const qs = require('qs');
const WebSocket = require('ws');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashServices = require('./zelcashService');

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

// return boolean
async function verifyFluxBroadcast(data, obtainedZelNodeList, currentTimeStamp) {
  const { pubKey } = data;
  const { timestamp } = data; // ms
  const { signature } = data;
  const message = qs.stringify(data.data);
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
  // const clientsValues = clientsSet .values();
  // console.log(clientsValues);
  // console.log(clientsSet .size);
  // for (let i = 0; i < clientsSet .size; i += 1) {
  //   console.log(clientsValues.next().value);
  // }
  // clientsSet .forEach((client) => {
  //   client.send('hello');
  // });
  // const { data } = req.params;
  // console.log(req);
  // console.log(ws);
  // verify data integrity, if not signed, close connection
  ws.on('message', (msg) => {
    if (msg === 'this is a test') {
      ws.send('test ok');
    }
    console.log(msg);
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


async function getRandomConnection() {

}

async function initiateConnection() {
}

async function fluxDisovery() {
  log.info('Flux Discovery started');
  const minPeers = 10;
  const zl = await zelnodelist();
  const numberOfZelNodes = zl.length;
  const requiredNumberOfConnections = numberOfZelNodes / 50; // 2%
  if (outgoingConnections.length < minPeers || outgoingConnections.length < requiredNumberOfConnections) {
    log.info('Initiating connection');
  }
}


module.exports = {
  getFluxMessageSignature,
  verifyFluxBroadcast,
  handleIncomingConnection,
  fluxDisovery,
};
