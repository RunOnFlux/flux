const { StringDecoder } = require('string_decoder');
const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const messageVerifier = require('./messageVerifier');
const appValidator = require('../appRequirements/appValidator');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { verifyAppNameAndOwner } = require('../utils/appIdentity');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const { serialiseAndSignFluxBroadcast } = require('../utils/fluxBroadcastHelper');
const { peerManager } = require('../utils/peerState');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const { openEphemeralConnection } = require('../fluxCommunication');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { normalizeSocketAddress } = require('../utils/socketAddressUtils');
const { CLOSE_CODES } = require('../utils/FluxPeerSocket');
const { appSyncEvents, EVENTS } = require('../utils/appSyncEvents');
const { HASH_EXPIRY_BLOCKS, HASH_RETRY_BACKOFF } = require('../utils/appConstants');
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const globalState = require('../utils/globalState');
const { isBefore, messagesThatCount } = require('../utils/appMessageChain');
const { invalidMessages } = require('../invalidMessages');
const { readMessageLog } = require('./permanentMessageLog');
const { MessageStage } = require('./messageStage');
const { Privilege, authOf } = require('../utils/privileges');

const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;

const SETTLE_TIME_MS = config.fluxapps.hashSyncSettleMs ?? 4000;
const RESPONSE_TIME_PER_HASH_MS = config.fluxapps.hashSyncResponseTimePerHashMs ?? 150;
const BUFFER_MS = config.fluxapps.hashSyncBufferMs ?? 5000;
const MAX_ROUNDS = config.fluxapps.hashSyncMaxRounds ?? 4;
const PEERS_PER_ROUND = config.fluxapps.hashSyncPeersPerRound ?? 3;
const EPHEMERAL_PEERS_COUNT = config.fluxapps.hashSyncEphemeralPeers ?? 5;

let syncRunning = false;

// The message right before one in the log, in (height, timestamp) order - the order
// getPreviousAppSpecifications and appMessageChain use, so a registration and an update paid in
// one block are in the same order for a bulk-synced node as for a live one. specs is sorted by
// (height, timestamp).
function findPrevSpec(specs, height, timestamp = -Infinity) {
  let lo = 0;
  let hi = specs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (isBefore(specs[mid], height, timestamp)) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? specs[lo - 1] : null;
}

async function getMissingHashes(options = {}) {
  const { force = false, currentHeight = 0 } = options;
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  // A payment whose transaction is not on the chain (notOnChain) has no message to fetch.
  const query = { message: false, notOnChain: { $ne: true } };
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

function createJsonArrayExtractor(onObject) {
  let buffer = '';
  let scanPos = 0;
  let inDataArray = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;

  return {
    write(chunk) {
      buffer += chunk;
      while (scanPos < buffer.length) {
        const ch = buffer[scanPos];
        if (!inDataArray) {
          const idx = buffer.indexOf('"data":[', scanPos);
          if (idx === -1) {
            const keep = Math.max(0, buffer.length - 20);
            buffer = buffer.slice(keep);
            scanPos = 0;
            return;
          }
          scanPos = idx + 8;
          inDataArray = true;
          continue;
        }
        if (escaped) { escaped = false; scanPos += 1; continue; }
        if (ch === '\\' && inString) { escaped = true; scanPos += 1; continue; }
        if (ch === '"') { inString = !inString; scanPos += 1; continue; }
        if (inString) { scanPos += 1; continue; }
        if (ch === '{') {
          if (depth === 0) objStart = scanPos;
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
          if (depth === 0 && objStart !== -1) {
            try { onObject(JSON.parse(buffer.slice(objStart, scanPos + 1))); } catch (e) { /* skip malformed */ }
            objStart = -1;
          }
        } else if (ch === ']' && depth === 0) {
          buffer = '';
          scanPos = 0;
          return;
        }
        scanPos += 1;
      }
      if (objStart !== -1) {
        buffer = buffer.slice(objStart);
        scanPos -= objStart;
        objStart = 0;
      } else {
        buffer = '';
        scanPos = 0;
      }
    },
  };
}

const BULK_FETCH_BATCH_SIZE = 500;
const BULK_FETCH_IDLE_MS = config.fluxapps.hashSyncBulkIdleMs ?? 120000;
// Two runs of missing messages are asked for in one request when fewer than this many app
// payments this node already holds lie between them.
const RANGE_GAP_PAYMENTS = 2000;

/**
 * The first index of a sorted array whose value is not below `value`.
 * @param {number[]} sorted ascending
 * @param {number} value
 * @returns {number}
 */
function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The block height ranges to ask peers for: every height holding a missing message, with two
 * neighbouring runs joined when fewer than RANGE_GAP_PAYMENTS app payments lie strictly between
 * them.
 * @param {number[]} missingHeights ascending
 * @param {number[]} paymentHeights ascending, the height of every app payment this node recorded
 * @returns {{fromHeight: number, toHeight: number}[]}
 */
function planRanges(missingHeights, paymentHeights) {
  const ranges = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const height of missingHeights) {
    const last = ranges[ranges.length - 1];
    const between = last ? lowerBound(paymentHeights, height) - lowerBound(paymentHeights, last.toHeight + 1) : 0;
    if (last && between < RANGE_GAP_PAYMENTS) last.toHeight = height;
    else ranges.push({ fromHeight: height, toHeight: height });
  }
  return ranges;
}

