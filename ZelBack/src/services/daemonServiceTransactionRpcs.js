const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('./verificationHelper');
const client = require('./utils/daemonrpcClient').default;

let response = messageHelper.createErrorMessage();

// == Rawtransactions ==
/**
 * To create raw transaction. Transactions, addresses, lock time (defaults to value of 0) and
 * expiry height (defaults to block count + 20) required as parameters for RPC call.
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
    response = messageHelper.createErrorMessage(error.message, error.name, error.code);
  });
  if (!blockcount) {
    // getBlockCount rejected the promise - return error message
    return res ? res.json(response) : response;
  }
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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To create raw transaction after data is processed. Transactions, addresses,
 * lock time (defaults to value of 0) and expiry height (defaults to block count + 20) required as parameters for RPC call.
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
      response = messageHelper.createErrorMessage(error.message, error.name, error.code);
    });
    if (!blockcount) {
      // getBlockCount rejected the promise - return error message
      return res.json(response);
    }
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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To sign raw transaction. Hex string, previous transactions, private keys,
 * signature hash type (defaults to ALL) and branch ID required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signRawTransaction(req, res) {
  let {
    hexstring, prevtxs, privatekeys, sighashtype, branchid,
  } = req.params;
  hexstring = hexstring || req.query.hexstring;
  prevtxs = prevtxs || req.query.prevtxs;
  privatekeys = privatekeys || req.query.privatekeys;
  sighashtype = sighashtype || req.query.sighashtype || 'ALL';
  branchid = branchid || req.query.branchid;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  return res ? res.json(response) : response;
}

/**
 * To sign raw transaction after data is processed. Hex string, previous transactions, private keys,
 *  signature hash type (defaults to all) and branch ID required as parameters for RPC call. Only accessible by admins.
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
    const { hexstring, branchid } = processedBody;
    let { prevtxs, privatekeys, sighashtype } = processedBody;
    sighashtype = sighashtype || 'ALL';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      response = messageHelper.errUnauthorizedMessage();
      return res.json(response);
    }
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
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    return res.json(response);
  });
}

module.exports = {
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
};
