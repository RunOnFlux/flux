const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const log = require('../../lib/log');

/**
 * To get array of price specifications updates
 * @returns {(object|object[])} Returns an array of app objects.
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
    // sort addressForks depending on height
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
 * Calculate the price per month for an application
 * @param {object} dataForAppRegistration - Application specification data
 * @param {number} height - Block height for pricing
 * @param {object[]} suppliedPrices - Optional pre-fetched price data
 * @returns {Promise<number|Error>} Monthly price or error
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
      const totalPrice = cpuTotal + ramTotal + hddTotal;
      let adjustedPrice = totalPrice;

      if (dataForAppRegistration.instances) {
        if (instancesAdditional > 0) {
          adjustedPrice = totalPrice + (totalPrice * 2 * Math.ceil(instancesAdditional / 3));
        }
      }

      if (adjustedPrice < priceSpecifications.minPrice) {
        adjustedPrice = priceSpecifications.minPrice;
      }

      return Number(Math.ceil(adjustedPrice * 100) / 100);
    }

    // Handle non-tiered applications (legacy)
    const cpuPrice = dataForAppRegistration.cpu * priceSpecifications.cpu * 10;
    const ramPrice = (dataForAppRegistration.ram * priceSpecifications.ram) / 100;
    const hddPrice = dataForAppRegistration.hdd * priceSpecifications.hdd;
    const totalPrice = cpuPrice + ramPrice + hddPrice;
    let adjustedPrice = totalPrice;

    if (dataForAppRegistration.instances) {
      if (instancesAdditional > 0) {
        adjustedPrice = totalPrice + (totalPrice * 2 * Math.ceil(instancesAdditional / 3));
      }
    }

    if (adjustedPrice < priceSpecifications.minPrice) {
      adjustedPrice = priceSpecifications.minPrice;
    }

    return Number(Math.ceil(adjustedPrice * 100) / 100);
  }

  // Handle version 4+ compose applications
  if (dataForAppRegistration.compose) {
    let totalPrice = 0;
    dataForAppRegistration.compose.forEach((appComponent) => {
      const cpuPrice = appComponent.cpu * priceSpecifications.cpu * 10;
      const ramPrice = (appComponent.ram * priceSpecifications.ram) / 100;
      const hddPrice = appComponent.hdd * priceSpecifications.hdd;
      totalPrice += cpuPrice + ramPrice + hddPrice;
    });

    let adjustedPrice = totalPrice;
    if (dataForAppRegistration.instances) {
      if (instancesAdditional > 0) {
        adjustedPrice = totalPrice + (totalPrice * 2 * Math.ceil(instancesAdditional / 3));
      }
    }

    if (adjustedPrice < priceSpecifications.minPrice) {
      adjustedPrice = priceSpecifications.minPrice;
    }

    return Number(Math.ceil(adjustedPrice * 100) / 100);
  }

  return new Error('Invalid application specification format');
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
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // TODO: Implement checkAndDecryptAppSpecs when enterprise logic is available
      // appSpecification = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(appSpecification);

      // Calculate app price
      const appPrice = await appPricePerMonth(appSpecFormatted, daemonHeight);

      // TODO: Add Fiat conversion logic
      const priceResponse = {
        fluxPrice: appPrice,
        fiatPrice: null, // TODO: Implement fiat conversion
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
 * Format app specifications to standard format
 * @param {object} specs - Raw app specifications
 * @returns {object} Formatted specifications
 */
function specificationFormatter(specs) {
  // TODO: Add proper specification formatting logic
  // For now, return specs as-is with minimal processing
  return {
    ...specs,
    // Ensure required fields have defaults
    version: specs.version || 1,
    name: specs.name || '',
    description: specs.description || '',
    owner: specs.owner || '',
    ports: specs.ports || [],
    enviromentParameters: specs.enviromentParameters || [],
    commands: specs.commands || [],
  };
}

module.exports = {
  getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates,
  appPricePerMonth,
  parseAppSpecification,
  getAppFiatAndFluxPrice,
  getAppPrice,
  specificationFormatter,
};
