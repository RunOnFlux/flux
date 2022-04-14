const daemonrpc = require('daemonrpc');
const fullnode = require('fullnode');
const LRU = require('lru-cache');
const config = require('config');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fnconfig = new fullnode.Config();
const isTestnet = userconfig.initial.testnet;
const rpcuser = fnconfig.rpcuser() || 'rpcuser';
const rpcpassword = fnconfig.rpcpassword() || 'rpcpassword';
const rpcport = fnconfig.rpcport() || (isTestnet === true ? config.daemon.rpcporttestnet : config.daemon.rpcport);

let currentDaemonHeight = 0;
let currentDaemonHeader = isTestnet === true ? 58494 : 1060453;
let isDaemonInsightExplorer = null;

const client = new daemonrpc.Client({
  port: rpcport,
  user: rpcuser,
  pass: rpcpassword,
  timeout: 60000,
});
let daemonCallRunning = false;

// default cache
const LRUoptions = {
  max: 500, // store 500 values for up to 20 seconds of other daemon calls
  maxAge: 1000 * 20, // 20 seconds
};

const cache = new LRU(LRUoptions);

const LRUoptionsBlocks = {
  max: 1500, // store 500 values for up to 1 hour of other daemon calls
  maxAge: 1000 * 60 * 60, // 1 hour
};

const blockCache = new LRU(LRUoptionsBlocks); // store 1.5k blocks in cache

const LRUoptionsTxs = {
  max: 30000, // store 500 values for up to 1 hour of other daemon calls
  maxAge: 1000 * 60 * 60, // 1 hour
};

const rawTxCache = new LRU(LRUoptionsTxs); // store 30k txs in cache

let response = messageHelper.createErrorMessage();

/**
 * To execute a remote procedure call (RPC).
 * @param {string} rpc Remote procedure call.
 * @param {string[]} params RPC parameters.
 * @returns {object} Message.
 */
async function executeCall(rpc, params) {
  let callResponse;
  const rpcparameters = params || [];
  try {
    let data;
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 250)) + 60;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 200)) + 50;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 150)) + 40;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 100)) + 30;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 75)) + 25;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 50)) + 20;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 25)) + 10;
      await serviceHelper.delay(randomDelay);
    }
    if (rpc === 'getBlock') {
      data = blockCache.get(rpc + serviceHelper.ensureString(rpcparameters));
    } else if (rpc === 'getRawTransaction') {
      data = rawTxCache.get(rpc + serviceHelper.ensureString(rpcparameters));
    } else {
      data = cache.get(rpc + serviceHelper.ensureString(rpcparameters));
    }
    if (!data) {
      daemonCallRunning = true;
      data = await client[rpc](...rpcparameters);
      blockCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      daemonCallRunning = false;
    }
    const successResponse = messageHelper.createDataMessage(data);
    callResponse = successResponse;
  } catch (error) {
    const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
    callResponse = daemonError;
  }

  return callResponse;
}

/**
 * To get a value for a specified key from the configuration file.
 * @param {string} parameter Config key.
 * @returns {string} Config value.
 */
function getConfigValue(parameter) {
  const value = fnconfig.get(parameter);
  return value;
}

/**
 * To check if Insight Explorer is activated in the daemon configuration file.
 * @returns {boolean} True if the daemon is configured with Insight Explorer on.
 */
function isInsightExplorer() {
  if (isDaemonInsightExplorer != null) {
    return isDaemonInsightExplorer;
  }
  const insightValue = getConfigValue('insightexplorer');
  if (insightValue === 1 || insightValue === '1') {
    isDaemonInsightExplorer = true;
    return true;
  }
  isDaemonInsightExplorer = false;
  return false;
}

