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
const zelfluxCommunication = require('./zelfluxCommunication');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fluxDirPath = path.join(__dirname, '../../../');
const zelappsFolder = `${fluxDirPath}ZelApps/`;

const cmdAsync = util.promisify(nodecmd.get);
const crontabLoad = util.promisify(systemcrontab.load);

const docker = new Docker();

const scannedHeightCollection =
  config.database.zelcash.collections.scannedHeight;
const zelappsHashesCollection =
  config.database.zelcash.collections.zelappsHashes;

const localZelAppsInformation =
  config.database.zelappslocal.collections.zelappsInformation;
const globalZelAppsMessages =
  config.database.zelappsglobal.collections.zelappsMessages;
const globalZelAppsInformation =
  config.database.zelappsglobal.collections.zelappsInformation;
const globalZelAppsTempMessages =
  config.database.zelappsglobal.collections.zelappsTemporaryMessages;
const globalZelAppsLocations =
  config.database.zelappsglobal.collections.zelappsLocations;

// default cache
const LRUoptions = {
  max: 500, // store 500 values, we shall not have more values at any period
  maxAge: 1000 * 60 * 10, // 10 minutes
};
const myCache = new LRU(LRUoptions);

let removalInProgress = false;

function getZelAppIdentifier(zelappName) {
  // this id is used for volumes, docker names so we know it reall belongs to
  // zelflux
  if (zelappName.startsWith('zel')) {
    return zelappName;
  }
  return `zel${zelappName}`;
}

function getZelAppDockerNameIdentifier(zelappName) {
  // this id is used for volumes, docker names so we know it reall belongs to
  // zelflux
  const name = getZelAppIdentifier(zelappName);
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
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);
  const response = await dockerContainer.inspect();
  return response;
}

async function dockerContainerStats(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
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
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
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
    const myContainer = containers.find(
      (container) =>
        container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
        container.Id === idOrName
    );
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
            throw new Error(
              'An error obtaining log data of an application has occured'
            );
          }
        }
      }
    );
  } catch (error) {
    callback(error);
  }
}

async function dockerContainerLogs(idOrName, lines) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
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

