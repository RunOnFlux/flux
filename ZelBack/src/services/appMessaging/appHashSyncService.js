const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const messageStore = require('./messageStore');
const messageVerifier = require('./messageVerifier');
const appValidator = require('../appRequirements/appValidator');
const registryManager = require('../appDatabase/registryManager');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { appPricePerMonth } = require('../utils/appUtilities');
const { getChainParamsPriceUpdates } = require('../utils/chainUtilities');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const { serialiseAndSignFluxBroadcast } = require('../utils/fluxBroadcastHelper');
const log = require('../../lib/log');
const { invalidMessages } = require('../invalidMessages');

const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

const SETTLE_TIME_MS = 4000;
const RESPONSE_TIME_PER_HASH_MS = 150;
const BUFFER_MS = 5000;
const MAX_ROUNDS = 4;
const PEERS_PER_ROUND = 3;

let syncRunning = false;

async function getMissingHashes(options = {}) {
  const { force = false } = options;
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { message: false };
  if (!force) {
    query.messageNotFound = { $ne: true };
  }
  const projection = {
    projection: {
      _id: 0, txid: 1, hash: 1, height: 1, value: 1, message: 1, messageNotFound: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
  results.sort((a, b) => a.height - b.height);
  return results.filter((r) => {
    if (force) return true;
    return !invalidMessages.find((m) => m.hash === r.hash && m.txid === r.txid);
  });
}

async function bulkFetchFromPeer(peerIp, peerPort) {
  log.info(`syncMissingHashes - Checking explorer sync on ${peerIp}:${peerPort}`);
  const syncResponse = await serviceHelper.axiosGet(
    `http://${peerIp}:${peerPort}/explorer/issynced`,
    { timeout: 5000 },
  ).catch((error) => { log.error(error); return null; });
  if (!syncResponse || !syncResponse.data || syncResponse.data.status !== 'success' || !syncResponse.data.data) {
    return null;
  }
  log.info(`syncMissingHashes - Fetching permanent messages from ${peerIp}:${peerPort}`);
  const response = await serviceHelper.axiosGet(
    `http://${peerIp}:${peerPort}/apps/permanentmessages`,
    { timeout: 120000 },
  ).catch((error) => { log.error(error); return null; });
  if (!response || !response.data || response.data.status !== 'success' || !response.data.data) {
    return null;
  }
  return response.data.data;
}

async function validatePrice(appSpecFormatted, height, valueSat, appPrices, prevMsg) {
  const isRegistration = !prevMsg;
  const defaultExpire = height >= config.fluxapps.daemonPONFork
    ? config.fluxapps.blocksLasting * 4
    : config.fluxapps.blocksLasting;
  const expireIn = appSpecFormatted.expire || defaultExpire;
  const intervals = appPrices.filter((interval) => interval.height < height);
  const priceSpec = intervals[intervals.length - 1];

  if (isRegistration) {
    let appPrice = await appPricePerMonth(appSpecFormatted, height, appPrices);
    const multiplier = expireIn / defaultExpire;
    appPrice *= multiplier;
    appPrice = Math.ceil(appPrice * 100) / 100;
    if (priceSpec && appPrice < priceSpec.minPrice) appPrice = priceSpec.minPrice;
    return valueSat >= appPrice * 1e8;
  }

  const prevSpecs = prevMsg.appSpecifications || prevMsg.zelAppSpecifications;
  let appPrice = await appPricePerMonth(appSpecFormatted, height, appPrices);
  let previousSpecsPrice = await appPricePerMonth(prevSpecs, prevMsg.height || height, appPrices);
  const defaultExpirePrevious = (prevMsg.height || height) >= config.fluxapps.daemonPONFork
    ? config.fluxapps.blocksLasting * 4
    : config.fluxapps.blocksLasting;
  const previousExpireIn = prevSpecs.expire || defaultExpirePrevious;
  const multiplierCurrent = expireIn / defaultExpire;
  appPrice *= multiplierCurrent;
  appPrice = Math.ceil(appPrice * 100) / 100;
  const multiplierPrevious = previousExpireIn / defaultExpirePrevious;
  previousSpecsPrice *= multiplierPrevious;
  previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;
  const heightDifference = height - (prevMsg.height || 0);
  const perc = (previousExpireIn - heightDifference) / previousExpireIn;
  let actualPriceToPay = appPrice * 0.9;
  if (perc > 0) {
    actualPriceToPay = (appPrice - (perc * previousSpecsPrice)) * 0.9;
  }
  actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
  if (priceSpec && actualPriceToPay < priceSpec.minPrice) actualPriceToPay = priceSpec.minPrice;
  return valueSat >= actualPriceToPay * 1e8;
}

async function processMessages(messages, onProgress) {
  const db = dbHelper.databaseConnection();
  const appsGlobalDb = db.db(config.database.appsglobal.database);
  const daemonDb = db.db(config.database.daemon.database);
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  messages.sort((a, b) => a.height - b.height);
  const filtered = messages.filter((app) => app.valueSat !== null);

  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  const daemonHeight = syncStatus.data.height || 0;
  const appPrices = await getChainParamsPriceUpdates();

  const CHUNK_SIZE = 2000;
  for (let offset = 0; offset < filtered.length; offset += CHUNK_SIZE) {
    const chunk = filtered.slice(offset, offset + CHUNK_SIZE);

    // 1. Batch existence check
    const chunkHashes = chunk.map((m) => m.hash);
    const existingDocs = await dbHelper.findInDatabase(
      appsGlobalDb, globalAppsMessages, { hash: { $in: chunkHashes } }, { projection: { _id: 0, hash: 1 } },
    );
    const existingSet = new Set(existingDocs.map((d) => d.hash));

    // 2. Batch mark existing hashes as message:true
    if (existingSet.size > 0) {
      const hashOps = [...existingSet].map((hash) => ({
        updateOne: { filter: { hash }, update: { $set: { message: true, messageNotFound: false } } },
      }));
      await daemonDb.collection(appsHashesCollection).bulkWrite(hashOps, { ordered: false })
        .catch((err) => log.error(`processMessages hashMark: ${err.message}`));
      skipped += existingSet.size;
    }

    const newMessages = chunk.filter((m) => !existingSet.has(m.hash));
    if (newMessages.length === 0) {
      log.info(`syncMissingHashes - ${processed} processed, ${skipped} skipped, ${failed} failed of ${filtered.length}`);
      if (onProgress) onProgress({ processed, skipped, total: filtered.length });
      continue;
    }

    // 3. Pre-load previous app specs for update messages in this chunk
    const updateNames = new Set();
    for (const msg of newMessages) {
      if (msg.type === 'fluxappupdate' || msg.type === 'zelappupdate') {
        const specs = msg.appSpecifications || msg.zelAppSpecifications;
        if (specs) updateNames.add(specs.name);
      }
    }
    const prevSpecsMap = new Map();
    if (updateNames.size > 0) {
      const prevDocs = await appsGlobalDb.collection(globalAppsMessages)
        .find({ 'appSpecifications.name': { $in: [...updateNames] } })
        .project({ _id: 0 })
        .sort({ height: -1 })
        .toArray();
      for (const doc of prevDocs) {
        const name = doc.appSpecifications?.name;
        if (name && !prevSpecsMap.has(name)) {
          prevSpecsMap.set(name, doc);
        }
      }
    }

    // 4. Verify each message and collect for batch insert
    const permInserts = [];
    const hashMarkOps = [];

    for (const appMessage of newMessages) {
      try {
        const specifications = appMessage.appSpecifications || appMessage.zelAppSpecifications;
        if (!specifications) continue;

        const appSpecFormatted = specificationFormatter(specifications);
        const messageVersion = serviceHelper.ensureNumber(appMessage.version);
        const messageTimestamp = serviceHelper.ensureNumber(appMessage.timestamp);
        const height = serviceHelper.ensureNumber(appMessage.height);
        const valueSat = serviceHelper.ensureNumber(appMessage.valueSat);
        const isRegistration = appMessage.type === 'fluxappregister' || appMessage.type === 'zelappregister';

        await messageVerifier.verifyAppHash(appMessage);
        await appValidator.verifyAppSpecifications(appSpecFormatted, height);

        if (isRegistration) {
          await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted, appMessage.hash);
          await messageVerifier.verifyAppMessageSignature(
            appMessage.type, messageVersion, appSpecFormatted, messageTimestamp, appMessage.signature,
          );
          if (!(await validatePrice(appSpecFormatted, height, valueSat, appPrices, null))) {
            failed += 1;
            continue;
          }
        } else {
          const prevMsg = prevSpecsMap.get(appSpecFormatted.name);
          if (!prevMsg) {
            failed += 1;
            continue;
          }
          const prevSpecs = prevMsg.appSpecifications || prevMsg.zelAppSpecifications;
          await messageVerifier.verifyAppMessageUpdateSignature(
            appMessage.type, messageVersion, appSpecFormatted, messageTimestamp,
            appMessage.signature, prevSpecs.owner, daemonHeight, prevSpecs,
          );
          if (!(await validatePrice(appSpecFormatted, height, valueSat, appPrices, prevMsg))) {
            failed += 1;
            continue;
          }
        }

        permInserts.push({
          type: appMessage.type,
          version: messageVersion,
          appSpecifications: appSpecFormatted,
          hash: appMessage.hash,
          timestamp: messageTimestamp,
          signature: appMessage.signature,
          txid: serviceHelper.ensureString(appMessage.txid),
          height,
          valueSat,
        });

        hashMarkOps.push({
          updateOne: { filter: { hash: appMessage.hash }, update: { $set: { message: true, messageNotFound: false } } },
        });
      } catch (error) {
        failed += 1;
        if (failed <= 10) log.warn(`processMessages verify failed: ${appMessage.hash} - ${error.message}`);
      }
    }

    // 5. Batch insert permanent messages
    if (permInserts.length > 0) {
      await appsGlobalDb.collection(globalAppsMessages).insertMany(permInserts, { ordered: false })
        .catch((err) => log.error(`processMessages insertMany: ${err.message}`));
      processed += permInserts.length;
    }

    // 6. Batch mark hashes
    if (hashMarkOps.length > 0) {
      await daemonDb.collection(appsHashesCollection).bulkWrite(hashMarkOps, { ordered: false })
        .catch((err) => log.error(`processMessages hashMark new: ${err.message}`));
    }

    log.info(`syncMissingHashes - ${processed} processed, ${skipped} skipped, ${failed} failed of ${filtered.length}`);
    if (onProgress) onProgress({ processed, skipped, total: filtered.length });
  }
  return { processed, skipped, total: filtered.length };
}

/**
 * Poll until responses settle or timeout. Responses arrive asynchronously
 * via gossip — we detect resolution by checking getMissingHashes() count.
 * @param {number} previousCount - Missing count before this round
 * @param {number} maxWaitMs - Maximum time to wait
 * @param {boolean} force - Pass to getMissingHashes
 * @returns {Promise<Array>} Remaining missing hashes
 */
async function waitForResolution(previousCount, maxWaitMs, force) {
  const deadline = Date.now() + maxWaitMs;
  let lastChangeAt = Date.now();
  let lastCount = previousCount;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await serviceHelper.delay(1000);
    const current = await getMissingHashes({ force });
    if (current.length === 0) return [];

    if (current.length < lastCount) {
      lastCount = current.length;
      lastChangeAt = Date.now();
    }

    if (Date.now() - lastChangeAt >= SETTLE_TIME_MS) return current;
    if (Date.now() >= deadline) return current;
  }
}

