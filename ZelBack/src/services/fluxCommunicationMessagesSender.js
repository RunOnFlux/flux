/* eslint-disable no-underscore-dangle */
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const { peerManager } = require('./utils/peerState');
const cacheManager = require('./utils/cacheManager').default;

const myMessageCache = cacheManager.tempMessageCache;


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
 * Sign and send a message to a peer.
 * @param {object} message Message to sign and send.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer Peer to send to.
 */
async function sendSignedMessage(message, peer) {
  try {
    const messageSigned = await serialiseAndSignFluxBroadcast(message);
    peer.send(messageSigned);
  } catch (error) {
    log.error(error);
  }
}

/**
 * To respond with app message.
 * @param {object} msgObj Message object with data.type and hashes.
 * @param {import('./utils/FluxPeerSocket').FluxPeerSocket} peer Peer that requested the message.
 * @returns {void}
 */
async function respondWithAppMessage(msgObj, peer) {
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
          sendSignedMessage(tempMesResponse, peer);
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
        sendSignedMessage(temporaryAppMessage, peer);
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
 * Relay a message to all connected peers (both directions), excluding the sender.
 * @param {string} data Serialised message data.
 * @param {string} [excludeKey] Peer key (ip:port) to exclude (the sender).
 */
async function relay(data, excludeKey) {
  await peerManager.broadcast(data, { exclude: excludeKey });
}

/**
 * Sign once, send to all connected peers (both directions).
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToAll(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  await relay(serialisedData);
}

/**
 * Sign and send to a random outbound peer.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToRandomOutgoing(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  const peer = peerManager.getRandomPeer('outbound');
  if (peer) peer.send(serialisedData);
}

/**
 * Sign and send to a random inbound peer.
 * @param {object} dataToBroadcast Data to broadcast.
 */
async function broadcastMessageToRandomIncoming(dataToBroadcast) {
  const serialisedData = await serialiseAndSignFluxBroadcast(dataToBroadcast);
  const peer = peerManager.getRandomPeer('inbound');
  if (peer) peer.send(serialisedData);
}

/**
 * @deprecated Use broadcastMessageFromUser instead. Sends to all peers.
 */
async function broadcastMessageToOutgoingFromUser(req, res) {
  log.warn('broadcastMessageToOutgoingFromUser is deprecated, use broadcastMessageFromUser');
  return broadcastMessageFromUser(req, res);
}

/**
 * @deprecated Use broadcastMessageFromUserPost instead. Sends to all peers.
 */
async function broadcastMessageToOutgoingFromUserPost(req, res) {
  log.warn('broadcastMessageToOutgoingFromUserPost is deprecated, use broadcastMessageFromUserPost');
  return broadcastMessageFromUserPost(req, res);
}

/**
 * @deprecated Use broadcastMessageFromUser instead. Sends to all peers.
 */
async function broadcastMessageToIncomingFromUser(req, res) {
  log.warn('broadcastMessageToIncomingFromUser is deprecated, use broadcastMessageFromUser');
  return broadcastMessageFromUser(req, res);
}

/**
 * @deprecated Use broadcastMessageFromUserPost instead. Sends to all peers.
 */
async function broadcastMessageToIncomingFromUserPost(req, res) {
  log.warn('broadcastMessageToIncomingFromUserPost is deprecated, use broadcastMessageFromUserPost');
  return broadcastMessageFromUserPost(req, res);
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
  relay,
  sendSignedMessage,
  respondWithAppMessage,
  serialiseAndSignFluxBroadcast,
  getFluxMessageSignature,
  broadcastMessageToOutgoingFromUser,
  broadcastMessageToOutgoingFromUserPost,
  broadcastMessageToIncomingFromUser,
  broadcastMessageToIncomingFromUserPost,
  broadcastMessageToAll,
  broadcastMessageFromUser,
  broadcastMessageFromUserPost,
  broadcastTemporaryAppMessage,
  broadcastMessageToRandomOutgoing,
  broadcastMessageToRandomIncoming,
};
