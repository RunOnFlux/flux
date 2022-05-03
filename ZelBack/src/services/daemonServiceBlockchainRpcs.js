const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('./verificationHelper');

let response = messageHelper.createErrorMessage();

/**
 * To get best block hash.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBestBlockHash(req, res) {
  const rpccall = 'getBestBlockHash';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get block. Hash height and verbosity required as parameters for RPC call. Verbosity defaults to an integer value of 2.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlock(req, res) {
  let { hashheight, verbosity } = req.params;
  hashheight = hashheight || req.query.hashheight;
  hashheight = serviceHelper.ensureString(hashheight);
  verbosity = verbosity || req.query.verbosity || 2; // defaults to json object. CORRECT DAEMON verbosity is number, error says its not boolean
  verbosity = serviceHelper.ensureNumber(verbosity);

  const rpccall = 'getBlock';
  const rpcparameters = [hashheight, verbosity];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get block hashes. High and low values and options object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBlockHashes(req, res) {
  let {
    high, low, noOrphans, logicalTimes,
  } = req.params;
  high = high || req.query.high;
  low = low || req.query.low;
  noOrphans = noOrphans ?? req.query.noOrphans;
  logicalTimes = logicalTimes ?? req.query.logicalTimes;

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  let { hash, verbose } = req.params;
  hash = hash || req.query.hash;
  verbose = verbose ?? req.query.verbose ?? true;

  const rpccall = 'getBlockHeader';
  const rpcparameters = [];
  if (hash) {
    verbose = serviceHelper.ensureBoolean(verbose);
    rpcparameters.push(hash);
    rpcparameters.push(verbose);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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
  verbose = verbose ?? req.query.verbose ?? false;

  verbose = serviceHelper.ensureBoolean(verbose);

  const rpccall = 'getRawMemPool';
  const rpcparameters = [verbose];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get transaction output. Transaction ID, number and whether to include mempool (defaults to true) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTxOut(req, res) {
  let { txid, n, includemempool } = req.params;
  txid = txid || req.query.txid;
  n = n || req.query.n;
  includemempool = includemempool ?? req.query.includemempool ?? true;

  const rpccall = 'getTxOut';
  const rpcparameters = [];
  if (txid && n) {
    includemempool = serviceHelper.ensureBoolean(includemempool);
    n = serviceHelper.ensureNumber(n);
    rpcparameters.push(txid);
    rpcparameters.push(n);
    rpcparameters.push(includemempool);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get transaction output proof. Array of transaction IDs required as parameter for RPC call. Block hash can also be included as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTxOutProof(req, res) {
  let { txids, blockhash } = req.params;
  txids = txids || req.query.txids;
  blockhash = blockhash || req.query.blockhash;
  const txidsarray = txids ? txids.split(',') : undefined;

  const rpccall = 'getTxOutProof';
  const rpcparameters = [];
  if (txids && blockhash) {
    rpcparameters.push(txidsarray);
    rpcparameters.push(blockhash);
  } else if (txids) {
    rpcparameters.push(txidsarray);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To verify chain. Check level and number of blocks required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyChain(req, res) {
  let { checklevel, numblocks } = req.params;
  checklevel = checklevel || req.query.checklevel || 3;
  numblocks = numblocks || req.query.numblocks || 288;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  checklevel = serviceHelper.ensureNumber(checklevel);
  numblocks = serviceHelper.ensureNumber(numblocks);
  const rpccall = 'verifyChain';
  const rpcparameters = [checklevel, numblocks];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get spent info. Transaction ID and index required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSpentInfo(req, res) {
  let { txid, index } = req.params;
  txid = txid || req.query.txid;
  index = index || req.query.index;

  const rpccall = 'getspentinfo';
  const options = {
    txid: serviceHelper.ensureString(txid),
    index: serviceHelper.ensureNumber(index),
  };
  const rpcparameters = [options];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
      txid: serviceHelper.ensureString(txid),
      index: serviceHelper.ensureNumber(index),
    };

    const rpccall = 'getspentinfo';
    const rpcparameters = [options];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

module.exports = {
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
};
