const benchmarkrpc = require('daemonrpc');
const config = require('config');
const path = require('path');
const fs = require('fs');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const userconfig = require('../../../config/userconfig');

const isTestnet = userconfig.initial.testnet;

const rpcport = isTestnet === true ? config.benchmark.rpcporttestnet : config.benchmark.rpcport;

const homeDirPath = path.join(__dirname, '../../../../');
const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');

let response = messageHelper.createErrorMessage();

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
async function getStatus(req, res) {
  const rpccall = 'getstatus';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

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
async function help(req, res) {
  let { command } = req.params;
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [command];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

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
async function getBenchmarks(req, res) {
  const rpccall = 'getbenchmarks';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getInfo(req, res) {
  const rpccall = 'getInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getPublicIp(req, res) {
  const rpccall = 'getpublicip';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

module.exports = {
  // == Benchmarks ==
  getStatus,
  restartNodeBenchmarks,
  signFluxTransaction,
  signFluxTransactionPost,

  // == Control ==
  help,
  stop,

  // == Zelnode ==
  getBenchmarks,
  getInfo,
  getPublicIp,
};
