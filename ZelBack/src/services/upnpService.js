const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');

const log = require('../lib/log');

const client = new natUpnp.Client();

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
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

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

module.exports = {
  verifyUPNPsupport,
  setupUPNP,
  mapUpnpPort,
  removeMapUpnpPort,
};
