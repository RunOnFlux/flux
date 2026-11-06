const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxEventBus = require('../utils/fluxEventBus');
const globalState = require('../utils/globalState');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../utils/appSyncEvents');
// Removed appsService to avoid circular dependency - will use dynamic require where needed
const { checkAndDecryptAppSpecs, encryptEnterpriseFromSession } = require('../utils/enterpriseHelper');
const { verifyAppNameAndOwner } = require('../utils/appIdentity');
const { specificationFormatter, updateToLatestAppSpecifications } = require('../utils/appUtilities');
const placementFeasibility = require('../appPlacement/placementFeasibility');
const { withRegistryWrite } = require('./registryWriteLock');
const appMessageChain = require('../utils/appMessageChain');
const mountParser = require('../utils/mountParser');
const signatureVerifier = require('../signatureVerifier');
const {
  SIGTERM_EXPIRY_MS,
  globalAppsInformation,
  localAppsInformation,
  globalAppsMessages,
  globalAppsLocations,
  globalAppStateEvents,
  globalAppsInstallingLocations,
  globalAppsInstallingErrorsLocations,
  globalAppsInstallingErrorsBroadcasts,
  appsHashesCollection,
  scannedHeightCollection,
} = require('../utils/appConstants');
const { Privilege, authOf } = require('../utils/privileges');
const localRemovalQueue = require('../appLifecycle/localRemovalQueue');
const {
  extractIp, ipsMatch, normalizeSocketAddress,
} = require('../utils/socketAddressUtils');

// The most moves followed from one address. A node announces each move it makes,
// so a real chain is one or two long; the bound only ends a chain that loops.
const MAX_ADDRESS_MOVES_FOLLOWED = 8;

// The rebuild running now, and the one that follows it for every caller that asked after it began.
let rebuildRunning = null;
let rebuildFollowing = null;

/**
 * The state of this node's app registry: the app sync state, the height its
 * explorer has scanned to (null before the first scan), how many apps it holds,
 * how many app transactions the explorer has recorded, how many of those this
 * node still has no message for, and how many of the missing ones it has
 * stopped looking for. A node answers in every sync state, READY or not.
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 * @returns {Promise<object>} {syncState, scannedHeight, apps, transactions, missingMessages, messagesNotFound}
 */
async function getRegistryStatus(_req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appsglobal.database);
    const daemonDatabase = dbopen.db(config.database.daemon.database);
    // The totals count the _id index rather than reading every document; the
    // missing counts are answered by the message index.
    const wholeCollection = { hint: { _id: 1 } };
    const [scanned, apps, transactions, missingMessages, messagesNotFound] = await Promise.all([
      dbHelper.findOneInDatabase(
        daemonDatabase,
        scannedHeightCollection,
        { generalScannedHeight: { $gte: 0 } },
        { projection: { _id: 0, generalScannedHeight: 1 } },
      ),
      dbHelper.countInDatabase(appsDatabase, globalAppsInformation, {}, wholeCollection),
      dbHelper.countInDatabase(daemonDatabase, appsHashesCollection, {}, wholeCollection),
      dbHelper.countInDatabase(daemonDatabase, appsHashesCollection, { message: false }),
      dbHelper.countInDatabase(daemonDatabase, appsHashesCollection, { message: false, messageNotFound: true }),
    ]);
    const status = {
      syncState: globalState.appSyncState,
      scannedHeight: scanned ? serviceHelper.ensureNumber(scanned.generalScannedHeight) : null,
      apps,
      transactions,
      missingMessages,
      messagesNotFound,
    };
    const statusResponse = messageHelper.createDataMessage(status);
    return res ? res.json(statusResponse) : statusResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Get all app hashes from the blockchain
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 * @returns {Promise<object>} List of app hashes
 */
