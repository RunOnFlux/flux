const config = require('config');
const stream = require('stream');
const Docker = require('dockerode');
const path = require('path');
const serviceHelper = require('./serviceHelper');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const pgpService = require('./pgpService');
const deviceHelper = require('./deviceHelper');
const generalService = require('./generalService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const { extractIp } = require('./utils/socketAddressUtils');
const log = require('../lib/log');
const cpuBurstHelper = require('./utils/cpuBurstHelper');

const globalState = require('./utils/globalState');

const isArcane = Boolean(process.env.FLUXOS_PATH);

const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
// eslint-disable-next-line no-unused-vars
const appsFolder = `${appsFolderPath}/`;

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
 * Inverse of getAppIdentifier: strips the flux/zel namespace prefix to recover
 * the bare component identifier (`{component}_{app}`, or `{app}` for v1-3) used
 * by app/component specs. Idempotent on an already-bare identifier. Consumers
 * whose canonical form is the bare identifier (e.g. the reconciler) normalise
 * inbound ids through this, mirroring how docker callers normalise through
 * getAppIdentifier.
 *
 * Note: like getAppIdentifier this is not perfectly invertible — a component
 * literally named `flux...`/`zel...` is ambiguous — but that is the existing
 * limitation of the prefix-as-marker convention, not new here.
 *
 * @param {string} idOrName
 * @returns {string} bare identifier
 */
function getBaseAppName(idOrName) {
  if (idOrName.startsWith('flux')) return idOrName.slice(4);
  if (idOrName.startsWith('zel')) return idOrName.slice(3);
  return idOrName;
}

/**
 * Generates an app docker name based on app name
 *
 * @param {string} appName
 * @returns {string} app docker name id
 */
function getDockerName(idOrName) {
  const name = getAppIdentifier(idOrName);
  return name.startsWith('/') ? name.substring(1) : name;
}

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
 * @param {string} idOrName
 * @returns {object} dockerContainer from list containers
 */
async function getDockerContainerOnly(idOrName) {
  const containers = await dockerListContainers(true);
  const myContainer = containers.find((container) => (container.Names[0] === getAppDockerNameIdentifier(idOrName) || container.Id === idOrName));
  if (!myContainer) {
    log.error(`Container ${idOrName} not found`);
  }
  return myContainer;
}

/**
 * Returns a docker container found by name or ID
 *
 * @param {string} idOrName
 * @returns {object} dockerContainer
 */
async function getDockerContainerByIdOrName(idOrName) {
  const myContainer = await getDockerContainerOnly(idOrName);
  // Don't throw error here, let it fail with property access error
  // to match test expectations
  const dockerContainer = docker.getContainer(myContainer.Id);
  return dockerContainer;
}
/**
 * Returns low-level information about a container.
 *
 * @param {string} idOrName
 * @param {object} options
 * @returns {object}
 */
async function dockerContainerInspect(idOrName, options = {}) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);
  const response = await dockerContainer.inspect(options);
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
        if (res.flush) res.flush();
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
 * @returns  docker container changes
 */
async function dockerContainerChanges(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const response = await dockerContainer.changes();
  return response;
}

/**
 * To pull a Docker Hub image and follow progress of the stream.
 * @param {object} pullConfig Pulling config consisting of repoTag and optional authToken
 * @param {object} res Response.
 * @param {function} callback Callback.
 */
