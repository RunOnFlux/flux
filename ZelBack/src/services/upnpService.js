const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies

const log = require('../lib/log');
const ufw = require('./utils/ufw');
const { Privilege, authOf } = require('./utils/privileges');

const client = new natUpnp.Client();

if (config.upnp.gatewayUrl) {
  // eslint-disable-next-line global-require
  const { Device } = require('@runonflux/nat-upnp/build/src/nat-upnp/device');
  const { gatewayUrl } = config.upnp;
  const nodeIp = config.upnp.nodeIp || '127.0.0.1';
  client.getGateway = async () => ({
    gateway: new Device(gatewayUrl),
    address: nodeIp,
  });
}

let upnpMachine = false;

/**
 * To quickly check if node has UPnP (Universal Plug and Play) support.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
function isUPNP() {
  return upnpMachine;
}

/**
 * To adjust a firewall to allow comms between host and router.
 */
async function adjustFirewallForUPNP() {
  try {
    let { routerIP } = userconfig.initial;
    routerIP = serviceHelper.ensureString(routerIP);
    if (routerIP) {
      const firewallActive = await ufw.isFirewallActive();
      if (firewallActive) {
        // standard rules for upnp, then one pair per home node ws port
        const rules = [
          ['prepend', 'allow', 'from', routerIP, 'port', '1900', 'to', 'any', 'proto', 'udp'],
          ['prepend', 'allow', 'from', routerIP, 'to', 'any', 'proto', 'udp'],
          ...config.server.allowedPorts.flatMap((port) => [
            ['prepend', 'allow', 'in', 'proto', 'tcp', 'from', 'any', 'to', routerIP, 'port', String(port)],
            ['prepend', 'allow', 'in', 'proto', 'udp', 'from', 'any', 'to', routerIP, 'port', String(port)],
          ]),
        ];
        // eslint-disable-next-line no-restricted-syntax
        for (const rule of rules) {
          // eslint-disable-next-line no-await-in-loop
          const { locked } = await ufw.runUfw(rule);
          if (locked) {
            log.error('Firewall not adjusted for UPNP: ufw is locked by another ufw command');
            return;
          }
        }
        log.info('Firewall adjusted for UPNP');
      } else {
        log.info('RouterIP is set but firewall is not active. Adjusting not applied for UPNP');
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To verify that a port has UPnP (Universal Plug and Play) support.
 * @param {number} apiport Port number.
 * @returns {Promise<boolean>} True if port mappings can be set. Otherwise false.
 */
async function verifyUPNPsupport(apiport = config.server.apiport) {
  try {
    if (userconfig.initial.routerIP) {
      await adjustFirewallForUPNP();
    }
    // run test on apiport + 1
    await client.getPublicIp();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get public ip');
    upnpMachine = false;
    return false;
  }
  try {
    await client.getGateway();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Gateway');
    upnpMachine = false;
    return false;
  }
  try {
    await client.createMapping({
      public: +apiport + 3,
      private: +apiport + 3,
      ttl: 0,
      description: 'Flux_UPNP_Mapping_Test',
    });

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed Create Mapping');
    upnpMachine = false;
    return false;
  }
  try {
    await client.getMappings();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Mappings');
    upnpMachine = false;
    return false;
  }
  try {
    await client.removeMapping({
      public: +apiport + 3,
    });

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed Remove Mapping');
    upnpMachine = false;
    return false;
  }

  upnpMachine = true;
  return true;
}

/**
 * To set up UPnP (Universal Plug and Play) support.
 * @param {number} apiport Port number.
 * @returns {Promise<boolean>} True if port mappings can be set. Otherwise false.
 */
async function setupUPNP(apiport = config.server.apiport) {
  try {
    await client.createMapping({
      public: +apiport,
      private: +apiport,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description: 'Flux_Backend_API',
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: +apiport + 1,
      private: +apiport + 1,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description: 'Flux_Backend_API_SSL',
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: +apiport - 1,
      private: +apiport - 1,
      ttl: 0,
      description: 'Flux_Home_UI',
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: +apiport + 2,
      private: +apiport + 2,
      ttl: 0,
      description: 'Flux_Syncthing',
    });

    await serviceHelper.delay(500);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To create mappings for UPnP (Universal Plug and Play) port.
 * @param {number} port Port number.
 * @param {string} description Port description.
 * @returns {Promise<boolean>} True if port mappings can be created for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function mapUpnpPort(port, description) {
  try {
    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'TCP',
      description,
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'UDP',
      description,
    });

    await serviceHelper.delay(500);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To remove TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) port mappings from UPnP (Universal Plug and Play) port.
 * @param {number} port Port number.
 * @returns {Promise<boolean>} True if port mappings have been removed for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function removeMapUpnpPort(port) {
  try {
    await client.removeMapping({
      public: port,
      protocol: 'TCP',
    });

    await serviceHelper.delay(500);

    await client.removeMapping({
      public: port,
      protocol: 'UDP',
    });

    await serviceHelper.delay(500);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To map a specified port and show a message if successfully mapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function mapPortApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized) {
      let { port } = req.params;
      port = port || req.query.port;
      if (port === undefined || port === null) {
        throw new Error('No Port address specified.');
      }
      port = serviceHelper.ensureNumber(port);
      await client.createMapping({
        public: port,
        private: port,
        ttl: 0,
        protocol: 'TCP',
        description: 'Flux_manual_entry',
      });

      await client.createMapping({
        public: port,
        private: port,
        ttl: 0,
        protocol: 'UDP',
        description: 'Flux_manual_entry',
      });
      const message = messageHelper.createSuccessMessage('Port mapped');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To unmap a specified port and show a message if successfully unmapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function removeMapPortApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized) {
      let { port } = req.params;
      port = port || req.query.port;
      if (port === undefined || port === null) {
        throw new Error('No Port address specified.');
      }
      port = serviceHelper.ensureNumber(port);
      await client.removeMapping({
        public: port,
        protocol: 'TCP',
      });
      await client.removeMapping({
        public: port,
        protocol: 'UDP',
      });
      const message = messageHelper.createSuccessMessage('Port unmapped');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To show a message with mappings. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function getMapApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized) {
      const map = await client.getMappings();
      const message = messageHelper.createDataMessage(map);
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To show a message with IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function getIpApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized) {
      const ip = await client.getPublicIp();
      const message = messageHelper.createDataMessage(ip);
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To show a message with gateway address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function getGatewayApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized) {
      const gateway = await client.getGateway();
      const message = messageHelper.createDataMessage(gateway);
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

module.exports = {
  isUPNP,
  verifyUPNPsupport,
  setupUPNP,
  mapUpnpPort,
  removeMapUpnpPort,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getIpApi,
  getGatewayApi,
  adjustFirewallForUPNP,
};
