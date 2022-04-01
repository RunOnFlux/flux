/* eslint-disable no-underscore-dangle */
const LRU = require('lru-cache');
const WebSocket = require('ws');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const { outgoingConnections } = require('./utils/outgoingConnections');
const { incomingConnections } = require('./utils/incomingConnections');
const { outgoingPeers } = require('./utils/outgoingPeers');
const { incomingPeers } = require('./utils/incomingPeers');

const myMessageCache = new LRU(250);

let response = messageHelper.createErrorMessage();

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
          fluxNetworkHelper.closeConnection(ip);
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
          fluxNetworkHelper.closeIncomingConnection(ip, [], client); // this is wrong
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

async function getFluxMessageSignature(message, privatekey) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey(privatekey);
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

async function serialiseAndSignFluxBroadcast(dataToBroadcast, privatekey) {
  const version = 1;
  const timestamp = Date.now();
  const pubKey = await fluxNetworkHelper.getFluxNodePublicKey(privatekey);
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

async function broadcastMessageToOutgoing(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToAllPeers(serialisedData);
}

async function broadcastMessageToIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToAllIncomingConnections(serialisedData);
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
  sendToAllPeers,
  sendMessageToWS,
  sendToAllIncomingConnections,
  respondWithAppMessage,
  serialiseAndSignFluxBroadcast,
  getFluxMessageSignature,
  broadcastMessageToOutgoingFromUser,
  broadcastMessageToOutgoingFromUserPost,
  broadcastMessageToIncomingFromUser,
  broadcastMessageToIncomingFromUserPost,
  broadcastMessageToIncoming,
  broadcastMessageFromUser,
  broadcastMessageFromUserPost,
  broadcastTemporaryAppMessage,
  broadcastMessageToOutgoing,
};
