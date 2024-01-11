/* global userconfig */
const config = require('config');
const https = require('https');
const axios = require('axios');
const express = require('express');
const http = require('http');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
const path = require('path');
const nodecmd = require('node-cmd');
const df = require('node-df');
const { LRUCache } = require('lru-cache');
const systemcrontab = require('crontab');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const httpShutdown = require('http-shutdown');
const fluxCommunication = require('./fluxCommunication');
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
const log = require('../lib/log');

const { invalidMessages } = require('./invalidMessages');

const fluxDirPath = path.join(__dirname, '../../../');
const appsFolder = `${fluxDirPath}ZelApps/`;

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

const testingAppExpress = express();
let testingAppserver = http.createServer(testingAppExpress);
testingAppserver = httpShutdown(testingAppserver);

const GlobalAppsSpawnLRUoptions = {
  max: 2000,
  ttl: 1000 * 60 * 60 * 2, // 2 hours
  maxAge: 1000 * 60 * 60 * 2, // 2 hours
};
const longCache = {
  max: 500,
  ttl: 1000 * 60 * 60 * 3, // 3 hours
  maxAge: 1000 * 60 * 60 * 3, // 3 hours
};

const testPortsCache = {
  max: 60,
  ttl: 1000 * 60 * 60 * 3, // 3 hours
  maxAge: 1000 * 60 * 60 * 3, // 3 hours
};

const syncthingAppsCache = {
  max: 500,
};

const stopedAppsCache = {
  max: 40,
  ttl: 1000 * 60 * 60 * 1.5, // 1.5 hours
  maxAge: 1000 * 60 * 60 * 1.5, // 1.5 hours
};

const trySpawningGlobalAppCache = new LRUCache(GlobalAppsSpawnLRUoptions);
const myLongCache = new LRUCache(longCache);
const failedNodesTestPortsCache = new LRUCache(testPortsCache);
const receiveOnlySyncthingAppsCache = new LRUCache(syncthingAppsCache);
const appsStopedCache = new LRUCache(stopedAppsCache);

let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;

const hashesNumberOfSearchs = new Map();

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
 */
async function executeAppGlobalCommand(appname, command, zelidauth, paramA) {
  try {
    // get a list of the specific app locations
    // eslint-disable-next-line no-use-before-define
    const locations = await appLocation(appname);
    let i = 1;
    // eslint-disable-next-line no-restricted-syntax
    for (const appInstance of locations) {
      // HERE let the node we are connected to handle it
      const ip = appInstance.ip.split(':')[0];
      const port = appInstance.ip.split(':')[1] || 16127;
      const axiosConfig = {
        headers: {
          zelidauth,
        },
      };
      let url = `http://${ip}:${port}/apps/${command}/${appname}`;
      if (paramA) {
        url += `/${paramA}`;
      }
      axios.get(url, axiosConfig);// do not wait, we do not care of the response
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
      if (command === 'redeploy' && !paramA && i < 4) {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(i * 60 * 1000);
      }
      i += 1;
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
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      if (appsMonitored[appname]) {
        const response = {
          lastHour: appsMonitored[appname].oneMinuteStatsStore,
          lastDay: appsMonitored[appname].fifteenMinStatsStore,
        };

        const appResponse = messageHelper.createDataMessage(response);
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
    const dirpath = path.join(__dirname, '../../../');
    const directoryPath = `${dirpath}ZelApps/${appName}`;
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
 * Starts app monitoring for a single app and saves monitoring data in-memory to the appsMonitored object.
 * @param {object} appName monitored component name
 */
function startAppMonitoring(appName) {
  if (!appName) {
    throw new Error('No App specified');
  } else {
    appsMonitored[appName] = {}; // oneMinuteInterval, fifteenMinInterval, oneMinuteStatsStore, fifteenMinStatsStore
    if (!appsMonitored[appName].fifteenMinStatsStore) {
      appsMonitored[appName].fifteenMinStatsStore = [];
    }
    if (!appsMonitored[appName].oneMinuteStatsStore) {
      appsMonitored[appName].oneMinuteStatsStore = [];
    }
    clearInterval(appsMonitored[appName].oneMinuteInterval);
    appsMonitored[appName].oneMinuteInterval = setInterval(async () => {
      try {
        if (!appsMonitored[appName]) {
          log.error(`Monitoring of ${appName} already stopped`);
          clearInterval(appsMonitored[appName].oneMinuteInterval);
          return;
        }
        const dockerContainer = await dockerService.getDockerContainerOnly(appName);
        if (!dockerContainer) {
          log.error(`Monitoring of ${appName} not possible. App does not exist. Forcing stopping of monitoring`);
          // eslint-disable-next-line no-use-before-define
          stopAppMonitoring(appName, true);
          return;
        }
        const statsNow = await dockerService.dockerContainerStats(appName);
        const appFolderName = dockerService.getAppDockerNameIdentifier(appName).substring(1);
        const folderSize = await getAppFolderSize(appFolderName);
        statsNow.disk_stats = {
          used: folderSize,
        };
        appsMonitored[appName].oneMinuteStatsStore.unshift({ timestamp: new Date().getTime(), data: statsNow }); // Most recent stats object is at position 0 in the array
        if (appsMonitored[appName].oneMinuteStatsStore.length > 60) {
          appsMonitored[appName].oneMinuteStatsStore.length = 60; // Store stats every 1 min for the last hour only
        }
      } catch (error) {
        log.error(error);
      }
    }, 1 * 60 * 1000);
    clearInterval(appsMonitored[appName].fifteenMinInterval);
    appsMonitored[appName].fifteenMinInterval = setInterval(async () => {
      try {
        if (!appsMonitored[appName]) {
          log.error(`Monitoring of ${appName} already stopped`);
          clearInterval(appsMonitored[appName].fifteenMinInterval);
          return;
        }
        const dockerContainer = await dockerService.getDockerContainerOnly(appName);
        if (!dockerContainer) {
          log.error(`Monitoring of ${appName} not possible. App does not exist. Forcing stopping of monitoring`);
          // eslint-disable-next-line no-use-before-define
          stopAppMonitoring(appName, true);
          return;
        }
        const statsNow = await dockerService.dockerContainerStats(appName);
        const appFolderName = dockerService.getAppDockerNameIdentifier(appName).substring(1);
        const folderSize = await getAppFolderSize(appFolderName);
        statsNow.disk_stats = {
          used: folderSize,
        };
        appsMonitored[appName].fifteenMinStatsStore.unshift({ timestamp: new Date().getTime(), data: statsNow }); // Most recent stats object is at position 0 in the array
        if (appsMonitored[appName].oneMinuteStatsStore.length > 96) {
          appsMonitored[appName].fifteenMinStatsStore.length = 96; // Store stats every 15 mins for the last day only
        }
      } catch (error) {
        log.error(error);
      }
    }, 15 * 60 * 1000);
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
    clearInterval(appsMonitored[appName].fifteenMinInterval);
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
  const useableSpaceOnNode = totalSpaceOnNode - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
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
  // space that is further reserved for flux os and that will be later substracted from available space. Max 40 + 20.
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
  }

  try {
    const allocateSpace = {
      status: 'Allocating space...',
    };
    log.info(allocateSpace);
    if (res) {
      res.write(serviceHelper.ensureString(allocateSpace));
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
    }

    const makeFilesystem = {
      status: 'Creating filesystem...',
    };
    log.info(makeFilesystem);
    if (res) {
      res.write(serviceHelper.ensureString(makeFilesystem));
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
    }

    const makeDirectory = {
      status: 'Making directory...',
    };
    log.info(makeDirectory);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectory));
    }
    const execDIR = `sudo mkdir -p ${appsFolder + appId}/appdata`;
    await cmdAsync(execDIR);
    const makeDirectory2 = {
      status: 'Directory made',
    };
    log.info(makeDirectory2);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectory2));
    }

    const mountingStatus = {
      status: 'Mounting volume...',
    };
    log.info(mountingStatus);
    if (res) {
      res.write(serviceHelper.ensureString(mountingStatus));
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
    }

    const permissionsDirectory = {
      status: 'Adjusting permissions...',
    };
    log.info(permissionsDirectory);
    if (res) {
      res.write(serviceHelper.ensureString(permissionsDirectory));
    }
    const execPERM = `sudo chmod 777 ${appsFolder + appId}`;
    await cmdAsync(execPERM);
    const permissionsDirectory2 = {
      status: 'Permissions adjusted',
    };
    log.info(permissionsDirectory2);
    if (res) {
      res.write(serviceHelper.ensureString(permissionsDirectory2));
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
        }
        /* if (appId.toLowerCase().includes('minecraft')) {
          const stignore = `sudo echo '*.paused' >| ${appsFolder + appId + containerFolder}/.stignore`;
          log.info(stignore);
          // eslint-disable-next-line no-await-in-loop
          await cmdAsync(stignore);
          const stiFileCreation = {
            status: '.stignore created',
          };
          log.info(stiFileCreation);
          if (res) {
            res.write(serviceHelper.ensureString(stiFileCreation));
          }
        } */
      }
    }

    const cronStatus = {
      status: 'Creating crontab...',
    };
    log.info(cronStatus);
    if (res) {
      res.write(serviceHelper.ensureString(cronStatus));
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
    }
  });
  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
  }

  // eslint-disable-next-line no-use-before-define
  await stopSyncthingApp(monitoredName, res);

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
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
    }
  });
  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name}container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
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
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
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
  }

  const unmuontStatus = {
    status: isComponent ? `Unmounting volume of component ${appName}...` : `Unmounting volume of ${appName}...`,
  };
  log.info(unmuontStatus);
  if (res) {
    res.write(serviceHelper.ensureString(unmuontStatus));
  }
  const execUnmount = `sudo umount ${appsFolder + appId}`;
  await cmdAsync(execUnmount).then(() => {
    const unmuontStatus2 = {
      status: isComponent ? `Volume of component ${appSpecifications.name} unmounted` : `Volume of ${appName} unmounted`,
    };
    log.info(unmuontStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(unmuontStatus2));
    }
  }).catch((e) => {
    log.error(e);
    const unmuontStatus3 = {
      status: isComponent ? `An error occured while unmounting component ${appSpecifications.name} storage. Continuing...` : `An error occured while unmounting ${appName} storage. Continuing...`,
    };
    log.info(unmuontStatus3);
    if (res) {
      res.write(serviceHelper.ensureString(unmuontStatus3));
    }
  });

  const cleaningStatus = {
    status: isComponent ? `Cleaning up component ${appSpecifications.name} data...` : `Cleaning up ${appName} data...`,
  };
  log.info(cleaningStatus);
  if (res) {
    res.write(serviceHelper.ensureString(cleaningStatus));
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
    }
  });
  const cleaningStatus2 = {
    status: isComponent ? `Data of component ${appSpecifications.name} cleaned` : `Data of ${appName} cleaned`,
  };
  log.info(cleaningStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(cleaningStatus2));
  }

  let volumepath;
  // CRONTAB
  const cronStatus = {
    status: 'Adjusting crontab...',
  };
  log.info(cronStatus);
  if (res) {
    res.write(serviceHelper.ensureString(cronStatus));
  }

  const crontab = await crontabLoad().catch((e) => {
    log.error(e);
    const cronE = {
      status: 'An error occured while loading crontab. Continuing...',
    };
    log.info(cronE);
    if (res) {
      res.write(serviceHelper.ensureString(cronE));
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
        }
      }
      const cronStatusDone = {
        status: 'Crontab Adjusted.',
      };
      log.info(cronStatusDone);
      if (res) {
        res.write(serviceHelper.ensureString(cronStatusDone));
      }
    } else {
      const cronStatusNotFound = {
        status: 'Crontab not found.',
      };
      log.info(cronStatusNotFound);
      if (res) {
        res.write(serviceHelper.ensureString(cronStatusNotFound));
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
      }
    });
    const cleaningVolumeStatus2 = {
      status: isComponent ? `Volume of component ${appSpecifications.name} cleaned` : `Volume of ${appName} cleaned`,
    };
    log.info(cleaningVolumeStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningVolumeStatus2));
    }
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
  }
}

