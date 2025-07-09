/* eslint-disable no-underscore-dangle */
const config = require('config');
const TTLCache = require('@isaacs/ttlcache');
const hash = require('object-hash');
const WebSocket = require('ws');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const messageHelper = require('./messageHelper');
const {
  outgoingConnections, outgoingPeers, incomingPeers, incomingConnections,
} = require('./utils/establishedConnections');

let response = messageHelper.createErrorMessage();
// default cache
const TtlOptions = {
  max: 20000, // currently 20000 nodes
  ttl: 1000 * 360, // 360 seconds, 3 blocks
};

// cache for temporary messages
const TtlOptionsTemp = { // cache for temporary messages
  max: 2000, // store max 2000 values
  ttl: 1000 * 60 * 70, // 70 minutes
};

const myCacheTemp = new TTLCache(TtlOptionsTemp);

/* const LRUTest = {
  max: 25000000, // 25M
  ttl: 60 * 60 * 1000, // 1h
  maxAge: 60 * 60 * 1000, // 1h
};

const testListCache = new LRUCache(LRUTest); */

let numberOfFluxNodes = 0;

const blockedPubKeysCache = new TTLCache(TtlOptions);

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
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppTemporaryMessage(message.data, true);
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
      outgoingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      incomingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(client);
        }
      });
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
    if (!myCacheTemp.has(messageHash)) {
      const dataObj = {
        requestMessageHash: messageHash,
      };
      const dataString = JSON.stringify(dataObj);
      if (outgoingConnection) {
        const wsListOut = outgoingConnections.filter((aux) => aux.ip === fromIP && aux.port === port);
        if (wsListOut && wsListOut.length > 0) {
          fluxCommunicationMessagesSender.sendToAllPeers(dataString, wsListOut);
        }
      } else {
        const wsList = incomingConnections.filter((aux) => aux.ip === fromIP && aux.port === port);
        if (wsList && wsList.length > 0) {
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
    if (myCacheTemp.has(messageHash)) {
      const message = myCacheTemp.get(messageHash);
      if (message) {
        const messageString = serviceHelper.ensureString(message);
        if (outgoingConnection) {
          const wsListOut = outgoingConnections.filter((aux) => aux.ip === fromIP && aux.port === port);
          if (wsListOut && wsListOut.length > 0) {
            fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
          }
        } else {
          const wsList = incomingConnections.filter((aux) => aux.ip === fromIP && aux.port === port);
          if (wsList && wsList.length > 0) {
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
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppRunningMessage(message.data);
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
      outgoingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      incomingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(client);
        }
      });
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
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppInstallingMessage(message.data);
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
      outgoingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      incomingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(client);
        }
      });
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
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppInstallingErrorMessage(message.data);
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
      outgoingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      incomingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(client);
        }
      });
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
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeIPChangedMessage(message.data);
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
      outgoingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      incomingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(client);
        }
      });
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
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppRemovedMessage(message.data);
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
      outgoingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = [];
      incomingConnections.forEach((client) => {
        if (client.ip === fromIP && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsList.push(client);
        }
      });
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle incoming connection. Several types of verification are performed.
 * @param {object} websocket Web socket.
 * @param {object} req Request.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
