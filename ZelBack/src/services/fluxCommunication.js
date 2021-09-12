/* eslint-disable no-underscore-dangle */
const WebSocket = require('ws');
const bitcoinjs = require('bitcoinjs-lib');
const config = require('config');
const cmd = require('node-cmd');
const LRU = require('lru-cache');
const fs = require('fs').promises;
const path = require('path');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const daemonService = require('./daemonService');
const benchmarkService = require('./benchmarkService');
const userconfig = require('../../../config/userconfig');

const outgoingConnections = []; // websocket list
const outgoingPeers = []; // array of objects containing ip, latency, lastPingTime

const incomingConnections = []; // websocket list
const incomingPeers = []; // array of objects containing ip

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

const minimumFluxBenchAllowedVersion = 223;
let storedFluxBenchAllowed = null;

// my external Flux IP from benchmark
let myFluxIP = null;

let myNodePubKey = null;

let response = serviceHelper.createErrorMessage();
// default cache
const LRUoptions = {
  max: 2000, // currently 750 nodes lets put a value expecting increase in the numbers.
  maxAge: 1000 * 150, // 150 seconds slightly over average blocktime. Allowing 1 block expired too.
};

const myCache = new LRU(LRUoptions);
const myMessageCache = new LRU(250);
const blockedPubKeysCache = new LRU(LRUoptions);

let addingNodesToCache = false;

