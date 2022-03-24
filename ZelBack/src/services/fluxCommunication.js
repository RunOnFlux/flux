/* eslint-disable no-underscore-dangle */
const bitcoinjs = require('bitcoinjs-lib');
const config = require('config');
const cmd = require('node-cmd');
const LRU = require('lru-cache');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const messageHelper = require('./messageHelper');
const daemonService = require('./daemonService');
const userconfig = require('../../../config/userconfig');
const { outgoingConnections } = require('./utils/outgoingConnections');
const { incomingConnections } = require('./utils/incomingConnections');

const outgoingPeers = []; // array of objects containing ip, latency, lastPingTime

const incomingPeers = []; // array of objects containing ip

const dosState = 0; // we can start at bigger number later
const dosMessage = null;

let response = messageHelper.createErrorMessage();
// default cache
const LRUoptions = {
  max: 2000, // currently 750 nodes lets put a value expecting increase in the numbers.
  maxAge: 1000 * 150, // 150 seconds slightly over average blocktime. Allowing 1 block expired too.
};

const numberOfFluxNodes = 0;

const myMessageCache = new LRU(250);
const blockedPubKeysCache = new LRU(LRUoptions);

async function getFluxMessageSignature(message, privatekey) {
  const privKey = await getFluxNodePrivateKey(privatekey);
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

async function getFluxNodePublicKey(privatekey) {
  try {
    const privKey = await getFluxNodePrivateKey(privatekey);
    const keyPair = bitcoinjs.ECPair.fromWIF(privKey);
    const pubKey = keyPair.publicKey.toString('hex');
    return pubKey;
  } catch (error) {
    return error;
  }
}

// return boolean
async function verifyFluxBroadcast(data, obtainedFluxNodesList, currentTimeStamp) {
  const dataObj = serviceHelper.ensureObject(data);
  const { pubKey } = dataObj;
  const { timestamp } = dataObj; // ms
  const { signature } = dataObj;
  const { version } = dataObj;
  // only version 1 is active
  if (version !== 1) {
    return false;
  }
  const message = serviceHelper.ensureString(dataObj.data);
  // is timestamp valid ?
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp - 120000)) { // message was broadcasted in the future. Allow 120 sec clock sync
    return false;
  }

  let node = null;
  if (obtainedFluxNodesList) { // for test purposes.
    node = obtainedFluxNodesList.find((key) => key.pubkey === pubKey);
    if (!node) {
      return false;
    }
  }
  if (!node) {
    // node that broadcasted the message has to be on list
    // pubkey of the broadcast has to be on the list
    const zl = await fluxCommunicationUtils.deterministicFluxList(pubKey); // this itself is sufficient.
    node = zl.find((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
  }
  if (!node) {
    return false;
  }
  const messageToVerify = version + message + timestamp;
  const verified = await verificationHelper.verifyMessage(messageToVerify, pubKey, signature);
  if (verified === true) {
    return true;
  }
  return false;
}

async function verifyTimestampInFluxBroadcast(data, currentTimeStamp) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp + 300000)) { // bigger than 5 mins
    return true;
  }
  return false;
}

// extends verifyFluxBroadcast by not allowing request older than 5 mins.
async function verifyOriginalFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp) {
  if (await verifyTimestampInFluxBroadcast(data, currentTimeStamp)) {
    return verifyFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp);
  }
  return false;
}

async function serialiseAndSignFluxBroadcast(dataToBroadcast, privatekey) {
  const version = 1;
  const timestamp = Date.now();
  const pubKey = await getFluxNodePublicKey(privatekey);
  const message = serviceHelper.ensureString(dataToBroadcast);
  const messageToSign = version + message + timestamp;
  const signature = await getFluxMessageSignature(messageToSign, privatekey);
  // version 1 specifications
  // message contains version, timestamp, pubKey, signature and data. Data is a stringified json. Signature is signature of version+stringifieddata+timestamp
  // signed by the priv key corresponding to pubkey attached
  // data object contains version, timestamp of signing, signature, pubKey, data object. further data object must at least contain its type as string to determine it further.
  const dataObj = {
    version,
    timestamp,
    pubKey,
    signature,
    data: dataToBroadcast,
  };
  const dataString = JSON.stringify(dataObj);
  return dataString;
}

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

