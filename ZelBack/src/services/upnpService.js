const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');

const log = require('../lib/log');

const client = new natUpnp.Client();

let upnpMachine = false;

/**
 * To quickly check if node has UPnP (Universal Plug and Play) support.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
function isUPNP() {
  return upnpMachine;
}

/**
 * To verify that a port has UPnP (Universal Plug and Play) support.
 * @param {number} apiport Port number.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
async function verifyUPNPsupport(apiport = config.apiport) {
  try {
    // run test on apiport + 1
    await client.getPublicIp();
    await client.getGateway();
    await client.createMapping({
      public: +apiport + 1,
      private: +apiport + 1,
      ttl: 0,
    });
    await client.removeMapping({
      public: +apiport + 1,
    });
    await client.getMappings();
    upnpMachine = true;
    return true;
  } catch (error) {
    log.error(error);
    upnpMachine = false;
    return false;
  }
}

/**
 * To set up UPnP (Universal Plug and Play) support.
 * @param {number} apiport Port number.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
async function setupUPNP(apiport = config.apiport) { // todo evaluate adding ssl port of + 1
  try {
    await client.createMapping({
      public: +apiport,
      private: +apiport,
      ttl: 0,
    });
    await client.createMapping({
      public: +apiport - 1,
      private: +apiport - 1,
      ttl: 0,
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
 * @returns {boolean} True if port mappings can be created for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function mapUpnpPort(port) {
  try {
    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'TCP',
    });
    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'UDP',
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
 * @returns {boolean} True if port mappings have been removed for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
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
 * To map a specified port and show a message if successfully mapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
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
      });
      await client.createMapping({
        public: port,
        private: port,
        ttl: 0,
        protocol: 'UDP',
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
 * @param {object} res Response.
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
 * @param {object} res Response.
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
 * @param {object} res Response.
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
 * @param {object} res Response.
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
  mapUpnpPort,
  removeMapUpnpPort,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getIpApi,
  getGatewayApi,
};
