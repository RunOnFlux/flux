/* eslint-disable no-underscore-dangle */
const config = require('config');
const LRU = require('lru-cache');
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
const LRUoptions = {
  max: 20000, // currently 20000 nodes
  maxAge: 1000 * 360, // 360 seconds, 3 blocks
};

const LRUNodeListSortedoptions = {
  max: 1, // NodeListSorted
  maxAge: 10 * 60 * 1000, // 10m , 5 blocks
};

const sortedNodeListCache = new LRU(LRUNodeListSortedoptions);

let numberOfFluxNodes = 0;

const blockedPubKeysCache = new LRU(LRUoptions);

const privateIpsList = [
  '192.168.', '10.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.28.', '172.29.', '172.30.', '172.31.',
];

/**
 * To handle temporary app messages.
 * @param {object} message Message.
 * @param {string} fromIP Sender's IP address.
 */
async function handleAppMessages(message, fromIP) {
  try {
    // check if we have it in database and if not add
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppTemporaryMessage(message.data, true);
    if (rebroadcastToPeers === true) {
      const messageString = serviceHelper.ensureString(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIP);
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(100);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIP);
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
 */
async function handleAppRunningMessage(message, fromIP) {
  try {
    // check if we have it exactly like that in database and if not, update
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppRunningMessage(message.data);
    const currentTimeStamp = new Date().getTime();
    const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(message, currentTimeStamp, 240000);
    if (rebroadcastToPeers === true && timestampOK) {
      const messageString = serviceHelper.ensureString(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIP);
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(500);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIP);
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To handle incoming connection. Several types of verification are performed.
 * @param {object} ws Web socket.
 * @param {object} req Request.
 * @param {object} expressWS Express web socket.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
// eslint-disable-next-line no-unused-vars
function handleIncomingConnection(ws, req, expressWS) {
  // now we are in connections state. push the websocket to our incomingconnections
  const maxPeers = 4 * config.fluxapps.minIncoming;
  const maxNumberOfConnections = numberOfFluxNodes / 40 < 9 * config.fluxapps.minIncoming ? numberOfFluxNodes / 40 : 9 * config.fluxapps.minIncoming;
  const maxCon = Math.max(maxPeers, maxNumberOfConnections);
  if (incomingConnections.length > maxCon) {
    setTimeout(() => {
      ws.close(1000, 'Max number of incomming connections reached');
    }, 1000);
    return;
  }
  const findPeer = incomingPeers.find((p) => p.ip === ws._socket.remoteAddress);
  if (findPeer) {
    setTimeout(() => {
      ws.close(1000, 'Peer received is already in incomingPeers list');
    }, 1000);
    return;
  }
  const peer = {
    ip: ws._socket.remoteAddress,
  };
  const ipv4Peer = peer.ip.replace('::ffff:', '');
  // eslint-disable-next-line no-restricted-syntax
  for (const privateIp of privateIpsList) {
    if (ipv4Peer.startsWith(privateIp)) {
      setTimeout(() => {
        ws.close(1000, 'Peer received is using internal IP');
      }, 1000);
      log.error(`Incoming connection of peer from internal IP not allowed: ${ipv4Peer}`);
      return;
    }
  }
  incomingConnections.push(ws);
  incomingPeers.push(peer);
  // verify data integrity, if not signed, close connection
  ws.on('message', async (msg) => {
    // check rate limit
    const rateOK = fluxNetworkHelper.lruRateLimit(ipv4Peer, 30);
    if (!rateOK) {
      return; // do not react to the message
    }
    // check blocked list
    const dataObj = serviceHelper.ensureObject(msg);
    const { pubKey } = dataObj;
    if (blockedPubKeysCache.has(pubKey)) {
      try {
        log.info('Closing incoming connection, peer is on blockedList');
        ws.close(1000, 'blocked list'); // close as of policy violation?
      } catch (e) {
        log.error(e);
      }
      return;
    }
    const currentTimeStamp = Date.now();
    const messageOK = await fluxCommunicationUtils.verifyFluxBroadcast(msg, undefined, currentTimeStamp);
    if (messageOK === true) {
      const timestampOK = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(msg, currentTimeStamp);
      if (timestampOK === true) {
        try {
          const msgObj = serviceHelper.ensureObject(msg);
          if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
            handleAppMessages(msgObj, peer.ip.replace('::ffff:', ''));
          } else if (msgObj.data.type === 'fluxapprequest') {
            fluxCommunicationMessagesSender.respondWithAppMessage(msgObj, ws);
          } else if (msgObj.data.type === 'fluxapprunning') {
            handleAppRunningMessage(msgObj, peer.ip.replace('::ffff:', ''));
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
        const nodeFound = possibleNodes.find((n) => n.ip === peer.ip.replace('::ffff:', ''));
        if (!nodeFound) {
          log.warn(`Invalid message received from incoming peer ${peer.ip} which is not an originating node of ${pubKey}.`);
          ws.close(1000, 'invalid message, disconnect'); // close as of policy violation
        } else {
          blockedPubKeysCache.set(pubKey, pubKey); // blocks ALL the nodes corresponding to the pubKey
          log.warn(`closing incoming connection, adding peers ${pubKey} to the blockedList. Originated from ${peer.ip}.`);
          ws.close(1000, 'invalid message, blocked'); // close as of policy violation?
        }
      } catch (e) {
        log.error(e);
      }
    }
  });
  ws.on('error', async (msg) => {
    const ip = ws._socket.remoteAddress;
    log.warn(`Incoming connection error ${ip}`);
    const ocIndex = incomingConnections.findIndex((incomingCon) => ws._socket.remoteAddress === incomingCon._socket.remoteAddress);
    const foundPeer = incomingPeers.find((mypeer) => mypeer.ip === ip);
    if (ocIndex > -1) {
      incomingConnections.splice(ocIndex, 1);
    }
    if (foundPeer) {
      const peerIndex = incomingPeers.indexOf(foundPeer);
      if (peerIndex > -1) {
        incomingPeers.splice(peerIndex, 1);
      }
    }
    log.warn(`Incoming connection errored with: ${msg}`);
  });
  ws.on('close', async (msg) => {
    const ip = ws._socket.remoteAddress;
    log.warn(`Incoming connection close ${ip}`);
    const ocIndex = incomingConnections.findIndex((incomingCon) => ws._socket.remoteAddress === incomingCon._socket.remoteAddress);
    const foundPeer = incomingPeers.find((mypeer) => mypeer.ip === ip);
    if (ocIndex > -1) {
      incomingConnections.splice(ocIndex, 1);
    }
    if (foundPeer) {
      const peerIndex = incomingPeers.indexOf(foundPeer);
      if (peerIndex > -1) {
        incomingPeers.splice(peerIndex, 1);
      }
    }
    log.warn(`Incoming connection closed with: ${msg}`);
  });
}

/**
 * To get IP addresses for all outgoing connected peers.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function connectedPeers(req, res) {
  const connections = [];
  outgoingConnections.forEach((client) => {
    connections.push(client._socket.remoteAddress);
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
  }, 30 * 1000);
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
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      const closeResponse = await fluxNetworkHelper.closeConnection(ip);
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
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      const closeResponse = await fluxNetworkHelper.closeIncomingConnection(ip, expressWS);
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
async function initiateAndHandleConnection(connection) {
  let ip = connection;
  let port = config.server.apiport;
  if (connection.includes(':')) {
    ip = connection.split(':')[0];
    port = connection.split(':')[1];
  }
  const wsuri = `ws://${ip}:${port}/ws/flux/`;
  const websocket = new WebSocket(wsuri);

  websocket.onopen = () => {
    outgoingConnections.push(websocket);
    const peer = {
      ip, // can represent just one ip address, multiport
      lastPingTime: null,
      latency: null,
    };
    outgoingPeers.push(peer);
  };

  // every time a ping is sent a pong as received, measure latency
  websocket.on('pong', () => {
    try {
      const curTime = new Date().getTime();
      const foundPeer = outgoingPeers.find((peer) => peer.ip === ip);
      if (foundPeer) {
        foundPeer.latency = Math.ceil((curTime - foundPeer.lastPingTime) / 2);
      }
    } catch (error) {
      log.error(error);
    }
  });

  websocket.onclose = (evt) => {
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      log.info(`Connection to ${connection} closed with code ${evt.code}`);
      outgoingConnections.splice(ocIndex, 1);
    }
    const foundPeer = outgoingPeers.find((peer) => peer.ip === ip);
    if (foundPeer) {
      const peerIndex = outgoingPeers.indexOf(foundPeer);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
        log.info(`Connection ${connection} removed from outgoingPeers`);
      }
    }
  };

  websocket.onmessage = async (evt) => {
    // incoming messages from outgoing connections
    const currentTimeStamp = Date.now(); // ms
    // check rate limit
    const rateOK = fluxNetworkHelper.lruRateLimit(ip, 30);
    if (!rateOK) {
      return; // do not react to the message
    }
    // check blocked list
    const msgObj = serviceHelper.ensureObject(evt.data);
    const { pubKey } = msgObj;
    if (blockedPubKeysCache.has(pubKey)) {
      try {
        log.info('Closing outgoing connection, peer is on blockedList');
        websocket.close(1000, 'blocked list'); // close as of policy violation?
      } catch (e) {
        log.error(e);
      }
      return;
    }
    const messageOK = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(msgObj, undefined, currentTimeStamp);
    if (messageOK === true) {
      if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
        handleAppMessages(msgObj, ip);
      } else if (msgObj.data.type === 'fluxapprequest') {
        fluxCommunicationMessagesSender.respondWithAppMessage(msgObj, websocket);
      } else if (msgObj.data.type === 'fluxapprunning') {
        handleAppRunningMessage(msgObj, ip);
      }
    } else {
      // we dont like this peer as it sent wrong message (wrong, or message belonging to node no longer on network). Lets close the connection
      // and add him to blocklist
      try {
        // check if message comes from IP belonging to the public Key
        const zl = await fluxCommunicationUtils.deterministicFluxList(pubKey); // this itself is sufficient.
        const possibleNodes = zl.filter((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
        const nodeFound = possibleNodes.find((n) => n.ip === connection);
        if (!nodeFound) {
          log.warn(`Invalid message received from outgoing peer ${connection} which is not an originating node of ${pubKey}.`);
          websocket.close(1000, 'invalid message, disconnect'); // close as of policy violation
        } else {
          blockedPubKeysCache.set(pubKey, pubKey); // blocks ALL the nodes corresponding to the pubKey
          log.warn(`closing outgoing connection, adding peers ${pubKey} to the blockedList. Originated from ${connection}.`);
          websocket.close(1000, 'invalid message, blocked'); // close as of policy violation?
        }
      } catch (e) {
        log.error(e);
      }
    }
  };

  websocket.onerror = (evt) => {
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      log.info(`Connection to ${connection} errord with code ${evt.code}`);
      outgoingConnections.splice(ocIndex, 1);
    }
    const foundPeer = outgoingPeers.find((peer) => peer.ip === ip);
    if (foundPeer) {
      const peerIndex = outgoingPeers.indexOf(foundPeer);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
        log.info(`Connection ${connection} removed from outgoingPeers`);
      }
    }
  };
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
    const wsObj = outgoingConnections.find((client) => client._socket.remoteAddress === justIP);
    if (wsObj) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${justIP}`);
      return res.json(errMessage);
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized !== true) {
      const message = messageHelper.errUnauthorizedMessage();
      return res.json(message);
    }
    initiateAndHandleConnection(ip);
    const message = messageHelper.createSuccessMessage(`Outgoing connection to ${ip} initiated`);
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

    const wsObj = outgoingConnections.find((client) => client._socket.remoteAddress === justIP);
    if (wsObj) {
      const errMessage = messageHelper.createErrorMessage(`Already connected to ${justIP}`);
      return res.json(errMessage);
    }

    const nodeList = await fluxCommunicationUtils.deterministicFluxList();
    const fluxNode = nodeList.find((node) => node.ip === ip);
    if (!fluxNode) {
      const errMessage = messageHelper.createErrorMessage(`FluxNode ${ip} is not confirmed on the network.`);
      return res.json(errMessage);
    }

    initiateAndHandleConnection(ip);
    const message = messageHelper.createSuccessMessage(`Outgoing connection to ${ip} initiated`);
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

    let nodeList = [];
    const currentIpsConnTried = [];

    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (myIP) {
      nodeList = await fluxCommunicationUtils.deterministicFluxList();
      numberOfFluxNodes = nodeList.length;
      const fluxNode = nodeList.find((node) => node.ip === myIP);
      if (!fluxNode) {
        throw new Error('Node not confirmed. Flux discovery is awaiting.');
      }
    } else {
      throw new Error('Flux IP not detected. Flux discovery is awaiting.');
    }
    let sortedNodeList = sortedNodeListCache.get('sortedNodeList');
    if (!sortedNodeList) {
      log.info('sortedNodeList not found in cache');
      sortedNodeList = nodeList;
      sortedNodeList.sort((a, b) => {
        if (a.added_height > b.added_height) return 1;
        if (b.added_height > a.added_height) return -1;
        if (b.txhash > a.txhash) return 1;
        return 0;
      });
      sortedNodeListCache.set('sortedNodeList', sortedNodeList);
      log.info('sortedNodeList stored in cache');
    }
    log.info('Searching for my node on sortedNodeList');
    const fluxNodeIndex = sortedNodeList.findIndex((node) => node.ip === myIP);
    log.info(`My node was found on index: ${fluxNodeIndex} of ${sortedNodeList.length} nodes`);
    const minDeterministicOutPeers = Math.min(sortedNodeList.length, 1.5 * config.fluxapps.minOutgoing);
    const minIncomingPeers = Math.min(sortedNodeList.length, 1.5 * config.fluxapps.minIncoming);
    log.info(`Current number of outgoing connections:${outgoingConnections.length}`);
    log.info(`Current number of incoming connections:${incomingConnections.length}`);
    // always try to connect to deterministic nodes
    // established deterministic outgoing connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex + i < sortedNodeList.length ? fluxNodeIndex + i : fluxNodeIndex + i - sortedNodeList.length;
      const { ip } = sortedNodeList[fixedIndex];
      // additional precaution
      const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
      const clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress.replace('::ffff:', '') === ip);
      if (!clientExists && !clientIncomingExists) {
        log.info(`Adding Flux peer: ${ip}`);
        initiateAndHandleConnection(ip);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
      }
    }
    // established deterministic 8 incoming connections
    for (let i = 1; i <= minDeterministicOutPeers; i += 1) {
      const fixedIndex = fluxNodeIndex - i > 0 ? fluxNodeIndex - i : sortedNodeList.length - fluxNodeIndex - i;
      const { ip } = sortedNodeList[fixedIndex];
      // additional precaution
      const clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress.replace('::ffff:', '') === ip);
      if (!clientIncomingExists) {
        log.info(`Asking Flux ${ip} to add us as a peer`);
        const ipInc = ip.split(':')[0];
        const portInc = ip.split(':')[1] || 16127;
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.axiosGet(`http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`).catch((error) => log.error(error));
      }
    }

    await serviceHelper.delay(500);
    let index = 0;
    while (outgoingConnections.length < (minDeterministicOutPeers + minDeterministicOutPeers / 2) && index < 100) { // Max of 18 outgoing connections - 12 possible deterministic + min. 6 random
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await fluxNetworkHelper.getRandomConnection();
      if (connection) {
        const ip = connection.split(':')[0];
        // additional precaution
        let sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ip);
        let clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
        let clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress.replace('::ffff:', '') === ip);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Adding random Flux peer: ${connection}`);
          currentIpsConnTried.push(ip);
          initiateAndHandleConnection(connection);
        }
        // Max of 8 incoming connections - 8 possible deterministic + x random if needed;
        // We can have more incoming connections as it will be outgoing connections from other nodes + random
        // we only add randoming incoming peers if currently it's bellow minimum
        if (incomingConnections.length < minIncomingPeers) {
          // eslint-disable-next-line no-await-in-loop
          const connectionInc = await fluxNetworkHelper.getRandomConnection();
          if (connectionInc) {
            const ipInc = connectionInc.split(':')[0];
            const portInc = connectionInc.split(':')[1] || 16127;
            // additional precaution
            sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ipInc);
            clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ipInc);
            clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress.replace('::ffff:', '') === ipInc);
            if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
              log.info(`Asking random Flux ${connectionInc} to add us as a peer`);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.axiosGet(`http://${ipInc}:${portInc}/flux/addoutgoingpeer/${myIP}`).catch((error) => log.error(error));
            }
          }
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
  initiateAndHandleConnection,
  getNumberOfPeers,
  addOutgoingPeer,
};