/**
 * Pick N random peers that haven't been tried yet.
 * @param {object} peerManager
 * @param {number} count
 * @param {object} [options]
 * @param {Set} [options.excludeKeys] - Peer keys already tried
 * @param {string[]} [options.excludeSources] - Peer sources to exclude (e.g. ['deterministic'])
 * @returns {Array} Array of peer objects
 */
function pickRandomPeers(peerManager, count, options = {}) {
  const { excludeKeys = new Set(), excludeSources = [] } = options;
  const candidates = [];
  for (const peer of peerManager.allValues()) {
    if (excludeKeys.has(peer.key)) continue;
    if (excludeSources.length && excludeSources.includes(peer.source)) continue;
    candidates.push(peer);
  }
  // Shuffle
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

/**
 * Send a fluxapprequest v2 message to a specific peer.
 * @param {Array<string>} hashes - Hashes to request
 * @param {object} peer - Peer socket to send to
 */
async function requestHashesFromPeer(hashes, peer) {
  const message = {
    type: 'fluxapprequest',
    version: 2,
    hashes,
  };
  const signed = await serialiseAndSignFluxBroadcast(message);
  peer.send(signed);
}

async function syncMissingHashes(options = {}) {
  const { maxConcurrentPeers = 3, onProgress = null, force = false } = options;

  if (syncRunning) {
    log.info('syncMissingHashes - Already running, skipping');
    return { resolved: 0, missing: 0, unreachable: 0 };
  }

  syncRunning = true;
  try {
    // eslint-disable-next-line global-require
    const { peerManager } = require('../utils/peerState');

    let missingHashes = await getMissingHashes({ force });
    log.info(`syncMissingHashes - Found ${missingHashes.length} missing hashes`);

    if (missingHashes.length === 0) {
      return { resolved: 0, missing: 0, unreachable: 0 };
    }

    const initialCount = missingHashes.length;
    let resolved = 0;

    // Bulk fetch for large gaps (> 500 exceeds single fluxapprequest v2 cap)
    if (missingHashes.length > 500) {
      log.info(`syncMissingHashes - ${missingHashes.length} missing, using bulk fetch`);
      const peers = pickRandomPeers(peerManager, 3, { excludeSources: ['deterministic'] });

      const fetchPromises = peers.map((p) => bulkFetchFromPeer(p.ip, p.port));
      const results = await Promise.allSettled(fetchPromises);

      const messagesByHash = new Map();
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          for (const msg of result.value) {
            if (msg.hash && !messagesByHash.has(msg.hash)) {
              messagesByHash.set(msg.hash, msg);
            }
          }
        }
      }

      if (messagesByHash.size > 0) {
        const merged = [...messagesByHash.values()];
        log.info(`syncMissingHashes - Bulk fetched ${merged.length} unique messages from ${peers.length} peers, processing`);
        const stats = await processMessages(merged, onProgress);
        resolved += stats.processed;
        log.info(`syncMissingHashes - Bulk: ${stats.processed} processed, ${stats.skipped} skipped`);
      }

      missingHashes = await getMissingHashes({ force });
    }

    // Targeted fetch for <= 500 missing hashes
    if (missingHashes.length > 0) {
      log.info(`syncMissingHashes - ${missingHashes.length} missing, requesting from peers`);
      const triedPeers = new Set();

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        if (missingHashes.length === 0) break;

        const peers = pickRandomPeers(peerManager, PEERS_PER_ROUND, {
          excludeKeys: triedPeers,
          excludeSources: ['deterministic'],
        });
        if (peers.length === 0) {
          log.info(`syncMissingHashes - No more untried peers available`);
          break;
        }

        for (const peer of peers) {
          triedPeers.add(peer.key);
        }

        const hashes = missingHashes.map((h) => h.hash);
        log.info(`syncMissingHashes - Round ${round + 1}: requesting ${hashes.length} hashes from ${peers.length} peers`);

        for (const peer of peers) {
          requestHashesFromPeer(hashes, peer);
        }

        const maxWait = hashes.length * RESPONSE_TIME_PER_HASH_MS + BUFFER_MS;
        const beforeCount = missingHashes.length;
        missingHashes = await waitForResolution(beforeCount, maxWait, force);
        const resolvedThisRound = beforeCount - missingHashes.length;
        resolved += resolvedThisRound;

        log.info(`syncMissingHashes - Round ${round + 1}: resolved ${resolvedThisRound}, ${missingHashes.length} remaining`);
        if (onProgress) onProgress({ resolved, missing: missingHashes.length });
      }
    }

    // Mark old unresolvable hashes
    const finalMissing = await getMissingHashes({ force: false });
    const maxExpireBlocks = config.fluxapps.blocksLasting * 12;
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    const scannedHeight = await dbHelper.findOneInDatabase(
      database,
      config.database.daemon.collections.scannedHeight,
      { generalScannedHeight: { $gte: 0 } },
      { projection: { _id: 0, generalScannedHeight: 1 } },
    );
    const currentHeight = scannedHeight ? scannedHeight.generalScannedHeight : 0;

    let unreachable = 0;
    for (const hash of finalMissing) {
      if (currentHeight - hash.height > maxExpireBlocks) {
        await messageVerifier.appHashHasMessageNotFound(hash.hash);
        unreachable += 1;
      }
    }

    const remaining = finalMissing.length - unreachable;
    log.info(`syncMissingHashes - Complete: ${resolved}/${initialCount} resolved, ${remaining} missing, ${unreachable} unreachable`);
    return { resolved, missing: remaining, unreachable };
  } catch (error) {
    log.error(error);
    return { resolved: 0, missing: -1, unreachable: 0 };
  } finally {
    syncRunning = false;
  }
}

async function triggerAppHashesCheckAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    syncMissingHashes({ force: true });
    const resultsResponse = messageHelper.createSuccessMessage('Running sync on missing application messages');
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

module.exports = {
  syncMissingHashes,
  getMissingHashes,
  triggerAppHashesCheckAPI,
};
