const config = require('config');
const axios = require('axios');

const serviceHelper = require('../serviceHelper');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const log = require('../../lib/log');
const cacheManager = require('../utils/cacheManager').default;

// Cache managers
const myShortCache = cacheManager.fluxRatesCache;
const myLongCache = cacheManager.appPriceBlockedRepoCache;

// Database collections
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

/**
 * Get array of price updates from chain params
 * @returns {(object|object[])} Returns array of price specifications with height
 */
async function getChainParamsPriceUpdates() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.chainparams.database);
    const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;
    const query = { version: 'p' };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const priceMessages = await dbHelper.findInDatabase(database, chainParamsMessagesCollection, query, projection);
    const priceForks = [];
    config.fluxapps.price.forEach((price) => {
      priceForks.push(price);
    });
    priceMessages.forEach((data) => {
      const splittedMess = data.message.split('_');
      if (splittedMess[4]) {
        const dataPoint = {
          height: +data.height,
          cpu: +splittedMess[1],
          ram: +splittedMess[2],
          hdd: +splittedMess[3],
          minPrice: +splittedMess[4],
          port: +splittedMess[5] || 2,
          scope: +splittedMess[6] || 6,
          staticip: +splittedMess[7] || 3,
        };
        priceForks.push(dataPoint);
      }
    });
    // sort priceForks depending on height
    priceForks.sort((a, b) => {
      if (a.height > b.height) return 1;
      if (a.height < b.height) return -1;
      return 0;
    });
    return priceForks;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get array of team support address updates
 * @returns {(object|object[])} Returns an array of team support addresses with height.
 */