// basic check for a version of other flux.
async function isFluxAvailable(ip) {
  const axiosConfig = {
    timeout: 8888,
  };
  try {
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${config.server.apiport}/flux/version`, axiosConfig);
    if (fluxResponse.data.status === 'success') {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// basic check for a version of other flux.
async function checkFluxAvailability(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = serviceHelper.createErrorMessage('No ip specified.');
    return res.json(errMessage);
  }

  const available = await isFluxAvailable(ip);

  if (available === true) {
    const message = serviceHelper.createSuccessMessage('Asking Flux is available');
    response = message;
  } else {
    const message = serviceHelper.createErrorMessage('Asking Flux is not available');
    response = message;
  }
  return res.json(response);
}

async function getMyFluxIP() {
  const benchmarkResponse = await daemonService.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  } else {
    dosMessage = 'Error getting fluxIp from FluxBench';
    dosState += 15;
    log.error(dosMessage);
  }
  myFluxIP = myIP;
  return myIP;
}

// get deterministc Flux list from cache
// filter can only be a publicKey!
async function deterministicFluxList(filter) {
  try {
    if (addingNodesToCache) {
      // prevent several instances filling the cache at the same time.
      await serviceHelper.delay(100);
      return deterministicFluxList(filter);
    }
    const request = {
      params: {},
      query: {},
    };
    let fluxList;
    if (filter) {
      fluxList = myCache.get(`fluxList${serviceHelper.ensureString(filter)}`);
    } else {
      fluxList = myCache.get('fluxList');
    }
    if (!fluxList) {
      // not present in cache lets get fluxList again and cache it.
      addingNodesToCache = true;
      const daemonFluxNodesList = await daemonService.viewDeterministicZelNodeList(request);
      if (daemonFluxNodesList.status === 'success') {
        fluxList = daemonFluxNodesList.data || [];
        fluxList.forEach((item) => {
          myCache.set(`fluxList${serviceHelper.ensureString(item.pubkey)}`, [item]);
        });
        myCache.set('fluxList', fluxList);
      }
      addingNodesToCache = false;
      if (filter) {
        fluxList = myCache.get(`fluxList${serviceHelper.ensureString(filter)}`);
      }
    }
    return fluxList || [];
  } catch (error) {
    log.error(error);
    return [];
  }
}

async function getFluxNodePrivateKey(privatekey) {
  const privKey = privatekey || daemonService.getConfigValue('zelnodeprivkey');
  return privKey;
}

async function getFluxMessageSignature(message, privatekey) {
  const privKey = await getFluxNodePrivateKey(privatekey);
  const signature = await serviceHelper.signMessage(message, privKey);
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
    node = await obtainedFluxNodesList.find((key) => key.pubkey === pubKey);
    if (!node) {
      return false;
    }
  }
  if (!node) {
    const zl = await deterministicFluxList(pubKey); // this itself is sufficient.
    if (zl.length === 1) {
      if (zl[0].pubkey === pubKey) {
        [node] = zl;
      }
    }
  }
  if (!node) {
    return false;
  }
  const messageToVerify = version + message + timestamp;
  const verified = await serviceHelper.verifyMessage(messageToVerify, pubKey, signature);
  if (verified === true) {
    return true;
  }
  return false;
}

// extends verifyFluxBroadcast by not allowing request older than 5 mins.
async function verifyOriginalFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp > (timestamp + 300000)) { // bigger than 5 mins
    return false;
  }
  const verified = await verifyFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp);
  return verified;
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

async function sendToAllPeers(data, wsList) {
  try {
    let removals = [];
    let ipremovals = [];
    // wsList is always a sublist of outgoingConnections
    const outConList = wsList || outgoingConnections;
    // eslint-disable-next-line no-restricted-syntax
    for (const client of outConList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(100);
        if (client.readyState === WebSocket.OPEN) {
          if (!data) {
            const pingTime = new Date().getTime();
            client.ping('flux'); // do ping with flux strc instead
            const foundPeer = outgoingPeers.find((peer) => peer.ip === client._socket.remoteAddress);
            if (foundPeer) {
              foundPeer.lastPingTime = pingTime;
            }
          } else {
            client.send(data);
          }
        } else {
          throw new Error(`Connection to ${client._socket.remoteAddress} is not open`);
        }
      } catch (e) {
        removals.push(client);
        try {
          const ip = client._socket.remoteAddress;
          const foundPeer = outgoingPeers.find((peer) => peer.ip === ip);
          ipremovals.push(foundPeer);
        } catch (err) {
          log.error(err);
        }
      }
    }

    for (let i = 0; i < ipremovals.length; i += 1) {
      const peerIndex = outgoingPeers.indexOf(ipremovals[i]);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
      }
    }
    for (let i = 0; i < removals.length; i += 1) {
      const ocIndex = outgoingConnections.indexOf(removals[i]);
      if (ocIndex > -1) {
        outgoingConnections.splice(ocIndex, 1);
      }
    }
    removals = [];
    ipremovals = [];
  } catch (error) {
    log.error(error);
  }
}

async function sendToAllIncomingConnections(data, wsList) {
  try {
    let removals = [];
    let ipremovals = [];
    // wsList is always a sublist of incomingConnections
    const incConList = wsList || incomingConnections;
    // eslint-disable-next-line no-restricted-syntax
    for (const client of incConList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(100);
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        } else {
          throw new Error(`Connection to ${client._socket.remoteAddress} is not open`);
        }
      } catch (e) {
        removals.push(client);
        try {
          const ip = client._socket.remoteAddress;
          const foundPeer = incomingPeers.find((peer) => peer.ip === ip);
          ipremovals.push(foundPeer);
        } catch (err) {
          log.error(err);
        }
      }
    }

    for (let i = 0; i < ipremovals.length; i += 1) {
      const peerIndex = incomingPeers.indexOf(ipremovals[i]);
      if (peerIndex > -1) {
        incomingPeers.splice(peerIndex, 1);
      }
    }
    for (let i = 0; i < removals.length; i += 1) {
      const ocIndex = incomingConnections.indexOf(removals[i]);
      if (ocIndex > -1) {
        incomingConnections.splice(ocIndex, 1);
      }
    }
    removals = [];
    ipremovals = [];
  } catch (error) {
    log.error(error);
  }
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
      sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(2345);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress !== fromIP);
      sendToAllIncomingConnections(messageString, wsList);
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
      sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(2345);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress !== fromIP);
      sendToAllIncomingConnections(messageString, wsList);
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
  incomingConnections.push(ws);
  const peer = {
    ip: ws._socket.remoteAddress,
  };
  incomingPeers.push(peer);
  // verify data integrity, if not signed, close connection
  ws.on('message', async (msg) => {
    const dataObj = serviceHelper.ensureObject(msg);
    const { pubKey } = dataObj;
    if (blockedPubKeysCache.has(pubKey)) {
      try {
        log.info('Closing connection, peer is on blockedList');
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
            handleAppMessages(msgObj, peer.ip);
          } else if (msgObj.data.type === 'zelapprequest' || msgObj.data.type === 'fluxapprequest') {
            respondWithAppMessage(msgObj, ws);
          } else if (msgObj.data.type === 'zelapprunning' || msgObj.data.type === 'fluxapprunning') {
            handleAppRunningMessage(msgObj, ws);
          } else {
            log.warn(`Unrecognised message type of ${msgObj.data.type}`);
          }
        } catch (e) {
          log.error(e);
        }
      }
    } else {
      // we dont like this peer as it sent wrong message. Lets close the connection
      // and add him to blocklist
      try {
        blockedPubKeysCache.set(pubKey, pubKey);
        log.info('closing connection, adding peer to the blockedList');
        ws.close(1000, 'invalid message, blocked'); // close as of policy violation?
      } catch (e) {
        console.error(e);
      }
    }
  });
  ws.on('error', async (msg) => {
    console.log(ws._socket.remoteAddress);
    const ip = ws._socket.remoteAddress;
    const ocIndex = incomingConnections.indexOf(ws);
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
    log.error(`Incoming connection errored with: ${msg}`);
  });
  ws.on('close', async (msg) => {
    const ip = ws._socket.remoteAddress;
    const ocIndex = incomingConnections.indexOf(ws);
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
    log.info(`Incoming connection closed with: ${msg}`);
  });
}

async function broadcastMessageToOutgoing(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  sendToAllPeers(serialisedData);
}

async function broadcastMessageToIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  sendToAllIncomingConnections(serialisedData);
}

async function broadcastMessageToOutgoingFromUser(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (data === undefined || data === null) {
    const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    broadcastMessageToOutgoing(data);
    const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
    response = message;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function broadcastMessageToOutgoingFromUserPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    if (processedBody === undefined || processedBody === null || processedBody === '') {
      const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
      response = errMessage;
    } else {
      const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
      if (authorized === true) {
        broadcastMessageToOutgoing(processedBody);
        const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
        response = message;
      } else {
        response = serviceHelper.errUnauthorizedMessage();
      }
    }
    return res.json(response);
  });
}

async function broadcastMessageToIncomingFromUser(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (data === undefined || data === null) {
    const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    broadcastMessageToIncoming(data);
    const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
    response = message;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function broadcastMessageToIncomingFromUserPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    if (processedBody === undefined || processedBody === null || processedBody === '') {
      const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
      response = errMessage;
    } else {
      const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
      if (authorized === true) {
        broadcastMessageToIncoming(processedBody);
        const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
        response = message;
      } else {
        response = serviceHelper.errUnauthorizedMessage();
      }
    }
    return res.json(response);
  });
}

async function broadcastMessageFromUser(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (data === undefined || data === null) {
    const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    broadcastMessageToOutgoing(data);
    broadcastMessageToIncoming(data);
    const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
    response = message;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function broadcastMessageFromUserPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    if (processedBody === undefined || processedBody === null || processedBody === '') {
      const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
      response = errMessage;
    } else {
      const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
      if (authorized === true) {
        broadcastMessageToOutgoing(processedBody);
        broadcastMessageToIncoming(processedBody);
        const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
        response = message;
      } else {
        response = serviceHelper.errUnauthorizedMessage();
      }
    }
    return res.json(response);
  });
}

async function getRandomConnection() {
  const nodeList = await deterministicFluxList();
  const zlLength = nodeList.length;
  if (zlLength === 0) {
    return null;
  }
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const ip = nodeList[randomNode].ip || nodeList[randomNode].ipaddress;

  if (ip === userconfig.initial.ipaddress || ip === myFluxIP) {
    return null;
  }
  return ip;
}

async function initiateAndHandleConnection(ip) {
  const wsuri = `ws://${ip}:${config.server.apiport}/ws/flux/`;
  const websocket = new WebSocket(wsuri);

  websocket.onopen = () => {
    outgoingConnections.push(websocket);
    const peer = {
      ip: websocket._socket.remoteAddress,
      lastPingTime: null,
      latency: null,
    };
    outgoingPeers.push(peer);
  };

  // every time a ping is sent a pong as received, measure latency
  websocket.on('pong', () => {
    try {
      const curTime = new Date().getTime();
      const { url } = websocket;
      let conIP = url.split('/')[2];
      conIP = conIP.split(`:${config.server.apiport}`).join('');
      const foundPeer = outgoingPeers.find((peer) => peer.ip === conIP);
      if (foundPeer) {
        foundPeer.latency = Math.ceil((curTime - foundPeer.lastPingTime) / 2);
      }
    } catch (error) {
      log.error(error);
    }
  });

  websocket.onclose = (evt) => {
    const { url } = websocket;
    let conIP = url.split('/')[2];
    conIP = conIP.split(`:${config.server.apiport}`).join('');
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      log.info(`Connection to ${conIP} closed with code ${evt.code}`);
      outgoingConnections.splice(ocIndex, 1);
    }
    const foundPeer = outgoingPeers.find((peer) => peer.ip === conIP);
    if (foundPeer) {
      const peerIndex = outgoingPeers.indexOf(foundPeer);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
        log.info(`Connection ${conIP} removed from outgoingPeers`);
      }
    }
  };

  websocket.onmessage = async (evt) => {
    // incoming messages from outgoing connections
    const currentTimeStamp = Date.now(); // ms
    const messageOK = await verifyOriginalFluxBroadcast(evt.data, undefined, currentTimeStamp);
    if (messageOK === true) {
      const { url } = websocket;
      let conIP = url.split('/')[2];
      conIP = conIP.split(`:${config.server.apiport}`).join('');
      const msgObj = serviceHelper.ensureObject(evt.data);
      if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
        handleAppMessages(msgObj, conIP);
      } else if (msgObj.data.type === 'zelapprequest' || msgObj.data.type === 'fluxapprequest') {
        respondWithAppMessage(msgObj, websocket);
      } else if (msgObj.data.type === 'zelapprunning' || msgObj.data.type === 'fluxapprunning') {
        handleAppRunningMessage(msgObj, websocket);
      }
    } // else we do not react to this message;
  };

  websocket.onerror = (evt) => {
    console.log(evt.code);
    const { url } = websocket;
    let conIP = url.split('/')[2];
    conIP = conIP.split(`:${config.server.apiport}`).join('');
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      log.info(`Connection to ${conIP} errord with code ${evt.code}`);
      outgoingConnections.splice(ocIndex, 1);
    }
    const foundPeer = outgoingPeers.find((peer) => peer.ip === conIP);
    if (foundPeer) {
      const peerIndex = outgoingPeers.indexOf(foundPeer);
      if (peerIndex > -1) {
        outgoingPeers.splice(peerIndex, 1);
        log.info(`Connection ${conIP} removed from outgoingPeers`);
      }
    }
  };
}

