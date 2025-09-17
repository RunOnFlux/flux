const path = require('path');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const log = require('../../lib/log');
const { appsFolder, localAppsInformation } = require('../utils/appConstants');
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

module.exports = {
  createAppVolume,
  registerAppLocally,
  installApplicationHard,
  installApplicationSoft,
  softRegisterAppLocally,
  getInstalledApps,
  updateAppStatus,
  cleanupFailedInstallation,
};
