const config = require('config');
const serviceHelper = require('../serviceHelper');
const log = require('../../lib/log');

/**
 * Verify type correctness of app specification
 * @param {object} appSpecification - App specification to verify
 * @returns {boolean} True if types are correct
 */
function verifyTypeCorrectnessOfApp(appSpecification) {
  const {
    version,
    name,
    description,
    owner,
    port,
    containerPort,
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

  // commons
  if (!version || !name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter name and/or description and/or owner');
  }

  if (typeof version !== 'number') {
    throw new Error('Invalid Flux App version');
  }
  if (!serviceHelper.isDecimalLimit(version)) {
    throw new Error('Invalid Flux App version decimals');
  }

  if (typeof name !== 'string') {
    throw new Error('Invalid Flux App name');
  }

  if (typeof description !== 'string') {
    throw new Error('Invalid Flux App description');
  }

  if (typeof owner !== 'string') {
    throw new Error('Invalid Flux App owner');
  }

  if (version === 1) {
    if (!port || !containerPort) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort');
    }
  } else if (version >= 2 && version <= 3) {
    if (!ports || !domains || !containerPorts) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort and/or domains');
    }
  }

  if (version === 1) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (typeof port !== 'number') {
      throw new Error('Port for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(port, 0)) {
      throw new Error('Ports for Flux App are invalid decimals');
    }

    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Environmental parameters for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        if (typeof command !== 'string') {
          throw new Error('Flux App commands are invalid');
        }
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    if (typeof containerPort !== 'number') {
      throw new Error('Container Port for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(containerPort, 0)) {
      throw new Error('Container Ports for Flux App are invalid decimals');
    }
    if (typeof containerData !== 'string') {
      throw new Error('Container Data for Flux App is invalid');
    }
    if (typeof cpu !== 'number') {
      throw new Error('CPU for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(cpu, 1)) {
      throw new Error('CPU for Flux App is invalid decimals');
    }
    if (typeof ram !== 'number') {
      throw new Error('RAM for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(ram, 0)) {
      throw new Error('RAM for Flux App is invalid decimals');
    }
    if (typeof hdd !== 'number') {
      throw new Error('SSD for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(hdd, 0)) {
      throw new Error('SSD for Flux App is invalid decimals');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
  } else if (version >= 2 && version <= 3) {
    // Version 2-3 validations
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (Array.isArray(ports)) {
      ports.forEach((port) => {
        if (typeof port !== 'number') {
          throw new Error('Port for Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(port, 0)) {
          throw new Error('Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }

    // Additional validations for version 2-3
    if (Array.isArray(domains)) {
      domains.forEach((domain) => {
        if (typeof domain !== 'string') {
          throw new Error('Domain for Flux App is invalid');
        }
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
    }
  } else if (version >= 4) {
    // Version 4+ compose validations
    if (!compose || !Array.isArray(compose)) {
      throw new Error('Compose parameter missing or invalid for Flux App version 4+');
    }

    compose.forEach((component) => {
      if (!component.name || typeof component.name !== 'string') {
        throw new Error('Component name is invalid');
      }
      if (!component.repotag || typeof component.repotag !== 'string') {
        throw new Error('Component repotag is invalid');
      }
      if (typeof component.cpu !== 'number') {
        throw new Error('Component CPU is invalid');
      }
      if (typeof component.ram !== 'number') {
        throw new Error('Component RAM is invalid');
      }
      if (typeof component.hdd !== 'number') {
        throw new Error('Component HDD is invalid');
      }
    });
  }

  // Optional parameter validations
  if (instances && typeof instances !== 'number') {
    throw new Error('Instances parameter is invalid');
  }
  if (contacts && !Array.isArray(contacts)) {
    throw new Error('Contacts parameter is invalid');
  }
  if (geolocation && !Array.isArray(geolocation)) {
    throw new Error('Geolocation parameter is invalid');
  }
  if (expire && typeof expire !== 'number') {
    throw new Error('Expire parameter is invalid');
  }
  if (nodes && !Array.isArray(nodes)) {
    throw new Error('Nodes parameter is invalid');
  }
  if (staticip !== undefined && typeof staticip !== 'boolean') {
    throw new Error('Static IP parameter is invalid');
  }

  return true;
}

/**
 * Verify restriction correctness of app specifications
 * @param {object} appSpecifications - App specifications
 * @param {number} height - Block height
 * @returns {boolean} True if restrictions are valid
 */
function verifyRestrictionCorrectnessOfApp(appSpecifications, height) {
  const { version, name, description, owner } = appSpecifications;

  // Version restrictions
  if (version > config.fluxapps.maximumAppVersion) {
    throw new Error(`Flux App version ${version} is not supported. Highest supported version is ${config.fluxapps.maximumAppVersion}`);
  }
  if (version < 1) {
    throw new Error('Flux App version must be at least 1');
  }

  // String length restrictions
  if (name.length > 32) {
    throw new Error('Flux App name is too long');
  }
  if (name.length < 1) {
    throw new Error('Flux App name is too short');
  }
  if (description.length > 256) {
    throw new Error('Flux App description is too long');
  }
  if (description.length < 1) {
    throw new Error('Flux App description is too short');
  }

  // Name format restrictions
  if (!name.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error('Flux App name contains invalid characters. Only alphanumeric characters are allowed');
  }

  // Owner validation
  if (owner.length !== 34 && owner.length !== 35) {
    throw new Error('Invalid Flux App owner format');
  }

  // Additional version-specific restrictions
  if (version === 1) {
    // Version 1 specific restrictions
    if (appSpecifications.port < 1 || appSpecifications.port > 65535) {
      throw new Error('Port is out of valid range');
    }
    if (appSpecifications.containerPort < 1 || appSpecifications.containerPort > 65535) {
      throw new Error('Container port is out of valid range');
    }
  } else if (version >= 2 && version <= 3) {
    // Version 2-3 restrictions
    if (appSpecifications.ports) {
      appSpecifications.ports.forEach((port) => {
        if (port < 1 || port > 65535) {
          throw new Error('Port is out of valid range');
        }
      });
    }
  }

  // Resource restrictions
  if (appSpecifications.cpu !== undefined) {
    if (appSpecifications.cpu < 0.1) {
      throw new Error('CPU allocation too low');
    }
    if (appSpecifications.cpu > 32) {
      throw new Error('CPU allocation too high');
    }
  }

  if (appSpecifications.ram !== undefined) {
    if (appSpecifications.ram < 100) {
      throw new Error('RAM allocation too low');
    }
    if (appSpecifications.ram > 32000) {
      throw new Error('RAM allocation too high');
    }
  }

  if (appSpecifications.hdd !== undefined) {
    if (appSpecifications.hdd < 1) {
      throw new Error('HDD allocation too low');
    }
    if (appSpecifications.hdd > 1000) {
      throw new Error('HDD allocation too high');
    }
  }

  return true;
}

/**
 * Verify object keys correctness of app specification
 * @param {object} appSpecifications - App specifications
 * @returns {boolean} True if object keys are valid
 */
function verifyObjectKeysCorrectnessOfApp(appSpecifications) {
  const { version } = appSpecifications;

  // Define allowed keys for each version
  const allowedKeysV1 = [
    'version', 'name', 'description', 'owner', 'port', 'containerPort',
    'repotag', 'enviromentParameters', 'commands', 'containerData',
    'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'cpusuper', 'cpubamf',
    'rambasic', 'ramsuper', 'rambamf', 'hddbasic', 'hddsuper', 'hddbamf',
    'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip'
  ];

  const allowedKeysV2V3 = [
    'version', 'name', 'description', 'owner', 'ports', 'domains',
    'repotag', 'enviromentParameters', 'commands', 'containerPorts',
    'containerData', 'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'cpusuper',
    'cpubamf', 'rambasic', 'ramsuper', 'rambamf', 'hddbasic', 'hddsuper',
    'hddbamf', 'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip'
  ];

  const allowedKeysV4Plus = [
    'version', 'name', 'description', 'owner', 'compose', 'instances',
    'contacts', 'geolocation', 'expire', 'nodes', 'staticip', 'enterprise'
  ];

  const allowedComposeKeys = [
    'name', 'description', 'repotag', 'ports', 'domains', 'enviromentParameters',
    'commands', 'containerPorts', 'containerData', 'cpu', 'ram', 'hdd',
    'tiered', 'cpubasic', 'cpusuper', 'cpubamf', 'rambasic', 'ramsuper',
    'rambamf', 'hddbasic', 'hddsuper', 'hddbamf', 'secrets', 'repoauth'
  ];

  let allowedKeys;
  if (version === 1) {
    allowedKeys = allowedKeysV1;
  } else if (version >= 2 && version <= 3) {
    allowedKeys = allowedKeysV2V3;
  } else if (version >= 4) {
    allowedKeys = allowedKeysV4Plus;
  } else {
    throw new Error('Invalid application version');
  }

  // Check main object keys
  const appKeys = Object.keys(appSpecifications);
  appKeys.forEach((key) => {
    if (!allowedKeys.includes(key)) {
      throw new Error(`Invalid key '${key}' found in Flux App specification for version ${version}`);
    }
  });

  // Check compose component keys for version 4+
  if (version >= 4 && appSpecifications.compose) {
    appSpecifications.compose.forEach((component, index) => {
      const componentKeys = Object.keys(component);
      componentKeys.forEach((key) => {
        if (!allowedComposeKeys.includes(key)) {
          throw new Error(`Invalid key '${key}' found in compose component ${index} for Flux App specification version ${version}`);
        }
      });
    });
  }

  return true;
}

/**
 * Update app specifications to latest format
 * @param {object} appSpec - App specification to update
 * @returns {object} Updated app specification
 */
function updateToLatestAppSpecifications(appSpec) {
  // Create a copy to avoid modifying the original
  const updatedSpec = JSON.parse(JSON.stringify(appSpec));

  // Version 1 to 2 migration logic
  if (updatedSpec.version === 1) {
    // Convert single port to ports array
    if (updatedSpec.port) {
      updatedSpec.ports = [updatedSpec.port];
      delete updatedSpec.port;
    }

    // Convert containerPort to containerPorts array
    if (updatedSpec.containerPort) {
      updatedSpec.containerPorts = [updatedSpec.containerPort];
      delete updatedSpec.containerPort;
    }

    // Add empty domains array if not present
    if (!updatedSpec.domains) {
      updatedSpec.domains = [];
    }

    // Update version
    updatedSpec.version = 2;
  }

  // Add any missing optional fields with defaults
  if (!updatedSpec.instances) {
    updatedSpec.instances = 1;
  }
  if (!updatedSpec.contacts) {
    updatedSpec.contacts = [];
  }
  if (!updatedSpec.geolocation) {
    updatedSpec.geolocation = [];
  }

  return updatedSpec;
}

module.exports = {
  verifyTypeCorrectnessOfApp,
  verifyRestrictionCorrectnessOfApp,
  verifyObjectKeysCorrectnessOfApp,
  updateToLatestAppSpecifications,
};