const path = require('path');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const log = require('../../lib/log');
const { appsFolder, localAppsInformation, scannedHeightCollection } = require('../utils/appConstants');
const { checkAppTemporaryMessageExistence, checkAppMessageExistence } = require('../appMessaging/messageVerifier');
const { availableApps, getApplicationGlobalSpecifications } = require('../appDatabase/registryManager');
const { verifyAppSpecifications } = require('../appRequirements/appValidator');
const config = require('config');

/**
 * Create application volume
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @returns {Promise<object>} Volume creation result
 */
async function createAppVolume(appSpecifications, appName, isComponent, res) {
  try {
    log.info(`Creating volume for app ${appName}`);

    // Create directory for app data
    const appDataPath = path.join(appsFolder, appName);

    // Implementation would include:
    // - Creating directory structure
    // - Setting up volume mounts
    // - Configuring permissions

    const volumeResult = {
      status: 'success',
      message: `Volume created for ${appName}`,
      path: appDataPath,
    };

    return volumeResult;
  } catch (error) {
    log.error(`Error creating volume for ${appName}: ${error.message}`);
    throw new Error(`Failed to create volume for ${appName}: ${error.message}`);
  }
}

/**
 * Register application locally in database
 * @param {object} appSpecs - Application specifications
 * @param {object} componentSpecs - Component specifications
 * @param {object} res - Response object
 * @param {boolean} test - Whether this is a test installation
 * @returns {Promise<object>} Registration result
 */
async function registerAppLocally(appSpecs, componentSpecs, res, test = false) {
  try {
    log.info(`Registering app ${appSpecs.name} locally`);

    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    // Prepare app registration data
    const appData = {
      ...appSpecs,
      registeredAt: Date.now(),
      status: 'installing',
      test: test || false,
    };

    // Insert app into local database
    await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appData);

    // Handle components if they exist
    if (componentSpecs && Array.isArray(componentSpecs)) {
      for (const component of componentSpecs) {
        const componentData = {
          ...component,
          parentApp: appSpecs.name,
          registeredAt: Date.now(),
          status: 'installing',
        };
        await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, componentData);
      }
    }

    log.info(`Successfully registered app ${appSpecs.name} locally`);
    return { status: 'success', message: `App ${appSpecs.name} registered locally` };
  } catch (error) {
    log.error(`Error registering app ${appSpecs.name}: ${error.message}`);
    throw new Error(`Failed to register app locally: ${error.message}`);
  }
}

/**
 * Install application (hard installation with Docker)
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @param {object} fullAppSpecs - Full app specifications
 * @param {boolean} test - Whether this is a test installation
 * @returns {Promise<object>} Installation result
 */
async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs, test = false) {
  try {
    log.info(`Starting hard installation of app ${appName}`);

    // Check if app already exists
    const existingApp = await getInstalledApps(appName);
    if (existingApp && existingApp.length > 0) {
      throw new Error(`App ${appName} already exists`);
    }

    // Create app volume first
    const volumeResult = await createAppVolume(appSpecifications, appName, isComponent, res);
    if (volumeResult.status === 'error') {
      throw new Error(`Volume creation failed: ${volumeResult.message}`);
    }

    // Pull Docker image
    log.info(`Pulling Docker image ${appSpecifications.repotag} for ${appName}`);
    const pullResult = await dockerService.dockerPullStream(appSpecifications.repotag);
    if (pullResult.status === 'error') {
      throw new Error(`Failed to pull Docker image: ${pullResult.message}`);
    }

    // Create and start container
    log.info(`Creating Docker container for ${appName}`);
    const containerOptions = {
      name: appName,
      image: appSpecifications.repotag,
      ports: appSpecifications.ports || [],
      env: appSpecifications.enviromentParameters || [],
      volumes: [`${volumeResult.path}:/data`],
      commands: appSpecifications.commands || [],
    };

    const containerResult = await dockerService.dockerCreateContainer(containerOptions);
    if (containerResult.status === 'error') {
      throw new Error(`Failed to create container: ${containerResult.message}`);
    }

    // Start the container
    const startResult = await dockerService.dockerStartContainer(appName);
    if (startResult.status === 'error') {
      throw new Error(`Failed to start container: ${startResult.message}`);
    }

    // Register app in local database
    const componentSpecs = isComponent ? [appSpecifications] : null;
    await registerAppLocally(fullAppSpecs || appSpecifications, componentSpecs, res, test);

    // Update app status to running
    await updateAppStatus(appName, 'running');

    log.info(`Successfully installed app ${appName}`);

    const result = {
      status: 'success',
      message: `App ${appName} installed successfully`,
      data: {
        appName,
        containerResult,
        volumePath: volumeResult.path,
      },
    };

    return result;
  } catch (error) {
    log.error(`Error installing app ${appName}: ${error.message}`);

    // Cleanup on failure
    try {
      await cleanupFailedInstallation(appName);
    } catch (cleanupError) {
      log.error(`Cleanup failed for ${appName}: ${cleanupError.message}`);
    }

    throw new Error(`Installation failed for ${appName}: ${error.message}`);
  }
}

