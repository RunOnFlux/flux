const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
const crypto = require('crypto');
const Docker = require('dockerode');
const stream = require('stream');
const path = require('path');
const nodecmd = require('node-cmd');
const df = require('node-df');
const fs = require('fs');
const formidable = require('formidable');
const LRU = require('lru-cache');
const archiver = require('archiver');
const systemcrontab = require('crontab');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const fluxCommunication = require('./fluxCommunication');
const serviceHelper = require('./serviceHelper');
const daemonService = require('./daemonService');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fluxDirPath = path.join(__dirname, '../../../');
const appsFolder = `${fluxDirPath}ZelApps/`;

const cmdAsync = util.promisify(nodecmd.get);
const crontabLoad = util.promisify(systemcrontab.load);

const docker = new Docker();

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

function getAppIdentifier(appName) {
  // this id is used for volumes, docker names so we know it reall belongs to flux
  if (appName.startsWith('zel')) {
    return appName;
  }
  if (appName.startsWith('flux')) {
    return appName;
  }
  if (appName === 'KadenaChainWebNode' || appName === 'FoldingAtHomeB') {
    return `zel${appName}`;
  }
  return `flux${appName}`;
}

function getAppDockerNameIdentifier(appName) {
  // this id is used for volumes, docker names so we know it reall belongs to flux
  const name = getAppIdentifier(appName);
  if (name.startsWith('/')) {
    return name;
  }
  return `/${name}`;
}

function getCollateralInfo(collateralOutpoint) {
  const a = collateralOutpoint;
  const b = a.split(', ');
  const txhash = b[0].substr(10, b[0].length);
  const txindex = serviceHelper.ensureNumber(b[1].split(')')[0]);
  return { txhash, txindex };
}

async function dockerCreateNetwork(options) {
  const network = await docker.createNetwork(options);
  return network;
}

async function dockerRemoveNetwork(netw) {
  const network = await netw.remove();
  return network;
}

async function dockerNetworkInspect(netw) {
  const network = await netw.inspect();
  return network;
}

async function dockerListContainers(all, limit, size, filter) {
  const options = {
    all,
    limit,
    size,
    filter,
  };
  const containers = await docker.listContainers(options);
  return containers;
}

async function dockerListImages() {
  const containers = await docker.listImages();
  return containers;
}

async function dockerContainerInspect(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);
  const response = await dockerContainer.inspect();
  return response;
}

async function dockerContainerStats(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);
  const options = {
    stream: false,
  };
  const response = await dockerContainer.stats(options); // output hw usage statistics just once
  return response;
}

async function dockerContainerChanges(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);
  const response = await dockerContainer.changes();
  return response.toString();
}

function dockerPullStream(repoTag, res, callback) {
  docker.pull(repoTag, (err, mystream) => {
    function onFinished(error, output) {
      if (error) {
        callback(err);
      } else {
        callback(null, output);
      }
    }
    function onProgress(event) {
      if (res) {
        res.write(serviceHelper.ensureString(event));
      }
      log.info(event);
    }
    if (err) {
      callback(err);
    } else {
      docker.modem.followProgress(mystream, onFinished, onProgress);
    }
  });
}

async function dockerContainerExec(container, cmd, env, res, callback) {
  try {
    const options = {
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Cmd: cmd,
      Env: env,
      Tty: false,
    };
    const optionsExecStart = {
      Detach: false,
      Tty: false,
    };

    const exec = await container.exec(options);
    exec.start(optionsExecStart, (err, mystream) => {
      if (err) {
        callback(err);
      }
      mystream.on('data', (data) => res.write(data.toString()));
      mystream.on('end', () => callback(null));
    });
  } catch (error) {
    callback(error);
  }
}

async function dockerContainerLogsStream(idOrName, res, callback) {
  try {
    // container ID or name
    const containers = await dockerListContainers(true);
    const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
    const dockerContainer = docker.getContainer(myContainer.Id);
    const logStream = new stream.PassThrough();
    logStream.on('data', (chunk) => {
      res.write(serviceHelper.ensureString(chunk.toString('utf8')));
    });

    dockerContainer.logs(
      {
        follow: true,
        stdout: true,
        stderr: true,
      },
      (err, mystream) => {
        if (err) {
          callback(err);
        } else {
          try {
            dockerContainer.modem.demuxStream(mystream, logStream, logStream);
            mystream.on('end', () => {
              logStream.end();
              callback(null);
            });

            setTimeout(() => {
              mystream.destroy();
            }, 2000);
          } catch (error) {
            throw new Error('An error obtaining log data of an application has occured');
          }
        }
      },
    );
  } catch (error) {
    callback(error);
  }
}

async function dockerContainerLogs(idOrName, lines) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  const options = {
    follow: false,
    stdout: true,
    stderr: true,
    tail: lines,
  };
  const logs = await dockerContainer.logs(options);
  return logs.toString();
}

