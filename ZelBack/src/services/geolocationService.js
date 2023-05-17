const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const serviceHelper = require('./serviceHelper');

let storedGeolocation = null;
let storedIp = null;
let staticIp = false;
const staticIpOrgs = ['hetzner', 'ovh', 'netcup', 'hostnodes', 'contabo'];

/**
 * Method responsable for setting node geolocation information
 */
async function setNodeGeolocation() {
  try {
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      throw new Error('Flux IP not detected. Flux geolocation service is awaiting');
    }
    if (!storedGeolocation || myIP !== storedIp) {
      log.info(`Checking geolocation of ${myIP}`);
      storedIp = myIP;
      // consider another service failover or stats db
      const ipApiUrl = `http://ip-api.com/json/${myIP.split(':')[0]}?fields=status,continent,continentCode,country,countryCode,region,regionName,lat,lon,query,org`;
      const ipRes = await serviceHelper.axiosGet(ipApiUrl);
      if (ipRes.data.status !== 'success') {
        throw new Error(`Geolocation of IP ${myIP} is unavailable`);
      }
      storedGeolocation = {
        ip: ipRes.data.query,
        continent: ipRes.data.continent,
        continentCode: ipRes.data.continentCode,
        country: ipRes.data.country,
        countryCode: ipRes.data.countryCode,
        region: ipRes.data.region,
        regionName: ipRes.data.regionName,
        lat: ipRes.data.lat,
        lon: ipRes.data.lon,
        org: ipRes.data.org,
      };
    }
    log.info(`Geolocation of ${myIP} is ${JSON.stringify(storedGeolocation)}`);
    for (let i = 0; i < staticIpOrgs.length; i += 1) {
      const org = staticIpOrgs[i];
      if (storedGeolocation.org.toLowerCase().includes(org)) {
        staticIp = true;
        break;
      }
    }
    setTimeout(() => { // executes again in 12h
      setNodeGeolocation();
    }, 12 * 60 * 60 * 1000);
  } catch (error) {
    log.error(`Failed to get Geolocation with ${error}`);
    log.error(error);
    setTimeout(() => {
      setNodeGeolocation();
    }, 5 * 60 * 1000);
  }
}

/**
 * Method responsible for getting stored node geolocation information
 */
function getNodeGeolocation() {
  return storedGeolocation;
}

/**
 * Method responsible for returning if node ip is static based on IP org.
 */
function IsStaticIp() {
  return staticIp;
}

module.exports = {
  setNodeGeolocation,
  getNodeGeolocation,
  IsStaticIp,
};
