/* eslint-disable no-underscore-dangle */
const config = require('config');
const hash = require('object-hash');
const WebSocket = require('ws');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const messageStore = require('./appMessaging/messageStore');
const { appRunningEntries } = require('./utils/appRunningEntries');
const verificationHelper = require('./verificationHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const policyStore = require('./policyStore');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const messageHelper = require('./messageHelper');
const { peerManager, PEER_SOURCE, CLOSE_CODES } = require('./utils/peerState');
const { RUNNING_EXPIRY_MS } = require('./utils/appConstants');
const cacheManager = require('./utils/cacheManager').default;
const networkStateService = require('./networkStateService');
const nodeConfirmationService = require('./nodeConfirmationService');
const {
  extractIp, extractPort, normalizeSocketAddress, parseSocketAddress, socketAddressesMatch,
} = require('./utils/socketAddressUtils');
const registryManager = require('./appDatabase/registryManager');
const fluxEventBus = require('./utils/fluxEventBus');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('./utils/appSyncEvents');
const { INTENT } = require('./utils/messageIntent');
const {
  ROUTE, register, declaredIntent, handlerFor, isOrdered,
} = require('./utils/messageRoutes');

const { announcementSeen, announcementStore, wsPeerCache } = cacheManager;

/* const LRUTest = {
  max: 25000000, // 25M
  ttl: 60 * 60 * 1000, // 1h
  maxAge: 60 * 60 * 1000, // 1h
};

const testListCache = new LRUCache(LRUTest); */

const { FluxPeerManager, DIRECTION, FLUX_VERSION, FLUX_CAPABILITIES } = require('./utils/FluxPeerManager');
const { NAK_REASON, buildSyncSignatureMessage } = require('./utils/peerCodec');
const { networkHealthMonitor } = require('./utils/NetworkHealthMonitor');
const verifyPool = require('./utils/verifyPool');
const { Privilege, authOf } = require('./utils/privileges');

const DISCOVERY = {
  maxOutbound: 14,
  minUniqueOutboundIps: 9,
  maxInbound: 12,
  minUniqueInboundIps: 5,
  maxIterations: 100,
  connectionDelayMs: config.fluxapps.discoveryConnectionDelayMs ?? 500,
};

// How many events of a sync response are carried through verification and
// storage together. A response holds up to 2500, and each event fans out into a
// database operation per app it reports, so the whole response is never held at
// once.
const SYNC_EVENTS_PER_SLICE = 250;

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
      fluxEventBus.publish('network:appmessage', { hash: message.data.hash, type: message.data.type, name: message.data.appSpecifications?.name });
      announceToPeers(message, `${fromIP}:${port}`);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * The broadcasts of a sync response that verify. Rejects when any of them
 * could not be verified because the database did not answer: the response is
 * then not all recorded, and its peer has not answered.
 * @param {object[]} broadcasts
 * @param {string} label
 * @returns {Promise<object[]>}
 */
async function batchVerifyBroadcasts(broadcasts, label) {
  if (broadcasts.length === 0) return [];

  const { VerifyResult } = fluxCommunicationUtils;
  const verdicts = await fluxCommunicationUtils.verifyBroadcasts(broadcasts, {
    verifySignatures: (items) => verifyPool.verify(items),
  });
  const unreadable = verdicts.filter(({ result }) => result === VerifyResult.UNREADABLE).length;
  if (unreadable > 0) throw new Error(`${label} - ${unreadable} broadcasts could not be verified, the database did not answer`);
  const verified = broadcasts.filter((broadcast, i) => verdicts[i].result === VerifyResult.OK);
  const signatureFailures = verdicts.filter(({ result }) => result === VerifyResult.BAD_SIGNATURE).length;
  const nodeCheckFailures = broadcasts.length - verified.length - signatureFailures;

  if (nodeCheckFailures > 0) {
    log.warn(`${label} - ${nodeCheckFailures} broadcasts failed node lookup`);
  }

  log.info(`${label} - Verified ${verified.length}/${broadcasts.length} broadcasts (${nodeCheckFailures} node lookup failures, ${signatureFailures} signature failures)`);
  return verified;
}

async function handleTempSyncResponse(message, peerSocket) {
  try {
    if (!peerManager.isSyncResponseWanted(peerSocket)) return;
    const peerKey = peerSocket.key;
    if (!message.data || message.data.type !== 'fluxapptempsync') return;
    const { messages, done, refused } = message.data;
    // A peer whose own app state is not authoritative holds an unknown fraction
    // of the network's pending registrations, and says so rather than sending
    // the fraction. A refusal is an answer and not a completion - see
    // handleAppRunningSyncResponse - and a peer refuses all four streams or
    // none, so whichever refusal arrives first ends the request.
    if (refused) {
      log.info(`handleTempSyncResponse - ${peerKey} declined: its app state is not authoritative yet`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_REFUSED, 'apptemp', peerKey);
      return;
    }
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleTempSyncResponse - Received ${messages.length} temp messages from ${peerKey} (done: ${!!done})`);
    let stored = 0;
    let writeFailed = false;
    for (const msg of messages) {
      try {
        const result = await messageStore.storeAppTemporaryMessage(msg, { furtherVerification: true });
        if (result === true || result === false) stored += 1;
      } catch (err) {
        log.error(`Temp sync message failed: ${err.message}`);
        // A message this node's database could not record leaves the answer
        // incomplete; one that fails its own checks is the peer's, and is skipped.
        if (dbHelper.isDatabaseError(err)) {
          writeFailed = true;
          break;
        }
      }
    }
    if (writeFailed) {
      // What this peer sent is not all recorded, so its request ends here and
      // another peer is asked; the rest of its answer is not read.
      log.warn(`handleTempSyncResponse - a write failed, ending ${peerKey}'s request`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_WRITE_FAILED, peerKey);
      return;
    }
    log.info(`handleTempSyncResponse - Processed ${stored} of ${messages.length} messages`);
    // COUNTED LIKE THE REST. A peer is credited once it has delivered every
    // stream it was asked for, so the record that admits its responses stays
    // open until this one has ended too - the three surveys finishing first no
    // longer cuts off what is still arriving here.
    if (done) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apptemp', peerKey);
      log.info('handleTempSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Ends the request of a peer whose sync response threw part way: what it sent is
 * not all recorded, so another peer is asked, and the rest of its answer is not
 * read. A peer whose response this node no longer wants has no request to end.
 * @param {{key: string, connectionId?: number}} peerSocket
 * @param {string} handler Names the handler in the log.
 * @returns {void}
 */
function endUnrecordedRequest(peerSocket, handler) {
  if (!peerManager.isSyncResponseWanted(peerSocket)) return;
  log.warn(`${handler} - the response was not all recorded, ending ${peerSocket.key}'s request`);
  appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_WRITE_FAILED, peerSocket.key);
}

async function handleAppRunningSyncResponse(message, peerSocket) {
  try {
    if (!message.data || message.data.type !== 'fluxapprunningsync') return;
    if (!peerManager.isSyncResponseWanted(peerSocket)) return;
    const peerKey = peerSocket.key;
    const { messages, done, refused } = message.data;
    // A peer that says its own app state is not worth surveying has ANSWERED,
    // and the answer is not a completion. Marking it declined stops it being
    // offered again on this connection, which opens a deficit in the pool of
    // outstanding requests and gets another peer asked.
    if (refused) {
      log.info(`handleAppRunningSyncResponse - ${peerKey} declined: its app state is not authoritative yet`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_REFUSED, 'apprunning', peerKey);
      return;
    }
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleAppRunningSyncResponse - Received ${messages.length} events from ${peerKey} (done: ${!!done})`);

    // A sync response is processed a slice at a time. Verifying and storing the
    // whole response at once holds the events, their verification copies and the
    // database encoding of every location update in memory together, which is
    // what made a single response cost hundreds of megabytes that were never
    // returned to the OS.
    // Evictions are applied ahead of the other state events, as they were
    // before this response was processed in slices.
    const evictions = [];
    const stateEvents = [];
    // Which apps a node still runs is only known from its newest broadcast in
    // the whole response, so pruning cannot be decided from inside a slice. Only
    // verified broadcasts count - pruning deletes rows, and an unsigned event
    // must never be able to do that.
    const newestByIp = new Map();
    let locationWriteFailed = false;

    await serviceHelper.processInSlices(messages, SYNC_EVENTS_PER_SLICE, async (slice) => {
      const appRunningBroadcasts = [];
      const otherBroadcasts = [];
      const evictedEvents = [];
      for (const event of slice) {
        if (event.envelope && event.type === 'apprunning') {
          appRunningBroadcasts.push({ ...event.envelope, data: event.data });
        } else if (event.type === 'evicted') {
          // Evicted events lack per-event signatures because they are generated
          // locally by nodeStatusMonitor, which makes non-deterministic HTTP
          // probe decisions about whether a remote node is alive. The
          // isSyncResponseWanted check above ensures only solicited responses are
          // processed, but a compromised confirmed peer we sync from could still
          // include fake evictions. Impact is limited: only affects this node's
          // view and self-heals on the next apprunning broadcast (≤60 min).
          //
          // The root cause is nodeStatusMonitor itself — it will be replaced by
          // a peer quorum approach where eviction is determined by consensus of
          // signed "peer unreachable" events (3 missed pongs on the WebSocket
          // layer). Once that lands, evicted events will carry verifiable
          // signatures and this path will verify them like all other event types.
          evictedEvents.push(event);
        } else if (event.envelope) {
          otherBroadcasts.push(event);
        }
      }

      const verifiedAppRunning = await batchVerifyBroadcasts(appRunningBroadcasts, 'handleAppRunningSyncResponse');

      const otherToVerify = otherBroadcasts.map((e) => ({ ...e.envelope, data: e.data }));
      const verifiedOther = await batchVerifyBroadcasts(otherToVerify, 'handleAppRunningSyncResponse');
      const verifiedOtherSet = new Set(verifiedOther);
      evictions.push(...evictedEvents);
      for (let i = 0; i < otherBroadcasts.length; i++) {
        if (verifiedOtherSet.has(otherToVerify[i])) {
          stateEvents.push(otherBroadcasts[i]);
        }
      }

      for (const broadcast of verifiedAppRunning) {
        const { data } = broadcast;
        if (!data || data.version !== 2 || !Array.isArray(data.apps) || !data.apps.length) continue;
        // Skipped for the same reason messageStore skips it when it builds this
        // map itself: an expired broadcast is not evidence of what an IP is
        // running now. The prune it feeds only deletes rows at or below the
        // broadcast's own timestamp, so an expired one could only ever take
        // already-expired rows - but that is a bound to be read out of another
        // file, and two builders of one input should not need reconciling.
        if (data.broadcastedAt + RUNNING_EXPIRY_MS < Date.now()) continue;
        // Pruned against the apps the broadcast names that can be stored: one
        // naming only entries this node refuses says nothing about what its
        // sender runs, and is never read as one naming no apps at all.
        const { stored } = appRunningEntries(data.apps);
        if (!stored.length) continue;
        const seen = newestByIp.get(data.ip);
        if (!seen || data.broadcastedAt > seen.broadcastedAt) {
          newestByIp.set(data.ip, { names: stored.map((a) => a.name), broadcastedAt: data.broadcastedAt });
        }
      }

      if (verifiedAppRunning.length > 0) {
        const { stored, writeFailed } = await messageStore.storeBatchAppRunningMessages(verifiedAppRunning);
        if (writeFailed) locationWriteFailed = true;
        log.info(`handleAppRunningSyncResponse - Stored ${stored} of ${verifiedAppRunning.length} verified apprunning events`);
        fluxEventBus.publish('sync:chunkVerified', { syncType: 'apprunning', peer: peerKey, verified: verifiedAppRunning.length, stored });
      }
    });

    if (locationWriteFailed) {
      // What this peer sent is not all recorded, so its request ends here and
      // another peer is asked; the rest of its answer is not read.
      log.warn(`handleAppRunningSyncResponse - a location write failed, ending ${peerKey}'s request`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_WRITE_FAILED, peerKey);
      return;
    }
    await messageStore.pruneAppRunningLocations(newestByIp);

    // Applied after every slice, once every apprunning row in the response is
    // stored. Each event removes, shortens or carries only the rows broadcast
    // before it. An eviction's time is createdAt, when the evicting node made it.
    for (const event of [...evictions, ...stateEvents]) {
      if (event.type === 'sigterm') {
        await messageStore.storeAppStateEvent(event.type, { message: event.data, envelope: event.envelope });
        await messageStore.expireLocationsForSigterm(event.data.ip, event.data.broadcastedAt);
      } else if (event.type === 'appremoved') {
        await messageStore.storeAppStateEvent(event.type, { message: event.data, envelope: event.envelope });
        await messageStore.removeLocationForAppRemoved(event.data.ip, event.data.appName, event.data.broadcastedAt);
      } else if (event.type === 'evicted') {
        await messageStore.applyEviction(event.ip, Date.parse(event.createdAt));
      } else if (event.type === 'ipchanged') {
        await messageStore.storeAppStateEvent(event.type, { message: event.data, envelope: event.envelope });
        await messageStore.storeIPChangedMessage(event.data);
      }
    }

    if (done) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apprunning', peerKey);
      log.info('handleAppRunningSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
    endUnrecordedRequest(peerSocket, 'handleAppRunningSyncResponse');
  }
}

async function handleAppInstallingSyncResponse(message, peerSocket) {
  try {
    if (!peerManager.isSyncResponseWanted(peerSocket)) return;
    const peerKey = peerSocket.key;
    if (!message.data || message.data.type !== 'fluxappinstallingsync') return;
    const { messages, done, refused } = message.data;
    // A refusal is an answer and not a completion - see handleAppRunningSyncResponse.
    if (refused) {
      log.info(`handleAppInstallingSyncResponse - ${peerKey} declined: its app state is not authoritative yet`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_REFUSED, 'appinstalling', peerKey);
      return;
    }
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleAppInstallingSyncResponse - Received ${messages.length} broadcasts from ${peerKey} (done: ${!!done})`);
    let writeFailed = false;
    await serviceHelper.processInSlices(messages, SYNC_EVENTS_PER_SLICE, async (slice) => {
      const verified = await batchVerifyBroadcasts(slice, 'handleAppInstallingSyncResponse');
      if (verified.length === 0) return;
      const stored = await messageStore.storeBatchAppInstallingMessages(verified);
      if (stored.writeFailed) writeFailed = true;
      log.info(`handleAppInstallingSyncResponse - Stored ${stored.stored} of ${verified.length} verified broadcasts`);
      fluxEventBus.publish('sync:chunkVerified', { syncType: 'appinstalling', peer: peerKey, verified: verified.length, stored: stored.stored });
    });
    if (writeFailed) {
      // What this peer sent is not all recorded, so its request ends here and
      // another peer is asked; the rest of its answer is not read.
      log.warn(`handleAppInstallingSyncResponse - a write failed, ending ${peerKey}'s request`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_WRITE_FAILED, peerKey);
      return;
    }
    if (done) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'appinstalling', peerKey);
      log.info('handleAppInstallingSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
    endUnrecordedRequest(peerSocket, 'handleAppInstallingSyncResponse');
  }
}

async function handleAppInstallingErrorsSyncResponse(message, peerSocket) {
  try {
    if (!peerManager.isSyncResponseWanted(peerSocket)) return;
    const peerKey = peerSocket.key;
    if (!message.data || message.data.type !== 'fluxappinstallingerrorssync') return;
    const { messages, done, refused } = message.data;
    // A refusal is an answer and not a completion - see handleAppRunningSyncResponse.
    if (refused) {
      log.info(`handleAppInstallingErrorsSyncResponse - ${peerKey} declined: its app state is not authoritative yet`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_REFUSED, 'apperrors', peerKey);
      return;
    }
    if (!Array.isArray(messages) || messages.length > 2500) return;
    log.info(`handleAppInstallingErrorsSyncResponse - Received ${messages.length} broadcasts from ${peerKey} (done: ${!!done})`);
    let writeFailed = false;
    await serviceHelper.processInSlices(messages, SYNC_EVENTS_PER_SLICE, async (slice) => {
      const verified = await batchVerifyBroadcasts(slice, 'handleAppInstallingErrorsSyncResponse');
      if (verified.length === 0) return;
      const stored = await messageStore.storeBatchAppInstallingErrorMessages(verified);
      if (stored.writeFailed) writeFailed = true;
      log.info(`handleAppInstallingErrorsSyncResponse - Stored ${stored.stored} of ${verified.length} verified broadcasts`);
      fluxEventBus.publish('sync:chunkVerified', { syncType: 'apperrors', peer: peerKey, verified: verified.length, stored: stored.stored });
    });
    if (writeFailed) {
      // What this peer sent is not all recorded, so its request ends here and
      // another peer is asked; the rest of its answer is not read.
      log.warn(`handleAppInstallingErrorsSyncResponse - a write failed, ending ${peerKey}'s request`);
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_WRITE_FAILED, peerKey);
      return;
    }
    if (done) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, 'apperrors', peerKey);
      log.info('handleAppInstallingErrorsSyncResponse - Sync complete');
    }
  } catch (error) {
    log.error(error);
    endUnrecordedRequest(peerSocket, 'handleAppInstallingErrorsSyncResponse');
  }
}

