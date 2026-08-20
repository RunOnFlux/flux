const config = require('config');
const axios = require('axios');
const serviceHelper = require('../serviceHelper');
// Removed verificationHelper to avoid circular dependency - will use dynamic require where needed
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const registryManager = require('../appDatabase/registryManager');
const appInspector = require('./appInspector');
const appsRuntimeState = require('./appsRuntimeState');
const appReconciler = require('../appMonitoring/appReconciler');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');
const log = require('../../lib/log');

const { globalCmdDelayMs } = config.fluxapps;
// Guaranteed a finite non-negative integer, so a missing or malformed config
// value can never spin the retry loop below forever.
const globalCmdBootRetries = (Number.isInteger(config.fluxapps.globalCmdBootRetries)
  && config.fluxapps.globalCmdBootRetries >= 0)
  ? config.fluxapps.globalCmdBootRetries
  : 8;

// A node still reconciling its apps after boot refuses these routes with 15s.
const BOOT_RETRY_AFTER_FALLBACK_S = 15;
// Caps a node's Retry-After so a hostile or absurd value cannot stall delivery.
const BOOT_RETRY_MAX_WAIT_MS = 60 * 1000;

/**
 * Send one global command to one instance, retrying only a boot-gate refusal.
 *
 * A node that has not finished reconciling its apps after boot answers these
 * routes with 503 + Retry-After (see requireBootSettled), which is
 * self-resolving - it settles within its boot window. Retrying that a bounded
 * number of times keeps a global command from being dropped on the first
 * refusal: without it a global appremove aimed at a node mid-restart never
 * lands, the app stays installed and running, and the owner was already told
 * the removal was queried. ONLY a 503 is retried; any other status is the
 * node's real answer and is final, and a node still refusing after the bound is
 * warned about rather than hammered forever.
 *
 * Errors are handled internally, so this never rejects - callers fire it and
 * move on.
 *
 * @param {string} url
 * @param {object} axiosConfig
 */
async function deliverGlobalCommand(url, axiosConfig) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await axios.get(url, axiosConfig);
      log.info(`Successfully sent command to ${url}: ${response.status}`);
      return;
    } catch (error) {
      const status = error.response && error.response.status;
      if (status !== 503) {
        log.error(`Axios request failed for ${url}`, error);
        return;
      }
      if (attempt >= globalCmdBootRetries) {
        log.warn(`Node at ${url} still reconciling apps after boot; command not delivered after ${globalCmdBootRetries} retries`);
        return;
      }
      const headerRetryAfter = Number(error.response.headers && error.response.headers['retry-after']);
      const retryAfterS = headerRetryAfter > 0 ? headerRetryAfter : BOOT_RETRY_AFTER_FALLBACK_S;
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(Math.min(retryAfterS * 1000, BOOT_RETRY_MAX_WAIT_MS));
    }
  }
}

/**
 * Get application locations from the global database
 * @param {string} appname - Application name
 * @returns {Promise<Array>} Application locations
 */
