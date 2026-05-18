const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const messageStore = require('./messageStore');
const messageVerifier = require('./messageVerifier');
const appValidator = require('../appRequirements/appValidator');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const { serialiseAndSignFluxBroadcast } = require('../utils/fluxBroadcastHelper');
const { peerManager } = require('../utils/peerState');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const { openEphemeralConnection } = require('../fluxCommunication');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { CLOSE_CODES } = require('../utils/FluxPeerSocket');
const globalState = require('../utils/globalState');
const { appSyncEvents, EVENTS } = require('../utils/appSyncEvents');
const { HASH_EXPIRY_BLOCKS, HASH_RETRY_BACKOFF } = require('../utils/appConstants');
const log = require('../../lib/log');
const { invalidMessages } = require('../invalidMessages');

const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

const SETTLE_TIME_MS = config.fluxapps.hashSyncSettleMs ?? 4000;
const RESPONSE_TIME_PER_HASH_MS = config.fluxapps.hashSyncResponseTimePerHashMs ?? 150;
const BUFFER_MS = config.fluxapps.hashSyncBufferMs ?? 5000;
const MAX_ROUNDS = config.fluxapps.hashSyncMaxRounds ?? 4;
const PEERS_PER_ROUND = config.fluxapps.hashSyncPeersPerRound ?? 3;
const EPHEMERAL_PEERS_COUNT = config.fluxapps.hashSyncEphemeralPeers ?? 5;

let syncRunning = false;

function findPrevSpec(specs, height) {
  let lo = 0;
  let hi = specs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (specs[mid].height < height) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? specs[lo - 1] : null;
}

