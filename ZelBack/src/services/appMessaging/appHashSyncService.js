const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const messageStore = require('./messageStore');
const messageVerifier = require('./messageVerifier');
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

async function processMessages(messages, onProgress) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  let processed = 0;
  let skipped = 0;

  messages.sort((a, b) => a.height - b.height);
  const filtered = messages.filter((app) => app.valueSat !== null);

  for (const appMessage of filtered) {
    try {
      const existingPerm = await dbHelper.findOneInDatabase(
        database, globalAppsMessages, { hash: appMessage.hash }, { projection: { _id: 0, hash: 1 } },
      );
      if (existingPerm) {
        skipped += 1;
        await messageVerifier.appHashHasMessage(appMessage.hash);
        continue;
      }

      const cleanMessage = {
        type: appMessage.type,
        version: appMessage.version,
        appSpecifications: appMessage.appSpecifications,
        hash: appMessage.hash,
        timestamp: appMessage.timestamp,
        signature: appMessage.signature,
      };
      if (appMessage.zelAppSpecifications) {
        cleanMessage.zelAppSpecifications = appMessage.zelAppSpecifications;
      }
      await messageStore.storeAppTemporaryMessage(cleanMessage);
      await messageVerifier.checkAndRequestApp(appMessage.hash, appMessage.txid, appMessage.height, appMessage.valueSat, 2);
      processed += 1;
    } catch (error) {
      log.error(error);
    }
    if ((processed + skipped) % 500 === 0) {
      log.info(`syncMissingHashes - ${processed} processed, ${skipped} skipped of ${filtered.length}`);
    }
    if (onProgress && (processed + skipped) % 100 === 0) {
      onProgress({ processed, skipped, total: filtered.length });
    }
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
