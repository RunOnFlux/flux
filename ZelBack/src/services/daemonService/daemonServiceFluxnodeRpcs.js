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
async function getFluxNodeStatus(req, res) {
  const rpccall = 'getzelnodestatus'; // getfluxnodestatus

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To list nodes. Optional filter can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listFluxNodes(req, res) {
  let { filter } = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'listzelnodes'; // listfluxnodes
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
async function listFluxNodeConf(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  let { filter } = req.params;
  filter = filter || req.query.filter;
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'listzelnodeconf'; // listfluxnodeconf
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
async function createFluxNodeKey(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodekey'; // createfluxnodekey

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get node count.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getFluxNodeCount(req, res) {
  const rpccall = 'getzelnodecount'; // getfluxnodecount

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
async function getFluxNodeOutputs(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getzelnodeoutputs'; // getfluxnodeoutputs
  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To start deterministic node. Alias required as a parameter for RPC call if not already specified. Optional lock wallet configuration can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startDeterministicFluxNode(req, res) {
  let { alias, lockwallet } = req.params;
  alias = alias || req.query.alias;
  lockwallet = lockwallet ?? req.query.lockwallet ?? false;
  lockwallet = serviceHelper.ensureBoolean(lockwallet);
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startdeterministiczelnode'; // startdeterministicfluxnode
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
async function startFluxNode(req, res) {
  let { set, lockwallet, alias } = req.params;
  set = set || req.query.set;
  lockwallet = lockwallet ?? req.query.lockwallet;
  alias = alias || req.query.alias;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startzelnode'; // startfluxnode
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
async function viewDeterministicFluxNodeList(req, res) {
  let { filter } = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'viewdeterministiczelnodelist'; // viewdeterministicfluxnodelist
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
async function fluxNodeCurrentWinner(req, res) {
  const rpccall = 'zelnodecurrentwinner'; // fluxnodecurrentwinner

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

module.exports = {
  createFluxNodeKey,
  getFluxNodeCount,
  getFluxNodeOutputs,
  getFluxNodeStatus,
  listFluxNodeConf,
  listFluxNodes,
  startDeterministicFluxNode,
  startFluxNode,
  viewDeterministicFluxNodeList,
  fluxNodeCurrentWinner,
  getDOSList,
  getStartList,
};
