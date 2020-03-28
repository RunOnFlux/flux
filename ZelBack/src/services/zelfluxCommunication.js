/* eslint-disable no-underscore-dangle */
const WebSocket = require('ws');
const bitcoinjs = require('bitcoinjs-lib');
const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashServices = require('./zelcashService');
const userconfig = require('../../../config/userconfig');
const explorerService = require('./explorerService');

const outgoingConnections = []; // websocket list
const outgoingPeers = []; // array of objects containing ip and rtt latency

const incomingConnections = []; // websocket list
const incomingPeers = []; // array of objects containing ip and rtt latency

let dosState = 0;
let dosMessage = null;

let response = serviceHelper.createErrorMessage();

async function myZelNodeIP() {
  const benchmarkResponse = await zelcashServices.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  } else {
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
  zelnodeList = await zelcashServices.listZelNodes(request);
  return zelnodeList.status === 'success' ? (zelnodeList.data || []) : [];
}

async function getZelNodePrivateKey(privatekey) {
  const privKey = privatekey || zelcashServices.getConfigValue('zelnodeprivkey');
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
  const verified = await serviceHelper.verifyMessage(message, pubKey, signature);
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

function sendToAllPeers(data) {
  let removals = [];
  let ipremovals = [];
  // console.log(data);
  outgoingConnections.forEach((client) => {
    try {
      client.send(data);
    } catch (e) {
      log.error(e);
      removals.push(client);
      const ip = client._socket.remoteAddress;
      const foundPeer = outgoingPeers.find((peer) => peer.ip === ip);
      ipremovals.push(foundPeer);
    }
  });

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
}

function sendToAllIncomingConnections(data) {
  let removals = [];
  let ipremovals = [];
  // console.log(data);
  incomingConnections.forEach((client) => {
    try {
      client.send(data);
    } catch (e) {
      log.error(e);
      removals.push(client);
      const ip = client._socket.remoteAddress;
      const foundPeer = incomingPeers.find((peer) => peer.ip === ip);
      ipremovals.push(foundPeer);
    }
  });

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
}

async function serialiseAndSignZelFluxBroadcast(dataToBroadcast, privatekey) {
  const timestamp = Date.now();
  const pubKey = await getZelNodePublicKey(privatekey);
  const message = serviceHelper.ensureString(dataToBroadcast);
  const signature = await getFluxMessageSignature(message, privatekey);
  const type = 'message';
  const dataObj = {
    type,
    timestamp,
    pubKey,
    signature,
    data: dataToBroadcast,
  };
  const dataString = JSON.stringify(dataObj);
  return dataString;
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
  ws.on('message', async (msg) => { // TODO move to message handling infcoming connection function
    const currentTimeStamp = Date.now(); // ms
    console.log(msg);
    const messageOK = await verifyFluxBroadcast(msg, undefined, currentTimeStamp);
    const timestampOK = await verifyTimestampInFluxBroadcast(msg, currentTimeStamp);
    if (messageOK === true && timestampOK === true) {
      try {
        const msgObj = serviceHelper.ensureObject(msg);
        if (msgObj.data.type === 'HeartBeat' && msgObj.data.message === 'ping') { // we know that data exists
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
          ws.send(`ZelFlux ${userconfig.initial.ipaddress} says message received!`);
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
        ws.send(`ZelFlux ${userconfig.initial.ipaddress} says message received but your message is outdated!`);
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);

  if (authorized === true) {
    broadcastMessageToOutgoing(data);
    const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to ZelFlux network');
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
      const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
      if (authorized === true) {
        broadcastMessageToOutgoing(processedBody);
        const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to ZelFlux network');
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);

  if (authorized === true) {
    broadcastMessageToIncoming(data);
    const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to ZelFlux network');
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
      const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
      if (authorized === true) {
        broadcastMessageToIncoming(processedBody);
        const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to ZelFlux network');
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);

  if (authorized === true) {
    broadcastMessageToOutgoing(data);
    broadcastMessageToIncoming(data);
    const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to ZelFlux network');
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
      const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
      if (authorized === true) {
        broadcastMessageToOutgoing(processedBody);
        broadcastMessageToIncoming(processedBody);
        const message = serviceHelper.createSuccessMessage('Message successfully broadcasted to ZelFlux network');
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
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const fullip = zelnodeList[randomNode].ip || zelnodeList[randomNode].ipaddress;
  const ip = fullip.split(':16125').join('');

  // const zelnodeList = ['157.230.249.150', '94.177.240.7', '89.40.115.8', '94.177.241.10', '54.37.234.130', '194.182.83.182'];
  // const zlLength = zelnodeList.length;
  // const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  // const ip = zelnodeList[randomNode];

  // TODO checks for ipv4, ipv6, tor
  if (ip.includes('onion') || ip === userconfig.initial.ipaddress) {
    return null;
  }

  const clientExists = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
  if (clientExists) {
    return null;
  }

  log.info(`Adding ZelFlux peer: ${ip}`);

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
    broadcastMessageToOutgoing('Hello ZelFlux');
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
  });

  websocket.onclose = (evt) => {
    const { url } = websocket;
    let conIP = url.split('/')[2];
    conIP = conIP.split(':16127').join('');
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
      const msgObj = serviceHelper.ensureObject(evt.data);
      if (msgObj.data.type === 'HeartBeat' && msgObj.data.message === 'pong') {
        const newerTimeStamp = Date.now(); // ms, get a bit newer time that has passed verification of broadcast
        const rtt = newerTimeStamp - msgObj.data.timestamp;
        const { url } = websocket;
        let conIP = url.split('/')[2];
        conIP = conIP.split(':16127').join('');
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
    conIP = conIP.split(':16127').join('');
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
  const minPeers = 5; // todo to 10;
  const zl = await deterministicZelNodeList();
  const numberOfZelNodes = zl.length;
  const requiredNumberOfConnections = numberOfZelNodes / 50; // 2%
  const minCon = Math.min(minPeers, requiredNumberOfConnections); // TODO correctly max
  if (outgoingConnections.length < minCon) {
    const ip = await getRandomConnection();
    if (ip) {
      initiateAndHandleConnection(ip);
    }
    // connect another peer
    setTimeout(() => {
      fluxDisovery();
    }, 1000);
  } else {
    // do new connections every 60 seconds
    setTimeout(() => {
      fluxDisovery();
    }, 60000);
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);

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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);

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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);

  if (authorized === true) {
    const closeResponse = await closeIncomingConnection(ip, expressWS);
    response = closeResponse;
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

async function checkDeterministicNodesCollisions() {
  // get my external ip address
  // get zelnode list with filter on this ip address
  // if it returns more than 1 object, shut down.
  // another precatuion might be comparing zelnode list on multiple zelnodes. evaulate in the future
  const myIP = await myZelNodeIP();
  if (myIP !== null) {
    const zelnodeList = await deterministicZelNodeList();
    const result = zelnodeList.filter((zelnode) => zelnode.ip === myIP);
    if (result.length > 1) {
      log.error('Flux collision detection');
      dosState = 100;
      dosMessage = 'Flux collision detection';
    } else {
      dosState = 0;
      dosMessage = null;
    }
  } else {
    dosState += 1;
    if (dosState > 10) {
      log.error('Flux IP detection failed');
      dosMessage = 'Flux IP detection failed';
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

function startFluxFunctions() {
  // fluxDisovery();
  // log.info('Flux Discovery started');
  // keepConnectionsAlive();
  // keepIncomingConnectionsAlive();
  // checkDeterministicNodesCollisions();
  // setInterval(() => {
  //   checkDeterministicNodesCollisions();
  // }, 60000);
  for (let i = 0; i < 5; i += 1) {
    explorerService.processBlock(i);
  }
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
  startFluxFunctions,
  addPeer,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  removePeer,
  removeIncomingPeer,
  connectedPeersInfo,
  getDOSState,
};
