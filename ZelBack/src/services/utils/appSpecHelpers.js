const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const { checkAndDecryptAppSpecs } = require('./enterpriseHelper');
const log = require('../../lib/log');

// Cache for fiat rates
const myShortCache = new Map();

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

/**
 * Format app specifications to standard format
 * @param {object} appSpecification - Raw app specifications
 * @returns {object} Formatted specifications
 */
function specificationFormatter(appSpecification) {
  let {
    version,
    name,
    description,
    owner,
    port, // version 1 deprecated
    containerPort, // version 1 deprecated
    compose,
    repotag,
    ports,
    domains,
    enviromentParameters,
    commands,
    containerPorts,
    containerData,
    instances,
    cpu,
    ram,
    hdd,
    tiered,
    contacts,
    geolocation,
    expire,
    nodes,
    staticip,
    enterprise,
  } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter version');
  }
  version = serviceHelper.ensureNumber(version);

  // commons
  if (!name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter name and/or description and/or owner');
  }
  name = serviceHelper.ensureString(name);
  description = serviceHelper.ensureString(description);
  owner = serviceHelper.ensureString(owner);

  // finalised parameters that will get stored in global database
  const appSpecFormatted = {
    version, // integer
    name, // string
    description, // string
    owner, // zelid string
  };

  const correctCompose = [];

  if (version === 1) {
    if (!repotag || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or port and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    repotag = serviceHelper.ensureString(repotag);
    port = serviceHelper.ensureNumber(port);
    containerPort = serviceHelper.ensureNumber(containerPort);
    enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
    const envParamsCorrected = [];
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        envParamsCorrected.push(param);
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    commands = serviceHelper.ensureObject(commands);
    const commandsCorrected = [];
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        const cmm = serviceHelper.ensureString(command);
        commandsCorrected.push(cmm);
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    containerData = serviceHelper.ensureString(containerData);
    cpu = serviceHelper.ensureNumber(cpu);
    ram = serviceHelper.ensureNumber(ram);
    hdd = serviceHelper.ensureNumber(hdd);
    tiered = serviceHelper.ensureBoolean(tiered);
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    // finalised parameters
    appSpecFormatted.repotag = repotag; // string
    appSpecFormatted.port = port; // integer
    appSpecFormatted.enviromentParameters = envParamsCorrected; // array of strings
    appSpecFormatted.commands = commandsCorrected; // array of strings
    appSpecFormatted.containerPort = containerPort; // integer
    appSpecFormatted.containerData = containerData; // string
    appSpecFormatted.cpu = cpu; // float 0.1 step
    appSpecFormatted.ram = ram; // integer 100 step (mb)
    appSpecFormatted.hdd = hdd; // integer 1 step
    appSpecFormatted.tiered = tiered; // boolean

    if (tiered) {
      // For tiered apps, set basic defaults
      appSpecFormatted.instances = instances || 3;
    }
  } else {
    // For versions 2+, use compose format
    if (compose) {
      compose.forEach((appComponent) => {
        const {
          name: componentName,
          description: componentDescription,
          repotag: componentRepotag,
          ports: componentPorts,
          domains: componentDomains,
          enviromentParameters: componentEnvParams,
          commands: componentCommands,
          containerPorts: componentContainerPorts,
          containerData: componentContainerData,
          cpu: componentCpu,
          ram: componentRam,
          hdd: componentHdd,
          tiered: componentTiered,
        } = appComponent;

        // Validate and format each component
        const formattedComponent = {
          name: serviceHelper.ensureString(componentName),
          description: serviceHelper.ensureString(componentDescription),
          repotag: serviceHelper.ensureString(componentRepotag),
          ports: componentPorts || [],
          domains: componentDomains || [],
          enviromentParameters: componentEnvParams || [],
          commands: componentCommands || [],
          containerPorts: componentContainerPorts || [],
          containerData: serviceHelper.ensureString(componentContainerData || ''),
          cpu: serviceHelper.ensureNumber(componentCpu),
          ram: serviceHelper.ensureNumber(componentRam),
          hdd: serviceHelper.ensureNumber(componentHdd),
          tiered: serviceHelper.ensureBoolean(componentTiered || false),
        };

        correctCompose.push(formattedComponent);
      });
    }

    appSpecFormatted.compose = correctCompose;
  }

  // Add optional fields if present
  if (contacts) {
    appSpecFormatted.contacts = contacts;
  }
  if (geolocation) {
    appSpecFormatted.geolocation = geolocation;
  }
  if (expire) {
    appSpecFormatted.expire = serviceHelper.ensureNumber(expire);
  }
  if (nodes) {
    appSpecFormatted.nodes = nodes;
  }
  if (staticip) {
    appSpecFormatted.staticip = staticip;
  }
  if (enterprise) {
    appSpecFormatted.enterprise = enterprise;
  }

  return appSpecFormatted;
}

module.exports = {
  getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates,
  appPricePerMonth,
  parseAppSpecification,
  getAppFiatAndFluxPrice,
  getAppPrice,
  specificationFormatter,
  convertToFiat,
};