// let messageNumber = 0;
// eslint-disable-next-line no-unused-vars
function handleIncomingConnection(websocket, optionalPort) {
  try {
    const ws = websocket;
    const port = optionalPort || 16127;
    // now we are in connections state. push the websocket to our incomingconnections
    const maxPeers = 4 * config.fluxapps.minIncoming;
    const maxNumberOfConnections = numberOfFluxNodes / 160 < 9 * config.fluxapps.minIncoming ? numberOfFluxNodes / 160 : 9 * config.fluxapps.minIncoming;
    const maxCon = Math.max(maxPeers, maxNumberOfConnections);
    if (incomingConnections.length > maxCon) {
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

    const peer = {
      ip: ipv4Peer,
      port,
    };

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
    ws.port = port;
    ws.ip = ipv4Peer;
    const findPeer = incomingPeers.find((p) => p.ip === ws.ip && p.port === port);
    if (findPeer) {
      setTimeout(() => {
        ws.close(4001, 'Peer received is already in incomingPeers list');
      }, 1000);
      return;
    }
    incomingConnections.push(ws);
    incomingPeers.push(peer);

    // verify data integrity, if not signed, close connection
    ws.onmessage = async (msg) => {
      if (!msg) {
        return;
      }
      // uncomment block bellow to know how many messages is a fluxNode receiving every hour
      /* messageNumber += 1;
      testListCache.set(messageNumber, messageNumber);
      if (messageNumber % 200 === 0) {
        testListCache.purgeStale();
        log.info(`Number of messages received in the last hour:${testListCache.size}`);
      }
      if (messageNumber === 100000000) {
        messageNumber = 0;
      } */
      // check rate limit
      const rateOK = fluxNetworkHelper.lruRateLimit(`${ipv4Peer}:${port}`, 120);
      if (!rateOK) {
        return; // do not react to the message
      }
      const msgObj = serviceHelper.ensureObject(msg.data);
      const { pubKey } = msgObj;
      const { timestamp } = msgObj;
      const { signature } = msgObj;
      const { version } = msgObj;
      const { data } = msgObj;
      const { messageHashPresent } = msgObj;
      const { requestMessageHash } = msgObj;
      if (messageHashPresent) {
        if (typeof messageHashPresent !== 'string' || messageHashPresent.length !== 40) {
          try {
            log.info(`Invalid message of type messageHashPresentreceived from outgoing peer ${peer.ip}:${peer.port}. Closing outgoing connection`);
            websocket.close(4016, 'Message not valid, disconnect');
          } catch (e) {
            log.error(e);
          }
          return;
        }
        handleCheckMessageHashPresent(messageHashPresent, peer.ip, peer.port, false);
        return;
      }
      if (requestMessageHash) {
        if (typeof requestMessageHash !== 'string' || requestMessageHash.length !== 40) {
          try {
            log.info(`Invalid message of type requestMessageHash from incoming peer ${peer.ip}:${peer.port}. Closing incoming connection`);
            websocket.close(4016, 'Message not valid, disconnect');
          } catch (e) {
            log.error(e);
          }
          return;
        }
        handleRequestMessageHash(requestMessageHash, peer.ip, peer.port, false);
        return;
      }
      if (!pubKey || !timestamp || !signature || !version || !data) {
        try {
          log.info(`Invalid received from incoming peer ${peer.ip}:${peer.port}. Closing incoming connection`);
          ws.close(4016, 'Message not valid, disconnect');
        } catch (e) {
          log.error(e);
        }
        return;
      }

      // check if we have the message in cache. If yes, return false. If not, store it and continue
      await serviceHelper.delay(Math.floor(Math.random() * 75 + 1)); // await max 75 miliseconds random, should jelp on processing duplicated messages received at same timestamp
      const messageHash = hash(msgObj.data);
      if (myCacheTemp.has(messageHash)) {
        return;
      }
      myCacheTemp.set(messageHash, msgObj);

      // check blocked list
      if (blockedPubKeysCache.has(pubKey)) {
        try {
          log.info('Closing incoming connection, peer is on blockedList');
          ws.close(4003, 'blocked list'); // close as of policy violation?
        } catch (e) {
          log.error(e);
        }
        return;
      }
      const currentTimeStamp = Date.now();
      const messageOK = await fluxCommunicationUtils.verifyFluxBroadcast(msgObj, undefined, currentTimeStamp);
      if (messageOK === true) {
        const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(msgObj, currentTimeStamp);
        if (timestampOK === true) {
          try {
            if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
              handleAppMessages(msgObj, peer.ip, peer.port);
            } else if (msgObj.data.type === 'fluxapprequest') {
              fluxCommunicationMessagesSender.respondWithAppMessage(msgObj, ws);
            } else if (msgObj.data.type === 'fluxapprunning') {
              handleAppRunningMessage(msgObj, peer.ip, peer.port);
            } else if (msgObj.data.type === 'fluxipchanged') {
              handleIPChangedMessage(msgObj, peer.ip, peer.port);
            } else if (msgObj.data.type === 'fluxappremoved') {
              handleAppRemovedMessage(msgObj, peer.ip, peer.port);
            } else if (msgObj.data.type === 'fluxappinstalling') {
              handleAppInstallingMessage(msgObj, peer.ip, peer.port);
            } else if (msgObj.data.type === 'fluxappinstallingerror') {
              handleAppInstallingErrorMessage(msgObj, peer.ip, peer.port);
            } else {
              log.warn(`Unrecognised message type of ${msgObj.data.type}`);
            }
          } catch (e) {
            log.error(e);
          }
        }
      } else {
        // we dont like this peer as it sent wrong message (wrong, or message belonging to node no longer on network). Lets close the connection
        // and add him to blocklist
        try {
          // check if message comes from IP belonging to the public Key
          let zl = await fluxCommunicationUtils.deterministicFluxList({ filter: pubKey }); // this itself is sufficient.
          let nodeFound = zl.find((n) => n.ip.split(':')[0] === peer.ip && (n.ip.split(':')[1] || 16127) === peer.port);
          if (!nodeFound) {
            // check if message comes from IP belonging to the public Key
            zl = await fluxCommunicationUtils.deterministicFluxList(); // this itself is sufficient.
            const possibleNodes = zl.filter((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
            nodeFound = possibleNodes.find((n) => n.ip.split(':')[0] === peer.ip && (n.ip.split(':')[1] || 16127) === peer.port);
            if (!nodeFound) {
              log.warn(`Invalid message received from incoming peer ${peer.ip}:${peer.port} which is not an originating node of ${pubKey}.`);
              ws.close(4004, 'invalid message, disconnect'); // close as of policy violation
            } else {
              blockedPubKeysCache.set(pubKey, ''); // blocks ALL the nodes corresponding to the pubKey
              log.warn(`closing incoming connection, adding peers ${pubKey}:${peer.port} to the blockedList. Originated from ${peer.ip}.`);
              ws.close(4005, 'invalid message, blocked'); // close as of policy violation?
            }
          } else {
            blockedPubKeysCache.set(pubKey, ''); // blocks ALL the nodes corresponding to the pubKey
            log.warn(`closing incoming connection, adding peers ${pubKey}:${peer.port} to the blockedList. Originated from ${peer.ip}.`);
            ws.close(4005, 'invalid message, blocked'); // close as of policy violation?
          }
        } catch (e) {
          log.error(e);
        }
      }
    };
    ws.onclose = (msg) => {
      const { ip } = ws;
      log.info(`Incoming connection to ${ip}:${port} closed with code ${msg.code}`);
      const ocIndex = incomingConnections.findIndex((incomingCon) => ip === incomingCon.ip && port === incomingCon.port);
      if (ocIndex > -1) {
        log.info(`Connection to ${ip}:${port} removed from incomingConnections`);
        incomingConnections.splice(ocIndex, 1);
      }
      const peerIndex = incomingPeers.findIndex((mypeer) => mypeer.ip === ip && mypeer.port === port);
      if (peerIndex > -1) {
        log.info(`Connection ${ip}:${port} removed from incomingPeers`);
        incomingPeers.splice(peerIndex, 1);
      }
    };
    ws.onerror = (msg) => {
      const { ip } = ws;
      log.info(`Incoming connection to ${ip}:${port} errord with code ${msg.code}`);
      const ocIndex = incomingConnections.findIndex((incomingCon) => ip === incomingCon.ip && port === incomingCon.port);
      if (ocIndex > -1) {
        log.info(`Connection to ${ip}:${port} removed from incomingConnections`);
        incomingConnections.splice(ocIndex, 1);
      }
      const peerIndex = incomingPeers.findIndex((mypeer) => mypeer.ip === ip && mypeer.port === port);
      if (peerIndex > -1) {
        log.info(`Connection ${ip}:${port} removed from incomingPeers`);
        incomingPeers.splice(peerIndex, 1);
      }
    };
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
  outgoingConnections.forEach((client) => {
    connections.push(client.ip);
  });
  const message = messageHelper.createDataMessage(connections);
  response = message;
  return res ? res.json(response) : response;
}

/**
 * To get info (IP address, latency and lastPingTime) for all outgoing connected peers.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function connectedPeersInfo(req, res) {
  const connections = outgoingPeers;
  const message = messageHelper.createDataMessage(connections);
  response = message;
  return res ? res.json(response) : response;
}

/**
 * To keep connections alive by pinging all outgoing and incoming peers.
 */
function keepConnectionsAlive() {
  setInterval(() => {
    fluxCommunicationMessagesSender.sendToAllPeers(); // perform ping
    fluxCommunicationMessagesSender.sendToAllIncomingConnections(); // perform ping
  }, 15 * 1000);
}

/**
 * To remove an outgoing peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function removePeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;
    if (ip === undefined || ip === null) {
      const errMessage = messageHelper.createErrorMessage('No IP address specified.');
      return res.json(errMessage);
    }
    const justIP = ip.split(':')[0];
    const port = ip.split(':')[1] || 16127;
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      const closeResponse = await fluxNetworkHelper.closeConnection(justIP, port);
      response = closeResponse;
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
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
 * To remove an incoming peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} expressWS Express web socket.
 * @returns {object} Message.
 */
async function removeIncomingPeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;
    if (ip === undefined || ip === null) {
      const errMessage = messageHelper.createErrorMessage('No IP address specified.');
      return res.json(errMessage);
    }
    const justIP = ip.split(':')[0];
    const port = ip.split(':')[1] || 16127;
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      const closeResponse = await fluxNetworkHelper.closeIncomingConnection(justIP, port);
      response = closeResponse;
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
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
 * To initiate and handle a connection. Opens a web socket and handles various events during connection.
 * @param {string} connection IP address (and port if applicable).
 */
let myPort = null;
async function initiateAndHandleConnection(connection) {
  let ip = connection;
  let port = config.server.apiport;
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
      myPort = myIP.split(':')[1] || 16127;
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
      outgoingConnections.push(websocket);
      const peer = {
        ip, // can represent just one ip address, multiport
        port,
        lastPingTime: null,
        latency: null,
      };
      outgoingPeers.push(peer);
    };

    // every time a ping is sent a pong as received, measure latency
    websocket.on('pong', () => {
      try {
        const curTime = Date.now();
        const foundPeer = outgoingPeers.find((peer) => peer.ip === ip && peer.port === port);
        if (foundPeer) {
          foundPeer.latency = Math.ceil((curTime - foundPeer.lastPingTime) / 2);
        }
      } catch (error) {
        log.error(error);
      }
    });

    websocket.onclose = (evt) => {
      log.info(`Outgoing connection to ${ip}:${port} closed with code ${evt.code}`);
      const ocIndex = outgoingConnections.findIndex((ws) => ip === ws.ip && port === ws.port);
      if (ocIndex > -1) {
        log.info(`Connection ${ip}:${port} removed from outgoingConnections`);
        outgoingConnections.splice(ocIndex, 1);
      }
      const peerIndex = outgoingPeers.findIndex((peer) => peer.ip === ip && peer.port === port);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
        log.info(`Connection ${ip}:${port} removed from outgoingPeers`);
      }
    };

    websocket.onmessage = async (evt) => {
      if (!evt) {
        return;
      }
      // uncomment block bellow to know how many messages is a fluxNode receiving every hour
      /* messageNumber += 1;
      testListCache.set(messageNumber, messageNumber);
      if (messageNumber % 200 === 0) {
        testListCache.purgeStale();
        log.info(`Number of messages received in the last hour:${testListCache.size}`);
      }
      if (messageNumber === 100000000) {
        messageNumber = 0;
      } */
      // check rate limit
      const rateOK = fluxNetworkHelper.lruRateLimit(`${ip}:${port}`, 120);
      if (!rateOK) {
        return; // do not react to the message
      }
      const msgObj = serviceHelper.ensureObject(evt.data);
      const { pubKey } = msgObj;
      const { timestamp } = msgObj;
      const { signature } = msgObj;
      const { version } = msgObj;
      const { data } = msgObj;
      const { messageHashPresent } = msgObj;
      const { requestMessageHash } = msgObj;
      if (messageHashPresent) {
        if (typeof messageHashPresent !== 'string' || messageHashPresent.length !== 40) {
          try {
            log.info(`Invalid message of type messageHashPresentreceived from outgoing peer ${ip}:${port}. Closing outgoing connection`);
            websocket.close(4017, 'Message not valid, disconnect');
          } catch (e) {
            log.error(e);
          }
          return;
        }
        handleCheckMessageHashPresent(messageHashPresent, ip, port, true);
        return;
      }
      if (requestMessageHash) {
        if (typeof requestMessageHash !== 'string' || requestMessageHash.length !== 40) {
          try {
            log.info(`Invalid message of type requestMessageHash from outgoing peer ${ip}:${port}. Closing outgoing connection`);
            websocket.close(4017, 'Message not valid, disconnect');
          } catch (e) {
            log.error(e);
          }
          return;
        }
        handleRequestMessageHash(requestMessageHash, ip, port, true);
        return;
      }
      if (!pubKey || !timestamp || !signature || !version || !data) {
        try {
          log.info(`Invalid received from outgoing peer ${ip}:${port}. Closing outgoing connection`);
          websocket.close(4017, 'Message not valid, disconnect');
        } catch (e) {
          log.error(e);
        }
        return;
      }
      // check if we have the message in cache. If yes, return false. If not, store it and continue
      await serviceHelper.delay(Math.floor(Math.random() * 75 + 1)); // await max 75 miliseconds random, should help processing duplicated messages received at same timestamp
      const messageHash = hash(msgObj.data);
      if (myCacheTemp.has(messageHash)) {
        return;
      }
      myCacheTemp.set(messageHash, msgObj);
      // incoming messages from outgoing connections
      const currentTimeStamp = Date.now(); // ms
      // check blocked list
      if (blockedPubKeysCache.has(pubKey)) {
        try {
          log.info('Closing outgoing connection, peer is on blockedList');
          websocket.close(4006, 'blocked list'); // close as of policy violation?
        } catch (e) {
          log.error(e);
        }
        return;
      }
      const messageOK = await fluxCommunicationUtils.verifyFluxBroadcast(msgObj, undefined, currentTimeStamp);
      if (messageOK === true) {
        const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(msgObj, currentTimeStamp);
        if (timestampOK === true) {
          try {
            if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
              handleAppMessages(msgObj, ip, port);
            } else if (msgObj.data.type === 'fluxapprequest') {
              fluxCommunicationMessagesSender.respondWithAppMessage(msgObj, websocket);
            } else if (msgObj.data.type === 'fluxapprunning') {
              handleAppRunningMessage(msgObj, ip, port);
            } else if (msgObj.data.type === 'fluxipchanged') {
              handleIPChangedMessage(msgObj, ip, port);
            } else if (msgObj.data.type === 'fluxappremoved') {
              handleAppRemovedMessage(msgObj, ip, port);
            } else if (msgObj.data.type === 'fluxappinstalling') {
              handleAppInstallingMessage(msgObj, ip, port);
            } else if (msgObj.data.type === 'fluxappinstallingerror') {
              handleAppInstallingErrorMessage(msgObj, ip, port);
            } else {
              log.warn(`Unrecognised message type of ${msgObj.data.type}`);
            }
          } catch (e) {
            log.error(e);
          }
        }
      } else {
        // we dont like this peer as it sent wrong message (wrong, or message belonging to node no longer on network). Lets close the connection
        // and add him to blocklist
        try {
          // check if message comes from IP belonging to the public Key
          const zl = await fluxCommunicationUtils.deterministicFluxList({ filter: pubKey }); // this itself is sufficient.
          const possibleNodes = zl.filter((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
          const nodeFound = possibleNodes.find((n) => n.ip === connection); // connection is either ip or ip:port (if port is not 16127)
          if (!nodeFound) {
            log.warn(`Invalid message received from outgoing peer ${connection} which is not an originating node of ${pubKey}.`);
            websocket.close(4007, 'invalid message, disconnect'); // close as of policy violation
          } else {
            blockedPubKeysCache.set(pubKey, ''); // blocks ALL the nodes corresponding to the pubKey
            log.warn(`closing outgoing connection, adding peers ${pubKey} to the blockedList. Originated from ${connection}.`);
            websocket.close(4008, 'invalid message, blocked'); // close as of policy violation?
          }
        } catch (e) {
          log.error(e);
        }
      }
    };

    websocket.onerror = (evt) => {
      log.info(`Outgoing Connection to ${ip}:${port} errord with code ${evt.code}`);
      const ocIndex = outgoingConnections.findIndex((ws) => ip === ws.ip && port === ws.port);
      if (ocIndex > -1) {
        log.info(`Connection ${ip}:${port} removed from outgoingConnections`);
        outgoingConnections.splice(ocIndex, 1);
      }
      const peerIndex = outgoingPeers.findIndex((peer) => peer.ip === ip && peer.port === port);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
        log.info(`Connection ${ip}:${port} removed from outgoingPeers`);
      }
    };
  } catch (error) {
    log.error(error);
  }
}

