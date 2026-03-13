/* eslint-disable no-underscore-dangle */
const WebSocket = require('ws');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const { peerManager } = require('./utils/establishedConnections');
const cacheManager = require('./utils/cacheManager').default;

const myMessageCache = cacheManager.tempMessageCache;

/**
 * To send to all peers.
 * @param {object} data Data.
 * @param {object[]} wsList Web socket list.
 */
async function sendToAllPeers(data, wsList) {
  try {
    // wsList is a legacy parameter — an array of raw ws objects to send to
    if (wsList) {
      // Legacy path: iterate provided ws list (used by handleAppMessages)
      for (const client of wsList) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(25);
          if (client.readyState === WebSocket.OPEN) {
            if (!data) {
              client.ping();
            } else {
              client.send(data);
            }
          } else {
            throw new Error(`Connection to ${client.ip} is not open`);
          }
        } catch (e) {
          try {
            fluxNetworkHelper.closeConnection(client.ip, client.port);
          } catch (err) {
            log.error(err);
          }
        }
      }
      return;
    }
    // New path: iterate peerManager outbound peers
    for (const peer of peerManager.outboundValues()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(25);
        if (!data) {
          peer.ping();
        } else if (!peer.send(data)) {
          throw new Error(`Connection to ${peer.key} is not open`);
        }
      } catch (e) {
        try {
          peer.close(4009, 'send failure');
        } catch (err) {
          log.error(err);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To send random peers.
 * @param {object} data Data.
 */
async function sendToRandomPeer(data) {
  try {
    const peer = peerManager.getRandomPeer('outbound');
    if (!peer) return;
    await serviceHelper.delay(25);
    if (!data) {
      peer.ping();
    } else if (!peer.send(data)) {
      throw new Error(`Connection to ${peer.key} is not open`);
    }
  } catch (e) {
    log.error(e);
  }
}

/**
 * To send to all incoming connections.
 * @param {object} data Data.
 * @param {object[]} wsList Web socket list.
 */
async function sendToAllIncomingConnections(data, wsList) {
  try {
    // wsList is a legacy parameter — an array of raw ws objects
    if (wsList) {
      for (const client of wsList) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(25);
          if (client.readyState === WebSocket.OPEN) {
            if (!data) {
              client.ping();
            } else {
              client.send(data);
            }
          } else {
            throw new Error(`Connection to ${client.ip} is not open`);
          }
        } catch (e) {
          try {
            fluxNetworkHelper.closeIncomingConnection(client.ip, client.port);
          } catch (err) {
            log.error(err);
          }
        }
      }
      return;
    }
    // New path: iterate peerManager inbound peers
    for (const peer of peerManager.inboundValues()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(25);
        if (!data) {
          peer.ping();
        } else if (!peer.send(data)) {
          throw new Error(`Connection to ${peer.key} is not open`);
        }
      } catch (e) {
        try {
          peer.close(4010, 'send failure');
        } catch (err) {
          log.error(err);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To send to random incoming connection.
 * @param {object} data Data.
 */
async function sendToRandomIncomingConnections(data) {
  try {
    const peer = peerManager.getRandomPeer('inbound');
    if (!peer) return;
    await serviceHelper.delay(25);
    if (!data) {
      peer.ping();
    } else if (!peer.send(data)) {
      throw new Error(`Connection to ${peer.key} is not open`);
    }
  } catch (e) {
    log.error(e);
  }
}

/**
 * To get Flux message signature.
 * @param {object} message Message.
 * @param {string} privatekey Private key.
 * @returns {Promise<string>} Signature.
 */
async function getFluxMessageSignature(message, privatekey) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey(privatekey);
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
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

/**
 * To sign and send message to web socket.
 * @param {object} message Message.
 * @param {object} ws Web Socket.
 */
async function sendMessageToWS(message, ws) {
  try {
    const messageSigned = await serialiseAndSignFluxBroadcast(message);
    try {
      ws.send(messageSigned);
    } catch (e) {
      log.error(e);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To respond with app message.
 * @param {object} message Message.
 * @param {object} ws Web socket.
 * @returns {void} Throws an error if invalid.
 */
async function respondWithAppMessage(msgObj, ws) {
  try {
    // check if we have it database of permanent appMessages
    // eslint-disable-next-line global-require
    const messageVerifier = require('./appMessaging/messageVerifier');
    const appsMessages = [];
    if (!msgObj.data) {
      throw new Error('Invalid Flux App Request message');
    }

    const message = msgObj.data;

    if (message.version !== 1 && message.version !== 2) {
      throw new Error(`Invalid Flux App Request message, version ${message.version} not supported`);
    }

    if (message.version === 1) {
      if (typeof message.hash !== 'string') {
        throw new Error('Invalid Flux App Request message, hash propery is mandatory on version 1');
      }
      appsMessages.push(message.hash);
    }

    if (message.version === 2) {
      if (!message.hashes || !Array.isArray(message.hashes) || message.hashes.length > 500) {
        throw new Error('Invalid Flux App Request v2 message');
      }
      for (let i = 0; i < message.hashes.length; i += 1) {
        if (typeof message.hashes[i] !== 'string') {
          throw new Error('Invalid Flux App Request v2 message');
        }
        appsMessages.push(message.hashes[i]);
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const hash of appsMessages) {
      if (myMessageCache.has(hash)) {
        const tempMesResponse = myMessageCache.get(hash);
        if (tempMesResponse) {
          sendMessageToWS(tempMesResponse, ws);
          // eslint-disable-next-line no-continue
          continue;
        }
      }
      let temporaryAppMessage = null;
      // eslint-disable-next-line no-await-in-loop
      const appMessage = await messageVerifier.checkAppMessageExistence(hash) || await messageVerifier.checkAppTemporaryMessageExistence(hash);
      if (appMessage) {
        temporaryAppMessage = { // specification of temp message
          type: appMessage.type,
          version: appMessage.version,
          appSpecifications: appMessage.appSpecifications || appMessage.zelAppSpecifications,
          hash: appMessage.hash,
          timestamp: appMessage.timestamp,
          signature: appMessage.signature,
          arcaneSender: appMessage.arcaneSender || false,
        };
        sendMessageToWS(temporaryAppMessage, ws);
      }
      myMessageCache.set(hash, temporaryAppMessage);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(150);
    }
    // else do nothing. We do not have this message. And this Flux would be requesting it from other peers soon too.
  } catch (error) {
    log.error(error);
  }
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
 * Sign once, send to both outgoing and incoming peers. Fixes double-signing issue
 * where the same logical message would get two different timestamps/signatures.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToAll(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToAllPeers(serialisedData);
  await sendToAllIncomingConnections(serialisedData);
}

/**
 * To broadcast message to outgoing peers. Data is serialised and sent to outgoing peers.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToRandomOutgoing(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToRandomPeer(serialisedData);
}

/**
 * To broadcast message to incoming peers. Data is serialised and sent to incoming peers.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToRandomIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await sendToRandomIncomingConnections(serialisedData);
}

/**
 * To broadcast message from user to outgoing peers. Data is serialised and sent to outgoing peers. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function broadcastMessageToOutgoingFromUser(req, res) {
  try {
    let { data } = req?.params || {};
    data = data || req?.query?.data;
    if (data === undefined || data === null) {
      throw new Error('No message to broadcast attached.');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    let message;

    if (authorized === true) {
      await broadcastMessageToOutgoing(data);
      message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
    } else {
      message = messageHelper.errUnauthorizedMessage();
    }
    res.json(message);
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
      if (body === undefined || body === '') {
        throw new Error('No message to broadcast attached.');
      }
      const processedBody = serviceHelper.ensureObject(body);
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

      let message;

      if (authorized === true) {
        await broadcastMessageToOutgoing(processedBody);
        message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
      } else {
        message = messageHelper.errUnauthorizedMessage();
      }
      res.json(message);
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
    let { data } = req?.params || {};
    data = data || req?.query?.data;
    if (data === undefined || data === null) {
      throw new Error('No message to broadcast attached.');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    let message;
    if (authorized === true) {
      await broadcastMessageToIncoming(data);
      message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
    } else {
      message = messageHelper.errUnauthorizedMessage();
    }
    res.json(message);
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
      if (body === undefined || body === '') {
        throw new Error('No message to broadcast attached.');
      }
      const processedBody = serviceHelper.ensureObject(body);
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

      let message;

      if (authorized === true) {
        await broadcastMessageToIncoming(processedBody);
        message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
      } else {
        message = messageHelper.errUnauthorizedMessage();
      }
      res.json(message);
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
    let { data } = req?.params || {};
    data = data || req?.query?.data;
    if (data === undefined || data === null) {
      throw new Error('No message to broadcast attached.');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

    let message;

    if (authorized === true) {
      await broadcastMessageToAll(data);
      message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
    } else {
      message = messageHelper.errUnauthorizedMessage();
    }
    res.json(message);
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
      if (body === undefined || body === '') {
        throw new Error('No message to broadcast attached.');
      }
      const processedBody = serviceHelper.ensureObject(body);
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

      let message;

      if (authorized === true) {
        await broadcastMessageToAll(processedBody);
        message = messageHelper.createSuccessMessage('Message successfully broadcasted to Flux network');
      } else {
        message = messageHelper.errUnauthorizedMessage();
      }
      res.json(message);
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
  // no verification of message before broadcasting. Broadcasting happens always after data have been verified and are stored in our db. It is up to receiving node to verify it and store and rebroadcast.
  if (typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.appSpecifications !== 'object' || typeof message.signature !== 'string' || typeof message.timestamp !== 'number' || typeof message.hash !== 'string') {
    throw new Error('Invalid Flux App message for storing');
  }
  // sign once, send to both directions
  await broadcastMessageToAll(message);
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
  broadcastMessageToAll,
  broadcastMessageFromUser,
  broadcastMessageFromUserPost,
  broadcastTemporaryAppMessage,
  broadcastMessageToOutgoing,
  broadcastMessageToRandomOutgoing,
  broadcastMessageToRandomIncoming,
};
