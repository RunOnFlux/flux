const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('./verificationHelper');

let response = messageHelper.createErrorMessage();

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get number of network hashes per second. Blocks (defaults to value of 120) and height (defaults to value of -1) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNetworkHashPs(req, res) {
  let { blocks, height } = req.params;
  blocks = blocks || req.query.blocks || 120;
  height = height || req.query.height || -1;

  blocks = serviceHelper.ensureNumber(blocks);
  height = serviceHelper.ensureNumber(height);

  const rpccall = 'getNetworkHashPs';
  const rpcparameters = [blocks, height];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get network solutions (hash computations created) per second. Blocks (defaults to value of 120) and height (defaults to value of -1) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNetworkSolPs(req, res) {
  let { blocks, height } = req.params;
  blocks = blocks || req.query.blocks || 120;
  height = height || req.query.height || -1;

  blocks = serviceHelper.ensureNumber(blocks);
  height = serviceHelper.ensureNumber(height);
  const rpccall = 'getNetworkSolPs';
  const rpcparameters = [blocks, height];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To prioritise transaction. Transaction ID, priority delta and fee delta required as parameters for RPC call. Only accessible by users.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function prioritiseTransaction(req, res) {
  let { txid, prioritydelta, feedelta } = req.params;
  txid = txid || req.query.txid;
  prioritydelta = prioritydelta || req.query.prioritydelta;
  feedelta = feedelta || req.query.feedelta;
  const authorized = await verificationHelper.verifyPrivilege('user', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'prioritiseTransaction';
  let rpcparameters = [];
  if (txid && prioritydelta && feedelta) {
    prioritydelta = serviceHelper.ensureNumber(prioritydelta);
    feedelta = serviceHelper.ensureNumber(feedelta);
    rpcparameters = [txid, prioritydelta, feedelta];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To submit a block. Hex data required as parameter for RPC call. JSON parameters object can also be provided as a parameter for RPC call. Only accessible by users.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function submitBlock(req, res) {
  let { hexdata, jsonparametersobject } = req.params;
  hexdata = hexdata || req.query.hexdata;
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

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
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

      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

module.exports = {
  getBlockSubsidy,
  getBlockTemplate,
  getLocalSolPs,
  getMiningInfo,
  getNetworkHashPs, // == available but DEPRECATED ==
  getNetworkSolPs,
  prioritiseTransaction,
  submitBlock,
  submitBlockPost,
};
