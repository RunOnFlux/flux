const WebSocket = require('ws');
const bitcoinjs = require('bitcoinjs-lib');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashServices = require('./zelcashService');
const config = require('../../../config/default');

const outgoingConnections = [];

// TODO create constants
let response = {
  status: 'error',
  data: {
    message: 'Unknown error',
  },
};

const errUnauthorizedMessage = {
  status: 'error',
  data: {
    message: 'Unauthorized. Access denied.',
  },
};

async function verifyPrivilege(privilege, req, res) { // move to helper
  let isAuthorized;
  switch (privilege) {
    case 'admin':
      // eslint-disable-next-line consistent-return
      serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
        if (error) {
          return res.json(error);
        }
        isAuthorized = authorized;
      });
      return isAuthorized;
    case 'zelteam':
      // eslint-disable-next-line consistent-return
      await serviceHelper.verifyZelTeamSession(req.headers, async (error, authorized) => {
        if (error) {
          return res.json(error);
        }
        isAuthorized = authorized;
      });
      return isAuthorized;
    case 'user':
      // eslint-disable-next-line consistent-return
      await serviceHelper.verifyUserSession(req.headers, async (error, authorized) => {
        if (error) {
          return res.json(error);
        }
        isAuthorized = authorized;
      });
      return isAuthorized;
    default:
      return false;
  }
}

async function zelnodelist(filter) {
  let zelnodeList = null;
  const request = {
    params: {
      filter,
    },
    query: {},
  };
  zelnodeList = await zelcashServices.listZelNodes(request);
  return zelnodeList.data || [];
}

async function getZelNodePrivateKey() {
  const privKey = zelcashServices.getConfigValue('zelnodeprivkey');
  return privKey;
}

async function getFluxMessageSignature(message, privKey) {
  // eslint-disable-next-line no-param-reassign
  privKey = privKey || await getZelNodePrivateKey();
  const signature = await serviceHelper.signMessage(message, privKey);
  return signature;
}

async function getZelNodePublicKey() {
  // eslint-disable-next-line no-param-reassign
  const privKey = await getZelNodePrivateKey();
  const keyPair = bitcoinjs.ECPair.fromWIF(privKey);
  const pubKey = keyPair.publicKey.toString('hex');
  return pubKey;
}

// return boolean
async function verifyFluxBroadcast(data, obtainedZelNodeList, currentTimeStamp) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = typeof data === 'object' ? data : JSON.parse(data);
  const { pubKey } = dataObj;
  const { timestamp } = dataObj; // ms
  const { signature } = dataObj;
  const message = typeof dataObj.data === 'string' ? dataObj.data : JSON.stringify(dataObj.data);
  // is timestamp valid ?
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp - 120000)) { // message was broadcasted in the past. Allow 120 sec clock sync
    return false;
  }

  let zelnode = null;
  if (obtainedZelNodeList) { // for test purposes
    zelnode = await obtainedZelNodeList.find(key => key.pubkey === pubKey);
  }
  if (!zelnode) {
    const zl = await zelnodelist(pubKey); // this itself is sufficient.
    if (zl.length === 1) {
      if (zl[0].pubkey === pubKey) {
        [zelnode] = zl;
      }
    }
  }
  if (!zelnode) { // if filtering fails, fetch all the list and run find method
    // eslint-disable-next-line no-param-reassign
    obtainedZelNodeList = await zelnodelist(); // support for daemons that do not have filtering via public key
    zelnode = await obtainedZelNodeList.find(key => key.pubkey === pubKey);
  }
  if (!zelnode) {
    return false;
  }
  if (zelnode.status !== 'ENABLED') { // refuse messages from not enabled zelnodes
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
  const dataObj = typeof data === 'object' ? data : JSON.parse(data);
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
  const dataObj = typeof data === 'object' ? data : JSON.parse(data);
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
  console.log(data);
  outgoingConnections.forEach((client) => {
    try {
      client.send(data);
    } catch (e) {
      log.error(e);
      removals.push(client);
    }
  });

  for (let i = 0; i < removals.length; i += 1) {
    const ocIndex = outgoingConnections.indexOf(removals[i]);
    outgoingConnections.splice(ocIndex, 1);
  }
  removals = [];
}