function dockerPullStream(pullConfig, res, callback) {
  const { repoTag, provider, authToken } = pullConfig;
  let pullOptions;

  // fix this auth token stuff upstream
  if (authToken) {
    if (authToken.includes(':')) { // specified by username:token
      pullOptions = {
        authconfig: {
          username: authToken.split(':')[0],
          password: authToken.split(':')[1],
        },
      };
      if (provider) {
        pullOptions.authconfig.serveraddress = provider;
      }
    } else {
      throw new Error('Invalid login credentials for docker provided');
    }
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
        if (res.flush) res.flush();
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
    let resultString = '';
    const exec = await container.exec(options);
    exec.start(optionsExecStart, (err, mystream) => {
      if (err) {
        callback(err);
      }
      mystream.on('data', (data) => {
        resultString = serviceHelper.dockerBufferToString(data);
        res.write(resultString);
        if (res.flush) res.flush();
      });
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
      if (res.flush) res.flush();
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
 * @returns {buffer}
 */
async function dockerContainerLogs(idOrName, lines) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  const options = {
    follow: false,
    stdout: true,
    stderr: true,
    tail: lines, // TODO FIXME when using tail, some nodes hang on execution, those nodes need to update, upgrade restart docker daemon.
  };
  const logs = await dockerContainer.logs(options);
  return logs;
}

async function dockerContainerLogsPolling(idOrName, lineCount, sinceTimestamp, callback) {
  try {
    const dockerContainer = await getDockerContainerByIdOrName(idOrName);
    const logStream = new stream.PassThrough();
    let logBuffer = '';

    logStream.on('data', (chunk) => {
      logBuffer += chunk.toString('utf8');
      const lines = logBuffer.split('\n');
      logBuffer = lines.pop();
      // eslint-disable-next-line no-restricted-syntax
      for (const line of lines) {
        if (line.trim()) {
          if (callback) {
            callback(null, line);
          }
        }
      }
    });

    logStream.on('error', (error) => {
      log.error('Log stream encountered an error:', error);
      if (callback) {
        callback(error);
      }
    });

    logStream.on('end', () => {
      if (callback) {
        callback(null, 'Stream ended'); // Notify end of logs
      }
    });

    const logOptions = {
      follow: true,
      stdout: true,
      stderr: true,
      tail: lineCount,
      timestamps: true,
    };

    if (sinceTimestamp) {
      logOptions.since = new Date(sinceTimestamp).getTime() / 1000;
    }
    await new Promise((resolve, reject) => {
      // eslint-disable-next-line consistent-return
      dockerContainer.logs(logOptions, (err, mystream) => {
        if (err) {
          log.error('Error fetching logs:', err);
          if (callback) {
            callback(err);
          }
          return reject(err);
        }
        try {
          dockerContainer.modem.demuxStream(mystream, logStream, logStream);
          setTimeout(() => {
            logStream.end();
          }, 1500);
          mystream.on('end', () => {
            logStream.end();
            resolve();
          });

          mystream.on('error', (error) => {
            log.error('Stream error:', error);
            logStream.end();
            if (callback) {
              callback(error);
            }
            reject(error);
          });
        } catch (error) {
          log.error('Error during stream processing:', error);
          if (callback) {
            callback(new Error('An error occurred while processing the log stream'));
          }
          reject(error);
        }
      });
    });
  } catch (error) {
    log.error('Error in dockerContainerLogsPolling:', error);
    if (callback) {
      callback(error);
    }
    throw error;
  }
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
 * Converts an IPv4 address string (e.g., "192.168.1.1") into a 32-bit integer.
 * This allows for easier calculations and comparisons.
 *
 * @param {string} ip - The IPv4 address as a string.
 * @returns {number} - The corresponding 32-bit integer representation.
 */
function ipToLong(ip) {
  // eslint-disable-next-line no-bitwise
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Converts a 32-bit integer back into an IPv4 address string.
 * This reverses the `ipToLong` function.
 *
 * @param {number} long - The 32-bit integer representation of an IPv4 address.
 * @returns {string} - The IPv4 address in dot-decimal format.
 */
function longToIp(long) {
  return [
    // eslint-disable-next-line no-bitwise
    (long >>> 24) & 255,
    // eslint-disable-next-line no-bitwise
    (long >>> 16) & 255,
    // eslint-disable-next-line no-bitwise
    (long >>> 8) & 255,
    // eslint-disable-next-line no-bitwise
    long & 255,
  ].join('.');
}

/**
 * Parses a CIDR subnet (e.g., "192.168.1.0/24") and extracts useful information.
 * Determines the first usable IP and the last usable IP in the subnet.
 *
 * @param {string} cidr - The subnet in CIDR notation (e.g., "192.168.1.0/24").
 * @returns {Object} - An object containing:
 *   - `firstAddress`: The first usable IP in the subnet.
 *   - `lastAddress`: The last usable IP in the subnet.
 */
function parseCidrSubnet(cidr) {
  const [ip, prefix] = cidr.split('/');
  const subnetLong = ipToLong(ip);
  const hostBits = 32 - Number(prefix);
  // eslint-disable-next-line no-bitwise
  const subnetMask = (0xFFFFFFFF << hostBits) >>> 0;
  // eslint-disable-next-line no-bitwise
  const network = subnetLong & subnetMask;
  // eslint-disable-next-line no-bitwise
  const broadcast = network | (~subnetMask >>> 0);

  return {
    firstAddress: longToIp(network + 1),
    lastAddress: longToIp(broadcast - 1),
  };
}

/**
 * Finds the next available IP address in a Docker network for a given app.
 *
 * This function inspects the Docker network associated with the app, retrieves
 * the subnet and gateway details, and determines the next free IP within the
 * subnet range. It avoids allocated IPs and the gateway address.
 *
 * @param {string} appName - The name of the application.
 * @returns {Promise<string|null>} - The next available IP address, or null if no IP is available.
 */
async function getNextAvailableIPForApp(appName) {
  try {
    const { IPAM, Containers } = await docker.getNetwork(`fluxDockerNetwork_${appName}`).inspect();
    if (!IPAM?.Config?.length) throw new Error('No IPAM configuration found');

    const { Subnet, Gateway } = IPAM.Config[0];
    log.info(`Subnet: ${Subnet}, Gateway: ${Gateway}`);

    const { firstAddress, lastAddress } = parseCidrSubnet(Subnet);
    log.info(`First usable IP: ${firstAddress}, Last usable IP: ${lastAddress}`);

    const allocatedIPs = new Set();
    if (Containers) {
      Object.values(Containers).forEach((containerInfo) => {
        const containerIP = containerInfo.IPv4Address.split('/')[0];
        if (containerIP) {
          allocatedIPs.add(containerIP);
        }
      });
    }

    const filteredContainers = await getAppContainerObjects(appName);

    // eslint-disable-next-line no-restricted-syntax
    for (const container of filteredContainers) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const containerInfo = await docker.getContainer(container.Id).inspect();
        const containerIP = containerInfo.NetworkSettings.Networks[`fluxDockerNetwork_${appName}`]?.IPAMConfig?.IPv4Address;
        if (containerIP && !allocatedIPs.has(containerIP)) {
          allocatedIPs.add(containerIP);
        }
      } catch (error) {
        log.error(`Error inspecting container ${container.Id}: ${error.message}`);
      }
    }

    if (allocatedIPs?.size) {
      log.info(`Allocated IPs: ${Array.from(allocatedIPs)}`);
    }

    const gatewayLong = ipToLong(Gateway);

    // eslint-disable-next-line no-plusplus
    for (let ipLong = ipToLong(firstAddress); ipLong <= ipToLong(lastAddress); ipLong++) {
      const ip = longToIp(ipLong);
      if (ipLong !== gatewayLong && !allocatedIPs.has(ip)) {
        log.info(`Available IP found: ${ip}`);
        return ip;
      }
    }

    log.info(`No available IP addresses found in the subnet ${Subnet}.`);
    return null;
  } catch (error) {
    log.error(`Error in getNextAvailableIPForApp: ${error.message}`);
    return null;
  }
}

/**
 * Retrieves the IP address of a running Docker container.
 *
 * @param {string} containerName - The name of the container.
 * @returns {Promise<string|null>} - The container's IP address, or null if not found.
 * @throws {Error} - If the container has no network or IP address.
 */
const getContainerIP = async (containerName) => {
  try {
    const container = await docker.getContainer(containerName).inspect();
    const networks = Object.keys(container.NetworkSettings.Networks);

    if (!Array.isArray(networks) || networks.length === 0) {
      throw new Error('No networks found for container');
    }

    const networkName = networks[0]; // Automatically selects the first network
    const ipAddressOfContainer = container.NetworkSettings.Networks[networkName].IPAddress ?? null;

    if (!ipAddressOfContainer) {
      throw new Error('No IPAddress found for container');
    }

    return ipAddressOfContainer;
  } catch (error) {
    log.error(`Failed to retrieve IP for ${containerName}: ${error.message}`);
    return null;
  }
};

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
  // multiple data volumes can be attached, if containerData contains more paths separated by |
  // Syntax supports:
  //   - Primary mount: [flags]:<path>  (e.g., r:/data)
  //   - Component ref: <number>:<path>  (e.g., 0:/shared)
  //   - Directory mount: m:<subdir>:<path>  (e.g., m:logs:/var/log)
  //   - File mount: f:<filename>:<path>  (e.g., f:config.yaml:/etc/config.yaml)
  //   - Component dir: c:<number>:<subdir>:<path>  (e.g., c:0:backups:/backups)
  //   - Component file: cf:<number>:<filename>:<path>  (e.g., cf:0:cert.pem:/etc/ssl/cert.pem)
  // Note: Components can only reference components with lower indices (ordering restriction)

  // Import mount parsing utilities
  // eslint-disable-next-line global-require
  const mountParser = require('./utils/mountParser');
  // eslint-disable-next-line global-require
  const volumeConstructor = require('./utils/volumeConstructor');

  // Parse containerData using new enhanced parser
  let parsedMounts;
  try {
    parsedMounts = mountParser.parseContainerData(appSpecifications.containerData);
    log.info(`Parsed ${parsedMounts.allMounts.length} mount(s) for ${identifier}`);
  } catch (error) {
    log.error(`Failed to parse containerData for ${identifier}: ${error.message}`);
    throw error;
  }

  // Validate mount configuration
  try {
    volumeConstructor.validateMountConfiguration(parsedMounts, fullAppSpecs, appSpecifications);
  } catch (error) {
    log.error(`Mount configuration validation failed for ${identifier}: ${error.message}`);
    throw error;
  }

  // Construct Docker bind mounts
  let constructedVolumes;
  try {
    constructedVolumes = volumeConstructor.constructVolumes(
      parsedMounts,
      identifier,
      appName,
      fullAppSpecs,
      appSpecifications,
    );
    log.info(`Constructed ${constructedVolumes.length} volume bind(s) for ${identifier}`);
  } catch (error) {
    log.error(`Failed to construct volumes for ${identifier}: ${error.message}`);
    throw error;
  }
  const envParams = appSpecifications.environmentParameters || appSpecifications.enviromentParameters;
  if (appSpecifications.secrets) {
    const decodedEnvParams = await pgpService.decryptMessage(appSpecifications.secrets);
    const arraySecrets = JSON.parse(decodedEnvParams);
    if (Array.isArray(arraySecrets)) {
      arraySecrets.forEach((parameter) => {
        if (typeof parameter !== 'string' || parameter.length > 5000000) {
          throw new Error('Environment parameters from Secrets are invalid - type or length');
        } else if (parameter !== 'privileged') {
          envParams.push(parameter);
        }
      });
    } else {
      throw new Error('Environment parameters from Secrets are invalid - not an array');
    }
  }
  const adjustedCommands = [];
  appSpecifications.commands.forEach((command) => {
    if (command !== '--privileged') {
      adjustedCommands.push(command);
    }
  });

  const isSender = envParams?.some((env) => env.startsWith('LOG=SEND'));
  const isCollector = envParams?.some((env) => env.startsWith('LOG=COLLECT'));

  let syslogTarget = null;
  let syslogIP = null;

  if (fullAppSpecs && fullAppSpecs?.compose) {
    syslogTarget = fullAppSpecs.compose.find((app) => app.environmentParameters?.some((env) => env.startsWith('LOG=COLLECT')))?.name;
  }

  if (syslogTarget && isSender) {
    syslogIP = await getContainerIP(`flux${syslogTarget}_${appName}`);
  }

  if (syslogTarget && isCollector) {
    syslogIP = await getNextAvailableIPForApp(appName);
  }

  // Cross-app LOG=SEND → LOG=COLLECT discovery: if this is a SEND component and
  // the app has no in-compose collector, look at every app this one is
  // networkWith-linked to and ship to the first linked app exposing a COLLECT
  // component. Reachability is provided by appNetworkLinker attaching this
  // container to the linked app's docker network.
  if (!syslogTarget && isSender && fullAppSpecs) {
    // eslint-disable-next-line global-require
    const appNetworkLinker = require('./appLifecycle/appNetworkLinker');
    const linkedCollector = await appNetworkLinker.findLinkedAppLogCollector(fullAppSpecs);
    if (linkedCollector) {
      const collectorContainerName = `flux${linkedCollector.collectorComponentName}_${linkedCollector.linkedAppName}`;
      const linkedIP = await getContainerIP(collectorContainerName);
      if (linkedIP) {
        syslogTarget = linkedCollector.collectorComponentName;
        syslogIP = linkedIP;
        log.info(`Cross-app LOG: ${appName} sender will ship to ${collectorContainerName} at ${syslogIP}`);
      } else {
        log.warn(`Cross-app LOG: collector ${collectorContainerName} not reachable; ${appName} will fall back to json-file logging`);
      }
    }
  }

  let nodeId = null;
  let nodeSocketAddr = null;
  let labels = null;
  if (syslogTarget && syslogIP) {
    const nodeCollateralInfo = await generalService.obtainNodeCollateralInformation().catch(() => { throw new Error('Host Identifier information not available at the moment'); });
    nodeId = nodeCollateralInfo.txhash + nodeCollateralInfo.txindex;
    nodeSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!nodeSocketAddr) {
      throw new Error('Not possible to get node IP');
    }
    labels = {
      app_name: `${appName}`,
      host_id: `${nodeId}`,
      host_ip: `${nodeSocketAddr}`,
    };
  }
  log.info(`syslogTarget=${syslogTarget}, syslogIP=${syslogIP}`);

  const logConfig = syslogTarget && syslogIP
    ? {
      Type: 'gelf',
      Config: {
        'gelf-address': `udp://${syslogIP}:514`,
        'gelf-compression-type': 'none',
        tag: `${appSpecifications.name}`,
        labels: 'app_name,host_id,host_ip',
      },
    }
    : {
      Type: 'json-file',
      Config: {
        'max-file': '1',
        'max-size': '20m',
      },
    };
  const autoAssignedIP = await getNextAvailableIPForApp(appName);

  // CPU burst eligibility is decided once here, where the full app spec is in
  // scope, and stamped onto the container as docker labels. Every subsequent
  // start of this container (initial start, restart, recovery) reads the
  // labels in appDockerStart and reapplies burst — no per-caller plumbing.
  const burstOwner = fullAppSpecs?.owner || null;
  const burstEligible = burstOwner
    && cpuBurstHelper.isEnterpriseOwner(burstOwner)
    && await cpuBurstHelper.isCpuBurstSupported();
  const burstLabels = burstEligible
    ? {
      'flux.burst.eligible': 'true',
      'flux.burst.cores': String(appSpecifications.cpu),
    }
    : null;
  const containerLabels = (labels || burstLabels)
    ? { ...(labels || {}), ...(burstLabels || {}) }
    : null;
  if (burstEligible) {
    log.info(`CPU burst: marking ${identifier} as burst-eligible (cores=${appSpecifications.cpu})`);
  }

  const options = {
    Image: appSpecifications.repotag,
    name: getAppIdentifier(identifier),
    Hostname: appSpecifications.name,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: adjustedCommands,
    Env: envParams,
    Tty: false,
    ExposedPorts: exposedPorts,
    // Conditionally include Labels only if it's not null
    ...(containerLabels && { Labels: containerLabels }),
    HostConfig: {
      NanoCPUs: Math.round(appSpecifications.cpu * 1e9),
      Memory: Math.round(appSpecifications.ram * 1024 * 1024),
      MemorySwap: Math.round((appSpecifications.ram + (config.fluxapps.defaultSwap * 1000)) * 1024 * 1024), // default 2GB swap
      // StorageOpt: { size: '5G' }, // root fs has max default 5G size, v8 is 5G + specified as per config.fluxapps.hddFileSystemMinimum
      Mounts: constructedVolumes, // Using modern Mount objects instead of legacy Binds
      Ulimits: [
        {
          Name: 'nofile',
          Soft: 100000,
          Hard: 100000, // 1048576
        },
      ],
      PortBindings: portBindings,
      RestartPolicy: {
        Name: 'no',
      },
      NetworkMode: `fluxDockerNetwork_${appName}`,
      LogConfig: logConfig,
      ExtraHosts: [`fluxnode.service:${config.server.fluxNodeServiceAddress}`],
    },
    // Conditionally include NetworkingConfig only if a static IP was determined.
    ...(autoAssignedIP && {
      NetworkingConfig: {
        EndpointsConfig: {
          [`fluxDockerNetwork_${appName}`]: {
            IPAMConfig: {
              IPv4Address: autoAssignedIP,
            },
          },
        },
      },
    }),
  };

  // get docker info about Backing Filesystem
  // eslint-disable-next-line no-use-before-define
  const dockerInfoResp = await dockerInfo();
  log.info(dockerInfoResp);
  const driverStatus = dockerInfoResp.DriverStatus;
  const backingFs = driverStatus.find((status) => status[0] === 'Backing Filesystem'); // d_type must be true for overlay, docker would not work if not
  if (backingFs && backingFs[1] === 'xfs') {
    // check that we have quota

    const mountTarget = isArcane ? '/dat/var/lib/docker' : '/var/lib/docker';

    const hasQuotaPossibility = await deviceHelper.hasQuotaOptionForMountTarget(mountTarget);

    if (hasQuotaPossibility) {
      options.HostConfig.StorageOpt = { size: `${config.fluxapps.hddFileSystemMinimum}G` }; // must also have 'pquota' mount option
    }
  }

  if (options.Env.length) {
    const fluxStorageEnv = options.Env.find((env) => env.startsWith(('F_S_ENV=')));
    if (fluxStorageEnv) {
      const index = options.Env.indexOf(fluxStorageEnv);
      if (index > -1) {
        options.Env.splice(index, 1);
      }
      const url = fluxStorageEnv.split('F_S_ENV=')[1];
      const envVars = await obtainPayloadFromStorage(url, appName);
      if (Array.isArray(envVars) && envVars.length < 200) {
        envVars.forEach((parameter) => {
          if (typeof parameter !== 'string' || parameter.length > 5000000) {
            throw new Error(`Environment parameters from Flux Storage ${fluxStorageEnv} are invalid`);
          } else if (parameter !== '--privileged') {
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
      const index = options.Cmd.indexOf(fluxStorageCmd);
      if (index > -1) {
        options.Cmd.splice(index, 1);
      }
      const url = fluxStorageCmd.split('F_S_CMD=')[1];
      const cmdVars = await obtainPayloadFromStorage(url, appName);
      if (Array.isArray(cmdVars) && cmdVars.length < 200) {
        cmdVars.forEach((parameter) => {
          if (typeof parameter !== 'string' || parameter.length > 5000000) {
            throw new Error(`Commands parameters from Flux Storage ${fluxStorageCmd} are invalid`);
          } else if (parameter !== '--privileged') {
            options.Cmd.push(parameter);
          }
        });
      } else {
        throw new Error(`Commands parameters from Flux Storage ${fluxStorageCmd} are invalid`);
      }
    }
  }

  // Inject Flux-provided env vars so apps can reference them directly or
  // via ${VAR} expansion in their own config files (e.g. Datadog's
  // DD_HOSTNAME=${FLUX_NODE_HOST_IP}). Appended last so they win over any
  // identically-named values supplied by the operator.
  const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
  const nodeHostIp = localSocketAddr ? extractIp(localSocketAddr) : null;
  if (nodeHostIp) {
    options.Env.push(`FLUX_NODE_HOST_IP=${nodeHostIp}`);
  } else {
    log.warn(`FLUX_NODE_HOST_IP not injected for ${identifier}: node IP not available`);
  }
  options.Env.push(`FLUX_APP_NAME=${appName}`);

  const app = await docker.createContainer(options).catch((error) => {
    log.error(error);
    throw error;
  });

  return app;
}

/**
 * Updates the CPU limits of a Docker container.
 *
 * @param {string} idOrName - The ID or name of the Docker container.
 * @param {number} nanoCpus - The CPU limit in nanoCPUs (1 CPU = 1,000,000,000 nanoCPUs).
 * @returns {Promise<string>} message
 */
async function appDockerUpdateCpu(idOrName, nanoCpus) {
  try {
    // Get the Docker container by ID or name
    const dockerContainer = await getDockerContainerByIdOrName(idOrName);

    // Update the container's CPU resources
    await dockerContainer.update({
      NanoCpus: nanoCpus,
    });

    return `Flux App ${idOrName} successfully updated with ${nanoCpus / 1e9} CPUs.`;
  } catch (error) {
    log.error(error);
    throw new Error(`Failed to update CPU resources for ${idOrName}: ${error.message}`);
  }
}

/**
 * Starts app's docker.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerStart(idOrName) {
  try {
    // container ID or name
    const dockerContainer = await getDockerContainerByIdOrName(idOrName);

    globalState.stoppingContainers.delete(getDockerName(idOrName));
    await dockerContainer.start(); // may throw

    // Apply CFS burst after start — cgroup paths only exist once the container
    // is running. Eligibility was decided at appDockerCreate time and stamped
    // onto the container as labels; we just read them here. This means burst
    // is reapplied on every start path (initial install, restart, recovery)
    // without each caller having to know about burst.
    try {
      const containerInspect = await dockerContainer.inspect();
      const dockerLabels = containerInspect.Config?.Labels || {};
      if (dockerLabels['flux.burst.eligible'] === 'true') {
        const cpuCores = parseFloat(dockerLabels['flux.burst.cores']);
        const pid = containerInspect.State?.Pid;
        if (pid && cpuCores > 0) {
          await cpuBurstHelper.applyBurst(pid, cpuCores, idOrName);
        } else {
          log.warn(`CPU burst: ${idOrName} marked eligible but pid/cores missing (pid=${pid}, cores=${cpuCores})`);
        }
      }
    } catch (burstError) {
      // Burst is best-effort — do not fail container start
      log.warn(`CPU burst: failed to configure burst for ${idOrName}: ${burstError.message}`);
    }

    return `Flux App ${idOrName} successfully started.`;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * Stops app's docker.
 *
 * @param {string} idOrName
 * @param {number} [timeout] Seconds to wait before Docker sends SIGKILL. Uses Docker default (~10s) when omitted.
 * @returns {string} message
 */
async function appDockerStop(idOrName, timeout) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  // Check if container is running before attempting to stop
  const containerInfo = await dockerContainer.inspect();
  if (!containerInfo.State.Running) {
    return `Flux App ${idOrName} is already stopped.`;
  }

  const dockerName = getDockerName(idOrName);
  // Held for the duration of the stop operation (legitimately hours under a
  // graceful shutdown) so the die handler swallows the deliberate stop and the
  // reconciler defers. Cleared when the operation settles - never left for the
  // die event to clean up: a lost event (stream outage) would leak the flag
  // and permanently wedge the reconciler's actuation for this component.
  globalState.stoppingContainers.add(dockerName);

  try {
    const opts = timeout !== undefined ? { t: timeout } : {};
    await dockerContainer.stop(opts);
  } finally {
    globalState.stoppingContainers.delete(dockerName);
  }
  return `Flux App ${idOrName} successfully stopped.`;
}

/**
 * Restarts app's docker.
 * If the container is stopped, it will be started instead of restarted.
 *
 * @param {string} idOrName
 * @returns {string} message
 */
async function appDockerRestart(idOrName) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  // Check if container is running
  const containerInfo = await dockerContainer.inspect();
  if (!containerInfo.State.Running) {
    // If stopped, start it instead of restarting
    globalState.stoppingContainers.delete(getDockerName(idOrName));
    await dockerContainer.start();
    return `Flux App ${idOrName} was stopped, successfully started.`;
  }

  const dockerName = getDockerName(idOrName);
  globalState.stoppingContainers.add(dockerName);
  try {
    await dockerContainer.restart();
  } finally {
    globalState.stoppingContainers.delete(dockerName);
  }
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

  const dockerName = getDockerName(idOrName);
  // same flag lifetime as appDockerStop: operation-scoped, never event-scoped
  globalState.stoppingContainers.add(dockerName);

  try {
    await dockerContainer.kill();
  } finally {
    globalState.stoppingContainers.delete(dockerName);
  }
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

  globalState.stoppingContainers.delete(getDockerName(idOrName));
  await dockerContainer.remove();
  return `Flux App ${idOrName} successfully removed.`;
}

/**
 * Force removes app's docker container (even if running).
 *
 * @param {string} idOrName
 * @param {boolean} removeVolumes - Also remove anonymous volumes
 * @returns {string} message
 */
async function appDockerForceRemove(idOrName, removeVolumes = true) {
  // container ID or name
  const dockerContainer = await getDockerContainerByIdOrName(idOrName);

  globalState.stoppingContainers.delete(getDockerName(idOrName));
  await dockerContainer.remove({ force: true, v: removeVolumes });
  return `Flux App ${idOrName} successfully force removed.`;
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
 * Reads a container's network attachment against its own configured NetworkMode.
 *
 * A Flux app component container is created with NetworkMode =
 * fluxDockerNetwork_<app> and a matching endpoint in NetworkSettings.Networks
 * (see appDockerCreate). A start that fails "programming external connectivity"
 * - e.g. a host-port bind conflict during a restart after an unclean reboot -
 * can leave libnetwork holding a stale endpoint for that container: the next
 * `docker start` then brings the task up attached to NO network at all.
 * NetworkMode still names the network, but NetworkSettings.Networks no longer
 * carries it (or carries it without an IP). Such a container runs with no IP, no
 * embedded DNS (it cannot resolve sibling components by name) and no published
 * ports, and a plain start never repairs it - only a recreate, which allocates a
 * fresh endpoint, clears the stale state. These helpers surface that condition so
 * callers (the reconciler) can detect and heal it. parseContainerNetworkAttachment
 * is the pure classifier over a Docker inspect object; getContainerNetworkAttachment
 * is the inspect-and-classify wrapper.
 *
 * @param {object} info - a Docker container inspect object
 * @returns {{managed: boolean, running: boolean, networkMode: (string|null), attached: boolean}}
 *   managed  - NetworkMode is a fluxDockerNetwork_* (we own its networking)
 *   running  - the container task is running
 *   attached - the NetworkMode network is present in Networks with an IP
 */
function parseContainerNetworkAttachment(info) {
  const networkMode = info && info.HostConfig ? info.HostConfig.NetworkMode || null : null;
  const running = !!(info && info.State && info.State.Running);
  const managed = typeof networkMode === 'string' && networkMode.startsWith('fluxDockerNetwork_');
  let attached = false;
  if (managed) {
    const networks = (info && info.NetworkSettings && info.NetworkSettings.Networks) || {};
    const endpoint = networks[networkMode];
    attached = !!(endpoint && endpoint.IPAddress);
  }
  return {
    managed, running, networkMode, attached,
  };
}

async function getContainerNetworkAttachment(idOrName) {
  const info = await dockerContainerInspect(idOrName);
  return parseContainerNetworkAttachment(info);
}

/**
 * Whether a container is running but not attached to its own managed network -
 * the unrecoverable-by-restart state described in getContainerNetworkAttachment.
 * A non-managed (host/none/bridge) container is never considered detached.
 *
 * @param {{managed: boolean, running: boolean, attached: boolean}} attachment
 * @returns {boolean}
 */
function isContainerDetachedFromNetwork(attachment) {
  if (!attachment) return false;
  return !!(attachment.managed && attachment.running && !attachment.attached);
}

/**
 * Whether a docker network exists, by name. Used to distinguish a stale endpoint
 * (network present, container not attached - recreatable) from a pruned network
 * (network gone - a recreate would fail on a missing NetworkMode). Any inspect
 * failure is treated as "does not exist".
 *
 * @param {string} networkName
 * @returns {Promise<boolean>}
 */
async function dockerNetworkExists(networkName) {
  if (!networkName) return false;
  try {
    await docker.getNetwork(networkName).inspect();
    return true;
  } catch (err) {
    return false;
  }
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
        Subnet: '172.23.0.0/24',
        Gateway: '172.23.0.1',
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
 *
 * @returns {Promise<Docker.NetworkInspectInfo[]>}
 */
async function getFluxDockerNetworks() {
  const fluxNetworks = await docker.listNetworks({
    filters: JSON.stringify({
      name: ['fluxDockerNetwork'],
    }),
  });

  return fluxNetworks;
}

/**
 *
 * @returns {Promise<string[]>}
 */
async function getFluxDockerNetworkPhysicalInterfaceNames() {
  const fluxNetworks = await getFluxDockerNetworks();

  const interfaceNames = fluxNetworks.map((network) => {
    // the physical interface name is br-<first 12 chars of Id>
    const intName = `br-${network.Id.slice(0, 12)}`;
    return intName;
  });

  return interfaceNames;
}

/**
 *
 * @returns {Promise<string[]>}
 */
async function getFluxDockerNetworkSubnets() {
  const fluxNetworks = await getFluxDockerNetworks();
  const subnets = fluxNetworks.map((network) => network.IPAM.Config[0].Subnet);
  return subnets;
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
        Subnet: `172.23.${number}.0/24`,
        Gateway: `172.23.${number}.1`,
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

/**
 * Force removes flux application docker network by disconnecting all endpoints first
 *
 * @param {string} appname - Application name
 * @returns {object} response
 */
async function forceRemoveFluxAppDockerNetwork(appname) {
  // eslint-disable-next-line no-shadow, global-require
  const log = require('../lib/log');
  const fluxAppNetworkName = `fluxDockerNetwork_${appname}`;
  const network = docker.getNetwork(fluxAppNetworkName);

  // Check if network exists
  let networkInfo;
  try {
    networkInfo = await dockerNetworkInspect(network);
  } catch (error) {
    return `Flux App Network of ${appname} already does not exist.`;
  }

  // Disconnect all containers from the network
  if (networkInfo.Containers) {
    const containerIds = Object.keys(networkInfo.Containers);
    if (containerIds.length > 0) {
      log.info(`Force disconnecting ${containerIds.length} container(s) from network ${fluxAppNetworkName}`);

      // Disconnect each container
      // eslint-disable-next-line no-restricted-syntax
      for (const containerId of containerIds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await network.disconnect({ Container: containerId, Force: true });
          log.info(`Disconnected container ${containerId} from network ${fluxAppNetworkName}`);
        } catch (error) {
          log.warn(`Failed to disconnect container ${containerId}: ${error.message}`);
        }
      }
    }
  }

  // Now try to remove the network
  try {
    const response = await dockerRemoveNetwork(network);
    log.info(`Successfully removed network ${fluxAppNetworkName}`);
    return response;
  } catch (error) {
    log.error(`Failed to remove network ${fluxAppNetworkName} after disconnecting endpoints: ${error.message}`);
    throw error;
  }
}

/**
 * Connects a container to an existing docker network. Idempotent — if the
 * container is already attached to the network this resolves without error.
 *
 * Strategy: inspect the container's NetworkSettings.Networks and return early
 * if the network is already present. Falls back to a narrow string-match catch
 * only for the connect race window (another caller wired the container between
 * our inspect and connect). The previous blanket 403 catch is gone — 403 is
 * overloaded by docker for unrelated failure modes (e.g. forbidden swarm-scoped
 * operations) and was silently masking them.
 *
 * @param {string} containerIdOrName - container id or name
 * @param {string} networkName - target docker network name
 * @returns {Promise<void>}
 */
async function appDockerNetworkConnect(containerIdOrName, networkName) {
  try {
    const containerInfo = await docker.getContainer(containerIdOrName).inspect();
    const attached = containerInfo && containerInfo.NetworkSettings && containerInfo.NetworkSettings.Networks;
    if (attached && Object.prototype.hasOwnProperty.call(attached, networkName)) {
      return;
    }
  } catch (error) {
    // Inspect failed (container not found, transient docker error). Let the
    // connect attempt below surface the real error message.
  }

  const network = docker.getNetwork(networkName);
  try {
    await network.connect({ Container: containerIdOrName });
  } catch (error) {
    if (/already exists in network|already connected/i.test(error.message || '')) {
      return;
    }
    throw error;
  }
}

/**
 * Escapes a string for safe use inside a RegExp source.
 */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the docker container summary objects (output of listContainers)
 * belonging to a given Flux app — both the modern component form
 * `flux<componentName>_<appName>` / `zel<componentName>_<appName>` and the
 * legacy single-component form `flux<appName>` / `zel<appName>`.
 *
 * Docker-listing based on purpose: the local DB blanks `compose` for enterprise
 * apps, so iterating spec.compose would miss components on non-Arcane nodes. The
 * regex anchors the `flux`/`zel` prefix so non-Flux containers cannot match.
 *
 * @param {string} appName
 * @returns {Promise<Array<object>>} container summary objects
 */
async function getAppContainerObjects(appName) {
  const containers = await dockerListContainers(true);
  const singleComponentSlashName = getAppDockerNameIdentifier(appName);
  const componentRegex = new RegExp(`^/(?:flux|zel)[a-zA-Z0-9]+_${escapeRegExp(appName)}$`);

  return (containers || []).filter((container) => {
    const names = container.Names || [];
    return names.some((name) => name === singleComponentSlashName || componentRegex.test(name));
  });
}

/**
 * Returns the docker container names (without leading slash) belonging to a
 * given Flux app. Thin wrapper around getAppContainerObjects.
 *
 * @param {string} appName
 * @returns {Promise<string[]>}
 */
async function getAppContainerNames(appName) {
  const objects = await getAppContainerObjects(appName);
  const names = [];
  objects.forEach((container) => {
    const raw = container.Names && container.Names[0];
    if (!raw) return;
    const name = raw.replace(/^\//, '');
    if (!names.includes(name)) names.push(name);
  });
  return names;
}

/**
 * Remove all unused containers. Unused contaienrs are those wich are not running
 */
async function pruneContainers() {
  return docker.pruneContainers();
}

/**
 * Remove all unused networks. Unused networks are those which are not referenced by any running containers
 */
async function pruneNetworks() {
  return docker.pruneNetworks();
}

/**
 * Remove all unused Volumes. Unused Volumes are those which are not referenced by any containers
 */
async function pruneVolumes() {
  return docker.pruneVolumes();
}

/**
 * Remove all unused Images. Unused Images are those which are not referenced by any containers
 */
async function pruneImages() {
  return docker.pruneImages();
}

/**
 * Return docker system information
 *
 * @returns {object}
 */
async function dockerInfo() {
  const info = await docker.info();
  return info;
}

/**
 * Returns the version of Docker that is running and various information about the system that Docker is running on.
 *
 * @returns {object}
 */
async function dockerVersion() {
  const version = await docker.version();
  return version;
}

/**
 * Returns docker events stream
 *
 * @param {object} options - Docker event filter options
 * @returns {object} Readable stream of Docker events
 */
async function dockerGetEvents(options = {}) {
  const events = await docker.getEvents(options);
  return events;
}

async function waitForDocker() {
  const RETRY_DELAY_MS = 5000;
  const LOG_INTERVAL_MS = 60000;
  let lastLogAt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await docker.ping();
      log.info('Docker daemon connected');
      return;
    } catch (error) {
      const now = Date.now();
      if (!lastLogAt || now - lastLogAt >= LOG_INTERVAL_MS) {
        log.info(`Waiting for Docker daemon... (${error.message})`);
        lastLogAt = now;
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(RETRY_DELAY_MS);
    }
  }
}

/**
 * Returns docker usage information
 *
 * @returns {object}
 */
async function dockerGetUsage() {
  const df = await docker.df();
  return df;
}

/**
 * Fix docker logs.
 * @returns {Promise<void>}
 */
async function dockerLogsFix() {
  try {
    const cwd = path.join(__dirname, '../../../helpers');
    const scriptPath = path.join(cwd, 'dockerLogsFix.sh');
    const { stdout } = await serviceHelper.runCommand(scriptPath, { cwd });

    // we do this so we don't log empty lines if there is no output
    const lines = stdout.split('\n');
    // this always has length
    if (lines.slice(-1)[0] === '') lines.pop();

    lines.forEach((line) => log.info(line));
  } catch (error) {
    log.error(error);
  }
}

async function getAppNameByContainerIp(ip) {
  const fluxNetworks = await docker.listNetworks({
    filters: JSON.stringify({
      name: ['fluxDockerNetwork'],
    }),
  });

  const fluxNetworkNames = fluxNetworks.map((n) => n.Name);

  const networkPromises = [];
  fluxNetworkNames.forEach((networkName) => {
    const dockerNetwork = docker.getNetwork(networkName);
    networkPromises.push(dockerNetwork.inspect());
  });

  const fluxNetworkData = await Promise.all(networkPromises);

  let appName = null;
  // eslint-disable-next-line no-restricted-syntax
  for (const fluxNetwork of fluxNetworkData) {
    const subnet = fluxNetwork.IPAM.Config[0].Subnet;
    if (serviceHelper.ipInSubnet(ip, subnet)) {
      appName = fluxNetwork.Name.split('_')[1];
      break;
    }
  }

  return appName;
}

async function migrateContainerRestartPolicies() {
  try {
    const containers = await dockerListContainers(true);
    if (!containers) return;
    const fluxContainers = containers.filter((c) => c.Names[0].startsWith('/flux') || c.Names[0].startsWith('/zel'));
    let migrated = 0;
    for (const c of fluxContainers) {
      try {
        const container = docker.getContainer(c.Id);
        // eslint-disable-next-line no-await-in-loop
        const info = await container.inspect();
        if (info.HostConfig.RestartPolicy.Name !== 'no') {
          // eslint-disable-next-line no-await-in-loop
          await container.update({ RestartPolicy: { Name: 'no' } });
          migrated += 1;
        }
      } catch (err) {
        log.warn(`Failed to migrate restart policy for ${c.Names[0]}: ${err.message}`);
      }
    }
    if (migrated > 0) {
      log.info(`Migrated restart policy to 'no' for ${migrated} containers`);
    }
  } catch (error) {
    log.error(`Failed to migrate container restart policies: ${error.message}`);
  }
}

module.exports = {
  appDockerCreate,
  appDockerUpdateCpu,
  appDockerImageRemove,
  appDockerKill,
  appDockerPause,
  appDockerRemove,
  appDockerForceRemove,
  appDockerRestart,
  appDockerStart,
  appDockerStop,
  appDockerTop,
  appDockerUnpause,
  createFluxAppDockerNetwork,
  createFluxDockerNetwork,
  dockerContainerChanges,
  dockerContainerExec,
  dockerContainerInspect,
  dockerContainerLogs,
  dockerContainerLogsPolling,
  dockerContainerLogsStream,
  dockerContainerStats,
  dockerContainerStatsStream,
  dockerCreateNetwork,
  dockerGetEvents,
  dockerGetUsage,
  dockerInfo,
  dockerListContainers,
  dockerListImages,
  dockerLogsFix,
  dockerNetworkInspect,
  dockerPullStream,
  dockerRemoveNetwork,
  dockerVersion,
  getAppDockerNameIdentifier,
  getAppIdentifier,
  getBaseAppName,
  getDockerContainer,
  getDockerContainerByIdOrName,
  getDockerContainerOnly,
  getFluxDockerNetworkPhysicalInterfaceNames,
  getFluxDockerNetworkSubnets,
  migrateContainerRestartPolicies,
  pruneContainers,
  pruneImages,
  pruneNetworks,
  pruneVolumes,
  removeFluxAppDockerNetwork,
  forceRemoveFluxAppDockerNetwork,
  appDockerNetworkConnect,
  getAppContainerNames,
  getAppContainerObjects,
  getAppNameByContainerIp,
  parseContainerNetworkAttachment,
  getContainerNetworkAttachment,
  isContainerDetachedFromNetwork,
  dockerNetworkExists,
  waitForDocker,
};