async function fluxDiscovery() {
  try {
    const syncStatus = await daemonService.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced. Flux discovery is awaiting.');
    }

    let nodeList = [];

    if (myNodePubKey) {
      nodeList = await deterministicFluxList(myNodePubKey);
      if (nodeList.length === 0) {
        myNodePubKey = null;
        throw new Error('Node no longer confirmed. Flux discovery is awaiting.');
      }
    } else {
      const myIP = await getMyFluxIP();
      if (myIP) {
        nodeList = await deterministicFluxList();
        const fluxNode = nodeList.find((node) => node.ip === myIP);
        if (fluxNode) {
          myNodePubKey = fluxNode.pubkey;
        } else {
          throw new Error('Node not confirmed. Flux discovery is awaiting.');
        }
      } else {
        throw new Error('Flux IP not detected. Flux discovery is awaiting.');
      }
    }
    const minPeers = 12;
    const maxPeers = 20;
    const numberOfFluxNodes = nodeList.length;
    const currentIpsConnTried = [];
    const requiredNumberOfConnections = numberOfFluxNodes / 100; // 1%
    const maxNumberOfConnections = numberOfFluxNodes / 50; // 2%
    const minCon = Math.max(minPeers, requiredNumberOfConnections); // awlays maintain at least 10 or 1% of nodes whatever is higher
    const maxCon = Math.max(maxPeers, maxNumberOfConnections); // have a maximum of 20 or 2% of nodes whatever is higher
    log.info(`Current number of outgoing connections:${outgoingConnections.length}`);
    log.info(`Current number of incoming connections:${incomingConnections.length}`);
    // coonect to peers as min connections not yet established
    let index = 0;
    while (outgoingConnections.length < minCon && index < 100) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const ip = await getRandomConnection();
      if (ip) {
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ip);
        const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
        const clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress === ip);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Adding Flux peer: ${ip}`);
          initiateAndHandleConnection(ip);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(1000);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1000);
    }
    if (outgoingConnections.length < maxCon) {
      const ip = await getRandomConnection();
      if (ip) {
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ip);
        const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
        const clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress === ip);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Adding Flux peer: ${ip}`);
          initiateAndHandleConnection(ip);
        }
      }
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

