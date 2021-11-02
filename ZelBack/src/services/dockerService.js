const stream = require('stream');
const Docker = require('dockerode');
const path = require('path');
const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');

const fluxDirPath = path.join(__dirname, '../../../');
const appsFolder = `${fluxDirPath}ZelApps/`;

const docker = new Docker();

function getDockerContainer(id) {
  const dockerContainer = docker.getContainer(id);
  return dockerContainer;
}

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

async function appDockerCreate(appSpecifications, appName, isComponent) {
  const identifier = isComponent ? `${appName}_${appSpecifications.name}` : appName;
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
  const options = {
    Image: appSpecifications.repotag,
    name: getAppIdentifier(identifier),
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
      Binds: [`${appsFolder + getAppIdentifier(identifier)}:${appSpecifications.containerData}`],
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
  appDockerUnpase,
  appDockerTop,
  createFluxDockerNetwork,
};
