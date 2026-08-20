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
// What this node observed about its own address - never the verdict drawn from
// it. Gathering costs an ip-api call and a PTR lookup, so it happens on the slow
// pass; the verdict also needs the published table, which is cheap to consult
// and arrives later, so it is reached on demand.
//
// Null means nothing has been gathered yet, which readers must distinguish from
// a verdict of UNKNOWN: "not observed" against "observed, and the evidence does
// not decide".
let networkEvidence = null;

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
        networkEvidence: observations.networkEvidence ?? null,
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
        networkEvidence: result.networkEvidence ?? null,
      };
    }
    return {
      geolocation: null,
      staticIp: false,
      dataCenter: false,
      lastIpChangeDate: null,
      ipFirstSeenAt: null,
      staticIpState: null,
      networkEvidence: null,
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
      networkEvidence: null,
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
 * What the published location table says about an address.
 *
 * The table is the authority. It is built in the policy repo from evidence a
 * node cannot gather for itself - chiefly the registries' own record of what a
 * block was assigned for, which six thousand nodes cannot each go and fetch -
 * and it is reviewed there with its reasons rather than derived here.
 *
 * TWO OUTCOMES, AND THEY MUST NOT BE CONFUSED:
 *
 *   consulted: false  the table could not be asked - none has been ingested
 *                     yet, or the store could not be read. Nothing is known,
 *                     and a node must reach no verdict at all.
 *   consulted: true   the table answered. `classification` is its verdict, or
 *                     null where it holds none for this address: no covering
 *                     row, or an organisation the policy repo deliberately
 *                     left unclassified. THAT null is an answer, and it is what
 *                     hands the decision to the node's own evidence.
 *
 * Collapsing the two is the very mistake this whole classifier exists to
 * avoid, one level up: "I have not asked" is not "there is no verdict". A node
 * boots, fetches a 4.6 MB artifact, and ingests two million rows, while a
 * single ip-api call answers in milliseconds - so the table is reliably absent
 * at the moment a booting node would otherwise decide, and treating that as an
 * abstention lets the node act on its own guess against a verdict the table
 * was about to give it.
 * @param {string} ip The node's public address.
 * @returns {Promise<{consulted: boolean, classification: string|null}>}
 */
async function publishedClassification(ip) {
  // Lazily required, like the benchmark service below: the location store
  // pulls in the database layer, and geolocation is read on paths that must
  // not depend on it being up.
  // eslint-disable-next-line global-require
  const ipLocationStore = require('./appPlacement/ipLocationStore');
  if (!ipLocationStore.status().ready) {
    return { consulted: false, classification: null };
  }
  try {
    const hit = await ipLocationStore.lookup(ip);
    return { consulted: true, classification: hit?.networkClass ?? null };
  } catch (error) {
    // A table that cannot be read is a table that was not asked. Same as above:
    // not evidence about the address, and not an abstention either.
    log.info(`Location table could not answer for ${ip}: ${error.message}`);
    return { consulted: false, classification: null };
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

    // Static IP is observed, never inferred from the operator. A public address
    // is trusted until this node WATCHES it move; the stability window is how
    // one that moved earns the trust back, not a probation every node serves
    // once. The whole rule is the table below.
    const currentIp = storedGeolocation.ip;
    const ipChanged = previousIp && previousIp !== currentIp;
    const now = Date.now();
    const stabilityThreshold = staticIpStabilityDays * 24 * 60 * 60 * 1000;

    if (ipChanged) {
      lastIpChangeDate = now;
      ipFirstSeenAt = now;
      log.info(`IP changed from ${previousIp} to ${currentIp}. Static IP observation restarts.`);
    } else if (!ipFirstSeenAt) {
      // Seeded from the last change on record rather than from now: an address
      // held since a change 400 days ago has been held for 400 days, and that
      // record is persisted and restored. Without this, an in-place upgrade
      // introducing ipFirstSeenAt restarts the window on a node that has held
      // its address for years.
      ipFirstSeenAt = lastIpChangeDate ?? now;
      log.info(`First observation of ${currentIp} by this build`
        + `${lastIpChangeDate ? `, held since the change recorded ${new Date(lastIpChangeDate).toISOString()}` : ', with no change ever recorded'}.`);
    }

    const hasPublicIp = await fluxNetworkHelper.hasPublicIpOnInterface();
    const heldForMs = now - ipFirstSeenAt;
    const heldDays = heldForMs / (24 * 60 * 60 * 1000);

    // THE WHOLE DECISION, in one table, in the order it is asked.
    //
    //   this node WATCHED    public IP on    published      verdict
    //   it change <10d ago   the interface   table says
    //   ------------------   -------------   ------------   -------
    //   yes                  -               -              UNKNOWN
    //   no                   yes             (not asked)    STATIC
    //   no                   no  (NAT)       hosting        STATIC
    //   no                   no  (NAT)       anything else  DYNAMIC
    //   no                   unreadable      hosting        STATIC
    //   no                   unreadable      anything else  UNKNOWN
    //
    // Only STATIC satisfies an app's `staticip` requirement; UNKNOWN and
    // DYNAMIC both fail it, and are kept apart so a node that could not answer
    // does not read as one that answered "behind NAT".
    //
    // A watched change is asked FIRST and nothing overrides it. It is the only
    // evidence here that is about this exact address rather than about the
    // range it sits in, and it is a record of the address actually moving. A
    // hosting range whose addresses do move is still a node whose address
    // moved, which is the whole of what an app requiring a fixed address cares
    // about. lastIpChangeDate comes from the geolocation fetch, so it is
    // available whether or not the node can see the address on an interface -
    // deciding rows 3 to 6 without consulting it threw away the best evidence
    // held, in exactly the cases where the rest of it is weakest.
    //
    // Row 2 is the common case: a node has WATCHED no change because it started
    // watching after the fact, which every node does exactly once. That is not
    // evidence the address moves. Measured on the fleet an address changes on
    // 0.29% of node-days, so treating not-yet-watched as suspect is wrong about
    // ~97% of nodes for the whole ten days it lasts - and it lands on all of
    // them together, because they upgrade together. An observed change is what
    // withdraws the trust, and the window is how the address earns it back.
    //
    // Where the local test cannot answer, the published table can. A 1:1-NAT
    // cloud instance holds a genuinely static address that never appears on any
    // local interface - every AWS, Azure, GCP and Oracle box fails the test
    // above - and a range the table calls hosting is that case.
    //
    // This is the job the deleted staticIpOrgs list was doing, done on evidence
    // that has been measured. That list was nine hoster names matched against
    // the block REGISTRANT, which disagrees with the operator on 67% of fleet
    // hosts, backed by an ip-api `static` field that is literally
    // `proxy || hosting`.
    //
    // Measured against the two signals over the whole fleet - 5,661 node slots
    // on 2,349 machines - the table treats 268 more slots as static than the
    // list did, on 153 machines it never named (83 of them one operator), and
    // withdraws it from 49 slots on 11 machines. Seven of those eleven are
    // consumer ISPs the list was wrong about - Verizon, Comcast, Free SAS,
    // Bouygues - flagged `proxy`, which is a VPN artefact and not an address
    // that stays put. The remaining four are genuine hosting the table has not
    // classified yet, and data/orgclass-overrides.json in
    // fluxos-network-policy is where that is corrected.
    const publishedHosting = (await publishedClassification(currentIp)).classification
      === networkClassifier.CLASSIFICATION.DATACENTER;

    const watchedItChange = Boolean(lastIpChangeDate) && heldForMs < stabilityThreshold;

    if (watchedItChange) {
      // Asked first, and nothing overrides it: this node saw this address move,
      // and it has not been held long enough since to say it has settled.
      staticIpState = STATIC_IP_STATE.UNKNOWN;
    } else if (hasPublicIp === true) {
      staticIpState = STATIC_IP_STATE.STATIC;
    } else if (publishedHosting) {
      // The node cannot see the address on an interface, but the table places
      // it in a hosting range - the 1:1-NAT case, where the address is fixed
      // and simply never appears locally.
      staticIpState = STATIC_IP_STATE.STATIC;
    } else if (hasPublicIp === false) {
      // Behind NAT as far as this node can see, and nothing says otherwise.
      staticIpState = STATIC_IP_STATE.DYNAMIC;
    } else {
      // The routing table could not be read. Not evidence of anything about the
      // address, and in particular not evidence of NAT.
      staticIpState = STATIC_IP_STATE.UNKNOWN;
    }
    staticIp = staticIpState === STATIC_IP_STATE.STATIC;
    log.info(`Static IP: ${staticIpState} (public IP on interface: ${hasPublicIp}, address held ${heldDays.toFixed(1)} of ${staticIpStabilityDays} days`
      + `, published hosting range: ${publishedHosting})`);

    // Whether the address is held (above) and what network it sits on (here) are
    // separate questions, answered from separate evidence.
    //
    // This pass gathers the EVIDENCE and stops there. Reaching a verdict also
    // needs the published table, and the table is not this pass's to wait for:
    // it arrives in a 4.6 MB artifact the node is still ingesting while this
    // runs, and a pass that recorded its own conclusion here would be recording
    // "the table said nothing" and standing by it until the next pass, three
    // days later. getNetworkClassification() reaches the verdict when asked,
    // which is what every other consumer of that table already does.
    const [ptr, linkSpeeds] = await Promise.all([
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

    // One whole object, assigned once every input has settled: a reader must
    // never combine evidence from a half-finished pass.
    networkEvidence = Object.freeze({
      ip: currentIp,
      classification: classified.classification,
      evidenceFor: Object.freeze([...classified.evidenceFor]),
      evidenceAgainst: Object.freeze([...classified.evidenceAgainst]),
      ptr: ptr || null,
      // Whether this pass had the signals that can contradict a residential
      // reading. False on the stats.runonflux.io fallback, which carries none
      // of them - and an empty evidenceAgainst from that path is nobody having
      // looked, not nothing having been found.
      contradictionSignalsGathered: classified.contradictionSignalsGathered,
      gatheredAt: now,
    });
    dataCenter = classified.classification === networkClassifier.CLASSIFICATION.DATACENTER;
    log.info(`Network evidence for ${currentIp}: the node's own reading is ${classified.classification}`
      + ` (for: ${classified.evidenceFor.join(', ') || 'none'};`
      + ` against: ${classified.evidenceAgainst.join(', ') || 'none'}`
      + `${classified.contradictionSignalsGathered ? '' : '; hosting/proxy/operator signals were NOT gathered'})`);

    // Store geolocation to database for persistence across restarts
    await storeGeolocationToDb(storedGeolocation, staticIp, dataCenter, lastIpChangeDate, {
      ipFirstSeenAt,
      staticIpState,
      networkEvidence,
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
      networkEvidence,
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
 * The node's access-network verdict, reached now from the evidence it gathered
 * and the table it currently holds.
 *
 * Reached here rather than stored because its two halves arrive at different
 * times and on different clocks. The evidence is expensive and refreshed every
 * three days; the published table is a local read that a booting node does not
 * have yet and will have shortly. Deciding once, at the moment only one half
 * exists, is how a node ends up acting for three days on a verdict the table
 * would have overruled.
 *
 * NO TABLE MEANS NO VERDICT. Not a fallback to the node's own reading - the
 * fallback belongs to a table that WAS consulted and holds nothing for this
 * address. Until one has been ingested, this node knows nothing about which
 * kind of network it is on, and null is the only honest answer. Nothing
 * enforces on null.
 * @returns {Promise<{classification: string, source: string,
 *   evidenceFor: string[], evidenceAgainst: string[], ptr: string|null,
 *   gatheredAt: number}|null>} Null when nothing has been gathered yet, or when
 *   no location table has been consulted. `source` names the authority:
 *   'published-table', 'node' where the table holds no verdict for this
 *   address, or 'node-veto' where the node declined a published RESIDENTIAL on
 *   evidence about its own address.
 */
async function getNetworkClassification() {
  if (!networkEvidence) return null;

  // Nothing usable was gathered about what kind of network this is, so this
  // node has no verdict - not even the table's. The veto below is the only
  // thing that can decline a published RESIDENTIAL, and it fires on local
  // evidence AGAINST; on a pass that never obtained any, it cannot fire, so a
  // published verdict would go unchallenged precisely where challenging it
  // matters. Returning null leaves the node unclassified, which enforces
  // nothing and re-derives on the next pass that reaches ip-api.
  if (!networkEvidence.contradictionSignalsGathered) return null;

  const published = await publishedClassification(networkEvidence.ip);
  if (!published.consulted) return null;

  // THE TABLE DECIDES, OR NOBODY DOES. Where it carries no verdict this returns
  // null and the node is simply not classified, which enforces nothing.
  //
  // It used to fall back to the node's own reading. That rule is the published
  // rule with its strongest signal removed - six thousand nodes cannot each
  // query the RIRs, so registration data belongs in the table - and its error
  // rate has never been measured: 0.13% is reverse DNS alone and 0.00% is the
  // combined rule WITH registration, and neither is what a node runs. It decided
  // for the ~8% of hosts whose organisation carries no published verdict, on the
  // one path that deletes customer data.
  //
  // Tuning belongs in fluxos-network-policy, where a verdict is evidence-backed,
  // auditable by anyone, correctable by hand through
  // data/orgclass-overrides.json, and fixable without a FluxOS release.
  if (!published.classification) return null;

  // The table decides, but a node that can see hosting evidence about its OWN
  // address exempts itself. An organisation is decided by 80% of its hosts
  // agreeing, so a minority tail of the other kind is guaranteed by
  // construction - and this is how one of them declines a verdict meant for its
  // neighbours, until someone adjudicates the range. The veto only ever removes
  // a node from enforcement; local evidence can never impose one the table did
  // not give.
  const vetoed = published.classification === networkClassifier.CLASSIFICATION.RESIDENTIAL
    && networkEvidence.evidenceAgainst.length > 0;

  return Object.freeze({
    classification: vetoed
      ? networkClassifier.CLASSIFICATION.CONFLICTED
      : published.classification,
    // Which authority decided, so a verdict can be traced to the table that
    // carried it or to the node declining one.
    source: vetoed ? 'node-veto' : 'published-table',
    evidenceFor: networkEvidence.evidenceFor,
    evidenceAgainst: networkEvidence.evidenceAgainst,
    ptr: networkEvidence.ptr,
    gatheredAt: networkEvidence.gatheredAt,
  });
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
