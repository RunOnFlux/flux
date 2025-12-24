const config = require('config');
const axios = require('axios');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const { checkAndDecryptAppSpecs } = require('./enterpriseHelper');
const { appPricePerMonth } = require('./appUtilities');
const { specificationFormatter } = require('./appUtilities');
const { getChainParamsPriceUpdates } = require('./chainUtilities');
const registryManager = require('../appDatabase/registryManager');
const cacheManager = require('./cacheManager').default;
const hwRequirements = require('../appRequirements/hwRequirements');
const log = require('../../lib/log');

// Database collections
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;

// Cache for fiat rates
const myShortCache = cacheManager.fluxRatesCache;
const myLongCache = cacheManager.appPriceBlockedRepoCache;

/**
 * Get app Flux on-chain price
 * @param {object} appSpecification - Application specification
 * @returns {Promise<string>} Price in Flux
 */
async function getAppFluxOnChainPrice(appSpecification) {
  try {
    const appSpecFormatted = specificationFormatter(appSpecification);

    // check if app exists or its a new registration price
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    // may throw
    const query = { name: appSpecFormatted.name };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }
    const daemonHeight = syncStatus.data.height;
    const appPrices = await getChainParamsPriceUpdates();
    const intervals = appPrices.filter((i) => i.height < daemonHeight);
    const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

    // Get dynamic default expire based on whether we're past the PON fork
    // After fork, blocks are 4x faster, so 1 month = 88000 blocks instead of 22000
    const blockHeightMultiplier = daemonHeight >= config.fluxapps.daemonPONFork ? 4 : 1;
    const defaultExpire = config.fluxapps.blocksLasting * blockHeightMultiplier;

    let actualPriceToPay = await appPricePerMonth(appSpecFormatted, daemonHeight, appPrices);
    const expireIn = appSpecFormatted.expire || defaultExpire;
    // app prices are ceiled to highest 0.01
    const multiplier = expireIn / defaultExpire;
    actualPriceToPay *= multiplier;
    actualPriceToPay = Math.ceil(actualPriceToPay * 100) / 100;
    if (appInfo) {
      let previousSpecsPrice = await appPricePerMonth(appInfo, daemonHeight, appPrices); // calculate previous based on CURRENT height, with current interval of prices!

      // Calculate previous expire with fork awareness
      const previousBlockHeightMultiplier = appInfo.height >= config.fluxapps.daemonPONFork ? 4 : 1;
      const previousDefaultExpire = config.fluxapps.blocksLasting * previousBlockHeightMultiplier;

      let previousExpireIn = previousSpecsPrice.expire || previousDefaultExpire; // bad typo bug line. Leave it like it is, this bug is a feature now.
      if (daemonHeight > 1315000) {
        previousExpireIn = appInfo.expire || previousDefaultExpire;
      }
      const multiplierPrevious = previousExpireIn / previousDefaultExpire;
      previousSpecsPrice *= multiplierPrevious;
      previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;

      // Calculate height difference accounting for fork
      // If app was registered before fork but we're now after fork, need to adjust
      let heightDifference = daemonHeight - appInfo.height;
      if (appInfo.height < config.fluxapps.daemonPONFork && daemonHeight >= config.fluxapps.daemonPONFork) {
        // App registered before fork, now after fork
        // Blocks before fork count as 1x, blocks after fork count as 4x (in terms of time passed)
        const blocksBeforeFork = config.fluxapps.daemonPONFork - appInfo.height;
        const blocksAfterFork = daemonHeight - config.fluxapps.daemonPONFork;
        // Normalize to pre-fork block equivalents for time calculation
        heightDifference = blocksBeforeFork + (blocksAfterFork * 4);
      }

      const perc = (previousExpireIn - heightDifference) / previousExpireIn;
      if (perc > 0) {
        actualPriceToPay -= (perc * previousSpecsPrice);
      }
    }
    const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecFormatted, 'bamf');
    if (appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
      actualPriceToPay *= 0.8;
    } else if (appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
      actualPriceToPay *= 0.9;
    }
    let gSyncthgApp = false;
    if (appSpecFormatted.version <= 3) {
      gSyncthgApp = appSpecFormatted.containerData.includes('g:');
    } else {
      gSyncthgApp = appSpecFormatted.compose.find((comp) => comp.containerData.includes('g:'));
    }
    if (gSyncthgApp) {
      actualPriceToPay *= 0.8;
    }
    actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
    if (actualPriceToPay < priceSpecifications.minPrice) {
      actualPriceToPay = priceSpecifications.minPrice;
    }
    return Number(actualPriceToPay).toFixed(2);
  } catch (error) {
    log.warn(error);
    throw error;
  }
}