// eslint-disable-next-line no-unused-vars
function handleIncomingConnection(ws, req, expressWS) {
  const currentTimeStamp = Date.now(); // ms
  // const clientsSet = expressWS.clients;
  // const clientsValues = clientsSet.values();
  // console.log(clientsValues);
  // console.log(clientsSet .size);
  // for (let i = 0; i < clientsSet.size; i += 1) {
  //   console.log(clientsValues.next().value);
  // }
  // clientsSet.forEach((client) => {
  //   client.send('hello');
  // });
  // const { data } = req.params;
  // console.log(req);
  // console.log(ws);
  // verify data integrity, if not signed, close connection
  ws.on('message', async (msg) => {
    const messageOK = await verifyFluxBroadcast(msg, undefined, currentTimeStamp);
    const timestampOK = await verifyTimestampInFluxBroadcast(msg, currentTimeStamp);
    if (messageOK === true && timestampOK === true) {
      try {
        ws.send('ZelFlux says Hi!');
      } catch (e) {
        log.error(e);
      }
      try {
        sendToAllPeers(msg);
      } catch (e) {
        log.error(e);
      }
      // try rebroadcasting to all outgoing peers
    } else if (messageOK === true) {
      try {
        ws.send('ZelFlux says Hi but your message is outdated!');
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
  ws.on('open', (msg) => {
    console.log(msg);
  });
  ws.on('connection', (msg) => {
    console.log(msg);
  });
  ws.on('error', (msg) => {
    console.log(msg);
  });
  ws.on('close', (msg) => {
    // console.log(clientsSet);
    console.log(msg);
  });
}

async function serialiseAndSignZelFluxBroadcast(dataToBroadcast) {
  const timestamp = Date.now();
  const pubKey = await getZelNodePublicKey();
  const message = typeof dataToBroadcast === 'string' ? dataToBroadcast : JSON.stringify(dataToBroadcast);
  const signature = await getFluxMessageSignature(message);
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

async function broadcastMessage(dataToBroadcast) {
  const serialisedData = await serialiseAndSignZelFluxBroadcast(dataToBroadcast);
  sendToAllPeers(serialisedData);
}

async function broadcastMessageFromUser(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (data === undefined || data === null) {
    const errMessage = {
      status: 'error',
      data: {
        message: 'No message to broadcast attached.',
      },
    };
    return res.json(errMessage);
  }
  const authorized = await verifyPrivilege('zelteam', req, res);

  if (authorized === false) { // TODO true
    broadcastMessage(data);
    const message = {
      status: 'success',
      data: {
        message: 'Message successfully broadcasted to ZelFlux network',
      },
    };
    response = message;
  } else {
    response = errUnauthorizedMessage;
  }
  return res.json(response);
}

async function getRandomConnection() {
  const zelnodeList = await zelnodelist();
  const zlLength = zelnodeList.length;
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const fullip = zelnodeList[randomNode].ipaddress;
  const ip = fullip.split(':16125').join('');

  // TODO checks for ipv4, ipv6, tor
  if (ip.includes('[') || ip.includes('onion')) {
    return null;
  }

  // eslint-disable-next-line no-underscore-dangle
  const clientExists = outgoingConnections.find(client => client._socket.remoteAddress === ip);
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
    broadcastMessage('Hello ZelFlux');
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
  });

  websocket.onclose = (evt) => {
    const { url } = websocket;
    let conIP = url.split('/')[2];
    conIP = conIP.split(':16127').join('');
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      // eslint-disable-next-line no-underscore-dangle
      log.info(`Connection to ${conIP} closed with code ${evt.code}`);
      outgoingConnections.splice(ocIndex, 1);
    }
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
  };

  websocket.onmessage = (evt) => {
    console.log(evt.msg);
  };

  websocket.onerror = (evt) => {
    console.log(evt.code);
    const { url } = websocket;
    let conIP = url.split('/')[2];
    conIP = conIP.split(':16127').join('');
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      // eslint-disable-next-line no-underscore-dangle
      log.info(`Connection to ${conIP} errord with code ${evt.code}`);
      outgoingConnections.splice(ocIndex, 1);
    }
    console.log(`#connectionsOut: ${outgoingConnections.length}`);
  };
}

async function fluxDisovery() {
  const minPeers = 4; // todo to 10;
  const zl = await zelnodelist();
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
    }, 2000);
  } else {
    // do new connections every 30 seconds
    setTimeout(() => {
      fluxDisovery();
    }, 30000);
  }
}

function connectedPeers(req, res) {
  const connections = [];
  outgoingConnections.forEach((client) => {
    // eslint-disable-next-line no-underscore-dangle
    connections.push(client._socket.remoteAddress);
  });
  const message = {
    status: 'success',
    data: {
      message: connections,
    },
  };
  response = message;
  res.json(response);
}

module.exports = {
  getFluxMessageSignature,
  verifyOriginalFluxBroadcast,
  verifyFluxBroadcast,
  handleIncomingConnection,
  fluxDisovery,
  broadcastMessage,
  broadcastMessageFromUser,
  serialiseAndSignZelFluxBroadcast,
  initiateAndHandleConnection,
  connectedPeers,
};