async function getAppHashes(_req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
        messageNotFound: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    return res ? res.json(resultsResponse) : resultsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Get app location information
 * @param {string} appname - Optional app name filter
 * @returns {Promise<Array>} Array of app locations
 */
/**
 * The names of the apps the network lists at `socketAddress`.
 * @param {string} socketAddress
 * @returns {Promise<string[]>}
 */
async function appsListedAt(socketAddress) {
  const ip = normalizeSocketAddress(socketAddress);
  if (!ip) return [];
  const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
  const rows = await database.collection(globalAppsLocations)
    .find({ ip }, { projection: { _id: 0, name: 1 } }).toArray();
  return [...new Set(rows.map((row) => row.name))];
}

async function appLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
      runningSince: 1,
      osUptime: 1,
      staticIp: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

// A recorded address move is a node announcing, signed, that it no longer
// answers at its old socket address and now answers at the new one: one per old
// address, the latest it announced. Events are stored as they arrive, before
// anything checks them, so only a version 1 move between two different
// addresses counts.
const MOVE_PROJECTION = Object.freeze({
  _id: 0, ip: 1, broadcastedAt: 1, 'data.newIP': 1, 'data.version': 1, 'envelope.pubKey': 1,
});

/**
 * Add a stored ipchanged event to `moves` when it is a move: version 1, between
 * two different addresses. `signer` is the key that signed it, or null.
 * @param {Map<string, {to: string, at: number, signer: string|null}>} moves
 * @param {object} event
 * @returns {string|null} The address it moves to, or null when it is not a move.
 */
function addMove(moves, event) {
  const from = normalizeSocketAddress(event.ip);
  const to = typeof event.data?.newIP === 'string' ? normalizeSocketAddress(event.data.newIP) : null;
  const at = new Date(event.broadcastedAt).getTime();
  if (event.data?.version !== 1 || !from || !to || to === from || !Number.isFinite(at)) return null;
  moves.set(from, { to, at, signer: event.envelope?.pubKey ?? null });
  return to;
}

/**
 * The recorded moves away from `addresses`, and away from every address those
 * lead to, read by address rather than by scanning every move.
 * @param {string[]} addresses Socket addresses.
 * @returns {Promise<Map<string, {to: string, at: number}>>} As addressMoves.
 */
async function addressMovesFrom(addresses) {
  const collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(globalAppStateEvents);
  const moves = new Map();
  const asked = new Set();
  let frontier = addresses;
  for (let hop = 0; hop < MAX_ADDRESS_MOVES_FOLLOWED && frontier.length; hop += 1) {
    // an address may be stored with its port or, when it is the default, without
    const pending = [...new Set(frontier.flatMap((address) => [address, normalizeSocketAddress(address)]).filter(Boolean))]
      .filter((address) => !asked.has(address));
    if (!pending.length) break;
    pending.forEach((address) => asked.add(address));
    // eslint-disable-next-line no-await-in-loop
    const events = await collection.find(
      { ip: { $in: pending }, type: 'ipchanged', expireAt: { $gt: new Date() } },
      { projection: MOVE_PROJECTION },
    ).toArray();
    frontier = events.map((event) => addMove(moves, event)).filter(Boolean);
  }
  return moves;
}

/**
 * The recorded moves to `address`.
 * @param {string} address A socket address.
 * @returns {Promise<Map<string, {to: string, at: number, signer: string|null}>>}
 *   old socket address -> the move, as addressMovesFrom gives it
 */
async function addressMovesTo(address) {
  const collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(globalAppStateEvents);
  const events = await collection.find(
    { type: 'ipchanged', 'data.newIP': normalizeSocketAddress(address), expireAt: { $gt: new Date() } },
    { projection: MOVE_PROJECTION },
  ).toArray();
  const moves = new Map();
  events.forEach((event) => addMove(moves, event));
  return moves;
}

/**
 * The query condition for every stored address at an IP, whatever its port.
 *
 * Every location and every move is stored under its node's address in ip:port
 * form, so the IP and the colon after it match exactly the addresses at that
 * IP: never one that only begins with it.
 * @param {string} ip An IP, or a socket address whose IP is meant.
 * @returns {RegExp|null} null when there is no IP
 */
function storedAtIp(ip) {
  const bare = extractIp(ip);
  if (!bare) return null;
  return new RegExp(`^${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
}

/**
 * The socket addresses at `ip` that a recorded move leaves.
 * @param {string} ip An IP, or a socket address whose IP is meant.
 * @returns {Promise<string[]>}
 */
async function addressesMovedFromIp(ip) {
  const atIp = storedAtIp(ip);
  if (!atIp) return [];
  const collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(globalAppStateEvents);
  const events = await collection.find(
    { ip: atIp, type: 'ipchanged', expireAt: { $gt: new Date() } },
    { projection: { _id: 0, ip: 1 } },
  ).toArray();
  return [...new Set(events.map((event) => event.ip))];
}

/**
 * Where each node that spoke for an address is now. A message signed at an
 * address speaks for the node that held it when it was signed; when that node
 * has since moved, what it said holds at the address it moved to.
 * @param {Array<{ip: string, at: number}>} sayings Each address, and when its message was signed (ms).
 * @returns {Promise<string[]>} One address per saying: where the node moved to, or `ip` as given when it has not moved.
 */
async function currentAddressesOf(sayings) {
  const moves = await addressMovesFrom(sayings.map(({ ip }) => ip));
  return sayings.map(({ ip, at }) => {
    const to = followAddressMoves(ip, moves, at);
    return to === normalizeSocketAddress(ip) ? ip : to;
  });
}

/**
 * The listed node whose recorded moves end at `address`, or null: an address
 * it moved on from is no longer the node's. A node moves only itself, so every
 * move followed is one signed by the key the list holds for the node, and each
 * is newer than the one before it.
 * @param {string} address A socket address.
 * @param {Array<{ip: string, pubkey: string}>} nodeList The deterministic list.
 * @returns {Promise<object|null>}
 */
async function listedNodeMovedTo(address, nodeList) {
  const target = normalizeSocketAddress(address);
  const sources = new Set((await addressesLeadingTo(address)).map(normalizeSocketAddress));
  sources.delete(target);
  const candidates = nodeList.filter((node) => sources.has(normalizeSocketAddress(node.ip)));
  // eslint-disable-next-line no-restricted-syntax
  for (const node of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const moves = await addressMovesFrom([node.ip]);
    let current = normalizeSocketAddress(node.ip);
    let since = 0;
    for (let hop = 0; hop < MAX_ADDRESS_MOVES_FOLLOWED; hop += 1) {
      const move = moves.get(current);
      if (!move || move.at <= since || move.signer !== node.pubkey) break;
      current = move.to;
      since = move.at;
    }
    if (current === target) return node;
  }
  return null;
}

/**
 * The addresses whose recorded moves lead to `address`, and `address` itself.
 * @param {string} address A socket address.
 * @returns {Promise<string[]>}
 */
async function addressesLeadingTo(address) {
  const collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(globalAppStateEvents);
  const found = new Set([address]);
  let frontier = [address];
  for (let hop = 0; hop < MAX_ADDRESS_MOVES_FOLLOWED && frontier.length; hop += 1) {
    // eslint-disable-next-line no-await-in-loop
    const events = await collection.find(
      { type: 'ipchanged', 'data.newIP': { $in: [...new Set(frontier.flatMap((to) => [to, normalizeSocketAddress(to)]))] }, expireAt: { $gt: new Date() } },
      { projection: { _id: 0, ip: 1 } },
    ).toArray();
    frontier = events.map((event) => event.ip).filter((ip) => !found.has(ip));
    frontier.forEach((ip) => found.add(ip));
  }
  return [...found];
}

/**
 * Where a node known at `socketAddr` as of `knownAt` answers now. Each move
 * followed must be newer than the address it moves from was known to be good, so
 * a node that moved away and back again ends at the address it holds now.
 * @param {string} socketAddr
 * @param {Map<string, {to: string, at: number}>} moves From addressMoves.
 * @param {number} [knownAt] When `socketAddr` was last known to be the node's (ms).
 * @returns {string} The address, normalised; `socketAddr` when it has not moved.
 */
function followAddressMoves(socketAddr, moves, knownAt = 0) {
  let address = normalizeSocketAddress(socketAddr);
  let since = knownAt;
  for (let hop = 0; hop < MAX_ADDRESS_MOVES_FOLLOWED; hop += 1) {
    const move = moves.get(address);
    if (!move || move.at <= since) break;
    address = move.to;
    since = move.at;
  }
  return address;
}

/**
 * The full socket address of the node FDM names an app's primary.
 *
 * FDM names it by IP alone. A node runs at most one instance of an app per IP,
 * so the app's location at that IP is the node, and its port is the one to ask
 * it on. A move carries a node's rows to where it is now as it is applied, so
 * the locations are where their nodes are. With no location at that IP, the IP
 * may be one a node has since moved from, which FDM names until it catches up:
 * the one move away from it that ends at a holder of the app is that node.
 *
 * When neither settles it - locations at the IP at different addresses, or no
 * move or several leading to a holder - the IP comes back as given.
 * @param {string} appName
 * @param {string} fdmIp The primary FDM names.
 * @returns {Promise<string>} A full socket address, or `fdmIp` unresolved.
 */
async function primaryAddressOf(appName, fdmIp) {
  const locations = await appLocation(appName);
  const atIp = new Set(locations
    .filter((location) => ipsMatch(location.ip, fdmIp))
    .map((location) => normalizeSocketAddress(location.ip)));
  if (atIp.size === 1) return [...atIp][0];
  if (atIp.size > 1) return fdmIp;
  const holders = new Set(locations.map((location) => normalizeSocketAddress(location.ip)));
  const moves = await addressMovesFrom(await addressesMovedFromIp(fdmIp));
  const reached = new Set(
    [...moves.keys()]
      .filter((from) => ipsMatch(from, fdmIp))
      .map((from) => followAddressMoves(from, moves))
      .filter((to) => holders.has(to)),
  );
  return reached.size === 1 ? [...reached][0] : fdmIp;
}

/**
 * The moves the event-derived view follows: version 1 ipchanged events, one per
 * old address (the newest), as stored.
 * @param {string[]|null} addresses Only the moves away from these, when given.
 * @returns {Promise<Array<{_id: string, newIP: string, changedAt: Date}>>}
 */
async function movesForView(addresses) {
  const collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(globalAppStateEvents);
  const query = {
    type: 'ipchanged', 'data.version': 1, 'data.newIP': { $type: 'string' }, expireAt: { $gt: new Date() },
  };
  if (addresses) query.ip = { $in: addresses };
  const events = await collection.find(query, { projection: { _id: 0, ip: 1, broadcastedAt: 1, 'data.newIP': 1 } })
    .sort({ broadcastedAt: -1 }).toArray();
  const moves = new Map();
  events
    .filter((event) => !moves.has(event.ip))
    .forEach((event) => moves.set(event.ip, { _id: event.ip, newIP: event.data.newIP, changedAt: event.broadcastedAt }));
  return [...moves.values()];
}

/**
 * An aggregation expression for where the node that held `address` at `at` is
 * now, following `moves` (from movesForView) the way followAddressMoves does:
 * each move followed is newer than the address it leaves was known to be the
 * node's. Stops at the first address with no such move.
 * @param {*} address Expression for the address.
 * @param {*} at Expression for when it was known to be the node's.
 * @param {Array<object>} moves
 * @param {number} [hop]
 * @returns {object}
 */
function followMovesExpr(address, at, moves, hop = 0) {
  if (hop === MAX_ADDRESS_MOVES_FOLLOWED) return address;
  const move = `move${hop}`;
  return {
    $let: {
      vars: {
        [move]: {
          $first: {
            $filter: {
              input: { $literal: moves },
              as: 'c',
              cond: { $and: [{ $eq: ['$$c._id', address] }, { $gt: ['$$c.changedAt', at] }] },
            },
          },
        },
      },
      in: {
        $cond: [
          { $eq: [{ $ifNull: [`$$${move}`, null] }, null] },
          address,
          followMovesExpr(`$$${move}.newIP`, `$$${move}.changedAt`, moves, hop + 1),
        ],
      },
    },
  };
}

/**
 * An aggregation expression for the newest of the document's `shutdowns` at
 * `address`, or null. Shutdowns made at different addresses can resolve to one.
 * @param {*} address Expression for the address.
 * @returns {object}
 */
function newestShutdownAt(address) {
  return {
    $let: {
      vars: { address },
      in: {
        $reduce: {
          input: { $filter: { input: '$shutdowns', as: 's', cond: { $eq: ['$$s._id', '$$address'] } } },
          initialValue: null,
          in: { $cond: [{ $or: [{ $eq: ['$$value', null] }, { $gt: ['$$this.eventAt', '$$value.eventAt'] }] }, '$$this', '$$value'] },
        },
      },
    },
  };
}

/**
 * The holders of an app by their own signed word: each signing key whose newest
 * standing announcement names the app, and which has signed no removal of the
 * app and no SIGTERM since. A record stands while its expireAt is after
 * `atMs`, so nodes judging one instant count the same records whether or not
 * their own expiry sweep has run.
 *
 * Unsigned evictions are not read. They trim the location table, each node on
 * its own probe and any peer it syncs from, so the table can count an app's
 * holders differently on two nodes; nothing here can be removed except by the
 * holder that signed it, or by time.
 * @param {string} appName Global app name.
 * @param {number} atMs The instant judged at, epoch ms.
 * @returns {Promise<Array<{key: string, ip: string, expireAt: Date}>>} One per
 *   signing key, its newest announcement's address and expiry.
 */
async function signedHoldersOf(appName, atMs) {
  const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
  const standing = { $gt: new Date(atMs) };
  const projection = {
    _id: 0, ip: 1, type: 1, dedupKey: 1, broadcastedAt: 1, expireAt: 1, 'data.apps.name': 1, 'data.appName': 1, 'envelope.pubKey': 1,
  };
  const naming = await dbHelper.findInDatabase(database, globalAppStateEvents, {
    type: 'apprunning',
    expireAt: standing,
    $or: [{ 'data.apps.name': appName }, { dedupKey: `v1:${appName}` }],
  }, { projection });
  const keys = [...new Set(naming.map((event) => event.envelope?.pubKey).filter(Boolean))];
  if (!keys.length) return [];

  // A key's newest announcement decides: one made since, from any address,
  // that no longer names the app means it no longer holds it.
  const [announcements, ends] = await Promise.all([
    dbHelper.findInDatabase(database, globalAppStateEvents, {
      type: 'apprunning',
      expireAt: standing,
      'envelope.pubKey': { $in: keys },
      dedupKey: { $in: ['v2', `v1:${appName}`] },
    }, { projection }),
    dbHelper.findInDatabase(database, globalAppStateEvents, {
      $or: [
        { type: 'appremoved', 'data.appName': appName },
        { type: 'sigterm' },
      ],
      expireAt: standing,
      'envelope.pubKey': { $in: keys },
    }, { projection }),
  ]);
  const newest = new Map();
  announcements.forEach((event) => {
    const key = event.envelope.pubKey;
    const held = newest.get(key);
    if (!held || event.broadcastedAt > held.broadcastedAt) newest.set(key, event);
  });
  const endedAt = new Map();
  ends.forEach((event) => {
    const key = event.envelope.pubKey;
    if (!endedAt.has(key) || event.broadcastedAt > endedAt.get(key)) endedAt.set(key, event.broadcastedAt);
  });

  const holders = [];
  newest.forEach((event, key) => {
    const names = event.dedupKey === 'v2' && (event.data?.apps ?? []).some((app) => app?.name === appName);
    if (!names && event.dedupKey !== `v1:${appName}`) return;
    if (endedAt.has(key) && endedAt.get(key) > event.broadcastedAt) return;
    holders.push({ key, ip: event.ip, expireAt: event.expireAt });
  });
  return holders;
}

// Derives running app locations from the event log. Will replace appLocation() once callers are switched.
//
// Performance: shutdown/v1 filtering happens at IP level BEFORE unwinding to individual apps.
// Lookups use $filter + $first against small arrays (shutdowns ~10) which is
// O(IPs * arraySize) — fast because the arrays are small. The v2Timestamps lookup for v1
// filtering is O(v1Count * v2IPs) which dominates at ~2.4M comparisons at steady state.
//
// MongoDB 7.2+ optimization: $getField supports dynamic field references, enabling
// $arrayToObject maps with O(1) key lookup via $getField({ field: '$$var.ip', input: '$map' }).
// This would reduce all lookups to O(n) total. Blocked by MongoDB 7.0 on CI (SERVER-74371).
//
// Every report, removal and shutdown speaks for the node that held its address when it was
// made; when that node has since moved, it holds at the address the node moved to. The moves
// are read first, and each facet is split by whether an event was made at an address a move
// leaves: only that part is resolved, against the moves as a literal. With no moves the
// pipeline is the one without them.
async function appLocationFromEvents(options = {}) {
  const { appname, ip } = options;
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const collection = database.collection(globalAppStateEvents);

  const escapedName = appname ? appname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
  const nameMatch = escapedName ? new RegExp(`^${escapedName}$`, 'i') : null;
  const now = new Date();

  const v1NameFilter = nameMatch ? [{ $match: { 'data.name': nameMatch } }] : [];
  const removalNameFilter = nameMatch ? [{ $match: { 'data.appName': nameMatch } }] : [];

  const initialMatch = {
    $or: [
      { type: { $in: ['apprunning', 'appremoved'] }, expireAt: { $gt: now } },
      { type: { $in: ['sigterm', 'evicted'] } },
    ],
  };
  const scope = ip ? await addressesLeadingTo(ip) : null;
  if (scope) initialMatch.ip = { $in: scope };
  const moves = await movesForView(scope);
  const movedFrom = moves.map((move) => move._id);
  // A facet's stages, and when there are moves a second facet `<name>Moved` for the
  // events made at an address a move leaves, ending in `resolve`.
  const splitByMove = (name, stages, resolve) => (moves.length ? {
    [name]: [{ $match: { ip: { $nin: movedFrom } } }, ...stages],
    [`${name}Moved`]: [{ $match: { ip: { $in: movedFrom } } }, ...stages, resolve],
  } : { [name]: stages });
  const resolveReport = { $addFields: { at: followMovesExpr('$ip', '$broadcastedAt', moves) } };

  const pipeline = [
    { $match: initialMatch },
    { $sort: { broadcastedAt: -1 } },
    {
      $facet: {
        ...splitByMove('v2', [
          { $match: { type: 'apprunning', 'data.apps': { $exists: true } } },
          { $group: { _id: '$ip', doc: { $first: '$$ROOT' } } },
          { $replaceRoot: { newRoot: '$doc' } },
          {
            $project: {
              _id: 0,
              ip: '$data.ip',
              broadcastedAt: 1,
              apps: '$data.apps',
              osUptime: '$data.osUptime',
              staticIp: '$data.staticIp',
              runningSince: '$data.runningSince',
            },
          },
        ], resolveReport),
        ...splitByMove('v1', [
          ...v1NameFilter,
          { $match: { type: 'apprunning', 'data.name': { $exists: true } } },
          {
            $group: {
              _id: { ip: '$ip', name: '$data.name' },
              doc: { $first: '$$ROOT' },
            },
          },
          { $replaceRoot: { newRoot: '$doc' } },
          {
            $project: {
              _id: 0,
              name: '$data.name',
              hash: '$data.hash',
              ip: '$data.ip',
              broadcastedAt: 1,
              runningSince: '$data.runningSince',
              osUptime: '$data.osUptime',
              staticIp: '$data.staticIp',
            },
          },
        ], resolveReport),
        v2Timestamps: [
          { $match: { type: 'apprunning', 'data.apps': { $exists: true } } },
          { $group: { _id: '$ip', latestV2: { $first: '$broadcastedAt' } } },
        ],
        ...splitByMove('removals', [
          { $match: { type: 'appremoved' } },
          ...removalNameFilter,
          {
            $group: {
              _id: { ip: '$ip', name: '$data.appName' },
              removedAt: { $first: '$broadcastedAt' },
            },
          },
        ], { $addFields: { '_id.ip': followMovesExpr('$_id.ip', '$removedAt', moves) } }),
        ...splitByMove('shutdowns', [
          { $match: { type: { $in: ['sigterm', 'evicted'] } } },
          { $addFields: { _eventAt: { $ifNull: ['$broadcastedAt', '$createdAt'] } } },
          { $sort: { _eventAt: -1 } },
          {
            $group: {
              _id: '$ip',
              eventAt: { $first: '$_eventAt' },
              expireAt: { $first: '$expireAt' },
              type: { $first: '$type' },
            },
          },
        ], { $addFields: { _id: followMovesExpr('$_id', '$eventAt', moves) } }),
      },
    },
    // A report keeps the address it was made at in `ip`; one made where a move leaves
    // gains the address its node holds now in `at`.
    ...(moves.length ? [{
      $addFields: Object.fromEntries(['v2', 'v1', 'removals', 'shutdowns']
        .map((name) => [name, { $concatArrays: [`$${name}`, `$${name}Moved`] }])),
    }] : []),
    // Filter v2 at IP level before unwinding — shutdown check against small array
    {
      $addFields: {
        _v2Filtered: {
          $filter: {
            input: '$v2',
            as: 'entry',
            cond: {
              $let: {
                vars: { sd: newestShutdownAt({ $ifNull: ['$$entry.at', '$$entry.ip'] }) },
                in: {
                  $or: [
                    { $eq: ['$$sd', null] },
                    { $gte: ['$$entry.broadcastedAt', '$$sd.eventAt'] },
                    { $and: [{ $eq: ['$$sd.type', 'sigterm'] }, { $gt: [{ $add: ['$$sd.eventAt', SIGTERM_EXPIRY_MS] }, now] }] },
                  ],
                },
              },
            },
          },
        },
      },
    },
    // Filter v1: newer than latest v2 for that IP and not shutdown
    {
      $addFields: {
        _v1Filtered: {
          $filter: {
            input: '$v1',
            as: 'entry',
            cond: {
              $and: [
                {
                  $let: {
                    vars: { v2Ts: { $first: { $filter: { input: '$v2Timestamps', as: 't', cond: { $eq: ['$$t._id', '$$entry.ip'] } } } } },
                    in: { $or: [{ $eq: ['$$v2Ts', null] }, { $gt: ['$$entry.broadcastedAt', '$$v2Ts.latestV2'] }] },
                  },
                },
                {
                  $let: {
                    vars: { sd: newestShutdownAt({ $ifNull: ['$$entry.at', '$$entry.ip'] }) },
                    in: {
                      $or: [
                        { $eq: ['$$sd', null] },
                        { $gte: ['$$entry.broadcastedAt', '$$sd.eventAt'] },
                        { $and: [{ $eq: ['$$sd.type', 'sigterm'] }, { $gt: [{ $add: ['$$sd.eventAt', SIGTERM_EXPIRY_MS] }, now] }] },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    // Unwind v2 apps and v1 into flat docs, apply per-app removal + IP change filters
    {
      $facet: {
        fromV2: [
          { $unwind: '$_v2Filtered' },
          { $unwind: '$_v2Filtered.apps' },
          ...(nameMatch ? [{ $match: { '_v2Filtered.apps.name': nameMatch } }] : []),
          {
            $project: {
              _id: 0,
              name: '$_v2Filtered.apps.name',
              hash: '$_v2Filtered.apps.hash',
              ip: { $ifNull: ['$_v2Filtered.at', '$_v2Filtered.ip'] },
              broadcastedAt: '$_v2Filtered.broadcastedAt',
              runningSince: { $ifNull: ['$_v2Filtered.apps.runningSince', '$_v2Filtered.runningSince'] },
              osUptime: '$_v2Filtered.osUptime',
              staticIp: '$_v2Filtered.staticIp',
              removals: 1,
            },
          },
          {
            $addFields: {
              // the newest: removals made at different addresses can resolve to one
              _removedAt: {
                $ifNull: [
                  { $max: { $map: {
                    input: { $filter: { input: '$removals', as: 'r', cond: { $and: [{ $eq: ['$$r._id.ip', '$ip'] }, { $eq: ['$$r._id.name', '$name'] }] } } },
                    as: 'r',
                    in: '$$r.removedAt',
                  } } },
                  new Date(0),
                ],
              },
            },
          },
          { $match: { $expr: { $gt: ['$broadcastedAt', '$_removedAt'] } } },
          { $project: { removals: 0, _removedAt: 0 } },
        ],
        fromV1: [
          { $unwind: '$_v1Filtered' },
          {
            $project: {
              _id: 0,
              name: '$_v1Filtered.name',
              hash: '$_v1Filtered.hash',
              ip: { $ifNull: ['$_v1Filtered.at', '$_v1Filtered.ip'] },
              broadcastedAt: '$_v1Filtered.broadcastedAt',
              runningSince: '$_v1Filtered.runningSince',
              osUptime: '$_v1Filtered.osUptime',
              staticIp: '$_v1Filtered.staticIp',
              removals: 1,
            },
          },
          {
            $addFields: {
              // the newest: removals made at different addresses can resolve to one
              _removedAt: {
                $ifNull: [
                  { $max: { $map: {
                    input: { $filter: { input: '$removals', as: 'r', cond: { $and: [{ $eq: ['$$r._id.ip', '$ip'] }, { $eq: ['$$r._id.name', '$name'] }] } } },
                    as: 'r',
                    in: '$$r.removedAt',
                  } } },
                  new Date(0),
                ],
              },
            },
          },
          { $match: { $expr: { $gt: ['$broadcastedAt', '$_removedAt'] } } },
          { $project: { removals: 0, _removedAt: 0 } },
        ],
      },
    },
    // Combine and dedup by {name, ip}, taking latest broadcastedAt
    { $project: { all: { $concatArrays: ['$fromV2', '$fromV1'] } } },
    { $unwind: '$all' },
    { $replaceRoot: { newRoot: '$all' } },
    { $sort: { broadcastedAt: -1 } },
    {
      $group: {
        _id: { name: '$name', ip: '$ip' },
        name: { $first: '$name' },
        hash: { $first: '$hash' },
        ip: { $first: '$ip' },
        broadcastedAt: { $first: '$broadcastedAt' },
        runningSince: { $first: '$runningSince' },
        osUptime: { $first: '$osUptime' },
        staticIp: { $first: '$staticIp' },
      },
    },
    { $project: { _id: 0 } },
  ];
  // the addresses that moved to `ip` are read too; what they said holds here only once resolved
  if (ip) pipeline.push({ $match: { ip } });

  const results = await collection.aggregate(pipeline).toArray();
  return results;
}

/**
 * Get app installing locations
 * @param {string} appname - Optional app name filter
 * @returns {Promise<Array>} Array of installing locations
 */
async function appInstallingLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingLocations, query, projection);
  return results;
}

/**
 * How many nodes are claiming each app, counted in one grouped pass.
 *
 * The spawner needs this for every candidate at once, to decide which apps
 * still need a node before it picks one. Asking per app would be a read per
 * candidate; this is a single scan of a collection that holds only live claims,
 * since they expire on a TTL index.
 *
 * Names are lowercased because an app is addressed case-insensitively
 * everywhere else here, so a caller must not have to know which case the
 * claiming node happened to send.
 * @returns {Promise<Map<string, number>>} Lowercased app name to claim count.
 */
async function installingCountsByApp() {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const rows = await dbHelper.aggregateInDatabase(database, globalAppsInstallingLocations, [
    { $group: { _id: { $toLower: '$name' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.count]));
}

/**
 * Get app installing errors locations for a specific app or all apps
 * @param {string} appname - Application name (optional)
 * @returns {Promise<Array>} Array of app installing error locations
 */
async function countAppInstallingErrors(hash) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  return dbHelper.countInDatabase(database, globalAppsInstallingErrorsLocations, { hash });
}

async function appInstallingErrorsLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      error: 1,
      broadcastedAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingErrorsLocations, query, projection);
  return results;
}

/**
 * Get app installing errors locations API endpoint
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsInstallingErrorsLocations(req, res) {
  try {
    const results = await appInstallingErrorsLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * Get a specific app's installing error locations API endpoint
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppInstallingErrorsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingErrorsLocation(appname);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * Store an app installing message in the database
 * @param {object} message - App installing message
 * @returns {Promise<boolean>} True if stored successfully, false if message is old/duplicate
 */
async function storeAppInstallingMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string') {
    throw new Error('Invalid Flux App Installing message for storing');
  }

  if (message.version !== 1) {
    throw new Error(`Invalid Flux App Installing message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (5 * 60 * 1000); // 5 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstalling message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingMessage = {
    name: message.name,
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
  const queryFind = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  const queryUpdate = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const update = { $set: newAppInstallingMessage };
  const options = {
    upsert: true,
  };
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingLocations, queryUpdate, update, options);

  // all stored, rebroadcast
  return true;
}

/**
 * To return the owner of a FluxOS application.
 * @param {string} appName Name of app.
 * @returns {string|null} Owner.
 */
async function getApplicationOwner(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
      owner: 1,
    },
  };
  const globalAppsInfoCollection = config.database.appsglobal.collections.appsInformation;
  const appSpecs = await dbHelper.findOneInDatabase(database, globalAppsInfoCollection, query, projection);
  if (appSpecs) {
    return appSpecs.owner;
  }
  // eslint-disable-next-line no-use-before-define
  const allApps = await availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  if (appInfo) {
    return appInfo.owner;
  }
  return null;
}

