const config = require('config');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const log = require('../../lib/log');
const generalService = require('../generalService');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const registryManager = require('../appDatabase/registryManager');
const messageVerifier = require('../appMessaging/messageVerifier');
const imageManager = require('../appSecurity/imageManager');
const advancedWorkflows = require('../appLifecycle/advancedWorkflows');
const { supportedArchitectures } = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appUtilities');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const portManager = require('../appNetwork/portManager');
const {
  outgoingPeers, incomingPeers,
} = require('../utils/establishedConnections');

const isArcane = Boolean(process.env.FLUXOS_PATH);

/**
 * Verify type correctness of application specification
 * @param {object} appSpecification - Application specification to validate
 * @returns {boolean} True if validation passes
 * @throws {Error} If validation fails
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
      throw new Error('Ports for Flux App are invalid decimals');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    if (typeof cpu !== 'number' || typeof hdd !== 'number' || typeof ram !== 'number') {
      throw new Error('Invalid HW specifications');
    }
    if (!serviceHelper.isDecimalLimit(cpu) || !serviceHelper.isDecimalLimit(hdd) || !serviceHelper.isDecimalLimit(ram)) {
      throw new Error('Invalid HW specifications decimal limits');
    }

    if (tiered) {
      const {
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
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
        || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
        || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else if (version <= 3) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Port of Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(parameter, 0)) {
          throw new Error('Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }
    if (Array.isArray(domains)) {
      domains.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Domains for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
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
    if (Array.isArray(containerPorts)) {
      containerPorts.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Container Port of Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(parameter, 0)) {
          throw new Error('Container Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Container Ports for Flux App are invalid');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    if (typeof cpu !== 'number' || typeof hdd !== 'number' || typeof ram !== 'number') {
      throw new Error('Invalid HW specifications');
    }
    if (!serviceHelper.isDecimalLimit(cpu) || !serviceHelper.isDecimalLimit(hdd) || !serviceHelper.isDecimalLimit(ram)) {
      throw new Error('Invalid HW specifications decimal limits');
    }

    if (tiered) {
      const {
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
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
        || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
        || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else if (version <= 7) { // v4 to v7
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    if (typeof compose !== 'object') {
      throw new Error('Invalid Flux App Specifications');
    }
    if (!Array.isArray(compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent.name !== 'string') {
        throw new Error('Invalid Flux App component name');
      }
      if (typeof appComponent.description !== 'string') {
        throw new Error(`Invalid Flux App component ${appComponent.name} description`);
      }
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.domains)) {
        appComponent.domains.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.environmentParameters)) {
        appComponent.environmentParameters.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.commands)) {
        appComponent.commands.forEach((command) => {
          if (typeof command !== 'string') {
            throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
          }
        });
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      if (Array.isArray(appComponent.containerPorts)) {
        appComponent.containerPorts.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (typeof appComponent.tiered !== 'boolean') {
        throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
      }
      const cpuB = appComponent.cpu;
      const ramB = appComponent.ram;
      const hddB = appComponent.hdd;
      if (typeof cpuB !== 'number' || typeof ramB !== 'number' || typeof hddB !== 'number') {
        throw new Error('Invalid HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpuB) || !serviceHelper.isDecimalLimit(ramB) || !serviceHelper.isDecimalLimit(hddB)) {
        throw new Error('Invalid HW specifications decimal limits');
      }
      if (appComponent.tiered) {
        const {
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
        if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
          || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
          || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
          throw new Error('Invalid tiered HW specifications');
        }
        if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
          || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
          || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
          throw new Error('Invalid tiered HW specifications');
        }
      }

      if (version === 7) {
        if (typeof appComponent.secrets !== 'string') {
          throw new Error(`Secrets for Flux App component ${appComponent.name} are invalid`);
        }

        if (typeof appComponent.repoauth !== 'string') {
          throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
        }
      }
    });
  } else { // v8+
    if (enterprise === null || enterprise === undefined) { // enterprise can be false or a encrypted string with a object with contacts and components
      throw new Error('Missing enterprise property');
    }
    if (!enterprise && nodes && nodes.length > 0) {
      throw new Error('Nodes can only be used in enterprise apps');
    }
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    if (typeof compose !== 'object') {
      throw new Error('Invalid Flux App Specifications');
    }
    if (!Array.isArray(compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent.name !== 'string') {
        throw new Error('Invalid Flux App component name');
      }
      if (typeof appComponent.description !== 'string') {
        throw new Error(`Invalid Flux App component ${appComponent.name} description`);
      }
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.domains)) {
        appComponent.domains.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.environmentParameters)) {
        appComponent.environmentParameters.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.commands)) {
        appComponent.commands.forEach((command) => {
          if (typeof command !== 'string') {
            throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
          }
        });
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      if (Array.isArray(appComponent.containerPorts)) {
        appComponent.containerPorts.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }

      const cpuB = appComponent.cpu;
      const ramB = appComponent.ram;
      const hddB = appComponent.hdd;
      if (typeof cpuB !== 'number' || typeof ramB !== 'number' || typeof hddB !== 'number') {
        throw new Error('Invalid HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpuB) || !serviceHelper.isDecimalLimit(ramB) || !serviceHelper.isDecimalLimit(hddB)) {
        throw new Error('Invalid HW specifications decimal limits');
      }

      if (typeof appComponent.repoauth !== 'string') {
        throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
      }
    });
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter instances');
    }
    if (typeof instances !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(instances) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (!serviceHelper.isDecimalLimit(instances, 0)) {
      throw new Error('Invalid instances specified');
    }
  }

  if (version >= 5) {
    if (Array.isArray(contacts)) {
      contacts.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Contacts for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Contacts for Flux App are invalid');
    }
    if (Array.isArray(geolocation)) {
      geolocation.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Geolocation for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Geolocation for Flux App are invalid');
    }
  }

  if (version >= 6) {
    if (!expire) {
      throw new Error('Missing Flux App specification parameter expire');
    }
    if (typeof expire !== 'number') {
      throw new Error('Invalid expire specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid expire specified');
    }
    if (!serviceHelper.isDecimalLimit(expire, 0)) {
      throw new Error('Invalid expire specified');
    }
  }

  if (version >= 7) {
    if (!nodes) {
      throw new Error('Missing Flux App specification parameter nodes');
    }
    if (Array.isArray(nodes)) {
      nodes.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Nodes for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Nodes for Flux App are invalid');
    }

    if (typeof staticip !== 'boolean') {
      throw new Error('Invalid static ip value obtained. Only boolean as true or false allowed.');
    }
  }

  return true;
}

/**
 * Verify restriction correctness of application specification
 * @param {object} appSpecifications - Application specifications
 * @param {number} height - Block height for validation context
 * @returns {void}
 * @throws {Error} If validation fails
 */
