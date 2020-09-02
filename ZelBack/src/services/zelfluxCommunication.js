/* eslint-disable no-underscore-dangle */
const WebSocket = require('ws');
const bitcoinjs = require('bitcoinjs-lib');
const config = require('config');
const cmd = require('node-cmd');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const userconfig = require('../../../config/userconfig');

const outgoingConnections = []; // websocket list
const outgoingPeers = []; // array of objects containing ip and rtt latency

const incomingConnections = []; // websocket list
const incomingPeers = []; // array of objects containing ip and rtt latency

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

// my external Flux IP from zelbench
let myFluxIP = null;

let response = serviceHelper.createErrorMessage();

// basic check for a version of other flux.
async function isFluxAvailable(ip) {
  const axiosConfig = {
    timeout: 8888,
  };
  try {
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${config.server.apiport}/zelflux/version`, axiosConfig);
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

async function myZelNodeIP() {
  const benchmarkResponse = await zelcashService.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  } else {
    dosMessage = benchmarkResponse.data;
    dosState += 10;
  }
  return myIP;
}

async function deterministicZelNodeList(filter) {
  let zelnodeList = null;
  const request = {
    params: {
      filter,
    },
    query: {},
  };
  zelnodeList = await zelcashService.viewDeterministicZelNodeList(request);
  return zelnodeList.status === 'success' ? (zelnodeList.data || []) : [];
}

async function getZelNodePrivateKey(privatekey) {
  const privKey = privatekey || zelcashService.getConfigValue('zelnodeprivkey');
  return privKey;
}

async function getFluxMessageSignature(message, privatekey) {
  const privKey = await getZelNodePrivateKey(privatekey);
  const signature = await serviceHelper.signMessage(message, privKey);
  return signature;
}

async function getZelNodePublicKey(privatekey) {
  try {
    const privKey = await getZelNodePrivateKey(privatekey);
    const keyPair = bitcoinjs.ECPair.fromWIF(privKey);
    const pubKey = keyPair.publicKey.toString('hex');
    return pubKey;
  } catch (error) {
    return error;
  }
}

// return boolean
async function verifyFluxBroadcast(data, obtainedZelNodeList, currentTimeStamp) {
  const dataObj = serviceHelper.ensureObject(data);
  const { pubKey } = dataObj;
  const { timestamp } = dataObj; // ms
  const { signature } = dataObj;
  const { version } = dataObj;
  // onle version 1 is active
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

  let zelnode = null;
  if (obtainedZelNodeList) { // for test purposes. TODO Can this be misuesed?
    zelnode = await obtainedZelNodeList.find((key) => key.pubkey === pubKey);
    if (!zelnode) {
      return false;
    }
  }
  if (!zelnode) {
    const zl = await deterministicZelNodeList(pubKey); // this itself is sufficient.
    if (zl.length === 1) {
      if (zl[0].pubkey === pubKey) {
        [zelnode] = zl;
      }
    }
  }
  if (!zelnode) { // if filtering fails, fetch all the list and run find method
    // eslint-disable-next-line no-param-reassign
    obtainedZelNodeList = await deterministicZelNodeList(); // support for daemons that do not have filtering via public key
    zelnode = await obtainedZelNodeList.find((key) => key.pubkey === pubKey);
  }
  if (!zelnode) {
    return false;
  }
  const messageToVerify = version + message + timestamp;
  const verified = await serviceHelper.verifyMessage(messageToVerify, pubKey, signature);
  if (verified === true) {
    return true;
  }
  return false;
}

// extends verifyFluxBroadcast by not allowing request older than 5 secs.
async function verifyOriginalFluxBroadcast(data, obtainedZelNodeList, currentTimeStamp) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp > (timestamp + 300000)) { // bigger than 5 mins
    return false;
  }
  const verified = await verifyFluxBroadcast(data, obtainedZelNodeList, currentTimeStamp);
  return verified;
}

async function verifyTimestampInFluxBroadcast(data, currentTimeStamp) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp + 300000)) { // bigger than 5 secs
    return true;
  }
  return false;
}

async function sendToAllPeers(data, wsList) {
  try {
    let removals = [];
    let ipremovals = [];
    // console.log(data);
    // wsList is always a sublist of outgoingConnections
    const outConList = wsList || outgoingConnections;
    // eslint-disable-next-line no-restricted-syntax
    for (const client of outConList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(100);
        client.send(data);
      } catch (e) {
        log.error(e);
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
    // console.log(data);
    // wsList is always a sublist of incomingConnections
    const incConList = wsList || incomingConnections;
    // eslint-disable-next-line no-restricted-syntax
    for (const client of incConList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(100);
        client.send(data);
      } catch (e) {
        log.error(e);
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

async function serialiseAndSignZelFluxBroadcast(dataToBroadcast, privatekey) {
  const version = 1;
  const timestamp = Date.now();
  const pubKey = await getZelNodePublicKey(privatekey);
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

async function handleZelAppMessages(message, fromIP) {
  try {
    // check if we have it in database and if not add
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    // eslint-disable-next-line global-require
    const zelappsService = require('./zelappsService');
    const rebroadcastToPeers = await zelappsService.storeZelAppTemporaryMessage(message.data, true);
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

async function handleZelAppRunningMessage(message, fromIP) {
  try {
    // check if we have it exactly like that in database and if not, update
    // if not in database, rebroadcast to all connections
    // do furtherVerification of message
    // eslint-disable-next-line global-require
    const zelappsService = require('./zelappsService');
    const rebroadcastToPeers = await zelappsService.storeZelAppRunningMessage(message.data, true);
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
    const pongResponse = await serialiseAndSignZelFluxBroadcast(message);
    ws.send(pongResponse);
  } catch (error) {
    log.error(error);
  }
}

async function respondWithAppMessage(message, ws) {
  // check if we have it database of permanent zelappMessages
  // eslint-disable-next-line global-require
  const zelappsService = require('./zelappsService');
  const permanentMessage = await zelappsService.checkZelAppMessageExistence(message.data.hash);
  if (permanentMessage) {
    // message exists in permanent storage. Create a message and broadcast it to the fromIP peer
    // const permanentZelAppMessage = {
    //   type: messageType,
    //   version: typeVersion,
    //   zelAppSpecifications: zelAppSpecFormatted,
    //   hash: messageHASH,
    //   timestamp,
    //   signature,
    //   txid,
    //   height,
    //   valueSat,
    // };
    const temporaryZelAppMessage = { // specification of temp message
      type: permanentMessage.type,
      version: permanentMessage.version,
      zelAppSpecifications: permanentMessage.zelAppSpecifications,
      hash: permanentMessage.hash,
      timestamp: permanentMessage.timestamp,
      signature: permanentMessage.signature,
    };
    sendMessageToWS(temporaryZelAppMessage, ws);
  } else {
    const existingTemporaryMessage = await zelappsService.checkZelAppTemporaryMessageExistence(message.data.hash);
    if (existingTemporaryMessage) {
      // a temporary zelappmessage looks like this:
      // const newMessage = {
      //   zelAppSpecifications: message.zelAppSpecifications,
      //   type: message.type,
      //   version: message.version,
      //   hash: message.hash,
      //   timestamp: message.timestamp,
      //   signature: message.signature,
      //   createdAt: new Date(message.timestamp),
      //   expireAt: new Date(validTill),
      // };
      const temporaryZelAppMessage = { // specification of temp message
        type: existingTemporaryMessage.type,
        version: existingTemporaryMessage.version,
        zelAppSpecifications: existingTemporaryMessage.zelAppSpecifications,
        hash: existingTemporaryMessage.hash,
        timestamp: existingTemporaryMessage.timestamp,
        signature: existingTemporaryMessage.signature,
      };
      sendMessageToWS(temporaryZelAppMessage, ws);
    }
    // else do nothing. We do not have this message. And this Flux would be requesting it from other peers soon too.
  }
}

// eslint-disable-next-line no-unused-vars
function handleIncomingConnection(ws, req, expressWS) {
  // now we are in connections state. push the websocket to our incomingconnections
  incomingConnections.push(ws);
  const peer = {
    ip: ws._socket.remoteAddress,
    rtt: null,
  };
  incomingPeers.push(peer);
  // verify data integrity, if not signed, close connection
  ws.on('message', async (msg) => {
    const currentTimeStamp = Date.now(); // ms
    console.log(msg);
    const messageOK = await verifyFluxBroadcast(msg, undefined, currentTimeStamp);
    const timestampOK = await verifyTimestampInFluxBroadcast(msg, currentTimeStamp);
    if (messageOK === true && timestampOK === true) {
      try {
        const msgObj = serviceHelper.ensureObject(msg);
        if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate') {
          handleZelAppMessages(msgObj, peer.ip);
        } else if (msgObj.data.type === 'zelapprequest') {
          respondWithAppMessage(msgObj, ws);
        } else if (msgObj.data.type === 'zelapprunning') {
          handleZelAppRunningMessage(msgObj, ws);
        } else if (msgObj.data.type === 'HeartBeat' && msgObj.data.message === 'ping') { // we know that data exists
          const newMessage = msgObj.data;
          newMessage.message = 'pong';
          const pongResponse = await serialiseAndSignZelFluxBroadcast(newMessage);
          ws.send(pongResponse);
        } else if (msgObj.data.type === 'HeartBeat' && msgObj.data.message === 'pong') { // we know that data exists. This is measuring rtt from incoming conn
          const newerTimeStamp = Date.now(); // ms, get a bit newer time that has passed verification of broadcast
          const rtt = newerTimeStamp - msgObj.data.timestamp;
          const ip = ws._socket.remoteAddress;
          const foundPeer = incomingPeers.find((mypeer) => mypeer.ip === ip);
          if (foundPeer) {
            const peerIndex = incomingPeers.indexOf(foundPeer);
            if (peerIndex > -1) {
              incomingPeers[peerIndex].rtt = rtt;
            }
          }
        } else {
          ws.send(`Flux ${userconfig.initial.ipaddress} says message received!`);
        }
      } catch (e) {
        log.error(e);
      }
      // try rebroadcasting to all outgoing peers
      // try {
      //   sendToAllPeers(msg);
      // } catch (e) {
      //   log.error(e);
      // }
    } else if (messageOK === true) {
      try {
        ws.send(`Flux ${userconfig.initial.ipaddress} says message received but your message is outdated!`);
      } catch (e) {
        log.error(e);
      }
    } else {
      // we dont like this peer as it sent wrong message. Lets close the connection
      try {
        ws.close(1008); // close as of policy violation?
      } catch (e) {
        log.error(e);
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
  const serialisedData = await serialiseAndSignZelFluxBroadcast(dataToBroadcast);
  sendToAllPeers(serialisedData);
}

async function broadcastMessageToIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignZelFluxBroadcast(dataToBroadcast);
  sendToAllIncomingConnections(serialisedData);
}

async function broadcastMessageToOutgoingFromUser(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (data === undefined || data === null) {
    const errMessage = serviceHelper.createErrorMessage('No message to broadcast attached.');
    return res.json(errMessage);
  }
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

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
  console.log(req.headers);
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
      const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);
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
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

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
  console.log(req.headers);
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
      const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);
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
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

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
  console.log(req.headers);
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
      const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);
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
  const zelnodeList = await deterministicZelNodeList();
  const zlLength = zelnodeList.length;
  if (zlLength === 0) {
    return null;
  }
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const ip = zelnodeList[randomNode].ip || zelnodeList[randomNode].ipaddress;

  // const zelnodeList = ['157.230.249.150', '94.177.240.7', '89.40.115.8', '94.177.241.10', '54.37.234.130', '194.182.83.182'];
  // const zlLength = zelnodeList.length;
  // const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  // const ip = zelnodeList[randomNode];

  // TODO checks for ipv4, ipv6, tor
  if (ip === userconfig.initial.ipaddress || ip === myFluxIP) {
    return null;
  }

  return ip;
}

async function initiateAndHandleConnection(ip) {
  const wsuri = `ws://${ip}:${config.server.apiport}/ws/zelflux/`;
  const websocket = new WebSocket(wsuri);

  websocket.on('open', () => {
    outgoingConnections.push(websocket);
    const peer = {
      ip: websocket._socket.remoteAddress,
      rtt: null,
    };
    outgoingPeers.push(peer);
    broadcastMessageToOutgoing('Hello Flux');
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
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
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
  };

  websocket.onmessage = async (evt) => { // TODO message handling outgoing connections function
    // incoming messages from outgoing connections
    console.log(evt.data);
    const currentTimeStamp = Date.now(); // ms
    const messageOK = await verifyOriginalFluxBroadcast(evt.data, undefined, currentTimeStamp);
    if (messageOK === true) {
      const { url } = websocket;
      let conIP = url.split('/')[2];
      conIP = conIP.split(`:${config.server.apiport}`).join('');
      const msgObj = serviceHelper.ensureObject(evt.data);
      if (msgObj.data.type === 'zelappregister' || msgObj.data.type === 'zelappupdate') {
        handleZelAppMessages(msgObj, conIP);
      } else if (msgObj.data.type === 'zelapprequest') {
        respondWithAppMessage(msgObj, websocket);
      } else if (msgObj.data.type === 'zelapprunning') {
        handleZelAppRunningMessage(msgObj, websocket);
      } else if (msgObj.data.type === 'HeartBeat' && msgObj.data.message === 'pong') {
        const newerTimeStamp = Date.now(); // ms, get a bit newer time that has passed verification of broadcast
        const rtt = newerTimeStamp - msgObj.data.timestamp;
        const foundPeer = outgoingPeers.find((peer) => peer.ip === conIP);
        if (foundPeer) {
          const peerIndex = outgoingPeers.indexOf(foundPeer);
          if (peerIndex > -1) {
            outgoingPeers[peerIndex].rtt = rtt;
          }
        }
      } else if (msgObj.data.type === 'HeartBeat' && msgObj.data.message === 'ping') {
        const newMessage = msgObj.data;
        newMessage.message = 'pong';
        const pongResponse = await serialiseAndSignZelFluxBroadcast(newMessage);
        try {
          websocket.send(pongResponse);
        } catch (error) {
          console.log(error.code);
        }
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
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
  };
}

async function fluxDisovery() {
  const minPeers = 10;
  const maxPeers = 20;
  const zl = await deterministicZelNodeList();
  const numberOfZelNodes = zl.length;
  const requiredNumberOfConnections = numberOfZelNodes / 100; // 1%
  const maxNumberOfConnections = numberOfZelNodes / 50; // 2%
  const minCon = Math.max(minPeers, requiredNumberOfConnections); // awlays maintain at least 10 or 1% of nodes whatever is higher
  const maxCon = Math.max(maxPeers, maxNumberOfConnections); // have a maximum of 20 or 2% of nodes whatever is higher
  // coonect a peer as maximum connections not yet established
  if (outgoingConnections.length < maxCon) {
    let ip = await getRandomConnection();
    const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
    if (clientExists) {
      ip = null;
    }
    if (ip) {
      log.info(`Adding Flux peer: ${ip}`);
      initiateAndHandleConnection(ip);
    }
  }
  // fast connect another peer as we do not have even enough connections to satisfy min or wait 1 min.
  setTimeout(() => {
    fluxDisovery();
  }, outgoingConnections.length < minCon ? 1000 : 60 * 1000);
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
    const timestamp = Date.now();
    const type = 'HeartBeat';
    const message = 'ping';
    const data = {
      timestamp,
      type,
      message,
    };
    broadcastMessageToOutgoing(data);
  }, 30000);
}

function keepIncomingConnectionsAlive() {
  setInterval(() => {
    const timestamp = Date.now();
    const type = 'HeartBeat';
    const message = 'ping';
    const data = {
      timestamp,
      type,
      message,
    };
    broadcastMessageToIncoming(data);
  }, 30000);
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
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

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
      wsObj.close(1000);
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
      wsObj.close(1000);
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
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

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
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

  if (authorized === true) {
    const closeResponse = await closeIncomingConnection(ip, expressWS);
    response = closeResponse;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function checkMyFluxAvailability(zelnodelist) {
  // run if at least 10 available nodes
  if (zelnodelist.length > 10) {
    let askingIP = await getRandomConnection();
    if (typeof askingIP !== 'string' || typeof myFluxIP !== 'string') {
      return;
    }
    if (askingIP.includes(':')) {
      // it is ipv6
      askingIP = `[${askingIP}]`;
    }
    let myIP = myFluxIP;
    if (myIP.includes(':')) {
      myIP = `[${myIP}]`;
    }
    const resMyAvailability = await serviceHelper.axiosGet(`http://${askingIP}:${config.server.apiport}/zelflux/checkfluxavailability/${myIP}`).catch((error) => {
      log.error(`${askingIP} is not reachable`);
      log.error(error);
    });
    if (!resMyAvailability) {
      dosState += 0.5;
      if (dosState > 10) {
        dosMessage = dosMessage || 'Flux communication is limited';
        log.error(dosMessage);
      }
      checkMyFluxAvailability(zelnodelist);
      return;
    }
    if (resMyAvailability.data.status === 'error' || resMyAvailability.data.data.message.includes('not')) {
      log.error(`My Flux unavailability detected from ${askingIP}`);
      // Asked Flux cannot reach me
      dosState += 1.5;
      if (dosState > 10) {
        dosMessage = dosMessage || 'Flux is not available for outside communication';
        log.error(dosMessage);
      } else {
        checkMyFluxAvailability(zelnodelist);
      }
    } else {
      dosState = 0;
      dosMessage = null;
    }
  } else {
    dosState = 0;
    dosMessage = null;
  }
}

async function checkDeterministicNodesCollisions() {
  // get my external ip address
  // get zelnode list with filter on this ip address
  // if it returns more than 1 object, shut down.
  // another precatuion might be comparing zelnode list on multiple zelnodes. evaulate in the future
  const myIP = await myZelNodeIP();
  myFluxIP = myIP;
  if (myIP !== null) {
    const zelnodeList = await deterministicZelNodeList();
    const result = zelnodeList.filter((zelnode) => zelnode.ip === myIP);
    const zelnodeStatus = await zelcashService.getZelNodeStatus();
    if (zelnodeStatus.status === 'success') { // different scenario is caught elsewhere
      const myCollateral = zelnodeStatus.data.collateral;
      const myZelNode = result.find((zelnode) => zelnode.collateral === myCollateral);
      if (result.length > 1) {
        log.warn('Multiple ZelNode instances detected');
        if (myZelNode) {
          const myBlockHeight = myZelNode.readded_confirmed_height || myZelNode.confirmed_height; // todo we may want to introduce new readded heights and readded confirmations
          const filterEarlierSame = result.filter((zelnode) => (zelnode.readded_confirmed_height || zelnode.confirmed_height) <= myBlockHeight);
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
        if (!myZelNode) {
          log.error('Flux collision detection');
          dosState = 100;
          dosMessage = 'Flux collision detection';
          return;
        }
      }
    }
    checkMyFluxAvailability(zelnodeList);
  } else {
    dosState += 1;
    if (dosState > 10) {
      dosMessage = dosMessage || 'Flux IP detection failed';
      log.error(dosMessage);
    }
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
  const authorized = await serviceHelper.verifyPrivilege('adminandzelteam', req);

  if (authorized === true) {
    const portResponseOK = await allowPort(port);
    if (portResponseOK.status === true) {
      response = serviceHelper.createSuccessMessage(portResponseOK.message, port, port);
    } else if (portResponseOK.status === false) {
      response = serviceHelper.createErrorMessage(portResponseOK.message, port, port);
    } else {
      response = serviceHelper.createErrorMessage(`Unkown error while opening port ${port}`);
    }
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function adjustFirewall() {
  const execA = 'sudo ufw status | grep Status';
  const execB = `sudo ufw allow ${config.server.apiport}`;
  const execC = `sudo ufw allow out ${config.server.apiport}`;
  const execD = `sudo ufw allow ${config.server.zelfrontport}`;
  const execE = `sudo ufw allow out ${config.server.zelfrontport}`;
  const cmdAsync = util.promisify(cmd.get);

  const cmdresA = await cmdAsync(execA);
  if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
    const cmdresB = await cmdAsync(execB);
    if (serviceHelper.ensureString(cmdresB).includes('updated') || serviceHelper.ensureString(cmdresB).includes('existing') || serviceHelper.ensureString(cmdresB).includes('added')) {
      log.info('Incoming Firewall adjusted for ZelBack port');
    } else {
      log.info('Failed to adjust Firewall for incoming ZelBack port');
    }
    const cmdresC = await cmdAsync(execC);
    if (serviceHelper.ensureString(cmdresC).includes('updated') || serviceHelper.ensureString(cmdresC).includes('existing') || serviceHelper.ensureString(cmdresC).includes('added')) {
      log.info('Outgoing Firewall adjusted for ZelBack port');
    } else {
      log.info('Failed to adjust Firewall for outgoing ZelBack port');
    }
    const cmdresD = await cmdAsync(execD);
    if (serviceHelper.ensureString(cmdresD).includes('updated') || serviceHelper.ensureString(cmdresD).includes('existing') || serviceHelper.ensureString(cmdresD).includes('added')) {
      log.info('Incoming Firewall adjusted for ZelFront port');
    } else {
      log.info('Failed to adjust Firewall for incoming ZelFront port');
    }
    const cmdresE = await cmdAsync(execE);
    if (serviceHelper.ensureString(cmdresE).includes('updated') || serviceHelper.ensureString(cmdresE).includes('existing') || serviceHelper.ensureString(cmdresE).includes('added')) {
      log.info('Outgoing Firewall adjusted for ZelFront port');
    } else {
      log.info('Failed to adjust Firewall for outgoing ZelFront port');
    }
  } else {
    log.info('Firewall is not active. Adjusting not applied');
  }
}

function isCommunicationEstablished(req, res) {
  let message;
  if (outgoingPeers.length < config.zelapps.minOutgoing) {
    message = serviceHelper.createErrorMessage('Not enough outgoing connections');
  } else if (incomingPeers.length < config.zelapps.minIncoming) {
    message = serviceHelper.createErrorMessage('Not enough incomming connections');
  } else {
    message = serviceHelper.createSuccessMessage('Communication to Flux network is properly established');
  }
  res.json(message);
}

async function broadcastTemporaryZelAppMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param zelAppSpecifications object
  * @param hash string - messageHash(type + version + JSON.stringify(zelAppSpecifications) + timestamp + signature))
  * @param timestamp number
  * @param signature string
  */
  console.log(message);
  // no verification of message before broadcasting. Broadcasting happens always after data have been verified and are stored in our db. It is up to receiving node to verify it and store and rebroadcast.
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.zelAppSpecifications !== 'object' && typeof message.signature !== 'string' && typeof message.timestamp !== 'number' && typeof message.hash !== 'string') {
    return new Error('Invalid ZelApp message for storing');
  }
  // to all outoing
  await broadcastMessageToOutgoing(message);
  await serviceHelper.delay(2345);
  // to all incoming. Delay broadcast in case message is processing
  await broadcastMessageToIncoming(message);
  return 0;
}

async function broadcastZelAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param hash string
  * @param ip string
  */
  console.log(message);
  // no verification of message before broadcasting. Broadcasting happens always after data have been verified and are stored in our db. It is up to receiving node to verify it and store and rebroadcast.
  if (typeof message !== 'object' && typeof message.type !== 'string' && typeof message.version !== 'number' && typeof message.broadcastedAt !== 'number' && typeof message.name !== 'string' && typeof message.hash !== 'string' && typeof message.ip !== 'string') {
    return new Error('Invalid ZelApp Running message for storing');
  }
  // to all outoing
  await broadcastMessageToOutgoing(message);
  await serviceHelper.delay(2345);
  // to all incoming. Delay broadcast in case message is processing
  await broadcastMessageToIncoming(message);
  return 0;
}

module.exports = {
  getFluxMessageSignature,
  verifyOriginalFluxBroadcast,
  verifyFluxBroadcast,
  handleIncomingConnection,
  fluxDisovery,
  broadcastMessageToOutgoing,
  broadcastMessageToIncoming,
  broadcastMessageToOutgoingFromUser,
  broadcastMessageToOutgoingFromUserPost,
  broadcastMessageToIncomingFromUser,
  broadcastMessageToIncomingFromUserPost,
  broadcastMessageFromUser,
  broadcastMessageFromUserPost,
  serialiseAndSignZelFluxBroadcast,
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
  broadcastTemporaryZelAppMessage,
  broadcastZelAppRunningMessage,
  keepIncomingConnectionsAlive,
  keepConnectionsAlive,
  adjustFirewall,
  checkDeterministicNodesCollisions,
};
