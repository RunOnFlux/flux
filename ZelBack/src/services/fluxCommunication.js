/* eslint-disable no-underscore-dangle */
const config = require('config');
const { LRUCache } = require('lru-cache');
const hash = require('object-hash');
const WebSocket = require('ws');
const log = require('../../../lib/log');
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
const LRUoptions = {
  max: 20000, // currently 20000 nodes
  ttl: 1000 * 360, // 360 seconds, 3 blocks
  maxAge: 1000 * 360, // 360 seconds, 3 blocks
};

const LRUNodeListSortedoptions = {
  max: 1, // NodeListSorted
  ttl: 10 * 60 * 1000, // 10m , 5 blocks
  maxAge: 10 * 60 * 1000, // 10m , 5 blocks
};

const sortedNodeListCache = new LRUCache(LRUNodeListSortedoptions);

// cache for temporary messages
const LRUoptionsTemp = { // cache for temporary messages
  max: 20000, // store max 20000 values
  ttl: 1000 * 60 * 70, // 70 minutes
  maxAge: 1000 * 60 * 70, // 70 minutes
};

const myCacheTemp = new LRUCache(LRUoptionsTemp);

/* const LRUTest = {
  max: 25000000, // 25M
  ttl: 60 * 60 * 1000, // 1h
  maxAge: 60 * 60 * 1000, // 1h
};

const testListCache = new LRUCache(LRUTest); */

const numberOfFluxNodes = 0;

const blockedPubKeysCache = new LRUCache(LRUoptions);

const privateIpsList = [
  '192.168.', '10.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.28.', '172.29.', '172.30.', '172.31.',
];

