const crypto = require('node:crypto');
const qs = require('qs');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const cacheManager = require('./utils/cacheManager').default;

/**
 * The meeting point between a browser and a wallet that cannot reach it.
 *
 * A wallet opened through the `zel:` handler is a separate application with no
 * route back to the page that opened it. So the page asks a node for an id,
 * listens on `/ws/payment/<id>`, and hands the wallet a callback carrying that
 * same id; whatever the wallet posts to the callback is delivered to the
 * listener, and to nothing else.
 *
 * A transaction id is a claim, and this carries it without examining it. No
 * part of Flux treats what arrives here as settlement: an app is paid when a
 * transaction on chain matches its message hash at the price for that height,
 * which every node establishes for itself from the chain.
 *
 * THIS BELONGS TO THE SITES THAT OPEN THE WALLET. The callback is theirs to
 * host, and hosting it there is what takes an unauthenticated write endpoint
 * off every node in the fleet. It is here only because
 * palworld-server-website, minecraft-server-website and games-website address
 * it here; when they host it themselves, this goes.
 */

/**
 * How many ids may be outstanding at once.
 *
 * Ids are issued to anyone who asks, so the bound is what stops a flood
 * costing the node memory. Eviction is oldest-first, which under a flood
 * spends a legitimate caller's id - the failure a caller can retry, rather
 * than the one the node cannot.
 */
const MAX_OUTSTANDING = 20000;

const MAX_BODY_SIZE = 10000;
const TXID_MAX_LENGTH = 500;
const WS_POLL_INTERVAL = 500;

/**
 * Outlasts `paymentRelayCache`'s ttl, so a listener that waits the whole time
 * is told its id expired rather than that the wait did.
 */
const WS_MAX_WAIT = 65 * 60 * 1000;

const pending = cacheManager.paymentRelayCache;

/**
 * Issues an id for one browser-and-wallet meeting.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void}
 */
function paymentRequest(req, res) {
  try {
    if (pending.size >= MAX_OUTSTANDING) {
      throw new Error('Too many payment requests are outstanding');
    }
    // Unguessable, because the id is the only thing the wallet's callback is
    // held to: whoever holds a live one can leave a transaction id for the
    // browser waiting on it.
    const paymentId = `${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    pending.set(paymentId, { txid: null });
    res.json(messageHelper.createDataMessage({ paymentId }));
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
  }
}

/**
 * Takes the wallet's callback and leaves its transaction id for the listener.
 *
 * The body is read off the request rather than a parser, because the wallet
 * chooses its own content type and this end does not get to state one.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void}
 */
function receivePaymentCallback(req, res) {
  let body = '';
  let refused = false;

  req.on('data', (data) => {
    if (refused) return;
    body += data;
    if (body.length > MAX_BODY_SIZE) {
      refused = true;
      req.destroy();
      res.status(413).json(messageHelper.createErrorMessage('Request body too large'));
    }
  });

  req.on('end', () => {
    if (refused) return;
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const txid = processedBody.transaction_id || processedBody.txid;
      const paymentId = req.query.paymentid || processedBody.paymentid;

      if (!paymentId) {
        throw new Error('No payment ID is specified');
      }
      if (typeof paymentId !== 'string' || paymentId.length < 10 || paymentId.length > 100) {
        throw new Error('Invalid payment ID format');
      }
      if (!txid) {
        throw new Error('No transaction ID is specified');
      }
      if (typeof txid !== 'string') {
        throw new Error('Transaction ID must be a string');
      }
      if (txid.length > TXID_MAX_LENGTH) {
        throw new Error('Invalid transaction ID length');
      }
      if (!pending.has(paymentId)) {
        throw new Error('Payment request not found or has expired');
      }

      pending.set(paymentId, { txid });

      res.json(messageHelper.createDataMessage({
        message: 'Payment received successfully',
        paymentId,
        txid,
        success_url: 'https://home.runonflux.io/successcheckout',
      }));
    } catch (error) {
      log.error(error);
      res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
    }
  });
}

/**
 * Holds a browser's socket open until the wallet's transaction id arrives.
 *
 * @param {object} ws Web socket.
 * @param {string} paymentid The id both sides carry.
 * @returns {void}
 */
function wsRespondPayment(ws, paymentid) {
  let closed = false;
  const startTime = Date.now();

  /* eslint-disable no-param-reassign */
  ws.onclose = (evt) => {
    log.info(`WebSocket payment listener closed with code: ${evt.code}`);
    closed = true;
  };

  ws.onerror = (evt) => {
    log.error(`WebSocket payment listener error: ${evt.code}`);
    closed = true;
  };
  /* eslint-enable no-param-reassign */

  // A closed socket is answered by not looking again, above, rather than by a
  // second check here: the send sites are all reached through that one.
  function send(message, code) {
    try {
      ws.send(qs.stringify(message));
      ws.close(code);
    } catch (error) {
      log.error(error);
    }
  }

  function waitForCallback() {
    if (closed) return;

    if (Date.now() - startTime > WS_MAX_WAIT) {
      log.warn(`WebSocket payment polling timeout reached for ${paymentid}`);
      send(messageHelper.createErrorMessage('Payment polling timeout reached. Please request a new payment.'), 4016);
      return;
    }

    const held = pending.get(paymentid);

    if (!held) {
      send(messageHelper.createErrorMessage('Payment request is no longer valid. Please request a new one.'));
      return;
    }

    if (held.txid) {
      send(messageHelper.createDataMessage({
        message: 'Payment received',
        paymentId: paymentid,
        txid: held.txid,
      }), 4012);
      return;
    }

    setTimeout(waitForCallback, WS_POLL_INTERVAL);
  }

  waitForCallback();
}

module.exports = {
  paymentRequest,
  receivePaymentCallback,
  wsRespondPayment,
};
