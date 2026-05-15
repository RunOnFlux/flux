/* eslint-disable no-underscore-dangle */
const config = require('config');
const hash = require('object-hash');
const WebSocket = require('ws');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageStore = require('./appMessaging/messageStore');
const verificationHelper = require('./verificationHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');
const { peerManager, PEER_SOURCE } = require('./utils/peerState');
const { SIGTERM_EXPIRY_MS } = require('./utils/appConstants');
const cacheManager = require('./utils/cacheManager').default;
const networkStateService = require('./networkStateService');
const nodeConfirmationService = require('./nodeConfirmationService');
const registryManager = require('./appDatabase/registryManager');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('./utils/appSyncEvents');
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

const { messageCache, wsPeerCache } = cacheManager;

/* const LRUTest = {
  max: 25000000, // 25M
  ttl: 60 * 60 * 1000, // 1h
  maxAge: 60 * 60 * 1000, // 1h
};

const testListCache = new LRUCache(LRUTest); */

const { FluxPeerManager, DIRECTION, FLUX_VERSION, FLUX_CAPABILITIES } = require('./utils/FluxPeerManager');
const { NAK_REASON, buildSyncSignatureMessage } = require('./utils/peerCodec');
const { networkHealthMonitor } = require('./utils/NetworkHealthMonitor');

const DISCOVERY = {
  maxOutbound: 14,
  minUniqueOutboundIps: 9,
  maxInbound: 12,
  minUniqueInboundIps: 5,
  maxIterations: 100,
  connectionDelayMs: config.fluxapps.discoveryConnectionDelayMs ?? 500,
};

/**
 * To handle temporary app messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleAppMessages(message, fromIP, port) {
  try {
    // check if we have it in database and if not add
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    const rebroadcastToPeers = await messageStore.storeAppTemporaryMessage(message.data);
    if (rebroadcastToPeers === true) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
      } else {
        fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function handleTempSyncResponse(message, peerKey) {
  try {
    if (!message.data || message.data.type !== 'fluxapptempsync') return;
    const { messages, done } = message.data;
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleTempSyncResponse - Received ${messages.length} temp messages from ${peerKey} (done: ${!!done})`);
    let stored = 0;
    for (const msg of messages) {
      try {
        const result = await messageStore.storeAppTemporaryMessage(msg, { furtherVerification: true });
        if (result === true || result === false) stored += 1;
      } catch (err) {
        log.error(`Temp sync message failed: ${err.message}`);
      }
    }
    log.info(`handleTempSyncResponse - Processed ${stored} of ${messages.length} messages`);
  } catch (error) {
    log.error(error);
  }
}

async function handleAppRunningSyncResponse(message, peerKey) {
  try {
    if (!message.data || message.data.type !== 'fluxapprunningsync') return;
    if (!peerManager.isSyncRequested(peerKey)) return;
    const { messages, done } = message.data;
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleAppRunningSyncResponse - Received ${messages.length} events from ${peerKey} (done: ${!!done})`);
    const verifiedAppRunning = [];
    const otherEvents = [];
    for (const event of messages) {
      try {
        if (event.envelope && event.type === 'apprunning') {
          const broadcast = { ...event.envelope, data: event.data };
          const result = await fluxCommunicationUtils.verifyFluxBroadcast(broadcast);
          if (result === fluxCommunicationUtils.VerifyResult.OK) {
            verifiedAppRunning.push(broadcast);
          } else {
            log.warn(`handleAppRunningSyncResponse - Event from ${event.ip} failed verification: ${result}`);
          }
        } else if (event.type === 'evicted') {
          // Evicted events lack per-event signatures because they are generated
          // locally by nodeStatusMonitor, which makes non-deterministic HTTP
          // probe decisions about whether a remote node is alive. The
          // isSyncRequested check above ensures only solicited responses are
          // processed, but a compromised confirmed peer we sync from could still
          // include fake evictions. Impact is limited: only affects this node's
          // view and self-heals on the next apprunning broadcast (≤60 min).
          //
          // The root cause is nodeStatusMonitor itself — it will be replaced by
          // a peer quorum approach where eviction is determined by consensus of
          // signed "peer unreachable" events (3 missed pongs on the WebSocket
          // layer). Once that lands, evicted events will carry verifiable
          // signatures and this path will verify them like all other event types.
          otherEvents.push(event);
        } else if (event.envelope) {
          const broadcast = { ...event.envelope, data: event.data };
          const result = await fluxCommunicationUtils.verifyFluxBroadcast(broadcast);
          if (result === fluxCommunicationUtils.VerifyResult.OK) {
            otherEvents.push(event);
          }
        }
      } catch (err) {
        log.error(`handleAppRunningSyncResponse - Verification error: ${err.message}`);
      }
    }
    if (verifiedAppRunning.length > 0) {
      const { stored } = await messageStore.storeBatchAppRunningMessages(verifiedAppRunning);
      log.info(`handleAppRunningSyncResponse - Stored ${stored} of ${verifiedAppRunning.length} verified apprunning events`);
    }
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    for (const event of otherEvents) {
      if (event.type === 'sigterm') {
        await messageStore.storeAppStateEvent(event.type, { message: event.data, envelope: event.envelope });
        const newExpireAt = new Date(event.data.broadcastedAt + SIGTERM_EXPIRY_MS);
        await dbHelper.updateInDatabase(database, globalAppsLocations, { ip: event.data.ip }, { $set: { expireAt: newExpireAt } });
      } else if (event.type === 'appremoved') {
        await messageStore.storeAppStateEvent(event.type, { message: event.data, envelope: event.envelope });
        await dbHelper.findOneAndDeleteInDatabase(database, globalAppsLocations, { ip: event.data.ip, name: event.data.appName }, {});
      } else if (event.type === 'evicted') {
        await messageStore.storeAppStateEvent(event.type, { ip: event.ip });
        await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, { ip: event.ip });
      } else if (event.type === 'ipchanged') {
        await messageStore.storeAppStateEvent(event.type, { message: event.data, envelope: event.envelope });
      }
    }
    if (done) {
      peerManager.completeSyncRequest(peerKey);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning');
      log.info('handleAppRunningSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
  }
}

async function handleAppInstallingSyncResponse(message, peerKey) {
  try {
    if (!message.data || message.data.type !== 'fluxappinstallingsync') return;
    const { messages, done } = message.data;
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleAppInstallingSyncResponse - Received ${messages.length} broadcasts from ${peerKey} (done: ${!!done})`);
    const verified = [];
    for (const broadcast of messages) {
      try {
        const result = await fluxCommunicationUtils.verifyFluxBroadcast(broadcast);
        if (result === fluxCommunicationUtils.VerifyResult.OK) {
          verified.push(broadcast);
        } else {
          log.warn(`handleAppInstallingSyncResponse - Broadcast from ${broadcast.data?.ip} failed: ${result}`);
        }
      } catch (err) {
        log.error(`handleAppInstallingSyncResponse - Verification error: ${err.message}`);
      }
    }
    if (verified.length > 0) {
      const { stored } = await messageStore.storeBatchAppInstallingMessages(verified);
      log.info(`handleAppInstallingSyncResponse - Stored ${stored} of ${verified.length} verified broadcasts`);
    }
    if (done) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling');
      log.info('handleAppInstallingSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
  }
}

async function handleAppInstallingErrorsSyncResponse(message, peerKey) {
  try {
    if (!message.data || message.data.type !== 'fluxappinstallingerrorssync') return;
    const { messages, done } = message.data;
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleAppInstallingErrorsSyncResponse - Received ${messages.length} broadcasts from ${peerKey} (done: ${!!done})`);
    const verified = [];
    for (const broadcast of messages) {
      try {
        const result = await fluxCommunicationUtils.verifyFluxBroadcast(broadcast);
        if (result === fluxCommunicationUtils.VerifyResult.OK) {
          verified.push(broadcast);
        } else {
          log.warn(`handleAppInstallingErrorsSyncResponse - Broadcast from ${broadcast.data?.ip} failed: ${result}`);
        }
      } catch (err) {
        log.error(`handleAppInstallingErrorsSyncResponse - Verification error: ${err.message}`);
      }
    }
    if (verified.length > 0) {
      const { stored } = await messageStore.storeBatchAppInstallingErrorMessages(verified);
      log.info(`handleAppInstallingErrorsSyncResponse - Stored ${stored} of ${verified.length} verified broadcasts`);
    }
    if (done) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors');
      log.info('handleAppInstallingErrorsSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
  }
}

async function handleCheckMessageHashPresent(messageHash, fromIP, port) {
  try {
    if (!messageCache.has(messageHash)) {
      peerManager.sendHashRequest(`${fromIP}:${port}`, messageHash);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle a request of a message, from the message hash from one of the ws connections.
 * @param {string} messageHash Message hash.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 * @param {boolean} outgoingConnection says if ip/port is from incoming or outgoing connections.
 */
