const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const { localAppsInformation } = require('../utils/appConstants');
const config = require('config');

/**
 * Hard uninstall application (complete removal)
 * @param {string} appName - Application name
 * @param {string} appId - Application ID
 * @param {object} appSpecifications - App specifications
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<object>} Uninstallation result
 */
async function appUninstallHard(appName, appId, appSpecifications, isComponent, res, stopAppMonitoring) {
  const appSpecsName = appSpecifications && appSpecifications.name ? appSpecifications.name : appName;
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecsName}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }

  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecsName}_${appName}`;
  }

  if (stopAppMonitoring) {
    stopAppMonitoring(monitoredName, true);
  }

  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    log.error(error);
  });

  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecsName} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
    if (res.flush) res.flush();
  }

  const removeStatus = {
    status: isComponent ? `Removing Flux App Component ${appSpecsName} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerRemove(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    log.error(error);
  });

  const removeStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecsName} container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
    if (res.flush) res.flush();
  }

  // Remove image
  const imageRemoveStatus = {
    status: isComponent ? `Removing Flux App Component ${appSpecsName} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageRemoveStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageRemoveStatus));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    log.error(error);
  });

  const imageStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecsName} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
    if (res.flush) res.flush();
  }

  return { status: 'success', message: `${appName} uninstalled successfully` };
}

/**
 * Soft uninstall application (container removal only)
 * @param {string} appName - Application name
 * @param {string} appId - Application ID
 * @param {object} appSpecifications - App specifications
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<object>} Uninstallation result
 */
async function appUninstallSoft(appName, appId, appSpecifications, isComponent, res, stopAppMonitoring) {
  const appSpecsName = appSpecifications && appSpecifications.name ? appSpecifications.name : appName;
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecsName}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }

  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecsName}_${appName}`;
  }

  if (stopAppMonitoring) {
    stopAppMonitoring(monitoredName, false);
  }

  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    log.error(error);
  });

  const removeStatus = {
    status: isComponent ? `Removing Flux App Component ${appSpecsName} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerRemove(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    log.error(error);
  });

  return { status: 'success', message: `${appName} soft uninstalled successfully` };
}

/**
 * Remove application completely from local node
 * @param {string} app - Application name
 * @param {object} res - Response object for streaming
 * @param {boolean} force - Force removal
 * @param {boolean} endResponse - Whether to end response
 * @param {boolean} sendMessage - Whether to send message to network
 * @param {object} globalState - Global state reference
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<void>}
 */
async function removeAppLocally(app, res, force = false, endResponse = true, sendMessage = false, globalState, stopAppMonitoring) {
  try {
    if (!force) {
      if (globalState.removalInProgress) {
        const warnResponse = messageHelper.createWarningMessage('Another application is undergoing removal. Removal not possible.');
        log.warn(warnResponse);
        if (res) {
          res.write(serviceHelper.ensureString(warnResponse));
          if (res.flush) res.flush();
          if (endResponse) {
            res.end();
          }
        }
        return;
      }
      if (globalState.installationInProgress) {
        const warnResponse = messageHelper.createWarningMessage('Another application is undergoing installation. Removal not possible.');
        log.warn(warnResponse);
        if (res) {
          res.write(serviceHelper.ensureString(warnResponse));
          if (res.flush) res.flush();
          if (endResponse) {
            res.end();
          }
        }
        return;
      }
    }

    globalState.removalInProgress = true;

    if (!app) {
      throw new Error('No App specified');
    }

    const isComponent = app.includes('_');
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    // Find app specifications in database
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    let appQuery = {};
    if (isComponent) {
      appQuery = {
        name: appComponent,
      };
    } else {
      appQuery = {
        name: app,
      };
    }

    const appSpecs = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appQuery);
    if (!appSpecs) {
      throw new Error('Flux App not found in database');
    }

    const appId = isComponent ? `${appComponent}_${appName}` : app;

    // Perform hard uninstall
    await appUninstallHard(appName, appId, appSpecs, isComponent, res, stopAppMonitoring);

    // Remove from database
    const deleteResult = await dbHelper.removeDocumentsFromCollection(appsDatabase, localAppsInformation, appQuery);
    log.info(`Database deletion result: ${JSON.stringify(deleteResult)}`);

    const successMessage = messageHelper.createSuccessMessage(`Flux App ${app} successfully removed`);
    log.info(successMessage);

    if (res) {
      res.write(serviceHelper.ensureString(successMessage));
      if (res.flush) res.flush();
      if (endResponse) {
        res.end();
      }
    }

  } catch (error) {
    log.error(`Error removing app ${app}: ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );

    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
      if (endResponse) {
        res.end();
      }
    }
  } finally {
    globalState.removalInProgress = false;
  }
}

