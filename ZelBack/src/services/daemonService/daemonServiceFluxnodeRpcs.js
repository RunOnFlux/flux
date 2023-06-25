const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('../verificationHelper');

let response = messageHelper.createErrorMessage();

/**
 * To get node status.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeStatus(req, res) {
  const rpccall = 'getzelnodestatus';

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'listzelnodeconf';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

    response = await daemonServiceUtils.executeCall(rpccall);
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
  const rpccall = 'znsync';
  const rpcparameters = [mode];
  if (mode === 'status') {
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    return res ? res.json(response) : response;
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To create node broadcast. Command and alias required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createZelNodeBroadcast(req, res) {
  let { command, alias } = req.params;
  command = command || req.query.command || '';
  alias = alias || req.query.alias || '';

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodebroadcast';
    const rpcparameters = [command, alias];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getzelnodeoutputs';
  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get node winnners. Optional filter can be included as a parameter for RPC call. Optional number of blocks can be included as a parameter for RPC call. Otherwise defaults to 10 blocks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeWinners(req, res) {
  let { blocks, filter } = req.params;
  blocks = blocks || req.query.blocks || '10'; // defaults to 10 as default flux value
  filter = filter || req.query.filter;

  const rpccall = 'getzelnodewinners';
  const rpcparameters = [];
  rpcparameters.push(blocks);
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To show spork. Optional value can be included as a parameter for RPC call. Optional name can be included as a parameter for RPC call. Otherwise defaults to show.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function spork(req, res) {
  let { name, value } = req.params;
  name = name || req.query.name || 'show'; // name, show, active
  value = value || req.query.value;

  const rpccall = 'spork';
  const rpcparameters = [];
  rpcparameters.push(name);
  if (value) {
    value = serviceHelper.ensureNumber(value);
    rpcparameters.push(value);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To start deterministic node. Alias required as a parameter for RPC call if not already specified. Optional lock wallet configuration can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startDeterministicZelNode(req, res) {
  let { alias, lockwallet } = req.params;
  alias = alias || req.query.alias;
  lockwallet = lockwallet ?? req.query.lockwallet ?? false;
  lockwallet = serviceHelper.ensureBoolean(lockwallet);
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startdeterministiczelnode';
    const rpcparameters = [];
    rpcparameters.push(alias);
    rpcparameters.push(lockwallet);

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
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
  let { set, lockwallet, alias } = req.params;
  set = set || req.query.set;
  lockwallet = lockwallet ?? req.query.lockwallet;
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

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

module.exports = {
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
};
