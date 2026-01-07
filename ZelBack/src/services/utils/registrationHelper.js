const messageHelper = require('../messageHelper');
// eslint-disable-next-line no-unused-vars
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const geolocationService = require('../geolocationService');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const log = require('../../lib/log');

/**
 * Get registration information for the node
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Registration information response
 */
async function registrationInformation(req, res) {
  try {
    // Get node tier information
    const nodeTier = await generalService.nodeTier();

    // Get daemon sync status
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced');
    }

    // Get node geolocation
    const nodeGeo = await geolocationService.getNodeGeolocation();

    // Get node specifications
    // eslint-disable-next-line global-require
    const hwRequirements = require('../appRequirements/hwRequirements');
    const nodeSpecs = await hwRequirements.getNodeSpecs();

    // Prepare registration information
    const registrationInfo = {
      tier: nodeTier,
      synchronized: syncStatus.data.synced,
      blockHeight: syncStatus.data.height,
      geolocation: nodeGeo ? {
        continent: nodeGeo.continentCode,
        country: nodeGeo.countryCode,
        region: nodeGeo.regionName,
      } : null,
      hardware: {
        cpu: nodeSpecs.cpuCores,
        ram: Math.round(nodeSpecs.ram), // MB
        storage: nodeSpecs.ssdStorage, // GB
      },
      timestamp: Date.now(),
    };

    const response = messageHelper.createDataMessage(registrationInfo);
    res.json(response);
  } catch (error) {
    log.error(`Error getting registration information: ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

module.exports = {
  registrationInformation,
};