async function appPull(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      let { repotag } = req.params;
      repotag = repotag || req.query.repotag;
      if (!repotag) {
        throw new Error('No Docker repository specified');
      }

      dockerPullStream(repotag, res, (error, dataLog) => {
        if (error) {
          throw error;
        } else {
          const containerLogResponse = serviceHelper.createDataMessage(dataLog);
          res.json(containerLogResponse);
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

async function listRunningApps(req, res) {
  try {
    let apps = await dockerListContainers(false);
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
    let apps = await dockerListContainers(true);
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
    const apps = await dockerListImages();
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

async function nodeTier() {
  // get our collateral information to decide if app specifications are basic, super, bamf
  // getzlenodestatus.collateral
  const nodeStatus = await daemonService.getZelNodeStatus();
  if (nodeStatus.status === 'error') {
    throw nodeStatus.data;
  }
  const collateralInformation = getCollateralInfo(nodeStatus.data.collateral);
  // get transaction information about collateralInformation.txhash
  const request = {
    params: {
      txid: collateralInformation.txhash,
      verbose: 1,
    },
  };
  const txInformation = await daemonService.getRawTransaction(request);
  if (txInformation.status === 'error') {
    throw txInformation.data;
  }
  // get collateralInformation.txindex vout
  const { value } = txInformation.data.vout[collateralInformation.txindex];
  if (value === 10000) {
    return 'basic';
  }
  if (value === 25000) {
    return 'super';
  }
  if (value === 100000) {
    return 'bamf';
  }
  throw new Error('Unrecognised Flux Node tier');
}

async function appDockerCreate(appSpecifications) {
  let exposedPorts = {};
  let portBindings = {};
  if (appSpecifications.version === 1) {
    portBindings = {
      [`${appSpecifications.containerPort.toString()}/tcp`]: [
        {
          HostPort: appSpecifications.port.toString(),
        },
      ],
    };
    exposedPorts = {
      [`${appSpecifications.port.toString()}/tcp`]: {},
      [`${appSpecifications.containerPort.toString()}/tcp`]: {},
    };
  } else if (appSpecifications.version === 2) {
    appSpecifications.ports.forEach((port) => {
      exposedPorts[[`${port.toString()}/tcp`]] = {};
    });
    appSpecifications.containerPorts.forEach((port) => {
      exposedPorts[[`${port.toString()}/tcp`]] = {};
    });
    for (let i = 0; i < appSpecifications.containerPorts.length; i += 1) {
      portBindings[[`${appSpecifications.containerPorts[i].toString()}/tcp`]] = [
        {
          HostPort: appSpecifications.ports[i].toString(),
        },
      ];
    }
  }
  const options = {
    Image: appSpecifications.repotag,
    name: getAppIdentifier(appSpecifications.name),
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: appSpecifications.commands,
    Env: appSpecifications.enviromentParameters,
    Tty: false,
    ExposedPorts: exposedPorts,
    HostConfig: {
      NanoCPUs: appSpecifications.cpu * 1e9,
      Memory: appSpecifications.ram * 1024 * 1024,
      Binds: [`${appsFolder + getAppIdentifier(appSpecifications.name)}:${appSpecifications.containerData}`],
      Ulimits: [
        {
          Name: 'nofile',
          Soft: 100000,
          Hard: 100000, // 1048576
        },
      ],
      PortBindings: portBindings,
      RestartPolicy: {
        Name: 'unless-stopped',
      },
      NetworkMode: 'fluxDockerNetwork',
      LogConfig: {
        Type: 'json-file',
        Config: {
          'max-file': '1',
          'max-size': '20m',
        },
      },
    },
  };

  const app = await docker.createContainer(options).catch((error) => {
    log.error(error);
    throw error;
  });
  return app;
}

async function appDockerStart(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.start(); // may throw
  return `Flux App ${idOrName} successfully started.`;
}

async function appDockerStop(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.stop();
  return `Flux App ${idOrName} successfully stopped.`;
}

async function appDockerRestart(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.restart();
  return `Flux App ${idOrName} successfully restarted.`;
}

async function appDockerKill(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.kill();
  return `Flux App ${idOrName} successfully killed.`;
}

async function appDockerRemove(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.remove();
  return `Flux App ${idOrName} successfully removed.`;
}

async function appDockerImageRemove(idOrName) {
  // container ID or name
  const dockerImage = docker.getImage(idOrName);

  await dockerImage.remove();
  return `Flux App ${idOrName} image successfully removed.`;
}

async function appDockerPause(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.pause();
  return `Flux App ${idOrName} successfully paused.`;
}

async function appDockerUnpase(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.unpause();
  return `Flux App ${idOrName} successfully unpaused.`;
}

async function appDockerTop(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);

  const processes = await dockerContainer.top();
  return processes;
}

async function appStart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await appDockerStart(appname);

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

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await appDockerStop(appname);

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

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await appDockerRestart(appname);

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
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const appRes = await appDockerKill(appname);

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

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await appDockerPause(appname);

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

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const appRes = await appDockerUnpase(appname);

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

    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const appRes = await appDockerTop(appname);

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
    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized === true) {
      const logs = await dockerContainerLogs(appname, lines);
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
    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized === true) {
      res.setHeader('Content-Type', 'application/json');
      dockerContainerLogsStream(appname, res, (error) => {
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
    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized === true) {
      const response = await dockerContainerInspect(appname);
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
    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized === true) {
      const response = await dockerContainerStats(appname);
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
    const authorized = await serviceHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized === true) {
      const response = await dockerContainerChanges(appname);
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

      const authorized = await serviceHelper.verifyPrivilege('appowner', req, processedBody.appname);
      if (authorized === true) {
        let cmd = processedBody.cmd || [];
        let env = processedBody.env || [];

        cmd = serviceHelper.ensureObject(cmd);
        env = serviceHelper.ensureObject(env);

        const containers = await dockerListContainers(true);
        const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(processedBody.appname) || container.Id === processedBody.appname));
        const dockerContainer = docker.getContainer(myContainer.Id);

        res.setHeader('Content-Type', 'application/json');

        dockerContainerExec(dockerContainer, cmd, env, res, (error) => {
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

async function createFluxDockerNetwork() {
  // todo remove after couple of updates
  try {
    const network = docker.getNetwork('zelfluxDockerNetwork');
    await dockerRemoveNetwork(network);
  } catch (error) {
    log.warn(error);
  }
  // check if fluxDockerNetwork exists
  const fluxNetworkOptions = {
    Name: 'fluxDockerNetwork',
    IPAM: {
      Config: [{
        Subnet: '172.15.0.0/16',
        Gateway: '172.15.0.1',
      }],
    },
  };
  let fluxNetworkExists = true;
  const network = docker.getNetwork(fluxNetworkOptions.Name);
  await dockerNetworkInspect(network).catch(() => {
    fluxNetworkExists = false;
  });
  let response;
  // create or check docker network
  if (!fluxNetworkExists) {
    response = await dockerCreateNetwork(fluxNetworkOptions);
  } else {
    response = 'Flux Network already exists.';
  }
  return response;
}

async function createFluxNetworkAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    const dockerRes = await createFluxDockerNetwork();
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
    const daemonGetInfo = await daemonService.getInfo();
    let daemonHeight = 1;
    if (daemonGetInfo.status === 'success') {
      daemonHeight = daemonGetInfo.data.blocks;
    } else {
      log.error(daemonGetInfo.data.message || daemonGetInfo.data);
    }
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

async function createAppVolume(appSpecifications, res) {
  const dfAsync = util.promisify(df);
  const appId = getAppIdentifier(appSpecifications.name);

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

  const tier = await nodeTier();
  const totalSpaceOnNode = config.fluxSpecifics.hdd[tier];
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
  const fluxSystemReserve = 30 - usedSpace > 0 ? 30 - usedSpace : 0;
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
    log.info(execMount);
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
// force determines if some a check for app not found is skipped
async function removeAppLocally(app, res, force = false, endResponse = true) {
  try {
    // remove app from local machine.
    // find in database, stop app, remove container, close ports delete data associated on system, remove from database
    // we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
    removalInProgress = true;
    if (!app) {
      throw new Error('No App specified');
    }

    const appId = getAppIdentifier(app);

    // first find the appSpecifications in our database.
    // connect to mongodb
    const dbopen = serviceHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const database = dbopen.db(config.database.appsglobal.database);

    const appsQuery = { name: app };
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
        appSpecifications = allApps.find((a) => a.name === app);
        // get it from permanent messages
        if (!appSpecifications) {
          const query = {};
          const projection = { projection: { _id: 0 } };
          const messages = await serviceHelper.findInDatabase(database, globalAppsMessages, query, projection);
          const appMessages = messages.filter((message) => {
            const specifications = message.appSpecifications || message.zelAppSpecifications;
            return specifications.name === app;
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

    // simplifying ignore error messages for now
    const stopStatus = {
      status: 'Stopping Flux App...',
    };
    log.info(stopStatus);
    if (res) {
      res.write(serviceHelper.ensureString(stopStatus));
    }
    await appDockerStop(appId).catch((error) => {
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
      status: 'Flux App stopped',
    };
    log.info(stopStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(stopStatus2));
    }

    const removeStatus = {
      status: 'Removing Flux App container...',
    };
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
    }
    await appDockerRemove(appId).catch((error) => {
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
      status: 'Flux App container removed',
    };
    log.info(removeStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus2));
    }

    const imageStatus = {
      status: 'Removing Flux App image...',
    };
    log.info(imageStatus);
    if (res) {
      res.write(serviceHelper.ensureString(imageStatus));
    }
    await appDockerImageRemove(appSpecifications.repotag).catch((error) => {
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
      status: 'Flux App image operations done',
    };
    log.info(imageStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(imageStatus2));
    }

    const portStatus = {
      status: 'Denying Flux App ports...',
    };
    log.info(portStatus);
    if (res) {
      res.write(serviceHelper.ensureString(portStatus));
    }
    if (appSpecifications.ports) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunication.denyPort(port);
      }
      // v1 compatibility
    } else if (appSpecifications.port) {
      await fluxCommunication.denyPort(appSpecifications.port);
    }
    const portStatus2 = {
      status: 'Ports denied',
    };
    log.info(portStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(portStatus2));
    }

    const unmuontStatus = {
      status: 'Unmounting volume...',
    };
    log.info(unmuontStatus);
    if (res) {
      res.write(serviceHelper.ensureString(unmuontStatus));
    }
    const execUnmount = `sudo umount ${appsFolder + appId}`;
    await cmdAsync(execUnmount).then(() => {
      const unmuontStatus2 = {
        status: 'Volume unmounted',
      };
      log.info(unmuontStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(unmuontStatus2));
      }
    }).catch((e) => {
      log.error(e);
      const unmuontStatus3 = {
        status: 'An error occured while unmounting storage. Continuing...',
      };
      log.info(unmuontStatus3);
      if (res) {
        res.write(serviceHelper.ensureString(unmuontStatus3));
      }
    });

    const cleaningStatus = {
      status: 'Cleaning up data...',
    };
    log.info(cleaningStatus);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningStatus));
    }
    const execDelete = `sudo rm -rf ${appsFolder + appId}`;
    await cmdAsync(execDelete).catch((e) => {
      log.error(e);
      const cleaningStatusE = {
        status: 'An error occured while cleaning data. Continuing...',
      };
      log.info(cleaningStatusE);
      if (res) {
        res.write(serviceHelper.ensureString(cleaningStatusE));
      }
    });
    const cleaningStatus2 = {
      status: 'Data cleaned',
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
          volumepath = cmdsplit[4]; // sudo mount -o loop /home/abcapp2TEMP /root/zelflux/ZelApps/abcapp2 is an example
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
        status: 'Cleaning up data volume...',
      };
      log.info(cleaningVolumeStatus);
      if (res) {
        res.write(serviceHelper.ensureString(cleaningVolumeStatus));
      }
      const execVolumeDelete = `sudo rm -rf ${volumepath}`;
      await cmdAsync(execVolumeDelete).catch((e) => {
        log.error(e);
        const cleaningVolumeStatusE = {
          status: 'An error occured while cleaning volume. Continuing...',
        };
        log.info(cleaningVolumeStatusE);
        if (res) {
          res.write(serviceHelper.ensureString(cleaningVolumeStatusE));
        }
      });
      const cleaningVolumeStatus2 = {
        status: 'Volume cleaned',
      };
      log.info(cleaningVolumeStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(cleaningVolumeStatus2));
      }
    }

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

    const appRemovalResponse = serviceHelper.createDataMessage(`Flux App ${app} was successfuly removed`);
    log.info(appRemovalResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponse));
      if (endResponse) {
        res.end();
      }
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

// removal WITHOUT storage deletion and catches. For app reload. Only for internal useage. We throwing in functinos using this
async function softRemoveAppLocally(app, res) {
  // remove app from local machine.
  // find in database, stop app, remove container, close port, remove from database
  // we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
  if (!app) {
    throw new Error('No Flux App specified');
  }

  const appId = getAppIdentifier(app);

  // first find the appSpecifications in our database.
  // connect to mongodb
  const dbopen = serviceHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appslocal.database);

  const appsQuery = { name: app };
  const appsProjection = {};
  const appSpecifications = await serviceHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
  if (!appSpecifications) {
    throw new Error('Flux App not found');
  }

  // simplifying ignore error messages for now
  const stopStatus = {
    status: 'Stopping Flux App...',
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
  }

  await appDockerStop(appId);

  const stopStatus2 = {
    status: 'Flux App stopped',
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
  }

  const removeStatus = {
    status: 'Removing Flux App container...',
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
  }

  await appDockerRemove(appId);

  const removeStatus2 = {
    status: 'Flux App container removed',
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
  }

  const imageStatus = {
    status: 'Removing Flux App image...',
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
  }
  await appDockerImageRemove(appSpecifications.repotag).catch((error) => {
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
    status: 'Flux App image operations done',
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
  }

  const portStatus = {
    status: 'Denying Flux App ports...',
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
  }
  if (appSpecifications.ports) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecifications.ports) {
      // eslint-disable-next-line no-await-in-loop
      await fluxCommunication.denyPort(port);
    }
    // v1 compatibility
  } else if (appSpecifications.port) {
    await fluxCommunication.denyPort(appSpecifications.port);
  }
  const portStatus2 = {
    status: 'Ports denied',
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
  }

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

  const appRemovalResponse = serviceHelper.createDataMessage(`Flux App ${app} was partially removed`);
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
  }
}