/**
 * To remove an app locally including any components. First finds app specifications in database and then deletes the app from database.
 * @param {string} app App name and app component (if applicable). A component name follows the app name after an underscore `_`.
 * @param {object} res Response.
 * @param {boolean} force Defaults to false. Force determines if a check for app not found is skipped.
 * @param {boolean} endResponse Defaults to true.
 * @param {boolean} sendMessage Defaults to false. When sendMessage is true we broadcast the appremoved message to the network.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
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
        const broadcastedAt = new Date().getTime();
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
      }
      await dockerService.removeFluxAppDockerNetwork(appName).catch((error) => log.error(error));
      const dockerNetworkStatus2 = {
        status: 'Docker network cleaned',
      };
      log.info(dockerNetworkStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworkStatus2));
      }
      const databaseStatus = {
        status: 'Cleaning up database...',
      };
      log.info(databaseStatus);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus));
      }
      await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const databaseStatus2 = {
        status: 'Database cleaned',
      };
      log.info(databaseStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus2));
      }
    }
    const appRemovalResponseDone = {
      status: `Removal step done. Result: Flux App ${appName} was successfuly removed`,
    };
    log.info(appRemovalResponseDone);

    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
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
  }
  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecifications.name}_${appName}`;
  }
  stopAppMonitoring(monitoredName, false);
  await dockerService.appDockerStop(appId);

  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
  }

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
  }

  await dockerService.appDockerRemove(appId);

  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name}container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
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
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
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
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
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
  const appSpecifications = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
  if (!appSpecifications) {
    throw new Error('Flux App not found');
  }

  let appId = dockerService.getAppIdentifier(app);

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
    }
    await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const databaseStatus2 = {
      status: 'Database cleaned',
    };
    log.info(databaseStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus2));
    }

    const appRemovalResponseDone = {
      status: `Removal step done. Result: Flux App ${appName} was partially removed`,
    };
    log.info(appRemovalResponseDone);
    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
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
  if (appSpecs.version >= 7 && appSpecs.nodes && appSpecs.nodes.length) {
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
  const useableSpaceOnNode = totalSpaceOnNode - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
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
 * To hard install an app. Pulls image/s, creates data volumes, creates components/app, assigns ports to components/app and starts all containers.
 * @param {object} appSpecifications App specifications.
 * @param {string} appName App name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs) {
  // check image and its architecture
  // eslint-disable-next-line no-use-before-define
  const architecture = await systemArchitecture();
  if (architecture !== 'arm64' && architecture !== 'amd64') {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }
  // eslint-disable-next-line no-use-before-define
  const repoArchitectures = await repositoryArchitectures(appSpecifications.repotag, appSpecifications.repoauth);
  if (!repoArchitectures.includes(architecture)) { // if my system architecture is not in the image
    throw new Error(`Architecture ${architecture} not supported by ${appSpecifications.repotag}`);
  }
  // check repository whitelisted
  await generalService.checkWhitelistedRepository(appSpecifications.repotag);

  // check repotag if available for download
  // eslint-disable-next-line no-use-before-define
  await verifyRepository(appSpecifications.repotag, appSpecifications.repoauth);
  // check blacklist
  // eslint-disable-next-line no-use-before-define
  await checkApplicationImagesComplience(fullAppSpecs);
  // pull image
  const pullConfig = { repoTag: appSpecifications.repotag };
  // decode repoauth if exists
  if (appSpecifications.repoauth) {
    const authToken = await pgpService.decryptMessage(appSpecifications.repoauth);
    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }
    pullConfig.authToken = authToken;
  }
  // eslint-disable-next-line no-unused-vars
  await dockerPullStreamPromise(pullConfig, res);
  const pullStatus = {
    status: isComponent ? `Pulling component ${appSpecifications.name} of Flux App ${appName}` : `Pulling global Flux App ${appName} was successful`,
  };
  if (res) {
    res.write(serviceHelper.ensureString(pullStatus));
  }

  await createAppVolume(appSpecifications, appName, isComponent, res);

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of Flux App ${appName}` : `Creating Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
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
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to map.`);
        }
      }
    }
  } else if (appSpecifications.port) {
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
  }
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  const app = await dockerService.appDockerStart(identifier);
  if (!app) {
    return;
  }
  startAppMonitoring(identifier);
  const appResponse = messageHelper.createDataMessage(app);
  log.info(appResponse);
  if (appSpecifications.containerData.includes('r:') || appSpecifications.containerData.includes('g:')) {
    dockerService.appDockerStop(identifier).catch((error) => log.error(`Error stopping app docker after installApplicationHard:${error}`));
    stopAppMonitoring(identifier, false);
  }
  if (res) {
    res.write(serviceHelper.ensureString(appResponse));
  }
}

/**
 * To register an app locally. Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs hard install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function registerAppLocally(appSpecs, componentSpecs, res) {
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
    }
    // connect to mongodb
    const dbOpenTest = {
      status: 'Connecting to database...',
    };
    log.info(dbOpenTest);
    if (res) {
      res.write(serviceHelper.ensureString(dbOpenTest));
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
      }
      await dockerService.pruneContainers();
      const dockerContainers2 = {
        status: 'Docker containers cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerContainers2));
      }

      const dockerNetworks = {
        status: 'Clearing up unused docker networks...',
      };
      log.info(dockerNetworks);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworks));
      }
      await dockerService.pruneNetworks();
      const dockerNetworks2 = {
        status: 'Docker networks cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworks2));
      }

      const dockerVolumes = {
        status: 'Clearing up unused docker volumes...',
      };
      log.info(dockerVolumes);
      if (res) {
        res.write(serviceHelper.ensureString(dockerVolumes));
      }
      await dockerService.pruneVolumes();
      const dockerVolumes2 = {
        status: 'Docker volumes cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerVolumes2));
      }

      const dockerImages = {
        status: 'Clearing up unused docker images...',
      };
      log.info(dockerImages);
      if (res) {
        res.write(serviceHelper.ensureString(dockerImages));
      }
      await dockerService.pruneImages();
      const dockerImages2 = {
        status: 'Docker images cleaned.',
      };
      if (res) {
        res.write(serviceHelper.ensureString(dockerImages2));
      }
    }

    if (!isComponent) {
      // last character of appName determines gateway
      const lastCharCode = appName.charCodeAt(appName.length - 1);

      const dockerNetworkAddrValue = lastCharCode;

      const fluxNetworkStatus = {
        status: `Checking Flux App network of ${appName}...`,
      };
      log.info(fluxNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetworkStatus));
      }
      const fluxNet = await dockerService.createFluxAppDockerNetwork(appName, dockerNetworkAddrValue).catch((error) => log.error(error));
      if (!fluxNet) {
        throw new Error(`Flux App network of ${appName} failed to initiate. Range already assigned to different application.`);
      }
      log.info(serviceHelper.ensureString(fluxNet));
      const fluxNetResponse = {
        status: `Docker network of ${appName} initiated.`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetResponse));
      }
    }

    const appInstallation = {
      status: isComponent ? `Initiating Flux App component ${appComponent.name} installation...` : `Initiating Flux App ${appName} installation...`,
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
    }
    if (!isComponent) {
      // register the app
      await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);
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
        await installApplicationHard(appComponentSpecs, appName, isComponent, res, appSpecifications);
      }
    } else {
      await installApplicationHard(specificationsToInstall, appName, isComponent, res, appSpecifications);
    }
    const broadcastedAt = new Date().getTime();
    const newAppRunningMessage = {
      type: 'fluxapprunning',
      version: 1,
      name: appSpecifications.name,
      hash: appSpecifications.hash, // hash of application specifics that are running
      ip: myIP,
      broadcastedAt,
      runningSince: broadcastedAt,
    };

    // store it in local database first
    // eslint-disable-next-line no-await-in-loop, no-use-before-define
    await storeAppRunningMessage(newAppRunningMessage);
    // broadcast messages about running apps to all peers
    await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
    await serviceHelper.delay(500);
    await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
    // broadcast messages about running apps to all peers
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
    }
    const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
    }
    removeAppLocally(appSpecs.name, res, true, true, false);
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
  // check image and its architecture
  // eslint-disable-next-line no-use-before-define
  const architecture = await systemArchitecture();
  if (architecture !== 'arm64' && architecture !== 'amd64') {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }
  // eslint-disable-next-line no-use-before-define
  const repoArchitectures = await repositoryArchitectures(appSpecifications.repotag, appSpecifications.repoauth);
  if (!repoArchitectures.includes(architecture)) { // if my system architecture is not in the image
    throw new Error(`Architecture ${architecture} not supported by ${appSpecifications.repotag}`);
  }
  // check repository whitelisted
  await generalService.checkWhitelistedRepository(appSpecifications.repotag);

  // check repotag if available for download
  // eslint-disable-next-line no-use-before-define
  await verifyRepository(appSpecifications.repotag, appSpecifications.repoauth);
  // check blacklist
  // eslint-disable-next-line no-use-before-define
  await checkApplicationImagesComplience(fullAppSpecs);
  // pull image
  const pullConfig = { repoTag: appSpecifications.repotag };
  // decode repoauth if exists
  if (appSpecifications.repoauth) {
    const authToken = await pgpService.decryptMessage(appSpecifications.repoauth);
    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }
    pullConfig.authToken = authToken;
  }
  // eslint-disable-next-line no-unused-vars
  await dockerPullStreamPromise(pullConfig, res);
  const pullStatus = {
    status: isComponent ? `Pulling global Flux App ${appSpecifications.name} was successful` : `Pulling global Flux App ${appName} was successful`,
  };
  if (res) {
    res.write(serviceHelper.ensureString(pullStatus));
  }

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of local Flux App ${appName}` : `Creating local Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
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
  }
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
    }
    // connect to mongodb
    const dbOpenTest = {
      status: 'Connecting to database...',
    };
    log.info(dbOpenTest);
    if (res) {
      res.write(serviceHelper.ensureString(dbOpenTest));
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
      // last character of appName determines gateway
      const lastCharCode = appName.charCodeAt(appName.length - 1);

      const dockerNetworkAddrValue = lastCharCode;

      const fluxNetworkStatus = {
        status: `Checking Flux App network of ${appName}...`,
      };
      log.info(fluxNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetworkStatus));
      }
      const fluxNet = await dockerService.createFluxAppDockerNetwork(appName, dockerNetworkAddrValue).catch((error) => log.error(error));
      if (!fluxNet) {
        throw new Error(`Flux App network of ${appName} failed to initiate. Range already assigned to different application`);
      }
      log.info(serviceHelper.ensureString(fluxNet));
      const fluxNetResponse = {
        status: `Docker network of ${appName} initiated.`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetResponse));
      }
    }

    const appInstallation = {
      status: isComponent ? `Initiating Flux App component ${appComponent.name} installation...` : `Initiating Flux App ${appName} installation...`,
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
    }
    if (!isComponent) {
      // register the app
      await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);
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
    }
    const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
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
      let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
      if (instancesAdditional > 0) {
        const additionalPrice = (appPrice * instancesAdditional) / 3;
        appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
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
    if (instancesAdditional > 0) {
      const additionalPrice = (appPrice * instancesAdditional) / 3;
      appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
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
  if (dataForAppRegistration.nodes && dataForAppRegistration.nodes.length) { // v7+ enterprise app scoped to nodes
    totalPrice += priceSpecifications.scope;
  }
  if (dataForAppRegistration.staticip) { // v7+ staticip option
    totalPrice += priceSpecifications.staticip;
  }
  totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
  let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
  if (instancesAdditional > 0) {
    const additionalPrice = (appPrice * instancesAdditional) / 3;
    appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
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
  const messToHash = message.type + message.version + JSON.stringify(message.appSpecifications || message.zelAppSpecifications) + message.timestamp + message.signature;
  const messageHASH = await generalService.messageHash(messToHash);
  if (messageHASH !== message.hash) {
    throw new Error('Invalid Flux App hash received!');
  }
  return true;
}

/**
 * To verify an app message signature.
 * @param {string} type Type.
 * @param {number} version Version.
 * @param {object} appSpec App specifications.
 * @param {number} timestamp Time stamp.
 * @param {string} signature Signature.
 * @returns {boolean} True if no error is thrown.
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
 * @returns {boolean} True if no errors are thrown.
 */
