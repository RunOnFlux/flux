const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
const path = require('path');
const nodecmd = require('node-cmd');
const df = require('node-df');
const LRU = require('lru-cache');
const systemcrontab = require('crontab');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const fluxCommunication = require('./fluxCommunication');
const serviceHelper = require('./serviceHelper');
const daemonService = require('./daemonService');
const dockerService = require('./dockerService');
const generalService = require('./generalService');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fluxDirPath = path.join(__dirname, '../../../');
const appsFolder = `${fluxDirPath}ZelApps/`;

const cmdAsync = util.promisify(nodecmd.get);
const crontabLoad = util.promisify(systemcrontab.load);
const dockerPullStreamPromise = util.promisify(dockerService.dockerPullStream);

const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;

const localAppsInformation = config.database.appslocal.collections.appsInformation;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

// default cache
const LRUoptions = {
  max: 500, // store 500 values, we shall not have more values at any period
  maxAge: 1000 * 60 * 10, // 10 minutes
};
const myCache = new LRU(LRUoptions);

let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;

const nodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

async function appPull(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      let { repotag } = req.params;
      repotag = repotag || req.query.repotag;
      if (!repotag) {
        throw new Error('No Docker repository specified');
      }
      await dockerPullStreamPromise(repotag, res);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function listRunningApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(false);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].substr(1, 3) === 'zel' || app.Names[0].substr(1, 4) === 'flux'));
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
    const appsResponse = serviceHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

