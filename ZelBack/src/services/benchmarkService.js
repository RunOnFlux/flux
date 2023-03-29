const benchmarkrpc = require('daemonrpc');
const config = require('config');
const path = require('path');
const fs = require('fs');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const generalService = require('./generalService');
const upnpService = require('./upnpService');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const isTestnet = userconfig.initial.testnet;

const rpcport = isTestnet === true ? config.benchmark.rpcporttestnet : config.benchmark.rpcport;

const homeDirPath = path.join(__dirname, '../../../../');
const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');

let response = messageHelper.createErrorMessage();

/**
 * To execute a remote procedure call (RPC).
 *
 * @param {string} rpc Remote procedure call.
 * @param {string[]} params RPC parameters.
 * @returns {object} Message.
 */
async function executeCall(rpc, params) {
  let callResponse;
  const rpcparameters = params || [];
  try {
    let rpcuser = 'zelbenchuser';
    let rpcpassword = 'zelbenchpassword';
    if (fs.existsSync(newBenchmarkPath)) {
      rpcuser = 'fluxbenchuser';
      rpcpassword = 'fluxbenchpassword';
    }

    const client = new benchmarkrpc.Client({
      port: rpcport,
      user: rpcuser,
      pass: rpcpassword,
      timeout: 60000,
    });
    const data = await client[rpc](...rpcparameters);
    const successResponse = messageHelper.createDataMessage(data);
    callResponse = successResponse;
  } catch (error) {
    const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
    callResponse = daemonError;
  }

  return callResponse;
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

  response = await executeCall(rpccall);

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

  response = await executeCall(rpccall, rpcparameters);

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
  if (authorized === true) {
    const rpccall = 'stop';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == Zelnode ==
/**
 * To show status of benchmarks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBenchmarks(req, res) {
  const rpccall = 'getbenchmarks';

  response = await executeCall(rpccall);

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

  response = await executeCall(rpccall);

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

  response = await executeCall(rpccall);

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

  response = await executeCall(rpccall);

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
    startMultiPortBench();
  }
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

  // == Zelnode ==
  getBenchmarks,
  getInfo,
  getPublicIp,

  // == UPNP FluxBecnh ==
  executeUpnpBench,
};