function getChainTeamSupportAddressUpdates() {
  try {
    /* to be adjusted in the future to check database
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.chainparams.database);
    const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;
    const query = { version: 'p' };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const priceMessages = await dbHelper.findInDatabase(database, chainParamsMessagesCollection, query, projection);
    */
    const addressForks = [];
    config.fluxapps.teamSupportAddress.forEach((address) => {
      addressForks.push(address);
    });
    // sort priceForks depending on height
    addressForks.sort((a, b) => {
      if (a.height > b.height) return 1;
      if (a.height < b.height) return -1;
      return 0;
    });
    return addressForks;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * Calculate total app hardware requirements for a specific node tier
 * @param {object} appSpecifications App specifications
 * @param {string} myNodeTier Node tier.
 * @returns {object} Values for CPU, RAM and HDD.
 */
function totalAppHWRequirements(appSpecifications, myNodeTier) {
  let cpu = 0;
  let ram = 0;
  let hdd = 0;
  const hddTier = `hdd${myNodeTier}`;
  const ramTier = `ram${myNodeTier}`;
  const cpuTier = `cpu${myNodeTier}`;
  if (appSpecifications.version <= 3) {
    if (appSpecifications.tiered) {
      cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      ram = appSpecifications[ramTier] || appSpecifications.ram;
      hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      // eslint-disable-next-line prefer-destructuring
      cpu = appSpecifications.cpu;
      // eslint-disable-next-line prefer-destructuring
      ram = appSpecifications.ram;
      // eslint-disable-next-line prefer-destructuring
      hdd = appSpecifications.hdd;
    }
  } else {
    appSpecifications.compose.forEach((appComponent) => {
      if (appComponent.tiered) {
        cpu += appComponent[cpuTier] || appComponent.cpu;
        ram += appComponent[ramTier] || appComponent.ram;
        hdd += appComponent[hddTier] || appComponent.hdd;
      } else {
        cpu += appComponent.cpu;
        ram += appComponent.ram;
        hdd += appComponent.hdd;
      }
    });
  }
  return {
    cpu,
    ram,
    hdd,
  };
}

/**
 * Calculate app price per month based on specifications and blockchain height
 * @param {object} dataForAppRegistration App registration data
 * @param {number} height Blockchain height
 * @param {object} suppliedPrices Optional supplied price specifications
 * @returns {number} Monthly price for the app
 */
async function appPricePerMonth(dataForAppRegistration, height, suppliedPrices) {
  if (!dataForAppRegistration) {
    return new Error('Application specification not provided');
  }
  const appPrices = suppliedPrices || await getChainParamsPriceUpdates();
  const intervals = appPrices.filter((i) => i.height < height);
  const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
  let instancesAdditional = 0;
  if (dataForAppRegistration.instances) {
    // spec of version >= 3
    // specification version 3 is saying. 3 instances are standard, every 3 additional is double the price.
    instancesAdditional = dataForAppRegistration.instances - 3; // has to always be >=0 as of checks before.
  }
  if (dataForAppRegistration.version <= 3) {
    if (dataForAppRegistration.tiered) {
      const cpuTotalCount = dataForAppRegistration.cpubasic + dataForAppRegistration.cpusuper + dataForAppRegistration.cpubamf;
      const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
      const cpuTotal = cpuPrice / 3;
      const ramTotalCount = dataForAppRegistration.rambasic + dataForAppRegistration.ramsuper + dataForAppRegistration.rambamf;
      const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
      const ramTotal = ramPrice / 3;
      const hddTotalCount = dataForAppRegistration.hddbasic + dataForAppRegistration.hddsuper + dataForAppRegistration.hddbamf;
      const hddPrice = hddTotalCount * priceSpecifications.hdd;
      const hddTotal = hddPrice / 3;
      let totalPrice = cpuTotal + ramTotal + hddTotal;
      if (dataForAppRegistration.port) {
        if (fluxNetworkHelper.isPortEnterprise(dataForAppRegistration.port)) {
          totalPrice += priceSpecifications.port;
        }
      } else if (dataForAppRegistration.ports) {
        const enterprisePorts = [];
        dataForAppRegistration.ports.forEach((port) => {
          if (fluxNetworkHelper.isPortEnterprise(port)) {
            enterprisePorts.push(port);
          }
        });
        totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
      }
      if (priceSpecifications.minUSDPrice && height >= config.fluxapps.applyMinimumPriceOn3Instances && totalPrice < priceSpecifications.minUSDPrice) {
        totalPrice = Number(priceSpecifications.minUSDPrice).toFixed(2);
      }
      let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
      if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
        if (appPrice < 1.50) {
          appPrice += (instancesAdditional * 0.50);
        } else {
          const additionalPrice = (appPrice * instancesAdditional) / 3;
          appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
        }
      }
      if (appPrice < priceSpecifications.minPrice) {
        appPrice = priceSpecifications.minPrice;
      }
      return appPrice;
    }
    const cpuTotal = dataForAppRegistration.cpu * priceSpecifications.cpu * 10;
    const ramTotal = (dataForAppRegistration.ram * priceSpecifications.ram) / 100;
    const hddTotal = dataForAppRegistration.hdd * priceSpecifications.hdd;
    let totalPrice = cpuTotal + ramTotal + hddTotal;
    if (dataForAppRegistration.port) {
      if (fluxNetworkHelper.isPortEnterprise(dataForAppRegistration.port)) {
        totalPrice += priceSpecifications.port;
      }
    } else if (dataForAppRegistration.ports) {
      const enterprisePorts = [];
      dataForAppRegistration.ports.forEach((port) => {
        if (fluxNetworkHelper.isPortEnterprise(port)) {
          enterprisePorts.push(port);
        }
      });
      totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
    }
    let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
    if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
      if (appPrice < 1.50) {
        appPrice += (instancesAdditional * 0.50);
      } else {
        const additionalPrice = (appPrice * instancesAdditional) / 3;
        appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
      }
    }
    if (appPrice < priceSpecifications.minPrice) {
      appPrice = priceSpecifications.minPrice;
    }
    return appPrice;
  }
  // v4+ compose
  let cpuTotalCount = 0;
  let ramTotalCount = 0;
  let hddTotalCount = 0;
  const enterprisePorts = [];
  dataForAppRegistration.compose.forEach((appComponent) => {
    if (appComponent.tiered) {
      cpuTotalCount += ((appComponent.cpubasic + appComponent.cpusuper + appComponent.cpubamf) / 3);
      ramTotalCount += ((appComponent.rambasic + appComponent.ramsuper + appComponent.rambamf) / 3);
      hddTotalCount += ((appComponent.hddbasic + appComponent.hddsuper + appComponent.hddbamf) / 3);
    } else {
      cpuTotalCount += appComponent.cpu;
      ramTotalCount += appComponent.ram;
      hddTotalCount += appComponent.hdd;
    }
    appComponent.ports.forEach((port) => {
      if (fluxNetworkHelper.isPortEnterprise(port)) {
        enterprisePorts.push(port);
      }
    });
  });
  const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
  const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
  const hddPrice = hddTotalCount * priceSpecifications.hdd;
  let totalPrice = cpuPrice + ramPrice + hddPrice;
  if ((dataForAppRegistration.nodes && dataForAppRegistration.nodes.length) || dataForAppRegistration.enterprise) { // v7+ enterprise apps
    totalPrice += priceSpecifications.scope;
  }
  if (dataForAppRegistration.staticip) { // v7+ staticip option
    totalPrice += priceSpecifications.staticip;
  }
  totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
  if (priceSpecifications.minUSDPrice && height >= config.fluxapps.applyMinimumPriceOn3Instances && totalPrice < priceSpecifications.minUSDPrice) {
    totalPrice = Number(priceSpecifications.minUSDPrice).toFixed(2);
  }
  let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
  if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
    if (appPrice < 1.50) {
      appPrice += (instancesAdditional * 0.50);
    } else {
      const additionalPrice = (appPrice * instancesAdditional) / 3;
      appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
    }
  }

  if (appPrice < priceSpecifications.minPrice) {
    appPrice = priceSpecifications.minPrice;
  }
  return appPrice;
}