async function zelAppPull(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function listRunningZelApps(req, res) {
  try {
    let zelapps = await dockerListContainers(false);
    if (zelapps.length > 0) {
      zelapps = zelapps.filter(
        (zelapp) => zelapp.Names[0].substr(1, 3) === 'zel'
      );
    }
    const modifiedZelApps = [];
    zelapps.forEach((zelapp) => {
      // eslint-disable-next-line no-param-reassign
      delete zelapp.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete zelapp.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete zelapp.Mounts;
      modifiedZelApps.push(zelapp);
    });
    const zelappsResponse = serviceHelper.createDataMessage(modifiedZelApps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

// shall be identical to installedZelApps. But this is docker response
async function listAllZelApps(req, res) {
  try {
    let zelapps = await dockerListContainers(true);
    if (zelapps.length > 0) {
      zelapps = zelapps.filter(
        (zelapp) => zelapp.Names[0].substr(1, 3) === 'zel'
      );
    }
    const modifiedZelApps = [];
    zelapps.forEach((zelapp) => {
      // eslint-disable-next-line no-param-reassign
      delete zelapp.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete zelapp.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete zelapp.Mounts;
      modifiedZelApps.push(zelapp);
    });
    const zelappsResponse = serviceHelper.createDataMessage(modifiedZelApps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function listZelAppsImages(req, res) {
  try {
    const zelapps = await dockerListImages();
    const zelappsResponse = serviceHelper.createDataMessage(zelapps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelnodeTier() {
  // get our collateral information to decide if app specifications are basic,
  // super, bamf getzlenodestatus.collateral
  const zelnodeStatus = await zelcashService.getZelNodeStatus();
  if (zelnodeStatus.status === 'error') {
    throw zelnodeStatus.data;
  }
  const collateralInformation = getCollateralInfo(
    zelnodeStatus.data.collateral
  );
  // get transaction information about collateralInformation.txhash
  const request = {
    params: {
      txid: collateralInformation.txhash,
      verbose: 1,
    },
  };
  const txInformation = await zelcashService.getRawTransaction(request);
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
  throw new Error('Unrecognised ZelNode tier');
}

async function zelAppDockerCreate(zelAppSpecifications) {
  const options = {
    Image: zelAppSpecifications.repotag,
    name: getZelAppIdentifier(zelAppSpecifications.name),
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: zelAppSpecifications.commands,
    Env: zelAppSpecifications.enviromentParameters,
    Tty: false,
    ExposedPorts: {
      [`${zelAppSpecifications.port.toString()}/tcp`]: {},
      [`${zelAppSpecifications.containerPort.toString()}/tcp`]: {},
    },
    HostConfig: {
      NanoCPUs: zelAppSpecifications.cpu * 1e9,
      Memory: zelAppSpecifications.ram * 1024 * 1024,
      Binds: [
        `${zelappsFolder + getZelAppIdentifier(zelAppSpecifications.name)}:${
          zelAppSpecifications.containerData
        }`,
      ],
      Ulimits: [
        {
          Name: 'nofile',
          Soft: 100000,
          Hard: 100000, // 1048576
        },
      ],
      PortBindings: {
        [`${zelAppSpecifications.containerPort.toString()}/tcp`]: [
          {
            HostPort: zelAppSpecifications.port.toString(),
          },
        ],
      },
      RestartPolicy: {
        Name: 'unless-stopped',
      },
      NetworkMode: 'zelfluxDockerNetwork',
    },
  };

  const zelapp = await docker.createContainer(options).catch((error) => {
    log.error(error);
    throw error;
  });
  return zelapp;
}

async function zelAppDockerStart(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.start(); // may throw
  return `ZelApp ${idOrName} successfully started.`;
}

async function zelAppDockerStop(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.stop();
  return `ZelApp ${idOrName} successfully stopped.`;
}

async function zelAppDockerRestart(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.restart();
  return `ZelApp ${idOrName} successfully restarted.`;
}

async function zelAppDockerKill(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.kill();
  return `ZelApp ${idOrName} successfully killed.`;
}

async function zelAppDockerRemove(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.remove();
  return `ZelApp ${idOrName} successfully removed.`;
}

async function zelAppDockerImageRemove(idOrName) {
  // container ID or name
  const dockerImage = docker.getImage(idOrName);

  await dockerImage.remove();
  return `ZelApp ${idOrName} image successfully removed.`;
}

async function zelAppDockerPause(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.pause();
  return `ZelApp ${idOrName} successfully paused.`;
}

async function zelAppDockerUnpase(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.unpause();
  return `ZelApp ${idOrName} successfully unpaused.`;
}

async function zelAppDockerTop(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find(
    (container) =>
      container.Names[0] === getZelAppDockerNameIdentifier(idOrName) ||
      container.Id === idOrName
  );
  const dockerContainer = docker.getContainer(myContainer.Id);

  const processes = await dockerContainer.top();
  return processes;
}

async function zelAppStart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const zelappRes = await zelAppDockerStart(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppStop(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const zelappRes = await zelAppDockerStop(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppRestart(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const zelappRes = await zelAppDockerRestart(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppKill(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const zelappRes = await zelAppDockerKill(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppPause(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const zelappRes = await zelAppDockerPause(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppUnpause(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    const zelappRes = await zelAppDockerUnpase(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppTop(req, res) {
  try {
    // List processes running inside a container
    let { appname } = req.params;
    appname = appname || req.query.appname;

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }

    if (!appname) {
      throw new Error('No ZelApp specified');
    }

    const zelappRes = await zelAppDockerTop(appname);

    const zelappResponse = serviceHelper.createDataMessage(zelappRes);
    return res ? res.json(zelappResponse) : zelappResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelAppLog(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    let { lines } = req.params;
    lines = lines || req.query.lines || 'all';

    if (!appname) {
      throw new Error('No ZelApp specified');
    }
    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function zelAppLogStream(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No ZelApp specified');
    }
    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (authorized === true) {
      res.setHeader('Content-Type', 'application/json');
      dockerContainerLogsStream(appname, res, (error) => {
        if (error) {
          log.error(error);
          const errorResponse = serviceHelper.createErrorMessage(
            error.message || error,
            error.name,
            error.code
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function zelAppInspect(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No ZelApp specified');
    }
    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (authorized === true) {
      const response = await dockerContainerInspect(appname);
      const zelappResponse = serviceHelper.createDataMessage(response);
      res.json(zelappResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelAppStats(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No ZelApp specified');
    }
    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (authorized === true) {
      const response = await dockerContainerStats(appname);
      const zelappResponse = serviceHelper.createDataMessage(response);
      res.json(zelappResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelAppChanges(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No ZelApp specified');
    }
    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
    if (authorized === true) {
      const response = await dockerContainerChanges(appname);
      const zelappResponse = serviceHelper.createDataMessage(response);
      res.json(zelappResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelAppExec(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);

      if (!processedBody.appname) {
        throw new Error('No ZelApp specified');
      }

      if (!processedBody.cmd) {
        throw new Error('No command specified');
      }

      const authorized = await serviceHelper.verifyPrivilege(
        'appowner',
        req,
        processedBody.appname
      );
      if (authorized === true) {
        let cmd = processedBody.cmd || [];
        let env = processedBody.env || [];

        cmd = serviceHelper.ensureObject(cmd);
        env = serviceHelper.ensureObject(env);

        const containers = await dockerListContainers(true);
        const myContainer = containers.find(
          (container) =>
            container.Names[0] ===
              getZelAppDockerNameIdentifier(processedBody.appname) ||
            container.Id === processedBody.appname
        );
        const dockerContainer = docker.getContainer(myContainer.Id);

        res.setHeader('Content-Type', 'application/json');

        dockerContainerExec(dockerContainer, cmd, env, res, (error) => {
          if (error) {
            log.error(error);
            const errorResponse = serviceHelper.createErrorMessage(
              error.message || error,
              error.name,
              error.code
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
        error.code
      );
      res.json(errorResponse);
    }
  });
}

async function createFluxNetwork() {
  // check if zelfluxDockerNetwork exists
  const fluxNetworkOptions = {
    Name: 'zelfluxDockerNetwork',
    IPAM: {
      Config: [
        {
          Subnet: '172.16.0.0/16',
          Gateway: '172.16.0.1',
        },
      ],
    },
  };
  let fluxNetworkExists = true;
  const networkID = docker.getNetwork(fluxNetworkOptions.Name);
  await dockerNetworkInspect(networkID).catch(() => {
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

async function createZelFluxNetwork(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    const dockerRes = await createFluxNetwork();
    const response = serviceHelper.createDataMessage(dockerRes);
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res.json(errorResponse);
  }
}

async function zelFluxUsage(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelcash.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(
      database,
      scannedHeightCollection,
      query,
      projection
    );
    if (!result) {
      log.error('Scanning not initiated');
    }
    let explorerHeight = 999999999;
    if (result) {
      explorerHeight =
        serviceHelper.ensureNumber(result.generalScannedHeight) || 999999999;
    }
    const zelcashGetInfo = await zelcashService.getInfo();
    let zelcashHeight = 1;
    if (zelcashGetInfo.status === 'success') {
      zelcashHeight = zelcashGetInfo.data.blocks;
    } else {
      log.error(zelcashGetInfo.data.message || zelcashGetInfo.data);
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
    if (explorerHeight < zelcashHeight - 5) {
      // Initial scanning is in progress
      cpuUsage += 0.5;
    } else if (explorerHeight < zelcashHeight) {
      cpuUsage += 0.25;
    } else {
      cpuUsage += 0.1; // normal load
    }
    cpuUsage *= cpuCores;

    // load usedResources of zelapps
    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { cpu: { $gte: 0 } };
    const zelappsProjection = {
      projection: {
        _id: 0,
        cpu: 1,
      },
    };
    const zelappsResult = await serviceHelper.findInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    let zelAppsCpusLocked = 0;
    zelappsResult.forEach((zelapp) => {
      zelAppsCpusLocked += serviceHelper.ensureNumber(zelapp.cpu) || 0;
    });

    cpuUsage += zelAppsCpusLocked;
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
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelappsResources(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { cpu: { $gte: 0 } };
    const zelappsProjection = {
      projection: {
        _id: 0,
        cpu: 1,
        ram: 1,
        hdd: 1,
      },
    };
    const zelappsResult = await serviceHelper.findInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    let zelAppsCpusLocked = 0;
    let zelAppsRamLocked = 0;
    let zelAppsHddLocked = 0;
    zelappsResult.forEach((zelapp) => {
      zelAppsCpusLocked += serviceHelper.ensureNumber(zelapp.cpu) || 0;
      zelAppsRamLocked += serviceHelper.ensureNumber(zelapp.ram) || 0;
      zelAppsHddLocked += serviceHelper.ensureNumber(zelapp.hdd) || 0;
    });
    const zelappsUsage = {
      zelAppsCpusLocked,
      zelAppsRamLocked,
      zelAppsHddLocked,
    };
    const response = serviceHelper.createDataMessage(zelappsUsage);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function createZelAppVolume(zelAppSpecifications, res) {
  const dfAsync = util.promisify(df);
  const zelappId = getZelAppIdentifier(zelAppSpecifications.name);

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
    if (
      volume.filesystem.includes('/dev/') &&
      !volume.filesystem.includes('loop') &&
      !volume.mount.includes('boot')
    ) {
      okVolumes.push(volume);
    } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
      okVolumes.push(volume);
    }
  });

  const tier = await zelnodeTier();
  const totalSpaceOnNode = config.fluxSpecifics.hdd[tier];
  const useableSpaceOnNode =
    totalSpaceOnNode - config.lockedSystemResources.hdd;
  const resourcesLocked = await zelappsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error(
      'Unable to obtain locked system resources by ZelApps. Aborting.'
    );
  }
  const hddLockedByApps = resourcesLocked.data.zelAppsHddLocked;
  const availableSpaceForZelApps =
    useableSpaceOnNode - hddLockedByApps + zelAppSpecifications.hdd; // because our application is already accounted
  // in locked resources
  // bigger or equal so we have the 1 gb free...
  if (zelAppSpecifications.hdd >= availableSpaceForZelApps) {
    throw new Error('Insufficient space on ZelNode to spawn an application');
  }
  // now we know that most likely there is a space available. IF user does not
  // have his own stuff on the node or space may be sharded accross hdds.
  let usedSpace = 0;
  let availableSpace = 0;
  okVolumes.forEach((volume) => {
    usedSpace += serviceHelper.ensureNumber(volume.used);
    availableSpace += serviceHelper.ensureNumber(volume.available);
  });
  // space that is further reserved for zelflux os and that will be later
  // substracted from available space. Max 30.
  const zelfluxSystemReserve = 30 - usedSpace > 0 ? 30 - usedSpace : 0;
  const totalAvailableSpaceLeft = availableSpace - zelfluxSystemReserve;
  if (zelAppSpecifications.hdd >= totalAvailableSpaceLeft) {
    // sadly user free space is not enough for this application
    throw new Error(
      'Insufficient space on ZelNode. Space is already assigned to system files'
    );
  }

  // check if space is not sharded in some bad way. Always count the
  // zelfluxSystemReserve
  let useThisVolume = null;
  const totalVolumes = okVolumes.length;
  for (let i = 0; i < totalVolumes; i += 1) {
    // check available volumes one by one. If a sufficient is found. Use this
    // one.
    if (
      okVolumes[i].available >
      zelAppSpecifications.hdd + zelfluxSystemReserve
    ) {
      useThisVolume = okVolumes[i];
      break;
    }
  }
  if (!useThisVolume) {
    // no useable volume has such a big space for the app
    throw new Error('Insufficient space on ZelNode. No useable volume found.');
  }

  // now we know there is a space and we have a volum we can operate with. Let's
  // do volume magic
  const searchSpace2 = {
    status: 'Space found',
  };
  log.info(searchSpace2);
  if (res) {
    res.write(serviceHelper.ensureString(searchSpace2));
  }

  try {
    const allocateSpace = {
      status: 'Allocating space, this may take a while...',
    };
    log.info(allocateSpace);
    if (res) {
      res.write(serviceHelper.ensureString(allocateSpace));
    }
    // space hdd * 10, thats why 0 at the end. As we have 100mb bs.
    let execDD = `sudo dd if=/dev/zero of=${useThisVolume.mount}/${zelappId}FLUXFSVOL bs=107374182 count=${zelAppSpecifications.hdd}0`; // eg /mnt/sthMounted/zelappTEMP
    if (useThisVolume.mount === '/') {
      execDD = `sudo dd if=/dev/zero of=${fluxDirPath}appvolumes/${zelappId}FLUXFSVOL bs=107374182 count=${zelAppSpecifications.hdd}0`; // if root mount then temp file is /tmp/zelappTEMP
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
    let execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}/${zelappId}FLUXFSVOL`;
    if (useThisVolume.mount === '/') {
      execFS = `sudo mke2fs -t ext4 ${fluxDirPath}appvolumes/${zelappId}FLUXFSVOL`;
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
    const execDIR = `sudo mkdir -p ${zelappsFolder + zelappId}`;
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
    let execMount = `sudo mount -o loop ${
      useThisVolume.mount
    }/${zelappId}FLUXFSVOL ${zelappsFolder + zelappId}`;
    if (useThisVolume.mount === '/') {
      execMount = `sudo mount -o loop ${fluxDirPath}appvolumes/${zelappId}FLUXFSVOL ${
        zelappsFolder + zelappId
      }`;
    }
    await cmdAsync(execMount);
    const mountingStatus2 = {
      status: 'Volume mounted',
    };
    log.info(execMount);
    if (res) {
      res.write(serviceHelper.ensureString(mountingStatus2));
    }

    const spaceVerification = {
      status: 'Beginning space verification. This may take a while...',
    };
    log.info(spaceVerification);
    if (res) {
      res.write(serviceHelper.ensureString(spaceVerification));
    }
    const execVerif = `sudo dd if=/dev/zero of=${
      zelappsFolder + zelappId
    }/${zelappId}VERTEMP bs=96636763 count=${zelAppSpecifications.hdd}0`; // 90%
    await cmdAsync(execVerif);
    const spaceVerification2 = {
      status: 'Verification written...',
    };
    log.info(spaceVerification2);
    if (res) {
      res.write(serviceHelper.ensureString(spaceVerification2));
    }

    const finaliseSpace = {
      status: 'Finalising space assignment',
    };
    log.info(finaliseSpace);
    if (res) {
      res.write(serviceHelper.ensureString(finaliseSpace));
    }
    const execFinal = `sudo rm -rf ${
      zelappsFolder + zelappId
    }/${zelappId}VERTEMP`;
    await cmdAsync(execFinal);
    const finaliseSpace2 = {
      status: `Space for ZelApp ${zelAppSpecifications.name} created and assigned.`,
    };
    log.info(finaliseSpace2);
    if (res) {
      res.write(serviceHelper.ensureString(finaliseSpace2));
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
      if (job.comment() === zelappId) {
        exists = true;
      }
      if (!job || !job.isValid()) {
        // remove the job as its invalid anyway
        crontab.remove(job);
      }
    });
    if (!exists) {
      const job = crontab.create(execMount, '@reboot', zelappId);
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
    const message = serviceHelper.createSuccessMessage(
      'ZelApp volume creation completed.'
    );
    return message;
  } catch (error) {
    // delete allocation, then uninstall as cron may not have been set
    const cleaningRemoval = {
      status: 'ERROR OCCURED: Pre-removal cleaning...',
    };
    log.info(cleaningRemoval);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningRemoval));
    }
    let execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}/${zelappId}FLUXFSVOL`;
    if (useThisVolume.mount === '/') {
      execRemoveAlloc = `sudo rm -rf ${fluxDirPath}appvolumes/${zelappId}FLUXFSVOL`;
    }
    await cmdAsync(execRemoveAlloc);
    const execFinal = `sudo rm -rf ${
      zelappsFolder + zelappId
    }/${zelappId}VERTEMP`;
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
async function removeZelAppLocally(
  zelapp,
  res,
  force = false,
  endResponse = true
) {
  try {
    // remove zelapp from local machine.
    // find in database, stop zelapp, remove container, close port delete data
    // associated on system, remove from database we want to remove the image as
    // well (repotag) what if other container uses the same image -> then it
    // shall result in an error so ok anyway
    removalInProgress = true;
    if (!zelapp) {
      throw new Error('No ZelApp specified');
    }

    const zelappId = getZelAppIdentifier(zelapp);

    // first find the zelAppSpecifications in our database.
    // connect to mongodb
    const dbopen = serviceHelper.databaseConnection();

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const database = dbopen.db(config.database.zelappsglobal.database);

    const zelappsQuery = { name: zelapp };
    const zelappsProjection = {};
    let zelAppSpecifications = await serviceHelper.findOneInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    if (!zelAppSpecifications) {
      if (!force) {
        throw new Error('ZelApp not found');
      }
      // get it from global Specifications
      zelAppSpecifications = await serviceHelper.findOneInDatabase(
        database,
        globalZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      );
      if (!zelAppSpecifications) {
        // get it from locally available Specifications
        // eslint-disable-next-line no-use-before-define
        const allZelApps = await availableZelApps();
        zelAppSpecifications = allZelApps.find((app) => app.name === zelapp);
        // get it from permanent messages
        if (!zelAppSpecifications) {
          const query = {};
          const projection = { projection: { _id: 0 } };
          const messages = await serviceHelper.findInDatabase(
            database,
            globalZelAppsMessages,
            query,
            projection
          );
          const appMessages = messages.filter(
            (message) => message.zelAppSpecifications.name === zelapp
          );
          let currentSpecifications;
          appMessages.forEach((message) => {
            if (
              !currentSpecifications ||
              message.height > currentSpecifications.height
            ) {
              currentSpecifications = message;
            }
          });
          if (currentSpecifications && currentSpecifications.height) {
            zelAppSpecifications = currentSpecifications.zelAppSpecifications;
          }
        }
      }
    }

    // simplifying ignore error messages for now
    const stopStatus = {
      status: 'Stopping ZelApp...',
    };
    log.info(stopStatus);
    if (res) {
      res.write(serviceHelper.ensureString(stopStatus));
    }
    await zelAppDockerStop(zelappId).catch((error) => {
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code
      );
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
      }
    });
    const stopStatus2 = {
      status: 'ZelApp stopped',
    };
    log.info(stopStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(stopStatus2));
    }

    const removeStatus = {
      status: 'Removing ZelApp container...',
    };
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
    }
    await zelAppDockerRemove(zelappId).catch((error) => {
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code
      );
      log.error(errorResponse);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
      }
    });
    const removeStatus2 = {
      status: 'ZelApp container removed',
    };
    log.info(removeStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus2));
    }

    const imageStatus = {
      status: 'Removing ZelApp image...',
    };
    log.info(imageStatus);
    if (res) {
      res.write(serviceHelper.ensureString(imageStatus));
    }
    await zelAppDockerImageRemove(zelAppSpecifications.repotag).catch(
      (error) => {
        const errorResponse = serviceHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code
        );
        log.error(errorResponse);
        if (res) {
          res.write(serviceHelper.ensureString(errorResponse));
        }
      }
    );
    const imageStatus2 = {
      status: 'ZelApp image operations done',
    };
    log.info(imageStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(imageStatus2));
    }

    const portStatus = {
      status: 'Denying ZelApp port...',
    };
    log.info(portStatus);
    if (res) {
      res.write(serviceHelper.ensureString(portStatus));
    }
    await zelfluxCommunication.denyPort(zelAppSpecifications.port);
    const portStatus2 = {
      status: 'Port denied',
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
    const execUnmount = `sudo umount ${zelappsFolder + zelappId}`;
    await cmdAsync(execUnmount)
      .then(() => {
        const unmuontStatus2 = {
          status: 'Volume unmounted',
        };
        log.info(unmuontStatus2);
        if (res) {
          res.write(serviceHelper.ensureString(unmuontStatus2));
        }
      })
      .catch((e) => {
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
    const execDelete = `sudo rm -rf ${zelappsFolder + zelappId}`;
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
        if (job.comment() === zelappId) {
          jobToRemove = job;
          // find the command that tells us where the actual fsvol is;
          const command = job.command();
          const cmdsplit = command.split(' ');
          // eslint-disable-next-line prefer-destructuring
          volumepath = cmdsplit[4]; // sudo mount -o loop /home/abcapp2TEMP
          // /root/zelflux/ZelApps/abcapp2 is an example
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
    await serviceHelper.findOneAndDeleteInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    const databaseStatus2 = {
      status: 'Database cleaned',
    };
    log.info(databaseStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus2));
    }

    const zelappRemovalResponse = serviceHelper.createDataMessage(
      `ZelApp ${zelapp} was successfuly removed`
    );
    log.info(zelappRemovalResponse);
    if (res) {
      res.write(serviceHelper.ensureString(zelappRemovalResponse));
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
      error.code
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (endResponse) {
        res.end();
      }
    }
  }
}

// removal WITHOUT storage deletion and catches. For app reload. Only for
// internal useage. We throwing in functinos using this
async function softRemoveZelAppLocally(zelapp, res) {
  // remove zelapp from local machine.
  // find in database, stop zelapp, remove container, close port, remove from
  // database we want to remove the image as well (repotag) what if other
  // container uses the same image -> then it shall result in an error so ok
  // anyway
  if (!zelapp) {
    throw new Error('No ZelApp specified');
  }

  const zelappId = getZelAppIdentifier(zelapp);

  // first find the zelAppSpecifications in our database.
  // connect to mongodb
  const dbopen = serviceHelper.databaseConnection();

  const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);

  const zelappsQuery = { name: zelapp };
  const zelappsProjection = {};
  const zelAppSpecifications = await serviceHelper.findOneInDatabase(
    zelappsDatabase,
    localZelAppsInformation,
    zelappsQuery,
    zelappsProjection
  );
  if (!zelAppSpecifications) {
    throw new Error('ZelApp not found');
  }

  // simplifying ignore error messages for now
  const stopStatus = {
    status: 'Stopping ZelApp...',
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
  }

  await zelAppDockerStop(zelappId);

  const stopStatus2 = {
    status: 'ZelApp stopped',
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
  }

  const removeStatus = {
    status: 'Removing ZelApp container...',
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
  }

  await zelAppDockerRemove(zelappId);

  const removeStatus2 = {
    status: 'ZelApp container removed',
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
  }

  const imageStatus = {
    status: 'Removing ZelApp image...',
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
  }
  await zelAppDockerImageRemove(zelAppSpecifications.repotag).catch((error) => {
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
    }
  });
  const imageStatus2 = {
    status: 'ZelApp image operations done',
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
  }

  const portStatus = {
    status: 'Denying ZelApp port...',
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
  }
  await zelfluxCommunication.denyPort(zelAppSpecifications.port);
  const portStatus2 = {
    status: 'Port denied',
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
  await serviceHelper.findOneAndDeleteInDatabase(
    zelappsDatabase,
    localZelAppsInformation,
    zelappsQuery,
    zelappsProjection
  );
  const databaseStatus2 = {
    status: 'Database cleaned',
  };
  log.info(databaseStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(databaseStatus2));
  }

  const zelappRemovalResponse = serviceHelper.createDataMessage(
    `ZelApp ${zelapp} was partially removed`
  );
  log.info(zelappRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(zelappRemovalResponse));
  }
}

async function removeZelAppLocallyApi(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    } else {
      // remove zelapp from local machine.
      // find in database, stop zelapp, remove container, close port delete data
      // associated on system, remove from database if other container uses the
      // same image -> then it shall result in an error so ok anyway
      let { appname } = req.params;
      appname = appname || req.query.appname;

      let { force } = req.params;
      force = force || req.query.force || false;
      force = serviceHelper.ensureBoolean(force);

      if (!appname) {
        throw new Error('No ZelApp specified');
      }

      res.setHeader('Content-Type', 'application/json');
      removeZelAppLocally(appname, res, force);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    res.json(errorResponse);
  }
}

async function checkZelAppRequirements(zelAppSpecs) {
  // ZelAppSpecs has hdd, cpu and ram assigned to correct tier
  const tier = await zelnodeTier();
  const resourcesLocked = await zelappsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error(
      'Unable to obtain locked system resources by ZelApps. Aborting.'
    );
  }

  const totalSpaceOnNode = config.fluxSpecifics.hdd[tier];
  const useableSpaceOnNode =
    totalSpaceOnNode - config.lockedSystemResources.hdd;
  const hddLockedByApps = resourcesLocked.data.zelAppsHddLocked;
  const availableSpaceForZelApps = useableSpaceOnNode - hddLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (zelAppSpecs.hdd >= availableSpaceForZelApps) {
    throw new Error('Insufficient space on ZelNode to spawn an application');
  }

  const totalCpuOnNode = config.fluxSpecifics.cpu[tier];
  const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
  const cpuLockedByApps = resourcesLocked.data.zelAppsCpusLocked * 10;
  const adjustedZelAppCpu = zelAppSpecs.cpu * 10;
  const availableCpuForZelApps = useableCpuOnNode - cpuLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (adjustedZelAppCpu >= availableCpuForZelApps) {
    throw new Error(
      'Insufficient CPU power on ZelNode to spawn an application'
    );
  }

  const totalRamOnNode = config.fluxSpecifics.ram[tier];
  const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
  const ramLockedByApps = resourcesLocked.data.zelAppsRamLocked;
  const availableRamForZelApps = useableRamOnNode - ramLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (zelAppSpecs.ram >= availableRamForZelApps) {
    throw new Error('Insufficient RAM on ZelNode to spawn an application');
  }
  return true;
}

async function registerZelAppLocally(zelAppSpecifications, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from zelapp messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    const zelappName = zelAppSpecifications.name;
    const precheckForInstallation = {
      status: 'Running initial checks for ZelApp...',
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

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { name: zelappName };
    const zelappsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if zelfluxDockerNetwork exists, if not create
    const fluxNetworkStatus = {
      status: 'Checking Flux network...',
    };
    log.info(fluxNetworkStatus);
    if (res) {
      res.write(serviceHelper.ensureString(fluxNetworkStatus));
    }
    const fluxNet = await createFluxNetwork();
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
    const zelappResult = await serviceHelper.findOneInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    if (zelappResult) {
      throw new Error('ZelApp already installed');
    }

    const checkParameters = {
      status: 'Checking ZelApp requirements...',
    };
    log.info(checkParameters);
    if (res) {
      res.write(serviceHelper.ensureString(checkParameters));
    }

    await checkZelAppRequirements(zelAppSpecifications);

    // prechecks done
    const zelAppInstallation = {
      status: 'Initiating ZelApp installation...',
    };
    log.info(zelAppInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(zelAppInstallation));
    }
    // register the zelapp
    await serviceHelper.insertOneToDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelAppSpecifications
    );

    // pull image
    // eslint-disable-next-line no-unused-vars
    dockerPullStream(
      zelAppSpecifications.repotag,
      res,
      async (error, dataLog) => {
        if (error) {
          const errorResponse = serviceHelper.createErrorMessage(
            error.message || error,
            error.name,
            error.code
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage(
            'Error occured. Initiating ZelApp removal'
          );
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeZelAppLocally(zelappName, res);
        } else {
          const pullStatus = {
            status: 'Pulling global ZelApp was successful',
          };
          if (res) {
            res.write(serviceHelper.ensureString(pullStatus));
          }

          const volumeOK = await createZelAppVolume(
            zelAppSpecifications,
            res
          ).catch((errr) => {
            const errorResponse = serviceHelper.createErrorMessage(
              errr.message || errr,
              errr.name,
              errr.code
            );
            log.error(errorResponse);
            if (res) {
              res.write(serviceHelper.ensureString(errorResponse));
            }

            const removeStatus = serviceHelper.createErrorMessage(
              'Error in volume assigning occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res);
          });

          if (!volumeOK) {
            return;
          }
          log.info(volumeOK);
          if (res) {
            res.write(serviceHelper.ensureString(volumeOK));
          }

          const createZelApp = {
            status: 'Creating local ZelApp',
          };
          log.info(createZelApp);
          if (res) {
            res.write(serviceHelper.ensureString(createZelApp));
          }

          const dockerCreated = await zelAppDockerCreate(
            zelAppSpecifications
          ).catch((e) => {
            const errorResponse = serviceHelper.createErrorMessage(
              e.message || e,
              e.name,
              e.code
            );
            log.error(errorResponse);
            if (res) {
              res.write(serviceHelper.ensureString(errorResponse));
            }
            const removeStatus = serviceHelper.createErrorMessage(
              'Error occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res);
          });
          if (!dockerCreated) {
            return;
          }
          const portStatusInitial = {
            status: 'Allowing ZelApp port...',
          };
          log.info(portStatusInitial);
          if (res) {
            res.write(serviceHelper.ensureString(portStatusInitial));
          }
          const portResponse = await zelfluxCommunication.allowPort(
            zelAppSpecifications.port
          );
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
            const removeStatus = serviceHelper.createErrorMessage(
              'Error occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res);
            return;
          }
          const startStatus = {
            status: 'Starting ZelApp...',
          };
          log.info(startStatus);
          if (res) {
            res.write(serviceHelper.ensureString(startStatus));
          }
          const zelapp = await zelAppDockerStart(
            getZelAppIdentifier(zelAppSpecifications.name)
          ).catch((error2) => {
            const errorResponse = serviceHelper.createErrorMessage(
              error2.message || error2,
              error2.name,
              error2.code
            );
            log.error(errorResponse);
            if (res) {
              res.write(serviceHelper.ensureString(errorResponse));
            }
            const removeStatus = serviceHelper.createErrorMessage(
              'Error occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res);
          });
          if (!zelapp) {
            return;
          }
          const zelappResponse = serviceHelper.createDataMessage(zelapp);
          log.info(zelappResponse);
          if (res) {
            res.write(serviceHelper.ensureString(zelappResponse));
            res.end();
          }
        }
      }
    );
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    }
  }
}

// register zelapp with volume already existing
async function softRegisterZelAppLocally(zelAppSpecifications, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from zelapp messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    const zelappName = zelAppSpecifications.name;
    const precheckForInstallation = {
      status: 'Running initial checks for ZelApp...',
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

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { name: zelappName };
    const zelappsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if zelfluxDockerNetwork exists, if not create
    const fluxNetworkStatus = {
      status: 'Checking Flux network...',
    };
    log.info(fluxNetworkStatus);
    if (res) {
      res.write(serviceHelper.ensureString(fluxNetworkStatus));
    }
    const fluxNet = await createFluxNetwork();
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
    const zelappResult = await serviceHelper.findOneInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    if (zelappResult) {
      throw new Error('ZelApp already installed');
    }

    const checkParameters = {
      status: 'Checking ZelApp requirements...',
    };
    log.info(checkParameters);
    if (res) {
      res.write(serviceHelper.ensureString(checkParameters));
    }

    await checkZelAppRequirements(zelAppSpecifications);

    // prechecks done
    const zelAppInstallation = {
      status: 'Initiating ZelApp installation...',
    };
    log.info(zelAppInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(zelAppInstallation));
    }
    // register the zelapp
    await serviceHelper.insertOneToDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelAppSpecifications
    );

    // pull image
    // eslint-disable-next-line no-unused-vars
    dockerPullStream(
      zelAppSpecifications.repotag,
      res,
      async (error, dataLog) => {
        if (error) {
          const errorResponse = serviceHelper.createErrorMessage(
            error.message || error,
            error.name,
            error.code
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage(
            'Error occured. Initiating ZelApp removal'
          );
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeZelAppLocally(zelappName, res, true);
        } else {
          const pullStatus = {
            status: 'Pulling global ZelApp was successful',
          };
          if (res) {
            res.write(serviceHelper.ensureString(pullStatus));
          }

          const createZelApp = {
            status: 'Creating local ZelApp',
          };
          log.info(createZelApp);
          if (res) {
            res.write(serviceHelper.ensureString(createZelApp));
          }

          const dockerCreated = await zelAppDockerCreate(
            zelAppSpecifications
          ).catch((e) => {
            const errorResponse = serviceHelper.createErrorMessage(
              e.message || e,
              e.name,
              e.code
            );
            log.error(errorResponse);
            if (res) {
              res.write(serviceHelper.ensureString(errorResponse));
            }
            const removeStatus = serviceHelper.createErrorMessage(
              'Error occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res, true);
          });
          if (!dockerCreated) {
            return;
          }
          const portStatusInitial = {
            status: 'Allowing ZelApp port...',
          };
          log.info(portStatusInitial);
          if (res) {
            res.write(serviceHelper.ensureString(portStatusInitial));
          }
          const portResponse = await zelfluxCommunication.allowPort(
            zelAppSpecifications.port
          );
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
            const removeStatus = serviceHelper.createErrorMessage(
              'Error occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res, true);
            return;
          }
          const startStatus = {
            status: 'Starting ZelApp...',
          };
          log.info(startStatus);
          if (res) {
            res.write(serviceHelper.ensureString(startStatus));
          }
          const zelapp = await zelAppDockerStart(
            getZelAppIdentifier(zelAppSpecifications.name)
          ).catch((error2) => {
            const errorResponse = serviceHelper.createErrorMessage(
              error2.message || error2,
              error2.name,
              error2.code
            );
            log.error(errorResponse);
            if (res) {
              res.write(serviceHelper.ensureString(errorResponse));
            }
            const removeStatus = serviceHelper.createErrorMessage(
              'Error occured. Initiating ZelApp removal'
            );
            log.info(removeStatus);
            if (res) {
              res.write(serviceHelper.ensureString(removeStatus));
            }
            removeZelAppLocally(zelappName, res, true);
          });
          if (!zelapp) {
            return;
          }
          const zelappResponse = serviceHelper.createDataMessage(zelapp);
          log.info(zelappResponse);
          if (res) {
            res.write(serviceHelper.ensureString(zelappResponse));
            res.end();
          }
        }
      }
    );
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    }
  }
}

function appPricePerMonth(dataForZelAppRegistration) {
  if (!dataForZelAppRegistration) {
    return new Error('Application specification not provided');
  }
  if (dataForZelAppRegistration.tiered) {
    const cpuTotalCount =
      dataForZelAppRegistration.cpubasic +
      dataForZelAppRegistration.cpusuper +
      dataForZelAppRegistration.cpubamf;
    const cpuPrice = cpuTotalCount * config.zelapps.price.cpu * 10;
    const cpuTotal = cpuPrice / 3;
    const ramTotalCount =
      dataForZelAppRegistration.rambasic +
      dataForZelAppRegistration.ramsuper +
      dataForZelAppRegistration.rambamf;
    const ramPrice = (ramTotalCount * config.zelapps.price.ram) / 100;
    const ramTotal = ramPrice / 3;
    const hddTotalCount =
      dataForZelAppRegistration.hddbasic +
      dataForZelAppRegistration.hddsuper +
      dataForZelAppRegistration.hddbamf;
    const hddPrice = hddTotalCount * config.zelapps.price.hdd;
    const hddTotal = hddPrice / 3;
    const totalPrice = cpuTotal + ramTotal + hddTotal;
    return Number(Math.ceil(totalPrice * 100) / 100);
  }
  const cpuTotal =
    dataForZelAppRegistration.cpu * config.zelapps.price.cpu * 10;
  const ramTotal =
    (dataForZelAppRegistration.ram * config.zelapps.price.ram) / 100;
  const hddTotal = dataForZelAppRegistration.hdd * config.zelapps.price.hdd;
  const totalPrice = cpuTotal + ramTotal + hddTotal;
  return Number(Math.ceil(totalPrice * 100) / 100);
}

function checkHWParameters(zelAppSpecs) {
  // check specs parameters. JS precision
  if (
    (zelAppSpecs.cpu * 10) % 1 !== 0 ||
    zelAppSpecs.cpu * 10 >
      config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu ||
    zelAppSpecs.cpu < 0.1
  ) {
    return new Error('CPU badly assigned');
  }
  if (
    zelAppSpecs.ram % 100 !== 0 ||
    zelAppSpecs.ram >
      config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram ||
    zelAppSpecs.ram < 100
  ) {
    return new Error('RAM badly assigned');
  }
  if (
    zelAppSpecs.hdd % 1 !== 0 ||
    zelAppSpecs.hdd >
      config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd ||
    zelAppSpecs.hdd < 1
  ) {
    return new Error('SSD badly assigned');
  }
  if (zelAppSpecs.tiered) {
    if (
      (zelAppSpecs.cpubasic * 10) % 1 !== 0 ||
      zelAppSpecs.cpubasic * 10 >
        config.fluxSpecifics.cpu.basic - config.lockedSystemResources.cpu ||
      zelAppSpecs.cpubasic < 0.1
    ) {
      return new Error('CPU for BASIC badly assigned');
    }
    if (
      zelAppSpecs.rambasic % 100 !== 0 ||
      zelAppSpecs.rambasic >
        config.fluxSpecifics.ram.basic - config.lockedSystemResources.ram ||
      zelAppSpecs.rambasic < 100
    ) {
      return new Error('RAM for BASIC badly assigned');
    }
    if (
      zelAppSpecs.hddbasic % 1 !== 0 ||
      zelAppSpecs.hddbasic >
        config.fluxSpecifics.hdd.basic - config.lockedSystemResources.hdd ||
      zelAppSpecs.hddbasic < 1
    ) {
      return new Error('SSD for BASIC badly assigned');
    }
    if (
      (zelAppSpecs.cpusuper * 10) % 1 !== 0 ||
      zelAppSpecs.cpusuper * 10 >
        config.fluxSpecifics.cpu.super - config.lockedSystemResources.cpu ||
      zelAppSpecs.cpusuper < 0.1
    ) {
      return new Error('CPU for SUPER badly assigned');
    }
    if (
      zelAppSpecs.ramsuper % 100 !== 0 ||
      zelAppSpecs.ramsuper >
        config.fluxSpecifics.ram.super - config.lockedSystemResources.ram ||
      zelAppSpecs.ramsuper < 100
    ) {
      return new Error('RAM for SUPER badly assigned');
    }
    if (
      zelAppSpecs.hddsuper % 1 !== 0 ||
      zelAppSpecs.hddsuper >
        config.fluxSpecifics.hdd.super - config.lockedSystemResources.hdd ||
      zelAppSpecs.hddsuper < 1
    ) {
      return new Error('SSD for SUPER badly assigned');
    }
    if (
      (zelAppSpecs.cpubamf * 10) % 1 !== 0 ||
      zelAppSpecs.cpubamf * 10 >
        config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu ||
      zelAppSpecs.cpubamf < 0.1
    ) {
      return new Error('CPU for BAMF badly assigned');
    }
    if (
      zelAppSpecs.rambamf % 100 !== 0 ||
      zelAppSpecs.rambamf >
        config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram ||
      zelAppSpecs.rambamf < 100
    ) {
      return new Error('RAM for BAMF badly assigned');
    }
    if (
      zelAppSpecs.hddbamf % 1 !== 0 ||
      zelAppSpecs.hddbamf >
        config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd ||
      zelAppSpecs.hddbamf < 1
    ) {
      return new Error('SSD for BAMF badly assigned');
    }
  }
  return true;
}

async function getZelAppsTemporaryMessages(req, res) {
  const db = serviceHelper.databaseConnection();

  const database = db.db(config.database.zelappsglobal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await serviceHelper
    .findInDatabase(database, globalZelAppsTempMessages, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
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

async function getZelAppsPermanentMessages(req, res) {
  const db = serviceHelper.databaseConnection();

  const database = db.db(config.database.zelappsglobal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await serviceHelper
    .findInDatabase(database, globalZelAppsMessages, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resultsResponse = serviceHelper.createDataMessage(results);
  res.json(resultsResponse);
}

async function getGlobalZelAppsSpecifications(req, res) {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.zelappsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await serviceHelper.findInDatabase(
      database,
      globalZelAppsInformation,
      query,
      projection
    );
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function availableZelApps(req, res) {
  // calls to global mongo db
  // simulate a similar response
  const zelapps = [
    {
      // zelapp specifications
      name: 'FoldingAtHomeB',
      description: 'Folding @ Home is cool :)',
      repotag: 'yurinnick/folding-at-home:latest',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      tiered: true,
      port: 30000,
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
      enviromentParameters: [
        `USER=${userconfig.initial.zelid}`,
        'TEAM=262156',
        'ENABLE_GPU=false',
        'ENABLE_SMP=true',
      ],
      commands: ['--allow', '0/0', '--web-allow', '0/0'],
      containerPort: 7396,
      containerData: '/config',
      hash: 'localappinstancehashABCDE', // hash of app message
      height: 0, // height of tx on which it was
    },
    {
      name: 'KadenaChainWebNode', // corresponds to docker name and this name
      // is stored in zelapps mongo database
      description:
        'Kadena is a fast, secure, and scalable blockchain using the Chainweb consensus protocol. ' +
        'Chainweb is a braided, parallelized Proof Of Work consensus mechanism that improves throughput and scalability in executing transactions on the blockchain while maintaining the security and integrity found in Bitcoin. ' +
        'The healthy information tells you if node is running. If you just installed the docker it can say unhealthy for almost 1 hour because on first run a bootstrap is downloaded and extracted to make your node sync faster before the node is started. ' +
        'Do not stop or restart the docker in the first hour after installation. To check if your kadena node is synced, when the app is healthy, go to running apps and press visit button on kadena and compare your node height with Kadena explorer. Thank you.',
      repotag: 'zelcash/kadena-chainweb-node:2.4',
      owner: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
      port: 30004,
      tiered: false,
      cpu: 2, // true resource registered for app. If not tiered only this is
      // available
      ram: 4000, // true resource registered for app
      hdd: 40, // true resource registered for app
      enviromentParameters: ['CHAINWEB_PORT=30004', 'LOGLEVEL=warn'],
      commands: [
        '/bin/bash',
        '-c',
        '(test -d /data/chainweb-db/0 && ./run-chainweb-node.sh) || (/chainweb/initialize-db.sh && ./run-chainweb-node.sh)',
      ],
      containerPort: 30004,
      containerData: '/data', // cannot be root todo in verification
      hash: 'localSpecificationsVersion4', // hash of app message
      height: 680000, // height of tx on which it was
    },
  ];

  const dataResponse = serviceHelper.createDataMessage(zelapps);
  return res ? res.json(dataResponse) : zelapps;
}

async function verifyAppHash(message) {
  /* message object
   * @param type string
   * @param version number
   * @param zelAppSpecifications object
   * @param hash string
   * @param timestamp number
   * @param signature string
   */
  const messToHash =
    message.type +
    message.version +
    JSON.stringify(message.zelAppSpecifications) +
    message.timestamp +
    message.signature;
  const messageHASH = await messageHash(messToHash);
  if (messageHASH !== message.hash) {
    throw new Error('Invalid ZelApp hash received!');
  }
  return true;
}

async function verifyZelAppMessageSignature(
  type,
  version,
  zelAppSpec,
  timestamp,
  signature
) {
  if (
    typeof zelAppSpec !== 'object' &&
    typeof timestamp !== 'number' &&
    typeof signature !== 'string' &&
    typeof version !== 'number' &&
    typeof type !== 'string'
  ) {
    throw new Error('Invalid ZelApp message specifications');
  }
  const messageToVerify =
    type + version + JSON.stringify(zelAppSpec) + timestamp;
  const isValidSignature = serviceHelper.verifyMessage(
    messageToVerify,
    zelAppSpec.owner,
    signature
  );
  if (isValidSignature !== true) {
    const errorMessage =
      isValidSignature === false
        ? 'Received signature is invalid or ZelApp specifications are not properly formatted'
        : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

async function verifyZelAppMessageUpdateSignature(
  type,
  version,
  zelAppSpec,
  timestamp,
  signature,
  zelappOwner
) {
  if (
    typeof zelAppSpec !== 'object' &&
    typeof timestamp !== 'number' &&
    typeof signature !== 'string' &&
    typeof version !== 'number' &&
    typeof type !== 'string'
  ) {
    throw new Error('Invalid ZelApp message specifications');
  }
  const messageToVerify =
    type + version + JSON.stringify(zelAppSpec) + timestamp;
  const isValidSignature = serviceHelper.verifyMessage(
    messageToVerify,
    zelappOwner,
    signature
  );
  if (isValidSignature !== true) {
    const errorMessage =
      isValidSignature === false
        ? 'Received signature does not correspond with ZelApp owner or ZelApp specifications are not properly formatted'
        : isValidSignature;
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
    const resDocker = await serviceHelper
      .axiosGet(
        `https://hub.docker.com/v2/repositories/${splittedRepo[0]}/tags/${splittedRepo[1]}`
      )
      .catch(() => {
        throw new Error(
          'Repository is not in valid format namespace/repository:tag'
        );
      });
    if (!resDocker) {
      throw new Error(
        'Unable to communicate with Docker Hub! Try again later.'
      );
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
    if (resDocker.data.full_size > config.zelapps.maxImageSize) {
      throw new Error('Docker image size is over Flux limit');
    }
  } else {
    throw new Error(
      'Repository is not in valid format namespace/repository:tag'
    );
  }
  return true;
}

async function checkWhitelistedRepository(repotag) {
  if (typeof repotag !== 'string') {
    throw new Error('Invalid repotag');
  }
  const splittedRepo = repotag.split(':');
  if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
    const resWhitelistRepo = await serviceHelper.axiosGet(
      'https://zel.network/project/zelflux/repositories.html'
    );

    if (!resWhitelistRepo) {
      throw new Error(
        'Unable to communicate with Zel Services! Try again later.'
      );
    }

    const repos = resWhitelistRepo.data;
    const whitelisted = repos.includes(repotag);
    if (!whitelisted) {
      throw new Error(
        'Repository is not whitelisted. Please contact Zel Team.'
      );
    }
  } else {
    throw new Error(
      'Repository is not in valid format namespace/repository:tag'
    );
  }
  return true;
}

async function checkWhitelistedZelID(zelid) {
  if (typeof zelid !== 'string') {
    throw new Error('Invalid Owner ZelID');
  }
  const resZelIDs = await serviceHelper.axiosGet(
    'https://zel.network/project/zelflux/zelids.html'
  );

  if (!resZelIDs) {
    throw new Error(
      'Unable to communicate with Zel Services! Try again later.'
    );
  }

  const zelids = resZelIDs.data;
  const whitelisted = zelids.includes(zelid);
  if (!whitelisted) {
    throw new Error(
      'Owner Zel ID is not whitelisted. Please contact Zel Team.'
    );
  }
  return true;
}

async function verifyZelAppSpecifications(zelAppSpecifications) {
  if (typeof zelAppSpecifications !== 'object') {
    throw new Error('Invalid ZelApp Specifications');
  }
  if (zelAppSpecifications.version !== 1) {
    throw new Error('ZelApp message version specification is invalid');
  }
  if (zelAppSpecifications.name.length > 32) {
    throw new Error('ZelApp name is too long');
  }
  // furthermore name cannot contain any special character
  if (!zelAppSpecifications.name.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error(
      'ZelApp name contains special characters. Only a-z, A-Z and 0-9 are allowed'
    );
  }
  if (zelAppSpecifications.name.startsWith('zel')) {
    throw new Error('ZelApp name can not start with zel');
  }
  if (zelAppSpecifications.description.length > 256) {
    throw new Error(
      'Description is too long. Maximum of 256 characters is allowed'
    );
  }
  const parameters = checkHWParameters(zelAppSpecifications);
  if (parameters !== true) {
    const errorMessage = parameters;
    throw new Error(errorMessage);
  }

  // check port is within range
  if (
    zelAppSpecifications.port < config.zelapps.portMin ||
    zelAppSpecifications.port > config.zelapps.portMax
  ) {
    throw new Error(
      `Assigned port is not within ZelApps range ${config.zelapps.portMin}-${config.zelapps.portMax}`
    );
  }

  // check if containerPort makes sense
  if (
    zelAppSpecifications.containerPort < 0 ||
    zelAppSpecifications.containerPort > 65535
  ) {
    throw new Error('Container Port is not within system limits 0-65535');
  }

  // check wheter shared Folder is not root
  if (zelAppSpecifications.containerData.length < 2) {
    throw new Error(
      'ZelApp container data folder not specified. If no data folder is whished, use /tmp'
    );
  }

  // check repotag if available for download
  await verifyRepository(zelAppSpecifications.repotag);

  // check repository whitelisted
  await checkWhitelistedRepository(zelAppSpecifications.repotag);

  // check Zel ID whitelisted
  await checkWhitelistedZelID(zelAppSpecifications.owner);
}

async function ensureCorrectApplicationPort(zelAppSpecFormatted) {
  const dbopen = serviceHelper.databaseConnection();
  const zelappsDatabase = dbopen.db(config.database.zelappsglobal.database);
  const portQuery = { port: zelAppSpecFormatted.port };
  const portProjection = {
    projection: {
      _id: 0,
      name: 1,
    },
  };
  const portResult = await serviceHelper.findOneInDatabase(
    zelappsDatabase,
    globalZelAppsInformation,
    portQuery,
    portProjection
  );
  if (!portResult) {
    return true;
  }

  if (portResult.name !== zelAppSpecFormatted.name) {
    throw new Error(
      `ZelApp ${zelAppSpecFormatted.name} port already registered with different application. Your ZelApp has to use different port.`
    );
  }
  return true;
}

async function checkApplicationNameConflicts(zelAppSpecFormatted) {
  // check if name is not yet registered
  const dbopen = serviceHelper.databaseConnection();

  const zelappsDatabase = dbopen.db(config.database.zelappsglobal.database);
  const zelappsQuery = {
    name: new RegExp(`^${zelAppSpecFormatted.name}$`, 'i'),
  }; // case insensitive
  const zelappsProjection = {
    projection: {
      _id: 0,
      name: 1,
    },
  };
  const zelappResult = await serviceHelper.findOneInDatabase(
    zelappsDatabase,
    globalZelAppsInformation,
    zelappsQuery,
    zelappsProjection
  );

  if (zelappResult) {
    throw new Error(
      `ZelApp ${zelAppSpecFormatted.name} already registered. ZelApp has to be registered under different name.`
    );
  }

  const localApps = await availableZelApps();
  const zelappExists = localApps.find(
    (localApp) =>
      localApp.name.toLowerCase() === zelAppSpecFormatted.name.toLowerCase()
  );
  if (zelappExists) {
    throw new Error(
      `ZelApp ${zelAppSpecFormatted.name} already assigned to local application. ZelApp has to be registered under different name.`
    );
  }
  if (zelAppSpecFormatted.name.toLowerCase() === 'share') {
    throw new Error(
      `ZelApp ${zelAppSpecFormatted.name} already assigned to Flux main application. ZelApp has to be registered under different name.`
    );
  }
  return true;
}
async function storeZelAppTemporaryMessage(
  message,
  furtherVerification = false
) {
  /* message object
   * @param type string
   * @param version number
   * @param zelAppSpecifications object
   * @param hash string
   * @param timestamp number
   * @param signature string
   */
  if (
    typeof message !== 'object' &&
    typeof message.type !== 'string' &&
    typeof message.version !== 'number' &&
    typeof message.zelAppSpecifications !== 'object' &&
    typeof message.signature !== 'string' &&
    typeof message.timestamp !== 'number' &&
    typeof message.hash !== 'string'
  ) {
    return new Error('Invalid ZelApp message for storing');
  }
  // check if we have the message in cache. If yes, return false. If not, store
  // it and continue
  if (myCache.has(serviceHelper.ensureString(message))) {
    return false;
  }
  console.log(serviceHelper.ensureString(message));
  myCache.set(serviceHelper.ensureString(message), message);
  // data shall already be verified by the broadcasting node. But verify all
  // again.
  if (furtherVerification) {
    if (message.type === 'zelappregister') {
      // missing check for port?
      await verifyZelAppSpecifications(message.zelAppSpecifications);
      await verifyAppHash(message);
      await ensureCorrectApplicationPort(message.zelAppSpecifications);
      await checkApplicationNameConflicts(message.zelAppSpecifications);
      await verifyZelAppMessageSignature(
        message.type,
        message.version,
        message.zelAppSpecifications,
        message.timestamp,
        message.signature
      );
    } else if (message.type === 'zelappupdate') {
      // stadard verifications
      await verifyZelAppSpecifications(message.zelAppSpecifications);
      await verifyAppHash(message);
      await ensureCorrectApplicationPort(message.zelAppSpecifications);
      // verify that app exists, does not change repotag and is signed by zelapp
      // owner.
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.zelappsglobal.database);
      // may throw
      const query = { name: message.zelAppSpecifications.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const zelappInfo = await serviceHelper.findOneInDatabase(
        database,
        globalZelAppsInformation,
        query,
        projection
      );
      if (!zelappInfo) {
        throw new Error(
          'ZelApp update message received but application does not exists!'
        );
      }
      if (zelappInfo.repotag !== message.zelAppSpecifications.repotag) {
        throw new Error('ZelApp update of repotag is not allowed');
      }
      const { owner } = zelappInfo;
      // here signature is checked against PREVIOUS zelapp owner
      await verifyZelAppMessageUpdateSignature(
        message.type,
        message.version,
        message.zelAppSpecifications,
        message.timestamp,
        message.signature,
        owner
      );
    } else {
      throw new Error('Invalid ZelApp message received');
    }
  }

  const receivedAt = Date.now();
  const validTill = receivedAt + 60 * 60 * 1000; // 60 minutes

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelappsglobal.database);
  const newMessage = {
    zelAppSpecifications: message.zelAppSpecifications,
    type: message.type, // shall be zelappregister, zelappupdate
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
  const result = await serviceHelper.findOneInDatabase(
    database,
    globalZelAppsTempMessages,
    query,
    projection
  );
  if (result) {
    // it is already stored
    return false;
  }
  await serviceHelper.insertOneToDatabase(
    database,
    globalZelAppsTempMessages,
    value
  );
  // it is stored and rebroadcasted
  return true;
}

async function storeZelAppRunningMessage(message) {
  /* message object
   * @param type string
   * @param version number
   * @param hash string
   * @param broadcastedAt number
   * @param name string
   * @param ip string
   */
  if (
    typeof message !== 'object' &&
    typeof message.type !== 'string' &&
    typeof message.version !== 'number' &&
    typeof message.broadcastedAt !== 'number' &&
    typeof message.hash !== 'string' &&
    typeof message.name !== 'string' &&
    typeof message.ip !== 'string'
  ) {
    return new Error('Invalid ZelApp Running message for storing');
  }

  // check if we have the message in cache. If yes, return false. If not, store
  // it and continue
  if (myCache.has(serviceHelper.ensureString(message))) {
    return false;
  }
  console.log(serviceHelper.ensureString(message));
  myCache.set(serviceHelper.ensureString(message), message);

  const validTill = message.broadcastedAt + 65 * 60 * 1000; // 3900 seconds

  if (validTill < new Date().getTime()) {
    // reject old message
    return false;
  }

  const randomDelay = Math.floor(Math.random() * 1280) + 240;
  await serviceHelper.delay(randomDelay);

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelappsglobal.database);
  const newZelAppRunningMessage = {
    name: message.name,
    hash: message.hash, // hash of application specifics that are running
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
  const queryFind = {
    name: newZelAppRunningMessage.name,
    ip: newZelAppRunningMessage.ip,
    broadcastedAt: { $gte: newZelAppRunningMessage.broadcastedAt },
  };
  const projection = { _id: 0 };
  // we already have the exact same data
  const result = await serviceHelper.findOneInDatabase(
    database,
    globalZelAppsLocations,
    queryFind,
    projection
  );
  if (result) {
    // it is already stored
    return false;
  }
  const queryUpdate = {
    name: newZelAppRunningMessage.name,
    ip: newZelAppRunningMessage.ip,
  };
  const update = { $set: newZelAppRunningMessage };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(
    database,
    globalZelAppsLocations,
    queryUpdate,
    update,
    options
  );
  // it is now stored, rebroadcast
  return true;
}

async function registerZelAppGlobalyApi(req, res) {
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
      // first  check if this node is available for application registration -
      // has at least 5 outgoing connections and 2 incoming connections (that is
      // sufficient as it means it is confirmed and works correctly)
      if (
        zelfluxCommunication.outgoingPeers.length <
          config.zelapps.minOutgoing ||
        zelfluxCommunication.incomingPeers.length < config.zelapps.minIncoming
      ) {
        throw new Error(
          'Sorry, This Flux does not have enough peers for safe application registration'
        );
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it
      // only to verify that user indeed has access to the private key of the
      // owner zelid. name and port HAVE to be unique for application. Check if
      // they dont exist in global database first lets check if all fields are
      // present and have propper format excpet tiered and teired specifications
      // and those can be ommited
      let { zelAppSpecification } = processedBody;
      let { timestamp } = processedBody;
      let { signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (
        !zelAppSpecification ||
        !timestamp ||
        !signature ||
        !messageType ||
        !typeVersion
      ) {
        throw new Error(
          'Incomplete message received. Check if specifications, type, version, timestamp and siganture are provided.'
        );
      }
      if (messageType !== 'zelappregister') {
        throw new Error('Invalid type of message');
      }
      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }
      zelAppSpecification = serviceHelper.ensureObject(zelAppSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      let { version } = zelAppSpecification; // shall be 1
      let { name } = zelAppSpecification;
      let { description } = zelAppSpecification;
      let { repotag } = zelAppSpecification;
      let { owner } = zelAppSpecification;
      let { port } = zelAppSpecification;
      let { enviromentParameters } = zelAppSpecification;
      let { commands } = zelAppSpecification;
      let { containerPort } = zelAppSpecification;
      let { containerData } = zelAppSpecification;
      let { cpu } = zelAppSpecification;
      let { ram } = zelAppSpecification;
      let { hdd } = zelAppSpecification;
      const { tiered } = zelAppSpecification;

      // check if signature of received data is correct
      if (
        !version ||
        !name ||
        !description ||
        !repotag ||
        !owner ||
        !port ||
        !enviromentParameters ||
        !commands ||
        !containerPort ||
        !containerData ||
        !cpu ||
        !ram ||
        !hdd
      ) {
        throw new Error('Missing ZelApp specification parameter');
      }
      version = serviceHelper.ensureNumber(version);
      name = serviceHelper.ensureString(name);
      description = serviceHelper.ensureString(description);
      repotag = serviceHelper.ensureString(repotag);
      owner = serviceHelper.ensureString(owner);
      port = serviceHelper.ensureNumber(port);
      enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
      const envParamsCorrected = [];
      if (Array.isArray(enviromentParameters)) {
        enviromentParameters.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          envParamsCorrected.push(param);
        });
      } else {
        throw new Error('Enviromental parameters for ZelApp are invalid');
      }
      commands = serviceHelper.ensureObject(commands);
      const commandsCorrected = [];
      if (Array.isArray(commands)) {
        commands.forEach((command) => {
          const cmm = serviceHelper.ensureString(command);
          commandsCorrected.push(cmm);
        });
      } else {
        throw new Error('ZelApp commands are invalid');
      }
      containerPort = serviceHelper.ensureNumber(containerPort);
      containerData = serviceHelper.ensureString(containerData);
      cpu = serviceHelper.ensureNumber(cpu);
      ram = serviceHelper.ensureNumber(ram);
      hdd = serviceHelper.ensureNumber(hdd);
      if (typeof tiered !== 'boolean') {
        throw new Error(
          'Invalid tiered value obtained. Only boolean as true or false allowed.'
        );
      }

      const zelcashGetInfo = await zelcashService.getInfo();
      let zelcashHeight = 0;
      if (zelcashGetInfo.status === 'success') {
        zelcashHeight = zelcashGetInfo.data.blocks;
      } else {
        throw new Error(zelcashGetInfo.data.message || zelcashGetInfo.data);
      }

      if (
        owner !== config.zelTeamZelId &&
        zelcashHeight < config.zelapps.publicepochstart
      ) {
        throw new Error('Global Registration open on the 10th of October 2020');
      }

      // finalised parameters that will get stored in global database
      const zelAppSpecFormatted = {
        version, // integer
        name, // string
        description, // string
        repotag, // string
        owner, // zelid string
        port, // integer
        enviromentParameters: envParamsCorrected, // array of strings
        commands: commandsCorrected, // array of strings
        containerPort, // integer
        containerData, // string
        cpu, // float 0.1 step
        ram, // integer 100 step (mb)
        hdd, // integer 1 step
        tiered, // boolean
      };

      if (tiered) {
        let { cpubasic } = zelAppSpecification;
        let { cpusuper } = zelAppSpecification;
        let { cpubamf } = zelAppSpecification;
        let { rambasic } = zelAppSpecification;
        let { ramsuper } = zelAppSpecification;
        let { rambamf } = zelAppSpecification;
        let { hddbasic } = zelAppSpecification;
        let { hddsuper } = zelAppSpecification;
        let { hddbamf } = zelAppSpecification;
        if (
          !cpubasic ||
          !cpusuper ||
          !cpubamf ||
          !rambasic ||
          !ramsuper ||
          !rambamf ||
          !hddbasic ||
          !hddsuper ||
          !hddbamf
        ) {
          throw new Error(
            'ZelApp was requested as tiered setup but specifications are missing'
          );
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

        zelAppSpecFormatted.cpubasic = cpubasic;
        zelAppSpecFormatted.cpusuper = cpusuper;
        zelAppSpecFormatted.cpubamf = cpubamf;
        zelAppSpecFormatted.rambasic = rambasic;
        zelAppSpecFormatted.ramsuper = ramsuper;
        zelAppSpecFormatted.rambamf = rambamf;
        zelAppSpecFormatted.hddbasic = hddbasic;
        zelAppSpecFormatted.hddsuper = hddsuper;
        zelAppSpecFormatted.hddbamf = hddbamf;
      }
      // parameters are now proper format and assigned. Check for their
      // validity, if they are within limits, have propper port, repotag exists,
      // string lengths, specs are ok
      await verifyZelAppSpecifications(zelAppSpecFormatted);

      // check if name is not yet registered
      await checkApplicationNameConflicts(zelAppSpecFormatted);

      // check if port is not yet registered
      await ensureCorrectApplicationPort(zelAppSpecFormatted);

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type
      // or bad message received. Respond with 'Received message is invalid';
      await verifyZelAppMessageSignature(
        messageType,
        typeVersion,
        zelAppSpecFormatted,
        timestamp,
        signature
      );

      // if all ok, then sha256 hash of entire message = message + timestamp +
      // signature. We are hashing all to have always unique value. If hashing
      // just specificiations, if application goes back to previous
      // specifications, it may possess some issues if we have indeed correct
      // state We respond with a hash that is supposed to go to transaction.
      const message =
        messageType +
        typeVersion +
        JSON.stringify(zelAppSpecFormatted) +
        timestamp +
        signature;
      const messageHASH = await messageHash(message);
      const responseHash = serviceHelper.createDataMessage(messageHASH);
      // now all is great. Store zelAppSpecFormatted, timestamp, signature and
      // hash in zelappsTemporaryMessages. with 1 hours expiration time.
      // Broadcast this message to all outgoing connections.
      const temporaryZelAppMessage = {
        // specification of temp message
        type: messageType,
        version: typeVersion,
        zelAppSpecifications: zelAppSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
      };
      await storeZelAppTemporaryMessage(temporaryZelAppMessage, false);
      await zelfluxCommunication.broadcastTemporaryZelAppMessage(
        temporaryZelAppMessage
      );
      return res.json(responseHash);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code
      );
      return res.json(errorResponse);
    }
  });
}

// price handled in UI and available in API
async function updateZelAppGlobalyApi(req, res) {
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
      // first  check if this node is available for application update - has at
      // least 5 outgoing connections and 2 incoming connections (that is
      // sufficient as it means it is confirmed and works correctly)
      if (
        zelfluxCommunication.outgoingPeers.length <
          config.zelapps.minOutgoing ||
        zelfluxCommunication.incomingPeers.length < config.zelapps.minIncoming
      ) {
        throw new Error(
          'Sorry, This Flux does not have enough peers for safe application update'
        );
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it
      // only to verify that user indeed has access to the private key of the
      // owner zelid. name and port HAVE to be unique for application. Check if
      // they dont exist in global database first lets check if all fields are
      // present and have propper format excpet tiered and teired specifications
      // and those can be ommited
      let { zelAppSpecification } = processedBody;
      let { timestamp } = processedBody;
      let { signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (
        !zelAppSpecification ||
        !timestamp ||
        !signature ||
        !messageType ||
        !typeVersion
      ) {
        throw new Error(
          'Incomplete message received. Check if specifications, timestamp, type, version and siganture are provided.'
        );
      }
      if (messageType !== 'zelappupdate') {
        throw new Error('Invalid type of message');
      }
      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }
      zelAppSpecification = serviceHelper.ensureObject(zelAppSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      let { version } = zelAppSpecification; // shall be 1
      let { name } = zelAppSpecification;
      let { description } = zelAppSpecification;
      let { repotag } = zelAppSpecification;
      let { owner } = zelAppSpecification;
      let { port } = zelAppSpecification;
      let { enviromentParameters } = zelAppSpecification;
      let { commands } = zelAppSpecification;
      let { containerPort } = zelAppSpecification;
      let { containerData } = zelAppSpecification;
      let { cpu } = zelAppSpecification;
      let { ram } = zelAppSpecification;
      let { hdd } = zelAppSpecification;
      const { tiered } = zelAppSpecification;

      // check if signature of received data is correct
      if (
        !version ||
        !name ||
        !description ||
        !repotag ||
        !owner ||
        !port ||
        !enviromentParameters ||
        !commands ||
        !containerPort ||
        !containerData ||
        !cpu ||
        !ram ||
        !hdd
      ) {
        throw new Error('Missing ZelApp specification parameter');
      }
      version = serviceHelper.ensureNumber(version);
      name = serviceHelper.ensureString(name);
      description = serviceHelper.ensureString(description);
      repotag = serviceHelper.ensureString(repotag);
      owner = serviceHelper.ensureString(owner);
      port = serviceHelper.ensureNumber(port);
      enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
      const envParamsCorrected = [];
      if (Array.isArray(enviromentParameters)) {
        enviromentParameters.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          envParamsCorrected.push(param);
        });
      } else {
        throw new Error('Enviromental parameters for ZelApp are invalid');
      }
      commands = serviceHelper.ensureObject(commands);
      const commandsCorrected = [];
      if (Array.isArray(commands)) {
        commands.forEach((command) => {
          const cmm = serviceHelper.ensureString(command);
          commandsCorrected.push(cmm);
        });
      } else {
        throw new Error('ZelApp commands are invalid');
      }
      containerPort = serviceHelper.ensureNumber(containerPort);
      containerData = serviceHelper.ensureString(containerData);
      cpu = serviceHelper.ensureNumber(cpu);
      ram = serviceHelper.ensureNumber(ram);
      hdd = serviceHelper.ensureNumber(hdd);
      if (typeof tiered !== 'boolean') {
        throw new Error(
          'Invalid tiered value obtained. Only boolean as true or false allowed.'
        );
      }

      // finalised parameters that will get stored in global database
      const zelAppSpecFormatted = {
        version, // integer
        name, // string
        description, // string
        repotag, // string
        owner, // zelid string
        port, // integer
        enviromentParameters: envParamsCorrected, // array of strings
        commands: commandsCorrected, // array of strings
        containerPort, // integer
        containerData, // string
        cpu, // float 0.1 step
        ram, // integer 100 step (mb)
        hdd, // integer 1 step
        tiered, // boolean
      };

      if (tiered) {
        let { cpubasic } = zelAppSpecification;
        let { cpusuper } = zelAppSpecification;
        let { cpubamf } = zelAppSpecification;
        let { rambasic } = zelAppSpecification;
        let { ramsuper } = zelAppSpecification;
        let { rambamf } = zelAppSpecification;
        let { hddbasic } = zelAppSpecification;
        let { hddsuper } = zelAppSpecification;
        let { hddbamf } = zelAppSpecification;
        if (
          !cpubasic ||
          !cpusuper ||
          !cpubamf ||
          !rambasic ||
          !ramsuper ||
          !rambamf ||
          !hddbasic ||
          !hddsuper ||
          !hddbamf
        ) {
          throw new Error(
            'ZelApp was requested as tiered setup but specifications are missing'
          );
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

        zelAppSpecFormatted.cpubasic = cpubasic;
        zelAppSpecFormatted.cpusuper = cpusuper;
        zelAppSpecFormatted.cpubamf = cpubamf;
        zelAppSpecFormatted.rambasic = rambasic;
        zelAppSpecFormatted.ramsuper = ramsuper;
        zelAppSpecFormatted.rambamf = rambamf;
        zelAppSpecFormatted.hddbasic = hddbasic;
        zelAppSpecFormatted.hddsuper = hddsuper;
        zelAppSpecFormatted.hddbamf = hddbamf;
      }
      // parameters are now proper format and assigned. Check for their
      // validity, if they are within limits, have propper port, repotag exists,
      // string lengths, specs are ok
      await verifyZelAppSpecifications(zelAppSpecFormatted);
      // check if port is not changing
      await ensureCorrectApplicationPort(zelAppSpecFormatted);

      // verify that app exists, does not change repotag and is signed by zelapp
      // owner.
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.zelappsglobal.database);
      // may throw
      const query = { name: zelAppSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const zelappInfo = await serviceHelper.findOneInDatabase(
        database,
        globalZelAppsInformation,
        query,
        projection
      );
      if (!zelappInfo) {
        throw new Error(
          'ZelApp update received but application to update does not exists!'
        );
      }
      if (zelappInfo.repotag !== zelAppSpecFormatted.repotag) {
        throw new Error('ZelApp update of repotag is not allowed');
      }
      const zelAppOwner = zelappInfo.owner; // ensure previous zelapp owner is signing this message
      // here signature is checked against PREVIOUS zelapp owner
      await verifyZelAppMessageUpdateSignature(
        messageType,
        typeVersion,
        zelAppSpecFormatted,
        timestamp,
        signature,
        zelAppOwner
      );

      // if all ok, then sha256 hash of entire message = message + timestamp +
      // signature. We are hashing all to have always unique value. If hashing
      // just specificiations, if application goes back to previous
      // specifications, it may possess some issues if we have indeed correct
      // state We respond with a hash that is supposed to go to transaction.
      const message =
        messageType +
        typeVersion +
        JSON.stringify(zelAppSpecFormatted) +
        timestamp +
        signature;
      const messageHASH = await messageHash(message);
      const responseHash = serviceHelper.createDataMessage(messageHASH);
      // now all is great. Store zelAppSpecFormatted, timestamp, signature and
      // hash in zelappsTemporaryMessages. with 1 hours expiration time.
      // Broadcast this message to all outgoing connections.
      const temporaryZelAppMessage = {
        // specification of temp message
        type: messageType,
        version: typeVersion,
        zelAppSpecifications: zelAppSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
      };
      await storeZelAppTemporaryMessage(temporaryZelAppMessage, false);
      await zelfluxCommunication.broadcastTemporaryZelAppMessage(
        temporaryZelAppMessage
      );
      return res.json(responseHash);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code
      );
      return res.json(errorResponse);
    }
  });
}

async function installTemporaryLocalApplication(req, res, applicationName) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
    if (authorized) {
      const allZelApps = await availableZelApps();
      const zelAppSpecifications = allZelApps.find(
        (zelapp) => zelapp.name === applicationName
      );
      if (!zelAppSpecifications) {
        throw new Error('Application Specifications not found');
      }

      // get our tier and adjust true resource registered
      if (zelAppSpecifications.tiered) {
        const tier = await zelnodeTier();
        if (tier === 'basic') {
          zelAppSpecifications.cpu =
            zelAppSpecifications.cpubasic || zelAppSpecifications.cpu;
          zelAppSpecifications.ram =
            zelAppSpecifications.rambasic || zelAppSpecifications.ram;
        } else if (tier === 'super') {
          zelAppSpecifications.cpu =
            zelAppSpecifications.cpusuper || zelAppSpecifications.cpu;
          zelAppSpecifications.ram =
            zelAppSpecifications.ramsuper || zelAppSpecifications.ram;
        } else if (tier === 'bamf') {
          zelAppSpecifications.cpu =
            zelAppSpecifications.cpubamf || zelAppSpecifications.cpu;
          zelAppSpecifications.ram =
            zelAppSpecifications.rambamf || zelAppSpecifications.ram;
        } else {
          throw new Error('Unrecognised ZelNode tier');
        }
      }

      res.setHeader('Content-Type', 'application/json');
      registerZelAppLocally(zelAppSpecifications, res);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    res.json(errorResponse);
  }
}

// where req can be equal to appname
// shall be identical to listAllZelApps. But this is database response
async function installedZelApps(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    let zelappsQuery = {};
    if (req && req.params && req.query) {
      let { appname } = req.params; // we accept both help/command and help?command=getinfo
      appname = appname || req.query.appname;
      if (appname) {
        zelappsQuery = {
          name: appname,
        };
      }
    } else if (req && typeof req === 'string') {
      // consider it as appname
      zelappsQuery = {
        name: req,
      };
    }
    const zelappsProjection = {
      projection: {
        _id: 0,
      },
    };
    const zelApps = await serviceHelper.findInDatabase(
      zelappsDatabase,
      localZelAppsInformation,
      zelappsQuery,
      zelappsProjection
    );
    const dataResponse = serviceHelper.createDataMessage(zelApps);
    return res ? res.json(dataResponse) : dataResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function requestZelAppMessage(hash) {
  // some message type request zelapp message, message hash
  // peer responds with data from permanent database or temporary database. If
  // does not have it requests further
  console.log(hash);
  const message = {
    type: 'zelapprequest',
    version: 1,
    hash,
  };
  await zelfluxCommunication.broadcastMessageToOutgoing(message);
  await serviceHelper.delay(2345);
  await zelfluxCommunication.broadcastMessageToIncoming(message);
}

async function storeZelAppPermanentMessage(message) {
  /* message object
   * @param type string
   * @param version number
   * @param zelAppSpecifications object
   * @param hash string
   * @param timestamp number
   * @param signature string
   * @param txid string
   * @param height number
   * @param valueSat number
   */
  if (
    typeof message !== 'object' &&
    typeof message.type !== 'string' &&
    typeof message.version !== 'number' &&
    typeof message.zelAppSpecifications !== 'object' &&
    typeof message.signature !== 'string' &&
    typeof message.timestamp !== 'number' &&
    typeof message.hash !== 'string' &&
    typeof message.txid !== 'string' &&
    typeof message.height !== 'number' &&
    typeof message.valueSat !== 'number'
  ) {
    return new Error('Invalid ZelApp message for storing');
  }

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelappsglobal.database);
  await serviceHelper
    .insertOneToDatabase(database, globalZelAppsMessages, message)
    .catch((error) => {
      log.error(error);
      throw error;
    });
  return true;
}

async function updateZelAppSpecifications(zelAppSpecs) {
  try {
    // zelAppSpecs: {
    //   version: 1,
    //   name: 'FoldingAtHomeB',
    //   description: 'Folding @ Home is cool :)',
    //   repotag: 'yurinnick/folding-at-home:latest',
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    //   port: 30001,
    //   enviromentParameters: '["USER=foldingUser", "TEAM=262156",
    //   "ENABLE_GPU=false", "ENABLE_SMP=true"]', // [] commands:
    //   '["--allow","0/0","--web-allow","0/0"]', // [] containerPort: 7396,
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
    const database = db.db(config.database.zelappsglobal.database);

    const query = { name: zelAppSpecs.name };
    const update = { $set: zelAppSpecs };
    const options = {
      upsert: true,
    };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const zelappInfo = await serviceHelper.findOneInDatabase(
      database,
      globalZelAppsInformation,
      query,
      projection
    );
    if (zelappInfo) {
      if (zelappInfo.height < zelAppSpecs.height) {
        await serviceHelper.updateOneInDatabase(
          database,
          globalZelAppsInformation,
          query,
          update,
          options
        );
      }
    } else {
      await serviceHelper.updateOneInDatabase(
        database,
        globalZelAppsInformation,
        query,
        update,
        options
      );
    }
  } catch (error) {
    // retry
    log.error(error);
    await serviceHelper.delay(60 * 1000);
    updateZelAppSpecifications(zelAppSpecs);
  }
}

async function updateZelAppSpecsForRescanReindex(zelAppSpecs) {
  // zelAppSpecs: {
  //   version: 1,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   port: 30001,
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156",
  //   "ENABLE_GPU=false", "ENABLE_SMP=true"]', // [] commands:
  //   '["--allow","0/0","--web-allow","0/0"]', // [] containerPort: 7396,
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
  const database = db.db(config.database.zelappsglobal.database);

  const query = { name: zelAppSpecs.name };
  const update = { $set: zelAppSpecs };
  const options = {
    upsert: true,
  };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const zelappInfo = await serviceHelper.findOneInDatabase(
    database,
    globalZelAppsInformation,
    query,
    projection
  );
  if (zelappInfo) {
    if (zelappInfo.height < zelAppSpecs.height) {
      await serviceHelper.updateOneInDatabase(
        database,
        globalZelAppsInformation,
        query,
        update,
        options
      );
    }
  } else {
    await serviceHelper.updateOneInDatabase(
      database,
      globalZelAppsInformation,
      query,
      update,
      options
    );
  }
  return true;
}

async function checkZelAppMessageExistence(hash) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const zelappsDatabase = dbopen.db(config.database.zelappsglobal.database);
    const zelappsQuery = { hash };
    const zelappsProjection = {};
    // a permanent global zelappmessage looks like this:
    // const permanentZelAppMessage = {
    //   type: messageType,
    //   version: typeVersion,
    //   zelAppSpecifications: zelAppSpecFormatted,
    //   hash: messageHASH,
    //   timestamp,
    //   signature,
    //   txid,
    //   height,
    //   valueSat,
    // };
    const zelappResult = await serviceHelper.findOneInDatabase(
      zelappsDatabase,
      globalZelAppsMessages,
      zelappsQuery,
      zelappsProjection
    );
    if (zelappResult) {
      return zelappResult;
    }
    return false;
  } catch (error) {
    log.error(error);
    return error;
  }
}

async function checkZelAppTemporaryMessageExistence(hash) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const zelappsDatabase = dbopen.db(config.database.zelappsglobal.database);
    const zelappsQuery = { hash };
    const zelappsProjection = {};
    // a temporary zelappmessage looks like this:
    // const newMessage = {
    //   zelAppSpecifications: message.zelAppSpecifications,
    //   type: message.type,
    //   version: message.version,
    //   hash: message.hash,
    //   timestamp: message.timestamp,
    //   signature: message.signature,
    //   createdAt: new Date(message.timestamp),
    //   expireAt: new Date(validTill),
    // };
    const zelappResult = await serviceHelper.findOneInDatabase(
      zelappsDatabase,
      globalZelAppsTempMessages,
      zelappsQuery,
      zelappsProjection
    );
    if (zelappResult) {
      return zelappResult;
    }
    return false;
  } catch (error) {
    log.error(error);
    return error;
  }
}

async function zelappHashHasMessage(hash) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelcash.database);
  const query = { hash };
  const update = { $set: { message: true } };
  const options = {};
  await serviceHelper.updateOneInDatabase(
    database,
    zelappsHashesCollection,
    query,
    update,
    options
  );
  return true;
}

// hash of zelapp information, txid it was in, height of blockchain containing
// the txid handles zelappregister type and zelappupdate type.
async function checkAndRequestZelApp(hash, txid, height, valueSat, i = 0) {
  try {
    const randomDelay = Math.floor(Math.random() * 1280) + 420;
    await serviceHelper.delay(randomDelay);
    const appMessageExists = await checkZelAppMessageExistence(hash);
    if (appMessageExists === false) {
      // otherwise do nothing
      // we surely do not have that message in permanent storaage.
      // check temporary message storage
      // if we have it in temporary storage, get the temporary message
      const tempMessage = await checkZelAppTemporaryMessageExistence(hash);
      if (tempMessage) {
        // temp message means its all ok. store it as permanent zelapp message
        const permanentZelAppMessage = {
          type: tempMessage.type,
          version: tempMessage.version,
          zelAppSpecifications: tempMessage.zelAppSpecifications,
          hash: tempMessage.hash,
          timestamp: tempMessage.timestamp,
          signature: tempMessage.signature,
          txid: serviceHelper.ensureString(txid),
          height: serviceHelper.ensureNumber(height),
          valueSat: serviceHelper.ensureNumber(valueSat),
        };
        await storeZelAppPermanentMessage(permanentZelAppMessage);
        // await update zelapphashes that we already have it stored
        await zelappHashHasMessage(hash);
        // disregard other types
        if (tempMessage.type === 'zelappregister') {
          // check if value is optimal or higher
          let appPrice = appPricePerMonth(tempMessage.zelAppSpecifications);
          if (appPrice < 1) {
            appPrice = 1;
          }
          if (valueSat >= appPrice * 1e8) {
            const updateForSpecifications =
              permanentZelAppMessage.zelAppSpecifications;
            updateForSpecifications.hash = permanentZelAppMessage.hash;
            updateForSpecifications.height = permanentZelAppMessage.height;
            // object of zelAppSpecifications extended for hash and height
            // do not await this
            updateZelAppSpecifications(updateForSpecifications);
          } // else do nothing notify its underpaid?
        } else if (tempMessage.type === 'zelappupdate') {
          // zelappSpecifications.name as identifier
          const db = serviceHelper.databaseConnection();
          const database = db.db(config.database.zelappsglobal.database);
          // may throw
          const query = { name: tempMessage.zelAppSpecifications.name };
          const projection = {
            projection: {
              _id: 0,
            },
          };
          const zelappInfo = await serviceHelper.findOneInDatabase(
            database,
            globalZelAppsInformation,
            query,
            projection
          );
          // here comparison of height differences and specifications
          // price shall be price for standard registration plus minus already
          // paid price according to old specifics. height remains height valid
          // for 22000 blocks
          const appPrice = appPricePerMonth(tempMessage.zelAppSpecifications);
          const previousSpecsPrice = appPricePerMonth(zelappInfo);
          // what is the height difference
          const heightDifference =
            permanentZelAppMessage.height - zelappInfo.height; // has to be lower than 22000
          const perc =
            (config.zelapps.blocksLasting - heightDifference) /
            config.zelapps.blocksLasting;
          let actualPriceToPay = appPrice * 0.9;
          if (perc > 0) {
            actualPriceToPay = (appPrice - perc * previousSpecsPrice) * 0.9; // discount for missing heights. Allow 90%
          }
          actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
          if (actualPriceToPay < 1) {
            actualPriceToPay = 1;
          }
          if (valueSat >= actualPriceToPay * 1e8) {
            const updateForSpecifications =
              permanentZelAppMessage.zelAppSpecifications;
            updateForSpecifications.hash = permanentZelAppMessage.hash;
            updateForSpecifications.height = permanentZelAppMessage.height;
            // object of zelAppSpecifications extended for hash and height
            // do not await this
            updateZelAppSpecifications(updateForSpecifications);
          } // else do nothing notify its underpaid?
        }
      } else {
        // request the message and broadcast the message further to our
        // connected peers.
        requestZelAppMessage(hash);
        // rerun this after 1 min delay
        // stop this loop after 7 mins, as it might be a scammy message or
        // simply this message is nowhere on the network, we dont have
        // connections etc. We also have continous checkup for it every 8 min
        if (i < 7) {
          await serviceHelper.delay(60 * 1000);
          checkAndRequestZelApp(hash, txid, height, valueSat, i + 1);
        }
        // additional requesting of missing zelapp messages is done on rescans
      }
    } else {
      // update zelapphashes that we already have it stored
      await zelappHashHasMessage(hash);
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
      const message = serviceHelper.createSuccessMessage(
        'Repotag is accessible'
      );
      return res.json(message);
    } catch (error) {
      log.warn(error);
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code
      );
      return res.json(errorResponse);
    }
  });
}

function registrationInformation(req, res) {
  try {
    const data = config.zelapps;
    const response = serviceHelper.createDataMessage(data);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    res.json(errorResponse);
  }
}

// function that drops global zelapps information and goes over all global
// zelapps messages and reconsturcts the global zelapps information. Further
// creates database indexes
async function reindexGlobalAppsInformation() {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.zelappsglobal.database);
    await serviceHelper
      .dropCollection(database, globalZelAppsInformation)
      .catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
    await database
      .collection(globalZelAppsInformation)
      .createIndex(
        { name: 1 },
        { name: 'query for getting zelapp based on zelapp specs name' }
      );
    await database
      .collection(globalZelAppsInformation)
      .createIndex(
        { owner: 1 },
        { name: 'query for getting zelapp based on zelapp specs owner' }
      );
    await database
      .collection(globalZelAppsInformation)
      .createIndex(
        { repotag: 1 },
        { name: 'query for getting zelapp based on image' }
      );
    await database.collection(globalZelAppsInformation).createIndex(
      { height: 1 },
      {
        name: 'query for getting zelapp based on last height update',
      }
    ); // we need to know the height of app adjustment
    await database.collection(globalZelAppsInformation).createIndex(
      { hash: 1 },
      {
        name: 'query for getting zelapp based on last hash',
      }
    ); // we need to know the hash of the last message update which is the
    // true identifier
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await serviceHelper.findInDatabase(
      database,
      globalZelAppsMessages,
      query,
      projection
    );
    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateZelAppSpecsForRescanReindex(updateForSpecifications);
    }
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

// function that drops information about running zelapps and rebuilds indexes
async function reindexGlobalAppsLocation() {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.zelappsglobal.database);
    await serviceHelper
      .dropCollection(database, globalZelAppsLocations)
      .catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
    await database.collection(globalZelAppsLocations).createIndex(
      { name: 1 },
      {
        name: 'query for getting zelapp location based on zelapp specs name',
      }
    );
    await database.collection(globalZelAppsLocations).createIndex(
      { hash: 1 },
      {
        name: 'query for getting zelapp location based on zelapp hash',
      }
    );
    await database.collection(globalZelAppsLocations).createIndex(
      { ip: 1 },
      {
        name: 'query for getting zelapp location based on ip',
      }
    );
    await database
      .collection(globalZelAppsLocations)
      .createIndex(
        { name: 1, ip: 1 },
        { name: 'query for getting app based on ip and name' }
      );
    await database
      .collection(globalZelAppsLocations)
      .createIndex(
        { name: 1, ip: 1, broadcastedAt: 1 },
        { name: 'query for getting app to ensure we possess a message' }
      );
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

// function goes over all global zelapps messages and updates global zelapps
// infromation database
async function rescanGlobalAppsInformation(
  height = 0,
  removeLastInformation = false
) {
  try {
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.zelappsglobal.database);
    await serviceHelper
      .dropCollection(database, globalZelAppsInformation)
      .catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
    const query = { height: { $gte: height } };
    const projection = { projection: { _id: 0 } };
    const results = await serviceHelper.findInDatabase(
      database,
      globalZelAppsMessages,
      query,
      projection
    );

    if (removeLastInformation === true) {
      await serviceHelper.removeDocumentsFromCollection(
        database,
        globalZelAppsInformation,
        query
      );
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateZelAppSpecsForRescanReindex(updateForSpecifications);
    }
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege(
      'adminandzelteam',
      req
    );
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = serviceHelper.createErrorMessage(
          'No blockheight provided'
        );
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = serviceHelper.databaseConnection();
      const database = dbopen.db(config.database.zelcash.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await serviceHelper.findOneInDatabase(
        database,
        scannedHeightCollection,
        query,
        projection
      );
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
      removelastinformation =
        removelastinformation || req.query.removelastinformation || false;
      removelastinformation = serviceHelper.ensureBoolean(
        removelastinformation
      );
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function continuousZelAppHashesCheck() {
  try {
    log.info('Requesting missing ZelApp messages');
    // get zelapp hashes that do not have a message;
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelcash.database);
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
    const results = await serviceHelper.findInDatabase(
      database,
      zelappsHashesCollection,
      query,
      projection
    );
    // eslint-disable-next-line no-restricted-syntax
    for (const result of results) {
      checkAndRequestZelApp(
        result.hash,
        result.txid,
        result.height,
        result.value
      );
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1234);
    }
  } catch (error) {
    log.error(error);
  }
}

async function getZelAppHashes(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelcash.database);
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
    const results = await serviceHelper.findInDatabase(
      database,
      zelappsHashesCollection,
      query,
      projection
    );
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    res.json(errorResponse);
  }
}

async function getZelAppsLocations(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelappsglobal.database);
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
    const results = await serviceHelper.findInDatabase(
      database,
      globalZelAppsLocations,
      query,
      projection
    );
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    res.json(errorResponse);
  }
}

async function getZelAppsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No ZelApp name specified');
    }
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelappsglobal.database);
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
    const results = await serviceHelper.findInDatabase(
      database,
      globalZelAppsLocations,
      query,
      projection
    );
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code
    );
    res.json(errorResponse);
  }
}

async function checkSynced() {
  try {
    // check if flux database is synced with zelcash database (equal or -1
    // inheight)
    const zelcashGetInfo = await zelcashService.getInfo();
    let zelcashHeight;
    if (zelcashGetInfo.status === 'success') {
      zelcashHeight = zelcashGetInfo.data.blocks;
    } else {
      throw new Error(zelcashGetInfo.data.message || zelcashGetInfo.data);
    }
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelcash.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(
      database,
      scannedHeightCollection,
      query,
      projection
    );
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(
      result.generalScannedHeight
    );

    if (
      explorerHeight + 1 === zelcashHeight ||
      explorerHeight === zelcashHeight
    ) {
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
    const database = db.db(config.database.zelappsglobal.database);
    const query = {};
    const projection = { projection: { _id: 0, name: 1 } };
    const results = await serviceHelper.findInDatabase(
      database,
      globalZelAppsInformation,
      query,
      projection
    );
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
  const database = dbopen.db(config.database.zelappsglobal.database);
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
  const results = await serviceHelper.findInDatabase(
    database,
    globalZelAppsLocations,
    query,
    projection
  );
  return results;
}

async function getApplicationGlobalSpecifications(appName) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelappsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const zelappInfo = await serviceHelper.findOneInDatabase(
    database,
    globalZelAppsInformation,
    query,
    projection
  );
  return zelappInfo;
}

async function getApplicationLocalSpecifications(appName) {
  const allZelApps = await availableZelApps();
  const zelappInfo = allZelApps.find(
    (zelapp) => zelapp.name.toLowerCase() === appName.toLowerCase()
  );
  return zelappInfo;
}

async function getApplicationSpecifications(appName) {
  // zelAppSpecs: {
  //   version: 1,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   port: 30001,
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156",
  //   "ENABLE_GPU=false", "ENABLE_SMP=true"]', // [] commands:
  //   '["--allow","0/0","--web-allow","0/0"]', // [] containerPort: 7396,
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
  const database = db.db(config.database.zelappsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let zelappInfo = await serviceHelper.findOneInDatabase(
    database,
    globalZelAppsInformation,
    query,
    projection
  );
  if (!zelappInfo) {
    const allZelApps = await availableZelApps();
    zelappInfo = allZelApps.find(
      (zelapp) => zelapp.name.toLowerCase() === appName.toLowerCase()
    );
  }
  return zelappInfo;
}

// case sensitive
async function getStrictApplicationSpecifications(appName) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelappsglobal.database);

  const query = { name: appName };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let zelappInfo = await serviceHelper.findOneInDatabase(
    database,
    globalZelAppsInformation,
    query,
    projection
  );
  if (!zelappInfo) {
    const allZelApps = await availableZelApps();
    zelappInfo = allZelApps.find((zelapp) => zelapp.name === appName);
  }
  return zelappInfo;
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
      error.code
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function trySpawningGlobalApplication() {
  try {
    // how do we continue with this function function?
    // we have globalapplication specifics list
    // check if we are synced
    const synced = await checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.zelapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // get all the applications list names
    const globalAppNames = await getAllGlobalApplicationsNames();
    // pick a random one
    const numberOfGlobalApps = globalAppNames.length;
    const randomAppnumber = Math.floor(Math.random() * numberOfGlobalApps);
    const randomApp = globalAppNames[randomAppnumber];
    if (!randomApp) {
      log.info('No application specifications found');
      await serviceHelper.delay(config.zelapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // check if there is < 5 instances of nodes running the app
    // TODO evaluate if its not better to check locally running applications!
    const runningAppList = await getRunningAppList(randomApp);
    if (runningAppList.length >= config.zelapps.minimumInstances) {
      log.info(
        `Application ${randomApp} is already spawned on ${runningAppList.length} instances`
      );
      await serviceHelper.delay(config.zelapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await zelcashService.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
      if (benchmarkResponseData.ipaddress) {
        myIP =
          benchmarkResponseData.ipaddress.length > 5
            ? benchmarkResponseData.ipaddress
            : null;
      }
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip === myIP)) {
      log.info(
        `Application ${randomApp} is reported as already running on this Flux`
      );
      await serviceHelper.delay(config.zelapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // second check if app is running on this node
    const runningApps = await listRunningZelApps();
    if (runningApps.status !== 'success') {
      throw new Error('Unable to check running apps on this Flux');
    }
    if (
      runningApps.data.find(
        (app) => app.Names[0].substr(4, app.Names[0].length) === randomApp
      )
    ) {
      log.info(`${randomApp} application is already running on this Flux`);
      await serviceHelper.delay(config.zelapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // check if node is capable to run it according to specifications
    // get app specifications
    const appSpecifications = await getApplicationGlobalSpecifications(
      randomApp
    );
    if (!appSpecifications) {
      throw new Error(
        `Specifications for application ${randomApp} were not found!`
      );
    }
    // run the verification
    // get tier and adjust specifications
    const tier = await zelnodeTier();
    if (appSpecifications.tiered) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu =
        appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram =
        appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd =
        appSpecifications[hddTier] || appSpecifications.hdd;
    }
    // verify requirements
    await checkZelAppRequirements(appSpecifications);

    // if all ok Check hashes comparison if its out turn to start the app. 1%
    // probability.
    const randomNumber = Math.floor(
      Math.random() * config.zelapps.installation.probability
    );
    if (randomNumber !== 0) {
      log.info('Other Fluxes are evaluating application installation');
      await serviceHelper.delay(config.zelapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    // an application was selected and checked that it can run on this node. try
    // to install and run it locally install the app
    await registerZelAppLocally(appSpecifications);

    await serviceHelper.delay(10 * config.zelapps.installation.delay * 1000);
    log.info('Reinitiating possible app installation');
    trySpawningGlobalApplication();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(config.zelapps.installation.delay * 1000);
    trySpawningGlobalApplication();
  }
}

async function checkAndNotifyPeersOfRunningApps() {
  try {
    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await zelcashService.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
      if (benchmarkResponseData.ipaddress) {
        myIP =
          benchmarkResponseData.ipaddress.length > 5
            ? benchmarkResponseData.ipaddress
            : null;
      }
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    // get list of locally installed apps. Store them in database as running and
    // send info to our peers. check if they are running?
    const installedAppsRes = await installedZelApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await listRunningZelApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const installedApps = installedAppsRes.data;
    const runningApps = runningAppsRes.data;
    const installedAppsNames = installedApps.map((app) => app.name);
    const runningAppsNames = runningApps.map((app) =>
      app.Names[0].substr(4, app.Names[0].length)
    );
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppsNames.filter(
      (installedApp) => !runningSet.has(installedApp)
    );
    // check if stoppedApp is a global application present in specifics. If so,
    // try to start it. eslint-disable-next-line no-restricted-syntax
    for (const stoppedApp of stoppedApps) {
      try {
        // proceed ONLY if its global App
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(stoppedApp);
        if (appDetails) {
          log.warn(
            `${stoppedApp} is stopped but shall be running. Starting...`
          );
          // it is a stopped global zelapp. Try to run it.
          const zelappId = getZelAppIdentifier(stoppedApp);
          // check if some removal is in progress as if it is dont start it!
          if (!removalInProgress) {
            // eslint-disable-next-line no-await-in-loop
            await zelAppDockerStart(zelappId);
          } else {
            log.warn(
              `Not starting ${stoppedApp} as of application removal in progress`
            );
          }
        }
      } catch (err) {
        log.error(err);
        // already checked for mongo ok, zelcash ok, docker ok.
        // eslint-disable-next-line no-await-in-loop
        await removeZelAppLocally(stoppedApp);
      }
    }
    const installedAndRunning = installedApps.filter((installedApp) =>
      runningAppsNames.includes(installedApp.name)
    );
    // eslint-disable-next-line no-restricted-syntax
    for (const application of installedAndRunning) {
      log.info(`${application.name} is running properly. Broadcasting status.`);
      try {
        // eslint-disable-next-line no-await-in-loop
        // we can distinguish pure local apps from global with hash and height
        const broadcastedAt = new Date().getTime();
        const newZelAppRunningMessage = {
          type: 'zelapprunning',
          version: 1,
          name: application.name,
          hash: application.hash, // hash of application specifics that are running
          ip: myIP,
          broadcastedAt,
        };

        // store it in local database first
        // eslint-disable-next-line no-await-in-loop
        await storeZelAppRunningMessage(newZelAppRunningMessage);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(2345);
        // eslint-disable-next-line no-await-in-loop
        await zelfluxCommunication.broadcastMessageToOutgoing(
          newZelAppRunningMessage
        );
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(2345);
        // eslint-disable-next-line no-await-in-loop
        await zelfluxCommunication.broadcastMessageToIncoming(
          newZelAppRunningMessage
        );
        // broadcast messages about running apps to all peers
      } catch (err) {
        log.error(err);
        // removeZelAppLocally(stoppedApp);
      }
    }
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  }
}

async function expireGlobalApplications() {
  // function to expire global applications. Find applications that are lower
  // than blocksLasting check if synced
  try {
    const synced = await checkSynced();
    if (synced !== true) {
      log.info('Application expiration paused. Not yet synced');
      return;
    }
    // get current height
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.zelcash.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(
      database,
      scannedHeightCollection,
      query,
      projection
    );
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(
      result.generalScannedHeight
    );
    const expirationHeight = explorerHeight - config.zelapps.blocksLasting;
    // get global applications specification that have up to date data
    // find applications that have specifications height lower than
    // expirationHeight
    const databaseZelApps = dbopen.db(config.database.zelappsglobal.database);
    const queryZelApps = { height: { $lt: expirationHeight } };
    const projectionZelApps = { projection: { _id: 0, name: 1 } };
    const results = await serviceHelper.findInDatabase(
      databaseZelApps,
      globalZelAppsInformation,
      queryZelApps,
      projectionZelApps
    );
    const appNamesToExpire = results.map((res) => res.name);
    // remove appNamesToExpire apps from global database
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appNamesToExpire) {
      const queryDeleteApp = { name: appName };
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.findOneAndDeleteInDatabase(
        databaseZelApps,
        globalZelAppsInformation,
        queryDeleteApp,
        projectionZelApps
      );
    }

    // get list of locally installed apps.
    const installedAppsRes = await installedZelApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const installedApps = installedAppsRes.data;
    const appsToRemove = installedApps.filter((app) =>
      appNamesToExpire.includes(app.name)
    );
    const appsToRemoveNames = appsToRemove.map((app) => app.name);
    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      // eslint-disable-next-line no-await-in-loop
      await removeZelAppLocally(appName);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(6 * 60 * 1000); // wait for 6 mins so we dont have more
      // removals at the same time
    }
  } catch (error) {
    log.error(error);
  }
}

// check if more than 10 instances of application are running
async function checkAndRemoveApplicationInstance() {
  // function to remove global applications on this local node. Find
  // applications that are spawned more than maximum number of instances allowed
  // check if synced
  try {
    const synced = await checkSynced();
    if (synced !== true) {
      log.info('Application duplication removal paused. Not yet synced');
      return;
    }

    // get list of locally installed apps.
    const installedAppsRes = await installedZelApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const installedApps = installedAppsRes.data;
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of installedApps) {
      // eslint-disable-next-line no-await-in-loop
      const runningAppList = await getRunningAppList(installedApp.name);
      if (runningAppList.length > config.zelapps.maximumInstances) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(
          installedApp.name
        );
        if (appDetails) {
          log.info(
            `Application ${installedApp.name} is already spawned on ${runningAppList.length} instances. Checking removal availability..`
          );
          const randomNumber = Math.floor(
            Math.random() * config.zelapps.removal.probability
          );
          if (randomNumber === 0) {
            log.warn(`Removing application ${installedApp.name} locally`);
            // eslint-disable-next-line no-await-in-loop
            await removeZelAppLocally(installedApp.name);
            log.warn(`Application ${installedApp.name} locally removed`);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(config.zelapps.removal.delay * 1000); // wait for 6 mins so we dont have
            // more removals at the same time
          } else {
            log.info(
              `Other Fluxes are evaluating application ${installedApp.name} removal.`
            );
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function softRedeploy(zelappSpecs, res) {
  try {
    await softRemoveZelAppLocally(zelappSpecs.name, res);
    const zelappRedeployResponse = serviceHelper.createDataMessage(
      'Application softly removed. Awaiting installation...'
    );
    log.info(zelappRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(zelappRedeployResponse));
    }
    await serviceHelper.delay(config.zelapps.redeploy.delay * 1000); // wait for delay mins
    // run the verification
    // get tier and adjust specifications
    const tier = await zelnodeTier();
    const appSpecifications = zelappSpecs;
    if (appSpecifications.tiered) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu =
        appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram =
        appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd =
        appSpecifications[hddTier] || appSpecifications.hdd;
    }
    // verify requirements
    await checkZelAppRequirements(appSpecifications);
    // register
    await softRegisterZelAppLocally(appSpecifications, res);
    log.info('Application softly redeployed');
  } catch (error) {
    log.error(error);
    removeZelAppLocally(zelappSpecs.name, res, true);
  }
}

async function hardRedeploy(zelappSpecs, res) {
  try {
    await removeZelAppLocally(zelappSpecs.name, res, false, false);
    const zelappRedeployResponse = serviceHelper.createDataMessage(
      'Application removed. Awaiting installation...'
    );
    log.info(zelappRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(zelappRedeployResponse));
    }
    await serviceHelper.delay(config.zelapps.redeploy.delay * 1000); // wait for delay mins
    // run the verification
    // get tier and adjust specifications
    const tier = await zelnodeTier();
    const appSpecifications = zelappSpecs;
    if (appSpecifications.tiered) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu =
        appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram =
        appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd =
        appSpecifications[hddTier] || appSpecifications.hdd;
    }
    // verify requirements
    await checkZelAppRequirements(appSpecifications);
    // register
    await registerZelAppLocally(appSpecifications, res);
    log.info('Application redeployed');
  } catch (error) {
    log.error(error);
    removeZelAppLocally(zelappSpecs.name, res, true);
  }
}

async function reinstallOldApplications() {
  try {
    const synced = await checkSynced();
    if (synced !== true) {
      log.info('Checking application status paused. Not yet synced');
      return;
    }
    // first get installed zelapps
    const installedAppsRes = await installedZelApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const installedApps = installedAppsRes.data;
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of installedApps) {
      // get current zelapp specifications for the zelapp name
      // if match found. Check if hash found.
      // if same, do nothing. if different remove and install.

      // eslint-disable-next-line no-await-in-loop
      const appSpecifications = await getStrictApplicationSpecifications(
        installedApp.name
      );
      const randomNumber = Math.floor(
        Math.random() * config.zelapps.redeploy.probability
      ); // 50%
      if (appSpecifications && appSpecifications.hash !== installedApp.hash) {
        // eslint-disable-next-line no-await-in-loop
        log.warn(`Application ${installedApp.name} version is obsolete.`);
        if (randomNumber === 0) {
          // check if node is capable to run it according to specifications
          // run the verification
          // get tier and adjust specifications
          // eslint-disable-next-line no-await-in-loop
          const tier = await zelnodeTier();
          if (appSpecifications.tiered) {
            const hddTier = `hdd${tier}`;
            const ramTier = `ram${tier}`;
            const cpuTier = `cpu${tier}`;
            appSpecifications.cpu =
              appSpecifications[cpuTier] || appSpecifications.cpu;
            appSpecifications.ram =
              appSpecifications[ramTier] || appSpecifications.ram;
            appSpecifications.hdd =
              appSpecifications[hddTier] || appSpecifications.hdd;
          }

          if (appSpecifications.hdd === installedApp.hdd) {
            log.warn('Beginning Soft Redeployment...');
            // soft redeployment
            try {
              // eslint-disable-next-line no-await-in-loop
              await softRemoveZelAppLocally(installedApp.name);
              log.warn('Application softly removed. Awaiting installation...');
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.zelapps.redeploy.delay * 1000); // wait for delay mins so we dont have more removals at
              // the same time
              // eslint-disable-next-line no-await-in-loop
              await checkZelAppRequirements(appSpecifications);

              // install the app
              // eslint-disable-next-line no-await-in-loop
              await softRegisterZelAppLocally(appSpecifications);
            } catch (error) {
              log.error(error);
              removeZelAppLocally(appSpecifications.name, null, true);
            }
          } else {
            log.warn('Beginning Hard Redeployment...');
            // hard redeployment
            try {
              // eslint-disable-next-line no-await-in-loop
              await removeZelAppLocally(installedApp.name);
              log.warn('Application removed. Awaiting installation...');
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.zelapps.redeploy.delay * 1000); // wait for delay mins so we dont have more removals at
              // the same time
              // eslint-disable-next-line no-await-in-loop
              await checkZelAppRequirements(appSpecifications);

              // install the app
              // eslint-disable-next-line no-await-in-loop
              await registerZelAppLocally(appSpecifications);
            } catch (error) {
              log.error(error);
              removeZelAppLocally(appSpecifications.name, null, true);
            }
          }
        } else {
          log.info(
            'Other Fluxes are redeploying application. Waiting for next round.'
          );
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
      let zelAppSpecification = processedBody;

      zelAppSpecification = serviceHelper.ensureObject(zelAppSpecification);

      let { name } = zelAppSpecification;
      let { cpu } = zelAppSpecification;
      let { ram } = zelAppSpecification;
      let { hdd } = zelAppSpecification;
      const { tiered } = zelAppSpecification;

      // check if signature of received data is correct
      if (!name || !cpu || !ram || !hdd) {
        throw new Error('Missing ZelApp HW specification parameter');
      }

      name = serviceHelper.ensureString(name);
      cpu = serviceHelper.ensureNumber(cpu);
      ram = serviceHelper.ensureNumber(ram);
      hdd = serviceHelper.ensureNumber(hdd);
      if (typeof tiered !== 'boolean') {
        throw new Error(
          'Invalid tiered value obtained. Only boolean as true or false allowed.'
        );
      }

      // finalised parameters that will get stored in global database
      const zelAppSpecFormatted = {
        name, // string
        cpu, // float 0.1 step
        ram, // integer 100 step (mb)
        hdd, // integer 1 step
        tiered, // boolean
      };

      if (tiered) {
        let { cpubasic } = zelAppSpecification;
        let { cpusuper } = zelAppSpecification;
        let { cpubamf } = zelAppSpecification;
        let { rambasic } = zelAppSpecification;
        let { ramsuper } = zelAppSpecification;
        let { rambamf } = zelAppSpecification;
        let { hddbasic } = zelAppSpecification;
        let { hddsuper } = zelAppSpecification;
        let { hddbamf } = zelAppSpecification;
        if (
          !cpubasic ||
          !cpusuper ||
          !cpubamf ||
          !rambasic ||
          !ramsuper ||
          !rambamf ||
          !hddbasic ||
          !hddsuper ||
          !hddbamf
        ) {
          throw new Error(
            'ZelApp was requested as tiered setup but specifications are missing'
          );
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

        zelAppSpecFormatted.cpubasic = cpubasic;
        zelAppSpecFormatted.cpusuper = cpusuper;
        zelAppSpecFormatted.cpubamf = cpubamf;
        zelAppSpecFormatted.rambasic = rambasic;
        zelAppSpecFormatted.ramsuper = ramsuper;
        zelAppSpecFormatted.rambamf = rambamf;
        zelAppSpecFormatted.hddbasic = hddbasic;
        zelAppSpecFormatted.hddsuper = hddsuper;
        zelAppSpecFormatted.hddbamf = hddbamf;
      }
      const parameters = checkHWParameters(zelAppSpecFormatted);
      if (parameters !== true) {
        const errorMessage = parameters;
        throw new Error(errorMessage);
      }

      // check if app exists or its a new registration price
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.zelappsglobal.database);
      // may throw
      const query = { name: zelAppSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const zelappInfo = await serviceHelper.findOneInDatabase(
        database,
        globalZelAppsInformation,
        query,
        projection
      );
      let actualPriceToPay = appPricePerMonth(zelAppSpecFormatted);
      if (zelappInfo) {
        const previousSpecsPrice = appPricePerMonth(zelappInfo);
        // what is the height difference
        const zelcashGetInfo = await zelcashService.getInfo();
        let zelcashHeight;
        if (zelcashGetInfo.status === 'success') {
          zelcashHeight = zelcashGetInfo.data.blocks;
        } else {
          throw new Error(zelcashGetInfo.data.message || zelcashGetInfo.data);
        }
        const heightDifference = zelcashHeight - zelappInfo.height; // has to be lower than 22000
        const perc =
          (config.zelapps.blocksLasting - heightDifference) /
          config.zelapps.blocksLasting;
        if (perc > 0) {
          actualPriceToPay -= perc * previousSpecsPrice;
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
        error.code
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
      throw new Error('No ZelApp specified');
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    const authorized = await serviceHelper.verifyPrivilege(
      'appownerabove',
      req,
      appname
    );
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function whitelistedRepositories(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet(
      'https://zel.network/project/zelflux/repositories.html'
    );
    const resultsResponse = serviceHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function whitelistedZelIDs(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet(
      'https://zel.network/project/zelflux/zelids.html'
    );
    const resultsResponse = serviceHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelShareDatabaseFileDelete(file) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseZelShare = dbopen.db(config.database.zelshare.database);
    const sharedCollection = config.database.zelshare.collections.shared;
    const queryZelShare = { name: file };
    const projectionZelShare = { projection: { _id: 0, name: 1, token: 1 } };
    await serviceHelper.findOneAndDeleteInDatabase(
      databaseZelShare,
      sharedCollection,
      queryZelShare,
      projectionZelShare
    );
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

// removes documents that starts with the path queried
async function zelShareDatabaseFileDeleteMultiple(pathstart) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseZelShare = dbopen.db(config.database.zelshare.database);
    const sharedCollection = config.database.zelshare.collections.shared;
    const queryZelShare = {
      name: new RegExp(`^${pathstart}`),
    }; // has to start with this path
    await serviceHelper.removeDocumentsFromCollection(
      databaseZelShare,
      sharedCollection,
      queryZelShare
    );
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

function getZelShareSize() {
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
  return totalSize / 1e9; // in 'GB'
}

function getZelShareSpecificFolderSize(folder) {
  const arrayOfFiles = getAllFiles(folder);

  let totalSize = 0;

  arrayOfFiles.forEach((filePath) => {
    try {
      totalSize += fs.statSync(filePath).size;
    } catch (error) {
      log.warn(error);
    }
  });
  return totalSize; // in 'B'
}

async function zelShareDatabaseShareFile(file) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseZelShare = dbopen.db(config.database.zelshare.database);
    const sharedCollection = config.database.zelshare.collections.shared;
    const queryZelShare = { name: file };
    const projectionZelShare = { projection: { _id: 0, name: 1, token: 1 } };
    const result = await serviceHelper.findOneInDatabase(
      databaseZelShare,
      sharedCollection,
      queryZelShare,
      projectionZelShare
    );
    if (result) {
      return result;
    }
    const string =
      file +
      new Date().getTime().toString() +
      Math.floor(Math.random() * 999999999999999).toString();

    const fileDetail = {
      name: file,
      token: crypto.createHash('sha256').update(string).digest('hex'),
    };
    // put the utxo to our mongoDB utxoIndex collection.
    await serviceHelper.insertOneToDatabase(
      databaseZelShare,
      sharedCollection,
      fileDetail
    );
    return fileDetail;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function zelShareSharedFiles() {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const databaseZelShare = dbopen.db(config.database.zelshare.database);
    const sharedCollection = config.database.zelshare.collections.shared;
    const queryZelShare = {};
    const projectionZelShare = { projection: { _id: 0, name: 1, token: 1 } };
    const results = await serviceHelper.findInDatabase(
      databaseZelShare,
      sharedCollection,
      queryZelShare,
      projectionZelShare
    );
    return results;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function zelShareGetSharedFiles(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      const files = await zelShareSharedFiles();
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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function zelShareUnshareFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      file = encodeURIComponent(file);
      await zelShareDatabaseFileDelete(file);
      const resultsResponse = serviceHelper.createSuccessMessage(
        'File sharing disabled'
      );
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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function zelShareShareFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      file = encodeURIComponent(file);
      const fileDetails = await zelShareDatabaseShareFile(file);
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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

// ZelShare specific
async function zelShareDownloadFolder(req, res, authorized = false) {
  try {
    let auth = authorized;
    if (!auth) {
      auth = await serviceHelper.verifyPrivilege('admin', req);
    }

    if (auth) {
      let { folder } = req.params;
      folder = folder || req.query.folder;

      if (!folder) {
        const errorResponse = serviceHelper.createErrorMessage(
          'No folder specified'
        );
        res.json(errorResponse);
        return;
      }

      const dirpath = path.join(__dirname, '../../../');
      const folderpath = `${dirpath}ZelApps/ZelShare/${folder}`;

      // beautify name
      const folderNameArray = folderpath.split('/');
      const folderName = folderNameArray[folderNameArray.length - 1];

      // const size = getZelShareSpecificFolderSize(folderpath);

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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function zelShareDownloadFile(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;

      if (!file) {
        const errorResponse = serviceHelper.createErrorMessage(
          'No file specified'
        );
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
      const databaseZelShare = dbopen.db(config.database.zelshare.database);
      const sharedCollection = config.database.zelshare.collections.shared;
      const queryZelShare = { name: fileURI, token };
      const projectionZelShare = { projection: { _id: 0, name: 1, token: 1 } };
      const result = await serviceHelper.findOneInDatabase(
        databaseZelShare,
        sharedCollection,
        queryZelShare,
        projectionZelShare
      );
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
        zelShareDownloadFolder(modifiedReq, res, true);
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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

// oldpath is relative path to default zelshare directory; newname is just a new
// name of folder/file
async function zelShareRename(req, res) {
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
      await zelShareDatabaseFileDeleteMultiple(fileURI);

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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function zelShareRemoveFile(req, res) {
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

      await zelShareDatabaseFileDelete(fileURI);

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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function zelShareRemoveFolder(req, res) {
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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function zelShareGetFolder(req, res) {
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
      let sharedFiles = await zelShareSharedFiles().catch((error) => {
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
        const fileShared = sharedFiles.find(
          (sharedfile) => sharedfile.name === fileURI
        );
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
          fileFolderSize = getZelShareSpecificFolderSize(`${filepath}/${file}`);
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelShareCreateFolder(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;

      await fs.promises.mkdir(filepath);

      const resultsResponse = serviceHelper.createSuccessMessage(
        'Folder Created'
      );
      res.json(resultsResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelShareFileExists(req, res) {
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
      error.code
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

async function getSpaceAvailableForZelShare() {
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
    if (
      volume.filesystem.includes('/dev/') &&
      !volume.filesystem.includes('loop') &&
      !volume.mount.includes('boot')
    ) {
      okVolumes.push(volume);
    } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
      okVolumes.push(volume);
    }
  });

  // now we know that most likely there is a space available. IF user does not
  // have his own stuff on the node or space may be sharded accross hdds.
  let totalSpace = 0;
  okVolumes.forEach((volume) => {
    totalSpace += serviceHelper.ensureNumber(volume.size);
  });
  // space that is further reserved for zelflux os and that will be later
  // substracted from available space. Max 30.
  const tier = await zelnodeTier();
  const lockedSpaceOnNode = config.fluxSpecifics.hdd[tier];

  const extraSpaceOnNode =
    totalSpace - lockedSpaceOnNode > 0 ? totalSpace - lockedSpaceOnNode : 0; // shall always be above 0. Put precaution to place anyway
  // const extraSpaceOnNode = availableSpace - lockedSpaceOnNode > 0 ?
  // availableSpace - lockedSpaceOnNode : 0;
  const spaceAvailableForZelShare = 2 + extraSpaceOnNode;
  return spaceAvailableForZelShare;
}

async function zelShareStorageStats(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized) {
      const spaceAvailableForZelShare = await getSpaceAvailableForZelShare();
      let spaceUsedByZelShare = getZelShareSize();
      spaceUsedByZelShare = Number(spaceUsedByZelShare.toFixed(6));
      const data = {
        available: spaceAvailableForZelShare - spaceUsedByZelShare,
        used: spaceUsedByZelShare,
        total: spaceAvailableForZelShare,
      };
      const resultsResponse = serviceHelper.createDataMessage(data);
      res.json(resultsResponse);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function zelShareUpload(req, res) {
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
    const spaceAvailableForZelShare = await getSpaceAvailableForZelShare();
    let spaceUsedByZelShare = getZelShareSize();
    spaceUsedByZelShare = Number(spaceUsedByZelShare.toFixed(6));
    const available = spaceAvailableForZelShare - spaceUsedByZelShare;
    if (available <= 0) {
      throw new Error('ZelShare Storage is full');
    }
    // eslint-disable-next-line no-bitwise
    await fs.promises.access(uploadDir, fs.constants.F_OK | fs.constants.W_OK); // check folder exists and write ability
    const form = formidable(options);
    form
      .parse(req)
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
          error.code
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
  zelAppPull,
  listRunningZelApps,
  listAllZelApps,
  listZelAppsImages,
  zelAppStart,
  zelAppStop,
  zelAppRestart,
  zelAppKill,
  zelAppPause,
  zelAppUnpause,
  zelAppTop,
  zelAppLog,
  zelAppLogStream,
  zelAppInspect,
  zelAppStats,
  zelAppChanges,
  zelAppExec,
  zelFluxUsage,
  removeZelAppLocally,
  registerZelAppLocally,
  registerZelAppGlobalyApi,
  createZelFluxNetwork,
  removeZelAppLocallyApi,
  installedZelApps,
  availableZelApps,
  zelappsResources,
  checkZelAppMessageExistence,
  checkAndRequestZelApp,
  checkDockerAccessibility,
  registrationInformation,
  appPricePerMonth,
  getZelAppsTemporaryMessages,
  getZelAppsPermanentMessages,
  getGlobalZelAppsSpecifications,
  storeZelAppTemporaryMessage,
  verifyRepository,
  checkHWParameters,
  messageHash,
  verifyAppHash,
  verifyZelAppMessageSignature,
  reindexGlobalAppsInformation,
  rescanGlobalAppsInformation,
  continuousZelAppHashesCheck,
  getZelAppHashes,
  getZelAppsLocation,
  getZelAppsLocations,
  storeZelAppRunningMessage,
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
  updateZelAppGlobalyApi,
  getAppPrice,
  reinstallOldApplications,
  checkAndRemoveApplicationInstance,
  checkZelAppTemporaryMessageExistence,
  softRegisterZelAppLocally,
  softRemoveZelAppLocally,
  softRedeploy,
  redeployAPI,
  whitelistedRepositories,
  whitelistedZelIDs,
  zelShareDownloadFile,
  zelShareGetFolder,
  zelShareCreateFolder,
  zelShareUpload,
  zelShareRemoveFile,
  zelShareRemoveFolder,
  zelShareFileExists,
  zelShareStorageStats,
  zelShareUnshareFile,
  zelShareShareFile,
  zelShareGetSharedFiles,
  zelShareRename,
  zelShareDownloadFolder,
};

// reenable min connections for registrations/updates before main release