async function removeAppLocallyApi(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    } else {
      // remove app from local machine.
      // find in database, stop app, remove container, close ports delete data associated on system, remove from database
      // if other container uses the same image -> then it shall result in an error so ok anyway
      let { appname } = req.params;
      appname = appname || req.query.appname;

      let { force } = req.params;
      force = force || req.query.force || false;
      force = serviceHelper.ensureBoolean(force);

      if (!appname) {
        throw new Error('No Flux App specified');
      }

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

async function checkAppRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  const tier = await nodeTier();
  const resourcesLocked = await appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
  }

  const totalSpaceOnNode = config.fluxSpecifics.hdd[tier];
  const useableSpaceOnNode = totalSpaceOnNode - config.lockedSystemResources.hdd;
  const hddLockedByApps = resourcesLocked.data.apsHddLocked;
  const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (appSpecs.hdd >= availableSpaceForApps) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }

  const totalCpuOnNode = config.fluxSpecifics.cpu[tier];
  const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
  const cpuLockedByApps = resourcesLocked.data.appsCpusLocked * 10;
  const adjustedAppCpu = appSpecs.cpu * 10;
  const availableCpuForApps = useableCpuOnNode - cpuLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (adjustedAppCpu >= availableCpuForApps) {
    throw new Error('Insufficient CPU power on Flux Node to spawn an application');
  }

  const totalRamOnNode = config.fluxSpecifics.ram[tier];
  const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
  const ramLockedByApps = resourcesLocked.data.appsRamLocked;
  const availableRamForApps = useableRamOnNode - ramLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (appSpecs.ram >= availableRamForApps) {
    throw new Error('Insufficient RAM on Flux Node to spawn an application');
  }
  return true;
}

async function registerAppLocally(appSpecifications, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from aapp messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    const appName = appSpecifications.name;
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
    const fluxNet = await createFluxDockerNetwork();
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
    if (appResult) {
      throw new Error('Flux App already installed');
    }

    const checkParameters = {
      status: 'Checking Flux App requirements...',
    };
    log.info(checkParameters);
    if (res) {
      res.write(serviceHelper.ensureString(checkParameters));
    }

    await checkAppRequirements(appSpecifications);

    // prechecks done
    const appInstallation = {
      status: 'Initiating Flux App installation...',
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
    }
    // register the app
    await serviceHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);

    // pull image
    // eslint-disable-next-line no-unused-vars
    dockerPullStream(appSpecifications.repotag, res, async (error, dataLog) => {
      if (error) {
        const errorResponse = serviceHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code,
        );
        log.error(errorResponse);
        if (res) {
          res.write(serviceHelper.ensureString(errorResponse));
        }
        const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
        log.info(removeStatus);
        if (res) {
          res.write(serviceHelper.ensureString(removeStatus));
        }
        removeAppLocally(appName, res);
      } else {
        const pullStatus = {
          status: 'Pulling global Flux App was successful',
        };
        if (res) {
          res.write(serviceHelper.ensureString(pullStatus));
        }

        const volumeOK = await createAppVolume(appSpecifications, res).catch((errr) => {
          const errorResponse = serviceHelper.createErrorMessage(
            errr.message || errr,
            errr.name,
            errr.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }

          const removeStatus = serviceHelper.createErrorMessage('Error in volume assigning occured. Initiating Flux App removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeAppLocally(appName, res);
        });

        if (!volumeOK) {
          return;
        }
        log.info(volumeOK);
        if (res) {
          res.write(serviceHelper.ensureString(volumeOK));
        }

        const createApp = {
          status: 'Creating local Flux App',
        };
        log.info(createApp);
        if (res) {
          res.write(serviceHelper.ensureString(createApp));
        }

        const dockerCreated = await appDockerCreate(appSpecifications).catch((e) => {
          const errorResponse = serviceHelper.createErrorMessage(
            e.message || e,
            e.name,
            e.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeAppLocally(appName, res);
        });
        if (!dockerCreated) {
          return;
        }
        const portStatusInitial = {
          status: 'Allowing Flux App ports...',
        };
        log.info(portStatusInitial);
        if (res) {
          res.write(serviceHelper.ensureString(portStatusInitial));
        }
        if (appSpecifications.ports) {
          // eslint-disable-next-line no-restricted-syntax
          for (const port of appSpecifications.ports) {
            // eslint-disable-next-line no-await-in-loop
            const portResponse = await fluxCommunication.allowPort(port);
            if (portResponse.status === true) {
              const portStatus = {
                status: `'Port ${port} OK'`,
              };
              log.info(portStatus);
              if (res) {
                res.write(serviceHelper.ensureString(portStatus));
              }
            } else {
              const portStatus = {
                status: `Error: Port ${port} FAILed to open.`,
              };
              log.info(portStatus);
              if (res) {
                res.write(serviceHelper.ensureString(portStatus));
              }
              const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
              log.info(removeStatus);
              if (res) {
                res.write(serviceHelper.ensureString(removeStatus));
              }
              removeAppLocally(appName, res);
              return;
            }
          }
        } else if (appSpecifications.port) {
          // v1 compatibility
          const portResponse = await fluxCommunication.allowPort(appSpecifications.port);
          if (portResponse.status === true) {
            const portStatus = {
              status: 'Port OK',
            };
            log.info(portStatus);
            if (res) {
              res.write(serviceHelper.ensureString(portStatus));
            }
          } else {
            const portStatus = {
              status: 'Error: Port FAILed to open.',
            };
            log.info(portStatus);
            if (res) {
              res.write(serviceHelper.ensureString(portStatus));
            }
            const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeAppLocally(appName, res);
            return;
          }
        }

        const startStatus = {
          status: 'Starting Flux App...',
        };
        log.info(startStatus);
        if (res) {
          res.write(serviceHelper.ensureString(startStatus));
        }
        const app = await appDockerStart(getAppIdentifier(appSpecifications.name)).catch((error2) => {
          const errorResponse = serviceHelper.createErrorMessage(
            error2.message || error2,
            error2.name,
            error2.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeAppLocally(appName, res);
        });
        if (!app) {
          return;
        }
        const appResponse = serviceHelper.createDataMessage(app);
        log.info(appResponse);
        if (res) {
          res.write(serviceHelper.ensureString(appResponse));
          res.end();
        }
      }
    });
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    }
  }
}

