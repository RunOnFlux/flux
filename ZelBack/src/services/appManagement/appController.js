const config = require('config');
const axios = require('axios');
const serviceHelper = require('../serviceHelper');
// Removed verificationHelper to avoid circular dependency - will use dynamic require where needed
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const registryManager = require('../appDatabase/registryManager');
const appsRuntimeState = require('./appsRuntimeState');
const appReconciler = require('../appMonitoring/appReconciler');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');
const fluxEventBus = require('../utils/fluxEventBus');
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
 * @param {object} [options]
 * @param {boolean} [options.awaitPass] hold until the reconcile pass has run
 * @param {boolean} [options.force] a stop is a hard kill, not a graceful stop
 * @param {boolean} [options.alsoRestart] raise the restart generation with the lock
 */
async function setAppOperatorStopped(appname, appSpecs, stopped, { awaitPass = false, force = false, alsoRestart = false } = {}) {
  const ids = (!appname.includes('_') && appSpecs && appSpecs.version > 3)
    ? appSpecs.compose.map((c) => `${c.name}_${appSpecs.name}`)
    : [appname];
  // Components come up in compose order and go down in the reverse of it, so a
  // dependency outlives what writes to it: the database stops after the server it
  // serves, not before it. awaitPass holds each component's pass open before the
  // next id is touched, so this order is the order the containers move in.
  // Reversed on the mapped ids, which is a fresh array - never on the spec, whose
  // compose array is shared with whatever the caller fetched it from.
  if (stopped) ids.reverse();
  let allActuated = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // Written through the reconciler's per-key slot rather than straight to the
    // store. A pass reads the lock and acts on that answer once docker has
    // replied, so a write landing in between is not seen: the pass starts a
    // container the operator has just stopped and the next pass stops it again.
    // applyIntent waits out any pass deciding for this id, holds the key while
    // the write lands, and enqueues on release - so the two cannot interleave,
    // and the next pass reads what was just written.
    // eslint-disable-next-line no-await-in-loop
    const actuated = await appReconciler.applyIntent(id, async () => {
      await appsRuntimeState.setOperatorStopped(id, stopped, { force });
      // Raised inside the same slot as the lock, so a pass cannot read one
      // without the other and bounce a container the operator meant to keep down.
      if (alsoRestart) await appsRuntimeState.requestRestart(id);
      // The operator's intent is the one desired-state write in this flow that
      // announced nothing, so nothing could be ordered against it - and the
      // failure it hides is an actuation on the PREVIOUS intent arriving after
      // this one landed. Published from inside the slot: after the write, so it
      // can never claim an intent that did not persist, and before the pass,
      // which is what makes it the ordering point.
      fluxEventBus.publish('app:operatorIntent', {
        // The bare component id the reconciler publishes its own actuations
        // under. An event carrying a different spelling of the same component
        // cannot be ordered against them, which is the only thing it is for.
        identifier: dockerService.getBaseAppName(id), stopped, force, restartRequested: alsoRestart,
      });
    }, { awaitPass });
    if (!actuated) allActuated = false;
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
  return { ids, actuated: allActuated };
}

/**
 * What the containers are actually doing, once the reconciler has had its pass.
 *
 * `actuated` says a pass ran, not that it achieved anything: a pass that finds
 * docker unreachable completes by deferring. So the answer to "is it stopped"
 * comes from probing, and dockerActual is the probe that can tell a container
 * being gone from docker being unreachable - which is the difference between
 * reporting done and reporting pending.
 * @param {string[]} ids Component identifiers.
 * @returns {Promise<{settled: boolean, reason: string|null}>}
 */
async function containersReachedStopped(ids) {
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const actual = await appReconciler.dockerActual(id);
    if (!actual.reachable) return { settled: false, reason: 'docker is not reachable' };
    if (actual.running) return { settled: false, reason: 'the reconciler has not stopped it yet' };
  }
  return { settled: true, reason: null };
}