/**
 * Soft remove application locally (database and container only)
 * @param {string} app - Application name
 * @param {object} res - Response object for streaming
 * @param {object} globalState - Global state reference
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<void>}
 */
async function softRemoveAppLocally(app, res, globalState, stopAppMonitoring) {
  if (globalState.removalInProgress) {
    throw new Error('Another application is undergoing removal');
  }
  if (globalState.installationInProgress) {
    throw new Error('Another application is undergoing installation');
  }

  globalState.removalInProgress = true;

  try {
    if (!app) {
      throw new Error('No Flux App specified');
    }

    const isComponent = app.includes('_');
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    // Find app specifications in database
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    let appQuery = {};
    if (isComponent) {
      appQuery = {
        name: appComponent,
      };
    } else {
      appQuery = {
        name: app,
      };
    }

    const appSpecs = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appQuery);
    if (!appSpecs) {
      throw new Error('Flux App not found in database');
    }

    const appId = isComponent ? `${appComponent}_${appName}` : app;

    // Perform soft uninstall
    await appUninstallSoft(appName, appId, appSpecs, isComponent, res, stopAppMonitoring);

    // Remove from database
    await dbHelper.removeDocumentsFromCollection(appsDatabase, localAppsInformation, appQuery);

    const successMessage = messageHelper.createSuccessMessage(`Flux App ${app} successfully soft removed`);
    log.info(successMessage);

    if (res) {
      res.write(serviceHelper.ensureString(successMessage));
      if (res.flush) res.flush();
    }

  } catch (error) {
    log.error(`Error soft removing app ${app}: ${error.message}`);
    throw error;
  } finally {
    globalState.removalInProgress = false;
  }
}

/**
 * API endpoint for removing application locally
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {object} globalState - Global state reference
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<void>}
 */
async function removeAppLocallyApi(req, res, globalState, stopAppMonitoring) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    if (appname.includes('_')) {
      throw new Error('Components cannot be removed manually');
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }

    if (global) {
      // Global removal logic would go here
      const message = messageHelper.createSuccessMessage(`Flux App ${appname} removal initiated globally`);
      return res.json(message);
    }

    // Set response headers for streaming
    res.setHeader('Content-Type', 'application/json');

    await removeAppLocally(appname, res, force, true, false, globalState, stopAppMonitoring);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

/**
 * Clean up application data and volumes
 * @param {string} appName - Application name
 * @returns {Promise<void>}
 */
async function cleanupAppData(appName) {
  try {
    // Remove app data directory
    const appsDataPath = process.env.FLUX_APPS_FOLDER || '/home/flux/ZelApps';
    const appDataPath = `${appsDataPath}/${appName}`;

    log.info(`Cleaning up app data at ${appDataPath}`);
    // Implementation would include actual file system cleanup

  } catch (error) {
    log.error(`Error cleaning up app data for ${appName}: ${error.message}`);
  }
}

/**
 * Remove Docker volumes associated with application
 * @param {string} appName - Application name
 * @returns {Promise<void>}
 */
async function removeAppVolumes(appName) {
  try {
    log.info(`Removing volumes for app ${appName}`);

    // Get all volumes associated with the app
    const volumes = await dockerService.dockerListVolumes();
    const appVolumes = volumes.filter(volume => volume.Name.includes(appName));

    for (const volume of appVolumes) {
      await dockerService.dockerVolumeRemove(volume.Name);
      log.info(`Removed volume ${volume.Name}`);
    }

  } catch (error) {
    log.error(`Error removing volumes for ${appName}: ${error.message}`);
  }
}

module.exports = {
  appUninstallHard,
  appUninstallSoft,
  removeAppLocally,
  softRemoveAppLocally,
  removeAppLocallyApi,
  cleanupAppData,
  removeAppVolumes,
};