/**
 * Tell peers this node holds a message, and keep it for whichever of them asks.
 *
 * The store is written here rather than at dispatch because this is where a message
 * becomes something a peer can ask for: a request follows an announcement, and only a
 * verified message reaches a handler. Nothing this node never announced is ever asked
 * of it, so nothing else needs keeping.
 * @param {object} message The verified signed envelope, as it will be handed over.
 * @param {string} excludeKey The peer it came from, which has it already.
 */
function announceToPeers(message, excludeKey) {
  const messageHash = hash(message.data);
  announcementStore.set(messageHash, message);
  peerManager.broadcastHash(messageHash, excludeKey);
}

async function handleCheckMessageHashPresent(messageHash, fromIP, port) {
  try {
    noteOwnMoveHeardBack(messageHash);
    // The filter, not the store: the question is whether this node already has the
    // message, and it has plenty it never announced - anything the database already
    // held when it arrived. Asking the store would re-request those.
    if (!announcementSeen.has(messageHash)) {
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
    // The store, not the filter: this hands the message over, so it needs the message.
    // A request follows an announcement, so what a peer can ask for is what this node
    // announced, which is exactly what the store holds.
    if (announcementStore.has(messageHash)) {
      const message = announcementStore.get(messageHash);
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
    if (result instanceof Error) {
      log.warn(`handleAppRunningMessage - not stored, from ${fromIP}:${port} for ${message.data?.ip}: ${result.message}`);
      return;
    }
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    const relayed = Boolean(result.rebroadcast && timestampOK);
    if (relayed) {
      announceToPeers(message, `${fromIP}:${port}`);
    }
    // Everything this node did with the message: the entries it wrote, the names
    // it refused, whether it cleared the sender's rows, and whether it passed it on.
    // A message that did none of these, such as a copy of one already stored,
    // publishes nothing.
    if (result.written.length || result.refused.length || result.cleared || relayed) {
      fluxEventBus.publish('network:apprunning', {
        ip: message.data.ip,
        apps: result.written,
        refused: result.refused,
        cleared: result.cleared,
        relayed,
      });
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
    if (rebroadcastToPeers === true) {
      // Version 2 withdraws the sender's claim rather than recording one and
      // arrives through this handler too, so the event names which it was.
      fluxEventBus.publish('network:appinstalling', {
        ip: message.data.ip,
        name: message.data.name,
        withdrawn: message.data.withdrawn === true,
      });
    }
    // The signed claim is what this node serves to peers syncing from it: one that is
    // not recorded is not relayed as though it were.
    await messageStore.storeSignedAppInstallingBroadcast(message);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp);
    if (rebroadcastToPeers === true && timestampOK) {
      announceToPeers(message, `${fromIP}:${port}`);
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
    if (rebroadcastToPeers === true) {
      fluxEventBus.publish('network:appinstallingerror', { ip: message.data.ip, name: message.data.name });
    }
    await messageStore.storeSignedAppInstallingErrorBroadcast(message);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp);
    if (rebroadcastToPeers === true && timestampOK) {
      announceToPeers(message, `${fromIP}:${port}`);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Record this node's own address move the way its peers record it: the signed
 * ipchanged event, and its location rows carried to the new address. Its own
 * broadcast reaches it only if a peer happens to relay it back, so without this
 * the one node that moved would be the one that cannot follow the move - it
 * would read FDM naming its old IP, for the minute or two FDM takes to catch up,
 * as another node holding its primary. Carrying its rows also keeps the
 * runningSince it announces, and with it its place in every app's order.
 * @param {string} oldIp This node's former socket address.
 * @param {string} newIp Its new socket address.
 * @param {number} broadcastedAt When the move was made (ms).
 */
async function recordOwnAddressMove(oldIp, newIp, broadcastedAt) {
  const move = {
    type: 'fluxipchanged', version: 1, oldIP: oldIp, newIP: newIp, broadcastedAt,
  };
  const signed = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(move);
  if (!signed) {
    log.warn(`recordOwnAddressMove - this node cannot sign as itself; its move from ${oldIp} to ${newIp} is not recorded`);
    return;
  }
  const {
    version, timestamp, pubKey, signature,
  } = JSON.parse(signed);
  await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.IPCHANGED, {
    message: move, envelope: { version, timestamp, pubKey, signature },
  });
  await messageStore.storeIPChangedMessage(move);
}

// A signed copy of a move is re-signed once it is this old, so a peer it reaches
// still has at least half of the relay window (verifyTimestampInFluxBroadcast's
// 240s in handleIPChangedMessage) to pass it on.
const OWN_MOVE_RESIGN_MS = 120 * 1000;

// This node's moves still being told to the network: each is sent to every peer
// as it connects, and dropped once a peer announces it back or it is too old to
// be applied. A move keeps the time it was made however often it is signed: that
// time decides which rows it carries and where it falls among the node's moves.
// `recordedLoaded` is whether the moves recorded before this process started
// have been read yet.
const pendingOwnMoves = [];
let sendingOwnMoves = false;
let recordedLoaded = true;

/**
 * Sign a move afresh: a new envelope timestamp over the same move.
 * @param {object} move A pending move.
 * @returns {Promise<void>}
 */
async function signOwnMove(move) {
  const signed = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(move.data);
  if (!signed) return;
  /* eslint-disable no-param-reassign */
  move.signed = signed;
  move.signedAt = Date.now();
  /* eslint-enable no-param-reassign */
}

function addPendingOwnMove(oldIp, newIp, broadcastedAt) {
  const known = pendingOwnMoves.some((move) => socketAddressesMatch(move.oldIp, oldIp) && socketAddressesMatch(move.newIp, newIp));
  if (!known) {
    const data = {
      type: 'fluxipchanged', version: 1, oldIP: oldIp, newIP: newIp, broadcastedAt,
    };
    pendingOwnMoves.push({
      oldIp, newIp, data, hash: hash(data), signed: null, signedAt: 0,
    });
  }
}

/**
 * Drops the pending moves too old for a peer to apply.
 * @returns {void}
 */
function dropExpiredOwnMoves() {
  const now = Date.now();
  for (let i = pendingOwnMoves.length - 1; i >= 0; i -= 1) {
    const move = pendingOwnMoves[i];
    if (now - move.data.broadcastedAt >= messageStore.IP_CHANGED_VALIDITY_MS) {
      pendingOwnMoves.splice(i, 1);
      log.info(`Address move from ${move.oldIp} to ${move.newIp} is too old to be applied - no longer sent`);
    }
  }
}

/**
 * The moves this node signed to the address it holds now, read once per
 * process: a restart between noticing a move and the network hearing it would
 * otherwise leave the network without it. A move to this address that another
 * key signed is the previous holder's.
 */
async function loadRecordedOwnMoves() {
  try {
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    const ownKey = await fluxNetworkHelper.getFluxNodePublicKey();
    if (!ownKey) return;
    const recorded = await registryManager.addressMovesTo(localSocketAddr);
    // eslint-disable-next-line no-restricted-syntax
    for (const [oldIp, { to, at, signer }] of recorded) {
      if (signer === ownKey) addPendingOwnMove(oldIp, to, at);
    }
    // Only a completed read counts: until then each connecting peer asks again.
    recordedLoaded = true;
  } catch (error) {
    log.warn(`loadRecordedOwnMoves - this node's recorded moves cannot be read: ${error.message}`);
  }
}

/**
 * Send every pending move to a peer that has just connected.
 * @param {string} peerKey
 */
async function sendOwnMovesTo(peerKey) {
  if (!recordedLoaded) await loadRecordedOwnMoves();
  dropExpiredOwnMoves();
  const peer = peerManager.get(peerKey);
  if (!peer) return;
  // eslint-disable-next-line no-restricted-syntax
  for (const move of pendingOwnMoves) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (!move.signed || Date.now() - move.signedAt > OWN_MOVE_RESIGN_MS) await signOwnMove(move);
      if (move.signed && peer.send(move.signed)) {
        log.info(`Address move from ${move.oldIp} to ${move.newIp} sent to ${peerKey}`);
      }
    } catch (error) {
      log.error(`sendOwnMovesTo - the move from ${move.oldIp} to ${move.newIp} could not be sent to ${peerKey}: ${error.message}`);
    }
  }
  stopSendingOwnMovesWhenDone();
}

function startSendingOwnMoves() {
  if (sendingOwnMoves) return;
  sendingOwnMoves = true;
  peerManager.on('peerConnected', sendOwnMovesTo);
}

function stopSendingOwnMoves() {
  if (!sendingOwnMoves) return;
  sendingOwnMoves = false;
  peerManager.off('peerConnected', sendOwnMovesTo);
}

/**
 * Stop listening for peers once nothing is left to send: every pending move is
 * gone and the recorded ones have been read.
 */
function stopSendingOwnMovesWhenDone() {
  if (recordedLoaded && !pendingOwnMoves.length) stopSendingOwnMoves();
}

/**
 * A peer announced, or relayed, a message this node holds the hash of. When it
 * is one of this node's own moves, the move has gone further than the peers
 * this node sent it to - a peer never announces a message back to the one it
 * had it from - and gossip is carrying it: it is no longer sent.
 * @param {string} messageHash
 * @returns {boolean} Whether it was one of this node's moves.
 */
function noteOwnMoveHeardBack(messageHash) {
  const index = pendingOwnMoves.findIndex((move) => move.hash === messageHash);
  if (index === -1) return false;
  const [move] = pendingOwnMoves.splice(index, 1);
  log.info(`Address move from ${move.oldIp} to ${move.newIp} heard back from the network - no longer sent`);
  stopSendingOwnMovesWhenDone();
  return true;
}

/**
 * Tell the network that this node moved. Every connection it holds was made to
 * its old address and carries nothing now, so all of them are dropped; the move
 * goes to each peer as it connects at the new address, until one announces it
 * back.
 * @param {string} oldIp This node's former socket address.
 * @param {string} newIp Its new socket address.
 * @param {number} broadcastedAt When the move was made (ms).
 */
function announceOwnAddressMove(oldIp, newIp, broadcastedAt) {
  addPendingOwnMove(oldIp, newIp, broadcastedAt);
  peerManager.dropAllConnections();
  startSendingOwnMoves();
}

/**
 * Record this node's own move and announce it, once: a move already recorded
 * at the time it was made is left as it is, since the network hears it from
 * the pending move or, after a restart, from the moves sent at startup. What
 * serviceManager wires to fluxNetworkHelper's address-moved seam.
 * @param {string} oldIp This node's former socket address.
 * @param {string} newIp Its new socket address.
 * @param {number} broadcastedAt When the move was made (ms).
 */
async function handleOwnAddressMove(oldIp, newIp, broadcastedAt) {
  const recorded = (await registryManager.addressMovesFrom([oldIp])).get(normalizeSocketAddress(oldIp));
  if (recorded && recorded.at === broadcastedAt && socketAddressesMatch(recorded.to, newIp)) return;
  await recordOwnAddressMove(oldIp, newIp, broadcastedAt);
  announceOwnAddressMove(oldIp, newIp, broadcastedAt);
}

/**
 * At startup, send the moves this node recorded to the address it holds now to
 * each peer as it connects, until one announces it back.
 */
function announceRecordedOwnMovesWhenConnected() {
  recordedLoaded = false;
  startSendingOwnMoves();
}

/**
 * To handle IP changed messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 */
async function handleIPChangedMessage(message, fromIP, port) {
  try {
    noteOwnMoveHeardBack(hash(message.data));
    const envelope = { version: message.version, timestamp: message.timestamp, pubKey: message.pubKey, signature: message.signature };
    await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.IPCHANGED, { message: message.data, envelope });
    // storeIPChangedMessage answers true, false for a move too old to apply, or an
    // Error for one it refused - only true is a move worth passing on
    const rebroadcastToPeers = await messageStore.storeIPChangedMessage(message.data);
    if (rebroadcastToPeers === true) {
      fluxEventBus.publish('network:ipchanged', { oldIP: message.data.oldIP, newIP: message.data.newIP });
    }
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers === true && timestampOK) {
      announceToPeers(message, `${fromIP}:${port}`);
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
    // storeAppRemovedMessage answers true, false for a removal too old to apply, or
    // an Error for one it refused - only true is a removal worth passing on
    const rebroadcastToPeers = await messageStore.storeAppRemovedMessage(message.data);
    if (rebroadcastToPeers === true) {
      fluxEventBus.publish('network:appremoved', { ip: message.data.ip, name: message.data.appName });
    }
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers === true && timestampOK) {
      announceToPeers(message, `${fromIP}:${port}`);
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
    fluxEventBus.publish('network:sigterm', { ip });

    await messageStore.expireLocationsForSigterm(ip, broadcastedAt);

    // Rebroadcast to other peers
    announceToPeers(message, `${fromIP}:${port}`);
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
// Only an announcement is a fact whose identity is its payload, so only an announcement
// is deduplicated. An ask and an answer are about the two nodes exchanging them, and
// `hash(data)` throws the sender away - see utils/messageIntent for the table.
//
// THE FILTER WAS NEVER WHAT BOUNDED THESE. It keys on the payload, which a peer sending a
// question controls: varying the hash on a fluxapprequest defeats it in one line. What it
// suppresses is accidental duplicates, which is the job it is for. The per-peer bound is
// FluxPeerSocket's inbound token bucket - lruRateLimit(ip:port, 120), applied to every
// frame before dispatch.
//
// That bucket counts messages, not bytes, and a ~60-byte fluxpolicyrequest draws a whole
// bundle back. It is still not a reflection vector: these arrive on an established
// websocket, so the sender cannot be spoofed and receives every byte it asks for. A peer
// can make this node serve it quickly; it cannot make this node serve anyone else. If a
// byte budget is ever wanted it belongs in lruRateLimit, covering every type, not in a
// second counter here.

// How long a broadcast this node could not verify, because its database did
// not answer, waits before it is dispatched again.
const BROADCAST_VERIFY_RETRY_MS = 30 * 1000;

async function dispatchFluxMessage(msgObj, peerSocket) {
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

  await serviceHelper.delay(Math.floor(Math.random() * 75 + 1));
  // Also what a NAK names further down, so it is computed for every message.
  const messageHash = hash(msgObj.data);
  // THE FILTER IS FOR MESSAGES THAT REACH THIS NODE BY MORE THAN ONE ROUTE, WHICH IS WHAT
  // MAKES CONTENT THEIR IDENTITY. A relayed announcement arriving three ways is one fact and
  // acting once is the point. Everything else is point to point, so it reaches this node once
  // per peer that sends it, and two peers sending the same bytes are two peers rather than
  // one fact twice. Filtering those on content discards every sender after the first, which
  // for a message whose whole meaning is "ask me" discards the only thing it carries.
  //
  // The TYPE decides, never the message: one that chose for itself could opt out of the
  // filter by saying so, and a relayed type doing that is a flood every honest node joins in.
  //
  // CLAIMED BEFORE VERIFICATION, HELD ONLY BY A MESSAGE THAT EARNED IT. The filter runs first
  // because that is what bounds the cost of verifying a flood of copies. But a message that
  // does not go on to verify was never established as anything, and a hash it leaves behind
  // suppresses the genuine message that hashes the same. So the slot is released on every
  // path that does not reach a handler, and what remains is the window of one signature check
  // rather than the cache's whole ttl.
  const claimedSlot = declaredIntent(msgObj.data.type) === INTENT.ANNOUNCE;
  if (claimedSlot) {
    if (announcementSeen.has(messageHash)) return;
    announcementSeen.set(messageHash, true);
  }
  const releaseSlot = () => { if (claimedSlot) announcementSeen.delete(messageHash); };

  // check blocked list
  if (wsPeerCache.has(pubKey)) {
    try {
      log.info(`Closing ${peerSocket.direction} connection, peer is on blockedList`);
      peerSocket.close(codes.blocked, 'blocked list');
    } catch (e) {
      log.error(e);
    }
    // Nothing here judged the message; the peer is what was refused.
    releaseSlot();
    return;
  }
  const currentTimeStamp = Date.now();
  const { VerifyResult } = fluxCommunicationUtils;
  const verifyResult = await fluxCommunicationUtils.verifyFluxBroadcast(msgObj, undefined, currentTimeStamp);

  if (verifyResult === VerifyResult.UNREADABLE) {
    // The slot stays claimed while the broadcast waits, so its copies are not
    // verified meanwhile; it is dispatched afresh while it is within its window.
    if (fluxCommunicationUtils.verifyTimestampInFluxBroadcast(msgObj, currentTimeStamp + BROADCAST_VERIFY_RETRY_MS)) {
      log.warn(`Deferring a ${msgObj.data?.type} from ${peerSocket.direction} peer ${peerSocket.key}: the database did not answer`);
      setTimeout(() => {
        releaseSlot();
        dispatchFluxMessage(msgObj, peerSocket).catch((error) => log.error(error));
      }, BROADCAST_VERIFY_RETRY_MS);
    } else {
      releaseSlot();
      log.warn(`Dropping a ${msgObj.data?.type} from ${peerSocket.direction} peer ${peerSocket.key}: the database did not answer within its window`);
    }
  } else if (verifyResult === VerifyResult.OK) {
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(msgObj, currentTimeStamp);
    if (timestampOK === true) {
      const handler = handlerFor(msgObj.data.type);
      if (!handler) {
        log.warn(`Unrecognised message type of ${msgObj.data.type}`);
      } else if (isOrdered(msgObj.data.type)) {
        // It reached the wrong pipeline: the socket routes these to the per-peer queue
        // when they are wanted, so arriving here means nobody asked for it.
        log.warn(`Unsolicited ${msgObj.data.type} from ${peerSocket.direction} peer ${peerSocket.key}`);
      } else {
        setImmediate(() => {
          try {
            handler(msgObj, peerSocket);
          } catch (e) {
            log.error(e);
          }
        });
      }
    } else {
      // Signed by a real node and outside the window, which is what a replay looks like.
      releaseSlot();
      peerSocket.sendNak(messageHash, NAK_REASON.STALE);
    }
  } else if (verifyResult === VerifyResult.NODE_NOT_FOUND) {
    releaseSlot();
    // Originator's node is not in the deterministic list — stale list or node went offline.
    // The relay peer is not at fault. Drop the message, don't punish the relay.
    log.warn(`Dropping message from ${peerSocket.direction} peer ${peerSocket.key}: originator pubkey ${pubKey} not found in node list`);
    fluxEventBus.publish('network:originatorNotListed', { type: msgObj.data?.type, pubKey, relay: peerSocket.key });
  } else {
    releaseSlot();
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

const syncChunkQueues = new Map();

// Verified by dispatchSyncResponse before the chunk was queued, because whether
// a peer signed what it sent is a statement about the peer and the deadline
// waiting on it needs the answer at arrival, not at the back of a queue.
async function processSyncChunk(msgObj, peerSocket) {
  const handler = handlerFor(msgObj.data.type);
  if (!handler) {
    log.warn(`Unknown sync response type: ${msgObj.data.type}`);
    return;
  }
  await handler(msgObj, peerSocket);
}

/**
 * The envelope check, as a verdict that never rejects.
 *
 * A chunk's verdict is read twice - once by the arrival that queued it and once
 * by whichever arrival is draining - so a rejection would surface in two places
 * and one of them is holding a queue for a peer it does not own. A failure to
 * decide is not a pass: it answers null, which is not OK, and the stream ends
 * on it like any other envelope this node cannot stand behind.
 * @param {object} msgObj
 * @returns {Promise<string|null>}
 */
async function verifySyncEnvelope(msgObj) {
  try {
    return await fluxCommunicationUtils.verifyFluxBroadcast(msgObj);
  } catch (error) {
    log.error(error);
    return null;
  }
}

async function dispatchSyncResponse(msgObj, peerSocket) {
  try {
    const peerKey = peerSocket.key;
    if (!peerManager.isSyncResponseWanted(peerSocket)) return;

    // THE QUEUE IS THE ORDER, so nothing that can reorder may sit in front of
    // it. Chunks carry meaning by position: the sender sorts by timestamp and
    // an eviction has none, so evictions land in the FIRST chunk and clear a
    // node's locations outright - a later chunk processed ahead of them has its
    // rows deleted by an eviction that came before them. `done` is positional
    // too, and a stream marked finished early loses whatever was still coming.
    //
    // So the chunk takes its place here, in the same synchronous step as its
    // arrival, and the envelope check is STARTED rather than waited for. Four
    // chunks arriving together are queued in arrival order and their checks
    // race each other with no say in it.
    if (!syncChunkQueues.has(peerKey)) {
      syncChunkQueues.set(peerKey, { queue: [], processing: false });
    }
    const state = syncChunkQueues.get(peerKey);
    const chunk = { msgObj, verdict: verifySyncEnvelope(msgObj) };
    state.queue.push(chunk);
    // Decided here for the same reason: read after an await, two arrivals both
    // find a queue nobody is draining and both start draining it.
    const drainer = !state.processing;
    if (drainer) state.processing = true;

    // THE PEER SPOKE, AND IT REALLY WAS THE PEER. Two different questions used
    // to be split at the wrong seam: arrival on one side, everything else on
    // the other. The seam that matters is whose statement it is.
    //
    // Whether a peer signed what it sent is about the PEER, and it is a
    // signature check. Storing two thousand messages, or re-verifying every
    // pending registration, is about US. So the envelope is answered here, as
    // soon as the check comes back and whatever the queue is doing, and the
    // payload work stays in the drain below.
    //
    // Announced at arrival rather than after that work, because a peer that
    // answered all four requests correctly and instantly went unheard for as
    // long as WE took on the first of them - and was recorded as having said
    // nothing and set aside, with the three answers queued behind it discarded
    // on the way out.
    //
    // And unverifiable bytes are not the peer speaking. Credited as progress
    // they renewed the deadline that exists to take the slot back, so a peer
    // streaming rubbish inside every stall window held one of the answers this
    // node needs for the whole attempt while never answering at all.
    const verdict = await chunk.verdict;
    if (verdict === fluxCommunicationUtils.VerifyResult.OK && !msgObj?.data?.refused) {
      appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_PROGRESS, peerKey);
    }

    if (!drainer) return;

    while (state.queue.length > 0) {
      const next = state.queue.shift();
      const nextVerdict = await next.verdict;
      // A HOLE IS NOT A SURVEY. Stepping over the chunk and carrying on left
      // this node counting a peer as having surveyed the network out of an
      // answer it knows part of is missing - and it cannot know which part,
      // because the chunk it could not attribute is the one it cannot read.
      // The stream ends the way every other failure in this design ends: the
      // request is over, and another peer is asked.
      if (nextVerdict !== fluxCommunicationUtils.VerifyResult.OK) {
        log.warn(`Sync response from ${peerKey} failed envelope verification: ${nextVerdict}, ending its request`);
        syncChunkQueues.delete(peerKey);
        // Only about the connection this drain serves. A backlog left by a
        // connection that has since been replaced still drains, and ending a
        // request on its behalf would close the one belonging to the peer that
        // dialled back in - which has answered nothing wrong.
        if (peerManager.isSyncResponseWanted(peerSocket)) {
          appSyncEvents.emit(SYNC_EVENTS.EPHEMERAL_SYNC_UNVERIFIED, peerKey);
        }
        return;
      }
      await processSyncChunk(next.msgObj, peerSocket);
    }

    state.processing = false;
    syncChunkQueues.delete(peerKey);
  } catch (error) {
    log.error(error);
    syncChunkQueues.delete(peerSocket.key);
  }
}

// Register message dispatchers on the peerManager singleton
// Every wire type this node answers.
// Everything a node tells the network about itself or about an app it saw. One fact
// reaching us by many routes is one fact, and a relayed type must be deduplicated.
register(['zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate'],
  (msg, peer) => handleAppMessages(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
register('fluxapprunning', (msg, peer) => handleAppRunningMessage(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
register('fluxipchanged', (msg, peer) => handleIPChangedMessage(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
register('fluxappremoved', (msg, peer) => handleAppRemovedMessage(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
register('fluxappinstalling', (msg, peer) => handleAppInstallingMessage(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
register('fluxappinstallingerror', (msg, peer) => handleAppInstallingErrorMessage(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
register('fluxnodesigterm', (msg, peer) => handleNodeSigtermMessage(msg, peer.ip, peer.port), ROUTE.GOSSIP, INTENT.ANNOUNCE);
// An ask delivered by broadcast. Delivery is not the classifier: it goes to every peer,
// and it is still a question from one node that each of them answers separately.
register('fluxapprequest', (msg, peer) => fluxCommunicationMessagesSender.respondWithAppMessage(msg, peer), ROUTE.GOSSIP, INTENT.ASK);
register('fluxpolicyrequest', (msg, peer) => fluxCommunicationMessagesSender.respondWithPolicy(msg, peer), ROUTE.GOSSIP, INTENT.ASK);
// The one type sent both ways: news when a node announces what it adopted, an answer when
// it settles a peer's ask. Nothing relays it, which is what makes the marker safe to trust.
// A claim rather than an answer: a number cannot be checked, so it is a prompt to ask.
register('fluxpolicyseq', (msg, peer) => policyStore.notePeerSeq(
  msg.data.seq, peer.key, msg.data.correlationId,
), ROUTE.GOSSIP, INTENT.VARIES);
// Checked against the pinned keys before adoption, so an unsolicited bundle is no more
// dangerous than one this node asked for - and peers announce what they adopt.
register('fluxpolicy', (msg, peer) => policyStore.offerBundle(
  msg.data.bundle, peer.key, msg.data.correlationId,
), ROUTE.GOSSIP, INTENT.ANSWER);

// Answers to a sync this node asked for, which is why they are ordered.
register('fluxapptempsync', handleTempSyncResponse, ROUTE.ORDERED, INTENT.ANSWER);
register('fluxapprunningsync', handleAppRunningSyncResponse, ROUTE.ORDERED, INTENT.ANSWER);
register('fluxappinstallingsync', handleAppInstallingSyncResponse, ROUTE.ORDERED, INTENT.ANSWER);
register('fluxappinstallingerrorssync', handleAppInstallingErrorsSyncResponse, ROUTE.ORDERED, INTENT.ANSWER);

peerManager.messageDispatcher = dispatchFluxMessage;
peerManager.syncResponseDispatcher = dispatchSyncResponse;
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
 * How many peers answered our most recent ping, out of how many we hold.
 *
 * The freshest liveness signal this node has about the network, and the one that
 * tells it whether IT is the thing that has gone quiet. Peer COUNT alone cannot: a
 * socket survives wsMaxMissedPongs rounds before it is dropped, so a node that has
 * just been cut off keeps a full peer list for ~45s and reads as perfectly healthy
 * throughout - after the point a decision gated on two 30s monitor passes could
 * already have been made. missedPongs moves on the first missed round instead
 * (~15s), which lands before that.
 *
 * Reported as a ratio rather than a bare count because the useful question is
 * proportional: one silent peer among many is that peer's problem, while all of
 * them going quiet at once is this node's. An absolute floor would also be a fleet
 * size in disguise - a node configured with two peers can never reach a threshold
 * written for a node with twelve.
 *
 * @returns {{responding: number, total: number}} Peers with no missed pong, and all peers
 */
function peerResponsiveness() {
  let responding = 0;
  let total = 0;
  for (const peer of peerManager.allValues()) {
    total += 1;
    if (peer.missedPongs === 0) responding += 1;
  }
  return { responding, total };
}

/**
 * To keep connections alive by pinging all outgoing and incoming peers.
 */
function keepConnectionsAlive() {
  networkHealthMonitor.setPeerManager(peerManager);
  peerManager.networkHealthMonitor = networkHealthMonitor;
  setInterval(() => {
    peerManager.pingAll();
  }, config.peers.wsPingIntervalMs ?? 15000);
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

    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      res.json(message);
      return;
    }

    const parsed = parseSocketAddress(ip);

    if (!parsed) {
      const unparsableError = messageHelper.createErrorMessage(
        'Unparsable `ip` parameter',
      );
      res.json(unparsableError);
      return;
    }

    const response = await fluxNetworkHelper.closeConnection(parsed.ip, parsed.port);

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

    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      res.json(message);
      return;
    }

    const parsed = parseSocketAddress(ip);

    if (!parsed) {
      const unparsableError = messageHelper.createErrorMessage(
        'Unparsable `ip` parameter',
      );
      res.json(unparsableError);
      return;
    }

    const response = await fluxNetworkHelper.closeIncomingConnection(parsed.ip, parsed.port);
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
  const key = `${meta.ip}:${meta.port}`;
  const existing = peerManager.get(key);
  // A connection to this peer is already held: a live one in the same
  // direction stays, and when both ends dialed at once the pair keeps the
  // connection dialed by the lower address (peerManager.resolveCrossing), the
  // same choice the far end makes. Otherwise add() replaces the held one.
  const replaces = !existing || peerManager.resolveCrossing(existing, DIRECTION.OUTBOUND);
  if (!replaces) {
    peerManager.clearPending(key);
    try { this.close(CLOSE_CODES.DUPLICATE_PEER, 'Peer already connected'); } catch (_e) { /* noop */ }
    return;
  }
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
  const ip = extractIp(connection);
  const port = extractPort(connection);
  try {
    const key = `${ip}:${port}`;
    if (peerManager.has(key) || peerManager.isPending(key)) return;
    peerManager.markPending(key);

    // This node's own address, asked of the peer manager rather than of
    // benchmark. That is where the fact lives - fluxNetworkHelper pushes every
    // refresh into it from the one place the node learns what it is - and the
    // peer manager already answers this exact question for the sync draw.
    // Asking benchmark is an uncached RPC (executeCall), and this runs on every
    // dial: discovery's deterministic loop, the reconnect queue, the random
    // draw, the manual add and /flux/addpeer. It also made all five hard
    // dependent on benchd answering, which only discovery already was.
    //
    // Fresh enough by construction: fluxDiscovery refreshes it once per cycle
    // before it dials anything, and so do the availability checker and the
    // address-change handler. That is a bound the form this replaces did not
    // have - it read the port once per process and never again, so after an
    // address change a node announced a stale one for as long as it ran.
    let localSocketAddr = peerManager.getOwnSocketAddress?.() || null;

    if (!localSocketAddr) {
      // Never been told, which a dial arriving before the first refresh
      // genuinely is. Ask once - the answer fills the peer manager's copy on its
      // way through, so this costs one call rather than one per dial.
      localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    }

    if (!localSocketAddr) {
      peerManager.clearPending(key);
      return;
    }
    myPort = extractPort(localSocketAddr);

    // Never ourselves, and refused HERE rather than by each caller. fluxDiscovery
    // filters its own address before dialling, but it is one of four ways in -
    // manual, deterministic, reconnect and random all arrive through this
    // function, and the reconnect queue in particular re-dials whatever it holds
    // without asking whose address it is. A self-connection is not merely a
    // wasted socket: it occupies a peer slot, is offered back as a peer to
    // gossip and to sync from, and answers every question with what this node
    // already knows.
    if (socketAddressesMatch(key, localSocketAddr)) {
      log.warn(`initiateAndHandleConnection - refusing to connect to ourselves at ${key} (source ${source})`);
      peerManager.clearPending(key);
      return;
    }
    const options = {
      handshakeTimeout: config.fluxapps.wsHandshakeTimeoutMs ?? 10000,
      perMessageDeflate: {
        zlibDeflateOptions: {
        // See zlib defaults.
          chunkSize: 1024,
          // No-context-takeover resets the stream after every message, so the
          // window only ever matches within one. Gossip messages are a few KB
          // and compress to the same bytes on an 8KB window as on a 32KB one,
          // for a third of the memory - and a context is held per peer socket.
          memLevel: 8,
          level: 9,
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024,
        },
        // Other options settable:
        clientNoContextTakeover: true, // Defaults to negotiated value.
        serverNoContextTakeover: true, // Defaults to negotiated value.
        // This socket only ever talks to another node, so both directions size
        // down; a peer on an older build negotiates back up to 15.
        serverMaxWindowBits: 13,
        clientMaxWindowBits: 13,
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
    const ip = extractIp(connection);
    const port = extractPort(connection);
    try {
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
      Privilege.NODE_OPERATOR_OR_FLUX_TEAM,
      authOf(req),
    );

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      res.json(message);
      return;
    }

    const parsed = parseSocketAddress(ip);

    if (!parsed) {
      const unparsableError = messageHelper.createErrorMessage(
        'Unparsable `ip` parameter',
      );
      res.json(unparsableError);
      return;
    }

    const { ip: peerIp, port: peerPort } = parsed;

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
    if (!nodeConfirmationService.isConfirmed()) {
      const errMessage = messageHelper.createErrorMessage('Node is not confirmed.');
      return res.json(errMessage);
    }
    let { ip } = req.params;
    ip = ip || req.query.ip;
    if (ip === undefined || ip === null) {
      const errMessage = messageHelper.createErrorMessage('No IP address specified.');
      return res.json(errMessage);
    }
    const peerIp = extractIp(ip);
    const peerPort = extractPort(ip);

    const remoteIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.headers['x-forwarded-for'];

    const remoteIP4 = remoteIP.replace('::ffff:', '');

    if (peerIp !== remoteIP4) {
      const errMessage = messageHelper.createErrorMessage(`Request ip ${remoteIP4} of ${remoteIP} doesn't match the ip: ${peerIp} to connect.`);
      return res.json(errMessage);
    }

    if (peerManager.has(`${peerIp}:${peerPort}`)) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${peerIp}:${peerPort}`);
      return res.json(errMessage);
    }

    const nodeList = await fluxCommunicationUtils.deterministicFluxList();
    // A listed node that has moved asks from the address its move leads to, which
    // the list names only once the move is confirmed on chain.
    const fluxNode = nodeList.find((node) => socketAddressesMatch(node.ip, ip))
      ?? await registryManager.listedNodeMovedTo(ip, nodeList);
    if (!fluxNode) {
      const errMessage = messageHelper.createErrorMessage(`FluxNode ${peerIp}:${peerPort} is not confirmed on the network.`);
      return res.json(errMessage);
    }

    initiateAndHandleConnection(ip, PEER_SOURCE.DETERMINISTIC);
    const message = messageHelper.createSuccessMessage(`Outgoing connection to ${peerIp}:${peerPort} initiated`);
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
  fluxEventBus.publish('discovery:started', {});
  // Driven by the node list arriving rather than by a retry that happens to
  // land after it. A peer holds one socket in either direction, so peers that
  // dial us while we are waiting take the very sockets we would have dialled
  // them on, and a late first pass then has nothing left to connect to.
  networkStateService.onReady(fluxDiscovery);
}

async function startDiscoveryApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
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

    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();

    if (!localSocketAddr) {
      throw new Error('Flux IP not detected. Flux discovery is awaiting.');
    }

    // An unknown node list and an empty one are the same value below, and acting
    // on the second when it is really the first sizes both deterministic loops
    // to zero - the node then connects to nobody and reports no error.
    if (!networkStateService.isReady()) {
      throw new Error('Network state not yet known. Flux discovery is awaiting.');
    }

    const sortedNodeList = await fluxCommunicationUtils.deterministicFluxList({
      sort: true,
      addressOnly: true,
    });

    peerManager.numberOfFluxNodes = sortedNodeList.length;

    log.info('Searching for my node on sortedNodeList');
    const fluxNodeIndex = sortedNodeList.findIndex((addr) => socketAddressesMatch(addr, localSocketAddr));
    log.info(`My node was found on index: ${fluxNodeIndex} of ${sortedNodeList.length} nodes`);
    const minDeterministicOutPeers = Math.min(sortedNodeList.length, config.fluxapps.minOutgoing);
    // const minIncomingPeers = Math.min(sortedNodeList.length, 1.5 * config.fluxapps.minIncoming);
    log.info(`Current number of outgoing connections:${peerManager.outboundCount}`);
    log.info(`Current number of incoming connections:${peerManager.inboundCount}`);
    // always try to connect to deterministic nodes
    // established deterministic outgoing connections
    let deterministicPeerConnections = false;
    const myIpGroup = FluxPeerManager.getIpGroup(extractIp(localSocketAddr));

    // established deterministic 8 outgoing connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex + i < sortedNodeList.length ? fluxNodeIndex + i : fluxNodeIndex + i - sortedNodeList.length;
      const addr = sortedNodeList[fixedIndex];
      const ipInc = extractIp(addr);
      if (!ipInc || ipInc === extractIp(localSocketAddr)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const portInc = extractPort(addr);
      if (peerManager.shouldAttemptConnection(ipInc, portInc)) {
        deterministicPeerConnections = true;
        initiateAndHandleConnection(addr, PEER_SOURCE.DETERMINISTIC);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(DISCOVERY.connectionDelayMs);
      }
    }
    // established deterministic 8 incoming connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex - i >= 0 ? fluxNodeIndex - i : sortedNodeList.length + fluxNodeIndex - i;
      const addr = sortedNodeList[fixedIndex];
      const ipInc = extractIp(addr);
      if (!ipInc || ipInc === extractIp(localSocketAddr)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const portInc = extractPort(addr);
      if (peerManager.shouldAttemptConnection(ipInc, portInc)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await serviceHelper.axiosGet(
          `http://${ipInc}:${portInc}/flux/addoutgoingpeer/${localSocketAddr}`,
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
      const connection = await networkStateService.getRandomSocketAddress(localSocketAddr);
      if (connection) {
        const ipInc = extractIp(connection);
        const portInc = extractPort(connection);
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
      const connection = await networkStateService.getRandomSocketAddress(localSocketAddr);
      if (connection) {
        const ipInc = extractIp(connection);
        const portInc = extractPort(connection);
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
          `http://${ipInc}:${portInc}/flux/addoutgoingpeer/${localSocketAddr}`,
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
    if (!confirmed) {
      log.info('fluxDiscovery - Confirmation lost, disconnecting all peers');
      peerManager.disconnectAll();
      return;
    }

    // Confirmed is not the same as ready to peer. Every message an inbound peer
    // sends is checked against the node list, so a peer that arrives before the
    // list does is refused however legitimate it is - there is nothing to
    // validate it against. The two facts come from different calls to the same
    // daemon, one carrying a single record and one carrying every node, so the
    // list lands well after the confirmation and that gap is the whole of the
    // window peers were being turned away in.
    //
    // Only the first open waits: once the list is here isReady() is true and
    // this runs inline, so regaining confirmation reconnects immediately.
    networkStateService.onReady(() => {
      // The wait is not instant, and confirmation can be lost inside it. Without
      // this the callback would re-open the door straight after disconnectAll().
      if (!nodeConfirmationService.isConfirmed()) return;

      peerManager.allowConnections();
    });
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
      unstable.push({
        ip: extractIp(key),
        port: String(extractPort(key)),
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
  const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
  peerResponsiveness,
  keepConnectionsAlive,
  fluxDiscovery,
  startDiscovery,
  initializeDiscovery,
  startDiscoveryApi,
  handleAppMessages,
  addPeer,
  logSocketsEvery,
  handleAppRunningMessage,
  handleAppInstallingMessage,
  handleAppInstallingErrorMessage,
  handleTempSyncResponse,
  handleAppRunningSyncResponse,
  handleAppInstallingSyncResponse,
  handleAppInstallingErrorsSyncResponse,
  handleIPChangedMessage,
  recordOwnAddressMove,
  announceOwnAddressMove,
  handleOwnAddressMove,
  announceRecordedOwnMovesWhenConnected,
  noteOwnMoveHeardBack,
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
