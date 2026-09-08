// What the app layer asks of the host system, where the answer is not a
// requirements check.
//
// The requirements checks live in appRequirements/hwRequirements - hardware,
// static ip, datacenter, nodes and geolocation - and are reached through
// appInstaller.checkAppRequirements. Parameter validation lives in
// appRequirements/appValidator, and the app monitoring lifecycle in
// appMonitoring/monitoringOrchestrator.

const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const benchmarkService = require('../benchmarkService');
const { Privilege, authOf } = require('../utils/privileges');

/**
 * To get system architecture type (ARM64 or AMD64).
 * @returns {Promise<string>} Architecture type (ARM64 or AMD64).
 */
async function systemArchitecture() {
  // get benchmark architecture - valid are arm64, amd64
  const benchmarkBenchRes = await benchmarkService.getBenchmarks();
  if (benchmarkBenchRes.status === 'error') {
    throw benchmarkBenchRes.data;
  }
  return benchmarkBenchRes.data.architecture;
}

/**
 * Get full node geolocation string
 * @returns {Promise<string>} Full geolocation string
 */
async function nodeFullGeolocation() {
  // Import locally to avoid circular dependency
  // eslint-disable-next-line global-require
  const geolocationService = require('../geolocationService');
  const nodeGeo = await geolocationService.getNodeGeolocation();
  if (!nodeGeo) {
    throw new Error('Node Geolocation not set. Aborting.');
  }
  return `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
}

/**
 * Create Flux network via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function createFluxNetworkAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    const dockerRes = await dockerService.createFluxDockerNetwork();
    const response = messageHelper.createDataMessage(dockerRes);
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

module.exports = {
  systemArchitecture,
  nodeFullGeolocation,
  createFluxNetworkAPI,
};
