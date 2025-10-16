// Deployment Info Service - Query functions for app deployment information
const config = require('config');
const messageHelper = require('../messageHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const chainUtilities = require('../utils/chainUtilities');
const log = require('../../lib/log');

/**
 * To get deployment information including prices and specifications.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function deploymentInformation(req, res) {
  try {
    // respond with information needed for application deployment regarding specification limitation and prices
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height;
    let deployAddr = config.fluxapps.address;
    if (daemonHeight >= config.fluxapps.appSpecsEnforcementHeights[6]) {
      deployAddr = config.fluxapps.addressMultisig;
    }
    if (daemonHeight >= config.fluxapps.multisigAddressChange) {
      deployAddr = config.fluxapps.addressMultisigB;
    }
    // search in chainparams db for chainmessages of p version
    const appPrices = await chainUtilities.getChainParamsPriceUpdates();
    const { fluxapps: { portMin, portMax } } = config;
    // After fork block, chain works 4x faster, so we use the new max blocks allowance
    const maxAllowance = daemonHeight >= config.fluxapps.daemonPONFork
      ? config.fluxapps.postPonMaxBlocksAllowance
      : config.fluxapps.maxBlocksAllowance;
    const information = {
      price: appPrices,
      appSpecsEnforcementHeights: config.fluxapps.appSpecsEnforcementHeights,
      address: deployAddr,
      portMin,
      portMax,
      enterprisePorts: config.fluxapps.enterprisePorts,
      bannedPorts: config.fluxapps.bannedPorts,
      maxImageSize: config.fluxapps.maxImageSize,
      minimumInstances: config.fluxapps.minimumInstances,
      maximumInstances: config.fluxapps.maximumInstances,
      blocksLasting: config.fluxapps.blocksLasting,
      minBlocksAllowance: config.fluxapps.minBlocksAllowance,
      maxBlocksAllowance: maxAllowance,
      blocksAllowanceInterval: config.fluxapps.blocksAllowanceInterval,
    };
    const respondPrice = messageHelper.createDataMessage(information);
    res.json(respondPrice);
  } catch (error) {
    log.warn(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get application specification usd prices.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Returns object with application specification usd prices.
 */
async function getAppSpecsUSDPrice(req, res) {
  try {
    const resMessage = messageHelper.createDataMessage(config.fluxapps.usdprice);
    res.json(resMessage);
  } catch (error) {
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
  }
}

module.exports = {
  deploymentInformation,
  getAppSpecsUSDPrice,
};
