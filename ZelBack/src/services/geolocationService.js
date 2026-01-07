const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');

const geolocationCollection = 'geolocation';

let storedGeolocation = null;
let storedIp = null;
let staticIp = false;
let execution = 1;
const staticIpOrgs = ['hetzner', 'ovh', 'netcup', 'hostnodes', 'contabo', 'hostslim', 'zayo', 'cogent', 'lumen'];

/**
 * Stores geolocation data to the database
 * @param {object} geolocation - The geolocation data to store
 * @param {boolean} isStaticIp - Whether the node has a static IP
 */
async function storeGeolocationToDb(geolocation, isStaticIp) {
  try {
    const dbClient = dbHelper.databaseConnection();
    if (!dbClient) {
      log.warn('Database connection not available for storing geolocation');
      return;
    }
    const database = dbClient.db(config.database.local.database);
    const query = { _id: 'nodeGeolocation' };
    const update = {
      $set: {
        geolocation,
        staticIp: isStaticIp,
        updatedAt: Date.now(),
      },
    };
    const options = { upsert: true };
    await dbHelper.updateOneInDatabase(database, geolocationCollection, query, update, options);
    log.info('Geolocation data stored to database');
  } catch (error) {
    log.error(`Failed to store geolocation to database: ${error.message}`);
  }
}

/**
 * Retrieves geolocation data from the database
 * @returns {Promise<{geolocation: object|null, staticIp: boolean}>}
 */
async function getGeolocationFromDb() {
  try {
    const dbClient = dbHelper.databaseConnection();
    if (!dbClient) {
      return { geolocation: null, staticIp: false };
    }
    const database = dbClient.db(config.database.local.database);
    const query = { _id: 'nodeGeolocation' };
    const result = await dbHelper.findOneInDatabase(database, geolocationCollection, query);
    if (result && result.geolocation) {
      return { geolocation: result.geolocation, staticIp: result.staticIp || false };
    }
    return { geolocation: null, staticIp: false };
  } catch (error) {
    log.error(`Failed to retrieve geolocation from database: ${error.message}`);
    return { geolocation: null, staticIp: false };
  }
}

/**
 * Method responsable for setting node geolocation information
 */
async function setNodeGeolocation() {
  try {
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      log.error('Flux IP not detected. Flux geolocation service is awaiting');
      setTimeout(() => {
        setNodeGeolocation();
      }, 10 * 1000);
      return;
    }
    if (!storedGeolocation || myIP !== storedIp || execution % 4 === 0) {
      log.info(`Checking geolocation of ${myIP}`);
      storedIp = myIP;
      // consider another service failover or stats db
      const ipApiUrl = `http://ip-api.com/json/${myIP.split(':')[0]}?fields=status,continent,continentCode,country,countryCode,region,regionName,lat,lon,query,org,isp,proxy,hosting`;
      const ipRes = await serviceHelper.axiosGet(ipApiUrl);
      if (ipRes.data.status === 'success' && ipRes.data.query !== '') {
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
          org: ipRes.data.org || ipRes.data.isp,
          static: ipRes.data.proxy || ipRes.data.hosting,
        };
      } else {
        const statsApiUrl = `https://stats.runonflux.io/fluxlocation/${myIP.split(':')[0]}`;
        const statsRes = await serviceHelper.axiosGet(statsApiUrl);
        if (statsRes.data.status === 'success' && statsRes.data.data) {
          storedGeolocation = {
            ip: statsRes.data.data.ip,
            continent: statsRes.data.data.continent,
            continentCode: statsRes.data.data.continentCode,
            country: statsRes.data.data.country,
            countryCode: statsRes.data.data.countryCode,
            region: statsRes.data.data.region,
            regionName: statsRes.data.data.regionName,
            lat: statsRes.data.data.lat,
            lon: statsRes.data.data.lon,
            org: statsRes.data.data.org,
            static: statsRes.data.data.static,
          };
        } else {
          throw new Error(`Geolocation of IP ${myIP} is unavailable`);
        }
      }
    }
    log.info(`Geolocation of ${myIP} is ${JSON.stringify(storedGeolocation)}`);
    if (storedGeolocation.static) {
      staticIp = true;
    } else {
      for (let i = 0; i < staticIpOrgs.length; i += 1) {
        const org = staticIpOrgs[i];
        if (storedGeolocation.org.toLowerCase().includes(org)) {
          staticIp = true;
          break;
        }
      }
    }
    // Store geolocation to database for persistence across restarts
    await storeGeolocationToDb(storedGeolocation, staticIp);
    execution += 1;
    setTimeout(() => { // executes again in 24h
      setNodeGeolocation();
    }, 24 * 60 * 60 * 1000);
  } catch (error) {
    log.error(`Failed to get Geolocation with ${error}`);
    log.error(error);
    setTimeout(() => {
      setNodeGeolocation();
    }, 5 * 60 * 1000);
  }
}

/**
 * Method responsible for getting stored node geolocation information.
 * If not available in memory, attempts to retrieve from database.
 * @returns {Promise<object|null>} The geolocation object or null
 */
async function getNodeGeolocation() {
  if (storedGeolocation) {
    return storedGeolocation;
  }
  // Try to get from database if not in memory
  const dbData = await getGeolocationFromDb();
  if (dbData.geolocation) {
    storedGeolocation = dbData.geolocation;
    staticIp = dbData.staticIp;
    log.info('Geolocation restored from database');
  }
  return storedGeolocation;
}

/**
 * Method responsible for returning if node ip is static based on IP org.
 */
function isStaticIP() {
  return staticIp;
}

module.exports = {
  setNodeGeolocation,
  getNodeGeolocation,
  isStaticIP,
};
