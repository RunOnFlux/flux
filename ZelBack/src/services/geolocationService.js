const config = require('config');
const dns = require('node:dns').promises;
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const { extractIp } = require('./utils/socketAddressUtils');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const networkClassifier = require('./utils/networkClassifier');

const { geolocation: geolocationCollection } = config.database.local.collections;

let storedGeolocation = null;
let storedIp = null;
let staticIp = false;
let dataCenter = false;
let lastIpChangeDate = null;
let execution = 1;
// Null means no verdict has been reached yet, which readers must distinguish
// from a verdict of UNKNOWN: "not computed" against "computed, and the evidence
// does not decide".
let networkClassification = null;

/**
 * Whether this address stays put. Three-state, because "we have not observed it
 * long enough" is a different answer from "it moves", and only one of them
 * should keep a node away from apps that need a stable address.
 */
const STATIC_IP_STATE = Object.freeze({
  STATIC: 'STATIC',
  DYNAMIC: 'DYNAMIC',
  UNKNOWN: 'UNKNOWN',
});
let staticIpState = STATIC_IP_STATE.UNKNOWN;
// The stability window is measured from here, not from lastIpChangeDate, which
// stays null until a change is actually seen.
let ipFirstSeenAt = null;
const staticIpStabilityDays = 10;

/**
 * Stores geolocation data to the database
 * @param {object} geolocation - The geolocation data to store
 * @param {boolean} isStaticIp - Whether the node has a static IP
 * @param {boolean} isDataCenter - Whether the node is in a data center
 * @param {number|null} ipChangeDate - Timestamp of when the IP last changed
 */
async function storeGeolocationToDb(geolocation, isStaticIp, isDataCenter, ipChangeDate, observations = {}) {
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
        // The window is an observation, so it outlives the process: a restart
        // that reset it would hold every node at UNKNOWN for another ten days.
        ipFirstSeenAt: observations.ipFirstSeenAt ?? null,
        staticIpState: observations.staticIpState ?? null,
        networkClassification: observations.networkClassification ?? null,
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
        ipFirstSeenAt: result.ipFirstSeenAt || null,
        // `?? null`: a document written before these fields existed carries no
        // observation, and saying so lets the next pass start the window.
        staticIpState: result.staticIpState ?? null,
        networkClassification: result.networkClassification ?? null,
      };
    }
    return {
      geolocation: null,
      staticIp: false,
      dataCenter: false,
      lastIpChangeDate: null,
      ipFirstSeenAt: null,
      staticIpState: null,
      networkClassification: null,
    };
  } catch (error) {
    log.error(`Failed to retrieve geolocation from database: ${error.message}`);
    return {
      geolocation: null,
      staticIp: false,
      dataCenter: false,
      lastIpChangeDate: null,
      ipFirstSeenAt: null,
      staticIpState: null,
      networkClassification: null,
    };
  }
}

/**
 * Reverse DNS for this node's own address - the strongest signal about the
 * network that does not come from a vendor.
 * @param {string} ip The node's public address.
 * @returns {Promise<string|null>} The first PTR name, or null when there is none.
 */
async function resolvePtr(ip) {
  try {
    const names = await dns.reverse(ip);
    return (names && names.length) ? names[0] : null;
  } catch (error) {
    // No PTR is ordinary - roughly a quarter of fleet hosts have none. It costs
    // one signal, and the classifier decides on what remains.
    return null;
  }
}

/**
 * The published verdict for an address, from the location table.
 *
 * This is the authority. The table is built in the policy repo from evidence a
 * node cannot gather for itself - chiefly the registries' own record of what a
 * block was assigned for, which six thousand nodes cannot each go and fetch -
 * and it is reviewed there with its reasons rather than derived here.
 * @param {string} ip The node's public address.
 * @returns {Promise<string|null>} The verdict, or null when the table has none
 *   for this address: no table yet, no covering row, or an organisation the
 *   policy repo deliberately left unclassified.
 */
async function publishedClassification(ip) {
  try {
    // Lazily required, like the benchmark service below: the location store
    // pulls in the database layer, and geolocation is read on paths that must
    // not depend on it being up.
    // eslint-disable-next-line global-require
    const ipLocationStore = require('./appPlacement/ipLocationStore');
    const hit = await ipLocationStore.lookup(ip);
    return hit?.networkClass ?? null;
  } catch (error) {
    // The table being unreadable is not evidence about the address.
    log.info(`Location table could not answer for ${ip}: ${error.message}`);
    return null;
  }
}

/**
 * Bench upload/download, for the link-asymmetry signal. Required lazily to keep
 * geolocation off the benchmark service's load path.
 * @returns {Promise<{uploadSpeed: number, downloadSpeed: number}>} Zeroes when
 * bench cannot be read, which the classifier reads as no signal rather than as a
 * symmetric link.
 */
