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
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const daemonService = require('./daemonService');
const benchmarkService = require('./benchmarkService');
const userconfig = require('../../../config/userconfig');

const outgoingConnections = []; // websocket list
const outgoingPeers = []; // array of objects containing ip, latency, lastPingTime

const incomingConnections = []; // websocket list
const incomingPeers = []; // array of objects containing ip

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

const minimumFluxBenchAllowedVersion = 300;
const minimumFluxOSAllowedVersion = 3100;
let storedFluxBenchAllowed = null;

// my external Flux IP from benchmark
let myFluxIP = null;

let response = messageHelper.createErrorMessage();
// default cache
const LRUoptions = {
  max: 2000, // currently 750 nodes lets put a value expecting increase in the numbers.
  maxAge: 1000 * 150, // 150 seconds slightly over average blocktime. Allowing 1 block expired too.
};

let numberOfFluxNodes = 0;

const axiosConfig = {
  timeout: 5000,
};

const myCache = new LRU(LRUoptions);
const myMessageCache = new LRU(250);
const blockedPubKeysCache = new LRU(LRUoptions);

// rate limiting
// https://kendru.github.io/javascript/2018/12/28/rate-limiting-in-javascript-with-a-token-bucket/
const buckets = new Map();
class TokenBucket {
  constructor(capacity, fillPerSecond) {
    this.capacity = capacity;
    this.fillPerSecond = fillPerSecond;

    this.lastFilled = Math.floor(Date.now() / 1000);
    this.tokens = capacity;
  }

