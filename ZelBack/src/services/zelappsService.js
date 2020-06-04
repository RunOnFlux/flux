const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
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
const scannedHeightCollection =
  config.database.zelcash.collections.scannedHeight;
const localZelAppsInformation =
  config.database.zelappslocal.collections.zelappsInformation;
const globalZelAppsMessages =
  config.database.zelappsglobal.collections.zelAppsMessages;

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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
            }
          );
        }
      }
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
    const myContainer = containers.find(
      (container) =>
        serviceHelper.ensureString(container.Names).includes(idOrName) ||
        serviceHelper.ensureString(container.Id).includes(idOrName)
    );
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
      }
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
      error.code
    );
    res.json(errorResponse);
  }
}

async function listRunningZelApps(req, res) {
  let zelapps = await dockerListContainers(false).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    log.error(error);
    return res ? res.json(errMessage) : errMessage;
  });
  try {
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

async function listAllZelApps(req, res) {
  let zelapps = await dockerListContainers(true).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    log.error(error);
    return res ? res.json(errMessage) : errMessage;
  });
  try {
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
  const zelapps = await dockerListImages().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappsResponse = serviceHelper.createDataMessage(zelapps);
  return res ? res.json(zelappsResponse) : zelappsResponse;
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
    name: zelAppSpecifications.name,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: zelAppSpecifications.commands,
    Env: zelAppSpecifications.enviromentParameters,
    Tty: false,
    HostConfig: {
      NanoCPUs: zelAppSpecifications.cpu * 1e9,
      Memory: zelAppSpecifications.ram * 1024 * 1024,
      Binds: [
        `${zelappsFolder + zelAppSpecifications.name}:${
          zelAppSpecifications.containerData
        }`,
      ],
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
    const myContainer = containers.find(
      (container) =>
        serviceHelper.ensureString(container.Names).includes(idOrName) ||
        serviceHelper.ensureString(container.Id).includes(idOrName)
    );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
  const myContainer = containers.find(
    (container) =>
      serviceHelper.ensureString(container.Names).includes(idOrName) ||
      serviceHelper.ensureString(container.Id).includes(idOrName)
  );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      'No ZelApp image specified'
    );
    return res.json(errMessage);
  }

  const zelappRes = await zelAppDockerImageRemove(image).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
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
      error.code
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

  const response = await dockerContainerInspect(container).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
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
        'Invalid memory count'
      );
      return res.json(errMessage);
    }
  }

  console.log(updateCommand);

  const response = await dockerContainer
    .update(updateCommand)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
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
            error.code
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
      error.code
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
      error.code
    );
    return res.json(errorResponse);
  }
}

