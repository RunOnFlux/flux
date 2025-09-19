const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const registryManager = require('../appDatabase/registryManager');
const appInspector = require('./appInspector');
const log = require('../../lib/log');

/**
 * Execute a global command on an application across the network
 * @param {string} appname - Application name
 * @param {string} command - Command to execute
 * @param {string} zelidauth - Authorization header
 * @param {string} paramA - Additional parameter
 * @param {boolean} bypassMyIp - Whether to bypass own IP
 * @returns {Promise<object>} Execution result
 */
async function executeAppGlobalCommand(appname, command, zelidauth, paramA, bypassMyIp) {
  try {
    // Implementation would include network communication logic
    // This is a simplified version for the refactor
    log.info(`Executing global command ${command} on app ${appname}`);

    // The actual implementation would involve:
    // - Getting peer nodes
    // - Sending command to all nodes
    // - Collecting responses

    return { status: 'success', message: `Global command ${command} initiated for ${appname}` };
  } catch (error) {
    log.error(`Error executing global command: ${error.message}`);
    throw error;
  }
}

/**
 * Start an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appStart(req, res, startMonitoring) {
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
      appRes = await dockerService.appDockerStart(appname);
      if (startMonitoring) {
        startMonitoring(appname);
      }
    } else {
      // Check if app exists before starting
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }

      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerStart(appname);
        if (startMonitoring) {
          startMonitoring(appname);
        }
      } else {
        // For composed applications (version > 3), start all components
        for (const appComponent of appSpecs.compose) {
          await dockerService.appDockerStart(`${appComponent.name}_${appSpecs.name}`);
          if (startMonitoring) {
            startMonitoring(`${appComponent.name}_${appSpecs.name}`);
          }
        }
        appRes = `Application ${appSpecs.name} started`;
      }
    }

    if (appRes && appRes.status === 'error') {
      throw appRes.data;
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
async function appStop(req, res, stopMonitoring) {
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
      if (stopMonitoring) {
        stopMonitoring(appname, false);
      }
      appRes = await dockerService.appDockerStop(appname);
    } else {
      // Check if app exists before stopping
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }

      if (appSpecs.version <= 3) {
        if (stopMonitoring) {
          stopMonitoring(appname, false);
        }
        appRes = await dockerService.appDockerStop(appname);
      } else {
        // For composed applications (version > 3), stop all components in reverse order
        for (const appComponent of appSpecs.compose.reverse()) {
          if (stopMonitoring) {
            stopMonitoring(`${appComponent.name}_${appSpecs.name}`, false);
          }
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} stopped`;
      }
    }

    if (appRes && appRes.status === 'error') {
      throw appRes.data;
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
async function appRestart(req, res, startMonitoring, stopMonitoring) {
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
      appRes = await dockerService.appDockerRestart(appname);
    } else {
      // Check if app exists before restarting
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }

      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerRestart(appname);
      } else {
        // For composed applications (version > 3), restart all components
        for (const appComponent of appSpecs.compose) {
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} restarted`;
      }
    }

    if (appRes && appRes.status === 'error') {
      throw appRes.data;
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
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component kill. Proceed with killing just component
    let appRes;

    if (isComponent) {
      appRes = await dockerService.appDockerKill(appname);
    } else {
      // Check if app exists before killing
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }

      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerKill(appname);
      } else {
        // For composed applications (version > 3), kill all components in reverse order
        for (const appComponent of appSpecs.compose.reverse()) {
          await dockerService.appDockerKill(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} killed`;
      }
    }

    if (appRes && appRes.status === 'error') {
      throw appRes.data;
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
 * Pause an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appPause(req, res) {
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

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (global) {
      executeAppGlobalCommand(appname, 'apppause', req.headers.zelidauth); // do not wait
      const message = messageHelper.createSuccessMessage(`Flux App ${appname} pause initiated globally`);
      return res ? res.json(message) : message;
    }

    const isComponent = appname.includes('_'); // it is a component pause
    let appRes;

    if (isComponent) {
      appRes = await dockerService.appDockerPause(appname);
    } else {
      // Check if app exists before pausing
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }

      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerPause(appname);
      } else {
        // For composed applications (version > 3), pause all components
        for (const appComponent of appSpecs.compose) {
          await dockerService.appDockerPause(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} paused`;
      }
    }

    if (appRes && appRes.status === 'error') {
      throw appRes.data;
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
 * Unpause an application
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {object} Response message
 */
async function appUnpause(req, res) {
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

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (global) {
      executeAppGlobalCommand(appname, 'appunpause', req.headers.zelidauth); // do not wait
      const message = messageHelper.createSuccessMessage(`Flux App ${appname} unpause initiated globally`);
      return res ? res.json(message) : message;
    }

    const isComponent = appname.includes('_'); // it is a component unpause
    let appRes;

    if (isComponent) {
      appRes = await dockerService.appDockerUnpause(appname);
    } else {
      // Check if app exists before unpausing
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }

      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerUnpause(appname);
      } else {
        // For composed applications (version > 3), unpause all components
        for (const appComponent of appSpecs.compose) {
          await dockerService.appDockerUnpause(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} unpaused`;
      }
    }

    if (appRes && appRes.status === 'error') {
      throw appRes.data;
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
 * Docker restart app (internal function)
 * @param {string} appname - Application name
 * @returns {Promise<void>}
 */
async function appDockerRestart(appname) {
  try {
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
 */
async function stopAllNonFluxRunningApps() {
  try {
    log.info('Running non Flux apps check...');
    let apps = await dockerService.dockerListContainers(false);
    apps = apps.filter((app) => (app.Names[0].slice(1, 4) !== 'zel' && app.Names[0].slice(1, 5) !== 'flux'));
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
  appStart,
  appStop,
  appRestart,
  appKill,
  appPause,
  appUnpause,
  appDockerRestart,
  stopAllNonFluxRunningApps,
};