function connectedPeers(req, res) {
  const connections = [];
  outgoingConnections.forEach((client) => {
    connections.push(client._socket.remoteAddress);
  });
  const message = serviceHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

function connectedPeersInfo(req, res) {
  const connections = outgoingPeers;
  const message = serviceHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

function keepConnectionsAlive() {
  setInterval(() => {
    sendToAllPeers(); // perform ping
  }, 30 * 1000);
}

async function addPeer(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = serviceHelper.createErrorMessage('No IP address specified.');
    return res.json(errMessage);
  }
  const wsObj = await outgoingConnections.find((client) => client._socket.remoteAddress === ip);
  if (wsObj) {
    const errMessage = serviceHelper.createErrorMessage(`Already connected to ${ip}`);
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    initiateAndHandleConnection(ip);
    const message = serviceHelper.createSuccessMessage(`Outgoing connection to ${ip} initiated`);
    response = message;
    console.log(response);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  console.log(response);
  return res.json(response);
}

function getIncomingConnections(req, res, expressWS) {
  const clientsSet = expressWS.clients;
  const connections = [];
  clientsSet.forEach((client) => {
    connections.push(client._socket.remoteAddress);
  });
  const message = serviceHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

function getIncomingConnectionsInfo(req, res) {
  const connections = incomingPeers;
  const message = serviceHelper.createDataMessage(connections);
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
      message = serviceHelper.createSuccessMessage(`Outgoing connection to ${ip} closed`);
    } else {
      message = serviceHelper.createErrorMessage(`Unable to close connection ${ip}. Try again later.`);
    }
  } else {
    message = serviceHelper.createWarningMessage(`Connection to ${ip} does not exists.`);
  }
  return message;
}

async function closeIncomingConnection(ip, expressWS) {
  const clientsSet = expressWS.clients;
  let message;
  let wsObj = null;
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
      message = serviceHelper.createSuccessMessage(`Incoming connection to ${ip} closed`);
    } else {
      message = serviceHelper.createErrorMessage(`Unable to close incoming connection ${ip}. Try again later.`);
    }
  } else {
    message = serviceHelper.createWarningMessage(`Connection from ${ip} does not exists.`);
  }
  return message;
}