async function handleAppRunningMessage(message, fromIP) {
  try {
    // check if we have it exactly like that in database and if not, update
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const rebroadcastToPeers = await appsService.storeAppRunningMessage(message.data);
    if (rebroadcastToPeers === true) {
      const messageString = serviceHelper.ensureString(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIP);
      fluxCommunicationMessagesSender.sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(2345);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIP);
      fluxCommunicationMessagesSender.sendToAllIncomingConnections(messageString, wsList);
    }
  } catch (error) {
    log.error(error);
  }
}

async function sendMessageToWS(message, ws) {
  try {
    const messageSigned = await serialiseAndSignFluxBroadcast(message);
    try {
      ws.send(messageSigned);
    } catch (e) {
      console.error(e);
    }
  } catch (error) {
    log.error(error);
  }
}

async function respondWithAppMessage(message, ws) {
  try {
    // check if we have it database of permanent appMessages
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');
    const tempMesResponse = myMessageCache.get(serviceHelper.ensureString(message));
    if (tempMesResponse) {
      sendMessageToWS(tempMesResponse, ws);
      return;
    }
    console.log(serviceHelper.ensureString(message));
    const permanentMessage = await appsService.checkAppMessageExistence(message.data.hash);
    if (permanentMessage) {
      // message exists in permanent storage. Create a message and broadcast it to the fromIP peer
      // const permanentAppMessage = {
      //   type: messageType,
      //   version: typeVersion,
      //   appSpecifications: appSpecFormatted,
      //   hash: messageHASH,
      //   timestamp,
      //   signature,
      //   txid,
      //   height,
      //   valueSat,
      // };
      const temporaryAppMessage = { // specification of temp message
        type: permanentMessage.type,
        version: permanentMessage.version,
        appSpecifications: permanentMessage.appSpecifications || permanentMessage.zelAppSpecifications,
        hash: permanentMessage.hash,
        timestamp: permanentMessage.timestamp,
        signature: permanentMessage.signature,
      };
      myMessageCache.set(serviceHelper.ensureString(message), temporaryAppMessage);
      sendMessageToWS(temporaryAppMessage, ws);
    } else {
      const existingTemporaryMessage = await appsService.checkAppTemporaryMessageExistence(message.data.hash);
      if (existingTemporaryMessage) {
        // a temporary appmessage looks like this:
        // const newMessage = {
        //   appSpecifications: message.appSpecifications || message.zelAppSpecifications,
        //   type: message.type,
        //   version: message.version,
        //   hash: message.hash,
        //   timestamp: message.timestamp,
        //   signature: message.signature,
        //   createdAt: new Date(message.timestamp),
        //   expireAt: new Date(validTill),
        // };
        const temporaryAppMessage = { // specification of temp message
          type: existingTemporaryMessage.type,
          version: existingTemporaryMessage.version,
          appSpecifications: existingTemporaryMessage.appSpecifications || existingTemporaryMessage.zelAppSpecifications,
          hash: existingTemporaryMessage.hash,
          timestamp: existingTemporaryMessage.timestamp,
          signature: existingTemporaryMessage.signature,
        };
        myMessageCache.set(serviceHelper.ensureString(message), temporaryAppMessage);
        sendMessageToWS(temporaryAppMessage, ws);
      }
      // else do nothing. We do not have this message. And this Flux would be requesting it from other peers soon too.
    }
  } catch (error) {
    log.error(error);
  }
}