/**
 * Whether a peer's explorer has synced, so that its message log is whole.
 * @param {{ip: string, port: string|number}} peer
 * @returns {Promise<boolean>}
 */
async function peerExplorerSynced(peer) {
  const response = await serviceHelper.axiosGet(`http://${peer.ip}:${peer.port}/explorer/issynced`, { timeout: 5000 })
    .catch((error) => {
      log.warn(`syncMissingHashes - explorer sync check on ${peer.key}: ${error.message}`);
      return null;
    });
  return response?.data?.status === 'success' && response.data.data === true;
}

/**
 * Stages what a peer's log of one height range holds of the missing messages.
 * @param {{ip: string, port: string|number}} peer
 * @param {{fromHeight: number, toHeight: number}} range
 * @param {MessageStage} stage
 */
async function stageRangeFromPeer(peer, range, stage) {
  const response = await serviceHelper.axiosGet(
    `http://${peer.ip}:${peer.port}/apps/permanentmessagesbyheight`,
    { params: range, responseType: 'stream', timeout: BULK_FETCH_IDLE_MS },
  );
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const message of readMessageLog(response.data)) {
      // eslint-disable-next-line no-await-in-loop
      await stage.add(message);
    }
  } finally {
    response.data.destroy();
  }
}

/**
 * Stages what a peer's whole message log holds of the missing messages, from the route every
 * version serves.
 * @param {{ip: string, port: string|number}} peer
 * @param {MessageStage} stage
 */
async function stageWholeLogFromPeer(peer, stage) {
  const response = await serviceHelper.axiosGet(
    `http://${peer.ip}:${peer.port}/apps/permanentmessages`,
    { responseType: 'stream', timeout: BULK_FETCH_IDLE_MS },
  );
  const received = [];
  const extractor = createJsonArrayExtractor((message) => received.push(message));
  const decoder = new StringDecoder('utf8');
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of response.data) {
      extractor.write(decoder.write(chunk));
      // eslint-disable-next-line no-restricted-syntax
      for (const message of received.splice(0)) {
        // eslint-disable-next-line no-await-in-loop
        await stage.add(message);
      }
    }
  } finally {
    response.data.destroy();
  }
}

/**
 * Stages the missing messages from peers in turn. Each peer is asked for the height ranges of
 * what is still unstaged, worked out from this node's own payment records; a peer that does not
 * serve the log by height is asked for its whole log instead. A peer that fails part way keeps
 * what it delivered, and the next peer is asked only for the rest.
 * @param {{ip: string, port: string|number, key: string}[]} peers
 * @param {MessageStage} stage
 * @param {number[]} paymentHeights ascending
 * @returns {Promise<{peer: string, route: string, staged: number, error?: string}[]>}
 */