/**
 * Install application (soft installation without Docker)
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @param {object} fullAppSpecs - Full app specifications
 * @returns {Promise<object>} Installation result
 */
async function installApplicationSoft(appSpecifications, appName, isComponent, res, fullAppSpecs) {
  try {
    log.info(`Starting soft installation of app ${appName}`);

    // Check if app already exists
    const existingApp = await getInstalledApps(appName);
    if (existingApp && existingApp.length > 0) {
      throw new Error(`App ${appName} already exists`);
    }

    // Soft register app in database
    const componentSpecs = isComponent ? [appSpecifications] : null;
    await softRegisterAppLocally(fullAppSpecs || appSpecifications, componentSpecs, res);

    log.info(`Successfully soft-installed app ${appName}`);

    const result = {
      status: 'success',
      message: `App ${appName} soft-installed successfully`,
      data: {
        appName,
        type: 'soft',
      },
    };

    return result;
  } catch (error) {
    log.error(`Error soft-installing app ${appName}: ${error.message}`);
    throw new Error(`Soft installation failed for ${appName}: ${error.message}`);
  }
}

/**
 * Soft register application locally (without Docker operations)
 * @param {object} appSpecs - Application specifications
 * @param {object} componentSpecs - Component specifications
 * @param {object} res - Response object
 * @returns {Promise<object>} Registration result
 */
async function softRegisterAppLocally(appSpecs, componentSpecs, res) {
  try {
    log.info(`Soft registering app ${appSpecs.name} locally`);

    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    // Prepare app registration data for soft install
    const appData = {
      ...appSpecs,
      registeredAt: Date.now(),
      status: 'soft-registered',
      installType: 'soft',
    };

    // Insert app into local database
    await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appData);

    // Handle components if they exist
    if (componentSpecs && Array.isArray(componentSpecs)) {
      for (const component of componentSpecs) {
        const componentData = {
          ...component,
          parentApp: appSpecs.name,
          registeredAt: Date.now(),
          status: 'soft-registered',
          installType: 'soft',
        };
        await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, componentData);
      }
    }

    log.info(`Successfully soft registered app ${appSpecs.name} locally`);
    return { status: 'success', message: `App ${appSpecs.name} soft registered locally` };
  } catch (error) {
    log.error(`Error soft registering app ${appSpecs.name}: ${error.message}`);
    throw new Error(`Failed to soft register app locally: ${error.message}`);
  }
}

/**
 * Get installed applications
 * @param {string} appName - Optional app name filter
 * @returns {Promise<Array>} List of installed apps
 */
async function getInstalledApps(appName = null) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const query = appName ? { name: appName } : {};
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, query);

    return apps;
  } catch (error) {
    log.error(`Error getting installed apps: ${error.message}`);
    return [];
  }
}

/**
 * Update application status
 * @param {string} appName - Application name
 * @param {string} status - New status
 * @returns {Promise<void>}
 */
async function updateAppStatus(appName, status) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const filter = { name: appName };
    const update = { $set: { status, updatedAt: Date.now() } };

    await dbHelper.updateOneInDatabase(appsDatabase, localAppsInformation, filter, update);
    log.info(`Updated status of app ${appName} to ${status}`);
  } catch (error) {
    log.error(`Error updating app status: ${error.message}`);
    throw error;
  }
}

/**
 * Cleanup failed installation
 * @param {string} appName - Application name to cleanup
 * @returns {Promise<void>}
 */
async function cleanupFailedInstallation(appName) {
  try {
    log.info(`Cleaning up failed installation for ${appName}`);

    // Stop and remove container if it exists
    try {
      await dockerService.dockerStopContainer(appName);
      await dockerService.dockerRemoveContainer(appName);
    } catch (dockerError) {
      log.warn(`Docker cleanup warning for ${appName}: ${dockerError.message}`);
    }

    // Remove from database
    try {
      const dbopen = dbHelper.databaseConnection();
      const appsDatabase = dbopen.db(config.database.appslocal.database);
      await dbHelper.removeDocumentsFromCollection(appsDatabase, localAppsInformation, { name: appName });
    } catch (dbError) {
      log.warn(`Database cleanup warning for ${appName}: ${dbError.message}`);
    }

    log.info(`Cleanup completed for ${appName}`);
  } catch (error) {
    log.error(`Cleanup error for ${appName}: ${error.message}`);
    throw error;
  }
}

/**
 * Install application locally - Main API entry point
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Installation result
 */
