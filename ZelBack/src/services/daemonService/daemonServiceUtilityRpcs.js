const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');

let response = messageHelper.createErrorMessage();

/**
 * To create a multi-signature scheme (to require multiple keys to authorize a transaction). Number of signatures and keys object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createMultiSig(req, res) {
  let { n, keys } = req.params;
  n = n || req.query.n;
  keys = keys || req.query.keys;

  const rpccall = 'createMultiSig';
  let rpcparameters = [];
  if (n && keys) {
    n = serviceHelper.ensureNumber(n);
    keys = serviceHelper.ensureObject(keys);
    rpcparameters = [n, keys];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    let { n, keys } = processedBody;

    const rpccall = 'createMultiSig';
    let rpcparameters = [];
    if (n && keys) {
      n = serviceHelper.ensureNumber(n);
      keys = serviceHelper.ensureObject(keys);
      rpcparameters = [n, keys];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  if (!res) {
    delete response.data.ismine;
    delete response.data.iswatchonly;

    return response;
  }

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    delete response.data.ismine;
    delete response.data.iswatchonly;
  }

  return res.json(response);
}

/**
 * To verify a message. Address, signature and message required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyMessage(req, res) {
  let { zelcashaddress, signature, message } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  signature = signature || req.query.signature;
  message = message || req.query.message;

  const rpccall = 'verifyMessage';
  let rpcparameters = [];
  if (zelcashaddress && signature && message) {
    rpcparameters = [zelcashaddress, signature, message];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    const { zelcashaddress, signature, message } = processedBody;

    const rpccall = 'verifyMessage';
    let rpcparameters = [];
    if (zelcashaddress && signature && message) {
      rpcparameters = [zelcashaddress, signature, message];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

module.exports = {
  createMultiSig,
  createMultiSigPost,
  estimateFee,
  estimatePriority,
  validateAddress,
  verifyMessage,
  verifyMessagePost,
  zValidateAddress,
};
