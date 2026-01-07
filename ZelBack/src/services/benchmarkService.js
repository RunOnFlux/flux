const path = require('node:path');
const fs = require('node:fs/promises');

const config = require('config');
const userconfig = require('../../../config/userconfig');
const log = require('../lib/log');

const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const generalService = require('./generalService');
const upnpService = require('./upnpService');
const fluxRpc = require('./utils/fluxRpc');
const dbHelper = require('./dbHelper');

// eslint-disable-next-line no-unused-vars
const isArcane = Boolean(process.env.FLUXOS_PATH);

const benchmarkCollection = 'benchmark';
const validTiers = ['CUMULUS', 'NIMBUS', 'STRATUS'];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let benchdClient = null;
let lastDbUpdateTimestamp = 0;

async function buildBenchdClient() {
  // just use process.cwd() or os.homedir() or something
  const homeDirPath = path.join(__dirname, '../../../../');
  const fluxbenchdPath = process.env.FLUXBENCH_PATH || path.join(homeDirPath, '.fluxbenchmark');

  const exists = await fs.stat(fluxbenchdPath).catch(() => false);

  const prefix = exists ? 'flux' : 'zel';

  const username = `${prefix}benchuser`;
  const password = `${prefix}benchpassword`;

  const { initial: { testnet: isTestnet } } = userconfig;
  const portId = isTestnet ? 'rpcporttestnet' : 'rpcport';
  const rpcPort = config.benchmark[portId];

  const client = new fluxRpc.FluxRpc(`http://127.0.0.1:${rpcPort}`, {
    auth: { username, password }, timeout: 10_000, mode: 'fluxbenchd',
  });

  benchdClient = client;
  return client;
}

/**
 * To execute a remote procedure call (RPC).
 *
 * @param {string} rpc Remote procedure call.
 * @param {string[]} params RPC parameters.
 * @returns {object} Message.
 */
async function executeCall(rpc, params) {
  const rpcparameters = params || [];

  if (!benchdClient) await buildBenchdClient();

  let callResponse;

  try {
    const data = await benchdClient.run(rpc, { params: rpcparameters });
    const successResponse = messageHelper.createDataMessage(data);
    callResponse = successResponse;
  } catch (error) {
    const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
    callResponse = daemonError;
  }

  return callResponse;
}

/**
 * Stores benchmark data to the database (only if tier is valid and not updated within a day)
 * @param {object} benchmarkData - The benchmark data to store
 * @param {string} tierStatus - The node tier status (CUMULUS, NIMBUS, STRATUS)
 */
async function storeBenchmarkToDb(benchmarkData, tierStatus) {
  try {

    // Only update once per day
    const now = Date.now();
    if (now - lastDbUpdateTimestamp < ONE_DAY_MS) {
      return;
    }

    // Only store if status is a valid tier
    if (!validTiers.includes(tierStatus)) {
      log.debug(`Benchmark status ${tierStatus} is not a valid tier, skipping database storage`);
      return;
    }

    const dbClient = dbHelper.databaseConnection();
    if (!dbClient) {
      log.warn('Database connection not available for storing benchmark');
      return;
    }

    const database = dbClient.db(config.database.local.database);
    const query = { _id: 'nodeBenchmark' };
    const update = {
      $set: {
        benchmark: benchmarkData,
        tier: tierStatus,
        updatedAt: now,
      },
    };
    const options = { upsert: true };
    await dbHelper.updateOneInDatabase(database, benchmarkCollection, query, update, options);
    lastDbUpdateTimestamp = now;
    log.info('Benchmark data stored to database');
  } catch (error) {
    log.error(`Failed to store benchmark to database: ${error.message}`);
  }
}

/**
 * Retrieves benchmark data from the database
 * @returns {Promise<{benchmark: object|null, tier: string|null}>}
 */
async function getBenchmarkFromDb() {
  try {
    const dbClient = dbHelper.databaseConnection();
    if (!dbClient) {
      return { benchmark: null, tier: null };
    }
    const database = dbClient.db(config.database.local.database);
    const query = { _id: 'nodeBenchmark' };
    const result = await dbHelper.findOneInDatabase(database, benchmarkCollection, query);
    if (result && result.benchmark) {
      // Update lastDbUpdateTimestamp if we have a recent record
      if (result.updatedAt && (Date.now() - result.updatedAt < ONE_DAY_MS)) {
        lastDbUpdateTimestamp = result.updatedAt;
      }
      return { benchmark: result.benchmark, tier: result.tier || null };
    }
    return { benchmark: null, tier: null };
  } catch (error) {
    log.error(`Failed to retrieve benchmark from database: ${error.message}`);
    return { benchmark: null, tier: null };
  }
}