/**
 * Check if app update is free
 * @param {object} appSpecFormatted - Formatted app specification
 * @param {number} daemonHeight - Current daemon height
 * @returns {Promise<boolean>} True if update is free
 */
async function checkFreeAppUpdate(appSpecFormatted, daemonHeight) {
  // check if it's a free app update offered by the network
  const appInfo = await registryManager.getApplicationGlobalSpecifications(appSpecFormatted.name);
  if (appInfo && appInfo.expire && appInfo.height && appSpecFormatted.expire) {
    const blocksToExtend = (appSpecFormatted.expire + Number(daemonHeight)) - appInfo.height - appInfo.expire;
    if (((!appSpecFormatted.nodes && !appInfo.nodes) || (appSpecFormatted.nodes && appInfo.nodes && appSpecFormatted.nodes.length === appInfo.nodes.length))
      && appSpecFormatted.instances === appInfo.instances && appSpecFormatted.staticip === appInfo.staticip && blocksToExtend <= 2) { // free updates should not extend app subscription
      if (appSpecFormatted.compose.length === appInfo.compose.length) {
        let changes = false;
        for (let i = 0; i < appSpecFormatted.compose.length; i += 1) {
          const compA = appSpecFormatted.compose[i];
          const compB = appInfo.compose[i];
          if (compA.cpu > compB.cpu || compA.ram > compB.ram || compA.hdd > compB.hdd) {
            changes = true;
            break;
          }
        }
        if (!changes) {
          const db = dbHelper.databaseConnection();
          const database = db.db(config.database.appsglobal.database);
          const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
          const query = { 'appSpecifications.name': appSpecFormatted.name };
          const projection = {
            projection: {
              _id: 0,
            },
          };
          const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
          let messagesInLasDays = permanentAppMessage.filter((message) => (message.type === 'fluxappupdate' || message.type === 'zelappupdate') && message.height > daemonHeight - 3600);
          // we will give a maximum of 10 free updates in 5 days, 8 in two days, 5 in one day
          if (!messagesInLasDays || messagesInLasDays.length === 0) {
            // eslint-disable-next-line no-param-reassign
            appSpecFormatted.expire -= blocksToExtend; // if it wasn't zero because some block was received between the validate app specs and this call, we will remove the extension.
            return true;
          }
          if (messagesInLasDays.length < 11) {
            messagesInLasDays = messagesInLasDays.filter((message) => message.height > daemonHeight - 1440);
            if (messagesInLasDays.length < 9) {
              messagesInLasDays = messagesInLasDays.filter((message) => message.height > daemonHeight - 720);
              if (messagesInLasDays.length < 6) {
                // eslint-disable-next-line no-param-reassign
                appSpecFormatted.expire -= blocksToExtend; // if it wasn't zero because some block was received between the validate app specs and this call, we will remove the extension.
                return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}

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

      if (!appSpecification) {
        throw new Error('Invalid application specification provided.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;
      appSpecification = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });
      const appSpecFormatted = specificationFormatter(appSpecification);

      // verifications skipped. This endpoint is only for price evaluation

      // check if app exists or its a new registration price
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };

      if (await checkFreeAppUpdate(appSpecFormatted, daemonHeight)) {
        const price = {
          usd: 0,
          flux: 0,
          fluxDiscount: 0,
        };
        const respondPrice = messageHelper.createDataMessage(price);
        return res.json(respondPrice);
      }

      const axiosConfig = {
        timeout: 5000,
      };
      const appPrices = [];
      if (myLongCache.has('appPrices')) {
        appPrices.push(myLongCache.get('appPrices'));
      } else {
        let response = await axios.get('https://stats.runonflux.io/apps/getappspecsusdprice', axiosConfig).catch((error) => log.error(error));
        if (response && response.data && response.data.status === 'success') {
          myLongCache.set('appPrices', response.data.data);
          appPrices.push(response.data.data);
        } else {
          response = config.fluxapps.usdprice;
          myLongCache.set('appPrices', response);
          appPrices.push(response);
        }
      }
      let actualPriceToPay = 0;

      // Get dynamic default expire based on whether we're past the PON fork
      // After fork, blocks are 4x faster, so 1 month = 88000 blocks instead of 22000
      const blockHeightMultiplier = daemonHeight >= config.fluxapps.daemonPONFork ? 4 : 1;
      const defaultExpire = config.fluxapps.blocksLasting * blockHeightMultiplier;

      actualPriceToPay = await appPricePerMonth(appSpecFormatted, daemonHeight, appPrices);
      const expireIn = appSpecFormatted.expire || defaultExpire;
      // app prices are ceiled to highest 0.01
      const multiplier = expireIn / defaultExpire;
      actualPriceToPay *= multiplier;
      actualPriceToPay = Number(actualPriceToPay).toFixed(2);
      const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (appInfo) {
        let previousSpecsPrice = await appPricePerMonth(appInfo, daemonHeight, appPrices); // calculate previous based on CURRENT height, with current interval of prices!

        // Calculate previous expire with fork awareness
        const previousBlockHeightMultiplier = appInfo.height >= config.fluxapps.daemonPONFork ? 4 : 1;
        const previousDefaultExpire = config.fluxapps.blocksLasting * previousBlockHeightMultiplier;

        let previousExpireIn = previousSpecsPrice.expire || previousDefaultExpire; // bad typo bug line. Leave it like it is, this bug is a feature now.
        if (daemonHeight > 1315000) {
          previousExpireIn = appInfo.expire || previousDefaultExpire;
        }

        // Adjust previousExpireIn if app was registered before fork and expiration crosses fork
        if (appInfo.height < config.fluxapps.daemonPONFork) {
          const originalExpireHeight = appInfo.height + previousExpireIn;
          if (originalExpireHeight > config.fluxapps.daemonPONFork) {
            // Expiration crosses fork boundary - adjust blocks after fork
            const blocksAfterFork = originalExpireHeight - config.fluxapps.daemonPONFork;
            const adjustedBlocksAfterFork = blocksAfterFork * 4;
            const adjustedExpireHeight = config.fluxapps.daemonPONFork + adjustedBlocksAfterFork;
            previousExpireIn = adjustedExpireHeight - appInfo.height;
          }
        }
        const multiplierPrevious = previousExpireIn / previousDefaultExpire;
        previousSpecsPrice *= multiplierPrevious;
        previousSpecsPrice = Number(previousSpecsPrice).toFixed(2);

        // Calculate height difference accounting for fork
        // If app was registered before fork but we're now after fork, need to adjust
        let heightDifference = daemonHeight - appInfo.height;
        if (appInfo.height < config.fluxapps.daemonPONFork && daemonHeight >= config.fluxapps.daemonPONFork) {
          // App registered before fork, now after fork
          // Blocks before fork count as 1x, blocks after fork count as 4x (in terms of time passed)
          const blocksBeforeFork = config.fluxapps.daemonPONFork - appInfo.height;
          const blocksAfterFork = daemonHeight - config.fluxapps.daemonPONFork;
          // Normalize to pre-fork block equivalents for time calculation
          heightDifference = blocksBeforeFork + (blocksAfterFork * 4);
        }

        const perc = (previousExpireIn - heightDifference) / previousExpireIn;
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice);
        }
      }
      const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecFormatted, 'bamf');
      const applyHWDiscount = appSpecFormatted.version <= 3 || appSpecFormatted.instances < 5;
      if (applyHWDiscount) {
        if (appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
          actualPriceToPay *= 0.8;
        } else if (appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
          actualPriceToPay *= 0.9;
        }
      }
      let gSyncthgApp = false;
      if (appSpecFormatted.version <= 3) {
        gSyncthgApp = appSpecFormatted.containerData.includes('g:');
      } else {
        gSyncthgApp = appSpecFormatted.compose.find((comp) => comp.containerData.includes('g:'));
      }
      if (gSyncthgApp) {
        actualPriceToPay *= 0.8;
      }
      const marketplaceResponse = await axios.get('https://stats.runonflux.io/marketplace/listapps').catch((error) => log.error(error));
      let marketPlaceApps = [];
      if (marketplaceResponse && marketplaceResponse.data && marketplaceResponse.data.status === 'success') {
        marketPlaceApps = marketplaceResponse.data.data;
      } else {
        log.error('Unable to get marketplace information');
      }

      if (appSpecification.priceUSD) {
        if (appSpecification.priceUSD < actualPriceToPay) {
          log.info(appSpecification.priceUSD);
          log.info(actualPriceToPay);
          throw new Error('USD price is not valid');
        }
        actualPriceToPay = Number(appSpecification.priceUSD).toFixed(2);
      } else {
        const marketPlaceApp = marketPlaceApps.find((app) => appSpecFormatted.name.toLowerCase().startsWith(app.name.toLowerCase()));
        if (marketPlaceApp) {
          if (marketPlaceApp.multiplier > 1) {
            actualPriceToPay *= marketPlaceApp.multiplier;
          }
        }
        actualPriceToPay = Number(actualPriceToPay * appPrices[0].multiplier).toFixed(2);
        if (actualPriceToPay < appPrices[0].minUSDPrice) {
          actualPriceToPay = Number(appPrices[0].minUSDPrice).toFixed(2);
        }
      }

      // Apply subscription duration discount
      const subscriptionMonths = expireIn / defaultExpire;
      if (subscriptionMonths >= 9) {
        actualPriceToPay *= 0.88; // 12% discount
      } else if (subscriptionMonths >= 6) {
        actualPriceToPay *= 0.94; // 6% discount
      } else if (subscriptionMonths >= 3) {
        actualPriceToPay *= 0.97; // 3% discount
      }
      actualPriceToPay = Number(actualPriceToPay).toFixed(2);

      // Ensure final price meets minimum after all discounts
      if (actualPriceToPay < appPrices[0].minUSDPrice) {
        actualPriceToPay = Number(appPrices[0].minUSDPrice).toFixed(2);
      }

      let fiatRates;
      let fluxUSDRate;
      if (myShortCache.has('fluxRates')) {
        fluxUSDRate = myShortCache.get('fluxRates');
      } else {
        fiatRates = await axios.get('https://viprates.runonflux.io/rates', axiosConfig).catch((error) => log.error(error));
        if (fiatRates && fiatRates.data) {
          const rateObj = fiatRates.data[0].find((rate) => rate.code === 'USD');
          if (!rateObj) {
            throw new Error('Unable to get USD rate.');
          }
          const btcRateforFlux = fiatRates.data[1].FLUX;
          if (btcRateforFlux === undefined) {
            throw new Error('Unable to get Flux USD Price.');
          }
          fluxUSDRate = rateObj.rate * btcRateforFlux;
          myShortCache.set('fluxRates', fluxUSDRate);
        } else {
          fiatRates = await axios.get('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=zelcash', axiosConfig);
          if (fiatRates && fiatRates.data && fiatRates.data.zelcash && fiatRates.data.zelcash.usd) {
            fluxUSDRate = fiatRates.data.zelcash.usd;
            myShortCache.set('fluxRates', fluxUSDRate);
          } else {
            // eslint-disable-next-line prefer-destructuring
            fluxUSDRate = config.fluxapps.fluxUSDRate;
            myShortCache.set('fluxRates', fluxUSDRate);
          }
        }
      }
      const fluxPrice = Number(((actualPriceToPay / fluxUSDRate) * appPrices[0].fluxmultiplier));
      const fluxChainPrice = Number(await getAppFluxOnChainPrice(appSpecification));
      const price = {
        usd: Number(actualPriceToPay),
        flux: fluxChainPrice > fluxPrice ? Number(fluxChainPrice.toFixed(2)) : Number(fluxPrice.toFixed(2)),
        fluxDiscount: fluxChainPrice > fluxPrice ? 'Not possible to define discount' : Number(100 - (appPrices[0].fluxmultiplier * 100)),
      };
      const respondPrice = messageHelper.createDataMessage(price);
      return res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
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

module.exports = {
  parseAppSpecification,
  getAppFiatAndFluxPrice,
  getAppPrice,
  getAppFluxOnChainPrice,
  checkFreeAppUpdate,
  // Re-export for backward compatibility
  specificationFormatter,
};
