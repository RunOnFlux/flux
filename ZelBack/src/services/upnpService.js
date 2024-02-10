const natUpnp = require('@megachips/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const nodecmd = require('node-cmd');
const util = require('util');

const log = require('../lib/log');

const client = new natUpnp.Client({ cacheGateway: true });

let upnpMachine = false;

/**
 * To quickly check if node has UPnP (Universal Plug and Play) support.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
function isUPNP() {
  return upnpMachine;
}

/**
 * To check if a firewall is active.
 * @returns {Promise<boolean>} True if a firewall is active. Otherwise false.
 */
async function isFirewallActive() {
  try {
    const cmdAsync = util.promisify(nodecmd.get);
    const execA = 'LANG="en_US.UTF-8" && sudo ufw status | grep Status';
    const cmdresA = await cmdAsync(execA);
    if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
      return true;
    }
    return false;
  } catch (error) {
    // command ufw not found is the most likely reason
    log.error(error);
    return false;
  }
}

/**
 * To allow inbound unicast SSDP M-SEARCH query response from as yet undiscovered
 * router. I.e. allow SSDP for any lan address. This gets removed and updated to router
 * Address once router found. Only applies to nodes using auto UPnP configuration.
 * @returns {Promise<boolean>} True if SSDP is allowed. Otherwise false.
 */
async function ufwAllowSsdpforInit() {
  if (!(await isFirewallActive())) return true;

  const cmdAsync = util.promisify(nodecmd.get);
  // allow from any address as we are looking for a router IP.
  const allowSsdpCmd = 'sudo ufw allow from any port 1900 to any proto udp > /dev/null 2>&1';
  try {
    await cmdAsync(allowSsdpCmd);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To remove allow inbound unicast SSDP M-SEARCH query response from LAN.
 * @returns {Promise<boolean>} True if SSDP removed / not exist. Otherwise false.
 */
async function ufwRemoveAllowSsdpforInit() {
  if (!(await isFirewallActive())) return true;

  const cmdAsync = util.promisify(nodecmd.get);
  // allow from any address as are looking for a router IP.
  const removeAllowSsdpCmd = 'sudo ufw delete allow from any port 1900 to any proto udp > /dev/null 2>&1';
  try {
    await cmdAsync(removeAllowSsdpCmd);
    return true;
  } catch (error) {
    // above rule returns 0 for non existent rule so this shouldn't fire unless actual error
    log.error(error);
    return false;
  }
}

/**
 *  * To adjust a firewall to allow comms between host and router.
 */
async function adjustFirewallForUPNP() {
  const { routerIp } = userconfig.computed;

  try {
    if (routerIp) {
      const cmdAsync = util.promisify(nodecmd.get);
      const firewallActive = await isFirewallActive();
      if (firewallActive) {
        // why allow outbound?!? There is a default allow
        const execA = 'sudo ufw allow out from any to 239.255.255.250 port 1900 proto udp > /dev/null 2>&1';
        // this is superfulous as there is an allow for allow udp below
        const execB = `sudo ufw allow from ${routerIp} port 1900 to any proto udp > /dev/null 2>&1`;
        const execC = `sudo ufw allow out from any to ${routerIp} proto tcp > /dev/null 2>&1`;
        const execD = `sudo ufw allow from ${routerIp} to any proto udp > /dev/null 2>&1`;
        // added this as we are now using multicast and need to be able to receive igmp queries
        const execE = 'sudo ufw allow to any proto igmp > /dev/null 2>&1';
        await cmdAsync(execA);
        await cmdAsync(execB);
        await cmdAsync(execC);
        await cmdAsync(execD);
        await cmdAsync(execE);
        log.info('Firewall adjusted for UPNP');
      } else {
        log.info(`Router IP: ${routerIp} set but firewall is not active. Adjustment not applied for UPNP`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To verify that a port has UPnP (Universal Plug and Play) support.
 * @returns {Promise<boolean>} True if port mappings can be set. Otherwise false.
 */
async function verifyUPNPsupport() {
  const { routerIp } = userconfig.computed;
  const { apiPort } = userconfig.computed;
  const testPort = apiPort + 3;

  try {
    if (routerIp) {
      await adjustFirewallForUPNP();
    }
    await client.getPublicIp();
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get public ip');
    upnpMachine = false;
    return false;
  }
  try {
    await client.getGateway();
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Gateway');
    upnpMachine = false;
    return false;
  }
  try {
    await client.createMapping({
      public: testPort,
      private: testPort,
      ttl: 0,
      description: 'Flux_UPNP_Mapping_Test',
    });
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed Create Mapping');
    upnpMachine = false;
    return false;
  }
  try {
    await client.getMappings();
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Mappings');
    upnpMachine = false;
    return false;
  }
  try {
    await client.removeMapping({
      public: testPort,
    });
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
 * @returns {Promise<boolean>} True if port mappings can be set. Otherwise false.
 */
async function setupUPNP() {
  try {
    await client.createMapping({
      public: userconfig.computed.homePort,
      private: userconfig.computed.homePort,
      ttl: 0,
      description: 'Flux_Home_UI',
    });
    await client.createMapping({
      public: userconfig.computed.apiPort,
      private: userconfig.computed.apiPort,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description: 'Flux_Backend_API',
    });
    await client.createMapping({
      public: userconfig.computed.apiPortSsl,
      private: userconfig.computed.apiPortSsl,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description: 'Flux_Backend_API_SSL',
    });
    await client.createMapping({
      public: userconfig.computed.syncthingPort,
      private: userconfig.computed.syncthingPort,
      ttl: 0,
      description: 'Flux_Syncthing',
    });
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
    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'UDP',
      description,
    });
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
    await client.removeMapping({
      public: port,
      protocol: 'UDP',
    });
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Removes any mappings on a node at startup
 * @param {string} ip
 * This nodes ip. Trying to remove a mapping for a host ip that doens't belong to this host, will error.
 */
async function cleanOldMappings(ip) {
  const mappings = await client.getMappings();

  // await in loop so we can bail early if we get an error
  // eslint-disable-next-line no-restricted-syntax
  for (const mapping of mappings) {
    if (mapping.private.host === ip) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await client.removeMapping(mapping.public.port, mapping.protocol);
      } catch (error) {
        log.error(error);
        return;
      }
    }
  }
}

/**
 * To map a specified port and show a message if successfully mapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function mapPortApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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
  cleanOldMappings,
  mapUpnpPort,
  removeMapUpnpPort,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getIpApi,
  getGatewayApi,
  adjustFirewallForUPNP,
  ufwAllowSsdpforInit,
  ufwRemoveAllowSsdpforInit,
};