async function stageFromPeers(peers, stage, paymentHeights) {
  const fetched = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const peer of peers) {
    const ranges = planRanges(stage.unstagedHeights(), paymentHeights);
    if (ranges.length === 0) break;
    // eslint-disable-next-line no-await-in-loop
    if (!await peerExplorerSynced(peer)) continue;

    const before = stage.size;
    const startedAt = process.hrtime.bigint();
    const outcome = { peer: peer.key, route: 'byHeight', staged: 0 };
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const range of ranges) {
        // eslint-disable-next-line no-await-in-loop
        await stageRangeFromPeer(peer, range, stage);
      }
    } catch (error) {
      if (error.response?.status === 404) {
        outcome.route = 'wholeLog';
        // eslint-disable-next-line no-await-in-loop
        await stageWholeLogFromPeer(peer, stage).catch((wholeLogError) => { outcome.error = wholeLogError.message; });
      } else {
        outcome.error = error.message;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await stage.flush();
    outcome.staged = stage.size - before;
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    log.info(`syncMissingHashes - Staged ${outcome.staged} messages from ${peer.key} (${outcome.route}, ${ranges.length} ranges) in ${seconds.toFixed(1)}s`
      + `${outcome.error ? `, then: ${outcome.error}` : ''}`);
    fetched.push(outcome);
  }
  return fetched;
}

/**
 * The height of every app payment this node recorded on chain, ascending.
 * @returns {Promise<number[]>}
 */
async function appPaymentHeights() {
  const db = dbHelper.databaseConnection();
  const daemonDb = db.db(config.database.daemon.database);
  const payments = await dbHelper.findInDatabase(daemonDb, appsHashesCollection, { notOnChain: { $ne: true } }, { projection: { _id: 0, height: 1 } });
  return payments.map((payment) => payment.height).sort((a, b) => a - b);
}

/**
 * Fetches the missing messages from peers, then verifies and stores them.
 * @param {{ip: string, port: string|number, key: string}[]} peers
 * @param {Map<string, {txid: string, height: number, value: number}>} missing this node's own
 *   payment record of each hash it is missing, keyed by hash. Hashes verified here are removed.
 * @param {Function} [onProgress]
 * @returns {Promise<{processed: number, skipped: number}>}
 */
async function bulkFetch(peers, missing, onProgress) {
  const stage = await MessageStage.open(missing);
  try {
    const fetched = await stageFromPeers(peers, stage, await appPaymentHeights());
    log.info(`syncMissingHashes - Staged ${stage.size} of ${missing.size} missing messages, verifying`);

    let processed = 0;
    let skipped = 0;
    // eslint-disable-next-line no-restricted-syntax
    for await (const batch of stage.batches(BULK_FETCH_BATCH_SIZE)) {
      // eslint-disable-next-line no-await-in-loop
      const stats = await processMessages(batch, missing, onProgress);
      processed += stats.processed;
      skipped += stats.skipped;
      // eslint-disable-next-line no-restricted-syntax
      for (const message of batch) missing.delete(message.hash);
    }

    log.info(`syncMissingHashes - Bulk fetch: ${processed} processed, ${skipped} skipped`);
    fluxEventBus.publish('hashSync:bulkFetched', {
      staged: fetched.reduce((sum, outcome) => sum + outcome.staged, 0), processed, skipped, peers: fetched,
    });
    return { processed, skipped };
  } finally {
    await stage.discard();
  }
}

/**
 * A peer's message with this node's chain facts for it: the txid, block height and payment its
 * own scan recorded for the hash. The peer's copy carries its own values for these, which are
 * never taken: they place the message on chain, and so decide which message is in force and when
 * its app expires.
 * @param {object} message as the peer sent it
 * @param {{txid: string, height: number, value: number}} record this node's payment record
 * @returns {object}
 */
function withOwnChainRecord(message, record) {
  if (message.txid !== record.txid || message.height !== record.height || message.valueSat !== record.value) {
    log.warn(`processMessages - ${message.hash}: peer sent txid ${message.txid} height ${message.height} valueSat ${message.valueSat}, `
      + `this node recorded txid ${record.txid} height ${record.height} value ${record.value}; storing this node's`);
  }
  return {
    ...message, txid: record.txid, height: record.height, valueSat: record.value,
  };
}

/**
 * Verifies and stores messages streamed from a peer.
 * @param {object[]} messages as the peer sent them
 * @param {Map<string, {txid: string, height: number, value: number}>} records this node's
 *   payment record of each hash, keyed by hash
 * @param {Function} [onProgress]
 */