async function benchLinkSpeeds() {
  try {
    // eslint-disable-next-line global-require
    const benchmarkService = require('./benchmarkService');
    const response = await benchmarkService.getBenchmarks();
    if (!response || response.status !== 'success' || !response.data) {
      return { uploadSpeed: 0, downloadSpeed: 0 };
    }
    return {
      uploadSpeed: response.data.upload_speed || 0,
      downloadSpeed: response.data.download_speed || 0,
    };
  } catch (error) {
    return { uploadSpeed: 0, downloadSpeed: 0 };
  }
}

/**
 * Method responsable for setting node geolocation information
 */
async function setNodeGeolocation() {
  try {
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
      log.error('Flux IP not detected. Flux geolocation service is awaiting');
      setTimeout(() => {
        setNodeGeolocation();
      }, 10 * 1000);
      return;
    }

    const localIp = extractIp(localSocketAddr);

    // Store previous IP to detect changes
    const previousIp = storedGeolocation ? storedGeolocation.ip : null;

    if (!storedGeolocation || localSocketAddr !== storedIp || execution % 4 === 0) {
      log.info(`Checking geolocation of ${localIp}`);
      storedIp = localSocketAddr;
      // consider another service failover or stats db
      // `as` names the operator's own autonomous system, which does not vary
      // with who registered a /29: across the fleet 227 ASNs separate hosting
      // from access networks with only 8 carrying both, against 87 distinct
      // `org` strings for the 329 nodes this decides about.
      const ipApiUrl = `${config.geolocation.ipApiBaseUrl}/json/${localIp}?fields=status,continent,continentCode,country,countryCode,region,regionName,lat,lon,query,org,isp,as,proxy,hosting,mobile`;
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
          isp: ipRes.data.isp,
          asn: ipRes.data.as,
          mobile: ipRes.data.mobile,
          proxy: ipRes.data.proxy,
          hosting: ipRes.data.hosting,
          static: ipRes.data.proxy || ipRes.data.hosting,
          dataCenter: ipRes.data.hosting,
        };
      } else {
        const statsApiUrl = `${config.stats.baseUrl}/fluxlocation/${localIp}`;
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
          throw new Error(`Geolocation of IP ${localIp} is unavailable`);
        }
      }
    }
    log.info(`Geolocation of ${localIp} is ${JSON.stringify(storedGeolocation)}`);

    // Static IP is observed, never inferred from the operator: the address must
    // be bound to a local interface and have been held for the stability window.
    const currentIp = storedGeolocation.ip;
    const ipChanged = previousIp && previousIp !== currentIp;
    const now = Date.now();
    const stabilityThreshold = staticIpStabilityDays * 24 * 60 * 60 * 1000;

    if (ipChanged) {
      lastIpChangeDate = now;
      ipFirstSeenAt = now;
      log.info(`IP changed from ${previousIp} to ${currentIp}. Static IP observation restarts.`);
    } else if (!ipFirstSeenAt) {
      // An address just met has been held for no time at all. It becomes STATIC
      // by being held, never by assumption.
      ipFirstSeenAt = now;
      log.info(`First observation of ${currentIp}. Static IP unknown until it has been held for ${staticIpStabilityDays} days.`);
    }

    const hasPublicIp = await fluxNetworkHelper.hasPublicIpOnInterface();
    const heldForMs = now - ipFirstSeenAt;
    const heldDays = heldForMs / (24 * 60 * 60 * 1000);

    if (!hasPublicIp) {
      // The public address is not on any local interface, so the node is behind
      // NAT. Nothing about the operator changes that.
      staticIpState = STATIC_IP_STATE.DYNAMIC;
    } else if (heldForMs >= stabilityThreshold) {
      staticIpState = STATIC_IP_STATE.STATIC;
    } else {
      // Public IP on the interface, but not yet held long enough to know.
      staticIpState = STATIC_IP_STATE.UNKNOWN;
    }
    staticIp = staticIpState === STATIC_IP_STATE.STATIC;
    log.info(`Static IP: ${staticIpState} (public IP on interface: ${hasPublicIp}, address held ${heldDays.toFixed(1)} of ${staticIpStabilityDays} days)`);

    // Whether the address is held (above) and what network it sits on (here) are
    // separate questions, answered from separate evidence.
    //
    // The published table decides where it can. Where it cannot - a range no
    // baseline covers, or an operator the policy repo left unclassified - the
    // node falls back to what it can observe about itself. The fallback is not a
    // weaker standard, only a narrower one: it still needs positive evidence
    // with nothing contradicting it, so an address the table declined to call
    // because its operator is mixed is one this will decline too.
    const [published, ptr, linkSpeeds] = await Promise.all([
      publishedClassification(currentIp),
      resolvePtr(currentIp),
      benchLinkSpeeds(),
    ]);
    const classified = networkClassifier.classifyNetwork({
      ptr,
      hosting: storedGeolocation.hosting,
      proxy: storedGeolocation.proxy,
      mobile: storedGeolocation.mobile,
      isp: storedGeolocation.isp,
      asn: storedGeolocation.asn,
      uploadSpeed: linkSpeeds.uploadSpeed,
      downloadSpeed: linkSpeeds.downloadSpeed,
    });

    // The table decides, but a node that can see hosting evidence about its OWN
    // address exempts itself. An organisation is published on a strong majority
    // of its hosts rather than on all of them, so a minority of its addresses
    // may be the other kind - and this is how one of them declines a verdict
    // meant for its neighbours. The veto only ever removes a node from
    // enforcement; local evidence can never impose one the table did not give.
    const vetoed = published === networkClassifier.CLASSIFICATION.RESIDENTIAL
      && classified.evidenceAgainst.length > 0;
    if (vetoed) {
      log.info(`Published verdict RESIDENTIAL declined for this address: ${classified.evidenceAgainst.join(', ')}`);
    }

    // One whole object, assigned once every input has settled: a reader must
    // never see a verdict computed from a half-finished pass.
    networkClassification = Object.freeze({
      classification: vetoed
        ? networkClassifier.CLASSIFICATION.CONFLICTED
        : (published ?? classified.classification),
      // Which authority decided, so a verdict can be traced to the table that
      // carried it, to the node that worked it out, or to the node declining one.
      // eslint-disable-next-line no-nested-ternary
      source: vetoed ? 'node-veto' : (published ? 'published-table' : 'node'),
      evidenceFor: Object.freeze([...classified.evidenceFor]),
      evidenceAgainst: Object.freeze([...classified.evidenceAgainst]),
      ptr: ptr || null,
      determinedAt: now,
    });
    dataCenter = classified.classification === networkClassifier.CLASSIFICATION.DATACENTER;
    log.info(`Network classification: ${networkClassification.classification}`
      + ` via ${networkClassification.source}`
      + ` (node evidence for: ${classified.evidenceFor.join(', ') || 'none'};`
      + ` against: ${classified.evidenceAgainst.join(', ') || 'none'})`);

    // Store geolocation to database for persistence across restarts
    await storeGeolocationToDb(storedGeolocation, staticIp, dataCenter, lastIpChangeDate, {
      ipFirstSeenAt,
      staticIpState,
      networkClassification,
    });
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
    ({
      geolocation: storedGeolocation,
      staticIp,
      dataCenter,
      lastIpChangeDate,
      ipFirstSeenAt,
      networkClassification,
    } = dbData);
    staticIpState = dbData.staticIpState ?? STATIC_IP_STATE.UNKNOWN;
    log.info('Geolocation restored from database');
  }
  return storedGeolocation;
}

