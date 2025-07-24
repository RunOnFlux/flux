const config = require('config');

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('https');
const axios = require('axios');
// eslint-disable-next-line import/no-extraneous-dependencies
const nodecmd = require('node-cmd');
const archiver = require('archiver');
const df = require('node-df');
const systemcrontab = require('crontab');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const fs = require('fs').promises;
const execShell = util.promisify(require('child_process').exec);
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const {
  outgoingPeers, incomingPeers,
} = require('./utils/establishedConnections');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceBenchmarkRpcs = require('./daemonService/daemonServiceBenchmarkRpcs');
const benchmarkService = require('./benchmarkService');
const dockerService = require('./dockerService');
const generalService = require('./generalService');
const upnpService = require('./upnpService');
const geolocationService = require('./geolocationService');
const syncthingService = require('./syncthingService');
const pgpService = require('./pgpService');
const signatureVerifier = require('./signatureVerifier');
const imageVerifier = require('./utils/imageVerifier');
// eslint-disable-next-line no-unused-vars
const backupRestoreService = require('./backupRestoreService');
const IOUtils = require('./IOUtils');
const log = require('../lib/log');
const { PassThrough } = require('stream');
const { invalidMessages } = require('./invalidMessages');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const cacheManager = require('./utils/cacheManager').default;
const networkStateService = require('./networkStateService');
const fluxHttpTestServer = require('./utils/fluxHttpTestServer');

const fluxDirPath = path.join(__dirname, '../../../');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

const cmdAsync = util.promisify(nodecmd.get);
const crontabLoad = util.promisify(systemcrontab.load);
const dockerPullStreamPromise = util.promisify(dockerService.dockerPullStream);
const dockerStatsStreamPromise = util.promisify(dockerService.dockerContainerStatsStream);

const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;

const localAppsInformation = config.database.appslocal.collections.appsInformation;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsInstallingLocations = config.database.appsglobal.collections.appsInstallingLocations;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;

const supportedArchitectures = ['amd64', 'arm64'];

const isArcane = Boolean(process.env.FLUXOS_PATH);

const spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
const trySpawningGlobalAppCache = cacheManager.appSpawnCache;
const myShortCache = cacheManager.fluxRatesCache;
const myLongCache = cacheManager.appPriceBlockedRepoCache;
const failedNodesTestPortsCache = cacheManager.testPortsCache;
const receiveOnlySyncthingAppsCache = new Map();
const appsStopedCache = cacheManager.stoppedAppsCache;
const syncthingDevicesIDCache = cacheManager.syncthingDevicesCache;

let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
const backupInProgress = [];
const restoreInProgress = [];

const hashesNumberOfSearchs = new Map();
const mastersRunningGSyncthingApps = new Map();
const timeTostartNewMasterApp = new Map();

const appsThatMightBeUsingOldGatewayIpAssignment = ['HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated', 'isokosse', 'ChainBraryDApp', 'health', 'ethercalc'];

const nodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

const appsMonitored = {
  // appsMonitored Object Examples:
  // component1_appname2: { // >= 4 or name for <= 3
  //   oneMinuteInterval: null, // interval
  //   fifteenMinInterval: null, // interval
  //   oneMinuteStatsStore: [ // stores last hour of stats of app measured every minute
  //     { // object of timestamp, data
  //       timestamp: 0,
  //       data: { },
  //     },
  //   ],
  //   fifteenMinStatsStore: [ // stores last 24 hours of stats of app measured every 15 minutes
  //     { // object of timestamp, data
  //       timestamp: 0,
  //       data: { },
  //     },
  //   ],
  // },
};

/**
 * To get array of price specifications updates
 * @returns {(object|object[])} Returns an array of app objects.
 */
async function getChainParamsPriceUpdates() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.chainparams.database);
    const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;
    const query = { version: 'p' };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const priceMessages = await dbHelper.findInDatabase(database, chainParamsMessagesCollection, query, projection);
    const priceForks = [];
    config.fluxapps.price.forEach((price) => {
      priceForks.push(price);
    });
    priceMessages.forEach((data) => {
      const splittedMess = data.message.split('_');
      if (splittedMess[4]) {
        const dataPoint = {
          height: +data.height,
          cpu: +splittedMess[1],
          ram: +splittedMess[2],
          hdd: +splittedMess[3],
          minPrice: +splittedMess[4],
          port: +splittedMess[5] || 2,
          scope: +splittedMess[6] || 6,
          staticip: +splittedMess[7] || 3,
        };
        priceForks.push(dataPoint);
      }
    });
    // sort priceForks depending on height
    priceForks.sort((a, b) => {
      if (a.height > b.height) return 1;
      if (a.height < b.height) return -1;
      return 0;
    });
    return priceForks;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get array of team support address updates
 * @returns {(object|object[])} Returns an array of team support addresses with height.
 */
function getChainTeamSupportAddressUpdates() {
  try {
    /* to be adjusted in the future to check database
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.chainparams.database);
    const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;
    const query = { version: 'p' };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const priceMessages = await dbHelper.findInDatabase(database, chainParamsMessagesCollection, query, projection);
    */
    const addressForks = [];
    config.fluxapps.teamSupportAddress.forEach((address) => {
      addressForks.push(address);
    });
    // sort priceForks depending on height
    addressForks.sort((a, b) => {
      if (a.height > b.height) return 1;
      if (a.height < b.height) return -1;
      return 0;
    });
    return addressForks;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get a list of installed apps. Where req can be equal to appname. Shall be identical to listAllApps but this is a database response.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function installedApps(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    let appsQuery = {};
    if (req && req.params && req.query) {
      let { appname } = req.params; // we accept both help/command and help?command=getinfo
      appname = appname || req.query.appname;
      if (appname) {
        appsQuery = {
          name: appname,
        };
      }
    } else if (req && typeof req === 'string') {
      // consider it as appname
      appsQuery = {
        name: req,
      };
    }
    const appsProjection = {
      projection: {
        _id: 0,
      },
    };
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const dataResponse = messageHelper.createDataMessage(apps);
    return res ? res.json(dataResponse) : dataResponse;
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
 * To list running apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listRunningApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(false);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      // eslint-disable-next-line no-param-reassign
      delete app.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete app.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
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
 * To list all apps or app components Shall be identical to installedApps but this is the Docker response.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listAllApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(true);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      // eslint-disable-next-line no-param-reassign
      delete app.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete app.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
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
 * To list Docker images for apps.
 * @param {object} req Request.
 * @param {object} res Repsonse.
 * @returns {object} Message.
 */
async function listAppsImages(req, res) {
  try {
    const apps = await dockerService.dockerListImages();
    const appsResponse = messageHelper.createDataMessage(apps);
    return res ? res.json(appsResponse) : appsResponse;
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
 * To execute a command to all app instances.
 * @param {string} appname Application name or App component name in Flux notation '_'.
 * @param {string} command What command to execute, api route to be done.
 * @param {object} zelidauth What zelidauth headers to send with request for authentication purposes.
 * @param {(object|boolean|string)} paramA first parameter that a command may need
 * @param {boolean} bypassMyIp Indicates if method should not be made to the ip of the fluxnode from where the call was made
 */
async function executeAppGlobalCommand(appname, command, zelidauth, paramA, bypassMyIp) {
  try {
    // get a list of the specific app locations
    // eslint-disable-next-line no-use-before-define
    const locations = await appLocation(appname);
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    const myUrl = myIP.split(':')[0];
    const myUrlPort = myIP.split(':')[1] || '16127';
    // eslint-disable-next-line no-restricted-syntax
    for (const appInstance of locations) {
      // HERE let the node we are connected to handle it
      const ip = appInstance.ip.split(':')[0];
      const port = appInstance.ip.split(':')[1] || '16127';
      if (bypassMyIp && myUrl === ip && myUrlPort === port) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const axiosConfig = {
        headers: {
          zelidauth,
        },
      };
      let url = `http://${ip}:${port}/apps/${command}/${appname}`;
      if (paramA) {
        url += `/${paramA}`;
      }
      axios.get(url, axiosConfig)
        .then((response) => {
          log.info(`Successfully sent command to ${url}: ${response.status}`);
        })
        .catch((error) => {
          log.error(`Axios request failed for ${url}`, error);
        });
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To start an app. Starts each component if the app is using Docker Compose. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerStart(appname);
      // eslint-disable-next-line no-use-before-define
      startAppMonitoring(appname);
    } else {
      // ask for starting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerStart(appname);
        // eslint-disable-next-line no-use-before-define
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStart(`${appComponent.name}_${appSpecs.name}`);
          // eslint-disable-next-line no-use-before-define
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
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
 * To stop an app. Stops each component if the app is using Docker Compose. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
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

    const isComponent = appname.includes('_'); // it is a component stop. Proceed with stopping just component

    let appRes;
    if (isComponent) {
      // eslint-disable-next-line no-use-before-define
      stopAppMonitoring(appname, false);
      appRes = await dockerService.appDockerStop(appname);
    } else {
      // ask for stopping entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        // eslint-disable-next-line no-use-before-define
        stopAppMonitoring(appname, false);
        appRes = await dockerService.appDockerStop(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose.reverse()) {
          // eslint-disable-next-line no-use-before-define
          stopAppMonitoring(`${appComponent.name}_${appSpecs.name}`, false);
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
 * To restart an app. Restarts each component if the app is using Docker Compose. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
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

    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerRestart(appname);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerRestart(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
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
 * To kill an app. Kills each component if the app is using Docker Compose. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
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
      // ask for killing entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerKill(appname);
      } else {
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
 * To pause an app. Pauses each component if the app is using Docker Compose. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
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
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global pause`);
      return res ? res.json(appResponse) : appResponse;
    }

    const isComponent = appname.includes('_'); // it is a component pause. Proceed with pausing just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerPause(appname);
    } else {
      // ask for pausing entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerPause(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose.reverse()) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerPause(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} paused`;
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
 * To unpause an app. Unpauses each component if the app is using Docker Compose. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Restart.
 * @returns {object} Message.
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
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global unpase`);
      return res ? res.json(appResponse) : appResponse;
    }

    const isComponent = appname.includes('_'); // it is a component unpause. Proceed with unpausing just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerUnpause(appname);
    } else {
      // ask for unpausing entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerUnpause(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerUnpause(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} unpaused`;
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
 * To show an app's active Docker container processes. Only accessible by app owner, admins and flux team members.
 * @param {object} req Requst.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function appTop(req, res) {
  try {
    // List processes running inside a container
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

    const appRes = await dockerService.appDockerTop(appname);

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
 * To show an app's Docker container logs. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appLog(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    let { lines } = req.params;
    lines = lines || req.query.lines || 'all';

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      let logs = await dockerService.dockerContainerLogs(appname, lines);
      logs = serviceHelper.dockerBufferToString(logs);
      const dataMessage = messageHelper.createDataMessage(logs);
      res.json(dataMessage);
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
 * To show an app's Docker container log stream. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appLogStream(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      res.setHeader('Content-Type', 'application/json');
      dockerService.dockerContainerLogsStream(appname, res, (error) => {
        if (error) {
          log.error(error);
          const errorResponse = messageHelper.createErrorMessage(
            error.message || error,
            error.name,
            error.code,
          );
          res.write(errorResponse);
          res.end();
        } else {
          res.end();
        }
      });
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
 * Polling an app's Docker container logs. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appLogPolling(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { lines } = req.params;
    lines = lines || req.query.lineCount || 'all';
    let { since } = req.params;
    since = since || req.query.since || '';
    if (!appname) {
      throw new Error('No Flux App specified');
    }
    const mainAppName = appname.split('_')[1] || appname;
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      let parsedLineCount;
      if (lines === 'all') {
        parsedLineCount = 'all';
      } else {
        parsedLineCount = parseInt(lines, 10) || 100;
      }
      const logs = [];
      await new Promise((resolve, reject) => {
        dockerService.dockerContainerLogsPolling(appname, parsedLineCount, since, (err, logLine) => {
          if (err) {
            reject(err);
          } else if (logLine === 'Stream ended') {
            resolve();
          } else if (logLine) {
            logs.push(logLine);
          }
        });
      });
      res.json({
        logs,
        lineCount: parsedLineCount,
        logCount: logs.length,
        sinceTimestamp: since,
        truncated: parsedLineCount === 'all' ? false : logs.length >= parsedLineCount,
        status: 'success',
      });
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
 * To inspect an app's Docker container and show low-level information about it. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appInspect(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerInspect(appname);
      const appResponse = messageHelper.createDataMessage(response);
      res.json(appResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * To show resource usage statistics for an app's Docker container. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appStats(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerStats(appname);
      // eslint-disable-next-line no-use-before-define
      const containerStorageInfo = await getContainerStorage(appname);
      response.disk_stats = containerStorageInfo;
      const inspect = await dockerService.dockerContainerInspect(appname);
      response.nanoCpus = inspect.HostConfig.NanoCpus;
      const appResponse = messageHelper.createDataMessage(response);
      res.json(appResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * To show resource usage statistics for an app's Docker container. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appMonitor(req, res) {
  try {
    let { appname, range } = req.params;
    appname = appname || req.query.appname;
    range = range || req.query.range || null;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    if (range !== null) {
      range = parseInt(range, 10);
      if (!Number.isInteger(range) || range <= 0) {
        throw new Error('Invalid range value. It must be a positive integer or null.');
      }
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      if (appsMonitored[appname]) {
        let appStatsMonitoring = appsMonitored[appname].statsStore;
        if (range) {
          const now = Date.now();
          const cutoffTimestamp = now - range;
          const hoursInMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
          appStatsMonitoring = appStatsMonitoring.filter((stats) => stats.timestamp >= cutoffTimestamp);
          if (range > hoursInMs) {
            appStatsMonitoring = appStatsMonitoring.filter((_, index, array) => index % 20 === 0 || index === array.length - 1); // keep always last entry
          }
        }
        const appResponse = messageHelper.createDataMessage(appStatsMonitoring);
        res.json(appResponse);
      } else throw new Error('No data available');
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * To show resource usage statistics for an app's Docker container. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appMonitorStream(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      await dockerStatsStreamPromise(appname, req, res);
      res.end();
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * Returns folder size in byes of application component
 * @param {object} appName monitored component name
 */
async function getAppFolderSize(appName) {
  try {
    const appsDirPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
    const directoryPath = path.join(appsDirPath, appName);
    const exec = `sudo du -s --block-size=1 ${directoryPath}`;
    const cmdres = await cmdAsync(exec);
    const size = serviceHelper.ensureString(cmdres).split('\t')[0] || 0;
    return size;
  } catch (error) {
    log.error(error);
    return 0;
  }
}

/**
 * Retrieves the storage usage of a specified Docker container, including bind mounts and volume mounts.
 * @param {string} appName The name of the Docker container to inspect.
 * @returns {Promise<object>} An object containing the sizes of bind mounts, volume mounts, root filesystem, total used storage, and status.
 *   - bind: Size of bind mounts in bytes.
 *   - volume: Size of volume mounts in bytes.
 *   - rootfs: Size of the container's root filesystem in bytes.
 *   - used: Total used size (sum of bind, volume, and rootfs sizes) in bytes.
 *   - status: 'success' if the operation succeeded, 'error' otherwise.
 *   - message: An error message if the operation failed.
 */
async function getContainerStorage(appName) {
  try {
    const containerInfo = await dockerService.dockerContainerInspect(appName, { size: true });
    let bindMountsSize = 0;
    let volumeMountsSize = 0;
    const containerRootFsSize = serviceHelper.ensureNumber(containerInfo.SizeRootFs) || 0;
    if (containerInfo?.Mounts?.length) {
      await Promise.all(containerInfo.Mounts.map(async (mount) => {
        let source = mount?.Source;
        const mountType = mount?.Type;
        if (source) {
          if (mountType === 'bind') {
            source = source.replace('/appdata', '');
            const exec = `sudo du -sb ${source}`;
            const mountInfo = await cmdAsync(exec);
            if (mountInfo) {
              const sizeNum = serviceHelper.ensureNumber(mountInfo.split('\t')[0]) || 0;
              bindMountsSize += sizeNum;
            } else {
              log.warn(`No mount info returned for source: ${source}`);
            }
          } else if (mountType === 'volume') {
            const exec = `sudo du -sb ${source}`;
            const mountInfo = await cmdAsync(exec);
            if (mountInfo) {
              const sizeNum = serviceHelper.ensureNumber(mountInfo.split('\t')[0]) || 0;
              volumeMountsSize += sizeNum;
            } else {
              log.warn(`No mount info returned for source: ${source}`);
            }
          } else {
            log.warn(`Unsupported mount type or source: Type: ${mountType}, Source: ${source}`);
          }
        }
      }));
    }
    const usedSize = bindMountsSize + volumeMountsSize + containerRootFsSize;
    return {
      bind: bindMountsSize,
      volume: volumeMountsSize,
      rootfs: containerRootFsSize,
      used: usedSize,
      status: 'success',
    };
  } catch (error) {
    log.error(`Error fetching container storage: ${error.message}`);
    return {
      bind: 0,
      volume: 0,
      rootfs: 0,
      used: 0,
      status: 'error',
      message: error.message,
    };
  }
}

/**
 * Starts app monitoring for a single app and saves monitoring data in-memory to the appsMonitored object.
 * @param {object} appName monitored component name
 */
function startAppMonitoring(appName) {
  if (!appName) {
    throw new Error('No App specified');
  } else {
    log.info('Initialize Monitoring...');
    appsMonitored[appName] = {}; // Initialize the app's monitoring object
    if (!appsMonitored[appName].statsStore) {
      appsMonitored[appName].statsStore = [];
    }
    if (!appsMonitored[appName].lastHourstatsStore) {
      appsMonitored[appName].lastHourstatsStore = [];
    }
    // Clear previous interval for this app to prevent multiple intervals
    clearInterval(appsMonitored[appName].oneMinuteInterval);
    appsMonitored[appName].run = 0;
    appsMonitored[appName].oneMinuteInterval = setInterval(async () => {
      try {
        if (!appsMonitored[appName]) {
          log.error(`Monitoring of ${appName} already stopped`);
          return;
        }
        const dockerContainer = await dockerService.getDockerContainerOnly(appName);
        if (!dockerContainer) {
          log.error(`Monitoring of ${appName} not possible. App does not exist. Forcing stopping of monitoring`);
          // eslint-disable-next-line no-use-before-define
          stopAppMonitoring(appName, true);
          return;
        }
        appsMonitored[appName].run += 1;
        const statsNow = await dockerService.dockerContainerStats(appName);
        const containerStorageInfo = await getContainerStorage(appName);
        statsNow.disk_stats = containerStorageInfo;
        const now = Date.now();
        if (appsMonitored[appName].run % 3 === 0) {
          const inspect = await dockerService.dockerContainerInspect(appName);
          statsNow.nanoCpus = inspect.HostConfig.NanoCpus;
          appsMonitored[appName].statsStore.push({ timestamp: now, data: statsNow });
          const statsStoreSizeInBytes = new TextEncoder().encode(JSON.stringify(appsMonitored[appName].statsStore)).length;
          const estimatedSizeInMB = statsStoreSizeInBytes / (1024 * 1024);
          log.info(`Size of stats for ${appName}: ${estimatedSizeInMB.toFixed(2)} MB`);
          appsMonitored[appName].statsStore = appsMonitored[appName].statsStore.filter(
            (stat) => now - stat.timestamp <= 7 * 24 * 60 * 60 * 1000,
          );
        }
        appsMonitored[appName].lastHourstatsStore.push({ timestamp: now, data: statsNow });
        appsMonitored[appName].lastHourstatsStore = appsMonitored[appName].lastHourstatsStore.filter(
          (stat) => now - stat.timestamp <= 60 * 60 * 1000,
        );
      } catch (error) {
        log.error(error);
      }
    }, 1 * 60 * 1000);
  }
}

/**
 * Stops app monitoring for a single app.
 * @param {object} appName App specifications.
 * @param {boolean} deleteData Delete monitored data
 */
// At any stage after the monitoring is started, trigger stop on demand without loosing data (unless delete data is chosen)
function stopAppMonitoring(appName, deleteData) {
  if (appsMonitored[appName]) {
    clearInterval(appsMonitored[appName].oneMinuteInterval);
  }
  if (deleteData) {
    delete appsMonitored[appName];
  }
}

/**
 * Starts app monitoring for all apps.
 * @param {array} appSpecsToMonitor Array of application specs to be monitored
 */
async function startMonitoringOfApps(appSpecsToMonitor) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        startAppMonitoring(app.name);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          startAppMonitoring(monitoredName);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Stops app monitoring for all apps.
 * @param {array} appSpecsToMonitor Array of application specs to be stopped for monitor
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  try {
    let apps = appSpecsToMonitor;
    if (!apps) {
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      apps = installedAppsRes.data;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version <= 3) {
        stopAppMonitoring(app.name, deleteData);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          const monitoredName = `${component.name}_${app.name}`;
          stopAppMonitoring(monitoredName, deleteData);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * API call to start app monitoring and save monitoring data in-memory to the appsMonitored object. Monitors all apps or a single app if its name is specified in the API request.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function startAppMonitoringAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) { // If no appname specified, monitor all apps
      // only flux team and node owner can do this
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // this should not be started if some monitoring is already running. Stop all monitoring before
      await stopMonitoringOfApps();
      await startMonitoringOfApps();
      const monitoringResponse = messageHelper.createSuccessMessage('Application monitoring started for all apps');
      res.json(monitoringResponse);
    } else {
      const mainAppName = appname.split('_')[1] || appname;
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      const installedAppsRes = await installedApps(mainAppName);
      if (installedAppsRes.status !== 'success') {
        throw new Error('Failed to get installed Apps');
      }
      const apps = installedAppsRes.data;
      const appSpecs = apps[0];
      if (!appSpecs) {
        throw new Error(`Application ${mainAppName} is not installed`);
      }
      if (mainAppName === appname) {
        await stopMonitoringOfApps([appSpecs]);
        await startMonitoringOfApps([appSpecs]);
      } else { // component based or <= 3
        stopAppMonitoring(appname);
        startAppMonitoring(appname);
      }
      const monitoringResponse = messageHelper.createSuccessMessage(`Application monitoring started for ${appSpecs.name}`);
      res.json(monitoringResponse);
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
 * API call to stop app monitoring. Applies to all apps or a single app if its name is specified in the API request. Maintains existing monitoring data or deletes existing monitoring data if specified in the API request.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function stopAppMonitoringAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { deletedata } = req.params;
    deletedata = deletedata || req.query.deletedata || false;
    // 1. Stop all apps
    if (!appname) {
      // only flux team and node owner can do this
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      await stopMonitoringOfApps();
      let successMessage = '';
      if (!deletedata) {
        successMessage = 'Application monitoring stopped for all apps. Existing monitoring data maintained.';
      } else {
        successMessage = 'Application monitoring stopped for all apps. Monitoring data deleted for all apps.';
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      res.json(monitoringResponse);
      // 2. Stop a specific app
    } else {
      const mainAppName = appname.split('_')[1] || appname;
      const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      let successMessage = '';
      if (mainAppName === appname) {
        // get appSpecs
        const installedAppsRes = await installedApps(mainAppName);
        if (installedAppsRes.status !== 'success') {
          throw new Error('Failed to get installed Apps');
        }
        const apps = installedAppsRes.data;
        const appSpecs = apps[0];
        if (!appSpecs) {
          throw new Error(`Application ${mainAppName} is not installed`);
        }
        await stopMonitoringOfApps([appSpecs], deletedata);
      } else { // component based or <= 3
        stopAppMonitoring(appname, deletedata);
      }
      if (deletedata) {
        successMessage = `Application monitoring stopped and monitoring data deleted for ${appname}.`;
      } else {
        successMessage = `Application monitoring stopped for ${appname}. Existing monitoring data maintained.`;
      }
      const monitoringResponse = messageHelper.createSuccessMessage(successMessage);
      res.json(monitoringResponse);
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
 * Created for testing purposes - sets appMonitored
 *
 * @param {object} appData
 */

function setAppsMonitored(appData) {
  appsMonitored[appData.appName] = appData;
}
/**
 * Created for testing purposes - gets appMonitored
 */

function getAppsMonitored() {
  return appsMonitored;
}

/**
 * Created for testing purposes - clears appMonitored
 *
 * @param {object} appData
 */

function clearAppsMonitored() {
  // eslint-disable-next-line no-restricted-syntax
  for (const prop of Object.getOwnPropertyNames(appsMonitored)) {
    delete appsMonitored[prop];
  }
}

/**
 * To show filesystem changes for an app's Docker container. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appChanges(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerChanges(appname);
      const appResponse = messageHelper.createDataMessage(response);
      res.json(appResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * To run a command inside an app's running Docker container. Only accessible by app owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function appExec(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);

      if (!processedBody.appname) {
        throw new Error('No Flux App specified');
      }

      if (!processedBody.cmd) {
        throw new Error('No command specified');
      }

      const mainAppName = processedBody.appname.split('_')[1] || processedBody.appname;

      const authorized = await verificationHelper.verifyPrivilege('appowner', req, mainAppName);
      if (authorized === true) {
        let cmd = processedBody.cmd || [];
        let env = processedBody.env || [];

        cmd = serviceHelper.ensureObject(cmd);
        env = serviceHelper.ensureObject(env);

        const containers = await dockerService.dockerListContainers(true);
        const myContainer = containers.find((container) => (container.Names[0] === dockerService.getAppDockerNameIdentifier(processedBody.appname) || container.Id === processedBody.appname));
        const dockerContainer = dockerService.getDockerContainer(myContainer.Id);

        res.setHeader('Content-Type', 'application/json');

        dockerService.dockerContainerExec(dockerContainer, cmd, env, res, (error) => {
          if (error) {
            log.error(error);
            const errorResponse = messageHelper.createErrorMessage(
              error.message || error,
              error.name,
              error.code,
            );
            res.write(errorResponse);
            res.end();
          } else {
            res.end();
          }
        });
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
  });
}

/**
 * To create Flux Docker network API. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createFluxNetworkAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    const dockerRes = await dockerService.createFluxDockerNetwork();
    const response = messageHelper.createDataMessage(dockerRes);
    return res.json(response);
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
 * To show average Flux CPU usage.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fluxUsage(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
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
      log.error('Scanning not initiated');
    }
    let explorerHeight = 999999999;
    if (result) {
      explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight) || 999999999;
    }
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height;
    let cpuCores = 0;
    const cpus = os.cpus();
    if (cpus) {
      cpuCores = cpus.length;
    }
    if (cpuCores > 8) {
      cpuCores = 8;
    }
    let cpuUsage = 0;
    if (explorerHeight < (daemonHeight - 5)) {
      // Initial scanning is in progress
      cpuUsage += 0.5;
    } else if (explorerHeight < daemonHeight) {
      cpuUsage += 0.25;
    } else {
      cpuUsage += 0.1; // normal load
    }
    cpuUsage *= cpuCores;

    // load usedResources of apps
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = { projection: { _id: 0 } };
    const appsResult = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    const cpuTier = `cpu${tier}`;
    appsResult.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((component) => {
          if (component.tiered && tier) {
            appsCpusLocked += serviceHelper.ensureNumber(component[cpuTier] || component.cpu) || 0;
          } else {
            appsCpusLocked += serviceHelper.ensureNumber(component.cpu) || 0;
          }
        });
      } else if (app.tiered && tier) {
        appsCpusLocked += serviceHelper.ensureNumber(app[cpuTier] || app.cpu) || 0;
      } else {
        appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
      }
    });

    cpuUsage += appsCpusLocked;
    let fiveMinUsage = 0;
    const loadavg = os.loadavg();
    if (loadavg) {
      fiveMinUsage = serviceHelper.ensureNumber(loadavg[1]) || 0;
    }
    if (fiveMinUsage > cpuCores) {
      fiveMinUsage = cpuCores;
    }
    // do an average of fiveMinUsage and cpuUsage;
    const avgOfUsage = ((fiveMinUsage + cpuUsage) / 2).toFixed(8);
    const response = messageHelper.createDataMessage(avgOfUsage);
    return res ? res.json(response) : response;
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
 * To show app resources locked (CPUs, RAM and HDD).
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function appsResources(req, res) {
  log.info('Checking appsResources');
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = { projection: { _id: 0 } };
    const appsResult = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    let appsRamLocked = 0;
    let appsHddLocked = 0;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    const hddTier = `hdd${tier}`;
    const ramTier = `ram${tier}`;
    const cpuTier = `cpu${tier}`;
    appsResult.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((component) => {
          if (component.tiered && tier) {
            appsCpusLocked += serviceHelper.ensureNumber(component[cpuTier] || component.cpu) || 0;
            appsRamLocked += serviceHelper.ensureNumber(component[ramTier] || component.ram) || 0;
            appsHddLocked += serviceHelper.ensureNumber(component[hddTier] || component.hdd) || 0;
          } else {
            appsCpusLocked += serviceHelper.ensureNumber(component.cpu) || 0;
            appsRamLocked += serviceHelper.ensureNumber(component.ram) || 0;
            appsHddLocked += serviceHelper.ensureNumber(component.hdd) || 0;
          }
          appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
        });
      } else if (app.tiered && tier) {
        appsCpusLocked += serviceHelper.ensureNumber(app[cpuTier] || app.cpu) || 0;
        appsRamLocked += serviceHelper.ensureNumber(app[ramTier] || app.ram) || 0;
        appsHddLocked += serviceHelper.ensureNumber(app[hddTier] || app.hdd) || 0;
        appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
      } else {
        appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
        appsRamLocked += serviceHelper.ensureNumber(app.ram) || 0;
        appsHddLocked += serviceHelper.ensureNumber(app.hdd) || 0;
        appsHddLocked += config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // 5gb per component + 2gb swap
      }
    });
    const appsUsage = {
      appsCpusLocked,
      appsRamLocked,
      appsHddLocked,
    };
    const response = messageHelper.createDataMessage(appsUsage);
    return res ? res.json(response) : response;
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
 * To get node specifications (CPUs, RAM and SSD).
 */
async function getNodeSpecs() {
  try {
    if (nodeSpecs.cpuCores === 0) {
      nodeSpecs.cpuCores = os.cpus().length;
    }
    if (nodeSpecs.ram === 0) {
      nodeSpecs.ram = os.totalmem() / 1024 / 1024;
    }
    if (nodeSpecs.ssdStorage === 0) {
      // get my external IP and check that it is longer than 5 in length.
      const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
      if (benchmarkResponse.status === 'success') {
        const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
        log.info(`Gathered ssdstorage ${benchmarkResponseData.ssd}`);
        nodeSpecs.ssdStorage = benchmarkResponseData.ssd;
      } else {
        throw new Error('Error getting ssdstorage from benchmarks');
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Created for testing purposes
 *
 * @param {number} cores
 * @param {number} ram
 * @param {number} ssdStorage
 */
function setNodeSpecs(cores, ram, ssdStorage) {
  nodeSpecs.cpuCores = cores;
  nodeSpecs.ram = ram;
  nodeSpecs.ssdStorage = ssdStorage;
}

/**
 * Created for testing purposes
 *
 * @param {number} cores
 * @param {number} ram
 * @param {number} ssdStorage
 */
function returnNodeSpecs() {
  return nodeSpecs;
}

/**
 * To create an app volume. First checks for availability of disk space and chooses an available volume that meets the app specifications. Then creates the necessary file systems and mounts the volume. Finally, sets up cron job.
 * @param {object} appSpecifications App specifications.
 * @param {string} appName App name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createAppVolume(appSpecifications, appName, isComponent, res) {
  const dfAsync = util.promisify(df);
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  const appId = dockerService.getAppIdentifier(identifier);

  const searchSpace = {
    status: 'Searching available space...',
  };
  log.info(searchSpace);
  if (res) {
    res.write(serviceHelper.ensureString(searchSpace));
    if (res.flush) res.flush();
  }

  // we want whole numbers in GB
  const options = {
    prefixMultiplier: 'GB',
    isDisplayPrefixMultiplier: false,
    precision: 0,
  };

  const dfres = await dfAsync(options);
  const okVolumes = [];
  dfres.forEach((volume) => {
    if (volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop') && !volume.mount.includes('boot')) {
      okVolumes.push(volume);
    } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
      okVolumes.push(volume);
    }
  });

  await getNodeSpecs();
  const totalSpaceOnNode = nodeSpecs.ssdStorage;
  const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
  const resourcesLocked = await appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux App. Aborting.');
  }
  const hddLockedByApps = resourcesLocked.data.appsHddLocked;
  const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps + appSpecifications.hdd + config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // because our application is already accounted in locked resources
  // bigger or equal so we have the 1 gb free...
  if (appSpecifications.hdd >= availableSpaceForApps) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }
  // now we know that most likely there is a space available. IF user does not have his own stuff on the node or space may be sharded accross hdds.
  let usedSpace = 0;
  let availableSpace = 0;
  okVolumes.forEach((volume) => {
    usedSpace += serviceHelper.ensureNumber(volume.used);
    availableSpace += serviceHelper.ensureNumber(volume.available);
  });
  // space that is further reserved for flux os and that will be later substracted from available space. Max 60 + 20.
  const fluxSystemReserve = config.lockedSystemResources.hdd + config.lockedSystemResources.extrahdd - usedSpace > 0 ? config.lockedSystemResources.hdd + config.lockedSystemResources.extrahdd - usedSpace : 0;
  const minSystemReserve = Math.max(config.lockedSystemResources.extrahdd, fluxSystemReserve);
  const totalAvailableSpaceLeft = availableSpace - minSystemReserve;
  if (appSpecifications.hdd >= totalAvailableSpaceLeft) {
    // sadly user free space is not enough for this application
    throw new Error('Insufficient space on Flux Node. Space is already assigned to system files');
  }

  // check if space is not sharded in some bad way. Always count the minSystemReserve
  let useThisVolume = null;
  const totalVolumes = okVolumes.length;
  for (let i = 0; i < totalVolumes; i += 1) {
    // check available volumes one by one. If a sufficient is found. Use this one.
    if (okVolumes[i].available > appSpecifications.hdd + minSystemReserve) {
      useThisVolume = okVolumes[i];
      break;
    }
  }
  if (!useThisVolume) {
    // no useable volume has such a big space for the app
    throw new Error('Insufficient space on Flux Node. No useable volume found.');
  }

  // now we know there is a space and we have a volume we can operate with. Let's do volume magic
  const searchSpace2 = {
    status: 'Space found',
  };
  log.info(searchSpace2);
  if (res) {
    res.write(serviceHelper.ensureString(searchSpace2));
    if (res.flush) res.flush();
  }

  try {
    const allocateSpace = {
      status: 'Allocating space...',
    };
    log.info(allocateSpace);
    if (res) {
      res.write(serviceHelper.ensureString(allocateSpace));
      if (res.flush) res.flush();
    }

    let execDD = `sudo fallocate -l ${appSpecifications.hdd}G ${useThisVolume.mount}/${appId}FLUXFSVOL`; // eg /mnt/sthMounted
    if (useThisVolume.mount === '/') {
      execDD = `sudo fallocate -l ${appSpecifications.hdd}G ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`; // if root mount then temp file is /flu/appvolumes
    }

    await cmdAsync(execDD);
    const allocateSpace2 = {
      status: 'Space allocated',
    };
    log.info(allocateSpace2);
    if (res) {
      res.write(serviceHelper.ensureString(allocateSpace2));
      if (res.flush) res.flush();
    }

    const makeFilesystem = {
      status: 'Creating filesystem...',
    };
    log.info(makeFilesystem);
    if (res) {
      res.write(serviceHelper.ensureString(makeFilesystem));
      if (res.flush) res.flush();
    }
    let execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}/${appId}FLUXFSVOL`;
    if (useThisVolume.mount === '/') {
      execFS = `sudo mke2fs -t ext4 ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;
    }
    await cmdAsync(execFS);
    const makeFilesystem2 = {
      status: 'Filesystem created',
    };
    log.info(makeFilesystem2);
    if (res) {
      res.write(serviceHelper.ensureString(makeFilesystem2));
      if (res.flush) res.flush();
    }

    const makeDirectory = {
      status: 'Making directory...',
    };
    log.info(makeDirectory);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectory));
      if (res.flush) res.flush();
    }
    const execDIR = `sudo mkdir -p ${appsFolder + appId}`;
    await cmdAsync(execDIR);
    const makeDirectory2 = {
      status: 'Directory made',
    };
    log.info(makeDirectory2);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectory2));
      if (res.flush) res.flush();
    }

    const mountingStatus = {
      status: 'Mounting volume...',
    };
    log.info(mountingStatus);
    if (res) {
      res.write(serviceHelper.ensureString(mountingStatus));
      if (res.flush) res.flush();
    }
    let execMount = `sudo mount -o loop ${useThisVolume.mount}/${appId}FLUXFSVOL ${appsFolder + appId}`;
    if (useThisVolume.mount === '/') {
      execMount = `sudo mount -o loop ${fluxDirPath}appvolumes/${appId}FLUXFSVOL ${appsFolder + appId}`;
    }
    await cmdAsync(execMount);
    const mountingStatus2 = {
      status: 'Volume mounted',
    };
    log.info(mountingStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(mountingStatus2));
      if (res.flush) res.flush();
    }

    const makeDirectoryB = {
      status: 'Making application data directory...',
    };
    log.info(makeDirectoryB);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectoryB));
      if (res.flush) res.flush();
    }
    const execDIR2 = `sudo mkdir -p ${appsFolder + appId}/appdata`;
    await cmdAsync(execDIR2);
    const makeDirectoryB2 = {
      status: 'Application data directory made',
    };
    log.info(makeDirectoryB2);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectoryB2));
      if (res.flush) res.flush();
    }

    const permissionsDirectory = {
      status: 'Adjusting permissions...',
    };
    log.info(permissionsDirectory);
    if (res) {
      res.write(serviceHelper.ensureString(permissionsDirectory));
      if (res.flush) res.flush();
    }
    const execPERM = `sudo chmod 777 ${appsFolder + appId}`;
    await cmdAsync(execPERM);
    const execPERMdata = `sudo chmod 777 ${appsFolder + appId}/appdata`;
    await cmdAsync(execPERMdata);
    const permissionsDirectory2 = {
      status: 'Permissions adjusted',
    };
    log.info(permissionsDirectory2);
    if (res) {
      res.write(serviceHelper.ensureString(permissionsDirectory2));
      if (res.flush) res.flush();
    }

    // if s flag create .stfolder
    const containersData = appSpecifications.containerData.split('|');
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < containersData.length; i += 1) {
      const container = containersData[i];
      const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
      if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
        const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
        const stFolderCreation = {
          status: 'Creating .stfolder for syncthing...',
        };
        log.info(stFolderCreation);
        if (res) {
          res.write(serviceHelper.ensureString(stFolderCreation));
          if (res.flush) res.flush();
        }
        const execDIRst = `sudo mkdir -p ${appsFolder + appId + containerFolder}/.stfolder`;
        // eslint-disable-next-line no-await-in-loop
        await cmdAsync(execDIRst);
        const stFolderCreation2 = {
          status: '.stfolder created',
        };
        log.info(stFolderCreation2);
        if (res) {
          res.write(serviceHelper.ensureString(stFolderCreation2));
          if (res.flush) res.flush();
        }
        if (i === 0) {
          const stignore = `sudo echo '/backup' >| ${appsFolder + appId + containerFolder}/.stignore`;
          log.info(stignore);
          // eslint-disable-next-line no-await-in-loop
          await cmdAsync(stignore);
          const stiFileCreation = {
            status: '.stignore created',
          };
          log.info(stiFileCreation);
          if (res) {
            res.write(serviceHelper.ensureString(stiFileCreation));
            if (res.flush) res.flush();
          }
        }
      }
    }

    const cronStatus = {
      status: 'Creating crontab...',
    };
    log.info(cronStatus);
    if (res) {
      res.write(serviceHelper.ensureString(cronStatus));
      if (res.flush) res.flush();
    }
    const crontab = await crontabLoad();
    const jobs = crontab.jobs();
    let exists = false;
    jobs.forEach((job) => {
      if (job.comment() === appId) {
        exists = true;
      }
      if (!job || !job.isValid()) {
        // remove the job as its invalid anyway
        crontab.remove(job);
      }
    });
    if (!exists) {
      const job = crontab.create(execMount, '@reboot', appId);
      // check valid
      if (job == null) {
        throw new Error('Failed to create a cron job');
      }
      if (!job.isValid()) {
        throw new Error('Failed to create a valid cron job');
      }
      // save
      crontab.save();
    }
    const cronStatusB = {
      status: 'Crontab adjusted.',
    };
    log.info(cronStatusB);
    if (res) {
      res.write(serviceHelper.ensureString(cronStatusB));
      if (res.flush) res.flush();
    }
    const message = messageHelper.createSuccessMessage('Flux App volume creation completed.');
    return message;
  } catch (error) {
    clearInterval(global.allocationInterval);
    clearInterval(global.verificationInterval);
    // delete allocation, then uninstall as cron may not have been set
    const cleaningRemoval = {
      status: 'ERROR OCCURED: Pre-removal cleaning...',
    };
    log.info(cleaningRemoval);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningRemoval));
      if (res.flush) res.flush();
    }
    let execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}/${appId}FLUXFSVOL`;
    if (useThisVolume.mount === '/') {
      execRemoveAlloc = `sudo rm -rf ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;
    }
    await cmdAsync(execRemoveAlloc).catch((e) => log.error(e));
    const execFinal = `sudo rm -rf ${appsFolder + appId}`;
    await cmdAsync(execFinal).catch((e) => log.error(e));
    const aloocationRemoval2 = {
      status: 'Pre-removal cleaning completed. Forcing removal.',
    };
    log.info(aloocationRemoval2);
    if (res) {
      res.write(serviceHelper.ensureString(aloocationRemoval2));
      if (res.flush) res.flush();
    }
    throw error;
  }
}

/**
 * To hard uninstall an app including any components. Removes container/s, removes image/s, denies all app/component ports, unmounts volumes and removes cron job.
 * @param {string} appName App name.
 * @param {string} appId App ID.
 * @param {object} appSpecifications App specifications.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 */
async function appUninstallHard(appName, appId, appSpecifications, isComponent, res) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }
  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecifications.name}_${appName}`;
  }
  stopAppMonitoring(monitoredName, true);
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
  });
  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
    if (res.flush) res.flush();
  }

  // eslint-disable-next-line no-use-before-define
  await stopSyncthingApp(monitoredName, res);

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
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
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name}container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
    if (res.flush) res.flush();
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
    if (res.flush) res.flush();
  }
  await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
    if (res.flush) res.flush();
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
    if (res.flush) res.flush();
  }
  if (appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(port));
      }
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
      }
    }
    // v1 compatibility
  } else if (appSpecifications.port) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(appSpecifications.port));
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
    }
  }
  const portStatus2 = {
    status: isComponent ? `Ports of component ${appSpecifications.name} denied` : `Ports of ${appName} denied`,
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
    if (res.flush) res.flush();
  }

  const unmuontStatus = {
    status: isComponent ? `Unmounting volume of component ${appName}...` : `Unmounting volume of ${appName}...`,
  };
  log.info(unmuontStatus);
  if (res) {
    res.write(serviceHelper.ensureString(unmuontStatus));
    if (res.flush) res.flush();
  }
  const execUnmount = `sudo umount ${appsFolder + appId}`;
  const execSuccess = await cmdAsync(execUnmount).catch((e) => {
    log.error(e);
    const unmuontStatus3 = {
      status: isComponent ? `An error occured while unmounting component ${appSpecifications.name} storage. Continuing...` : `An error occured while unmounting ${appName} storage. Continuing...`,
    };
    log.info(unmuontStatus3);
    if (res) {
      res.write(serviceHelper.ensureString(unmuontStatus3));
      if (res.flush) res.flush();
    }
  });
  if (execSuccess) {
    const unmuontStatus2 = {
      status: isComponent ? `Volume of component ${appSpecifications.name} unmounted` : `Volume of ${appName} unmounted`,
    };
    log.info(unmuontStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(unmuontStatus2));
      if (res.flush) res.flush();
    }
  }

  const cleaningStatus = {
    status: isComponent ? `Cleaning up component ${appSpecifications.name} data...` : `Cleaning up ${appName} data...`,
  };
  log.info(cleaningStatus);
  if (res) {
    res.write(serviceHelper.ensureString(cleaningStatus));
    if (res.flush) res.flush();
  }
  const execDelete = `sudo rm -rf ${appsFolder + appId}`;
  await cmdAsync(execDelete).catch((e) => {
    log.error(e);
    const cleaningStatusE = {
      status: isComponent ? `An error occured while cleaning component ${appSpecifications.name} data. Continuing...` : `An error occured while cleaning ${appName} data. Continuing...`,
    };
    log.info(cleaningStatusE);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningStatusE));
      if (res.flush) res.flush();
    }
  });
  const cleaningStatus2 = {
    status: isComponent ? `Data of component ${appSpecifications.name} cleaned` : `Data of ${appName} cleaned`,
  };
  log.info(cleaningStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(cleaningStatus2));
    if (res.flush) res.flush();
  }

  let volumepath;
  // CRONTAB
  const cronStatus = {
    status: 'Adjusting crontab...',
  };
  log.info(cronStatus);
  if (res) {
    res.write(serviceHelper.ensureString(cronStatus));
    if (res.flush) res.flush();
  }

  const crontab = await crontabLoad().catch((e) => {
    log.error(e);
    const cronE = {
      status: 'An error occured while loading crontab. Continuing...',
    };
    log.info(cronE);
    if (res) {
      res.write(serviceHelper.ensureString(cronE));
      if (res.flush) res.flush();
    }
  });
  if (crontab) {
    const jobs = crontab.jobs();
    // find correct cronjob
    let jobToRemove;
    jobs.forEach((job) => {
      if (job.comment() === appId) {
        jobToRemove = job;
        // find the command that tells us where the actual fsvol is;
        const command = job.command();
        const cmdsplit = command.split(' ');
        // eslint-disable-next-line prefer-destructuring
        volumepath = cmdsplit[4]; // sudo mount -o loop /home/abcapp2TEMP /root/flux/ZelApps/abcapp2 is an example
        if (!job || !job.isValid()) {
          // remove the job as its invalid anyway
          crontab.remove(job);
        }
      }
    });
    // remove the job
    if (jobToRemove) {
      crontab.remove(jobToRemove);
      // save
      try {
        crontab.save();
      } catch (e) {
        log.error(e);
        const cronE = {
          status: 'An error occured while saving crontab. Continuing...',
        };
        log.info(cronE);
        if (res) {
          res.write(serviceHelper.ensureString(cronE));
          if (res.flush) res.flush();
        }
      }
      const cronStatusDone = {
        status: 'Crontab Adjusted.',
      };
      log.info(cronStatusDone);
      if (res) {
        res.write(serviceHelper.ensureString(cronStatusDone));
        if (res.flush) res.flush();
      }
    } else {
      const cronStatusNotFound = {
        status: 'Crontab not found.',
      };
      log.info(cronStatusNotFound);
      if (res) {
        res.write(serviceHelper.ensureString(cronStatusNotFound));
        if (res.flush) res.flush();
      }
    }
  }

  if (volumepath) {
    const cleaningVolumeStatus = {
      status: isComponent ? `Cleaning up data volume of ${appSpecifications.name}...` : `Cleaning up data volume of ${appName}...`,
    };
    log.info(cleaningVolumeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningVolumeStatus));
      if (res.flush) res.flush();
    }
    const execVolumeDelete = `sudo rm -rf ${volumepath}`;
    await cmdAsync(execVolumeDelete).catch((e) => {
      log.error(e);
      const cleaningVolumeStatusE = {
        status: isComponent ? `An error occured while cleaning component ${appSpecifications.name} volume. Continuing...` : `An error occured while cleaning ${appName} volume. Continuing...`,
      };
      log.info(cleaningVolumeStatusE);
      if (res) {
        res.write(serviceHelper.ensureString(cleaningVolumeStatusE));
        if (res.flush) res.flush();
      }
    });
    const cleaningVolumeStatus2 = {
      status: isComponent ? `Volume of component ${appSpecifications.name} cleaned` : `Volume of ${appName} cleaned`,
    };
    log.info(cleaningVolumeStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningVolumeStatus2));
      if (res.flush) res.flush();
    }
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
    if (res.flush) res.flush();
  }
}

/**
 * To remove an app locally including any components. First finds app specifications in database and then deletes the app from database.
 * @param {string} app App name and app component (if applicable). A component name follows the app name after an underscore `_`.
 * @param {object} res Response.
 * @param {boolean} force Defaults to false. Force determines if a check for app not found is skipped.
 * @param {boolean} endResponse Defaults to true.
 * @param {boolean} sendMessage Defaults to false. When sendMessage is true we broadcast the appremoved message to the network.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function removeAppLocally(app, res, force = false, endResponse = true, sendMessage = false) {
  try {
    // remove app from local machine.
    // find in database, stop app, remove container, close ports delete data associated on system, remove from database
    // we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
    if (!force) {
      if (removalInProgress) {
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
      if (installationInProgress) {
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
    removalInProgress = true;

    if (!app) {
      throw new Error('No App specified');
    }

    let isComponent = app.includes('_'); // copmonent is defined by appComponent.name_appSpecs.name

    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    // first find the appSpecifications in our database.
    // connect to mongodb
    const dbopen = dbHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const database = dbopen.db(config.database.appsglobal.database);

    const appsQuery = { name: appName };
    const appsProjection = {};
    let appSpecifications = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (!appSpecifications) {
      if (!force) {
        throw new Error('Flux App not found');
      }
      // get it from global Specifications
      appSpecifications = await dbHelper.findOneInDatabase(database, globalAppsInformation, appsQuery, appsProjection);
      if (!appSpecifications) {
        // get it from locally available Specifications
        // eslint-disable-next-line no-use-before-define
        const allApps = await availableApps();
        appSpecifications = allApps.find((a) => a.name === appName);
        // get it from permanent messages
        if (!appSpecifications) {
          const query = {};
          const projection = { projection: { _id: 0 } };
          const messages = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
          const appMessages = messages.filter((message) => {
            const specifications = message.appSpecifications || message.zelAppSpecifications;
            return specifications.name === appName;
          });
          let currentSpecifications;
          appMessages.forEach((message) => {
            if (!currentSpecifications || message.height > currentSpecifications.height) {
              currentSpecifications = message;
            }
          });
          if (currentSpecifications && currentSpecifications.height) {
            appSpecifications = currentSpecifications.appSpecifications || currentSpecifications.zelAppSpecifications;
          }
        }
      }
    }

    if (!appSpecifications) {
      throw new Error('Flux App not found');
    }

    let appId = dockerService.getAppIdentifier(app); // get app or app component identifier

    // do this temporarily - otherwise we have to move a bunch of functions around
    // eslint-disable-next-line no-use-before-define
    appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
    // eslint-disable-next-line no-use-before-define
    appSpecifications = specificationFormatter(appSpecifications);

    if (appSpecifications.version >= 4 && !isComponent) {
      // it is a composed application
      // eslint-disable-next-line no-restricted-syntax
      for (const appComposedComponent of appSpecifications.compose.reverse()) {
        isComponent = true;
        appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
        const appComponentSpecifications = appComposedComponent;
        // eslint-disable-next-line no-await-in-loop
        await appUninstallHard(appName, appId, appComponentSpecifications, isComponent, res);
      }
      isComponent = false;
    } else if (isComponent) {
      const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
      await appUninstallHard(appName, appId, componentSpecifications, isComponent, res);
    } else {
      await appUninstallHard(appName, appId, appSpecifications, isComponent, res);
    }

    if (sendMessage) {
      const ip = await fluxNetworkHelper.getMyFluxIPandPort();
      if (ip) {
        const broadcastedAt = Date.now();
        const appRemovedMessage = {
          type: 'fluxappremoved',
          version: 1,
          appName,
          ip,
          broadcastedAt,
        };
        log.info('Broadcasting appremoved message to the network');
        // broadcast messages about app removed to all peers
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(appRemovedMessage);
        await serviceHelper.delay(500);
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(appRemovedMessage);
      }
    }

    if (!isComponent) {
      const dockerNetworkStatus = {
        status: 'Cleaning up docker network...',
      };
      log.info(dockerNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworkStatus));
        if (res.flush) res.flush();
      }
      await dockerService.removeFluxAppDockerNetwork(appName).catch((error) => log.error(error));
      const dockerNetworkStatus2 = {
        status: 'Docker network cleaned',
      };
      log.info(dockerNetworkStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworkStatus2));
        if (res.flush) res.flush();
      }
      const databaseStatus = {
        status: 'Cleaning up database...',
      };
      log.info(databaseStatus);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus));
        if (res.flush) res.flush();
      }
      await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const databaseStatus2 = {
        status: 'Database cleaned',
      };
      log.info(databaseStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus2));
        if (res.flush) res.flush();
      }
    }
    const appRemovalResponseDone = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was successfuly removed`);
    log.info(appRemovalResponseDone);

    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
      if (res.flush) res.flush();
    }
    if (res && endResponse) {
      res.end();
    }
    removalInProgress = false;
  } catch (error) {
    removalInProgress = false;
    log.error(error);
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
  }
}

/**
 * To soft uninstall an app including any components. Removes container/s, removes image/s and denies all app/component ports.
 * @param {string} appName App name.
 * @param {string} appId App ID.
 * @param {object} appSpecifications App specifications.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 */
async function appUninstallSoft(appName, appId, appSpecifications, isComponent, res) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }
  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecifications.name}_${appName}`;
  }
  stopAppMonitoring(monitoredName, false);
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
  });

  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
    if (res.flush) res.flush();
  }

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerRemove(appId);

  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name}container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
    if (res.flush) res.flush();
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
    if (res.flush) res.flush();
  }
  await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
    if (res.flush) res.flush();
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
    if (res.flush) res.flush();
  }
  if (appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(port));
      }
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
      }
    }
    // v1 compatibility
  } else if (appSpecifications.port) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(appSpecifications.port));
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
    }
  }
  const portStatus2 = {
    status: isComponent ? `Ports of component ${appSpecifications.name} denied` : `Ports of ${appName} denied`,
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
    if (res.flush) res.flush();
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
    if (res.flush) res.flush();
  }
}

/**
 * To remove an app locally (including any components) without storage and cache deletion (keeps mounted volumes and cron job). First finds app specifications in database and then deletes the app from database. For app reload. Only for internal usage. We are throwing in functions using this.
 * @param {string} app App name.
 * @param {object} res Response.
 */
async function softRemoveAppLocally(app, res) {
  // remove app from local machine.
  // find in database, stop app, remove container, close port, remove from database
  // we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
  if (removalInProgress) {
    throw new Error('Another application is undergoing removal');
  }
  if (installationInProgress) {
    throw new Error('Another application is undergoing installation');
  }
  removalInProgress = true;
  if (!app) {
    throw new Error('No Flux App specified');
  }

  let isComponent = app.includes('_'); // copmonent is defined by appComponent.name_appSpecs.name

  const appName = isComponent ? app.split('_')[1] : app;
  const appComponent = app.split('_')[0];

  // first find the appSpecifications in our database.
  // connect to mongodb
  const dbopen = dbHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appslocal.database);

  const appsQuery = { name: appName };
  const appsProjection = {};
  let appSpecifications = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
  if (!appSpecifications) {
    throw new Error('Flux App not found');
  }

  let appId = dockerService.getAppIdentifier(app);

  // do this temporarily - otherwise we have to move a bunch of functions around
  // eslint-disable-next-line no-use-before-define
  appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
  // eslint-disable-next-line no-use-before-define
  appSpecifications = specificationFormatter(appSpecifications);

  if (appSpecifications.version >= 4 && !isComponent) {
    // it is a composed application
    // eslint-disable-next-line no-restricted-syntax
    for (const appComposedComponent of appSpecifications.compose.reverse()) {
      isComponent = true;
      appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
      const appComponentSpecifications = appComposedComponent;
      // eslint-disable-next-line no-await-in-loop
      await appUninstallSoft(appName, appId, appComponentSpecifications, isComponent, res);
    }
    isComponent = false;
  } else if (isComponent) {
    const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
    await appUninstallSoft(appName, appId, componentSpecifications, isComponent, res);
  } else {
    await appUninstallSoft(appName, appId, appSpecifications, isComponent, res);
  }

  if (!isComponent) {
    const databaseStatus = {
      status: 'Cleaning up database...',
    };
    log.info(databaseStatus);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus));
      if (res.flush) res.flush();
    }
    await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const databaseStatus2 = {
      status: 'Database cleaned',
    };
    log.info(databaseStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus2));
      if (res.flush) res.flush();
    }
    const appRemovalResponseDone = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was partially removed`);
    log.info(appRemovalResponseDone);
    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
      if (res.flush) res.flush();
    }
  }

  removalInProgress = false;
}

/**
 * To remove app locally via API call. Cannot be performed for individual components. Force defaults to false. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function removeAppLocallyApi(req, res) {
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
      res.json(errMessage);
    } else if (global) {
      executeAppGlobalCommand(appname, 'appremove', req.headers.zelidauth); // do not wait
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global reinstallation`);
      res.json(appResponse);
    } else {
      // remove app from local machine.
      // find in database, stop app, remove container, close ports delete data associated on system, remove from database
      // if other container uses the same image -> then it shall result in an error so ok anyway
      res.setHeader('Content-Type', 'application/json');
      removeAppLocally(appname, res, force, true, true);
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
 * To return total app hardware requirements (CPU, RAM and HDD).
 * @param {object} appSpecifications App specifications.
 * @param {string} myNodeTier Node tier.
 * @returns {object} Values for CPU, RAM and HDD.
 */
function totalAppHWRequirements(appSpecifications, myNodeTier) {
  let cpu = 0;
  let ram = 0;
  let hdd = 0;
  const hddTier = `hdd${myNodeTier}`;
  const ramTier = `ram${myNodeTier}`;
  const cpuTier = `cpu${myNodeTier}`;
  if (appSpecifications.version <= 3) {
    if (appSpecifications.tiered) {
      cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      ram = appSpecifications[ramTier] || appSpecifications.ram;
      hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      // eslint-disable-next-line prefer-destructuring
      cpu = appSpecifications.cpu;
      // eslint-disable-next-line prefer-destructuring
      ram = appSpecifications.ram;
      // eslint-disable-next-line prefer-destructuring
      hdd = appSpecifications.hdd;
    }
  } else {
    appSpecifications.compose.forEach((appComponent) => {
      if (appComponent.tiered) {
        cpu += appComponent[cpuTier] || appComponent.cpu;
        ram += appComponent[ramTier] || appComponent.ram;
        hdd += appComponent[hddTier] || appComponent.hdd;
      } else {
        cpu += appComponent.cpu;
        ram += appComponent.ram;
        hdd += appComponent.hdd;
      }
    });
  }
  return {
    cpu,
    ram,
    hdd,
  };
}

function nodeFullGeolocation() {
  const nodeGeo = geolocationService.getNodeGeolocation();
  if (!nodeGeo) {
    throw new Error('Node Geolocation not set. Aborting.');
  }
  const myNodeLocationFull = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
  return myNodeLocationFull;
}

/**
 * To check app requirements of staticip restrictions for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
function checkAppStaticIpRequirements(appSpecs) {
  // check geolocation
  if (appSpecs.version >= 7 && appSpecs.staticip) {
    const isMyNodeStaticIP = geolocationService.isStaticIP();
    if (isMyNodeStaticIP !== appSpecs.staticip) {
      throw new Error(`Application ${appSpecs.name} requires static IP address to run. Aborting.`);
    }
  }
  return true;
}

/**
 * To check app satisfaction of nodes restrictions for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
async function checkAppNodesRequirements(appSpecs) {
  if (appSpecs.version === 7 && appSpecs.nodes && appSpecs.nodes.length) {
    const myCollateral = await generalService.obtainNodeCollateralInformation();
    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      throw new Error('Unable to detect Flux IP address');
    }
    // get my external IP and check that it is longer than 5 in length.
    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    if (appSpecs.nodes.includes(myIP) || appSpecs.nodes.includes(`${myCollateral.txhash}:${myCollateral.txindex}`)) {
      return true;
    }
    throw new Error(`Application ${appSpecs.name} is not allowed to run on this node. Aborting.`);
  }
  return true;
}

/**
 * To check app requirements of geolocation restrictions for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
function checkAppGeolocationRequirements(appSpecs) {
  // check geolocation
  if (appSpecs.version >= 5 && appSpecs.geolocation && appSpecs.geolocation.length > 0) {
    const nodeGeo = geolocationService.getNodeGeolocation();
    if (!nodeGeo) {
      throw new Error('Node Geolocation not set. Aborting.');
    }
    // previous geolocation specification version (a, b) [aEU, bFR]
    // current geolocation style [acEU], [acEU_CZ], [acEU_CZ_PRG], [a!cEU], [a!cEU_CZ], [a!cEU_CZ_PRG]
    const appContinent = appSpecs.geolocation.find((x) => x.startsWith('a'));
    const appCountry = appSpecs.geolocation.find((x) => x.startsWith('b'));
    const geoC = appSpecs.geolocation.filter((x) => x.startsWith('ac')); // this ensures that new specs can only run on updated nodes.
    const geoCForbidden = appSpecs.geolocation.filter((x) => x.startsWith('a!c'));
    const myNodeLocationContinent = nodeGeo.continentCode;
    const myNodeLocationContCountry = `${nodeGeo.continentCode}_${nodeGeo.countryCode}`;
    const myNodeLocationFull = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
    const myNodeLocationContinentALL = 'ALL';
    const myNodeLocationContCountryALL = `${nodeGeo.continentCode}_ALL`;
    const myNodeLocationFullALL = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_ALL`;

    if (appContinent && !geoC.length && !geoCForbidden.length) { // backwards old style compatible. Can be removed after a month
      if (appContinent.slice(1) !== nodeGeo.continentCode) {
        throw new Error('App specs with continents geolocation set not matching node geolocation. Aborting.');
      }
    }
    if (appCountry) {
      if (appCountry.slice(1) !== nodeGeo.countryCode) {
        throw new Error('App specs with countries geolocation set not matching node geolocation. Aborting.');
      }
    }

    geoCForbidden.forEach((locationNotAllowed) => {
      if (locationNotAllowed.slice(3) === myNodeLocationContinent || locationNotAllowed.slice(3) === myNodeLocationContCountry || locationNotAllowed.slice(3) === myNodeLocationFull) {
        throw new Error('App specs of geolocation set is forbidden to run on node geolocation. Aborting.');
      }
    });
    if (geoC.length) {
      const nodeLocationOK = geoC.find((locationAllowed) => locationAllowed.slice(2) === myNodeLocationContinent || locationAllowed.slice(2) === myNodeLocationContCountry || locationAllowed.slice(2) === myNodeLocationFull
        || locationAllowed.slice(2) === myNodeLocationContinentALL || locationAllowed.slice(2) === myNodeLocationContCountryALL || locationAllowed.slice(2) === myNodeLocationFullALL);
      if (!nodeLocationOK) {
        throw new Error('App specs of geolocation set is not matching to run on node geolocation. Aborting.');
      }
    }
  }
  return true;
}

/**
 * To check app requirements of HW for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
async function checkAppHWRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  const tier = await generalService.nodeTier();
  const resourcesLocked = await appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
  }

  const appHWrequirements = totalAppHWRequirements(appSpecs, tier);
  await getNodeSpecs();
  const totalSpaceOnNode = nodeSpecs.ssdStorage;
  if (totalSpaceOnNode === 0) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }
  const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
  const hddLockedByApps = resourcesLocked.data.appsHddLocked;
  const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (appHWrequirements.hdd > availableSpaceForApps) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }

  const totalCpuOnNode = nodeSpecs.cpuCores * 10;
  const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
  const cpuLockedByApps = resourcesLocked.data.appsCpusLocked * 10;
  const adjustedAppCpu = appHWrequirements.cpu * 10;
  const availableCpuForApps = useableCpuOnNode - cpuLockedByApps;
  if (adjustedAppCpu > availableCpuForApps) {
    throw new Error('Insufficient CPU power on Flux Node to spawn an application');
  }

  const totalRamOnNode = nodeSpecs.ram;
  const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
  const ramLockedByApps = resourcesLocked.data.appsRamLocked;
  const availableRamForApps = useableRamOnNode - ramLockedByApps;
  if (appHWrequirements.ram > availableRamForApps) {
    throw new Error('Insufficient RAM on Flux Node to spawn an application');
  }

  return true;
}

/**
 * To check app requirements to include HDD space, CPU power, RAM and GEO for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
async function checkAppRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  await checkAppHWRequirements(appSpecs);
  // check geolocation

  checkAppStaticIpRequirements(appSpecs);

  await checkAppNodesRequirements(appSpecs);

  checkAppGeolocationRequirements(appSpecs);

  return true;
}

/**
 * To get system architecture type (ARM64 or AMD64).
 * @returns {Promise<string>} Architecture type (ARM64 or AMD64).
 */
async function systemArchitecture() {
  // get benchmark architecture - valid are arm64, amd64
  const benchmarkBenchRes = await benchmarkService.getBenchmarks();
  if (benchmarkBenchRes.status === 'error') {
    throw benchmarkBenchRes.data;
  }
  return benchmarkBenchRes.data.architecture;
}

/**
 * To hard install an app. Pulls image/s, creates data volumes, creates components/app, assigns ports to components/app and starts all containers.
 * @param {object} appSpecifications App specifications.
 * @param {string} appName App name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 * @param {boolean} test indicates if we are just testing the install of the app.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */

async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs, test = false) {
  // check image and its architecture
  // eslint-disable-next-line no-use-before-define
  const architecture = await systemArchitecture();
  if (!supportedArchitectures.includes(architecture)) {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }

  // check blacklist
  // eslint-disable-next-line no-use-before-define
  await checkApplicationImagesComplience(fullAppSpecs);

  const imgVerifier = new imageVerifier.ImageVerifier(
    appSpecifications.repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  const pullConfig = { repoTag: appSpecifications.repotag };

  let authToken = null;

  if (appSpecifications.repoauth) {
    authToken = await pgpService.decryptMessage(appSpecifications.repoauth);

    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }

    if (!authToken.includes(':')) {
      throw new Error('Provided credentials not in the correct username:token format');
    }

    imgVerifier.addCredentials(authToken);
    pullConfig.authToken = authToken;
  }

  await imgVerifier.verifyImage();
  imgVerifier.throwIfError();

  if (!imgVerifier.supported) {
    throw new Error(`Architecture ${architecture} not supported by ${appSpecifications.repotag}`);
  }

  // if dockerhub, this is now registry-1.docker.io instead of hub.docker.com
  pullConfig.provider = imgVerifier.provider;

  // eslint-disable-next-line no-unused-vars
  await dockerPullStreamPromise(pullConfig, res);

  const pullStatus = {
    status: isComponent ? `Pulling component ${appSpecifications.name} of Flux App ${appName}` : `Pulling global Flux App ${appName} was successful`,
  };

  if (res) {
    res.write(serviceHelper.ensureString(pullStatus));
    if (res.flush) res.flush();
  }

  await createAppVolume(appSpecifications, appName, isComponent, res);

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of Flux App ${appName}` : `Creating Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
    if (res.flush) res.flush();
  }
  if (!test && appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(port));
        if (portResponse.status === true) {
          const portStatus = {
            status: `Port ${port} OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to open.`);
        }
      }
    } else {
      log.info('Firewall not active, application ports are open');
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
        if (portResponse === true) {
          const portStatus = {
            status: `Port ${port} mapped OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to map.`);
        }
      }
    }
  } else if (!test && appSpecifications.port) {
    // v1 compatibility
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      const portResponse = await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(appSpecifications.port));
      if (portResponse.status === true) {
        const portStatus = {
          status: `Port ${appSpecifications.port} OK`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to open.`);
      }
    } else {
      log.info('Firewall not active, application ports are open');
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      const portResponse = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
      if (portResponse === true) {
        const portStatus = {
          status: `Port ${appSpecifications.port} mapped OK`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to map.`);
      }
    }
  }
  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
    if (res.flush) res.flush();
  }
  if (test || (!appSpecifications.containerData.includes('r:') && !appSpecifications.containerData.includes('g:'))) {
    const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
    const app = await dockerService.appDockerStart(identifier);
    if (!app) {
      return;
    }
    if (!test) {
      startAppMonitoring(identifier);
    }
    const appResponse = messageHelper.createDataMessage(app);
    log.info(appResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appResponse));
      if (res.flush) res.flush();
    }
  }
}

/**
 * To register an app locally. Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs hard install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @param {boolean} test indicates if it is just to test the app install.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function registerAppLocally(appSpecs, componentSpecs, res, test = false) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    if (removalInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing removal. Installation not possible.');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }
    if (installationInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing installation. Installation not possible');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }
    installationInProgress = true;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    if (!tier) {
      const rStatus = messageHelper.createErrorMessage('Failed to get Node Tier');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }

    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      throw new Error('FluxBench status Error. Application cannot be installed at the moment');
    }
    if (benchmarkResponse.data.thunder) {
      throw new Error('Flux Node is a Fractus Storage Node. Applications cannot be installed at this node type');
    }
    // get my external IP and check that it is longer than 5 in length.
    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }

    const appSpecifications = appSpecs;
    const appComponent = componentSpecs;
    const appName = appSpecifications.name;
    let isComponent = !!appComponent;
    const precheckForInstallation = {
      status: 'Running initial checks for Flux App...',
    };
    log.info(precheckForInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(precheckForInstallation));
      if (res.flush) res.flush();
    }
    // connect to mongodb
    const dbOpenTest = {
      status: 'Connecting to database...',
    };
    log.info(dbOpenTest);
    if (res) {
      res.write(serviceHelper.ensureString(dbOpenTest));
      if (res.flush) res.flush();
    }
    const dbopen = dbHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = { name: appName };
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if app is already installed
    const checkDb = {
      status: 'Checking database...',
    };
    log.info(checkDb);
    if (res) {
      res.write(serviceHelper.ensureString(checkDb));
      if (res.flush) res.flush();
    }
    const appResult = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (appResult && !isComponent) {
      installationInProgress = false;
      const rStatus = messageHelper.createErrorMessage(`Flux App ${appName} already installed`);
      log.error(rStatus);
      if (res) {
        res.write(rStatus);
        res.end();
      }
      return false;
    }

    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const runningApps = runningAppsRes.data;
    const installedAppComponentNames = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((appAux) => {
          installedAppComponentNames.push(`${appAux.name}_${app.name}`);
        });
      } else {
        installedAppComponentNames.push(app.name);
      }
    });
    // kadena and folding is old naming scheme having /zel.  all global application start with /flux
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));
    if (stoppedApps.length === 0 && !masterSlaveAppsRunning) {
      const dockerContainers = {
        status: 'Clearing up unused docker containers...',
      };
      log.info(dockerContainers);
      if (res) {
        res.write(serviceHelper.ensureString(dockerContainers));
        if (res.flush) res.flush();
      }
      await dockerService.pruneContainers();
      const dockerContainers2 = {
        status: 'Docker containers cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerContainers2));
        if (res.flush) res.flush();
      }

      const dockerNetworks = {
        status: 'Clearing up unused docker networks...',
      };
      log.info(dockerNetworks);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworks));
        if (res.flush) res.flush();
      }
      await dockerService.pruneNetworks();
      const dockerNetworks2 = {
        status: 'Docker networks cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworks2));
        if (res.flush) res.flush();
      }

      const dockerVolumes = {
        status: 'Clearing up unused docker volumes...',
      };
      log.info(dockerVolumes);
      if (res) {
        res.write(serviceHelper.ensureString(dockerVolumes));
        if (res.flush) res.flush();
      }
      await dockerService.pruneVolumes();
      const dockerVolumes2 = {
        status: 'Docker volumes cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerVolumes2));
        if (res.flush) res.flush();
      }

      const dockerImages = {
        status: 'Clearing up unused docker images...',
      };
      log.info(dockerImages);
      if (res) {
        res.write(serviceHelper.ensureString(dockerImages));
        if (res.flush) res.flush();
      }
      await dockerService.pruneImages();
      const dockerImages2 = {
        status: 'Docker images cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerImages2));
        if (res.flush) res.flush();
      }
    }

    if (!isComponent) {
      let dockerNetworkAddrValue = Math.floor(Math.random() * 256);
      if (appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
        dockerNetworkAddrValue = appName.charCodeAt(appName.length - 1);
      }
      const fluxNetworkStatus = {
        status: `Checking Flux App network of ${appName}...`,
      };
      log.info(fluxNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetworkStatus));
        if (res.flush) res.flush();
      }
      let fluxNet = null;
      for (let i = 0; i <= 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        fluxNet = await dockerService.createFluxAppDockerNetwork(appName, dockerNetworkAddrValue).catch((error) => log.error(error));
        if (fluxNet || appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
          break;
        }
        dockerNetworkAddrValue = Math.floor(Math.random() * 256);
      }
      if (!fluxNet) {
        throw new Error(`Flux App network of ${appName} failed to initiate. Not possible to create docker application network.`);
      }
      log.info(serviceHelper.ensureString(fluxNet));
      const fluxNetworkInterfaces = await dockerService.getFluxDockerNetworkPhysicalInterfaceNames();
      const accessRemoved = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces);
      const accessRemovedRes = {
        status: accessRemoved ? `Private network access removed for ${appName}` : `Error removing private network access for ${appName}`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(accessRemovedRes));
        if (res.flush) res.flush();
      }
      const fluxNetResponse = {
        status: `Docker network of ${appName} initiated.`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetResponse));
        if (res.flush) res.flush();
      }
    }

    const appInstallation = {
      status: isComponent ? `Initiating Flux App component ${appComponent.name} installation...` : `Initiating Flux App ${appName} installation...`,
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
      if (res.flush) res.flush();
    }
    if (!isComponent) {
      // register the app

      const isEnterprise = Boolean(
        appSpecifications.version >= 8 && appSpecifications.enterprise,
      );

      const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

      if (isEnterprise) {
        dbSpecs.compose = [];
        dbSpecs.contacts = [];
      }

      await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = test ? 0.2 : appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = test ? 300 : appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = test ? 2 : appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appComponent.cpu = test ? 0.2 : appComponent[cpuTier] || appComponent.cpu;
      appComponent.ram = test ? 300 : appComponent[ramTier] || appComponent.ram;
      appComponent.hdd = test ? 2 : appComponent[hddTier] || appComponent.hdd;
    }

    const specificationsToInstall = isComponent ? appComponent : appSpecifications;
    try {
      if (specificationsToInstall.version >= 4) { // version is undefined for component
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponentSpecs of specificationsToInstall.compose) {
          isComponent = true;
          const hddTier = `hdd${tier}`;
          const ramTier = `ram${tier}`;
          const cpuTier = `cpu${tier}`;
          appComponentSpecs.cpu = test ? 0.2 : appComponentSpecs[cpuTier] || appComponentSpecs.cpu;
          appComponentSpecs.ram = test ? 300 : appComponentSpecs[ramTier] || appComponentSpecs.ram;
          appComponentSpecs.hdd = test ? 2 : appComponentSpecs[hddTier] || appComponentSpecs.hdd;
          // eslint-disable-next-line no-await-in-loop
          await installApplicationHard(appComponentSpecs, appName, isComponent, res, appSpecifications, test);
        }
      } else {
        await installApplicationHard(specificationsToInstall, appName, isComponent, res, appSpecifications, test);
      }
    } catch (error) {
      if (!test) {
        const errorResponse = messageHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code,
        );
        const broadcastedAt = Date.now();
        const newAppRunningMessage = {
          type: 'fluxappinstallingerror',
          version: 1,
          name: appSpecifications.name,
          hash: appSpecifications.hash, // hash of application specifics that are running
          error: serviceHelper.ensureString(errorResponse),
          ip: myIP,
          broadcastedAt,
        };
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        await storeAppInstallingErrorMessage(newAppRunningMessage);
        // broadcast messages about running apps to all peers
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
        await serviceHelper.delay(500);
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
        // broadcast messages about running apps to all peers
      }
      throw error;
    }
    if (!test) {
      const broadcastedAt = Date.now();
      const newAppRunningMessage = {
        type: 'fluxapprunning',
        version: 1,
        name: appSpecifications.name,
        hash: appSpecifications.hash, // hash of application specifics that are running
        ip: myIP,
        broadcastedAt,
        runningSince: broadcastedAt,
        osUptime: os.uptime(),
        staticIp: geolocationService.isStaticIP(),
      };

      // store it in local database first
      // eslint-disable-next-line no-await-in-loop, no-use-before-define
      await storeAppRunningMessage(newAppRunningMessage);
      // broadcast messages about running apps to all peers
      await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
      await serviceHelper.delay(500);
      await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
      // broadcast messages about running apps to all peers
    }

    // all done message
    const successStatus = messageHelper.createSuccessMessage(`Flux App ${appName} successfully installed and launched`);
    log.info(successStatus);
    if (res) {
      res.write(serviceHelper.ensureString(successStatus));
      res.end();
    }
    installationInProgress = false;
  } catch (error) {
    installationInProgress = false;
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    if (!test) {
      const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
      log.info(removeStatus);
      if (res) {
        res.write(serviceHelper.ensureString(removeStatus));
        if (res.flush) res.flush();
      }
      removeAppLocally(appSpecs.name, res, true, true, false);
    }
    return false;
  }
  return true;
}

/**
 * To soft install app. Pulls image/s, creates components/app, assigns ports to components/app and starts all containers. Does not create data volumes.
 * @param {object} appSpecifications App specifications.
 * @param {string} appName App name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function installApplicationSoft(appSpecifications, appName, isComponent, res, fullAppSpecs) {
  const architecture = await systemArchitecture();
  if (!supportedArchitectures.includes(architecture)) {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }

  // check blacklist
  // eslint-disable-next-line no-use-before-define
  await checkApplicationImagesComplience(fullAppSpecs);

  const imgVerifier = new imageVerifier.ImageVerifier(
    appSpecifications.repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  const pullConfig = { repoTag: appSpecifications.repotag };

  let authToken = null;

  if (appSpecifications.repoauth) {
    authToken = await pgpService.decryptMessage(appSpecifications.repoauth);

    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }

    if (!authToken.includes(':')) {
      throw new Error('Provided credentials not in the correct username:token format');
    }

    imgVerifier.addCredentials(authToken);
    pullConfig.authToken = authToken;
  }

  await imgVerifier.verifyImage();
  imgVerifier.throwIfError();

  if (!imgVerifier.supported) {
    throw new Error(`Architecture ${architecture} not supported by ${appSpecifications.repotag}`);
  }

  // if dockerhub, this is now registry-1.docker.io instead of hub.docker.com
  pullConfig.provider = imgVerifier.provider;

  await dockerPullStreamPromise(pullConfig, res);

  const pullStatus = {
    status: isComponent ? `Pulling global Flux App ${appSpecifications.name} was successful` : `Pulling global Flux App ${appName} was successful`,
  };
  if (res) {
    res.write(serviceHelper.ensureString(pullStatus));
    if (res.flush) res.flush();
  }

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of local Flux App ${appName}` : `Creating local Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
    if (res.flush) res.flush();
  }
  if (appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(port));
        if (portResponse.status === true) {
          const portStatus = {
            status: `Port ${port} OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to open.`);
        }
      }
    } else {
      log.info('Firewall not active, application ports are open');
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
        if (portResponse === true) {
          const portStatus = {
            status: `Port ${port} mapped OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to map.`);
        }
      }
    }
  } else if (appSpecifications.port) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // v1 compatibility
      const portResponse = await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(appSpecifications.port));
      if (portResponse.status === true) {
        const portStatus = {
          status: 'Port OK',
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to open.`);
      }
    } else {
      log.info('Firewall not active, application ports are open');
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      const portResponse = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
      if (portResponse === true) {
        const portStatus = {
          status: `Port ${appSpecifications.port} mapped OK`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to map.`);
      }
    }
  }
  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
    if (res.flush) res.flush();
  }
  if (!appSpecifications.containerData.includes('g:')) {
    const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
    const app = await dockerService.appDockerStart(identifier);
    if (!app) {
      return;
    }
    startAppMonitoring(identifier);
    const appResponse = messageHelper.createDataMessage(app);
    log.info(appResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appResponse));
      if (res.flush) res.flush();
    }
  }
}

/**
 * To soft register an app locally (with data volume already in existence). Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs soft install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function softRegisterAppLocally(appSpecs, componentSpecs, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  // throw without catching
  try {
    if (removalInProgress) {
      const rStatus = messageHelper.createErrorMessage('Another application is undergoing removal');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }
    if (installationInProgress) {
      const rStatus = messageHelper.createErrorMessage('Another application is undergoing installation');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }
    installationInProgress = true;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    if (!tier) {
      const rStatus = messageHelper.createErrorMessage('Failed to get Node Tier');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }
    const appSpecifications = appSpecs;
    const appComponent = componentSpecs;
    const appName = appSpecifications.name;
    let isComponent = !!appComponent;
    const precheckForInstallation = {
      status: 'Running initial checks for Flux App...',
    };
    log.info(precheckForInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(precheckForInstallation));
      if (res.flush) res.flush();
    }
    // connect to mongodb
    const dbOpenTest = {
      status: 'Connecting to database...',
    };
    log.info(dbOpenTest);
    if (res) {
      res.write(serviceHelper.ensureString(dbOpenTest));
      if (res.flush) res.flush();
    }
    const dbopen = dbHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = { name: appName };
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if app is already installed
    const checkDb = {
      status: 'Checking database...',
    };
    log.info(checkDb);
    if (res) {
      res.write(serviceHelper.ensureString(checkDb));
      if (res.flush) res.flush();
    }
    const appResult = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (appResult && !isComponent) {
      installationInProgress = false;
      const rStatus = messageHelper.createErrorMessage(`Flux App ${appName} already installed`);
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }

    if (!isComponent) {
      let dockerNetworkAddrValue = Math.floor(Math.random() * 256);
      if (appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
        dockerNetworkAddrValue = appName.charCodeAt(appName.length - 1);
      }
      const fluxNetworkStatus = {
        status: `Checking Flux App network of ${appName}...`,
      };
      log.info(fluxNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetworkStatus));
        if (res.flush) res.flush();
      }
      let fluxNet = null;
      for (let i = 0; i <= 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        fluxNet = await dockerService.createFluxAppDockerNetwork(appName, dockerNetworkAddrValue).catch((error) => log.error(error));
        if (fluxNet || appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
          break;
        }
        dockerNetworkAddrValue = Math.floor(Math.random() * 256);
      }
      if (!fluxNet) {
        throw new Error(`Flux App network of ${appName} failed to initiate. Not possible to create docker application network.`);
      }
      log.info(serviceHelper.ensureString(fluxNet));
      const fluxNetworkInterfaces = await dockerService.getFluxDockerNetworkPhysicalInterfaceNames();
      const accessRemoved = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces);
      const accessRemovedRes = {
        status: accessRemoved ? `Private network access removed for ${appName}` : `Error removing private network access for ${appName}`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(accessRemovedRes));
        if (res.flush) res.flush();
      }
      const fluxNetResponse = {
        status: `Docker network of ${appName} initiated.`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetResponse));
        if (res.flush) res.flush();
      }
    }

    const appInstallation = {
      status: isComponent ? `Initiating Flux App component ${appComponent.name} installation...` : `Initiating Flux App ${appName} installation...`,
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
      if (res.flush) res.flush();
    }
    if (!isComponent) {
      // register the app

      const isEnterprise = Boolean(
        appSpecifications.version >= 8 && appSpecifications.enterprise,
      );

      const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

      if (isEnterprise) {
        dbSpecs.compose = [];
        dbSpecs.contacts = [];
      }

      await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
      appComponent.ram = appComponent[ramTier] || appComponent.ram;
      appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
    }

    const specificationsToInstall = isComponent ? appComponent : appSpecifications;

    if (specificationsToInstall.version >= 4) { // version is undefined for component
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponentSpecs of specificationsToInstall.compose) {
        isComponent = true;
        const hddTier = `hdd${tier}`;
        const ramTier = `ram${tier}`;
        const cpuTier = `cpu${tier}`;
        appComponentSpecs.cpu = appComponentSpecs[cpuTier] || appComponentSpecs.cpu;
        appComponentSpecs.ram = appComponentSpecs[ramTier] || appComponentSpecs.ram;
        appComponentSpecs.hdd = appComponentSpecs[hddTier] || appComponentSpecs.hdd;
        // eslint-disable-next-line no-await-in-loop
        await installApplicationSoft(appComponentSpecs, appName, isComponent, res, appSpecifications);
      }
    } else {
      await installApplicationSoft(specificationsToInstall, appName, isComponent, res, appSpecifications);
    }
    // all done message
    const successStatus = messageHelper.createSuccessMessage(`Flux App ${appName} successfully installed and launched`);
    log.info(successStatus);
    if (res) {
      res.write(serviceHelper.ensureString(successStatus));
      res.end();
    }
    installationInProgress = false;
  } catch (error) {
    installationInProgress = false;
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
      if (res.flush) res.flush();
    }
    removeAppLocally(appSpecs.name, res, true);
  }
}

/**
 * To return the monthly app hosting price.
 * This is app price per blocksLasting
 * @param {string} dataForAppRegistration App registration date.
 * @param {number} height Block height.
 * @returns {number} App price.
 */
async function appPricePerMonth(dataForAppRegistration, height, suppliedPrices) {
  if (!dataForAppRegistration) {
    return new Error('Application specification not provided');
  }
  const appPrices = suppliedPrices || await getChainParamsPriceUpdates();
  const intervals = appPrices.filter((i) => i.height < height);
  const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
  let instancesAdditional = 0;
  if (dataForAppRegistration.instances) {
    // spec of version >= 3
    // specification version 3 is saying. 3 instances are standard, every 3 additional is double the price.
    instancesAdditional = dataForAppRegistration.instances - 3; // has to always be >=0 as of checks before.
  }
  if (dataForAppRegistration.version <= 3) {
    if (dataForAppRegistration.tiered) {
      const cpuTotalCount = dataForAppRegistration.cpubasic + dataForAppRegistration.cpusuper + dataForAppRegistration.cpubamf;
      const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
      const cpuTotal = cpuPrice / 3;
      const ramTotalCount = dataForAppRegistration.rambasic + dataForAppRegistration.ramsuper + dataForAppRegistration.rambamf;
      const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
      const ramTotal = ramPrice / 3;
      const hddTotalCount = dataForAppRegistration.hddbasic + dataForAppRegistration.hddsuper + dataForAppRegistration.hddbamf;
      const hddPrice = hddTotalCount * priceSpecifications.hdd;
      const hddTotal = hddPrice / 3;
      let totalPrice = cpuTotal + ramTotal + hddTotal;
      if (dataForAppRegistration.port) {
        if (fluxNetworkHelper.isPortEnterprise(dataForAppRegistration.port)) {
          totalPrice += priceSpecifications.port;
        }
      } else if (dataForAppRegistration.ports) {
        const enterprisePorts = [];
        dataForAppRegistration.ports.forEach((port) => {
          if (fluxNetworkHelper.isPortEnterprise(port)) {
            enterprisePorts.push(port);
          }
        });
        totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
      }
      if (priceSpecifications.minUSDPrice && height >= config.fluxapps.applyMinimumPriceOn3Instances && totalPrice < priceSpecifications.minUSDPrice) {
        totalPrice = Number(priceSpecifications.minUSDPrice).toFixed(2);
      }
      let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
      if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
        if (appPrice < 1.50) {
          appPrice += (instancesAdditional * 0.50);
        } else {
          const additionalPrice = (appPrice * instancesAdditional) / 3;
          appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
        }
      }
      if (appPrice < priceSpecifications.minPrice) {
        appPrice = priceSpecifications.minPrice;
      }
      return appPrice;
    }
    const cpuTotal = dataForAppRegistration.cpu * priceSpecifications.cpu * 10;
    const ramTotal = (dataForAppRegistration.ram * priceSpecifications.ram) / 100;
    const hddTotal = dataForAppRegistration.hdd * priceSpecifications.hdd;
    let totalPrice = cpuTotal + ramTotal + hddTotal;
    if (dataForAppRegistration.port) {
      if (fluxNetworkHelper.isPortEnterprise(dataForAppRegistration.port)) {
        totalPrice += priceSpecifications.port;
      }
    } else if (dataForAppRegistration.ports) {
      const enterprisePorts = [];
      dataForAppRegistration.ports.forEach((port) => {
        if (fluxNetworkHelper.isPortEnterprise(port)) {
          enterprisePorts.push(port);
        }
      });
      totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
    }
    let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
    if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
      if (appPrice < 1.50) {
        appPrice += (instancesAdditional * 0.50);
      } else {
        const additionalPrice = (appPrice * instancesAdditional) / 3;
        appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
      }
    }
    if (appPrice < priceSpecifications.minPrice) {
      appPrice = priceSpecifications.minPrice;
    }
    return appPrice;
  }
  // v4+ compose
  let cpuTotalCount = 0;
  let ramTotalCount = 0;
  let hddTotalCount = 0;
  const enterprisePorts = [];
  dataForAppRegistration.compose.forEach((appComponent) => {
    if (appComponent.tiered) {
      cpuTotalCount += ((appComponent.cpubasic + appComponent.cpusuper + appComponent.cpubamf) / 3);
      ramTotalCount += ((appComponent.rambasic + appComponent.ramsuper + appComponent.rambamf) / 3);
      hddTotalCount += ((appComponent.hddbasic + appComponent.hddsuper + appComponent.hddbamf) / 3);
    } else {
      cpuTotalCount += appComponent.cpu;
      ramTotalCount += appComponent.ram;
      hddTotalCount += appComponent.hdd;
    }
    appComponent.ports.forEach((port) => {
      if (fluxNetworkHelper.isPortEnterprise(port)) {
        enterprisePorts.push(port);
      }
    });
  });
  const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
  const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
  const hddPrice = hddTotalCount * priceSpecifications.hdd;
  let totalPrice = cpuPrice + ramPrice + hddPrice;
  if ((dataForAppRegistration.nodes && dataForAppRegistration.nodes.length) || dataForAppRegistration.enterprise) { // v7+ enterprise apps
    totalPrice += priceSpecifications.scope;
  }
  if (dataForAppRegistration.staticip) { // v7+ staticip option
    totalPrice += priceSpecifications.staticip;
  }
  totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
  if (priceSpecifications.minUSDPrice && height >= config.fluxapps.applyMinimumPriceOn3Instances && totalPrice < priceSpecifications.minUSDPrice) {
    totalPrice = Number(priceSpecifications.minUSDPrice).toFixed(2);
  }
  let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
  if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
    if (appPrice < 1.50) {
      appPrice += (instancesAdditional * 0.50);
    } else {
      const additionalPrice = (appPrice * instancesAdditional) / 3;
      appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
    }
  }

  if (appPrice < priceSpecifications.minPrice) {
    appPrice = priceSpecifications.minPrice;
  }
  return appPrice;
}

/**
 * To check if a node's hardware is suitable for running the assigned app.
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function checkHWParameters(appSpecs) {
  // check specs parameters. JS precision
  if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
    throw new Error(`CPU badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.ram < 100) {
    throw new Error(`RAM badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
    throw new Error(`SSD badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.tiered) {
    if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
      throw new Error(`CPU for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
      throw new Error(`RAM for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
      throw new Error(`SSD for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
      throw new Error(`CPU for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
      throw new Error(`RAM for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
      throw new Error(`SSD for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
      throw new Error(`CPU for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
      throw new Error(`RAM for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
      throw new Error(`SSD for Stratus badly assigned for ${appSpecs.name}`);
    }
  }
  return true;
}

/**
 * To check if a node's hardware is suitable for running the assigned Docker Compose app. Advises if too much resources being assigned to an app.
 * @param {object} appSpecsComposed App specifications composed.
 * @returns {boolean} True if no errors are thrown.
 */
function checkComposeHWParameters(appSpecsComposed) {
  // calculate total HW assigned
  let totalCpu = 0;
  let totalRam = 0;
  let totalHdd = 0;
  let totalCpuBasic = 0;
  let totalCpuSuper = 0;
  let totalCpuBamf = 0;
  let totalRamBasic = 0;
  let totalRamSuper = 0;
  let totalRamBamf = 0;
  let totalHddBasic = 0;
  let totalHddSuper = 0;
  let totalHddBamf = 0;
  const isTiered = appSpecsComposed.compose.find((appComponent) => appComponent.tiered === true);
  appSpecsComposed.compose.forEach((appComponent) => {
    if (isTiered) {
      totalCpuBamf += ((appComponent.cpubamf || appComponent.cpu) * 10);
      totalRamBamf += appComponent.rambamf || appComponent.ram;
      totalHddBamf += appComponent.hddbamf || appComponent.hdd;
      totalCpuSuper += ((appComponent.cpusuper || appComponent.cpu) * 10);
      totalRamSuper += appComponent.ramsuper || appComponent.ram;
      totalHddSuper += appComponent.hddsuper || appComponent.hdd;
      totalCpuBasic += ((appComponent.cpubasic || appComponent.cpu) * 10);
      totalRamBasic += appComponent.rambasic || appComponent.ram;
      totalHddBasic += appComponent.hddbasic || appComponent.hdd;
    } else {
      totalCpu += (appComponent.cpu * 10);
      totalRam += appComponent.ram;
      totalHdd += appComponent.hdd;
    }
  });
  // check specs parameters. JS precision
  if (totalCpu > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
    throw new Error(`Too much CPU resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalRam > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
    throw new Error(`Too much RAM resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalHdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
    throw new Error(`Too much SSD resources assigned for ${appSpecsComposed.name}`);
  }
  if (isTiered) {
    if (totalCpuBasic > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuSuper > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamSuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddSuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuBamf > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
  }
  return true;
}

/**
 * To get temporary hash messages for global apps.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsTemporaryMessages(req, res) {
  try {
    const db = dbHelper.databaseConnection();

    const database = db.db(config.database.appsglobal.database);
    let query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    if (hash) {
      query = { hash };
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsTempMessages, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get permanent hash messages for global apps.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsPermanentMessages(req, res) {
  try {
    const db = dbHelper.databaseConnection();

    const database = db.db(config.database.appsglobal.database);
    const query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    let { owner } = req.params;
    owner = owner || req.query.owner;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (hash) {
      query.hash = hash;
    }
    if (owner) {
      query['appSpecifications.owner'] = owner;
    }
    if (appname) {
      query['appSpecifications.name'] = appname;
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get specifications for global apps.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getGlobalAppsSpecifications(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    let { owner } = req.params;
    owner = owner || req.query.owner;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (hash) {
      query.hash = hash;
    }
    if (owner) {
      query.owner = owner;
    }
    if (appname) {
      query.name = appname;
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return available apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {(object|object[])} Returns a response or an array of app objects.
 */
async function availableApps(req, res) {
  // calls to global mongo db
  // simulate a similar response
  const apps = [
    { // app specifications
      version: 2,
      name: 'FoldingAtHomeB',
      description: 'Folding @ Home for AMD64 Devices. Folding@home is a project focused on disease research. Client Visit was disabled, to check your stats go to https://stats.foldingathome.org/donor and search for your zelid.',
      repotag: 'yurinnick/folding-at-home:latest',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      tiered: true,
      ports: [30000],
      containerPorts: [7396],
      domains: [''],
      cpu: 0.5,
      ram: 500,
      hdd: 5,
      cpubasic: 0.5,
      cpusuper: 1,
      cpubamf: 2,
      rambasic: 500,
      ramsuper: 500,
      rambamf: 500,
      hddbasic: 5,
      hddsuper: 5,
      hddbamf: 5,
      enviromentParameters: [`USER=${userconfig.initial.zelid}`, 'TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
      commands: [],
      containerData: '/config',
      hash: 'localappinstancehashABCDEF', // hash of app message
      height: 0, // height of tx on which it was
    },
    { // app specifications
      version: 2,
      name: 'FoldingAtHomeArm64',
      description: 'Folding @ Home For ARM64. Folding@home is a project focused on disease research. Client Visit was disabled, to check your stats go to https://stats.foldingathome.org/donor and search for your zelid.',
      repotag: 'beastob/foldingathome-arm64',
      owner: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
      tiered: true,
      ports: [30000],
      containerPorts: [7396],
      domains: [''],
      cpu: 1,
      ram: 500,
      hdd: 5,
      cpubasic: 1,
      cpusuper: 2,
      cpubamf: 2,
      rambasic: 500,
      ramsuper: 500,
      rambamf: 500,
      hddbasic: 5,
      hddsuper: 5,
      hddbamf: 5,
      enviromentParameters: [`FOLD_USER=${userconfig.initial.zelid}`, 'FOLD_TEAM=262156', 'FOLD_ANON=false'],
      commands: [],
      containerData: '/config',
      hash: 'localSpecificationsFoldingVersion1', // hash of app message
      height: 0, // height of tx on which it was
    },
  ];

  const dataResponse = messageHelper.createDataMessage(apps);
  return res ? res.json(dataResponse) : apps;
}

/**
 * To verify an app hash message.
 * @param {object} message Message.
 * @returns {boolean} True if no error is thrown.
 */
async function verifyAppHash(message) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  const specifications = message.appSpecifications || message.zelAppSpecifications;
  let messToHash = message.type + message.version + JSON.stringify(specifications) + message.timestamp + message.signature;
  let messageHASH = await generalService.messageHash(messToHash);

  if (messageHASH === message.hash) return true;

  const appSpecsCopy = JSON.parse(JSON.stringify(specifications));

  if (specifications.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;

    const appSpecOld = {
      version: specifications.version,
      name: specifications.name,
      description: specifications.description,
      repotag: specifications.repotag,
      owner: specifications.owner,
      ...appSpecsCopy,
    };
    messToHash = message.type + message.version + JSON.stringify(appSpecOld) + message.timestamp + message.signature;
    messageHASH = await generalService.messageHash(messToHash);
  } else if (specifications.version === 7) {
    // fix for repoauth / secrets order change for apps created after 1750273721000
    appSpecsCopy.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;

      delete comp.secrets;
      delete comp.repoauth;

      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });

    messToHash = message.type + message.version + JSON.stringify(appSpecsCopy) + message.timestamp + message.signature;
    messageHASH = await generalService.messageHash(messToHash);
  }

  if (messageHASH !== message.hash) {
    log.error(`Hashes dont match - expected - ${message.hash} - calculated - ${messageHASH} for the message ${JSON.stringify(message)}`);
    throw new Error('Invalid Flux App hash received');
  }

  // ToDo: fix this function. Should just return true / false and the upper layer deals with it,
  // none of this needs to be async, crypto.createHash is synchronous
  return true;
}

/**
 * To verify an app message signature.
 * @param {string} type Type.
 * @param {number} version Version.
 * @param {object} appSpec App specifications.
 * @param {number} timestamp Time stamp.
 * @param {string} signature Signature.
 * @returns {Promise<boolean>} True if no error is thrown.
 */
async function verifyAppMessageSignature(type, version, appSpec, timestamp, signature) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = verificationHelper.verifyMessage(messageToVerify, appSpec.owner, signature); // only btc
  if (timestamp > 1688947200000) {
    isValidSignature = signatureVerifier.verifySignature(messageToVerify, appSpec.owner, signature); // btc, eth
  }
  if (isValidSignature !== true && appSpec.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    const appSpecsCopy = JSON.parse(JSON.stringify(appSpec));
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;
    const appSpecOld = {
      version: appSpec.version,
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      owner: appSpec.owner,
      ...appSpecsCopy,
    };
    const messageToVerifyB = type + version + JSON.stringify(appSpecOld) + timestamp;
    isValidSignature = verificationHelper.verifyMessage(messageToVerifyB, appSpec.owner, signature); // only btc
    if (timestamp > 1688947200000) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appSpec.owner, signature); // btc, eth
    }
    // fix for repoauth / secrets order change for apps created after 1750273721000
  } else if (isValidSignature !== true && appSpec.version === 7) {
    const appSpecsClone = JSON.parse(JSON.stringify(appSpec));

    appSpecsClone.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;

      delete comp.secrets;
      delete comp.repoauth;

      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });

    const messageToVerifyC = type + version + JSON.stringify(appSpecsClone) + timestamp;
    // we can just use the btc / eth verifier as v7 specs came out at 1688749251
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyC, appSpec.owner, signature);
  }
  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appSpec.owner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature is invalid or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

/**
 * To verify an app message signature update.
 * @param {string} type Type.
 * @param {number} version Version.
 * @param {object} appSpec App specifications.
 * @param {number} timestamp Time stamp.
 * @param {string} signature Signature.
 * @param {string} appOwner App owner.
 * @param {number} daemonHeight Daemon height.
 * @returns {boolean} True if no errors are thrown.
 */
async function verifyAppMessageUpdateSignature(type, version, appSpec, timestamp, signature, appOwner, daemonHeight) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  let marketplaceApp = false;
  let fluxSupportTeamFluxID = null;
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = signatureVerifier.verifySignature(messageToVerify, appOwner, signature); // btc, eth
  if (isValidSignature !== true) {
    const teamSupportAddresses = getChainTeamSupportAddressUpdates();
    if (teamSupportAddresses.length > 0) {
      const intervals = teamSupportAddresses.filter((interval) => interval.height <= daemonHeight); // if an app message was sent on block before the team support address was activated, will be empty array
      if (intervals && intervals.length) {
        const addressInfo = intervals[intervals.length - 1]; // always defined
        if (addressInfo && addressInfo.height && daemonHeight >= addressInfo.height) { // unneeded check for safety
          fluxSupportTeamFluxID = addressInfo.address;
          const numbersOnAppName = appSpec.name.match(/\d+/g);
          if (numbersOnAppName && numbersOnAppName.length > 0) {
            const dateBeforeReleaseMarketplace = Date.parse('2020-01-01');
            // eslint-disable-next-line no-restricted-syntax
            for (const possibleTimestamp of numbersOnAppName) {
              if (Number(possibleTimestamp) > dateBeforeReleaseMarketplace) {
                marketplaceApp = true;
                break;
              }
            }
            if (marketplaceApp) {
              isValidSignature = signatureVerifier.verifySignature(messageToVerify, fluxSupportTeamFluxID, signature); // btc, eth
            }
          }
        }
      }
    }
  }
  if (isValidSignature !== true && appSpec.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    const appSpecsCopy = JSON.parse(JSON.stringify(appSpec));
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;
    const appSpecOld = {
      version: appSpec.version,
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      owner: appSpec.owner,
      ...appSpecsCopy,
    };
    const messageToVerifyB = type + version + JSON.stringify(appSpecOld) + timestamp;
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appOwner, signature); // btc, eth
    if (isValidSignature !== true && marketplaceApp) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, fluxSupportTeamFluxID, signature); // btc, eth
    }
    // fix for repoauth / secrets order change for apps created after 1750273721000
  } else if (isValidSignature !== true && appSpec.version === 7) {
    const appSpecsClone = JSON.parse(JSON.stringify(appSpec));

    appSpecsClone.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;

      delete comp.secrets;
      delete comp.repoauth;

      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });

    const messageToVerifyC = type + version + JSON.stringify(appSpecsClone) + timestamp;
    // we can just use the btc / eth verifier as v7 specs came out at 1688749251
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyC, appOwner, signature);
  }
  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appOwner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature does not correspond with Flux App owner or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

/**
 * Checks that the supplied Docker Image Tag is in the Flux Whitelist, if auth is provided,
 * that it is in the correct format, and verifies that the image can run on the Flux network,
 * and that it can run on this specific node (architecture match). Throws if requirements not met.
 * @param {string} repotag The Docker Image Tag
 * @param {{repoauth?:string, skipVerification?:boolean, architecture:string}} options
 * @returns {Promise<void>}
 */
async function verifyRepository(repotag, options = {}) {
  const repoauth = options.repoauth || null;
  const skipVerification = options.skipVerification || false;
  const architecture = options.architecture || null;

  const imgVerifier = new imageVerifier.ImageVerifier(
    repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  // ToDo: fix this upstream
  if (repoauth && skipVerification) {
    return;
  }

  if (repoauth) {
    const authToken = await pgpService.decryptMessage(repoauth);

    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }

    if (!authToken.includes(':')) {
      throw new Error('Provided credentials not in the correct username:token format');
    }

    imgVerifier.addCredentials(authToken);
  }

  await imgVerifier.verifyImage();
  imgVerifier.throwIfError();

  if (architecture && !imgVerifier.supported) {
    throw new Error(`This Fluxnode's architecture ${architecture} not supported by ${repotag}`);
  }
}

async function getBlockedRepositores() {
  try {
    const cachedResponse = myLongCache.get('blockedRepositories');
    if (cachedResponse) {
      return cachedResponse;
    }
    const resBlockedRepo = await serviceHelper.axiosGet('https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/blockedrepositories.json');
    if (resBlockedRepo.data) {
      myLongCache.set('blockedRepositories', resBlockedRepo.data);
      return resBlockedRepo.data;
    }
    return null;
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * Check fluxOs configuration to see if there is any repository blocked and return a list of them that doesn't exist on marketplace
 * As any change of the config will restart FluxOs we cache the first execution and always return that.
 * @returns {array} array of string repositories.
 */
let cacheUserBlockedRepos = null;
async function getUserBlockedRepositores() {
  try {
    if (cacheUserBlockedRepos) {
      return cacheUserBlockedRepos;
    }
    const userBlockedRepos = userconfig.initial.blockedRepositories || [];
    if (userBlockedRepos.length === 0) {
      return userBlockedRepos;
    }
    const usableUserBlockedRepos = [];
    const marketPlaceUrl = 'https://stats.runonflux.io/marketplace/listapps';
    const response = await axios.get(marketPlaceUrl);
    console.log(response);
    if (response && response.data && response.data.status === 'success') {
      const visibleApps = response.data.data.filter((val) => val.visible);
      for (let i = 0; i < userBlockedRepos.length; i += 1) {
        const userRepo = userBlockedRepos[i];
        userRepo.substring(0, userRepo.lastIndexOf(':') > -1 ? userRepo.lastIndexOf(':') : userRepo.length);
        const exist = visibleApps.find((app) => app.compose.find((compose) => compose.repotag.substring(0, compose.repotag.lastIndexOf(':') > -1 ? compose.repotag.lastIndexOf(':') : compose.repotag.length).toLowerCase() === userRepo.toLowerCase()));
        if (!exist) {
          usableUserBlockedRepos.push(userRepo);
        } else {
          log.info(`${userRepo} is part of marketplace offer and despite being on blockedRepositories it will not be take in consideration`);
        }
      }
      cacheUserBlockedRepos = usableUserBlockedRepos;
      return cacheUserBlockedRepos;
    }
    return [];
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * Check secrets, if they are being used return exception
 * @param {string} appName App name.
 * @param {object} appComponentSpecs App specifications.
 * @param {string} appOwner owner Id of the app.
 */
async function checkAppSecrets(appName, appComponentSpecs, appOwner) {
  // Normalize PGP secrets string
  const normalizePGP = (pgpMessage) => {
    if (!pgpMessage) return '';
    return pgpMessage.replace(/\s+/g, '').replace(/\\n/g, '').trim();
  };

  const appComponentSecrets = normalizePGP(appComponentSpecs.secrets);

  // Database connection
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = { projection: { _id: 0 } };
  // Query permanent app messages
  const appsQuery = {
    $and: [
      { 'appSpecifications.version': 7 },
      { 'appSpecifications.nodes': { $exists: true, $ne: [] } },
    ],
  };

  const permanentAppMessages = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);

  const processedSecrets = new Set();
  // eslint-disable-next-line no-restricted-syntax
  for (const message of permanentAppMessages) {
    // eslint-disable-next-line no-restricted-syntax
    for (const component of message.appSpecifications.compose.filter((comp) => comp.secrets)) {
      const normalizedComponentSecret = normalizePGP(component.secrets);
      // eslint-disable-next-line no-continue
      if (processedSecrets.has(normalizedComponentSecret)) continue;
      processedSecrets.add(normalizedComponentSecret);

      if (normalizedComponentSecret === appComponentSecrets && message.appSpecifications.owner !== appOwner) {
        throw new Error(
          `Component '${appComponentSpecs.name}' secrets are not valid - registered already with different app owner').`,
        );
      }
    }
  }
}

/**
 * To check compliance of app images (including images for each component if a Docker Compose app). Checks Flux OS's GitHub repository for list of blocked Docker Hub/Github/Google repositories.
 * @param {object} appSpecs App specifications.
 * @returns {Promise<boolean>} True if no errors are thrown.
 */
async function checkApplicationImagesComplience(appSpecs) {
  const repos = await getBlockedRepositores();
  const userBlockedRepos = await getUserBlockedRepositores();
  if (!repos) {
    throw new Error('Unable to communicate with Flux Services! Try again later.');
  }

  const pureImagesOrOrganisationsRepos = [];
  repos.forEach((repo) => {
    pureImagesOrOrganisationsRepos.push(repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));
  });

  // blacklist works also for zelid and app hash
  if (pureImagesOrOrganisationsRepos.includes(appSpecs.hash)) {
    throw new Error(`${appSpecs.hash} is not allowed to be spawned`);
  }
  if (pureImagesOrOrganisationsRepos.includes(appSpecs.owner)) {
    throw new Error(`${appSpecs.owner} is not allowed to run applications`);
  }

  const images = [];
  const organisations = [];
  if (appSpecs.version <= 3) {
    const repository = appSpecs.repotag.substring(0, appSpecs.repotag.lastIndexOf(':') > -1 ? appSpecs.repotag.lastIndexOf(':') : appSpecs.repotag.length);
    images.push(repository);
    const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
    organisations.push(pureNamespace);
  } else {
    appSpecs.compose.forEach((component) => {
      const repository = component.repotag.substring(0, component.repotag.lastIndexOf(':') > -1 ? component.repotag.lastIndexOf(':') : component.repotag.length);
      images.push(repository);
      const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
      organisations.push(pureNamespace);
    });
  }

  images.forEach((image) => {
    if (pureImagesOrOrganisationsRepos.includes(image)) {
      throw new Error(`Image ${image} is blocked. Application ${appSpecs.name} connot be spawned.`);
    }
  });
  organisations.forEach((org) => {
    if (pureImagesOrOrganisationsRepos.includes(org)) {
      throw new Error(`Organisation ${org} is blocked. Application ${appSpecs.name} connot be spawned.`);
    }
  });

  if (userBlockedRepos) {
    log.info(`userBlockedRepos: ${JSON.stringify(userBlockedRepos)}`);
    organisations.forEach((org) => {
      if (userBlockedRepos.includes(org.toLowerCase())) {
        throw new Error(`Organisation ${org} is user blocked. Application ${appSpecs.name} connot be spawned.`);
      }
    });
    images.forEach((image) => {
      if (userBlockedRepos.includes(image.toLowerCase())) {
        throw new Error(`Image ${image} is user blocked. Application ${appSpecs.name} connot be spawned.`);
      }
    });
  }

  return true;
}

/**
 *
 * @param {express.Request} req
 * @param {express.Response} res
 */
async function getlatestApplicationSpecificationAPI(req, res) {
  const latestSpec = config.fluxapps.latestAppSpecification || 1;

  const message = messageHelper.createDataMessage(latestSpec);

  res.json(message);
}

/**
 * To check if application image is part of blocked repositories
 * @param {object} appSpecs App specifications.
 * @returns {boolean, string} False if blocked, String of reason if yes
 */
async function checkApplicationImagesBlocked(appSpecs) {
  const repos = await getBlockedRepositores();
  const userBlockedRepos = await getUserBlockedRepositores();
  let isBlocked = false;
  if (!repos && !userBlockedRepos) {
    return isBlocked;
  }
  const images = [];
  const organisations = [];
  if (appSpecs.version <= 3) {
    const repository = appSpecs.repotag.substring(0, appSpecs.repotag.lastIndexOf(':') > -1 ? appSpecs.repotag.lastIndexOf(':') : appSpecs.repotag.length);
    images.push(repository);
    const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
    organisations.push(pureNamespace);
  } else {
    appSpecs.compose.forEach((component) => {
      const repository = component.repotag.substring(0, component.repotag.lastIndexOf(':') > -1 ? component.repotag.lastIndexOf(':') : component.repotag.length);
      images.push(repository);
      const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
      organisations.push(pureNamespace);
    });
  }
  if (repos) {
    const pureImagesOrOrganisationsRepos = [];
    repos.forEach((repo) => {
      pureImagesOrOrganisationsRepos.push(repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));
    });

    // blacklist works also for zelid and app hash
    if (pureImagesOrOrganisationsRepos.includes(appSpecs.hash)) {
      return `${appSpecs.hash} is not allowed to be spawned`;
    }
    if (pureImagesOrOrganisationsRepos.includes(appSpecs.owner)) {
      return `${appSpecs.owner} is not allowed to run applications`;
    }

    images.forEach((image) => {
      if (pureImagesOrOrganisationsRepos.includes(image)) {
        isBlocked = `Image ${image} is blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
    organisations.forEach((org) => {
      if (pureImagesOrOrganisationsRepos.includes(org)) {
        isBlocked = `Organisation ${org} is blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
  }

  if (!isBlocked && userBlockedRepos) {
    log.info(`userBlockedRepos: ${JSON.stringify(userBlockedRepos)}`);
    organisations.forEach((org) => {
      if (userBlockedRepos.includes(org.toLowerCase())) {
        isBlocked = `Organisation ${org} is user blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
    if (!isBlocked) {
      images.forEach((image) => {
        if (userBlockedRepos.includes(image.toLowerCase())) {
          isBlocked = `Image ${image} is user blocked. Application ${appSpecs.name} connot be spawned.`;
        }
      });
    }
  }

  return isBlocked;
}

/**
 * To verify correctness of attribute values within an app specification object. Checks for types and that required attributes exist.
 * @param {object} appSpecification App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function verifyTypeCorrectnessOfApp(appSpecification) {
  const {
    version,
    name,
    description,
    owner,
    port,
    containerPort,
    compose,
    repotag,
    ports,
    domains,
    enviromentParameters,
    commands,
    containerPorts,
    containerData,
    instances,
    cpu,
    ram,
    hdd,
    tiered,
    contacts,
    geolocation,
    expire,
    nodes,
    staticip,
    enterprise,
  } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter version');
  }

  // commons
  if (!version || !name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter name and/or description and/or owner');
  }

  if (typeof version !== 'number') {
    throw new Error('Invalid Flux App version');
  }
  if (!serviceHelper.isDecimalLimit(version)) {
    throw new Error('Invalid Flux App version decimals');
  }

  if (typeof name !== 'string') {
    throw new Error('Invalid Flux App name');
  }

  if (typeof description !== 'string') {
    throw new Error('Invalid Flux App description');
  }

  if (typeof owner !== 'string') {
    throw new Error('Invalid Flux App owner');
  }

  if (version === 1) {
    if (!port || !containerPort) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort');
    }
  } else if (version >= 2 && version <= 3) {
    if (!ports || !domains || !containerPorts) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort and/or domains');
    }
  }

  if (version === 1) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (typeof port !== 'number') {
      throw new Error('Port for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(port, 0)) {
      throw new Error('Ports for Flux App are invalid decimals');
    }

    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Environmental parameters for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        if (typeof command !== 'string') {
          throw new Error('Flux App commands are invalid');
        }
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    if (typeof containerPort !== 'number') {
      throw new Error('Container Port for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(containerPort, 0)) {
      throw new Error('Ports for Flux App are invalid decimals');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    if (typeof cpu !== 'number' || typeof hdd !== 'number' || typeof ram !== 'number') {
      throw new Error('Invalid HW specifications');
    }
    if (!serviceHelper.isDecimalLimit(cpu) || !serviceHelper.isDecimalLimit(hdd) || !serviceHelper.isDecimalLimit(ram)) {
      throw new Error('Invalid HW specifications decimal limits');
    }

    if (tiered) {
      const {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
        || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
        || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else if (version <= 3) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Port of Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(parameter, 0)) {
          throw new Error('Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }
    if (Array.isArray(domains)) {
      domains.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Domains for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
    }
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Environmental parameters for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        if (typeof command !== 'string') {
          throw new Error('Flux App commands are invalid');
        }
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    if (Array.isArray(containerPorts)) {
      containerPorts.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Container Port of Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(parameter, 0)) {
          throw new Error('Container Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Container Ports for Flux App are invalid');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    if (typeof cpu !== 'number' || typeof hdd !== 'number' || typeof ram !== 'number') {
      throw new Error('Invalid HW specifications');
    }
    if (!serviceHelper.isDecimalLimit(cpu) || !serviceHelper.isDecimalLimit(hdd) || !serviceHelper.isDecimalLimit(ram)) {
      throw new Error('Invalid HW specifications decimal limits');
    }

    if (tiered) {
      const {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
        || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
        || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else if (version <= 7) { // v4 to v7
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    if (typeof compose !== 'object') {
      throw new Error('Invalid Flux App Specifications');
    }
    if (!Array.isArray(compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent.name !== 'string') {
        throw new Error('Invalid Flux App component name');
      }
      if (typeof appComponent.description !== 'string') {
        throw new Error(`Invalid Flux App component ${appComponent.name} description`);
      }
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.domains)) {
        appComponent.domains.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.environmentParameters)) {
        appComponent.environmentParameters.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.commands)) {
        appComponent.commands.forEach((command) => {
          if (typeof command !== 'string') {
            throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
          }
        });
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      if (Array.isArray(appComponent.containerPorts)) {
        appComponent.containerPorts.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (typeof appComponent.tiered !== 'boolean') {
        throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
      }
      const cpuB = appComponent.cpu;
      const ramB = appComponent.ram;
      const hddB = appComponent.hdd;
      if (typeof cpuB !== 'number' || typeof ramB !== 'number' || typeof hddB !== 'number') {
        throw new Error('Invalid HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpuB) || !serviceHelper.isDecimalLimit(ramB) || !serviceHelper.isDecimalLimit(hddB)) {
        throw new Error('Invalid HW specifications decimal limits');
      }
      if (appComponent.tiered) {
        const {
          cpubasic,
          cpusuper,
          cpubamf,
          rambasic,
          ramsuper,
          rambamf,
          hddbasic,
          hddsuper,
          hddbamf,
        } = appComponent;
        if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
          || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
          || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
          throw new Error('Invalid tiered HW specifications');
        }
        if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
          || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
          || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
          throw new Error('Invalid tiered HW specifications');
        }
      }

      if (version === 7) {
        if (typeof appComponent.secrets !== 'string') {
          throw new Error(`Secrets for Flux App component ${appComponent.name} are invalid`);
        }

        if (typeof appComponent.repoauth !== 'string') {
          throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
        }
      }
    });
  } else { // v8+
    if (enterprise === null || enterprise === undefined) { // enterprise can be false or a encrypted string with a object with contacts and components
      throw new Error('Missing enterprise property');
    }
    if (!enterprise && nodes && nodes.length > 0) {
      throw new Error('Nodes can only be used in enterprise apps');
    }
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    if (typeof compose !== 'object') {
      throw new Error('Invalid Flux App Specifications');
    }
    if (!Array.isArray(compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent.name !== 'string') {
        throw new Error('Invalid Flux App component name');
      }
      if (typeof appComponent.description !== 'string') {
        throw new Error(`Invalid Flux App component ${appComponent.name} description`);
      }
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.domains)) {
        appComponent.domains.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.environmentParameters)) {
        appComponent.environmentParameters.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.commands)) {
        appComponent.commands.forEach((command) => {
          if (typeof command !== 'string') {
            throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
          }
        });
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      if (Array.isArray(appComponent.containerPorts)) {
        appComponent.containerPorts.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }

      const cpuB = appComponent.cpu;
      const ramB = appComponent.ram;
      const hddB = appComponent.hdd;
      if (typeof cpuB !== 'number' || typeof ramB !== 'number' || typeof hddB !== 'number') {
        throw new Error('Invalid HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpuB) || !serviceHelper.isDecimalLimit(ramB) || !serviceHelper.isDecimalLimit(hddB)) {
        throw new Error('Invalid HW specifications decimal limits');
      }

      if (typeof appComponent.repoauth !== 'string') {
        throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
      }
    });
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter instances');
    }
    if (typeof instances !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(instances) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (!serviceHelper.isDecimalLimit(instances, 0)) {
      throw new Error('Invalid instances specified');
    }
  }

  if (version >= 5) {
    if (Array.isArray(contacts)) {
      contacts.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Contacts for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Contacts for Flux App are invalid');
    }
    if (Array.isArray(geolocation)) {
      geolocation.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Geolocation for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Geolocation for Flux App are invalid');
    }
  }

  if (version >= 6) {
    if (!expire) {
      throw new Error('Missing Flux App specification parameter expire');
    }
    if (typeof expire !== 'number') {
      throw new Error('Invalid expire specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid expire specified');
    }
    if (!serviceHelper.isDecimalLimit(expire, 0)) {
      throw new Error('Invalid expire specified');
    }
  }

  if (version >= 7) {
    if (!nodes) {
      throw new Error('Missing Flux App specification parameter nodes');
    }
    if (Array.isArray(nodes)) {
      nodes.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Nodes for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Nodes for Flux App are invalid');
    }

    if (typeof staticip !== 'boolean') {
      throw new Error('Invalid static ip value obtained. Only boolean as true or false allowed.');
    }
  }

  return true;
}

/**
 * To verify correctness of attribute values within an app specification object. Checks for if restrictions of specs are valid.
 * @param {object} appSpecification App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function verifyRestrictionCorrectnessOfApp(appSpecifications, height) {
  const minPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMin : config.fluxapps.portMinLegacy;
  const maxPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMax : config.fluxapps.portMaxLegacy;
  if (appSpecifications.version !== 1 && appSpecifications.version !== 2 && appSpecifications.version !== 3 && appSpecifications.version !== 4 && appSpecifications.version !== 5 && appSpecifications.version !== 6 && appSpecifications.version !== 7 && appSpecifications.version !== 8) {
    throw new Error('Flux App message version specification is invalid');
  }
  if (appSpecifications.name.length > 32) {
    throw new Error('Flux App name is too long');
  }
  // furthermore name cannot contain any special character
  if (!appSpecifications.name) {
    throw new Error('Please provide a valid Flux App name');
  }
  if (!appSpecifications.name.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error('Flux App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
  }
  if (appSpecifications.name.startsWith('zel')) {
    throw new Error('Flux App name can not start with zel');
  }
  if (appSpecifications.name.toLowerCase() === 'watchtower') {
    throw new Error('Flux App name is conflicting with another application');
  }
  if (appSpecifications.name.startsWith('flux')) {
    throw new Error('Flux App name can not start with flux');
  }
  if (appSpecifications.description.length > 256) {
    throw new Error('Description is too long. Maximum of 256 characters is allowed');
  }

  if (appSpecifications.version === 1) {
    // check port is within range
    if (appSpecifications.port < minPort || appSpecifications.port > maxPort) {
      throw new Error(`Assigned port ${appSpecifications.port} is not within Flux Apps range ${minPort}-${maxPort}`);
    }
    const iBP = fluxNetworkHelper.isPortBanned(appSpecifications.port);
    if (iBP) {
      throw new Error(`Assigned port ${appSpecifications.port} is not allowed for Flux Apps`);
    }
    // check if containerPort makes sense
    if (appSpecifications.containerPort < 0 || appSpecifications.containerPort > 65535) {
      throw new Error(`Container Port ${appSpecifications.containerPort} is not within system limits 0-65535`);
    }
  } else if (appSpecifications.version <= 3) {
    // check port is within range
    appSpecifications.ports.forEach((port) => {
      if (port < minPort || port > maxPort) {
        throw new Error(`Assigned port ${port} is not within Flux Apps range ${minPort}-${maxPort}`);
      }
      const iBP = fluxNetworkHelper.isPortBanned(port);
      if (iBP) {
        throw new Error(`Assigned port ${port} is not allowed for Flux Apps`);
      }
    });
    // check if containerPort makes sense
    appSpecifications.containerPorts.forEach((port) => {
      if (port < 0 || port > 65535) {
        throw new Error(`Container Port ${port} is not within system limits 0-65535`);
      }
    });
    if (appSpecifications.containerPorts.length !== appSpecifications.ports.length) {
      throw new Error('Ports specifications do not match');
    }
    if (appSpecifications.domains.length !== appSpecifications.ports.length) {
      throw new Error('Domains specifications do not match available ports');
    }
    if (appSpecifications.ports.length > 5) {
      throw new Error('Too many ports defined. Maximum of 5 allowed.');
    }
    appSpecifications.domains.forEach((dom) => {
      if (dom.length > 253) {
        throw new Error(`App ${appSpecifications.name} domain ${dom} is too long. Maximum of 253 characters is allowed`);
      }
    });
  }

  if (appSpecifications.version <= 3) {
    // check wheter shared Folder is not root
    if (appSpecifications.containerData.length < 2) {
      throw new Error('Flux App container data folder not specified. If no data folder is whished, use /tmp');
    }
    if (appSpecifications.containerData.length > 200) {
      throw new Error('Flux App Container Data is too long. Maximum of 200 characters is allowed');
    }
    if (appSpecifications.repotag.length > 200) {
      throw new Error('Flux App Repository is too long. Maximum of 200 characters is allowed.');
    }
    if (appSpecifications.enviromentParameters.length > 20) {
      throw new Error(`App ${appSpecifications.name} environment invalid. Maximum of 20 environment variables allowed.`);
    }
    appSpecifications.enviromentParameters.forEach((env) => {
      if (env.length > 400) {
        throw new Error(`App ${appSpecifications.name} environment ${env} is too long. Maximum of 400 characters is allowed`);
      }
    });
    if (appSpecifications.commands.length > 20) {
      throw new Error(`App ${appSpecifications.name} commands invalid. Maximum of 20 commands allowed.`);
    }
    appSpecifications.commands.forEach((com) => {
      if (com.length > 400) {
        throw new Error(`App ${appSpecifications.name} command ${com} is too long. Maximum of 400 characters is allowed`);
      }
    });
  } else {
    if (appSpecifications.compose.length < 1) {
      throw new Error('Flux App does not contain any composition');
    }
    let maxComponents = 10;
    if (height < config.fluxapps.appSpecsEnforcementHeights[6]) {
      maxComponents = 5;
    }
    if (appSpecifications.compose.length > maxComponents) {
      throw new Error('Flux App has too many components');
    }
    // check port is within range
    const usedNames = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecifications.compose) {
      if (!appComponent) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent !== 'object') {
        throw new Error('Invalid Flux App Specifications');
      }
      if (!appComponent.name) {
        throw new Error('Please provide a valid Flux App Component name');
      }
      if (appComponent.name.length > 32) {
        throw new Error('Flux App name is too long');
      }
      if (appComponent.name.startsWith('zel')) {
        throw new Error('Flux App Component name can not start with zel');
      }
      if (appComponent.name.startsWith('flux')) {
        throw new Error('Flux App Component name can not start with flux');
      }
      // furthermore name cannot contain any special character
      if (!appComponent.name.match(/^[a-zA-Z0-9]+$/)) {
        throw new Error('Flux App component name contains special characters. Only a-z, A-Z and 0-9 are allowed');
      }
      if (usedNames.includes(appComponent.name)) {
        throw new Error(`Flux App component ${appComponent.name} already assigned. Use different name.`);
      }
      usedNames.push(appComponent.name);
      if (appComponent.description.length > 256) {
        throw new Error('Description is too long. Maximum of 256 characters is allowed.');
      }
      appComponent.ports.forEach((port) => {
        if (port < minPort || port > maxPort) {
          throw new Error(`Assigned port ${port} is not within Flux Apps range ${minPort}-${maxPort}`);
        }
        const iBP = fluxNetworkHelper.isPortBanned(port);
        if (iBP) {
          throw new Error(`Assigned port ${port} is not allowed for Flux Apps`);
        }
      });
      if (appComponent.repotag.length > 200) {
        throw new Error('Flux App Repository is too long. Maximum of 200 characters is allowed.');
      }
      if (appComponent.containerData.length > 200) {
        throw new Error('Flux App Container Data is too long. Maximum of 200 characters is allowed');
      }
      if (appComponent.environmentParameters.length > 20) {
        throw new Error(`App component ${appComponent.name} environment invalid. Maximum of 20 environment variables allowed.`);
      }
      appComponent.environmentParameters.forEach((env) => {
        if (env.length > 400) {
          throw new Error(`App component ${appComponent.name} environment ${env} is too long. Maximum of 400 characters is allowed`);
        }
      });
      if (appComponent.commands.length > 20) {
        throw new Error(`App component ${appComponent.name} commands invalid. Maximum of 20 commands allowed.`);
      }
      appComponent.commands.forEach((com) => {
        if (com.length > 400) {
          throw new Error(`App component ${appComponent.name} command ${com} is too long. Maximum of 400 characters is allowed`);
        }
      });
      appComponent.domains.forEach((dom) => {
        if (dom.length > 253) {
          throw new Error(`App component ${appComponent.name} domain ${dom} is too long. Maximum of 253 characters is allowed`);
        }
      });
      // check if containerPort makes sense
      appComponent.containerPorts.forEach((port) => {
        if (port < 0 || port > 65535) {
          throw new Error(`Container Port ${port} in in ${appComponent.name} is not within system limits 0-65535`);
        }
      });
      if (appComponent.containerPorts.length !== appComponent.ports.length) {
        throw new Error(`Ports specifications in ${appComponent.name} do not match`);
      }
      if (appComponent.domains.length !== appComponent.ports.length) {
        throw new Error(`Domains specifications in ${appComponent.name} do not match available ports`);
      }
      if (appComponent.ports.length > 5) {
        throw new Error(`Too many ports defined in ${appComponent.name}. Maximum of 5 allowed.`);
      }
      // check wheter shared Folder is not root
      if (appComponent.containerData.length < 2) {
        throw new Error(`Flux App container data folder not specified in in ${appComponent.name}. If no data folder is whished, use /tmp`);
      }

      if (appSpecifications.version === 7) {
        if (!appSpecifications.nodes.length) { // this is NOT an enterprise app, no nodes scoping
          if (appComponent.secrets.length) { // pgp encrypted message. Every signature encryption of node is about 100 characters. For 100 selected nodes, this gives ~5k chars limit
            throw new Error('Secrets can not be defined for non Enterprise Applications');
          }
          if (appComponent.repoauth.length) { // pgp encrypted message.
            throw new Error('Private repositories are only allowed for Enterprise Applications');
          }
        } else {
          if (appComponent.secrets.length > 15000) { // pgp encrypted message. Every signature encryption of node is about 100 characters. For 100 selected nodes, this gives ~5k chars limit
            throw new Error('Maximum length of secrets is 15000. Consider uploading to Flux Storage for bigger payload.');
          }
          if (appComponent.repoauth.length > 15000) { // pgp encrypted message.
            throw new Error('Maximum length of repoauth is 15000.');
          }
        }
      }
      if (appSpecifications.version >= 8) {
        if (!appSpecifications.enterpise) { // this is NOT an enterprise app
          if (appComponent.repoauth.length) { // pgp encrypted message.
            throw new Error('Private repositories are only allowed for Enterprise Applications');
          }
        } else if (appComponent.repoauth.length > 15000) { // pgp encrypted message.
          throw new Error('Maximum length of repoauth is 15000.');
        }
      }
    }
  }

  if (appSpecifications.version >= 3) {
    if (appSpecifications.instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (appSpecifications.instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
  }

  if (appSpecifications.version >= 5) {
    if (appSpecifications.contacts.length > 5) {
      throw new Error('Too many contacts defined. Maximum of 5 allowed.');
    }
    appSpecifications.contacts.forEach((contact) => {
      if (contact.length > 75) {
        throw new Error(`Contact ${contact} is too long. Maximum of 75 characters is allowed.`);
      }
    });
    if (appSpecifications.geolocation.length > 10) { // we only expect 2
      throw new Error('Invalid geolocation submited.'); // for now we are only accepting continent and country.
    }
    appSpecifications.geolocation.forEach((geo) => {
      const maxGeoLength = 50;
      if (geo.length > maxGeoLength) { // for now we only treat aXX and bXX as continent and country specs.
        throw new Error(`Geolocation ${geo} is not valid.`); // firt letter for what represents and next two for the code
      }
    });
  }

  if (appSpecifications.version >= 6) {
    if (height < config.fluxapps.newMinBlocksAllowanceBlock) {
      if (appSpecifications.expire < config.fluxapps.minBlocksAllowance) {
        throw new Error(`Minimum expiration of application is ${config.fluxapps.minBlocksAllowance} blocks ~ 1 week`);
      }
    } else if (height < config.fluxapps.cancel1BlockMinBlocksAllowanceBlock) {
      if (appSpecifications.expire < config.fluxapps.newMinBlocksAllowance) {
        throw new Error(`Minimum expiration of application is ${config.fluxapps.newMinBlocksAllowance} blocks ~ 3 hours`);
      }
    } else if (appSpecifications.expire < config.fluxapps.cancel1BlockMinBlocksAllowance) {
      throw new Error(`Minimum expiration of application is ${config.fluxapps.cancel1BlockMinBlocksAllowance} blocks`);
    }
    if (appSpecifications.expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    if (height < config.fluxapps.removeBlocksAllowanceIntervalBlock) {
      if (appSpecifications.expire % config.fluxapps.blocksAllowanceInterval !== 0) {
        throw new Error(`Expiration of application has to be a multiple of ${config.fluxapps.blocksAllowanceInterval} blocks ~ 1 day`);
      }
    }
  }

  if (appSpecifications.version >= 7) {
    if (appSpecifications.nodes.length > 120) {
      throw new Error('Maximum number of selecteed nodes is 120');
    }
    appSpecifications.nodes.forEach((node) => {
      if (node.length > 70) { // 64 for txhash, : separator, max 5 for outidx
        throw new Error('Invalid node length');
      }
    });
  }
}

/**
 * To verify correctness of attribute values within an app specification object. Checks if all object keys are assigned and no excess present
 * @param {object} appSpecification App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function verifyObjectKeysCorrectnessOfApp(appSpecifications) {
  if (appSpecifications.version === 1) {
    // appSpecs: {
    //   version: 2,
    //   name: 'FoldingAtHomeB',
    //   description: 'Folding @ Home is cool :)',
    //   repotag: 'yurinnick/folding-at-home:latest',
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    //   ports: '[30001]', // []
    //   containerPorts: '[7396]', // []
    //   domains: '[""]', // []
    //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
    //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
    //   containerData: '/config',
    //   cpu: 0.5,
    //   ram: 500,
    //   hdd: 5,
    //   tiered: true,
    //   cpubasic: 0.5,
    //   rambasic: 500,
    //   hddbasic: 5,
    //   cpusuper: 1,
    //   ramsuper: 1000,
    //   hddsuper: 5,
    //   cpubamf: 2,
    //   rambamf: 2000,
    //   hddbamf: 5,
    //   hash: hash of message that has these paramenters,
    //   height: height containing the message
    // };
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'port', 'containerPort', 'enviromentParameters', 'commands', 'containerData',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v1 app specifications');
      }
    });
  } else if (appSpecifications.version === 2) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v2 app specifications');
      }
    });
  } else if (appSpecifications.version === 3) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains', 'instances',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v3 app specifications');
      }
    });
  } else if (appSpecifications.version === 4) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v4 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v4 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 5) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v5 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v5 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 6) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v6 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v6 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 7) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'secrets', 'repoauth',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v7 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v7 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 8) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts',
      'geolocation', 'expire', 'nodes', 'staticip', 'enterprise',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'repoauth',
      'cpu', 'ram', 'hdd',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v8 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v8 app specifications');
        }
      });
    });
  } else {
    throw new Error(`Invalid version specification of ${appSpecifications.version}`);
  }
}

/**
 * To convert an array of ports to a set object containing a list of unique ports.
 * @param {number[]} portsArray Array of ports.
 * @returns {object} Set object.
 */
function appPortsUnique(portsArray) {
  return (new Set(portsArray)).size === portsArray.length;
}

/**
 * To ensure that the app ports are unique.
 * @param {object} appSpecFormatted App specifications.
 * @returns True if Docker version 1. If Docker version 2 to 3, returns true if no errors are thrown.
 */
function ensureAppUniquePorts(appSpecFormatted) {
  if (appSpecFormatted.version === 1) {
    return true;
  }
  if (appSpecFormatted.version <= 3) {
    const portsUnique = appPortsUnique(appSpecFormatted.ports);
    if (!portsUnique) {
      throw new Error(`Flux App ${appSpecFormatted.name} must have unique ports specified`);
    }
  } else {
    const allPorts = [];
    appSpecFormatted.compose.forEach((component) => {
      component.ports.forEach((port) => {
        allPorts.push(port);
      });
    });
    const portsUnique = appPortsUnique(allPorts);
    if (!portsUnique) {
      throw new Error(`Flux App ${appSpecFormatted.name} must have unique ports specified accross all composition`);
    }
  }
  return true;
}

/**
 * To verify app specifications. Checks the attribute values of the appSpecifications object.
 * @param {object} appSpecifications App specifications.
 * @param {number} height Block height.
 * @param {boolean} checkDockerAndWhitelist Defaults to false.
 */
async function verifyAppSpecifications(appSpecifications, height, checkDockerAndWhitelist = false) {
  if (!appSpecifications) {
    throw new Error('Invalid Flux App Specifications');
  }
  if (typeof appSpecifications !== 'object') {
    throw new Error('Invalid Flux App Specifications');
  }
  if (Array.isArray(appSpecifications)) {
    throw new Error('Invalid Flux App Specifications');
  }

  // TYPE CHECKS
  verifyTypeCorrectnessOfApp(appSpecifications);

  // RESTRICTION CHECKS
  verifyRestrictionCorrectnessOfApp(appSpecifications, height);

  // SPECS VALIDIT TIME
  if (height < config.fluxapps.appSpecsEnforcementHeights[appSpecifications.version]) {
    throw new Error(`Flux apps specifications of version ${appSpecifications.version} not yet supported`);
  }

  // OBJECT KEY CHECKS
  // check for Object.keys in applications. App can have only the fields that are in the version specification.
  verifyObjectKeysCorrectnessOfApp(appSpecifications);

  // PORTS UNIQUE CHECKS
  // verify ports are unique accross app
  ensureAppUniquePorts(appSpecifications);

  // HW Checks
  if (appSpecifications.version <= 3) {
    checkHWParameters(appSpecifications);
  } else {
    checkComposeHWParameters(appSpecifications);
  }

  // Whitelist, repository checks
  if (checkDockerAndWhitelist) {
    // check blacklist
    await checkApplicationImagesComplience(appSpecifications);

    if (appSpecifications.version <= 3) {
      // check repository whitelisted and repotag is available for download
      await verifyRepository(appSpecifications.repotag, { repoauth: appSpecifications.repoauth, skipVerification: true });
    } else {
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponent of appSpecifications.compose) {
        // check repository whitelisted and repotag is available for download
        // eslint-disable-next-line no-await-in-loop
        await verifyRepository(appComponent.repotag, { repoauth: appComponent.repoauth, skipVerification: true });
      }
    }
  }
}

/**
 * To create a list of ports assigned to each local app.
 * @returns {object[]} Array of app specs objects.
 */
async function assignedPortsInstalledApps() {
  // construct object ob app name and ports array
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appslocal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await dbHelper.findInDatabase(database, localAppsInformation, query, projection);

  const decryptedApps = [];

  // ToDo: move the functions around so we can remove no-use-before-define

  // eslint-disable-next-line no-restricted-syntax
  for (const spec of results) {
    const isEnterprise = Boolean(
      spec.version >= 8 && spec.enterprise,
    );

    if (isEnterprise) {
      // eslint-disable-next-line no-await-in-loop,no-use-before-define
      const decrypted = await checkAndDecryptAppSpecs(spec);
      // eslint-disable-next-line no-use-before-define
      const formatted = specificationFormatter(decrypted);
      decryptedApps.push(formatted);
    } else {
      decryptedApps.push(spec);
    }
  }

  const apps = [];
  decryptedApps.forEach((app) => {
    // there is no app
    if (app.version === 1) {
      const appSpecs = {
        name: app.name,
        ports: [Number(app.port)],
      };
      apps.push(appSpecs);
    } else if (app.version <= 3) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.ports.forEach((port) => {
        appSpecs.ports.push(Number(port));
      });
      apps.push(appSpecs);
    } else if (app.version >= 4) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.compose.forEach((composeApp) => {
        appSpecs.ports = appSpecs.ports.concat(composeApp.ports);
      });
      apps.push(appSpecs);
    }
  });
  return apps;
}

/**
 * To create a list of ports assigned to each global app.
 * @param {string[]} appNames App names.
 * @returns {object[]} Array of app specs objects.
 */
async function assignedPortsGlobalApps(appNames) {
  // construct object ob app name and ports array
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const appsQuery = [];
  appNames.forEach((app) => {
    appsQuery.push({
      name: app,
    });
  });
  if (!appsQuery.length) {
    return [];
  }
  const query = {
    $or: appsQuery,
  };
  const projection = { projection: { _id: 0 } };
  const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
  const apps = [];
  results.forEach((app) => {
    // there is no app
    if (app.version === 1) {
      const appSpecs = {
        name: app.name,
        ports: [Number(app.port)],
      };
      apps.push(appSpecs);
    } else if (app.version <= 3) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.ports.forEach((port) => {
        appSpecs.ports.push(Number(port));
      });
      apps.push(appSpecs);
    } else if (app.version >= 4) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.compose.forEach((composeApp) => {
        appSpecs.ports = appSpecs.ports.concat(composeApp.ports);
      });
      apps.push(appSpecs);
    }
  });
  return apps;
}

/**
 * Restores FluxOS firewall, UPNP rules
 */
async function restoreFluxPortsSupport() {
  try {
    const isUPNP = upnpService.isUPNP();

    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const homePort = +apiPort - 1;
    const apiPortSSL = +apiPort + 1;
    const syncthingPort = +apiPort + 2;

    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // setup UFW if active
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(apiPort));
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(homePort));
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(apiPortSSL));
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(syncthingPort));
    }

    // UPNP
    if (isUPNP) {
      // map our Flux API, UI and SYNCTHING port
      await upnpService.setupUPNP(apiPort);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Restores applications firewall, UPNP rules
 */
async function restoreAppsPortsSupport() {
  try {
    const currentAppsPorts = await assignedPortsInstalledApps();
    const isUPNP = upnpService.isUPNP();

    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    // setup UFW for apps
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of currentAppsPorts) {
        // eslint-disable-next-line no-restricted-syntax
        for (const port of application.ports) {
          // eslint-disable-next-line no-await-in-loop
          await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(port));
        }
      }
    }

    // UPNP
    if (isUPNP) {
      // map application ports
      // eslint-disable-next-line no-restricted-syntax
      for (const application of currentAppsPorts) {
        // eslint-disable-next-line no-restricted-syntax
        for (const port of application.ports) {
          // eslint-disable-next-line no-await-in-loop
          const upnpOk = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${application.name}`);
          if (!upnpOk) {
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(application.name, null, true, true, true).catch((error) => log.error(error)); // remove entire app
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(3 * 60 * 1000); // 3 mins
            break;
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Restores FluxOS and applications firewall, UPNP rules
 */
async function restorePortsSupport() {
  try {
    await restoreFluxPortsSupport();
    await restoreAppsPortsSupport();
  } catch (error) {
    log.error(error);
  }
}

/**
 * To ensure application ports are not already in use by another appliaction.
 * @param {object} appSpecFormatted App specifications.
 * @param {string[]} globalCheckedApps Names of global checked apps.
 * @returns {boolean} True if no errors are thrown.
 */
async function ensureApplicationPortsNotUsed(appSpecFormatted, globalCheckedApps) {
  let currentAppsPorts = await assignedPortsInstalledApps();
  if (globalCheckedApps && globalCheckedApps.length) {
    const globalAppsPorts = await assignedPortsGlobalApps(globalCheckedApps);
    currentAppsPorts = currentAppsPorts.concat(globalAppsPorts);
  }
  if (appSpecFormatted.version === 1) {
    const portAssigned = currentAppsPorts.find((app) => app.ports.includes(Number(appSpecFormatted.port)));
    if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
      throw new Error(`Flux App ${appSpecFormatted.name} port ${appSpecFormatted.port} already used with different application. Installation aborted.`);
    }
  } else if (appSpecFormatted.version <= 3) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecFormatted.ports) {
      const portAssigned = currentAppsPorts.find((app) => app.ports.includes(Number(port)));
      if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
        throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already used with different application. Installation aborted.`);
      }
    }
  } else {
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecFormatted.compose) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appComponent.ports) {
        const portAssigned = currentAppsPorts.find((app) => app.ports.includes(port));
        if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
          throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already used with different application. Installation aborted.`);
        }
      }
    }
  }
  return true;
}

/**
 * To check if app name already registered. App names must be unique.
 * @param {object} appSpecFormatted App specifications.
 * @param {hash} string hash of App specifications.
 * @param {number} timestamp Timestamp of App specifications message.
 * @returns {boolean} True if no errors are thrown.
 */
async function checkApplicationRegistrationNameConflicts(appSpecFormatted, hash) {
  // check if name is not yet registered
  const dbopen = dbHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') }; // case insensitive
  const appsProjection = {
    projection: {
      _id: 0,
      name: 1,
      height: 1,
      expire: 1,
    },
  };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsInformation, appsQuery, appsProjection);

  if (appResult) {
    // in this case, check if hash of the message is older than our current app
    if (hash) {
      // check if we have the hash of the app in our db
      const query = { hash };
      const projection = {
        projection: {
          _id: 0,
          txid: 1,
          hash: 1,
          height: 1,
        },
      };
      const database = dbopen.db(config.database.daemon.database);
      const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
      if (!result) {
        throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash not found in collection.`);
      }
      if (appResult.height <= result.height) {
        log.debug(appResult);
        log.debug(result);
        const currentExpiration = appResult.height + (appResult.expire || 22000);
        if (currentExpiration >= result.height) {
          throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash is not older than our current app.`);
        } else {
          log.warn(`Flux App ${appSpecFormatted.name} active specifications are outdated. Will be cleaned on next expiration`);
        }
      }
    } else {
      throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name.`);
    }
  }

  const localApps = await availableApps();
  const appExists = localApps.find((localApp) => localApp.name.toLowerCase() === appSpecFormatted.name.toLowerCase());
  if (appExists) {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to local application. Flux App has to be registered under different name.`);
  }
  if (appSpecFormatted.name.toLowerCase() === 'share') {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to Flux main application. Flux App has to be registered under different name.`);
  }
  return true;
}

/**
 * To check for any conflicts with the latest permenent app registration message and any app update messages.
 * @param {object} specifications App specifications.
 * @param {number} verificationTimestamp Verifiaction time stamp.
 * @returns {Promise<boolean>} True if no errors are thrown.
 */
async function checkApplicationUpdateNameRepositoryConflicts(specifications, verificationTimestamp) {
  // eslint-disable-next-line no-use-before-define
  const appSpecs = await getPreviousAppSpecifications(specifications, verificationTimestamp);
  if (specifications.version >= 4) {
    if (appSpecs.version >= 4) {
      // update and current are both v4 compositions
      // must be same amount of copmositions
      // must be same names
      if (specifications.compose.length !== appSpecs.compose.length) {
        throw new Error(`Flux App ${specifications.name} change of components is not allowed`);
      }
      appSpecs.compose.forEach((appComponent) => {
        const newSpecComponentFound = specifications.compose.find((appComponentNew) => appComponentNew.name === appComponent.name);
        if (!newSpecComponentFound) {
          throw new Error(`Flux App ${specifications.name} change of component name is not allowed`);
        }
        // v4 allows for changes of repotag
      });
    } else { // update is v4+ and current app have v1,2,3
      throw new Error(`Flux App ${specifications.name} on update to different specifications is not possible`);
    }
  } else if (appSpecs.version >= 4) {
    throw new Error(`Flux App ${specifications.name} update to different specifications is not possible`);
  } else { // bot update and current app have v1,2,3
    // eslint-disable-next-line no-lonely-if
    if (appSpecs.repotag !== specifications.repotag) { // v1,2,3 does not allow repotag change
      throw new Error(`Flux App ${specifications.name} update of repotag is not allowed`);
    }
  }
  return true;
}

/**
 * To get previous app specifications.
 * @param {object} specifications App sepcifications.
 * @param {object} verificationTimestamp Message timestamp
 * @returns {object} App specifications.
 */
async function getPreviousAppSpecifications(specifications, verificationTimestamp) {
  // we may not have the application in global apps. This can happen when we receive the message after the app has already expired AND we need to get message right before our message. Thus using messages system that is accurate
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appsQuery = {
    'appSpecifications.name': specifications.name,
  };
  const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
  let latestPermanentRegistrationMessage;
  permanentAppMessage.forEach((foundMessage) => {
    // has to be registration message
    if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
      if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= verificationTimestamp) { // no message and found message is not newer than our message
        latestPermanentRegistrationMessage = foundMessage;
      } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= verificationTimestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      }
    }
  });
  // some early app have zelAppSepcifications
  const appsQueryB = {
    'zelAppSpecifications.name': specifications.name,
  };
  const permanentAppMessageB = await dbHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
  permanentAppMessageB.forEach((foundMessage) => {
    // has to be registration message
    if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
      if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= verificationTimestamp) { // no message and found message is not newer than our message
        latestPermanentRegistrationMessage = foundMessage;
      } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= verificationTimestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      }
    }
  });
  if (!latestPermanentRegistrationMessage) {
    throw new Error(`Flux App ${specifications.name} update message received but application does not exists!`);
  }
  const appSpecs = latestPermanentRegistrationMessage.appSpecifications || latestPermanentRegistrationMessage.zelAppSpecifications;
  if (!appSpecs) {
    throw new Error(`Previous specifications for ${specifications.name} update message does not exists! This should not happen.`);
  }
  const heightForDecrypt = latestPermanentRegistrationMessage.height;
  // eslint-disable-next-line no-use-before-define
  const decryptedPrev = await checkAndDecryptAppSpecs(appSpecs, { daemonHeight: heightForDecrypt });
  // eslint-disable-next-line no-use-before-define
  const formattedPrev = specificationFormatter(decryptedPrev);

  return formattedPrev;
}

/**
 * To check if an app message hash exists.
 * @param {string} hash Message hash.
 * @returns {(object|boolean)} Returns document object if it exists in the database. Otherwise returns false.
 */
async function checkAppMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a permanent global zelappmessage looks like this:
  // const permanentAppMessage = {
  //   type: messageType,
  //   version: typeVersion,
  //   zelAppSpecifications: appSpecFormatted,
  //   appSpecifications: appSpecFormatted,
  //   hash: messageHASH,
  //   timestamp,
  //   signature,
  //   txid,
  //   height,
  //   valueSat,
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

/**
 * To check if an app temporary message hash exists.
 * @param {string} hash Message hash.
 * @returns {(object|boolean)} Returns document object if it exists in the database. Otherwise returns false.
 */
async function checkAppTemporaryMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a temporary zelappmessage looks like this:
  // const newMessage = {
  //   appSpecifications: message.appSpecifications,
  //   type: message.type,
  //   version: message.version,
  //   hash: message.hash,
  //   timestamp: message.timestamp,
  //   signature: message.signature,
  //   createdAt: new Date(message.timestamp),
  //   expireAt: new Date(validTill),
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsTempMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

/**
 * To store a temporary message for an app.
 * @param {object} message Message.
 * @param {boolean} furtherVerification Defaults to false.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is already in cache or has already been broadcast. Otherwise an error is thrown.
 */
async function storeAppTemporaryMessage(message, furtherVerification = false) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.signature !== 'string' || typeof message.timestamp !== 'number' || typeof message.hash !== 'string') {
    return new Error('Invalid Flux App message for storing');
  }
  // expect one to be present
  if (typeof message.appSpecifications !== 'object' && typeof message.zelAppSpecifications !== 'object') {
    return new Error('Invalid Flux App message for storing');
  }

  const specifications = message.appSpecifications || message.zelAppSpecifications;
  // eslint-disable-next-line no-use-before-define
  const appSpecFormatted = specificationFormatter(specifications);
  const messageTimestamp = serviceHelper.ensureNumber(message.timestamp);
  const messageVersion = serviceHelper.ensureNumber(message.version);

  // check permanent app message storage
  const appMessage = await checkAppMessageExistence(message.hash);
  if (appMessage) {
    // do not rebroadcast further
    return false;
  }
  // check temporary message storage
  const tempMessage = await checkAppTemporaryMessageExistence(message.hash);
  if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
    // do not rebroadcast further
    return false;
  }

  let isAppRequested = false;
  const db = dbHelper.databaseConnection();
  const query = { hash: message.hash };
  const projection = {
    projection: {
      _id: 0,
      message: 1,
      height: 1,
    },
  };
  let database = db.db(config.database.daemon.database);
  const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  const daemonHeight = syncStatus.data.height;
  let block = daemonHeight;
  if (result && !result.message) {
    isAppRequested = true;
    block = result.height;
  }

  // data shall already be verified by the broadcasting node. But verify all again.
  // this takes roughly at least 1 second
  if (furtherVerification) {
    const appRegistraiton = message.type === 'zelappregister' || message.type === 'fluxappregister';
    if (appSpecFormatted.version >= 8 && appSpecFormatted.enterprise) {
      if (!message.arcaneSender) {
        return new Error('Invalid Flux App message for storing, enterprise app where original sender was not arcane node');
      }
      // eslint-disable-next-line global-require
      const fluxService = require('./fluxService');
      if (await fluxService.isSystemSecure()) {
        // eslint-disable-next-line no-use-before-define
        const appSpecDecrypted = await checkAndDecryptAppSpecs(
          appSpecFormatted,
          { daemonHeight: block, owner: appSpecFormatted.owner },
        );
        // eslint-disable-next-line no-use-before-define
        const appSpecFormattedDecrypted = specificationFormatter(appSpecDecrypted);
        await verifyAppSpecifications(appSpecFormattedDecrypted, block);
        if (appRegistraiton) {
          await checkApplicationRegistrationNameConflicts(appSpecFormattedDecrypted, message.hash);
        } else {
          await checkApplicationUpdateNameRepositoryConflicts(appSpecFormattedDecrypted, messageTimestamp);
        }
      }
    } else {
      await verifyAppSpecifications(appSpecFormatted, block);
      if (appRegistraiton) {
        await checkApplicationRegistrationNameConflicts(appSpecFormatted, message.hash);
      } else {
        await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, messageTimestamp);
      }
    }

    await verifyAppHash(message);
    if (appRegistraiton) {
      await verifyAppMessageSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature);
    } else {
      // get previousAppSpecifications as we need previous owner
      const previousAppSpecs = await getPreviousAppSpecifications(appSpecFormatted, messageTimestamp);
      const { owner } = previousAppSpecs;
      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature, owner, block);
    }
  }

  const receivedAt = Date.now();
  const validTill = receivedAt + (60 * 60 * 1000); // 60 minutes

  const newMessage = {
    appSpecifications: appSpecFormatted,
    type: message.type, // shall be fluxappregister, fluxappupdate
    version: messageVersion,
    hash: message.hash,
    timestamp: messageTimestamp,
    signature: message.signature,
    receivedAt: new Date(receivedAt),
    expireAt: new Date(validTill),
    arcaneSender: message.arcaneSender,
  };
  const value = newMessage;

  database = db.db(config.database.appsglobal.database);
  // message does not exist anywhere and is ok, store it
  await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, value);
  // it is stored and rebroadcasted
  if (isAppRequested) {
    // node received the message but it is coming from a requestappmessage we should not rebroadcast to all peers
    return false;
  }
  return true;
}

/**
 * To store a message for a running app.
 * @param {object} message Message.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is old. Throws an error if invalid.
 */
async function storeAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param hash string
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  const appsMessages = [];
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string') {
    return new Error('Invalid Flux App Running message for storing');
  }

  if (message.version !== 1 && message.version !== 2) {
    return new Error(`Invalid Flux App Running message for storing version ${message.version} not supported`);
  }

  if (message.version === 1) {
    if (typeof message.hash !== 'string' || typeof message.name !== 'string') {
      return new Error('Invalid Flux App Running message for storing');
    }
    const app = {
      name: message.name,
      hash: message.hash,
    };
    appsMessages.push(app);
  }

  if (message.version === 2) {
    if (!message.apps || !Array.isArray(message.apps)) {
      return new Error('Invalid Flux App Running message for storing');
    }
    for (let i = 0; i < message.apps.length; i += 1) {
      const app = message.apps[i];
      appsMessages.push(app);
      if (typeof app.hash !== 'string' || typeof app.name !== 'string') {
        return new Error('Invalid Flux App Running v2 message for storing');
      }
    }
  }

  const validTill = message.broadcastedAt + (125 * 60 * 1000); // 7500 seconds
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid Fluxapprunning message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  let messageNotOk = false;
  for (let i = 0; i < appsMessages.length; i += 1) {
    const app = appsMessages[i];
    const newAppRunningMessage = {
      name: app.name,
      hash: app.hash, // hash of application specifics that are running
      ip: message.ip,
      broadcastedAt: new Date(message.broadcastedAt),
      expireAt: new Date(validTill),
      osUptime: message.osUptime,
      staticIp: message.staticIp,
    };

    // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
    const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const projection = { _id: 0, runningSince: 1 };
    // we already have the exact same data
    // eslint-disable-next-line no-await-in-loop
    const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result && result.broadcastedAt && result.broadcastedAt >= newAppRunningMessage.broadcastedAt) {
      // found a message that was already stored/probably from duplicated message processsed
      messageNotOk = true;
      break;
    }
    if (message.runningSince) {
      newAppRunningMessage.runningSince = new Date(message.runningSince);
    } else if (app.runningSince) {
      newAppRunningMessage.runningSince = new Date(app.runningSince);
    } else if (result && result.runningSince) {
      newAppRunningMessage.runningSince = result.runningSince;
    }
    const queryUpdate = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const update = { $set: newAppRunningMessage };
    const options = {
      upsert: true,
    };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.updateOneInDatabase(database, globalAppsLocations, queryUpdate, update, options);
  }

  if (message.version === 2 && appsMessages.length === 0) {
    const queryFind = { ip: message.ip };
    const projection = { _id: 0, runningSince: 1 };
    // we already have the exact same data
    const result = await dbHelper.findInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result.length > 0) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, queryFind);
    } else {
      return false;
    }
  }

  if (message.version === 1) {
    const queryFind = { name: appsMessages[0].name, ip: message.ip };
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingLocations, queryFind);
  }

  if (messageNotOk) {
    return false;
  }

  // all stored, rebroadcast
  return true;
}

/**
 * To store a message for a installing app.
 * @param {object} message Message.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is old. Throws an error if invalid.
 */
async function storeAppInstallingMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string') {
    return new Error('Invalid Flux App Installing message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Installing message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (5 * 60 * 1000); // 5 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstalling message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingMessage = {
    name: message.name,
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
  const queryFind = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  const queryUpdate = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const update = { $set: newAppInstallingMessage };
  const options = {
    upsert: true,
  };
  // eslint-disable-next-line no-await-in-loop
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingLocations, queryUpdate, update, options);

  // all stored, rebroadcast
  return true;
}

/**
 * To store a message for a app error installing.
 * @param {object} message Message.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is old. Throws an error if invalid.
 */
async function storeAppInstallingErrorMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param hash string
  * @param ip string
  * @param error string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string'
    || typeof message.hash !== 'number' || typeof message.error !== 'string') {
    return new Error('Invalid Flux App Installing Error message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Installing Error message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (60 * 60 * 1000); // 60 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstallingerror message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingErrorMessage = {
    name: message.name,
    hash: message.hash,
    ip: message.ip,
    error: message.error,
    broadcastedAt: new Date(message.broadcastedAt),
    startCacheAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  let queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash, ip: newAppInstallingErrorMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingErrorMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  let update = { $set: newAppInstallingErrorMessage };
  const options = {
    upsert: true,
  };
  // eslint-disable-next-line no-await-in-loop
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update, options);

  queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const results = await dbHelper.countInDatabase(database, globalAppsInstallingErrorsLocations, queryFind);
  if (results >= 5) {
    update = { $set: { startCacheAt: null, expireAt: null } };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.updateInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update);
  }
  // all stored, rebroadcast
  return true;
}

/**
 * To update DB with new node IP that is running app.
 * @param {object} message Message.
 * @returns {boolean} True if message is valid. Returns false if message is old. Throws an error if invalid/wrong properties.
 */
async function storeIPChangedMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param oldIP string
  * @param newIP string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.oldIP !== 'string' || typeof message.newIP !== 'string') {
    return new Error('Invalid Flux IP Changed message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux IP Changed message for storing version ${message.version} not supported`);
  }

  if (!message.oldIP || !message.newIP) {
    return new Error('Invalid Flux IP Changed message oldIP and newIP cannot be empty');
  }

  if (message.oldIP === message.newIP) {
    return new Error(`Invalid Flux IP Changed message oldIP and newIP are the same ${message.newIP}`);
  }

  log.info('New Flux IP Changed message received.');
  log.info(message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < Date.now()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.oldIP };
  const update = { $set: { ip: message.newIP, broadcastedAt: new Date(message.broadcastedAt) } };
  await dbHelper.updateInDatabase(database, globalAppsLocations, query, update);

  // all stored, rebroadcast
  return true;
}

/**
 * To remove from DB that the IP is running the app.
 * @param {object} message Message.
 * @returns {boolean} True if message is valid. Returns false if message is old. Throws an error if invalid/wrong properties.
 */
async function storeAppRemovedMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param ip string
  * @param appName string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.appName !== 'string') {
    return new Error('Invalid Flux App Removed message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Removed message for storing version ${message.version} not supported`);
  }

  if (!message.ip) {
    return new Error('Invalid Flux App Removed message ip cannot be empty');
  }

  if (!message.appName) {
    return new Error('Invalid Flux App Removed message appName cannot be empty');
  }

  log.info('New Flux App Removed message received.');
  log.info(message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < Date.now()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.ip, name: message.appName };
  const projection = {};
  await dbHelper.findOneAndDeleteInDatabase(database, globalAppsLocations, query, projection);

  // all stored, rebroadcast
  return true;
}

/**
 * To request app message.
 * @param {string} hash Message hash.
 */
async function requestAppMessage(hash) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  const message = {
    type: 'fluxapprequest',
    version: 1,
    hash,
  };
  await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(message);
  await serviceHelper.delay(500);
  await fluxCommunicationMessagesSender.broadcastMessageToIncoming(message);
}

/**
 * To request app message.
 * @param {string} apps list of apps, apps[i].hash have the message hash of each app.
 * @param {boolean} incoming If true the message will be asked to a incoming peer, if false to an outgoing peer.
 */
async function requestAppsMessage(apps, incoming) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  const message = {
    type: 'fluxapprequest',
    version: 2,
    hashes: apps.map((a) => a.hash),
  };
  if (incoming) {
    await fluxCommunicationMessagesSender.broadcastMessageToRandomIncoming(message);
  } else {
    await fluxCommunicationMessagesSender.broadcastMessageToRandomOutgoing(message);
  }
}

/**
 * To manually request app message over api
 * @param {req} req api request
 * @param {res} res api response
 */
async function requestAppMessageAPI(req, res) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    let { hash } = req.params;
    hash = hash || req.query.hash;

    if (!hash) {
      throw new Error('No Flux App Hash specified');
    }
    requestAppMessage(hash);
    const resultsResponse = messageHelper.createSuccessMessage(`Application hash ${hash} requested from the network`);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To format app specification object. Checks that all parameters exist and are correct.
 * @param {object} appSpecification App specification.
 * @returns {object} Returns formatted app specification to be stored in global database. Otherwise throws error.
 */
function specificationFormatter(appSpecification) {
  let {
    version,
    name,
    description,
    owner,
    port, // version 1 deprecated
    containerPort, // version 1 deprecated
    compose,
    repotag,
    ports,
    domains,
    enviromentParameters,
    commands,
    containerPorts,
    containerData,
    instances,
    cpu,
    ram,
    hdd,
    tiered,
    contacts,
    geolocation,
    expire,
    nodes,
    staticip,
    enterprise,
  } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter version');
  }
  version = serviceHelper.ensureNumber(version);

  // commons
  if (!name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter name and/or description and/or owner');
  }
  name = serviceHelper.ensureString(name);
  description = serviceHelper.ensureString(description);
  owner = serviceHelper.ensureString(owner);

  // finalised parameters that will get stored in global database
  const appSpecFormatted = {
    version, // integer
    name, // string
    description, // string
    owner, // zelid string
  };

  const correctCompose = [];

  if (version === 1) {
    if (!repotag || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or port and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    repotag = serviceHelper.ensureString(repotag);
    port = serviceHelper.ensureNumber(port);
    containerPort = serviceHelper.ensureNumber(containerPort);
    enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
    const envParamsCorrected = [];
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        envParamsCorrected.push(param);
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    commands = serviceHelper.ensureObject(commands);
    const commandsCorrected = [];
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        const cmm = serviceHelper.ensureString(command);
        commandsCorrected.push(cmm);
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    containerData = serviceHelper.ensureString(containerData);
    cpu = serviceHelper.ensureNumber(cpu);
    ram = serviceHelper.ensureNumber(ram);
    hdd = serviceHelper.ensureNumber(hdd);
    tiered = serviceHelper.ensureBoolean(tiered);
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    // finalised parameters
    appSpecFormatted.repotag = repotag; // string
    appSpecFormatted.port = port; // integer
    appSpecFormatted.enviromentParameters = envParamsCorrected; // array of strings
    appSpecFormatted.commands = commandsCorrected; // array of strings
    appSpecFormatted.containerPort = containerPort; // integer
    appSpecFormatted.containerData = containerData; // string
    appSpecFormatted.cpu = cpu; // float 0.1 step
    appSpecFormatted.ram = ram; // integer 100 step (mb)
    appSpecFormatted.hdd = hdd; // integer 1 step
    appSpecFormatted.tiered = tiered; // boolean

    if (tiered) {
      let {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
        throw new Error('Flux App was requested as tiered setup but specifications are missing');
      }
      cpubasic = serviceHelper.ensureNumber(cpubasic);
      cpusuper = serviceHelper.ensureNumber(cpusuper);
      cpubamf = serviceHelper.ensureNumber(cpubamf);
      rambasic = serviceHelper.ensureNumber(rambasic);
      ramsuper = serviceHelper.ensureNumber(ramsuper);
      rambamf = serviceHelper.ensureNumber(rambamf);
      hddbasic = serviceHelper.ensureNumber(hddbasic);
      hddsuper = serviceHelper.ensureNumber(hddsuper);
      hddbamf = serviceHelper.ensureNumber(hddbamf);

      appSpecFormatted.cpubasic = cpubasic;
      appSpecFormatted.cpusuper = cpusuper;
      appSpecFormatted.cpubamf = cpubamf;
      appSpecFormatted.rambasic = rambasic;
      appSpecFormatted.ramsuper = ramsuper;
      appSpecFormatted.rambamf = rambamf;
      appSpecFormatted.hddbasic = hddbasic;
      appSpecFormatted.hddsuper = hddsuper;
      appSpecFormatted.hddbamf = hddbamf;
    }
  } else if (version <= 3) {
    if (!repotag || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or port and/or domains and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    repotag = serviceHelper.ensureString(repotag);
    ports = serviceHelper.ensureObject(ports);
    const portsCorrect = [];
    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // v2 and v3 have string
        portsCorrect.push(param);
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }
    domains = serviceHelper.ensureObject(domains);
    const domainsCorrect = [];
    if (Array.isArray(domains)) {
      domains.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        domainsCorrect.push(param);
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
    }
    enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
    const envParamsCorrected = [];
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        envParamsCorrected.push(param);
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    commands = serviceHelper.ensureObject(commands);
    const commandsCorrected = [];
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        const cmm = serviceHelper.ensureString(command);
        commandsCorrected.push(cmm);
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    containerPorts = serviceHelper.ensureObject(containerPorts);
    const containerportsCorrect = [];
    if (Array.isArray(containerPorts)) {
      containerPorts.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // next specification fork here we want to do ensureNumber
        containerportsCorrect.push(param);
      });
    } else {
      throw new Error('Container Ports for Flux App are invalid');
    }
    containerData = serviceHelper.ensureString(containerData);
    cpu = serviceHelper.ensureNumber(cpu);
    ram = serviceHelper.ensureNumber(ram);
    hdd = serviceHelper.ensureNumber(hdd);
    tiered = serviceHelper.ensureBoolean(tiered);
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }

    // finalised parameters.
    appSpecFormatted.repotag = repotag; // string
    appSpecFormatted.ports = portsCorrect; // array of integers
    appSpecFormatted.domains = domainsCorrect;
    appSpecFormatted.enviromentParameters = envParamsCorrected; // array of strings
    appSpecFormatted.commands = commandsCorrected; // array of strings
    appSpecFormatted.containerPorts = containerportsCorrect; // array of integers
    appSpecFormatted.containerData = containerData; // string
    appSpecFormatted.cpu = cpu; // float 0.1 step
    appSpecFormatted.ram = ram; // integer 100 step (mb)
    appSpecFormatted.hdd = hdd; // integer 1 step
    appSpecFormatted.tiered = tiered; // boolean

    if (tiered) {
      let {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
        throw new Error('Flux App was requested as tiered setup but specifications are missing');
      }
      cpubasic = serviceHelper.ensureNumber(cpubasic);
      cpusuper = serviceHelper.ensureNumber(cpusuper);
      cpubamf = serviceHelper.ensureNumber(cpubamf);
      rambasic = serviceHelper.ensureNumber(rambasic);
      ramsuper = serviceHelper.ensureNumber(ramsuper);
      rambamf = serviceHelper.ensureNumber(rambamf);
      hddbasic = serviceHelper.ensureNumber(hddbasic);
      hddsuper = serviceHelper.ensureNumber(hddsuper);
      hddbamf = serviceHelper.ensureNumber(hddbamf);

      appSpecFormatted.cpubasic = cpubasic;
      appSpecFormatted.cpusuper = cpusuper;
      appSpecFormatted.cpubamf = cpubamf;
      appSpecFormatted.rambasic = rambasic;
      appSpecFormatted.ramsuper = ramsuper;
      appSpecFormatted.rambamf = rambamf;
      appSpecFormatted.hddbasic = hddbasic;
      appSpecFormatted.hddsuper = hddsuper;
      appSpecFormatted.hddbamf = hddbamf;
    }
  } else { // v4+
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    compose = serviceHelper.ensureObject(compose);
    if (!Array.isArray(compose)) {
      throw new Error('Flux App compose parameter is not valid');
    }
    compose.forEach((appComponent) => {
      const appComponentCorrect = {};
      appComponentCorrect.name = serviceHelper.ensureString(appComponent.name);
      appComponentCorrect.description = serviceHelper.ensureString(appComponent.description);
      appComponentCorrect.repotag = serviceHelper.ensureString(appComponent.repotag);
      appComponentCorrect.ports = serviceHelper.ensureObject(appComponent.ports);
      const portsCorrect = [];
      if (Array.isArray(appComponentCorrect.ports)) {
        appComponentCorrect.ports.forEach((parameter) => {
          const param = serviceHelper.ensureNumber(parameter);
          portsCorrect.push(param);
        });
        appComponentCorrect.ports = portsCorrect;
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.domains = serviceHelper.ensureObject(appComponent.domains);
      const domainsCorect = [];
      if (Array.isArray(appComponentCorrect.domains)) {
        appComponentCorrect.domains.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          domainsCorect.push(param);
        });
        appComponentCorrect.domains = domainsCorect;
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.environmentParameters = serviceHelper.ensureObject(appComponent.environmentParameters);
      const envParamsCorrected = [];
      if (Array.isArray(appComponentCorrect.environmentParameters)) {
        appComponentCorrect.environmentParameters.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          envParamsCorrected.push(param);
        });
        appComponentCorrect.environmentParameters = envParamsCorrected;
      } else {
        throw new Error(`Environmental parameters for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.commands = serviceHelper.ensureObject(appComponent.commands);
      const commandsCorrected = [];
      if (Array.isArray(appComponentCorrect.commands)) {
        appComponentCorrect.commands.forEach((command) => {
          const cmm = serviceHelper.ensureString(command);
          commandsCorrected.push(cmm);
        });
        appComponentCorrect.commands = commandsCorrected;
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      appComponentCorrect.containerPorts = serviceHelper.ensureObject(appComponent.containerPorts);
      const containerportsCorrect = [];
      if (Array.isArray(appComponentCorrect.containerPorts)) {
        appComponentCorrect.containerPorts.forEach((parameter) => {
          const param = serviceHelper.ensureNumber(parameter);
          containerportsCorrect.push(param);
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.containerData = serviceHelper.ensureString(appComponent.containerData);
      appComponentCorrect.cpu = serviceHelper.ensureNumber(appComponent.cpu);
      appComponentCorrect.ram = serviceHelper.ensureNumber(appComponent.ram);
      appComponentCorrect.hdd = serviceHelper.ensureNumber(appComponent.hdd);

      if (version <= 7) {
        appComponentCorrect.tiered = appComponent.tiered;
        if (typeof appComponentCorrect.tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }
        if (appComponentCorrect.tiered) {
          let {
            cpubasic,
            cpusuper,
            cpubamf,
            rambasic,
            ramsuper,
            rambamf,
            hddbasic,
            hddsuper,
            hddbamf,
          } = appComponent;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error(`Flux App component ${appComponent.name} was requested as tiered setup but specifications are missing`);
          }
          cpubasic = serviceHelper.ensureNumber(cpubasic);
          cpusuper = serviceHelper.ensureNumber(cpusuper);
          cpubamf = serviceHelper.ensureNumber(cpubamf);
          rambasic = serviceHelper.ensureNumber(rambasic);
          ramsuper = serviceHelper.ensureNumber(ramsuper);
          rambamf = serviceHelper.ensureNumber(rambamf);
          hddbasic = serviceHelper.ensureNumber(hddbasic);
          hddsuper = serviceHelper.ensureNumber(hddsuper);
          hddbamf = serviceHelper.ensureNumber(hddbamf);

          appComponentCorrect.cpubasic = cpubasic;
          appComponentCorrect.cpusuper = cpusuper;
          appComponentCorrect.cpubamf = cpubamf;
          appComponentCorrect.rambasic = rambasic;
          appComponentCorrect.ramsuper = ramsuper;
          appComponentCorrect.rambamf = rambamf;
          appComponentCorrect.hddbasic = hddbasic;
          appComponentCorrect.hddsuper = hddsuper;
          appComponentCorrect.hddbamf = hddbamf;
        }
      }

      if (version >= 7) {
        appComponentCorrect.repoauth = serviceHelper.ensureString(appComponent.repoauth);
        if (version === 7) {
          appComponentCorrect.secrets = serviceHelper.ensureString(appComponent.secrets);
        }
      }
      correctCompose.push(appComponentCorrect);
    });
    appSpecFormatted.compose = correctCompose;
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter instances');
    }
    instances = serviceHelper.ensureNumber(instances);
    if (typeof instances !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(instances) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
    appSpecFormatted.instances = instances;
  }

  if (version >= 5) {
    if (!contacts || !geolocation) { // can be empty array for no contact or no geolocation requirements
      throw new Error('Missing Flux App specification parameter contacts and/or geolocation');
    }
    contacts = serviceHelper.ensureObject(contacts);
    const contactsCorrect = [];
    if (Array.isArray(contacts)) {
      contacts.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        contactsCorrect.push(param);
      });
    } else {
      throw new Error('Contacts for Flux App are invalid');
    }
    appSpecFormatted.contacts = contactsCorrect;

    geolocation = serviceHelper.ensureObject(geolocation);
    const geolocationCorrect = [];
    if (Array.isArray(geolocation)) {
      geolocation.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        geolocationCorrect.push(param);
      });
    } else {
      throw new Error('Geolocation for Flux App is invalid');
    }
    appSpecFormatted.geolocation = geolocationCorrect;
  }

  if (version >= 6) {
    if (!expire) {
      throw new Error('Missing Flux App specification parameter expire');
    }
    expire = serviceHelper.ensureNumber(expire);
    if (typeof expire !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    appSpecFormatted.expire = expire;
  }

  if (version >= 7) {
    if (!nodes) { // can be empty array for no nodes set
      throw new Error('Missing Flux App specification parameter nodes');
    }
    nodes = serviceHelper.ensureObject(nodes);
    const nodesCorrect = [];
    if (Array.isArray(nodes)) {
      nodes.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        nodesCorrect.push(param);
      });
    } else {
      throw new Error('Nodes for Flux App are invalid');
    }
    appSpecFormatted.nodes = nodesCorrect;

    staticip = serviceHelper.ensureBoolean(staticip);
    if (typeof staticip !== 'boolean') {
      throw new Error('Invalid staticip specification. Only boolean as true or false allowed.');
    }
    appSpecFormatted.staticip = staticip;
  }

  if (version >= 8) {
    if (enterprise) {
      enterprise = serviceHelper.ensureString(enterprise);
    }

    appSpecFormatted.enterprise = enterprise;
  }

  return appSpecFormatted;
}

/**
 * Decrypts content with aes key
 * @param {string} appName application name.
 * @param {String} base64NonceCiphertextTag base64 encoded encrypted data
 * @param {String} base64AesKey base64 encoded AesKey
 * @returns {any} decrypted data
 */
function decryptWithAesSession(appName, base64NonceCiphertextTag, base64AesKey) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }

  try {
    const key = Buffer.from(base64AesKey, 'base64');
    const nonceCiphertextTag = Buffer.from(base64NonceCiphertextTag, 'base64');

    const nonce = nonceCiphertextTag.subarray(0, 12);
    const ciphertext = nonceCiphertextTag.subarray(12, -16);
    const tag = nonceCiphertextTag.subarray(-16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);

    const decrypted = decipher.update(ciphertext, '', 'utf8') + decipher.final('utf8');

    return decrypted;
  } catch (error) {
    log.error(`Error decrypting ${appName}`);
    throw error;
  }
}
/**
 * Encrypts content with aes key
 * @param {String} appName application name
 * @param {any} dataToEncrypt data to encrypt
 * @param {String} base64AesKey encoded AES key
 * @returns {String} Return base64 encrypted nonce + cyphertext + tag
 */
function encryptWithAesSession(appName, dataToEncrypt, base64AesKey) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  try {
    const key = Buffer.from(base64AesKey, 'base64');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

    const encryptedStart = cipher.update(dataToEncrypt, 'utf8');
    const encryptedEnd = cipher.final();

    const nonceCyphertextTag = Buffer.concat([
      nonce,
      encryptedStart,
      encryptedEnd,
      cipher.getAuthTag(),
    ]);

    const base64NonceCyphertextTag = nonceCyphertextTag.toString('base64');
    return base64NonceCyphertextTag;
  } catch (error) {
    log.error(`Error encrypting ${appName}`);
    throw error;
  }
}

/**
 * Decrypts aes key
 * @param {string} appName application name.
 * @param {integer} daemonHeight daemon block height.
 * @param {string} owner original owner of the application
 * @param {string} enterpriseKey base64 RSA encrypted AES key used to encrypt enterprise app data
 * @returns {object} Return enterprise object decrypted.
 */
async function decryptAesKeyWithRsaKey(appName, daemonHeight, enterpriseKey, owner = null) {
  const block = daemonHeight;
  let appOwner = owner;

  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  if (!enterpriseKey) {
    throw new Error('enterpriseKey is mandatory for enterprise Apps.');
  }
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appsQuery = null;
  if (!appOwner) {
    log.info(`Searching register permanent messages for ${appName} to get registration message`);
    appsQuery = {
      'appSpecifications.name': appName,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    appOwner = lastAppRegistration.appSpecifications.owner;
  }
  const inputData = JSON.stringify({
    fluxID: appOwner,
    appName,
    message: enterpriseKey,
    blockHeight: block,
  });
  const dataReturned = await benchmarkService.decryptRSAMessage(inputData);
  const { status, data } = dataReturned;
  if (status === 'success') {
    const dataParsed = JSON.parse(data);
    const base64AesKey = dataParsed.status === 'ok' ? dataParsed.message : null;
    if (base64AesKey) return base64AesKey;

    throw new Error('Error decrypting AES key.');
  } else {
    throw new Error('Error getting decrypted AES key.');
  }
}

/**
 * Decrypts app specs from api request. It is expected that the caller of this
 * endpoint has aes-256-gcm encrypted the app specs with a random aes key,
 * encrypted with the RSA public key received via prior api call.
 *
 * The enterpise field is in this format:
 * base64(rsa encrypted aes key + nonce + aes-256-gcm(base64(json(enterprise specs))) + authTag)
 *
 * We do this so that we don't have to double JSON encode, and we have the
 * nonce + cyphertext + tag all in one entry
 *
 * The enterpriseKey is in this format:
 * base64(rsa(base64(aes key bytes))))
 *
 * We base64 encode the key so that were not passing around raw bytes
 *
 * @param {string} base64Encrypted enterprise encrypted content (decrypted is a JSON string)
 * @param {string} appName application name
 * @param {integer} daemonHeight daemon block height
 * @param {string} owner original owner of the application
 * @returns {Promise<object>} Return enterprise object decrypted.
 */
async function decryptEnterpriseFromSession(base64Encrypted, appName, daemonHeight, owner = null) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }

  const enterpriseBuf = Buffer.from(base64Encrypted, 'base64');
  const aesKeyEncrypted = enterpriseBuf.subarray(0, 256);
  const nonceCiphertextTag = enterpriseBuf.subarray(256);

  // we encode this as we are passing it as an api call
  const base64EncryptedAesKey = aesKeyEncrypted.toString('base64');

  const base64AesKey = await decryptAesKeyWithRsaKey(
    appName,
    daemonHeight,
    base64EncryptedAesKey,
    owner,
  );

  const jsonEnterprise = decryptWithAesSession(
    appName,
    nonceCiphertextTag,
    base64AesKey,
  );

  const decryptedEnterprise = JSON.parse(jsonEnterprise);

  if (decryptedEnterprise) {
    return decryptedEnterprise;
  }
  throw new Error('Error decrypting enterprise object.');
}

/**
 * Decrypts app specs if they are encrypted
 * @param {object} appSpec application specifications.
 * @param {integer} daemonHeight daemon block height.
 * @param {{daemonHeight?: Number, owner?: string}} options daemonHeight - block height  \
 *    owner - the application owner
 * @returns {Promise<object>} Return appSpecs decrypted if it is enterprise.
 */
async function checkAndDecryptAppSpecs(appSpec, options = {}) {
  if (!appSpec || appSpec.version < 8 || !appSpec.enterprise) {
    return appSpec;
  }

  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }

  // move to structuredClone when we are at > nodeJS 17.0.0
  // we do this so we can have a copy of both formatted and decrypted
  const appSpecs = JSON.parse(JSON.stringify(appSpec));

  let daemonHeight = options.daemonHeight || null;
  let appOwner = options.owner || null;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appsQuery = null;

  if (!appOwner) {
    log.info(`Searching register permanent messages for ${appSpecs.name} to get registration message`);
    appsQuery = {
      'appSpecifications.name': appSpecs.name,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    if (permanentAppMessage.length > 0) {
      const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
      appOwner = lastAppRegistration.owner;
    } else {
      appOwner = appSpec.owner;
    }
  }

  if (!daemonHeight) {
    log.info(`Searching register permanent messages for ${appSpecs.name} to get latest update`);
    appsQuery = {
      'appSpecifications.name': appSpecs.name,
    };
    const allPermanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastUpdate = allPermanentAppMessage[allPermanentAppMessage.length - 1];

    if (!lastUpdate) {
      throw new Error(`App: ${appSpecs.name} does not exist in global messages`);
    }

    daemonHeight = lastUpdate.height;
  }

  const enterprise = await decryptEnterpriseFromSession(
    appSpecs.enterprise,
    appSpecs.name,
    daemonHeight,
    appSpecs.owner,
  );

  appSpecs.contacts = enterprise.contacts;
  appSpecs.compose = enterprise.compose;

  return appSpecs;
}

/**
 * Encrypts app specs
 * @param {object} enterprise content to be encrypted.
 * @param {string} appName name of the app.
 * @param {integer} daemonHeight daemon block height.
 * @param {string} owner original owner of the application.
 * @returns {Promise<string>} Return enteprise content encrypted.
 */
async function encryptEnterpriseWithAes(enterprise, appName, daemonHeight = null, owner = null) {
  let block = daemonHeight;
  let appOwner = owner;

  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appsQuery = null;
  if (!appOwner) {
    log.info(`Searching register permanent messages for ${appName} to get registration message`);
    appsQuery = {
      'appSpecifications.name': appName,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    appOwner = lastAppRegistration.owner;
  }
  if (!block) {
    log.info(`Searching register permanent messages for ${appName} to get latest update`);
    appsQuery = {
      'appSpecifications.name': appName,
    };
    const allPermanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastUpdate = allPermanentAppMessage[allPermanentAppMessage.length - 1];
    block = lastUpdate.height;
  }

  const jsonEnterprise = JSON.stringify(enterprise);
  const base64JsonEnterprise = Buffer.from(jsonEnterprise).toString('base64');

  const inputData = JSON.stringify({
    fluxID: appOwner,
    appName,
    message: base64JsonEnterprise,
    blockHeight: block,
  });
  const dataReturned = await benchmarkService.encryptMessage(inputData);
  const { status, data } = dataReturned;
  if (status === 'success') {
    const dataParsed = JSON.parse(data);
    const newEnterprise = status === 'success' && dataParsed.status === 'ok' ? dataParsed.message : null;
    if (newEnterprise) {
      return newEnterprise;
    }
    throw new Error('Error decrypting applications specifications.');
  } else {
    throw new Error('Error getting public key to encrypt app enterprise content.');
  }
}

/**
 * Encrypts app specs for api request
 * @param {object} appSpec App spec that needs contacts / compose encrypted
* @param {integer} daemonHeight daemon block height.
 * @param {string} enterpriseKey enterprise key encrypted used to encrypt encrypt enterprise app.
 * @returns {Promise<object>} Return app specs copy with enterprise object encrypted (and sensitive content removed)
 */
async function encryptEnterpriseFromSession(appSpec, daemonHeight, enterpriseKey) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  if (!enterpriseKey) {
    throw new Error('enterpriseKey is mandatory for enterprise Apps.');
  }

  const appName = appSpec.name;

  const enterpriseSpec = {
    contacts: appSpec.contacts,
    compose: appSpec.compose,
  };

  const encoded = JSON.stringify(enterpriseSpec);

  const base64AesKey = await decryptAesKeyWithRsaKey(appName, daemonHeight, enterpriseKey);
  const encryptedEnterprise = encryptWithAesSession(appSpec.enterprise, encoded, base64AesKey);
  if (encryptedEnterprise) {
    return encryptedEnterprise;
  }
  throw new Error('Error encrypting enterprise object.');
}

/**
 * To register an app globally via API. Performs various checks before the app can be registered. Only accessible by users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function registerAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // first check if this node is available for application registration
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application registration');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, type, version, timestamp and signature are provided.');
      }
      if (messageType !== 'zelappregister' && messageType !== 'fluxappregister') {
        throw new Error('Invalid type of message');
      }
      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }
      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? specificationFormatter(appSpecification)
        : appSpecFormatted;

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await verifyAppMessageSignature(messageType, typeVersion, toVerify, timestamp, signature);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      // request app message is quite slow and from performance testing message will appear roughly 5 seconds after ask
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await checkAppTemporaryMessageExistence(messageHASH); // Cumulus measurement: after roughly 8 seconds here
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed. Cumulus measurement: Approx 5-6 seconds
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to register application on the network. Try again later.');
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * To update an app globally via API. Performs various checks before the app can be updated. Price handled in UI and available in API. Only accessible by users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function updateAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // first check if this node is available for application update
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application update');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application update');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and ports HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, timestamp, type, version and signature are provided.');
      }
      if (messageType !== 'zelappupdate' && messageType !== 'fluxappupdate') {
        throw new Error('Invalid type of message');
      }
      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }
      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // verify that app exists, does not change repotag and is signed by app owner.
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (!appInfo) {
        throw new Error('Flux App update received but application to update does not exist!');
      }
      if (appInfo.repotag !== appSpecFormatted.repotag) { // this is OK. <= v3 cannot change, v4 can but does not have this in specifications as its compose
        throw new Error('Flux App update of repotag is not allowed');
      }
      const appOwner = appInfo.owner; // ensure previous app owner is signing this message

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? specificationFormatter(appSpecification)
        : appSpecFormatted;

      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(messageType, typeVersion, toVerify, timestamp, signature, appOwner, daemonHeight);

      // verify that app exists, does not change repotag (for v1-v3), does not change name and does not change component names
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await checkAppTemporaryMessageExistence(messageHASH);
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed.
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to update application on the network. Try again later.');
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * To install any app locally Checks that the app is installable on the machine (i.e. the machine has a suitable space. Only accessible by admins and Flux team members.
 * Possible to install any locally present app and currently present global app
 * This has intentionally less check then automated global installation. Node op should know what is doing, great for testing.
 * @param {object} req Request.
 * @param {object} res Response.
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
* Test will be used on UI for app owners to test their app specifications are good and the app installs and start
 * @param {object} req Request.
 * @param {object} res Response.
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
      appSpecifications.name += 'Test';
      res.setHeader('Content-Type', 'application/json');
      await registerAppLocally(appSpecifications, undefined, res, true); // can throw
      removeAppLocally(appSpecifications.name, null, true, false, false);
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
  } finally {
    res.end();
  }
}

/**
 * To store a permanent message for an app.
 * @param {object} message Message.
 * @returns True if no error is thrown.
 */
async function storeAppPermanentMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  * @param txid string
  * @param height number
  * @param valueSat number
  */
  if (!message || !message.appSpecifications || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.appSpecifications !== 'object' || typeof message.signature !== 'string'
    || typeof message.timestamp !== 'number' || typeof message.hash !== 'string' || typeof message.txid !== 'string' || typeof message.height !== 'number' || typeof message.valueSat !== 'number') {
    throw new Error('Invalid Flux App message for storing');
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  await dbHelper.insertOneToDatabase(database, globalAppsMessages, message).catch((error) => {
    log.error(error);
    throw error;
  });
  return true;
}

/**
 * To update app specifications.
 * @param {object} appSpecs App specifications.
 */
async function updateAppSpecifications(appSpecs) {
  try {
    // appSpecs: {
    //   version: 3,
    //   name: 'FoldingAtHomeB',
    //   description: 'Folding @ Home is cool :)',
    //   repotag: 'yurinnick/folding-at-home:latest',
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    //   ports: '[30001]',
    //   containerPorts: '[7396]',
    //   domains: '[""]',
    //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
    //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
    //   containerData: '/config',
    //   cpu: 0.5,
    //   ram: 500,
    //   hdd: 5,
    //   tiered: true,
    //   cpubasic: 0.5,
    //   rambasic: 500,
    //   hddbasic: 5,
    //   cpusuper: 1,
    //   ramsuper: 1000,
    //   hddsuper: 5,
    //   cpubamf: 2,
    //   rambamf: 2000,
    //   hddbamf: 5,
    //   instances: 10, // version 3 fork
    //   hash: hash of message that has these paramenters,
    //   height: height containing the message
    // };
    // const appSpecs = {
    //   version: 4, // int
    //   name: 'FoldingAtHomeB', // string
    //   description: 'Folding @ Home is cool :)', // string
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', // string
    //   compose: [ // array of max 5 objects of following specs
    //     {
    //       name: 'Daemon', // string
    //       description: 'Main ddaemon for foldingAtHome', // string
    //       repotag: 'yurinnick/folding-at-home:latest',
    //       ports: '[30001]', // array of ints
    //       containerPorts: '[7396]', // array of ints
    //       domains: '[""]', // array of strings
    //       environmentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // array of strings
    //       commands: '["--allow","0/0","--web-allow","0/0"]', // array of strings
    //       containerData: '/config', // string
    //       cpu: 0.5, // float
    //       ram: 500, // int
    //       hdd: 5, // int
    //       tiered: true, // bool
    //       cpubasic: 0.5, // float
    //       rambasic: 500, // int
    //       hddbasic: 5, // int
    //       cpusuper: 1, // float
    //       ramsuper: 1000, // int
    //       hddsuper: 5, // int
    //       cpubamf: 2, // float
    //       rambamf: 2000, // int
    //       hddbamf: 5, // int
    //     },
    //   ],
    //   instances: 10, // int
    // };
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: appSpecs.name };
    const update = { $set: appSpecs };
    const options = {
      upsert: true,
    };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    if (appInfo) {
      if (appInfo.height < appSpecs.height) {
        await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
      }
    } else {
      await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
    const queryDeleteAppErrors = { name: appSpecs.name };
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
  } catch (error) {
    // retry
    log.error(error);
    await serviceHelper.delay(60 * 1000);
    updateAppSpecifications(appSpecs);
  }
}

/**
 * To update app specifications for rescan/reindex.
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True.
 */
async function updateAppSpecsForRescanReindex(appSpecs) {
  // appSpecs: {
  //   version: 3,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]',
  //   containerPorts: '[7396]',
  //   domains: '[""]',
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   instances: 10, // version 3 fork
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: appSpecs.name };
  const update = { $set: appSpecs };
  const options = {
    upsert: true,
  };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (appInfo) {
    if (appInfo.height < appSpecs.height) {
      await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
  } else {
    await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
  }
  return true;
}

/**
 * To update the database that an app hash has a message.
 * @param {object} hash Hash object containing app information.
 * @returns {boolean} True.
 */
async function appHashHasMessage(hash) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { message: true, messageNotFound: false } };
  const options = {};
  await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
}

/**
 * To update the database that an app hash has a message not found on network.
 * @param {object} hash Hash object containing app information.
 * @returns {boolean} True.
 */
async function appHashHasMessageNotFound(hash) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { messageNotFound: true } };
  const options = {};
  await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
}

/**
 * To check and request an app. Handles fluxappregister type and fluxappupdate type.
 * Verification of specification was already done except the price which is done here
 * @param {object} hash Hash object containing app information.
 * @param {string} txid Transaction ID.
 * @param {number} height Block height.
 * @param {number} valueSat Satoshi denomination (100 millionth of 1 Flux).
 * @param {number} i Defaults to value of 0.
 * @returns {boolean} Return true if app message is already present otherwise else.
 */
async function checkAndRequestApp(hash, txid, height, valueSat, i = 0) {
  try {
    if (height < config.fluxapps.epochstart) { // do not request testing apps
      return false;
    }
    const appMessageExists = await checkAppMessageExistence(hash);
    if (appMessageExists === false) { // otherwise do nothing
      // we surely do not have that message in permanent storaage.
      // check temporary message storage
      // if we have it in temporary storage, get the temporary message
      const tempMessage = await checkAppTemporaryMessageExistence(hash);
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const specifications = tempMessage.appSpecifications || tempMessage.zelAppSpecifications;
        // temp message means its all ok. store it as permanent app message
        const permanentAppMessage = {
          type: tempMessage.type,
          version: tempMessage.version,
          appSpecifications: specifications,
          hash: tempMessage.hash,
          timestamp: tempMessage.timestamp,
          signature: tempMessage.signature,
          txid: serviceHelper.ensureString(txid),
          height: serviceHelper.ensureNumber(height),
          valueSat: serviceHelper.ensureNumber(valueSat),
        };
        await storeAppPermanentMessage(permanentAppMessage);
        // await update zelapphashes that we already have it stored
        await appHashHasMessage(hash);

        const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
        const daemonHeight = syncStatus.data.height;
        const expire = specifications.expire || 22000;
        if (height + expire > daemonHeight) {
          // we only do this validations if the app can still be currently running to insert it or update it in globalappspecifications
          const appPrices = await getChainParamsPriceUpdates();
          const intervals = appPrices.filter((interval) => interval.height < height);
          const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
          if (tempMessage.type === 'zelappregister' || tempMessage.type === 'fluxappregister') {
            // check if value is optimal or higher
            let appPrice = await appPricePerMonth(specifications, height, appPrices);
            const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
            const expireIn = specifications.expire || defaultExpire;
            // app prices are ceiled to highest 0.01
            const multiplier = expireIn / defaultExpire;
            appPrice *= multiplier;
            appPrice = Math.ceil(appPrice * 100) / 100;
            if (appPrice < priceSpecifications.minPrice) {
              appPrice = priceSpecifications.minPrice;
            }
            if (valueSat >= appPrice * 1e8) {
              const updateForSpecifications = permanentAppMessage.appSpecifications;
              updateForSpecifications.hash = permanentAppMessage.hash;
              updateForSpecifications.height = permanentAppMessage.height;
              // object of appSpecifications extended for hash and height
              await updateAppSpecifications(updateForSpecifications);
              // every time we ask for a missing app message that is a appregister call after expireGlobalApplications to make sure we don't have on
            } else {
              log.warn(`Apps message ${permanentAppMessage.hash} is underpaid ${valueSat} < ${appPrice * 1e8} - priceSpecs ${JSON.stringify(priceSpecifications)} - specs ${JSON.stringify(specifications)}`);
            }
          } else if (tempMessage.type === 'zelappupdate' || tempMessage.type === 'fluxappupdate') {
            // appSpecifications.name as identifier
            const db = dbHelper.databaseConnection();
            const database = db.db(config.database.appsglobal.database);
            const projection = {
              projection: {
                _id: 0,
              },
            };
            // we may not have the application in global apps. This can happen when we receive the message after the app has already expired AND we need to get message right before our message. Thus using messages system that is accurate
            const appsQuery = {
              'appSpecifications.name': specifications.name,
            };
            const findPermAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
            let latestPermanentRegistrationMessage;
            findPermAppMessage.forEach((foundMessage) => {
              // has to be registration message
              if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
                if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= tempMessage.timestamp) { // no message and found message is not newer than our message
                  latestPermanentRegistrationMessage = foundMessage;
                } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                  if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                    latestPermanentRegistrationMessage = foundMessage;
                  }
                }
              }
            });
            // some early app have zelAppSepcifications
            const appsQueryB = {
              'zelAppSpecifications.name': specifications.name,
            };
            const findPermAppMessageB = await dbHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
            findPermAppMessageB.forEach((foundMessage) => {
              // has to be registration message
              if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
                if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= tempMessage.timestamp) { // no message and found message is not newer than our message
                  latestPermanentRegistrationMessage = foundMessage;
                } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                  if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                    latestPermanentRegistrationMessage = foundMessage;
                  }
                }
              }
            });
            const messageInfo = latestPermanentRegistrationMessage;
            if (!messageInfo) {
              log.error(`Last permanent message for ${specifications.name} not found`);
              return true;
            }
            const previousSpecs = messageInfo.appSpecifications || messageInfo.zelAppSpecifications;
            // here comparison of height differences and specifications
            // price shall be price for standard registration plus minus already paid price according to old specifics. height remains height valid for 22000 blocks
            let appPrice = await appPricePerMonth(specifications, height, appPrices);
            let previousSpecsPrice = await appPricePerMonth(previousSpecs, messageInfo.height || height, appPrices);
            const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
            const currentExpireIn = specifications.expire || defaultExpire;
            const previousExpireIn = previousSpecs.expire || defaultExpire;
            // app prices are ceiled to highest 0.01
            const multiplierCurrent = currentExpireIn / defaultExpire;
            appPrice *= multiplierCurrent;
            appPrice = Math.ceil(appPrice * 100) / 100;
            const multiplierPrevious = previousExpireIn / defaultExpire;
            previousSpecsPrice *= multiplierPrevious;
            previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;
            // what is the height difference
            const heightDifference = permanentAppMessage.height - messageInfo.height;
            // currentExpireIn is always higher than heightDifference
            const perc = (previousExpireIn - heightDifference) / previousExpireIn; // how much of previous specs was not used yet
            let actualPriceToPay = appPrice * 0.9;
            if (perc > 0) {
              actualPriceToPay = (appPrice - (perc * previousSpecsPrice)) * 0.9; // discount for missing heights. Allow 90%
            }
            actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
            if (actualPriceToPay < priceSpecifications.minPrice) {
              actualPriceToPay = priceSpecifications.minPrice;
            }
            if (valueSat >= actualPriceToPay * 1e8) {
              const updateForSpecifications = permanentAppMessage.appSpecifications;
              updateForSpecifications.hash = permanentAppMessage.hash;
              updateForSpecifications.height = permanentAppMessage.height;
              // object of appSpecifications extended for hash and height
              // do not await this
              updateAppSpecifications(updateForSpecifications);
            } else {
              log.warn(`Apps message ${permanentAppMessage.hash} is underpaid ${valueSat} < ${appPrice * 1e8}`);
            }
          }
        }
        return true;
      }
      if (i < 2) {
        // request the message and broadcast the message further to our connected peers.
        // rerun this after 1 min delay
        // We ask to the connected nodes 2 times in 1 minute interval for the app message, if connected nodes don't
        // have the app message we will ask for it again when continuousFluxAppHashesCheck executes again.
        // in total we ask to the connected nodes 10 (30m interval) x 2 (1m interval) = 20 times before apphash is marked as not found
        await requestAppMessage(hash);
        await serviceHelper.delay(60 * 1000);
        return checkAndRequestApp(hash, txid, height, valueSat, i + 1);
        // additional requesting of missing app messages is done on rescans
      }
      return false;
    }
    // update apphashes that we already have it stored
    await appHashHasMessage(hash);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To check and request an app. Handles fluxappregister type and fluxappupdate type.
 * Verification of specification was already done except the price which is done here
 * @param {object} apps array list with list of apps that are missing.
 * @param {boolean} incoming If true the message will be asked to a incoming peer, if false to an outgoing peer.
 * @param {number} i Defaults to value of 1.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkAndRequestMultipleApps(apps, incoming = false, i = 1) {
  try {
    const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
    if (numberOfPeers < 12) {
      log.info('checkAndRequestMultipleApps - Not enough connected peers to request missing Flux App messages');
      return;
    }
    await requestAppsMessage(apps, incoming);
    await serviceHelper.delay(30 * 1000);
    const appsToRemove = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      const messageReceived = await checkAndRequestApp(app.hash, app.txid, app.height, app.value, 2);
      if (messageReceived) {
        appsToRemove.push(app);
      }
    }
    apps.filter((item) => !appsToRemove.includes(item));
    if (apps.length > 0 && i < 5) {
      await checkAndRequestMultipleApps(apps, i % 2 === 0, i + 1);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To check Docker accessibility. Only accessible by users.
 *
 * This function no longer makes sense since it's possible to use auth.
 * It's also not used anywhere (it's referenced in appsService HomeUI but not used)
 *
 * Schedule to remove
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function checkDockerAccessibility(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }
      // check repotag if available for download
      const processedBody = serviceHelper.ensureObject(body);

      if (!processedBody.repotag) {
        throw new Error('No repotag specifiec');
      }

      const message = messageHelper.createSuccessMessage('deprecated');
      // await verifyRepository(processedBody.repotag);
      // const message = messageHelper.createSuccessMessage('Repotag is accessible');
      return res.json(message);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

/**
 * To get registration information (Flux apps).
 * @param {object} req Request.
 * @param {object} res Response.
 */
function registrationInformation(req, res) {
  try {
    const data = config.fluxapps;
    const response = messageHelper.createDataMessage(data);
    res.json(response);
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
 * To drop global apps information and iterate over all global apps messages and reconstruct the global apps information. Further creates database indexes.
 * @returns {boolean} True or thorws an error.
 */
let reindexRunning = false;
async function reindexGlobalAppsInformation() {
  try {
    if (reindexRunning) {
      return 'Previous app reindex not yet finished. Skipping.';
    }
    reindexRunning = true;
    log.info('Reindexing global application list');
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppsInformation).createIndex({ name: 1 }, { name: 'query for getting zelapp based on zelapp specs name' });
    await database.collection(globalAppsInformation).createIndex({ owner: 1 }, { name: 'query for getting zelapp based on zelapp specs owner' });
    await database.collection(globalAppsInformation).createIndex({ repotag: 1 }, { name: 'query for getting zelapp based on image' });
    await database.collection(globalAppsInformation).createIndex({ height: 1 }, { name: 'query for getting zelapp based on last height update' }); // we need to know the height of app adjustment
    await database.collection(globalAppsInformation).createIndex({ hash: 1 }, { name: 'query for getting zelapp based on last hash' }); // we need to know the hash of the last message update which is the true identifier
    const query = {};
    const projection = { projection: { _id: 0 }, sort: { height: 1 } }; // sort from oldest to newest
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.appSpecifications || message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateAppSpecsForRescanReindex(updateForSpecifications);
    }
    log.info('Reindexing of global application list finished. Starting expiring global apps.');
    // eslint-disable-next-line no-use-before-define
    await expireGlobalApplications();
    log.info('Expiration of global application list finished. Done.');
    reindexRunning = false;
    return true;
  } catch (error) {
    reindexRunning = false;
    log.error(error);
    throw error;
  }
}

/**
 * To drop information about running apps and rebuild indexes.
 * @returns {boolean} True or thorws an error.
 */
async function reindexGlobalAppsLocation() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsLocations).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppsLocations).createIndex({ name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
    await database.collection(globalAppsLocations).createIndex({ hash: 1 }, { name: 'query for getting zelapp location based on zelapp hash' });
    await database.collection(globalAppsLocations).createIndex({ ip: 1 }, { name: 'query for getting zelapp location based on ip' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting app based on ip and name' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1, broadcastedAt: 1 }, { name: 'query for getting app to ensure we possess a message' });
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To iterate over all global apps messages and update global apps information database.
 * @param {number} height Defaults to value of 0.
 * @param {boolean} removeLastInformation Defaults to false.
 * @returns {boolean} True or thorws an error.
 */
async function rescanGlobalAppsInformation(height = 0, removeLastInformation = false) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    const query = { height: { $gte: height } };
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);

    if (removeLastInformation === true) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsInformation, query);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.appSpecifications || message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateAppSpecsForRescanReindex(updateForSpecifications);
    }
    // eslint-disable-next-line no-use-before-define
    expireGlobalApplications();
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To reindex global apps location via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsLocation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
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
 * To reindex global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsInformation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
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
 * To rescan global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      let { removelastinformation } = req.params;
      removelastinformation = removelastinformation || req.query.removelastinformation || false;
      removelastinformation = serviceHelper.ensureBoolean(removelastinformation);
      await rescanGlobalAppsInformation(blockheight, removelastinformation);
      const message = messageHelper.createSuccessMessage('Rescan successfull');
      res.json(message);
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
 * Check if we are misssing over 95% of the app hashes and in that case, get from one of the peers the permanentappmessages and process them if it was messages received
 */
let checkAndSyncAppHashesWasEverExecuted = false;
async function checkAndSyncAppHashes() {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    // get flux app hashes that do not have a message;
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        message: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const numberOfMissingApps = results.filter((app) => app.message === false).length;
    if (numberOfMissingApps > results.length * 0.95) {
      let finished = false;
      let i = 0;
      while (!finished && i <= 5) {
        i += 1;
        const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
        let axiosConfig = {
          timeout: 5000,
        };
        log.info(`checkAndSyncAppHashes - Getting explorer sync status from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/explorer/issynced`, axiosConfig).catch((error) => log.error(error));
        if (!response || !response.data || response.data.status !== 'success') {
          log.info(`checkAndSyncAppHashes - Failed to get explorer sync status from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!response.data.data) {
          log.info(`checkAndSyncAppHashes - Explorer is not synced on ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`checkAndSyncAppHashes - Explorer is synced on ${client.ip}:${client.port}`);
        axiosConfig = {
          timeout: 120000,
        };
        log.info(`checkAndSyncAppHashes - Getting permanent app messages from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const appsResponse = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/apps/permanentmessages`, axiosConfig).catch((error) => log.error(error));
        if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
          log.info(`checkAndSyncAppHashes - Failed to get permanent app messages from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        const apps = appsResponse.data.data;
        log.info(`checkAndSyncAppHashes - Will process ${apps.length} apps messages`);
        // sort it by height, so we process oldest messages first
        apps.sort((a, b) => a.height - b.height);

        // because there are broken nodes on the network, we need to temporarily skip
        // any apps that have null for valueSat.
        const filteredApps = apps.filter((app) => app.valueSat !== null);

        let y = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const appMessage of filteredApps) {
          y += 1;
          try {
            // eslint-disable-next-line no-await-in-loop
            await storeAppTemporaryMessage(appMessage, true);
            // eslint-disable-next-line no-await-in-loop
            await checkAndRequestApp(appMessage.hash, appMessage.txid, appMessage.height, appMessage.valueSat, 2);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(50);
          } catch (error) {
            log.error(error);
          }
          if (y % 500 === 0) {
            log.info(`checkAndSyncAppHashes - ${y} were already processed`);
          }
        }
        finished = true;
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        await expireGlobalApplications();
        log.info('checkAndSyncAppHashes - Process finished');
      }
    }
    checkAndSyncAppHashesWasEverExecuted = true;
  } catch (error) {
    log.error(error);
    checkAndSyncAppHashesWasEverExecuted = true;
  }
}

/**
 * To perform continuous checks for Flux app hashes that don't have a message.
 */
let continuousFluxAppHashesCheckRunning = false;
let firstContinuousFluxAppHashesCheckRun = true;
async function continuousFluxAppHashesCheck(force = false) {
  try {
    if (continuousFluxAppHashesCheckRunning) {
      return;
    }
    log.info('Requesting missing Flux App messages');
    continuousFluxAppHashesCheckRunning = true;
    const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
    if (numberOfPeers < 12) {
      log.info('Not enough connected peers to request missing Flux App messages');
      continuousFluxAppHashesCheckRunning = false;
      return;
    }

    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      continuousFluxAppHashesCheckRunning = false;
      return;
    }

    if (firstContinuousFluxAppHashesCheckRun && !checkAndSyncAppHashesWasEverExecuted) {
      await checkAndSyncAppHashes();
    }

    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const queryHeight = { generalScannedHeight: { $gte: 0 } };
    const projectionHeight = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const scanHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, queryHeight, projectionHeight);
    if (!scanHeight) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(scanHeight.generalScannedHeight);

    // get flux app hashes that do not have a message;
    const query = { message: false };
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
        messageNotFound: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    // sort it by height, so we request oldest messages first
    results.sort((a, b) => a.height - b.height);
    let appsMessagesMissing = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const result of results) {
      if (!result.messageNotFound || force || firstContinuousFluxAppHashesCheckRun) { // most likely wrong data, if no message found. This attribute is cleaned every reconstructAppMessagesHashPeriod blocks so all nodes search again for missing messages
        let heightDifference = explorerHeight - result.height;
        if (heightDifference < 0) {
          heightDifference = 0;
        }
        let maturity = Math.round(heightDifference / config.fluxapps.blocksLasting);
        if (maturity > 12) {
          maturity = 16; // maturity of max 16 representing its older than 1 year. Old messages will only be searched 3 times, newer messages more oftenly
        }
        if (invalidMessages.find((message) => message.hash === result.hash && message.txid === result.txid)) {
          if (!force) {
            maturity = 30; // do not request known invalid messages.
          }
        }
        // every config.fluxapps.blocksLasting increment maturity by 2;
        let numberOfSearches = maturity;
        if (hashesNumberOfSearchs.has(result.hash)) {
          numberOfSearches = hashesNumberOfSearchs.get(result.hash) + 2; // max 10 tries
        }
        hashesNumberOfSearchs.set(result.hash, numberOfSearches);
        log.info(`Requesting missing Flux App message: ${result.hash}, ${result.txid}, ${result.height}`);
        if (numberOfSearches <= 20) { // up to 10 searches
          const appMessageInformation = {
            hash: result.hash,
            txid: result.txid,
            height: result.height,
            value: result.value,
          };
          appsMessagesMissing.push(appMessageInformation);
          if (appsMessagesMissing.length === 500) {
            log.info('Requesting 500 app messages');
            checkAndRequestMultipleApps(appsMessagesMissing);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // delay 2 minutes to give enough time to process all messages received
            appsMessagesMissing = [];
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          await appHashHasMessageNotFound(result.hash); // mark message as not found
          hashesNumberOfSearchs.delete(result.hash); // remove from our map
        }
      }
    }
    if (appsMessagesMissing.length > 0) {
      log.info(`Requesting ${appsMessagesMissing.length} app messages`);
      checkAndRequestMultipleApps(appsMessagesMissing);
    }
    continuousFluxAppHashesCheckRunning = false;
    firstContinuousFluxAppHashesCheckRun = false;
  } catch (error) {
    log.error(error);
    continuousFluxAppHashesCheckRunning = false;
    firstContinuousFluxAppHashesCheckRun = false;
  }
}

/**
 * To manually request app message over api
 * @param {req} req api request
 * @param {res} res api response
 */
async function triggerAppHashesCheckAPI(req, res) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    continuousFluxAppHashesCheck(true);
    const resultsResponse = messageHelper.createSuccessMessage('Running check on missing application messages ');
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get app hashes.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppHashes(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
        messageNotFound: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    return res ? res.json(resultsResponse) : resultsResponse;
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
 * To get app locations or a location of an app
 * @param {string} appname Application Name.
 */
async function appLocation(appname) {
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
 * To get app locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsLocations(req, res) {
  try {
    const results = await appLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get app installing locations or a location of an app
 * @param {string} appname Application Name.
 */
async function appInstallingLocation(appname) {
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
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingLocations, query, projection);
  return results;
}

/**
 * To get app installing locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsInstallingLocations(req, res) {
  try {
    const results = await appInstallingLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get app installing errors locations or a location of an app
 * @param {string} appname Application Name.
 */
async function appInstallingErrorsLocation(appname) {
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
      error: 1,
      broadcastedAt: 1,
      cachedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingErrorsLocations, query, projection);
  return results;
}

/**
 * To get app installing errors locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsInstallingErrorsLocations(req, res) {
  try {
    const results = await appInstallingErrorsLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get a specific app's location.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appLocation(appname);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get a specific app's installing locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppInstallingLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingLocation(appname);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get a specific app's installing error locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppInstallingErrorsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingErrorsLocation(appname);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * To get all global app names.
 * @param {array} proj Array of wanted projection to get, If not submitted, all fields.
 * @returns {string[]} Array of app specifications or an empty array if an error is caught.
 */
async function getAllGlobalApplications(proj = []) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const wantedProjection = {
      _id: 0,
    };
    proj.forEach((field) => {
      wantedProjection[field] = 1;
    });
    const projection = { projection: wantedProjection, sort: { height: 1 } }; // ensure sort from oldest to newest
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    return results;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get a list of running apps for a specific IP address.
 * @param {string} ip IP address.
 * @returns {object[]} Array of running apps.
 */
async function getRunningAppIpList(ip) { // returns all apps running on this ip
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const query = { ip: new RegExp(`^${ip}`) };
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
 * To get app specifications for a specific global app.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationGlobalSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const dbAppSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  let appSpec = await checkAndDecryptAppSpecs(dbAppSpec);
  if (appSpec && appSpec.version >= 8 && appSpec.enterprise) {
    const { height, hash } = appSpec;
    appSpec = specificationFormatter(appSpec);
    appSpec.height = height;
    appSpec.hash = hash;
  }
  return appSpec;
}

/**
 * To get app specifications for a specific local app.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationLocalSpecifications(appName) {
  const allApps = await availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  return appInfo;
}

/**
 * To get app specifications for a specific app if global/local status is unkown. First searches global apps and if not found then searches local apps.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationSpecifications(appName) {
  // appSpecs: {
  //   version: 2,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]', // []
  //   containerPorts: '[7396]', // []
  //   domains: '[""]', // []
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  }

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  appInfo = await checkAndDecryptAppSpecs(appInfo);
  if (appInfo && appInfo.version >= 8 && appInfo.enterprise) {
    const { height, hash } = appInfo;
    appInfo = specificationFormatter(appInfo);
    appInfo.height = height;
    appInfo.hash = hash;
  }
  return appInfo;
}

/**
 * To get app specifications for a specific app (case sensitive) if global/local status is unkown. First searches global apps and if not found then searches local apps.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getStrictApplicationSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: appName };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name === appName);
  }

  // we don't need the height here, but just to keep things the same, we add it
  appInfo = await checkAndDecryptAppSpecs(appInfo);
  if (appInfo && appInfo.version >= 8 && appInfo.enterprise) {
    const { height, hash } = appInfo;
    appInfo = specificationFormatter(appInfo);
    appInfo.height = height;
    appInfo.hash = hash;
  }
  return appInfo;
}

/**
 * To get app specifications updated to the latest version of the network.
 * @param {object} appSpec original specifications.
 * @return {object} appSpec update to the latest version.
 */
function updateToLatestAppSpecifications(appSpec) {
  // current latest version is 8
  if (appSpec.version === 1) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'port', 'containerPort', 'enviromentParameters', 'commands', 'containerData',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: [appSpec.port],
      containerPorts: [appSpec.containerPort],
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: 3,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 2) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: appSpec.ports,
      containerPorts: appSpec.containerPorts,
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      domains: appSpec.domains,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: 3,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 3) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains', 'instances',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    ]; */
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: appSpec.ports,
      containerPorts: appSpec.containerPorts,
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      domains: appSpec.domains,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: appSpec.instances,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 4) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 5) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: 22000,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 6) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: appSpec.expire,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 7) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'secrets', 'repoauth',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: appSpec.expire,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [], // we don't fill the nodes as they were used for different thing.
      staticip: appSpec.staticip,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: component.repoauth,
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 8) {
    return appSpec;
  }
  throw new Error('Original application version not recognized');
}

/**
 * To get app specifications for a specific app (global or local) via API. If it's
 * a v8+ app, can request the specs with the original encryption, or reencrypted with
 * a session key provided by the client in the Enterprise-Key header. If the client
 * is flux support, we allow a partial decryption of the app specs.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>}
 */
async function getApplicationSpecificationAPI(req, res) {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { height: daemonHeight } } = syncStatus;

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // query params take precedence over params (they were set explictly)
    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    const mainAppName = appname.split('_')[1] || appname;

    if (!specifications) {
      throw new Error('Application not found');
    }

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    if (!decrypt) {
      if (isEnterprise) {
        specifications.compose = [];
        specifications.contacts = [];
      }

      const specResponse = messageHelper.createDataMessage(specifications);
      res.json(specResponse);
      return null;
    }

    if (!isEnterprise) {
      throw new Error('App spec decryption is only possible for version 8+ Apps.');
    }

    const encryptedEnterpriseKey = req.headers['enterprise-key'];
    if (!encryptedEnterpriseKey) {
      throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
    }

    const ownerAuthorized = await verificationHelper.verifyPrivilege(
      'appowner',
      req,
      mainAppName,
    );

    const fluxTeamAuthorized = ownerAuthorized === true
      ? false
      : await verificationHelper.verifyPrivilege(
        'appownerabove',
        req,
        mainAppName,
      );

    if (ownerAuthorized !== true && fluxTeamAuthorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    if (fluxTeamAuthorized) {
      specifications.compose.forEach((component) => {
        const comp = component;
        comp.environmentParameters = [];
        comp.repoauth = '';
      });
    }

    // this seems a bit weird, but the client can ask for the specs encrypted or decrypted.
    // If decrypted, they pass us another session key and we use that to encrypt.
    specifications.enterprise = await encryptEnterpriseFromSession(
      specifications,
      daemonHeight,
      encryptedEnterpriseKey,
    );

    specifications.contacts = [];
    specifications.compose = [];

    const specResponse = messageHelper.createDataMessage(specifications);
    res.json(specResponse);
  } catch (error) {
    log.error(error);

    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );

    res.json(errorResponse);
  }

  return null;
}

/**
 * To update specifications to the latest version. (This is futureproofed, i.e.
 * clients can update from 8 to 8+, by passing encryption key)
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 */
async function updateApplicationSpecificationAPI(req, res) {
  try {
    const { appname } = req.params;
    if (!appname) {
      throw new Error('appname parameter is mandatory');
    }

    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { daemonHeight } } = syncStatus;

    const specifications = await getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    let encryptedEnterpriseKey = null;
    if (isEnterprise) {
      encryptedEnterpriseKey = req.headers['enterprise-key'];
      if (!encryptedEnterpriseKey) {
        throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
      }
    }

    const authorized = await verificationHelper.verifyPrivilege(
      'appownerabove',
      req,
      mainAppName,
    );

    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    const updatedSpecs = updateToLatestAppSpecifications(specifications);

    if (isEnterprise) {
      const enterprise = await encryptEnterpriseFromSession(
        updatedSpecs,
        daemonHeight,
        encryptedEnterpriseKey,
      );

      updatedSpecs.enterprise = enterprise;
      updatedSpecs.contact = [];
      updatedSpecs.compose = [];
    }

    const specResponse = messageHelper.createDataMessage(updatedSpecs);
    res.json(specResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
  return null;
}

/**
 * To get app owner for a specific app (global or local) via API.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationOwnerAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const owner = await serviceHelper.getApplicationOwner(appname);
    if (!owner) {
      throw new Error('Application not found');
    }
    const ownerResponse = messageHelper.createDataMessage(owner);
    res.json(ownerResponse);
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
 * To get app original owner for a specific app (global or local) via API.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationOriginalOwner(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const projection = {
      projection: {
        _id: 0,
      },
    };
    log.info(`Searching register permanent messages for ${appname}`);
    const appsQuery = {
      'appSpecifications.name': appname,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    const ownerResponse = messageHelper.createDataMessage(lastAppRegistration.appSpecifications.owner);
    res.json(ownerResponse);
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
 * Get all application ports
 * @param {object} appSpecs application specifications
 * @return {array} Returns array of ports
 */
function getAppPorts(appSpecs) {
  const appPorts = [];
  // eslint-disable-next-line no-restricted-syntax
  if (appSpecs.version === 1) {
    appPorts.push(+appSpecs.port);
  } else if (appSpecs.version <= 3) {
    appSpecs.ports.forEach((port) => {
      appPorts.push(+port);
    });
  } else {
    appSpecs.compose.forEach((component) => {
      component.ports.forEach((port) => {
        appPorts.push(+port);
      });
    });
  }
  return appPorts;
}

/**
 * Get from another peer the list of apps installing errors or just for a specific application name
 */
async function getPeerAppsInstallingErrorMessages() {
  try {
    let finished = false;
    let i = 0;
    while (!finished && i <= 10) {
      i += 1;
      const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
      let axiosConfig = {
        timeout: 5000,
      };
      log.info(`getPeerAppsInstallingErrorMessages - Getting fluxos uptime from ${client.ip}:${client.port}`);
      // eslint-disable-next-line no-await-in-loop
      const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/flux/uptime`, axiosConfig).catch((error) => log.error(error));
      if (!response || !response.data || response.data.status !== 'success' || !response.data.data) {
        log.info(`getPeerAppsInstallingErrorMessages - Failed to get fluxos uptime from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const ut = process.uptime();
      const measureUptime = Math.floor(ut);
      // let's get information from a node that have higher fluxos uptime than me for at least one hour.
      if (response.data.data < measureUptime + 3600) {
        log.info(`getPeerAppsInstallingErrorMessages - Connected peer ${client.ip}:${client.port} doesn't have FluxOS uptime to be used`);
        // eslint-disable-next-line no-continue
        continue;
      }
      log.info(`getPeerAppsInstallingErrorMessages - FluxOS uptime is ok on ${client.ip}:${client.port}`);
      axiosConfig = {
        timeout: 30000,
      };
      log.info(`getPeerAppsInstallingErrorMessages - Getting app installing errors from ${client.ip}:${client.port}`);
      const url = `http://${client.ip}:${client.port}/apps/installingerrorslocations`;
      // eslint-disable-next-line no-await-in-loop
      const appsResponse = await serviceHelper.axiosGet(url, axiosConfig).catch((error) => log.error(error));
      if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
        log.info(`getPeerAppsInstallingErrorMessages - Failed to get app installing error locations from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const apps = appsResponse.data.data;
      log.info(`getPeerAppsInstallingErrorMessages - Will process ${apps.length} apps installing errors locations messages`);
      const operations = apps.map((message) => ({
        updateOne: {
          filter: { name: message.name, hash: message.hash, ip: message.ip }, // ou outro campo único
          update: { $set: message },
          upsert: true,
        },
      }));
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.appsglobal.database);
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.bulkWriteInDatabase(database, globalAppsInstallingErrorsLocations, operations);
      finished = true;
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To try spawning a global application. Performs various checks before the app is spawned. Checks that app is not already running on the FluxNode/IP address.
 * Checks if app already has the required number of instances deployed. Checks that application image is not blacklisted. Checks that ports not already in use.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
let firstExecutionAfterItsSynced = true;
let fluxNodeWasAlreadyConfirmed = false;
let fluxNodeWasNotConfirmedOnLastCheck = false;
const appsToBeCheckedLater = [];
const appsSyncthingToBeCheckedLater = [];
async function trySpawningGlobalApplication() {
  try {
    // how do we continue with this function?
    // we have globalapplication specifics list
    // check if we are synced
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    if (!checkAndSyncAppHashesWasEverExecuted) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Global applications will not be installed');
      fluxNodeWasNotConfirmedOnLastCheck = true;
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    if (firstExecutionAfterItsSynced === true) {
      log.info('Explorer Synced, checking for expired apps');
      // eslint-disable-next-line no-use-before-define
      await expireGlobalApplications();
      firstExecutionAfterItsSynced = false;
      await getPeerAppsInstallingErrorMessages();
    }

    if (fluxNodeWasAlreadyConfirmed && fluxNodeWasNotConfirmedOnLastCheck) {
      fluxNodeWasNotConfirmedOnLastCheck = false;
      setTimeout(() => {
        // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
        // 125 minutes should give enough time for node receive currently two times the apprunning messages
        trySpawningGlobalApplication();
      }, 125 * 60 * 1000);
      return;
    }
    fluxNodeWasAlreadyConfirmed = true;

    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      log.info('FluxBench status Error. Global applications will not be installed');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    if (benchmarkResponse.data.thunder) {
      log.info('Flux Node is a Fractus Storage Node. Global applications will not be installed');
      await serviceHelper.delay(24 * 3600 * 1000); // check again in one day as changing from and to only requires the restart of flux daemon
      trySpawningGlobalApplication();
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }

    // get all the applications list names missing instances
    const pipeline = [
      {
        $lookup: {
          from: 'zelappslocation',
          localField: 'name',
          foreignField: 'name',
          as: 'locations',
        },
      },
      {
        $addFields: {
          actual: { $size: '$locations.name' },
        },
      },
      {
        $match: {
          $expr: { $lt: ['$actual', { $ifNull: ['$instances', 3] }] },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$name',
          actual: '$actual',
          required: '$instances',
          nodes: { $ifNull: ['$nodes', []] },
          geolocation: { $ifNull: ['$geolocation', []] },
          hash: '$hash',
          version: '$version',
          enterprise: '$enterprise',
        },
      },
      { $sort: { name: 1 } },
    ];

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    log.info('trySpawningGlobalApplication - Checking for apps that are missing instances on the network.');
    let globalAppNamesLocation = await dbHelper.aggregateInDatabase(database, globalAppsInformation, pipeline);
    const numberOfGlobalApps = globalAppNamesLocation.length;
    if (!numberOfGlobalApps) {
      log.info('No installable application found');
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }
    log.info(`trySpawningGlobalApplication - Found ${numberOfGlobalApps} apps that are missing instances on the network.`);

    let appToRun = null;
    let appToRunAux = null;
    let minInstances = null;
    let appHash = null;
    let appFromAppsToBeCheckedLater = false;
    let appFromAppsSyncthingToBeCheckedLater = false;
    const appIndex = appsToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
    const appSyncthingIndex = appsSyncthingToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
    let runningAppList = [];
    let installingAppList = [];
    if (appIndex >= 0) {
      appToRun = appsToBeCheckedLater[appIndex].appName;
      appHash = appsToBeCheckedLater[appIndex].hash;
      minInstances = appsToBeCheckedLater[appIndex].required;
      appsToBeCheckedLater.splice(appIndex, 1);
      appFromAppsToBeCheckedLater = true;
    } else if (appSyncthingIndex >= 0) {
      appToRun = appsSyncthingToBeCheckedLater[appSyncthingIndex].appName;
      appHash = appsSyncthingToBeCheckedLater[appSyncthingIndex].hash;
      minInstances = appsSyncthingToBeCheckedLater[appSyncthingIndex].required;
      appsSyncthingToBeCheckedLater.splice(appSyncthingIndex, 1);
      appFromAppsSyncthingToBeCheckedLater = true;
    } else {
      const myNodeLocation = nodeFullGeolocation();

      const runningApps = await listRunningApps();
      if (runningApps.status !== 'success') {
        throw new Error('trySpawningGlobalApplication - Unable to check running apps on this Flux');
      }

      // filter apps that failed to install before
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => !runningApps.data.find((appsRunning) => appsRunning.Names[0].slice(5) === app.name)
        && !spawnErrorsLongerAppCache.has(app.hash)
        && !trySpawningGlobalAppCache.has(app.hash)
        && !appsToBeCheckedLater.includes((appAux) => appAux.appName === app.name));
      // filter apps that are non enterprise or are marked to install on my node
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => app.nodes.length === 0 || app.nodes.find((ip) => ip === myIP) || app.version >= 8);
      // filter apps that dont have geolocation or that are forbidden to spawn on my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('a!c')).length === 0 || !app.geolocation.find((loc) => loc.startsWith('a!c') && `a!c${myNodeLocation}`.startsWith(loc.replace('_NONE', '')))));
      // filter apps that dont have geolocation or have and match my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('ac')).length === 0 || app.geolocation.find((loc) => loc.startsWith('ac') && `ac${myNodeLocation}`.startsWith(loc))));
      if (globalAppNamesLocation.length === 0) {
        log.info('trySpawningGlobalApplication - No app currently to be processed');
        await serviceHelper.delay(30 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      log.info(`trySpawningGlobalApplication - Found ${globalAppNamesLocation.length} apps that are missing instances on the network and can be selected to try to spawn on my node.`);
      let random = Math.floor(Math.random() * globalAppNamesLocation.length);
      appToRunAux = globalAppNamesLocation[random];
      const filterAppsWithNyNodeIP = globalAppNamesLocation.filter((app) => app.nodes.find((ip) => ip === myIP));
      if (filterAppsWithNyNodeIP.length > 0) {
        random = Math.floor(Math.random() * filterAppsWithNyNodeIP.length);
        appToRunAux = filterAppsWithNyNodeIP[random];
      }

      appToRun = appToRunAux.name;
      appHash = appToRunAux.hash;
      minInstances = appToRunAux.required;

      log.info(`trySpawningGlobalApplication - Application ${appToRun} selected to try to spawn. Reported as been running in ${appToRunAux.actual} instances and ${appToRunAux.required} are required.`);
      runningAppList = await appLocation(appToRun);
      installingAppList = await appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      if (appToRunAux.enterprise && !isArcane) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} can only install on ArcaneOS`);
        spawnErrorsLongerAppCache.set(appHash, '');
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
    }

    trySpawningGlobalAppCache.set(appHash, '');
    log.info(`trySpawningGlobalApplication - App ${appToRun} hash: ${appHash}`);

    const installingAppErrorsList = await appInstallingErrorsLocation(appToRun);
    if (installingAppErrorsList.find((app) => !app.expireAt && app.hash === appHash)) {
      spawnErrorsLongerAppCache.set(appHash, '');
      throw new Error(`trySpawningGlobalApplication - App ${appToRun} is marked as having errors on app installing errors locations.`);
    }

    runningAppList = await appLocation(appToRun);

    const adjustedIP = myIP.split(':')[0]; // just IP address
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }
    if (installingAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // get app specifications
    const appSpecifications = await getApplicationGlobalSpecifications(appToRun);
    if (!appSpecifications) {
      throw new Error(`trySpawningGlobalApplication - Specifications for application ${appToRun} were not found!`);
    }

    // eslint-disable-next-line no-restricted-syntax
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {}; // all
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
        version: 1,
        repotag: 1,
        compose: 1,
      },
    };
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const appExists = apps.find((app) => app.name === appSpecifications.name);
    if (appExists) { // double checked in installation process.
      log.info(`trySpawningGlobalApplication - Application ${appSpecifications.name} is already installed`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // verify app compliance
    await checkApplicationImagesComplience(appSpecifications).catch((error) => {
      if (error.message !== 'Unable to communicate with Flux Services! Try again later.') {
        spawnErrorsLongerAppCache.set(appHash, '');
      }
      throw error;
    });

    // verify requirements
    await checkAppRequirements(appSpecifications);

    // ensure ports unused
    // appNames on Ip
    const runningAppsIp = await getRunningAppIpList(adjustedIP);
    const runningAppsNames = [];
    runningAppsIp.forEach((app) => {
      runningAppsNames.push(app.name);
    });

    await ensureApplicationPortsNotUsed(appSpecifications, runningAppsNames);

    const appPorts = getAppPorts(appSpecifications);
    // check port is not user blocked
    appPorts.forEach((port) => {
      const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
      if (isUserBlocked) {
        spawnErrorsLongerAppCache.set(appHash, '');
        throw new Error(`trySpawningGlobalApplication - Port ${port} is blocked by user. Installation aborted.`);
      }
    });
    // eslint-disable-next-line no-use-before-define
    const portsPubliclyAvailable = await checkInstallingAppPortAvailable(appPorts);
    if (portsPubliclyAvailable === false) {
      log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // double check if app is installed on the number of instances requested
    runningAppList = await appLocation(appToRun);
    installingAppList = await appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    let syncthingApp = false;
    if (appSpecifications.version <= 3) {
      syncthingApp = appSpecifications.containerData.includes('g:') || appSpecifications.containerData.includes('r:') || appSpecifications.containerData.includes('s:');
    } else {
      syncthingApp = appSpecifications.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
    }

    if (syncthingApp) {
      const myIpWithoutPort = myIP.split(':')[0];
      const lastIndex = myIpWithoutPort.lastIndexOf('.');
      const secondLastIndex = myIpWithoutPort.substring(0, lastIndex).lastIndexOf('.');
      const sameIpRangeNode = runningAppList.find((location) => location.ip.includes(myIpWithoutPort.substring(0, secondLastIndex)));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater && runningAppList.length < 6) {
        // check if there are connectivity to all nodes
        // eslint-disable-next-line no-restricted-syntax
        for (const node of runningAppList) {
          const ip = node.ip.split(':')[0];
          const port = node.ip.split(':')[1] || '16127';
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
          if (!isOpen) {
            log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance running on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 30m if remaining missing instances`);
            const appToCheck = {
              timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
              appName: appToRun,
              hash: appHash,
              required: minInstances,
            };
            appsSyncthingToBeCheckedLater.push(appToCheck);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(5 * 60 * 1000);
            trySpawningGlobalAppCache.delete(appHash);
            trySpawningGlobalApplication();
            return;
          }
        }
      }
    }

    if (!appFromAppsToBeCheckedLater) {
      const tier = await generalService.nodeTier();
      const appHWrequirements = totalAppHWRequirements(appSpecifications, tier);
      let delay = false;
      if (!appToRunAux.enterprise && isArcane) {
        const appToCheck = {
          timeToCheck: Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs not enterprise, will check in around 1h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length > 0 && !appToRunAux.nodes.find((ip) => ip === myIP)) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs have target ips, will check in around 0.5h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 1.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 2h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.35 * 60 * 60 * 1000 : Date.now() + 1.45 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from nimbus, will check in around 1h30 if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'super' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.2 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 1h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      }
      if (delay) {
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
    }

    // ToDo: Move this to global
    const architecture = await systemArchitecture();

    // TODO evaluate later to move to more broad check as image can be shared among multiple apps
    const compositedSpecification = appSpecifications.compose || [appSpecifications]; // use compose array if v4+ OR if not defined its <= 3 do an array of appSpecs.
    // eslint-disable-next-line no-restricted-syntax
    for (const componentToInstall of compositedSpecification) {
      // check image is whitelisted and repotag is available for download
      // eslint-disable-next-line no-await-in-loop
      await verifyRepository(componentToInstall.repotag, { repoauth: componentToInstall.repoauth, architecture }).catch((error) => {
        spawnErrorsLongerAppCache.set(appHash, '');
        throw error;
      });
    }

    // triple check if app is installed on the number of instances requested
    runningAppList = await appLocation(appToRun);
    installingAppList = await appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // an application was selected and checked that it can run on this node. try to install and run it locally
    // lets broadcast to the network the app is going to be installed on this node, so we don't get lot's of intances installed when it's not needed
    let broadcastedAt = Date.now();
    const newAppInstallingMessage = {
      type: 'fluxappinstalling',
      version: 1,
      name: appSpecifications.name,
      ip: myIP,
      broadcastedAt,
    };

    // store it in local database first
    // eslint-disable-next-line no-await-in-loop, no-use-before-define
    await storeAppInstallingMessage(newAppInstallingMessage);
    // broadcast messages about running apps to all peers
    await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppInstallingMessage);
    await serviceHelper.delay(500);
    await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppInstallingMessage);
    // broadcast messages about running apps to all peers

    await serviceHelper.delay(30 * 1000); // give it time so messages are propagated on the network

    // double check if app is installed in more of the instances requested
    runningAppList = await appLocation(appToRun);
    installingAppList = await appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      installingAppList.sort((a, b) => {
        if (a.broadcastedAt < b.broadcastedAt) {
          return -1;
        }
        if (a.broadcastedAt > b.broadcastedAt) {
          return 1;
        }
        return 0;
      });
      broadcastedAt = Date.now();
      const index = installingAppList.findIndex((x) => x.ip === myIP);
      if (runningAppList.length + index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances, my instance is number ${runningAppList.length + index + 1}`);
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
    }

    // install the app
    let registerOk = false;
    try {
      registerOk = await registerAppLocally(appSpecifications, null, null, false); // can throw
    } catch (error) {
      log.error(error);
      registerOk = false;
    }
    if (!registerOk) {
      log.info('trySpawningGlobalApplication - Error on registerAppLocally');
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    await serviceHelper.delay(1 * 60 * 1000); // await 1 minute to give time for messages to be propagated on the network
    // double check if app is installed in more of the instances requested
    runningAppList = await appLocation(appToRun);
    if (runningAppList.length > minInstances) {
      runningAppList.sort((a, b) => {
        if (!a.runningSince && b.runningSince) {
          return -1;
        }
        if (a.runningSince && !b.runningSince) {
          return 1;
        }
        if (a.runningSince < b.runningSince) {
          return -1;
        }
        if (a.runningSince > b.runningSince) {
          return 1;
        }
        return 0;
      });
      const index = runningAppList.findIndex((x) => x.ip === myIP);
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned on ${runningAppList.length} instances, my instance is number ${index + 1}`);
      if (index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is going to be removed as already passed the instances required.`);
        trySpawningGlobalAppCache.delete(appHash);
        removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
      }
    }

    await serviceHelper.delay(30 * 60 * 1000);
    log.info('trySpawningGlobalApplication - Reinitiating possible app installation');
    trySpawningGlobalApplication();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(5 * 60 * 1000);
    trySpawningGlobalApplication();
  }
}

/**
 * To check and notify peers of running apps. Checks if apps are installed, stopped or running.
 */
let checkAndNotifyPeersOfRunningAppsFirstRun = true;
async function checkAndNotifyPeersOfRunningApps() {
  try {
    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('checkAndNotifyPeersOfRunningApps - FluxNode is not Confirmed');
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
      if (benchmarkResponseData.ipaddress) {
        log.info(`Gathered IP ${benchmarkResponseData.ipaddress}`);
        myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
      }
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    // get list of locally installed apps. Store them in database as running and send info to our peers.
    // check if they are running?
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const runningApps = runningAppsRes.data;
    const installedAppComponentNames = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((appComponent) => {
          installedAppComponentNames.push(`${appComponent.name}_${app.name}`);
        });
      } else {
        installedAppComponentNames.push(app.name);
      }
    });
    // kadena and folding is old naming scheme having /zel.  all global application start with /flux
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));
    const masterSlaveAppsInstalled = [];
    // check if stoppedApp is a global application present in specifics. If so, try to start it.
    if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
      // eslint-disable-next-line no-restricted-syntax
      for (const stoppedApp of stoppedApps) { // will uninstall app if some component is missing
        try {
          // proceed ONLY if it's a global App
          const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
          // eslint-disable-next-line no-await-in-loop
          const appDetails = await getApplicationGlobalSpecifications(mainAppName);
          const appInstalledMasterSlave = appsInstalled.find((app) => app.name === mainAppName);
          const appInstalledSyncthing = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:'));
          const appInstalledMasterSlaveCheck = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:'));
          if (appInstalledSyncthing) {
            masterSlaveAppsInstalled.push(appInstalledMasterSlave);
          }
          if (appDetails && !appInstalledMasterSlaveCheck) {
            if (appInstalledSyncthing) {
              const db = dbHelper.databaseConnection();
              const database = db.db(config.database.appsglobal.database);
              const queryFind = { name: mainAppName, ip: myIP };
              const projection = { _id: 0, runningSince: 1 };
              // we already have the exact same data
              // eslint-disable-next-line no-await-in-loop
              const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
              if (!result || !result.runningSince || Date.parse(result.runningSince) + 30 * 60 * 1000 > Date.now()) {
                log.info(`Application ${stoppedApp} uses r syncthing and haven't started yet because was installed less than 30m ago.`);
                // eslint-disable-next-line no-continue
                continue;
              }
            }
            log.warn(`${stoppedApp} is stopped but should be running. Starting...`);
            // it is a stopped global app. Try to run it.
            // check if some removal is in progress and if it is don't start it!
            const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
            const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
            if (backupSkip || restoreSkip) {
              log.warn(`Application ${stoppedApp} backup/restore is in progress...`);
            }
            if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress && !restoreSkip && !backupSkip) {
              log.warn(`${stoppedApp} is stopped, starting`);
              if (!appsStopedCache.has(stoppedApp)) {
                appsStopedCache.set(stoppedApp, '');
              } else {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerStart(stoppedApp);
                startAppMonitoring(stoppedApp);
              }
            } else {
              log.warn(`Not starting ${stoppedApp} as application removal or installation or backup/restore is in progress`);
            }
          }
        } catch (err) {
          log.error(err);
          if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
            const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
            // already checked for mongo ok, daemon ok, docker ok.
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(mainAppName, null, false, true, true);
          }
        }
      }
    } else {
      log.warn('Stopped application checks not running, some removal or installation is in progress');
    }
    const installedAndRunning = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        let appRunningWell = true;
        app.compose.forEach((appComponent) => {
          if (!runningAppsNames.includes(`${appComponent.name}_${app.name}`)) {
            appRunningWell = false;
          }
        });
        if (appRunningWell) {
          installedAndRunning.push(app);
        }
      } else if (runningAppsNames.includes(app.name)) {
        installedAndRunning.push(app);
      }
    });
    installedAndRunning.push(...masterSlaveAppsInstalled);
    const applicationsToBroadcast = [...new Set(installedAndRunning)];
    const apps = [];
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of applicationsToBroadcast) {
        const queryFind = { name: application.name, ip: myIP };
        const projection = { _id: 0, runningSince: 1 };
        let runningOnMyNodeSince = Date.now();
        // we already have the exact same data
        // eslint-disable-next-line no-await-in-loop
        const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
        if (result && result.runningSince) {
          runningOnMyNodeSince = result.runningSince;
        }
        log.info(`${application.name} is running/installed properly. Broadcasting status.`);
        // eslint-disable-next-line no-await-in-loop
        // we can distinguish pure local apps from global with hash and height
        const newAppRunningMessage = {
          type: 'fluxapprunning',
          version: 1,
          name: application.name,
          hash: application.hash, // hash of application specifics that are running
          ip: myIP,
          broadcastedAt: Date.now(),
          runningSince: runningOnMyNodeSince,
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        const app = {
          name: application.name,
          hash: application.hash,
          runningSince: runningOnMyNodeSince,
        };
        apps.push(app);
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop
        await storeAppRunningMessage(newAppRunningMessage);
        if (installedAndRunning.length === 1) {
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
          // broadcast messages about running apps to all peers
          log.info(`App Running Message broadcasted ${JSON.stringify(newAppRunningMessage)}`);
        }
      }
      if (installedAndRunning.length > 1) {
        // send v2 unique message instead
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: Date.now(),
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
        log.info(`App Running Message broadcasted ${JSON.stringify(newAppRunningMessageV2)}`);
      } else if (installedAndRunning.length === 0 && checkAndNotifyPeersOfRunningAppsFirstRun) {
        checkAndNotifyPeersOfRunningAppsFirstRun = false;
        // we will broadcast a message that we are not running any app
        // if multitoolbox option to reinstall fluxos or fix mongodb is executed all apps are removed from the node, once the node starts and it's confirmed
        // should broadcast to the network what is running or not
        // the nodes who receive the message will only rebroadcast if they had information about a app running on this node
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: Date.now(),
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
        log.info(`No Apps Running Message broadcasted ${JSON.stringify(newAppRunningMessageV2)}`);
      }
    } catch (err) {
      log.error(err);
      // removeAppLocally(stoppedApp);
    }
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  }
}

/**
 * To find and remove expired global applications. Finds applications that are registered on lower height than current height minus default blocksLasting
 * or set by their expire blockheight specification, then deletes them from global database and do potential uninstall.
 * Also adjusted for trial apps
 */
async function expireGlobalApplications() {
  // check if synced
  try {
    // get current height
    const dbopen = dbHelper.databaseConnection();
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
    let minExpirationHeight = explorerHeight - config.fluxapps.newMinBlocksAllowance; // do a pre search in db as every app has to live for at least newMinBlocksAllowance
    if (explorerHeight < config.fluxapps.newMinBlocksAllowanceBlock) {
      minExpirationHeight = explorerHeight - config.fluxapps.minBlocksAllowance; // do a pre search in db as every app has to live for at least minBlocksAllowance
    }
    // get global applications specification that have up to date data
    // find applications that have specifications height lower than minExpirationHeight
    const databaseApps = dbopen.db(config.database.appsglobal.database);
    const queryApps = { height: { $lt: minExpirationHeight } };
    const projectionApps = {
      projection: {
        _id: 0, name: 1, hash: 1, expire: 1, height: 1,
      },
    };
    const results = await dbHelper.findInDatabase(databaseApps, globalAppsInformation, queryApps, projectionApps);
    const appsToExpire = [];
    const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
    results.forEach((appSpecs) => {
      const expireIn = appSpecs.expire || defaultExpire;
      if (appSpecs.height + expireIn < explorerHeight) { // registered/updated on height, expires in expireIn is lower than current height
        appsToExpire.push(appSpecs);
      }
    });
    const appNamesToExpire = appsToExpire.map((res) => res.name);
    // remove appNamesToExpire apps from global database
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsToExpire) {
      log.info(`Expiring application ${app.name}`);
      const queryDeleteApp = { name: app.name };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.findOneAndDeleteInDatabase(databaseApps, globalAppsInformation, queryDeleteApp, projectionApps);

      const queryDeleteAppErrors = { name: app.name };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.removeDocumentsFromCollection(databaseApps, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
    }

    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // remove any installed app which height is lower (or not present) but is not infinite app
    const appsToRemove = [];
    appsInstalled.forEach((app) => {
      if (appNamesToExpire.includes(app.name)) {
        appsToRemove.push(app);
      } else if (!app.height) {
        appsToRemove.push(app);
      } else if (app.height === 0) {
        // do nothing, forever lasting local app
      } else {
        const expireIn = app.expire || defaultExpire;
        if (app.height + expireIn < explorerHeight) {
          appsToRemove.push(app);
        }
      }
    });
    const appsToRemoveNames = appsToRemove.map((app) => app.name);

    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is expired, removing`);
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(appName, null, false, true, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1 * 60 * 1000); // wait for 1 min
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Removes applications that are blacklisted
 */
async function checkApplicationsCompliance() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const appsToRemoveNames = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const isAppBlocked = await checkApplicationImagesBlocked(app);
      if (isAppBlocked) {
        if (!appsToRemoveNames.includes(app.name)) {
          appsToRemoveNames.push(app.name);
        }
      }
    }
    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is blacklisted, removing`);
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(appName, null, false, true, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(3 * 60 * 1000); // wait for 3 mins so we don't have more removals at the same time
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * check if app cpu is throttling
 */
async function checkApplicationsCpuUSage() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    let stats;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version <= 3) {
        stats = appsMonitored[app.name].lastHourstatsStore;
        // eslint-disable-next-line no-await-in-loop
        const inspect = await dockerService.dockerContainerInspect(app.name);
        if (inspect && stats && stats.length > 4) {
          const nanoCpus = inspect.HostConfig.NanoCpus;
          let cpuThrottlingRuns = 0;
          let cpuThrottling = false;
          const cpuPercentage = nanoCpus / app.cpu / 1e9;
          // eslint-disable-next-line no-restricted-syntax
          for (const stat of stats) {
            const cpuUsage = stat.data.cpu_stats.cpu_usage.total_usage - stat.data.precpu_stats.cpu_usage.total_usage;
            const systemCpuUsage = stat.data.cpu_stats.system_cpu_usage - stat.data.precpu_stats.system_cpu_usage;
            const cpu = ((cpuUsage / systemCpuUsage) * stat.data.cpu_stats.online_cpus * 100) / app.cpu || 0;
            const realCpu = cpu / cpuPercentage;
            if (realCpu >= 92) {
              cpuThrottlingRuns += 1;
            }
          }
          if (cpuThrottlingRuns >= stats.length * 0.8) {
            // cpu was high on 80% of the checks
            cpuThrottling = true;
          }
          appsMonitored[app.name].lastHourstatsStore = [];
          log.info(`checkApplicationsCpuUSage ${app.name} cpu high load: ${cpuThrottling}`);
          log.info(`checkApplicationsCpuUSage ${cpuPercentage}`);
          if (cpuThrottling && app.cpu > 1) {
            if (cpuPercentage === 1) {
              if (app.cpu > 2) {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.8));
              } else {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.9));
              }
              log.info(`checkApplicationsCpuUSage ${app.name} lowering cpu.`);
            }
          } else if (cpuPercentage <= 0.8) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.85));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 85.`);
          } else if (cpuPercentage <= 0.85) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.9));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 90.`);
          } else if (cpuPercentage <= 0.9) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9 * 0.95));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 95.`);
          } else if (cpuPercentage < 1) {
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerUpdateCpu(app.name, Math.round(app.cpu * 1e9));
            log.info(`checkApplicationsCpuUSage ${app.name} increasing cpu 100.`);
          }
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of app.compose) {
          stats = appsMonitored[`${appComponent.name}_${app.name}`].lastHourstatsStore;
          // eslint-disable-next-line no-await-in-loop
          const inspect = await dockerService.dockerContainerInspect(`${appComponent.name}_${app.name}`);
          if (inspect && stats && stats.length > 4) {
            const nanoCpus = inspect.HostConfig.NanoCpus;
            let cpuThrottlingRuns = 0;
            let cpuThrottling = false;
            const cpuPercentage = nanoCpus / appComponent.cpu / 1e9;
            // eslint-disable-next-line no-restricted-syntax
            for (const stat of stats) {
              const cpuUsage = stat.data.cpu_stats.cpu_usage.total_usage - stat.data.precpu_stats.cpu_usage.total_usage;
              const systemCpuUsage = stat.data.cpu_stats.system_cpu_usage - stat.data.precpu_stats.system_cpu_usage;
              const cpu = ((cpuUsage / systemCpuUsage) * 100 * stat.data.cpu_stats.online_cpus) / appComponent.cpu || 0;
              const realCpu = cpu / cpuPercentage;
              if (realCpu >= 92) {
                cpuThrottlingRuns += 1;
              }
            }
            if (cpuThrottlingRuns >= stats.length * 0.8) {
              // cpu was high on 80% of the checks
              cpuThrottling = true;
            }
            appsMonitored[`${appComponent.name}_${app.name}`].lastHourstatsStore = [];
            log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} cpu high load: ${cpuThrottling}`);
            log.info(`checkApplicationsCpuUSage ${cpuPercentage}`);
            if (cpuThrottling && appComponent.cpu > 1) {
              if (cpuPercentage === 1) {
                if (appComponent.cpu > 2) {
                  // eslint-disable-next-line no-await-in-loop
                  await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.8));
                } else {
                  // eslint-disable-next-line no-await-in-loop
                  await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.9));
                }
                log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} lowering cpu.`);
              }
            } else if (cpuPercentage <= 0.8) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.85));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 85.`);
            } else if (cpuPercentage <= 0.85) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.9));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 90.`);
            } else if (cpuPercentage <= 0.9) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9 * 0.95));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 95.`);
            } else if (cpuPercentage < 1) {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerUpdateCpu(`${appComponent.name}_${app.name}`, Math.round(appComponent.cpu * 1e9));
              log.info(`checkApplicationsCpuUSage ${appComponent.name}_${app.name} increasing cpu 100.`);
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To find and remove apps that are spawned more than maximum number of instances allowed locally.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkAndRemoveApplicationInstance() {
  // To check if more than allowed instances of application are running
  // check if synced
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Application duplication removal paused. Not yet synced');
      return;
    }

    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const runningAppList = await appLocation(installedApp.name);
      const minInstances = installedApp.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
      if (runningAppList.length > minInstances) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(installedApp.name);
        if (appDetails) {
          log.info(`Application ${installedApp.name} is already spawned on ${runningAppList.length} instances. Checking if should be unninstalled from the FluxNode..`);
          runningAppList.sort((a, b) => {
            if (!a.runningSince && b.runningSince) {
              return 1;
            }
            if (a.runningSince && !b.runningSince) {
              return -1;
            }
            if (a.runningSince < b.runningSince) {
              return 1;
            }
            if (a.runningSince > b.runningSince) {
              return -1;
            }
            if (a.ip < b.ip) {
              return 1;
            }
            if (a.ip > b.ip) {
              return -1;
            }
            return 0;
          });
          // eslint-disable-next-line no-await-in-loop
          const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
          if (myIP) {
            const index = runningAppList.findIndex((x) => x.ip === myIP);
            if (index === 0) {
              log.info(`Application ${installedApp.name} going to be removed from node as it was the latest one running it to install it..`);
              log.warn(`Removing application ${installedApp.name} locally`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(installedApp.name, null, false, true, true);
              log.warn(`Application ${installedApp.name} locally removed`);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.fluxapps.removal.delay * 1000); // wait for 6 mins so we don't have more removals at the same time
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To soft redeploy. Checks if any other installations/uninstallations are in progress and if not, removes and reinstalls app locally.
 * @param {object} appSpecs App specifications.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function softRedeploy(appSpecs, res) {
  try {
    if (removalInProgress) {
      log.warn('Another application is undergoing removal');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing removal');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (installationInProgress) {
      log.warn('Another application is undergoing installation');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing installation');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    log.info('Starting softRedeploy');
    try {
      await softRemoveAppLocally(appSpecs.name, res);
    } catch (error) {
      log.error(error);
      removalInProgress = false;
      throw error;
    }
    const appRedeployResponse = messageHelper.createSuccessMessage('Application softly removed. Awaiting installation...');
    log.info(appRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appRedeployResponse));
      if (res.flush) res.flush();
    }
    await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins
    // verify requirements
    await checkAppRequirements(appSpecs);
    // register
    await softRegisterAppLocally(appSpecs, undefined, res);
    log.info('Application softly redeployed');
  } catch (error) {
    log.info('Error on softRedeploy');
    log.error(error);
    removeAppLocally(appSpecs.name, res, true, true, true);
  }
}

/**
 * To hard redeploy. Removes and reinstalls app locally.
 * @param {object} appSpecs App specifications.
 * @param {object} res Response.
 */
async function hardRedeploy(appSpecs, res) {
  try {
    await removeAppLocally(appSpecs.name, res, false, false);
    const appRedeployResponse = messageHelper.createSuccessMessage('Application removed. Awaiting installation...');
    log.info(appRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appRedeployResponse));
      if (res.flush) res.flush();
    }
    await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins
    // verify requirements
    await checkAppRequirements(appSpecs);
    // register
    await registerAppLocally(appSpecs, undefined, res); // can throw
    log.info('Application redeployed');
  } catch (error) {
    log.error(error);
    removeAppLocally(appSpecs.name, res, true, true, true);
  }
}

/**
 * To reinstall old apps. Tries soft and hard reinstalls of app (and any components).
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function reinstallOldApplications() {
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Checking application status paused. Not yet synced');
      return;
    }
    // first get installed apps
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    reinstallationOfOldAppsInProgress = true;
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled) {
      // get current app specifications for the app name
      // if match found. Check if hash found.
      // if same, do nothing. if different remove and install.

      // eslint-disable-next-line no-await-in-loop
      const appSpecifications = await getStrictApplicationSpecifications(installedApp.name);
      const randomNumber = Math.floor((Math.random() * config.fluxapps.redeploy.probability)); // 50%
      if (appSpecifications && appSpecifications.hash !== installedApp.hash) {
        // eslint-disable-next-line no-await-in-loop
        log.warn(`Application ${installedApp.name} version is obsolete.`);
        if (randomNumber === 0) {
          // check if the app spec was changed
          const auxAppSpecifications = JSON.parse(JSON.stringify(appSpecifications));
          const auxInstalledApp = JSON.parse(JSON.stringify(installedApp));
          delete auxAppSpecifications.description;
          delete auxAppSpecifications.expire;
          delete auxAppSpecifications.hash;
          delete auxAppSpecifications.height;
          delete auxAppSpecifications.instances;
          delete auxAppSpecifications.owner;

          delete auxInstalledApp.description;
          delete auxInstalledApp.expire;
          delete auxInstalledApp.hash;
          delete auxInstalledApp.height;
          delete auxInstalledApp.instances;
          delete auxInstalledApp.owner;

          if (JSON.stringify(auxAppSpecifications) === JSON.stringify(auxInstalledApp)) {
            log.info(`Application ${installedApp.name} was updated without any change on the specifications, updating localAppsInformation db information.`);
            // connect to mongodb
            const dbopen = dbHelper.databaseConnection();
            const appsDatabase = dbopen.db(config.database.appslocal.database);
            const appsQuery = { name: appSpecifications.name };
            const options = {
              upsert: true,
            };
            // eslint-disable-next-line no-await-in-loop
            await dbHelper.updateOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appSpecifications, options);
            log.info(`Application ${installedApp.name} Database updated`);
            // eslint-disable-next-line no-continue
            continue;
          }

          // check if node is capable to run it according to specifications
          // run the verification
          // get tier and adjust specifications
          // eslint-disable-next-line no-await-in-loop
          const tier = await generalService.nodeTier();
          if (appSpecifications.version >= 4 && installedApp.version <= 3) {
            if (removalInProgress) {
              log.warn('Another application is undergoing removal');
              return;
            }
            if (installationInProgress) {
              log.warn('Another application is undergoing installation');
              return;
            }
            log.warn('Updating from old application version, doing hard redeploy...');
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(appSpecifications.name, null, true, false);
            // connect to mongodb
            const dbopen = dbHelper.databaseConnection();
            const appsDatabase = dbopen.db(config.database.appslocal.database);
            const appsQuery = { name: appSpecifications.name };
            const appsProjection = {};
            log.warn('Cleaning up database...');
            // eslint-disable-next-line no-await-in-loop
            await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
            const databaseStatus2 = {
              status: 'Database cleaned',
            };
            log.warn('Database cleaned');
            log.warn(databaseStatus2);
            log.warn(`Compositions of application ${appSpecifications.name} uninstalled. Continuing with installation...`);
            // composition removal done. Remove from installed apps and being installation
            // eslint-disable-next-line no-await-in-loop
            await checkAppRequirements(appSpecifications); // entire app
            // eslint-disable-next-line no-restricted-syntax
            for (const appComponent of appSpecifications.compose) {
              log.warn(`Continuing Hard Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
              // install the app
              // eslint-disable-next-line no-await-in-loop
              await registerAppLocally(appSpecifications, appComponent); // component
            }
            // register the app

            const isEnterprise = Boolean(
              appSpecifications.version >= 8 && appSpecifications.enterprise,
            );

            const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

            if (isEnterprise) {
              dbSpecs.compose = [];
              dbSpecs.contacts = [];
            }

            // eslint-disable-next-line no-await-in-loop
            await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
            log.warn(`Composed application ${appSpecifications.name} updated.`);
            log.warn(`Restarting application ${appSpecifications.name}`);
            // eslint-disable-next-line no-await-in-loop, no-use-before-define
            await appDockerRestart(appSpecifications.name);
          } else if (appSpecifications.version <= 3) {
            if (appSpecifications.tiered) {
              const hddTier = `hdd${tier}`;
              const ramTier = `ram${tier}`;
              const cpuTier = `cpu${tier}`;
              appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
              appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
              appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
            }

            if (removalInProgress) {
              log.warn('Another application is undergoing removal');
              return;
            }
            if (installationInProgress) {
              log.warn('Another application is undergoing installation');
              return;
            }

            if (appSpecifications.hdd === installedApp.hdd) {
              log.warn(`Beginning Soft Redeployment of ${appSpecifications.name}...`);
              // soft redeployment
              // eslint-disable-next-line no-await-in-loop
              await softRedeploy(appSpecifications);
            } else {
              log.warn(`Beginning Hard Redeployment of ${appSpecifications.name}...`);
              // hard redeployment
              // eslint-disable-next-line no-await-in-loop
              await hardRedeploy(appSpecifications);
            }
          } else {
            // composed application
            log.warn(`Beginning Redeployment of ${appSpecifications.name}...`);
            if (removalInProgress) {
              log.warn('Another application is undergoing removal');
              return;
            }
            if (installationInProgress) {
              log.warn('Another application is undergoing installation');
              return;
            }
            try {
              const reversedCompose = [...appSpecifications.compose].reverse();
              // eslint-disable-next-line no-restricted-syntax
              for (const appComponent of reversedCompose) {
                if (appComponent.tiered) {
                  const hddTier = `hdd${tier}`;
                  const ramTier = `ram${tier}`;
                  const cpuTier = `cpu${tier}`;
                  appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
                  appComponent.ram = appComponent[ramTier] || appComponent.ram;
                  appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
                }

                const installedComponent = installedApp.compose.find((component) => component.name === appComponent.name);

                if (JSON.stringify(installedComponent) === JSON.stringify(appComponent)) {
                  log.warn(`Component ${appComponent.name}_${appSpecifications.name} specs were not changed, skipping.`);
                } else if (appComponent.hdd === installedComponent.hdd) {
                  log.warn(`Beginning Soft Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // soft redeployment
                  // eslint-disable-next-line no-await-in-loop
                  await softRemoveAppLocally(`${appComponent.name}_${appSpecifications.name}`); // component
                  log.warn(`Application component ${appComponent.name}_${appSpecifications.name} softly removed. Awaiting installation...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                } else {
                  log.warn(`Beginning Hard Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // hard redeployment
                  // eslint-disable-next-line no-await-in-loop
                  await removeAppLocally(`${appComponent.name}_${appSpecifications.name}`); // component
                  log.warn(`Application component ${appComponent.name}_${appSpecifications.name} removed. Awaiting installation...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                }
              }
              // connect to mongodb
              const dbopen = dbHelper.databaseConnection();
              const appsDatabase = dbopen.db(config.database.appslocal.database);
              const appsQuery = { name: appSpecifications.name };
              const appsProjection = {};
              log.warn('Cleaning up database...');
              // eslint-disable-next-line no-await-in-loop
              await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
              const databaseStatus2 = {
                status: 'Database cleaned',
              };
              log.warn('Database cleaned');
              log.warn(databaseStatus2);
              log.warn(`Compositions of application ${appSpecifications.name} uninstalled. Continuing with installation...`);
              // composition removal done. Remove from installed apps and being installation
              // eslint-disable-next-line no-await-in-loop
              await checkAppRequirements(appSpecifications); // entire app
              // eslint-disable-next-line no-restricted-syntax
              for (const appComponent of appSpecifications.compose) {
                if (appComponent.tiered) {
                  const hddTier = `hdd${tier}`;
                  const ramTier = `ram${tier}`;
                  const cpuTier = `cpu${tier}`;
                  appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
                  appComponent.ram = appComponent[ramTier] || appComponent.ram;
                  appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
                }

                const installedComponent = installedApp.compose.find((component) => component.name === appComponent.name);

                if (JSON.stringify(installedComponent) === JSON.stringify(appComponent)) {
                  log.warn(`Component ${appComponent.name}_${appSpecifications.name} specs were not changed, skipping.`);
                } else if (appComponent.hdd === installedComponent.hdd) {
                  log.warn(`Continuing Soft Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                  // install the app
                  // eslint-disable-next-line no-await-in-loop
                  await softRegisterAppLocally(appSpecifications, appComponent); // component
                } else {
                  log.warn(`Continuing Hard Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                  // install the app
                  // eslint-disable-next-line no-await-in-loop
                  await registerAppLocally(appSpecifications, appComponent); // component
                }
              }
              // register the app

              const isEnterprise = Boolean(
                appSpecifications.version >= 8 && appSpecifications.enterprise,
              );

              const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

              if (isEnterprise) {
                dbSpecs.compose = [];
                dbSpecs.contacts = [];
              }

              // eslint-disable-next-line no-await-in-loop
              await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
              log.warn(`Composed application ${appSpecifications.name} updated.`);
              log.warn(`Restarting application ${appSpecifications.name}`);
              // eslint-disable-next-line no-await-in-loop, no-use-before-define
              await appDockerRestart(appSpecifications.name);
            } catch (error) {
              log.error(error);
              removeAppLocally(appSpecifications.name, null, true, true, true); // remove entire app
            }
          }
        } else {
          log.warn('Other Fluxes are redeploying application. Waiting for next round.');
        }
      }
      // else specifications do not exist anymore, app shall expire itself
    }
    reinstallationOfOldAppsInProgress = false;
  } catch (error) {
    log.error(error);
    reinstallationOfOldAppsInProgress = false;
  }
}

/**
 * To get app flux onchain price.
 * @param {object} appSpecification Request.
 * @returns {number} Flux Chain Price.
 */
async function getAppFluxOnChainPrice(appSpecification) {
  try {
    const appSpecFormatted = specificationFormatter(appSpecification);

    // check if app exists or its a new registration price
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    // may throw
    const query = { name: appSpecFormatted.name };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }
    const daemonHeight = syncStatus.data.height;
    const appPrices = await getChainParamsPriceUpdates();
    const intervals = appPrices.filter((i) => i.height < daemonHeight);
    const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
    let actualPriceToPay = await appPricePerMonth(appSpecFormatted, daemonHeight, appPrices);
    const expireIn = appSpecFormatted.expire || defaultExpire;
    // app prices are ceiled to highest 0.01
    const multiplier = expireIn / defaultExpire;
    actualPriceToPay *= multiplier;
    actualPriceToPay = Math.ceil(actualPriceToPay * 100) / 100;
    if (appInfo) {
      let previousSpecsPrice = await appPricePerMonth(appInfo, daemonHeight, appPrices); // calculate previous based on CURRENT height, with current interval of prices!
      let previousExpireIn = previousSpecsPrice.expire || defaultExpire; // bad typo bug line. Leave it like it is, this bug is a feature now.
      if (daemonHeight > 1315000) {
        previousExpireIn = appInfo.expire || defaultExpire;
      }
      const multiplierPrevious = previousExpireIn / defaultExpire;
      previousSpecsPrice *= multiplierPrevious;
      previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;
      // what is the height difference
      const heightDifference = daemonHeight - appInfo.height;
      const perc = (previousExpireIn - heightDifference) / previousExpireIn;
      if (perc > 0) {
        actualPriceToPay -= (perc * previousSpecsPrice);
      }
    }
    actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
    if (actualPriceToPay < priceSpecifications.minPrice) {
      actualPriceToPay = priceSpecifications.minPrice;
    }
    return Number(actualPriceToPay).toFixed(2);
  } catch (error) {
    log.warn(error);
    throw error;
  }
}

/**
 * To verify if app update have free network update
 * @param {object} appSpecFormatted appSpecFormatted.
 * @param {number} daemonHeight daemonHeight.
 * @returns {boolean} yes if update message is network free.
 */
async function checkFreeAppUpdate(appSpecFormatted, daemonHeight) {
  // check if it's a free app update offered by the network
  const appInfo = await getApplicationGlobalSpecifications(appSpecFormatted.name);
  if (appInfo && appInfo.expire && appInfo.height && appSpecFormatted.expire) {
    const blocksToExtend = (appSpecFormatted.expire + Number(daemonHeight)) - appInfo.height - appInfo.expire;
    if (((!appSpecFormatted.nodes && !appInfo.nodes) || (appSpecFormatted.nodes && appInfo.nodes && appSpecFormatted.nodes.length === appInfo.nodes.length))
      && appSpecFormatted.instances === appInfo.instances && appSpecFormatted.staticip === appInfo.staticip && blocksToExtend <= 2) { // free updates should not extend app subscription
      if (appSpecFormatted.compose.length === appInfo.compose.length) {
        let changes = false;
        for (let i = 0; i < appSpecFormatted.compose.length; i += 1) {
          const compA = appSpecFormatted.compose[i];
          const compB = appInfo.compose[i];
          if (compA.cpu > compB.cpu || compA.ram > compB.ram || compA.hdd > compB.hdd) {
            changes = true;
            break;
          }
        }
        if (!changes) {
          const db = dbHelper.databaseConnection();
          const database = db.db(config.database.appsglobal.database);
          query = { 'appSpecifications.name': appSpecFormatted.name };
          const projection = {
            projection: {
              _id: 0,
            },
          };
          const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
          let messagesInLasDays = permanentAppMessage.filter((message) => (message.type === 'fluxappupdate' || message.type === 'zelappupdate') && message.height > daemonHeight - 3600);
          // we will give a maximum of 10 free updates in 5 days, 8 in two days, 5 in one day
          if (!messagesInLasDays) {
            // eslint-disable-next-line no-param-reassign
            appSpecFormatted.expire -= blocksToExtend; // if it wasn't zero because some block was received between the validate app specs and this call, we will remove the extension.
            return true;
          }
          if (messagesInLasDays.length < 11) {
            messagesInLasDays = messagesInLasDays.filter((message) => message.height > daemonHeight - 1440);
            if (messagesInLasDays.length < 9) {
              messagesInLasDays = messagesInLasDays.filter((message) => message.height > daemonHeight - 720);
              if (messagesInLasDays.length < 6) {
                // eslint-disable-next-line no-param-reassign
                appSpecFormatted.expire -= blocksToExtend; // if it wasn't zero because some block was received between the validate app specs and this call, we will remove the extension.
                return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * To get app price.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<object>} Message.
 */
async function getAppFiatAndFluxPrice(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;

      appSpecification = serviceHelper.ensureObject(appSpecification);
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;
      appSpecification = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });
      const appSpecFormatted = specificationFormatter(appSpecification);

      // verifications skipped. This endpoint is only for price evaluation

      // check if app exists or its a new registration price
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };

      if (await checkFreeAppUpdate(appSpecFormatted, daemonHeight)) {
        const price = {
          usd: 0,
          flux: 0,
          fluxDiscount: 0,
        };
        const respondPrice = messageHelper.createDataMessage(price);
        return res.json(respondPrice);
      }

      const axiosConfig = {
        timeout: 5000,
      };
      const appPrices = [];
      if (myLongCache.has('appPrices')) {
        appPrices.push(myLongCache.get('appPrices'));
      } else {
        let response = await axios.get('https://stats.runonflux.io/apps/getappspecsusdprice', axiosConfig).catch((error) => log.error(error));
        if (response && response.data && response.data.status === 'success') {
          myLongCache.set('appPrices', response.data.data);
          appPrices.push(response.data.data);
        } else {
          response = config.fluxapps.usdprice;
          myLongCache.set('appPrices', response);
          appPrices.push(response);
        }
      }
      let actualPriceToPay = 0;
      const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
      actualPriceToPay = await appPricePerMonth(appSpecFormatted, daemonHeight, appPrices);
      const expireIn = appSpecFormatted.expire || defaultExpire;
      // app prices are ceiled to highest 0.01
      const multiplier = expireIn / defaultExpire;
      actualPriceToPay *= multiplier;
      actualPriceToPay = Number(actualPriceToPay).toFixed(2);
      const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (appInfo) {
        let previousSpecsPrice = await appPricePerMonth(appInfo, daemonHeight, appPrices); // calculate previous based on CURRENT height, with current interval of prices!
        let previousExpireIn = previousSpecsPrice.expire || defaultExpire; // bad typo bug line. Leave it like it is, this bug is a feature now.
        if (daemonHeight > 1315000) {
          previousExpireIn = appInfo.expire || defaultExpire;
        }
        const multiplierPrevious = previousExpireIn / defaultExpire;
        previousSpecsPrice *= multiplierPrevious;
        previousSpecsPrice = Number(previousSpecsPrice).toFixed(2);
        // what is the height difference
        const heightDifference = daemonHeight - appInfo.height;
        const perc = (previousExpireIn - heightDifference) / previousExpireIn;
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice);
        }
      }
      const appHWrequirements = totalAppHWRequirements(appSpecFormatted, 'bamf');
      if (appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        actualPriceToPay *= 0.8;
      } else if (appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
        actualPriceToPay *= 0.9;
      }
      let gSyncthgApp = false;
      if (appSpecFormatted.version <= 3) {
        gSyncthgApp = appSpecFormatted.containerData.includes('g:');
      } else {
        gSyncthgApp = appSpecFormatted.compose.find((comp) => comp.containerData.includes('g:'));
      }
      if (gSyncthgApp) {
        actualPriceToPay *= 0.8;
      }
      const marketplaceResponse = await axios.get('https://stats.runonflux.io/marketplace/listapps').catch((error) => log.error(error));
      let marketPlaceApps = [];
      if (marketplaceResponse && marketplaceResponse.data && marketplaceResponse.data.status === 'success') {
        marketPlaceApps = marketplaceResponse.data.data;
      } else {
        log.error('Unable to get marketplace information');
      }

      if (appSpecification.priceUSD) {
        if (appSpecification.priceUSD < actualPriceToPay) {
          log.info(appSpecification.priceUSD);
          log.info(actualPriceToPay);
          throw new Error('USD price is not valid');
        }
        actualPriceToPay = Number(appSpecification.priceUSD).toFixed(2);
      } else {
        const marketPlaceApp = marketPlaceApps.find((app) => appSpecFormatted.name.toLowerCase().startsWith(app.name.toLowerCase()));
        if (marketPlaceApp) {
          if (marketPlaceApp.multiplier > 1) {
            actualPriceToPay *= marketPlaceApp.multiplier;
          }
        }
        actualPriceToPay = Number(actualPriceToPay * appPrices[0].multiplier).toFixed(2);
        if (actualPriceToPay < appPrices[0].minUSDPrice) {
          actualPriceToPay = Number(appPrices[0].minUSDPrice).toFixed(2);
        }
      }
      let fiatRates;
      let fluxUSDRate;
      if (myShortCache.has('fluxRates')) {
        fluxUSDRate = myShortCache.get('fluxRates');
      } else {
        fiatRates = await axios.get('https://viprates.runonflux.io/rates', axiosConfig).catch((error) => log.error(error));
        if (fiatRates && fiatRates.data) {
          const rateObj = fiatRates.data[0].find((rate) => rate.code === 'USD');
          if (!rateObj) {
            throw new Error('Unable to get USD rate.');
          }
          const btcRateforFlux = fiatRates.data[1].FLUX;
          if (btcRateforFlux === undefined) {
            throw new Error('Unable to get Flux USD Price.');
          }
          fluxUSDRate = rateObj.rate * btcRateforFlux;
          myShortCache.set('fluxRates', fluxUSDRate);
        } else {
          fiatRates = await axios.get('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=zelcash', axiosConfig);
          if (fiatRates && fiatRates.data && fiatRates.data.zelcash && fiatRates.data.zelcash.usd) {
            fluxUSDRate = fiatRates.data.zelcash.usd;
            myShortCache.set('fluxRates', fluxUSDRate);
          } else {
            // eslint-disable-next-line prefer-destructuring
            fluxUSDRate = config.fluxapps.fluxUSDRate;
            myShortCache.set('fluxRates', fluxUSDRate);
          }
        }
      }
      const fluxPrice = Number(((actualPriceToPay / fluxUSDRate) * appPrices[0].fluxmultiplier));
      const fluxChainPrice = Number(await getAppFluxOnChainPrice(appSpecification));
      const price = {
        usd: Number(actualPriceToPay),
        flux: fluxChainPrice > fluxPrice ? Number(fluxChainPrice.toFixed(2)) : Number(fluxPrice.toFixed(2)),
        fluxDiscount: fluxChainPrice > fluxPrice ? 'Not possible to define discount' : Number(100 - (appPrices[0].fluxmultiplier * 100)),
      };
      const respondPrice = messageHelper.createDataMessage(price);
      return res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

/**
 * DEPRECATED: To get app price. Should be used getAppFiatAndFluxPrice method instead
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAppPrice(req, res) {
  return getAppFiatAndFluxPrice(req, res);
}

/**
 * To redeploy via API. Cannot be performed for individual components. Force defaults to false. Only accessible by app owner, admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function redeployAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    if (appname.includes('_')) {
      throw new Error('Component cannot be redeployed manually');
    }

    const redeploySkip = restoreInProgress.some((backupItem) => appname === backupItem);
    if (redeploySkip) {
      log.info(`Restore is running for ${appname}, redeploy skipped...`);
      return;
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    if (global) {
      executeAppGlobalCommand(appname, 'redeploy', req.headers.zelidauth, force); // do not wait
      const hardOrSoft = force ? 'hard' : 'soft';
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global ${hardOrSoft} redeploy`);
      res.json(appResponse);
      return;
    }

    const specifications = await getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }

    res.setHeader('Content-Type', 'application/json');

    if (force) {
      hardRedeploy(specifications, res);
    } else {
      softRedeploy(specifications, res);
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
 * To verify app registration parameters. Checks for correct format, specs and non-duplication of values/resources.
 * @param {express.Request} req Request
 * @param {express.Response} res Response
 * @returns {Promise<void>}
 */
async function verifyAppRegistrationParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const appSpecification = serviceHelper.ensureObject(body);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
      res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * To verify app update parameters. Checks for correct format, specs and non-duplication of values/resources.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Message.
 */
async function verifyAppUpdateParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;
      appSpecification = serviceHelper.ensureObject(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const decryptedSpecs = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(decryptedSpecs);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      const timestamp = Date.now();
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
      res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * To get price and specification information required for deployment.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function deploymentInformation(req, res) {
  try {
    // respond with information needed for application deployment regarding specification limitation and prices
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height;
    let deployAddr = config.fluxapps.address;
    if (daemonHeight >= config.fluxapps.appSpecsEnforcementHeights[6]) {
      deployAddr = config.fluxapps.addressMultisig;
    }
    if (daemonHeight >= config.fluxapps.multisigAddressChange) {
      deployAddr = config.fluxapps.addressMultisigB;
    }
    // search in chainparams db for chainmessages of p version
    const appPrices = await getChainParamsPriceUpdates();
    const { fluxapps: { minPort, maxPort } } = config;
    const information = {
      price: appPrices,
      appSpecsEnforcementHeights: config.fluxapps.appSpecsEnforcementHeights,
      address: deployAddr,
      portMin: minPort,
      portMax: maxPort,
      enterprisePorts: config.fluxapps.enterprisePorts,
      bannedPorts: config.fluxapps.bannedPorts,
      maxImageSize: config.fluxapps.maxImageSize,
      minimumInstances: config.fluxapps.minimumInstances,
      maximumInstances: config.fluxapps.maximumInstances,
      blocksLasting: config.fluxapps.blocksLasting,
      minBlocksAllowance: config.fluxapps.minBlocksAllowance,
      maxBlocksAllowance: config.fluxapps.maxBlocksAllowance,
      blocksAllowanceInterval: config.fluxapps.blocksAllowanceInterval,
    };
    const respondPrice = messageHelper.createDataMessage(information);
    res.json(respondPrice);
  } catch (error) {
    log.warn(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To reconstruct app messages hash collection. Checks if globalAppsMessages has the message or not.
 * @returns {string} Reconstruct success message.
 */
async function reconstructAppMessagesHashCollection() {
  // go through our appsHashesCollection and check if globalAppsMessages truly has the message or not
  const db = dbHelper.databaseConnection();
  const databaseApps = db.db(config.database.appsglobal.database);
  const databaseDaemon = db.db(config.database.daemon.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const permanentMessages = await dbHelper.findInDatabase(databaseApps, globalAppsMessages, query, projection);
  const appHashes = await dbHelper.findInDatabase(databaseDaemon, appsHashesCollection, query, projection);
  // eslint-disable-next-line no-restricted-syntax
  for (const appHash of appHashes) {
    const options = {};
    const queryUpdate = {
      hash: appHash.hash,
      txid: appHash.txid,
    };
    const permanentMessageFound = permanentMessages.find((message) => message.hash === appHash.hash);
    if (permanentMessageFound) {
      // update that we have the message
      const update = { $set: { message: true, messageNotFound: false } };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, queryUpdate, update, options);
    } else {
      // update that we do not have the message
      const update = { $set: { message: false, messageNotFound: false } };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, queryUpdate, update, options);
    }
  }
  return 'Reconstruct success';
}

/**
 * To reconstruct app messages hash collection via API. Checks if globalAppsMessages has the message or not. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reconstructAppMessagesHashCollectionAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const result = await reconstructAppMessagesHashCollection();
      const message = messageHelper.createSuccessMessage(result);
      res.json(message);
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

// there might be some apps reported by docker but not installed. In that case compare list and initiate force removal
async function forceAppRemovals() {
  try {
    const dockerAppsReported = await listAllApps();
    const dockerApps = dockerAppsReported.data;
    const installedAppsRes = await installedApps();
    const appsInstalled = installedAppsRes.data;
    const dockerAppsNames = dockerApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    const dockerAppsTrueNames = [];
    dockerAppsNames.forEach((appName) => {
      const name = appName.split('_')[1] || appName;
      dockerAppsTrueNames.push(name);
    });

    // array of unique main app names
    let dockerAppsTrueNameB = [...new Set(dockerAppsTrueNames)];
    dockerAppsTrueNameB = dockerAppsTrueNameB.filter((appName) => appName !== 'watchtower');
    // eslint-disable-next-line no-restricted-syntax
    for (const dApp of dockerAppsTrueNameB) {
      // check if app is in installedApps
      const appInstalledExists = appsInstalled.find((app) => app.name === dApp);
      if (!appInstalledExists) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(dApp);
        if (appDetails) {
          // it is global app
          // do removal
          log.warn(`${dApp} does not exist in installed app. Forcing removal.`);
          // eslint-disable-next-line no-await-in-loop
          await removeAppLocally(dApp, null, true, true, true).catch((error) => log.error(error)); // remove entire app
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(3 * 60 * 1000); // 3 mins
        } else {
          log.warn(`${dApp} does not exist in installed apps and global application specifications are missing. Forcing removal.`);
          // eslint-disable-next-line no-await-in-loop
          await removeAppLocally(dApp, null, true, true, true).catch((error) => log.error(error)); // remove entire app, as of missing specs will be done based on latest app specs message
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(3 * 60 * 1000); // 3 mins
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function stopSyncthingApp(appComponentName, res, isBackRestore) {
  try {
    const identifier = appComponentName;
    const appId = dockerService.getAppIdentifier(identifier);
    if (!isBackRestore && receiveOnlySyncthingAppsCache.has(appId)) {
      receiveOnlySyncthingAppsCache.delete(appId);
    }
    const folder = `${appsFolder + appId}`;
    const allSyncthingFolders = await syncthingService.getConfigFolders();
    if (allSyncthingFolders.status === 'error') {
      return;
    }
    let folderId = null;
    // eslint-disable-next-line no-restricted-syntax
    for (const syncthingFolder of allSyncthingFolders.data) {
      if (syncthingFolder.path === folder || syncthingFolder.path.includes(`${folder}/`)) {
        folderId = syncthingFolder.id;
      }
      if (folderId) {
        const adjustSyncthingA = {
          status: `Stopping syncthing on folder ${syncthingFolder.path}...`,
        };
        // remove folder from syncthing
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigFolders('delete', undefined, folderId);
        // check if restart is needed
        // eslint-disable-next-line no-await-in-loop
        const restartRequired = await syncthingService.getConfigRestartRequired();
        if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
          log.info('Syncthing restart required, restarting...');
          // eslint-disable-next-line no-await-in-loop
          await syncthingService.systemRestart();
        }
        const adjustSyncthingB = {
          status: 'Syncthing adjusted',
        };
        log.info(adjustSyncthingA);
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingA));
          if (res.flush) res.flush();
        }
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingB));
          if (res.flush) res.flush();
        }
      }
      folderId = null;
    }
  } catch (error) {
    log.error(error);
  }
}

async function getDeviceID(fluxIP) {
  try {
    const axiosConfig = {
      timeout: 5000,
    };
    const response = await axios.get(`http://${fluxIP}/syncthing/deviceid`, axiosConfig);
    if (response.data.status === 'success') {
      return response.data.data;
    }
    throw new Error(`Unable to get deviceid from ${fluxIP}`);
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * To restart an app. Restarts each component if the app is using Docker Compose.
 * Function to ba called after synthing database revert that can cause no data to show up inside container despite it exists on mountpoint.
 * @param {string} appname Request.
 */
async function appDockerRestart(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerRestart(appname);
      startAppMonitoring(appname);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerRestart(appname);
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To start an app. Start each component if the app is using Docker Compose.
 * @param {string} appname Request.
 */
async function appDockerStart(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerStart(appname);
      startAppMonitoring(appname);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStart(appname);
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStart(`${appComponent.name}_${appSpecs.name}`);
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To stop an app. Stop each component if the app is using Docker Compose.
 * Function to ba called before starting synthing in r: mode.
 * @param {string} appname Request.
 */
async function appDockerStop(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerStop(appname);
      stopAppMonitoring(appname, false);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStop(appname);
        stopAppMonitoring(appname, false);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
          stopAppMonitoring(`${appComponent.name}_${appSpecs.name}`, false);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To delete all data inside app mount point
 * Function to ba called before starting synthing in r: mode.
 * @param {string} appname Request.
 */
async function appDeleteDataInMountPoint(appname) {
  try {
    const execDIR = `sudo rm -fr ${appsFolder + appname}/appdata/*`;
    await cmdAsync(execDIR);
  } catch (error) {
    log.error(error);
  }
}

let updateSyncthingRunning = false;
let syncthingAppsFirstRun = true;
// update syncthing configuration for locally installed apps
async function syncthingApps() {
  try {
    // do not run if installationInProgress or removalInProgress
    if (installationInProgress || removalInProgress || updateSyncthingRunning) {
      return;
    }
    updateSyncthingRunning = true;
    // get list of all installed apps
    const appsInstalled = await installedApps();
    if (appsInstalled.status === 'error') {
      return;
    }
    // go through every containerData of all components of every app
    const devicesIds = [];
    const devicesConfiguration = [];
    const folderIds = [];
    const foldersConfiguration = [];
    const newFoldersConfiguration = [];
    const myDeviceId = await syncthingService.getDeviceId();

    if (!myDeviceId) {
      log.error('syncthingApps - Failed to get myDeviceId');
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      log.error('syncthingApps - Failed to get myIP');
      return;
    }

    const allFoldersResp = await syncthingService.getConfigFolders();
    const allDevicesResp = await syncthingService.getConfigDevices();
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      const backupSkip = backupInProgress.some((backupItem) => installedApp.name === backupItem);
      const restoreSkip = restoreInProgress.some((backupItem) => installedApp.name === backupItem);
      if (backupSkip || restoreSkip) {
        log.info(`syncthingApps - Backup is running for ${installedApp.name}, syncthing disabled for that app`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (installedApp.version <= 3) {
        const containersData = installedApp.containerData.split('|');
        // eslint-disable-next-line no-restricted-syntax
        for (let i = 0; i < containersData.length; i += 1) {
          const container = containersData[i];
          const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
          if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
            const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
            const identifier = installedApp.name;
            const appId = dockerService.getAppIdentifier(identifier);
            const folder = `${appsFolder + appId + containerFolder}`;
            const id = appId;
            const label = appId;
            const devices = [{ deviceID: myDeviceId }];
            const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
            // eslint-disable-next-line no-await-in-loop
            await cmdAsync(execDIRst);
            // eslint-disable-next-line no-await-in-loop
            let locations = await appLocation(installedApp.name);
            locations.sort((a, b) => {
              if (a.ip < b.ip) {
                return -1;
              }
              if (a.ip > b.ip) {
                return 1;
              }
              return 0;
            });
            locations = locations.filter((loc) => loc.ip !== myIP);
            // eslint-disable-next-line no-restricted-syntax
            for (const appInstance of locations) {
              const ip = appInstance.ip.split(':')[0];
              const port = appInstance.ip.split(':')[1] || '16127';
              const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
              const name = `${ip}:${port}`;
              let deviceID;
              if (syncthingDevicesIDCache.has(name)) {
                deviceID = syncthingDevicesIDCache.get(name);
              } else {
                // eslint-disable-next-line no-await-in-loop
                deviceID = await getDeviceID(name);
                if (deviceID) {
                  syncthingDevicesIDCache.set(name, deviceID);
                }
              }
              if (deviceID) {
                if (deviceID !== myDeviceId) { // skip my id, already present
                  const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
                  if (!folderDeviceExists) { // double check if not multiple the same ids
                    devices.push({ deviceID });
                  }
                }
                const deviceExists = devicesConfiguration.find((device) => device.name === name);
                if (!deviceExists) {
                  const newDevice = {
                    deviceID,
                    name,
                    addresses,
                    autoAcceptFolders: true,
                  };
                  devicesIds.push(deviceID);
                  if (deviceID !== myDeviceId) {
                    const syncthingDeviceExists = allDevicesResp.data.find((device) => device.name === name);
                    if (!syncthingDeviceExists) {
                      devicesConfiguration.push(newDevice);
                    }
                  }
                }
              }
            }
            const syncthingFolder = {
              id,
              label,
              path: folder,
              devices,
              paused: false,
              type: 'sendreceive',
              rescanIntervalS: 900,
              maxConflicts: 0,
            };
            const syncFolder = allFoldersResp.data.find((x) => x.id === id);
            if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              if (syncthingAppsFirstRun) {
                if (!syncFolder) {
                  log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                  syncthingFolder.type = 'receiveonly';
                  const cache = {
                    numberOfExecutions: 1,
                  };
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerStop(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                  // eslint-disable-next-line no-await-in-loop
                  await appDeleteDataInMountPoint(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                } else {
                  const cache = {
                    restarted: true,
                  };
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                  if (syncFolder.type === 'receiveonly') {
                    cache.restarted = false;
                    cache.numberOfExecutions = 1;
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                  }
                }
              } else if (receiveOnlySyncthingAppsCache.has(appId) && !receiveOnlySyncthingAppsCache.get(appId).restarted) {
                const cache = receiveOnlySyncthingAppsCache.get(appId);

                // eslint-disable-next-line no-await-in-loop
                const runningAppList = await appLocation(installedApp.name);
                runningAppList.sort((a, b) => {
                  if (!a.runningSince && b.runningSince) {
                    return -1;
                  }
                  if (a.runningSince && !b.runningSince) {
                    return 1;
                  }
                  if (a.runningSince < b.runningSince) {
                    return -1;
                  }
                  if (a.runningSince > b.runningSince) {
                    return 1;
                  }
                  if (a.broadcastedAt < b.broadcastedAt) {
                    return -1;
                  }
                  if (a.broadcastedAt > b.broadcastedAt) {
                    return 1;
                  }
                  if (a.ip < b.ip) {
                    return -1;
                  }
                  if (a.ip > b.ip) {
                    return 1;
                  }
                  return 0;
                });
                if (myIP) {
                  const index = runningAppList.findIndex((x) => x.ip === myIP);
                  let numberOfExecutionsRequired = 2;
                  if (index > 0) {
                    numberOfExecutionsRequired = 2 + 10 * index;
                  }
                  if (numberOfExecutionsRequired > 60) {
                    numberOfExecutionsRequired = 60;
                  }
                  cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                  syncthingFolder.type = 'receiveonly';
                  cache.numberOfExecutions += 1;
                  if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                    syncthingFolder.type = 'sendreceive';
                  } else if (cache.numberOfExecutions >= cache.numberOfExecutionsRequired + 1) {
                    log.info(`syncthingApps - changing syncthing type to sendreceive for appIdentifier ${appId}`);
                    syncthingFolder.type = 'sendreceive';
                    if (containerDataFlags.includes('r')) {
                      log.info(`syncthingApps - starting appIdentifier ${appId}`);
                      // eslint-disable-next-line no-await-in-loop
                      await appDockerRestart(id);
                    }
                    cache.restarted = true;
                  }
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                }
              } else if (!receiveOnlySyncthingAppsCache.has(appId)) {
                log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                syncthingFolder.type = 'receiveonly';
                const cache = {
                  numberOfExecutions: 1,
                };
                receiveOnlySyncthingAppsCache.set(appId, cache);
                // eslint-disable-next-line no-await-in-loop
                await appDockerStop(id);
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(500);
                // eslint-disable-next-line no-await-in-loop
                await appDeleteDataInMountPoint(id);
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(500);
              }
            }
            folderIds.push(id);
            foldersConfiguration.push(syncthingFolder);
            if (!syncFolder) {
              newFoldersConfiguration.push(syncthingFolder);
            } else if (syncFolder && (syncFolder.maxConflicts !== 0 || syncFolder.paused || syncFolder.type !== syncthingFolder.type || JSON.stringify(syncFolder.devices) !== JSON.stringify(syncthingFolder.devices))) {
              newFoldersConfiguration.push(syncthingFolder);
            }
          }
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const installedComponent of installedApp.compose) {
          const containersData = installedComponent.containerData.split('|');
          // eslint-disable-next-line no-restricted-syntax
          for (let i = 0; i < containersData.length; i += 1) {
            const container = containersData[i];
            const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
            if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
              const identifier = `${installedComponent.name}_${installedApp.name}`;
              const appId = dockerService.getAppIdentifier(identifier);
              const folder = `${appsFolder + appId + containerFolder}`;
              const id = appId;
              const label = appId;
              const devices = [{ deviceID: myDeviceId }];
              const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
              // eslint-disable-next-line no-await-in-loop
              await cmdAsync(execDIRst);
              // eslint-disable-next-line no-await-in-loop
              let locations = await appLocation(installedApp.name);
              locations.sort((a, b) => {
                if (a.ip < b.ip) {
                  return -1;
                }
                if (a.ip > b.ip) {
                  return 1;
                }
                return 0;
              });
              locations = locations.filter((loc) => loc.ip !== myIP);
              // eslint-disable-next-line no-restricted-syntax
              for (const appInstance of locations) {
                const ip = appInstance.ip.split(':')[0];
                const port = appInstance.ip.split(':')[1] || '16127';
                const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
                const name = `${ip}:${port}`;
                let deviceID;
                if (syncthingDevicesIDCache.has(name)) {
                  deviceID = syncthingDevicesIDCache.get(name);
                } else {
                  // eslint-disable-next-line no-await-in-loop
                  deviceID = await getDeviceID(name);
                  if (deviceID) {
                    syncthingDevicesIDCache.set(name, deviceID);
                  }
                }
                if (deviceID) {
                  if (deviceID !== myDeviceId) { // skip my id, already present
                    const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
                    if (!folderDeviceExists) { // double check if not multiple the same ids
                      devices.push({ deviceID });
                    }
                  }
                  const deviceExists = devicesConfiguration.find((device) => device.name === name);
                  if (!deviceExists) {
                    const newDevice = {
                      deviceID,
                      name,
                      addresses,
                      autoAcceptFolders: true,
                    };
                    devicesIds.push(deviceID);
                    if (deviceID !== myDeviceId) {
                      const syncthingDeviceExists = allDevicesResp.data.find((device) => device.name === name);
                      if (!syncthingDeviceExists) {
                        devicesConfiguration.push(newDevice);
                      }
                    }
                  }
                }
              }
              const syncthingFolder = {
                id,
                label,
                path: folder,
                devices,
                paused: false,
                type: 'sendreceive',
                rescanIntervalS: 900,
                maxConflicts: 0,
              };
              const syncFolder = allFoldersResp.data.find((x) => x.id === id);
              if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
                if (syncthingAppsFirstRun) {
                  if (!syncFolder) {
                    log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                    syncthingFolder.type = 'receiveonly';
                    const cache = {
                      numberOfExecutions: 1,
                    };
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                    // eslint-disable-next-line no-await-in-loop
                    await appDockerStop(id);
                    // eslint-disable-next-line no-await-in-loop
                    await serviceHelper.delay(500);
                    // eslint-disable-next-line no-await-in-loop
                    await appDeleteDataInMountPoint(id);
                    // eslint-disable-next-line no-await-in-loop
                    await serviceHelper.delay(500);
                  } else {
                    const cache = {
                      restarted: true,
                    };
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                    if (syncFolder.type === 'receiveonly') {
                      cache.restarted = false;
                      cache.numberOfExecutions = 1;
                      receiveOnlySyncthingAppsCache.set(appId, cache);
                    }
                  }
                } else if (receiveOnlySyncthingAppsCache.has(appId) && !receiveOnlySyncthingAppsCache.get(appId).restarted) {
                  const cache = receiveOnlySyncthingAppsCache.get(appId);
                  // eslint-disable-next-line no-await-in-loop
                  const runningAppList = await appLocation(installedApp.name);
                  log.info(`syncthingApps - appIdentifier ${appId} is running on nodes ${JSON.stringify(runningAppList)}`);
                  runningAppList.sort((a, b) => {
                    if (!a.runningSince && b.runningSince) {
                      return -1;
                    }
                    if (a.runningSince && !b.runningSince) {
                      return 1;
                    }
                    if (a.runningSince < b.runningSince) {
                      return -1;
                    }
                    if (a.runningSince > b.runningSince) {
                      return 1;
                    }
                    if (a.broadcastedAt < b.broadcastedAt) {
                      return -1;
                    }
                    if (a.broadcastedAt > b.broadcastedAt) {
                      return 1;
                    }
                    if (a.ip < b.ip) {
                      return -1;
                    }
                    if (a.ip > b.ip) {
                      return 1;
                    }
                    return 0;
                  });
                  if (myIP) {
                    const index = runningAppList.findIndex((x) => x.ip === myIP);
                    log.info(`syncthingApps - appIdentifier ${appId} is node index ${index}`);
                    let numberOfExecutionsRequired = 2;
                    if (index > 0) {
                      numberOfExecutionsRequired = 2 + 10 * index;
                    }
                    if (numberOfExecutionsRequired > 60) {
                      numberOfExecutionsRequired = 60;
                    }
                    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                    syncthingFolder.type = 'receiveonly';
                    cache.numberOfExecutions += 1;
                    log.info(`syncthingApps - appIdentifier ${appId} execution ${cache.numberOfExecutions} of ${cache.numberOfExecutionsRequired + 1} to start the app`);
                    if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                      syncthingFolder.type = 'sendreceive';
                    } else if (cache.numberOfExecutions === cache.numberOfExecutionsRequired + 1) {
                      log.info(`syncthingApps - starting appIdentifier ${appId}`);
                      syncthingFolder.type = 'sendreceive';
                      if (containerDataFlags.includes('r')) {
                        log.info(`syncthingApps - starting appIdentifier ${appId}`);
                        // eslint-disable-next-line no-await-in-loop
                        await appDockerRestart(id);
                      }
                      cache.restarted = true;
                    }
                    receiveOnlySyncthingAppsCache.set(appId, cache);
                  }
                } else if (!receiveOnlySyncthingAppsCache.has(appId)) {
                  log.info(`syncthingApps - stopping and cleaning appIdentifier ${appId}`);
                  syncthingFolder.type = 'receiveonly';
                  const cache = {
                    numberOfExecutions: 1,
                  };
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerStop(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                  // eslint-disable-next-line no-await-in-loop
                  await appDeleteDataInMountPoint(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                }
              }
              folderIds.push(id);
              foldersConfiguration.push(syncthingFolder);
              if (!syncFolder) {
                newFoldersConfiguration.push(syncthingFolder);
              } else if (syncFolder && (syncFolder.maxConflicts !== 0 || syncFolder.paused || syncFolder.type !== syncthingFolder.type || JSON.stringify(syncFolder.devices) !== JSON.stringify(syncthingFolder.devices))) {
                newFoldersConfiguration.push(syncthingFolder);
              }
            }
          }
        }
      }
    }

    // remove folders that should not be synced anymore (this shall actually not trigger)
    const nonUsedFolders = allFoldersResp.data.filter((syncthingFolder) => !folderIds.includes(syncthingFolder.id));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedFolder of nonUsedFolders) {
      log.info(`syncthingApps - Removing unused Syncthing of folder ${nonUsedFolder.id}`);
      // eslint-disable-next-line no-await-in-loop
      await syncthingService.adjustConfigFolders('delete', undefined, nonUsedFolder.id);
    }
    // remove obsolete devices
    const nonUsedDevices = allDevicesResp.data.filter((syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedDevice of nonUsedDevices) {
      // exclude our deviceID
      if (nonUsedDevice.deviceID !== myDeviceId) {
        log.info(`syncthingApps - Removing unused Syncthing device ${nonUsedDevice.deviceID}`);
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigDevices('delete', undefined, nonUsedDevice.deviceID);
      }
    }
    // finally apply all new configuration
    // now we have new accurate devicesConfiguration and foldersConfiguration
    // add more of current devices
    // excludes our current deviceID adjustment
    if (devicesConfiguration.length >= 0) {
      await syncthingService.adjustConfigDevices('put', devicesConfiguration);
    }
    if (newFoldersConfiguration.length >= 0) {
      await syncthingService.adjustConfigFolders('put', newFoldersConfiguration);
    }
    // all configuration changes applied

    // check for errors in folders and if true reset that index database
    for (let i = 0; i < foldersConfiguration.length; i += 1) {
      const folder = foldersConfiguration[i];
      // eslint-disable-next-line no-await-in-loop
      const folderError = await syncthingService.getFolderIdErrors(folder.id);
      if (folderError && folderError.status === 'success' && folderError.data.errors && folderError.data.errors.length > 0) {
        log.error(`syncthingApps - Errors detected on syncthing folderId:${folder.id} - app is going to be uninstalled`);
        log.error(folderError);
        let appName = folder.id;
        if (appName.contains('_')) {
          appName = appName.split('_')[1];
        }
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(appName, null, true, false, true);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(5 * 1000);
      }
    }
    // check if restart is needed
    const restartRequired = await syncthingService.getConfigRestartRequired();
    if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
      log.info('syncthingApps - New configuration applied. Syncthing restart required, restarting...');
      await syncthingService.systemRestart();
    }
  } catch (error) {
    log.error(error);
  } finally {
    updateSyncthingRunning = false;
    syncthingAppsFirstRun = false;
    await serviceHelper.delay(30 * 1000);
    syncthingApps();
  }
}

// function responsable for starting and stopping apps to have only one instance running as master
async function masterSlaveApps() {
  try {
    masterSlaveAppsRunning = true;
    // do not run if installationInProgress or removalInProgress
    if (installationInProgress || removalInProgress) {
      return;
    }
    // get list of all installed apps
    const appsInstalled = await installedApps();
    // eslint-disable-next-line no-await-in-loop
    const runningAppsRes = await listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const runningApps = runningAppsRes.data;
    if (appsInstalled.status === 'error') {
      return;
    }
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    const agent = new https.Agent({
      rejectUnauthorized: false,
    });
    const axiosOptions = {
      timeout: 10000,
      httpsAgent: agent,
    };
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      let fdmOk = true;
      let identifier;
      let needsToBeChecked = false;
      let appId;
      const backupSkip = backupInProgress.some((backupItem) => installedApp.name === backupItem);
      const restoreSkip = restoreInProgress.some((backupItem) => installedApp.name === backupItem);
      if (backupSkip || restoreSkip) {
        log.info(`masterSlaveApps: Backup/Restore is running for ${installedApp.name}, syncthing masterSlave check is disabled for that app`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (installedApp.version <= 3) {
        identifier = installedApp.name;
        appId = dockerService.getAppIdentifier(identifier);
        needsToBeChecked = installedApp.containerData.includes('g:') && receiveOnlySyncthingAppsCache.has(appId) && receiveOnlySyncthingAppsCache.get(appId).restarted;
      } else {
        const componentUsingMasterSlave = installedApp.compose.find((comp) => comp.containerData.includes('g:'));
        if (componentUsingMasterSlave) {
          identifier = `${componentUsingMasterSlave.name}_${installedApp.name}`;
          appId = dockerService.getAppIdentifier(identifier);
          needsToBeChecked = receiveOnlySyncthingAppsCache.has(appId) && receiveOnlySyncthingAppsCache.get(appId).restarted;
        }
      }
      if (needsToBeChecked) {
        let fdmIndex = 1;
        const appNameFirstLetterLowerCase = installedApp.name.substring(0, 1).toLowerCase();
        if (appNameFirstLetterLowerCase.match(/[h-n]/)) {
          fdmIndex = 2;
        } else if (appNameFirstLetterLowerCase.match(/[o-u]/)) {
          fdmIndex = 3;
        } else if (appNameFirstLetterLowerCase.match(/[v-z]/)) {
          fdmIndex = 4;
        }
        let ip = null;
        // eslint-disable-next-line no-await-in-loop
        let fdmEUData = await serviceHelper.axiosGet(`https://fdm-fn-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name}apprunonfluxio;json;norefresh`, axiosOptions).catch((error) => {
          log.error(`masterSlaveApps: Failed to reach EU FDM with error: ${error}`);
          fdmOk = false;
        });
        if (fdmOk) {
          fdmEUData = fdmEUData.data;
          if (fdmEUData && fdmEUData.length > 0) {
            // eslint-disable-next-line no-restricted-syntax
            for (const fdmData of fdmEUData) {
              const serviceName = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${installedApp.name.toLowerCase()}apprunonfluxio`));
              if (serviceName) {
                const ipElement = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                if (ipElement) {
                  ip = ipElement.value.value;
                }
                break;
              }
            }
          }
        }
        if (!ip) {
          fdmOk = true;
          // eslint-disable-next-line no-await-in-loop
          let fdmUSAData = await serviceHelper.axiosGet(`https://fdm-usa-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name}apprunonfluxio;json;norefresh`, axiosOptions).catch((error) => {
            log.error(`masterSlaveApps: Failed to reach USA FDM with error: ${error}`);
            fdmOk = false;
          });
          if (fdmOk) {
            fdmUSAData = fdmUSAData.data;
            if (fdmUSAData && fdmUSAData.length > 0) {
              // eslint-disable-next-line no-restricted-syntax
              for (const fdmData of fdmUSAData) {
                const serviceName = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${installedApp.name.toLowerCase()}apprunonfluxio`));
                if (serviceName) {
                  const ipElement = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                  if (ipElement) {
                    ip = ipElement.value.value;
                  }
                  break;
                }
              }
            }
          }
        }
        if (!ip) {
          fdmOk = true;
          // eslint-disable-next-line no-await-in-loop
          let fdmASIAData = await serviceHelper.axiosGet(`https://fdm-sg-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name}apprunonfluxio;json;norefresh`, axiosOptions).catch((error) => {
            log.error(`masterSlaveApps: Failed to reach ASIA FDM with error: ${error}`);
            fdmOk = false;
          });
          if (fdmOk) {
            fdmASIAData = fdmASIAData.data;
            if (fdmASIAData && fdmASIAData.length > 0) {
              // eslint-disable-next-line no-restricted-syntax
              for (const fdmData of fdmASIAData) {
                const serviceName = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${installedApp.name.toLowerCase()}apprunonfluxio`));
                if (serviceName) {
                  const ipElement = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                  if (ipElement) {
                    ip = ipElement.value.value;
                  }
                  break;
                }
              }
            }
          }
        }
        if (fdmOk) {
          // no ip means there was no row with ip on fdm
          // down means there was a row ip with status down
          // eslint-disable-next-line no-await-in-loop
          let myIP = await fluxNetworkHelper.getMyFluxIPandPort();
          if (myIP) {
            if (myIP.indexOf(':') < 0) {
              myIP += ':16127';
            }
            if ((!ip)) {
              log.info(`masterSlaveApps: app:${installedApp.name} has currently no primary set`);
              if (!runningAppsNames.includes(identifier)) {
                // eslint-disable-next-line no-await-in-loop
                const runningAppList = await appLocation(installedApp.name);
                runningAppList.sort((a, b) => {
                  if (!a.runningSince && b.runningSince) {
                    return -1;
                  }
                  if (a.runningSince && !b.runningSince) {
                    return 1;
                  }
                  if (a.runningSince < b.runningSince) {
                    return -1;
                  }
                  if (a.runningSince > b.runningSince) {
                    return 1;
                  }
                  if (a.ip < b.ip) {
                    return -1;
                  }
                  if (a.ip > b.ip) {
                    return 1;
                  }
                  return 0;
                });
                const index = runningAppList.findIndex((x) => x.ip.split(':')[0] === myIP.split(':')[0]);
                if (index === 0 && !mastersRunningGSyncthingApps.has(identifier)) {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index}`);
                } else if (!timeTostartNewMasterApp.has(identifier) && mastersRunningGSyncthingApps.has(identifier) && mastersRunningGSyncthingApps.get(identifier) !== myIP) {
                  const { CancelToken } = axios;
                  const source = CancelToken.source();
                  let isResolved = false;
                  const timeout = 5 * 1000; // 5 seconds
                  setTimeout(() => {
                    if (!isResolved) {
                      source.cancel('Operation canceled by the user.');
                    }
                  }, timeout * 2);
                  const url = mastersRunningGSyncthingApps.get(identifier);
                  const ipToCheckAppRunning = url.split(':')[0];
                  const portToCheckAppRunning = url.split(':')[1] || '16127';
                  // eslint-disable-next-line no-await-in-loop
                  const response = await axios.get(`http://${ipToCheckAppRunning}:${portToCheckAppRunning}/apps/listrunningapps`, { timeout, cancelToken: source.token });
                  isResolved = true;
                  const appsRunning = response.data.data;
                  if (appsRunning.find((app) => app.Names[0].includes(installedApp.name))) {
                    log.info(`masterSlaveApps: app:${installedApp.name} is not on fdm but previous master is running it at: ${url}`);
                    return;
                  }
                  // if it was running before on this node was removed from fdm, app was stopped or node rebooted, we will only start the app on a different node
                  if (index === 0) {
                    appDockerRestart(installedApp.name);
                    log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index}`);
                  } else {
                    const previousMasterIndex = runningAppList.findIndex((x) => x.ip.split(':')[0] === mastersRunningGSyncthingApps.get(identifier).split(':')[0]);
                    let timetoStartApp = Date.now();
                    if (previousMasterIndex >= 0) {
                      log.info(`masterSlaveApps: app:${installedApp.name} had primary running at index: ${previousMasterIndex}`);
                      if (index > previousMasterIndex) {
                        timetoStartApp += (index - 1) * 3 * 60 * 1000;
                      } else {
                        timetoStartApp += index * 3 * 60 * 1000;
                      }
                    } else {
                      timetoStartApp += index * 3 * 60 * 1000;
                    }
                    if (timetoStartApp <= Date.now()) {
                      appDockerRestart(installedApp.name);
                      log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index}`);
                    } else {
                      log.info(`masterSlaveApps: will start docker app:${installedApp.name} at ${timetoStartApp.toString()}`);
                      timeTostartNewMasterApp.set(identifier, timetoStartApp);
                    }
                  }
                } else if (timeTostartNewMasterApp.has(identifier) && timeTostartNewMasterApp.get(identifier) <= Date.now()) {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index} that was scheduled to start at ${timeTostartNewMasterApp.get(identifier).toString()}`);
                } else {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: no previous information about primary, starting docker app:${installedApp.name}`);
                }
              }
            } else {
              mastersRunningGSyncthingApps.set(identifier, ip);
              if (timeTostartNewMasterApp.has(identifier)) {
                log.info(`masterSlaveApps: app:${installedApp.name} removed from timeTostartNewMasterApp cache, already started on another standby node`);
                timeTostartNewMasterApp.delete(identifier);
              }
              if (myIP !== ip && runningAppsNames.includes(identifier)) {
                appDockerStop(installedApp.name);
                log.info(`masterSlaveApps: stopping docker app:${installedApp.name} it's running on ip:${ip} and myIP is: ${myIP}`);
              } else if (myIP === ip && !runningAppsNames.includes(identifier)) {
                appDockerRestart(installedApp.name);
                log.info(`masterSlaveApps: starting docker app:${installedApp.name}`);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(`masterSlaveApps: ${error}`);
  } finally {
    masterSlaveAppsRunning = false;
    await serviceHelper.delay(30 * 1000);
    masterSlaveApps();
  }
}

// function responsable for monitoring apps using sharedDB project
async function monitorSharedDBApps() {
  try {
    // do not run if installationInProgress or removalInProgress
    if (installationInProgress || removalInProgress) {
      return;
    }
    // get list of all installed apps
    const appsInstalled = await installedApps();

    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data.filter((app) => app.version > 3)) {
      const componentUsingSharedDB = installedApp.compose.find((comp) => comp.repotag.includes('runonflux/shared-db'));
      if (componentUsingSharedDB) {
        log.info(`monitorSharedDBApps: Found app ${installedApp.name} using sharedDB`);
        if (componentUsingSharedDB.ports && componentUsingSharedDB.ports.length > 0) {
          const apiPort = componentUsingSharedDB.ports[componentUsingSharedDB.ports.length - 1]; // it's the last port from the shareddb that is the api port
          // eslint-disable-next-line no-await-in-loop
          const url = `http://localhost:${apiPort}/status`;
          log.info(`monitorSharedDBApps: ${installedApp.name} going to check operator status on url ${url}`);
          // eslint-disable-next-line no-await-in-loop
          const operatorStatus = await serviceHelper.axiosGet(url).catch((error) => log.error(`monitorSharedDBApps: ${installedApp.name} operatorStatus error: ${error}`));
          if (operatorStatus && operatorStatus.data) {
            if (operatorStatus.data.status === 'UNINSTALL') {
              log.info(`monitorSharedDBApps: ${installedApp.name} operatorStatus is UNINSTALL, going to uninstall the app`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(installedApp.name, null, true, false, true);
            } else {
              log.info(`monitorSharedDBApps: ${installedApp.name} operatorStatus is ${operatorStatus.data.status}`);
            }
          } else {
            log.info(`monitorSharedDBApps: ${installedApp.name} operatorStatus is not set`);
          }
        }
      }
    }
  } catch (error) {
    log.error(`monitorSharedDBApps: ${error}`);
  } finally {
    await serviceHelper.delay(5 * 60 * 1000);
    monitorSharedDBApps();
  }
}

let dosState = 0; // we can start at bigger number later
let dosMessage = null;
let dosMountMessage = '';
let dosDuplicateAppMessage = '';

/**
 * To get DOS state.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getAppsDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  const response = messageHelper.createDataMessage(data);
  return res ? res.json(response) : response;
}

async function signCheckAppData(message) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey();
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

/**
 * Periodically call other nodes to stablish a connection with the ports I have open on UPNP to remain OPEN
*/
async function callOtherNodeToKeepUpnpPortsOpen() {
  try {
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    let myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      return;
    }

    const randomSocketAddress = await networkStateService.getRandomSocketAddress(myIP);

    if (!randomSocketAddress) return;

    const [askingIP, askingIpPort = '16127'] = randomSocketAddress.split(':');

    myIP = myIP.split(':')[0];

    if (myIP === askingIP) {
      callOtherNodeToKeepUpnpPortsOpen();
      return;
    }
    if (failedNodesTestPortsCache.has(askingIP)) {
      callOtherNodeToKeepUpnpPortsOpen();
      return;
    }

    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      return;
    }
    const apps = installedAppsRes.data;
    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    const ports = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version === 1) {
        ports.push(+app.port);
      } else if (app.version <= 3) {
        app.ports.forEach((port) => {
          ports.push(+port);
        });
      } else {
        app.compose.forEach((component) => {
          component.ports.forEach((port) => {
            ports.push(+port);
          });
        });
      }
    }

    // We don't add the api port, as the remote node will callback to our
    // api port to make sure it can connect before testing any other ports
    // this is so that we know the remote end can reach us. I also removed
    // -2,-3,-4, +3 as they are currently not used.
    ports.push(apiPort - 1);
    // ports.push(apiPort - 2);
    // ports.push(apiPort - 3);
    // ports.push(apiPort - 4);
    ports.push(apiPort - 5);
    ports.push(apiPort + 1);
    ports.push(apiPort + 2);
    // ports.push(apiPort + 3);

    const axiosConfig = {
      timeout: 5_000,
    };

    const dataUPNP = {
      ip: myIP,
      apiPort,
      ports,
      pubKey,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const stringData = JSON.stringify(dataUPNP);
    const signature = await signCheckAppData(stringData);
    dataUPNP.signature = signature;

    const logMsg = `callOtherNodeToKeepUpnpPortsOpen - calling ${askingIP}:${askingIpPort} to test ports: ${ports}`;
    log.info(logMsg);

    const url = `http://${askingIP}:${askingIpPort}/flux/keepupnpportsopen`;
    await axios.post(url, dataUPNP, axiosConfig).catch(() => {
      // callOtherNodeToKeepUpnpPortsOpen();
    });
  } catch (error) {
    log.error(error);
  }
}

/**
 *
 * @param {Number} testingPort The target port
 * @param {http.Server} testHttpServer The test http server
 * @param {{skipFirewall?: Boolean, skipUpnp?: Boolean, skipHttpServer?: Boolean}} options Options
 */
async function handleTestShutdown(testingPort, testHttpServer, options = {}) {
  const skipFirewall = options.skipFirewall || false;
  const skipUpnp = options.skipUpnp || false;
  const skipHttpServer = options.skipHttpServer || false;

  // fail open on the firewall check
  const updateFirewall = skipFirewall
    ? false
    : isArcane
    || await fluxNetworkHelper.isFirewallActive().catch(() => true);

  if (updateFirewall) {
    await fluxNetworkHelper
      .deleteAllowPortRule(testingPort)
      .catch((e) => log.error(e));
  }

  if (!skipUpnp) {
    await upnpService
      .removeMapUpnpPort(testingPort, 'Flux_Test_App')
      .catch((e) => log.error(e));
  }

  if (!skipHttpServer) {
    testHttpServer.close((err) => {
      if (err) {
        log.error(`testHttpServer shutdown failed: ${err.message}`);
      }
    });
  }
}

let testingPort = null;
let originalPortFailed = null;
let lastUPNPMapFailed = false;
let nextTestingPort = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
const portsNotWorking = new Set();

/**
 * Periodically check that our applications port range is usable. I.e, we open
 * the firewall, map the port (if UPnP) and set up a TCP listener on the port.
 * We then request another node validate that we respond with a SYN-ACK when
 * they send a SYN.
 * @returns {Promise<void>}
 */
async function checkMyAppsAvailability() {
  /**
   * default timeout = 1h     - Normal state  \
   * error timeout = 60s      - Something unexpected happened  \
   * failure timeout = 15s    - Our port testing failed  \
   * dos timeout = 5m         - We're DOS  \
   * app error = 4m           - Something on the fluxNode is broken
   */
  const timeouts = {
    default: 3_600_000,
    error: 60_000,
    failure: 15_000,
    dos: 300_000,
    appError: 240_000,
  };

  /**
   * dos              - Dos is a number between 0-100. The threshold is the upper limit
   * ports high edge  - The upper limit after which the dos counter will increment
   * ports low edge   - The lower limit after which the node can resume normal state
   */
  const thresholds = {
    dos: 100,
    portsHighEdge: 100,
    portsLowEdge: 80,
  };

  if (dosMountMessage || dosDuplicateAppMessage) {
    dosMessage = dosMountMessage || dosDuplicateAppMessage;
    dosState = thresholds.dos;

    await serviceHelper.delay(timeouts.appError);
    setImmediate(checkMyAppsAvailability);
    return;
  }

  const isUpnp = upnpService.isUPNP();
  const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer();

  /**
   * Sets the next port if we come across a port that is banned or excluded etc
   *
   * @returns {void}
   */
  const setNextPort = () => {
    if (originalPortFailed && testingPort > originalPortFailed) {
      nextTestingPort = originalPortFailed - 1;
    } else {
      nextTestingPort = null;
      originalPortFailed = null;
    }
  };

  /**
   * Picks a random port from the existing set of not working ports
   *
   * @returns {Array} The array of not working ports. Just so any caller
   * doesn't have to convert to an Array
   */
  const setRandomPort = () => {
    const ports = Array.from(portsNotWorking);
    const randomIndex = Math.floor(Math.random() * ports.length);
    nextTestingPort = ports[randomIndex];

    return ports;
  };

  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      log.info('Flux Node daemon not synced. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);

    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const localSocketAddress = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!localSocketAddress) {
      log.info('No Public IP found. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      log.error('Failed to get installed Apps');

      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const apps = installedAppsRes.data;
    const appPorts = [];

    apps.forEach((app) => {
      if (app.version === 1) {
        appPorts.push(+app.port);
      } else if (app.version <= 3) {
        app.ports.forEach((port) => {
          appPorts.push(+port);
        });
      } else {
        app.compose.forEach((component) => {
          component.ports.forEach((port) => {
            appPorts.push(+port);
          });
        });
      }
    });

    if (nextTestingPort) {
      testingPort = nextTestingPort;
    } else {
      const { fluxapps: { portMin, portMax } } = config;

      testingPort = Math.floor(Math.random() * (portMax - portMin) + portMin);
    }

    log.info(`checkMyAppsAvailability - Testing port ${testingPort}`);

    const isPortBanned = fluxNetworkHelper.isPortBanned(testingPort);

    if (isPortBanned) {
      log.info(
        `checkMyAppsAvailability - Testing port ${testingPort} is banned`,
      );

      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (isUpnp) {
      const isPortUpnpBanned = fluxNetworkHelper.isPortUPNPBanned(testingPort);

      if (isPortUpnpBanned) {
        log.info(
          `checkMyAppsAvailability - Testing port ${testingPort} is UPNP banned`,
        );

        setNextPort();
        await serviceHelper.delay(timeouts.failure);
        setImmediate(checkMyAppsAvailability);
        return;
      }
    }

    const isPortUserBlocked = fluxNetworkHelper.isPortUserBlocked(testingPort);

    if (isPortUserBlocked) {
      log.info(
        `checkMyAppsAvailability - Testing port ${testingPort} is user blocked`,
      );

      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (appPorts.includes(testingPort)) {
      log.info(
        `checkMyAppsAvailability - Skipped checking ${testingPort} - in use`,
      );

      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const remoteSocketAddress = await networkStateService.getRandomSocketAddress(
      localSocketAddress,
    );

    if (!remoteSocketAddress) {
      await serviceHelper.delay(timeouts.appError);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    if (failedNodesTestPortsCache.has(remoteSocketAddress)) {
      // same as above. This is unlikley, just wait the 15 seconds
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    const firewallActive = isArcane
      ? true
      : await fluxNetworkHelper.isFirewallActive();

    if (firewallActive) {
      await fluxNetworkHelper.allowPort(testingPort);
    }

    if (isUpnp) {
      const upnpMapResult = await upnpService.mapUpnpPort(
        testingPort,
        'Flux_Test_App',
      );

      // upnp dos takes precedence over both port dos and others
      if (!upnpMapResult) {
        if (lastUPNPMapFailed) {
          dosState += 4;
          if (dosState >= thresholds.dos) {
            dosMessage = 'Not possible to run applications on the node, '
              + 'router returning exceptions when creating UPNP ports mappings';
          }
        }
        lastUPNPMapFailed = true;
        log.info(
          `checkMyAppsAvailability - Testing port ${testingPort} `
          + 'failed to create UPnP mapping',
        );

        setNextPort();

        await handleTestShutdown(testingPort, testHttpServer, {
          skipFirewall: !firewallActive,
          skipUpnp: true,
          skipHttpServer: true,
        });

        // If we are failing mappings, we still need o fail 25 times before we go DOS.
        const upnpDelay = dosMessage ? timeouts.dos : timeouts.error;
        await serviceHelper.delay(upnpDelay);
        setImmediate(checkMyAppsAvailability);
        return;
      }

      lastUPNPMapFailed = false;
    }

    // Tested: This catches EADDRINUSE. Previously, this was crashing the entire app
    // note - if you kill the port with:
    //    ss --kill state listening src :<the port>
    // nodeJS does not raise an error.
    const listening = new Promise((resolve, reject) => {
      testHttpServer
        .once('error', (err) => {
          testHttpServer.removeAllListeners('listening');
          reject(err.message);
        })
        .once('listening', () => {
          testHttpServer.removeAllListeners('error');
          resolve(null);
        });
      testHttpServer.listen(testingPort);
    });

    const error = await listening.catch((err) => err);

    if (error) {
      log.warn(`Unable to listen on port: ${testingPort}.Error: ${error}`);

      setNextPort();

      await handleTestShutdown(testingPort, testHttpServer, {
        skipFirewall: !firewallActive,
        skipUpnp: !isUpnp,
        skipHttpServer: true,
      });

      await serviceHelper.delay(timeouts.error);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    // The other end only waits 5 seconds anyway
    const timeout = 10_000;
    // we set an empty content-type header here. This is for when we fix
    // the api, that the checkappavailability call will work will old and new
    // nodes while we transition
    const axiosConfig = {
      timeout,
      headers: {
        'content-type': '',
      },
    };

    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    const [localIp, localPort = '16127'] = localSocketAddress.split(':');
    const [remoteIp, remotePort = '16127'] = remoteSocketAddress.split(':');

    const data = {
      ip: localIp,
      port: localPort,
      appname: 'appPortsTest',
      ports: [testingPort],
      pubKey,
    };

    const signature = await signCheckAppData(JSON.stringify(data));
    data.signature = signature;

    const resMyAppAvailability = await axios
      .post(
        `http://${remoteIp}:${remotePort}/flux/checkappavailability`,
        JSON.stringify(data),
        axiosConfig,
      )
      .catch(() => {
        log.error(
          `checkMyAppsAvailability - ${remoteSocketAddress} `
          + 'for app availability is not reachable',
        );
        nextTestingPort = testingPort;
        failedNodesTestPortsCache.set(remoteSocketAddress, '');
        return null;
      });

    await handleTestShutdown(testingPort, testHttpServer, {
      skipFirewall: !firewallActive,
      skipUpnp: !isUpnp,
    });

    if (!resMyAppAvailability) {
      await serviceHelper.delay(timeouts.failure);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    // at this point - testing is complete. Analyze the result and set up the
    // next test (if applicable)

    const {
      data: {
        status: responseStatus = null,
        data: { message: responseMessasge = 'No response' } = {
          message: 'No response',
        },
      },
    } = resMyAppAvailability;

    if (!['success', 'error'].includes(responseStatus)) {
      // we retry the same port but with another node
      log.warning('checkMyAppsAvailability - Unexpected response '
        + `status: ${responseStatus}`);

      await serviceHelper.delay(timeouts.error);
      setImmediate(checkMyAppsAvailability);
      return;
    }

    /**
     * States
     *
     * Normal
     *   No broken ports, or broken ports less than 80 and a "good" port test
     * Normal - Rising edge
     *   I.e. broken ports increasing but threshold not reached. This state could
     *   also be considered normal, and could take many many hours to cross the threshold
     * Failed - Rising edge
     *   Threshold crossed. There are 100 ports in portsNotWorking. At this time the
     *   dosState starts rising 4 per fail. (takes 25 ports once in this state to DOS)
     * Failed - DOS
     *    There are 100 ports in the portsNotWorking array. 25 of those ports
     *   have failed a second time. Node is in DOS state.
     * Failed - Lowering edge
     *   Same as failed, however the node is now considered "working" and is removing
     *   ports from the portsNotWorking array. It will remain in this state until 20 ports
     *   have been removed from the portsNotWorking array. (hysteresis) Once this happens, the node
     *   is then considered in the "normal" state - and the portsNotWorking array is cleared
     */

    const portTestFailed = responseStatus === 'error';
    let waitMs = 0;

    if (portTestFailed && portsNotWorking.size < thresholds.portsHighEdge) {
      // Normal - Rising edge
      portsNotWorking.add(testingPort);

      if (!originalPortFailed) {
        originalPortFailed = testingPort;
        nextTestingPort = testingPort < 65535 ? testingPort + 1 : testingPort - 1;
      } else if (
        testingPort >= originalPortFailed
        && testingPort + 1 <= 65535
      ) {
        nextTestingPort = testingPort + 1;
      } else if (testingPort - 1 > 0) {
        nextTestingPort = testingPort - 1;
      } else {
        nextTestingPort = null;
        originalPortFailed = null;
      }

      waitMs = timeouts.failure;
    } else if (portTestFailed && dosState < thresholds.dos) {
      // Failed - Rising edge (by default takes 25 of these to get to 100)
      dosState += 4;
      setRandomPort();

      waitMs = timeouts.failure;
    } else if (portTestFailed && dosState >= thresholds.dos) {
      // Failed - DOS. At this point - all apps will be removed off node
      // by monitorNodeStatus
      const failedPorts = setRandomPort();

      // this dosMessage takes priority over dosMountMessage or dosDuplicateAppMessage
      dosMessage = 'Ports tested not reachable from outside, DMZ or UPNP '
        + `required! All ports that have failed: ${JSON.stringify(
          failedPorts,
        )}`;

      waitMs = timeouts.dos;
    } else if (!portTestFailed && portsNotWorking.size > thresholds.portsLowEdge) {
      // Failed - Lowering edge, the hysteresis stops bouncing between states
      portsNotWorking.delete(testingPort);
      setRandomPort();

      waitMs = timeouts.failure;
    } else {
      // Normal. This means that if we have less than 80 ports failed
      // (and we haven't gone DOS), and we get a good port, it will reset
      // the not working list
      portsNotWorking.clear();
      nextTestingPort = null;
      originalPortFailed = null;
      // we have to set this here. As the mount or duplicate messages could be set
      // in between when we last checked and now
      dosMessage = dosMountMessage || dosDuplicateAppMessage || null;
      dosState = dosMessage ? thresholds.dos : 0;

      waitMs = timeouts.default;
    }

    if (portTestFailed) {
      log.error(
        `checkMyAppsAvailability - Port ${testingPort} unreachable. `
        + `Detected from ${remoteIp}:${remotePort}. DosState: ${dosState}`,
      );
    } else {
      log.info(
        `${responseMessasge} Detected from ${remoteIp}:${remotePort} on `
        + `port ${testingPort}. DosState: ${dosState}`,
      );
    }

    if (portsNotWorking.size) {
      log.error(
        `checkMyAppsAvailability - Count: ${portsNotWorking.size}. `
        + `portsNotWorking: ${JSON.stringify(
          Array.from(portsNotWorking),
        )}`,
      );
    }

    await serviceHelper.delay(waitMs);
    setImmediate(checkMyAppsAvailability);
  } catch (error) {
    // this whole catch block is problematic. We are assuming that the rules have been
    // allowed, the rule has been mapped, and that the testing server has been
    // started. While all of these are then caught, we're logging errors that
    // aren't necessary. We should only remove stuff if it's been added. (and just
    // catch the errors as they are happening instead of using a catch all block)
    if (!dosMessage && (dosMountMessage || dosDuplicateAppMessage)) {
      dosMessage = dosMountMessage || dosDuplicateAppMessage;
    }

    await handleTestShutdown(testingPort, testHttpServer, { skipUpnp: !isUpnp });

    log.error(`checkMyAppsAvailability - Error: ${error}`);
    await serviceHelper.delay(timeouts.appError);
    setImmediate(checkMyAppsAvailability);
  }
}

/**
 * Check wheter ports of an installing applications are opened and publicly available
 * @param {array} portsToTest array of ports we will be testing
 * @returns boolean if ports are publicly available. So app installation can proceed
 */
let beforeAppInstallTestingServers = [];
async function checkInstallingAppPortAvailable(portsToTest = []) {
  beforeAppInstallTestingServers = [];
  const isUPNP = upnpService.isUPNP();
  let portsStatus = false;
  try {
    const localSocketAddress = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!localSocketAddress) {
      throw new Error('Failed to detect Public IP');
    }
    const [myIP, myPort = '16127'] = localSocketAddress.split(':');

    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    let somePortBanned = false;
    portsToTest.forEach((portToTest) => {
      const iBP = fluxNetworkHelper.isPortBanned(portToTest);
      if (iBP) {
        somePortBanned = true;
      }
    });
    if (somePortBanned) {
      return false;
    }
    if (isUPNP) {
      somePortBanned = false;
      portsToTest.forEach((portToTest) => {
        const iBP = fluxNetworkHelper.isPortUPNPBanned(portToTest);
        if (iBP) {
          somePortBanned = true;
        }
      });
      if (somePortBanned) {
        return false;
      }
    }
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    // eslint-disable-next-line no-restricted-syntax
    for (const portToTest of portsToTest) {
      // now open this port properly and launch listening on it
      if (firewallActive) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.allowPort(portToTest);
      }
      if (isUPNP) {
        // eslint-disable-next-line no-await-in-loop
        const upnpMapResult = await upnpService.mapUpnpPort(portToTest, `Flux_Prelaunch_App_${portToTest}`);
        if (!upnpMapResult) {
          throw new Error('Failed to create map UPNP port');
        }
      }
      const beforeAppInstallTestingExpress = express();
      let beforeAppInstallTestingServer = http.createServer(beforeAppInstallTestingExpress);
      beforeAppInstallTestingServer = httpShutdown(beforeAppInstallTestingServer);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(5 * 1000);
      beforeAppInstallTestingServers.push(beforeAppInstallTestingServer);
      beforeAppInstallTestingServer.listen(portToTest).on('error', (err) => {
        throw err.message;
      }).on('uncaughtException', (err) => {
        throw err.message;
      });
    }
    await serviceHelper.delay(10 * 1000);
    const timeout = 30000;
    const axiosConfig = {
      timeout,
    };
    const data = {
      ip: myIP,
      port: myPort,
      appname: 'appPortsTest',
      ports: portsToTest,
      pubKey,
    };
    const stringData = JSON.stringify(data);
    // eslint-disable-next-line no-await-in-loop
    const signature = await signCheckAppData(stringData);
    data.signature = signature;
    let i = 0;
    let finished = false;
    while (!finished && i < 5) {
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      const randomSocketAddress = await networkStateService.getRandomSocketAddress(localSocketAddress);

      // this should never happen as the list should be populated here
      if (!randomSocketAddress) {
        throw new Error('Unable to get random test connection');
      }

      const [askingIP, askingIpPort = '16127'] = randomSocketAddress.split(':');

      // first check against our IP address
      // eslint-disable-next-line no-await-in-loop
      const resMyAppAvailability = await axios.post(`http://${askingIP}:${askingIpPort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig).catch((error) => {
        log.error(`${askingIP} for app availability is not reachable`);
        log.error(error);
      });
      if (resMyAppAvailability && resMyAppAvailability.data.status === 'error') {
        if (resMyAppAvailability.data.data && resMyAppAvailability.data.data.message && resMyAppAvailability.data.data.message.includes('Failed port: ')) {
          const portToRetest = serviceHelper.ensureNumber(resMyAppAvailability.data.data.message.split('Failed port: ')[1]);
          if (portToRetest > 0) {
            portsNotWorking.add(portToRetest);
            // if we aren't already testing ports, we set it here, otherwise, just continue
            if (!originalPortFailed) {
              originalPortFailed = portToRetest;
              setPortToTest = portToRetest < 65535 ? testingPort + 1 : testingPort - 1;
            }
          }
        }
        portsStatus = false;
        finished = true;
      } else if (resMyAppAvailability && resMyAppAvailability.data.status === 'success') {
        portsStatus = true;
        finished = true;
      }
    }
    // stop listening on the port, close the port
    // eslint-disable-next-line no-restricted-syntax
    for (const portToTest of portsToTest) {
      if (firewallActive) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(portToTest);
      }
      if (isUPNP) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(portToTest, `Flux_Prelaunch_App_${portToTest}`);
      }
    }
    beforeAppInstallTestingServers.forEach((beforeAppInstallTestingServer) => {
      beforeAppInstallTestingServer.shutdown((err) => {
        if (err) {
          log.error(`beforeAppInstallTestingServer Shutdown failed: ${err.message}`);
        }
      });
    });
    return portsStatus;
  } catch (error) {
    if (dosMountMessage || dosDuplicateAppMessage) {
      dosMessage = dosMountMessage || dosDuplicateAppMessage;
    }
    let firewallActive = true;
    firewallActive = await fluxNetworkHelper.isFirewallActive().catch((e) => log.error(e));
    // stop listening on the testing port, close the port
    // eslint-disable-next-line no-restricted-syntax
    for (const portToTest of portsToTest) {
      if (firewallActive) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(portToTest).catch((e) => log.error(e));
      }
      if (isUPNP) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(portToTest, `Flux_Prelaunch_App_${portToTest}`).catch((e) => log.error(e));
      }
    }
    beforeAppInstallTestingServers.forEach((beforeAppInstallTestingServer) => {
      try {
        beforeAppInstallTestingServer.shutdown((err) => {
          if (err) {
            log.error(`beforeAppInstallTestingServer Shutdown failed: ${err.message}`);
          }
        });
      } catch (e) {
        log.warn(e);
      }
    });
    log.error(error);
    return false;
  }
}

// Unmount Testing Functionality
async function removeTestAppMount(specifiedVolume) {
  try {
    const appId = 'flux_fluxTestVol';
    log.info('Mount Test: Unmounting volume');
    const execUnmount = `sudo umount ${appsFolder + appId}`;
    await cmdAsync(execUnmount).then(() => {
      log.info('Mount Test: Volume unmounted');
    }).catch((e) => {
      log.error(e);
      log.error('Mount Test: An error occured while unmounting volume. Continuing. Most likely false positive.');
    });

    log.info('Mount Test: Cleaning up data');
    const execDelete = `sudo rm -rf ${appsFolder + appId}`;
    await cmdAsync(execDelete).catch((e) => {
      log.error(e);
      log.error('Mount Test: An error occured while cleaning up data. Continuing. Most likely false positive.');
    });
    log.info('Mount Test: Data cleaned');
    log.info('Mount Test: Cleaning up data volume');
    const volumeToRemove = specifiedVolume || `${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;
    const execVolumeDelete = `sudo rm -rf ${volumeToRemove}`;
    await cmdAsync(execVolumeDelete).catch((e) => {
      log.error(e);
      log.error('Mount Test: An error occured while cleaning up volume. Continuing. Most likely false positive.');
    });
    log.info('Mount Test: Volume cleaned');
  } catch (error) {
    log.error('Mount Test Removal: Error');
    log.error(error);
  }
}

// Mount Testing Functionality
async function testAppMount() {
  try {
    // before running, try to remove first
    await removeTestAppMount();
    const appSize = 1;
    const overHeadRequired = 2;
    const dfAsync = util.promisify(df);
    const appId = 'flux_fluxTestVol';

    log.info('Mount Test: started');
    log.info('Mount Test: Searching available space...');

    // we want whole numbers in GB
    const options = {
      prefixMultiplier: 'GB',
      isDisplayPrefixMultiplier: false,
      precision: 0,
    };

    const dfres = await dfAsync(options);
    const okVolumes = [];
    dfres.forEach((volume) => {
      if (volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop') && !volume.mount.includes('boot')) {
        okVolumes.push(volume);
      } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
        okVolumes.push(volume);
      }
    });

    // check if space is not sharded in some bad way. Always count the fluxSystemReserve
    let useThisVolume = null;
    const totalVolumes = okVolumes.length;
    for (let i = 0; i < totalVolumes; i += 1) {
      // check available volumes one by one. If a sufficient is found. Use this one.
      if (okVolumes[i].available > appSize + overHeadRequired) {
        useThisVolume = okVolumes[i];
        break;
      }
    }
    if (!useThisVolume) {
      // no useable volume has such a big space for the app
      log.warn('Mount Test: Insufficient space on Flux Node. No useable volume found.');
      // node marked OK
      dosMountMessage = ''; // No Space Found actually
      return;
    }

    // now we know there is a space and we have a volume we can operate with. Let's do volume magic
    log.info('Mount Test: Space found');
    log.info('Mount Test: Allocating space...');

    let volumePath = `${useThisVolume.mount}/${appId}FLUXFSVOL`; // eg /mnt/sthMounted/
    if (useThisVolume.mount === '/') {
      volumePath = `${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;// if root mount then temp file is in flux folder/appvolumes
    }

    const execDD = `sudo fallocate -l ${appSize}G ${volumePath}`;

    await cmdAsync(execDD);

    log.info('Mount Test: Space allocated');
    log.info('Mount Test: Creating filesystem...');

    const execFS = `sudo mke2fs -t ext4 ${volumePath}`;
    await cmdAsync(execFS);
    log.info('Mount Test: Filesystem created');
    log.info('Mount Test: Making directory...');

    const execDIR = `sudo mkdir -p ${appsFolder + appId}`;
    await cmdAsync(execDIR);
    log.info('Mount Test: Directory made');
    log.info('Mount Test: Mounting volume...');

    const execMount = `sudo mount -o loop ${volumePath} ${appsFolder + appId}`;
    await cmdAsync(execMount);
    log.info('Mount Test: Volume mounted. Test completed.');
    dosMountMessage = '';
    // run removal
    removeTestAppMount(volumePath);
  } catch (error) {
    log.error('Mount Test: Error...');
    log.error(error);
    // node marked OK
    dosMountMessage = 'Unavailability to mount applications volumes. Impossible to run applications.';
    // run removal
    removeTestAppMount();
  }
}

/**
 * Check on apps Logs if there is reported another instance of the app on the same network (public ip).
 * For start we will check for PresearchNodes, in the future we can add other masternode apps
 */
async function checkForNonAllowedAppsOnLocalNetwork() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    dosDuplicateAppMessage = '';
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.name.toLowerCase().startsWith('presearchnode')) {
        let containerName = app.name;
        if (app.version >= 4) {
          containerName = `${app.compose[0].name}_${app.name}`;
        }
        // eslint-disable-next-line no-await-in-loop
        const logs = await dockerService.dockerContainerLogs(containerName, 5);
        if (logs.toLowerCase().includes('duplicate ip: this ip address is already running another node')) {
          log.error('Another PresearchNode was detected running on your local network.');
          // dosDuplicateAppMessage = 'Another PresearchNode was detected running on your local network.';
          break;
        }
      }
    }
    if (dosDuplicateAppMessage) {
      setTimeout(() => {
        checkForNonAllowedAppsOnLocalNetwork();
      }, 60 * 60 * 1000);
    } else {
      setTimeout(() => {
        checkForNonAllowedAppsOnLocalNetwork();
      }, 12 * 60 * 60 * 1000);
    }
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkForNonAllowedAppsOnLocalNetwork();
    }, 60 * 60 * 1000);
  }
}

/**
  * Check if the running application container, volumes are using less than maximum allowed space
  * If not, then softly redeploy the application, potentially remove
  * This is to prevent applications from using too much space
*/
let appsStorageViolations = [];
async function checkStorageSpaceForApps() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const dockerSystemDF = await dockerService.dockerGetUsage();
    const allowedMaximum = (config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap) * 1000 * 1024 * 1024;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version >= 4) {
        let totalSize = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          // compose
          const identifier = `${component.name}_${app.name}`;
          const contId = dockerService.getAppDockerNameIdentifier(identifier);
          const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
          if (contExists) {
            totalSize += contExists.SizeRootFs;
          }
        }
        const maxAllowedSize = app.compose.length * allowedMaximum;
        if (totalSize > maxAllowedSize) { // here we allow that one component can take more space than allowed as long as total per entire app is lower than total allowed
          // soft redeploy, todo remove the entire app if multiple violations
          appsStorageViolations.push(app.name);
          const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
          if (occurancies > 3) { // if more than 3 violations, then remove the app
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Removing...`);
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(app.name).catch((error) => {
              log.error(error);
            });
            const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
            appsStorageViolations = adjArray;
          } else {
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Soft redeploying...`);
            // eslint-disable-next-line no-await-in-loop
            await softRedeploy(app).catch((error) => {
              log.error(error);
            });
          }
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2 * 60 * 1000); // 2 mins
        }
      } else {
        const identifier = app.name;
        const contId = dockerService.getAppDockerNameIdentifier(identifier);
        const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
        if (contExists) {
          if (contExists.SizeRootFs > allowedMaximum) {
            // soft redeploy, todo remove the entire app if multiple violations
            appsStorageViolations.push(app.name);
            const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
            if (occurancies > 3) { // if more than 3 violations, then remove the app
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Removing...`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(app.name).catch((error) => {
                log.error(error);
              });
              const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
              appsStorageViolations = adjArray;
            } else {
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Soft redeploying...`);
              // eslint-disable-next-line no-await-in-loop
              await softRedeploy(app).catch((error) => {
                log.error(error);
              });
            }
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // 2 mins
          }
        }
      }
    }
    setTimeout(() => {
      checkStorageSpaceForApps();
    }, 30 * 60 * 1000);
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkStorageSpaceForApps();
    }, 30 * 60 * 1000);
  }
}

function removalInProgressReset() {
  removalInProgress = false;
}

function setRemovalInProgressToTrue() {
  removalInProgress = true;
}

function installationInProgressReset() {
  installationInProgress = false;
}

function setInstallationInProgressTrue() {
  installationInProgress = true;
}

/**
 * Send a chunk of data as a response to the client with a delay.
 * @async
 * @param {object} res - Response object.
 * @param {string} chunk - Data chunk to be sent.
 * @returns {Promise<void>} - A Promise that resolves after sending the chunk with a delay.
 */
async function sendChunk(res, chunk) {
  return new Promise((resolve) => {
    setTimeout(() => {
      res.write(`${chunk}\n`);
      if (res.flush) res.flush();
      resolve();
    }, 3000); // Adjust the delay as needed
  });
}

/**
 * Append a backup task based on the provided parameters.
 * @async
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {boolean} - True if the backup task is successfully appended, otherwise false.
 * @throws {object} - JSON error response if an error occurs.
 */
async function appendBackupTask(req, res) {
  let appname;
  let backup;
  try {
    const processedBody = serviceHelper.ensureObject(req.body);
    log.info(processedBody);
    // eslint-disable-next-line prefer-destructuring
    appname = processedBody.appname;
    // eslint-disable-next-line prefer-destructuring
    backup = processedBody.backup;
    if (!appname || !backup) {
      throw new Error('appname and backup parameters are mandatory');
    }
    const indexBackup = backupInProgress.indexOf(appname);
    if (indexBackup !== -1) {
      throw new Error('Backup in progress...');
    }
    const hasTrueBackup = backup.some((backupitem) => backupitem.backup);
    if (hasTrueBackup === false) {
      throw new Error('No backup jobs...');
    }
  } catch (error) {
    log.error(error);
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
  try {
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      backupInProgress.push(appname);
      // Check if app using syncthing, stop syncthing for all component that using it
      const appDetails = await getApplicationGlobalSpecifications(appname);
      // eslint-disable-next-line no-restricted-syntax
      const syncthing = appDetails.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      if (syncthing) {
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(res, `Stopping syncthing for ${appname}\n`);
        // eslint-disable-next-line no-await-in-loop
        await stopSyncthingApp(appname, res, true);
      }

      await sendChunk(res, 'Stopping application...\n');
      await appDockerStop(appname);
      await serviceHelper.delay(5 * 1000);
      // eslint-disable-next-line no-restricted-syntax
      for (const component of backup) {
        if (component.backup) {
          // eslint-disable-next-line no-await-in-loop
          const componentPath = await IOUtils.getVolumeInfo(appname, component.component, 'B', 0, 'mount');
          const targetPath = `${componentPath[0].mount}/appdata`;
          const tarGzPath = `${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`;
          // eslint-disable-next-line no-await-in-loop
          const existStatus = await IOUtils.checkFileExists(`${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`);
          if (existStatus === true) {
            // eslint-disable-next-line no-await-in-loop
            await sendChunk(res, `Removing exists backup archive for ${component.component.toLowerCase()}...\n`);
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeFile(`${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`);
          }
          // eslint-disable-next-line no-await-in-loop
          await sendChunk(res, `Creating backup archive for ${component.component.toLowerCase()}...\n`);
          // eslint-disable-next-line no-await-in-loop
          const tarStatus = await IOUtils.createTarGz(targetPath, tarGzPath);
          if (tarStatus.status === false) {
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeFile(`${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`);
            throw new Error(`Error: Failed to create backup archive for ${component.component.toLowerCase()}, ${tarStatus.error}`);
          }
        }
      }
      await serviceHelper.delay(5 * 1000);
      await sendChunk(res, 'Starting application...\n');
      if (!syncthing) {
        await appDockerStart(appname);
      } else {
        const componentsWithoutGSyncthing = appDetails.compose.filter((comp) => !comp.containerData.includes('g:'));
        // eslint-disable-next-line no-restricted-syntax
        for (const component of componentsWithoutGSyncthing) {
          // eslint-disable-next-line no-await-in-loop
          await appDockerStart(`${component.name}_${appname}`);
        }
      }
      await sendChunk(res, 'Finalizing...\n');
      await serviceHelper.delay(5 * 1000);
      const indexToRemove = backupInProgress.indexOf(appname);
      backupInProgress.splice(indexToRemove, 1);
      res.end();
      return true;
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const indexToRemove = backupInProgress.indexOf(appname);
    if (indexToRemove >= 0) {
      backupInProgress.splice(indexToRemove, 1);
    }
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
}

/**
 * Append a restore task based on the provided parameters.
 * @async
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {boolean} - True if the restore task is successfully appended, otherwise false.
 * @throws {object} - JSON error response if an error occurs.
 */
async function appendRestoreTask(req, res) {
  let appname;
  let restore;
  let type;
  try {
    const processedBody = serviceHelper.ensureObject(req.body);
    log.info(processedBody);
    // eslint-disable-next-line prefer-destructuring
    appname = processedBody.appname;
    // eslint-disable-next-line prefer-destructuring
    restore = processedBody.restore;
    // eslint-disable-next-line prefer-destructuring
    type = processedBody.type;
    if (!appname || !restore || !type) {
      throw new Error('appname, restore and type parameters are mandatory');
    }
    const indexRestore = restoreInProgress.indexOf(appname);
    if (indexRestore !== -1) {
      throw new Error(`Restore for app ${appname} is running...`);
    }
    const hasTrueRestore = restore.some((restoreitem) => restoreitem.restore);
    if (hasTrueRestore === false) {
      throw new Error('No restore jobs...');
    }
  } catch (error) {
    log.error(error);
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
  try {
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      const componentItem = restore.map((restoreItem) => restoreItem);
      restoreInProgress.push(appname);
      const appDetails = await getApplicationGlobalSpecifications(appname);
      // eslint-disable-next-line no-restricted-syntax
      const syncthing = appDetails.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      if (syncthing) {
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(res, `Stopping syncthing for ${appname}\n`);
        // eslint-disable-next-line no-await-in-loop
        await stopSyncthingApp(appname, res, true);
      }
      await sendChunk(res, 'Stopping application...\n');
      await appDockerStop(appname);
      await serviceHelper.delay(5 * 1000);
      // eslint-disable-next-line no-restricted-syntax
      for (const component of restore) {
        if (component.restore) {
          // eslint-disable-next-line no-await-in-loop
          const componentVolumeInfo = await IOUtils.getVolumeInfo(appname, component.component, 'B', 0, 'mount');
          const appDataPath = `${componentVolumeInfo[0].mount}/appdata`;
          // eslint-disable-next-line no-await-in-loop
          await sendChunk(res, `Removing ${component.component} component data...\n`);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2 * 1000);
          // eslint-disable-next-line no-await-in-loop
          await IOUtils.removeDirectory(appDataPath, true);
        }
      }

      if (type === 'remote') {
        // eslint-disable-next-line no-restricted-syntax
        for (const restoreItem of componentItem) {
          if (restoreItem?.url !== '') {
            // eslint-disable-next-line no-await-in-loop
            const componentPath = await IOUtils.getVolumeInfo(appname, restoreItem.component, 'B', 0, 'mount');
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeDirectory(`${componentPath[0].mount}/backup/remote`, true);
            // eslint-disable-next-line no-await-in-loop
            await sendChunk(res, `Downloading ${restoreItem.url}...\n`);
            // eslint-disable-next-line no-await-in-loop
            const downloadStatus = await IOUtils.downloadFileFromUrl(restoreItem.url, `${componentPath[0].mount}/backup/remote`, restoreItem.component, true);
            if (downloadStatus !== true) {
              throw new Error(`Error: Failed to download ${restoreItem.url}...`);
            }
          }
        }
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const component of restore) {
        if (component.restore) {
          // eslint-disable-next-line no-await-in-loop
          const componentPath = await IOUtils.getVolumeInfo(appname, component.component, 'B', 0, 'mount');
          const targetPath = `${componentPath[0].mount}/appdata`;
          const tarGzPath = `${componentPath[0].mount}/backup/${type}/backup_${component.component.toLowerCase()}.tar.gz`;
          // eslint-disable-next-line no-await-in-loop
          await sendChunk(res, `Unpacking backup archive for ${component.component.toLowerCase()}...\n`);
          // eslint-disable-next-line no-await-in-loop
          const tarStatus = await IOUtils.untarFile(targetPath, tarGzPath);
          if (tarStatus.status === false) {
            throw new Error(`Error: Failed to unpack archive file for ${component.component.toLowerCase()}, ${tarStatus.error}`);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await sendChunk(res, `Removing backup file for ${component.component.toLowerCase()}...\n`);
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeFile(tarGzPath);
          }
          const syncthingAux = appDetails.compose.find((comp) => comp.name === component.component && (comp.containerData.includes('g:') || comp.containerData.includes('r:')));
          if (syncthingAux) {
            const identifier = `${component.component}_${appname}`;
            const appId = dockerService.getAppIdentifier(identifier);
            const cache = {
              restarted: true,
              numberOfExecutionsRequired: 4,
              numberOfExecutions: 10,
            };
            receiveOnlySyncthingAppsCache.set(appId, cache);
          }
        }
      }
      await serviceHelper.delay(1 * 5 * 1000);
      await sendChunk(res, 'Starting application...\n');
      await appDockerStart(appname);
      if (syncthing) {
        await sendChunk(res, 'Redeploying other instances...\n');
        executeAppGlobalCommand(appname, 'redeploy', req.headers.zelidauth, true);
        await serviceHelper.delay(1 * 60 * 1000);
      }
      await sendChunk(res, 'Finalizing...\n');
      await serviceHelper.delay(5 * 1000);
      const indexToRemove = restoreInProgress.indexOf(appname);
      restoreInProgress.splice(indexToRemove, 1);
      res.end();
      return true;
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const indexToRemove = restoreInProgress.indexOf(appname);
    if (indexToRemove >= 0) {
      restoreInProgress.splice(indexToRemove, 1);
    }
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
}

/**
 * To get a list of files with their details for all files.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const options = {
        withFileTypes: false,
      };
      const files = await fs.readdir(filepath, options);
      const filesWithDetails = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const fileStats = await fs.lstat(`${filepath}/${file}`);
        const isDirectory = fileStats.isDirectory();
        const isFile = fileStats.isFile();
        const isSymbolicLink = fileStats.isSymbolicLink();
        let fileFolderSize = fileStats.size;
        if (isDirectory) {
          // eslint-disable-next-line no-await-in-loop
          fileFolderSize = await IOUtils.getFolderSize(`${filepath}/${file}`);
        }
        const detailedFile = {
          name: file,
          size: fileFolderSize, // bytes
          isDirectory,
          isFile,
          isSymbolicLink,
          createdAt: fileStats.birthtime,
          modifiedAt: fileStats.mtime,
        };
        filesWithDetails.push(detailedFile);
      }
      const resultsResponse = messageHelper.createDataMessage(filesWithDetails);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To create a folder
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function createAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo mkdir "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const resultsResponse = messageHelper.createSuccessMessage('Folder Created');
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To rename a file or folder. Oldpath is relative path to default fluxshare directory; newname is just a new name of folder/file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function renameAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { oldpath } = req.params;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      oldpath = oldpath || req.query.oldpath;
      if (!oldpath) {
        throw new Error('No file nor folder to rename specified');
      }
      let { newname } = req.params;
      newname = newname || req.query.newname;
      if (!newname) {
        throw new Error('No new name specified');
      }
      if (newname.includes('/')) {
        throw new Error('New name is invalid');
      }
      // stop sharing of ALL files that start with the path
      const fileURI = encodeURIComponent(oldpath);
      let oldfullpath;
      let newfullpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        oldfullpath = `${appVolumePath[0].mount}/appdata/${oldpath}`;
        newfullpath = `${appVolumePath[0].mount}/appdata/${newname}`;
      } else {
        throw new Error('Application volume not found');
      }
      const fileURIArray = fileURI.split('%2F');
      fileURIArray.pop();
      if (fileURIArray.length > 0) {
        const renamingFolder = fileURIArray.join('/');
        newfullpath = `${appVolumePath[0].mount}/appdata/${renamingFolder}/${newname}`;
      }
      const cmd = `sudo mv -T "${oldfullpath}" "${newfullpath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const response = messageHelper.createSuccessMessage('Rename successful');
      res.json(response);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To remove a specified shared file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function removeAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { object } = req.params;
      object = object || req.query.object;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!component) {
        throw new Error('component parameter is mandatory');
      }
      if (!object) {
        throw new Error('No object specified');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${object}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo rm -rf "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const response = messageHelper.createSuccessMessage('File Removed');
      res.json(response);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a zip folder for a specified directory. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {boolean} authorized False until verified as an admin.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder;
      let { component } = req.params;
      component = component || req.query.component;
      if (!folder || !component) {
        const errorResponse = messageHelper.createErrorMessage('folder and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let folderpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        folderpath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const zip = archiver('zip');
      const sizeStream = new PassThrough();
      let compressedSize = 0;
      sizeStream.on('data', (chunk) => {
        compressedSize += chunk.length;
      });
      sizeStream.on('end', () => {
        const folderNameArray = folderpath.split('/');
        const folderName = folderNameArray[folderNameArray.length - 1];
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-disposition': `attachment; filename=${folderName}.zip`,
          'Content-Length': compressedSize,
        });
        // Now, pipe the compressed data to the response stream
        const zipFinal = archiver('zip');
        zipFinal.pipe(res);
        zipFinal.directory(folderpath, false);
        zipFinal.finalize();
      });
      zip.pipe(sizeStream);
      zip.directory(folderpath, false);
      zip.finalize();
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a specified file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFile(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      let { component } = req.params;
      component = component || req.query.component;
      if (!file || !component) {
        const errorResponse = messageHelper.createErrorMessage('file and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${file}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo chmod 777 "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      // beautify name
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      res.download(filepath, fileName);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To get application specification usd prices.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Returns object with application specification usd prices.
 */
async function getAppSpecsUSDPrice(req, res) {
  try {
    const resMessage = messageHelper.createDataMessage(config.fluxapps.usdprice);
    res.json(resMessage);
  } catch (error) {
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  }
}

/**
 * Method responsable to monitor node status ans uninstall apps if node is not confirmed
 */
// eslint-disable-next-line consistent-return
async function monitorNodeStatus() {
  try {
    let isNodeConfirmed = false;
    if (fluxNetworkHelper.getDosStateValue() >= 100) {
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node have DOS state over 100`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(installedApp.name, null, true, false, isNodeConfirmed);
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(60 * 1000); // wait for 1 min between each removal
      }
      await serviceHelper.delay(10 * 60 * 1000); // 10m delay before next check
      return monitorNodeStatus();
    }
    let error = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => { error = true; });
    if (!isNodeConfirmed && !error) {
      log.info('monitorNodeStatus - Node is not Confirmed');
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node is not confirmed on the network`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(installedApp.name, null, true, false, false);
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(60 * 1000); // wait for 1 min between each removal
      }
      await serviceHelper.delay(20 * 60 * 1000); // 20m delay before next check
      return monitorNodeStatus();
    } if (isNodeConfirmed) {
      log.info('monitorNodeStatus - Node is Confirmed');
      // lets remove from locations when nodes are no longer confirmed
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      const variable = 'ip';
      // we already have the exact same data
      const appslocations = await dbHelper.distinctDatabase(database, globalAppsLocations, variable);
      const appsLocationCount = appslocations.length;
      log.info(`monitorNodeStatus - Found ${appsLocationCount} distinct IP's on appslocations`);

      const appsLocationsNotOnNodelist = [];

      const iterChunk = async (chunk) => {
        const promises = chunk.map(async (location) => {
          const found = await fluxCommunicationUtils.socketAddressInFluxList(location);
          if (!found) appsLocationsNotOnNodelist.push(location);
        });
        await Promise.all(promises);
      };

      const chunkSize = 250;
      let startIndex = 0;
      let endIndex = Math.min(chunkSize, appsLocationCount);

      while (startIndex < appsLocationCount) {
        const chunk = appslocations.slice(startIndex, endIndex);
        // eslint-disable-next-line no-await-in-loop
        await iterChunk(chunk);

        startIndex = endIndex;
        endIndex += chunk.length;
      }

      log.info(`monitorNodeStatus - Found ${appsLocationsNotOnNodelist.length} IP(s) not present on deterministic node list`);
      // eslint-disable-next-line no-restricted-syntax
      for (const location of appsLocationsNotOnNodelist) {
        log.info(`monitorNodeStatus - Checking IP ${location}.`);
        const ip = location.split(':')[0];
        const port = location.split(':')[1] || '16127';
        const { CancelToken } = axios;
        const source = CancelToken.source();
        let isResolved = false;
        const timeout = 10 * 1000; // 10 seconds
        setTimeout(() => {
          if (!isResolved) {
            source.cancel('Operation canceled by the user.');
          }
        }, timeout * 2);
        // eslint-disable-next-line no-await-in-loop
        const response = await axios.get(`http://${ip}:${port}/daemon/getfluxnodestatus`, { timeout, cancelToken: source.token }).catch(() => null);
        isResolved = true;
        if (response && response.data && response.data.status === 'success' && response.data.data.status === 'CONFIRMED') {
          log.info(`monitorNodeStatus - IP ${location} is available and confirmed, awaiting for a new confirmation transaction`);
        } else {
          log.info(`monitorNodeStatus - Removing IP ${location} from globalAppsLocations`);
          const query = { ip: location };
          // eslint-disable-next-line no-await-in-loop
          await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, query);
        }
      }
    }
    await serviceHelper.delay(20 * 60 * 1000); // 20m delay before next check
    monitorNodeStatus();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(2 * 60 * 1000); // 2m delay before next check
    monitorNodeStatus();
  }
}

/**
 * To get Public Key from fluxbench.
 * @param {fluxID} string app owner.
 * @param {appName} string app name.
 * @param {blockHeight} number block when it is registered.
 * @returns {string} Key.
 */
async function getAppPublicKey(fluxID, appName, blockHeight) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  const inputData = JSON.stringify({
    fluxID,
    appName,
    blockHeight,
  });
  const dataReturned = await benchmarkService.getPublicKey(inputData);
  const { status, data } = dataReturned;
  let publicKey = null;
  if (status === 'success') {
    const dataParsed = JSON.parse(data);
    publicKey = dataParsed.status === 'ok' ? dataParsed.publicKey : null;
    if (!publicKey) {
      throw new Error('Error getting public key to encrypt app enterprise content from SAS.');
    }
  } else {
    throw new Error('Error getting public key to encrypt app enterprise content.');
  }

  return publicKey;
}

/**
 * To get Public Key to Encrypt Enterprise Content.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {string} Key.
 */
async function getPublicKey(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }

      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;
      appSpecification = serviceHelper.ensureObject(appSpecification);
      if (!appSpecification.owner || !appSpecification.name) {
        throw new Error('Input parameters missing.');
      }
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const publicKey = await getAppPublicKey(appSpecification.owner, appSpecification.name, daemonHeight);
      // respond with formatted specifications
      const response = messageHelper.createDataMessage(publicKey);
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

module.exports = {
  listRunningApps,
  listAllApps,
  listAppsImages,
  appStart,
  appStop,
  appRestart,
  appKill,
  appPause,
  appUnpause,
  appTop,
  appLog,
  appLogPolling,
  appLogStream,
  appInspect,
  appStats,
  appMonitor,
  appMonitorStream,
  startMonitoringOfApps,
  startAppMonitoringAPI,
  stopAppMonitoringAPI,
  appChanges,
  appExec,
  fluxUsage,
  removeAppLocally,
  registerAppLocally,
  registerAppGlobalyApi,
  createFluxNetworkAPI,
  removeAppLocallyApi,
  installedApps,
  availableApps,
  appsResources,
  checkAppMessageExistence,
  requestAppMessageAPI,
  checkAndRequestApp,
  checkAndRequestMultipleApps,
  checkDockerAccessibility,
  registrationInformation,
  appPricePerMonth,
  getAppsTemporaryMessages,
  getAppsPermanentMessages,
  getGlobalAppsSpecifications,
  storeAppTemporaryMessage,
  verifyRepository,
  checkHWParameters,
  verifyAppHash,
  verifyAppMessageSignature,
  reindexGlobalAppsInformation,
  rescanGlobalAppsInformation,
  continuousFluxAppHashesCheck,
  getAppHashes,
  getAppsLocation,
  getAppsLocations,
  storeAppRunningMessage,
  storeIPChangedMessage,
  storeAppRemovedMessage,
  reindexGlobalAppsLocation,
  getRunningAppIpList,
  trySpawningGlobalApplication,
  getApplicationSpecifications,
  getStrictApplicationSpecifications,
  getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications,
  getApplicationSpecificationAPI,
  updateApplicationSpecificationAPI,
  getApplicationOwnerAPI,
  checkAndNotifyPeersOfRunningApps,
  rescanGlobalAppsInformationAPI,
  reindexGlobalAppsInformationAPI,
  reindexGlobalAppsLocationAPI,
  expireGlobalApplications,
  installAppLocally,
  testAppInstall,
  updateAppGlobalyApi,
  getAppPrice,
  getAppFiatAndFluxPrice,
  reinstallOldApplications,
  checkAndRemoveApplicationInstance,
  checkAppTemporaryMessageExistence,
  softRegisterAppLocally,
  softRemoveAppLocally,
  softRedeploy,
  redeployAPI,
  verifyAppRegistrationParameters,
  verifyAppUpdateParameters,
  deploymentInformation,
  reconstructAppMessagesHashCollection,
  reconstructAppMessagesHashCollectionAPI,
  stopAllNonFluxRunningApps,
  restorePortsSupport,
  restoreFluxPortsSupport,
  restoreAppsPortsSupport,
  forceAppRemovals,
  getAllGlobalApplications,
  syncthingApps,
  getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates,
  getAppsDOSState,
  checkMyAppsAvailability,
  checkApplicationsCompliance,
  testAppMount,
  checkStorageSpaceForApps,
  appendBackupTask,
  appendRestoreTask,
  sendChunk,
  getAppsFolder,
  createAppsFolder,
  renameAppsObject,
  removeAppsObject,
  downloadAppsFolder,
  downloadAppsFile,
  encryptEnterpriseWithAes,
  getlatestApplicationSpecificationAPI,
  // exports for testing purposes
  setAppsMonitored,
  getAppsMonitored,
  clearAppsMonitored,
  getAppFolderSize,
  startAppMonitoring,
  stopMonitoringOfApps,
  getNodeSpecs,
  setNodeSpecs,
  returnNodeSpecs,
  appUninstallHard,
  appUninstallSoft,
  removalInProgressReset,
  totalAppHWRequirements,
  nodeFullGeolocation,
  checkAppGeolocationRequirements,
  checkAppHWRequirements,
  installApplicationHard,
  setRemovalInProgressToTrue,
  installationInProgressReset,
  setInstallationInProgressTrue,
  checkForNonAllowedAppsOnLocalNetwork,
  triggerAppHashesCheckAPI,
  masterSlaveApps,
  getAppSpecsUSDPrice,
  checkApplicationsCpuUSage,
  monitorNodeStatus,
  monitorSharedDBApps,
  callOtherNodeToKeepUpnpPortsOpen,
  getPublicKey,
  getApplicationOriginalOwner,
  storeAppInstallingMessage,
  getAppInstallingLocation,
  getAppsInstallingLocations,
  storeAppInstallingErrorMessage,
  getAppInstallingErrorsLocation,
  getAppsInstallingErrorsLocations,
};