async function verifyAppMessageUpdateSignature(type, version, appSpec, timestamp, signature, appOwner) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = verificationHelper.verifyMessage(messageToVerify, appOwner, signature); // only btc
  if (timestamp > 1688947200000) { // remove after this time passed
    isValidSignature = signatureVerifier.verifySignature(messageToVerify, appOwner, signature); // btc, eth
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
    isValidSignature = verificationHelper.verifyMessage(messageToVerifyB, appOwner, signature); // only btc
    if (timestamp > 1688947200000) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appOwner, signature); // btc, eth
    }
  }
  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appOwner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature does not correspond with Flux App owner or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

/**
 * To fetch an auth token from registry auth provider.
 * @param {object} authDetails Parsed www-authenticate header.
 * @param {object} AxiosConfig axios Auth object.
 */
async function getAuthToken(authDetails, axiosConfig) {
  const { realm, service, scope } = authDetails;
  const authTokenRes = await serviceHelper.axiosGet(`${realm}?service=${service}&scope=${scope}`, axiosConfig).catch((error) => {
    log.warn(error);
    throw new Error(`Authentication token from ${realm} for ${scope} not available`);
  });
  if (!authTokenRes) {
    throw new Error(`Unable to communicate with authentication token provider ${realm}! Try again later.`);
  }
  return authTokenRes.data.token;
}

async function verifyRepository(repotag, repoauth, skipVerification = false) {
  const {
    provider, namespace, repository, tag,
  } = generalService.parseDockerTag(repotag);

  const image = repository;
  if (repoauth && skipVerification) {
    return true;
  }
  let decryptedRepoAuth;
  if (repoauth) {
    decryptedRepoAuth = await pgpService.decryptMessage(repoauth);
    if (!decryptedRepoAuth) {
      throw new Error('Unable to decrypt provided credentials');
    }
  }
  if (provider === 'hub.docker.com') { // favor docker hub api
    // if we are using private image, we need to authenticate first
    const axiosConfig = {};
    if (decryptedRepoAuth) {
      let loginData = {};
      if (decryptedRepoAuth.includes(':')) { // specified by username:token
        loginData = {
          username: decryptedRepoAuth.split(':')[0],
          password: decryptedRepoAuth.split(':')[1],
        };
      } else {
        throw new Error('Invalid login credentials for docker provided');
      }
      const loginResp = await axios.post('https://hub.docker.com/v2/users/login', loginData).catch((error) => {
        log.warn(error);
      });
      const { token } = loginResp.data;
      axiosConfig.headers = {
        Authorization: `Bearer ${token}`,
      };
    }
    const resDocker = await serviceHelper.axiosGet(`https://hub.docker.com/v2/repositories/${namespace}/${image}/tags/${tag}`, axiosConfig).catch((error) => {
      log.warn(error);
      throw new Error(`Repository ${repotag} is not found on ${provider} in expected format`);
    });
    if (!resDocker) {
      throw new Error(`Unable to communicate with ${provider}! Try again later.`);
    }
    if (resDocker.data.errinfo) {
      throw new Error('Docker image not found');
    }
    if (!resDocker.data.images) {
      throw new Error('Docker image not found2');
    }
    if (!resDocker.data.images[0]) {
      throw new Error('Docker image not found3');
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const img of resDocker.data.images) {
      if (img.size > config.fluxapps.maxImageSize) {
        throw new Error(`Docker image ${repotag} of architecture ${img.architecture} size is over Flux limit`);
      }
    }
    if (resDocker.data.full_size > config.fluxapps.maxImageSize) {
      throw new Error(`Docker image ${repotag} size is over Flux limit`);
    }
  } else { // use docker v2 api, general for any public docker repositories
    // if we are using private image, we need to authenticate first
    const axiosAuthConfig = {};
    if (decryptedRepoAuth) {
      let loginData = {};
      if (decryptedRepoAuth.includes(':')) { // specified by username:token
        loginData = {
          username: decryptedRepoAuth.split(':')[0],
          password: decryptedRepoAuth.split(':')[1],
        };
      } else {
        throw new Error('Invalid login credentials for docker provided');
      }
      axiosAuthConfig.auth = loginData;
    }

    const axiosOptionsManifest = {
      timeout: 20000,
      headers: {
        // eslint-disable-next-line max-len
        // need to accept both media types here, some registries (google artifact registry)
        // will respond with error if only the manifest exists and not the manifest list (instead
        // of just returning the manifest list)
        Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
      },
    };

    let manifestsListResp = await serviceHelper.axiosGet(`https://${provider}/v2/${namespace}/${image}/manifests/${tag}`, axiosOptionsManifest).catch(async (error) => {
      let authToken;
      // unauthorized
      if (error.response && error.response.status === 401) {
        const authDetails = generalService.parseAuthHeader(error.response.headers['www-authenticate']);
        if (!authDetails) {
          log.warn(error);
          throw new Error(`Manifests List from ${provider} for ${namespace}/${image}:${tag} not available`);
        }
        authToken = await getAuthToken(authDetails, axiosAuthConfig);
      }

      if (!authToken) {
        log.warn(error);
        throw new Error(`Manifests List from ${provider} for ${namespace}/${image}:${tag} not available`);
      }
      axiosOptionsManifest.headers.Authorization = `Bearer ${authToken}`;
    });

    // we got challenged on the first try, and now have auth details
    if (!manifestsListResp && axiosOptionsManifest.headers.Authorization) {
      manifestsListResp = await serviceHelper.axiosGet(`https://${provider}/v2/${namespace}/${image}/manifests/${tag}`, axiosOptionsManifest).catch((error) => {
        log.warn(error);
        throw new Error(`Manifests List from ${provider} for ${namespace}/${image}:${tag} not available`);
      });
    }

    if (!manifestsListResp) {
      throw new Error(`Unable to communicate with manifest list provider ${provider}! Try again later.`);
    }
    if (manifestsListResp.data.schemaVersion !== 2) {
      throw new Error(`Unsupported manifest list version from ${provider} for ${namespace}/${image}:${tag}.`);
    }
    const manifests = manifestsListResp.data.manifests || [];

    if (manifestsListResp.data.mediaType === 'application/vnd.docker.distribution.manifest.v2+json') {
      // returned not a list like we wanted
      // treat as single platform amd64
      let size = 0;
      manifestsListResp.data.layers.forEach((layer) => {
        size += layer.size;
      });
      if (size > config.fluxapps.maxImageSize) {
        throw new Error(`Docker image ${repotag} size is over Flux limit`);
      }
    } else if (manifestsListResp.data.mediaType !== 'application/vnd.docker.distribution.manifest.list.v2+json') { // we only want v2 or list
      throw new Error(`Unsupported manifest from ${provider} for ${namespace}/${image}:${tag} media type ${manifestsListResp.data.mediaType}`);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const mnfst of manifests) {
      // rate limit precaution
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1000); // catch for potential rate limit
      const { digest } = mnfst;
      // eslint-disable-next-line no-await-in-loop
      const manifestResp = await serviceHelper.axiosGet(`https://${provider}/v2/${namespace}/${image}/manifests/${digest}`, axiosOptionsManifest).catch((error) => {
        log.warn(error);
        throw new Error(`Manifest from ${provider} for ${namespace}/${image}:${digest} not available`);
      });
      if (!manifestResp) {
        throw new Error(`Unable to communicate with manifest provider ${provider}! Try again later.`);
      }
      const manifest = manifestResp.data;
      if (manifest.schemaVersion !== 2) {
        throw new Error(`Unsupported manifest version from ${provider} for ${namespace}/${image}:${digest}.`);
      }
      if (manifest.mediaType !== 'application/vnd.docker.distribution.manifest.v2+json') {
        throw new Error(`Unsupported manifest from ${provider} for ${namespace}/${image}:${tag} media type ${manifest.mediaType}`);
      }
      let size = 0;
      manifest.layers.forEach((layer) => {
        size += layer.size;
      });
      if (size > config.fluxapps.maxImageSize) {
        throw new Error(`Docker image ${repotag} size is over Flux limit`);
      }
    }
  }
  return true;
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
    if (response.data.status === 'success') {
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
    return null;
  }
}

