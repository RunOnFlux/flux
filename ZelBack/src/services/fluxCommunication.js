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
const { peerManager } = require('./utils/establishedConnections');
const cacheManager = require('./utils/cacheManager').default;
const networkStateService = require('./networkStateService');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

const { messageCache, wsPeerCache } = cacheManager;

/* const LRUTest = {
  max: 25000000, // 25M
  ttl: 60 * 60 * 1000, // 1h
  maxAge: 60 * 60 * 1000, // 1h
};

const testListCache = new LRUCache(LRUTest); */

let numberOfFluxNodes = 0;

/**
 * Extracts the /16 subnet prefix (first 2 octets) from an IP address.
 * @param {string} ip IP address (e.g., "192.168.1.100")
 * @returns {string} Subnet prefix (e.g., "192.168")
 */
function getIpSubnet(ip) {
  const parts = ip.split('.');
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return ip;
}

const privateIpsList = [
  '192.168.', '10.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.28.', '172.29.', '172.30.', '172.31.',
];

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
    const rebroadcastToPeers = await messageStore.storeAppTemporaryMessage(message.data, true);
    if (rebroadcastToPeers === true) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      let messageString = serviceHelper.ensureString(message);
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        const dataObj = {
          messageHashPresent: hash(message.data),
        };
        messageString = JSON.stringify(dataObj);
      }
      const wsListOut = [];
      for (const peer of peerManager.outboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      for (const peer of peerManager.inboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle check if message hash is present, if node doesn't have that message hash will send to the client a message requesting for the message.
 * @param {string} messageHash Message hash.
 * @param {string} fromIP Sender's IP address.
 * @param {string} port Sender's node Api port.
 * @param {boolean} outgoingConnection says if ip/port is from incoming or outgoing connections.
 */
async function handleCheckMessageHashPresent(messageHash, fromIP, port, outgoingConnection) {
  try {
    if (!messageCache.has(messageHash)) {
      const dataObj = {
        requestMessageHash: messageHash,
      };
      const dataString = JSON.stringify(dataObj);
      const peer = peerManager.get(`${fromIP}:${port}`);
      if (peer) {
        const wsList = [peer.ws];
        if (outgoingConnection) {
          fluxCommunicationMessagesSender.sendToAllPeers(dataString, wsList);
        } else {
          fluxCommunicationMessagesSender.sendToAllIncomingConnections(dataString, wsList);
        }
      }
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
async function handleRequestMessageHash(messageHash, fromIP, port, outgoingConnection) {
  try {
    if (messageCache.has(messageHash)) {
      const message = messageCache.get(messageHash);
      if (message) {
        const messageString = serviceHelper.ensureString(message);
        const peer = peerManager.get(`${fromIP}:${port}`);
        if (peer) {
          const wsList = [peer.ws];
          if (outgoingConnection) {
            fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsList);
          } else {
            fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
          }
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
    // check if we have it exactly like that in database and if not, update
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    const rebroadcastToPeers = await messageStore.storeAppRunningMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers === true && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      let messageString = serviceHelper.ensureString(message);
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        const dataObj = {
          messageHashPresent: hash(message.data),
        };
        messageString = JSON.stringify(dataObj);
      }
      const wsListOut = [];
      for (const peer of peerManager.outboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      for (const peer of peerManager.inboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
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
    // check if we have it exactly like that in database and if not, update
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    const rebroadcastToPeers = await messageStore.storeAppInstallingMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp);
    if (rebroadcastToPeers === true && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      let messageString = serviceHelper.ensureString(message);
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        const dataObj = {
          messageHashPresent: hash(message.data),
        };
        messageString = JSON.stringify(dataObj);
      }
      const wsListOut = [];
      for (const peer of peerManager.outboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      for (const peer of peerManager.inboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
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
    // check if we have it exactly like that in database and if not, update
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    const rebroadcastToPeers = await messageStore.storeAppInstallingErrorMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp);
    if (rebroadcastToPeers === true && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      let messageString = serviceHelper.ensureString(message);
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        const dataObj = {
          messageHashPresent: hash(message.data),
        };
        messageString = JSON.stringify(dataObj);
      }
      const wsListOut = [];
      for (const peer of peerManager.outboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      for (const peer of peerManager.inboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
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
async function handleIPChangedMessage(message, fromIP, port) {
  try {
    // check if we have it any app running on that location and if yes, update information
    // rebroadcast message to the network if it's valid
    const rebroadcastToPeers = await messageStore.storeIPChangedMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      let messageString = serviceHelper.ensureString(message);
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        const dataObj = {
          messageHashPresent: hash(message.data),
        };
        messageString = JSON.stringify(dataObj);
      }
      const wsListOut = [];
      for (const peer of peerManager.outboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      for (const peer of peerManager.inboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
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
async function handleAppRemovedMessage(message, fromIP, port) {
  try {
    // check if we have it any app running on that location and if yes, delete that information
    // rebroadcast message to the network if it's valid
    const rebroadcastToPeers = await messageStore.storeAppRemovedMessage(message.data);
    const currentTimeStamp = Date.now();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers && timestampOK) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height || 0;
      let messageString = serviceHelper.ensureString(message);
      if (daemonHeight >= config.messagesBroadcastRefactorStart) {
        const dataObj = {
          messageHashPresent: hash(message.data),
        };
        messageString = JSON.stringify(dataObj);
      }
      const wsListOut = [];
      for (const peer of peerManager.outboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      for (const peer of peerManager.inboundValues()) {
        if (peer.ip === fromIP && peer.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(peer.ws);
        }
      }
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
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

    // Check if this IP has any apps running in our database
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = { ip };
    const projection = { _id: 0, name: 1 };
    const appsOnNode = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);

    if (!appsOnNode || appsOnNode.length === 0) {
      log.info(`No apps found for node ${ip} in locations database, not rebroadcasting sigterm`);
      return;
    }

    log.info(`Found ${appsOnNode.length} apps for node ${ip}, updating expiration and rebroadcasting sigterm`);

    // Update broadcastedAt to make records expire 7 minutes after the sigterm broadcastedAt
    // TTL index is 7500 seconds, so set broadcastedAt = sigtermBroadcastedAt - (7500 - 420) seconds
    const newBroadcastedAt = new Date(broadcastedAt - (7500 - 420) * 1000);
    const newExpireAt = new Date(broadcastedAt + (420 * 1000));
    const update = { $set: { broadcastedAt: newBroadcastedAt, expireAt: newExpireAt } };
    await dbHelper.updateInDatabase(database, globalAppsLocations, query, update);

    // Rebroadcast to other peers
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height || 0;
    let messageString = serviceHelper.ensureString(message);
    if (daemonHeight >= config.messagesBroadcastRefactorStart) {
      const dataObj = {
        messageHashPresent: hash(message.data),
      };
      messageString = JSON.stringify(dataObj);
    }
    const wsListOut = [];
    for (const peer of peerManager.outboundValues()) {
      if (peer.ip === fromIP && peer.port === port) {
        // do not broadcast to this peer
      } else {
        wsListOut.push(peer.ws);
      }
    }
    fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
    await serviceHelper.delay(500);
    const wsList = [];
    for (const peer of peerManager.inboundValues()) {
      if (peer.ip === fromIP && peer.port === port) {
        // do not broadcast to this peer
      } else {
        wsList.push(peer.ws);
      }
    }
    fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
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
  const isOutbound = peerSocket.direction === 'outbound';
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
    setImmediate(() => handleCheckMessageHashPresent(messageHashPresent, peerSocket.ip, peerSocket.port, isOutbound));
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
    setImmediate(() => handleRequestMessageHash(requestMessageHash, peerSocket.ip, peerSocket.port, isOutbound));
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
          setImmediate(() => fluxCommunicationMessagesSender.respondWithAppMessage(msgObj, peerSocket.ws));
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
        } else {
          log.warn(`Unrecognised message type of ${msgObj.data.type}`);
        }
      } catch (e) {
        log.error(e);
      }
    } else {
      peerSocket.sendNak(messageHash, 'stale');
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

/**
 * To handle incoming connection. Several types of verification are performed.
 * @param {object} websocket Web socket.
 * @param {string} optionalPort Port number.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
// let messageNumber = 0;
// eslint-disable-next-line no-unused-vars
function handleIncomingConnection(websocket, optionalPort) {
  try {
    const ws = websocket;
    const port = optionalPort || '16127';
    const maxPeers = 4 * config.fluxapps.minIncoming;
    const maxNumberOfConnections = numberOfFluxNodes / 160 < 9 * config.fluxapps.minIncoming ? numberOfFluxNodes / 160 : 9 * config.fluxapps.minIncoming;
    const maxCon = Math.max(maxPeers, maxNumberOfConnections);
    if (peerManager.inboundCount > maxCon) {
      setTimeout(() => {
        ws.close(4000, `Max number of incomming connections ${maxCon} reached`);
      }, 1000);
      return;
    }
    let ipv4Peer;
    try {
      ipv4Peer = ws._socket.remoteAddress.replace('::ffff:', '');
      if (!ipv4Peer) {
        ipv4Peer = ws._socket._peername.address.replace('::ffff:', '');
      }
    } catch (error) {
      log.error(error);
      ipv4Peer = ws._socket._peername.address.replace('::ffff:', '');
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const privateIp of privateIpsList) {
      if (ipv4Peer.startsWith(privateIp)) {
        setTimeout(() => {
          ws.close(4002, 'Peer received is using internal IP');
        }, 1000);
        log.error(`Incoming connection of peer from internal IP not allowed: ${ipv4Peer}`);
        return;
      }
    }

    const key = `${ipv4Peer}:${port}`;
    if (peerManager.has(key)) {
      setTimeout(() => {
        ws.close(4001, 'Peer received is already in peers list');
      }, 1000);
      return;
    }

    // Add to peerManager — FluxPeerSocket constructor binds all handlers (onmessage, onclose, onerror, pong)
    peerManager.add(ws, 'inbound', ipv4Peer, port);
  } catch (error) {
    log.error(error);
  }
}

/**
 * To get IP addresses for all outgoing connected peers.
 * @param {object} req Request.
 * @param {object} res Response.
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
 * To get info (IP address, latency and lastPingTime) for all outgoing connected peers.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function connectedPeersInfo(req, res) {
  const connections = peerManager.outgoingPeers;
  const message = messageHelper.createDataMessage(connections);
  return res ? res.json(message) : message;
}

/**
 * To keep connections alive by pinging all outgoing and incoming peers.
 */
function keepConnectionsAlive() {
  setInterval(() => {
    peerManager.pruneDeadConnections();
    peerManager.pingAll();
  }, 15 * 1000);
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
async function initiateAndHandleConnection(connection) {
  let ip = connection;
  let port = config.server.apiport.toString();
  try {
    if (connection.includes(':')) {
      ip = connection.split(':')[0];
      port = connection.split(':')[1];
    }
    if (!myPort) {
      const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
      if (!myIP) {
        return;
      }
      myPort = myIP.split(':')[1] || '16127';
    }
    const options = {
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
    };
    const wsuri = `ws://${ip}:${port}/ws/flux/${myPort}`;
    const websocket = new WebSocket(wsuri, options);
    websocket.port = port;
    websocket.ip = ip;
    websocket.onopen = () => {
      // Add to peerManager — FluxPeerSocket constructor binds all handlers
      peerManager.add(websocket, 'outbound', ip, port);
    };
  } catch (error) {
    log.error(error);
  }
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

    setImmediate(() => initiateAndHandleConnection(ip));

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

    initiateAndHandleConnection(ip);
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

/**
 * To discover and connect to other randomly selected FluxNodes. Maintains connections with 1-2% of nodes on the Flux network. Ensures that FluxNode connections are not duplicated.
 */
async function fluxDiscovery() {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced. Flux discovery is awaiting.');
    }

    const currentIpsConnTried = [];

    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();

    if (!myIP) {
      throw new Error('Flux IP not detected. Flux discovery is awaiting.');
    }

    const fluxNode = await fluxCommunicationUtils.getFluxnodeFromFluxList(myIP);

    if (!fluxNode) {
      throw new Error('Node not confirmed. Flux discovery is awaiting.');
    }

    const sortedNodeList = await fluxCommunicationUtils.deterministicFluxList({
      sort: true,
      addressOnly: true,
    });

    numberOfFluxNodes = sortedNodeList.length;

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
      // additional precaution
      if (!peerManager.has(`${ipInc}:${portInc}`)) {
        // we add to the cache immediately here as we have no idea if this is successful or not;
        // If it's not successful (due to many reasons) We spam the connection over and over

        // This just adds a 15 minute cooldown between retries, until we implement
        // heartbeats (and rework the communcation module)
        wsPeerCache.set(ip, '');
        deterministicPeerConnections = true;
        initiateAndHandleConnection(ip);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
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
      // additional precaution
      if (!peerManager.has(`${ipInc}:${portInc}`) && !wsPeerCache.has(`${ipInc}:${portInc}`)) {
        // we add to the cache immediately, instead of waiting for an error; The reason
        // for this is that we don't have heartbeats set up, so quite often, the other
        // end will think it's connected to us when it's not - and cut the connection.
        // This just adds a 15 minute cooldown between retries, until we implement
        // heartbeats (and rework the communcation module)
        wsPeerCache.set(`${ipInc}:${portInc}`, '');
        // eslint-disable-next-line no-await-in-loop
        const result = await serviceHelper.axiosGet(
          `http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`,
          { timeout: 5_000 },
        ).catch((error) => {
          if (error.code !== 'ECONNREFUSED') log.error(error);

          return null;
        });

        if (result) deterministicPeerConnections = true;
      }
    }
    if (deterministicPeerConnections) {
      log.info('Connections to deterministic peers established');
    }

    await serviceHelper.delay(500);

    // Process reconnect queue — retry recently disconnected outbound peers before random selection
    const reconnectQueue = peerManager.getReconnectQueue();
    for (const [rKey, rEntry] of reconnectQueue) {
      if (peerManager.has(rKey)) {
        peerManager.clearReconnectEntry(rKey);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (peerManager.isUnstable(rEntry.ip, rEntry.port)) {
        peerManager.clearReconnectEntry(rKey);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (rEntry.attempts > 3) {
        peerManager.clearReconnectEntry(rKey);
        // eslint-disable-next-line no-continue
        continue;
      }
      log.info(`Reconnecting to queued peer: ${rKey} (attempt ${rEntry.attempts})`);
      initiateAndHandleConnection(`${rEntry.ip}:${rEntry.port}`);
      // Don't clear here — if connection fails, remove() calls queueReconnect()
      // which increments attempts. Successful connections clear via add().
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }

    // Prune expired unstable node entries periodically
    peerManager.pruneUnstableList();

    let index = 0;
    const currentSubnetsConnTried = [];
    while ((peerManager.outboundCount < 14 || [...new Set([...peerManager.outboundValues()].map((p) => p.ip))].length < 9) && index < 100) { // Max of 14 outgoing connections - 8 possible deterministic + min. 6 random
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await networkStateService.getRandomSocketAddress(myIP);

      if (connection) {
        const [ipInc, portInc = '16127'] = connection.split(':');
        // we don't connect to any other nodes on the same ip
        if (ipInc === myIP.split(':')[0]) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // check subnet diversity - skip nodes in same subnet as my node or already connected
        const ipSubnet = getIpSubnet(ipInc);
        const mySubnet = getIpSubnet(myIP.split(':')[0]);
        if (ipSubnet === mySubnet) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const connectedSubnets = [...peerManager.outboundValues()].map((p) => getIpSubnet(p.ip));
        const subnetAlreadyConnected = connectedSubnets.includes(ipSubnet) || currentSubnetsConnTried.includes(ipSubnet);
        if (subnetAlreadyConnected) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ipInc);
        if (!sameConnectedIp && !peerManager.has(`${ipInc}:${portInc}`)) {
          log.info(`Adding random Flux peer: ${connection}`);
          currentIpsConnTried.push(connection);
          currentSubnetsConnTried.push(ipSubnet);
          initiateAndHandleConnection(connection);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }
    index = 0;
    const currentIncomingSubnetsConnTried = [];
    while ((peerManager.inboundCount < 12 || [...new Set([...peerManager.inboundValues()].map((p) => p.ip))].length < 5) && index < 100) { // Max of 12 incoming connections - 8 possible deterministic + min. 4 random (we will get more random as others nodes have more random outgoing connections)
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await networkStateService.getRandomSocketAddress(myIP);
      if (connection) {
        const [ipInc, portInc = '16127'] = connection.split(':');
        // we don't connect to any other nodes on the same ip
        if (ipInc === myIP.split(':')[0]) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // check subnet diversity - skip nodes in same subnet as my node or already connected
        const ipSubnet = getIpSubnet(ipInc);
        const mySubnet = getIpSubnet(myIP.split(':')[0]);
        if (ipSubnet === mySubnet) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const connectedSubnets = [...peerManager.inboundValues()].map((p) => getIpSubnet(p.ip));
        const subnetAlreadyConnected = connectedSubnets.includes(ipSubnet) || currentIncomingSubnetsConnTried.includes(ipSubnet);
        if (subnetAlreadyConnected) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ipInc);
        if (!sameConnectedIp && !peerManager.has(`${ipInc}:${portInc}`)) {
          log.info(`Asking random Flux ${connection} to add us as a peer`);
          currentIpsConnTried.push(connection);
          currentIncomingSubnetsConnTried.push(ipSubnet);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.axiosGet(
            `http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`,
            { timeout: 5_000 },
          ).catch((error) => log.error(error));
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }
    setTimeout(() => {
      fluxDiscovery();
    }, 60 * 1000);
  } catch (error) {
    log.warn(error.message || error);
    setTimeout(() => {
      fluxDiscovery();
    }, 120 * 1000);
  }
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
  handleIncomingConnection,
  connectedPeers,
  removePeer,
  removeIncomingPeer,
  connectedPeersInfo,
  keepConnectionsAlive,
  fluxDiscovery,
  handleAppMessages,
  addPeer,
  logSocketsEvery,
  handleAppRunningMessage,
  handleIPChangedMessage,
  handleAppRemovedMessage,
  handleNodeSigtermMessage,
  initiateAndHandleConnection,
  addOutgoingPeer,
};