function verifyRestrictionCorrectnessOfApp(appSpecifications, height) {
  const minPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMin : config.fluxapps.portMinLegacy;
  const maxPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMax : config.fluxapps.portMaxLegacy;
  if (appSpecifications.version !== 1 && appSpecifications.version !== 2 && appSpecifications.version !== 3 && appSpecifications.version !== 4 && appSpecifications.version !== 5 && appSpecifications.version !== 6 && appSpecifications.version !== 7 && appSpecifications.version !== 8) {
    throw new Error('Flux App message version specification is invalid');
  }
  if (appSpecifications.name.length > 32) {
    throw new Error('Flux App name is too long');
  }
  // furthermore name cannot contain any special character
  if (!appSpecifications.name) {
    throw new Error('Please provide a valid Flux App name');
  }
  if (!appSpecifications.name.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error('Flux App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
  }
  if (appSpecifications.name.startsWith('zel')) {
    throw new Error('Flux App name can not start with zel');
  }
  if (appSpecifications.name.toLowerCase() === 'watchtower') {
    throw new Error('Flux App name is conflicting with another application');
  }
  if (appSpecifications.name.startsWith('flux')) {
    throw new Error('Flux App name can not start with flux');
  }
  if (appSpecifications.description.length > 256) {
    throw new Error('Description is too long. Maximum of 256 characters is allowed');
  }

  if (appSpecifications.version === 1) {
    // check port is within range
    if (appSpecifications.port < minPort || appSpecifications.port > maxPort) {
      throw new Error(`Assigned port ${appSpecifications.port} is not within Flux Apps range ${minPort}-${maxPort}`);
    }
    const iBP = require('../fluxNetworkHelper').isPortBanned(appSpecifications.port);
    if (iBP) {
      throw new Error(`Assigned port ${appSpecifications.port} is not allowed for Flux Apps`);
    }
    // check if containerPort makes sense
    if (appSpecifications.containerPort < 0 || appSpecifications.containerPort > 65535) {
      throw new Error(`Container Port ${appSpecifications.containerPort} is not within system limits 0-65535`);
    }
  } else if (appSpecifications.version <= 3) {
    // check port is within range
    appSpecifications.ports.forEach((port) => {
      if (port < minPort || port > maxPort) {
        throw new Error(`Assigned port ${port} is not within Flux Apps range ${minPort}-${maxPort}`);
      }
      const iBP = require('../fluxNetworkHelper').isPortBanned(port);
      if (iBP) {
        throw new Error(`Assigned port ${port} is not allowed for Flux Apps`);
      }
    });
    // check if containerPort makes sense
    appSpecifications.containerPorts.forEach((port) => {
      if (port < 0 || port > 65535) {
        throw new Error(`Container Port ${port} is not within system limits 0-65535`);
      }
    });
    if (appSpecifications.containerPorts.length !== appSpecifications.ports.length) {
      throw new Error('Ports specifications do not match');
    }
    if (appSpecifications.domains.length !== appSpecifications.ports.length) {
      throw new Error('Domains specifications do not match available ports');
    }
    if (appSpecifications.ports.length > 5) {
      throw new Error('Too many ports defined. Maximum of 5 allowed.');
    }
    appSpecifications.domains.forEach((dom) => {
      if (dom.length > 253) {
        throw new Error(`App ${appSpecifications.name} domain ${dom} is too long. Maximum of 253 characters is allowed`);
      }
    });
  }

  if (appSpecifications.version <= 3) {
    // check wheter shared Folder is not root
    if (appSpecifications.containerData.length < 2) {
      throw new Error('Flux App container data folder not specified. If no data folder is whished, use /tmp');
    }
    if (appSpecifications.containerData.length > 200) {
      throw new Error('Flux App Container Data is too long. Maximum of 200 characters is allowed');
    }
    if (appSpecifications.repotag.length > 200) {
      throw new Error('Flux App Repository is too long. Maximum of 200 characters is allowed.');
    }
    if (appSpecifications.enviromentParameters.length > 20) {
      throw new Error(`App ${appSpecifications.name} environment invalid. Maximum of 20 environment variables allowed.`);
    }
    appSpecifications.enviromentParameters.forEach((env) => {
      if (env.length > 400) {
        throw new Error(`App ${appSpecifications.name} environment ${env} is too long. Maximum of 400 characters is allowed`);
      }
    });
    if (appSpecifications.commands.length > 20) {
      throw new Error(`App ${appSpecifications.name} commands invalid. Maximum of 20 commands allowed.`);
    }
    appSpecifications.commands.forEach((com) => {
      if (com.length > 400) {
        throw new Error(`App ${appSpecifications.name} command ${com} is too long. Maximum of 400 characters is allowed`);
      }
    });
  } else {
    if (appSpecifications.compose.length < 1) {
      throw new Error('Flux App does not contain any composition');
    }
    let maxComponents = 10;
    if (height < config.fluxapps.appSpecsEnforcementHeights[6]) {
      maxComponents = 5;
    }
    if (appSpecifications.compose.length > maxComponents) {
      throw new Error('Flux App has too many components');
    }
    // check port is within range
    const usedNames = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecifications.compose) {
      if (!appComponent) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent !== 'object') {
        throw new Error('Invalid Flux App Specifications');
      }
      if (!appComponent.name) {
        throw new Error('Please provide a valid Flux App Component name');
      }
      if (appComponent.name.length > 32) {
        throw new Error('Flux App name is too long');
      }
      if (appComponent.name.startsWith('zel')) {
        throw new Error('Flux App Component name can not start with zel');
      }
      if (appComponent.name.startsWith('flux')) {
        throw new Error('Flux App Component name can not start with flux');
      }
      // furthermore name cannot contain any special character
      if (!appComponent.name.match(/^[a-zA-Z0-9]+$/)) {
        throw new Error('Flux App component name contains special characters. Only a-z, A-Z and 0-9 are allowed');
      }
      if (usedNames.includes(appComponent.name)) {
        throw new Error(`Flux App component ${appComponent.name} already assigned. Use different name.`);
      }
      usedNames.push(appComponent.name);
      if (appComponent.description.length > 256) {
        throw new Error('Description is too long. Maximum of 256 characters is allowed.');
      }
      appComponent.ports.forEach((port) => {
        if (port < minPort || port > maxPort) {
          throw new Error(`Assigned port ${port} is not within Flux Apps range ${minPort}-${maxPort}`);
        }
        const iBP = require('../fluxNetworkHelper').isPortBanned(port);
        if (iBP) {
          throw new Error(`Assigned port ${port} is not allowed for Flux Apps`);
        }
      });
      if (appComponent.repotag.length > 200) {
        throw new Error('Flux App Repository is too long. Maximum of 200 characters is allowed.');
      }
      if (appComponent.containerData.length > 200) {
        throw new Error('Flux App Container Data is too long. Maximum of 200 characters is allowed');
      }
      if (appComponent.environmentParameters.length > 20) {
        throw new Error(`App component ${appComponent.name} environment invalid. Maximum of 20 environment variables allowed.`);
      }
      appComponent.environmentParameters.forEach((env) => {
        if (env.length > 400) {
          throw new Error(`App component ${appComponent.name} environment ${env} is too long. Maximum of 400 characters is allowed`);
        }
      });
      if (appComponent.commands.length > 20) {
        throw new Error(`App component ${appComponent.name} commands invalid. Maximum of 20 commands allowed.`);
      }
      appComponent.commands.forEach((com) => {
        if (com.length > 400) {
          throw new Error(`App component ${appComponent.name} command ${com} is too long. Maximum of 400 characters is allowed`);
        }
      });
      appComponent.domains.forEach((dom) => {
        if (dom.length > 253) {
          throw new Error(`App component ${appComponent.name} domain ${dom} is too long. Maximum of 253 characters is allowed`);
        }
      });
      // check if containerPort makes sense
      appComponent.containerPorts.forEach((port) => {
        if (port < 0 || port > 65535) {
          throw new Error(`Container Port ${port} in in ${appComponent.name} is not within system limits 0-65535`);
        }
      });
      if (appComponent.containerPorts.length !== appComponent.ports.length) {
        throw new Error(`Ports specifications in ${appComponent.name} do not match`);
      }
      if (appComponent.domains.length !== appComponent.ports.length) {
        throw new Error(`Domains specifications in ${appComponent.name} do not match available ports`);
      }
      if (appComponent.ports.length > 5) {
        throw new Error(`Too many ports defined in ${appComponent.name}. Maximum of 5 allowed.`);
      }
      // check wheter shared Folder is not root
      if (appComponent.containerData.length < 2) {
        throw new Error(`Flux App container data folder not specified in in ${appComponent.name}. If no data folder is whished, use /tmp`);
      }

      if (appSpecifications.version === 7) {
        if (!appSpecifications.nodes.length) { // this is NOT an enterprise app, no nodes scoping
          if (appComponent.secrets.length) { // pgp encrypted message. Every signature encryption of node is about 100 characters. For 100 selected nodes, this gives ~5k chars limit
            throw new Error('Secrets can not be defined for non Enterprise Applications');
          }
          if (appComponent.repoauth.length) { // pgp encrypted message.
            throw new Error('Private repositories are only allowed for Enterprise Applications');
          }
        } else {
          if (appComponent.secrets.length > 15000) { // pgp encrypted message. Every signature encryption of node is about 100 characters. For 100 selected nodes, this gives ~5k chars limit
            throw new Error('Maximum length of secrets is 15000. Consider uploading to Flux Storage for bigger payload.');
          }
          if (appComponent.repoauth.length > 15000) { // pgp encrypted message.
            throw new Error('Maximum length of repoauth is 15000.');
          }
        }
      }
      if (appSpecifications.version >= 8) {
        if (!appSpecifications.enterpise) { // this is NOT an enterprise app
          if (appComponent.repoauth.length) { // pgp encrypted message.
            throw new Error('Private repositories are only allowed for Enterprise Applications');
          }
        } else if (appComponent.repoauth.length > 15000) { // pgp encrypted message.
          throw new Error('Maximum length of repoauth is 15000.');
        }
      }
    }
  }

  if (appSpecifications.version >= 3) {
    if (appSpecifications.instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (appSpecifications.instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
  }

  if (appSpecifications.version >= 5) {
    if (appSpecifications.contacts.length > 5) {
      throw new Error('Too many contacts defined. Maximum of 5 allowed.');
    }
    appSpecifications.contacts.forEach((contact) => {
      if (contact.length > 75) {
        throw new Error(`Contact ${contact} is too long. Maximum of 75 characters is allowed.`);
      }
    });
    if (appSpecifications.geolocation.length > 10) { // we only expect 2
      throw new Error('Invalid geolocation submited.'); // for now we are only accepting continent and country.
    }
    appSpecifications.geolocation.forEach((geo) => {
      const maxGeoLength = 50;
      if (geo.length > maxGeoLength) { // for now we only treat aXX and bXX as continent and country specs.
        throw new Error(`Geolocation ${geo} is not valid.`); // firt letter for what represents and next two for the code
      }
    });
  }

  if (appSpecifications.version >= 6) {
    if (height < config.fluxapps.newMinBlocksAllowanceBlock) {
      if (appSpecifications.expire < config.fluxapps.minBlocksAllowance) {
        throw new Error(`Minimum expiration of application is ${config.fluxapps.minBlocksAllowance} blocks ~ 1 week`);
      }
    } else if (height < config.fluxapps.cancel1BlockMinBlocksAllowanceBlock) {
      if (appSpecifications.expire < config.fluxapps.newMinBlocksAllowance) {
        throw new Error(`Minimum expiration of application is ${config.fluxapps.newMinBlocksAllowance} blocks ~ 3 hours`);
      }
    } else if (appSpecifications.expire < config.fluxapps.cancel1BlockMinBlocksAllowance) {
      throw new Error(`Minimum expiration of application is ${config.fluxapps.cancel1BlockMinBlocksAllowance} blocks`);
    }
    if (appSpecifications.expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    if (height < config.fluxapps.removeBlocksAllowanceIntervalBlock) {
      if (appSpecifications.expire % config.fluxapps.blocksAllowanceInterval !== 0) {
        throw new Error(`Expiration of application has to be a multiple of ${config.fluxapps.blocksAllowanceInterval} blocks ~ 1 day`);
      }
    }
  }

  if (appSpecifications.version >= 7) {
    if (appSpecifications.nodes.length > 120) {
      throw new Error('Maximum number of selecteed nodes is 120');
    }
    appSpecifications.nodes.forEach((node) => {
      if (node.length > 70) { // 64 for txhash, : separator, max 5 for outidx
        throw new Error('Invalid node length');
      }
    });
  }
}

/**
 * Verify object keys correctness of application specification
 * @param {object} appSpecifications - Application specifications
 * @returns {void}
 * @throws {Error} If validation fails
 */
function verifyObjectKeysCorrectnessOfApp(appSpecifications) {
  if (appSpecifications.version === 1) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'port', 'containerPort', 'enviromentParameters', 'commands', 'containerData',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        throw new Error('Unsupported parameter for v1 app specifications');
      }
    });
  } else if (appSpecifications.version === 2) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        throw new Error('Unsupported parameter for v2 app specifications');
      }
    });
  } else if (appSpecifications.version === 3) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains', 'instances',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        throw new Error('Unsupported parameter for v3 app specifications');
      }
    });
  } else if (appSpecifications.version === 4) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        log.error(`Unsupported top-level parameter detected in v4 app specifications: ${sKey}`);
        log.error(`Allowed top-level parameters: ${specifications.join(', ')}`);
        log.error(`Received top-level parameters: ${specsKeys.join(', ')}`);
        log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
        throw new Error(`Unsupported parameter for v4 app specifications: ${sKey}`);
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes(sKey)) {
          log.error(`Unsupported component parameter detected in v4 app specifications: ${sKey}`);
          log.error(`Component index: ${appSpecifications.compose.indexOf(appComponent)}`);
          log.error(`Component name: ${appComponent.name || 'unnamed'}`);
          log.error(`Allowed component parameters: ${componentSpecifications.join(', ')}`);
          log.error(`Received component parameters: ${specsKeysComponent.join(', ')}`);
          log.error(`Full component specification: ${JSON.stringify(appComponent, null, 2)}`);
          log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
          throw new Error(`Unsupported parameter for v4 app specifications in component: ${sKey}`);
        }
      });
    });
  } else if (appSpecifications.version === 5) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        log.error(`Unsupported top-level parameter detected in v5 app specifications: ${sKey}`);
        log.error(`Allowed top-level parameters: ${specifications.join(', ')}`);
        log.error(`Received top-level parameters: ${specsKeys.join(', ')}`);
        log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
        throw new Error(`Unsupported parameter for v5 app specifications: ${sKey}`);
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes(sKey)) {
          log.error(`Unsupported component parameter detected in v5 app specifications: ${sKey}`);
          log.error(`Component index: ${appSpecifications.compose.indexOf(appComponent)}`);
          log.error(`Component name: ${appComponent.name || 'unnamed'}`);
          log.error(`Allowed component parameters: ${componentSpecifications.join(', ')}`);
          log.error(`Received component parameters: ${specsKeysComponent.join(', ')}`);
          log.error(`Full component specification: ${JSON.stringify(appComponent, null, 2)}`);
          log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
          throw new Error(`Unsupported parameter for v5 app specifications in component: ${sKey}`);
        }
      });
    });
  } else if (appSpecifications.version === 6) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        log.error(`Unsupported top-level parameter detected in v6 app specifications: ${sKey}`);
        log.error(`Allowed top-level parameters: ${specifications.join(', ')}`);
        log.error(`Received top-level parameters: ${specsKeys.join(', ')}`);
        log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
        throw new Error(`Unsupported parameter for v6 app specifications: ${sKey}`);
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes(sKey)) {
          log.error(`Unsupported component parameter detected in v6 app specifications: ${sKey}`);
          log.error(`Component index: ${appSpecifications.compose.indexOf(appComponent)}`);
          log.error(`Component name: ${appComponent.name || 'unnamed'}`);
          log.error(`Allowed component parameters: ${componentSpecifications.join(', ')}`);
          log.error(`Received component parameters: ${specsKeysComponent.join(', ')}`);
          log.error(`Full component specification: ${JSON.stringify(appComponent, null, 2)}`);
          log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
          throw new Error(`Unsupported parameter for v6 app specifications in component: ${sKey}`);
        }
      });
    });
  } else if (appSpecifications.version === 7) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'secrets', 'repoauth',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        log.error(`Unsupported top-level parameter detected in v6 app specifications: ${sKey}`);
        log.error(`Allowed top-level parameters: ${specifications.join(', ')}`);
        log.error(`Received top-level parameters: ${specsKeys.join(', ')}`);
        log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
        throw new Error('Unsupported parameter for v7 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes(sKey)) {
          log.error(`Unsupported component parameter detected in v6 app specifications: ${sKey}`);
          log.error(`Component index: ${appSpecifications.compose.indexOf(appComponent)}`);
          log.error(`Component name: ${appComponent.name || 'unnamed'}`);
          log.error(`Allowed component parameters: ${componentSpecifications.join(', ')}`);
          log.error(`Received component parameters: ${specsKeysComponent.join(', ')}`);
          log.error(`Full component specification: ${JSON.stringify(appComponent, null, 2)}`);
          log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
          throw new Error('Unsupported parameter for v7 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 8) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts',
      'geolocation', 'expire', 'nodes', 'staticip', 'enterprise',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'repoauth',
      'cpu', 'ram', 'hdd',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes(sKey)) {
        log.error(`Unsupported top-level parameter detected in v8 app specifications: ${sKey}`);
        log.error(`Allowed top-level parameters: ${specifications.join(', ')}`);
        log.error(`Received top-level parameters: ${specsKeys.join(', ')}`);
        log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
        throw new Error(`Unsupported parameter for v8 app specifications: ${sKey}`);
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes(sKey)) {
          log.error(`Unsupported component parameter detected in v8 app specifications: ${sKey}`);
          log.error(`Component index: ${appSpecifications.compose.indexOf(appComponent)}`);
          log.error(`Component name: ${appComponent.name || 'unnamed'}`);
          log.error(`Allowed component parameters: ${componentSpecifications.join(', ')}`);
          log.error(`Received component parameters: ${specsKeysComponent.join(', ')}`);
          log.error(`Full component specification: ${JSON.stringify(appComponent, null, 2)}`);
          log.error(`Full app specifications: ${JSON.stringify(appSpecifications, null, 2)}`);
          throw new Error(`Unsupported parameter for v8 app specifications in component: ${sKey}`);
        }
      });
    });
  } else {
    throw new Error(`Invalid version specification of ${appSpecifications.version}`);
  }
}