async function appLocation(appname) {
  // eslint-disable-next-line global-require
  const dbHelper = require('../dbHelper');
  // eslint-disable-next-line global-require
  const config = require('config');
  const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
      runningSince: 1,
      osUptime: 1,
      staticIp: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

/**
 * Execute a global command on an application across the network
 * @param {string} appname - Application name
 * @param {string} command - Command to execute
 * @param {string} zelidauth - Authorization header
 * @param {string} [paramA] - Additional parameter to append to URL
 * @param {boolean} [bypassMyIp] - Whether to bypass own IP
 * @returns {Promise<void>}
 */
async function executeAppGlobalCommand(appname, command, zelidauth, paramA, bypassMyIp) {
  try {
    // get a list of the specific app locations
    const locations = await appLocation(appname);
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    const localIp = extractIp(localSocketAddr);
    const localPort = extractPort(localSocketAddr);
    // eslint-disable-next-line no-restricted-syntax
    for (const appInstance of locations) {
      // HERE let the node we are connected to handle it
      const instanceIp = extractIp(appInstance.ip);
      const instancePort = extractPort(appInstance.ip);
      if (bypassMyIp && localIp === instanceIp && localPort === instancePort) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const axiosConfig = {
        headers: {
          zelidauth,
        },
      };
      let url = `http://${instanceIp}:${instancePort}/apps/${command}/${appname}`;
      if (paramA) {
        url += `/${paramA}`;
      }
      // Fire-and-forget: each node's delivery, with its own bounded retry of a
      // boot-gate 503, runs on its own while the loop paces the sends.
      deliverGlobalCommand(url, axiosConfig);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(globalCmdDelayMs);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Start an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
/**
 * Records the operator's desired run-state for an app (or single component) so
 * the reconciler honours a deliberate stop/kill and resumes on start. Spreads
 * to every component for a whole composed-app command.
 *
 * @param {string} appname app or component identifier
 * @param {object|null} appSpecs full app spec (null for a component command)
 * @param {boolean} stopped
 */
async function setAppOperatorStopped(appname, appSpecs, stopped) {
  const ids = (!appname.includes('_') && appSpecs && appSpecs.version > 3)
    ? appSpecs.compose.map((c) => `${c.name}_${appSpecs.name}`)
    : [appname];
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await appsRuntimeState.setOperatorStopped(id, stopped);
    // A stop retracts the controller's desire as well as taking the lock. The
    // lock only suppresses the reconciler while it is held; a desire left
    // standing is reconciled against the stopped container the moment the lock
    // lifts, restarting a g:/r: component with no election pass and putting it
    // beside whichever peer took over. Retracted, the component sits at "no
    // controller opinion" - take no action - until its decider re-derives
    // intent. Plain apps do not consult the controller, so their
    // resume-on-start is unchanged.
    //
    // The RUN opinion only. A pending appdata clear is the sync layer's finding
    // that the local data must not be trusted, and an operator stopping the app
    // says nothing about that - dropping it here would lose it for good, since
    // the sync layer marks a component processed before it asks.
    if (stopped) appReconciler.clearControllerDesired(id);
  }
}

async function appStart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    // eslint-disable-next-line global-require
    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const verificationHelper = require('../verificationHelper');
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (global) {
      executeAppGlobalCommand(appname, 'appstart', req.headers.zelidauth); // do not wait
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global start`);
      return res ? res.json(appResponse) : appResponse;
    }

    const isComponent = appname.includes('_'); // it is a component start
    let appRes;

    if (isComponent) {
      // user-initiated start clears the operator stop lock so the reconciler keeps it running
      await setAppOperatorStopped(appname, null, false);
      // For component start, check if it uses g:syncthing mode
      const componentMainApp = appname.split('_')[1];
      const appSpecs = await registryManager.getApplicationSpecifications(componentMainApp);
      if (appSpecs && appSpecs.version > 3) {
        const componentSpec = appSpecs.compose.find((comp) => `${comp.name}_${appSpecs.name}` === appname);
        if (componentSpec && componentSpec.containerData && componentSpec.containerData.includes('g:')) {
          // Check if component is running
          try {
            const containers = await dockerService.dockerListContainers(false); // Get only running containers
            const isRunning = containers.some((container) => container.Names[0] === dockerService.getAppDockerNameIdentifier(appname) || container.Id === appname);
            if (!isRunning) {
              log.info(`Skipping start for g:syncthing component ${appname} - not currently running`);
              appRes = `Component ${appname} uses g:syncthing mode and is not running - skipped start`;
              const appResponse = messageHelper.createDataMessage(appRes);
              return res ? res.json(appResponse) : appResponse;
            }
          } catch (error) {
            log.warn(`Could not check running status for ${appname}: ${error.message}`);
          }
        }
      }
      appRes = await dockerService.appDockerStart(appname);
      appInspector.startAppMonitoring(appname);
    } else {
      // Check if app exists before starting
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      // user-initiated start clears the operator stop lock so the reconciler keeps it running
      await setAppOperatorStopped(appname, appSpecs, false);

      if (appSpecs.version <= 3) {
        // For non-composed apps, check if it uses g:syncthing mode
        if (appSpecs.containerData && appSpecs.containerData.includes('g:')) {
          try {
            const containers = await dockerService.dockerListContainers(false);
            const isRunning = containers.some((container) => container.Names[0] === dockerService.getAppDockerNameIdentifier(appname) || container.Id === appname);
            if (!isRunning) {
              log.info(`Skipping start for g:syncthing app ${appname} - not currently running`);
              appRes = `Application ${appname} uses g:syncthing mode and is not running - skipped start`;
              const appResponse = messageHelper.createDataMessage(appRes);
              return res ? res.json(appResponse) : appResponse;
            }
          } catch (error) {
            log.warn(`Could not check running status for ${appname}: ${error.message}`);
          }
        }
        appRes = await dockerService.appDockerStart(appname);
        appInspector.startAppMonitoring(appname);
      } else {
        // For composed applications (version > 3), start all components
        log.info(`Starting composed app ${appSpecs.name} with ${appSpecs.compose.length} components`);
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          const componentName = `${appComponent.name}_${appSpecs.name}`;
          // Check if component uses g:syncthing mode
          if (appComponent.containerData && appComponent.containerData.includes('g:')) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const containers = await dockerService.dockerListContainers(false);
              const isRunning = containers.some((container) => container.Names[0] === dockerService.getAppDockerNameIdentifier(componentName) || container.Id === componentName);
              if (!isRunning) {
                log.info(`Skipping start for g:syncthing component ${componentName} - not currently running`);
                // eslint-disable-next-line no-continue
                continue;
              }
            } catch (error) {
              log.warn(`Could not check running status for ${componentName}: ${error.message}`);
            }
          }
          log.info(`Starting component: ${componentName}`);
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStart(componentName);
          log.info(`Component ${componentName} started, starting monitoring`);
          appInspector.startAppMonitoring(componentName);
          log.info(`Monitoring started for ${componentName}`);
        }
        log.info(`All components started for ${appSpecs.name}`);
        appRes = `Application ${appSpecs.name} started`;
      }
    }

    const appResponse = messageHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Stop an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appStop(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    if (!appname) {
      throw new Error('No Flux App specified');
    }
    // eslint-disable-next-line global-require

    const mainAppName = appname.split('_')[1] || appname;

    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const verificationHelper = require('../verificationHelper');
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (global) {
      executeAppGlobalCommand(appname, 'appstop', req.headers.zelidauth); // do not wait
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global stop`);
      return res ? res.json(appResponse) : appResponse;
    }

    const isComponent = appname.includes('_'); // it is a component stop
    let appRes;

    if (isComponent) {
      // lock BEFORE the docker op (matching the whole-app path): a crash between
      // the stop and the lock write would leave a stopped container the
      // reconciler restarts against the operator's intent
      await setAppOperatorStopped(appname, null, true);
      appInspector.stopAppMonitoring(appname, false);
      appRes = await dockerService.appDockerStop(appname);
    } else {
      // Check if app exists before stopping
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      // operator stop persists so the reconciler does not restart it
      await setAppOperatorStopped(appname, appSpecs, true);

      // eslint-disable-next-line no-restricted-syntax
      if (appSpecs.version <= 3) {
        // eslint-disable-next-line no-await-in-loop
        appInspector.stopAppMonitoring(appname, false);
        appRes = await dockerService.appDockerStop(appname);
      } else {
        // For composed applications (version > 3), stop all components in reverse order
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose.reverse()) {
          appInspector.stopAppMonitoring(`${appComponent.name}_${appSpecs.name}`, false);
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} stopped`;
      }
    }

    const appResponse = messageHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Restart an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appRestart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    // eslint-disable-next-line global-require
    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const verificationHelper = require('../verificationHelper');
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (global) {
      executeAppGlobalCommand(appname, 'apprestart', req.headers.zelidauth); // do not wait
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global restart`);
      return res ? res.json(appResponse) : appResponse;
    }

    const isComponent = appname.includes('_'); // it is a component restart
    let appRes;

    if (isComponent) {
      // user-initiated restart means "make it run": clear the operator stop lock
      // (before the docker op) so the reconciler keeps it running afterwards
      await setAppOperatorStopped(appname, null, false);
      // For component restart, check if it uses g:syncthing mode
      const componentMainApp = appname.split('_')[1];
      const appSpecs = await registryManager.getApplicationSpecifications(componentMainApp);
      if (appSpecs && appSpecs.version > 3) {
        const componentSpec = appSpecs.compose.find((comp) => `${comp.name}_${appSpecs.name}` === appname);
        if (componentSpec && componentSpec.containerData && componentSpec.containerData.includes('g:')) {
          // Check if component is running
          try {
            const containers = await dockerService.dockerListContainers(false); // Get only running containers
            const isRunning = containers.some((container) => container.Names[0] === dockerService.getAppDockerNameIdentifier(appname) || container.Id === appname);
            if (!isRunning) {
              log.info(`Skipping restart for g:syncthing component ${appname} - not currently running`);
              appRes = `Component ${appname} uses g:syncthing mode and is not running - skipped restart`;
              const appResponse = messageHelper.createDataMessage(appRes);
              return res ? res.json(appResponse) : appResponse;
            }
          } catch (error) {
            log.warn(`Could not check running status for ${appname}: ${error.message}`);
          }
        }
      }
      appRes = await dockerService.appDockerRestart(appname);
    } else {
      // Check if app exists before restarting
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      // eslint-disable-next-line no-restricted-syntax
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      // user-initiated restart means "make it run": clear the operator stop lock
      // for every component (before the docker ops), matching appStart
      await setAppOperatorStopped(appname, appSpecs, false);

      if (appSpecs.version <= 3) {
        // For non-composed apps, check if it uses g:syncthing mode
        if (appSpecs.containerData && appSpecs.containerData.includes('g:')) {
          try {
            const containers = await dockerService.dockerListContainers(false);
            const isRunning = containers.some((container) => container.Names[0] === dockerService.getAppDockerNameIdentifier(appname) || container.Id === appname);
            if (!isRunning) {
              log.info(`Skipping restart for g:syncthing app ${appname} - not currently running`);
              appRes = `Application ${appname} uses g:syncthing mode and is not running - skipped restart`;
              const appResponse = messageHelper.createDataMessage(appRes);
              return res ? res.json(appResponse) : appResponse;
            }
          } catch (error) {
            log.warn(`Could not check running status for ${appname}: ${error.message}`);
          }
        }
        appRes = await dockerService.appDockerRestart(appname);
      } else {
        // For composed applications (version > 3), restart all components
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          const componentName = `${appComponent.name}_${appSpecs.name}`;
          // Check if component uses g:syncthing mode
          if (appComponent.containerData && appComponent.containerData.includes('g:')) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const containers = await dockerService.dockerListContainers(false);
              const isRunning = containers.some((container) => container.Names[0] === dockerService.getAppDockerNameIdentifier(componentName) || container.Id === componentName);
              if (!isRunning) {
                log.info(`Skipping restart for g:syncthing component ${componentName} - not currently running`);
                // eslint-disable-next-line no-continue
                continue;
              }
            } catch (error) {
              log.warn(`Could not check running status for ${componentName}: ${error.message}`);
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} restarted`;
      }
    }

    const appResponse = messageHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Kill an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appKill(req, res) {
  try {
    let { appname } = req.params;
    // eslint-disable-next-line global-require
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const verificationHelper = require('../verificationHelper');
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component kill. Proceed with killing just component
    let appRes;

    if (isComponent) {
      // lock BEFORE the docker op (matching the whole-app path) - crash-safe direction
      await setAppOperatorStopped(appname, null, true);
      appRes = await dockerService.appDockerKill(appname);
    } else {
      // eslint-disable-next-line no-restricted-syntax
      // Check if app exists before killing
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      // operator kill persists so the reconciler does not restart it
      await setAppOperatorStopped(appname, appSpecs, true);

      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerKill(appname);
      } else {
        // For composed applications (version > 3), kill all components in reverse order
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose.reverse()) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerKill(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} killed`;
      }
    }

    const appResponse = messageHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Pause and unpause were removed: docker reports a paused container as running, so the
 * reconciler and the load balancer both treat it as healthy and keep routing to it,
 * while nothing in FluxOS can see that it is frozen. The routes answer with an error
 * rather than a success so a caller is not told the container stopped when it has not.
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function deprecatedPauseResponse(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (appname) {
      // Validated before anything is done with it. Express's default extended
      // query parser turns ?appname=a&appname=b into an ARRAY and ?appname[x]=1
      // into an object, neither of which has .split - and this runs ahead of
      // verifyPrivilege because the app name is what the privilege is scoped to,
      // so it is reachable unauthenticated from the open internet.
      //
      // Unguarded, the rejection was dropped and the response never written: the
      // socket stayed open with nothing left to answer it, since fluxServer sets
      // a two-hour requestTimeout and node stops applying it once the request has
      // been received.
      if (typeof appname !== 'string') {
        throw new Error('Invalid Flux App name specified');
      }
      const mainAppName = appname.split('_')[1] || appname;
      // eslint-disable-next-line global-require
      const verificationHelper = require('../verificationHelper');
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res ? res.json(errMessage) : errMessage;
      }
    }

    const errorResponse = messageHelper.createErrorMessage(
      'Pausing applications is no longer supported. Use appstop to stop an application.',
      'Deprecated',
      410,
    );
    return res ? res.json(errorResponse) : errorResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Pause an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appPause(req, res) {
  return deprecatedPauseResponse(req, res);
}

