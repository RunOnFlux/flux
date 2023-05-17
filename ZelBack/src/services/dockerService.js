const stream = require('stream');
const Docker = require('dockerode');
const path = require('path');
const serviceHelper = require('./serviceHelper');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const log = require('../lib/log');

const fluxDirPath = path.join(__dirname, '../../../');
const appsFolder = `${fluxDirPath}ZelApps/`;

const docker = new Docker();

/**
 * Creates a docker container object with a given ID.
 *
 * @param {string} id
 *
 * @returns {object} docker container object
 */
function getDockerContainer(id) {
  const dockerContainer = docker.getContainer(id);
  return dockerContainer;
}

/**
 * Generates an app identifier based on app name.
 *
 * @param {string} appName
 * @returns {string} app identifier
 */
function getAppIdentifier(appName) {
  // this id is used for volumes, docker names so we know it really belongs to flux
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

/**
 * Generates an app docker name based on app name
 *
 * @param {string} appName
 * @returns {string} app docker name id
 */
function getAppDockerNameIdentifier(appName) {
  // this id is used for volumes, docker names so we know it reall belongs to flux
  const name = getAppIdentifier(appName);
  if (name.startsWith('/')) {
    return name;
  }
  return `/${name}`;
}

/**
 * Creates a docker network object.
 *
 * @param {object} options:
 *      Name: string;
        CheckDuplicate?: boolean | undefined;
        Driver?: string | undefined;
        Internal?: boolean | undefined;
        Attachable?: boolean | undefined;
        Ingress?: boolean | undefined;
        IPAM?: IPAM | undefined;
        EnableIPv6?: boolean | undefined;
        Options?: { [option: string]: string } | undefined;
        Labels?: { [label: string]: string } | undefined;

        abortSignal?: AbortSignal;
 * @returns {object} Network
 */
async function dockerCreateNetwork(options) {
  const network = await docker.createNetwork(options);
  return network;
}

/**
 * Removes docker network.
 *
 * @param {object} netw - Network object
 *
 * @returns {Buffer}
 */
async function dockerRemoveNetwork(netw) {
  const network = await netw.remove();
  return network;
}

/**
 * Returns inspect network object.
 *
 * @param {object} netw - Network object
 *
 * @returns {object} ispect network object
 */
async function dockerNetworkInspect(netw) {
  const network = await netw.inspect();
  return network;
}

/**
 * Returns a list of containers.
 *
 * @param {bool} [all] - defaults to false; By default only running containers are shown
 * @param {number} [limit] - Return this number of most recently created containers, including non-running ones.
 * @param {bool} [size] - Return the size of container as fields SizeRw and SizeRootFs.
 * @param {string} [filter] Filters to process on the container list, encoded as JSON

 * @returns {array} containers list
 */
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

/**
 * Returns a list of images on the server.
 *
 * @returns {array} images list
 */
async function dockerListImages() {
  const containers = await docker.listImages();
  return containers;
}

/**
 * Returns a docker container found by name or ID
 *
 * @param {string} idOrName
 * @returns {object} dockerContainer
 */
async function getDockerContainerByIdOrName(idOrName) {
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  const dockerContainer = docker.getContainer(myContainer.Id);
  return dockerContainer;
}
/**
 * Returns low-level information about a container.
 *
 * @param {string} idOrName
 * @returns {object}
 */
async function dockerContainerInspect(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const response = await dockerContainer.inspect();
  return response;
}

/**
 * Returns a sample of container’s resource usage statistics.
 *
 * @param {string} idOrName
 * @returns docker container statistics
 */
async function dockerContainerStats(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const options = {
    stream: false,
  };
  const response = await dockerContainer.stats(options); // output hw usage statistics just once
  return response;
}

/**
 * Take stats from docker container and follow progress of the stream.
 * @param {string} repoTag Docker Hub repo/image tag.
 * @param {object} res Response.
 * @param {function} callback Callback.
 */
async function dockerContainerStatsStream(idOrName, req, res, callback) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  dockerContainer.stats(idOrName, (err, mystream) => {
    function onFinished(error, output) {
      if (error) {
        callback(err);
      } else {
        callback(null, output);
      }
      mystream.destroy();
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
    req.on('close', () => {
      mystream.destroy();
    });
  });
}

/**
 * Returns changes on a container’s filesystem.
 *
 * @param {string} idOrName
 * @returns {string}
 */
async function dockerContainerChanges(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const response = await dockerContainer.changes();
  return serviceHelper.ensureString(response);
}

/**
 * To pull a Docker Hub image and follow progress of the stream.
 * @param {object} config Pulling config consisting of repoTag and optional authToken
 * @param {object} res Response.
 * @param {function} callback Callback.
 */
function dockerPullStream(config, res, callback) {
  const { repoTag, authToken } = config;
  let pullOptions;
  if (authToken) {
    pullOptions = {
      authconfig: {
        key: authToken,
      },
    };
  }
  docker.pull(repoTag, pullOptions, (err, mystream) => {
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

/**
 * Runs a command inside a running container.
 *
 * @param {object} container Docker container object
 * @param {string} cmd Command to execute
 * @param {array} env Environment variables
 * @param {object} res response object
 * @param {function} callback
 */
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

/**
 * Subscribes to logs stream.
 *
 * @param {string} idOrName
 * @param {object} res
 * @param {function} callback
 */
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

/**
 * Returns requested number of lines of logs from the container.
 *
 * @param {string} idOrName
 * @param {number} lines
 *
 * @returns {string}
 */
async function dockerContainerLogs(idOrName, lines) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const options = {
    follow: false,
    stdout: true,
    stderr: true,
    tail: lines,
  };
  const logs = await dockerContainer.logs(options);
  return logs.toString();
}

async function obtainPayloadFromStorage(url, appName) {
  try {
    // do a signed request in headers
    // we want to be able to fetch even from unsecure storages that may not have all the auths
    // and so this is only basic auth where timestamp is important
    // server should verify valid signature based on publicKey that server can get from
    // deterministic node list of ip address that did this request
    const version = 1;
    const timestamp = Date.now();
    const message = version + url + timestamp;
    const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message);
    const axiosConfig = {
      headers: {
        'flux-message': message,
        'flux-signature': signature,
        'flux-app': appName,
      },
      timeout: 20000,
    };
    const response = await serviceHelper.axiosGet(url, axiosConfig);
    return response.data;
  } catch (error) {
    log.error(error);
    throw new Error(`Parameters from Flux Storage ${url} failed to be obtained`);
  }
}

/**
 * Creates an app container.
 *
 * @param {object} appSpecifications
 * @param {string} appName
 * @param {bool} isComponent
 * @returns {object}
 */
async function appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs) {
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  let exposedPorts = {};
  let portBindings = {};
  if (appSpecifications.version === 1) {
    portBindings = {
      [`${appSpecifications.containerPort.toString()}/tcp`]: [
        {
          HostPort: appSpecifications.port.toString(),
        },
      ],
      [`${appSpecifications.containerPort.toString()}/udp`]: [
        {
          HostPort: appSpecifications.port.toString(),
        },
      ],
    };
    exposedPorts = {
      [`${appSpecifications.port.toString()}/tcp`]: {},
      [`${appSpecifications.containerPort.toString()}/tcp`]: {},
      [`${appSpecifications.port.toString()}/udp`]: {},
      [`${appSpecifications.containerPort.toString()}/udp`]: {},
    };
  } else {
    appSpecifications.ports.forEach((port) => {
      exposedPorts[[`${port.toString()}/tcp`]] = {};
      exposedPorts[[`${port.toString()}/udp`]] = {};
    });
    appSpecifications.containerPorts.forEach((port) => {
      exposedPorts[[`${port.toString()}/tcp`]] = {};
      exposedPorts[[`${port.toString()}/udp`]] = {};
    });
    for (let i = 0; i < appSpecifications.containerPorts.length; i += 1) {
      portBindings[[`${appSpecifications.containerPorts[i].toString()}/tcp`]] = [
        {
          HostPort: appSpecifications.ports[i].toString(),
        },
      ];
      portBindings[[`${appSpecifications.containerPorts[i].toString()}/udp`]] = [
        {
          HostPort: appSpecifications.ports[i].toString(),
        },
      ];
    }
  }
  // containerData can have flags eg. s (s:/data) for synthing enabled container data
  // multiple data volumes can be attached, if containerData is contains more paths of |
  // next path should be attaching volumes of other app components, eg 0:/mydata where component X is attaching volume of first component to /mydata path
  // experimental feature
  // only component of higher number can use volumes of previous components. Eg. 2nd component can't use volume of 3rd component but can use volume of 1st component.
  // that limitation comes down to how we are creating volumes, assigning them and starting applications
  // todo v7 adjust this limitations in future revisions, switcher to docker volumes.
  // tbd v7 potential issues of hard redeploys of components
  const containerData = appSpecifications.containerData.split('|')[0].split(':')[1] || appSpecifications.containerData.split('|')[0];
  const dataPaths = appSpecifications.containerData.split('|');
  const outsideVolumesToAttach = [];
  for (let i = 1; i < dataPaths.length; i += 1) {
    const splittedPath = dataPaths[i].split(':');
    const pathFlags = splittedPath[0];
    const actualPath = splittedPath[1];
    if (pathFlags && actualPath && pathFlags.replace(/[^0-9]/g, '')) {
      const comopnentToUse = pathFlags.replace(/[^0-9]/g, '')[0]; // take first number character representing the component number to attach to
      outsideVolumesToAttach.push({
        component: Number(comopnentToUse),
        path: actualPath,
      });
    }
  }
  if (outsideVolumesToAttach.length && !fullAppSpecs) {
    throw new Error(`Complete App Specification was not supplied but additional volumes requested for ${appName}`);
  }
  const constructedVolumes = [`${appsFolder + getAppIdentifier(identifier)}/appdata:${containerData}`];
  outsideVolumesToAttach.forEach((volToAttach) => {
    if (fullAppSpecs.version >= 4) {
      const myIndex = fullAppSpecs.compose.findIndex((component) => component.name === appSpecifications.name);
      if (myIndex >= volToAttach.component) {
        const atCompIdentifier = `${fullAppSpecs.compose[volToAttach.component].name}_${appName}`;
        const vol = `${appsFolder + getAppIdentifier(atCompIdentifier)}/appdata:${volToAttach.path}`;
        constructedVolumes.push(vol);
      } else {
        log.error(`Additional volume ${outsideVolumesToAttach.path} can't be mounted to component ${outsideVolumesToAttach.component}`);
      }
    } else if (volToAttach.component === 0) { // not a compose specs
      const vol = `${appsFolder + getAppIdentifier(identifier)}/appdata:${volToAttach.path}`;
      constructedVolumes.push(vol);
    }
  });
  const options = {
    Image: appSpecifications.repotag,
    name: getAppIdentifier(identifier),
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: appSpecifications.commands,
    Env: appSpecifications.environmentParameters || appSpecifications.enviromentParameters,
    Tty: false,
    ExposedPorts: exposedPorts,
    HostConfig: {
      NanoCPUs: appSpecifications.cpu * 1e9,
      Memory: appSpecifications.ram * 1024 * 1024,
      StorageOpts: { size: '12G' }, // root fs has max 12G
      Binds: constructedVolumes,
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
      NetworkMode: `fluxDockerNetwork_${appName}`,
      LogConfig: {
        Type: 'json-file',
        Config: {
          'max-file': '1',
          'max-size': '20m',
        },
      },
    },
  };

  if (options.Env.length) {
    const fluxStorageEnv = options.Env.find((env) => env.startsWith(('F_S_ENV=')));
    if (fluxStorageEnv) {
      const url = fluxStorageEnv.split('F_S_ENV=')[1];
      const envVars = await obtainPayloadFromStorage(url, appName);
      if (Array.isArray(envVars) && envVars.length < 200) {
        envVars.forEach((parameter) => {
          if (typeof parameter !== 'string' || parameter.length > 5000000) {
            throw new Error(`Environment parameters from Flux Storage ${fluxStorageEnv} are invalid`);
          } else {
            options.Env.push(parameter);
          }
        });
      } else {
        throw new Error(`Environment parameters from Flux Storage ${fluxStorageEnv} are invalid`);
      }
    }
  }

  if (options.Cmd.length) {
    const fluxStorageCmd = options.Cmd.find((cmd) => cmd.startsWith(('F_S_CMD=')));
    if (fluxStorageCmd) {
      const url = fluxStorageCmd.split('F_S_CMD=')[1];
      const envVars = await obtainPayloadFromStorage(url, appName);
      if (Array.isArray(envVars) && envVars.length < 200) {
        envVars.forEach((parameter) => {
          if (typeof parameter !== 'string' || parameter.length > 5000000) {
            throw new Error(`Commands parameters from Flux Storage ${fluxStorageCmd} are invalid`);
          } else {
            options.Env.push(parameter);
          }
        });
      } else {
        throw new Error(`Commands parameters from Flux Storage ${fluxStorageCmd} are invalid`);
      }
    }
  }

  const app = await docker.createContainer(options).catch((error) => {
    log.error(error);
    throw error;
  });
  return app;
}

/**
 * Starts app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerStart(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.start(); // may throw
  return `Flux App ${idOrName} successfully started.`;
}

/**
 * Stops app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerStop(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.stop();
  return `Flux App ${idOrName} successfully stopped.`;
}

/**
 * Restarts app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerRestart(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.restart();
  return `Flux App ${idOrName} successfully restarted.`;
}

/**
 * Kills app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerKill(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.kill();
  return `Flux App ${idOrName} successfully killed.`;
}

/**
 * Removes app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerRemove(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.remove();
  return `Flux App ${idOrName} successfully removed.`;
}

/**
 * Removes app's docker image.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerImageRemove(idOrName) {
  // container ID or name
  const dockerImage = docker.getImage(idOrName);
  await dockerImage.remove();
  return `Flux App ${idOrName} image successfully removed.`;
}

/**
 * Pauses app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerPause(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.pause();
  return `Flux App ${idOrName} successfully paused.`;
}

/**
 * Unpauses app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerUnpause(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  await dockerContainer.unpause();
  return `Flux App ${idOrName} successfully unpaused.`;
}

/**
 * Returns app's docker's active processes.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerTop(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const processes = await dockerContainer.top();
  return processes;
}

/**
 * Creates flux docker network if doesn't exist
 * OBSOLETE
 * @returns {object} response
 */
async function createFluxDockerNetwork() {
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

/**
 * Creates flux application docker network if doesn't exist
 *
 * @returns {object} response
 */
async function createFluxAppDockerNetwork(appname, number) {
  // check if fluxDockerNetwork of an appexists
  const fluxNetworkOptions = {
    Name: `fluxDockerNetwork_${appname}`,
    IPAM: {
      Config: [{
        Subnet: `172.${number}.0.0/16`,
        Gateway: `172.${number}.0.1`,
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
    response = `Flux App Network of ${appname} already exists.`;
  }
  return response;
}

/**
 * Removes flux application docker network if exists
 *
 * @returns {object} response
 */
async function removeFluxAppDockerNetwork(appname) {
  // check if fluxDockerNetwork of an app exists
  const fluxAppNetworkName = `fluxDockerNetwork_${appname}`;
  let fluxNetworkExists = true;
  const network = docker.getNetwork(fluxAppNetworkName);
  await dockerNetworkInspect(network).catch(() => {
    fluxNetworkExists = false;
  });
  let response;
  // remove docker network
  if (fluxNetworkExists) {
    response = await dockerRemoveNetwork(network);
  } else {
    response = `Flux App Network of ${appname} already does not exist.`;
  }
  return response;
}

module.exports = {
  getDockerContainer,
  getAppIdentifier,
  getAppDockerNameIdentifier,
  dockerCreateNetwork,
  dockerRemoveNetwork,
  dockerNetworkInspect,
  dockerListContainers,
  dockerListImages,
  dockerContainerInspect,
  dockerContainerStats,
  dockerContainerStatsStream,
  dockerContainerChanges,
  dockerPullStream,
  dockerContainerExec,
  dockerContainerLogsStream,
  dockerContainerLogs,
  appDockerCreate,
  appDockerStart,
  appDockerStop,
  appDockerRestart,
  appDockerKill,
  appDockerRemove,
  appDockerImageRemove,
  appDockerPause,
  appDockerUnpause,
  appDockerTop,
  createFluxDockerNetwork,
  getDockerContainerByIdOrName,
  createFluxAppDockerNetwork,
  removeFluxAppDockerNetwork,
};
