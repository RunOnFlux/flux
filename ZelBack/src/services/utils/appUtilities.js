const path = require('path');
const util = require('util');
const nodecmd = require('node-cmd');
const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const geolocationService = require('../geolocationService');
const { getChainParamsPriceUpdates } = require('./chainUtilities');

const cmdAsync = util.promisify(nodecmd.run);
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');

/**
 * Calculate app price per month
 * @param {object} dataForAppRegistration - App registration data
 * @param {number} height - Block height
 * @param {Array} suppliedPrices - Optional price data
 * @returns {Promise<number>} Monthly price
 */
async function appPricePerMonth(dataForAppRegistration, height, suppliedPrices) {
  if (!dataForAppRegistration) {
    return new Error('Application specification not provided');
  }
  // eslint-disable-next-line global-require
  const fluxNetworkHelper = require('../fluxNetworkHelper');
  const appPrices = suppliedPrices || await getChainParamsPriceUpdates();
  const intervals = appPrices.filter((i) => i.height < height);
  const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
  let instancesAdditional = 0;
  const isV8OrAbove = dataForAppRegistration.version >= 8 && height >= config.fluxapps.minimumInstancesV8Block;
  const baseInstances = isV8OrAbove ? 1 : 3;
  if (dataForAppRegistration.instances) {
    // spec of version >= 3
    // specification version 3-7 is saying. 3 instances are standard, every 3 additional is double the price.
    // specification version 8+ allows 1 instance as base, pricing is per instance.
    instancesAdditional = dataForAppRegistration.instances - baseInstances;
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

  // For v8+ apps, calculate price per instance (base price is for 3 instances, so divide by 3)
  // then multiply by actual number of instances
  if (isV8OrAbove) {
    const pricePerInstance = totalPrice / 3;
    totalPrice = pricePerInstance * dataForAppRegistration.instances;
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

/**
 * Get node full geolocation
 * @returns {string} Full geolocation string
 */
function nodeFullGeolocation() {
  const nodeGeo = geolocationService.getNodeGeolocation();
  if (!nodeGeo) {
    throw new Error('Node Geolocation not set. Aborting.');
  }
  const myNodeLocationFull = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
  return myNodeLocationFull;
}

/**
 * Get app folder size
 * @param {string} appName - Application name
 * @returns {Promise<number>} Folder size in bytes
 */
async function getAppFolderSize(appName) {
  try {
    const appsDirPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
    const directoryPath = path.join(appsDirPath, appName);
    const exec = `sudo du -s --block-size=1 ${directoryPath}`;
    const cmdres = await cmdAsync(exec);
    const size = serviceHelper.ensureString(cmdres).split('\t')[0] || 0;
    return size;
  } catch (error) {
    log.error(`Error getting app folder size: ${error.message}`);
    return 0;
  }
}

/**
 * Get container storage usage
 * @param {string} appName - Application name
 * @returns {Promise<object>} Storage usage information
 */
async function getContainerStorage(appName) {
  try {
    const containerInfo = await dockerService.dockerContainerInspect(appName, { size: true });
    let bindMountsSize = 0;
    let volumeMountsSize = 0;
    const containerRootFsSize = serviceHelper.ensureNumber(containerInfo.SizeRootFs) || 0;
    if (containerInfo?.Mounts?.length) {
      // Collect all mount sources and filter out nested mounts to avoid double-counting
      const allMounts = containerInfo.Mounts.filter((m) => m?.Source);
      const mountsToCount = [];

      // For each mount, check if it's a child of another mount
      // eslint-disable-next-line no-restricted-syntax
      for (const mount of allMounts) {
        const source = mount.Source;
        const isNested = allMounts.some((otherMount) => {
          if (otherMount === mount) return false; // Skip self
          const otherSource = otherMount.Source;
          // Check if this mount is a child of another mount
          return source.startsWith(`${otherSource}/`);
        });

        if (!isNested) {
          mountsToCount.push(mount);
        }
      }

      await Promise.all(mountsToCount.map(async (mount) => {
        const source = mount.Source;
        const mountType = mount.Type;
        if (mountType === 'bind') {
          const exec = `sudo du -sb ${source}`;
          try {
            const mountInfo = await cmdAsync(exec);
            if (mountInfo) {
              const sizeNum = serviceHelper.ensureNumber(mountInfo.split('\t')[0]) || 0;
              bindMountsSize += sizeNum;
            } else {
              log.warn(`No mount info returned for source: ${source}`);
            }
          } catch (error) {
            log.warn(`Failed to get size for bind mount ${source}: ${error.message}`);
          }
        } else if (mountType === 'volume') {
          const exec = `sudo du -sb ${source}`;
          try {
            const mountInfo = await cmdAsync(exec);
            if (mountInfo) {
              const sizeNum = serviceHelper.ensureNumber(mountInfo.split('\t')[0]) || 0;
              volumeMountsSize += sizeNum;
            } else {
              log.warn(`No mount info returned for source: ${source}`);
            }
          } catch (error) {
            log.warn(`Failed to get size for volume mount ${source}: ${error.message}`);
          }
        } else {
          log.warn(`Unsupported mount type or source: Type: ${mountType}, Source: ${source}`);
        }
      }));
    }
    const usedSize = bindMountsSize + volumeMountsSize + containerRootFsSize;
    return {
      bind: bindMountsSize,
      volume: volumeMountsSize,
      rootfs: containerRootFsSize,
      used: usedSize,
      status: 'success',
    };
  } catch (error) {
    log.error(`Error fetching container storage: ${error.message}`);
    return {
      bind: 0,
      volume: 0,
      rootfs: 0,
      used: 0,
      status: 'error',
      message: error.message,
    };
  }
}

/**
 * Get app ports from specifications
 * @param {object} appSpecs - Application specifications
 * @returns {Array<number>} Array of port numbers
 */
function getAppPorts(appSpecs) {
  const appPorts = [];
  // eslint-disable-next-line no-restricted-syntax
  if (appSpecs.version === 1) {
    appPorts.push(+appSpecs.port);
  } else if (appSpecs.version <= 3) {
    appSpecs.ports.forEach((port) => {
      appPorts.push(+port);
    });
  } else {
    appSpecs.compose.forEach((component) => {
      component.ports.forEach((port) => {
        appPorts.push(+port);
      });
    });
  }
  return appPorts;
}

/**
 * Format app specifications to standard format
 * @param {object} appSpecification - Raw app specifications
 * @returns {object} Formatted app specifications
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
      let {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
        throw new Error('Flux App was requested as tiered setup but specifications are missing');
      }
      cpubasic = serviceHelper.ensureNumber(cpubasic);
      cpusuper = serviceHelper.ensureNumber(cpusuper);
      cpubamf = serviceHelper.ensureNumber(cpubamf);
      rambasic = serviceHelper.ensureNumber(rambasic);
      ramsuper = serviceHelper.ensureNumber(ramsuper);
      rambamf = serviceHelper.ensureNumber(rambamf);
      hddbasic = serviceHelper.ensureNumber(hddbasic);
      hddsuper = serviceHelper.ensureNumber(hddsuper);
      hddbamf = serviceHelper.ensureNumber(hddbamf);

      appSpecFormatted.cpubasic = cpubasic;
      appSpecFormatted.cpusuper = cpusuper;
      appSpecFormatted.cpubamf = cpubamf;
      appSpecFormatted.rambasic = rambasic;
      appSpecFormatted.ramsuper = ramsuper;
      appSpecFormatted.rambamf = rambamf;
      appSpecFormatted.hddbasic = hddbasic;
      appSpecFormatted.hddsuper = hddsuper;
      appSpecFormatted.hddbamf = hddbamf;
    }
  } else if (version <= 3) {
    if (!repotag || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or port and/or domains and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    repotag = serviceHelper.ensureString(repotag);
    ports = serviceHelper.ensureObject(ports);
    const portsCorrect = [];
    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // v2 and v3 have string
        portsCorrect.push(param);
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }
    domains = serviceHelper.ensureObject(domains);
    const domainsCorrect = [];
    if (Array.isArray(domains)) {
      domains.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        domainsCorrect.push(param);
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
    }
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
    containerPorts = serviceHelper.ensureObject(containerPorts);
    const containerportsCorrect = [];
    if (Array.isArray(containerPorts)) {
      containerPorts.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // next specification fork here we want to do ensureNumber
        containerportsCorrect.push(param);
      });
    } else {
      throw new Error('Container Ports for Flux App are invalid');
    }
    containerData = serviceHelper.ensureString(containerData);
    cpu = serviceHelper.ensureNumber(cpu);
    ram = serviceHelper.ensureNumber(ram);
    hdd = serviceHelper.ensureNumber(hdd);
    tiered = serviceHelper.ensureBoolean(tiered);
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }

    // finalised parameters.
    appSpecFormatted.repotag = repotag; // string
    appSpecFormatted.ports = portsCorrect; // array of integers
    appSpecFormatted.domains = domainsCorrect;
    appSpecFormatted.enviromentParameters = envParamsCorrected; // array of strings
    appSpecFormatted.commands = commandsCorrected; // array of strings
    appSpecFormatted.containerPorts = containerportsCorrect; // array of integers
    appSpecFormatted.containerData = containerData; // string
    appSpecFormatted.cpu = cpu; // float 0.1 step
    appSpecFormatted.ram = ram; // integer 100 step (mb)
    appSpecFormatted.hdd = hdd; // integer 1 step
    appSpecFormatted.tiered = tiered; // boolean

    if (tiered) {
      let {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
        throw new Error('Flux App was requested as tiered setup but specifications are missing');
      }
      cpubasic = serviceHelper.ensureNumber(cpubasic);
      cpusuper = serviceHelper.ensureNumber(cpusuper);
      cpubamf = serviceHelper.ensureNumber(cpubamf);
      rambasic = serviceHelper.ensureNumber(rambasic);
      ramsuper = serviceHelper.ensureNumber(ramsuper);
      rambamf = serviceHelper.ensureNumber(rambamf);
      hddbasic = serviceHelper.ensureNumber(hddbasic);
      hddsuper = serviceHelper.ensureNumber(hddsuper);
      hddbamf = serviceHelper.ensureNumber(hddbamf);

      appSpecFormatted.cpubasic = cpubasic;
      appSpecFormatted.cpusuper = cpusuper;
      appSpecFormatted.cpubamf = cpubamf;
      appSpecFormatted.rambasic = rambasic;
      appSpecFormatted.ramsuper = ramsuper;
      appSpecFormatted.rambamf = rambamf;
      appSpecFormatted.hddbasic = hddbasic;
      appSpecFormatted.hddsuper = hddsuper;
      appSpecFormatted.hddbamf = hddbamf;
    }
  } else { // v4+
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    compose = serviceHelper.ensureObject(compose);
    if (!Array.isArray(compose)) {
      throw new Error('Flux App compose parameter is not valid');
    }
    compose.forEach((appComponent) => {
      const appComponentCorrect = {};
      appComponentCorrect.name = serviceHelper.ensureString(appComponent.name);
      appComponentCorrect.description = serviceHelper.ensureString(appComponent.description);
      appComponentCorrect.repotag = serviceHelper.ensureString(appComponent.repotag);
      appComponentCorrect.ports = serviceHelper.ensureObject(appComponent.ports);
      const portsCorrect = [];
      if (Array.isArray(appComponentCorrect.ports)) {
        appComponentCorrect.ports.forEach((parameter) => {
          const param = serviceHelper.ensureNumber(parameter);
          portsCorrect.push(param);
        });
        appComponentCorrect.ports = portsCorrect;
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.domains = serviceHelper.ensureObject(appComponent.domains);
      const domainsCorect = [];
      if (Array.isArray(appComponentCorrect.domains)) {
        appComponentCorrect.domains.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          domainsCorect.push(param);
        });
        appComponentCorrect.domains = domainsCorect;
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.environmentParameters = serviceHelper.ensureObject(appComponent.environmentParameters);
      const envParamsCorrected = [];
      if (Array.isArray(appComponentCorrect.environmentParameters)) {
        appComponentCorrect.environmentParameters.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          envParamsCorrected.push(param);
        });
        appComponentCorrect.environmentParameters = envParamsCorrected;
      } else {
        throw new Error(`Environmental parameters for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.commands = serviceHelper.ensureObject(appComponent.commands);
      const commandsCorrected = [];
      if (Array.isArray(appComponentCorrect.commands)) {
        appComponentCorrect.commands.forEach((command) => {
          const cmm = serviceHelper.ensureString(command);
          commandsCorrected.push(cmm);
        });
        appComponentCorrect.commands = commandsCorrected;
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      appComponentCorrect.containerPorts = serviceHelper.ensureObject(appComponent.containerPorts);
      const containerportsCorrect = [];
      if (Array.isArray(appComponentCorrect.containerPorts)) {
        appComponentCorrect.containerPorts.forEach((parameter) => {
          const param = serviceHelper.ensureNumber(parameter);
          containerportsCorrect.push(param);
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.containerData = serviceHelper.ensureString(appComponent.containerData);
      appComponentCorrect.cpu = serviceHelper.ensureNumber(appComponent.cpu);
      appComponentCorrect.ram = serviceHelper.ensureNumber(appComponent.ram);
      appComponentCorrect.hdd = serviceHelper.ensureNumber(appComponent.hdd);

      if (version <= 7) {
        appComponentCorrect.tiered = appComponent.tiered;
        if (typeof appComponentCorrect.tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }
        if (appComponentCorrect.tiered) {
          let {
            cpubasic,
            cpusuper,
            cpubamf,
            rambasic,
            ramsuper,
            rambamf,
            hddbasic,
            hddsuper,
            hddbamf,
          } = appComponent;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error(`Flux App component ${appComponent.name} was requested as tiered setup but specifications are missing`);
          }
          cpubasic = serviceHelper.ensureNumber(cpubasic);
          cpusuper = serviceHelper.ensureNumber(cpusuper);
          cpubamf = serviceHelper.ensureNumber(cpubamf);
          rambasic = serviceHelper.ensureNumber(rambasic);
          ramsuper = serviceHelper.ensureNumber(ramsuper);
          rambamf = serviceHelper.ensureNumber(rambamf);
          hddbasic = serviceHelper.ensureNumber(hddbasic);
          hddsuper = serviceHelper.ensureNumber(hddsuper);
          hddbamf = serviceHelper.ensureNumber(hddbamf);

          appComponentCorrect.cpubasic = cpubasic;
          appComponentCorrect.cpusuper = cpusuper;
          appComponentCorrect.cpubamf = cpubamf;
          appComponentCorrect.rambasic = rambasic;
          appComponentCorrect.ramsuper = ramsuper;
          appComponentCorrect.rambamf = rambamf;
          appComponentCorrect.hddbasic = hddbasic;
          appComponentCorrect.hddsuper = hddsuper;
          appComponentCorrect.hddbamf = hddbamf;
        }
      }

      if (version >= 7) {
        appComponentCorrect.repoauth = serviceHelper.ensureString(appComponent.repoauth);
        if (version === 7) {
          appComponentCorrect.secrets = serviceHelper.ensureString(appComponent.secrets);
        }
      }
      correctCompose.push(appComponentCorrect);
    });
    appSpecFormatted.compose = correctCompose;
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter instances');
    }
    instances = serviceHelper.ensureNumber(instances);
    if (typeof instances !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(instances) !== true) {
      throw new Error('Invalid instances specified');
    }
    const minInstances = version >= 8
      ? config.fluxapps.minimumInstancesV8
      : config.fluxapps.minimumInstances;
    if (instances < minInstances) {
      throw new Error(`Minimum number of instances is ${minInstances}`);
    }
    if (instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
    appSpecFormatted.instances = instances;
  }

  if (version >= 5) {
    if (!contacts || !geolocation) { // can be empty array for no contact or no geolocation requirements
      throw new Error('Missing Flux App specification parameter contacts and/or geolocation');
    }
    contacts = serviceHelper.ensureObject(contacts);
    const contactsCorrect = [];
    if (Array.isArray(contacts)) {
      contacts.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        contactsCorrect.push(param);
      });
    } else {
      throw new Error('Contacts for Flux App are invalid');
    }
    appSpecFormatted.contacts = contactsCorrect;

    geolocation = serviceHelper.ensureObject(geolocation);
    const geolocationCorrect = [];
    if (Array.isArray(geolocation)) {
      geolocation.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        geolocationCorrect.push(param);
      });
    } else {
      throw new Error('Geolocation for Flux App is invalid');
    }
    appSpecFormatted.geolocation = geolocationCorrect;
  }

  if (version >= 6) {
    if (!expire) {
      throw new Error('Missing Flux App specification parameter expire');
    }
    expire = serviceHelper.ensureNumber(expire);
    if (typeof expire !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid instances specified');
    }

    // Determine the correct maxBlocksAllowance based on current blockchain height
    let maxAllowance = config.fluxapps.maxBlocksAllowance;
    try {
      // eslint-disable-next-line global-require
      const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
      const currentHeight = daemonServiceMiscRpcs.getCurrentDaemonHeight();
      if (currentHeight >= config.fluxapps.daemonPONFork) {
        maxAllowance = config.fluxapps.postPonMaxBlocksAllowance;
      }
    } catch (error) {
      log.warn(`Unable to fetch blockchain height for maxBlocksAllowance validation: ${error.message}. Using default value.`);
      // If we can't get the height, default to the original maxBlocksAllowance for safety
    }

    if (expire > maxAllowance) {
      throw new Error(`Maximum expiration of application is ${maxAllowance} blocks ~ 1 year`);
    }
    appSpecFormatted.expire = expire;
  }

  if (version >= 7) {
    if (!nodes) { // can be empty array for no nodes set
      throw new Error('Missing Flux App specification parameter nodes');
    }
    nodes = serviceHelper.ensureObject(nodes);
    const nodesCorrect = [];
    if (Array.isArray(nodes)) {
      nodes.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        nodesCorrect.push(param);
      });
    } else {
      throw new Error('Nodes for Flux App are invalid');
    }
    appSpecFormatted.nodes = nodesCorrect;

    staticip = serviceHelper.ensureBoolean(staticip);
    if (typeof staticip !== 'boolean') {
      throw new Error('Invalid staticip specification. Only boolean as true or false allowed.');
    }
    appSpecFormatted.staticip = staticip;
  }

  if (version >= 8) {
    if (enterprise) {
      enterprise = serviceHelper.ensureString(enterprise);
    }

    appSpecFormatted.enterprise = enterprise;
  }

  return appSpecFormatted;
}

/**
 * Update app specifications to latest version (v8)
 * @param {object} appSpec - Application specifications
 * @returns {object} Updated app specifications
 */
function updateToLatestAppSpecifications(appSpec) {
  // current latest version is 8
  if (appSpec.version === 1) {
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: [appSpec.port],
      containerPorts: [appSpec.containerPort],
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: 3,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 2) {
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: appSpec.ports,
      containerPorts: appSpec.containerPorts,
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      domains: appSpec.domains,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: 3,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 3) {
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: appSpec.ports,
      containerPorts: appSpec.containerPorts,
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      domains: appSpec.domains,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: appSpec.instances,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 4) {
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 5) {
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: 22000,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 6) {
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: appSpec.expire,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 7) {
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: appSpec.expire,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [], // we don't fill the nodes as they were used for different thing.
      staticip: appSpec.staticip,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: component.repoauth,
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 8) {
    return appSpec;
  }
  throw new Error('Original application version not recognized');
}

/**
 * Find common architectures across all app components
 * @param {Array<{name: string, architectures: string[]}>} componentArchitectures - Array of component architecture info
 * @returns {string[]} Array of architecture strings common to all components
 */
function findCommonArchitectures(componentArchitectures) {
  if (componentArchitectures.length === 0) return [];
  if (componentArchitectures.length === 1) return componentArchitectures[0].architectures;

  return componentArchitectures[0].architectures.filter((arch) =>
    componentArchitectures.every((comp) => comp.architectures.includes(arch)),
  );
}

module.exports = {
  appPricePerMonth,
  nodeFullGeolocation,
  getAppFolderSize,
  getContainerStorage,
  getAppPorts,
  specificationFormatter,
  updateToLatestAppSpecifications,
  findCommonArchitectures,
};
