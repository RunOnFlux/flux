const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('../verificationHelper');

let response = messageHelper.createErrorMessage();

/**
 * To get benchmarks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBenchmarks(req, res) {
  const rpccall = 'getbenchmarks';

  response = await daemonServiceUtils.executeCall(rpccall);

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

  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'startzelbenchd'; // startfluxbenchd
  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'stopzelbenchd'; // stopfluxbenchd
  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

module.exports = {
  getBenchmarks,
  getBenchStatus,
  startBenchmarkD,
  stopBenchmarkD,
};