/**
 * Check hardware parameters for application
 * @param {object} appSpecs - Application specifications
 * @returns {boolean} True if validation passes
 * @throws {Error} If validation fails
 */
function checkHWParameters(appSpecs) {
  // check specs parameters. JS precision
  if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
    throw new Error(`CPU badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.ram < 100) {
    throw new Error(`RAM badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
    throw new Error(`SSD badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.tiered) {
    if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
      throw new Error(`CPU for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
      throw new Error(`RAM for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
      throw new Error(`SSD for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
      throw new Error(`CPU for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
      throw new Error(`RAM for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
      throw new Error(`SSD for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
      throw new Error(`CPU for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
      throw new Error(`RAM for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
      throw new Error(`SSD for Stratus badly assigned for ${appSpecs.name}`);
    }
  }
  return true;
}

/**
 * Check compose hardware parameters for multi-component applications
 * @param {object} appSpecsComposed - Composed application specifications
 * @returns {boolean} True if validation passes
 * @throws {Error} If validation fails
 */
function checkComposeHWParameters(appSpecsComposed) {
  // calculate total HW assigned
  let totalCpu = 0;
  let totalRam = 0;
  let totalHdd = 0;
  let totalCpuBasic = 0;
  let totalCpuSuper = 0;
  let totalCpuBamf = 0;
  let totalRamBasic = 0;
  let totalRamSuper = 0;
  let totalRamBamf = 0;
  let totalHddBasic = 0;
  let totalHddSuper = 0;
  let totalHddBamf = 0;
  const isTiered = appSpecsComposed.compose.find((appComponent) => appComponent.tiered === true);
  appSpecsComposed.compose.forEach((appComponent) => {
    if (isTiered) {
      totalCpuBamf += ((appComponent.cpubamf || appComponent.cpu) * 10);
      totalRamBamf += appComponent.rambamf || appComponent.ram;
      totalHddBamf += appComponent.hddbamf || appComponent.hdd;
      totalCpuSuper += ((appComponent.cpusuper || appComponent.cpu) * 10);
      totalRamSuper += appComponent.ramsuper || appComponent.ram;
      totalHddSuper += appComponent.hddsuper || appComponent.hdd;
      totalCpuBasic += ((appComponent.cpubasic || appComponent.cpu) * 10);
      totalRamBasic += appComponent.rambasic || appComponent.ram;
      totalHddBasic += appComponent.hddbasic || appComponent.hdd;
    } else {
      totalCpu += (appComponent.cpu * 10);
      totalRam += appComponent.ram;
      totalHdd += appComponent.hdd;
    }
  });
  // check specs parameters. JS precision
  if (totalCpu > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
    throw new Error(`Too much CPU resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalRam > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
    throw new Error(`Too much RAM resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalHdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
    throw new Error(`Too much SSD resources assigned for ${appSpecsComposed.name}`);
  }
  if (isTiered) {
    if (totalCpuBasic > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuSuper > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamSuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddSuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuBamf > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
  }
  return true;
}

/**
 * Main validation function for application specifications
 * @param {object} appSpecifications - Application specifications to validate
 * @param {number} height - Block height for validation context
 * @param {boolean} checkDockerAndWhitelist - Whether to check Docker and whitelist requirements
 * @returns {Promise<boolean>} True if validation passes
 * @throws {Error} If validation fails
 */
async function verifyAppSpecifications(appSpecifications, height, checkDockerAndWhitelist = false) {
  if (!appSpecifications) {
    throw new Error('Invalid Flux App Specifications');
  }
  if (typeof appSpecifications !== 'object') {
    throw new Error('Invalid Flux App Specifications');
  }
  if (Array.isArray(appSpecifications)) {
    throw new Error('Invalid Flux App Specifications');
  }

  // TYPE CHECKS
  verifyTypeCorrectnessOfApp(appSpecifications);

  // RESTRICTION CHECKS
  verifyRestrictionCorrectnessOfApp(appSpecifications, height);

  // SPECS VALIDIT TIME
  if (height < config.fluxapps.appSpecsEnforcementHeights[appSpecifications.version]) {
    throw new Error(`Flux apps specifications of version ${appSpecifications.version} not yet supported`);
  }

  // OBJECT KEY CHECKS
  verifyObjectKeysCorrectnessOfApp(appSpecifications);

  // PORTS UNIQUE CHECKS
  // verify ports are unique accross app
  portManager.ensureAppUniquePorts(appSpecifications);

  // HW Checks
  if (appSpecifications.version <= 3) {
    checkHWParameters(appSpecifications);
  } else {
    checkComposeHWParameters(appSpecifications);
  }

  // Whitelist, repository checks
  if (checkDockerAndWhitelist) {
    // check blacklist
    await imageManager.checkApplicationImagesComplience(appSpecifications);

    if (appSpecifications.version <= 3) {
      // check repository whitelisted and repotag is available for download
      await imageManager.verifyRepository(appSpecifications.repotag, { repoauth: appSpecifications.repoauth, skipVerification: true });
    } else {
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponent of appSpecifications.compose) {
        // check repository whitelisted and repotag is available for download
        // eslint-disable-next-line no-await-in-loop
        await imageManager.verifyRepository(appComponent.repotag, { repoauth: appComponent.repoauth, skipVerification: true });
      }
    }
  }

  return true;
}

/**
 * Verify app registration parameters via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Validation result
 */
async function verifyAppRegistrationParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const appSpecification = serviceHelper.ensureObject(body);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      // Decrypt enterprise specifications if needed
      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await imageManager.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
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
  });
}

/**
 * Verify app update parameters via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Validation result
 */
async function verifyAppUpdateParameters(req, res) {
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

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const decryptedSpecs = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(decryptedSpecs);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await imageManager.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      const timestamp = Date.now();
      await advancedWorkflows.checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
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
  });
}

/**
 * Register application globally via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Registration result
 */
async function registerAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }

      // first check if this node is available for application registration
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application registration');
      }

      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future

      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, type, version, timestamp and signature are provided.');
      }

      if (messageType !== 'zelappregister' && messageType !== 'fluxappregister') {
        throw new Error('Invalid type of message');
      }

      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }

      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }

      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await imageManager.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted);

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? specificationFormatter(appSpecification)
        : appSpecFormatted;

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await messageVerifier.verifyAppMessageSignature(messageType, typeVersion, toVerify, timestamp, signature);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await messageVerifier.requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      // request app message is quite slow and from performance testing message will appear roughly 5 seconds after ask
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH); // Cumulus measurement: after roughly 8 seconds here
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed. Cumulus measurement: Approx 5-6 seconds
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to register application on the network. Try again later.');

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

module.exports = {
  verifyTypeCorrectnessOfApp,
  verifyRestrictionCorrectnessOfApp,
  verifyObjectKeysCorrectnessOfApp,
  checkHWParameters,
  checkComposeHWParameters,
  verifyAppSpecifications,
  verifyAppRegistrationParameters,
  verifyAppUpdateParameters,
  registerAppGlobalyApi,
};