async function zelFluxUsage(req, res) {
  try {
    const dbopen = await serviceHelper
      .connectMongoDb(mongoUrl)
      .catch((error) => {
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
    const result = await serviceHelper
      .findOneInDatabase(database, scannedHeightCollection, query, projection)
      .catch((error) => {
        dbopen.close();
        throw error;
      });
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
    const zelappsResult = await serviceHelper
      .findInDatabase(
        zelappsDatabase,
        localZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
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
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function zelappsResources(req, res) {
  try {
    const dbopen = await serviceHelper
      .connectMongoDb(mongoUrl)
      .catch((error) => {
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
    const zelappsResult = await serviceHelper
      .findInDatabase(
        zelappsDatabase,
        localZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
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
      error.code
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function createZelAppVolume(zelAppSpecifications, res) {
  const dfAsync = util.promisify(df);

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
  console.log(okVolumes);
  // todo get tier
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
  const availableSpaceForZelApps = useableSpaceOnNode - hddLockedByApps;
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

  const allocateSpace = {
    status: 'Allocating space, this may take a while...',
  };
  log.info(allocateSpace);
  if (res) {
    res.write(serviceHelper.ensureString(allocateSpace));
  }
  // space hdd * 10, thats why 0 at the end. As we have 100mb bs.
  let execDD = `sudo dd if=/dev/zero of=${useThisVolume.mount}/${zelAppSpecifications.name}TEMP bs=107374182 count=${zelAppSpecifications.hdd}0`; // eg /mnt/sthMounted/zelappTEMP
  if (useThisVolume.mount === '/') {
    execDD = `sudo dd if=/dev/zero of=${useThisVolume.mount}tmp/${zelAppSpecifications.name}TEMP bs=107374182 count=${zelAppSpecifications.hdd}0`; // if root mount then temp file is /tmp/zelappTEMP
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
  let execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}/${zelAppSpecifications.name}TEMP`;
  if (useThisVolume.mount === '/') {
    execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}tmp/${zelAppSpecifications.name}TEMP`;
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
  const execDIR = `sudo mkdir -p ${zelappsFolder + zelAppSpecifications.name}`;
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
  let execMount = `sudo mount -o loop ${useThisVolume.mount}/${
    zelAppSpecifications.name
  }TEMP ${zelappsFolder + zelAppSpecifications.name}`;
  if (useThisVolume.mount === '/') {
    execMount = `sudo mount -o loop ${useThisVolume.mount}tmp/${
      zelAppSpecifications.name
    }TEMP ${zelappsFolder + zelAppSpecifications.name}`;
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
  let execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}/${zelAppSpecifications.name}TEMP`;
  if (useThisVolume.mount === '/') {
    execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}tmp/${zelAppSpecifications.name}TEMP`;
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
  const execVerif = `sudo dd if=/dev/zero of=${
    zelappsFolder + zelAppSpecifications.name
  }/${zelAppSpecifications.name}VERTEMP bs=96636763 count=${
    zelAppSpecifications.hdd
  }0`; // 90%
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
  const execFinal = `sudo rm -rf ${zelappsFolder + zelAppSpecifications.name}/${
    zelAppSpecifications.name
  }VERTEMP`;
  await cmdAsync(execFinal);
  const finaliseSpace2 = {
    status: `Space for ZelApp ${zelAppSpecifications.name} created and assigned.`,
  };
  log.info(finaliseSpace2);
  if (res) {
    res.write(serviceHelper.ensureString(finaliseSpace2));
  }
  const message = serviceHelper.createSuccessMessage(
    'ZelApp volume creation completed.'
  );
  return message;
}

async function removeZelAppLocally(zelapp, res) {
  try {
    // remove zelapp from local machine.
    // find in database, stop zelapp, remove container, close port delete data
    // associated on system, remove from database todo do we want to remove the
    // image as well (repotag) what if other container uses the same image ->
    // then it shall result in an error so ok anyway
    if (!zelapp) {
      throw new Error('No ZelApp specified');
    }

    // first find the zelAppSpecifications in our database.
    // connect to mongodb
    const dbopen = await serviceHelper
      .connectMongoDb(mongoUrl)
      .catch((error) => {
        throw error;
      });

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { name: zelapp };
    const zelappsProjection = {};
    const zelAppSpecifications = await serviceHelper
      .findOneInDatabase(
        zelappsDatabase,
        localZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
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
    await zelAppDockerStop(zelapp).catch((error) => {
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code
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
    await zelAppDockerRemove(zelapp).catch((error) => {
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
    const execUnmount = `sudo umount ${
      zelappsFolder + zelAppSpecifications.name
    }`;
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
    const execDelete = `sudo rm -rf ${
      zelappsFolder + zelAppSpecifications.name
    }`;
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
    await serviceHelper
      .findOneAndDeleteInDatabase(
        zelappsDatabase,
        localZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
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

    const zelappRemovalResponse = serviceHelper.createDataMessage(
      `ZelApp ${zelapp} was successfuly removed`
    );
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
      error.code
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
      // find in database, stop zelapp, remove container, close port delete data
      // associated on system, remove from database todo do we want to remove
      // the image as well (repotag) what if other container uses the same image
      // -> then it shall result in an error so ok anyway
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
      error.code
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
    const dbopen = await serviceHelper
      .connectMongoDb(mongoUrl)
      .catch((error) => {
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
      status: 'Checking ZelFlux network...',
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
    const zelappResult = await serviceHelper
      .findOneInDatabase(
        zelappsDatabase,
        localZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
        dbopen.close();
        throw error;
      });

    if (!zelappResult) {
      // register the zelapp
      await serviceHelper
        .insertOneToDatabase(
          zelappsDatabase,
          localZelAppsInformation,
          zelAppSpecifications
        )
        .catch((error) => {
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
          res.write(serviceHelper.ensureString(pullStatus));

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
              'Error occured. Initiating ZelApp removal'
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
            zelAppSpecifications.name
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

async function temporaryZelAppRegisterFunctionForFoldingAtHome(req, res) {
  // this function is just temporary
  // when a launch folding button is clicked
  // check what tier our node is
  // if bamf limit to - 2 cores, 4 GB ram, super 1 core, 1 gb ram, basic 0.5
  // core, 0.5gb ram; data storage let be ~/zelflux/ZelApp/zelFoldingAtHome name
  // of docker let be zelFoldingAtHome Flux uses port range for apps 30000 -
  // 39999. Allowing up to 10k apps. port this temporary folding at home let be
  // a unique 30000 as according to specifications ports are asssigned from
  // lowest possible number (); if not exists create zelflux network for docker
  // on gateway ip docker network create --subnet=172.16.0.0/16
  // --gateway=172.16.0.1 zelfluxDockerNetwork
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (authorized) {
      // ram is specified in MB, hdd specified in GB
      const zelAppSpecifications = {
        repotag: 'yurinnick/folding-at-home:latest',
        name: 'zelFoldingAtHome', // corresponds to docker name and this name
        // is stored in zelapps mongo database
        port: 30000,
        tiered: true,
        cpu: 0.5, // true resource registered for app. If not tiered only this
        // is available
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
        enviromentParameters: [
          `USER=${userconfig.initial.zelid}`,
          'TEAM=262156',
          'ENABLE_GPU=false',
          'ENABLE_SMP=true',
        ],
        commands: ['--allow', '0/0', '--web-allow', '0/0'],
        containerPort: 7396,
        containerData: '/config',
      };

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

async function availableZelApps(req, res) {
  // calls to global mongo db
  // simulate a similar response
  const zelapps = [
    {
      name: 'zelFoldingAtHome',
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
      enviromentParameters: [
        `USER=${userconfig.initial.zelid}`,
        'TEAM=262156',
        'ENABLE_GPU=false',
        'ENABLE_SMP=true',
      ],
      commands: ['--allow', '0/0', '--web-allow', '0/0'],
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
    const dbopen = await serviceHelper
      .connectMongoDb(mongoUrl)
      .catch((error) => {
        throw error;
      });

    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = {};
    const zelappsProjection = {};
    const zelApps = await serviceHelper
      .findInDatabase(
        zelappsDatabase,
        localZelAppsInformation,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
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
      error.code
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
    const dbopen = await serviceHelper
      .connectMongoDb(mongoUrl)
      .catch((error) => {
        throw error;
      });
    const zelappsDatabase = dbopen.db(config.database.zelappslocal.database);
    const zelappsQuery = { zelapphash };
    const zelappsProjection = {};
    const zelappResult = await serviceHelper
      .findOneInDatabase(
        zelappsDatabase,
        globalZelAppsMessages,
        zelappsQuery,
        zelappsProjection
      )
      .catch((error) => {
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
      // request the message and broadcast the message further to our connected
      // peers.
    }
  } catch (error) {
    log.error(error);
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
};