/**
 * To check compliance of app images (including images for each component if a Docker Compose app). Checks Flux OS's GitHub repository for list of blocked Docker Hub/Github/Google repositories.
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if no errors are thrown.
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
    images.forEach((image) => {
      if (userBlockedRepos.includes(image.toLowerCase())) {
        throw new Error(`Image ${image} is user blocked. Application ${appSpecs.name} connot be spawned.`);
      }
    });
  }

  return true;
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
    images.forEach((image) => {
      if (userBlockedRepos.includes(image.toLowerCase())) {
        isBlocked = `Image ${image} is user blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
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
  } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter');
  }

  // commons
  if (!version || !name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
    }
  } else if (version >= 2 && version <= 3) {
    if (!ports || !domains || !containerPorts) {
      throw new Error('Missing Flux App specification parameter');
    }
  }

  if (version === 1) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
  } else { // v4+
    if (!compose) {
      throw new Error('Missing Flux App specification parameter');
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

      if (version >= 7) {
        if (typeof appComponent.secrets !== 'string') {
          throw new Error(`Secrets for Flux App component ${appComponent.name} are invalid`);
        }

        if (typeof appComponent.repoauth !== 'string') {
          throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
        }
      }
    });
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
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
  const minPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMinNew : config.fluxapps.portMin;
  const maxPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMaxNew : config.fluxapps.portMax;
  if (appSpecifications.version !== 1 && appSpecifications.version !== 2 && appSpecifications.version !== 3 && appSpecifications.version !== 4 && appSpecifications.version !== 5 && appSpecifications.version !== 6 && appSpecifications.version !== 7) {
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

      if (appSpecifications.version >= 7) {
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
    if (appSpecifications.expire < config.fluxapps.minBlocksAllowance) {
      throw new Error(`Minimum expiration of application is ${config.fluxapps.minBlocksAllowance} blocks ~ 1 week`);
    }
    if (appSpecifications.expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    if (appSpecifications.expire % config.fluxapps.blocksAllowanceInterval !== 0) {
      throw new Error(`Expiration of application has to be a multiple of ${config.fluxapps.blocksAllowanceInterval} blocks ~ 1 day`);
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
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecifications.compose) {
      checkHWParameters(appComponent);
    }
  }

  // Whitelist, repository checks
  if (checkDockerAndWhitelist) {
    if (appSpecifications.version <= 3) {
      // check repository whitelisted
      await generalService.checkWhitelistedRepository(appSpecifications.repotag);

      // check repotag if available for download
      await verifyRepository(appSpecifications.repotag, appSpecifications.repoauth, true);
    } else {
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponent of appSpecifications.compose) {
        // check repository whitelisted
        // eslint-disable-next-line no-await-in-loop
        await generalService.checkWhitelistedRepository(appComponent.repotag);

        // check repotag if available for download
        // eslint-disable-next-line no-await-in-loop
        await verifyRepository(appComponent.repotag, appComponent.repoauth, true);
      }
    }
    // check blacklist
    await checkApplicationImagesComplience(appSpecifications);
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
 * To get Docker image architectures.
 * @param {string} repotag Docker Hub repository tag.
 * @returns {string[]} List of Docker image architectures.
 */
async function repositoryArchitectures(repotag, repoauth) {
  const {
    provider, namespace, repository, tag,
  } = generalService.parseDockerTag(repotag);

  const image = repository;
  const architectures = [];
  let decryptedRepoAuth;
  if (repoauth) {
    decryptedRepoAuth = await pgpService.decryptMessage(repoauth);
    if (!decryptedRepoAuth) {
      throw new Error('Unable to decrypt provided credentials');
    }
  }
  if (provider === 'hub.docker.com') { // favor docker hub api
    // if we are using private image, we need to authenticate first
    const axiosConfig = {};
    if (decryptedRepoAuth) {
      let loginData = {};
      if (decryptedRepoAuth.includes(':')) { // specified by username:token
        loginData = {
          username: decryptedRepoAuth.split(':')[0],
          password: decryptedRepoAuth.split(':')[1],
        };
      } else {
        throw new Error('Invalid login credentials for docker provided');
      }
      const loginResp = await axios.post('https://hub.docker.com/v2/users/login', loginData).catch((error) => {
        log.warn(error);
      });
      const { token } = loginResp.data;
      axiosConfig.headers = {
        Authorization: `Bearer ${token}`,
      };
    }
    const resDocker = await serviceHelper.axiosGet(`https://hub.docker.com/v2/repositories/${namespace}/${image}/tags/${tag}`, axiosConfig).catch((error) => {
      log.warn(error);
      throw new Error(`Repository ${repotag} is not found on ${provider} in expected format`);
    });
    if (!resDocker) {
      throw new Error(`Unable to communicate with ${provider}! Try again later.`);
    }
    if (resDocker.data.errinfo) {
      throw new Error('Docker image not found');
    }
    if (!resDocker.data.images) {
      throw new Error('Docker image not found2');
    }
    if (!resDocker.data.images[0]) {
      throw new Error('Docker image not found3');
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const img of resDocker.data.images) {
      architectures.push(img.architecture);
    }
  } else { // use docker v2 api, general for any public docker repositories
    // if we are using private image, we need to authenticate first
    const axiosAuthConfig = {};
    if (decryptedRepoAuth) {
      let loginData = {};
      if (decryptedRepoAuth.includes(':')) { // specified by username:token
        loginData = {
          username: decryptedRepoAuth.split(':')[0],
          password: decryptedRepoAuth.split(':')[1],
        };
      } else {
        throw new Error('Invalid login credentials for docker provided');
      }
      axiosAuthConfig.auth = loginData;
    }

    const axiosOptionsManifest = {
      timeout: 20000,
      headers: {
        // eslint-disable-next-line max-len
        // need to accept both media types here, some registries (google artifact registry)
        // will respond with error if only the manifest exists and not the manifest list (instead
        // of just returning the manifest list)
        Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
      },
    };

    let manifestsListResp = await serviceHelper.axiosGet(`https://${provider}/v2/${namespace}/${image}/manifests/${tag}`, axiosOptionsManifest).catch(async (error) => {
      let authToken;
      // unauthorized
      if (error.response && error.response.status === 401) {
        const authDetails = generalService.parseAuthHeader(error.response.headers['www-authenticate']);
        if (!authDetails) {
          log.warn(error);
          throw new Error(`Manifests List from ${provider} for ${namespace}/${image}:${tag} not available`);
        }
        authToken = await getAuthToken(authDetails, axiosAuthConfig);
      }

      if (!authToken) {
        log.warn(error);
        throw new Error(`Manifests List from ${provider} for ${namespace}/${image}:${tag} not available`);
      }
      axiosOptionsManifest.headers.Authorization = `Bearer ${authToken}`;
    });

    // we got challenged on the first try, and now have auth details
    if (!manifestsListResp && axiosOptionsManifest.headers.Authorization) {
      manifestsListResp = await serviceHelper.axiosGet(`https://${provider}/v2/${namespace}/${image}/manifests/${tag}`, axiosOptionsManifest).catch((error) => {
        log.warn(error);
        throw new Error(`Manifests List from ${provider} for ${namespace}/${image}:${tag} not available`);
      });
    }

    if (!manifestsListResp) {
      throw new Error(`Unable to communicate with manifest list provider ${provider}! Try again later.`);
    }
    if (manifestsListResp.data.schemaVersion !== 2) {
      throw new Error(`Unsupported manifest list version from ${provider} for ${namespace}/${image}:${tag}.`);
    }
    const manifests = manifestsListResp.data.manifests || [];

    if (manifestsListResp.data.mediaType === 'application/vnd.docker.distribution.manifest.v2+json') {
      // handle as single platform amd64.
      architectures.push('amd64');
    } else if (manifestsListResp.data.mediaType !== 'application/vnd.docker.distribution.manifest.list.v2+json') { // we only want v2 or list
      throw new Error(`Unsupported manifest from ${provider} for ${namespace}/${image}:${tag} media type ${manifestsListResp.data.mediaType}`);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const mnfst of manifests) {
      architectures.push(mnfst.platform.architecture);
    }
  }
  return architectures;
}

/**
 * To get system architecture type (ARM64 or AMD64).
 * @returns {string} Architecture type (ARM64 or AMD64).
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
 * To ensure that all app images are of a consistent architecture type. Architecture must be either ARM64 or AMD64.
 * @param {object} appSpecFormatted App specifications.
 * @returns {boolean} True if all apps have the same system architecture.
 */