// register app with volume already existing
async function softRegisterAppLocally(appSpecifications, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    const appName = appSpecifications.name;
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
    const fluxNet = await createFluxDockerNetwork();
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
    if (appResult) {
      throw new Error('Flux App already installed');
    }

    const checkParameters = {
      status: 'Checking Flux App requirements...',
    };
    log.info(checkParameters);
    if (res) {
      res.write(serviceHelper.ensureString(checkParameters));
    }

    await checkAppRequirements(appSpecifications);

    // prechecks done
    const appInstallation = {
      status: 'Initiating Flux App installation...',
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
    }
    // register the app
    await serviceHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appSpecifications);

    // pull image
    // eslint-disable-next-line no-unused-vars
    dockerPullStream(appSpecifications.repotag, res, async (error, dataLog) => {
      if (error) {
        const errorResponse = serviceHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code,
        );
        log.error(errorResponse);
        if (res) {
          res.write(serviceHelper.ensureString(errorResponse));
        }
        const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
        log.info(removeStatus);
        if (res) {
          res.write(serviceHelper.ensureString(removeStatus));
        }
        removeAppLocally(appName, res, true);
      } else {
        const pullStatus = {
          status: 'Pulling global Flux App was successful',
        };
        if (res) {
          res.write(serviceHelper.ensureString(pullStatus));
        }

        const createApp = {
          status: 'Creating local Flux App',
        };
        log.info(createApp);
        if (res) {
          res.write(serviceHelper.ensureString(createApp));
        }

        const dockerCreated = await appDockerCreate(appSpecifications).catch((e) => {
          const errorResponse = serviceHelper.createErrorMessage(
            e.message || e,
            e.name,
            e.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeAppLocally(appName, res, true);
        });
        if (!dockerCreated) {
          return;
        }
        const portStatusInitial = {
          status: 'Allowing Flux App ports...',
        };
        log.info(portStatusInitial);
        if (res) {
          res.write(serviceHelper.ensureString(portStatusInitial));
        }
        if (appSpecifications.ports) {
          // eslint-disable-next-line no-restricted-syntax
          for (const port of appSpecifications.ports) {
            // eslint-disable-next-line no-await-in-loop
            const portResponse = await fluxCommunication.allowPort(port);
            if (portResponse.status === true) {
              const portStatus = {
                status: `'Port ${port} OK'`,
              };
              log.info(portStatus);
              if (res) {
                res.write(serviceHelper.ensureString(portStatus));
              }
            } else {
              const portStatus = {
                status: `Error: Port ${port} FAILed to open.`,
              };
              log.info(portStatus);
              if (res) {
                res.write(serviceHelper.ensureString(portStatus));
              }
              const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
              log.info(removeStatus);
              if (res) {
                res.write(serviceHelper.ensureString(removeStatus));
              }
              removeAppLocally(appName, res, true);
              return;
            }
          }
        } else if (appSpecifications.port) {
          // v1 compatibility
          const portResponse = await fluxCommunication.allowPort(appSpecifications.port);
          if (portResponse.status === true) {
            const portStatus = {
              status: 'Port OK',
            };
            log.info(portStatus);
            if (res) {
              res.write(serviceHelper.ensureString(portStatus));
            }
          } else {
            const portStatus = {
              status: 'Error: Port FAILed to open.',
            };
            log.info(portStatus);
            if (res) {
              res.write(serviceHelper.ensureString(portStatus));
            }
            const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeAppLocally(appName, res, true);
            return;
          }
        }
        const startStatus = {
          status: 'Starting Flux App...',
        };
        log.info(startStatus);
        if (res) {
          res.write(serviceHelper.ensureString(startStatus));
        }
        const app = await appDockerStart(getAppIdentifier(appSpecifications.name)).catch((error2) => {
          const errorResponse = serviceHelper.createErrorMessage(
            error2.message || error2,
            error2.name,
            error2.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating Flux App removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeAppLocally(appName, res, true);
        });
        if (!app) {
          return;
        }
        const appResponse = serviceHelper.createDataMessage(app);
        log.info(appResponse);
        if (res) {
          res.write(serviceHelper.ensureString(appResponse));
          res.end();
        }
      }
    });
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    }
  }
}

function appPricePerMonth(dataForAppRegistration) {
  if (!dataForAppRegistration) {
    return new Error('Application specification not provided');
  }
  if (dataForAppRegistration.tiered) {
    const cpuTotalCount = dataForAppRegistration.cpubasic + dataForAppRegistration.cpusuper + dataForAppRegistration.cpubamf;
    const cpuPrice = cpuTotalCount * config.fluxapps.price.cpu * 10;
    const cpuTotal = cpuPrice / 3;
    const ramTotalCount = dataForAppRegistration.rambasic + dataForAppRegistration.ramsuper + dataForAppRegistration.rambamf;
    const ramPrice = (ramTotalCount * config.fluxapps.price.ram) / 100;
    const ramTotal = ramPrice / 3;
    const hddTotalCount = dataForAppRegistration.hddbasic + dataForAppRegistration.hddsuper + dataForAppRegistration.hddbamf;
    const hddPrice = hddTotalCount * config.fluxapps.price.hdd;
    const hddTotal = hddPrice / 3;
    const totalPrice = cpuTotal + ramTotal + hddTotal;
    return Number(Math.ceil(totalPrice * 100) / 100);
  }
  const cpuTotal = dataForAppRegistration.cpu * config.fluxapps.price.cpu * 10;
  const ramTotal = (dataForAppRegistration.ram * config.fluxapps.price.ram) / 100;
  const hddTotal = dataForAppRegistration.hdd * config.fluxapps.price.hdd;
  const totalPrice = cpuTotal + ramTotal + hddTotal;
  return Number(Math.ceil(totalPrice * 100) / 100);
}

function checkHWParameters(appSpecs) {
  // check specs parameters. JS precision
  if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
    return new Error('CPU badly assigned');
  }
  if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram) || appSpecs.ram < 100) {
    return new Error('RAM badly assigned');
  }
  if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
    return new Error('SSD badly assigned');
  }
  if (appSpecs.tiered) {
    if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.basic - config.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
      return new Error('CPU for Cumulus badly assigned');
    }
    if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (config.fluxSpecifics.ram.basic - config.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
      return new Error('RAM for Cumulus badly assigned');
    }
    if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (config.fluxSpecifics.hdd.basic - config.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
      return new Error('SSD for Cumulus badly assigned');
    }
    if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.super - config.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
      return new Error('CPU for Nimbus badly assigned');
    }
    if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (config.fluxSpecifics.ram.super - config.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
      return new Error('RAM for Nimbus badly assigned');
    }
    if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (config.fluxSpecifics.hdd.super - config.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
      return new Error('SSD for Nimbus badly assigned');
    }
    if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
      return new Error('CPU for Stratus badly assigned');
    }
    if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
      return new Error('RAM for Stratus badly assigned');
    }
    if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
      return new Error('SSD for Stratus badly assigned');
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