// Flux Communication Controller
let fcc = new serviceHelper.FluxController();
let connectionTimeout = null;

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
      const messageString = serviceHelper.ensureString(message);
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
      const messageString = serviceHelper.ensureString(message);
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
      const messageString = serviceHelper.ensureString(message);
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
      const messageString = serviceHelper.ensureString(message);
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
function handleIncomingConnection(websocket, req) {
  try {
    const ws = websocket;
    const port = req.params.port || 16127;
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

      const msgObj = serviceHelper.ensureObject(msg.data);
      const { pubKey } = msgObj;
      const { timestamp } = msgObj;
      const { signature } = msgObj;
      const { version } = msgObj;
      const { data } = msgObj;
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
      myCacheTemp.set(messageHash, messageHash);
      // check rate limit
      const rateOK = fluxNetworkHelper.lruRateLimit(`${ipv4Peer}:${port}`, 90);
      if (!rateOK) {
        return; // do not react to the message
      }

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
          const zl = await fluxCommunicationUtils.deterministicFluxList(pubKey); // this itself is sufficient.
          const possibleNodes = zl.filter((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
          const nodeFound = possibleNodes.find((n) => n.ip.split(':')[0] === peer.ip && (n.ip.split(':')[1] || 16127) === peer.port);
          if (!nodeFound) {
            log.warn(`Invalid message received from incoming peer ${peer.ip}:${peer.port} which is not an originating node of ${pubKey}.`);
            ws.close(4004, 'invalid message, disconnect'); // close as of policy violation
          } else {
            blockedPubKeysCache.set(pubKey, pubKey); // blocks ALL the nodes corresponding to the pubKey
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
 * @returns {Promise<void>}
 */
async function pingAllPeers() {
  // this was previous running both inbound / outbound pings at the same time. Which based
  // on the 25ms delay in each function - wasn't the intent. It migh be a better solution to
  // spread out the ~30 pings over the 15sec period.
  await fluxCommunicationMessagesSender.sendToAllPeers(); // perform ping
  await fluxCommunicationMessagesSender.sendToAllIncomingConnections(); // perform ping
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
      const closeResponse = await fluxNetworkHelper.closeOutboundConnection(justIP, port);
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
async function removeIncomingPeer(req, res, expressWS) {
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
      const closeResponse = await fluxNetworkHelper.closeIncomingConnection(justIP, port, expressWS);
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

async function closeAllConnections() {
  const promises = [];

  outgoingPeers.forEach((peer) => {
    promises.push(fluxNetworkHelper.closeOutboundConnection(peer.ip, peer.port));
  });

  incomingPeers.forEach((peer) => {
    promises.push(fluxNetworkHelper.closeIncomingConnection(peer.ip, peer.port));
  });

  await Promise.all(promises);
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
    const wsuri = `ws://${ip}:${port}/ws/flux/${myPort}`;
    const websocket = new WebSocket(wsuri);
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
      const msgObj = serviceHelper.ensureObject(evt.data);
      const { pubKey } = msgObj;
      const { timestamp } = msgObj;
      const { signature } = msgObj;
      const { version } = msgObj;
      const { data } = msgObj;
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
      myCacheTemp.set(messageHash, messageHash);
      // incoming messages from outgoing connections
      const currentTimeStamp = Date.now(); // ms
      // check rate limit
      const rateOK = fluxNetworkHelper.lruRateLimit(`${ip}:${port}`, 90);
      if (!rateOK) {
        return; // do not react to the message
      }
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
      const messageOK = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(msgObj, undefined, currentTimeStamp);
      if (messageOK === true) {
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
        } else {
          log.warn(`Unrecognised message type of ${msgObj.data.type}`);
        }
      } else {
        // we dont like this peer as it sent wrong message (wrong, or message belonging to node no longer on network). Lets close the connection
        // and add him to blocklist
        try {
          // check if message comes from IP belonging to the public Key
          const zl = await fluxCommunicationUtils.deterministicFluxList(pubKey); // this itself is sufficient.
          const possibleNodes = zl.filter((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
          const nodeFound = possibleNodes.find((n) => n.ip === connection); // connection is either ip or ip:port (if port is not 16127)
          if (!nodeFound) {
            log.warn(`Invalid message received from outgoing peer ${connection} which is not an originating node of ${pubKey}.`);
            websocket.close(4007, 'invalid message, disconnect'); // close as of policy violation
          } else {
            blockedPubKeysCache.set(pubKey, pubKey); // blocks ALL the nodes corresponding to the pubKey
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
 * To discover and connect to other randomly selected FluxNodes Ensures that
 * FluxNode connections are not duplicated.
 * @returns {Promise<number>} ms to sleep for until next attempt
 */
async function connectToPeers() {
  if (fcc.aborted) return 0;

  await fcc.lock.enable();

  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      log.error('Daemon not synced. Peer discovery on hold. Will try again in 1m.');
      return 60 * 1000;
    }

    const currentIpsConnTried = [];

    const localEndpoint = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!localEndpoint) {
      log.error('Flux IP not detected. Peer discovery on hold. Will try again in 1m.');
      return 60 * 1000;
    }

    const activatedNodes = await fluxCommunicationUtils.deterministicFluxList();

    const fluxNode = activatedNodes.find((node) => node.ip === localEndpoint);

    if (!fluxNode) {
      log.error('Node not confirmed. Peer discovery on hold. Will try again in 1m.');
      return 60 * 1000;
    }

    const cacheHit = sortedNodeListCache.get('sortedNodeList');

    let [sortedNodeList, fluxNodeIndex] = cacheHit || [undefined, undefined];

    if (!sortedNodeList) {
      log.info('sortedNodeList not found in cache');
      sortedNodeList = activatedNodes;
      log.info('Searching for my node on sortedNodeList');
      fluxNodeIndex = sortedNodeList.findIndex((node) => node.ip === localEndpoint);
      log.info(`My node was found on index: ${fluxNodeIndex} of ${sortedNodeList.length} nodes`);
      sortedNodeList.sort((a, b) => {
        if (a.added_height > b.added_height) return 1;
        if (b.added_height > a.added_height) return -1;
        if (b.txhash > a.txhash) return 1;
        return 0;
      });
      // this just moves the list, so the node behind us in the list is index 0
      sortedNodeList = sortedNodeList
        .slice(fluxNodeIndex + 1, sortedNodeList.length)
        .concat(sortedNodeList.slice(0, fluxNodeIndex));

      sortedNodeListCache.set('sortedNodeList', [sortedNodeList, fluxNodeIndex]);
      log.info('sortedNodeList stored to cache');
    }

    const minDeterministicOutPeers = Math.min(sortedNodeList.length, config.fluxapps.minOutgoing);

    log.info(`Inbound/Outbound connection count: ${incomingConnections.length}/${outgoingConnections.length}`);
    log.info(`Inbound/Outbound peer count: ${incomingPeers.length}/${outgoingPeers.length}`);

    // always try to connect to deterministic nodes
    let deterministicPeerConnections = false;

    while (!fcc.aborted && outgoingConnections.length < minDeterministicOutPeers) {
      const { ip: endpoint } = sortedNodeList.shift();
      const [ip, port] = endpoint.includes(':') ? endpoint.split(':') : [endpoint, 16127];

      // change these to maps
      const outgoing = outgoingConnections.find((client) => client.ip === ip && client.port === port);
      const incoming = incomingConnections.find((client) => client.ip === ip && client.port === port);

      if (!outgoing && !incoming) {
        deterministicPeerConnections = true;
        initiateAndHandleConnection(endpoint);
        // this is pretty rugged. Should wait on the connection being established.
        // eslint-disable-next-line no-await-in-loop
        await fcc.sleep(500);
      }
    }

    // established deterministic 8 incoming connections
    while (!fcc.aborted && incomingConnections.length < minDeterministicOutPeers) {
      const { ip: endpoint } = sortedNodeList.shift();
      const [ip, port] = endpoint.includes(':') ? endpoint.split(':') : [endpoint, 16127];

      // change these to maps
      const outgoing = outgoingConnections.find((client) => client.ip === ip && client.port === port);
      const incoming = incomingConnections.find((client) => client.ip === ip && client.port === port);

      if (!outgoing && !incoming) {
        deterministicPeerConnections = true;
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.axiosGet(`http://${ip}:${port}/flux/addoutgoingpeer/${localEndpoint}`).catch((error) => log.error(error));
      }
    }

    if (deterministicPeerConnections) {
      log.info('Connections to deterministic peers established');
    }

    // why??
    await fcc.sleep(500);

    let index = 0;
    // Max of 14 outgoing connections - 8 possible deterministic + min. 6 random
    while (!fcc.aborted && index < 100 && (outgoingConnections.length < 14 || [...new Set(outgoingConnections.map((client) => client.ip))].length < 9)) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await fluxNetworkHelper.getRandomConnection();
      if (connection) {
        const ipInc = connection.split(':')[0];
        const portInc = connection.split(':')[1] || 16127;
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
      await fcc.sleep(500);
    }
    index = 0;
    // Max of 12 incoming connections - 8 possible deterministic + min. 4 random (we will get more random as others nodes have more random outgoing connections)
    while ((incomingConnections.length < 12 || [...new Set(incomingConnections.map((client) => client.ip))].length < 5) && index < 100) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await fluxNetworkHelper.getRandomConnection();
      if (connection) {
        const ipInc = connection.split(':')[0];
        const portInc = connection.split(':')[1] || 16127;
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ipInc);
        const clientExists = outgoingConnections.find((client) => client.ip === ipInc && client.port === portInc);
        const clientIncomingExists = incomingConnections.find((client) => client.ip === ipInc && client.port === portInc);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Asking random Flux ${connection} to add us as a peer`);
          currentIpsConnTried.push(connection);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.axiosGet(`http://${ipInc}:${portInc}/flux/addoutgoingpeer/${localEndpoint}`).catch((error) => log.error(error));
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await fcc.sleep(500);
    }
    return 60 * 1000;
  } catch (err) {
    if (err.name === 'AbortError') {
      return 0;
    } else {
      log.warn(err);
      return 2 * 60 * 120;
    }
  } finally {
    fcc.lock.disable();
  }
}

async function loopPeerConnections() {
  const ms = await connectToPeers();
  if (!ms) return;
  connectionTimeout = setTimeout(loopPeerConnections, ms);
}

function startPeerConnectionSentinel() {
  loopPeerConnections();
}

async function stopPeerConnectionSentinel() {
  if (connectionTimeout) clearTimeout(connectionTimeout);
  connectionTimeout = null;
  await fcc.abort();
  fcc = new serviceHelper.FluxController();
  await closeAllConnections();
}

/**
 * Return the number of peers this node is connected to
 */
function getNumberOfPeers() {
  return incomingConnections.length + outgoingConnections.length;
}

module.exports = {
  addOutgoingPeer,
  addPeer,
  connectedPeers,
  connectedPeersInfo,
  getNumberOfPeers,
  handleAppMessages,
  handleAppRemovedMessage,
  handleAppRunningMessage,
  handleIncomingConnection,
  handleIPChangedMessage,
  initiateAndHandleConnection,
  pingAllPeers,
  removeIncomingPeer,
  removePeer,
  startPeerConnectionSentinel,
  stopPeerConnectionSentinel,
};