// Why the reconciler is not running a component, in the operator's terms. The
// election cases are not failures: a synced component runs on the node the
// election made the writer, so "not started" is the correct outcome elsewhere
// and saying so is more use than a generic wait.
const NOT_RUNNING_REASONS = {
  awaitingController: 'waiting for the election',
  controllerDesired: 'the election has not made this node the writer',
  policy: 'its restart policy does not allow it to run',
  invalidSpec: 'its specification cannot be actuated',
  notInstalled: 'it is not installed on this node',
};

/**
 * What the containers are actually doing, once the reconciler has had its pass.
 *
 * The mirror of containersReachedStopped, with one asymmetry: a container that
 * is not running may be one the reconciler is right to leave alone, so the
 * reason comes from the reconciler's own verdict rather than from the absence.
 *
 * @param {string[]} ids Component identifiers.
 * @returns {Promise<{settled: boolean, reason: string|null}>}
 */
async function containersReachedRunning(ids) {
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const actual = await appReconciler.dockerActual(id);
    if (!actual.reachable) return { settled: false, reason: 'docker is not reachable' };
    if (actual.running) {
      // eslint-disable-next-line no-continue
      continue;
    }
    let verdict;
    try {
      // eslint-disable-next-line no-await-in-loop
      verdict = await appReconciler.desiredRunState(id);
    } catch (err) {
      return { settled: false, reason: `its state could not be read: ${err.message}` };
    }
    return {
      settled: false,
      reason: NOT_RUNNING_REASONS[verdict.reason] || 'the reconciler has not started it yet',
    };
  }
  return { settled: true, reason: null };
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

    // THE RECONCILER STARTS IT, NOT THIS HANDLER.
    //
    // Clearing the lock is the whole of an operator start: whether the container
    // may run is a decision the election already owns for a g:/r: component, and
    // the reconciler consults it on every pass. A handler that also probed docker
    // was asking a different question - "is this container running now" as a proxy
    // for "should this node be running it" - and those diverge both ways: a
    // primary whose container is stopped was refused a start, a standby whose
    // container happened to be up was started.
    //
    // awaitPass holds this handler until the pass has run, so a success still
    // means the container is running in the same wall-clock the direct call took.
    const isComponent = appname.includes('_'); // it is a component start
    let ids;
    let actuated;
    let startedName;

    if (isComponent) {
      ({ ids, actuated } = await setAppOperatorStopped(appname, null, false, { awaitPass: true }));
      startedName = appname;
    } else {
      // Check if app exists before starting
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      ({ ids, actuated } = await setAppOperatorStopped(appname, appSpecs, false, { awaitPass: true }));
      startedName = appSpecs.name;
    }

    // A pass that completed is not a container that started - docker being
    // unreachable completes by deferring, and a synced component the election
    // holds elsewhere is a pass that correctly did nothing. Probe rather than
    // infer, and name which of the two it was.
    const outcome = actuated
      ? await containersReachedRunning(ids)
      : { settled: false, reason: 'no reconcile has run yet' };

    if (!outcome.settled) {
      // Accepted, not applied. The intent is durable and the reconciler converges
      // on it; where the reason is the election, "not started here" is the correct
      // outcome rather than a failure, and the operator is told which it is.
      const pending = messageHelper.createDataMessage(
        `Application ${startedName} will be started: ${outcome.reason}`,
      );
      return res ? res.json(pending) : pending;
    }

    const appResponse = messageHelper.createDataMessage(`Application ${startedName} started`);
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

    // THE RECONCILER STOPS IT, NOT THIS HANDLER.
    //
    // Two things drove the container before this: the handler called
    // appDockerStop directly while the reconciler actuated off its own per-key
    // queue. Two writers to one container is what made an operator stop
    // interleave with a pass - the pass read the lock, the stop landed, the pass
    // started the container it had already decided to start. Writing the intent
    // and letting the single actuator converge removes the second writer rather
    // than narrowing the window between them.
    //
    // The contract is unchanged: awaitPass holds this handler until the pass has
    // run, so a success still means the container is stopped, in the same
    // wall-clock the direct call took.
    //
    // Monitoring goes with the container, so the reconciler turns it off when it
    // stops one. Doing it here stopped the sampler for a container the stop had
    // not reached - an unreachable docker left it running and unwatched.
    const isComponent = appname.includes('_'); // it is a component stop
    let ids;
    let actuated;
    let stoppedName;

    if (isComponent) {
      ({ ids, actuated } = await setAppOperatorStopped(appname, null, true, { awaitPass: true }));
      stoppedName = appname;
    } else {
      // Check if app exists before stopping
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      ({ ids, actuated } = await setAppOperatorStopped(appname, appSpecs, true, { awaitPass: true }));
      stoppedName = appSpecs.name;
    }

    // A pass that completed is not a container that stopped - docker being
    // unreachable completes by deferring. Probe rather than infer, so a stop
    // that has not happened yet is never reported as one that has.
    const outcome = actuated
      ? await containersReachedStopped(ids)
      : { settled: false, reason: 'no reconcile has run yet' };

    if (!outcome.settled) {
      // Accepted, not applied. The intent is durable and the reconciler will
      // converge, so an error here would be false - the old direct call threw
      // in exactly this case, after the lock had already been written.
      const pending = messageHelper.createDataMessage(
        `Application ${stoppedName} will be stopped: ${outcome.reason}`,
      );
      return res ? res.json(pending) : pending;
    }

    const appResponse = messageHelper.createDataMessage(`Application ${stoppedName} stopped`);
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

    // A RESTART IS DESIRED STATE, NOT A DOCKER CALL.
    //
    // "Make it run now" is the lock cleared and the restart generation raised.
    // The reconciler bounces a running container once the generation passes the
    // one it last actuated, and a stopped container is simply started - which is
    // the same request satisfied. Expressing it as a level rather than an action
    // is what removes the race: there is no window between this handler deciding
    // and the reconciler deciding, because only one of them decides.
    const isComponent = appname.includes('_'); // it is a component restart
    let ids;
    let actuated;
    let restartedName;

    if (isComponent) {
      ({ ids, actuated } = await setAppOperatorStopped(appname, null, false, { awaitPass: true, alsoRestart: true }));
      restartedName = appname;
    } else {
      // Check if app exists before restarting
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      ({ ids, actuated } = await setAppOperatorStopped(appname, appSpecs, false, { awaitPass: true, alsoRestart: true }));
      restartedName = appSpecs.name;
    }

    const outcome = actuated
      ? await containersReachedRunning(ids)
      : { settled: false, reason: 'no reconcile has run yet' };

    if (!outcome.settled) {
      const pending = messageHelper.createDataMessage(
        `Application ${restartedName} will be restarted: ${outcome.reason}`,
      );
      return res ? res.json(pending) : pending;
    }

    const appResponse = messageHelper.createDataMessage(`Application ${restartedName} restarted`);
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
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const verificationHelper = require('../verificationHelper');
    // Not appownerabove: that admits the node operator, and a hard kill of
    // someone else's app is not theirs to order. The owner and the flux team
    // only - the operator keeps every other lifecycle control.
    const authorized = await verificationHelper.verifyPrivilege('appownerorfluxteam', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    // A kill is a stop that carries a signal, so it is the same desired state
    // with a mode: the lock, plus force. The reconciler reads the mode where it
    // stops the container, which keeps the choice of signal beside the decision
    // to stop rather than in a handler racing it.
    const isComponent = appname.includes('_'); // it is a component kill
    let ids;
    let actuated;
    let killedName;

    if (isComponent) {
      ({ ids, actuated } = await setAppOperatorStopped(appname, null, true, { awaitPass: true, force: true }));
      killedName = appname;
    } else {
      // Check if app exists before killing
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      ({ ids, actuated } = await setAppOperatorStopped(appname, appSpecs, true, { awaitPass: true, force: true }));
      killedName = appSpecs.name;
    }

    const outcome = actuated
      ? await containersReachedStopped(ids)
      : { settled: false, reason: 'no reconcile has run yet' };

    if (!outcome.settled) {
      const pending = messageHelper.createDataMessage(
        `Application ${killedName} will be killed: ${outcome.reason}`,
      );
      return res ? res.json(pending) : pending;
    }

    const appResponse = messageHelper.createDataMessage(`Application ${killedName} killed`);
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
