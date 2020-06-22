const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
const crypto = require('crypto');
const Docker = require('dockerode');
const stream = require('stream');
const path = require('path');
const nodecmd = require('node-cmd');
const df = require('node-df');
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

const docker = new Docker();

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;
const scannedHeightCollection = config.database.zelcash.collections.scannedHeight;
const localZelAppsInformation = config.database.zelappslocal.collections.zelappsInformation;
const globalZelAppsMessages = config.database.zelappsglobal.collections.zelappsMessages;
const globalZelAppsInformation = config.database.zelappsglobal.collections.zelappsInformation;
const globalZelAppsTempMessages = config.database.zelappsglobal.collections.zelappsTemporaryMessages;

function getZelAppIdentifier(zelappName) {
  // this id is used for volumes, docker names so we know it reall belongs to zelflux
  if (zelappName.startsWith('zel')) {
    return zelappName;
  }
  return `zel${zelappName}`;
}

function getCollateralInfo(collateralOutpoint) {
  const a = collateralOutpoint;
  const b = a.split(', ');
  const txhash = b[0].substr(10, b[0].length);
  const txindex = serviceHelper.ensureNumber(b[1].split(')')[0]);
  return { txhash, txindex };
}

async function dockerCreateNetwork(options) {
  const network = await docker.createNetwork(options).catch((error) => {
    throw error;
  });
  return network;
}

async function dockerNetworkInspect(netw) {
  const network = await netw.inspect().catch((error) => {
    throw error;
  });
  return network;
}

async function dockerListContainers(all, limit, size, filter) {
  const options = {
    all,
    limit,
    size,
    filter,
  };
  const containers = await docker.listContainers(options).catch((error) => {
    throw error;
  });
  return containers;
}

async function dockerListImages() {
  const containers = await docker.listImages().catch((error) => {
    throw error;
  });
  return containers;
}

async function dockerContainerInspect(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);
  const response = await dockerContainer.inspect().catch((error) => {
    throw error;
  });
  return response;
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

// TODO look into
function dockerContainerExec(container, cmd, env, res, callback) {
  try {
    const logStream = new stream.PassThrough();
    let logStreamData = '';
    logStream.on('data', (chunk) => {
      console.log(chunk.toString('utf8'));
      res.write(serviceHelper.ensureString(chunk.toString('utf8')));
      logStreamData += chunk.toString('utf8');
    });
    console.log(cmd);

    container.exec(
      {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd,
        Env: env,
        Tty: false,
      },
      (error, exec) => {
        if (error) {
          console.log(error);
          callback(error);
        } else {
          exec.start(
            {
              hijack: true,
              stdin: true,
              stdout: true,
              stderr: true,
            },
            (err, mystream) => {
              if (err) {
                console.log(err);
                callback(err);
              } else {
                try {
                  container.modem.demuxStream(mystream, logStream, logStream);
                  mystream.on('end', () => {
                    logStream.end();
                    callback(null, logStreamData);
                  });

                  setTimeout(() => {
                    mystream.destroy();
                  }, 2000);
                } catch (errr) {
                  throw new Error({
                    message:
                      'An error obtaining log data of an application has occured',
                  });
                }
              }
            },
          );
        }
      },
    );
  } catch (error) {
    throw new Error({
      message: 'An error obtaining log data of an application has occured',
    });
  }
}

async function dockerContainerLogs(idOrName, callback) {
  try {
    // container ID or name
    const containers = await dockerListContainers(true);
    const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
    const dockerContainer = docker.getContainer(myContainer.Id);
    const logStream = new stream.PassThrough();
    let logStreamData = '';
    logStream.on('data', (chunk) => {
      logStreamData += chunk.toString('utf8');
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
              callback(null, logStreamData);
            });

            setTimeout(() => {
              mystream.destroy();
            }, 2000);
          } catch (error) {
            throw new Error({
              message:
                'An error obtaining log data of an application has occured',
            });
          }
        }
      },
    );
  } catch (error) {
    throw new Error({
      message: 'An error obtaining log data of an application has occured',
    });
  }
}