// == Benchmarks ==
/**
 * To get benchmark status.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getStatus(req, res) {
  const rpccall = 'getstatus';

  const response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To restart node benchmarks. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function restartNodeBenchmarks(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  let response;

  if (authorized === true) {
    const rpccall = 'restartnodebenchmarks';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To sign Flux transaction. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signFluxTransaction(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  let response;

  if (authorized === true) {
    const rpccall = 'signzelnodetransaction';
    const rpcparameters = [];
    if (hexstring) {
      rpcparameters.push(hexstring);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To ensure that a request is an object and sign Flux transaction. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function signFluxTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hexstring } = processedBody;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);

    let response;

    if (authorized === true) {
      const rpccall = 'signzelnodetransaction';
      const rpcparameters = [];
      if (hexstring) {
        rpcparameters.push(hexstring);
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  });
}

/**
 * Ask FLuxBench to decrypt message
 * @param {object} message message object with information to be decrypted.
 */
async function decryptMessage(message) {
  const rpccall = 'decryptmessage';
  const rpcparameters = [message];
  return executeCall(rpccall, rpcparameters);
}

/**
 * Ask FLuxBench to decrypt rsa message
 * @param {object} message message object with information to be decrypted.
 */
async function decryptRSAMessage(message) {
  const rpccall = 'decryptrsamessage';
  const rpcparameters = [message];
  return executeCall(rpccall, rpcparameters);
}

/**
 * Ask FLuxBench to encrypt message
 * @param {object} message message object with information to be decrypted.
 */
async function encryptMessage(message) {
  const rpccall = 'encryptmessage';
  const rpcparameters = [message];
  return executeCall(rpccall, rpcparameters);
}

/**
 * Ask FLuxBench to get public key to encrypt enterprise content
 * @param {object} message message object with the key.
 */
async function getPublicKey(message) {
  const rpccall = 'getpublickey';
  const rpcparameters = [message];
  return executeCall(rpccall, rpcparameters);
}

// == Control ==
/**
 * To request help message.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function help(req, res) {
  let { command } = req.params;
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [command];

  const response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To stop node benchmarks. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stop(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);

  let response;

  if (authorized === true) {
    const rpccall = 'stop';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == Fluxnode ==
/**
 * To show status of benchmarks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBenchmarks(req, res) {
  const rpccall = 'getbenchmarks';

  const response = await executeCall(rpccall);

  // Store to database if successful and tier is valid (CUMULUS, NIMBUS, STRATUS)
  if (response.status === 'success' && response.data && response.data.status) {
    // Store benchmark data with tier status (only updates once per day for valid tiers)
    storeBenchmarkToDb(response.data, response.data.status).catch((error) => {
      log.error(`Error storing benchmark to database: ${error.message}`);
    });
  }

  return res ? res.json(response) : response;
}

/**
 * To get info on benchmark version and RCP port.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getInfo(req, res) {
  const rpccall = 'getInfo';

  const response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To show public IP address.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getPublicIp(req, res) {
  const rpccall = 'getpublicip';

  const response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To execute benchmark at the same time on all upnp nodes.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startMultiPortBench(req, res) {
  const rpccall = 'startmultiportbench';

  const response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * Execute benchmark on all upnp nodes at the same time
 */
async function executeUpnpBench() {
  // check if we are synced
  const synced = await generalService.checkSynced();
  if (synced !== true) {
    log.info('executeUpnpBench - Flux not yet synced');
    return;
  }
  const isUPNP = upnpService.isUPNP();
  if ((userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) || isUPNP) {
    log.info('Calling FluxBench startMultiPortBench');
    log.info(await startMultiPortBench());
  }
}

if (require.main === module) {
  getInfo().then((res) => console.log(res));
}

module.exports = {
  // == Export for testing purposes ==
  executeCall,
  // == Benchmarks ==
  getStatus,
  restartNodeBenchmarks,
  signFluxTransaction,
  signFluxTransactionPost,
  startMultiPortBench,

  // == Control ==
  help,
  stop,

  // == Fluxnode ==
  getBenchmarks,
  getBenchmarkFromDb,
  getInfo,
  getPublicIp,

  // == UPNP FluxBecnh ==
  executeUpnpBench,
  //
  decryptMessage,
  getPublicKey,
  decryptRSAMessage,
  encryptMessage,
};