/**
 * Get all app locations via API
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 */
async function getAppsLocations(_req, res) {
  try {
    const results = await appLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * Get specific app location via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppsLocation(req, res) {
  try {
    let { appname } = req?.params || {};
    appname = appname || req?.query?.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appLocation(appname);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * Get specific app installing location via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getAppInstallingLocation(req, res) {
  try {
    let { appname } = req?.params || {};
    appname = appname || req?.query?.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingLocation(appname);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * Get global app specifications for a specific app
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specifications
 */
async function getApplicationGlobalSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const dbAppSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

  // Decrypt and format specifications if needed
  let appSpec = await checkAndDecryptAppSpecs(dbAppSpec);
  if (appSpec && appSpec.version >= 8 && appSpec.enterprise) {
    const { height, hash } = appSpec;
    appSpec = specificationFormatter(appSpec);
    appSpec.height = height;
    appSpec.hash = hash;
  }
  return appSpec;
}

/**
 * Get local app specifications for a specific app
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specifications
 */
async function getApplicationLocalSpecifications(appName) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appslocal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = { projection: { _id: 0 } };

  const appInfo = await dbHelper.findOneInDatabase(database, localAppsInformation, query, projection);
  return appInfo;
}

/**
 * Get app specifications (tries global first, then local)
 * @param {string} appName - Application name
 * @returns {Promise<object|null>} App specifications
 */
async function getApplicationSpecifications(appName) {
  // appSpecs: {
  //   version: 2,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]', // []
  //   containerPorts: '[7396]', // []
  //   domains: '[""]', // []
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    // eslint-disable-next-line no-use-before-define
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  }

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  appInfo = await checkAndDecryptAppSpecs(appInfo);
  if (appInfo && appInfo.version >= 8 && appInfo.enterprise) {
    const { height, hash } = appInfo;
    appInfo = specificationFormatter(appInfo);
    appInfo.height = height;
    appInfo.hash = hash;
  }
  return appInfo;
}

/**
 * What the flux team may know about an app whose specification they cannot
 * read: the names of its components, whether each is election managed, and what
 * the app costs in total.
 *
 * Deliberately NOT specification-shaped. A redacted specification is the
 * dangerous thing here: it is indistinguishable from a complete one, so an
 * update composed from it writes its blanks back over the customer's app.
 * Nothing can mistake this shape for a spec or submit it as one.
 *
 * Two different claims, which is why they are two fields:
 *
 * `resources` is public information that happens to be sealed today. v9 keeps
 * the totals OUTSIDE the encrypted envelope on purpose - a node has to judge
 * whether it can host an app without being able to read it - and binds them
 * into the AAD so a relayer cannot understate them. Returning them here is that
 * same decision, made for a spec version that has not shipped it yet.
 *
 * `components` is not. v9 seals the component list and publishes only a count,
 * so handing over the names is a deliberate exception rather than a claim they
 * are harmless: the container tools address a component as `<component>_<app>`,
 * so logs, terminal, monitoring and file changes cannot function without them.
 * The exception is granted to an authenticated flux team caller, on a node that
 * already holds the plaintext, and to nobody else.
 *
 * Withheld either way: environment parameters, repository credentials, secrets,
 * commands, image tags, ports and domains.
 *
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getApplicationComponentNamesAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    const mainAppName = appname.split('_')[1] || appname;

    // fluxteam, not appownerorfluxteam: an owner reads the specification itself
    // and has no use for this, and the node operator is not a party to a
    // customer's app at all.
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }

    const specifications = await getApplicationSpecifications(mainAppName);
    if (!specifications) {
      throw new Error(`Application: ${mainAppName} not found`);
    }

    const components = specifications.version >= 4 && Array.isArray(specifications.compose)
      ? specifications.compose
      : [specifications];

    // Totals, not per-component sizing: it is what an app costs, it is what the
    // app list renders, and it is the granularity v9 publishes. Named for the
    // fields a v8 spec carries - v9 calls the same three cpu, memoryMb and
    // storageGb.
    const resources = components.reduce((total, component) => ({
      cpu: total.cpu + (Number(component.cpu) || 0),
      ram: total.ram + (Number(component.ram) || 0),
      hdd: total.hdd + (Number(component.hdd) || 0),
    }), { cpu: 0, ram: 0, hdd: 0 });

    const response = messageHelper.createDataMessage({
      components: components.map((component) => ({
        name: component.name,
        // The classifier the election itself uses. A sync flag counts only on the
        // primary mount, so this must agree with what decides the component's
        // fate rather than with anywhere the letters happen to appear.
        masterSlave: mountParser.isGComponent(component.containerData || ''),
      })),
      resources,
    });

    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

/**
 * Get application specification via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getApplicationSpecificationAPI(req, res) {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { height: daemonHeight } } = syncStatus;

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // query params take precedence over params (they were set explictly)
    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    const mainAppName = appname.split('_')[1] || appname;

    if (!specifications) {
      throw new Error(`Application: ${appname} not found`);
    }

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    if (!decrypt) {
      if (isEnterprise) {
        specifications.compose = [];
        specifications.contacts = [];
      }

      const specResponse = messageHelper.createDataMessage(specifications);
      res.json(specResponse);
      return null;
    }

    if (!isEnterprise) {
      throw new Error('App spec decryption is only possible for version 8+ Apps.');
    }

    const encryptedEnterpriseKey = req.headers['enterprise-key'];
    if (!encryptedEnterpriseKey) {
      throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
    }

    // Decrypting a spec is the owner's alone. A partly-redacted one would be
    // neither usable nor safe: an update composed from a spec whose
    // environmentParameters and repoauth have been blanked writes those blanks
    // back over the customer's app, and everything left in it is still theirs.
    //
    // The flux team decrypts out of band instead, which keeps a decryption a
    // deliberate act by a named person rather than a side effect of opening a
    // page.
    const authorized = await verificationHelper.verifyPrivilege(
      Privilege.APP_OWNER,
      authOf(req),
      { appName: mainAppName },
    );

    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    // this seems a bit weird, but the client can ask for the specs encrypted or decrypted.
    // If decrypted, they pass us another session key and we use that to encrypt.
    specifications.enterprise = await encryptEnterpriseFromSession(
      specifications,
      daemonHeight,
      encryptedEnterpriseKey,
    );

    specifications.contacts = [];
    specifications.compose = [];

    const specResponse = messageHelper.createDataMessage(specifications);
    res.json(specResponse);
  } catch (error) {
    log.error(error);

    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );

    res.json(errorResponse);
  }

  return null;
}

/**
 * Get application owner via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function getApplicationOwnerAPI(req, res) {
  try {
    let { appname } = req?.params || {};
    appname = appname || req?.query?.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const owner = await getApplicationOwner(appname);
    if (!owner) {
      throw new Error('Application not found');
    }
    const ownerResponse = messageHelper.createDataMessage(owner);
    res.json(ownerResponse);
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
 * Update application specification to latest version via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<object|null>} Response with updated specifications
 */
async function updateApplicationSpecificationAPI(req, res) {
  try {
    const { appname } = req.params;
    if (!appname) {
      throw new Error('appname parameter is mandatory');
    }

    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { height: daemonHeight } } = syncStatus;

    const specifications = await getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    let encryptedEnterpriseKey = null;
    if (isEnterprise) {
      encryptedEnterpriseKey = req.headers['enterprise-key'];
      if (!encryptedEnterpriseKey) {
        throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
      }
    }

    // The owner alone, as for the decrypt path above. This upgrades the stored
    // spec and hands it back whole, encrypted to a session key the caller
    // supplies - environmentParameters and repoauth included - which is the
    // spec its owner is about to re-sign, and nobody else's business.
    const authorized = await verificationHelper.verifyPrivilege(
      Privilege.APP_OWNER,
      authOf(req),
      { appName: mainAppName },
    );

    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    const updatedSpecs = updateToLatestAppSpecifications(specifications);

    if (isEnterprise) {
      const enterprise = await encryptEnterpriseFromSession(
        updatedSpecs,
        daemonHeight,
        encryptedEnterpriseKey,
      );

      updatedSpecs.enterprise = enterprise;
      updatedSpecs.contacts = [];
      updatedSpecs.compose = [];
    }

    const specResponse = messageHelper.createDataMessage(updatedSpecs);
    res.json(specResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
  return null;
}

/**
 * Get global apps specifications via API
 * @param {object} req - Request object with optional params/query for hash, owner, appname
 * @param {object} res - Response object
 */
async function getGlobalAppsSpecifications(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    let { owner } = req.params;
    owner = owner || req.query.owner;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (hash) {
      query.hash = hash;
    }
    if (owner) {
      query.owner = owner;
    }
    if (appname) {
      query.name = appname;
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
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
 * Get available apps (both global and local)
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 */
async function availableApps(_req, res) {
  try {
    // Get global apps
    const globalDb = dbHelper.databaseConnection();
    const globalDatabase = globalDb.db(config.database.appsglobal.database);
    const globalQuery = {};
    const globalProjection = { projection: { _id: 0 } };
    const globalApps = await dbHelper.findInDatabase(globalDatabase, globalAppsInformation, globalQuery, globalProjection);

    // Get local apps
    const localDb = dbHelper.databaseConnection();
    const localDatabase = localDb.db(config.database.appslocal.database);
    const localQuery = {};
    const localProjection = { projection: { _id: 0 } };
    const localApps = await dbHelper.findInDatabase(localDatabase, localAppsInformation, localQuery, localProjection);

    const allApps = [...globalApps, ...localApps];

    if (res) {
      const resultsResponse = messageHelper.createDataMessage(allApps);
      return res.json(resultsResponse);
    }
    return allApps;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Check for registration name conflicts
 * @param {object} appSpecFormatted - Application specifications
 * @param {string} hash - Application hash
 * @returns {Promise<boolean>} True if no conflicts found
 */
async function checkApplicationRegistrationNameConflicts(appSpecFormatted, hash) {
  // check if name is not yet registered
  const dbopen = dbHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') }; // case insensitive
  const appsProjection = {
    projection: {
      _id: 0,
      name: 1,
      height: 1,
      expire: 1,
    },
  };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsInformation, appsQuery, appsProjection);

  if (appResult) {
    // in this case, check if hash of the message is older than our current app
    if (hash) {
      // check if we have the hash of the app in our db
      const query = { hash };
      const projection = {
        projection: {
          _id: 0,
          txid: 1,
          hash: 1,
          height: 1,
        },
      };
      const database = dbopen.db(config.database.daemon.database);
      const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
      if (!result) {
        throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash not found in collection.`);
      }
      if (appResult.height <= result.height) {
        log.debug(appResult);
        log.debug(result);
        // Determine default expire based on whether app was registered after PON fork
        const defaultExpire = appResult.height >= config.fluxapps.daemonPONFork ? 88000 : 22000;
        const expireIn = appResult.expire || defaultExpire;
        let currentExpiration = appResult.height + expireIn;

        // If app was registered before fork block and expiration extends past fork block
        // the chain moves 4x faster, so we need to adjust the expiration
        if (appResult.height < config.fluxapps.daemonPONFork && currentExpiration > config.fluxapps.daemonPONFork) {
          // Calculate blocks that were supposed to live after fork block
          const blocksAfterFork = currentExpiration - config.fluxapps.daemonPONFork;
          // Multiply by 4 to account for 4x faster chain
          const adjustedBlocksAfterFork = blocksAfterFork * 4;
          // New expiration = fork block + adjusted blocks
          currentExpiration = config.fluxapps.daemonPONFork + adjustedBlocksAfterFork;
        }

        if (currentExpiration >= result.height) {
          throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash is not older than our current app.`);
        } else {
          log.warn(`Flux App ${appSpecFormatted.name} active specifications are outdated. Will be cleaned on next expiration`);
        }
      } else {
        throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash is older than our current app.`);
      }
    } else {
      throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name.`);
    }
  }

  const localApps = await availableApps();
  const appExists = localApps.find((localApp) => localApp.name.toLowerCase() === appSpecFormatted.name.toLowerCase());
  if (appExists) {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to local application. Flux App has to be registered under different name.`);
  }
  if (appSpecFormatted.name.toLowerCase() === 'share') {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to Flux main application. Flux App has to be registered under different name.`);
  }
  return true;
}

/**
 * Get installed apps information
 * @returns {Promise<Array>} Array of installed apps. Rejects when the read fails:
 *   an unread list is not an empty one.
 */
async function getInstalledApps() {
  const localDb = dbHelper.databaseConnection();
  const localDatabase = localDb.db(config.database.appslocal.database);
  const projection = { projection: { _id: 0 } };
  return dbHelper.findInDatabase(localDatabase, localAppsInformation, {}, projection);
}

/**
 * To get all apps running on a specific IP address. Returns all apps running on this ip
 * @param {string} ip An IP, or a socket address whose IP is meant.
 * @returns {Promise<Array>} Array of apps running on the specified IP
 */
async function getRunningAppIpList(ip) {
  const atIp = storedAtIp(ip);
  if (!atIp) return [];
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const query = { ip: atIp };
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
      runningSince: 1,
      osUptime: 1,
      staticIp: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

/**
 * Get registration information for Flux apps
 * @param {object} _req - Request object (unused)
 * @param {object} res - Response object
 * @returns {void} Registration information
 */
function registrationInformation(_req, res) {
  try {
    const data = config.fluxapps;
    const response = messageHelper.createDataMessage(data);
    res.json(response);
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
 * Remove expired applications from global database and local installations
 * @returns {Promise<void>} Completion status
 */
async function expireGlobalApplications() {
  // check if synced
  try {
    // get current height
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);
    // get all global applications specifications and evaluate expiration per app below
    const databaseApps = dbopen.db(config.database.appsglobal.database);
    const queryApps = {};
    const projectionApps = {
      projection: {
        _id: 0, name: 1, hash: 1, expire: 1, height: 1,
      },
    };
    // Read, decide and delete under the registry write lock: a promotion cannot store a renewal
    // between the read and the delete, and a rebuild's rename cannot bring back an app deleted here.
    const appNamesToExpire = await withRegistryWrite(async () => {
      const results = await dbHelper.findInDatabase(databaseApps, globalAppsInformation, queryApps, projectionApps);
      const appsToExpire = results.filter((appSpecs) => !appMessageChain.isInForce(appSpecs.height, appSpecs.expire, explorerHeight));
      const expired = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const app of appsToExpire) {
        // Delete the spec that was read as expired, not whatever holds the name now.
        // eslint-disable-next-line no-await-in-loop
        const deleted = await dbHelper.findOneAndDeleteInDatabase(databaseApps, globalAppsInformation, { name: app.name, hash: app.hash }, projectionApps);
        if (!deleted) {
          log.info(`Application ${app.name} was updated while expiring, keeping it`);
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`Expiring application ${app.name}`);
        expired.push(app.name);

        const queryDeleteAppErrors = { name: app.name };
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.removeDocumentsFromCollection(databaseApps, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.removeDocumentsFromCollection(databaseApps, globalAppsInstallingErrorsBroadcasts, { 'data.name': app.name });
      }
      return expired;
    });

    // get list of locally installed apps.
    // Use dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const appQueryService = require('../appQuery/appQueryService');
    const installedAppsRes = await appQueryService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // remove any installed app which height is lower (or not present) but is not infinite app
    const appsToRemove = [];
    const locallyExpired = [];
    appsInstalled.forEach((app) => {
      // An app being tested has no height until it is registered, and its test
      // removes it when it ends.
      if (globalState.testInstallingApps.has(app.name)) return;
      if (appNamesToExpire.includes(app.name)) {
        appsToRemove.push(app);
      } else if (!app.height) {
        appsToRemove.push(app);
      } else if (app.height === 0) {
        // do nothing, forever lasting local app
      } else if (!appMessageChain.isInForce(app.height, app.expire, explorerHeight)) {
        locallyExpired.push(app);
      }
    });
    // The installed record is only refreshed from a renewal by reinstallOldApplications, every
    // 16-36 blocks, so for a while after a renewal it still carries the old expiry. Ask the
    // global spec before uninstalling: removing an app the network has just renewed deletes
    // its data on this node for nothing.
    if (locallyExpired.length) {
      const globalSpecs = await dbHelper.findInDatabase(
        databaseApps,
        globalAppsInformation,
        { name: { $in: locallyExpired.map((app) => app.name) } },
        {
          projection: {
            _id: 0, name: 1, owner: 1, expire: 1, height: 1,
          },
        },
      );
      locallyExpired.forEach((app) => {
        const globalSpec = globalSpecs.find((spec) => spec.name === app.name);
        // the same owner's app, not a re-registration of its released name by someone else
        if (globalSpec && signatureVerifier.sameSigningIdentity(globalSpec.owner, app.owner)
          && appMessageChain.isInForce(globalSpec.height, globalSpec.expire, explorerHeight)) {
          log.info(`Application ${app.name} is expired locally but renewed on the network, keeping it`);
          return;
        }
        appsToRemove.push(app);
      });
    }
    const appsToRemoveNames = appsToRemove.map((app) => app.name);
    appsToRemoveNames.forEach((appName) => {
      log.warn(`Application ${appName} is expired, removing`);
      log.warn(`REMOVAL REASON: App expired - ${appName} reached expiration date (registryManager)`);
    });
    localRemovalQueue.queueRemovals(appsToRemoveNames);
  } catch (error) {
    log.error(error);
  }
}

/**
 * The permanent messages of an app name that count (appMessageChain.messagesThatCount), oldest
 * first.
 * @param {string} appName
 * @returns {Promise<object[]>}
 */
async function appMessagesThatCount(appName) {
  const db = dbHelper.databaseConnection();
  const messages = await dbHelper.findInDatabase(
    db.db(config.database.appsglobal.database),
    globalAppsMessages,
    { 'appSpecifications.name': appName },
    { projection: { _id: 0 } },
  );
  return dbHelper.appMessagesThatCount(db.db(config.database.daemon.database), messages);
}

/**
 * The permanent message that governs an app: the newest that counts (appMessageChain), or null.
 * @param {string} appName
 * @returns {Promise<object|null>}
 */
async function governingAppMessage(appName) {
  const counted = await appMessagesThatCount(appName);
  return counted.length > 0 ? counted[counted.length - 1] : null;
}

/**
 * Whether a permanent message is the one that governs its app: the newest that counts
 * (appMessageChain). A message fetched late (missing-hash sync) must not end an app that a newer
 * message keeps alive, and another owner's registration of a held name governs nothing.
 * @param {string} appName
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function isGoverningAppMessage(appName, hash) {
  const governing = await governingAppMessage(appName);
  return governing !== null && governing.hash === hash;
}

/**
 * Stores a promoted message's specifications as its app's global spec when that message is in
 * force (appMessageChain): the one that governs the name in the message log, and alive at the
 * current block. Any other message changes nothing: a newer one governs the app, or its term has ended.
 * A registration and an update are stored alike, so an update renews an app this node's expiry
 * pass has already removed, and this node holds what a rebuild from the log would. A row that
 * already holds this message at this height is left as it is.
 * @param {object} appSpecs the message's specifications, with its hash and height
 * @returns {Promise<void>} Rejects when a read or the write fails: the caller decides what an
 *   unwritten registry row costs it.
 */
async function storeAppSpecificationInForce(appSpecs) {
  return withRegistryWrite(async () => {
    if (!await isGoverningAppMessage(appSpecs.name, appSpecs.hash)) return;
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const currentHeight = syncStatus && syncStatus.data ? syncStatus.data.height : 0;
    if (!appMessageChain.isInForce(appSpecs.height, appSpecs.expire, currentHeight)) return;
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const held = await dbHelper.findOneInDatabase(database, globalAppsInformation, { name: appSpecs.name }, { projection: { _id: 0, hash: 1, height: 1 } });
    if (held && held.hash === appSpecs.hash && held.height === appSpecs.height) return;
    await dbHelper.replaceOneInDatabase(database, globalAppsInformation, { name: appSpecs.name }, appSpecs, { upsert: true });
    fluxEventBus.publish('app:specStored', { name: appSpecs.name, hash: appSpecs.hash });
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingErrorsLocations, { name: appSpecs.name });
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingErrorsBroadcasts, { 'data.name': appSpecs.name });
  });
}

async function rebuildRegistry() {
  log.info('Reindexing global application list');

  const db = dbHelper.databaseConnection();
  const appsGlobalDb = db.db(config.database.appsglobal.database);
  const appsLocalDb = db.db(config.database.appslocal.database);
  const daemonDb = db.db(config.database.daemon.database);

  const scannedHeightResult = await dbHelper.findOneInDatabase(
    daemonDb,
    scannedHeightCollection,
    { generalScannedHeight: { $gte: 0 } },
    { projection: { _id: 0, generalScannedHeight: 1 } },
  );
  if (!scannedHeightResult) {
    throw new Error('Scanning not initiated');
  }
  const scannedHeight = serviceHelper.ensureNumber(
    scannedHeightResult.generalScannedHeight,
  );

  const appsToRemove = await dbHelper.reindexGlobalAppsInformation(
    appsGlobalDb,
    appsLocalDb,
    globalAppsMessages,
    globalAppsInformation,
    localAppsInformation,
    scannedHeight,
    daemonDb,
  );

  log.info('Reindexing of global application list finished.');

  appsToRemove.forEach((appName) => {
    log.warn(`Application ${appName} is expired, removing`);
    log.warn(`REMOVAL REASON: App expired - ${appName} reached expiration date (reindex)`);
  });
  localRemovalQueue.queueRemovals(appsToRemove);
}

async function runRebuild() {
  try {
    await rebuildRegistry();
  } catch (error) {
    log.error(error);
    throw error;
  } finally {
    rebuildRunning = null;
  }
}

async function rebuildAfter(running) {
  try {
    await running;
  } catch {
    // the rebuild that follows reads the log afresh, whatever this one did
  }
  rebuildFollowing = null;
  // eslint-disable-next-line no-use-before-define
  return reindexGlobalAppsInformation();
}

/**
 * Rebuild the global apps information collection from the message log, and queue the removal of
 * every installed app it no longer lists (localRemovalQueue).
 *
 * Resolves once a rebuild that began after this call has swapped the registry in, without
 * waiting for the removals. A call made while a rebuild runs is answered by one more rebuild after
 * it, which every such call shares, so a message stored after the running rebuild read the log is
 * in the registry this call resolves with.
 *
 * @returns {Promise<true>}
 */
async function reindexGlobalAppsInformation() {
  if (!rebuildRunning) {
    rebuildRunning = runRebuild();
    await rebuildRunning;
    return true;
  }
  if (!rebuildFollowing) rebuildFollowing = rebuildAfter(rebuildRunning);
  return rebuildFollowing;
}

// Hash records corrected per round trip.
const HASH_RECONSTRUCTION_BATCH = 5000;

/**
 * Brings each payment record's `message` flag to whether this node stores that message. A record
 * whose message is gone is looked for afresh, as a payment never looked for. Reads only the
 * fields it compares, and writes its corrections HASH_RECONSTRUCTION_BATCH at a time.
 * @returns {Promise<{changed: number}>}
 */
async function reconstructAppMessagesHashCollection() {
  try {
    const db = dbHelper.databaseConnection();
    const databaseApps = db.db(config.database.appsglobal.database);
    const databaseDaemon = db.db(config.database.daemon.database);

    const permanentMessages = await dbHelper.findInDatabase(databaseApps, globalAppsMessages, {}, { projection: { _id: 0, hash: 1 } });
    const appHashes = await dbHelper.findInDatabase(databaseDaemon, appsHashesCollection, {}, {
      projection: {
        _id: 0, hash: 1, txid: 1, message: 1, messageNotFound: 1,
      },
    });
    const permHashSet = new Set(permanentMessages.map((m) => m.hash));

    const ops = [];
    let markedMissing = 0;
    // eslint-disable-next-line no-restricted-syntax
    for (const appHash of appHashes) {
      const filter = { hash: appHash.hash, txid: appHash.txid };
      const hasPermanent = permHashSet.has(appHash.hash);

      if (hasPermanent && (!appHash.message || appHash.messageNotFound)) {
        ops.push({ updateOne: { filter, update: { $set: { message: true, messageNotFound: false } } } });
      } else if (!hasPermanent && appHash.message) {
        markedMissing += 1;
        ops.push({
          updateOne: {
            filter,
            update: {
              $set: { message: false, messageNotFound: false, syncAttempts: 0 },
              $unset: { nextRetryHeight: '', retryFromHeight: '' },
            },
          },
        });
      }
    }

    let changed = 0;
    for (let i = 0; i < ops.length; i += HASH_RECONSTRUCTION_BATCH) {
      // eslint-disable-next-line no-await-in-loop
      const result = await databaseDaemon.collection(appsHashesCollection).bulkWrite(ops.slice(i, i + HASH_RECONSTRUCTION_BATCH), { ordered: false });
      changed += result.modifiedCount;
    }

    // a message this node no longer holds is fetched from peers on the next block
    if (markedMissing > 0) appSyncEvents.emit(SYNC_EVENTS.HASH_UNRESOLVED);

    return { changed };
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * API endpoint to reconstruct app messages hash collection
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<object>} Reconstruction result message
 */
async function reconstructAppMessagesHashCollectionAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized) {
      const result = await reconstructAppMessagesHashCollection();
      const message = messageHelper.createSuccessMessage(result);
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
 * To register an application globally via API. Only accessible by authorized users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function registerAppGlobalyApi(req, res) {
  // Import dependencies needed for this function
  // eslint-disable-next-line global-require
  const generalService = require('../generalService');
  // eslint-disable-next-line global-require
  const appUtilities = require('../utils/appUtilities');
  // eslint-disable-next-line global-require
  const appValidator = require('../appRequirements/appValidator');
  // eslint-disable-next-line global-require
  const imageManager = require('../appSecurity/imageManager');
  // eslint-disable-next-line global-require
  const messageVerifier = require('../appMessaging/messageVerifier');
  // eslint-disable-next-line global-require
  const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
  // eslint-disable-next-line global-require
  const { peerManager } = require('../utils/peerState');

  const isArcane = Boolean(process.env.FLUXOS_PATH);

  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      // first check if this node is available for application registration
      if (peerManager.outboundCount < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (peerManager.inboundCount < config.fluxapps.minIncoming) {
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

      if (appSpecification.version >= 8 && appSpecification.enterprise) {
        verifyAppNameAndOwner(appSpecification.name, appSpecification.owner);
      }

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = await appUtilities.specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await appValidator.verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      // placement feasibility at the front door, while the spec is still
      // decrypted: an impossible spec is rejected before it is paid for, a
      // diversity-constrained one is accepted with a warning
      await placementFeasibility.checkPlacementFeasibility(appSpecFormatted, 'registerAppGlobalyApi');

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
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? await appUtilities.specificationFormatter(appSpecification)
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

/**
 * Drops and recreates global apps locations collection with indexes
 * @returns {Promise<boolean>} True if successful
 */
async function reindexGlobalAppsLocation() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsLocations).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await dbHelper.dropCollection(database, globalAppStateEvents).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppStateEvents).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    await database.collection(globalAppStateEvents).createIndex({ ip: 1, type: 1, dedupKey: 1 }, { unique: true });
    await database.collection(globalAppStateEvents).createIndex({ broadcastedAt: 1 });
    await database.collection(globalAppStateEvents).createIndex({ createdAt: 1 });
    await database.collection(globalAppStateEvents).createIndex({ type: 1, expireAt: 1 }, { name: 'events by type and expiry' });
    await database.collection(globalAppStateEvents).createIndex({ 'data.newIP': 1 }, { name: 'moves by the address they lead to', partialFilterExpression: { type: 'ipchanged' } });
    await database.collection(globalAppsLocations).createIndex({ name: 1 }, { name: 'query for getting app location based on app specs name' });
    await database.collection(globalAppsLocations).createIndex({ hash: 1 }, { name: 'query for getting app location based on app hash' });
    await database.collection(globalAppsLocations).createIndex({ ip: 1 }, { name: 'query for getting app location based on ip' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting app based on ip and name' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1, broadcastedAt: 1 }, { name: 'query for getting app to ensure we possess a message' });
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To reindex global apps location via API.
 *
 * Flux team only. It drops the location store and the app state events, and
 * until peers announce again this node serves every location read from an
 * empty store.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    if (authorized === true) {
      await reindexGlobalAppsLocation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
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
 * To reindex global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized === true) {
      await reindexGlobalAppsInformation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
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
 * Rescans global apps information from messages collection starting from a specific height
 * @param {number} height - Starting block height for rescan (default 0)
 * @param {boolean} removeLastInformation - Whether to remove existing information before rescanning (default false)
 * @returns {Promise<boolean>} True if successful
 */
async function rescanGlobalAppsInformation(height = 0, removeLastInformation = false) {
  // Rebuilt from the whole message log by the same rule as the reindex: an app not updated since
  // the requested height is still in force, so a partial replay would lose it.
  log.info(`rescanGlobalAppsInformation - rebuilding from the full message log (requested from ${height}, removeLastInformation ${removeLastInformation})`);
  await reindexGlobalAppsInformation();
  return true;
}

/**
 * To rescan global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
        return;
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      let { removelastinformation } = req.params;
      removelastinformation = removelastinformation || req.query.removelastinformation || false;
      removelastinformation = serviceHelper.ensureBoolean(removelastinformation);

      await rescanGlobalAppsInformation(blockheight, removelastinformation);
      const message = messageHelper.createSuccessMessage('Rescan successfull');
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
 * To get previous app specifications from the permanent message log. Used when
 * verifying an app update message: the prior registration/update spec may no
 * longer be in global apps (e.g. the app expired), so the message log is the
 * accurate source. Lives here (not in advancedWorkflows) so message verification
 * does not depend on the lifecycle layer — that was a require cycle.
 * @param {object} specifications App specifications.
 * @param {number} [beforeHeight] Block of the message being verified, when it is on chain
 *   (promotion, replay). Omitted for a live submission, which builds on the newest message.
 * @param {number} [beforeTimestamp] Its timestamp: a message in the same block signed earlier
 *   (a registration paid in the same block as its first update) counts as before it.
 * @returns {object|null} App specifications or null if not found.
 */
async function getPreviousAppSpecifications(specifications, beforeHeight, beforeTimestamp) {
  // we may not have the application in global apps. This can happen when we receive the message
  // after the app has already expired AND we need to get message right before our message.
  // Thus using messages system that is accurate
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appsQuery = {
    'appSpecifications.name': specifications.name,
  };
  const logged = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
  // Only a message that counts can be the previous spec: another owner's registration of a name
  // held at its block holds nothing (appMessageChain).
  const permanentAppMessage = await dbHelper.appMessagesThatCount(db.db(config.database.daemon.database), logged);
  // The previous spec is the message right below ours on chain: the highest height under the
  // block ours confirmed in (in that block, one signed before ours), or, for a live submission
  // not yet on chain, the newest one. The bulk hash sync replays history by the same rule
  // (appHashSyncService findPrevSpec), so a node that synced in bulk and one that followed live
  // judge a message the same way.
  //
  // Chain position, not the signed timestamp: messages confirm out of signing order, and the
  // timestamp is the signer's to choose, so a former owner could backdate an update to before
  // the transfer that took the app from them. A same-block tie goes to the later timestamp.
  const validTypes = ['zelappregister', 'fluxappregister', 'zelappupdate', 'fluxappupdate'];
  const below = beforeHeight === undefined || beforeHeight === null ? Infinity : beforeHeight;
  const signedBefore = beforeTimestamp === undefined || beforeTimestamp === null ? -Infinity : beforeTimestamp;
  let latestPermanentRegistrationMessage;
  permanentAppMessage.forEach((foundMessage) => {
    if (!validTypes.includes(foundMessage.type) || !appMessageChain.isBefore(foundMessage, below, signedBefore)) return;
    const latest = latestPermanentRegistrationMessage;
    if (!latest
      || (foundMessage.height || 0) > (latest.height || 0)
      || ((foundMessage.height || 0) === (latest.height || 0) && foundMessage.timestamp > latest.timestamp)) {
      latestPermanentRegistrationMessage = foundMessage;
    }
  });
  if (!latestPermanentRegistrationMessage) {
    return null;
  }
  const appSpecs = latestPermanentRegistrationMessage.appSpecifications;
  if (!appSpecs) {
    throw new Error(`Previous specifications for ${specifications.name} update message does not exists! This should not happen.`);
  }
  if (appSpecs.version >= 8 && appSpecs.enterprise) {
    try {
      const heightForDecrypt = latestPermanentRegistrationMessage.height;
      const decryptedPrev = await checkAndDecryptAppSpecs(appSpecs, { daemonHeight: heightForDecrypt });
      return specificationFormatter(decryptedPrev);
    } catch {
      return specificationFormatter(appSpecs);
    }
  }
  return specificationFormatter(appSpecs);
}

/**
 * Nodes that have announced a shutdown and not come back: the newest state
 * event from each is a sigterm still inside SIGTERM_EXPIRY_MS, with no apprunning
 * broadcast after it.
 *
 * @returns {Promise<string[]>} Their socket addresses
 */
async function shuttingDownNodes() {
  const db = dbHelper.databaseConnection();
  const events = db.db(config.database.appsglobal.database).collection(globalAppStateEvents);
  const since = new Date(Date.now() - SIGTERM_EXPIRY_MS);
  const sigterms = await events.find(
    { type: 'sigterm', broadcastedAt: { $gt: since } },
    { projection: { _id: 0, ip: 1, broadcastedAt: 1 } },
  ).toArray();
  const departing = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const { ip, broadcastedAt } of sigterms) {
    // eslint-disable-next-line no-await-in-loop
    const back = await events.findOne(
      { ip, type: 'apprunning', broadcastedAt: { $gt: broadcastedAt } },
      { projection: { _id: 1 } },
    );
    if (!back) departing.push(ip);
  }
  return departing;
}

module.exports = {
  appsListedAt,
  shuttingDownNodes,
  getAppHashes,
  getRegistryStatus,
  getPreviousAppSpecifications,
  appLocation,
  addressMovesFrom,
  addressMovesTo,
  addressesMovedFromIp,
  currentAddressesOf,
  addressesLeadingTo,
  listedNodeMovedTo,
  followAddressMoves,
  primaryAddressOf,
  appLocationFromEvents,
  signedHoldersOf,
  appInstallingLocation,
  installingCountsByApp,
  appInstallingErrorsLocation,
  countAppInstallingErrors,
  storeAppInstallingMessage,
  getAppsLocations,
  getAppsLocation,
  getAppInstallingLocation,
  getAppInstallingErrorsLocation,
  getAppsInstallingErrorsLocations,
  getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications,
  getApplicationSpecifications,
  getApplicationComponentNamesAPI,
  getApplicationSpecificationAPI,
  updateApplicationSpecificationAPI,
  getApplicationOwner,
  getApplicationOwnerAPI,
  getGlobalAppsSpecifications,
  availableApps,
  checkApplicationRegistrationNameConflicts,
  storeAppSpecificationInForce,
  governingAppMessage,
  isGoverningAppMessage,
  getInstalledApps,
  getRunningAppIpList,
  registrationInformation,
  expireGlobalApplications,
  reindexGlobalAppsInformation,
  reindexGlobalAppsLocation,
  rescanGlobalAppsInformation,
  reconstructAppMessagesHashCollection,
  reconstructAppMessagesHashCollectionAPI,
  registerAppGlobalyApi,
  reindexGlobalAppsLocationAPI,
  reindexGlobalAppsInformationAPI,
  rescanGlobalAppsInformationAPI,
};
