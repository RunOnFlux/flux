const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const { checkAndDecryptAppSpecs } = require('./enterpriseHelper');
const { appPricePerMonth } = require('./appUtilities');
const { specificationFormatter } = require('./appUtilities');
const { getChainParamsPriceUpdates } = require('./chainUtilities');
const log = require('../../lib/log');

// Cache for fiat rates
const myShortCache = new Map();

/**
 * Parse application specification versions and extract components
 * @param {object} appSpec - Application specification
 * @returns {object} Parsed specification components
 */
function parseAppSpecification(appSpec) {
  const result = {
    isCompose: false,
    components: [],
    totalResources: { cpu: 0, ram: 0, hdd: 0 },
    instances: appSpec.instances || 1,
    version: appSpec.version || 1,
  };

  if (appSpec.compose && appSpec.version >= 4) {
    result.isCompose = true;
    result.components = appSpec.compose;

    // Calculate total resources for compose apps
    appSpec.compose.forEach((component) => {
      result.totalResources.cpu += component.cpu || 0;
      result.totalResources.ram += component.ram || 0;
      result.totalResources.hdd += component.hdd || 0;
    });
  } else if (appSpec.tiered && appSpec.version <= 3) {
    // Handle tiered applications
    result.totalResources = {
      cpu: (appSpec.cpubasic || 0) + (appSpec.cpusuper || 0) + (appSpec.cpubamf || 0),
      ram: (appSpec.rambasic || 0) + (appSpec.ramsuper || 0) + (appSpec.rambamf || 0),
      hdd: (appSpec.hddbasic || 0) + (appSpec.hddsuper || 0) + (appSpec.hddbamf || 0),
    };
  } else {
    // Handle simple applications
    result.totalResources = {
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
    };
  }

  return result;
}

/**
 * Get app price with Fiat and Flux pricing
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Price response
 */
async function getAppFiatAndFluxPrice(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;

      appSpecification = serviceHelper.ensureObject(appSpecification);
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // Decrypt enterprise specifications if needed
      appSpecification = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(appSpecification);

      // Calculate app price
      const appPrice = await appPricePerMonth(appSpecFormatted, daemonHeight);

      // Add Fiat conversion logic
      const fiatPrice = await convertToFiat(appPrice);
      const priceResponse = {
        fluxPrice: appPrice,
        fiatPrice,
        currency: 'USD'
      };

      const response = messageHelper.createDataMessage(priceResponse);
      res.json(response);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Get app price (simplified wrapper)
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Price response
 */
async function getAppPrice(req, res) {
  return getAppFiatAndFluxPrice(req, res);
}

/**
 * Convert Flux price to fiat (USD)
 * @param {number} fluxPrice - Price in Flux
 * @returns {Promise<number|null>} Price in USD or null if conversion fails
 */
async function convertToFiat(fluxPrice) {
  try {
    let fluxUSDRate = myShortCache.get('fluxRates');

    if (!fluxUSDRate) {
      // Try to fetch from CoinGecko or similar API
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd');
        const data = await response.json();

        if (data.zelcash && data.zelcash.usd) {
          fluxUSDRate = data.zelcash.usd;
          myShortCache.set('fluxRates', fluxUSDRate);
          // Cache for 5 minutes
          setTimeout(() => myShortCache.delete('fluxRates'), 300000);
        }
      } catch (error) {
        log.warn('Failed to fetch Flux USD rate:', error.message);
        return null;
      }
    }

    if (fluxUSDRate) {
      return Number((fluxPrice * fluxUSDRate).toFixed(2));
    }

    return null;
  } catch (error) {
    log.error('Error in fiat conversion:', error);
    return null;
  }
}

module.exports = {
  parseAppSpecification,
  getAppFiatAndFluxPrice,
  getAppPrice,
  convertToFiat,
};