// == Control ==
/**
 * To request help message. Command required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function help(req, res) {
  let { command } = req.params; // we accept both help/command and help?command=getinfo
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [command];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get info on daemon version and RPC port. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getInfo(req, res) {
  const rpccall = 'getInfo';

  response = await executeCall(rpccall);
  if (res) {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      delete response.data.balance;
    }
  } else {
    delete response.data.balance;
  }

  return res ? res.json(response) : response;
}

/**
 * To stop node daemon. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stop(req, res) { // practically useless
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
 * To get node status.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeStatus(req, res) {
  const rpccall = 'getzelnodestatus';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To list nodes. Optional filter can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listZelNodes(req, res) {
  let { filter } = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'listzelnodes';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To list node configuration. Optional filter can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listZelNodeConf(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  let { filter } = req.params;
  filter = filter || req.query.filter;
  if (authorized === true) {
    const rpccall = 'listzelnodeconf';
    const rpcparameters = [];
    if (filter) {
      rpcparameters.push(filter);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To create node key. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createZelNodeKey(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodekey';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get node sync status. Mode (defaults to status) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function znsync(req, res) {
  let { mode } = req.params; // we accept both znsync/status and znsync?mode=status
  mode = mode || req.query.mode || 'status'; // default to status
  if (mode === 'status') {
    const rpccall = 'znsync';
    const rpcparameters = [mode];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'znsync';
      const rpcparameters = [mode];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
  }
  return res ? res.json(response) : response;
}

/**
 * To create node broadcast. Command and alias required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createZelNodeBroadcast(req, res) {
  let { command } = req.params;
  command = command || req.query.command || '';
  let { alias } = req.params;
  alias = alias || req.query.alias || '';

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodebroadcast';
    const rpcparameters = [command, alias];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To decode node broadcast. Optional hex string can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function decodeZelNodeBroadcast(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodezelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get node count.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeCount(req, res) {
  const rpccall = 'getzelnodecount';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get DOS list.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getDOSList(req, res) {
  const rpccall = 'getdoslist';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get start list.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getStartList(req, res) {
  const rpccall = 'getstartlist';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get node outputs. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeOutputs(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getzelnodeoutputs';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get node scores. Optional number of blocks can be included as a parameter for RPC call. Otherwise defaults to 10 blocks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeScores(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10';

  const rpccall = 'getzelnodescores';
  const rpcparameters = [];
  rpcparameters.push(blocks);

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get node winnners. Optional filter can be included as a parameter for RPC call. Optional number of blocks can be included as a parameter for RPC call. Otherwise defaults to 10 blocks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeWinners(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10'; // defaults to 10 as default zelcash value
  let { filter } = req.params;
  filter = filter || req.query.filter;

  const rpccall = 'getzelnodewinners';
  const rpcparameters = [];
  rpcparameters.push(blocks);
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To relay node broadcast. Optional hex string can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function relayZelNodeBroadcast(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'relayzelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To show spork. Optional value can be included as a parameter for RPC call. Optional name can be included as a parameter for RPC call. Otherwise defaults to show.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function spork(req, res) {
  let { name } = req.params;
  name = name || req.query.name || 'show'; // name, show, active
  let { value } = req.params;
  value = value || req.query.value;

  const rpccall = 'spork';
  const rpcparameters = [];
  rpcparameters.push(name);
  if (value) {
    value = serviceHelper.ensureNumber(value);
    rpcparameters.push(value);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To start deterministic node. Alias required as a parameter for RPC call if not already specified. Optional lock wallet configuration can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startDeterministicZelNode(req, res) {
  let { alias } = req.params;
  alias = alias || req.query.alias;
  let { lockwallet } = req.params;
  lockwallet = lockwallet || req.query.lockwallet || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startdeterministiczelnode';
    const rpcparameters = [];
    rpcparameters.push(alias);
    if (lockwallet) {
      lockwallet = serviceHelper.ensureBoolean(lockwallet);
      rpcparameters.push(lockwallet);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To start node. Set and lock wallet configurations required as parameters for RPC call if not already specified. Optional alias can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startZelNode(req, res) {
  let { set } = req.params;
  set = set || req.query.set;
  let { lockwallet } = req.params;
  lockwallet = lockwallet || req.query.lockwallet;
  let { alias } = req.params;
  alias = alias || req.query.alias;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startzelnode';
    const rpcparameters = [];
    rpcparameters.push(set);
    rpcparameters.push(lockwallet);
    if (alias) {
      rpcparameters.push(alias);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To view list of deterministic nodes. Optional filter can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function viewDeterministicZelNodeList(req, res) {
  let { filter } = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'viewdeterministiczelnodelist';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To show current node winner.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zelNodeCurrentWinner(req, res) {
  const rpccall = 'zelnodecurrentwinner';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To debug node.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zelNodeDebug(req, res) {
  const rpccall = 'zelnodedebug';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

// == Blockchain ==
/**
 * To get best block hash.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBestBlockHash(req, res) {
  const rpccall = 'getBestBlockHash';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get block. Hash height and verbosity required as parameters for RPC call. Verbosity defaults to an integer value of 2.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlock(req, res) {
  let { hashheight } = req.params;
  hashheight = hashheight || req.query.hashheight;
  hashheight = serviceHelper.ensureString(hashheight);
  let { verbosity } = req.params;
  verbosity = verbosity || req.query.verbosity || 2; // defaults to json object. CORRECT DAEMON verbosity is number, error says its not boolean
  verbosity = serviceHelper.ensureNumber(verbosity);

  const rpccall = 'getBlock';
  const rpcparameters = [hashheight, verbosity];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get blockchain info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockchainInfo(req, res) {
  const rpccall = 'getBlockchainInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get block count.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockCount(req, res) {
  const rpccall = 'getBlockCount';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get block hash. Index required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockHash(req, res) {
  let { index } = req.params;
  index = index || req.query.index; // no default value, show help

  const rpccall = 'getBlockHash';
  const rpcparameters = [];
  if (index) {
    index = serviceHelper.ensureNumber(index);
    rpcparameters.push(index);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get block deltas. Hash required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockDeltas(req, res) {
  let { hash } = req.params;
  hash = hash || req.query.hash;

  const rpccall = 'getblockdeltas';
  const rpcparameters = [];
  if (hash) {
    rpcparameters.push(hash);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get block hashes. High and low values and options object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockHashes(req, res) {
  let { high } = req.params;
  high = high || req.query.high;
  let { low } = req.params;
  low = low || req.query.low;
  let { noOrphans } = req.params;
  noOrphans = noOrphans || req.query.noOrphans;
  let { logicalTimes } = req.params;
  logicalTimes = logicalTimes || req.query.logicalTimes;

  const rpccall = 'getblockhashes';
  const rpcparameters = [];
  if (high) {
    high = serviceHelper.ensureNumber(high);
    rpcparameters.push(high);
  }
  if (low) {
    low = serviceHelper.ensureNumber(low);
    rpcparameters.push(low);
  }
  const options = {};
  if (noOrphans !== undefined && noOrphans !== null) {
    options.noOrphans = serviceHelper.ensureBoolean(noOrphans);
  }
  if (logicalTimes !== undefined && logicalTimes !== null) {
    options.logicalTimes = serviceHelper.ensureBoolean(logicalTimes);
  }
  if (options.noOrphans !== undefined || options.logicalTimes !== undefined) {
    rpcparameters.push(options);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get block hashes after data is processed. High and low values required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getBlockHashesPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { high, low, options } = processedBody;

    const rpccall = 'getblockhashes';
    const rpcparameters = [high, low];

    if (options) {
      rpcparameters.push(options);
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get block header. Hash and verbose (defaults to true) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockHeader(req, res) {
  let { hash } = req.params;
  hash = hash || req.query.hash;
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || true;

  const rpccall = 'getBlockHeader';
  const rpcparameters = [];
  if (hash) {
    verbose = serviceHelper.ensureBoolean(verbose);
    rpcparameters.push(hash);
    rpcparameters.push(verbose);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get chain tips.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getChainTips(req, res) {
  const rpccall = 'getChainTips';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get block hash algorithm difficulty.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getDifficulty(req, res) {
  const rpccall = 'getDifficulty';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get mempool (memory pool) info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getMempoolInfo(req, res) {
  const rpccall = 'getMempoolInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get raw mempool (memory pool) info. Verbose (defaults to true) required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getRawMemPool(req, res) {
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || false;

  verbose = serviceHelper.ensureBoolean(verbose);

  const rpccall = 'getRawMemPool';
  const rpcparameters = [verbose];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get transaction output. Transaction ID, number and whether to include mempool (defaults to true) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTxOut(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { n } = req.params;
  n = n || req.query.n;
  let { includemempool } = req.params;
  includemempool = includemempool || req.query.includemempool || true;

  const rpccall = 'getTxOut';
  const rpcparameters = [];
  if (txid && n) {
    includemempool = serviceHelper.ensureBoolean(includemempool);
    n = serviceHelper.ensureNumber(n);
    rpcparameters.push(txid);
    rpcparameters.push(n);
    rpcparameters.push(includemempool);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get transaction output proof. Array of transaction IDs required as parameter for RPC call. Block hash can also be included as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTxOutProof(req, res) {
  let { txids } = req.params;
  txids = txids || req.query.txids;
  let { blockhash } = req.params;
  blockhash = blockhash || req.query.blockhash;
  const txidsarray = txids.split(',');

  const rpccall = 'getTxOutProof';
  const rpcparameters = [];
  if (txids && blockhash) {
    rpcparameters.push(txidsarray);
    rpcparameters.push(blockhash);
  } else if (txids) {
    rpcparameters.push(txidsarray);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get transaction output set info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTxOutSetInfo(req, res) {
  const rpccall = 'getTxOutSetInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To verify chain. Check level and number of blocks required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyChain(req, res) {
  let { checklevel } = req.params;
  checklevel = checklevel || req.query.checklevel || 3;
  let { numblocks } = req.params;
  numblocks = numblocks || req.query.numblocks || 288;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    checklevel = serviceHelper.ensureNumber(checklevel);
    numblocks = serviceHelper.ensureNumber(numblocks);
    const rpccall = 'verifyChain';
    const rpcparameters = [checklevel, numblocks];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To verify transaction output proof. Proof required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyTxOutProof(req, res) {
  let { proof } = req.params;
  proof = proof || req.query.proof;

  const rpccall = 'verifyTxOutProof';
  const rpcparameters = [];
  if (proof) {
    rpcparameters.push(proof);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get spent info. Transaction ID and index required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSpentInfo(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { index } = req.params;
  index = index || req.query.index;

  const rpccall = 'getspentinfo';
  const options = {
    txid: serviceHelper.ensureString(txid),
    index: serviceHelper.ensureNumber(index),
  };
  const rpcparameters = [options];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get spent info after data is processed. Transaction ID and index required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSpentInfoPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { txid, index } = processedBody;
    const options = {
      txid,
      index,
    };

    const rpccall = 'getspentinfo';
    const rpcparameters = [options];

    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

// == Address Index ==
/**
 * To get transaction IDs for specified address/es. Addresses, start and end required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressTxids(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { addresses, start, end } = processedBody;

    const options = {
      addresses,
      start,
      end,
    };

    const rpccall = 'getaddresstxids';
    const rpcparameters = [options];

    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get transaction IDs for single specified address. Address, start and end required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddresssTxids(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { start } = req.params;
  start = start || req.query.start;
  let { end } = req.params;
  end = end || req.query.end;

  const options = {
    addresses: [address],
    start,
    end,
  };

  const rpccall = 'getaddresstxids';
  const rpcparameters = [options];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get balance of address/es. Addresses required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressBalance(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { addresses } = processedBody;

    const options = {
      addresses,
    };

    const rpccall = 'getaddressbalance';
    const rpcparameters = [options];

    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get balance of a single address. Address required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressBalance(req, res) {
  let { address } = req.params;
  address = address || req.query.address;

  const options = {
    addresses: [address],
  };

  const rpccall = 'getaddressbalance';
  const rpcparameters = [options];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get address deltas. Addresses, start, end and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressDeltas(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {
      addresses, start, end, chainInfo,
    } = processedBody;

    const options = {
      addresses,
      start,
      end,
      chainInfo,
    };

    const rpccall = 'getaddressdeltas';
    const rpcparameters = [options];

    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get deltas for a single address. Address, start, end and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressDeltas(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { start } = req.params;
  start = start || req.query.start;
  let { end } = req.params;
  end = end || req.query.end;
  let { chaininfo } = req.params;
  chaininfo = chaininfo || req.query.chaininfo;

  const options = {
    addresses: [address],
    start,
    end,
    chainInfo: chaininfo,
  };

  const rpccall = 'getaddressdeltas';
  const rpcparameters = [options];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get UTXOs for multiple addresses. Addresses and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressUtxos(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {
      addresses, chainInfo,
    } = processedBody;

    const options = {
      addresses,
      chainInfo,
    };

    const rpccall = 'getaddressutxos';
    const rpcparameters = [options];

    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get UTXOs for a single address. Address and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressUtxos(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { chaininfo } = req.params;
  chaininfo = chaininfo || req.query.chaininfo;

  const options = {
    addresses: [address],
    chainInfo: chaininfo,
  };

  const rpccall = 'getaddressutxos';
  const rpcparameters = [options];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get mempool (memory pool) for multiple addresses. Addresses required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressMempool(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {
      addresses,
    } = processedBody;

    const options = {
      addresses,
    };

    const rpccall = 'getaddressmempool';
    const rpcparameters = [options];

    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get mempool (memory pool) for a single address. Address required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressMempool(req, res) {
  let { address } = req.params;
  address = address || req.query.address;

  const options = {
    addresses: [address],
  };

  const rpccall = 'getaddressmempool';
  const rpcparameters = [options];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

// == Mining ==
/**
 * To get block subsidy. Height required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockSubsidy(req, res) {
  let { height } = req.params;
  height = height || req.query.height;

  const rpccall = 'getBlockSubsidy';
  const rpcparameters = [];
  if (height) {
    height = serviceHelper.ensureNumber(height);
    rpcparameters.push(height);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get block template. JSON request object required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Block template.
 */