async function processMessages(messages, records, onProgress) {
  const db = dbHelper.databaseConnection();
  const appsGlobalDb = db.db(config.database.appsglobal.database);
  const daemonDb = db.db(config.database.daemon.database);
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  const placed = messages
    .filter((message) => records.has(message.hash))
    .map((message) => withOwnChainRecord(message, records.get(message.hash)));
  // (height, timestamp): the order findPrevSpec searches, and the one a same-block pair confirmed in
  placed.sort((a, b) => (a.height - b.height) || ((a.timestamp || 0) - (b.timestamp || 0)));
  const filtered = placed.filter((app) => app.valueSat !== null);

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

    // 2. Batch mark existing hashes as message:true, the stored message following this node's
    // payment record
    if (existingSet.size > 0) {
      await messageVerifier.alignStoredMessagesWithPayments([...existingSet].map((hash) => ({ hash, ...records.get(hash) })));
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
        const specs = msg.appSpecifications;
        if (specs) updateNames.add(specs.name);
      }
    }
    const prevSpecsMap = new Map();
    if (updateNames.size > 0) {
      const prevDocs = await appsGlobalDb.collection(globalAppsMessages)
        .find({ 'appSpecifications.name': { $in: [...updateNames] } })
        .project({ _id: 0 })
        // a same-block tie in the order getPreviousAppSpecifications and appMessageChain use
        .sort({ height: 1, timestamp: 1 })
        .toArray();
      for (const doc of prevDocs) {
        const name = doc.appSpecifications?.name;
        if (!name) continue;
        if (!prevSpecsMap.has(name)) prevSpecsMap.set(name, []);
        prevSpecsMap.get(name).push(doc);
      }
    }

    // Who holds a name is decided by the chain (appMessageChain): an update is verified against
    // the message before it among those that count, from this node's payment records.
    const paymentFacts = await dbHelper.appPaymentFacts(
      daemonDb,
      [...[...prevSpecsMap.values()].flat(), ...newMessages].map((message) => message.hash),
    );
    const countedBefore = (list) => messagesThatCount(
      list.filter((message) => !paymentFacts.notOnChain.has(message.hash)),
      paymentFacts.positions,
    );

    // 4. Verify each message and collect for batch insert
    const permInserts = [];
    let hashMarkOps = [];

    for (const appMessage of newMessages) {
      try {
        const specifications = appMessage.appSpecifications;
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
            verifyAppNameAndOwner(appSpecFormatted.name, appSpecFormatted.owner);
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
          const prevMsg = prevSpecsList ? findPrevSpec(countedBefore(prevSpecsList), height, messageTimestamp) : null;
          if (!prevMsg) {
            failed += 1;
            continue;
          }
          const prevSpecs = prevMsg.appSpecifications;
          let prevSpecsForVerification = prevSpecs;
          if (prevSpecs.version >= 8 && prevSpecs.enterprise) {
            try {
              verifyAppNameAndOwner(prevSpecs.name, prevSpecs.owner);
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
        // kept sorted, as findPrevSpec searches it: a gap filled late lands mid-list, not at its end
        const prevList = prevSpecsMap.get(appSpecFormatted.name);
        const at = prevList.indexOf(findPrevSpec(prevList, height, messageTimestamp)) + 1;
        prevList.splice(at, 0, permMsg);

        hashMarkOps.push({
          updateOne: { filter: { hash: appMessage.hash }, update: { $set: { message: true, messageNotFound: false } } },
        });
      } catch (error) {
        failed += 1;
        if (failed <= 10) log.warn(`processMessages verify failed: ${appMessage.hash} - ${error.message}`);
      }
    }

    // 5. Batch insert permanent messages (ordered so insertedCount is deterministic on failure)
    let inserted = 0;
    if (permInserts.length > 0) {
      inserted = permInserts.length;
      await appsGlobalDb.collection(globalAppsMessages).insertMany(permInserts, { ordered: true })
        .catch((err) => {
          inserted = err.result?.insertedCount ?? 0;
          hashMarkOps = hashMarkOps.slice(0, inserted);
          log.error(`processMessages insertMany: ${inserted}/${permInserts.length} inserted — ${err.message}`);
        });
      processed += inserted;
    }

    // The registry rows of the apps whose messages were stored, before their hashes are
    // marked. A registry not built yet is built in full from every stored message before
    // the node is ready (dbReady), so only a built one is kept current here. Rows not
    // written leave the hashes unmarked, and the next retry finds the messages stored and
    // writes the rows (alignStoredMessagesWithPayments).
    if (inserted > 0 && globalState.dbReady) {
      const apps = [...new Set(permInserts.slice(0, inserted).map((message) => message.appSpecifications.name))];
      try {
        await messageVerifier.storeGoverningAppSpecifications(apps);
      } catch (err) {
        log.error(`processMessages registry rows: ${err.message}`);
        hashMarkOps = [];
      }
    }

    // 6. Batch mark hashes
    if (hashMarkOps.length > 0) {
      await daemonDb.collection(appsHashesCollection).bulkWrite(hashMarkOps, { ordered: false })
        .catch((err) => log.error(`processMessages hashMark: ${err.message}`));
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
async function waitForResolution(pendingHashes, maxWaitMs, force, currentHeight) {
  const deadline = Date.now() + maxWaitMs;
  let lastActivityAt = Date.now();

  const handler = (hash) => { if (pendingHashes.has(hash)) lastActivityAt = Date.now(); };
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
 * Sign a fluxapprequest v2 message once and send to all peers.
 * @param {Array<string>} hashes - Hashes to request
 * @param {Array<object>} peers - Peer sockets to send to
 */
async function broadcastHashRequest(hashes, peers) {
  const message = {
    type: 'fluxapprequest',
    version: 2,
    hashes,
  };
  const signed = await serialiseAndSignFluxBroadcast(message);
  if (!signed) return;
  for (const peer of peers) {
    peer.send(signed);
  }
}

/**
 * Pick random IPs from the deterministic node list, excluding connected peers.
 * @param {number} count
 * @returns {Promise<string[]>} Array of ip:port strings
 */
async function pickEphemeralTargets(count) {
  const nodeList = await fluxCommunicationUtils.deterministicFluxList();
  const localSocketAddress = await fluxNetworkHelper.getLocalSocketAddress();
  if (!localSocketAddress) return [];
  const connectedKeys = new Set();
  for (const peer of peerManager.allValues()) {
    connectedKeys.add(peer.key);
  }
  const candidates = [];
  for (const node of nodeList) {
    if (!node.ip) continue;
    const key = normalizeSocketAddress(node.ip);
    if (connectedKeys.has(key)) continue;
    if (key === localSocketAddress) continue;
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

  try {
    for (let offset = 0; offset < hashes.length; offset += 500) {
      // eslint-disable-next-line no-await-in-loop
      await broadcastHashRequest(hashes.slice(offset, offset + 500), peers);
    }

    const maxWait = hashes.length * RESPONSE_TIME_PER_HASH_MS + BUFFER_MS;
    const remaining = await waitForResolution(new Set(hashes), maxWait, force, currentHeight);

    return remaining;
  } finally {
    for (const peer of peers) {
      try { peer.close(CLOSE_CODES.EPHEMERAL_DONE, 'done'); } catch (_e) { /* noop */ }
    }
  }
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
        // The stored message follows this node's payment record.
        const foundHashes = new Set(found.map((m) => m.hash));
        // eslint-disable-next-line no-await-in-loop
        await messageVerifier.alignStoredMessagesWithPayments(chunk.filter((record) => foundHashes.has(record.hash)));
        const ops = found.map((m) => ({ updateOne: { filter: { hash: m.hash }, update: { $set: { message: true, messageNotFound: false } } } }));
        // eslint-disable-next-line no-await-in-loop
        await daemonDb.collection(appsHashesCollection).bulkWrite(ops, { ordered: false });
        localResolved += found.length;
      }
    }
    // A message this node holds unpromoted is promoted from that copy, as a block's scan
    // promotes it; a peer's copy of a message already held is not taken (messageStore).
    let poolResolved = 0;
    for (let i = 0; i < missingHashes.length; i += CHUNK_SIZE) {
      const chunk = missingHashes.slice(i, i + CHUNK_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const held = await dbHelper.findInDatabase(appsGlobalDb, globalAppsTempMessages, { hash: { $in: chunk.map((h) => h.hash) } }, { projection: { _id: 0, hash: 1 } });
      const heldHashes = new Set(held.map((m) => m.hash));
      // eslint-disable-next-line no-restricted-syntax
      for (const record of chunk.filter((r) => heldHashes.has(r.hash))) {
        // eslint-disable-next-line no-await-in-loop
        if (await messageVerifier.checkAndRequestApp(record.hash, record.txid, record.height, record.value, 2)) poolResolved += 1;
      }
    }
    if (localResolved > 0 || poolResolved > 0) {
      log.info(`syncMissingHashes - Resolved ${localResolved} hashes from local permanent messages, ${poolResolved} from unpromoted ones`);
      localResolved += poolResolved;
      missingHashes = await getMissingHashes({ force, currentHeight });
    }

    if (missingHashes.length === 0) {
      return { resolved: localResolved, missing: 0, unreachable: 0 };
    }

    const initialCount = missingHashes.length;
    let resolved = localResolved;

    // Bulk fetch for large gaps (> 500 exceeds single fluxapprequest v2 cap)
    if (missingHashes.length > 500) {
      const peers = pickRandomPeers(peerManager, maxConcurrentPeers, { excludeSources: ['deterministic'] });
      const peerKeys = peers.map((p) => p.key).join(', ');
      log.info(`syncMissingHashes - ${missingHashes.length} missing, using bulk fetch from ${peers.length} peers: ${peerKeys}`);

      // A hash paid more than once is placed by its first payment, as the scan records it first.
      const missing = new Map();
      for (const record of missingHashes) {
        if (!missing.has(record.hash)) missing.set(record.hash, record);
      }
      const stats = await bulkFetch(peers, missing, onProgress);
      resolved += stats.processed;

      missingHashes = await getMissingHashes({ force, currentHeight });
    }

    // Targeted fetch via fluxapprequest v2 (capped at 500 per request)
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

        const allHashes = missingHashes.map((h) => h.hash);
        for (let offset = 0; offset < allHashes.length; offset += 500) {
          const hashChunk = allHashes.slice(offset, offset + 500);
          const peerKeys = peers.map((p) => p.key).join(', ');
          log.info(`syncMissingHashes - Round ${round + 1}: requesting ${hashChunk.length} hashes from ${peers.length} peers: ${peerKeys}`);

          // eslint-disable-next-line no-await-in-loop
          await broadcastHashRequest(hashChunk, peers);
        }

        const maxWait = allHashes.length * RESPONSE_TIME_PER_HASH_MS + BUFFER_MS;
        const beforeCount = missingHashes.length;
        missingHashes = await waitForResolution(new Set(allHashes), maxWait, force, currentHeight);
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

    // A hash whose message this node already stores waits on no peer: the next pass
    // writes its registry row from the stored copy, so it is neither backed off nor
    // given up on.
    const stored = new Set();
    for (let i = 0; i < finalMissing.length; i += CHUNK_SIZE) {
      const hashValues = finalMissing.slice(i, i + CHUNK_SIZE).map((h) => h.hash);
      // eslint-disable-next-line no-await-in-loop
      const found = await dbHelper.findInDatabase(appsGlobalDb, globalAppsMessages, { hash: { $in: hashValues } }, { projection: { _id: 0, hash: 1 } });
      found.forEach((m) => stored.add(m.hash));
    }

    let unreachable = 0;
    let minNextRetry = null;
    const backoffOps = [];
    for (const hashDoc of finalMissing) {
      if (stored.has(hashDoc.hash)) continue;
      // A hash is looked for for HASH_EXPIRY_BLOCKS from this node's first look,
      // not from its payment: a node that records an old payment has not been
      // looking for it since.
      const retryFromHeight = hashDoc.retryFromHeight ?? currentHeight;
      if (currentHeight - retryFromHeight > HASH_EXPIRY_BLOCKS) {
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
            update: { $set: { syncAttempts: attempts, nextRetryHeight: nextRetry, retryFromHeight } },
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
  } finally {
    syncRunning = false;
  }
}

async function triggerAppHashesCheckAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    appSyncEvents.emit(EVENTS.HASH_CHECK_REQUESTED);
    const resultsResponse = messageHelper.createSuccessMessage('Sync on missing application messages queued');
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
  findPrevSpec,
  syncMissingHashes,
  getMissingHashes,
  resetHashSyncForUpgrade,
  triggerAppHashesCheckAPI,
};