/**
 * Get Flux on-chain price for app specification
 * @param {object} appSpecification App specification to price
 * @returns {string} Price in Flux tokens formatted to 2 decimal places
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
    const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
    let actualPriceToPay = await appPricePerMonth(appSpecFormatted, daemonHeight, appPrices);
    const expireIn = appSpecFormatted.expire || defaultExpire;
    // app prices are ceiled to highest 0.01
    const multiplier = expireIn / defaultExpire;
    actualPriceToPay *= multiplier;
    actualPriceToPay = Math.ceil(actualPriceToPay * 100) / 100;
    if (appInfo) {
      let previousSpecsPrice = await appPricePerMonth(appInfo, daemonHeight, appPrices); // calculate previous based on CURRENT height, with current interval of prices!
      let previousExpireIn = previousSpecsPrice.expire || defaultExpire; // bad typo bug line. Leave it like it is, this bug is a feature now.
      if (daemonHeight > 1315000) {
        previousExpireIn = appInfo.expire || defaultExpire;
      }
      const multiplierPrevious = previousExpireIn / defaultExpire;
      previousSpecsPrice *= multiplierPrevious;
      previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;
      // what is the height difference
      const heightDifference = daemonHeight - appInfo.height;
      const perc = (previousExpireIn - heightDifference) / previousExpireIn;
      if (perc > 0) {
        actualPriceToPay -= (perc * previousSpecsPrice);
      }
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
 * To verify if app update have free network update
 * @param {object} appSpecFormatted appSpecFormatted.
 * @param {number} daemonHeight daemonHeight.
 * @returns {boolean} yes if update message is network free.
 */
async function checkFreeAppUpdate(appSpecFormatted, daemonHeight) {
  // check if it's a free app update offered by the network
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  // may throw
  let query = { name: appSpecFormatted.name };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
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
          query = { 'appSpecifications.name': appSpecFormatted.name };
          const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
          let messagesInLasDays = permanentAppMessage.filter((message) => (message.type === 'fluxappupdate' || message.type === 'zelappupdate') && message.height > daemonHeight - 3600);
          // we will give a maximum of 10 free updates in 5 days, 8 in two days, 5 in one day
          if (!messagesInLasDays) {
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
 * Get app specifications USD price configuration
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<object>} Message.
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

/**
 * Helper function needed for pricing calculations - placeholder implementation
 * NOTE: This function should be imported from the main appsService.js
 */
function specificationFormatter(appSpecification) {
  // Placeholder function - assumes appSpecification is already formatted
  return appSpecification;
}

/**
 * Helper function needed for pricing calculations - placeholder implementation
 * NOTE: This function should be imported from the main appsService.js
 */
async function checkAndDecryptAppSpecs(appSpecification, options = {}) {
  // Placeholder function - assumes appSpecification doesn't need decryption
  return appSpecification;
}

/**
 * To get app fiat and flux price.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<object>} Message.
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
      const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
      actualPriceToPay = await appPricePerMonth(appSpecFormatted, daemonHeight, appPrices);
      const expireIn = appSpecFormatted.expire || defaultExpire;
      // app prices are ceiled to highest 0.01
      const multiplier = expireIn / defaultExpire;
      actualPriceToPay *= multiplier;
      actualPriceToPay = Number(actualPriceToPay).toFixed(2);
      const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (appInfo) {
        let previousSpecsPrice = await appPricePerMonth(appInfo, daemonHeight, appPrices); // calculate previous based on CURRENT height, with current interval of prices!
        let previousExpireIn = previousSpecsPrice.expire || defaultExpire; // bad typo bug line. Leave it like it is, this bug is a feature now.
        if (daemonHeight > 1315000) {
          previousExpireIn = appInfo.expire || defaultExpire;
        }
        const multiplierPrevious = previousExpireIn / defaultExpire;
        previousSpecsPrice *= multiplierPrevious;
        previousSpecsPrice = Number(previousSpecsPrice).toFixed(2);
        // what is the height difference
        const heightDifference = daemonHeight - appInfo.height;
        const perc = (previousExpireIn - heightDifference) / previousExpireIn;
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice);
        }
      }
      const appHWrequirements = totalAppHWRequirements(appSpecFormatted, 'bamf');
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
 * DEPRECATED: To get app price. Should be used getAppFiatAndFluxPrice method instead
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAppPrice(req, res) {
  return getAppFiatAndFluxPrice(req, res);
}

module.exports = {
  getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates,
  totalAppHWRequirements,
  appPricePerMonth,
  getAppFluxOnChainPrice,
  checkFreeAppUpdate,
  getAppFiatAndFluxPrice,
  getAppPrice,
  getAppSpecsUSDPrice,
  // Helper functions (placeholders for now)
  specificationFormatter,
  checkAndDecryptAppSpecs,
};
