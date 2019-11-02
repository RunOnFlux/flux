const WebSocket = require('ws');
const bitcoinjs = require('bitcoinjs-lib');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashServices = require('./zelcashService');
const config = require('../../../config/default');

const outgoingConnections = [];

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
  if (currentTimeStamp > (timestamp + 5000)) { // bigger than 5 secs
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

function handleIncomingConnection(ws, req, expressWS) {
  const clientsSet = expressWS.clients;
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
    const messageOK = await verifyFluxBroadcast(msg);
    if (messageOK === true) {
      ws.send('Message received ok');
    } else {
      // we dont like this message. Lets close the connection
      ws.close(1008); // close as of policy violation
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
    console.log(clientsSet);
    console.log(msg);
  });
}

function sendToAllPeers(data) {
  outgoingConnections.forEach((client) => {
    client.send(data);
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

async function getRandomConnection() {
  const zelnodeList = await zelnodelist();
  const zlLength = zelnodeList.length;
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const fullip = zelnodeList[randomNode].ipaddress;
  const ip = fullip.split(':16125').join('');
  // const ip = '157.230.249.150';
  console.log(ip);
  return ip;
}

async function initiateAndHandleConnection(ip) {
  const wsuri = `ws://${ip}:${config.server.apiport}/ws/zelflux/`;
  const websocket = new WebSocket(wsuri);
  console.log(websocket);

  websocket.on('open', () => {
    console.log('here');
    outgoingConnections.push(websocket);
    broadcastMessage('this is a test');
    console.log(outgoingConnections);
  });

  websocket.onclose = (evt) => {
    console.log(evt);
    console.log(evt.data);
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      outgoingConnections.splice(ocIndex, 1);
    }
    console.log(outgoingConnections);
  };

  websocket.onmessage = (evt) => {
    console.log(evt.data);
  };

  websocket.onerror = (evt) => {
    console.log(evt.data);
    const ocIndex = outgoingConnections.indexOf(websocket);
    if (ocIndex > -1) {
      outgoingConnections.splice(ocIndex, 1);
    }
    console.log(outgoingConnections);
  };
}

async function fluxDisovery() {
  log.info('Flux Discovery started');
  const minPeers = 10;
  const zl = await zelnodelist();
  const numberOfZelNodes = zl.length;
  const requiredNumberOfConnections = numberOfZelNodes / 50; // 2%
  if (outgoingConnections.length < minPeers || outgoingConnections.length < requiredNumberOfConnections) {
    log.info('Initiating connection');
    // run initiation connection funciton if the condition drops below requirement
    const ip = await getRandomConnection();
    initiateAndHandleConnection(ip);
  }
}

module.exports = {
  getFluxMessageSignature,
  verifyFluxBroadcast,
  handleIncomingConnection,
  fluxDisovery,
  broadcastMessage,
  serialiseAndSignZelFluxBroadcast,
  initiateAndHandleConnection,
};
