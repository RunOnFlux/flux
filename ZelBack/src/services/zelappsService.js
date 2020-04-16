const config = require('config');
// eslint-disable-next-line import/no-extraneous-dependencies
const os = require('os');
const Docker = require('dockerode');
const stream = require('stream');
const path = require('path');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

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

async function dockerContainerInspect(container) {
  const response = await container.inspect().catch((error) => {
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

function dockerContainerLogs(container, callback) {
  try {
    const logStream = new stream.PassThrough();
    let logStreamData = '';
    logStream.on('data', (chunk) => {
      logStreamData += chunk.toString('utf8');
    });

    container.logs(
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
            container.modem.demuxStream(mystream, logStream, logStream);
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

function zelAppPull(req, res) {
  try {
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
  const zelapps = await dockerListContainers(false).catch((error) => {
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

async function listAllZelApps(req, res) {
  const zelapps = await dockerListContainers(true).catch((error) => {
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

async function zelAppDockerCreate(zelappSpecifications, fluxNetworkID) {
  // todo https://docs.docker.com/engine/api/v1.37/#operation/ContainerCreate
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
      Memory: zelappSpecifications.ram * 1e6,
      Binds: [`~/zelflux/ZelApps/${zelappSpecifications.name}:${zelappSpecifications.containerData}`],
      Ulimits: [
        {
          Name: 'nofile',
          Soft: 8192,
          Hard: 16384,
        },
      ],
      PortBindings: {
        [`${zelappSpecifications.containerPort}/tcp`]: [
          {
            HostPort: zelappSpecifications.port,
          },
        ],
      },
      RestartPolicy: {
        Name: 'unless-stopped',
      },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        NetworkID: fluxNetworkID,
        IPAddress: zelappSpecifications.ip,
      },
    },
  };

  const zelapp = await docker.createContainer(options).catch((error) => {
    log.error(error);
    throw error;
  });
  return zelapp;
}

async function zelAppDockerStart(container) {
  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.start().catch((error) => {
    log.error(error);
    throw error;
  });
  return zelapp;
}

async function zelAppDockerStop(container) {
  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.stop().catch((error) => {
    log.error(error);
    throw error;
  });
  return zelapp;
}

async function zelAppStart(req, res) {
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
    throw error;
  });

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppStop(req, res) {
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
    throw error;
  });

  const zelappResponse = serviceHelper.createDataMessage(zelappRes);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppRestart(req, res) {
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.restart().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(zelapp);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppKill(req, res) {
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.kill().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(zelapp);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppRemove(req, res) {
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.remove().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(zelapp);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppPause(req, res) {
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.pause().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(zelapp);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppUnpause(req, res) {
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.unpause().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(zelapp);
  return res ? res.json(zelappResponse) : zelappResponse;
}

async function zelAppTop(req, res) {
  // List processes running inside a container
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const zelapp = await dockerContainer.top().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappResponse = serviceHelper.createDataMessage(zelapp);
  return res ? res.json(zelappResponse) : zelappResponse;
}

function zelAppLog(req, res) {
  try {
    let { container } = req.params;
    container = container || req.query.container;

    if (!container) {
      throw new Error('No ZelApp specified');
    }

    const dockerContainer = docker.getContainer(container);

    dockerContainerLogs(dockerContainer, (error, dataLog) => {
      if (error) {
        throw error;
      } else {
        const containerLogResponse = serviceHelper.createDataMessage(dataLog);
        res.json(containerLogResponse);
      }
    });
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
  let { container } = req.params;
  container = container || req.query.container;

  if (!container) {
    const errMessage = serviceHelper.createErrorMessage('No ZelApp specified');
    return res.json(errMessage);
  }

  const dockerContainer = docker.getContainer(container);

  const response = await dockerContainerInspect(dockerContainer).catch(
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
function zelAppExec(req, res) {
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
}

async function zelShareFile(req, res) {
  let { file } = req.params;
  file = file || req.query.file;

  const dirpath = path.join(__dirname, '../../../');
  const filepath = `${dirpath}/ZelApps/ZelShare/${file}`;

  return res.sendFile(filepath);
}

async function zelFluxUsage(req, res) {
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
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
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
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
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
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
  res.json(response);
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
  // port this temporary folding at home let be a unique 30000 though and highest available ip on 172.16.0.2;
  // as according to specifications ports are asssigned from lowest possible number ();
  // if not exists create zelflux network for docker on gateway ip docker network create --subnet=172.16.0.0/16 --gateway=172.16.0.1 zelfluxDockerNetwork
  try {
    // ram is specified in MB, hdd specified in GB
    const zelAppSpecifications = {
      repotag: 'yurinnick/folding-at-home:latest',
      name: 'zelFoldingAtHome', // corresponds to docker name and this name is stored in zelapps mongo database
      port: 30000,
      ip: '172.16.0.2',
      cpu: 0.5,
      ram: 500,
      hdd: 15,
      enviromentParameters: [`USER=${userconfig.initial.zelid}`, 'TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
      commands: ['init'],
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
    console.log(value);
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
    if (zelappResult) {
      throw new Error('ZelApp is already installed.');
    }

    // register the zelapp
    await serviceHelper.insertOneToDatabase(zelappsDatabase, localZelAppsInformation, zelAppSpecifications).catch((error) => {
      dbopen.close();
      throw error;
    });

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
    const fluxNetworkID = await dockerNetworkInspect(networkID).catch(() => {
      fluxNetworkExists = false;
    });
    // create or check docker network
    // docker network create --subnet=172.16.0.0/16 --gateway=172.16.0.1 zelfluxDockerNetwork
    if (!fluxNetworkExists) {
      await dockerCreateNetwork(fluxNetworkOptions);
    }

    // pull image
    // set the appropriate HTTP header
    res.setHeader('Content-Type', 'text/html');
    dockerPullStream(zelAppSpecifications.repotag, res, async (error, dataLog) => {
      if (error) {
        throw error;
      } else {
        log.info(dataLog);
        res.write('\r\nPulling global ZelApp success\r\n');
        res.write('Creating local ZelApp\r\n');
        const dockerContainer = zelAppDockerCreate(zelAppSpecifications, fluxNetworkID).catch((e) => {
          throw e;
        });
        res.write('\r\nStarting ZelApp\r\n');
        const zelapp = await dockerContainer.start().catch((error2) => {
          throw error2;
        });
        const zelappResponse = serviceHelper.createDataMessage(zelapp);
        res.write(zelappResponse);
        res.end();
      }
    });
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
  registerZelAppLocally,
  temporaryZelAppRegisterFunctionForFoldingAtHome,
  createZelFluxNetwork,
};