async function removePeer(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = serviceHelper.createErrorMessage('No IP address specified.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const closeResponse = await closeConnection(ip);
    response = closeResponse;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function removeIncomingPeer(req, res, expressWS) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = serviceHelper.createErrorMessage('No IP address specified.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const closeResponse = await closeIncomingConnection(ip, expressWS);
    response = closeResponse;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function checkFluxbenchVersionAllowed() {
  if (storedFluxBenchAllowed) {
    return storedFluxBenchAllowed >= minimumFluxBenchAllowedVersion;
  }
  try {
    const benchmarkInfoResponse = await benchmarkService.getInfo();
    if (benchmarkInfoResponse.status === 'success') {
      log.info(benchmarkInfoResponse);
      let benchmarkVersion = benchmarkInfoResponse.data.version;
      benchmarkVersion = benchmarkVersion.replace(/\./g, '');
      storedFluxBenchAllowed = benchmarkVersion;
      if (benchmarkVersion >= minimumFluxBenchAllowedVersion) {
        return true;
      }
      dosState += 11;
      dosMessage = `Fluxbench Version Error. Current lower version allowed is v${minimumFluxBenchAllowedVersion} found v${benchmarkVersion}`;
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    dosMessage = 'Fluxbench Version Error. Error obtaining Flux Version.';
    log.error(dosMessage);
    return false;
  } catch (err) {
    log.error(err);
    log.error(`Error on checkFluxBenchVersion: ${err.message}`);
    dosState += 2;
    dosMessage = 'Fluxbench Version Error. Error obtaining Flux Version.';
    return false;
  }
}

async function checkMyFluxAvailability() {
  const fluxBenchVersionAllowed = await checkFluxbenchVersionAllowed();
  if (!fluxBenchVersionAllowed) {
    return false;
  }
  let askingIP = await getRandomConnection();
  if (typeof askingIP !== 'string' || typeof myFluxIP !== 'string' || myFluxIP === askingIP) {
    return false;
  }
  if (askingIP.includes(':')) {
    // it is ipv6
    askingIP = `[${askingIP}]`;
  }
  let myIP = myFluxIP;
  if (myIP.includes(':')) {
    myIP = `[${myIP}]`;
  }
  let availabilityError = null;
  const resMyAvailability = await serviceHelper.axiosGet(`http://${askingIP}:${config.server.apiport}/flux/checkfluxavailability/${myIP}`).catch((error) => {
    log.error(`${askingIP} is not reachable`);
    log.error(error);
    availabilityError = true;
  });
  if (!resMyAvailability || availabilityError) {
    dosState += 1.5;
    if (dosState > 10) {
      dosMessage = dosMessage || 'Flux communication is limited';
      log.error(dosMessage);
    }
    return false;
  }
  if (resMyAvailability.data.status === 'error' || resMyAvailability.data.data.message.includes('not')) {
    log.error(`My Flux unavailability detected from ${askingIP}`);
    // Asked Flux cannot reach me lets check if ip changed
    log.info('Getting publicIp from FluxBench');
    const benchIpResponse = await daemonService.getPublicIp();
    if (benchIpResponse.status === 'success') {
      const benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
      if (benchMyIP && benchMyIP !== myIP) {
        log.info('New public Ip detected, updating the FluxNode info in the network');
        myIP = benchMyIP;
        daemonService.createConfirmationTransaction();
        await serviceHelper.delay(4 * 60 * 1000); // lets wait 2 blocks time for the transaction to be mined
        return true;
      } if (benchMyIP && benchMyIP === myIP) {
        log.info('FluxBench reported the same Ip that was already in use');
      } else {
        log.error('FluxBench wasnt able to detect flux node public ip');
      }
    } else {
      dosMessage = 'Error getting publicIp from FluxBench';
      dosState += 15;
      log.error(dosMessage);
      return false;
    }
    dosState += 1.5;
    if (dosState > 10) {
      dosMessage = dosMessage || 'Flux is not available for outside communication';
      log.error(dosMessage);
    }
    return false;
  }
  dosState = 0;
  dosMessage = null;
  return true;
}

async function adjustExternalIP(ip) {
  try {
    const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
    // https://github.com/sindresorhus/ip-regex/blob/master/index.js#L8
    const v4 = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}';
    const v4exact = new RegExp(`^${v4}$`);
    if (!v4exact.test(ip)) {
      log.warn(`Gathered IP ${ip} is not a valid format`);
      return;
    }
    if (ip === userconfig.initial.ipaddress) {
      return;
    }
    log.info(`Adjusting External IP from ${userconfig.initial.ipaddress} to ${ip}`);
    const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${ip}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamZelId}',
    cruxid: '${userconfig.initial.cruxid || ''}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);
  } catch (error) {
    log.error(error);
  }
}

async function checkDeterministicNodesCollisions() {
  try {
    // get my external ip address
    // get node list with filter on this ip address
    // if it returns more than 1 object, shut down.
    // another precatuion might be comparing node list on multiple nodes. evaulate in the future
    const myIP = await getMyFluxIP();
    if (myIP) {
      const syncStatus = await daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        setTimeout(() => {
          checkDeterministicNodesCollisions();
        }, 120 * 1000);
        return;
      }
      const nodeList = await deterministicFluxList();
      const result = nodeList.filter((node) => node.ip === myIP);
      const nodeStatus = await daemonService.getZelNodeStatus();
      if (nodeStatus.status === 'success') { // different scenario is caught elsewhere
        const myCollateral = nodeStatus.data.collateral;
        const myNode = result.find((node) => node.collateral === myCollateral);
        if (result.length > 1) {
          log.warn('Multiple Flux Node instances detected');
          if (myNode) {
            const myBlockHeight = myNode.readded_confirmed_height || myNode.confirmed_height; // todo we may want to introduce new readded heights and readded confirmations
            const filterEarlierSame = result.filter((node) => (node.readded_confirmed_height || node.confirmed_height) <= myBlockHeight);
            // keep running only older collaterals
            if (filterEarlierSame.length >= 1) {
              log.error('Flux earlier collision detection');
              dosState = 100;
              dosMessage = 'Flux earlier collision detection';
              return;
            }
          }
          // prevent new activation
        } else if (result.length === 1) {
          if (!myNode) {
            log.error('Flux collision detection');
            dosState = 100;
            dosMessage = 'Flux collision detection';
            return;
          }
        }
      }
      const availabilityOk = await checkMyFluxAvailability();
      if (availabilityOk) {
        adjustExternalIP(myIP);
      }
    } else {
      dosState += 1;
      if (dosState > 10) {
        dosMessage = dosMessage || 'Flux IP detection failed';
        log.error(dosMessage);
      }
    }
    setTimeout(() => {
      checkDeterministicNodesCollisions();
    }, 60 * 1000);
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkDeterministicNodesCollisions();
    }, 120 * 1000);
  }
}