async function messageHash(message) {
  if (typeof message !== 'string') {
    return new Error('Invalid message');
  }
  return crypto.createHash('sha256').update(message).digest('hex');
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
      description: 'Folding @ Home is cool :)',
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
      ramsuper: 1000,
      rambamf: 4000,
      hddbasic: 5,
      hddsuper: 5,
      hddbamf: 5,
      enviromentParameters: [`USER=${userconfig.initial.zelid}`, 'TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
      commands: [
        '--allow',
        '0/0',
        '--web-allow',
        '0/0',
      ],
      containerData: '/config',
      hash: 'localappinstancehashABCDE', // hash of app message
      height: 0, // height of tx on which it was
    },
    {
      version: 2,
      name: 'KadenaChainWebNode', // corresponds to docker name and this name is stored in apps mongo database
      description: 'Kadena is a fast, secure, and scalable blockchain using the Chainweb consensus protocol. '
        + 'Chainweb is a braided, parallelized Proof Of Work consensus mechanism that improves throughput and scalability in executing transactions on the blockchain while maintaining the security and integrity found in Bitcoin. '
        + 'The healthy information tells you if your node is running and synced. If you just installed the docker it can say unhealthy for long time because on first run a bootstrap is downloaded and extracted to make your node sync faster before the node is started. '
        + 'Do not stop or restart the docker in the first hour after installation. You can also check if your kadena node is synced, by going to running apps and press visit button on kadena and compare your node height with Kadena explorer. Thank you.',
      repotag: 'zelcash/kadena-chainweb-node:2.7',
      owner: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
      ports: [30004, 30005],
      containerPorts: [30004, 30005],
      domains: ['', ''],
      tiered: false,
      cpu: 2, // true resource registered for app. If not tiered only this is available
      ram: 4000, // true resource registered for app
      hdd: 60, // true resource registered for app
      enviromentParameters: ['CHAINWEB_P2P_PORT=30004', 'CHAINWEB_SERVICE_PORT=30005', 'LOGLEVEL=warn'],
      commands: ['/bin/bash', '-c', '(test -d /data/chainweb-db/0 && ./run-chainweb-node.sh) || (/chainweb/initialize-db.sh && ./run-chainweb-node.sh)'],
      containerData: '/data', // cannot be root todo in verification
      hash: 'localSpecificationsVersion8', // hash of app message
      height: 680000, // height of tx on which it was
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
  const messageHASH = await messageHash(messToHash);
  if (messageHASH !== message.hash) {
    throw new Error('Invalid Flux App hash received!');
  }
  return true;
}

async function verifyAppMessageSignature(type, version, appSpec, timestamp, signature) {
  if (typeof appSpec !== 'object' && typeof timestamp !== 'number' && typeof signature !== 'string' && typeof version !== 'number' && typeof type !== 'string') {
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
  if (typeof appSpec !== 'object' && typeof timestamp !== 'number' && typeof signature !== 'string' && typeof version !== 'number' && typeof type !== 'string') {
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
    const resDocker = await serviceHelper.axiosGet(`https://hub.docker.com/v2/repositories/${splittedRepo[0]}/tags/${splittedRepo[1]}`).catch(() => {
      throw new Error('Repository is not in valid format namespace/repository:tag');
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
    throw new Error('Repository is not in valid format namespace/repository:tag');
  }
  return true;
}

async function checkWhitelistedRepository(repotag) {
  if (typeof repotag !== 'string') {
    throw new Error('Invalid repotag');
  }
  const splittedRepo = repotag.split(':');
  if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
    const resWhitelistRepo = await serviceHelper.axiosGet('https://raw.githubusercontent.com/zelcash/zelflux/master/helpers/repositories.json');

    if (!resWhitelistRepo) {
      throw new Error('Unable to communicate with Flux Services! Try again later.');
    }

    const repos = resWhitelistRepo.data;
    const whitelisted = repos.includes(repotag);
    if (!whitelisted) {
      throw new Error('Repository is not whitelisted. Please contact Flux Team.');
    }
  } else {
    throw new Error('Repository is not in valid format namespace/repository:tag');
  }
  return true;
}

async function checkWhitelistedZelID(zelid) {
  if (typeof zelid !== 'string') {
    throw new Error('Invalid Owner ZelID');
  }
  const resZelIDs = await serviceHelper.axiosGet('https://raw.githubusercontent.com/zelcash/zelflux/master/helpers/zelids.json');

  if (!resZelIDs) {
    throw new Error('Unable to communicate with Flux Services! Try again later.');
  }

  const zelids = resZelIDs.data;
  const whitelisted = zelids.includes(zelid);
  if (!whitelisted) {
    throw new Error('Owner ZelID is not whitelisted. Please contact Flux Team.');
  }
  return true;
}

async function verifyAppSpecifications(appSpecifications) {
  if (typeof appSpecifications !== 'object') {
    throw new Error('Invalid Flux App Specifications');
  }
  if (appSpecifications.version !== 1 && appSpecifications.version !== 2) {
    throw new Error('Flux App message version specification is invalid');
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
  const parameters = checkHWParameters(appSpecifications);
  if (parameters !== true) {
    const errorMessage = parameters;
    throw new Error(errorMessage);
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
  } else if (appSpecifications.version === 2) {
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

  // check wheter shared Folder is not root
  if (appSpecifications.containerData.length < 2) {
    throw new Error('Flux App container data folder not specified. If no data folder is whished, use /tmp');
  }

  // check repotag if available for download
  await verifyRepository(appSpecifications.repotag);

  // check repository whitelisted
  await checkWhitelistedRepository(appSpecifications.repotag);

  // check ZelID whitelisted
  await checkWhitelistedZelID(appSpecifications.owner);
}

async function ensureCorrectApplicationPort(appSpecFormatted) {
  const dbopen = serviceHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  if (appSpecFormatted.version === 1) {
    const portQuery = { ports: appSpecFormatted.port };
    const portProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };
    // eslint-disable-next-line no-await-in-loop
    const portsResult = await serviceHelper.findInDatabase(appsDatabase, globalAppsInformation, portQuery, portProjection);

    portsResult.forEach((result) => {
      if (result.name !== appSpecFormatted.name) {
        throw new Error(`Flux App ${appSpecFormatted.name} port ${appSpecFormatted.port} already registered with different application. Your Flux App has to use different port.`);
      }
    });
  } else if (appSpecFormatted.version === 2) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecFormatted.ports) {
      const portQuery = { ports: port };
      const portProjection = {
        projection: {
          _id: 0,
          name: 1,
        },
      };
      // eslint-disable-next-line no-await-in-loop
      const portsResult = await serviceHelper.findInDatabase(appsDatabase, globalAppsInformation, portQuery, portProjection);

      portsResult.forEach((result) => {
        if (result.name !== appSpecFormatted.name) {
          throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already registered with different application. Your Flux App has to use different port.`);
        }
      });
    }
  }
  return true;
}

async function checkApplicationNameConflicts(appSpecFormatted) {
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
async function storeAppTemporaryMessage(message, furtherVerification = false) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.signature !== 'string' && typeof message.timestamp !== 'number' && typeof message.hash !== 'string') {
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
  // data shall already be verified by the broadcasting node. But verify all again.
  if (furtherVerification) {
    if (message.type === 'zelappregister' || message.type === 'fluxappregister') {
      // missing check for port?
      await verifyAppSpecifications(specifications);
      await verifyAppHash(message);
      await ensureCorrectApplicationPort(specifications);
      await checkApplicationNameConflicts(specifications);
      await verifyAppMessageSignature(message.type, message.version, specifications, message.timestamp, message.signature);
    } else if (message.type === 'zelappupdate' || message.type === 'fluxappupdate') {
      // stadard verifications
      await verifyAppSpecifications(specifications);
      await verifyAppHash(message);
      await ensureCorrectApplicationPort(specifications);
      // verify that app exists, does not change repotag and is signed by app owner.
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: specifications.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (!appInfo) {
        throw new Error('Flux App update message received but application does not exists!');
      }
      if (appInfo.repotag !== specifications.repotag) {
        throw new Error('Flux App update of repotag is not allowed');
      }
      const { owner } = appInfo;
      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(message.type, message.version, specifications, message.timestamp, message.signature, owner);
    } else {
      throw new Error('Invalid Flux App message received');
    }
  }

  const receivedAt = Date.now();
  const validTill = receivedAt + (60 * 60 * 1000); // 60 minutes

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
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
  const query = { hash: newMessage.hash };
  const projection = {};
  const result = await serviceHelper.findOneInDatabase(database, globalAppsTempMessages, query, projection);
  if (result) {
    // it is already stored
    return false;
  }
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
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.broadcastedAt !== 'number' && typeof message.hash !== 'string' && typeof message.name !== 'string' && typeof message.ip !== 'string') {
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
      // first  check if this node is available for application registration - has at least 7 connections (that is sufficient as it means it is confirmed and works correctly)
      if (fluxCommunication.outgoingPeers.length + fluxCommunication.incomingPeers.length < config.fluxapps.minOutgoing + config.fluxapps.minIncoming) {
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

      let { version } = appSpecification; // Active specs version is 2
      let { name } = appSpecification;
      let { description } = appSpecification;
      let { repotag } = appSpecification;
      let { owner } = appSpecification;
      let { ports } = appSpecification;
      let { domains } = appSpecification;
      let { enviromentParameters } = appSpecification;
      let { commands } = appSpecification;
      let { containerPorts } = appSpecification;
      let { containerData } = appSpecification;
      let { cpu } = appSpecification;
      let { ram } = appSpecification;
      let { hdd } = appSpecification;
      const { tiered } = appSpecification;

      // check if signature of received data is correct
      if (!version || !name || !description || !repotag || !owner || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
        throw new Error('Missing Flux App specification parameter');
      }
      version = serviceHelper.ensureNumber(version);
      name = serviceHelper.ensureString(name);
      description = serviceHelper.ensureString(description);
      repotag = serviceHelper.ensureString(repotag);
      owner = serviceHelper.ensureString(owner);
      ports = serviceHelper.ensureObject(ports);
      const portsCorrect = [];
      if (Array.isArray(ports)) {
        ports.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter); // next specification fork here we want to do ensureNumber
          portsCorrect.push(param);
        });
      } else {
        throw new Error('Ports for Flux App are invalid');
      }
      domains = serviceHelper.ensureObject(domains);
      const domainsCorect = [];
      if (Array.isArray(domains)) {
        domains.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          domainsCorect.push(param);
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
        throw new Error('Enviromental parameters for Flux App are invalid');
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

      const daemonGetInfo = await daemonService.getInfo();
      let daemonHeight = 0;
      if (daemonGetInfo.status === 'success') {
        daemonHeight = daemonGetInfo.data.blocks;
      } else {
        throw new Error(daemonGetInfo.data.message || daemonGetInfo.data);
      }

      if (owner !== config.fluxTeamZelId && daemonHeight < config.fluxapps.publicepochstart) {
        throw new Error('Global Registration open on the 10th of October 2020');
      }

      // finalised parameters that will get stored in global database
      const appSpecFormatted = {
        version, // integer
        name, // string
        description, // string
        repotag, // string
        owner, // zelid string
        ports: portsCorrect, // array of integers
        domains: domainsCorect,
        enviromentParameters: envParamsCorrected, // array of strings
        commands: commandsCorrected, // array of strings
        containerPorts: containerportsCorrect, // array of integers
        containerData, // string
        cpu, // float 0.1 step
        ram, // integer 100 step (mb)
        hdd, // integer 1 step
        tiered, // boolean
      };

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
      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted);

      // check if name is not yet registered
      await checkApplicationNameConflicts(appSpecFormatted);

      // check if ports is not yet registered
      await ensureCorrectApplicationPort(appSpecFormatted);

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await verifyAppMessageSignature(messageType, typeVersion, appSpecFormatted, timestamp, signature);

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may possess some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await messageHash(message);
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
      // first  check if this node is available for application update - has at least 7 connections (that is sufficient as it means it is confirmed and works correctly)
      if (fluxCommunication.outgoingPeers.length + fluxCommunication.incomingPeers.length < config.fluxapps.minOutgoing + config.fluxapps.minIncoming) {
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

      let { version } = appSpecification; // shall be 2
      let { name } = appSpecification;
      let { description } = appSpecification;
      let { repotag } = appSpecification;
      let { owner } = appSpecification;
      let { ports } = appSpecification;
      let { domains } = appSpecification;
      let { enviromentParameters } = appSpecification;
      let { commands } = appSpecification;
      let { containerPorts } = appSpecification;
      let { containerData } = appSpecification;
      let { cpu } = appSpecification;
      let { ram } = appSpecification;
      let { hdd } = appSpecification;
      const { tiered } = appSpecification;

      // check if signature of received data is correct
      if (!version || !name || !description || !repotag || !owner || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
        throw new Error('Missing Flux App specification parameter');
      }
      version = serviceHelper.ensureNumber(version);
      name = serviceHelper.ensureString(name);
      description = serviceHelper.ensureString(description);
      repotag = serviceHelper.ensureString(repotag);
      owner = serviceHelper.ensureString(owner);
      ports = serviceHelper.ensureObject(ports);
      const portsCorrect = [];
      if (Array.isArray(ports)) {
        ports.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter); // todo ensureNumber
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
        throw new Error('Enviromental parameters for Flux App are invalid');
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
          const param = serviceHelper.ensureString(parameter); // todo ensureNumber
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

      // finalised parameters that will get stored in global database
      const appSpecFormatted = {
        version, // integer
        name, // string
        description, // string
        repotag, // string
        owner, // zelid string
        ports: portsCorrect, // array of integers
        domains: domainsCorrect, // array of strings
        enviromentParameters: envParamsCorrected, // array of strings
        commands: commandsCorrected, // array of strings
        containerPorts: containerportsCorrect, // array of integers
        containerData, // string
        cpu, // float 0.1 step
        ram, // integer 100 step (mb)
        hdd, // integer 1 step
        tiered, // boolean
      };

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
      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted);
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
      const messageHASH = await messageHash(message);
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

async function installTemporaryLocalApplication(req, res, applicationName) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const allApps = await availableApps();
      const appSpecifications = allApps.find((app) => app.name === applicationName);
      if (!appSpecifications) {
        throw new Error('Application Specifications not found');
      }

      // get our tier and adjust true resource registered
      if (appSpecifications.tiered) {
        const tier = await nodeTier();
        if (tier === 'basic') {
          appSpecifications.cpu = appSpecifications.cpubasic || appSpecifications.cpu;
          appSpecifications.ram = appSpecifications.rambasic || appSpecifications.ram;
        } else if (tier === 'super') {
          appSpecifications.cpu = appSpecifications.cpusuper || appSpecifications.cpu;
          appSpecifications.ram = appSpecifications.ramsuper || appSpecifications.ram;
        } else if (tier === 'bamf') {
          appSpecifications.cpu = appSpecifications.cpubamf || appSpecifications.cpu;
          appSpecifications.ram = appSpecifications.rambamf || appSpecifications.ram;
        } else {
          throw new Error('Unrecognised Flux Node tier');
        }
      }

      res.setHeader('Content-Type', 'application/json');
      registerAppLocally(appSpecifications, res);
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
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.appSpecifications !== 'object' && typeof message.signature !== 'string'
    && typeof message.timestamp !== 'number' && typeof message.hash !== 'string' && typeof message.txid !== 'string' && typeof message.height !== 'number' && typeof message.valueSat !== 'number') {
    return new Error('Invalid Flux App message for storing');
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
    //   version: 2,
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
  } catch (error) {
    // retry
    log.error(error);
    await serviceHelper.delay(60 * 1000);
    updateAppSpecifications(appSpecs);
  }
}

async function updateAppSpecsForRescanReindex(appSpecs) {
  // appSpecs: {
  //   version: 2,
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
    const randomDelay = Math.floor((Math.random() * 1280)) + 420;
    await serviceHelper.delay(randomDelay);
    const appMessageExists = await checkAppMessageExistence(hash);
    if (appMessageExists === false) { // otherwise do nothing
      // we surely do not have that message in permanent storaage.
      // check temporary message storage
      // if we have it in temporary storage, get the temporary message
      const tempMessage = await checkAppTemporaryMessageExistence(hash);
      if (tempMessage) {
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
        if (tempMessage.type === 'zelappregister' || tempMessage.type === 'fluxappregister') {
          // check if value is optimal or higher
          let appPrice = appPricePerMonth(specifications);
          if (appPrice < 1) {
            appPrice = 1;
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
          // may throw
          const query = { name: specifications.name };
          const projection = {
            projection: {
              _id: 0,
            },
          };
          const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
          // here comparison of height differences and specifications
          // price shall be price for standard registration plus minus already paid price according to old specifics. height remains height valid for 22000 blocks
          const appPrice = appPricePerMonth(specifications);
          const previousSpecsPrice = appPricePerMonth(appInfo);
          // what is the height difference
          const heightDifference = permanentAppMessage.height - appInfo.height; // has to be lower than 22000
          const perc = (config.fluxapps.blocksLasting - heightDifference) / config.fluxapps.blocksLasting;
          let actualPriceToPay = appPrice * 0.9;
          if (perc > 0) {
            actualPriceToPay = (appPrice - (perc * previousSpecsPrice)) * 0.9; // discount for missing heights. Allow 90%
          }
          actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
          if (actualPriceToPay < 1) {
            actualPriceToPay = 1;
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
      checkAndRequestApp(result.hash, result.txid, result.height, result.value);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1234);
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

async function checkSynced() {
  try {
    // check if flux database is synced with daemon database (equal or -1 inheight)
    const daemonGetInfo = await daemonService.getInfo();
    let daemonHeight;
    if (daemonGetInfo.status === 'success') {
      daemonHeight = daemonGetInfo.data.blocks;
    } else {
      throw new Error(daemonGetInfo.data.message || daemonGetInfo.data);
    }
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

    if (explorerHeight + 1 === daemonHeight || explorerHeight === daemonHeight) {
      return true;
    }
    return false;
  } catch (e) {
    log.error(e);
    return false;
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
    const tier = await nodeTier();
    if (tier === 'basic') {
      log.info('Basic node detected. Global applications will not be installed');
    }
    const synced = await checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
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
    if (runningAppList.length >= config.fluxapps.minimumInstances) {
      log.info(`Application ${randomApp} is already spawned on ${runningAppList.length} instances`);
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await daemonService.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
      if (benchmarkResponseData.ipaddress) {
        myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
      }
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip === myIP)) {
      log.info(`Application ${randomApp} is reported as already running on this Flux`);
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // second check if app is running on this node
    const runningApps = await listRunningApps();
    if (runningApps.status !== 'success') {
      throw new Error('Unable to check running apps on this Flux');
    }
    if (runningApps.data.find((app) => app.Names[0].substr(4, app.Names[0].length) === randomApp)) {
      log.info(`${randomApp} application is already running on this Flux`);
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // check if node is capable to run it according to specifications
    // get app specifications
    const appSpecifications = await getApplicationGlobalSpecifications(randomApp);
    if (!appSpecifications) {
      throw new Error(`Specifications for application ${randomApp} were not found!`);
    }
    // run the verification
    // get tier and adjust specifications
    if (appSpecifications.tiered) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    }
    // verify requirements
    await checkAppRequirements(appSpecifications);

    // if all ok Check hashes comparison if its out turn to start the app. 1% probability.
    const randomNumber = Math.floor((Math.random() * config.fluxapps.installation.probability));
    if (randomNumber !== 0) {
      log.info('Other Fluxes are evaluating application installation');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // an application was selected and checked that it can run on this node. try to install and run it locally
    // install the app
    await registerAppLocally(appSpecifications);

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
    const installedAppsNames = appsInstalled.map((app) => app.name);
    const runningAppsNames = runningApps.map((app) => app.Names[0].substr(4, app.Names[0].length));
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppsNames.filter((installedApp) => !runningSet.has(installedApp));
    // check if stoppedApp is a global application present in specifics. If so, try to start it.
    // eslint-disable-next-line no-restricted-syntax
    for (const stoppedApp of stoppedApps) {
      try {
        // proceed ONLY if its global App
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(stoppedApp);
        if (appDetails) {
          log.warn(`${stoppedApp} is stopped but shall be running. Starting...`);
          // it is a stopped global app. Try to run it.
          const appId = getAppIdentifier(stoppedApp);
          // check if some removal is in progress as if it is dont start it!
          if (!removalInProgress) {
            // eslint-disable-next-line no-await-in-loop
            await appDockerStart(appId);
          } else {
            log.warn(`Not starting ${stoppedApp} as of application removal in progress`);
          }
        }
      } catch (err) {
        log.error(err);
        // already checked for mongo ok, daemon ok, docker ok.
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocally(stoppedApp);
      }
    }
    const installedAndRunning = appsInstalled.filter((installedApp) => runningAppsNames.includes(installedApp.name));
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
    const synced = await checkSynced();
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
    const projectionApps = { projection: { _id: 0, name: 1 } };
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
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(appName);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(6 * 60 * 1000); // wait for 6 mins so we dont have more removals at the same time
    }
  } catch (error) {
    log.error(error);
  }
}

// check if more than 10 instances of application are running
async function checkAndRemoveApplicationInstance() {
  // function to remove global applications on this local node. Find applications that are spawned more than maximum number of instances allowed
  // check if synced
  try {
    const synced = await checkSynced();
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
      if (runningAppList.length > config.fluxapps.maximumInstances) {
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
    await softRemoveAppLocally(appSpecs.name, res);
    const appRedeployResponse = serviceHelper.createDataMessage('Application softly removed. Awaiting installation...');
    log.info(appRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appRedeployResponse));
    }
    await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins
    // run the verification
    // get tier and adjust specifications
    const tier = await nodeTier();
    const appSpecifications = appSpecs;
    if (appSpecifications.tiered) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    }
    // verify requirements
    await checkAppRequirements(appSpecifications);
    // register
    await softRegisterAppLocally(appSpecifications, res);
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
    // run the verification
    // get tier and adjust specifications
    const tier = await nodeTier();
    const appSpecifications = appSpecs;
    if (appSpecifications.tiered) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    }
    // verify requirements
    await checkAppRequirements(appSpecifications);
    // register
    await registerAppLocally(appSpecifications, res);
    log.info('Application redeployed');
  } catch (error) {
    log.error(error);
    removeAppLocally(appSpecs.name, res, true);
  }
}

async function reinstallOldApplications() {
  try {
    const synced = await checkSynced();
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
          const tier = await nodeTier();
          if (appSpecifications.tiered) {
            const hddTier = `hdd${tier}`;
            const ramTier = `ram${tier}`;
            const cpuTier = `cpu${tier}`;
            appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
            appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
            appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
          }

          if (appSpecifications.hdd === installedApp.hdd) {
            log.warn('Beginning Soft Redeployment...');
            // soft redeployment
            try {
              // eslint-disable-next-line no-await-in-loop
              await softRemoveAppLocally(installedApp.name);
              log.warn('Application softly removed. Awaiting installation...');
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
            log.warn('Beginning Hard Redeployment...');
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
              await registerAppLocally(appSpecifications);
            } catch (error) {
              log.error(error);
              removeAppLocally(appSpecifications.name, null, true);
            }
          }
        } else {
          log.info('Other Fluxes are redeploying application. Waiting for next round.');
        }
      }
      // else specifications do not exist anymore, app shall expire itself
    }
  } catch (error) {
    log.error(error);
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

      let { name } = appSpecification;
      let { cpu } = appSpecification;
      let { ram } = appSpecification;
      let { hdd } = appSpecification;
      const { tiered } = appSpecification;

      // check if signature of received data is correct
      if (!name || !cpu || !ram || !hdd) {
        throw new Error('Missing Flux App HW specification parameter');
      }

      name = serviceHelper.ensureString(name);
      cpu = serviceHelper.ensureNumber(cpu);
      ram = serviceHelper.ensureNumber(ram);
      hdd = serviceHelper.ensureNumber(hdd);
      if (typeof tiered !== 'boolean') {
        throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
      }

      // finalised parameters that will get stored in global database
      const appSpecFormatted = {
        name, // string
        cpu, // float 0.1 step
        ram, // integer 100 step (mb)
        hdd, // integer 1 step
        tiered, // boolean
      };

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
      const parameters = checkHWParameters(appSpecFormatted);
      if (parameters !== true) {
        const errorMessage = parameters;
        throw new Error(errorMessage);
      }

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
      const appInfo = await serviceHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      let actualPriceToPay = appPricePerMonth(appSpecFormatted);
      if (appInfo) {
        const previousSpecsPrice = appPricePerMonth(appInfo);
        // what is the height difference
        const daemonGetInfo = await daemonService.getInfo();
        let daemonHeight;
        if (daemonGetInfo.status === 'success') {
          daemonHeight = daemonGetInfo.data.blocks;
        } else {
          throw new Error(daemonGetInfo.data.message || daemonGetInfo.data);
        }
        const heightDifference = daemonHeight - appInfo.height; // has to be lower than 22000
        const perc = (config.fluxapps.blocksLasting - heightDifference) / config.fluxapps.blocksLasting;
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice);
        }
      }
      actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
      if (actualPriceToPay < 1) {
        actualPriceToPay = 1;
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

async function whitelistedRepositories(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet('https://raw.githubusercontent.com/zelcash/zelflux/master/helpers/repositories.json');
    const resultsResponse = serviceHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function whitelistedZelIDs(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet('https://raw.githubusercontent.com/zelcash/zelflux/master/helpers/zelids.json');
    const resultsResponse = serviceHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

// FluxShare specific
async function fluxShareDatabaseFileDelete(file) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = { name: file };
    const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
    await serviceHelper.findOneAndDeleteInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

// removes documents that starts with the path queried
async function fluxShareDatabaseFileDeleteMultiple(pathstart) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = { name: new RegExp(`^${pathstart}`) }; // has to start with this path
    await serviceHelper.removeDocumentsFromCollection(databaseFluxShare, sharedCollection, queryFluxShare);
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  // eslint-disable-next-line no-param-reassign
  arrayOfFiles = arrayOfFiles || [];

  files.forEach((file) => {
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(`${dirPath}/${file}`).isDirectory();
    } catch (error) {
      log.warn(error);
    }
    if (isDirectory) {
      // eslint-disable-next-line no-param-reassign
      arrayOfFiles = getAllFiles(`${dirPath}/${file}`, arrayOfFiles);
    } else {
      arrayOfFiles.push(`${dirPath}/${file}`);
    }
  });
  return arrayOfFiles;
}

function getFluxShareSize() {
  const dirpath = path.join(__dirname, '../../../');
  const directoryPath = `${dirpath}ZelApps/ZelShare`;

  const arrayOfFiles = getAllFiles(directoryPath);

  let totalSize = 0;

  arrayOfFiles.forEach((filePath) => {
    try {
      totalSize += fs.statSync(filePath).size;
    } catch (error) {
      log.warn(error);
    }
  });
  return (totalSize / 1e9); // in 'GB'
}

function getFluxShareSpecificFolderSize(folder) {
  const arrayOfFiles = getAllFiles(folder);

  let totalSize = 0;

  arrayOfFiles.forEach((filePath) => {
    try {
      totalSize += fs.statSync(filePath).size;
    } catch (error) {
      log.warn(error);
    }
  });
  return (totalSize); // in 'B'
}

async function fluxShareDatabaseShareFile(file) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = { name: file };
    const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
    const result = await serviceHelper.findOneInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
    if (result) {
      return result;
    }
    const string = file + new Date().getTime().toString() + Math.floor((Math.random() * 999999999999999)).toString();

    const fileDetail = {
      name: file,
      token: crypto.createHash('sha256').update(string).digest('hex'),
    };
    await serviceHelper.insertOneToDatabase(databaseFluxShare, sharedCollection, fileDetail);
    return fileDetail;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function fluxShareSharedFiles() {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = {};
    const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
    const results = await serviceHelper.findInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
    return results;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function fluxShareGetSharedFiles(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      const files = await fluxShareSharedFiles();
      const resultsResponse = serviceHelper.createDataMessage(files);
      res.json(resultsResponse);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function fluxShareUnshareFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      file = encodeURIComponent(file);
      await fluxShareDatabaseFileDelete(file);
      const resultsResponse = serviceHelper.createSuccessMessage('File sharing disabled');
      res.json(resultsResponse);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function fluxShareShareFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      file = encodeURIComponent(file);
      const fileDetails = await fluxShareDatabaseShareFile(file);
      const resultsResponse = serviceHelper.createDataMessage(fileDetails);
      res.json(resultsResponse);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function fluxShareDownloadFolder(req, res, authorized = false) {
  try {
    let auth = authorized;
    if (!auth) {
      auth = await serviceHelper.verifyPrivilege('admin', req);
    }

    if (auth) {
      let { folder } = req.params;
      folder = folder || req.query.folder;

      if (!folder) {
        const errorResponse = serviceHelper.createErrorMessage('No folder specified');
        res.json(errorResponse);
        return;
      }

      const dirpath = path.join(__dirname, '../../../');
      const folderpath = `${dirpath}ZelApps/ZelShare/${folder}`;

      // beautify name
      const folderNameArray = folderpath.split('/');
      const folderName = folderNameArray[folderNameArray.length - 1];

      // const size = getFluxShareSpecificFolderSize(folderpath);

      // Tell the browser that this is a zip file.
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-disposition': `attachment; filename=${folderName}.zip`,
      });

      const zip = archiver('zip');

      // Send the file to the page output.
      zip.pipe(res);
      zip.glob('**/*', { cwd: folderpath });
      zip.finalize();
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
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

async function fluxShareDownloadFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;

      if (!file) {
        const errorResponse = serviceHelper.createErrorMessage('No file specified');
        res.json(errorResponse);
        return;
      }

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;

      // beautify name
      const fileNameArray = file.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];

      res.download(filepath, fileName);
    } else {
      let { file } = req.params;
      file = file || req.query.file;
      let { token } = req.params;
      token = token || req.query.token;
      if (!file || !token) {
        const errMessage = serviceHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      const fileURI = encodeURIComponent(file);
      const dbopen = serviceHelper.databaseConnection();
      const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
      const sharedCollection = config.database.fluxshare.collections.shared;
      const queryFluxShare = { name: fileURI, token };
      const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
      const result = await serviceHelper.findOneInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
      if (!result) {
        const errMessage = serviceHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }

      // check if file is file. If directory use zelshareDwonloadFolder
      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;
      const fileStats = await fs.promises.lstat(filepath);
      const isDirectory = fileStats.isDirectory();

      if (isDirectory) {
        const modifiedReq = req;
        modifiedReq.params.folder = req.params.file;
        modifiedReq.query.folder = req.query.file;
        fluxShareDownloadFolder(modifiedReq, res, true);
      } else {
        // beautify name
        const fileNameArray = filepath.split('/');
        const fileName = fileNameArray[fileNameArray.length - 1];

        res.download(filepath, fileName);
      }
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
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

// oldpath is relative path to default fluxshare directory; newname is just a new name of folder/file
async function fluxShareRename(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { oldpath } = req.params;
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
        throw new Error('No new name is invalid');
      }
      // stop sharing of ALL files that start with the path
      const fileURI = encodeURIComponent(oldpath);
      await fluxShareDatabaseFileDeleteMultiple(fileURI);

      const dirpath = path.join(__dirname, '../../../');
      const oldfullpath = `${dirpath}ZelApps/ZelShare/${oldpath}`;
      let newfullpath = `${dirpath}ZelApps/ZelShare/${newname}`;
      const fileURIArray = fileURI.split('%2F');
      fileURIArray.pop();
      if (fileURIArray.length > 0) {
        const renamingFolder = fileURIArray.join('/');
        newfullpath = `${dirpath}ZelApps/ZelShare/${renamingFolder}/${newname}`;
      }
      await fs.promises.rename(oldfullpath, newfullpath);

      const response = serviceHelper.createSuccessMessage('Rename successful');
      res.json(response);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function fluxShareRemoveFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      const fileURI = encodeURIComponent(file);
      if (!file) {
        throw new Error('No file specified');
      }
      // stop sharing

      await fluxShareDatabaseFileDelete(fileURI);

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;
      await fs.promises.unlink(filepath);

      const response = serviceHelper.createSuccessMessage('File Removed');
      res.json(response);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function fluxShareRemoveFolder(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder;
      if (!folder) {
        throw new Error('No folder specified');
      }

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;
      await fs.promises.rmdir(filepath);

      const response = serviceHelper.createSuccessMessage('Folder Removed');
      res.json(response);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function fluxShareGetFolder(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;
      const options = {
        withFileTypes: false,
      };
      const files = await fs.promises.readdir(filepath, options);
      const filesWithDetails = [];
      let sharedFiles = await fluxShareSharedFiles().catch((error) => {
        log.error(error);
      });
      sharedFiles = sharedFiles || [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const fileStats = await fs.promises.lstat(`${filepath}/${file}`);
        let fileURI = encodeURIComponent(file);
        if (folder) {
          fileURI = encodeURIComponent(`${folder}/${file}`);
        }
        const fileShared = sharedFiles.find((sharedfile) => sharedfile.name === fileURI);
        let shareToken;
        let shareFile;
        if (fileShared) {
          shareToken = fileShared.token;
          shareFile = fileShared.name;
        }
        const isDirectory = fileStats.isDirectory();
        const isFile = fileStats.isFile();
        const isSymbolicLink = fileStats.isSymbolicLink();
        let fileFolderSize = fileStats.size;
        if (isDirectory) {
          fileFolderSize = getFluxShareSpecificFolderSize(`${filepath}/${file}`);
        }
        const detailedFile = {
          name: file,
          size: fileFolderSize, // bytes
          isDirectory,
          isFile,
          isSymbolicLink,
          createdAt: fileStats.birthtime,
          modifiedAt: fileStats.mtime,
          shareToken,
          shareFile,
        };
        filesWithDetails.push(detailedFile);
      }
      const resultsResponse = serviceHelper.createDataMessage(filesWithDetails);
      res.json(resultsResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function fluxShareCreateFolder(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;

      await fs.promises.mkdir(filepath);

      const resultsResponse = serviceHelper.createSuccessMessage('Folder Created');
      res.json(resultsResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function fluxShareFileExists(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;
      let fileExists = true;
      try {
        await fs.promises.access(filepath, fs.constants.F_OK); // check folder exists and write ability
      } catch (error) {
        fileExists = false;
      }
      const data = {
        fileExists,
      };
      const resultsResponse = serviceHelper.createDataMessage(data);
      res.json(resultsResponse);
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
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function getSpaceAvailableForFluxShare() {
  const dfAsync = util.promisify(df);
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

  // now we know that most likely there is a space available. IF user does not have his own stuff on the node or space may be sharded accross hdds.
  let totalSpace = 0;
  okVolumes.forEach((volume) => {
    totalSpace += serviceHelper.ensureNumber(volume.size);
  });
  // space that is further reserved for flux os and that will be later substracted from available space. Max 30.
  const tier = await nodeTier();
  const lockedSpaceOnNode = config.fluxSpecifics.hdd[tier];

  const extraSpaceOnNode = totalSpace - lockedSpaceOnNode > 0 ? totalSpace - lockedSpaceOnNode : 0; // shall always be above 0. Put precaution to place anyway
  // const extraSpaceOnNode = availableSpace - lockedSpaceOnNode > 0 ? availableSpace - lockedSpaceOnNode : 0;
  const spaceAvailableForFluxShare = 2 + extraSpaceOnNode;
  return spaceAvailableForFluxShare;
}

async function fluxShareStorageStats(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      const spaceAvailableForFluxShare = await getSpaceAvailableForFluxShare();
      let spaceUsedByFluxShare = getFluxShareSize();
      spaceUsedByFluxShare = Number(spaceUsedByFluxShare.toFixed(6));
      const data = {
        available: spaceAvailableForFluxShare - spaceUsedByFluxShare,
        used: spaceUsedByFluxShare,
        total: spaceAvailableForFluxShare,
      };
      const resultsResponse = serviceHelper.createDataMessage(data);
      res.json(resultsResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function fluxShareUpload(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (!authorized) {
      throw new Error('Unauthorized. Access denied.');
    }
    let { folder } = req.params;
    folder = folder || req.query.folder || '';
    if (folder) {
      folder += '/';
    }
    const dirpath = path.join(__dirname, '../../../');
    const uploadDir = `${dirpath}ZelApps/ZelShare/${folder}`;
    const options = {
      multiples: true,
      uploadDir,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5gb
      hash: true,
      keepExtensions: true,
    };
    const spaceAvailableForFluxShare = await getSpaceAvailableForFluxShare();
    let spaceUsedByFluxShare = getFluxShareSize();
    spaceUsedByFluxShare = Number(spaceUsedByFluxShare.toFixed(6));
    const available = spaceAvailableForFluxShare - spaceUsedByFluxShare;
    if (available <= 0) {
      throw new Error('FluxShare Storage is full');
    }
    // eslint-disable-next-line no-bitwise
    await fs.promises.access(uploadDir, fs.constants.F_OK | fs.constants.W_OK); // check folder exists and write ability
    const form = formidable(options);
    form.parse(req)
      .on('fileBegin', (name, file) => {
        try {
          res.write(serviceHelper.ensureString(file.name));
          const filepath = `${dirpath}ZelApps/ZelShare/${folder}${file.name}`;
          // eslint-disable-next-line no-param-reassign
          file.path = filepath;
        } catch (error) {
          log.error(error);
        }
      })
      .on('progress', (bytesReceived, bytesExpected) => {
        try {
          // console.log('PROGRESS');
          res.write(serviceHelper.ensureString([bytesReceived, bytesExpected]));
        } catch (error) {
          log.error(error);
        }
      })
      .on('field', (name, field) => {
        console.log('Field', name, field);
        // console.log(name);
        // console.log(field);
        // res.write(serviceHelper.ensureString(field));
      })
      .on('file', (name, file) => {
        try {
          // console.log('Uploaded file', name, file);
          res.write(serviceHelper.ensureString(file));
        } catch (error) {
          log.error(error);
        }
      })
      .on('aborted', () => {
        console.error('Request aborted by the user');
      })
      .on('error', (error) => {
        log.error(error);
        const errorResponse = serviceHelper.createErrorMessage(
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
      })
      .on('end', () => {
        try {
          res.end();
        } catch (error) {
          log.error(error);
        }
      });
  } catch (error) {
    log.error(error);
    if (res) {
      // res.set('Connection', 'close');
      try {
        res.connection.destroy();
      } catch (e) {
        log.error(e);
      }
    }
  }
}

module.exports = {
  dockerListContainers,
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
  messageHash,
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
  checkSynced,
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
  whitelistedRepositories,
  whitelistedZelIDs,
  fluxShareDownloadFile,
  fluxShareGetFolder,
  fluxShareCreateFolder,
  fluxShareUpload,
  fluxShareRemoveFile,
  fluxShareRemoveFolder,
  fluxShareFileExists,
  fluxShareStorageStats,
  fluxShareUnshareFile,
  fluxShareShareFile,
  fluxShareGetSharedFiles,
  fluxShareRename,
  fluxShareDownloadFolder,
};

// reenable min connections for registrations/updates before main release