async function getBlockTemplate(req, res) {
  let { jsonrequestobject } = req.params;
  jsonrequestobject = jsonrequestobject || req.query.jsonrequestobject;

  const rpccall = 'getBlockTemplate';
  const rpcparameters = [];
  if (jsonrequestobject) {
    jsonrequestobject = serviceHelper.ensureObject(jsonrequestobject);
    rpcparameters.push(jsonrequestobject);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get local solutions (hash computations created) per second.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getLocalSolPs(req, res) {
  const rpccall = 'getLocalSolPs';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get mining info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getMiningInfo(req, res) {
  const rpccall = 'getMiningInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get number of network hashes per second. Blocks (defaults to value of 120) and height (defaults to value of -1) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNetworkHashPs(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || 120;
  let { height } = req.params;
  height = height || req.query.height || -1;

  blocks = serviceHelper.ensureNumber(blocks);
  height = serviceHelper.ensureNumber(height);

  const rpccall = 'getNetworkHashPs';
  const rpcparameters = [blocks, height];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get network solutions (hash computations created) per second. Blocks (defaults to value of 120) and height (defaults to value of -1) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNetworkSolPs(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || 120;
  let { height } = req.params;
  height = height || req.query.height || -1;

  blocks = serviceHelper.ensureNumber(blocks);
  height = serviceHelper.ensureNumber(height);
  const rpccall = 'getNetworkSolPs';
  const rpcparameters = [blocks, height];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To prioritise transaction. Transaction ID, priority delta and fee delta required as parameters for RPC call. Only accessible by users.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function prioritiseTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { prioritydelta } = req.params;
  prioritydelta = prioritydelta || req.query.prioritydelta;
  let { feedelta } = req.params;
  feedelta = feedelta || req.query.feedelta;
  const authorized = await verificationHelper.verifyPrivilege('user', req);
  if (authorized === true) {
    const rpccall = 'prioritiseTransaction';
    let rpcparameters = [];
    if (txid && prioritydelta && feedelta) {
      prioritydelta = serviceHelper.ensureNumber(prioritydelta);
      feedelta = serviceHelper.ensureNumber(feedelta);
      rpcparameters = [txid, prioritydelta, feedelta];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To submit a block. Hex data required as parameter for RPC call. JSON parameters object can also be provided as a parameter for RPC call. Only accessible by users.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function submitBlock(req, res) {
  let { hexdata } = req.params;
  hexdata = hexdata || req.query.hexdata;
  let { jsonparametersobject } = req.params;
  jsonparametersobject = jsonparametersobject || req.query.jsonparametersobject;
  const authorized = await verificationHelper.verifyPrivilege('user', req);
  if (authorized === true) {
    const rpccall = 'submitBlock';
    let rpcparameters = [];
    if (hexdata && jsonparametersobject) {
      jsonparametersobject = serviceHelper.ensureObject(jsonparametersobject);
      rpcparameters = [hexdata, jsonparametersobject];
    } else if (hexdata) {
      rpcparameters = [hexdata];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To submit a block after data is processed. Hex data required as parameter for RPC call. JSON parameters object can also be provided as a parameter for RPC call. Only accessible by users.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function submitBlockPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hexdata } = processedBody;
    let { jsonparametersobject } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('user', req);
    if (authorized === true) {
      const rpccall = 'submitBlock';
      let rpcparameters = [];
      if (hexdata && jsonparametersobject) {
        jsonparametersobject = serviceHelper.ensureObject(jsonparametersobject);
        rpcparameters = [hexdata, jsonparametersobject];
      } else if (hexdata) {
        rpcparameters = [hexdata];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

// == Network ==
/**
 * To add a node. Node and command required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addNode(req, res) {
  let { node } = req.params;
  node = node || req.query.node;
  let { command } = req.params;
  command = command || req.query.command;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'addNode';
    let rpcparameters = [];
    if (node && command) {
      rpcparameters = [node, command];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To clear banned IP addresses. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function clearBanned(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'clearBanned';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To disconnect a node. Node required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function disconnectNode(req, res) {
  let { node } = req.params;
  node = node || req.query.node;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'disconnectNode';
    let rpcparameters = [];
    if (node) {
      rpcparameters = [node];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get node info. DNS and node required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddedNodeInfo(req, res) {
  let { dns } = req.params;
  dns = dns || req.query.dns;
  let { node } = req.params;
  node = node || req.query.node;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getAddedNodeInfo';
    const rpcparameters = [];
    if (dns) {
      dns = serviceHelper.ensureBoolean(dns);
      rpcparameters.push(dns);
      if (node) {
        rpcparameters.push(node);
      }
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get connection count.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getConnectionCount(req, res) {
  const rpccall = 'getConnectionCount';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get deprecation info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getDeprecationInfo(req, res) {
  const rpccall = 'getDeprecationInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get net totals.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNetTotals(req, res) {
  const rpccall = 'getNetTotals';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get network info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNetworkInfo(req, res) {
  const rpccall = 'getNetworkInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get node peer info.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getPeerInfo(req, res) {
  const rpccall = 'getPeerInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To list banned IP addresses.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listBanned(req, res) {
  const rpccall = 'listBanned';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To send a ping to peers. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function ping(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'ping';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To set a ban on an IP address. IP, command, ban time and if absolute required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function setBan(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  let { command } = req.params;
  command = command || req.query.command;
  let { bantime } = req.params;
  bantime = bantime || req.query.bantime;
  let { absolute } = req.params;
  absolute = absolute || req.query.absolute;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'setBan';
    const rpcparameters = [];
    if (ip && command) {
      rpcparameters.push(ip);
      rpcparameters.push(command);
      if (bantime) {
        bantime = serviceHelper.ensureNumber(bantime);
        rpcparameters.push(bantime);
        if (absolute) {
          absolute = serviceHelper.ensureBoolean(absolute);
          rpcparameters.push(absolute);
        }
      }
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == Rawtransactions ==
/**
 * To create raw transaction. Transactions, addresses, lock time (defaults to value of 0) and expiry height (defaults to block count + 20) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createRawTransaction(req, res) {
  let { transactions } = req.params;
  transactions = transactions || req.query.transactions;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  let { locktime } = req.params;
  locktime = locktime || req.query.locktime || 0;
  const blockcount = await client.getBlockCount().catch((error) => {
    const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
    response = daemonError;
    return res ? res.json(response) : response;
  });
  const defaultExpiryHeight = blockcount + 20;
  let { expiryheight } = req.params;
  expiryheight = expiryheight || req.query.expiryheight || defaultExpiryHeight;

  locktime = serviceHelper.ensureNumber(locktime);
  expiryheight = serviceHelper.ensureNumber(expiryheight);
  const rpccall = 'createRawTransaction';
  let rpcparameters = [];
  if (transactions && addresses) {
    transactions = serviceHelper.ensureObject(transactions);
    addresses = serviceHelper.ensureObject(addresses);
    rpcparameters = [transactions, addresses, locktime, expiryheight];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To create raw transaction after data is processed. Transactions, addresses, lock time (defaults to value of 0) and expiry height (defaults to block count + 20) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { transactions } = processedBody;
    let { addresses } = processedBody;
    let { locktime } = processedBody;
    locktime = locktime || 0;
    const blockcount = await client.getBlockCount().catch((error) => {
      const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
      response = daemonError;
      return res.json(response);
    });
    const defaultExpiryHeight = blockcount + 20;
    let { expiryheight } = processedBody;
    expiryheight = expiryheight || defaultExpiryHeight;

    locktime = serviceHelper.ensureNumber(locktime);
    expiryheight = serviceHelper.ensureNumber(expiryheight);
    const rpccall = 'createRawTransaction';
    let rpcparameters = [];
    if (transactions && addresses) {
      transactions = serviceHelper.ensureObject(transactions);
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters = [transactions, addresses, locktime, expiryheight];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To decode raw transaction. Hex string required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function decodeRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodeRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    rpcparameters = [hexstring];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To decode raw transaction after data is processed. Hex string required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function decodeRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hexstring } = processedBody;

    const rpccall = 'decodeRawTransaction';
    let rpcparameters = [];
    if (hexstring) {
      rpcparameters = [hexstring];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To decode script. Hex required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function decodeScript(req, res) {
  let { hex } = req.params;
  hex = hex || req.query.hex;

  const rpccall = 'decodeScript';
  let rpcparameters = [];
  if (hex) {
    rpcparameters = [hex];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To decode script after data is processed. Hex required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function decodeScriptPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hex } = processedBody;

    const rpccall = 'decodeScript';
    let rpcparameters = [];
    if (hex) {
      rpcparameters = [hex];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To fund raw transaction. Hex string required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fundRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'fundRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    rpcparameters = [hexstring];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To fund raw transaction after data is processed. Hex string required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fundRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hexstring } = processedBody;

    const rpccall = 'fundRawTransaction';
    let rpcparameters = [];
    if (hexstring) {
      rpcparameters = [hexstring];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get raw transaction. Transaction ID and verbose (defaults to value of 0) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getRawTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || 0;

  const rpccall = 'getRawTransaction';
  let rpcparameters = [];
  if (txid) {
    verbose = serviceHelper.ensureNumber(verbose);
    rpcparameters = [txid, verbose];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To send raw transaction. Hex string and whether to allow high fees (defaults to false) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;
  let { allowhighfees } = req.params;
  allowhighfees = allowhighfees || req.query.allowhighfees || false;

  const rpccall = 'sendRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    allowhighfees = serviceHelper.ensureBoolean(allowhighfees);
    rpcparameters = [hexstring, allowhighfees];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To send raw transaction after data is processed. Hex string and whether to allow high fees (defaults to false) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hexstring } = processedBody;
    let { allowhighfees } = processedBody;
    allowhighfees = allowhighfees || false;

    const rpccall = 'sendRawTransaction';
    let rpcparameters = [];
    if (hexstring) {
      allowhighfees = serviceHelper.ensureBoolean(allowhighfees);
      rpcparameters = [hexstring, allowhighfees];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To sign raw transaction. Hex string, previous transactions, private keys, signature hash type (defaults to ALL) and branch ID required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;
  let { prevtxs } = req.params;
  prevtxs = prevtxs || req.query.prevtxs;
  let { privatekeys } = req.params;
  privatekeys = privatekeys || req.query.privatekeys;
  let { sighashtype } = req.params;
  sighashtype = sighashtype || req.query.sighashtype || 'ALL';
  let { branchid } = req.params;
  branchid = branchid || req.query.branchid;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'signRawTransaction';
    const rpcparameters = [];
    if (hexstring) {
      rpcparameters.push(hexstring);
      if (prevtxs) {
        prevtxs = serviceHelper.ensureObject(prevtxs);
        rpcparameters.push(prevtxs);
        if (privatekeys) {
          privatekeys = serviceHelper.ensureObject(privatekeys);
          rpcparameters.push(privatekeys);
          rpcparameters.push(sighashtype);
          if (branchid) {
            rpcparameters.push(branchid);
          }
        }
      }
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To sign raw transaction after data is processed. Hex string, previous transactions, private keys, signature hash type (defaults to all) and branch ID required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { hexstring } = processedBody;
    let { prevtxs } = processedBody;
    let { privatekeys } = processedBody;
    let { sighashtype } = processedBody;
    sighashtype = sighashtype || 'ALL';
    const { branchid } = processedBody;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'signRawTransaction';
      const rpcparameters = [];
      if (hexstring) {
        rpcparameters.push(hexstring);
        if (prevtxs) {
          prevtxs = serviceHelper.ensureObject(prevtxs);
          rpcparameters.push(prevtxs);
          if (privatekeys) {
            privatekeys = serviceHelper.ensureObject(privatekeys);
            rpcparameters.push(privatekeys);
            rpcparameters.push(sighashtype);
            if (branchid) {
              rpcparameters.push(branchid);
            }
          }
        }
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  });
}

// == Util ==
/**
 * To create a multi-signature scheme (to require multiple keys to authorize a transaction). Number of signatures and keys object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createMultiSig(req, res) {
  let { n } = req.params;
  n = n || req.query.n;
  let { keys } = req.params;
  keys = keys || req.query.keys;

  const rpccall = 'createMultiSig';
  let rpcparameters = [];
  if (n && keys) {
    n = serviceHelper.ensureNumber(n);
    keys = serviceHelper.ensureObject(keys);
    rpcparameters = [n, keys];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To create a multi-signature scheme (to require multiple keys to authorize a transaction) after data is processed. Number of signatures and keys object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createMultiSigPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { n } = processedBody;
    let { keys } = processedBody;

    const rpccall = 'createMultiSig';
    let rpcparameters = [];
    if (n && keys) {
      n = serviceHelper.ensureNumber(n);
      keys = serviceHelper.ensureObject(keys);
      rpcparameters = [n, keys];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To estimate a transaction fee. Number of blocks required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function estimateFee(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimateFee';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = serviceHelper.ensureNumber(nblocks);
    rpcparameters = [nblocks];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To estimate transaction priority. Number of blocks required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function estimatePriority(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimatePriority';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = serviceHelper.ensureNumber(nblocks);
    rpcparameters = [nblocks];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To validate an address. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function validateAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;

  const rpccall = 'validateAddress';
  let rpcparameters = [];
  if (zelcashaddress) {
    rpcparameters = [zelcashaddress];
  }
  response = await executeCall(rpccall, rpcparameters);

  if (res) {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      delete response.data.ismine;
      delete response.data.iswatchonly;
    }
  } else {
    delete response.data.ismine;
    delete response.data.iswatchonly;
  }

  return res ? res.json(response) : response;
}

/**
 * To verify a message. Address, signature and message required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyMessage(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { signature } = req.params;
  signature = signature || req.query.signature;
  let { message } = req.params;
  message = message || req.query.message;

  const rpccall = 'verifyMessage';
  let rpcparameters = [];
  if (zelcashaddress && signature && message) {
    rpcparameters = [zelcashaddress, signature, message];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To verify a message after data is processed. Address, signature and message required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyMessagePost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { zelcashaddress } = processedBody;
    const { signature } = processedBody;
    const { message } = processedBody;

    const rpccall = 'verifyMessage';
    let rpcparameters = [];
    if (zelcashaddress && signature && message) {
      rpcparameters = [zelcashaddress, signature, message];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To validate a Z address. Z address required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zValidateAddress(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;

  const rpccall = 'z_validateaddress';
  let rpcparameters = [];
  if (zaddr) {
    rpcparameters = [zaddr];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

// == Wallet == Admin Privilage. Benchmark fluxteam privilage
/**
 * To add a multi-signature address (requires multiple keys to authorize a transaction). Number of addresses/keys and keys object required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addMultiSigAddress(req, res) {
  let { n } = req.params;
  n = n || req.query.n;
  let { keysobject } = req.params;
  keysobject = keysobject || req.query.keysobject;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'addMultiSigAddress';
    let rpcparameters = [];
    if (n && keysobject) {
      n = serviceHelper.ensureNumber(n);
      keysobject = serviceHelper.ensureObject(keysobject);
      rpcparameters = [n, keysobject];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To add a multi-signature address (requires multiple keys to authorize a transaction) after data is processed. Number of addresses/keys and keys object required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addMultiSigAddressPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { n } = processedBody;
    let { keysobject } = processedBody;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'addMultiSigAddress';
      let rpcparameters = [];
      if (n && keysobject) {
        n = serviceHelper.ensureNumber(n);
        keysobject = serviceHelper.ensureObject(keysobject);
        rpcparameters = [n, keysobject];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To backup wallet. Backup destination/directory required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function backupWallet(req, res) {
  let { destination } = req.params;
  destination = destination || req.query.destination;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'backupWallet';
    let rpcparameters = [];
    if (destination) {
      rpcparameters = [destination];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To dump private key. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function dumpPrivKey(req, res) {
  let { taddr } = req.params;
  taddr = taddr || req.query.taddr;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'dumpPrivKey';
    let rpcparameters = [];
    if (taddr) {
      rpcparameters = [taddr];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get balance. Min conf (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBalance(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getBalance';
    minconf = serviceHelper.ensureNumber(minconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpcparameters = ['', minconf, includewatchonly];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get a new address. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNewAddress(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getNewAddress';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get raw change address. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getRawChangeAddress(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getRawChangeAddress';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get received by address. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getReceivedByAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getReceivedByAddress';
    let rpcparameters = [];
    if (zelcashaddress) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [zelcashaddress, minconf];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get a transaction. Transaction ID and whether to include watch only (defaults to false) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;

  const rpccall = 'getTransaction';
  let rpcparameters = [];
  if (txid) {
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    rpcparameters = [txid, includewatchonly];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get unconfirmed balance. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getUnconfirmedBalance(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getUnconfirmedBalance';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get wallet info. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getWalletInfo(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getWalletInfo';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import address. Address, label and whether to rescan (defaults to true) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request. 
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importAddress(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { label } = req.params;
  label = label || req.query.label || '';
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || true;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importAddress';
    let rpcparameters = [];
    if (address) {
      rescan = serviceHelper.ensureBoolean(rescan);
      rpcparameters = [address, label, rescan];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import private key. Private key, label and whether to rescan (defaults to true) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importPrivKey(req, res) {
  let { zelcashprivkey } = req.params;
  zelcashprivkey = zelcashprivkey || req.query.zelcashprivkey;
  let { label } = req.params;
  label = label || req.query.label || '';
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || true;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importPrivKey';
    let rpcparameters = [];
    if (zelcashprivkey) {
      rescan = serviceHelper.ensureBoolean(rescan);
      rpcparameters = [zelcashprivkey, label, rescan];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import wallet. File name required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importWallet';
    let rpcparameters = [];
    if (filename) {
      rpcparameters = [filename];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To refill key pool. New size (defaults to value of 100) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function keyPoolRefill(req, res) {
  let { newsize } = req.params;
  newsize = newsize || req.query.newsize || 100;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'keyPoolRefill';
    newsize = serviceHelper.ensureNumber(newsize);
    const rpcparameters = [newsize];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list address groupings. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listAddressGroupings(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'listAddressGroupings';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list lock unspent. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listLockUnspent(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'listLockUnspent';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To rescan the blockchain. Start height (defaults to value of 0) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function rescanBlockchain(req, res) {
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    startheight = serviceHelper.ensureNumber(startheight);
    const rpccall = 'rescanblockchain';
    const rpcparameters = [startheight];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list received transactions by address. Min conf (defaults to value of 1), whether to include empty (defaults to false) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listReceivedByAddress(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includeempty } = req.params;
  includeempty = includeempty || req.query.includeempty || false;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    includeempty = serviceHelper.ensureBoolean(includeempty);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listReceivedByAddress';
    const rpcparameters = [minconf, includeempty, includewatchonly];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list since a specified block. Block hash, target confirmations (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listSinceBlock(req, res) {
  let { blockhash } = req.params;
  blockhash = blockhash || req.query.blockhash || '';
  let { targetconfirmations } = req.params;
  targetconfirmations = targetconfirmations || req.query.targetconfirmations || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    targetconfirmations = serviceHelper.ensureNumber(targetconfirmations);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listSinceBlock';
    const rpcparameters = [blockhash, targetconfirmations, includewatchonly];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list transactions. Account, count (defaults to value of 10), from (defaults to value of 0) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listTransactions(req, res) {
  const account = '*';
  let { count } = req.params;
  count = count || req.query.count || 10;
  let { from } = req.params;
  from = from || req.query.from || 0;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    count = serviceHelper.ensureNumber(count);
    from = serviceHelper.ensureNumber(from);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listTransactions';
    const rpcparameters = [account, count, from, includewatchonly];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list unspent. Min conf (defaults to value of 1), max conf (defaults to value of 9999999) and address required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listUnspent(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { maxconf } = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    maxconf = serviceHelper.ensureNumber(maxconf);
    const rpccall = 'listUnspent';
    const rpcparameters = [minconf, maxconf];
    if (addresses) {
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters.push(addresses);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To lock unspent. Whether unlocked and transactions required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function lockUnspent(req, res) {
  let { unlock } = req.params;
  unlock = unlock || req.query.unlock;
  let { transactions } = req.params;
  transactions = transactions || req.query.transactions;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'lockUnspent';
    let rpcparameters = [];
    if (unlock && transactions) {
      unlock = serviceHelper.ensureBoolean(unlock);
      transactions = serviceHelper.ensureObject(transactions);
      rpcparameters = [unlock, transactions];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send transaction from address. Sender account, recipient address, amount, min conf (defaults to value of 1), comment and comment for recipient required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendFrom(req, res) {
  const account = '';
  let { tozelcashaddress } = req.params;
  tozelcashaddress = tozelcashaddress || req.query.tozelcashaddress;
  let { amount } = req.params;
  amount = amount || req.query.amount;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { comment } = req.params;
  comment = comment || req.query.comment || '';
  let { commentto } = req.params;
  commentto = commentto || req.query.commentto || '';
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendFrom';
    let rpcparameters = [];
    if (tozelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send transaction from address after data is processed. Sender account, recipient address, amount, min conf (defaults to value of 1), comment and comment for recipient required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendFromPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { tozelcashaddress } = processedBody;
    let { amount } = processedBody;
    let { minconf } = processedBody;
    let { comment } = processedBody;
    let { commentto } = processedBody;
    const account = '';
    minconf = minconf || 1;
    comment = comment || '';
    commentto = commentto || '';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendFrom';
      let rpcparameters = [];
      if (tozelcashaddress && amount) {
        amount = serviceHelper.ensureNumber(amount);
        minconf = serviceHelper.ensureNumber(minconf);
        rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To send multiple transactions. Sender account, amounts, min conf (defaults to value of 1), comment and fee to substract from amount required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendMany(req, res) {
  const fromaccount = '';
  let { amounts } = req.params;
  amounts = amounts || req.query.amounts;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { comment } = req.params;
  comment = comment || req.query.comment || '';
  let { substractfeefromamount } = req.params;
  substractfeefromamount = substractfeefromamount || req.query.substractfeefromamount;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendMany';
    let rpcparameters = [];
    if (amounts) {
      amounts = serviceHelper.ensureObject(amounts);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [fromaccount, amounts, minconf, comment];
      if (substractfeefromamount) {
        substractfeefromamount = serviceHelper.ensureObject(substractfeefromamount);
        rpcparameters.push(substractfeefromamount);
      }
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send multiple transactions after data is processed. Sender account, amounts, min conf (defaults to value of 1), comment and fee to substract from amount required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendManyPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { amounts } = processedBody;
    let { minconf } = processedBody;
    let { comment } = processedBody;
    let { substractfeefromamount } = processedBody;
    const fromaccount = '';
    minconf = minconf || 1;
    comment = comment || '';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendMany';
      let rpcparameters = [];
      if (amounts) {
        amounts = serviceHelper.ensureObject(amounts);
        minconf = serviceHelper.ensureNumber(minconf);
        rpcparameters = [fromaccount, amounts, minconf, comment];
        if (substractfeefromamount) {
          substractfeefromamount = serviceHelper.ensureObject(substractfeefromamount);
          rpcparameters.push(substractfeefromamount);
        }
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To send transaction to address. Recipient address, amount, comment, comment for recipient and fee to substract from amount (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendToAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { amount } = req.params;
  amount = amount || req.query.amount;
  let { comment } = req.params;
  comment = comment || req.query.comment || '';
  let { commentto } = req.params;
  commentto = commentto || req.query.commentto || '';
  let { substractfeefromamount } = req.params;
  substractfeefromamount = substractfeefromamount || req.query.substractfeefromamount || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendToAddress';
    let rpcparameters = [];
    if (zelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      substractfeefromamount = serviceHelper.ensureBoolean(substractfeefromamount);
      rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send transaction to address after data is processed. Recipient address, amount, comment, comment for recipient and fee to substract from amount (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendToAddressPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { zelcashaddress } = processedBody;
    let { amount } = processedBody;
    let { comment } = processedBody;
    let { commentto } = processedBody;
    let { substractfeefromamount } = processedBody;
    comment = comment || '';
    commentto = commentto || '';
    substractfeefromamount = substractfeefromamount || false;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendToAddress';
      let rpcparameters = [];
      if (zelcashaddress && amount) {
        amount = serviceHelper.ensureNumber(amount);
        substractfeefromamount = serviceHelper.ensureBoolean(substractfeefromamount);
        rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To set transaction fee. Amount required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function setTxFee(req, res) {
  let { amount } = req.params;
  amount = amount || req.query.amount;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'setTxFee';
    let rpcparameters = [];
    if (amount) {
      amount = serviceHelper.ensureNumber(amount);
      rpcparameters = [amount];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To sign message. Address and message required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signMessage(req, res) {
  let { taddr } = req.params;
  taddr = taddr || req.query.taddr;
  let { message } = req.params;
  message = message || req.query.message;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'signMessage';
    let rpcparameters = [];
    if (taddr && message) {
      rpcparameters = [taddr, message];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To sign message after data is processed. Address and message required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signMessagePost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { taddr } = processedBody;
    const { message } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'signMessage';
      let rpcparameters = [];
      if (taddr && message) {
        rpcparameters = [taddr, message];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To export key. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zExportKey(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_exportkey';
    let rpcparameters = [];
    if (zaddr) {
      rpcparameters = [zaddr];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To export viewing key. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zExportViewingKey(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_exportviewingkey';
    let rpcparameters = [];
    if (zaddr) {
      rpcparameters = [zaddr];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get account balance. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetBalance(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getbalance';
    let rpcparameters = [];
    if (address) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [address, minconf];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get migration status. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetMigrationStatus(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getmigrationstatus';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get new address. Type (defaults to sapling) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetNewAddress(req, res) {
  let { type } = req.params;
  type = type || req.query.type || 'sapling';
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getnewaddress';
    const rpcparameters = [type];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get operation result. Operation ID required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetOperationResult(req, res) {
  let { operationid } = req.params;
  operationid = operationid || req.query.operationid || [];
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    operationid = serviceHelper.ensureObject(operationid);
    const rpccall = 'z_getoperationresult';
    const rpcparameters = [operationid];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get operation status. Operation ID required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetOperationStatus(req, res) {
  let { operationid } = req.params;
  operationid = operationid || req.query.operationid || [];
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    operationid = serviceHelper.ensureObject(operationid);
    const rpccall = 'z_getoperationstatus';
    const rpcparameters = [operationid];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get total balance. Min conf (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetTotalBalance(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'z_gettotalbalance';
    const rpcparameters = [minconf, includewatchonly];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import key. Key, rescan configuration (defaults to when key is new) and start height (defaults to value of 0) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportKey(req, res) {
  let { zkey } = req.params;
  zkey = zkey || req.query.zkey;
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importkey';
    let rpcparameters = [];
    if (zkey) {
      startheight = serviceHelper.ensureNumber(startheight);
      rpcparameters = [zkey, rescan, startheight];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import viewing key. Viewing key, rescan configuration (defaults to when key is new) and start height (defaults to value of 0) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportViewingKey(req, res) {
  let { vkey } = req.params;
  vkey = vkey || req.query.vkey;
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importviewingkey';
    let rpcparameters = [];
    if (vkey) {
      startheight = serviceHelper.ensureNumber(startheight);
      rpcparameters = [vkey, rescan, startheight];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import wallet. File name required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importwallet';
    let rpcparameters = [];
    if (filename) {
      rpcparameters = [filename];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list addresses. Whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListAddresses(req, res) {
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'z_listaddresses';
    const rpcparameters = [includewatchonly];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list Operation IDs. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListOperationIds(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listoperationids';

    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list received by address. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListReceivedByAddress(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listreceivedbyaddress';
    let rpcparameters = [];
    if (address) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [address, minconf];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list unspent. Min conf (defaults to value of 1), max conf (defaults to value of 9999999), whether to include watch only (defaults to false) and addresses required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListUnspent(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { maxconf } = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listunspent';
    minconf = serviceHelper.ensureNumber(minconf);
    maxconf = serviceHelper.ensureNumber(maxconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpcparameters = [minconf, maxconf, includewatchonly];
    if (addresses) {
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters.push(addresses);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To merge to address. Sender address, recipient address, fee (defaults to a value of 0.0001), transparent limit (defaults to a value of 50), shielded limit (defaults to a value of 20) and memo required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zMergeToAddress(req, res) {
  let { fromaddresses } = req.params;
  fromaddresses = fromaddresses || req.query.fromaddresses;
  let { toaddress } = req.params;
  toaddress = toaddress || req.query.toaddress;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  let { transparentlimit } = req.params;
  transparentlimit = transparentlimit || req.query.transparentlimit || 50; // 0 for as many as can fit
  let { shieldedlimit } = req.params;
  shieldedlimit = shieldedlimit || req.query.shieldedlimit || 20; // 0 for as many as can fit
  let { memo } = req.params;
  memo = memo || req.query.memo || '';
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_mergetoaddress';
    let rpcparameters = [];
    if (fromaddresses && toaddress) {
      fromaddresses = serviceHelper.ensureObject(fromaddresses);
      fee = serviceHelper.ensureNumber(fee);
      transparentlimit = serviceHelper.ensureNumber(transparentlimit);
      shieldedlimit = serviceHelper.ensureNumber(shieldedlimit);
      rpcparameters = [fromaddresses, toaddress, fee, transparentlimit, shieldedlimit, memo];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send multiple transactions. Sender account, amounts, min conf (defaults to value of 1) and fee (defaults to a value of 0.0001) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zSendMany(req, res) {
  let { fromaddress } = req.params;
  fromaddress = fromaddress || req.query.fromaddress;
  let { amounts } = req.params;
  amounts = amounts || req.query.amounts;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_sendmany';
    let rpcparameters = [];
    if (fromaddress && amounts) {
      amounts = serviceHelper.ensureObject(amounts);
      minconf = serviceHelper.ensureNumber(minconf);
      fee = serviceHelper.ensureNumber(fee);
      rpcparameters = [fromaddress, amounts, minconf, fee];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send multiple transactions after data is processed. Sender account, amounts, min conf (defaults to value of 1) and fee (defaults to a value of 0.0001) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zSendManyPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { fromaddress } = processedBody;
    let { amounts } = processedBody;
    let { minconf } = processedBody;
    let { fee } = processedBody;
    minconf = minconf || 1;
    fee = fee || 0.0001;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'z_sendmany';
      let rpcparameters = [];
      if (fromaddress && amounts) {
        amounts = serviceHelper.ensureObject(amounts);
        minconf = serviceHelper.ensureNumber(minconf);
        fee = serviceHelper.ensureNumber(fee);
        rpcparameters = [fromaddress, amounts, minconf, fee];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To set migration. Enabled configuration required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zSetMigration(req, res) {
  let { enabled } = req.params;
  enabled = enabled || req.query.enabled;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_setmigration';
    let rpcparameters = [];
    if (enabled) {
      enabled = serviceHelper.ensureBoolean(enabled);
      rpcparameters = [enabled];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To shield coin base. Sender address, recipient address, fee (defaults to a value of 0.0001) and limit (defaults to a value of 50) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zShieldCoinBase(req, res) {
  let { fromaddress } = req.params;
  fromaddress = fromaddress || req.query.fromaddress; // '*' for all
  let { toaddress } = req.params;
  toaddress = toaddress || req.query.toaddress;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  let { limit } = req.params;
  limit = limit || req.query.limit || 50; // 0 for as many as can fit
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_shieldcoinbase';
    let rpcparameters = [];
    if (fromaddress && toaddress) {
      fee = serviceHelper.ensureNumber(fee);
      limit = serviceHelper.ensureNumber(limit);
      rpcparameters = [fromaddress, toaddress, fee, limit];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To perform benchmark. Benchmark type and sample count required as parameters for RPC call. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcBenchmark(req, res) {
  let { benchmarktype } = req.params;
  benchmarktype = benchmarktype || req.query.benchmarktype;
  let { samplecount } = req.params;
  samplecount = samplecount || req.query.samplecount;
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'zcbenchmark';
    let rpcparameters = [];
    if (benchmarktype && samplecount) {
      samplecount = serviceHelper.ensureNumber(samplecount);
      rpcparameters = [benchmarktype, samplecount];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To perform a raw join split. Raw transaction, inputs, outputs, old vpub and new vpub required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawJoinSplit(req, res) {
  let { rawtx } = req.params;
  rawtx = rawtx || req.query.rawtx;
  let { inputs } = req.params;
  inputs = inputs || req.query.inputs;
  let { outputs } = req.params;
  outputs = outputs || req.query.outputs;
  let { vpubold } = req.params;
  vpubold = vpubold || req.query.vpubold;
  let { vpubnew } = req.params;
  vpubnew = vpubnew || req.query.vpubnew;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawjoinsplit';
    let rpcparameters = [];
    if (rawtx && inputs && outputs && vpubold && vpubnew) {
      inputs = serviceHelper.ensureObject(inputs);
      outputs = serviceHelper.ensureObject(outputs);
      rpcparameters = [rawtx, inputs, outputs, vpubold, vpubnew];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To perform a raw join split after data is processed. Raw transaction, inputs, outputs, old vpub and new vpub required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawJoinSplitPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { rawtx } = processedBody;
    let { inputs } = processedBody;
    let { outputs } = processedBody;
    const { vpubold } = processedBody;
    const { vpubnew } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'zcrawjoinsplit';
      let rpcparameters = [];
      if (rawtx && inputs && outputs && vpubold && vpubnew) {
        inputs = serviceHelper.ensureObject(inputs);
        outputs = serviceHelper.ensureObject(outputs);
        rpcparameters = [rawtx, inputs, outputs, vpubold, vpubnew];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To generate a raw key. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawKeygen(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawkeygen';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To receive raw transaction. Secret key and encrypted note required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawReceive(req, res) {
  let { zcsecretkey } = req.params;
  zcsecretkey = zcsecretkey || req.query.zcsecretkey;
  let { encryptednote } = req.params;
  encryptednote = encryptednote || req.query.encryptednote;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawreceive';
    let rpcparameters = [];
    if (zcsecretkey && encryptednote) {
      rpcparameters = [zcsecretkey, encryptednote];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To receive raw transaction after data is processed. Secret key and encrypted note required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawReceivePost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { zcsecretkey } = processedBody;
    const { encryptednote } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'zcrawreceive';
      let rpcparameters = [];
      if (zcsecretkey && encryptednote) {
        rpcparameters = [zcsecretkey, encryptednote];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To perform a sample join split. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcSampleJoinSplit(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'zcsamplejoinsplit';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To create confirmation transaction.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createConfirmationTransaction(req, res) {
  const rpccall = 'createconfirmationtransaction';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

// == Benchmarks ==
/**
 * To get benchmarks.
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
 * To get benchmark status.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBenchStatus(req, res) {
  const rpccall = 'getbenchstatus';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To start benchmark daemon. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startBenchmarkD(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'startzelbenchd';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To stop benchmark daemon. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stopBenchmarkD(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'stopzelbenchd';
    response = await executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == NON Daemon ==
/**
 * To check if daemon is synced.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function isDaemonSynced(req, res) {
  const isSynced = {
    header: currentDaemonHeader,
    height: currentDaemonHeight,
    synced: false,
  };
  if (currentDaemonHeight > currentDaemonHeader - 5) {
    isSynced.synced = true;
  }
  const successResponse = messageHelper.createDataMessage(isSynced);
  return res ? res.json(successResponse) : successResponse;
}

/**
 * To show flux daemon blockchain sync status in logs.
 */
async function fluxDaemonBlockchainInfo() {
  try {
    const daemonBlockChainInfo = await getBlockchainInfo();
    if (daemonBlockChainInfo.status === 'success') {
      currentDaemonHeight = daemonBlockChainInfo.data.blocks;
      if (daemonBlockChainInfo.data.headers >= currentDaemonHeader) {
        currentDaemonHeader = daemonBlockChainInfo.data.headers;
      }
      log.info(`Daemon Sync status: ${currentDaemonHeight}/${currentDaemonHeader}`);
    } else {
      log.error(daemonBlockChainInfo.data.message || daemonBlockChainInfo.data);
    }
  } catch (error) {
    log.warn(error);
  }
}

/**
 * To call the flux daemon blockchain info function at set intervals.
 */
function daemonBlockchainInfoService() {
  fluxDaemonBlockchainInfo();
  setInterval(() => {
    fluxDaemonBlockchainInfo();
  }, 60 * 1000);
}

module.exports = {
  getConfigValue,
  isInsightExplorer,
  // == Control ==
  help,
  getInfo,
  stop,

  // == Zelnode ==
  createZelNodeBroadcast,
  createZelNodeKey,
  decodeZelNodeBroadcast,
  getZelNodeCount,
  getZelNodeOutputs,
  getZelNodeScores,
  getZelNodeStatus,
  getZelNodeWinners,
  listZelNodeConf,
  listZelNodes,
  relayZelNodeBroadcast,
  spork,
  startDeterministicZelNode,
  startZelNode,
  viewDeterministicZelNodeList,
  zelNodeCurrentWinner,
  zelNodeDebug,
  znsync,
  getDOSList,
  getStartList,

  // == Blockchain ==
  getBestBlockHash,
  getBlock,
  getBlockchainInfo,
  getBlockCount,
  getBlockDeltas, // experimental feataure, insight explorer
  getBlockHashes, // experimental feataure, insight explorer
  getBlockHashesPost, // experimental feataure, insight explorer
  getBlockHash,
  getBlockHeader,
  getChainTips,
  getDifficulty,
  getMempoolInfo,
  getRawMemPool,
  getTxOut,
  getTxOutProof,
  getTxOutSetInfo,
  verifyChain,
  verifyTxOutProof,
  getSpentInfo, // experimental feature, insight explorer
  getSpentInfoPost, // experimental feature, insight explorer

  // == AddressIndex ==
  getAddressTxids, // insight explorer
  getSingleAddresssTxids,
  getAddressBalance, // insight explorer
  getSingleAddressBalance,
  getAddressDeltas, // insight explorer
  getSingleAddressDeltas,
  getAddressUtxos, // insight explorer
  getSingleAddressUtxos,
  getAddressMempool, // insight explorer
  getSingleAddressMempool,

  // == Disclosure ==
  // intentionally left out as of experimental feature
  // == Generating ==
  // intentionally left out as cpu mining is discouraged on zelnodes

  // == Mining ==
  getBlockSubsidy,
  getBlockTemplate,
  getLocalSolPs,
  getMiningInfo,
  getNetworkHashPs, // == available but DEPRECATED ==
  getNetworkSolPs,
  prioritiseTransaction,
  submitBlock,
  submitBlockPost,

  // == Network ==
  addNode,
  clearBanned,
  disconnectNode,
  getAddedNodeInfo,
  getConnectionCount,
  getDeprecationInfo,
  getNetTotals,
  getNetworkInfo,
  getPeerInfo,
  listBanned,
  ping,
  setBan,

  // == Rawtransactions ==
  createRawTransaction,
  createRawTransactionPost,
  decodeRawTransaction,
  decodeRawTransactionPost,
  decodeScript,
  decodeScriptPost,
  fundRawTransaction,
  fundRawTransactionPost,
  getRawTransaction,
  sendRawTransaction,
  sendRawTransactionPost,
  signRawTransaction,
  signRawTransactionPost,

  // == Util ==
  createMultiSig,
  createMultiSigPost,
  estimateFee,
  estimatePriority,
  validateAddress,
  verifyMessage,
  verifyMessagePost,
  zValidateAddress,

  // == Wallet ==
  addMultiSigAddress,
  addMultiSigAddressPost,
  backupWallet,
  dumpPrivKey,
  // encryptWallet, // == not available - EXPERIMENTAL FEATURE ==
  // getAccount, // == not available - DEPRECATED ==
  // getAccountAddress, // == not available - DEPRECATED ==
  // getAddressesByAccount, // == not available - DEPRECATED ==
  getBalance,
  getNewAddress,
  getRawChangeAddress,
  // getReceivedByAccount, // == not available - DEPRECATED ==
  getReceivedByAddress,
  getTransaction,
  getUnconfirmedBalance,
  getWalletInfo,
  importAddress,
  importPrivKey,
  importWallet, // == does not make much sense as no uploading method ==
  keyPoolRefill,
  // listAccounts, // == not available - DEPRECATED ==
  listAddressGroupings,
  listLockUnspent,
  // listReceivedByAccount, // == not available - DEPRECATED ==
  listReceivedByAddress,
  listSinceBlock,
  listTransactions,
  listUnspent,
  lockUnspent,
  rescanBlockchain,
  // move, // == not available - DEPRECATED ==
  sendFrom, // == available but DEPRECATED ==
  sendFromPost, // == available but DEPRECATED ==
  sendMany,
  sendManyPost,
  sendToAddress,
  sendToAddressPost,
  // setAccount, // == not available - DEPRECATED ==
  setTxFee,
  signMessage,
  signMessagePost,
  zExportKey,
  zExportViewingKey,
  zGetBalance,
  zGetMigrationStatus,
  zGetNewAddress,
  zGetOperationResult,
  zGetOperationStatus,
  zGetTotalBalance,
  zImportKey,
  zImportViewingKey,
  zImportWallet,
  zListAddresses,
  zListOperationIds,
  zListReceivedByAddress,
  zListUnspent,
  zMergeToAddress,
  zSendMany,
  zSendManyPost,
  zSetMigration,
  zShieldCoinBase,
  zcBenchmark,
  zcRawJoinSplit, // == available but DEPRECATED ==
  zcRawJoinSplitPost, // == available but DEPRECATED ==
  zcRawKeygen, // == available but DEPRECATED ==
  zcRawReceive, // == available but DEPRECATED ==
  zcRawReceivePost, // == available but DEPRECATED ==
  zcSampleJoinSplit,
  createConfirmationTransaction,

  // == Benchmarks ==
  getBenchmarks,
  getBenchStatus,
  startBenchmarkD,
  stopBenchmarkD,

  // == NON Daemon ==
  isDaemonSynced,
  daemonBlockchainInfoService,
};