// eslint-disable-next-line no-unused-vars
function handleIncomingConnection(ws, req, expressWS) {
  // now we are in connections state. push the websocket to our incomingconnections
  const maxPeers = 20;
  const maxNumberOfConnections = numberOfFluxNodes / 40 < 120 ? numberOfFluxNodes / 40 : 120;
  const maxCon = Math.max(maxPeers, maxNumberOfConnections);
  if (incomingConnections.length > maxCon) {
    setTimeout(() => {
      ws.close(1000, 'Max number of incomming connections reached');
    }, 1000);
    return;
  }
  incomingConnections.push(ws);
  const peer = {
    ip: ws._socket.remoteAddress,
  };
  incomingPeers.push(peer);
  // verify data integrity, if not signed, close connection
  ws.on('message', async (msg) => {
    // check rate limit
    const rateOK = await fluxNetworkHelper.checkRateLimit(peer.ip);
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
        console.error(e);
      }
      return;
    }
    const currentTimeStamp = Date.now();
    const messageOK = await verifyFluxBroadcast(msg, undefined, currentTimeStamp);
    if (messageOK === true) {
      const timestampOK = await verifyTimestampInFluxBroadcast(msg, currentTimeStamp);
      if (timestampOK === true) {
        try {
          const msgObj = serviceHelper.ensureObject(msg);
          if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
            handleAppMessages(msgObj, peer.ip.replace('::ffff:', ''));
          } else if (msgObj.data.type === 'zelapprequest' || msgObj.data.type === 'fluxapprequest') {
            respondWithAppMessage(msgObj, ws);
          } else if (msgObj.data.type === 'zelapprunning' || msgObj.data.type === 'fluxapprunning') {
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
          log.warn(`Message received from incoming peer ${peer.ip} but is not an originating node of ${pubKey}.`);
          ws.close(1000, 'invalid message, disconnect'); // close as of policy violation
        } else {
          blockedPubKeysCache.set(pubKey, pubKey); // blocks ALL the nodes corresponding to the pubKey
          log.warn(`closing incoming connection, adding peers ${pubKey} to the blockedList. Originated from ${peer.ip}.`);
          ws.close(1000, 'invalid message, blocked'); // close as of policy violation?
        }
      } catch (e) {
        console.error(e);
      }
    }
  });
  ws.on('error', async (msg) => {
    const ip = ws._socket.remoteAddress;
    log.warn(`Incoming connection error ${ip}`);
    const ocIndex = incomingConnections.findIndex((incomingCon) => ws._socket.remoteAddress === incomingCon._socket.remoteAddress);
    const foundPeer = await incomingPeers.find((mypeer) => mypeer.ip === ip);
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
    const foundPeer = await incomingPeers.find((mypeer) => mypeer.ip === ip);
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

async function broadcastMessageToOutgoing(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await fluxCommunicationMessagesSender.sendToAllPeers(serialisedData);
}

async function broadcastMessageToIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await fluxCommunicationMessagesSender.sendToAllIncomingConnections(serialisedData);
}

async function broadcastMessageToOutgoingFromUser(req, res) {
  try {
    let { data } = req.params;
    data = data || req.query.data;
    if (data === undefined || data === null) {
      throw new Error('No message to broadcast attached.');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      await broadcastMessageToOutgoing(data);
      const message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
      response = message;
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
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

async function broadcastMessageToOutgoingFromUserPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (processedBody === undefined || processedBody === null || processedBody === '') {
        throw new Error('No message to broadcast attached.');
      }
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (authorized === true) {
        await broadcastMessageToOutgoing(processedBody);
        const message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
        response = message;
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
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
  });
}

async function broadcastMessageToIncomingFromUser(req, res) {
  try {
    let { data } = req.params;
    data = data || req.query.data;
    if (data === undefined || data === null) {
      throw new Error('No message to broadcast attached.');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      await broadcastMessageToIncoming(data);
      const message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
      response = message;
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
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

async function broadcastMessageToIncomingFromUserPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (processedBody === undefined || processedBody === null || processedBody === '') {
        throw new Error('No message to broadcast attached.');
      }
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (authorized === true) {
        await broadcastMessageToIncoming(processedBody);
        const message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
        response = message;
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
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
  });
}

async function broadcastMessageFromUser(req, res) {
  try {
    let { data } = req.params;
    data = data || req.query.data;
    if (data === undefined || data === null) {
      throw new Error('No message to broadcast attached.');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    if (authorized === true) {
      await broadcastMessageToOutgoing(data);
      await broadcastMessageToIncoming(data);
      const message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
      response = message;
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
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

async function broadcastMessageFromUserPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (processedBody === undefined || processedBody === null || processedBody === '') {
        throw new Error('No message to broadcast attached.');
      }
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      if (authorized === true) {
        await broadcastMessageToOutgoing(processedBody);
        await broadcastMessageToIncoming(processedBody);
        const message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
        response = message;
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
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
  });
}

function connectedPeers(req, res) {
  const connections = [];
  outgoingConnections.forEach((client) => {
    connections.push(client._socket.remoteAddress);
  });
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

function connectedPeersInfo(req, res) {
  const connections = outgoingPeers;
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

function keepConnectionsAlive() {
  setInterval(() => {
    fluxCommunicationMessagesSender.sendToAllPeers(); // perform ping
    fluxCommunicationMessagesSender.sendToAllIncomingConnections(); // perform ping
  }, 30 * 1000);
}

function getIncomingConnections(req, res, expressWS) {
  const clientsSet = expressWS.clients;
  const connections = [];
  clientsSet.forEach((client) => {
    connections.push(client._socket.remoteAddress);
  });
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

function getIncomingConnectionsInfo(req, res) {
  const connections = incomingPeers;
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

async function closeConnection(ip) {
  let message;
  const wsObj = await outgoingConnections.find((client) => client._socket.remoteAddress === ip);
  if (wsObj) {
    const ocIndex = outgoingConnections.indexOf(wsObj);
    const foundPeer = await outgoingPeers.find((peer) => peer.ip === ip);
    if (ocIndex > -1) {
      wsObj.close(1000, 'purpusfully closed');
      log.info(`Connection to ${ip} closed`);
      outgoingConnections.splice(ocIndex, 1);
      if (foundPeer) {
        const peerIndex = outgoingPeers.indexOf(foundPeer);
        if (peerIndex > -1) {
          outgoingPeers.splice(peerIndex, 1);
        }
      }
      message = messageHelper.createSuccessMessage(`Outgoing connection to ${ip} closed`);
    } else {
      message = messageHelper.createErrorMessage(`Unable to close connection ${ip}. Try again later.`);
    }
  } else {
    message = messageHelper.createWarningMessage(`Connection to ${ip} does not exists.`);
  }
  return message;
}

async function closeIncomingConnection(ip, expressWS, clientToClose) {
  const clientsSet = expressWS.clients || [];
  let message;
  let wsObj = null || clientToClose;
  clientsSet.forEach((client) => {
    if (client._socket.remoteAddress === ip) {
      wsObj = client;
    }
  });
  if (wsObj) {
    const ocIndex = incomingConnections.indexOf(wsObj);
    const foundPeer = await incomingPeers.find((peer) => peer.ip === ip);
    if (ocIndex > -1) {
      wsObj.close(1000, 'purpusfully closed');
      log.info(`Connection from ${ip} closed`);
      incomingConnections.splice(ocIndex, 1);
      if (foundPeer) {
        const peerIndex = incomingPeers.indexOf(foundPeer);
        if (peerIndex > -1) {
          incomingPeers.splice(peerIndex, 1);
        }
      }
      message = messageHelper.createSuccessMessage(`Incoming connection to ${ip} closed`);
    } else {
      message = messageHelper.createErrorMessage(`Unable to close incoming connection ${ip}. Try again later.`);
    }
  } else {
    message = messageHelper.createWarningMessage(`Connection from ${ip} does not exists.`);
  }
  return message;
}

async function removePeer(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = messageHelper.createErrorMessage('No IP address specified.');
    return res.json(errMessage);
  }
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const closeResponse = await closeConnection(ip);
    response = closeResponse;
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function removeIncomingPeer(req, res, expressWS) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = messageHelper.createErrorMessage('No IP address specified.');
    return res.json(errMessage);
  }
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const closeResponse = await closeIncomingConnection(ip, expressWS);
    response = closeResponse;
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function getDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  response = messageHelper.createDataMessage(data);
  return res ? res.json(response) : response;
}

async function allowPort(port) {
  const exec = `sudo ufw allow ${port} && sudo ufw allow out ${port}`;
  const cmdAsync = util.promisify(cmd.get);

  const cmdres = await cmdAsync(exec);
  console.log(cmdres);
  const cmdStat = {
    status: false,
    message: null,
  };
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('existing') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

async function denyPort(port) {
  const exec = `sudo ufw deny ${port} && sudo ufw deny out ${port}`;
  const cmdAsync = util.promisify(cmd.get);

  const cmdres = await cmdAsync(exec);
  console.log(cmdres);
  const cmdStat = {
    status: false,
    message: null,
  };
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('existing') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

async function allowPortApi(req, res) {
  let { port } = req.params;
  port = port || req.query.port;
  if (port === undefined || port === null) {
    const errMessage = messageHelper.createErrorMessage('No Port address specified.');
    return res.json(errMessage);
  }
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const portResponseOK = await allowPort(port);
    if (portResponseOK.status === true) {
      response = messageHelper.createSuccessMessage(portResponseOK.message, port, port);
    } else if (portResponseOK.status === false) {
      response = messageHelper.createErrorMessage(portResponseOK.message, port, port);
    } else {
      response = messageHelper.createErrorMessage(`Unknown error while opening port ${port}`);
    }
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function isFirewallActive() {
  try {
    const cmdAsync = util.promisify(cmd.get);
    const execA = 'sudo ufw status | grep Status';
    const cmdresA = await cmdAsync(execA);
    if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
      return true;
    }
    return false;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

async function adjustFirewall() {
  try {
    const cmdAsync = util.promisify(cmd.get);
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const homePort = +apiPort - 1;
    let ports = [apiPort, homePort, 80, 443, 16125];
    const fluxCommunicationPorts = config.server.allowedPorts;
    ports = ports.concat(fluxCommunicationPorts);
    const firewallActive = await isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        const execB = `sudo ufw allow ${port}`;
        const execC = `sudo ufw allow out ${port}`;

        // eslint-disable-next-line no-await-in-loop
        const cmdresB = await cmdAsync(execB);
        if (serviceHelper.ensureString(cmdresB).includes('updated') || serviceHelper.ensureString(cmdresB).includes('existing') || serviceHelper.ensureString(cmdresB).includes('added')) {
          log.info(`Firewall adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall for port ${port}`);
        }

        // eslint-disable-next-line no-await-in-loop
        const cmdresC = await cmdAsync(execC);
        if (serviceHelper.ensureString(cmdresC).includes('updated') || serviceHelper.ensureString(cmdresC).includes('existing') || serviceHelper.ensureString(cmdresC).includes('added')) {
          log.info(`Firewall adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall for port ${port}`);
        }
      }
    } else {
      log.info('Firewall is not active. Adjusting not applied');
    }
  } catch (error) {
    log.error(error);
  }
}

function isCommunicationEstablished(req, res) {
  let message;
  if (outgoingPeers.length < config.fluxapps.minOutgoing || incomingPeers.length < config.fluxapps.minIncoming) {
    message = messageHelper.createErrorMessage('Not enough connections established to Flux network');
  } else {
    message = messageHelper.createSuccessMessage('Communication to Flux network is properly established');
  }
  res.json(message);
}

// how long can this take?
async function broadcastTemporaryAppMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string - messageHash(type + version + JSON.stringify(appSpecifications) + timestamp + signature))
  * @param timestamp number
  * @param signature string
  */
  log.info(message);
  // no verification of message before broadcasting. Broadcasting happens always after data have been verified and are stored in our db. It is up to receiving node to verify it and store and rebroadcast.
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.appSpecifications !== 'object' && typeof message.signature !== 'string' && typeof message.timestamp !== 'number' && typeof message.hash !== 'string') {
    throw new Error('Invalid Flux App message for storing');
  }
  // to all outoing
  await broadcastMessageToOutgoing(message); // every outgoing peer AT LEAST 50ms - suppose 40 outgoing - 0.8 seconds
  // to all incoming. Delay broadcast in case message is processing
  await broadcastMessageToIncoming(message); // every incoing peer AT LEAST 50ms. Suppose 50 incoming - 1 second
}

module.exports = {
  getFluxMessageSignature,
  verifyOriginalFluxBroadcast,
  verifyFluxBroadcast,
  handleIncomingConnection,
  broadcastMessageToOutgoing,
  broadcastMessageToIncoming,
  broadcastMessageToOutgoingFromUser,
  broadcastMessageToOutgoingFromUserPost,
  broadcastMessageToIncomingFromUser,
  broadcastMessageToIncomingFromUserPost,
  broadcastMessageFromUser,
  broadcastMessageFromUserPost,
  serialiseAndSignFluxBroadcast,
  connectedPeers,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  removePeer,
  removeIncomingPeer,
  connectedPeersInfo,
  getDOSState,
  isFirewallActive,
  allowPort,
  allowPortApi,
  denyPort,
  outgoingPeers,
  incomingPeers,
  isCommunicationEstablished,
  broadcastTemporaryAppMessage,
  keepConnectionsAlive,
  adjustFirewall,
  // exports for testing
  getFluxNodePublicKey,
  verifyTimestampInFluxBroadcast,
  handleAppMessages,
  outgoingConnections,
};
