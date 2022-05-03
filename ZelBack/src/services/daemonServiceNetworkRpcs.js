const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('./verificationHelper');

let response = messageHelper.createErrorMessage();

/**
 * To add a node. Node and command required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addNode(req, res) {
  let { node, command } = req.params;
  node = node || req.query.node;
  command = command || req.query.command;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();

    return res ? res.json(response) : response;
  }
  const rpccall = 'addNode';
  let rpcparameters = [];
  if (node && command) {
    rpcparameters = [node, command];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'clearBanned';
  response = await daemonServiceUtils.executeCall(rpccall);

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

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
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
  let { dns, node } = req.params;
  dns = dns ?? req.query.dns;
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

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'ping';
  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To set a ban on an IP address. IP, command, ban time and if absolute required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function setBan(req, res) {
  let {
    ip, command, bantime, absolute,
  } = req.params;
  ip = ip || req.query.ip;
  command = command || req.query.command;
  bantime = bantime || req.query.bantime;
  absolute = absolute ?? req.query.absolute;
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

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

module.exports = {
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
};