  take() {
    // Calculate how many tokens (if any) should have been added since the last request
    this.refill();

    if (this.tokens > 0) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  refill() {
    const now = Math.floor(Date.now() / 1000);
    const rate = (now - this.lastFilled) / this.fillPerSecond;

    this.tokens = Math.min(this.capacity, this.tokens + Math.floor(rate * this.capacity));
    this.lastFilled = now;
  }
}

let addingNodesToCache = false;

/**
 * To perform a basic check of current FluxOS version.
 * @param {string} ip IP address.
 * @param {string} port Port. Defaults to config.server.apiport.
 * @returns {boolean} False unless FluxOS version meets or exceeds the minimum allowed version.
 */
async function isFluxAvailable(ip, port = config.server.apiport) {
  try {
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${port}/flux/version`, axiosConfig);
    if (fluxResponse.data.status === 'success') {
      let fluxVersion = fluxResponse.data.data;
      fluxVersion = fluxVersion.replace(/\./g, '');
      if (fluxVersion >= minimumFluxOSAllowedVersion) {
        return true;
      }
      return false;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * To check Flux availability for specific IP address/port.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function checkFluxAvailability(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  let { port } = req.params;
  port = port || req.query.port;
  if (ip === undefined || ip === null) {
    const errMessage = messageHelper.createErrorMessage('No ip specified.');
    return res.json(errMessage);
  }

  const available = await isFluxAvailable(ip, port);

  if (available === true) {
    const message = messageHelper.createSuccessMessage('Asking Flux is available');
    response = message;
  } else {
    const message = messageHelper.createErrorMessage('Asking Flux is not available');
    response = message;
  }
  return res.json(response);
}

/**
 * To get Flux IP adress and port.
 * @returns {string} IP address and port.
 */
async function getMyFluxIPandPort() {
  const benchmarkResponse = await daemonService.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  }
  myFluxIP = myIP;
  return myIP;
}

/**
 * To get deterministc Flux list from cache.
 * @param {string} filter Filter. Can only be a publicKey.
 * @returns {(*|*[])} Value of any type or an empty array of any type.
 */
async function deterministicFluxList(filter) {
  try {
    while (addingNodesToCache) {
      // prevent several instances filling the cache at the same time.
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(100);
    }
    let fluxList;
    if (filter) {
      fluxList = myCache.get(`fluxList${serviceHelper.ensureString(filter)}`);
    } else {
      fluxList = myCache.get('fluxList');
    }
    if (!fluxList) {
      let generalFluxList = myCache.get('fluxList');
      addingNodesToCache = true;
      if (!generalFluxList) {
        const request = {
          params: {},
          query: {},
        };
        const daemonFluxNodesList = await daemonService.viewDeterministicZelNodeList(request);
        if (daemonFluxNodesList.status === 'success') {
          generalFluxList = daemonFluxNodesList.data || [];
          myCache.set('fluxList', generalFluxList);
          if (filter) {
            const filterFluxList = generalFluxList.filter((node) => node.pubkey === filter);
            myCache.set(`fluxList${serviceHelper.ensureString(filter)}`, filterFluxList);
          }
        }
      } else { // surely in filtered branch too
        const filterFluxList = generalFluxList.filter((node) => node.pubkey === filter);
        myCache.set(`fluxList${serviceHelper.ensureString(filter)}`, filterFluxList);
      }
      addingNodesToCache = false;
      if (filter) {
        fluxList = myCache.get(`fluxList${serviceHelper.ensureString(filter)}`);
      } else {
        fluxList = myCache.get('fluxList');
      }
    }
    return fluxList || [];
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get FluxNode private key.
 * @param {string} privatekey Private Key.
 * @returns {string} Private key, if already input as parameter or otherwise from the daemon config.
 */
async function getFluxNodePrivateKey(privatekey) {
  const privKey = privatekey || daemonService.getConfigValue('zelnodeprivkey');
  return privKey;
}

/**
 * To get Flux message signature.
 * @param {object} message Message.
 * @param {string} privatekey Private key.
 * @returns {string} Signature.
 */
async function getFluxMessageSignature(message, privatekey) {
  const privKey = await getFluxNodePrivateKey(privatekey);
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

/**
 * To get FluxNode public key.
 * @param {string} privatekey Private key.
 * @returns {string} Public key.
 */
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

/**
 * To verify Flux broadcast.
 * @param {object} data Data containing public key, timestamp, signature and version. 
 * @param {object[]} obtainedFluxNodesList List of FluxNodes.
 * @param {number} currentTimeStamp Current timestamp. 
 * @returns {boolean} False unless message is successfully verified.
 */
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
    const zl = await deterministicFluxList(pubKey); // this itself is sufficient.
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

/**
 * To verify original Flux broadcast. Extends verifyFluxBroadcast by not allowing request older than 5 mins.
 * @param {object} data Data.
 * @param {object[]} obtainedFluxNodeList List of FluxNodes.
 * @param {number} currentTimeStamp Current timestamp. 
 * @returns {boolean} False unless message is successfully verified.
 */
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

/**
 * To verify timestamp in Flux broadcast.
 * @param {object} data Data.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {boolean} False unless current timestamp is within 5 minutes of the data object's timestamp.
 */
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

/**
 * To send to all peers.
 * @param {object} data Data.
 * @param {object[]} wsList Web socket list.
 */
async function sendToAllPeers(data, wsList) {
  try {
    const removals = [];
    const ipremovals = [];
    // wsList is always a sublist of outgoingConnections
    const outConList = wsList || outgoingConnections;
    // eslint-disable-next-line no-restricted-syntax
    for (const client of outConList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(25);
        if (client.readyState === WebSocket.OPEN) {
          if (!data) {
            const pingTime = new Date().getTime();
            client.ping('flux'); // do ping with flux str instead
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
          // eslint-disable-next-line no-use-before-define
          closeConnection(ip);
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
  } catch (error) {
    log.error(error);
  }
}

/**
 * To send to all incoming connections.
 * @param {object} data Data.
 * @param {object[]} wsList Web socket list.
 */
async function sendToAllIncomingConnections(data, wsList) {
  try {
    const removals = [];
    const ipremovals = [];
    // wsList is always a sublist of incomingConnections
    const incConList = wsList || incomingConnections;
    // eslint-disable-next-line no-restricted-syntax
    for (const client of incConList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(25);
        if (client.readyState === WebSocket.OPEN) {
          if (!data) {
            client.ping('flux'); // do ping with flux str instead
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
          const foundPeer = incomingPeers.find((peer) => peer.ip === ip);
          ipremovals.push(foundPeer);
          // eslint-disable-next-line no-use-before-define
          closeIncomingConnection(ip, [], client); // this is wrong
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
  } catch (error) {
    log.error(error);
  }
}

/**
 * To serialise and sign a Flux broadcast.
 * @param {object} dataToBroadcast Data to broadcast. Contains version, timestamp, pubKey, signature and data.
 * @param {string} privatekey Private key.
 * @returns {string} Data string (serialised data object).
 */
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
      sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(100);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIP);
      sendToAllIncomingConnections(messageString, wsList);
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
    if (rebroadcastToPeers === true) {
      const messageString = serviceHelper.ensureString(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIP);
      sendToAllPeers(messageString, wsListOut);
      await serviceHelper.delay(2345);
      const wsList = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIP);
      sendToAllIncomingConnections(messageString, wsList);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To send a message via web socket.
 * @param {object} message Message.
 * @param {object} ws Web socket.
 */
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

/**
 * To respond with app message.
 * @param {object} message Message.
 * @param {object} ws Web socket.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
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

/**
 * To check rate limit.
 * @param {string} ip IP address.
 * @param {number} perSecond Defaults to value of 10.
 * @param {number} maxBurst Defaults to value of 15.
 * @returns {boolean} True if a token is taken from the IP's token bucket. Otherwise false.
 */
function checkRateLimit(ip, perSecond = 10, maxBurst = 15) {
  if (!buckets.has(ip)) {
    buckets.set(ip, new TokenBucket(maxBurst, perSecond));
  }

  const bucketForIP = buckets.get(ip);

  if (bucketForIP.take()) {
    return true;
  }
  return false;
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
    const rateOK = await checkRateLimit(peer.ip);
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
        const zl = await deterministicFluxList(pubKey); // this itself is sufficient.
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

/**
 * To broadcast message to outgoing peers. Data is serialised and sent to outgoing peers.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToOutgoing(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToAllPeers(serialisedData);
}

/**
 * To broadcast message to incoming peers. Data is serialised and sent to incoming peers.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToAllIncomingConnections(serialisedData);
}

/**
 * To broadcast message from user to outgoing peers. Data is serialised and sent to outgoing peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
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

/**
 * To broadcast message from user to outgoing peers after data is processed. Processed data is serialised and sent to outgoing peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
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

/**
 * To broadcast message from user to incoming peers. Data is serialised and sent to incoming peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
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

/**
 * To broadcast message from user to incoming peers after data is processed. Processed data is serialised and sent to incoming peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
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

/**
 * To broadcast message from user. Handles messages to outgoing and incoming peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
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

/**
 * To broadcast message from user after data is processed. Handles messages to outgoing and incoming peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
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

/**
 * To get a random connection.
 * @returns {string} IP:Port or just IP if default.
 */
async function getRandomConnection() {
  const nodeList = await deterministicFluxList();
  const zlLength = nodeList.length;
  if (zlLength === 0) {
    return null;
  }
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const ip = nodeList[randomNode].ip || nodeList[randomNode].ipaddress;
  const apiPort = userconfig.initial.apiport || config.server.apiport;

  if (ip === userconfig.initial.ipaddress || ip === myFluxIP || ip === `${userconfig.initial.ipaddress}:${apiPort}`) {
    return null;
  }
  return ip;
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
    const rateOK = await checkRateLimit(ip);
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
        console.error(e);
      }
      return;
    }
    const messageOK = await verifyOriginalFluxBroadcast(evt.data, undefined, currentTimeStamp);
    if (messageOK === true) {
      if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate' || msgObj.data.type === 'fluxappregister' || msgObj.data.type === 'fluxappupdate') {
        handleAppMessages(msgObj, ip);
      } else if (msgObj.data.type === 'zelapprequest' || msgObj.data.type === 'fluxapprequest') {
        respondWithAppMessage(msgObj, websocket);
      } else if (msgObj.data.type === 'zelapprunning' || msgObj.data.type === 'fluxapprunning') {
        handleAppRunningMessage(msgObj, ip);
      }
    } else {
      // we dont like this peer as it sent wrong message (wrong, or message belonging to node no longer on network). Lets close the connection
      // and add him to blocklist
      try {
        // check if message comes from IP belonging to the public Key
        const zl = await deterministicFluxList(pubKey); // this itself is sufficient.
        const possibleNodes = zl.filter((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
        const nodeFound = possibleNodes.find((n) => n.ip === connection);
        if (!nodeFound) {
          log.warn(`Message received from outgoing peer ${connection} but is not an originating node of ${pubKey}.`);
          websocket.close(1000, 'invalid message, disconnect'); // close as of policy violation
        } else {
          blockedPubKeysCache.set(pubKey, pubKey); // blocks ALL the nodes corresponding to the pubKey
          log.warn(`closing outgoing connection, adding peers ${pubKey} to the blockedList. Originated from ${connection}.`);
          websocket.close(1000, 'invalid message, blocked'); // close as of policy violation?
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  websocket.onerror = (evt) => {
    console.log(evt.code);
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
 * To discover and connect to other randomly selected FluxNodes. Maintains connections with 1-2% of nodes on the Flux network. Ensures that FluxNode connections are not duplicated.
 */
async function fluxDiscovery() {
  try {
    const syncStatus = daemonService.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced. Flux discovery is awaiting.');
    }

    let nodeList = [];

    const myIP = await getMyFluxIPandPort();
    if (myIP) {
      nodeList = await deterministicFluxList();
      const fluxNode = nodeList.find((node) => node.ip === myIP);
      if (!fluxNode) {
        throw new Error('Node not confirmed. Flux discovery is awaiting.');
      }
    } else {
      throw new Error('Flux IP not detected. Flux discovery is awaiting.');
    }
    const minPeers = 10;
    const maxPeers = 20;
    numberOfFluxNodes = nodeList.length;
    const currentIpsConnTried = [];
    const requiredNumberOfConnections = numberOfFluxNodes / 100 < 40 ? numberOfFluxNodes / 100 : 40; // 1%
    const maxNumberOfConnections = numberOfFluxNodes / 75 < 50 ? numberOfFluxNodes / 75 : 50; // 1.5%
    const minCon = Math.max(minPeers, requiredNumberOfConnections); // awlays maintain at least 10 or 1% of nodes whatever is higher
    const maxCon = Math.max(maxPeers, maxNumberOfConnections); // have a maximum of 20 or 2% of nodes whatever is higher
    log.info(`Current number of outgoing connections:${outgoingConnections.length}`);
    log.info(`Current number of incoming connections:${incomingConnections.length}`);
    // coonect to peers as min connections not yet established
    let index = 0;
    while (outgoingConnections.length < minCon && index < 100) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      const connection = await getRandomConnection();
      if (connection) {
        const ip = connection.split(':')[0];
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ip);
        const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
        const clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress.replace('::ffff:', '') === ip);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Adding Flux peer: ${connection}`);
          currentIpsConnTried.push(ip);
          initiateAndHandleConnection(connection);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }
    if (outgoingConnections.length < maxCon) {
      const connection = await getRandomConnection();
      if (connection) {
        const ip = connection.split(':')[0];
        // additional precaution
        const sameConnectedIp = currentIpsConnTried.find((connectedIP) => connectedIP === ip);
        const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
        const clientIncomingExists = incomingConnections.find((client) => client._socket.remoteAddress.replace('::ffff:', '') === ip);
        if (!sameConnectedIp && !clientExists && !clientIncomingExists) {
          log.info(`Adding Flux peer: ${connection}`);
          initiateAndHandleConnection(connection);
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
  res.json(response);
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
  res.json(response);
}

/**
 * To keep connections alive by pinging all outgoing and incoming peers.
 */
function keepConnectionsAlive() {
  setInterval(() => {
    sendToAllPeers(); // perform ping
    sendToAllIncomingConnections(); // perform ping
  }, 30 * 1000);
}

/**
 * To add a peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addPeer(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  if (ip === undefined || ip === null) {
    const errMessage = messageHelper.createErrorMessage('No IP address specified.');
    return res.json(errMessage);
  }
  const justIP = ip.split(':')[0];
  const wsObj = await outgoingConnections.find((client) => client._socket.remoteAddress === justIP);
  if (wsObj) {
    const errMessage = messageHelper.createErrorMessage(`Already connected to ${justIP}`);
    return res.json(errMessage);
  }
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    initiateAndHandleConnection(ip);
    const message = messageHelper.createSuccessMessage(`Outgoing connection to ${ip} initiated`);
    response = message;
    console.log(response);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  console.log(response);
  return res.json(response);
}

/**
 * To get IP addresses for incoming connections.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} expressWS Express web socket.
 */
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

/**
 * To get info for incoming connections.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function getIncomingConnectionsInfo(req, res) {
  const connections = incomingPeers;
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

/**
 * To close an outgoing connection.
 * @param {string} ip IP address.
 * @returns {object} Message.
 */
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

/**
 * To close an incoming connection.
 * @param {string} ip IP address.
 * @param {object} expressWS Express web socket.
 * @param {object} clientToClose Web socket for client to close.
 * @returns {object} Message.
 */
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

/**
 * To remove an outgoing peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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

/**
 * To remove an incoming peer by specifying the IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} expressWS Express web socket.
 * @returns {object} Message.
 */
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

/**
 * To check if Flux benchmark version is allowed.
 * @returns {boolean} True if version is verified as allowed. Otherwise false.
 */
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

/**
 * To check user's FluxNode availability.
 * @param {number} retryNumber Number of retries.
 * @returns {boolean} True if all checks passed.
 */
async function checkMyFluxAvailability(retryNumber = 0) {
  const fluxBenchVersionAllowed = await checkFluxbenchVersionAllowed();
  if (!fluxBenchVersionAllowed) {
    return false;
  }
  let askingIP = await getRandomConnection();
  if (typeof askingIP !== 'string' || typeof myFluxIP !== 'string' || myFluxIP === askingIP) {
    return false;
  }
  let askingIpPort = config.server.apiport;
  if (askingIP.includes(':')) { // has port specification
    // it has port specification
    const splittedIP = askingIP.split(':');
    askingIP = splittedIP[0];
    askingIpPort = splittedIP[1];
  }
  let myIP = myFluxIP;
  if (myIP.includes(':')) { // has port specification
    myIP = myIP.split(':')[0];
  }
  let availabilityError = null;
  const axiosConfigAux = {
    timeout: 7000,
  };
  const apiPort = userconfig.initial.apiport || config.server.apiport;
  const resMyAvailability = await serviceHelper.axiosGet(`http://${askingIP}:${askingIpPort}/flux/checkfluxavailability?ip=${myIP}&port=${apiPort}`, axiosConfigAux).catch((error) => {
    log.error(`${askingIP} is not reachable`);
    log.error(error);
    availabilityError = true;
  });
  if (!resMyAvailability || availabilityError) {
    dosState += 2;
    if (dosState > 10) {
      dosMessage = dosMessage || 'Flux communication is limited';
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  if (resMyAvailability.data.status === 'error' || resMyAvailability.data.data.message.includes('not')) {
    log.error(`My Flux unavailability detected from ${askingIP}`);
    // Asked Flux cannot reach me lets check if ip changed
    log.info('Getting publicIp from FluxBench');
    const benchIpResponse = await benchmarkService.getPublicIp();
    if (benchIpResponse.status === 'success') {
      let benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
      if (benchMyIP && userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) {
        // add port
        benchMyIP += userconfig.initial.apiport;
      }
      if (benchMyIP && benchMyIP !== myIP) {
        log.info('New public Ip detected, updating the FluxNode info in the network');
        myIP = benchMyIP;
        daemonService.createConfirmationTransaction();
        await serviceHelper.delay(4 * 60 * 1000); // lets wait 2 blocks time for the transaction to be mined
        return true;
      } if (benchMyIP && benchMyIP === myIP) {
        log.info('FluxBench reported the same Ip that was already in use');
      } else {
        dosMessage = 'Error getting publicIp from FluxBench';
        dosState += 15;
        log.error('FluxBench wasnt able to detect flux node public ip');
      }
    } else {
      dosMessage = 'Error getting publicIp from FluxBench';
      dosState += 15;
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    if (dosState > 10) {
      dosMessage = dosMessage || 'Flux is not available for outside communication';
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  dosState = 0;
  dosMessage = null;
  return true;
}

/**
 * To adjust an external IP.
 * @param {string} ip IP address.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
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
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
    apiport: ${Number(userconfig.initial.apiport || config.apiport)},
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);
  } catch (error) {
    log.error(error);
  }
}

/**
 * To check deterministic node collisions (i.e. if multiple FluxNode instances detected).
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkDeterministicNodesCollisions() {
  try {
    // get my external ip address
    // get node list with filter on this ip address
    // if it returns more than 1 object, shut down.
    // another precatuion might be comparing node list on multiple nodes. evaulate in the future
    const myIP = await getMyFluxIPandPort();
    if (myIP) {
      const syncStatus = daemonService.isDaemonSynced();
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
        adjustExternalIP(myIP.split(':')[0]);
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

/**
 * To get DOS state.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  response = messageHelper.createDataMessage(data);
  return res ? res.json(response) : response;
}

/**
 * To allow a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
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

/**
 * To deny a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
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

/**
 * To allow a port via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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

/**
 * To check if a firewall is active.
 * @returns {boolean} True if a firewall is active. Otherwise false.
 */
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
    // command ufw not found is the most likely reason
    log.error(error);
    return false;
  }
}

/**
 * To adjust a firewall to allow ports for Flux.
 */
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

/**
 * To check if sufficient communication is established. Minimum number of outgoing and incoming peers must be met. 
 * @param {object} req Request.
 * @param {object} res Response.
 */
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
/**
 * To broadcast temporary app message.
 * @param {object} message Message.
 */
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
  isFirewallActive,
  allowPort,
  allowPortApi,
  denyPort,
  checkFluxAvailability,
  outgoingPeers,
  incomingPeers,
  isCommunicationEstablished,
  broadcastTemporaryAppMessage,
  keepConnectionsAlive,
  adjustFirewall,
  checkDeterministicNodesCollisions,
};