// shall be identical to installedApps. But this is docker response
async function listAllApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(true);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].substr(1, 3) === 'zel' || app.Names[0].substr(1, 4) === 'flux'));
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
    const appsResponse = serviceHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function listAppsImages(req, res) {
  try {
    const apps = await dockerService.dockerListImages();
    const appsResponse = serviceHelper.createDataMessage(apps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appStart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerStart(appname);
    } else {
      // ask for starting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerStart(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStart(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} started`;
      }
    }

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appStop(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerStop(appname);
    } else {
      // ask for starting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerStop(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose.reverse()) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} stopped`;
      }
    }

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appRestart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerRestart(appname);
    } else {
      // ask for starting entire composed application
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

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appKill(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerKill(appname);
    } else {
      // ask for starting entire composed application
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

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appPause(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerPause(appname);
    } else {
      // ask for starting entire composed application
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

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appUnpause(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const isComponent = appname.includes('_'); // it is a component start. Proceed with starting just component

    let appRes;
    if (isComponent) {
      appRes = await dockerService.appDockerUnpase(appname);
    } else {
      // ask for starting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        appRes = await dockerService.appDockerUnpase(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerUnpase(`${appComponent.name}_${appSpecs.name}`);
        }
        appRes = `Application ${appSpecs.name} unpaused`;
      }
    }

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appTop(req, res) {
  try {
    // List processes running inside a container
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await dockerService.appDockerTop(appname);

    const appResponse = serviceHelper.createDataMessage(appRes);
    return res ? res.json(appResponse) : appResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

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

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const logs = await dockerService.dockerContainerLogs(appname, lines);
      const dataMessage = serviceHelper.createDataMessage(logs);
      res.json(dataMessage);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function appLogStream(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      res.setHeader('Content-Type', 'application/json');
      dockerService.dockerContainerLogsStream(appname, res, (error) => {
        if (error) {
          log.error(error);
          const errorResponse = serviceHelper.createErrorMessage(
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
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function appInspect(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerInspect(appname);
      const appResponse = serviceHelper.createDataMessage(response);
      res.json(appResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

async function appStats(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerStats(appname);
      const appResponse = serviceHelper.createDataMessage(response);
      res.json(appResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

async function appChanges(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, mainAppName);
    if (authorized === true) {
      const response = await dockerService.dockerContainerChanges(appname);
      const appResponse = serviceHelper.createDataMessage(response);
      res.json(appResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

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

      const authorized = await serviceHelper.verifyPrivilege('appowner', req, mainAppName);
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
            const errorResponse = serviceHelper.createErrorMessage(
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
        const errMessage = serviceHelper.errUnauthorizedMessage();
        res.json(errMessage);
      }
    } catch (error) {
      log.error(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

async function createFluxNetworkAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    const dockerRes = await dockerService.createFluxDockerNetwork();
    const response = serviceHelper.createDataMessage(dockerRes);
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

async function fluxUsage(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      log.error('Scanning not initiated');
    }
    let explorerHeight = 999999999;
    if (result) {
      explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight) || 999999999;
    }
    const syncStatus = daemonService.isDaemonSynced();
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
    const appsQuery = { cpu: { $gte: 0 } };
    const appsProjection = {
      projection: {
        _id: 0,
        cpu: 1,
      },
    };
    const appsResult = await serviceHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    appsResult.forEach((app) => {
      appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
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
    const response = serviceHelper.createDataMessage(avgOfUsage);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function appsResources(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = { cpu: { $gte: 0 } };
    const appsProjection = {
      projection: {
        _id: 0,
        cpu: 1,
        ram: 1,
        hdd: 1,
      },
    };
    const appsResult = await serviceHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    let appsCpusLocked = 0;
    let appsRamLocked = 0;
    let appsHddLocked = 0;
    appsResult.forEach((app) => {
      appsCpusLocked += serviceHelper.ensureNumber(app.cpu) || 0;
      appsRamLocked += serviceHelper.ensureNumber(app.ram) || 0;
      appsHddLocked += serviceHelper.ensureNumber(app.hdd) || 0;
    });
    const appsUsage = {
      appsCpusLocked,
      appsRamLocked,
      appsHddLocked,
    };
    const response = serviceHelper.createDataMessage(appsUsage);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

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
      const benchmarkResponse = await daemonService.getBenchmarks();
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
  const useableSpaceOnNode = totalSpaceOnNode - config.lockedSystemResources.hdd;
  const resourcesLocked = await appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux App. Aborting.');
  }
  const hddLockedByApps = resourcesLocked.data.appsHddLocked;
  const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps + appSpecifications.hdd; // because our application is already accounted in locked resources
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
  // space that is further reserved for flux os and that will be later substracted from available space. Max 30.
  const fluxSystemReserve = config.lockedSystemResources.hdd - usedSpace > 0 ? config.lockedSystemResources.hdd - usedSpace : 0;
  const totalAvailableSpaceLeft = availableSpace - fluxSystemReserve;
  if (appSpecifications.hdd >= totalAvailableSpaceLeft) {
    // sadly user free space is not enough for this application
    throw new Error('Insufficient space on Flux Node. Space is already assigned to system files');
  }

  // check if space is not sharded in some bad way. Always count the fluxSystemReserve
  let useThisVolume = null;
  const totalVolumes = okVolumes.length;
  for (let i = 0; i < totalVolumes; i += 1) {
    // check available volumes one by one. If a sufficient is found. Use this one.
    if (okVolumes[i].available > appSpecifications.hdd + fluxSystemReserve) {
      useThisVolume = okVolumes[i];
      break;
    }
  }
  if (!useThisVolume) {
    // no useable volume has such a big space for the app
    throw new Error('Insufficient space on Flux Node. No useable volume found.');
  }

  // now we know there is a space and we have a volum we can operate with. Let's do volume magic
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

    let execDD = `sudo fallocate -l ${appSpecifications.hdd}G ${useThisVolume.mount}/${appId}FLUXFSVOL`; // eg /mnt/sthMounted/zelappTEMP
    if (useThisVolume.mount === '/') {
      execDD = `sudo fallocate -l ${appSpecifications.hdd}G ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`; // if root mount then temp file is /tmp/zelappTEMP
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
    const execDIR = `sudo mkdir -p ${appsFolder + appId}`;
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
    const message = serviceHelper.createSuccessMessage('Flux App volume creation completed.');
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
    await cmdAsync(execRemoveAlloc);
    const execFinal = `sudo rm -rf ${appsFolder + appId}/${appId}VERTEMP`;
    await cmdAsync(execFinal);
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

async function appUninstallHard(appName, appId, appSpecifications, isComponent, res) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
  }
  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = serviceHelper.createErrorMessage(
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

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
  }
  await dockerService.appDockerRemove(appId).catch((error) => {
    const errorResponse = serviceHelper.createErrorMessage(
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
    const errorResponse = serviceHelper.createErrorMessage(
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
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecifications.ports) {
      // eslint-disable-next-line no-await-in-loop
      await fluxCommunication.denyPort(serviceHelper.ensureNumber(port));
    }
    // v1 compatibility
  } else if (appSpecifications.port) {
    await fluxCommunication.denyPort(serviceHelper.ensureNumber(appSpecifications.port));
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

// force determines if some a check for app not found is skipped. Works for both entire app or app component
async function removeAppLocally(app, res, force = false, endResponse = true) {
  try {
    // remove app from local machine.
    // find in database, stop app, remove container, close ports delete data associated on system, remove from database
    // we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
    if (!force) {
      if (removalInProgress) {
        log.warn('Another application is undergoing removal');
        if (res) {
          res.write(serviceHelper.ensureString('Another application is undergoing removal'));
          if (endResponse) {
            res.end();
          }
        }
        return;
      }
      if (installationInProgress) {
        log.warn('Another application is undergoing installation');
        if (res) {
          res.write(serviceHelper.ensureString('Another application is undergoing installation'));
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
    const dbopen = serviceHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const database = dbopen.db(config.database.appsglobal.database);

    const appsQuery = { name: appName };
    const appsProjection = {};
    let appSpecifications = await serviceHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (!appSpecifications) {
      if (!force) {
        throw new Error('Flux App not found');
      }
      // get it from global Specifications
      appSpecifications = await serviceHelper.findOneInDatabase(database, globalAppsInformation, appsQuery, appsProjection);
      if (!appSpecifications) {
        // get it from locally available Specifications
        // eslint-disable-next-line no-use-before-define
        const allApps = await availableApps();
        appSpecifications = allApps.find((a) => a.name === appName);
        // get it from permanent messages
        if (!appSpecifications) {
          const query = {};
          const projection = { projection: { _id: 0 } };
          const messages = await serviceHelper.findInDatabase(database, globalAppsMessages, query, projection);
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

    let appId = dockerService.getAppIdentifier(app); // get app or component app identifier

    if (appSpecifications.version === 4 && !isComponent) {
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
    if (!isComponent) {
      const databaseStatus = {
        status: 'Cleaning up database...',
      };
      log.info(databaseStatus);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus));
      }
      await serviceHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
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
    const errorResponse = serviceHelper.createErrorMessage(
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

async function appUninstallSoft(appName, appId, appSpecifications, isComponent, res) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
  }

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
    const errorResponse = serviceHelper.createErrorMessage(
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
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecifications.ports) {
      // eslint-disable-next-line no-await-in-loop
      await fluxCommunication.denyPort(serviceHelper.ensureNumber(port));
    }
    // v1 compatibility
  } else if (appSpecifications.port) {
    await fluxCommunication.denyPort(serviceHelper.ensureNumber(appSpecifications.port));
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

// removal WITHOUT storage deletion and catches. For app reload. Only for internal useage. We throwing in functinos using this
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
  const dbopen = serviceHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appslocal.database);

  const appsQuery = { name: appName };
  const appsProjection = {};
  const appSpecifications = await serviceHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
  if (!appSpecifications) {
    throw new Error('Flux App not found');
  }

  let appId = dockerService.getAppIdentifier(app);

  if (appSpecifications.version === 4 && !isComponent) {
    // it is a composed application
    // eslint-disable-next-line no-restricted-syntax
    for (const appComposedComponent of appSpecifications.compose.reverse()) {
      isComponent = true;
      appId = `${appComposedComponent.name}_${appSpecifications.name}`;
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
    await serviceHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
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

async function removeAppLocallyApi(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (appname.includes('_')) {
      throw new Error('Components cannot be removed manually');
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    } else {
      // remove app from local machine.
      // find in database, stop app, remove container, close ports delete data associated on system, remove from database
      // if other container uses the same image -> then it shall result in an error so ok anyway
      res.setHeader('Content-Type', 'application/json');
      removeAppLocally(appname, res, force);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

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
        cpu += appSpecifications.cpu;
        ram += appSpecifications.ram;
        hdd += appSpecifications.hdd;
      }
    });
  }
  return {
    cpu,
    ram,
    hdd,
  };
}

async function checkAppRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  const tier = await generalService.nodeTier();
  const resourcesLocked = await appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
  }

  const appHWrequirements = totalAppHWRequirements(appSpecs, tier);
  await getNodeSpecs();
  const totalSpaceOnNode = nodeSpecs.ssdStorage;
  const useableSpaceOnNode = totalSpaceOnNode - config.lockedSystemResources.hdd;
  const hddLockedByApps = resourcesLocked.data.apsHddLocked;
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

async function installApplicationHard(appSpecifications, appName, isComponent, res) {
  // pull image // todo pull to be promise
  // eslint-disable-next-line no-unused-vars
  await dockerPullStreamPromise(appSpecifications.repotag, res);
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

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent);

  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
  }
  if (appSpecifications.ports) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecifications.ports) {
      // eslint-disable-next-line no-await-in-loop
      const portResponse = await fluxCommunication.allowPort(serviceHelper.ensureNumber(port));
      if (portResponse.status === true) {
        const portStatus = {
          status: `'Port ${port} OK'`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
        }
      } else {
        throw new Error(`Error: Port ${port} FAILed to open.`);
      }
    }
  } else if (appSpecifications.port) {
    // v1 compatibility
    const portResponse = await fluxCommunication.allowPort(serviceHelper.ensureNumber(appSpecifications.port));
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
  }
  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
  }
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  const app = await dockerService.appDockerStart(dockerService.getAppIdentifier(identifier));
  installationInProgress = false;
  if (!app) {
    return;
  }
  const appResponse = serviceHelper.createDataMessage(app);
  log.info(appResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appResponse));
  }
}

async function registerAppLocally(appSpecs, componentSpecs, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from aapp messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    if (removalInProgress) {
      log.error('Another application is undergoing removal');
      return;
    }
    if (installationInProgress) {
      log.error('Another application is undergoing installation');
      return;
    }
    installationInProgress = true;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    if (!tier) {
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
    const dbopen = serviceHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = { name: appName };
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if fluxDockerNetwork exists, if not create
    const fluxNetworkStatus = {
      status: 'Checking Flux network...',
    };
    log.info(fluxNetworkStatus);
    if (res) {
      res.write(serviceHelper.ensureString(fluxNetworkStatus));
    }
    const fluxNet = await dockerService.createFluxDockerNetwork().catch((error) => log.error(error));
    if (!fluxNet) {
      return;
    }
    const fluxNetResponse = serviceHelper.createDataMessage(fluxNet);
    log.info(fluxNetResponse);
    if (res) {
      res.write(serviceHelper.ensureString(fluxNetResponse));
    }

    // check if app is already installed
    const checkDb = {
      status: 'Checking database...',
    };
    log.info(checkDb);
    if (res) {
      res.write(serviceHelper.ensureString(checkDb));
    }
    const appResult = await serviceHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (appResult && !isComponent) {
      installationInProgress = false;
      log.error(`Flux App ${appName} already installed`);
      if (res) {
        res.write(`Flux App ${appName} already installed`);
        res.end();
      }
      return;
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
      await serviceHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);
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
        await installApplicationHard(appComponentSpecs, appName, isComponent, res);
      }
    } else {
      await installApplicationHard(specificationsToInstall, appName, isComponent, res);
    }

    // all done message
    const successStatus = {
      status: `Flux App ${appName} successfully installed and launched`,
    };
    log.info(successStatus);
    if (res) {
      res.write(serviceHelper.ensureString(successStatus));
      res.end();
    }
  } catch (error) {
    installationInProgress = false;
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
    }
    const removeStatus = serviceHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
    }
    installationInProgress = false;
    removeAppLocally(appSpecs.name, res, true);
  }
}

async function installApplicationSoft(appSpecifications, appName, isComponent, res) {
  // pull image // todo pull to be promise
  // eslint-disable-next-line no-unused-vars
  await dockerPullStreamPromise(appSpecifications.repotag, res);
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

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent);

  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
  }
  if (appSpecifications.ports) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecifications.ports) {
      // eslint-disable-next-line no-await-in-loop
      const portResponse = await fluxCommunication.allowPort(serviceHelper.ensureNumber(port));
      if (portResponse.status === true) {
        const portStatus = {
          status: `'Port ${port} OK'`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
        }
      } else {
        throw new Error(`Error: Port ${port} FAILed to open.`);
      }
    }
  } else if (appSpecifications.port) {
    // v1 compatibility
    const portResponse = await fluxCommunication.allowPort(serviceHelper.ensureNumber(appSpecifications.port));
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
  }
  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
  }
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  const app = await dockerService.appDockerStart(dockerService.getAppIdentifier(identifier));
  installationInProgress = false;
  if (!app) {
    return;
  }
  const appResponse = serviceHelper.createDataMessage(app);
  log.info(appResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appResponse));
  }
}

// register app with volume already existing
async function softRegisterAppLocally(appSpecs, componentSpecs, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  // throw without catching
  try {
    if (removalInProgress) {
      log.error('Another application is undergoing removal');
      return;
    }
    if (installationInProgress) {
      log.error('Another application is undergoing installation');
      return;
    }
    installationInProgress = true;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    if (!tier) {
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
    const dbopen = serviceHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = { name: appName };
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if fluxDockerNetwork exists, if not create
    const fluxNetworkStatus = {
      status: 'Checking Flux network...',
    };
    log.info(fluxNetworkStatus);
    if (res) {
      res.write(serviceHelper.ensureString(fluxNetworkStatus));
    }
    const fluxNet = await dockerService.createFluxDockerNetwork().catch((error) => log.error(error));
    if (!fluxNet) {
      return;
    }
    const fluxNetResponse = serviceHelper.createDataMessage(fluxNet);
    log.info(fluxNetResponse);
    if (res) {
      res.write(serviceHelper.ensureString(fluxNetResponse));
    }

    // check if app is already installed
    const checkDb = {
      status: 'Checking database...',
    };
    log.info(checkDb);
    if (res) {
      res.write(serviceHelper.ensureString(checkDb));
    }
    const appResult = await serviceHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (appResult && !isComponent) {
      installationInProgress = false;
      log.error(`Flux App ${appName} already installed`);
      if (res) {
        res.write(`Flux App ${appName} already installed`);
        res.end();
      }
      return;
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
      await serviceHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);
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
        await installApplicationSoft(appComponentSpecs, appName, isComponent, res);
      }
    } else {
      await installApplicationSoft(specificationsToInstall, appName, isComponent, res);
    }
    // all done message
    const successStatus = {
      status: `Flux App ${appName} successfully installed and launched`,
    };
    log.info(successStatus);
    if (res) {
      res.write(serviceHelper.ensureString(successStatus));
      res.end();
    }
  } catch (error) {
    installationInProgress = false;
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
    }
    const removeStatus = serviceHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
    }
    installationInProgress = false;
    removeAppLocally(appSpecs.name, res, true);
  }
}

function appPricePerMonth(dataForAppRegistration, height) {
  if (!dataForAppRegistration) {
    return new Error('Application specification not provided');
  }
  const intervals = config.fluxapps.price.filter((i) => i.height <= height);
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
      const totalPrice = cpuTotal + ramTotal + hddTotal;
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
    const totalPrice = cpuTotal + ramTotal + hddTotal;
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
  });
  const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
  const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
  const hddPrice = hddTotalCount * priceSpecifications.hdd;
  const totalPrice = cpuPrice + ramPrice + hddPrice;
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

function checkHWParameters(appSpecs) {
  // check specs parameters. JS precision
  if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
    throw new Error(`CPU badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram) || appSpecs.ram < 100) {
    throw new Error(`RAM badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
    throw new Error(`SSD badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.tiered) {
    if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.basic - config.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
      throw new Error(`CPU for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (config.fluxSpecifics.ram.basic - config.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
      throw new Error(`RAM for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (config.fluxSpecifics.hdd.basic - config.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
      throw new Error(`SSD for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.super - config.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
      throw new Error(`CPU for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (config.fluxSpecifics.ram.super - config.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
      throw new Error(`RAM for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (config.fluxSpecifics.hdd.super - config.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
      throw new Error(`SSD for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
      throw new Error(`CPU for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
      throw new Error(`RAM for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
      throw new Error(`SSD for Stratus badly assigned for ${appSpecs.name}`);
    }
  }
  return true;
}

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
  if (totalCpu > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu)) {
    throw new Error(`Too much CPU resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalRam > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram)) {
    throw new Error(`Too much RAM resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalHdd > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd)) {
    throw new Error(`Too much SSD resources assigned for ${appSpecsComposed.name}`);
  }
  if (isTiered) {
    if (totalCpuBasic > (config.fluxSpecifics.cpu.basic - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBasic > (config.fluxSpecifics.ram.basic - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBasic > (config.fluxSpecifics.hdd.basic - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuSuper > (config.fluxSpecifics.cpu.super - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamSuper > (config.fluxSpecifics.ram.super - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddSuper > (config.fluxSpecifics.hdd.super - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuBamf > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBamf > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBamf > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
  }
  return true;
}

async function getAppsTemporaryMessages(req, res) {
  const db = serviceHelper.databaseConnection();

  const database = db.db(config.database.appsglobal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await serviceHelper.findInDatabase(database, globalAppsTempMessages, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const resultsResponse = serviceHelper.createDataMessage(results);
  res.json(resultsResponse);
}

async function getAppsPermanentMessages(req, res) {
  const db = serviceHelper.databaseConnection();

  const database = db.db(config.database.appsglobal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await serviceHelper.findInDatabase(database, globalAppsMessages, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const resultsResponse = serviceHelper.createDataMessage(results);
  res.json(resultsResponse);
}

async function getGlobalAppsSpecifications(req, res) {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await serviceHelper.findInDatabase(database, globalAppsInformation, query, projection);
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

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
    {
      version: 2,
      name: 'KadenaChainWebNode', // corresponds to docker name and this name is stored in apps mongo database
      description: 'Kadena is a fast, secure, and scalable blockchain using the Chainweb consensus protocol. '
        + 'Chainweb is a braided, parallelized Proof Of Work consensus mechanism that improves throughput and scalability in executing transactions on the blockchain while maintaining the security and integrity found in Bitcoin. '
        + 'The healthy information tells you if your node is running and synced. If you just installed the docker it can say unhealthy for long time because on first run a bootstrap is downloaded and extracted to make your node sync faster before the node is started. '
        + 'Do not stop or restart the docker in the first hour after installation. You can also check if your kadena node is synced, by going to running apps and press visit button on kadena and compare your node height with Kadena explorer. Thank you.',
      repotag: 'runonflux/kadena-chainweb-node:2.11.0',
      owner: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
      ports: [30004, 30005],
      containerPorts: [30004, 30005],
      domains: ['', ''],
      tiered: false,
      cpu: 2.5, // true resource registered for app. If not tiered only this is available
      ram: 4000, // true resource registered for app
      hdd: 90, // true resource registered for app
      enviromentParameters: ['CHAINWEB_P2P_PORT=30004', 'CHAINWEB_SERVICE_PORT=30005', 'LOGLEVEL=warn'],
      commands: ['/bin/bash', '-c', '(test -d /data/chainweb-db/0 && ./run-chainweb-node.sh) || (/chainweb/initialize-db.sh && ./run-chainweb-node.sh)'],
      containerData: '/data', // cannot be root todo in verification
      hash: 'localSpecificationsVersion14', // hash of app message
      height: 680000, // height of tx on which it was
    },
    {
      version: 2,
      name: 'KadenaChainWebData', // corresponds to docker name and this name is stored in apps mongo database
      description: 'Kadena Chainweb Data is extension to Chainweb Node offering additional data about Kadena blockchain. Chainweb Data offers statistics, coins circulation and mainly transaction history and custom searching through transactions',
      repotag: 'runonflux/kadena-chainweb-data:v1.1.0',
      owner: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
      ports: [30006],
      containerPorts: [8888],
      domains: [''],
      tiered: false,
      cpu: 3, // true resource registered for app. If not tiered only this is available
      ram: 6000, // true resource registered for app
      hdd: 60, // true resource registered for app
      enviromentParameters: [],
      commands: [],
      containerData: '/var/lib/postgresql/data', // cannot be root todo in verification
      hash: 'chainwebDataLocalSpecificationsVersion3', // hash of app message
      height: 900000, // height of tx on which it was
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

  const dataResponse = serviceHelper.createDataMessage(apps);
  return res ? res.json(dataResponse) : apps;
}

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

async function verifyAppMessageSignature(type, version, appSpec, timestamp, signature) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  const isValidSignature = serviceHelper.verifyMessage(messageToVerify, appSpec.owner, signature);
  if (isValidSignature !== true) {
    const errorMessage = isValidSignature === false ? 'Received signature is invalid or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

async function verifyAppMessageUpdateSignature(type, version, appSpec, timestamp, signature, appOwner) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  const isValidSignature = serviceHelper.verifyMessage(messageToVerify, appOwner, signature);
  if (isValidSignature !== true) {
    const errorMessage = isValidSignature === false ? 'Received signature does not correspond with Flux App owner or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

async function verifyRepository(repotag) {
  if (typeof repotag !== 'string') {
    throw new Error('Invalid repotag');
  }
  const splittedRepo = repotag.split(':');
  if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
    let repoToFetch = splittedRepo[0];
    if (!repoToFetch.includes('/')) {
      repoToFetch = `library/${splittedRepo[0]}`;
    }
    const resDocker = await serviceHelper.axiosGet(`https://hub.docker.com/v2/repositories/${repoToFetch}/tags/${splittedRepo[1]}`).catch(() => {
      throw new Error(`Repository ${repotag} is not found on docker hub in expected format`);
    });
    if (!resDocker) {
      throw new Error('Unable to communicate with Docker Hub! Try again later.');
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
    if (resDocker.data.full_size > config.fluxapps.maxImageSize) {
      throw new Error('Docker image size is over Flux limit');
    }
  } else {
    throw new Error(`Repository ${repotag} is not in valid format namespace/repository:tag`);
  }
  return true;
}

function verifyCorrectnessOfApp(appSpecification) {
  const { version } = appSpecification;
  const { name } = appSpecification;
  const { description } = appSpecification;
  const { owner } = appSpecification;
  const { port } = appSpecification;
  const { containerPort } = appSpecification;
  const { compose } = appSpecification;
  const { repotag } = appSpecification;
  const { ports } = appSpecification;
  const { domains } = appSpecification;
  const { enviromentParameters } = appSpecification;
  const { commands } = appSpecification;
  const { containerPorts } = appSpecification;
  const { containerData } = appSpecification;
  const { instances } = appSpecification;
  const { cpu } = appSpecification;
  const { ram } = appSpecification;
  const { hdd } = appSpecification;
  const { tiered } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter');
  }
  if (version === 1) {
    throw new Error('Specifications of version 1 is depreceated');
  }

  // commons
  if (!version || !name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter');
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

  if (version <= 3) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter');
    }

    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Ports for Flux App are invalid');
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
          throw new Error('Container Ports for Flux App are invalid');
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

    if (tiered) {
      const { cpubasic } = appSpecification;
      const { cpusuper } = appSpecification;
      const { cpubamf } = appSpecification;
      const { rambasic } = appSpecification;
      const { ramsuper } = appSpecification;
      const { rambamf } = appSpecification;
      const { hddbasic } = appSpecification;
      const { hddsuper } = appSpecification;
      const { hddbamf } = appSpecification;
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else { // v4+
    if (!compose) {
      throw new Error('Missing Flux App specification parameter');
    }
    if (compose.length < 1) {
      throw new Error('Flux App does not contain any components');
    }
    if (compose.length > 5) {
      throw new Error('Flux App has too many components');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
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
      if (appComponent.tiered) {
        const { cpubasic } = appComponent;
        const { cpusuper } = appComponent;
        const { cpubamf } = appComponent;
        const { rambasic } = appComponent;
        const { ramsuper } = appComponent;
        const { rambamf } = appComponent;
        const { hddbasic } = appComponent;
        const { hddsuper } = appComponent;
        const { hddbamf } = appComponent;
        if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
          || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
          || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
          throw new Error('Invalid tiered HW specifications');
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
    if (instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
  }

  return true;
}

async function verifyAppSpecifications(appSpecifications, height) {
  if (!appSpecifications) {
    throw new Error('Invalid Flux App Specifications');
  }
  if (typeof appSpecifications !== 'object') {
    throw new Error('Invalid Flux App Specifications');
  }
  if (Array.isArray(appSpecifications)) {
    throw new Error('Invalid Flux App Specifications');
  }
  const typeCheckVerification = verifyCorrectnessOfApp(appSpecifications); // throw if wrong
  if (typeCheckVerification !== true) {
    const errorMessage = typeCheckVerification;
    throw new Error(errorMessage);
  }
  if (appSpecifications.version !== 1 && appSpecifications.version !== 2 && appSpecifications.version !== 3 && appSpecifications.version !== 4) {
    throw new Error('Flux App message version specification is invalid');
  }
  if (height < config.fluxapps.appSpecsEnforcementHeights[appSpecifications.version]) {
    throw new Error(`Flux apps specifications of version ${appSpecifications.version} not yet supported`);
  }
  if (appSpecifications.name.length > 32) {
    throw new Error('Flux App name is too long');
  }
  // furthermore name cannot contain any special character
  if (!appSpecifications.name.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error('Flux App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
  }
  if (appSpecifications.name.startsWith('zel')) {
    throw new Error('Flux App name can not start with zel');
  }
  if (appSpecifications.name.startsWith('flux')) {
    throw new Error('Flux App name can not start with flux');
  }
  if (appSpecifications.description.length > 256) {
    throw new Error('Description is too long. Maximum of 256 characters is allowed');
  }

  if (appSpecifications.version === 1) {
    // check port is within range
    if (appSpecifications.port < config.fluxapps.portMin || appSpecifications.port > config.fluxapps.portMax) {
      throw new Error(`Assigned port ${appSpecifications.port} is not within Flux Apps range ${config.fluxapps.portMin}-${config.fluxapps.portMax}`);
    }

    // check if containerPort makes sense{
    if (appSpecifications.containerPort < 0 || appSpecifications.containerPort > 65535) {
      throw new Error(`Container Port ${appSpecifications.containerPort} is not within system limits 0-65535`);
    }
  } else if (appSpecifications.version <= 3) {
    // check port is within range
    appSpecifications.ports.forEach((port) => {
      if (port < config.fluxapps.portMin || port > config.fluxapps.portMax) {
        throw new Error(`Assigned port ${port} is not within Flux Apps range ${config.fluxapps.portMin}-${config.fluxapps.portMax}`);
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
  }

  if (appSpecifications.version <= 3) {
    checkHWParameters(appSpecifications);

    // check wheter shared Folder is not root
    if (appSpecifications.containerData.length < 2) {
      throw new Error('Flux App container data folder not specified. If no data folder is whished, use /tmp');
    }

    // check repotag if available for download
    await verifyRepository(appSpecifications.repotag);

    // check repository whitelisted
    await generalService.checkWhitelistedRepository(appSpecifications.repotag);
  } else {
    console.log(appSpecifications);
    if (!Array.isArray(appSpecifications.compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    if (appSpecifications.compose.length < 1) {
      throw new Error('Flux App does not contain any composition');
    }
    if (appSpecifications.compose.length > 5) {
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
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
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
        throw new Error('Flux App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
      }
      if (usedNames.includes(appComponent.name)) {
        throw new Error(`Flux App component ${appComponent.name} already assigned. Use different name.`);
      }
      usedNames.push(appComponent.name);
      if (appComponent.description.length > 256) {
        throw new Error('Description is too long. Maximum of 256 characters is allowed');
      }
      appComponent.ports.forEach((port) => {
        if (port < config.fluxapps.portMin || port > config.fluxapps.portMax) {
          throw new Error(`Assigned port ${port} is not within Flux Apps range ${config.fluxapps.portMin}-${config.fluxapps.portMax}`);
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

      checkHWParameters(appComponent);

      checkComposeHWParameters(appSpecifications);

      // check repotag if available for download
      // eslint-disable-next-line no-await-in-loop
      await verifyRepository(appComponent.repotag);

      // check repository whitelisted
      // eslint-disable-next-line no-await-in-loop
      await generalService.checkWhitelistedRepository(appComponent.repotag);
    }
  }

  if (appSpecifications.version >= 3) {
    if (typeof appSpecifications.instances !== 'number') {
      throw new Error('Instances is not a number');
    }
    if (Number.isInteger(appSpecifications.instances) !== true) {
      throw new Error('Instances is not an integer');
    }
    if (appSpecifications.instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (appSpecifications.instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
  }

  // check for Object.keys in applications. App can have only the fields that are in the version specification.
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
  } else {
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
  }
  // check ZelID whitelisted
  await generalService.checkWhitelistedZelID(appSpecifications.owner);
}

async function assignedPortsApps() {
  // construct object ob app name and ports array
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await serviceHelper.findInDatabase(database, globalAppsInformation, query, projection);
  const apps = [];
  results.forEach((app) => {
    // there is no app
    if (app.version === 1) {
      const appSpecs = {
        name: app.name,
        ports: [app.port],
      };
      apps.push(appSpecs);
    } else if (app.version <= 3) {
      const appSpecs = {
        name: app.name,
        ports: app.ports,
      };
      apps.push(appSpecs);
    } else if (app.version >= 4) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.compose.forEach((composeApp) => {
        appSpecs.ports = appSpecs.ports.concat(composeApp.ports);
      });
    }
  });
  return apps;
}

async function ensureCorrectApplicationPort(appSpecFormatted) {
  const currentAppsPorts = await assignedPortsApps();
  if (appSpecFormatted.version === 1) {
    const portAssigned = currentAppsPorts.find((app) => app.ports.includes(appSpecFormatted.port));
    if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
      throw new Error(`Flux App ${appSpecFormatted.name} port ${appSpecFormatted.port} already registered with different application. Your Flux App has to use different port.`);
    }
  } else if (appSpecFormatted.version <= 3) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecFormatted.ports) {
      const portAssigned = currentAppsPorts.find((app) => app.ports.includes(port));
      if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
        throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already registered with different application. Your Flux App has to use different port.`);
      }
    }
  } else {
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecFormatted.compose) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appComponent.ports) {
        const portAssigned = currentAppsPorts.find((app) => app.ports.includes(port));
        if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
          throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already registered with different application. Your Flux App has to use different port.`);
        }
      }
    }
  }
  return true;
}

async function checkApplicationRegistrationNameConflicts(appSpecFormatted) {
  // check if name is not yet registered
  const dbopen = serviceHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') }; // case insensitive
  const appsProjection = {
    projection: {
      _id: 0,
      name: 1,
    },
  };
  const appResult = await serviceHelper.findOneInDatabase(appsDatabase, globalAppsInformation, appsQuery, appsProjection);

  if (appResult) {
    throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name.`);
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

async function checkApplicationUpdateNameRepositoryConflicts(specifications, verificationTimestamp) {
  // we may not have the application in global apps. This can happen when we receive the message after the app has already expired AND we need to get message right before our message. Thus using messages system that is accurate
  const db = serviceHelper.databaseConnection();
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
  const permanentAppMessage = await serviceHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
  let latestPermanentRegistrationMessage;
  permanentAppMessage.forEach((foundMessage) => {
    // has to be registration message
    if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
      if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= verificationTimestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      } else if (foundMessage.timestamp <= verificationTimestamp) { // we dont have any message or our message is newer. foundMessage has to have lower timestamp than our new message
        latestPermanentRegistrationMessage = foundMessage;
      }
    }
  });
  // some early app have zelAppSepcifications
  const appsQueryB = {
    'zelAppSpecifications.name': specifications.name,
  };
  const permanentAppMessageB = await serviceHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
  permanentAppMessageB.forEach((foundMessage) => {
    // has to be registration message
    if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
      if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= verificationTimestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      } else if (foundMessage.timestamp <= verificationTimestamp) { // we dont have any message or our message is newer. foundMessage has to have lower timestamp than our new message
        latestPermanentRegistrationMessage = foundMessage;
      }
    }
  });
  if (!latestPermanentRegistrationMessage) {
    throw new Error(`Flux App ${specifications.name} update message received but permanent message of parameters does not exist!`);
  }
  const appSpecs = latestPermanentRegistrationMessage.appSpecifications || latestPermanentRegistrationMessage.zelAppSpecifications;
  if (!appSpecs) {
    throw new Error(`Flux App ${specifications.name} update message received but application does not exists!`);
  }
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
      throw new Error(`Flux App ${specifications.name} update to different specifications is not possible`);
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

async function getPreviousAppSpecifications(specifications, message) {
  // we may not have the application in global apps. This can happen when we receive the message after the app has already expired AND we need to get message right before our message. Thus using messages system that is accurate
  const db = serviceHelper.databaseConnection();
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
  const permanentAppMessage = await serviceHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
  let latestPermanentRegistrationMessage;
  permanentAppMessage.forEach((foundMessage) => {
    // has to be registration message
    if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
      if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= message.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      } else if (foundMessage.timestamp <= message.timestamp) { // we dont have any message or our message is newer. foundMessage has to have lower timestamp than our new message
        latestPermanentRegistrationMessage = foundMessage;
      }
    }
  });
  // some early app have zelAppSepcifications
  const appsQueryB = {
    'zelAppSpecifications.name': specifications.name,
  };
  const permanentAppMessageB = await serviceHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
  permanentAppMessageB.forEach((foundMessage) => {
    // has to be registration message
    if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
      if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= message.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      } else if (foundMessage.timestamp <= message.timestamp) { // we dont have any message or our message is newer. foundMessage has to have lower timestamp than our new message
        latestPermanentRegistrationMessage = foundMessage;
      }
    }
  });
  const appSpecs = latestPermanentRegistrationMessage.appSpecifications || latestPermanentRegistrationMessage.zelAppSpecifications;
  if (!appSpecs) {
    throw new Error(`Flux App ${specifications.name} update message received but application does not exists!`);
  }
  return appSpecs;
}

async function checkAppMessageExistence(hash) {
  try {
    const dbopen = serviceHelper.databaseConnection();
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
    const appResult = await serviceHelper.findOneInDatabase(appsDatabase, globalAppsMessages, appsQuery, appsProjection);
    if (appResult) {
      return appResult;
    }
    return false;
  } catch (error) {
    log.error(error);
    return error;
  }
}

async function checkAppTemporaryMessageExistence(hash) {
  try {
    const dbopen = serviceHelper.databaseConnection();
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
    const appResult = await serviceHelper.findOneInDatabase(appsDatabase, globalAppsTempMessages, appsQuery, appsProjection);
    if (appResult) {
      return appResult;
    }
    return false;
  } catch (error) {
    log.error(error);
    return error;
  }
}

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
  // check if we have the message in cache. If yes, return false. If not, store it and continue
  if (myCache.has(serviceHelper.ensureString(message))) {
    return false;
  }
  console.log(serviceHelper.ensureString(message));
  myCache.set(serviceHelper.ensureString(message), message);
  const specifications = message.appSpecifications || message.zelAppSpecifications;

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
  if (furtherVerification) {
    if (message.type === 'zelappregister' || message.type === 'fluxappregister') {
      const syncStatus = daemonService.isDaemonSynced();
      const daemonHeight = syncStatus.data.height;
      await verifyAppSpecifications(specifications, daemonHeight);
      await verifyAppHash(message);
      await ensureCorrectApplicationPort(specifications);
      await checkApplicationRegistrationNameConflicts(specifications);
      await verifyAppMessageSignature(message.type, message.version, specifications, message.timestamp, message.signature);
    } else if (message.type === 'zelappupdate' || message.type === 'fluxappupdate') {
      const syncStatus = daemonService.isDaemonSynced();
      const daemonHeight = syncStatus.data.height;
      // stadard verifications
      await verifyAppSpecifications(specifications, daemonHeight);
      await verifyAppHash(message);
      await ensureCorrectApplicationPort(specifications);
      // verify that app exists, does not change repotag (for v1-v3), does not change name and does not change component names
      await checkApplicationUpdateNameRepositoryConflicts(specifications, message.timestamp);
      // get previousAppSpecifications as we need previous owner
      const previousAppSpecs = await getPreviousAppSpecifications(specifications, message);
      const { owner } = previousAppSpecs;
      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(message.type, message.version, specifications, message.timestamp, message.signature, owner);
    } else {
      throw new Error('Invalid Flux App message received');
    }
  }

  const receivedAt = Date.now();
  const validTill = receivedAt + (60 * 60 * 1000); // 60 minutes

  const newMessage = {
    appSpecifications: specifications,
    type: message.type, // shall be fluxappregister, fluxappupdate
    version: message.version,
    hash: message.hash,
    timestamp: message.timestamp,
    signature: message.signature,
    receivedAt: new Date(receivedAt),
    expireAt: new Date(validTill),
  };
  const value = newMessage;
  // message does not exist anywhere and is ok, store it
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  await serviceHelper.insertOneToDatabase(database, globalAppsTempMessages, value);
  // it is stored and rebroadcasted
  return true;
}

async function storeAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param hash string
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.broadcastedAt !== 'number' || typeof message.hash !== 'string' || typeof message.name !== 'string' || typeof message.ip !== 'string') {
    return new Error('Invalid Flux App Running message for storing');
  }

  // check if we have the message in cache. If yes, return false. If not, store it and continue
  if (myCache.has(serviceHelper.ensureString(message))) {
    return false;
  }
  console.log(serviceHelper.ensureString(message));
  myCache.set(serviceHelper.ensureString(message), message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds

  if (validTill < new Date().getTime()) {
    // reject old message
    return false;
  }

  const randomDelay = Math.floor((Math.random() * 1280)) + 240;
  await serviceHelper.delay(randomDelay);

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const newAppRunningMessage = {
    name: message.name,
    hash: message.hash, // hash of application specifics that are running
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
  const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip, broadcastedAt: { $gte: newAppRunningMessage.broadcastedAt } };
  const projection = { _id: 0 };
  // we already have the exact same data
  const result = await serviceHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
  if (result) {
    // it is already stored
    return false;
  }
  const queryUpdate = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
  const update = { $set: newAppRunningMessage };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(database, globalAppsLocations, queryUpdate, update, options);
  // it is now stored, rebroadcast
  return true;
}

function specificationFormatter(appSpecification) {
  let { version } = appSpecification;
  let { name } = appSpecification;
  let { description } = appSpecification;
  let { owner } = appSpecification;
  let { compose } = appSpecification;
  let { repotag } = appSpecification;
  let { ports } = appSpecification;
  let { domains } = appSpecification;
  let { enviromentParameters } = appSpecification;
  let { commands } = appSpecification;
  let { containerPorts } = appSpecification;
  let { containerData } = appSpecification;
  let { instances } = appSpecification;
  let { cpu } = appSpecification;
  let { ram } = appSpecification;
  let { hdd } = appSpecification;
  const { tiered } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter');
  }
  version = serviceHelper.ensureNumber(version);
  if (version === 1) {
    throw new Error('Specifications of version 1 is depreceated');
  }

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

  if (version <= 3) {
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
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }

    // finalised parameters
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
      let { cpubasic } = appSpecification;
      let { cpusuper } = appSpecification;
      let { cpubamf } = appSpecification;
      let { rambasic } = appSpecification;
      let { ramsuper } = appSpecification;
      let { rambamf } = appSpecification;
      let { hddbasic } = appSpecification;
      let { hddsuper } = appSpecification;
      let { hddbamf } = appSpecification;
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
    if (compose.length < 1) {
      throw new Error('Flux App does not contain any components');
    }
    if (compose.length > 5) {
      throw new Error('Flux App has too many components');
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
        let { cpubasic } = appComponent;
        let { cpusuper } = appComponent;
        let { cpubamf } = appComponent;
        let { rambasic } = appComponent;
        let { ramsuper } = appComponent;
        let { rambamf } = appComponent;
        let { hddbasic } = appComponent;
        let { hddsuper } = appComponent;
        let { hddbamf } = appComponent;
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

  return appSpecFormatted;
}

async function registerAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await serviceHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = serviceHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }
      // first  check if this node is available for application registration
      if (fluxCommunication.outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough peers for safe application registration');
      }
      if (fluxCommunication.incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough peers for safe application registration');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they dont exist in global database
      // first lets check if all fields are present and have propper format excpet tiered and teired specifications and those can be ommited
      let { appSpecification } = processedBody;
      let { timestamp } = processedBody;
      let { signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, type, version, timestamp and siganture are provided.');
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

      const syncStatus = daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight);

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      // check if ports is not yet registered
      await ensureCorrectApplicationPort(appSpecFormatted);

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await verifyAppMessageSignature(messageType, typeVersion, appSpecFormatted, timestamp, signature);

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may possess some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);
      const responseHash = serviceHelper.createDataMessage(messageHASH);
      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
      };
      await storeAppTemporaryMessage(temporaryAppMessage, false);
      await fluxCommunication.broadcastTemporaryAppMessage(temporaryAppMessage);
      return res.json(responseHash);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

// price handled in UI and available in API
async function updateAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await serviceHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = serviceHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }
      // first  check if this node is available for application registration
      if (fluxCommunication.outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough peers for safe application registration');
      }
      if (fluxCommunication.incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough peers for safe application registration');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and ports HAVE to be unique for application. Check if they dont exist in global database
      // first lets check if all fields are present and have propper format excpet tiered and teired specifications and those can be ommited
      let { appSpecification } = processedBody;
      let { timestamp } = processedBody;
      let { signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, timestamp, type, version and siganture are provided.');
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

      const syncStatus = daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight);
      // check if ports are not conflicting
      await ensureCorrectApplicationPort(appSpecFormatted);

      // verify that app exists, does not change repotag and is signed by app owner.
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (!appInfo) {
        throw new Error('Flux App update received but application to update does not exists!');
      }
      if (appInfo.repotag !== appSpecFormatted.repotag) {
        throw new Error('Flux App update of repotag is not allowed');
      }
      const appOwner = appInfo.owner; // ensure previous app owner is signing this message
      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(messageType, typeVersion, appSpecFormatted, timestamp, signature, appOwner);

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may possess some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);
      const responseHash = serviceHelper.createDataMessage(messageHASH);
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
      await storeAppTemporaryMessage(temporaryAppMessage, false);
      await fluxCommunication.broadcastTemporaryAppMessage(temporaryAppMessage);
      return res.json(responseHash);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

// where req can be equal to appname
// shall be identical to listAllApps. But this is database response
async function installedApps(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();

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
    const apps = await serviceHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const dataResponse = serviceHelper.createDataMessage(apps);
    return res ? res.json(dataResponse) : dataResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function installTemporaryLocalApplication(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const allApps = await availableApps();
      const appSpecifications = allApps.find((app) => app.name === appname);
      if (!appSpecifications) {
        throw new Error('Application Specifications not found');
      }
      const tier = await generalService.nodeTier();
      if (appname === 'KadenaChainWebNode' && tier === 'basic') {
        throw new Error('KadenaChainWebNode can only be installed on NIMBUS and STRATUS');
      } else if (appname === 'KadenaChainWebData' && (tier === 'basic' || tier === 'super')) {
        throw new Error('KadenaChainWebData can only be installed on STRATUS');
      } else if (appname === 'KadenaChainWebData') {
        // this app can only be installed if KadenaChainWebNode is installed
        // check if they are running?
        const installedAppsRes = await installedApps();
        if (installedAppsRes.status !== 'success') {
          throw new Error('Failed to get installed Apps');
        }
        const appsInstalled = installedAppsRes.data;
        const chainwebNode = appsInstalled.find((app) => app.name === 'KadenaChainWebNode');
        if (!chainwebNode) {
          throw new Error('KadenaChainWebNode must be installed first');
        }
      }

      await checkAppRequirements(appSpecifications); // entire app

      res.setHeader('Content-Type', 'application/json');
      registerAppLocally(appSpecifications, undefined, res); // can throw
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function requestAppMessage(hash) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  console.log(hash);
  const message = {
    type: 'fluxapprequest',
    version: 1,
    hash,
  };
  await fluxCommunication.broadcastMessageToOutgoing(message);
  await serviceHelper.delay(2345);
  await fluxCommunication.broadcastMessageToIncoming(message);
}

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

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  await serviceHelper.insertOneToDatabase(database, globalAppsMessages, message).catch((error) => {
    log.error(error);
    throw error;
  });
  return true;
}

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
    const db = serviceHelper.databaseConnection();
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
    const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    if (appInfo) {
      if (appInfo.height < appSpecs.height) {
        await serviceHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
      }
    } else {
      await serviceHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
  } catch (error) {
    // retry
    log.error(error);
    await serviceHelper.delay(60 * 1000);
    updateAppSpecifications(appSpecs);
  }
}

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
  const db = serviceHelper.databaseConnection();
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
  const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (appInfo) {
    if (appInfo.height < appSpecs.height) {
      await serviceHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
  } else {
    await serviceHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
  }
  return true;
}

async function appHashHasMessage(hash) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { message: true } };
  const options = {};
  await serviceHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
}

// hash of app information, txid it was in, height of blockchain containing the txid
// handles fluxappregister type and fluxappupdate type.
async function checkAndRequestApp(hash, txid, height, valueSat, i = 0) {
  try {
    if (height < config.fluxapps.epochstart) { // do not request testing apps
      return;
    }
    const randomDelay = Math.floor((Math.random() * 1280)) + 420;
    await serviceHelper.delay(randomDelay);
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
        const intervals = config.fluxapps.price.filter((interval) => interval.height <= height);
        const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
        if (tempMessage.type === 'zelappregister' || tempMessage.type === 'fluxappregister') {
          // check if value is optimal or higher
          let appPrice = appPricePerMonth(specifications, height);
          if (appPrice < priceSpecifications.minPrice) {
            appPrice = priceSpecifications.minPrice;
          }
          if (valueSat >= appPrice * 1e8) {
            const updateForSpecifications = permanentAppMessage.appSpecifications;
            updateForSpecifications.hash = permanentAppMessage.hash;
            updateForSpecifications.height = permanentAppMessage.height;
            // object of appSpecifications extended for hash and height
            // do not await this
            updateAppSpecifications(updateForSpecifications);
          } // else do nothing notify its underpaid?
        } else if (tempMessage.type === 'zelappupdate' || tempMessage.type === 'fluxappupdate') {
          // appSpecifications.name as identifier
          const db = serviceHelper.databaseConnection();
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
          const findPermAppMessage = await serviceHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
          let latestPermanentRegistrationMessage;
          findPermAppMessage.forEach((foundMessage) => {
            // has to be registration message
            if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
              if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                  latestPermanentRegistrationMessage = foundMessage;
                }
              } else if (foundMessage.timestamp <= tempMessage.timestamp) { // we dont have any message or our message is newer. foundMessage has to have lower timestamp than our new message
                latestPermanentRegistrationMessage = foundMessage;
              }
            }
          });
          // some early app have zelAppSepcifications
          const appsQueryB = {
            'zelAppSpecifications.name': specifications.name,
          };
          const findPermAppMessageB = await serviceHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
          findPermAppMessageB.forEach((foundMessage) => {
            // has to be registration message
            if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
              if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                  latestPermanentRegistrationMessage = foundMessage;
                }
              } else if (foundMessage.timestamp <= tempMessage.timestamp) { // we dont have any message or our message is newer. foundMessage has to have lower timestamp than our new message
                latestPermanentRegistrationMessage = foundMessage;
              }
            }
          });
          const messageInfo = latestPermanentRegistrationMessage;
          // here comparison of height differences and specifications
          // price shall be price for standard registration plus minus already paid price according to old specifics. height remains height valid for 22000 blocks
          const appPrice = appPricePerMonth(specifications, height);
          const previousSpecsPrice = appPricePerMonth(messageInfo.appSpecifications || messageInfo.zelAppSpecifications, height);
          // what is the height difference
          const heightDifference = permanentAppMessage.height - messageInfo.height; // has to be lower than 22000
          const perc = (config.fluxapps.blocksLasting - heightDifference) / config.fluxapps.blocksLasting;
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
          } // else do nothing notify its underpaid?
        }
      } else {
        // request the message and broadcast the message further to our connected peers.
        requestAppMessage(hash);
        // rerun this after 1 min delay
        // stop this loop after 7 mins, as it might be a scammy message or simply this message is nowhere on the network, we dont have connections etc. We also have continous checkup for it every 8 min
        if (i < 7) {
          await serviceHelper.delay(60 * 1000);
          checkAndRequestApp(hash, txid, height, valueSat, i + 1);
        }
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

async function checkDockerAccessibility(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await serviceHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = serviceHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }
      // check repotag if available for download
      const processedBody = serviceHelper.ensureObject(body);

      if (!processedBody.repotag) {
        throw new Error('No repotag specifiec');
      }

      await verifyRepository(processedBody.repotag);
      const message = serviceHelper.createSuccessMessage('Repotag is accessible');
      return res.json(message);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

function registrationInformation(req, res) {
  try {
    const data = config.fluxapps;
    const response = serviceHelper.createDataMessage(data);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

// function that drops global apps information and goes over all global apps messages and reconsturcts the global apps information. Further creates database indexes
async function reindexGlobalAppsInformation() {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await serviceHelper.dropCollection(database, globalAppsInformation).catch((error) => {
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
    const projection = { projection: { _id: 0 } };
    const results = await serviceHelper.findInDatabase(database, globalAppsMessages, query, projection);
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

// function that drops information about running apps and rebuilds indexes
async function reindexGlobalAppsLocation() {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await serviceHelper.dropCollection(database, globalAppsLocations).catch((error) => {
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

// function goes over all global apps messages and updates global apps infromation database
async function rescanGlobalAppsInformation(height = 0, removeLastInformation = false) {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await serviceHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    const query = { height: { $gte: height } };
    const projection = { projection: { _id: 0 } };
    const results = await serviceHelper.findInDatabase(database, globalAppsMessages, query, projection);

    if (removeLastInformation === true) {
      await serviceHelper.removeDocumentsFromCollection(database, globalAppsInformation, query);
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

async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsLocation();
      const message = serviceHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsInformation();
      const message = serviceHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = serviceHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = serviceHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
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
      const message = serviceHelper.createSuccessMessage('Rescan successfull');
      res.json(message);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function continuousFluxAppHashesCheck() {
  try {
    const knownWrongTxids = ['e56e08a8dbe9523ad10ca328fca84ee1da775ea5f466abed06ec357daa192940', 'e56e08a8dbe9523ad10ca328fca84ee1da775ea5f466abed06ec357daa192940'];
    log.info('Requesting missing Flux App messages');
    // get flux app hashes that do not have a message;
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { message: false };
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
      },
    };
    const results = await serviceHelper.findInDatabase(database, appsHashesCollection, query, projection);
    // eslint-disable-next-line no-restricted-syntax
    for (const result of results) {
      if (!knownWrongTxids.includes(result.txid)) { // wrong data, can be later removed
        checkAndRequestApp(result.hash, result.txid, result.height, result.value);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(1234);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function getAppHashes(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
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
      },
    };
    const results = await serviceHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function getAppsLocations(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.appsglobal.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        name: 1,
        hash: 1,
        ip: 1,
        broadcastedAt: 1,
        expireAt: 1,
      },
    };
    const results = await serviceHelper.findInDatabase(database, globalAppsLocations, query, projection);
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function getAppsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.appsglobal.database);
    const query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
    const projection = {
      projection: {
        _id: 0,
        name: 1,
        hash: 1,
        ip: 1,
        broadcastedAt: 1,
        expireAt: 1,
      },
    };
    const results = await serviceHelper.findInDatabase(database, globalAppsLocations, query, projection);
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function getAllGlobalApplicationsNames() {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0, name: 1 } };
    const results = await serviceHelper.findInDatabase(database, globalAppsInformation, query, projection);
    const names = results.map((result) => result.name);
    return names;
  } catch (error) {
    log.error(error);
    return [];
  }
}

async function getRunningAppList(appName) {
  console.log(appName);
  const dbopen = serviceHelper.databaseConnection();
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
    },
  };
  const results = await serviceHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

async function getApplicationGlobalSpecifications(appName) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  return appInfo;
}

async function getApplicationLocalSpecifications(appName) {
  const allApps = await availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  return appInfo;
}

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
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  }
  return appInfo;
}

// case sensitive
async function getStrictApplicationSpecifications(appName) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: appName };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name === appName);
  }
  return appInfo;
}

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
    const specResponse = serviceHelper.createDataMessage(specifications);
    res.json(specResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

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
    const ownerResponse = serviceHelper.createDataMessage(owner);
    res.json(ownerResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

async function trySpawningGlobalApplication() {
  try {
    // how do we continue with this function function?
    // we have globalapplication specifics list
    // check if we are synced
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    const isNodeConfirmed = await generalService.isNodeStatusConfirmed();
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Global applications will not be installed');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // get all the applications list names
    const globalAppNames = await getAllGlobalApplicationsNames();
    // pick a random one
    const numberOfGlobalApps = globalAppNames.length;
    const randomAppnumber = Math.floor((Math.random() * numberOfGlobalApps));
    const randomApp = globalAppNames[randomAppnumber];
    if (!randomApp) {
      log.info('No application specifications found');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // check if there is < 5 instances of nodes running the app
    // TODO evaluate if its not better to check locally running applications!
    const runningAppList = await getRunningAppList(randomApp);

    const delay = config.fluxapps.installation.delay * 1000;
    const probLn = Math.log(2 + numberOfGlobalApps); // from ln(2) -> ln(2 + x)
    const adjustedDelay = delay / probLn;

    if (runningAppList.length >= config.fluxapps.minimumInstances) {
      log.info(`Application ${randomApp} is already spawned on ${runningAppList.length} instances`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }
    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await daemonService.getBenchmarks();
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
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip === myIP)) {
      log.info(`Application ${randomApp} is reported as already running on this Flux`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }
    // second check if app is running on this node
    const runningApps = await listRunningApps();
    if (runningApps.status !== 'success') {
      throw new Error('Unable to check running apps on this Flux');
    }
    if (runningApps.data.find((app) => app.Names[0].substr(5, app.Names[0].length) === randomApp)) {
      log.info(`${randomApp} application is already running on this Flux`);
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }
    // check if node is capable to run it according to specifications
    // get app specifications
    const appSpecifications = await getApplicationGlobalSpecifications(randomApp);
    if (!appSpecifications) {
      throw new Error(`Specifications for application ${randomApp} were not found!`);
    }

    // verify requirements
    await checkAppRequirements(appSpecifications);

    // if all ok Check hashes comparison if its out turn to start the app. 1% probability.
    const randomNumber = Math.floor((Math.random() * (config.fluxapps.installation.probability / probLn))); // higher probability for more apps on network
    if (randomNumber !== 0) {
      log.info('Other Fluxes are evaluating application installation');
      await serviceHelper.delay(adjustedDelay);
      trySpawningGlobalApplication();
      return;
    }
    // an application was selected and checked that it can run on this node. try to install and run it locally
    // install the app
    await registerAppLocally(appSpecifications); // can throw

    await serviceHelper.delay(10 * config.fluxapps.installation.delay * 1000);
    log.info('Reinitiating possible app installation');
    trySpawningGlobalApplication();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
    trySpawningGlobalApplication();
  }
}

async function checkAndNotifyPeersOfRunningApps() {
  try {
    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await daemonService.getBenchmarks();
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
        return app.Names[0].substr(4, app.Names[0].length);
      }
      return app.Names[0].substr(5, app.Names[0].length);
    });
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));
    // check if stoppedApp is a global application present in specifics. If so, try to start it.
    if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
      // eslint-disable-next-line no-restricted-syntax
      for (const stoppedApp of stoppedApps) { // will uninstall app if some component is missing
        try {
          // proceed ONLY if its global App
          const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
          // eslint-disable-next-line no-await-in-loop
          const appDetails = await getApplicationGlobalSpecifications(mainAppName);
          if (appDetails) {
            log.warn(`${stoppedApp} is stopped but shall be running. Starting...`);
            // it is a stopped global app. Try to run it.
            const appId = dockerService.getAppIdentifier(stoppedApp);
            // check if some removal is in progress as if it is dont start it!
            if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
              log.warn(`${appId} is stopped, starting`);
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerStart(appId);
            } else {
              log.warn(`Not starting ${stoppedApp} as of application removal or installation in progress`);
            }
          }
        } catch (err) {
          log.error(err);
          if (!removalInProgress && !installationInProgress && !reinstallationOfOldAppsInProgress) {
            const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
            // already checked for mongo ok, daemon ok, docker ok.
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(mainAppName);
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
    // eslint-disable-next-line no-restricted-syntax
    for (const application of installedAndRunning) {
      log.info(`${application.name} is running properly. Broadcasting status.`);
      try {
        // eslint-disable-next-line no-await-in-loop
        // we can distinguish pure local apps from global with hash and height
        const broadcastedAt = new Date().getTime();
        const newAppRunningMessage = {
          type: 'fluxapprunning',
          version: 1,
          name: application.name,
          hash: application.hash, // hash of application specifics that are running
          ip: myIP,
          broadcastedAt,
        };

        // store it in local database first
        // eslint-disable-next-line no-await-in-loop
        await storeAppRunningMessage(newAppRunningMessage);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(2345);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunication.broadcastMessageToOutgoing(newAppRunningMessage);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(2345);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunication.broadcastMessageToIncoming(newAppRunningMessage);
        // broadcast messages about running apps to all peers
      } catch (err) {
        log.error(err);
        // removeAppLocally(stoppedApp);
      }
    }
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  }
}

async function expireGlobalApplications() {
  // function to expire global applications. Find applications that are lower than blocksLasting
  // check if synced
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Application expiration paused. Not yet synced');
      return;
    }
    // get current height
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);
    const expirationHeight = explorerHeight - config.fluxapps.blocksLasting;
    // get global applications specification that have up to date data
    // find applications that have specifications height lower than expirationHeight
    const databaseApps = dbopen.db(config.database.appsglobal.database);
    const queryApps = { height: { $lt: expirationHeight } };
    const projectionApps = { projection: { _id: 0, name: 1, hash: 1 } }; // todo look into correction for checking hash of app
    const results = await serviceHelper.findInDatabase(databaseApps, globalAppsInformation, queryApps, projectionApps);
    const appNamesToExpire = results.map((res) => res.name);
    // remove appNamesToExpire apps from global database
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appNamesToExpire) {
      const queryDeleteApp = { name: appName };
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.findOneAndDeleteInDatabase(databaseApps, globalAppsInformation, queryDeleteApp, projectionApps);
    }

    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const appsToRemove = appsInstalled.filter((app) => appNamesToExpire.includes(app.name));
    const appsToRemoveNames = appsToRemove.map((app) => app.name);
    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is expired, removing`);
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(appName);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(6 * 60 * 1000); // wait for 6 mins so we dont have more removals at the same time
    }
  } catch (error) {
    log.error(error);
  }
}

// check if more than allowed instances of application are running
async function checkAndRemoveApplicationInstance() {
  // function to remove global applications on this local node. Find applications that are spawned more than maximum number of instances allowed
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
            await removeAppLocally(installedApp.name);
            log.warn(`Application ${installedApp.name} locally removed`);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(config.fluxapps.removal.delay * 1000); // wait for 6 mins so we dont have more removals at the same time
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

async function softRedeploy(appSpecs, res) {
  try {
    if (removalInProgress) {
      log.warn('Another application is undergoing removal');
      const appRedeployResponse = serviceHelper.createDataMessage('Another application is undergoing removal');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
      }
      return;
    }
    if (installationInProgress) {
      log.warn('Another application is undergoing installation');
      const appRedeployResponse = serviceHelper.createDataMessage('Another application is undergoing installation');
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
    const appRedeployResponse = serviceHelper.createDataMessage('Application softly removed. Awaiting installation...');
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
    removeAppLocally(appSpecs.name, res, true);
  }
}

async function hardRedeploy(appSpecs, res) {
  try {
    await removeAppLocally(appSpecs.name, res, false, false);
    const appRedeployResponse = serviceHelper.createDataMessage('Application removed. Awaiting installation...');
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
    removeAppLocally(appSpecs.name, res, true);
  }
}

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
                await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins so we dont have more removals at the same time
                // eslint-disable-next-line no-await-in-loop
                await checkAppRequirements(appSpecifications);
                // install the app
                // eslint-disable-next-line no-await-in-loop
                await softRegisterAppLocally(appSpecifications);
              } catch (error) {
                log.error(error);
                removeAppLocally(appSpecifications.name, null, true);
              }
            } else {
              log.warn(`Beginning Hard Redeployment of ${appSpecifications.name}...`);
              // hard redeployment
              try {
                // eslint-disable-next-line no-await-in-loop
                await removeAppLocally(installedApp.name);
                log.warn('Application removed. Awaiting installation...');
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins so we dont have more removals at the same time
                // eslint-disable-next-line no-await-in-loop
                await checkAppRequirements(appSpecifications);

                // install the app
                // eslint-disable-next-line no-await-in-loop
                await registerAppLocally(appSpecifications); // can throw
              } catch (error) {
                log.error(error);
                removeAppLocally(appSpecifications.name, null, true);
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
              const dbopen = serviceHelper.databaseConnection();
              const appsDatabase = dbopen.db(config.database.appslocal.database);
              const appsQuery = { name: appSpecifications.name };
              const appsProjection = {};
              log.warn('Cleaning up database...');
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
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
              await serviceHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);
              log.warn(`Composed application ${appSpecifications.name} updated.`);
            } catch (error) {
              removalInProgress = false;
              log.error(error);
              removeAppLocally(appSpecifications.name, null, true); // remove entire app
            }
          }
        } else {
          log.info('Other Fluxes are redeploying application. Waiting for next round.');
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
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const syncStatus = daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;
      const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      let actualPriceToPay = appPricePerMonth(appSpecFormatted, daemonHeight);
      if (appInfo) {
        const previousSpecsPrice = appPricePerMonth(appInfo, daemonHeight); // calculate previous based on CURRENT height, with current interval of prices!
        // what is the height difference
        const heightDifference = daemonHeight - appInfo.height; // has to be lower than 22000
        const perc = (config.fluxapps.blocksLasting - heightDifference) / config.fluxapps.blocksLasting;
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice);
        }
      }
      const intervals = config.fluxapps.price.filter((i) => i.height <= daemonHeight);
      const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
      actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
      if (actualPriceToPay < priceSpecifications.minPrice) {
        actualPriceToPay = priceSpecifications.minPrice;
      }
      const respondPrice = serviceHelper.createDataMessage(actualPriceToPay);
      return res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

async function redeployAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    if (appname.includes('_')) {
      throw new Error('Component cannot be redeployed manually');
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
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
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

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

      const syncStatus = daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight);

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      // check if ports is not yet registered
      await ensureCorrectApplicationPort(appSpecFormatted);

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = serviceHelper.createDataMessage(appSpecFormatted);
      return res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

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

      const syncStatus = daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight);

      // check if name is not yet registered
      const timestamp = new Date().getTime();
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      // check if ports is not yet registered
      await ensureCorrectApplicationPort(appSpecFormatted);

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = serviceHelper.createDataMessage(appSpecFormatted);
      return res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

async function deloymentInformation(req, res) {
  try {
    // respond with information needed for application deployment regarding specification limitation and prices
    const information = {
      price: config.fluxapps.price,
      appSpecsEnforcementHeights: config.fluxapps.appSpecsEnforcementHeights,
      address: config.fluxapps.address,
      portMin: config.fluxapps.portMin,
      portMax: config.fluxapps.portMax,
      maxImageSize: config.fluxapps.maxImageSize,
      minimumInstances: config.fluxapps.minimumInstances,
      maximumInstances: config.fluxapps.maximumInstances,
    };
    const respondPrice = serviceHelper.createDataMessage(information);
    res.json(respondPrice);
  } catch (error) {
    log.warn(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

module.exports = {
  appPull,
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
  reindexGlobalAppsLocation,
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
  installTemporaryLocalApplication,
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
  deloymentInformation,
};