async function handleRequestMessageHash(messageHash, fromIP, port) {
  try {
    if (messageCache.has(messageHash)) {
      const message = messageCache.get(messageHash);
      if (message) {
        const messageString = serviceHelper.ensureString(message);
        const peer = peerManager.get(`${fromIP}:${port}`);
        if (peer) {
          peer.send(messageString);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle running app messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleAppRunningMessage(message, fromIP, port) {
  try {
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: message });
    const result = await messageStore.storeAppRunningMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (result.rebroadcast && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
      } else {
        fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle installing app messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleAppInstallingMessage(message, fromIP, port) {
  try {
    const rebroadcastToPeers = await messageStore.storeAppInstallingMessage(message.data);
    messageStore.storeSignedAppInstallingBroadcast(message);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp);
    if (rebroadcastToPeers === true && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
      } else {
        fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle installing error app messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleAppInstallingErrorMessage(message, fromIP, port) {
  try {
    const rebroadcastToPeers = await messageStore.storeAppInstallingErrorMessage(message.data);
    messageStore.storeSignedAppInstallingErrorBroadcast(message);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp);
    if (rebroadcastToPeers === true && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
      } else {
        fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle IP changed messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleIPChangedMessage(message, fromIP, port) {
  try {
    const envelope = { version: message.version, timestamp: message.timestamp, pubKey: message.pubKey, signature: message.signature };
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.IPCHANGED, { message: message.data, envelope });
    const rebroadcastToPeers = await messageStore.storeIPChangedMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
      } else {
        fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle app removed messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleAppRemovedMessage(message, fromIP, port) {
  try {
    // check if we have it any app running on that location and if yes, delete that information
    // rebroadcast message to the network if it's valid
    const envelope = { version: message.version, timestamp: message.timestamp, pubKey: message.pubKey, signature: message.signature };
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPREMOVED, { message: message.data, envelope });
    const rebroadcastToPeers = await messageStore.storeAppRemovedMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
      } else {
        fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle node sigterm messages (graceful shutdown notifications).
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleNodeSigtermMessage(message, fromIP, port) {
  try {
    const { ip, broadcastedAt } = message.data;
    log.info(`Received SIGTERM notification from node ${ip} (broadcasted at ${new Date(broadcastedAt).toISOString()})`);

    // Verify timestamp - only accept messages from last 4 minutes
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);

    if (!timestampOK) {
      return;
    }

    const appsOnNode = await registryManager.appLocationFromEvents({ ip });

    if (!appsOnNode || appsOnNode.length === 0) {
      log.info(`No apps found for node ${ip} in event log view, not rebroadcasting sigterm`);
      return;
    }

    log.info(`Found ${appsOnNode.length} apps for node ${ip}, updating expiration and rebroadcasting sigterm`);

    const envelope = { version: message.version, timestamp: message.timestamp, pubKey: message.pubKey, signature: message.signature };
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.SIGTERM, { message: message.data, envelope });

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const newExpireAt = new Date(broadcastedAt + SIGTERM_EXPIRY_MS);
    const update = { $set: { expireAt: newExpireAt } };
    const query = { ip };
    await dbHelper.updateInDatabase(database, globalAppsLocations, query, update);

    // Rebroadcast to other peers
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height || 0;
    if (daemonHeight >= config.messagesBroadcastRefactorStart) {
      peerManager.broadcastHash(hash(message.data), `${fromIP}:${port}`);
    } else {
      fluxCommunicationMessagesSender.relay(serviceHelper.ensureString(message), `${fromIP}:${port}`);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Unified message dispatcher for both inbound and outbound peer connections.
 * Handles message validation, cache checking, signature verification, and message type dispatch.
 * Registered as peerManager.messageDispatcher to break circular dependencies.
 * @param {object} msgObj Parsed message object.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peerSocket FluxPeerSocket instance.
 */
async function dispatchFluxMessage(msgObj, peerSocket) {
  const isOutbound = peerSocket.direction === DIRECTION.OUTBOUND;
  const codes = peerSocket.closeCodes;
  const {
    pubKey, timestamp, signature, version, data,
    messageHashPresent, requestMessageHash,
  } = msgObj;

  if (messageHashPresent) {
    if (typeof messageHashPresent !== 'string' || messageHashPresent.length !== 40) {
      try {
        log.info(`Invalid message of type messageHashPresent received from ${peerSocket.direction} peer ${peerSocket.key}. Closing connection`);
        peerSocket.close(codes.invalidMsg, 'Message not valid, disconnect');
      } catch (e) {
        log.error(e);
      }
      return;
    }
    const counter = peerSocket.msgMap.get('newHash');
    peerSocket.msgMap.set('newHash', counter + 1);
    setImmediate(() => handleCheckMessageHashPresent(messageHashPresent, peerSocket.ip, peerSocket.port));
    return;
  }
  if (requestMessageHash) {
    if (typeof requestMessageHash !== 'string' || requestMessageHash.length !== 40) {
      try {
        log.info(`Invalid message of type requestMessageHash from ${peerSocket.direction} peer ${peerSocket.key}. Closing connection`);
        peerSocket.close(codes.invalidMsg, 'Message not valid, disconnect');
      } catch (e) {
        log.error(e);
      }
      return;
    }
    const counter = peerSocket.msgMap.get('requestHash');
    peerSocket.msgMap.set('requestHash', counter + 1);
    setImmediate(() => handleRequestMessageHash(requestMessageHash, peerSocket.ip, peerSocket.port));
    return;
  }
  if (!pubKey || !timestamp || !signature || !version || !data) {
    try {
      log.info(`Invalid received from ${peerSocket.direction} peer ${peerSocket.key}. Closing connection`);
      peerSocket.close(codes.invalidMsg, 'Message not valid, disconnect');
    } catch (e) {
      log.error(e);
    }
    return;
  }

  // check if we have the message in cache. If yes, return false. If not, store it and continue
  await serviceHelper.delay(Math.floor(Math.random() * 75 + 1));
  const messageHash = hash(msgObj.data);
  if (messageCache.has(messageHash)) {
    return;
  }
  messageCache.set(messageHash, msgObj);

  // check blocked list
  if (wsPeerCache.has(pubKey)) {
    try {
      log.info(`Closing ${peerSocket.direction} connection, peer is on blockedList`);
      peerSocket.close(codes.blocked, 'blocked list');
    } catch (e) {
      log.error(e);
    }
    return;
  }
  const currentTimeStamp = Date.now();
  const { VerifyResult } = fluxCommunicationUtils;
  const verifyResult = await fluxCommunicationUtils.verifyFluxBroadcast(msgObj, undefined, currentTimeStamp);

  if (verifyResult === VerifyResult.OK) {
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(msgObj, currentTimeStamp);
    if (timestampOK === true) {
      try {
        if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
          setImmediate(() => handleAppMessages(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxapprequest') {
          setImmediate(() => fluxCommunicationMessagesSender.respondWithAppMessage(msgObj, peerSocket));
        } else if (msgObj.data.type === 'fluxapprunning') {
          setImmediate(() => handleAppRunningMessage(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxipchanged') {
          setImmediate(() => handleIPChangedMessage(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxappremoved') {
          setImmediate(() => handleAppRemovedMessage(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxappinstalling') {
          setImmediate(() => handleAppInstallingMessage(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxappinstallingerror') {
          setImmediate(() => handleAppInstallingErrorMessage(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxnodesigterm') {
          setImmediate(() => handleNodeSigtermMessage(msgObj, peerSocket.ip, peerSocket.port));
        } else if (msgObj.data.type === 'fluxapptempsync') {
          setImmediate(() => handleTempSyncResponse(msgObj, peerSocket.key));
        } else if (msgObj.data.type === 'fluxapprunningsync') {
          setImmediate(() => handleAppRunningSyncResponse(msgObj, peerSocket.key));
        } else if (msgObj.data.type === 'fluxappinstallingsync') {
          setImmediate(() => handleAppInstallingSyncResponse(msgObj, peerSocket.key));
        } else if (msgObj.data.type === 'fluxappinstallingerrorssync') {
          setImmediate(() => handleAppInstallingErrorsSyncResponse(msgObj, peerSocket.key));
        } else {
          log.warn(`Unrecognised message type of ${msgObj.data.type}`);
        }
      } catch (e) {
        log.error(e);
      }
    } else {
      peerSocket.sendNak(messageHash, NAK_REASON.STALE);
    }
  } else if (verifyResult === VerifyResult.NODE_NOT_FOUND) {
    // Originator's node is not in the deterministic list — stale list or node went offline.
    // The relay peer is not at fault. Drop the message, don't punish the relay.
    log.warn(`Dropping message from ${peerSocket.direction} peer ${peerSocket.key}: originator pubkey ${pubKey} not found in node list`);
  } else {
    // BAD_SIGNATURE or MALFORMED — the message is corrupted or forged.
    // Track against this relay peer with a rolling window.
    // If they send 5+ bad messages in 10 minutes, disconnect.
    const BAD_MSG_WINDOW = 10 * 60 * 1000;
    const BAD_MSG_THRESHOLD = 5;
    const now = Date.now();
    const cutoff = now - BAD_MSG_WINDOW;
    peerSocket.badMessageTimestamps.push(now);
    while (peerSocket.badMessageTimestamps.length > 0 && peerSocket.badMessageTimestamps[0] < cutoff) {
      peerSocket.badMessageTimestamps.shift();
    }
    // Safety cap — prevent unbounded growth from adversarial peers
    if (peerSocket.badMessageTimestamps.length > 20) {
      peerSocket.badMessageTimestamps = peerSocket.badMessageTimestamps.slice(-10);
    }
    const count = peerSocket.badMessageTimestamps.length;
    log.warn(`Bad message (${verifyResult}) from ${peerSocket.direction} peer ${peerSocket.key}, count: ${count}/10min`);
    if (count >= BAD_MSG_THRESHOLD) {
      log.warn(`Disconnecting ${peerSocket.direction} peer ${peerSocket.key} after ${count} bad messages in 10 minutes`);
      peerSocket.close(codes.badOrigin, 'too many bad messages');
    }
  }
}

// Register the message dispatcher on the peerManager singleton
peerManager.messageDispatcher = dispatchFluxMessage;
async function verifySyncRequest(peer, decoded) {
  const { requestTimestamp, pubkey, signature, sinceTimestamp } = decoded;
  const now = Date.now();
  if (Math.abs(now - requestTimestamp) > 120_000) {
    log.warn(`Sync request from ${peer.key} rejected: timestamp too far (${now - requestTimestamp}ms)`);
    return false;
  }
  const nodes = await networkStateService.getFluxnodesByPubkey(pubkey);
  if (!nodes) {
    log.warn(`Sync request from ${peer.key} rejected: pubkey not in node list`);
    return false;
  }
  const msg = buildSyncSignatureMessage(decoded.type, sinceTimestamp, requestTimestamp);
  const verified = verificationHelper.verifyMessage(msg, pubkey, signature);
  if (!verified) {
    log.warn(`Sync request from ${peer.key} rejected: bad signature`);
    return false;
  }
  return true;
}

peerManager.hashHandlers = {
  handleHashPresent: (peer, hexHash) => {
    const counter = peer.msgMap.get('newHash');
    peer.msgMap.set('newHash', counter + 1);
    setImmediate(() => handleCheckMessageHashPresent(hexHash, peer.ip, peer.port));
  },
  handleHashRequest: (peer, hexHash) => {
    const counter = peer.msgMap.get('requestHash');
    peer.msgMap.set('requestHash', counter + 1);
    setImmediate(() => handleRequestMessageHash(hexHash, peer.ip, peer.port));
  },
  handleTempMessagesRequest: (peer, decoded) => {
    const now = Date.now();
    const last = peer.lastTempSyncResponse || 0;
    if (now - last < (config.fluxapps.syncResponseThrottleMs ?? 300000)) return;
    peer.lastTempSyncResponse = now;
    setImmediate(async () => {
      if (!await verifySyncRequest(peer, decoded)) return;
      fluxCommunicationMessagesSender.respondWithTempMessages(peer, decoded.sinceTimestamp);
    });
  },
  handleAppRunningRequest: (peer, decoded) => {
    const now = Date.now();
    const last = peer.lastAppRunningSyncResponse || 0;
    if (now - last < (config.fluxapps.syncResponseThrottleMs ?? 300000)) return;
    peer.lastAppRunningSyncResponse = now;
    setImmediate(async () => {
      if (!await verifySyncRequest(peer, decoded)) return;
      fluxCommunicationMessagesSender.respondWithAppRunningMessages(peer, decoded.sinceTimestamp);
    });
  },
  handleAppInstallingRequest: (peer, decoded) => {
    const now = Date.now();
    const last = peer.lastAppInstallingSyncResponse || 0;
    if (now - last < (config.fluxapps.syncResponseThrottleMs ?? 300000)) return;
    peer.lastAppInstallingSyncResponse = now;
    setImmediate(async () => {
      if (!await verifySyncRequest(peer, decoded)) return;
      fluxCommunicationMessagesSender.respondWithAppInstallingMessages(peer, decoded.sinceTimestamp);
    });
  },
  handleAppInstallingErrorsRequest: (peer, decoded) => {
    const now = Date.now();
    const last = peer.lastAppInstallingErrorsSyncResponse || 0;
    if (now - last < (config.fluxapps.syncResponseThrottleMs ?? 300000)) return;
    peer.lastAppInstallingErrorsSyncResponse = now;
    setImmediate(async () => {
      if (!await verifySyncRequest(peer, decoded)) return;
      fluxCommunicationMessagesSender.respondWithAppInstallingErrorsMessages(peer, decoded.sinceTimestamp);
    });
  },
};


/**
 * To get IP addresses for all outgoing connected peers.
 * @param {object} req Request.
 * @param {object} res Response.
 */
/**
 * @deprecated Use getPeers with direction=outbound instead.
 */
function connectedPeers(req, res) {
  const connections = [];
  for (const peer of peerManager.outboundValues()) {
    connections.push(peer.ip);
  }
  const message = messageHelper.createDataMessage(connections);
  return res ? res.json(message) : message;
}

/**
 * @deprecated Use getPeers with direction=outbound instead.
 */
function connectedPeersInfo(req, res) {
  const connections = [...peerManager.outboundValues()].map((p) => p.toPeerInfo());
  const message = messageHelper.createDataMessage(connections);
  return res ? res.json(message) : message;
}

/**
 * To keep connections alive by pinging all outgoing and incoming peers.
 */
function keepConnectionsAlive() {
  networkHealthMonitor.setPeerManager(peerManager);
  peerManager.networkHealthMonitor = networkHealthMonitor;
  setInterval(() => {
    peerManager.pingAll();
  }, config.fluxapps.wsPingIntervalMs ?? 15000);
}

/**
 * To remove an outgoing peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function removePeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;

    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      res.json(message);
      return;
    }

    const normalized = serviceHelper.normalizeNodeIpApiPort(
      ip,
      { portAsNumber: true },
    );

    if (!normalized) {
      const unparsableError = messageHelper.createErrorMessage(
        'Unparsable `ip` parameter',
      );
      res.json(unparsableError);
      return;
    }

    const response = await fluxNetworkHelper.closeConnection(...normalized);

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
 * To remove an incoming peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} expressWS Express web socket.
 * @returns {Promise<void>}
 */
async function removeIncomingPeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;

    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      res.json(message);
      return;
    }

    const normalized = serviceHelper.normalizeNodeIpApiPort(
      ip,
      { portAsNumber: true },
    );

    if (!normalized) {
      const unparsableError = messageHelper.createErrorMessage(
        'Unparsable `ip` parameter',
      );
      res.json(unparsableError);
      return;
    }

    const response = await fluxNetworkHelper.closeIncomingConnection(...normalized);
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
 * To initiate and handle a connection. Opens a web socket and handles various events during connection.
 * @param {string} connection IP address (and port if applicable).
 */
let myPort = null;
let discoveryRunning = false;

/** @type {WeakMap<WebSocket, {ip: string, port: string, source: string}>} */
const wsMetadata = new WeakMap();

function onOutboundError(error) {
  const meta = wsMetadata.get(this);
  if (!meta) return;
  const key = `${meta.ip}:${meta.port}`;
  peerManager.clearPending(key);
  log.error(`Outbound connection to ${key} failed: ${error.message}`);
}

function onOutboundOpen() {
  const meta = wsMetadata.get(this);
  if (!meta) return;
  peerManager.add(this, meta.ip, meta.port, {
    source: meta.source,
    remoteCapabilities: meta.remoteCapabilities,
    remoteClockOffsetMs: meta.remoteClockOffsetMs,
    remoteVersion: meta.remoteVersion,
    remoteFluxUptime: meta.remoteFluxUptime,
  });
}

function onOutboundUpgrade(response) {
  const meta = wsMetadata.get(this);
  if (!meta) return;
  if (response.headers['x-flux-capabilities']) {
    meta.remoteCapabilities = response.headers['x-flux-capabilities'].split(',').map((s) => s.trim()).filter(Boolean);
  }
  const clockHeader = response.headers['x-flux-clock-offset'];
  if (clockHeader !== undefined) {
    meta.remoteClockOffsetMs = Number(clockHeader);
  }
  if (response.headers['x-flux-version']) {
    meta.remoteVersion = response.headers['x-flux-version'];
  }
  if (response.headers['x-flux-uptime']) {
    meta.remoteFluxUptime = Number(response.headers['x-flux-uptime']);
  }
}

async function initiateAndHandleConnection(connection, source = PEER_SOURCE.RANDOM) {
  let ip = connection;
  let port = config.server.apiport.toString();
  try {
    if (connection.includes(':')) {
      ip = connection.split(':')[0];
      port = connection.split(':')[1];
    }
    const key = `${ip}:${port}`;
    if (peerManager.has(key) || peerManager.isPending(key)) return;
    peerManager.markPending(key);
    if (!myPort) {
      const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
      if (!myIP) {
        peerManager.clearPending(key);
        return;
      }
      myPort = myIP.split(':')[1] || '16127';
    }
    const options = {
      handshakeTimeout: config.fluxapps.wsHandshakeTimeoutMs ?? 10000,
      perMessageDeflate: {
        zlibDeflateOptions: {
        // See zlib defaults.
          chunkSize: 1024,
          memLevel: 9,
          level: 9,
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024,
        },
        // Other options settable:
        clientNoContextTakeover: true, // Defaults to negotiated value.
        serverNoContextTakeover: true, // Defaults to negotiated value.
        serverMaxWindowBits: 15, // Defaults to negotiated value.
        clientMaxWindowBits: 15, // Defaults to negotiated value.
        // Below options specified as default values.
        concurrencyLimit: 2, // Limits zlib concurrency for perf.
        threshold: 128, // Size (in bytes) below which messages
      // should not be compressed if context takeover is disabled.
      },
      headers: {
        'X-Flux-Capabilities': FLUX_CAPABILITIES.join(','),
        'X-Flux-Version': FLUX_VERSION,
        'X-Flux-Uptime': String(Math.floor(process.uptime())),
      },
    };
    const offsetMs = fluxNetworkHelper.getLocalClockOffsetMs();
    if (offsetMs !== null) {
      options.headers['X-Flux-Clock-Offset'] = String(offsetMs);
    }
    if (source === PEER_SOURCE.RECONNECT) {
      options.headers['X-Flux-Reconnect'] = 'true';
    }
    const wsuri = `ws://${ip}:${port}/ws/flux/${myPort}`;
    const websocket = new WebSocket(wsuri, options);
    wsMetadata.set(websocket, { ip, port, source });
    websocket.on('error', onOutboundError);
    websocket.on('upgrade', onOutboundUpgrade);
    websocket.onopen = onOutboundOpen;
  } catch (error) {
    const catchKey = `${ip}:${port}`;
    peerManager.clearPending(catchKey);
    log.error(error);
  }
}

/**
 * Open an ephemeral connection to a peer. Returns a promise that resolves
 * with the FluxPeerSocket once connected, or null on failure.
 * @param {string} connection - IP or IP:port
 * @returns {Promise<FluxPeerSocket|null>}
 */
function openEphemeralConnection(connection) {
  return new Promise((resolve) => {
    let ip = connection;
    let port = config.server.apiport.toString();
    try {
      if (connection.includes(':')) {
        ip = connection.split(':')[0];
        port = connection.split(':')[1];
      }
      const key = `${ip}:${port}`;
      if (peerManager.isPending(key)) {
        log.info(`Ephemeral connection to ${key} skipped: pending`);
        resolve(null);
        return;
      }
      peerManager.markPending(key);
      if (!myPort) {
        peerManager.clearPending(key);
        log.warn(`Ephemeral connection to ${key} skipped: myPort not set`);
        resolve(null);
        return;
      }
      const options = {
        handshakeTimeout: config.fluxapps.wsHandshakeTimeoutMs ?? 10000,
        headers: {
          'X-Flux-Capabilities': FLUX_CAPABILITIES.join(','),
          'X-Flux-Version': FLUX_VERSION,
          'X-Flux-Uptime': String(Math.floor(process.uptime())),
        },
      };
      const offsetMs = fluxNetworkHelper.getLocalClockOffsetMs();
      if (offsetMs !== null) {
        options.headers['X-Flux-Clock-Offset'] = String(offsetMs);
      }
      const wsuri = `ws://${ip}:${port}/ws/flux/${myPort}`;
      const websocket = new WebSocket(wsuri, options);
      const meta = { ip, port };
      let settled = false;

      websocket.on('upgrade', (response) => {
        if (response.headers['x-flux-capabilities']) {
          meta.remoteCapabilities = response.headers['x-flux-capabilities'].split(',').map((s) => s.trim()).filter(Boolean);
        }
        const clockHeader = response.headers['x-flux-clock-offset'];
        if (clockHeader !== undefined) {
          meta.remoteClockOffsetMs = Number(clockHeader);
        }
      });

      websocket.on('error', (error) => {
        if (settled) return;
        settled = true;
        peerManager.clearPending(key);
        log.warn(`Ephemeral connection to ${key} failed: ${error.message}`);
        resolve(null);
      });

      websocket.on('close', (code, reason) => {
        if (settled) return;
        settled = true;
        peerManager.clearPending(key);
        log.warn(`Ephemeral connection to ${key} closed before open: ${code} ${reason}`);
        resolve(null);
      });

      websocket.onopen = () => {
        if (settled) return;
        settled = true;
        const peer = peerManager.addEphemeral(websocket, meta.ip, meta.port, {
          remoteCapabilities: meta.remoteCapabilities,
          remoteClockOffsetMs: meta.remoteClockOffsetMs,
        });
        resolve(peer);
      };
    } catch (error) {
      peerManager.clearPending(`${ip}:${port}`);
      log.error(error);
      resolve(null);
    }
  });
}

/**
 * To add a peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function addPeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;

    const authorized = await verificationHelper.verifyPrivilege(
      'adminandfluxteam',
      req,
    );

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      res.json(message);
      return;
    }

    const normalized = serviceHelper.normalizeNodeIpApiPort(
      ip,
      { portAsNumber: true },
    );

    if (!normalized) {
      const unparsableError = messageHelper.createErrorMessage(
        'Unparsable `ip` parameter',
      );
      res.json(unparsableError);
      return;
    }

    const [peerIp, peerPort] = normalized;

    if (peerManager.has(`${peerIp}:${peerPort}`)) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${peerIp}:${peerPort}`);
      res.json(errMessage);
      return;
    }

    setImmediate(() => initiateAndHandleConnection(ip, PEER_SOURCE.MANUAL));

    const message = messageHelper.createSuccessMessage(
      `Outgoing connection to ${peerIp}:${peerPort} initiated`,
    );

    res.json(message);
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
 * Function to be called by FluxNodes without the minimum Incoming connections.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addOutgoingPeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;
    if (ip === undefined || ip === null) {
      const errMessage = messageHelper.createErrorMessage('No IP address specified.');
      return res.json(errMessage);
    }
    const justIP = ip.split(':')[0];

    const remoteIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.headers['x-forwarded-for'];

    const remoteIP4 = remoteIP.replace('::ffff:', '');

    if (justIP !== remoteIP4) {
      const errMessage = messageHelper.createErrorMessage(`Request ip ${remoteIP4} of ${remoteIP} doesn't match the ip: ${justIP} to connect.`);
      return res.json(errMessage);
    }
    const port = ip.split(':')[1] || '16127';

    if (peerManager.has(`${justIP}:${port}`)) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${justIP}:${port}`);
      return res.json(errMessage);
    }

    const nodeList = await fluxCommunicationUtils.deterministicFluxList();
    const fluxNode = nodeList.find((node) => node.ip.split(':')[0] === ip.split(':')[0] && (node.ip.split(':')[1] || '16127') === port);
    if (!fluxNode) {
      const errMessage = messageHelper.createErrorMessage(`FluxNode ${ip.split(':')[0]}:${port} is not confirmed on the network.`);
      return res.json(errMessage);
    }

    initiateAndHandleConnection(ip, PEER_SOURCE.DETERMINISTIC);
    const message = messageHelper.createSuccessMessage(`Outgoing connection to ${ip.split(':')[0]}:${port} initiated`);
    return res.json(message);
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

function startDiscovery() {
  if (discoveryRunning) return;
  discoveryRunning = true;
  fluxDiscovery();
}

async function startDiscoveryApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('fluxteam', req);
    if (authorized !== true) {
      return res.json(messageHelper.errUnauthorizedMessage());
    }
    startDiscovery();
    return res.json(messageHelper.createSuccessMessage('Discovery started'));
  } catch (error) {
    log.error(error);
    return res.json(messageHelper.createErrorMessage(error.message || error));
  }
}

/**
 * To discover and connect to other randomly selected FluxNodes. Maintains connections with 1-2% of nodes on the Flux network. Ensures that FluxNode connections are not duplicated.
 */
async function fluxDiscovery() {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced. Flux discovery is awaiting.');
    }

    if (!nodeConfirmationService.isConfirmed()) {
      throw new Error('Node not confirmed. Flux discovery is awaiting.');
    }

    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();

    if (!myIP) {
      throw new Error('Flux IP not detected. Flux discovery is awaiting.');
    }

    const sortedNodeList = await fluxCommunicationUtils.deterministicFluxList({
      sort: true,
      addressOnly: true,
    });

    peerManager.numberOfFluxNodes = sortedNodeList.length;

    log.info('Searching for my node on sortedNodeList');
    const fluxNodeIndex = sortedNodeList.findIndex((ip) => ip === myIP);
    log.info(`My node was found on index: ${fluxNodeIndex} of ${sortedNodeList.length} nodes`);
    const minDeterministicOutPeers = Math.min(sortedNodeList.length, config.fluxapps.minOutgoing);
    // const minIncomingPeers = Math.min(sortedNodeList.length, 1.5 * config.fluxapps.minIncoming);
    log.info(`Current number of outgoing connections:${peerManager.outboundCount}`);
    log.info(`Current number of incoming connections:${peerManager.inboundCount}`);
    // always try to connect to deterministic nodes
    // established deterministic outgoing connections
    let deterministicPeerConnections = false;
    const myIpGroup = FluxPeerManager.getIpGroup(myIP.split(':')[0]);

    // established deterministic 8 outgoing connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex + i < sortedNodeList.length ? fluxNodeIndex + i : fluxNodeIndex + i - sortedNodeList.length;
      const ip = sortedNodeList[fixedIndex];
      const ipInc = ip.split(':')[0];
      if (!ipInc || ipInc === myIP.split(':')[0]) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const portInc = ip.split(':')[1] || '16127';
      if (peerManager.shouldAttemptConnection(ipInc, portInc)) {
        deterministicPeerConnections = true;
        initiateAndHandleConnection(ip, PEER_SOURCE.DETERMINISTIC);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(DISCOVERY.connectionDelayMs);
      }
    }
    // established deterministic 8 incoming connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex - i >= 0 ? fluxNodeIndex - i : sortedNodeList.length + fluxNodeIndex - i;
      const ip = sortedNodeList[fixedIndex];
      const ipInc = ip.split(':')[0];
      if (!ipInc || ipInc === myIP.split(':')[0]) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const portInc = ip.split(':')[1] || '16127';
      if (peerManager.shouldAttemptConnection(ipInc, portInc)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await serviceHelper.axiosGet(
          `http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`,
          { timeout: 5_000 },
        ).catch((error) => {
          peerManager.recordFailedConnection(ipInc, portInc);
          if (error.code !== 'ECONNREFUSED') log.error(error);
          return null;
        });

        if (result) deterministicPeerConnections = true;
      }
    }
    if (deterministicPeerConnections) {
      log.info('Connections to deterministic peers established');
    }

    await serviceHelper.delay(DISCOVERY.connectionDelayMs);

    // Process reconnect queue — retry recently disconnected outbound peers
    const reconnectCandidates = peerManager.getReconnectCandidates();
    for (const candidate of reconnectCandidates) {
      log.info(`Reconnecting to queued peer: ${candidate.key} (attempt ${candidate.attempts})`);
      initiateAndHandleConnection(`${candidate.ip}:${candidate.port}`, PEER_SOURCE.RECONNECT);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(DISCOVERY.connectionDelayMs);
    }

    // Prune expired unstable node entries periodically
    peerManager.pruneUnstableList();

    const triedIps = new Set();
    const triedIpGroups = new Set();

    // Random outbound connections
    const outThresholds = { maxCount: DISCOVERY.maxOutbound, minUniqueIps: DISCOVERY.minUniqueOutboundIps };
    let index = 0;
    while (peerManager.needsMorePeers(DIRECTION.OUTBOUND, outThresholds) && index < DISCOVERY.maxIterations) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await networkStateService.getRandomSocketAddress(myIP);
      if (connection) {
        const [ipInc, portInc = '16127'] = connection.split(':');
        if (!peerManager.canAcceptPeer(ipInc, portInc, DIRECTION.OUTBOUND, myIpGroup)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const ipGroup = FluxPeerManager.getIpGroup(ipInc);
        if (triedIpGroups.has(ipGroup) || triedIps.has(ipInc)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`Adding random Flux peer: ${connection}`);
        triedIps.add(ipInc);
        triedIpGroups.add(ipGroup);
        initiateAndHandleConnection(connection);
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(DISCOVERY.connectionDelayMs);
    }

    // Random inbound connections
    const inThresholds = { maxCount: DISCOVERY.maxInbound, minUniqueIps: DISCOVERY.minUniqueInboundIps };
    index = 0;
    while (peerManager.needsMorePeers(DIRECTION.INBOUND, inThresholds) && index < DISCOVERY.maxIterations) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await networkStateService.getRandomSocketAddress(myIP);
      if (connection) {
        const [ipInc, portInc = '16127'] = connection.split(':');
        if (!peerManager.canAcceptPeer(ipInc, portInc, DIRECTION.INBOUND, myIpGroup)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const ipGroup = FluxPeerManager.getIpGroup(ipInc);
        if (triedIpGroups.has(ipGroup) || triedIps.has(ipInc)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`Asking random Flux ${connection} to add us as a peer`);
        triedIps.add(ipInc);
        triedIpGroups.add(ipGroup);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.axiosGet(
          `http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`,
          { timeout: 5_000 },
        ).catch((error) => log.error(error));
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(DISCOVERY.connectionDelayMs);
    }
    setTimeout(() => {
      fluxDiscovery();
    }, config.fluxapps.discoveryRetryMs ?? 60000);
  } catch (error) {
    log.warn(error.message || error);
    setTimeout(() => {
      fluxDiscovery();
    }, config.fluxapps.discoveryFailRetryMs ?? 120000);
  }
}

function initializeDiscovery() {
  nodeConfirmationService.onConfirmationChange((confirmed) => {
    if (confirmed) {
      peerManager.allowConnections();
    } else {
      log.info('fluxDiscovery - Confirmation lost, disconnecting all peers');
      peerManager.disconnectAll();
    }
  });
}

/**
 * Get detailed peer info for a single peer.
 * @param {FluxPeerSocket} peer
 * @returns {object}
 */
function peerToDetailedInfo(peer) {
  return {
    ip: peer.ip,
    port: peer.port,
    direction: peer.direction,
    latency: peer.latency,
    missedPongs: peer.missedPongs,
    lastPingTime: peer.lastPingTime,
    lastPongTime: peer.lastPongTime,
    connectedAt: peer.connectedAt,
    uptime: Date.now() - peer.connectedAt,
    source: peer.source,
    isAlive: peer.isAlive,
    badMessages: peer.badMessageTimestamps.length,
    capabilities: [...peer.remoteCapabilities],
    remoteClockOffsetMs: peer.remoteClockOffsetMs,
    lastTransmissionDelay: peer.lastTransmissionDelay,
    messagesReceived: peer.messagesReceived,
    messagesSent: peer.messagesSent,
    bytesReceived: peer.bytesReceived,
    bytesSent: peer.bytesSent,
    remoteVersion: peer.remoteVersion,
    reconnects: peer.reconnects,
  };
}

/**
 * Get peers, optionally filtered by direction or specific key.
 * GET /flux/peers — all peers
 * GET /flux/peers/outbound — outbound only
 * GET /flux/peers/inbound — inbound only
 * GET /flux/peers/:ip:port — specific peer detail
 * @param {object} req Request.
 * @param {object} res Response.
 */
function getPeers(req, res) {
  const { filter } = req.params;

  if (filter === 'outbound') {
    const peers = [...peerManager.outboundValues()].map(peerToDetailedInfo);
    return res.json(messageHelper.createDataMessage(peers));
  }

  if (filter === 'inbound') {
    const peers = [...peerManager.inboundValues()].map(peerToDetailedInfo);
    return res.json(messageHelper.createDataMessage(peers));
  }

  if (filter && filter.includes('.')) {
    // Specific peer lookup by ip:port
    const peer = peerManager.get(filter);
    if (!peer) {
      return res.json(messageHelper.createErrorMessage(`Peer ${filter} not found`));
    }
    return res.json(messageHelper.createDataMessage(peerToDetailedInfo(peer)));
  }

  // All peers
  const peers = [...peerManager.allValues()].map(peerToDetailedInfo);
  return res.json(messageHelper.createDataMessage(peers));
}

/**
 * Get list of nodes flagged as unstable (5+ disconnects in 2 hours).
 * GET /flux/unstablenodes
 * @param {object} req Request.
 * @param {object} res Response.
 */
function getUnstableNodes(req, res) {
  const unstable = [];
  for (const [key, entry] of peerManager.unstableEntries()) {
    if (entry.disconnects >= 5) {
      const [ip, port] = key.split(':');
      unstable.push({
        ip,
        port,
        disconnects: entry.disconnects,
        firstDisconnect: entry.firstDisconnect,
      });
    }
  }
  return res.json(messageHelper.createDataMessage(unstable));
}

/**
 * Get peer connection history from the ring buffer.
 * GET /flux/peerhistory — all events
 * GET /flux/peerhistory?ip=75.6.52 — filter by IP prefix
 * GET /flux/peerhistory?code=4004 — filter by close code
 * GET /flux/peerhistory?event=disconnected — filter by event type
 * GET /flux/peerhistory?limit=50 — limit results (most recent)
 * GET /flux/peerhistory?since=1773520000000 — events after timestamp
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getPeerHistory(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    return res.json(messageHelper.errUnauthorizedMessage());
  }
  const { ip, code, event, limit, since } = req.query;
  const filters = {};
  if (since) filters.since = Number(since);
  if (ip) filters.ip = ip;
  if (code) filters.code = Number(code);
  if (event) filters.event = event;
  if (limit) filters.limit = Number(limit);
  const events = peerManager.getFilteredHistory(filters);
  return res.json(messageHelper.createDataMessage(events));
}

/**
 * Get peer exchange topology — what peers our peers have reported.
 * GET /flux/topology
 * @param {object} req Request.
 * @param {object} res Response.
 */
function getTopology(req, res) {
  const topology = {};
  for (const [reporter, entry] of peerManager.topologyEntries()) {
    topology[reporter] = {
      outbound: [...entry.outbound],
      inbound: [...entry.inbound],
    };
  }
  const data = {
    reporters: peerManager.peerTopologySize,
    knownPeers: peerManager.knownPeers.size,
    topology,
  };
  return res.json(messageHelper.createDataMessage(data));
}

/**
 * Get network health status and diagnosis history.
 * GET /flux/networkhealth
 * @param {object} req Request.
 * @param {object} res Response.
 */
function getNetworkHealth(req, res) {
  const data = {
    status: networkHealthMonitor.getStatus(),
    inSteadyState: networkHealthMonitor.isInSteadyState(),
    history: networkHealthMonitor.getDiagnosisHistory(),
  };
  return res.json(messageHelper.createDataMessage(data));
}

function logSockets() {
  const inboundMessages = { requestHash: 0, newHash: 0 };
  const outboundMessages = { requestHash: 0, newHash: 0 };

  for (const peer of peerManager.inboundValues()) {
    inboundMessages.requestHash += peer.msgMap.get('requestHash');
    inboundMessages.newHash += peer.msgMap.get('newHash');
    peer.msgMap = new Map([['requestHash', 0], ['newHash', 0]]);
  }
  for (const peer of peerManager.outboundValues()) {
    outboundMessages.requestHash += peer.msgMap.get('requestHash');
    outboundMessages.newHash += peer.msgMap.get('newHash');
    peer.msgMap = new Map([['requestHash', 0], ['newHash', 0]]);
  }

  const { requestHash: inboundRequest, newHash: inboundNew } = inboundMessages;
  const { requestHash: outboundRequest, newHash: outboundNew } = outboundMessages;

  log.info('Inbound socket info. Hash Requests: '
    + `${inboundRequest}, New Hashes: ${inboundNew}`);

  log.info('Outbound socket info. Hash Requests: '
    + `${outboundRequest}, New Hashes: ${outboundNew}`);
}

function logSocketsEvery(intervalMs) {
  // do this properly
  setInterval(logSockets, intervalMs);
}

module.exports = {
  connectedPeers,
  removePeer,
  removeIncomingPeer,
  connectedPeersInfo,
  keepConnectionsAlive,
  fluxDiscovery,
  initializeDiscovery,
  startDiscoveryApi,
  handleAppMessages,
  addPeer,
  logSocketsEvery,
  handleAppRunningMessage,
  handleIPChangedMessage,
  handleAppRemovedMessage,
  handleNodeSigtermMessage,
  initiateAndHandleConnection,
  addOutgoingPeer,
  getPeers,
  getUnstableNodes,
  getPeerHistory,
  getTopology,
  getNetworkHealth,
  openEphemeralConnection,
};
