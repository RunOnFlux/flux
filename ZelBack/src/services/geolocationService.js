const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');

const { geolocation: geolocationCollection } = config.database.local.collections;

let storedGeolocation = null;
let storedIp = null;
let staticIp = false;
let dataCenter = false;
let lastIpChangeDate = null;
let execution = 1;
const staticIpOrgs = ['hetzner', 'ovh', 'netcup', 'hostnodes', 'contabo', 'hostslim', 'zayo', 'cogent', 'lumen'];
const staticIpStabilityDays = 10;

/**
 * Stores geolocation data to the database
 * @param {object} geolocation - The geolocation data to store
 * @param {boolean} isStaticIp - Whether the node has a static IP
 * @param {boolean} isDataCenter - Whether the node is in a data center
 * @param {number|null} ipChangeDate - Timestamp of when the IP last changed
 */
async function storeGeolocationToDb(geolocation, isStaticIp, isDataCenter, ipChangeDate) {
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
        dataCenter: isDataCenter,
        lastIpChangeDate: ipChangeDate,
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
 * @returns {Promise<{geolocation: object|null, staticIp: boolean, dataCenter: boolean, lastIpChangeDate: number|null}>}
 */
async function getGeolocationFromDb() {
  try {
    const dbClient = dbHelper.databaseConnection();
    if (!dbClient) {
      return { geolocation: null, staticIp: false, dataCenter: false, lastIpChangeDate: null };
    }
    const database = dbClient.db(config.database.local.database);
    const query = { _id: 'nodeGeolocation' };
    const result = await dbHelper.findOneInDatabase(database, geolocationCollection, query);
    if (result && result.geolocation) {
      return {
        geolocation: result.geolocation,
        staticIp: result.staticIp || false,
        dataCenter: result.dataCenter || false,
        lastIpChangeDate: result.lastIpChangeDate || null,
      };
    }
    return { geolocation: null, staticIp: false, dataCenter: false, lastIpChangeDate: null };
  } catch (error) {
    log.error(`Failed to retrieve geolocation from database: ${error.message}`);
    return { geolocation: null, staticIp: false, dataCenter: false, lastIpChangeDate: null };
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

    // Store previous IP to detect changes
    const previousIp = storedGeolocation ? storedGeolocation.ip : null;

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
          dataCenter: ipRes.data.hosting,
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
            dataCenter: statsRes.data.data.dataCenter,
          };
        } else {
          throw new Error(`Geolocation of IP ${myIP} is unavailable`);
        }
      }
    }
    log.info(`Geolocation of ${myIP} is ${JSON.stringify(storedGeolocation)}`);

    // Check if IP has changed
    const currentIp = storedGeolocation.ip;
    const ipChanged = previousIp && previousIp !== currentIp;

    if (ipChanged) {
      // IP changed - set static to false and record the change date
      staticIp = false;
      lastIpChangeDate = Date.now();
      log.info(`IP changed from ${previousIp} to ${currentIp}. Setting staticIp to false.`);
    } else {
      // IP has not changed - check static IP conditions
      const hasPublicIp = await fluxNetworkHelper.hasPublicIpOnInterface();
      const now = Date.now();
      const stabilityThreshold = staticIpStabilityDays * 24 * 60 * 60 * 1000;

      // If lastIpChangeDate is null (never recorded), consider IP as stable for more than 10 days
      const effectiveLastIpChangeDate = lastIpChangeDate || (now - stabilityThreshold - 1);
      const daysSinceChange = (now - effectiveLastIpChangeDate) / (24 * 60 * 60 * 1000);

      // Determine static IP status based on multiple signals
      if (hasPublicIp) {
        // Has public IP on interface - strong indicator of static IP
        if (now - effectiveLastIpChangeDate >= stabilityThreshold) {
          // IP stable for 10+ days with public IP on interface - definitely static
          staticIp = true;
          if (lastIpChangeDate) {
            log.info(`Node has public IP on interface and IP stable for ${daysSinceChange.toFixed(1)} days. Setting staticIp to true.`);
          } else {
            log.info('Node has public IP on interface and no IP change recorded. Assuming stable IP. Setting staticIp to true.');
          }
        } else {
          // Has public IP but hasn't been stable long enough yet
          // Check other signals (API and org-based)
          staticIp = false;
          if (storedGeolocation.static) {
            staticIp = true;
          } else if (storedGeolocation.org) {
            for (let i = 0; i < staticIpOrgs.length; i += 1) {
              const org = staticIpOrgs[i];
              if (storedGeolocation.org.toLowerCase().includes(org)) {
                staticIp = true;
                break;
              }
            }
          }
          log.info(`Node has public IP on interface, IP stable for ${daysSinceChange.toFixed(1)} days (need ${staticIpStabilityDays}). staticIp=${staticIp}`);
        }
      } else {
        // No public IP on interface - use API and org-based detection only
        staticIp = false;
        if (storedGeolocation.static) {
          staticIp = true;
        } else if (storedGeolocation.org) {
          for (let i = 0; i < staticIpOrgs.length; i += 1) {
            const org = staticIpOrgs[i];
            if (storedGeolocation.org.toLowerCase().includes(org)) {
              staticIp = true;
              break;
            }
          }
        }
      }
    }

    // Data center detection (unchanged logic)
    if (storedGeolocation.dataCenter) {
      dataCenter = true;
    } else {
      dataCenter = false;
      if (storedGeolocation.org) {
        for (let i = 0; i < staticIpOrgs.length; i += 1) {
          const org = staticIpOrgs[i];
          if (storedGeolocation.org.toLowerCase().includes(org)) {
            dataCenter = true;
            break;
          }
        }
      }
    }

    // Store geolocation to database for persistence across restarts
    await storeGeolocationToDb(storedGeolocation, staticIp, dataCenter, lastIpChangeDate);
    execution += 1;
    setTimeout(() => { // executes again in 3 days
      setNodeGeolocation();
    }, 3 * 24 * 60 * 60 * 1000);
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
    dataCenter = dbData.dataCenter;
    lastIpChangeDate = dbData.lastIpChangeDate;
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

/**
 * Method responsible for returning if node is in a data center based on IP org.
 */
function isDataCenter() {
  return dataCenter;
}

/**
 * Method responsible for returning the timestamp of when the IP last changed.
 * @returns {number|null} Timestamp of last IP change or null if not tracked yet
 */
function getLastIpChangeDate() {
  return lastIpChangeDate;
}

/**
 * Method responsible for checking if the node has a public IP on its network interface.
 * @returns {Promise<boolean>} True if a public IP is configured on an interface
 */
async function hasPublicIp() {
  return fluxNetworkHelper.hasPublicIpOnInterface();
}

module.exports = {
  setNodeGeolocation,
  getNodeGeolocation,
  isStaticIP,
  isDataCenter,
  getLastIpChangeDate,
  hasPublicIp,
};