async function getMissingHashes(options = {}) {
  const { force = false, currentHeight = 0 } = options;
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { message: false };
  if (!force) {
    query.messageNotFound = { $ne: true };
    query.$or = [
      { nextRetryHeight: { $exists: false } },
      { nextRetryHeight: { $lte: currentHeight } },
    ];
  }
  const projection = {
    projection: {
      _id: 0, txid: 1, hash: 1, height: 1, value: 1, message: 1, messageNotFound: 1, syncAttempts: 1, retryFromHeight: 1,
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
  const appsGlobalDb = db.db(config.database.appsglobal.database);
  const daemonDb = db.db(config.database.daemon.database);
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  messages.sort((a, b) => a.height - b.height);
  const filtered = messages.filter((app) => app.valueSat !== null);

  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  const daemonHeight = syncStatus.data.height || 0;

  const prevOwnerMap = new Map();
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

    // 3. Pre-load previous app specs from DB for update messages in this chunk
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
        .sort({ height: 1 })
        .toArray();
      for (const doc of prevDocs) {
        const name = doc.appSpecifications?.name;
        if (!name) continue;
        if (!prevSpecsMap.has(name)) prevSpecsMap.set(name, []);
        prevSpecsMap.get(name).push(doc);
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

        if (appSpecFormatted.version >= 8 && appSpecFormatted.enterprise) {
          try {
            const decrypted = await checkAndDecryptAppSpecs(
              appSpecFormatted,
              { daemonHeight: height, owner: appSpecFormatted.owner },
            );
            const appSpecDecrypted = specificationFormatter(decrypted);
            await appValidator.verifyAppSpecifications(appSpecDecrypted, height);
          } catch (err) {
            log.warn(`processMessages enterprise decrypt skipped for ${appSpecFormatted.name}: ${err.message}`);
          }
        } else {
          await appValidator.verifyAppSpecifications(appSpecFormatted, height);
        }

        const permMsg = {
          type: appMessage.type,
          version: messageVersion,
          appSpecifications: appSpecFormatted,
          hash: appMessage.hash,
          timestamp: messageTimestamp,
          signature: appMessage.signature,
          txid: serviceHelper.ensureString(appMessage.txid),
          height,
          valueSat,
        };

        if (isRegistration) {
          await messageVerifier.verifyAppMessageSignature(
            appMessage.type, messageVersion, appSpecFormatted, messageTimestamp, appMessage.signature,
          );
        } else {
          const prevSpecsList = prevSpecsMap.get(appSpecFormatted.name);
          const prevMsg = prevSpecsList ? findPrevSpec(prevSpecsList, height) : null;
          if (!prevMsg) {
            failed += 1;
            continue;
          }
          const prevSpecs = prevMsg.appSpecifications || prevMsg.zelAppSpecifications;
          let prevSpecsForVerification = prevSpecs;
          if (prevSpecs.version >= 8 && prevSpecs.enterprise) {
            try {
              const decrypted = await checkAndDecryptAppSpecs(
                prevSpecs, { daemonHeight: prevMsg.height, owner: prevSpecs.owner },
              );
              prevSpecsForVerification = specificationFormatter(decrypted);
            } catch (err) {
              log.warn(`processMessages prevSpec decrypt skipped for ${appSpecFormatted.name}: ${err.message}`);
            }
          }
          try {
            await messageVerifier.verifyAppMessageUpdateSignature(
              appMessage.type, messageVersion, appSpecFormatted, messageTimestamp,
              appMessage.signature, prevSpecsForVerification.owner, daemonHeight, prevSpecsForVerification,
            );
          } catch (sigError) {
            // Before height 2000000, owner-change races were accepted by the
            // network (re-verification not deployed until v8.10.0, well after
            // the last known race at h=1880981).
            if (height >= 2000000) throw sigError;
            const oldOwner = prevOwnerMap.get(appSpecFormatted.name);
            if (oldOwner && oldOwner !== prevSpecsForVerification.owner) {
              await messageVerifier.verifyAppMessageUpdateSignature(
                appMessage.type, messageVersion, appSpecFormatted, messageTimestamp,
                appMessage.signature, oldOwner, daemonHeight, prevSpecsForVerification,
              );
            } else {
              throw sigError;
            }
          }
          const currentOwner = prevSpecs.owner;
          if (currentOwner && appSpecFormatted.owner !== currentOwner) {
            prevOwnerMap.set(appSpecFormatted.name, currentOwner);
          }
        }

        // Verified — add to batch and update map for subsequent messages
        permInserts.push(permMsg);
        if (!prevSpecsMap.has(appSpecFormatted.name)) prevSpecsMap.set(appSpecFormatted.name, []);
        prevSpecsMap.get(appSpecFormatted.name).push(permMsg);

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
async function waitForResolution(previousCount, maxWaitMs, force, currentHeight) {
  const deadline = Date.now() + maxWaitMs;
  let lastActivityAt = Date.now();

  const handler = () => { lastActivityAt = Date.now(); };
  appSyncEvents.on(EVENTS.HASH_RESPONSE_RECEIVED, handler);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await serviceHelper.delay(1000);
      const current = await getMissingHashes({ force, currentHeight });
      if (current.length === 0) return [];
      if (Date.now() - lastActivityAt >= SETTLE_TIME_MS) return current;
      if (Date.now() >= deadline) return current;
    }
  } finally {
    appSyncEvents.removeListener(EVENTS.HASH_RESPONSE_RECEIVED, handler);
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

/**
 * Pick random IPs from the deterministic node list, excluding connected peers.
 * @param {number} count
 * @returns {Promise<string[]>} Array of ip:port strings
 */
async function pickEphemeralTargets(count) {
  const nodeList = await fluxCommunicationUtils.deterministicFluxList();
  const localSocketAddress = await fluxNetworkHelper.getMyFluxIPandPort();
  const selfKey = localSocketAddress.includes(':') ? localSocketAddress : `${localSocketAddress}:16127`;
  const connectedKeys = new Set();
  for (const peer of peerManager.allValues()) {
    connectedKeys.add(peer.key);
  }
  const candidates = [];
  for (const node of nodeList) {
    if (!node.ip) continue;
    const key = node.ip.includes(':') ? node.ip : `${node.ip}:16127`;
    if (connectedKeys.has(key)) continue;
    if (key === selfKey) continue;
    candidates.push(key);
  }
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

/**
 * Open ephemeral connections to random nodes, request hashes, wait for
 * responses, then close all connections.
 * @param {string[]} hashes - Hashes to request
 * @param {boolean} force - Pass to getMissingHashes
 * @returns {Promise<Array>} Remaining missing hashes
 */
async function ephemeralHashRound(hashes, force, currentHeight) {
  const targets = await pickEphemeralTargets(EPHEMERAL_PEERS_COUNT);
  if (targets.length === 0) {
    log.info('syncMissingHashes - No ephemeral targets available');
    return getMissingHashes({ force, currentHeight });
  }

  log.info(`syncMissingHashes - Ephemeral round: attempting ${targets.length} connections: ${targets.join(', ')}`);
  const connections = await Promise.all(targets.map((t) => openEphemeralConnection(t)));
  const peers = connections.filter(Boolean);
  if (peers.length === 0) {
    log.info(`syncMissingHashes - All ${targets.length} ephemeral connections failed`);
    return getMissingHashes({ force, currentHeight });
  }

  const peerKeys = peers.map((p) => p.key).join(', ');
  log.info(`syncMissingHashes - Ephemeral round: requesting ${hashes.length} hashes from ${peers.length} peers: ${peerKeys}`);

  globalState.pendingHashRequests = new Set(hashes);
  for (const peer of peers) {
    requestHashesFromPeer(hashes, peer);
  }

  const maxWait = hashes.length * RESPONSE_TIME_PER_HASH_MS + BUFFER_MS;
  const remaining = await waitForResolution(hashes.length, maxWait, force, currentHeight);
  globalState.pendingHashRequests = null;

  for (const peer of peers) {
    try { peer.close(CLOSE_CODES.EPHEMERAL_DONE, 'done'); } catch (_e) { /* noop */ }
  }

  return remaining;
}

async function syncMissingHashes(options = {}) {
  const { maxConcurrentPeers = 3, onProgress = null, force = false, currentHeight = 0 } = options;

  if (syncRunning) {
    log.info('syncMissingHashes - Already running, skipping');
    return { resolved: 0, missing: 0, unreachable: 0 };
  }

  syncRunning = true;
  try {
    const db = dbHelper.databaseConnection();
    const daemonDb = db.db(config.database.daemon.database);

    let missingHashes = await getMissingHashes({ force, currentHeight });
    log.info(`syncMissingHashes - Found ${missingHashes.length} missing hashes`);

    if (missingHashes.length === 0) {
      return { resolved: 0, missing: 0, unreachable: 0 };
    }

    // Check local permanent messages before fetching from peers
    const appsGlobalDb = db.db(config.database.appsglobal.database);
    const CHUNK_SIZE = 10000;
    let localResolved = 0;
    for (let i = 0; i < missingHashes.length; i += CHUNK_SIZE) {
      const chunk = missingHashes.slice(i, i + CHUNK_SIZE);
      const hashValues = chunk.map((h) => h.hash);
      // eslint-disable-next-line no-await-in-loop
      const found = await dbHelper.findInDatabase(appsGlobalDb, globalAppsMessages, { hash: { $in: hashValues } }, { projection: { _id: 0, hash: 1 } });
      if (found.length > 0) {
        const ops = found.map((m) => ({ updateOne: { filter: { hash: m.hash }, update: { $set: { message: true, messageNotFound: false } } } }));
        // eslint-disable-next-line no-await-in-loop
        await daemonDb.collection(appsHashesCollection).bulkWrite(ops, { ordered: false });
        localResolved += found.length;
      }
    }
    if (localResolved > 0) {
      log.info(`syncMissingHashes - Resolved ${localResolved} hashes from local permanent messages`);
      missingHashes = await getMissingHashes({ force, currentHeight });
    }

    if (missingHashes.length === 0) {
      return { resolved: localResolved, missing: 0, unreachable: 0 };
    }

    const initialCount = missingHashes.length;
    let resolved = localResolved;

    // Bulk fetch for large gaps (> 500 exceeds single fluxapprequest v2 cap)
    if (missingHashes.length > 500) {
      const peers = pickRandomPeers(peerManager, 3, { excludeSources: ['deterministic'] });
      const peerKeys = peers.map((p) => p.key).join(', ');
      log.info(`syncMissingHashes - ${missingHashes.length} missing, using bulk fetch from ${peers.length} peers: ${peerKeys}`);

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

      missingHashes = await getMissingHashes({ force, currentHeight });
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
        globalState.pendingHashRequests = new Set(hashes);
        const peerKeys = peers.map((p) => p.key).join(', ');
        log.info(`syncMissingHashes - Round ${round + 1}: requesting ${hashes.length} hashes from ${peers.length} peers: ${peerKeys}`);

        for (const peer of peers) {
          requestHashesFromPeer(hashes, peer);
        }

        const maxWait = hashes.length * RESPONSE_TIME_PER_HASH_MS + BUFFER_MS;
        const beforeCount = missingHashes.length;
        missingHashes = await waitForResolution(beforeCount, maxWait, force, currentHeight);
        globalState.pendingHashRequests = null;
        const resolvedThisRound = beforeCount - missingHashes.length;
        resolved += resolvedThisRound;

        log.info(`syncMissingHashes - Round ${round + 1}: resolved ${resolvedThisRound}, ${missingHashes.length} remaining`);
        if (onProgress) onProgress({ resolved, missing: missingHashes.length });
      }
    }

    // Ephemeral round: connect to random nodes outside our peer pool
    if (missingHashes.length > 0) {
      const beforeEphemeral = missingHashes.length;
      const hashes = missingHashes.map((h) => h.hash);
      missingHashes = await ephemeralHashRound(hashes, force, currentHeight);
      const resolvedEphemeral = beforeEphemeral - missingHashes.length;
      resolved += resolvedEphemeral;
      log.info(`syncMissingHashes - Ephemeral round: resolved ${resolvedEphemeral}, ${missingHashes.length} remaining`);
    }

    // Update backoff for unresolved hashes
    const finalMissing = await getMissingHashes({ force: false, currentHeight });

    let unreachable = 0;
    let minNextRetry = null;
    const backoffOps = [];
    for (const hashDoc of finalMissing) {
      if (currentHeight - hashDoc.retryFromHeight > HASH_EXPIRY_BLOCKS) {
        // eslint-disable-next-line no-await-in-loop
        await messageVerifier.appHashHasMessageNotFound(hashDoc.hash);
        unreachable += 1;
      } else {
        const attempts = (hashDoc.syncAttempts ?? 0) + 1;
        const backoffIdx = Math.min(attempts, HASH_RETRY_BACKOFF.length - 1);
        const nextRetry = currentHeight + HASH_RETRY_BACKOFF[backoffIdx];
        if (minNextRetry === null || nextRetry < minNextRetry) {
          minNextRetry = nextRetry;
        }
        backoffOps.push({
          updateOne: {
            filter: { hash: hashDoc.hash },
            update: { $set: { syncAttempts: attempts, nextRetryHeight: nextRetry } },
          },
        });
      }
    }
    if (backoffOps.length > 0) {
      await daemonDb.collection(appsHashesCollection).bulkWrite(backoffOps, { ordered: false })
        .catch((err) => log.error(`syncMissingHashes backoff update: ${err.message}`));
    }

    const remaining = finalMissing.length - unreachable;
    log.info(`syncMissingHashes - Complete: ${resolved}/${initialCount} resolved, ${remaining} missing (${backoffOps.length} backed off), ${unreachable} unreachable`);
    return { resolved, missing: remaining, unreachable, nextRetryHeight: minNextRetry };
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

async function resetHashSyncForUpgrade(currentHeight) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);

  // Hashes already seen by the new retry system — one retry with new code
  const existingResult = await database.collection(appsHashesCollection).updateMany(
    { message: false, retryFromHeight: { $exists: true } },
    { $set: { messageNotFound: false, nextRetryHeight: currentHeight } },
  );

  // Hashes never seen by the new retry system — full fresh start with 1-year window
  const newResult = await database.collection(appsHashesCollection).updateMany(
    { message: false, retryFromHeight: { $exists: false } },
    { $set: { messageNotFound: false, syncAttempts: 0, nextRetryHeight: currentHeight, retryFromHeight: currentHeight } },
  );

  return existingResult.modifiedCount + newResult.modifiedCount;
}

module.exports = {
  syncMissingHashes,
  getMissingHashes,
  resetHashSyncForUpgrade,
  triggerAppHashesCheckAPI,
};