/**
 * Unpause an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appUnpause(req, res) {
  return deprecatedPauseResponse(req, res);
}
/**
 * Docker restart app (internal function)
 * @param {string} appname - Application name
 * @returns {Promise<void>}
 */
async function appDockerRestart(appname) {
  try {
    // mainAppName extracted for potential future use
    // eslint-disable-next-line no-unused-vars
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerRestart(appname);
      // Note: startAppMonitoring would need to be injected or called separately
      log.info(`Component ${appname} restarted successfully`);
    } else {
      // ask for restarting entire composed application
      // This would need getApplicationSpecifications from registryManager
      log.info(`Restarting entire application ${appname}`);
      await dockerService.appDockerRestart(appname);
    }
  } catch (error) {
    log.error(`Docker restart failed for ${appname}: ${error.message}`);
    throw error;
  }
}

/**
 * To stop all non Flux running apps. Executes continuously at regular intervals.
 *
 * What is kept is everything FluxOS owns, not everything that is an app: the
 * node runs short-lived containers of its own - a file operation is one - and
 * those are unnamed, so docker gives them a random name that no prefix test can
 * tell from a tenant's. Selecting on the ownership label instead means a long
 * copy is not stopped out from under its caller by a sweep that runs every two
 * hours.
 */
async function stopAllNonFluxRunningApps() {
  try {
    log.info('Running non Flux apps check...');
    let apps = await dockerService.dockerListContainers(false);
    apps = apps.filter((app) => !dockerService.isFluxOwnedContainer(app));
    if (apps.length > 0) {
      log.info(`Found ${apps.length} apps to be stopped...`);
      // eslint-disable-next-line no-restricted-syntax
      for (const app of apps) {
        try {
          log.info(`Stopping non Flux app ${app.Names[0]}`);
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(app.Id); // continue if failed to stop one app
          log.info(`Non Flux app ${app.Names[0]} stopped.`);
        } catch (error) {
          log.error(`Failed to stop non Flux app ${app.Names[0]}.`);
        }
      }
    } else {
      log.info('Only Flux apps are running.');
    }
    setTimeout(() => {
      stopAllNonFluxRunningApps();
    }, 2 * 60 * 60 * 1000); // execute every 2h
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      stopAllNonFluxRunningApps();
    }, 30 * 60 * 1000); // In case of an error execute after 30m
  }
}

module.exports = {
  executeAppGlobalCommand,
  deliverGlobalCommand,
  appStart,
  appStop,
  appRestart,
  appKill,
  appPause,
  appUnpause,
  appDockerRestart,
  stopAllNonFluxRunningApps,
};