async function getDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  response = serviceHelper.createDataMessage(data);
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
    const errMessage = serviceHelper.createErrorMessage('No Port address specified.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const portResponseOK = await allowPort(port);
    if (portResponseOK.status === true) {
      response = serviceHelper.createSuccessMessage(portResponseOK.message, port, port);
    } else if (portResponseOK.status === false) {
      response = serviceHelper.createErrorMessage(portResponseOK.message, port, port);
    } else {
      response = serviceHelper.createErrorMessage(`Unknown error while opening port ${port}`);
    }
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function adjustFirewall() {
  try {
    const execA = 'sudo ufw status | grep Status';
    const execB = `sudo ufw allow ${config.server.apiport}`;
    const execC = `sudo ufw allow out ${config.server.apiport}`;
    const execD = `sudo ufw allow ${config.server.homeport}`;
    const execE = `sudo ufw allow out ${config.server.homeport}`;
    const cmdAsync = util.promisify(cmd.get);

    const cmdresA = await cmdAsync(execA);
    if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
      const cmdresB = await cmdAsync(execB);
      if (serviceHelper.ensureString(cmdresB).includes('updated') || serviceHelper.ensureString(cmdresB).includes('existing') || serviceHelper.ensureString(cmdresB).includes('added')) {
        log.info('Incoming Firewall adjusted for Flux port');
      } else {
        log.info('Failed to adjust Firewall for incoming Flux port');
      }
      const cmdresC = await cmdAsync(execC);
      if (serviceHelper.ensureString(cmdresC).includes('updated') || serviceHelper.ensureString(cmdresC).includes('existing') || serviceHelper.ensureString(cmdresC).includes('added')) {
        log.info('Outgoing Firewall adjusted for Flux port');
      } else {
        log.info('Failed to adjust Firewall for outgoing Flux port');
      }
      const cmdresD = await cmdAsync(execD);
      if (serviceHelper.ensureString(cmdresD).includes('updated') || serviceHelper.ensureString(cmdresD).includes('existing') || serviceHelper.ensureString(cmdresD).includes('added')) {
        log.info('Incoming Firewall adjusted for Home port');
      } else {
        log.info('Failed to adjust Firewall for incoming Home port');
      }
      const cmdresE = await cmdAsync(execE);
      if (serviceHelper.ensureString(cmdresE).includes('updated') || serviceHelper.ensureString(cmdresE).includes('existing') || serviceHelper.ensureString(cmdresE).includes('added')) {
        log.info('Outgoing Firewall adjusted for Home port');
      } else {
        log.info('Failed to adjust Firewall for outgoing Home port');
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
  if (outgoingPeers.length + incomingPeers.length < config.fluxapps.minOutgoing + config.fluxapps.minIncoming) {
    message = serviceHelper.createErrorMessage('Not enough connections established to Flux network');
  } else {
    message = serviceHelper.createSuccessMessage('Communication to Flux network is properly established');
  }
  res.json(message);
}

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
    return new Error('Invalid Flux App message for storing');
  }
  // to all outoing
  await broadcastMessageToOutgoing(message);
  await serviceHelper.delay(2345);
  // to all incoming. Delay broadcast in case message is processing
  await broadcastMessageToIncoming(message);
  return 0;
}

async function broadcastAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param hash string
  * @param ip string
  */
  log.info(message);
  // no verification of message before broadcasting. Broadcasting happens always after data have been verified and are stored in our db. It is up to receiving node to verify it and store and rebroadcast.
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.broadcastedAt !== 'number' && typeof message.name !== 'string' && typeof message.hash !== 'string' && typeof message.ip !== 'string') {
    return new Error('Invalid Flux App Running message for storing');
  }
  // to all outoing
  await broadcastMessageToOutgoing(message);
  await serviceHelper.delay(2345);
  // to all incoming. Delay broadcast in case message is processing
  await broadcastMessageToIncoming(message);
  return 0;
}