/**
 * To add a peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addPeer(req, res) {
  try {
    let { ip } = req.params;
    ip = ip || req.query.ip;
    if (ip === undefined || ip === null) {
      const errMessage = messageHelper.createErrorMessage('No IP address specified.');
      return res.json(errMessage);
    }
    const justIP = ip.split(':')[0];
    const port = ip.split(':')[1] || 16127;
    const wsObj = outgoingConnections.find((client) => client.ip === justIP && client.port === port);
    if (wsObj) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${justIP}:${port}`);
      return res.json(errMessage);
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      return res.json(message);
    }
    initiateAndHandleConnection(ip);
    const message = messageHelper.createSuccessMessage(`Outgoing connection to ${ip}:${port} initiated`);
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
    const port = ip.split(':')[1] || 16127;

    const wsObj = outgoingConnections.find((client) => client.ip === justIP && client.port === port);
    if (wsObj) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${justIP}:${port}`);
      return res.json(errMessage);
    }

    const nodeList = await fluxCommunicationUtils.deterministicFluxList();
    const fluxNode = nodeList.find((node) => node.ip.split(':')[0] === ip.split(':')[0] && (node.ip.split(':')[1] || 16127) === port);
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

    let sortedNodeList = [];
    const currentIpsConnTried = [];

    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (myIP) {
      sortedNodeList = await fluxCommunicationUtils.deterministicFluxList({ sort: true });
      numberOfFluxNodes = sortedNodeList.length;
      const fluxNode = await fluxCommunicationUtils.getFluxnodeFromFluxList(myIP);
      if (!fluxNode) {
        throw new Error('Node not confirmed. Flux discovery is awaiting.');
      }
    } else {
      throw new Error('Flux IP not detected. Flux discovery is awaiting.');
    }

    log.info('Searching for my node on sortedNodeList');
    const fluxNodeIndex = sortedNodeList.findIndex((node) => node.ip === myIP);
    log.info(`My node was found on index: ${fluxNodeIndex} of ${sortedNodeList.length} nodes`);
    const minDeterministicOutPeers = Math.min(sortedNodeList.length, config.fluxapps.minOutgoing);
    // const minIncomingPeers = Math.min(sortedNodeList.length, 1.5 * config.fluxapps.minIncoming);
    log.info(`Current number of outgoing connections:${outgoingConnections.length}`);
    log.info(`Current number of incoming connections:${incomingConnections.length}`);
    log.info(`Current number of outgoing peers:${outgoingPeers.length}`);
    log.info(`Current number of incoming peers:${incomingPeers.length}`);
    // always try to connect to deterministic nodes
    // established deterministic outgoing connections
    let deterministicPeerConnections = false;
    // established deterministic 8 outgoing connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex + i < sortedNodeList.length ? fluxNodeIndex + i : fluxNodeIndex + i - sortedNodeList.length;
      const { ip } = sortedNodeList[fixedIndex];
      const ipInc = ip.split(':')[0];
      if (ipInc === myIP.split(':')[0]) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const portInc = ip.split(':')[1] || '16127';
      // additional precaution
      const clientExists = outgoingConnections.find((client) => client.ip === ipInc && client.port === portInc);
      const clientIncomingExists = incomingConnections.find((client) => client.ip === ipInc && client.port === portInc);
      if (!clientExists && !clientIncomingExists) {
        deterministicPeerConnections = true;
        initiateAndHandleConnection(ip);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
      }
    }
    // established deterministic 8 incoming connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex - i > 0 ? fluxNodeIndex - i : sortedNodeList.length - fluxNodeIndex - i;
      const { ip } = sortedNodeList[fixedIndex];
      const ipInc = ip.split(':')[0];
      if (ipInc === myIP.split(':')[0]) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const portInc = ip.split(':')[1] || '16127';
      // additional precaution
      const clientExists = outgoingConnections.find((client) => client.ip === ipInc && client.port === portInc);
      const clientIncomingExists = incomingConnections.find((client) => client.ip === ipInc && client.port === portInc);
      if (!clientExists && !clientIncomingExists) {
        deterministicPeerConnections = true;
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.axiosGet(`http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`).catch((error) => log.error(error));
      }
    }
    if (deterministicPeerConnections) {
      log.info('Connections to deterministic peers established');
    }

    await serviceHelper.delay(500);
    let index = 0;
    while ((outgoingConnections.length < 14 || [...new Set(outgoingConnections.map((client) => client.ip))].length < 9) && index < 100) { // Max of 14 outgoing connections - 8 possible deterministic + min. 6 random
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await fluxNetworkHelper.getRandomConnection();
      if (connection) {
        const ipInc = connection.split(':')[0];
        if (ipInc === myIP.split(':')[0]) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const portInc = connection.split(':')[1] || '16127';
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ipInc);
        const clientExists = outgoingConnections.find((client) => client.ip === ipInc && client.port === portInc);
        const clientIncomingExists = incomingConnections.find((client) => client.ip === ipInc && client.port === portInc);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Adding random Flux peer: ${connection}`);
          currentIpsConnTried.push(connection);
          initiateAndHandleConnection(connection);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }
    index = 0;
    while ((incomingConnections.length < 12 || [...new Set(incomingConnections.map((client) => client.ip))].length < 5) && index < 100) { // Max of 12 incoming connections - 8 possible deterministic + min. 4 random (we will get more random as others nodes have more random outgoing connections)
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await fluxNetworkHelper.getRandomConnection();
      if (connection) {
        const ipInc = connection.split(':')[0];
        if (ipInc === myIP.split(':')[0]) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const portInc = connection.split(':')[1] || '16127';
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ipInc);
        const clientExists = outgoingConnections.find((client) => client.ip === ipInc && client.port === portInc);
        const clientIncomingExists = incomingConnections.find((client) => client.ip === ipInc && client.port === portInc);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Asking random Flux ${connection} to add us as a peer`);
          currentIpsConnTried.push(connection);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.axiosGet(`http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`).catch((error) => log.error(error));
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

/**
 * Return the number of peers this node is connected to
 */
function getNumberOfPeers() {
  return incomingConnections.length + outgoingConnections.length;
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
  handleAppRunningMessage,
  handleIPChangedMessage,
  handleAppRemovedMessage,
  initiateAndHandleConnection,
  getNumberOfPeers,
  addOutgoingPeer,
};