async function ensureApplicationImagesExistsForPlatform(appSpecFormatted) {
  const architecture = await systemArchitecture();
  if (architecture !== 'arm64' && architecture !== 'amd64') {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }
  if (appSpecFormatted.version <= 3) {
    const repoArchitectures = await repositoryArchitectures(appSpecFormatted.repotag, appSpecFormatted.repoauth); // repoauth is undefined
    if (!repoArchitectures.includes(architecture)) { // if my system architecture is not in the image
      return false;
    }
  } else {
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecFormatted.compose) {
      // eslint-disable-next-line no-await-in-loop
      const repoArchitectures = await repositoryArchitectures(appComponent.repotag, appComponent.repoauth);
      if (!repoArchitectures.includes(architecture)) { // if my system architecture is not in the image
        return false;
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500); // catch for potential rate limit
    }
  }
  return true; // all images have my system architecture
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
 * @returns {boolean} True if no errors are thrown.
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
  log.info(`Searching permanent messages for ${specifications.name}`);
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
  return appSpecs;
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

  // data shall already be verified by the broadcasting node. But verify all again.
  // this takes roughly at least 1 second
  if (furtherVerification) {
    if (message.type === 'zelappregister' || message.type === 'fluxappregister') {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height;
      await verifyAppSpecifications(appSpecFormatted, daemonHeight);
      await verifyAppHash(message);
      await checkApplicationRegistrationNameConflicts(appSpecFormatted, message.hash);
      await verifyAppMessageSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature);
    } else if (message.type === 'zelappupdate' || message.type === 'fluxappupdate') {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height;
      // stadard verifications
      await verifyAppSpecifications(appSpecFormatted, daemonHeight);
      await verifyAppHash(message);
      // verify that app exists, does not change repotag (for v1-v3), does not change name and does not change component names
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, messageTimestamp);
      // get previousAppSpecifications as we need previous owner
      const previousAppSpecs = await getPreviousAppSpecifications(appSpecFormatted, messageTimestamp);
      const { owner } = previousAppSpecs;
      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature, owner);
    } else {
      throw new Error('Invalid Flux App message received');
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
  };
  const value = newMessage;
  // message does not exist anywhere and is ok, store it
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, value);
  // it is stored and rebroadcasted
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

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < new Date().getTime()) {
    // reject old message
    return false;
  }

  const randomDelay = Math.floor((Math.random() * 1280)) + 240;
  await serviceHelper.delay(randomDelay);

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
    };

    // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
    const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const projection = { _id: 0, runningSince: 1 };
    // we already have the exact same data
    // eslint-disable-next-line no-await-in-loop
    const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result && result.broadcastedAt && result.broadcastedAt >= newAppRunningMessage.broadcastedAt) {
      // found a message that was already stored/bad message
      messageNotOk = true;
      break;
    }
    if (message.runningSince) {
      newAppRunningMessage.runningSince = new Date(message.runningSince);
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
  if (messageNotOk) {
    return false;
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
  if (validTill < new Date().getTime()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.oldIP };
  const update = { $set: { ip: message.newIP } };
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
  if (validTill < new Date().getTime()) {
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
  } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter');
  }
  version = serviceHelper.ensureNumber(version);

  // commons
  if (!name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
      if (version >= 7) {
        appComponentCorrect.secrets = serviceHelper.ensureString(appComponent.secrets);
        appComponentCorrect.repoauth = serviceHelper.ensureString(appComponent.repoauth);
      }
      correctCompose.push(appComponentCorrect);
    });
    appSpecFormatted.compose = correctCompose;
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
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
      throw new Error('Missing Flux App specification parameter');
    }
    expire = serviceHelper.ensureNumber(expire);
    if (typeof expire !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (expire < config.fluxapps.minBlocksAllowance) {
      throw new Error(`Minimum expiration of application is ${config.fluxapps.minBlocksAllowance} blocks ~ 1 week`);
    }
    if (expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    if (expire % config.fluxapps.blocksAllowanceInterval !== 0) {
      throw new Error(`Expiration of application has to be a multiple of ${config.fluxapps.blocksAllowanceInterval} blocks ~ 1 day`);
    }
    appSpecFormatted.expire = expire;
  }

  if (version >= 7) {
    if (!nodes) { // can be empty array for no nodes set
      throw new Error('Missing Flux App specification parameter');
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

  return appSpecFormatted;
}

/**
 * To register an app globally via API. Performs various checks before the app can be registered. Only accessible by users.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
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

      const appSpecFormatted = specificationFormatter(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await verifyAppMessageSignature(messageType, typeVersion, appSpecFormatted, timestamp, signature);

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
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
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

      const appSpecFormatted = specificationFormatter(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

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
      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(messageType, typeVersion, appSpecFormatted, timestamp, signature, appOwner);

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
      };
      // verify that app exists, does not change repotag (for v1-v3), does not change name and does not change component names
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, temporaryAppMessage.timestamp);
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
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkAndRequestApp(hash, txid, height, valueSat, i = 0) {
  try {
    if (height < config.fluxapps.epochstart) { // do not request testing apps
      return;
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
        // disregard other types
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
            // globalappsspecifications expired apps and this prevent them to be selected to be installed on the node
            // eslint-disable-next-line no-use-before-define
            await expireGlobalApplications();
          } else {
            log.warn(`Apps message ${permanentAppMessage.hash} is underpaid`);
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
            return;
          }
          const previousSpecs = messageInfo.appSpecifications || messageInfo.zelAppSpecifications;
          // here comparison of height differences and specifications
          // price shall be price for standard registration plus minus already paid price according to old specifics. height remains height valid for 22000 blocks
          let appPrice = await appPricePerMonth(specifications, height, appPrices);
          let previousSpecsPrice = await appPricePerMonth(previousSpecs, height, appPrices);
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
            log.warn(`Apps message ${permanentAppMessage.hash} is underpaid`);
          }
        }
      } else if (i < 2) {
        // request the message and broadcast the message further to our connected peers.
        // rerun this after 1 min delay
        // We ask to the connected nodes 2 times in 1 minute interval for the app message, if connected nodes don't
        // have the app message we will ask for it again when continuousFluxAppHashesCheck executes again.
        // in total we ask to the connected nodes 10 (30m interval) x 2 (1m interval) = 20 times before apphash is marked as not found
        await requestAppMessage(hash);
        await serviceHelper.delay(60 * 1000);
        checkAndRequestApp(hash, txid, height, valueSat, i + 1);
        // additional requesting of missing app messages is done on rescans
      }
    } else {
      // update apphashes that we already have it stored
      await appHashHasMessage(hash);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To check Docker accessibility. Only accessible by users.
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

      await verifyRepository(processedBody.repotag);
      const message = messageHelper.createSuccessMessage('Repotag is accessible');
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
    const numberOfPeers = fluxCommunication.getNumberOfPeers();
    if (numberOfPeers < 20) {
      log.info('Not enough connected peers to request missing Flux App messages');
      continuousFluxAppHashesCheckRunning = false;
      return;
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
        log.info('Requesting missing Flux App message:');
        log.info(`${result.hash}, ${result.txid}, ${result.height}`);
        if (numberOfSearches <= 20) { // up to 10 searches
          checkAndRequestApp(result.hash, result.txid, result.height, result.value);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay((Math.random() + 1) * 1000); // delay between 1 and 2 seconds max
        } else {
          // eslint-disable-next-line no-await-in-loop
          await appHashHasMessageNotFound(result.hash); // mark message as not found
          hashesNumberOfSearchs.delete(result.hash); // remove from our map
        }
      }
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
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

/**
 * To get a list of running instances of a specific app.
 * @param {string} appName App name.
 * @returns {object[]} Array of running apps.
 */
async function getRunningAppList(appName) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const query = { name: appName };
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
      runningSince: 1,
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
  const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  return appInfo;
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
  return appInfo;
}

/**
 * To get app specifications for a specific app (global or local) via API.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationSpecificationAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const specifications = await getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }
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
 * To try spawning a global application. Performs various checks before the app is spawned. Checks that app is not already running on the FluxNode/IP address.
 * Checks if app already has the required number of instances deployed. Checks that application image is not blacklisted. Checks that ports not already in use.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
let firstExecutionAfterItsSynced = true;
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
    if (firstExecutionAfterItsSynced === true) {
      log.info('Explorer Synced, checking for expired apps');
      // eslint-disable-next-line no-use-before-define
      await expireGlobalApplications();
      firstExecutionAfterItsSynced = false;
    }

    const isNodeConfirmed = await generalService.isNodeStatusConfirmed();
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Global applications will not be installed');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

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

    // get all the applications list names
    const globalAppNamesLocation = await getAllGlobalApplications(['name', 'geolocation', 'nodes']);
    const numberOfGlobalApps = globalAppNamesLocation.length;
    if (!numberOfGlobalApps) {
      log.info('No installable application found');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    const installDelay = config.fluxapps.installation.delay * 1000;
    let probLn = Math.log(2 + numberOfGlobalApps); // from ln(2) -> ln(2 + x)
    const adjustedDelay = installDelay / probLn;

    let appToRun;
    // highly favor application that is targetting our node
    // get my collateral
    const myCollateral = await generalService.obtainNodeCollateralInformation();
    // get my ip address
    // filter apps only those that include my ip or my collateral
    const scopedApps = globalAppNamesLocation.filter((app) => app.nodes && (app.nodes.includes(myIP) || app.nodes.includes(`${myCollateral.txhash}:${myCollateral.txindex}`)));
    const scopedAppsToRun = scopedApps.filter((app) => !trySpawningGlobalAppCache.has(app.name));
    // check if this app was already evaluated
    const numberOfScopedAppsToRun = scopedAppsToRun.length;
    if (numberOfScopedAppsToRun) { // some app should be prioritized on our node
      const appToRunNumber = Math.floor((Math.random() * numberOfScopedAppsToRun));
      appToRun = scopedAppsToRun[appToRunNumber].name;
    }

    if (appToRun) { // ensure higher rate spawning for scoped apps
      probLn *= 2;
    }
    // if all ok Check hashes comparison if its out turn to start the app. higher than 1% probability.
    const randomNumber = Math.floor((Math.random() * (config.fluxapps.installation.probability / probLn))); // higher probability for more apps on network
    if (randomNumber !== 0) {
      log.info('Other Flux nodes are evaluating application installation');
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }

    // no scoped applicaton, run some global app
    if (!appToRun) {
      // pick a random one
      const appToRunNumber = Math.floor((Math.random() * numberOfGlobalApps));
      appToRun = globalAppNamesLocation[appToRunNumber].name;

      // force switch to run a geo restricted app
      if (appToRunNumber % 5 === 0) { // every 5th run we are forcing application instalation that is in the nodes geolocation, esnuring highly geolocated apps spawn fast enough
        // get this node location
        const myNodeLocation = nodeFullGeolocation();
        const appsInMyLocation = globalAppNamesLocation.filter((apps) => apps.geolocation && apps.geolocation.find((loc) => `ac${myNodeLocation}`.startsWith(loc)));
        if (appsInMyLocation.length) {
          const numberOfMyNodeGeoApps = appsInMyLocation.length;
          const randomGeoAppNumber = Math.floor((Math.random() * numberOfMyNodeGeoApps));
          // install geo location restricted app instead
          appToRun = appsInMyLocation[randomGeoAppNumber].name;
        }
      }
    }

    // Check if App was checked in the last 2 hours.
    // This is a small help because random can be getting the same app over and over
    if (trySpawningGlobalAppCache.has(appToRun)) {
      log.info(`App ${appToRun} was already evaluated in the last 2 hours.`);
      const delay = numberOfGlobalApps < 20 ? config.fluxapps.installation.delay * 1000 : config.fluxapps.installation.delay * 1000 * 0.1;
      await serviceHelper.delay(delay);
      trySpawningGlobalApplication();
      return;
    }

    trySpawningGlobalAppCache.set(appToRun, appToRun);

    let runningAppList = await getRunningAppList(appToRun);

    const adjustedIP = myIP.split(':')[0]; // just IP address
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`Application ${appToRun} is reported as already running on this Flux IP`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }
    // second check if app is running on this node
    const runningApps = await listRunningApps();
    if (runningApps.status !== 'success') {
      throw new Error('Unable to check running apps on this Flux');
    }
    if (runningApps.data.find((app) => app.Names[0].slice(5) === appToRun)) {
      log.info(`${appToRun} application is already running on this Flux`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }

    // get app specifications
    const appSpecifications = await getApplicationGlobalSpecifications(appToRun);
    if (!appSpecifications) {
      throw new Error(`Specifications for application ${appToRun} were not found!`);
    }

    // check if app is installed on the number of instances requested
    let minInstances = appSpecifications.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
    if (runningAppList.length >= minInstances) {
      log.info(`Application ${appToRun} is already spawned on ${runningAppList.length} instances`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
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
      log.info(`Application ${appSpecifications.name} is already installed`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }
    // TODO evaluate later to move to more broad check as image can be shared among multiple apps
    const compositedSpecification = appSpecifications.compose || [appSpecifications]; // use compose array if v4+ OR if not defined its <= 3 do an array of appSpecs.
    // eslint-disable-next-line no-restricted-syntax
    for (const componentToInstall of compositedSpecification) {
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of apps) {
        const installedAppCompositedSpecification = installedApp.compose || [installedApp];
        // eslint-disable-next-line no-restricted-syntax
        for (const component of installedAppCompositedSpecification) {
          if (component.repotag === componentToInstall.repotag && componentToInstall.repotag.startsWith('presearch/node')) { // applies to presearch specifically
            log.info(`${componentToInstall.repotag} Image is already running on this Flux`);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(adjustedDelay);
            trySpawningGlobalApplication();
            return;
          }
        }
      }
      // check repository whitelisted
      // eslint-disable-next-line no-await-in-loop
      await generalService.checkWhitelistedRepository(componentToInstall.repotag);

      // check repotag if available for download
      // eslint-disable-next-line no-await-in-loop
      await verifyRepository(componentToInstall.repotag, componentToInstall.repoauth);
    }

    // verify app compliance
    await checkApplicationImagesComplience(appSpecifications);

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

    // ensure images exists for platform
    const imagesArchitectureMatches = await ensureApplicationImagesExistsForPlatform(appSpecifications);

    if (imagesArchitectureMatches !== true) {
      log.info(`Application ${appToRun} does not support our node architecture, installation aborted.`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }

    const appPorts = getAppPorts(appSpecifications);
    // check port is not user blocked
    appPorts.forEach((port) => {
      const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
      if (isUserBlocked) {
        throw new Error(`Port ${port} is blocked by user. Installation aborted.`);
      }
    });
    // eslint-disable-next-line no-use-before-define
    const portsPubliclyAvailable = await checkInstallingAppPortAvailable(appPorts);
    if (portsPubliclyAvailable === false) {
      log.error(`Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }

    // double check if app is installed on the number of instances requested
    runningAppList = await getRunningAppList(appToRun);
    minInstances = appSpecifications.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
    if (runningAppList.length >= minInstances) {
      log.info(`Application ${appToRun} is already spawned on ${runningAppList.length} instances`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }

    // an application was selected and checked that it can run on this node. try to install and run it locally
    // install the app
    const registerOk = await registerAppLocally(appSpecifications); // can throw
    if (!registerOk) {
      log.info('Error on registerAppLocally');
      const broadcastedAt = new Date().getTime();
      const appRemovedMessage = {
        type: 'fluxappremoved',
        version: 1,
        appName: appSpecifications.name,
        ip: myIP,
        broadcastedAt,
      };
      log.info('Broadcasting appremoved message to the network');
      // broadcast messages about app removed to all peers
      await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(appRemovedMessage);
      await serviceHelper.delay(500);
      await fluxCommunicationMessagesSender.broadcastMessageToIncoming(appRemovedMessage);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }

    // double check if app is installed in more of the instances requested
    runningAppList = await getRunningAppList(appToRun);
    minInstances = appSpecifications.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
    if (runningAppList.length >= minInstances) {
      log.info(`Application ${appToRun} is already spawned on ${runningAppList.length} instances, will unninstall it`);
      removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
      await serviceHelper.delay(10 * config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    await serviceHelper.delay(10 * config.fluxapps.installation.delay * 1000);
    log.info('Reinitiating possible app installation');
    trySpawningGlobalApplication();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
    trySpawningGlobalApplication();
  }
}

/**
 * To check and notify peers of running apps. Checks if apps are installed, stopped or running.
 */
async function checkAndNotifyPeersOfRunningApps() {
  try {
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
          const appInstalledMasterSlaveCheck = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:'));
          if (appInstalledMasterSlaveCheck) {
            masterSlaveAppsInstalled.push(appInstalledMasterSlave);
          } else if (appDetails) {
            log.warn(`${stoppedApp} is stopped but should be running. Starting...`);
            // it is a stopped global app. Try to run it.
            // check if some removal is in progress and if it is don't start it!
            if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
              log.warn(`${stoppedApp} is stopped, starting`);
              if (!appsStopedCache.has(stoppedApp)) {
                appsStopedCache.set(stoppedApp, stoppedApp);
              } else {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerStart(stoppedApp);
                startAppMonitoring(stoppedApp);
              }
            } else {
              log.warn(`Not starting ${stoppedApp} as application removal or installation is in progress`);
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
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height || 0;
    const apps = [];
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of installedAndRunning) {
        log.info(`${application.name} is running properly. Broadcasting status.`);
        // eslint-disable-next-line no-await-in-loop
        // we can distinguish pure local apps from global with hash and height
        const newAppRunningMessage = {
          type: 'fluxapprunning',
          version: 1,
          name: application.name,
          hash: application.hash, // hash of application specifics that are running
          ip: myIP,
          broadcastedAt: new Date().getTime(),
        };
        const app = {
          name: application.name,
          hash: application.hash,
        };
        apps.push(app);
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop
        await storeAppRunningMessage(newAppRunningMessage);
        if (daemonHeight < config.fluxapps.apprunningv2 || installedAndRunning.length === 1) {
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
          // broadcast messages about running apps to all peers
        }
      }
      if (daemonHeight >= config.fluxapps.apprunningv2 && installedAndRunning.length > 1) {
        // send v2 unique message instead
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: new Date().getTime(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
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
    const minExpirationHeight = explorerHeight - config.fluxapps.minBlocksAllowance; // do a pre search in db as every app has to live for at least minBlocksAllowance
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
    for (const appName of appNamesToExpire) {
      log.info(`Expiring application ${appName}`);
      const queryDeleteApp = { name: appName };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.findOneAndDeleteInDatabase(databaseApps, globalAppsInformation, queryDeleteApp, projectionApps);
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
      await serviceHelper.delay(3 * 60 * 1000); // wait for 3 mins so we don't have more removals at the same time
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
      const runningAppList = await getRunningAppList(installedApp.name);
      const minInstances = installedApp.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
      if (runningAppList.length > (minInstances + config.fluxapps.maximumAdditionalInstances)) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(installedApp.name);
        if (appDetails) {
          log.info(`Application ${installedApp.name} is already spawned on ${runningAppList.length} instances. Checking removal availability..`);
          const randomNumber = Math.floor((Math.random() * config.fluxapps.removal.probability));
          if (randomNumber === 0) {
            log.warn(`Removing application ${installedApp.name} locally`);
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(installedApp.name, null, false, true, true);
            log.warn(`Application ${installedApp.name} locally removed`);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(config.fluxapps.removal.delay * 1000); // wait for 6 mins so we don't have more removals at the same time
          } else {
            log.info(`Other Fluxes are evaluating application ${installedApp.name} removal.`);
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
      }
      return;
    }
    if (installationInProgress) {
      log.warn('Another application is undergoing installation');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing installation');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
      }
      return;
    }
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
    }
    await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins
    // verify requirements
    await checkAppRequirements(appSpecs);
    // register
    await softRegisterAppLocally(appSpecs, undefined, res);
    log.info('Application softly redeployed');
  } catch (error) {
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
          // check if node is capable to run it according to specifications
          // run the verification
          // get tier and adjust specifications
          // eslint-disable-next-line no-await-in-loop
          const tier = await generalService.nodeTier();
          if (appSpecifications.version <= 3) {
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
              try {
                try {
                  // eslint-disable-next-line no-await-in-loop
                  await softRemoveAppLocally(installedApp.name);
                  log.warn('Application softly removed. Awaiting installation...');
                } catch (error) {
                  log.error(error);
                  removalInProgress = false;
                  throw error;
                }
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins so we don't have more removals at the same time
                // eslint-disable-next-line no-await-in-loop
                await checkAppRequirements(appSpecifications);
                // install the app
                // eslint-disable-next-line no-await-in-loop
                await softRegisterAppLocally(appSpecifications);
              } catch (error) {
                log.error(error);
                removeAppLocally(appSpecifications.name, null, true, true, true);
              }
            } else {
              log.warn(`Beginning Hard Redeployment of ${appSpecifications.name}...`);
              // hard redeployment
              try {
                // eslint-disable-next-line no-await-in-loop
                await removeAppLocally(installedApp.name);
                log.warn('Application removed. Awaiting installation...');
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins so we don't have more removals at the same time
                // eslint-disable-next-line no-await-in-loop
                await checkAppRequirements(appSpecifications);

                // install the app
                // eslint-disable-next-line no-await-in-loop
                await registerAppLocally(appSpecifications); // can throw
              } catch (error) {
                log.error(error);
                removeAppLocally(appSpecifications.name, null, true, true, true);
              }
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
              // eslint-disable-next-line no-restricted-syntax
              for (const appComponent of appSpecifications.compose.reverse()) {
                if (appComponent.tiered) {
                  const hddTier = `hdd${tier}`;
                  const ramTier = `ram${tier}`;
                  const cpuTier = `cpu${tier}`;
                  appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
                  appComponent.ram = appComponent[ramTier] || appComponent.ram;
                  appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
                }

                const installedComponent = installedApp.compose.find((component) => component.name === appComponent.name);

                if (appComponent.hdd === installedComponent.hdd) {
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

                if (appComponent.hdd === installedComponent.hdd) {
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
              // eslint-disable-next-line no-await-in-loop
              await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);
              log.warn(`Composed application ${appSpecifications.name} updated.`);
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
 * To get app price.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAppPrice(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;

      appSpecification = serviceHelper.ensureObject(appSpecification);
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
      const respondPrice = messageHelper.createDataMessage(actualPriceToPay);
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
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyAppRegistrationParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;

      appSpecification = serviceHelper.ensureObject(appSpecification);
      const appSpecFormatted = specificationFormatter(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
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
 * To verify app update parameters. Checks for correct format, specs and non-duplication of values/resources.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
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
      const appSpecFormatted = specificationFormatter(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      // check if name is not yet registered
      const timestamp = new Date().getTime();
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
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
    // search in chainparams db for chainmessages of p version
    const appPrices = await getChainParamsPriceUpdates();
    const minPort = daemonHeight >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMinNew : config.fluxapps.portMin;
    const maxPort = daemonHeight >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMaxNew : config.fluxapps.portMax;
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

async function stopSyncthingApp(appComponentName, res) {
  try {
    const identifier = appComponentName;
    const appId = dockerService.getAppIdentifier(identifier);
    if (receiveOnlySyncthingAppsCache.has(appId)) {
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
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.systemRestart();
        const adjustSyncthingB = {
          status: 'Syncthing adjusted',
        };
        log.info(adjustSyncthingA);
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingA));
        }
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingB));
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
    const myDeviceID = await syncthingService.getDeviceID();
    if (myDeviceID.status !== 'success') {
      return;
    }
    const allFoldersResp = await syncthingService.getConfigFolders();
    const allDevicesResp = await syncthingService.getConfigDevices();
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
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
            const devices = [{ deviceID: myDeviceID.data }];
            const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
            // eslint-disable-next-line no-await-in-loop
            await cmdAsync(execDIRst);
            // eslint-disable-next-line no-await-in-loop
            const locations = await appLocation(installedApp.name);
            // eslint-disable-next-line no-restricted-syntax
            for (const appInstance of locations) {
              const ip = appInstance.ip.split(':')[0];
              const port = appInstance.ip.split(':')[1] || 16127;
              const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
              const name = `${ip}:${port}`;
              // eslint-disable-next-line no-await-in-loop
              const deviceID = await getDeviceID(name);
              if (deviceID) {
                if (deviceID !== myDeviceID.data) { // skip my id, already present
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
                  if (deviceID !== myDeviceID.data) {
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
            };
            const syncFolder = allFoldersResp.data.find((x) => x.id === id);
            if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              if (syncthingAppsFirstRun) {
                if (!syncFolder) {
                  log.info(`SyncthingApps stopping and cleaning appIdentifier ${appId}`);
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
                if (!cache.numberOfExecutionsRequired) {
                  // eslint-disable-next-line no-await-in-loop
                  const runningAppList = await getRunningAppList(installedApp.name);
                  runningAppList.sort((a, b) => {
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
                  // eslint-disable-next-line no-await-in-loop
                  const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
                  const index = runningAppList.findIndex((x) => x.ip === myIP);
                  let numberOfExecutionsRequired = 2;
                  if (index > 0) {
                    numberOfExecutionsRequired = 2 + 12 * index;
                  }
                  if (numberOfExecutionsRequired > 60) {
                    numberOfExecutionsRequired = 60;
                  }
                  cache.numberOfExecutionsRequired = numberOfExecutionsRequired;
                }
                syncthingFolder.type = 'receiveonly';
                cache.numberOfExecutions += 1;
                if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                  syncthingFolder.type = 'sendreceive';
                } else if (cache.numberOfExecutions === cache.numberOfExecutionsRequired + 1) {
                  log.info(`SyncthingApps starting appIdentifier ${appId}`);
                  syncthingFolder.type = 'sendreceive';
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerRestart(id);
                  cache.restarted = true;
                }
                receiveOnlySyncthingAppsCache.set(appId, cache);
              } else if (!receiveOnlySyncthingAppsCache.has(appId)) {
                log.info(`SyncthingApps stopping and cleaning appIdentifier ${appId}`);
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
            } else if (syncFolder && (syncFolder.paused || syncFolder.type !== syncthingFolder.type)) {
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
              const devices = [{ deviceID: myDeviceID.data }];
              const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
              // eslint-disable-next-line no-await-in-loop
              await cmdAsync(execDIRst);
              // eslint-disable-next-line no-await-in-loop
              const locations = await appLocation(installedApp.name);
              // eslint-disable-next-line no-restricted-syntax
              for (const appInstance of locations) {
                const ip = appInstance.ip.split(':')[0];
                const port = appInstance.ip.split(':')[1] || 16127;
                const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
                const name = `${ip}:${port}`;
                // eslint-disable-next-line no-await-in-loop
                const deviceID = await getDeviceID(name);
                if (deviceID) {
                  if (deviceID !== myDeviceID.data) { // skip my id, already present
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
                    if (deviceID !== myDeviceID.data) {
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
              };
              const syncFolder = allFoldersResp.data.find((x) => x.id === id);
              if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
                if (syncthingAppsFirstRun) {
                  if (!syncFolder) {
                    log.info(`SyncthingApps stopping and cleaning appIdentifier ${appId}`);
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
                  if (!cache.numberOfExecutionsRequired) {
                    // eslint-disable-next-line no-await-in-loop
                    const runningAppList = await getRunningAppList(installedApp.name);
                    log.info(`SyncthingApps appIdentifier ${appId} is running on nodes ${JSON.stringify(runningAppList)}`);
                    runningAppList.sort((a, b) => {
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
                    // eslint-disable-next-line no-await-in-loop
                    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
                    const index = runningAppList.findIndex((x) => x.ip === myIP);
                    log.info(`SyncthingApps appIdentifier ${appId} is node index ${index}`);
                    let numberOfExecutionsRequired = 2;
                    if (index > 0) {
                      numberOfExecutionsRequired = 2 + 12 * index;
                    }
                    if (numberOfExecutionsRequired > 60) {
                      numberOfExecutionsRequired = 60;
                    }
                    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;
                  }
                  syncthingFolder.type = 'receiveonly';
                  cache.numberOfExecutions += 1;
                  log.info(`SyncthingApps appIdentifier ${appId} execution ${cache.numberOfExecutions} of ${cache.numberOfExecutionsRequired + 1} to start the app`);
                  if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                    syncthingFolder.type = 'sendreceive';
                  } else if (cache.numberOfExecutions === cache.numberOfExecutionsRequired + 1) {
                    log.info(`SyncthingApps starting appIdentifier ${appId}`);
                    syncthingFolder.type = 'sendreceive';
                    // eslint-disable-next-line no-await-in-loop
                    await appDockerRestart(id);
                    cache.restarted = true;
                  }
                  receiveOnlySyncthingAppsCache.set(appId, cache);
                } else if (!receiveOnlySyncthingAppsCache.has(appId)) {
                  log.info(`SyncthingApps stopping and cleaning appIdentifier ${appId}`);
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
              } else if (syncFolder && (syncFolder.paused || syncFolder.type !== syncthingFolder.type)) {
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
      log.info(`Removing unused Syncthing of folder ${nonUsedFolder.id}`);
      // eslint-disable-next-line no-await-in-loop
      await syncthingService.adjustConfigFolders('delete', undefined, nonUsedFolder.id);
    }
    // remove obsolete devices
    const nonUsedDevices = allDevicesResp.data.filter((syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedDevice of nonUsedDevices) {
      // exclude our deviceID
      if (nonUsedDevice.deviceID !== myDeviceID.data) {
        log.info(`Removing unused Syncthing device ${nonUsedDevice.deviceID}`);
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
        log.error(`Errors detected on syncthing folderId:${folder.id} - folder index database is going to be reseted`);
        log.error(folderError);
        folder.paused = true;
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigFolders('put', folder, folder.id); // systemResetFolder id requires the folder to be paused before execution
        // eslint-disable-next-line no-await-in-loop
        const folderReset = await syncthingService.systemResetFolderId(folder.id);
        log.error(folderReset);
        folder.paused = false;
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigFolders('put', folder, folder.id);
      }
    }
    // check if restart is needed
    const restartRequired = await syncthingService.getConfigRestartRequired();
    if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
      log.info('New configuration applied. Syncthing restart required, restarting...');
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
      let fdmOk = false;
      let identifier;
      let needsToBeChecked = false;
      let appId;
      if (installedApp.version <= 3) {
        identifier = installedApp.name;
        appId = dockerService.getAppIdentifier(identifier);
        needsToBeChecked = installedApp.containerData.includes('g:') && receiveOnlySyncthingAppsCache.get(appId).restarted;
      } else {
        const componentUsingMasterSlave = installedApp.compose.find((comp) => comp.containerData.includes('g:'));
        if (componentUsingMasterSlave) {
          identifier = `${componentUsingMasterSlave.name}_${installedApp.name}`;
          appId = dockerService.getAppIdentifier(identifier);
          needsToBeChecked = receiveOnlySyncthingAppsCache.get(appId).restarted;
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
        let serverStatus = null;
        // eslint-disable-next-line no-await-in-loop
        let fdmEUData = await serviceHelper.axiosGet(`https://fdm-fn-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name};json;norefresh`, axiosOptions).catch((error) => {
          log.error(`masterSlaveApps: Failed to reach EU FDM with error: ${error}`);
        });
        fdmEUData = fdmEUData.data;
        fdmOk = true;
        if (fdmEUData && fdmEUData.length > 0) {
          const ipElement = fdmEUData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
          if (ipElement) {
            ip = ipElement.value.value.split(':')[0];
            serverStatus = fdmEUData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'status').value.value;
          }
        }
        if (!ip || !serverStatus) {
          // eslint-disable-next-line no-await-in-loop
          let fdmUSAData = await serviceHelper.axiosGet(`https://fdm-usa-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name};json;norefresh`, axiosOptions).catch((error) => {
            log.error(`masterSlaveApps: Failed to reach USA FDM with error: ${error}`);
          });
          fdmUSAData = fdmUSAData.data;
          fdmOk = true;
          if (fdmUSAData && fdmUSAData.length > 0) {
            const ipElement = fdmUSAData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
            if (ipElement) {
              ip = ipElement.value.value.split(':')[0];
              serverStatus = fdmUSAData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'status').value.value;
            }
          }
        }
        if (!ip || !serverStatus) {
          // eslint-disable-next-line no-await-in-loop
          let fdmASIAData = await serviceHelper.axiosGet(`https://fdm-sg-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name};json;norefresh`, axiosOptions).catch((error) => {
            log.error(`masterSlaveApps: Failed to reach ASIA FDM with error: ${error}`);
          });
          fdmASIAData = fdmASIAData.data;
          fdmOk = true;
          if (fdmASIAData && fdmASIAData.length > 0) {
            const ipElement = fdmASIAData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
            if (ipElement) {
              ip = ipElement.value.value.split(':')[0];
              serverStatus = fdmASIAData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'status').value.value;
            }
          }
        }
        if (fdmOk) {
          // no ip means there was no row with ip on fdm
          // down means there was a row ip with status down
          if ((!ip || serverStatus === 'DOWN')) {
            if (!runningAppsNames.includes(identifier)) {
              appDockerRestart(installedApp.name);
              log.info(`masterSlaveApps: starting docker app:${installedApp.name}`);
            }
          } else {
            // eslint-disable-next-line no-await-in-loop
            let myIP = await fluxNetworkHelper.getMyFluxIPandPort();
            myIP = myIP.split(':')[0];
            if (myIP !== ip && runningAppsNames.includes(identifier)) {
              appDockerStop(installedApp.name);
              log.info(`masterSlaveApps: stopping docker app:${installedApp.name}`);
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
 * Periodically check for our applications port range is available
*/
let failedPort;
let testingPort;
const portsNotWorking = [];
let lastUPNPMapFailed = false;
async function checkMyAppsAvailability() {
  const isUPNP = upnpService.isUPNP();
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
    const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!currentHeight) {
      throw new Error('No scanned height found');
    }
    if (dosMountMessage || dosDuplicateAppMessage) {
      dosMessage = dosMountMessage || dosDuplicateAppMessage;
      dosState = 100;
      return;
    }
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      log.info('Flux Node daemon not synced. Application checks are disabled');
      await serviceHelper.delay(4 * 60 * 1000);
      checkMyAppsAvailability();
      return;
    }
    const isNodeConfirmed = await generalService.isNodeStatusConfirmed();
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Application checks are disabled');
      await serviceHelper.delay(4 * 60 * 1000);
      checkMyAppsAvailability();
      return;
    }
    let myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    myIP = myIP.split(':')[0];
    const myPort = myIP.split(':')[1] || 16127;
    // go through all our installed apps and test if they are available on a random node
    let portTestFailed = false;
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const apps = installedAppsRes.data;
    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    const appPorts = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
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
    }
    const minPort = currentHeight.generalScannedHeight >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMinNew : config.fluxapps.portMin - 1000;
    const maxPort = currentHeight.generalScannedHeight >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMaxNew : config.fluxapps.portMax;
    // choose random port
    const min = minPort;
    const max = maxPort;
    testingPort = failedPort || Math.floor(Math.random() * (max - min) + min);

    log.info(`checkMyAppsAvailability - Testing port ${testingPort}.`);
    const portNotWorking = portsNotWorking.includes(testingPort);
    if (portNotWorking) {
      log.info(`checkMyAppsAvailability - Testing port ${testingPort} is part of the list of ports not working on this node.`);
      failedPort = null;
      // skip this check, port is not possible to run on flux
      await serviceHelper.delay(15 * 1000);
      checkMyAppsAvailability();
      return;
    }
    let iBP = fluxNetworkHelper.isPortBanned(testingPort);
    if (iBP) {
      log.info(`checkMyAppsAvailability - Testing port ${testingPort} is banned.`);
      failedPort = null;
      // skip this check, port is not possible to run on flux
      await serviceHelper.delay(15 * 1000);
      checkMyAppsAvailability();
      return;
    }
    if (isUPNP) {
      iBP = fluxNetworkHelper.isPortUPNPBanned(testingPort);
      if (iBP) {
        log.info(`checkMyAppsAvailability - Testing port ${testingPort} is UPNP banned.`);
        failedPort = null;
        // skip this check, port is not possible to run on flux
        await serviceHelper.delay(15 * 1000);
        checkMyAppsAvailability();
        return;
      }
    }
    const isPortUserBlocked = fluxNetworkHelper.isPortUserBlocked(testingPort);
    if (isPortUserBlocked) {
      log.info(`checkMyAppsAvailability - Testing port ${testingPort} is user blocked.`);
      failedPort = null;
      // skip this check, port is not allowed for this flux node by user
      await serviceHelper.delay(15 * 1000);
      checkMyAppsAvailability();
      return;
    }
    if (appPorts.includes(testingPort)) {
      log.info(`checkMyAppsAvailability - Skipped checking ${testingPort} - in use.`);
      failedPort = null;
      // skip this check
      await serviceHelper.delay(15 * 1000);
      checkMyAppsAvailability();
      return;
    }
    // now open this port properly and launch listening on it
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.allowPort(testingPort);
    }
    if (isUPNP) {
      const upnpMapResult = await upnpService.mapUpnpPort(testingPort, 'Flux_Test_App');
      if (!upnpMapResult) {
        if (lastUPNPMapFailed) {
          dosState += 0.4;
          if (dosState > 10) {
            dosMessage = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings.';
          }
        }
        lastUPNPMapFailed = true;
        log.info(`checkMyAppsAvailability - Testing port ${testingPort} failed to create on UPNP mappings. Possible already assigned?`);
        failedPort = null;
        throw new Error('Failed to create map UPNP port');
      }
      lastUPNPMapFailed = false;
    }
    await serviceHelper.delay(5 * 1000);
    testingAppserver.listen(testingPort).on('error', (err) => {
      throw err.message;
    }).on('uncaughtException', (err) => {
      throw err.message;
    });
    await serviceHelper.delay(10 * 1000);
    // eslint-disable-next-line no-await-in-loop
    let askingIP = await fluxNetworkHelper.getRandomConnection();
    if (!askingIP) {
      checkMyAppsAvailability();
      return;
    }
    let askingIpPort = config.server.apiport;
    if (askingIP.includes(':')) { // has port specification
      // it has port specification
      const splittedIP = askingIP.split(':');
      askingIP = splittedIP[0];
      askingIpPort = splittedIP[1];
    }
    if (myIP === askingIP) {
      checkMyAppsAvailability();
      return;
    }
    if (failedNodesTestPortsCache.has(askingIP)) {
      checkMyAppsAvailability();
      return;
    }
    const timeout = 30000;
    const axiosConfig = {
      timeout,
    };
    const data = {
      ip: myIP,
      port: myPort,
      appname: 'appPortsTest',
      ports: [testingPort],
      pubKey,
    };
    const stringData = JSON.stringify(data);
    // eslint-disable-next-line no-await-in-loop
    const signature = await signCheckAppData(stringData);
    data.signature = signature;
    // first check against our IP address
    // eslint-disable-next-line no-await-in-loop
    const resMyAppAvailability = await axios.post(`http://${askingIP}:${askingIpPort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig).catch((error) => {
      log.error(`checkMyAppsAvailability - ${askingIP} for app availability is not reachable`);
      log.error(error);
      failedPort = testingPort;
      failedNodesTestPortsCache.set(askingIP, askingIP);
    });
    if (resMyAppAvailability && resMyAppAvailability.data.status === 'error') {
      log.warn(`checkMyAppsAvailability - Applications port range unavailability detected from ${askingIP}:${askingIpPort} on ${testingPort}`);
      log.warn(JSON.stringify(data));
      portTestFailed = true;
      dosState += 0.4;
      failedPort = testingPort;
      failedNodesTestPortsCache.set(askingIP, askingIP);
    } else if (resMyAppAvailability && resMyAppAvailability.data.status === 'success') {
      log.info(`${resMyAppAvailability.data.data.message} Detected from ${askingIP}:${askingIpPort} on ${testingPort}`);
      failedPort = null;
    }

    if (dosState > 10) {
      dosMessage = `Applications port range is not reachable from outside! All ports that have failed: ${JSON.stringify(portsNotWorking)}`;
    }
    // stop listening on the port, close the port
    if (firewallActive) {
      await fluxNetworkHelper.deleteAllowPortRule(testingPort);
    }
    if (isUPNP) {
      await upnpService.removeMapUpnpPort(testingPort, 'Flux_Test_App');
    }

    testingAppserver.shutdown((err) => {
      if (err) {
        log.error(`testingAppserver Shutdown failed: ${err.message}`);
      }
    });
    if (!portTestFailed) {
      dosState = 0;
      dosMessage = dosMountMessage || dosDuplicateAppMessage || null;
      await serviceHelper.delay(60 * 60 * 1000);
    } else {
      portsNotWorking.push(failedPort);
      log.error(`checkMyAppsAvailability - portsNotWorking ${JSON.stringify(portsNotWorking)}.`);
      if (portsNotWorking.length <= 100) {
        failedPort = null;
        dosState = 0;
        dosMessage = dosMountMessage || dosDuplicateAppMessage || null;
      }
      await serviceHelper.delay(1 * 60 * 1000);
    }
    checkMyAppsAvailability();
  } catch (error) {
    if (dosMountMessage || dosDuplicateAppMessage) {
      dosMessage = dosMountMessage || dosDuplicateAppMessage;
    }
    let firewallActive = true;
    firewallActive = await fluxNetworkHelper.isFirewallActive().catch((e) => log.error(e));
    // stop listening on the testing port, close the port
    if (firewallActive) {
      await fluxNetworkHelper.deleteAllowPortRule(testingPort).catch((e) => log.error(e));
    }
    if (isUPNP) {
      await upnpService.removeMapUpnpPort(testingPort, 'Flux_Test_App').catch((e) => log.error(e));
    }
    testingAppserver.shutdown((err) => {
      if (err) {
        log.error(`testingAppserver shutdown failed: ${err.message}`);
      }
    });
    log.error(`checkMyAppsAvailability - Error: ${error}`);
    await serviceHelper.delay(4 * 60 * 1000);
    checkMyAppsAvailability();
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
    let myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    myIP = myIP.split(':')[0];
    const myPort = myIP.split(':')[1] || 16127;
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
    // eslint-disable-next-line no-await-in-loop
    let askingIP = await fluxNetworkHelper.getRandomConnection();
    while (!askingIP || askingIP.split(':')[0] === myIP) {
      // eslint-disable-next-line no-await-in-loop
      askingIP = await fluxNetworkHelper.getRandomConnection();
    }
    let askingIpPort = config.server.apiport;
    if (askingIP.includes(':')) { // has port specification
      // it has port specification
      const splittedIP = askingIP.split(':');
      askingIP = splittedIP[0];
      askingIpPort = splittedIP[1];
    }
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
          failedPort = portToRetest;
        }
      }
      portsStatus = false;
    } else if (resMyAppAvailability && resMyAppAvailability.data.status === 'success') {
      portsStatus = true;
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

    const execDIR = `sudo mkdir -p ${appsFolder + appId}/appdata`;
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
  getRunningAppList,
  trySpawningGlobalApplication,
  getApplicationSpecifications,
  getStrictApplicationSpecifications,
  getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications,
  getApplicationSpecificationAPI,
  getApplicationOwnerAPI,
  checkAndNotifyPeersOfRunningApps,
  rescanGlobalAppsInformationAPI,
  reindexGlobalAppsInformationAPI,
  reindexGlobalAppsLocationAPI,
  expireGlobalApplications,
  installAppLocally,
  updateAppGlobalyApi,
  getAppPrice,
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
  getAppsDOSState,
  checkMyAppsAvailability,
  checkApplicationsCompliance,
  testAppMount,
  checkStorageSpaceForApps,

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
  getAuthToken,
  masterSlaveApps,
};