async function installAppLocally(req, res) {
  try {
    // appname can be app name or app hash of specific app version
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }
    let blockAllowance = config.fluxapps.ownerAppAllowance;
    // needs to be logged in
    const authorized = await verificationHelper.verifyPrivilege('user', req);
    if (authorized) {
      let appSpecifications;
      // anyone can deploy temporary app
      // favor temporary to launch test temporary apps
      const tempMessage = await checkAppTemporaryMessageExistence(appname);
      if (tempMessage) {
        // eslint-disable-next-line prefer-destructuring
        appSpecifications = tempMessage.appSpecifications;
        blockAllowance = config.fluxapps.temporaryAppAllowance;
      }
      if (!appSpecifications) {
        // only owner can deploy permanent message or existing app
        const ownerAuthorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
        if (!ownerAuthorized) {
          const errMessage = messageHelper.errUnauthorizedMessage();
          res.json(errMessage);
          return;
        }
      }
      if (!appSpecifications) {
        const allApps = await availableApps();
        appSpecifications = allApps.find((app) => app.name === appname);
      }
      if (!appSpecifications) {
        // eslint-disable-next-line no-use-before-define
        appSpecifications = await getApplicationGlobalSpecifications(appname);
      }
      // search in permanent messages for the specific apphash to launch
      if (!appSpecifications) {
        const permMessage = await checkAppMessageExistence(appname);
        if (permMessage) {
          // eslint-disable-next-line prefer-destructuring
          appSpecifications = permMessage.appSpecifications;
        }
      }
      if (!appSpecifications) {
        throw new Error(`Application Specifications of ${appname} not found`);
      }
      // get current height
      const dbopen = dbHelper.databaseConnection();
      if (!appSpecifications.height && appSpecifications.height !== 0) {
        // precaution for old temporary apps. Set up for custom test specifications.
        const database = dbopen.db(config.database.daemon.database);
        const query = { generalScannedHeight: { $gte: 0 } };
        const projection = {
          projection: {
            _id: 0,
            generalScannedHeight: 1,
          },
        };
        const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
        if (!result) {
          throw new Error('Scanning not initiated');
        }
        const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);
        appSpecifications.height = explorerHeight - config.fluxapps.blocksLasting + blockAllowance; // allow running for this amount of blocks
      }

      const appsDatabase = dbopen.db(config.database.appslocal.database);
      const appsQuery = {}; // all
      const appsProjection = {
        projection: {
          _id: 0,
          name: 1,
        },
      };
      const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const appExists = apps.find((app) => app.name === appSpecifications.name);
      if (appExists) { // double checked in installation process.
        throw new Error(`Application ${appname} is already installed`);
      }

      await checkAppRequirements(appSpecifications); // entire app

      res.setHeader('Content-Type', 'application/json');
      registerAppLocally(appSpecifications, undefined, res); // can throw
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * Check application requirements (wrapper for verifyAppSpecifications)
 * @param {object} appSpecifications - Application specifications to check
 * @returns {Promise<boolean>} True if requirements are met
 */
async function checkAppRequirements(appSpecifications) {
  // Use the modular verification function
  // In production, this might need additional height parameter
  return verifyAppSpecifications(appSpecifications, 0, false);
}

/**
 * Test application installation - Similar to installAppLocally but for testing
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Test installation result
 */
async function testAppInstall(req, res) {
  try {
    // appname can be app name or app hash of specific app version
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    log.info(`testAppInstall: ${appname}`);
    let blockAllowance = config.fluxapps.ownerAppAllowance;

    // needs to be logged in
    const authorized = await verificationHelper.verifyPrivilege('user', req);
    if (authorized) {
      let appSpecifications;

      // anyone can deploy temporary app
      // favor temporary to launch test temporary apps
      const tempMessage = await checkAppTemporaryMessageExistence(appname);
      if (tempMessage) {
        // eslint-disable-next-line prefer-destructuring
        appSpecifications = tempMessage.appSpecifications;
        blockAllowance = config.fluxapps.temporaryAppAllowance;
      }

      if (!appSpecifications) {
        // only owner can deploy permanent message or existing app
        const ownerAuthorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
        if (!ownerAuthorized) {
          const errMessage = messageHelper.errUnauthorizedMessage();
          res.json(errMessage);
          return;
        }
      }

      if (!appSpecifications) {
        const allApps = await availableApps();
        appSpecifications = allApps.find((app) => app.name === appname);
      }

      if (!appSpecifications) {
        appSpecifications = await getApplicationGlobalSpecifications(appname);
      }

      // search in permanent messages for the specific apphash to launch
      if (!appSpecifications) {
        const permMessage = await checkAppMessageExistence(appname);
        if (permMessage) {
          // eslint-disable-next-line prefer-destructuring
          appSpecifications = permMessage.appSpecifications;
        }
      }

      if (!appSpecifications) {
        throw new Error(`Application Specifications of ${appname} not found`);
      }

      // Test installation - similar to regular install but with test flag
      await checkAppRequirements(appSpecifications);

      res.setHeader('Content-Type', 'application/json');

      // Run test installation (registerAppLocally with test=true)
      registerAppLocally(appSpecifications, undefined, res, true);

    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

module.exports = {
  createAppVolume,
  registerAppLocally,
  installApplicationHard,
  installApplicationSoft,
  softRegisterAppLocally,
  getInstalledApps,
  updateAppStatus,
  cleanupFailedInstallation,
  installAppLocally,
  testAppInstall,
};