async function adjustGitRepository() {
  try {
    const nodedpath = path.join(__dirname, '../../../');
    const execGetRepo = `cd ${nodedpath} && git remote -v`;
    const execAdjustRepo = `cd ${nodedpath} && git remote set-url origin https://github.com/runonflux/flux`;
    const cmdAsync = util.promisify(cmd.get);
    const cmdres = await cmdAsync(execGetRepo);
    log.info(cmdres);
    if (cmdres.includes('zelcash/zelflux')) {
      await cmdAsync(execAdjustRepo);
      log.info('Flux repository adjusted');
      const cmdresB = await cmdAsync(execGetRepo);
      log.info(cmdresB);
    }
  } catch (err) {
    log.error(err);
    log.error(`Error adusting Flux repository: ${err.message}`, err.name, err.code);
  }
}

module.exports = {
  getFluxMessageSignature,
  verifyOriginalFluxBroadcast,
  verifyFluxBroadcast,
  handleIncomingConnection,
  fluxDiscovery,
  broadcastMessageToOutgoing,
  broadcastMessageToIncoming,
  broadcastMessageToOutgoingFromUser,
  broadcastMessageToOutgoingFromUserPost,
  broadcastMessageToIncomingFromUser,
  broadcastMessageToIncomingFromUserPost,
  broadcastMessageFromUser,
  broadcastMessageFromUserPost,
  serialiseAndSignFluxBroadcast,
  initiateAndHandleConnection,
  connectedPeers,
  addPeer,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  removePeer,
  removeIncomingPeer,
  connectedPeersInfo,
  getDOSState,
  allowPort,
  allowPortApi,
  denyPort,
  checkFluxAvailability,
  outgoingPeers,
  incomingPeers,
  isCommunicationEstablished,
  broadcastTemporaryAppMessage,
  broadcastAppRunningMessage,
  keepConnectionsAlive,
  adjustFirewall,
  checkDeterministicNodesCollisions,
  adjustGitRepository,
};
