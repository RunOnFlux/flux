const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const messageStore = require('./messageStore');
const messageVerifier = require('./messageVerifier');
const log = require('../../lib/log');
const { invalidMessages } = require('../invalidMessages');

const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

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

async function syncMissingHashes(options = {}) {
  const { maxConcurrentPeers = 5, onProgress = null, force = false } = options;

  if (syncRunning) {
    log.info('syncMissingHashes - Already running, skipping');
    return { resolved: 0, missing: 0, unreachable: 0 };
  }

  syncRunning = true;
  try {
    // eslint-disable-next-line global-require
    const { peerManager } = require('../utils/peerState');

    const missingHashes = await getMissingHashes({ force });
    log.info(`syncMissingHashes - Found ${missingHashes.length} missing hashes`);

    if (missingHashes.length === 0) {
      return { resolved: 0, missing: 0, unreachable: 0 };
    }

    let resolved = 0;

    if (missingHashes.length > 1000) {
      log.info(`syncMissingHashes - ${missingHashes.length} missing, using bulk fetch`);
      const peersToTry = [];
      for (let i = 0; i < Math.min(maxConcurrentPeers, 3); i += 1) {
        const peer = peerManager.getRandomPeer('outbound');
        if (peer) peersToTry.push(peer.toPeerInfo());
      }

      const fetchPromises = peersToTry.map((p) => bulkFetchFromPeer(p.ip, p.port));
      const results = await Promise.allSettled(fetchPromises);

      let bestResult = null;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          if (!bestResult || result.value.length > bestResult.length) {
            bestResult = result.value;
          }
        }
      }

      if (bestResult) {
        log.info(`syncMissingHashes - Bulk fetched ${bestResult.length} messages, processing`);
        const stats = await processMessages(bestResult, onProgress);
        resolved += stats.processed;
        log.info(`syncMissingHashes - Bulk: ${stats.processed} processed, ${stats.skipped} skipped`);
      }
    }

    // Request any still-missing hashes from multiple peers
    const stillMissing = await getMissingHashes({ force });
    if (stillMissing.length > 0) {
      log.info(`syncMissingHashes - ${stillMissing.length} still missing, requesting from peers`);

      const maxRounds = 3;
      for (let round = 0; round < maxRounds; round += 1) {
        const currentMissing = await getMissingHashes({ force });
        if (currentMissing.length === 0) break;

        log.info(`syncMissingHashes - Round ${round + 1}: ${currentMissing.length} missing`);
        const appsToRequest = currentMissing.map((h) => ({
          hash: h.hash, txid: h.txid, height: h.height, value: h.value,
        }));

        const requestPromises = [];
        for (let i = 0; i < Math.min(maxConcurrentPeers, 5); i += 1) {
          const incoming = i % 2 === 0;
          requestPromises.push(
            messageVerifier.checkAndRequestMultipleApps(appsToRequest, incoming),
          );
        }
        await Promise.allSettled(requestPromises);

        const afterRound = await getMissingHashes({ force });
        const resolvedThisRound = currentMissing.length - afterRound.length;
        resolved += resolvedThisRound;
        log.info(`syncMissingHashes - Round ${round + 1}: resolved ${resolvedThisRound}`);

        if (resolvedThisRound === 0) break;
        if (onProgress) onProgress({ resolved, missing: afterRound.length });
      }
    }

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
    log.info(`syncMissingHashes - Complete: ${resolved} resolved, ${remaining} missing, ${unreachable} unreachable`);
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