/**
 * Whether this node's address is known to stay put. True only when the address
 * is bound to a local interface and has been held for the stability window; an
 * address not yet observed that long is not static, so apps that require one are
 * never placed on evidence the node does not have.
 * @returns {boolean}
 */
function isStaticIP() {
  return staticIp;
}

/**
 * The three-state form of isStaticIP, for callers that need to tell "we have not
 * watched it long enough" apart from "it moves".
 * @returns {('STATIC'|'DYNAMIC'|'UNKNOWN')}
 */
function getStaticIpState() {
  return staticIpState;
}

/**
 * Whether this node sits in a data centre. True only on a positive verdict from
 * networkClassifier - CONFLICTED and UNKNOWN are both false, because neither is
 * evidence of a data centre.
 * @returns {boolean}
 */
function isDataCenter() {
  return dataCenter;
}

/**
 * The node's access-network verdict and the evidence behind it.
 * @returns {{classification: string, source: string, evidenceFor: string[],
 *   evidenceAgainst: string[], ptr: string|null, determinedAt: number}|null} Null
 *   when no verdict has been reached, which is not the same as a verdict of
 *   UNKNOWN. `source` names the authority: 'published-table', 'node' when the
 *   table had nothing for this address, or 'node-veto' when the node declined a
 *   published RESIDENTIAL on evidence about its own address.
 */
function getNetworkClassification() {
  return networkClassification;
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
  getStaticIpState,
  isDataCenter,
  getNetworkClassification,
  getLastIpChangeDate,
  hasPublicIp,
  STATIC_IP_STATE,
};
