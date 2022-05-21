const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceUtils = require('./daemonServiceUtils');

let response = messageHelper.createErrorMessage();

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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

  response = await daemonServiceUtils.executeCall(rpccall);
  if (!res) {
    delete response.data.balance;
    return res ? res.json(response) : response;
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'stop';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

module.exports = {
  help,
  getInfo,
  stop,
};