async function zelAppPull(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
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

async function listRunningZelApps(req, res) {
  let zelapps = await dockerListContainers(false).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    return res ? res.json(errMessage) : errMessage;
  });
  try {
    if (zelapps.length > 0) {
      zelapps = zelapps.filter((zelapp) => zelapp.Names[0].substr(1, 3) === 'zel');
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
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function listAllZelApps(req, res) {
  let zelapps = await dockerListContainers(true).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    return res ? res.json(errMessage) : errMessage;
  });
  try {
    if (zelapps.length > 0) {
      zelapps = zelapps.filter((zelapp) => zelapp.Names[0].substr(1, 3) === 'zel');
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
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function listZelAppsImages(req, res) {
  const zelapps = await dockerListImages().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappsResponse = serviceHelper.createDataMessage(zelapps);
  return res ? res.json(zelappsResponse) : zelappsResponse;
}

async function zelnodeTier() {
  // get our collateral information to decide if app specifications are basic, super, bamf
  // getzlenodestatus.collateral
  const zelnodeStatus = await zelcashService.getZelNodeStatus();
  if (zelnodeStatus.status === 'error') {
    throw zelnodeStatus.data;
  }
  const collateralInformation = getCollateralInfo(zelnodeStatus.data.collateral);
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
    HostConfig: {
      NanoCPUs: zelAppSpecifications.cpu * 1e9,
      Memory: zelAppSpecifications.ram * 1024 * 1024,
      Binds: [`${zelappsFolder + getZelAppIdentifier(zelAppSpecifications.name)}:${zelAppSpecifications.containerData}`],
      Ulimits: [
        {
          Name: 'nofile',
          Soft: 8192,
          Hard: 16384,
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
  try {
    // container ID or name
    const containers = await dockerListContainers(true);
    const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
    const dockerContainer = docker.getContainer(myContainer.Id);

    await dockerContainer.start();
    return `ZelApp ${idOrName} successfully started.`;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function zelAppDockerStop(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.stop().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} successfully stopped.`;
}

async function zelAppDockerRestart(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.restart().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} successfully restarted.`;
}

async function zelAppDockerKill(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.kill().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} successfully killed.`;
}

async function zelAppDockerRemove(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.remove().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} successfully removed.`;
}

async function zelAppDockerImageRemove(idOrName) {
  // container ID or name
  const dockerImage = docker.getImage(idOrName);

  await dockerImage.remove().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} image successfully removed.`;
}

async function zelAppDockerPause(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.pause().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} successfully paused.`;
}

async function zelAppDockerUnpase(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  await dockerContainer.unpause().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} successfully unpaused.`;
}

async function zelAppDockerTop(idOrName) {
  // container ID or name
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (serviceHelper.ensureString(container.Names).includes(idOrName) || serviceHelper.ensureString(container.Id).includes(idOrName)));
  const dockerContainer = docker.getContainer(myContainer.Id);

  const processes = await dockerContainer.top().catch((error) => {
    log.error(error);
    throw error;
  });
  return processes;
}

async function zelAppStart(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerStart(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });
  if (!zelappRes) {
    return 0;
  }
  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppStop(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerStop(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppRestart(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerRestart(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppKill(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerKill(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppRemove(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerRemove(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppImageRemove(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { image } = req.params;
  image = image || req.query.image;

  if (!image) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp image specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerImageRemove(image).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppPause(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerPause(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppUnpause(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerUnpase(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppTop(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  // List processes running inside a container
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerTop(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  });

  if (!zelappRes) {
    return 0;
  }

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (authorized) {
      let { container } = req.params;
      container = container || req.query.container;

      if (!container) {
        throw new Error('No ZelApp specified');
      }

      dockerContainerLogs(container, (error, dataLog) => {
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

async function zelAppInspect(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const response = await dockerContainerInspect(container).catch(
    (error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code,
      );
      log.error(error);
      res.json(errMessage);
      throw error;
    },
  );
  const zelappResponse = serviceHelper.createDataMessage(response);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppUpdate(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { container } = req.params;
  container = container || req.query.container;

  let { cpus } = req.params;
  cpus = cpus || req.query.cpus;

  let { memory } = req.params;
  memory = memory || req.query.memory;

  const dockerContainer = docker.getContainer(container);
  const updateCommand = {};
  if (cpus) {
    cpus = serviceHelper.ensureNumber(cpus);
    cpus *= 1e9;
    updateCommand.NanoCPUs = cpus;
    if (Number.isNaN(cpus)) {
      const errMessage = serviceHelper.createErrorMessage('Invalid cpu count');
      return res.json(errMessage);
    }
  }
  // memory in bytes
  if (memory) {
    memory = serviceHelper.ensureNumber(memory);
    updateCommand.memory = memory;
    if (Number.isNaN(memory)) {
      const errMessage = serviceHelper.createErrorMessage(
        'Invalid memory count',
      );
      return res.json(errMessage);
    }
  }

  console.log(updateCommand);

  const response = await dockerContainer.update(updateCommand).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(response);
  return res ? res.json(zelappResponse) : zelappResponse;
}

// todo needs post
async function zelAppExec(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (authorized) {
      let { container } = req.params;
      container = container || req.query.container;

      let { cmd } = req.params;
      cmd = cmd || req.query.cmd;

      let { env } = req.params;
      env = env || req.query.env;

      if (cmd) {
        // must be an array
        cmd = serviceHelper.ensureObject(cmd);
      } else {
        cmd = [];
      }

      if (env) {
        // must be an array
        env = serviceHelper.ensureObject(env);
      } else {
        env = [];
      }

      const dockerContainer = docker.getContainer(container);

      dockerContainerExec(dockerContainer, cmd, env, res, (error, dataLog) => {
        if (error) {
          const errorResponse = serviceHelper.createErrorMessage(
            error.message,
            error.name,
            error.code,
          );
          res.json(errorResponse);
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

async function zelShareFile(req, res) {
  let { file } = req.params;
  file = file || req.query.file;

  const dirpath = path.join(__dirname, '../../../');
  const filepath = `${dirpath}ZelApps/ZelShare/${file}`;

  return res.sendFile(filepath);
}

async function createFluxNetwork() {
  // check if zelfluxDockerNetwork exists
  const fluxNetworkOptions = {
    Name: 'zelfluxDockerNetwork',
    IPAM: {
      Config: [{
        Subnet: '172.16.0.0/16',
        Gateway: '172.16.0.1',
      }],
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  try {
    const dockerRes = await createFluxNetwork();
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

async function zelFluxUsage(req, res) {
  try {
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });
    const database = dbopen.db(config.database.zelcash.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection).catch((error) => {
      dbopen.close();
      throw error;
    });
    if (!result) {
      log.error('Scanning not initiated');
    }
    let explorerHeight = 999999999;
    if (result) {
      explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight) || 999999999;
    }
    const zelcashGetInfo = await zelcashService.getInfo();
    let zelcashHeight = 1;
    if (zelcashGetInfo.status === 'success') {
      zelcashHeight = zelcashGetInfo.data.blocks;
    } else {
      log.error(zelcashGetInfo.data);
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
    if (explorerHeight < (zelcashHeight - 5)) {
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
    const zelappsResult = await serviceHelper.findInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
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
    dbopen.close();
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

async function zelappsResources(req, res) {
  try {
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });
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
    const zelappsResult = await serviceHelper.findInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
    dbopen.close();
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
      error.code,
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

  const dfres = await dfAsync(options).catch((error) => {
    throw error;
  });
  const okVolumes = [];
  dfres.forEach((volume) => {
    if (volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop') && !volume.mount.includes('boot')) {
      okVolumes.push(volume);
    } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
      okVolumes.push(volume);
    }
  });
  console.log(okVolumes);
  // todo get tier
  const tier = await zelnodeTier();
  const totalSpaceOnNode = config.fluxSpecifics.hdd[tier];
  const useableSpaceOnNode = totalSpaceOnNode - config.lockedSystemResources.hdd;
  const resourcesLocked = await zelappsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by ZelApps. Aborting.');
  }
  const hddLockedByApps = resourcesLocked.data.zelAppsHddLocked;
  const availableSpaceForZelApps = useableSpaceOnNode - hddLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (zelAppSpecifications.hdd >= availableSpaceForZelApps) {
    throw new Error('Insufficient space on ZelNode to spawn an application');
  }
  // now we know that most likely there is a space available. IF user does not have his own stuff on the node or space may be sharded accross hdds.
  let usedSpace = 0;
  let availableSpace = 0;
  okVolumes.forEach((volume) => {
    usedSpace += serviceHelper.ensureNumber(volume.used);
    availableSpace += serviceHelper.ensureNumber(volume.available);
  });
  // space that is further reserved for zelflux os and that will be later substracted from available space. Max 30.
  const zelfluxSystemReserve = 30 - usedSpace > 0 ? 30 - usedSpace : 0;
  const totalAvailableSpaceLeft = availableSpace - zelfluxSystemReserve;
  if (zelAppSpecifications.hdd >= totalAvailableSpaceLeft) {
    // sadly user free space is not enough for this application
    throw new Error('Insufficient space on ZelNode. Space is already assigned to system files');
  }

  // check if space is not sharded in some bad way. Always count the zelfluxSystemReserve
  let useThisVolume = null;
  const totalVolumes = okVolumes.length;
  for (let i = 0; i < totalVolumes; i += 1) {
    // check available volumes one by one. If a sufficient is found. Use this one.
    if (okVolumes[i].available > zelAppSpecifications.hdd + zelfluxSystemReserve) {
      useThisVolume = okVolumes[i];
      break;
    }
  }
  if (!useThisVolume) {
    // no useable volume has such a big space for the app
    throw new Error('Insufficient space on ZelNode. No useable volume found.');
  }

  // now we know there is a space and we have a volum we can operate with. Let's do volume magic
  const searchSpace2 = {
    status: 'Space found',
  };
  log.info(searchSpace2);
  if (res) {
    res.write(serviceHelper.ensureString(searchSpace2));
  }

  const allocateSpace = {
    status: 'Allocating space, this may take a while...',
  };
  log.info(allocateSpace);
  if (res) {
    res.write(serviceHelper.ensureString(allocateSpace));
  }
  // space hdd * 10, thats why 0 at the end. As we have 100mb bs.
  let execDD = `sudo dd if=/dev/zero of=${useThisVolume.mount}/${zelappId}TEMP bs=107374182 count=${zelAppSpecifications.hdd}0`; // eg /mnt/sthMounted/zelappTEMP
  if (useThisVolume.mount === '/') {
    execDD = `sudo dd if=/dev/zero of=${useThisVolume.mount}tmp/${zelappId}TEMP bs=107374182 count=${zelAppSpecifications.hdd}0`; // if root mount then temp file is /tmp/zelappTEMP
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
  let execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}/${zelappId}TEMP`;
  if (useThisVolume.mount === '/') {
    execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}tmp/${zelappId}TEMP`;
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
  let execMount = `sudo mount -o loop ${useThisVolume.mount}/${zelappId}TEMP ${zelappsFolder + zelappId}`;
  if (useThisVolume.mount === '/') {
    execMount = `sudo mount -o loop ${useThisVolume.mount}tmp/${zelappId}TEMP ${zelappsFolder + zelappId}`;
  }
  await cmdAsync(execMount);
  const mountingStatus2 = {
    status: 'Volume mounted',
  };
  log.info(execMount);
  if (res) {
    res.write(serviceHelper.ensureString(mountingStatus2));
  }

  const aloocationRemoval = {
    status: 'Removing allocation...',
  };
  log.info(aloocationRemoval);
  if (res) {
    res.write(serviceHelper.ensureString(aloocationRemoval));
  }
  let execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}/${zelappId}TEMP`;
  if (useThisVolume.mount === '/') {
    execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}tmp/${zelappId}TEMP`;
  }
  await cmdAsync(execRemoveAlloc);
  const aloocationRemoval2 = {
    status: 'Allocation removed',
  };
  log.info(aloocationRemoval2);
  if (res) {
    res.write(serviceHelper.ensureString(aloocationRemoval2));
  }

  const spaceVerification = {
    status: 'Beginning space verification. This may take a while...',
  };
  log.info(spaceVerification);
  if (res) {
    res.write(serviceHelper.ensureString(spaceVerification));
  }
  const execVerif = `sudo dd if=/dev/zero of=${zelappsFolder + zelappId}/${zelappId}VERTEMP bs=96636763 count=${zelAppSpecifications.hdd}0`; // 90%
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
  const execFinal = `sudo rm -rf ${zelappsFolder + zelappId}/${zelappId}VERTEMP`;
  await cmdAsync(execFinal);
  const finaliseSpace2 = {
    status: `Space for ZelApp ${zelAppSpecifications.name} created and assigned.`,
  };
  log.info(finaliseSpace2);
  if (res) {
    res.write(serviceHelper.ensureString(finaliseSpace2));
  }
  const message = serviceHelper.createSuccessMessage('ZelApp volume creation completed.');
  return message;
}

async function removeZelAppLocally(zelapp, res) {
  try {
    // remove zelapp from local machine.
    // find in database, stop zelapp, remove container, close port delete data associated on system, remove from database
    // todo do we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
    if (!zelapp) {
      throw new Error('No ZelApp specified');
    }

    const zelappId = getZelAppIdentifier(zelapp);

    // first find the zelAppSpecifications in our database.
    // connect to mongodb
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { name: zelapp };
    const zelappsProjection = {};
    const zelAppSpecifications = await serviceHelper.findOneInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
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
    await zelAppDockerStop(zelappId).catch((error) => {
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.write(serviceHelper.ensureString(errorResponse));
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
        error.code,
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
    await zelAppDockerImageRemove(zelAppSpecifications.repotag).catch((error) => {
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
    const execDelete = `sudo rm -rf ${zelappsFolder + zelappId}`;
    await cmdAsync(execDelete);
    const cleaningStatus2 = {
      status: 'Data cleaned',
    };
    log.info(cleaningStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningStatus2));
    }

    const databaseStatus = {
      status: 'Cleaning up database...',
    };
    log.info(databaseStatus);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus));
    }
    await serviceHelper.findOneAndDeleteInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
    const databaseStatus2 = {
      status: 'Database cleaned',
    };
    log.info(databaseStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus2));
    }
    dbopen.close();

    const zelappRemovalResponse = serviceHelper.createDataMessage(`ZelApp ${zelapp} was successfuly removed`);
    log.info(zelappRemovalResponse);
    if (res) {
      res.write(serviceHelper.ensureString(zelappRemovalResponse));
      res.end();
    }
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

async function removeZelAppLocallyApi(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    } else {
      // remove zelapp from local machine.
      // find in database, stop zelapp, remove container, close port delete data associated on system, remove from database
      // todo do we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
      let { zelapp } = req.params;
      zelapp = zelapp || req.query.zelapp;

      if (!zelapp) {
        throw new Error('No ZelApp specified');
      }

      res.setHeader('Content-Type', 'application/json');
      removeZelAppLocally(zelapp, res);
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

async function registerZelAppLocally(zelAppSpecifications, res) {
  // TODOs
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
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });

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
    const zelappResult = await serviceHelper.findOneInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });

    if (!zelappResult) {
      // register the zelapp
      await serviceHelper.insertOneToDatabase(zelappsDatabase, localZelAppsInformation, zelAppSpecifications).catch((error) => {
        dbopen.close();
        throw error;
      });
      dbopen.close();
    } else {
      dbopen.close();
      throw new Error('ZelApp already installed');
    }

    const zelAppInstallation = {
      status: 'Initiating ZelApp installation...',
    };
    log.info(zelAppInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(zelAppInstallation));
    }

    // pull image
    // eslint-disable-next-line no-unused-vars
    dockerPullStream(zelAppSpecifications.repotag, res, async (error, dataLog) => {
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
        const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating ZelApp removal');
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

        const volumeOK = await createZelAppVolume(zelAppSpecifications, res).catch((errr) => {
          const errorResponse = serviceHelper.createErrorMessage(
            errr.message || errr,
            errr.name,
            errr.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }

          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating ZelApp removal');
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

        const dockerCreated = await zelAppDockerCreate(zelAppSpecifications).catch((e) => {
          const errorResponse = serviceHelper.createErrorMessage(
            e.message || e,
            e.name,
            e.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating ZelApp removal');
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
        const portResponse = await zelfluxCommunication.allowPort(zelAppSpecifications.port);
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
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating ZelApp removal');
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
        const zelapp = await zelAppDockerStart(getZelAppIdentifier(zelAppSpecifications.name)).catch((error2) => {
          const errorResponse = serviceHelper.createErrorMessage(
            error2.message || error2,
            error2.name,
            error2.code,
          );
          log.error(errorResponse);
          if (res) {
            res.write(serviceHelper.ensureString(errorResponse));
          }
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating ZelApp removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeZelAppLocally(zelappName, res);
        });
        if (!zelapp) {
          const removeStatus = serviceHelper.createErrorMessage('Error occured. Initiating ZelApp removal');
          log.info(removeStatus);
          if (res) {
            res.write(serviceHelper.ensureString(removeStatus));
          }
          removeZelAppLocally(zelappName, res);
          return;
        }
        const zelappResponse = serviceHelper.createDataMessage(zelapp);
        log.info(zelappResponse);
        if (res) {
          res.write(serviceHelper.ensureString(zelappResponse));
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

function appPricePerMonth(dataForZelAppRegistration) {
  if (!dataForZelAppRegistration) {
    return new Error('Application specification not provided');
  }
  if (dataForZelAppRegistration.tiered) {
    const cpuTotalCount = dataForZelAppRegistration.cpubasic + dataForZelAppRegistration.cpusuper + dataForZelAppRegistration.cpubamf;
    const cpuPrice = cpuTotalCount * config.zelapps.price.cpu * 10;
    const cpuTotal = cpuPrice / 3;
    const ramTotalCount = dataForZelAppRegistration.rambasic + dataForZelAppRegistration.ramsuper + dataForZelAppRegistration.rambamf;
    const ramPrice = (ramTotalCount * config.zelapps.price.ram) / 100;
    const ramTotal = ramPrice / 3;
    const hddTotalCount = dataForZelAppRegistration.hddbasic + dataForZelAppRegistration.hddsuper + dataForZelAppRegistration.hddbamf;
    const hddPrice = hddTotalCount * config.zelapps.price.hdd;
    const hddTotal = hddPrice / 3;
    return Math.ceil(cpuTotal + ramTotal + hddTotal);
  }
  const cpuTotal = dataForZelAppRegistration.cpu * config.zelapps.price.cpu * 10;
  const ramTotal = (dataForZelAppRegistration.ram * config.zelapps.price.ram) / 100;
  const hddTotal = dataForZelAppRegistration.hdd * config.zelapps.price.hdd;
  return Math.ceil(cpuTotal + ramTotal + hddTotal);
}

function checkHWParameters(zelAppSpecs) {
  // check specs parameters. JS precision
  if ((zelAppSpecs.cpu * 10) % 1 !== 0 || (zelAppSpecs.cpu * 10) > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu) || zelAppSpecs.cpu < 0.1) {
    return new Error('CPU badly assigned');
  }
  if (zelAppSpecs.ram % 100 !== 0 || zelAppSpecs.ram > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram) || zelAppSpecs.ram < 100) {
    return new Error('RAM badly assigned');
  }
  if (zelAppSpecs.hdd % 1 !== 0 || zelAppSpecs.hdd > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd) || zelAppSpecs.hdd < 1) {
    return new Error('SSD badly assigned');
  }
  if (zelAppSpecs.tiered) {
    if ((zelAppSpecs.cpubasic * 10) % 1 !== 0 || (zelAppSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.basic - config.lockedSystemResources.cpu) || zelAppSpecs.cpubasic < 0.1) {
      return new Error('CPU for BASIC badly assigned');
    }
    if (zelAppSpecs.rambasic % 100 !== 0 || zelAppSpecs.rambasic > (config.fluxSpecifics.ram.basic - config.lockedSystemResources.ram) || zelAppSpecs.rambasic < 100) {
      return new Error('RAM for BASIC badly assigned');
    }
    if (zelAppSpecs.hddbasic % 1 !== 0 || zelAppSpecs.hddbasic > (config.fluxSpecifics.hdd.basic - config.lockedSystemResources.hdd) || zelAppSpecs.hddbasic < 1) {
      return new Error('SSD for BASIC badly assigned');
    }
    if ((zelAppSpecs.cpusuper * 10) % 1 !== 0 || (zelAppSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.super - config.lockedSystemResources.cpu) || zelAppSpecs.cpusuper < 0.1) {
      return new Error('CPU for SUPER badly assigned');
    }
    if (zelAppSpecs.ramsuper % 100 !== 0 || zelAppSpecs.ramsuper > (config.fluxSpecifics.ram.super - config.lockedSystemResources.ram) || zelAppSpecs.ramsuper < 100) {
      return new Error('RAM for SUPER badly assigned');
    }
    if (zelAppSpecs.hddsuper % 1 !== 0 || zelAppSpecs.hddsuper > (config.fluxSpecifics.hdd.super - config.lockedSystemResources.hdd) || zelAppSpecs.hddsuper < 1) {
      return new Error('SSD for SUPER badly assigned');
    }
    if ((zelAppSpecs.cpubamf * 10) % 1 !== 0 || (zelAppSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.bamf - config.lockedSystemResources.cpu) || zelAppSpecs.cpubamf < 0.1) {
      return new Error('CPU for BAMF badly assigned');
    }
    if (zelAppSpecs.rambamf % 100 !== 0 || zelAppSpecs.rambamf > (config.fluxSpecifics.ram.bamf - config.lockedSystemResources.ram) || zelAppSpecs.rambamf < 100) {
      return new Error('RAM for BAMF badly assigned');
    }
    if (zelAppSpecs.hddbamf % 1 !== 0 || zelAppSpecs.hddbamf > (config.fluxSpecifics.hdd.bamf - config.lockedSystemResources.hdd) || zelAppSpecs.hddbamf < 1) {
      return new Error('SSD for BAMF badly assigned');
    }
  }
  return true;
}

async function getZelAppsTemporaryMessages(req, res) {
  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });

  const database = db.db(config.database.zelappsglobal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await serviceHelper.findInDatabase(database, globalZelAppsTempMessages, query, projection).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    db.close();
    throw error;
  });
  db.close();
  const resultsResponse = serviceHelper.createDataMessage(results);
  res.json(resultsResponse);
}

async function messageHash(message) {
  if (typeof message !== 'string') {
    return new Error('Invalid message');
  }
  return crypto.createHash('sha256').update(message).digest('hex');
}

async function verifyZelAppHash(message) {
  /* message object
  * @param type string
  * @param version number
  * @param zelAppSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  const messToHash = message.type + message.version + JSON.stringify(message.zelAppSpecifications) + message.timestamp + message.signature;
  const messageHASH = await messageHash(messToHash);
  if (messageHASH !== message.hash) {
    throw new Error('Invalid ZelApp hash received!');
  }
  return 0;
}

async function verifyZelAppMessageSignature(type, version, zelAppSpec, timestamp, signature) {
  if (typeof zelAppSpec !== 'object' && typeof timestamp !== 'number' && typeof signature !== 'string' && typeof version !== 'number' && typeof type !== 'string') {
    throw new Error('Invalid ZelApp message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(zelAppSpec) + timestamp;
  const isValidSignature = serviceHelper.verifyMessage(messageToVerify, zelAppSpec.owner, signature);
  if (isValidSignature !== true) {
    const errorMessage = isValidSignature === false ? 'Received signature is invalid or ZelApp specifications are not properly formatted' : isValidSignature;
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
    if (resDocker.data.full_size > config.zelapps.maxImageSize) {
      throw new Error('Docker image size is over Flux limit');
    }
  } else {
    throw new Error('Repository is not in valid format namespace/repository:tag');
  }
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
    throw new Error('ZelApp name contains special characters. Only a-z, A-Z and 0-9 are allowed');
  }
  if (zelAppSpecifications.description.length > 256) {
    throw new Error('Description is too long. Maximum of 256 characters is allowed');
  }
  const parameters = checkHWParameters(zelAppSpecifications);
  if (parameters !== true) {
    const errorMessage = parameters;
    throw new Error(errorMessage);
  }

  // check port is within range
  if (zelAppSpecifications.port < config.zelapps.portMin || zelAppSpecifications.port > config.zelapps.portMax) {
    throw new Error(`Assigned port is not within ZelApps range ${config.zelapps.portMin}-${config.zelapps.portMax}`);
  }

  // check if containerPort makes sense
  if (zelAppSpecifications.containerPort < 0 || zelAppSpecifications.containerPort > 65535) {
    throw new Error('Container Port is not within system limits 0-65535');
  }

  // check repotag if available for download
  await verifyRepository(zelAppSpecifications.repotag);
}

async function storeZelAppTemporaryMessage(message, furtherVerification = false) {
  /* message object
  * @param type string
  * @param version number
  * @param zelAppSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.zelAppSpecifications !== 'object' && typeof message.signature !== 'string' && typeof message.timestamp !== 'number' && typeof message.hash !== 'string') {
    return new Error('Invalid ZelApp message for storing');
  }
  // data shall already be verified by the broadcasting node. But verify all again.
  if (furtherVerification) {
    await verifyZelAppSpecifications(message.zelAppSpecifications);
    await verifyZelAppHash(message);
    await verifyZelAppMessageSignature(message.type, message.version, message.zelAppSpecifications, message.timestamp, message.signature);
  }

  const validTill = message.timestamp + (60 * 60 * 1000); // 60 minutes

  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    log.error(error);
    throw error;
  });
  const database = db.db(config.database.zelappsglobal.database);
  database.collection(globalZelAppsTempMessages).createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
  const newMessage = {
    zelAppSpecifications: message.zelAppSpecifications,
    type: message.type,
    version: message.version,
    hash: message.hash,
    timestamp: message.timestamp,
    signature: message.signature,
    createdAt: new Date(message.timestamp),
    expireAt: new Date(validTill),
  };
  const value = newMessage;
  const query = { hash: newMessage.hash };
  const projection = {};
  const result = await serviceHelper.findOneInDatabase(database, globalZelAppsTempMessages, query, projection).catch((error) => {
    log.error(error);
    db.close();
    throw error;
  });
  if (result) {
    // it is already stored
    return false;
  }
  await serviceHelper.insertOneToDatabase(database, globalZelAppsTempMessages, value).catch((error) => {
    log.error(error);
    db.close();
    throw error;
  });
  db.close();
  // it is stored and rebroadcasted
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
      // first  check if this node is available for application registration - has at least 5 outgoing connections and 2 incoming connections (that is sufficient as it means it is confirmed and works correctly)
      // TODO reenable in smarter way
      // if (zelfluxCommunication.outgoingPeers.length < 5 || zelfluxCommunication.incomingPeers.length < 2) {
      //   throw new Error('Sorry, This Flux does not have enough peers for safe application registration');
      // }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they dont exist in global database
      // first lets check if all fields are present and have propper format excpet tiered and teired specifications and those can be ommited
      let { zelAppSpecification } = processedBody;
      let { timestamp } = processedBody;
      let { signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!zelAppSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Inclomplete message received. Check if specifications, timestamp and siganture is provided.');
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
      if (!version || !name || !description || !repotag || !owner || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
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
        throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
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
        if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
          throw new Error('ZelApp was requested as tiered setup but specifications are missing');
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
      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper port, repotag exists, string lengths, specs are ok
      await verifyZelAppSpecifications(zelAppSpecFormatted);

      // check if name is not yet registered
      const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
        throw error;
      });

      const zelappsDatabase = dbopen.db(config.database.zelappsglobal.database);
      const zelappsQuery = { name: zelAppSpecFormatted.name };
      const zelappsProjection = {
        projection: {
          _id: 0,
          name: 1,
        },
      };
      const zelappResult = await serviceHelper.findOneInDatabase(zelappsDatabase, globalZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
        dbopen.close();
        throw error;
      });

      if (zelappResult) {
        dbopen.close();
        throw new Error(`ZelApp ${zelAppSpecFormatted.name} already registered. ZelApp has to be registered under different name.`);
      }

      // check if port is not yet registered
      const portQuery = { port: zelAppSpecFormatted.port };
      const portProjection = {
        projection: {
          _id: 0,
          name: 1,
        },
      };
      const portResult = await serviceHelper.findOneInDatabase(zelappsDatabase, globalZelAppsInformation, portQuery, portProjection).catch((error) => {
        dbopen.close();
        throw error;
      });

      if (portResult) {
        dbopen.close();
        throw new Error(`ZelApp ${zelAppSpecFormatted.name} port already registered. ZelApp has to be registered with different port.`);
      }

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await verifyZelAppMessageSignature(messageType, typeVersion, zelAppSpecFormatted, timestamp, signature);

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may possess some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(zelAppSpecFormatted) + timestamp + signature;
      const messageHASH = await messageHash(message);
      const responseHash = serviceHelper.createDataMessage(messageHASH);
      // now all is great. Store zelAppSpecFormatted, timestamp, signature and hash in zelappsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryZelAppMessage = {
        type: messageType,
        version: typeVersion,
        zelAppSpecifications: zelAppSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
      };
      await storeZelAppTemporaryMessage(temporaryZelAppMessage, false);
      await zelfluxCommunication.broadcastTemporaryZelAppMessage(temporaryZelAppMessage);
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

async function temporaryZelAppRegisterFunctionForFoldingAtHome(req, res) {
  // this function is just temporary
  // when a launch folding button is clicked
  // check what tier our node is
  // if bamf limit to - 2 cores, 4 GB ram, super 1 core, 1 gb ram, basic 0.5 core, 0.5gb ram;
  // data storage let be ~/zelflux/ZelApp/zelFoldingAtHome
  // name of docker let be zelFoldingAtHome
  // Flux uses port range for apps 30000 - 39999. Allowing up to 10k apps.
  // port this temporary folding at home let be a unique 30000
  // as according to specifications ports are asssigned from lowest possible number ();
  // if not exists create zelflux network for docker on gateway ip docker network create --subnet=172.16.0.0/16 --gateway=172.16.0.1 zelfluxDockerNetwork
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (authorized) {
      // ram is specified in MB, hdd specified in GB
      const zelAppSpecifications = {
        repotag: 'yurinnick/folding-at-home:latest',
        name: 'zelFoldingAtHome', // corresponds to docker name and this name is stored in zelapps mongo database
        description: 'Folding @ Home is cool :)',
        port: 30000,
        tiered: true,
        cpu: 0.5, // true resource registered for app. If not tiered only this is available
        ram: 500, // true resource registered for app
        hdd: 5, // true resource registered for app
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
        containerPort: 7396,
        containerData: '/config',
      };

      // get our tier and adjust true resource registered
      if (zelAppSpecifications.tiered) {
        const tier = await zelnodeTier();
        if (tier === 'basic') {
          zelAppSpecifications.cpu = zelAppSpecifications.cpubasic || zelAppSpecifications.cpu;
          zelAppSpecifications.ram = zelAppSpecifications.rambasic || zelAppSpecifications.ram;
        } else if (tier === 'super') {
          zelAppSpecifications.cpu = zelAppSpecifications.cpusuper || zelAppSpecifications.cpu;
          zelAppSpecifications.ram = zelAppSpecifications.ramsuper || zelAppSpecifications.ram;
        } else if (tier === 'bamf') {
          zelAppSpecifications.cpu = zelAppSpecifications.cpubamf || zelAppSpecifications.cpu;
          zelAppSpecifications.ram = zelAppSpecifications.rambamf || zelAppSpecifications.ram;
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
      error.code,
    );
    res.json(errorResponse);
  }
}

async function availableZelApps(req, res) {
  // calls to global mongo db
  // simulate a similar response
  const zelapps = [
    {
      name: 'zelFoldingAtHome',
      description: 'Folding @ Home is cool :)',
      repotag: 'yurinnick/folding-at-home:latest',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      timestamp: 1587181519000,
      validTill: 1608263119000,
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
      enviromentParameters: [`USER=${userconfig.initial.zelid}`, 'TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
      commands: [
        '--allow',
        '0/0',
        '--web-allow',
        '0/0',
      ],
      containerPort: 7396,
      containerData: '/config',
      // below not part of message data. Signature from above data
      signature: 'todo',
      // txid of transaction that brings the hash message to zel blockchain
      txid: 'todo',
    },
  ];

  const dataResponse = serviceHelper.createDataMessage(zelapps);
  return res.json(dataResponse);
}

async function installedZelApps(req, res) {
  try {
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = {};
    const zelappsProjection = {};
    const zelApps = await serviceHelper.findInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
    dbopen.close();
    const dataResponse = serviceHelper.createDataMessage(zelApps);
    return res.json(dataResponse);
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

async function calculateZelAmountForApp(cpu, ram, hdd) {
  const cpuPrice = config.zelapps.price.cpu;
  const ramPrice = config.zelapps.price.ram;
  const hddPrice = config.zelapps.price.hdd;

  const cpuTotal = serviceHelper.ensureNumber(cpu) * cpuPrice;
  const ramTotal = serviceHelper.ensureNumber(ram) * ramPrice;
  const hddTotal = serviceHelper.ensureNumber(hdd) * hddPrice;

  const total = cpuTotal + ramTotal + hddTotal;
  return total;
}

async function checkZelAppMessageExistence(zelapphash) {
  try {
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });
    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { zelapphash };
    const zelappsProjection = {};
    const zelappResult = await serviceHelper.findOneInDatabase(zelappsDatabase, globalZelAppsMessages, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
    dbopen.close();
    if (zelappResult) {
      return true;
    }
    return false;
  } catch (error) {
    log.error(error);
    return error;
  }
}

async function checkAndRequestZelApp(zelapphash) {
  try {
    const appMessageExists = await checkZelAppMessageExistence(zelapphash);
    if (!appMessageExists) {
      // we surely do not have that message.
      // request the message and broadcast the message further to our connected peers.
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
    const data = config.zelapps;
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
  zelAppRemove,
  zelAppPause,
  zelAppUnpause,
  zelAppTop,
  zelAppLog,
  zelAppInspect,
  zelAppUpdate,
  zelAppExec,
  zelShareFile,
  zelFluxUsage,
  removeZelAppLocally,
  registerZelAppLocally,
  registerZelAppGlobalyApi,
  temporaryZelAppRegisterFunctionForFoldingAtHome,
  createZelFluxNetwork,
  removeZelAppLocallyApi,
  zelAppImageRemove,
  installedZelApps,
  availableZelApps,
  zelappsResources,
  calculateZelAmountForApp,
  checkZelAppMessageExistence,
  checkAndRequestZelApp,
  checkDockerAccessibility,
  registrationInformation,
  appPricePerMonth,
  getZelAppsTemporaryMessages,
  storeZelAppTemporaryMessage,
};
