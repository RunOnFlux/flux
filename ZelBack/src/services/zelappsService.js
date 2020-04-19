const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
const Docker = require('dockerode');
const stream = require('stream');
const path = require('path');
const nodecmd = require('node-cmd');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const zelfluxCommunication = require('./zelfluxCommunication');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fluxDirPath = path.join(__dirname, '../../../');
const zelappsFolder = `${fluxDirPath}ZelApps/`;


const docker = new Docker();

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;
const scannedHeightCollection = config.database.zelcash.collections.scannedHeight;
const localZelAppsInformation = config.database.zelapps.collections.zelappsInformation;

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

async function createZelFluxNetwork(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  try {
    const options = {
      Name: 'zelfluxDockerNetwork',
      IPAM: {
        Config: [{
          Subnet: '172.16.0.0/16',
          Gateway: '172.16.0.1',
        }],
      },
    };
    const dockerRes = await dockerCreateNetwork(options);
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
      res.write(serviceHelper.ensureString(event));
      console.log(event);
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
    const zelappsResponse = serviceHelper.createDataMessage(zelapps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
  } catch (error) {
    const zelappsResponse = serviceHelper.createDataMessage(zelapps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
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
    res.json(errMessage);
    throw error;
  });
  try {
    if (zelapps.length > 0) {
      zelapps = zelapps.filter((zelapp) => zelapp.Names[0].substr(1, 3) === 'zel');
    }
    const zelappsResponse = serviceHelper.createDataMessage(zelapps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
  } catch (error) {
    const zelappsResponse = serviceHelper.createDataMessage(zelapps);
    return res ? res.json(zelappsResponse) : zelappsResponse;
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

async function zelAppDockerCreate(zelappSpecifications) {
  // todo attaching our zelflux network and correct ip not working, limiting size
  const options = {
    Image: zelappSpecifications.repotag,
    name: zelappSpecifications.name,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: zelappSpecifications.commands,
    Env: zelappSpecifications.enviromentParameters,
    Tty: false,
    HostConfig: {
      NanoCPUs: zelappSpecifications.cpu * 1e9,
      Memory: zelappSpecifications.ram * 1024 * 1024,
      Binds: [`${zelappsFolder + zelappSpecifications.name}:${zelappSpecifications.containerData}`],
      Ulimits: [
        {
          Name: 'nofile',
          Soft: 8192,
          Hard: 16384,
        },
      ],
      PortBindings: {
        [`${zelappSpecifications.containerPort.toString()}/tcp`]: [
          {
            HostPort: zelappSpecifications.port.toString(),
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
    return `ZelApp ${idOrName} succesfully started.`;
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
  return `ZelApp ${idOrName} succesfully stopped.`;
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
  return `ZelApp ${idOrName} succesfully restarted.`;
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
  return `ZelApp ${idOrName} succesfully killed.`;
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
  return `ZelApp ${idOrName} succesfully removed.`;
}

async function zelAppDockerImageRemove(idOrName) {
  // container ID or name
  const dockerImage = docker.getImage(idOrName);

  await dockerImage.remove().catch((error) => {
    log.error(error);
    throw error;
  });
  return `ZelApp ${idOrName} image succesfully removed.`;
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
  return `ZelApp ${idOrName} succesfully paused.`;
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
  return `ZelApp ${idOrName} succesfully unpaused.`;
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
    const zelappsDatabase = dbopen.db(config.database.zelapps.database);
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
    // if fiveminUsage is greaeter than our cpuUsage, do an average of those numbers;
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

async function registerZelAppLocally() {
  // get applications specifics from zelapp messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
}

function getCollateralInfo(collateralOutpoint) {
  const a = collateralOutpoint;
  const b = a.split(', ');
  const txhash = b[0].substr(10, b[0].length);
  const txindex = serviceHelper.ensureNumber(b[1].split(')')[0]);
  return { txhash, txindex };
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
        port: 30000,
        cpu: 0.5,
        ram: 500,
        hdd: 15,
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
        zelAppSpecifications.cpu = 0.5;
        zelAppSpecifications.ram = 500;
      } else if (value === 25000) {
        zelAppSpecifications.cpu = 1;
        zelAppSpecifications.ram = 1000;
      } else if (value === 100000) {
        zelAppSpecifications.cpu = 2;
        zelAppSpecifications.ram = 4000;
      } else {
        throw new Error('Unrecognised ZelNode tier');
      }

      // connect to mongodb
      const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
        throw error;
      });

      const zelappsDatabase = dbopen.db(config.database.zelapps.database);
      const zelappsQuery = { name: zelAppSpecifications.name };
      const zelappsProjection = {
        projection: {
          _id: 0,
          name: 1,
        },
      };

      // check if app is already installed
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
      }

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
      // create or check docker network
      // docker network create --subnet=172.16.0.0/16 --gateway=172.16.0.1 zelfluxDockerNetwork
      if (!fluxNetworkExists) {
        await dockerCreateNetwork(fluxNetworkOptions);
      }

      // pull image
      // set the appropriate HTTP header
      res.setHeader('Content-Type', 'application/json');
      // eslint-disable-next-line no-unused-vars
      dockerPullStream(zelAppSpecifications.repotag, res, async (error, dataLog) => {
        if (error) {
          log.error(error);
          const errorResponse = serviceHelper.createErrorMessage(
            error.message || error,
            error.name,
            error.code,
          );
          res.write(serviceHelper.ensureString(errorResponse));
          res.end();
        } else {
          const pullStatus = {
            status: 'Pulling global ZelApp was successful',
          };
          res.write(serviceHelper.ensureString(pullStatus));
          const createZelApp = {
            status: 'Creating local ZelApp',
          };
          res.write(serviceHelper.ensureString(createZelApp));
          const dockerCreated = await zelAppDockerCreate(zelAppSpecifications).catch((e) => {
            const errorResponse = serviceHelper.createErrorMessage(
              e.message || e,
              e.name,
              e.code,
            );
            res.write(serviceHelper.ensureString(errorResponse));
            res.end();
          });
          if (!dockerCreated) {
            return;
          }
          const portStatusInitial = {
            status: 'Allowing ZelApp port...',
          };
          res.write(serviceHelper.ensureString(portStatusInitial));
          const portResponse = await zelfluxCommunication.allowPort(zelAppSpecifications.port);
          if (portResponse.status === true) {
            const portStatus = {
              status: 'Port OK',
            };
            res.write(serviceHelper.ensureString(portStatus));
          } else {
            const portStatus = {
              status: 'Warning: Port FAILed to open. Try opening manually later.',
            };
            res.write(serviceHelper.ensureString(portStatus));
          }
          const startStatus = {
            status: 'Starting ZelApp...',
          };
          res.write(serviceHelper.ensureString(startStatus));
          const zelapp = await zelAppDockerStart(zelAppSpecifications.name).catch((error2) => {
            const errorResponse = serviceHelper.createErrorMessage(
              error2.message || error2,
              error2.name,
              error2.code,
            );
            res.write(serviceHelper.ensureString(errorResponse));
            res.end();
          });
          if (!zelapp) {
            return;
          }
          const zelappResponse = serviceHelper.createDataMessage(zelapp);
          res.write(serviceHelper.ensureString(zelappResponse));
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
      hdd: 15,
      cpubasic: 0.5,
      cpusuper: 1,
      cpubamf: 2,
      rambasic: 500,
      ramsuper: 1000,
      rambamf: 4000,
      hddbasic: 15,
      hddsuper: 15,
      hddbamf: 15,
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

    const zelappsDatabase = dbopen.db(config.database.zelapps.database);
    const zelappsQuery = {};
    const zelappsProjection = {};
    const zelApps = await serviceHelper.findInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
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

async function removeZelAppLocally(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    // remove zelapp from local machine.
    // find in database, stop zelapp, remove container, close port delete data associated on system, remove from database
    // todo do we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
    let { zelapp } = req.params;
    zelapp = zelapp || req.query.zelapp;

    if (!zelapp) {
      throw new Error('No ZelApp specified');
    }

    // first find the zelappSpecifications in our database.
    // connect to mongodb
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });

    const zelappsDatabase = dbopen.db(config.database.zelapps.database);
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
    // set the appropriate HTTP header
    res.setHeader('Content-Type', 'application/json');

    const stopStatus = {
      status: 'Stopping ZelApp...',
    };
    res.write(serviceHelper.ensureString(stopStatus));
    await zelAppDockerStop(zelapp).catch((error) => {
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
    res.write(serviceHelper.ensureString(stopStatus2));

    const removeStatus = {
      status: 'Removing ZelApp container...',
    };
    res.write(serviceHelper.ensureString(removeStatus));
    await zelAppDockerRemove(zelapp).catch((error) => {
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.write(serviceHelper.ensureString(errorResponse));
    });
    const removeStatus2 = {
      status: 'ZelApp container removed',
    };
    res.write(serviceHelper.ensureString(removeStatus2));

    const imageStatus = {
      status: 'Removing ZelApp image...',
    };
    res.write(serviceHelper.ensureString(imageStatus));
    await zelAppDockerImageRemove(zelAppSpecifications.repotag).catch((error) => {
      const errorResponse = serviceHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.write(serviceHelper.ensureString(errorResponse));
    });
    const imageStatus2 = {
      status: 'ZelApp image operations done',
    };
    res.write(serviceHelper.ensureString(imageStatus2));

    const portStatus = {
      status: 'Denying ZelApp port...',
    };
    res.write(serviceHelper.ensureString(portStatus));
    await zelfluxCommunication.denyPort(zelAppSpecifications.port);
    const portStatus2 = {
      status: 'Port denied',
    };
    res.write(serviceHelper.ensureString(portStatus2));

    const cleaningStatus = {
      status: 'Cleaning up data...',
    };
    res.write(serviceHelper.ensureString(cleaningStatus));
    const exec = `sudo rm -rf ${zelappsFolder + zelAppSpecifications.name}`;
    const cmdAsync = util.promisify(nodecmd.get);
    await cmdAsync(exec);
    const cleaningStatus2 = {
      status: 'Data cleaned',
    };
    res.write(serviceHelper.ensureString(cleaningStatus2));

    const databaseStatus = {
      status: 'Cleaning up database...',
    };
    res.write(serviceHelper.ensureString(databaseStatus));
    await serviceHelper.findOneAndDeleteInDatabase(zelappsDatabase, localZelAppsInformation, zelappsQuery, zelappsProjection).catch((error) => {
      dbopen.close();
      throw error;
    });
    const databaseStatus2 = {
      status: 'Database cleaned',
    };
    res.write(serviceHelper.ensureString(databaseStatus2));
    dbopen.close();

    const zelappRemovalResponse = serviceHelper.createDataMessage(`ZelApp ${zelapp} was successfuly removed`);
    res.write(serviceHelper.ensureString(zelappRemovalResponse));
    return res.end();
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

async function zelappsResources(req, res) {
  try {
    const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      throw error;
    });
    const zelappsDatabase = dbopen.db(config.database.zelapps.database);
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
    let zelAppsCpusLocked = 0;
    let zelAppsRamLocked = 0;
    let zelAppsHddLocked = 0;
    zelappsResult.forEach((zelapp) => {
      zelAppsCpusLocked += serviceHelper.ensureNumber(zelapp.cpu) || 0;
      zelAppsRamLocked += serviceHelper.ensureNumber(zelapp.hdd) || 0;
      zelAppsHddLocked += serviceHelper.ensureNumber(zelapp.ram) || 0;
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
  registerZelAppLocally,
  temporaryZelAppRegisterFunctionForFoldingAtHome,
  createZelFluxNetwork,
  removeZelAppLocally,
  zelAppImageRemove,
  installedZelApps,
  availableZelApps,
  zelappsResources,
};
