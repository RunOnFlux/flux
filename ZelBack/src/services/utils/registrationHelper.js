const messageHelper = require('../messageHelper');
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
    const nodeGeo = geolocationService.getNodeGeolocation();

    // Get node specifications
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

/**
 * Check if node meets requirements for app registration
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<object>} Requirements check result
 */
async function checkNodeRegistrationRequirements(appSpecs) {
  try {
    const nodeTier = await generalService.nodeTier();
    const hwRequirements = require('../appRequirements/hwRequirements');

    // Check hardware requirements
    const hwCheck = await hwRequirements.checkAppHWRequirements(appSpecs);

    // Check geolocation requirements
    const geoCheck = hwRequirements.checkAppGeolocationRequirements(appSpecs);

    // Check static IP requirements
    const staticIpCheck = hwRequirements.checkAppStaticIpRequirements(appSpecs);

    // Check node-specific requirements
    const nodesCheck = await hwRequirements.checkAppNodesRequirements(appSpecs);

    return {
      hardware: hwCheck,
      geolocation: geoCheck,
      staticIp: staticIpCheck,
      nodes: nodesCheck,
      nodeTier,
      allRequirementsMet: hwCheck && geoCheck && staticIpCheck && nodesCheck,
    };
  } catch (error) {
    log.error(`Error checking node registration requirements: ${error.message}`);
    return {
      hardware: false,
      geolocation: false,
      staticIp: false,
      nodes: false,
      allRequirementsMet: false,
      error: error.message,
    };
  }
}

module.exports = {
  registrationInformation,
  checkNodeRegistrationRequirements,
};