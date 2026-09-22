const crypto = require('node:crypto');
const qs = require('qs');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const { resolveClientIp } = require('./utils/ingressCapture');
const cacheManager = require('./utils/cacheManager').default;
const { lruRateLimit } = require('./utils/rateLimit');

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
 * It is reachable unauthenticated on every node, because neither end can be:
 * the page holds no session and the wallet is a separate application. The id
 * is the whole of what the callback is held to - unguessable, spent on
 * delivery, and capped per caller so one source cannot take the cache.
 */

/**
 * The most a body may be when this end has to read it itself.
 *
 * Only the content types no mounted parser claims reach that path; a JSON body
 * is bounded by express.json before it gets here.
 */
const MAX_BODY_SIZE = 10000;
const TXID_MAX_LENGTH = 500;
const WS_POLL_INTERVAL = 500;
// A payment button is pressed by a person, so a handful a second from one
// address is generous; above it, issuance is refused. This is what stops a
// flood, not the cache size - the cache is small on purpose.
const PAYMENT_REQUEST_RATE_PER_SEC = 5;
// The most pending ids one address may hold at once. The rate limit bounds how
// fast ids are minted; this bounds how many one source holds, so a flood cannot
// take the cache's slots and evict the ids other browsers are still waiting on -
// the cache evicts oldest-first and a rate cap alone does not stop one source
// filling it.
const MAX_PENDING_PER_IP = 10;

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
    // The caller as far as this node can honestly tell: the socket peer, or the
    // address a balancer this node recognises reports having seen. A forwarding
    // header from anything else is the caller's own claim and is ignored, so the
    // limits below cannot be stepped around by setting one. Nodes are reached
    // through the domain proxy as well as directly, and keying on the socket
    // peer alone spends one allowance on everyone arriving that way.
    const ip = resolveClientIp(req.socket && req.socket.remoteAddress, req.headers).ip || '';
    if (!lruRateLimit(ip, PAYMENT_REQUEST_RATE_PER_SEC)) {
      res.status(429).json(messageHelper.createErrorMessage('Too many payment requests'));
      return;
    }
    let heldByIp = 0;
    // eslint-disable-next-line no-restricted-syntax
    for (const entry of pending.values()) {
      if (entry && entry.ip === ip) heldByIp += 1;
    }
    if (heldByIp >= MAX_PENDING_PER_IP) {
      res.status(429).json(messageHelper.createErrorMessage('Too many pending payment requests'));
      return;
    }
    // Unguessable, because the id is the only thing the wallet's callback is
    // held to: whoever holds a live one can leave a transaction id for the
    // browser waiting on it.
    const paymentId = `${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    // The address is kept so a later request can count what this source already
    // holds.
    pending.set(paymentId, { txid: null, ip });
    res.json(messageHelper.createDataMessage({ paymentId }));
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
  }
}

/**
 * Leaves a wallet's transaction id for the listener waiting on its id.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} payload The callback's body, however it was read.
 * @returns {void}
 */
function answerCallback(req, res, payload) {
  try {
    const txid = payload.transaction_id || payload.txid;
    const paymentId = req.query.paymentid || payload.paymentid;

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

    // The address stays with the id. It is what the issuance limit counts, and an
    // answered id still holds a slot until the browser collects it - so an id
    // answered by whoever asked for it goes on costing them their own allowance
    // rather than becoming a free slot. The remaining lifetime is carried too: a
    // meeting is an hour old from when it was made, and answering does not buy
    // another one.
    const held = pending.get(paymentId) || {};
    pending.set(paymentId, { ...held, txid }, { ttl: pending.getRemainingTTL(paymentId) || undefined });

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
}

/**
 * Takes the wallet's callback and leaves its transaction id for the listener.
 *
 * The wallet chooses its own content type, and only one parser is mounted. A
 * JSON body therefore arrives already parsed with its stream spent - waiting
 * on `end` for one waits forever, holding the connection open and answering
 * nothing - while every other type arrives unread. Which of the two happened
 * is read off the stream rather than the headers: what decides is whether
 * anything is left to read.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void}
 */
function receivePaymentCallback(req, res) {
  if (req.readableEnded) {
    answerCallback(req, res, req.body || {});
    return;
  }

  let body = '';
  let refused = false;

  req.on('data', (data) => {
    if (refused) return;
    body += data;
    if (body.length > MAX_BODY_SIZE) {
      refused = true;
      // Answered before the socket goes: a write to a destroyed socket is
      // discarded without complaint, and the caller sees a reset in place of
      // the refusal.
      res.status(413).json(messageHelper.createErrorMessage('Request body too large'));
      res.on('finish', () => req.destroy());
    }
  });

  req.on('end', () => {
    if (refused) return;
    answerCallback(req, res, serviceHelper.ensureObject(body));
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

  /* eslint-disable no-param-reassign */
  ws.onclose = (evt) => {
    log.info(`WebSocket payment listener closed with code: ${evt.code}`);
    closed = true;
    // The browser is the only party that collects an id, so one it is no longer
    // waiting on will not be collected: it is dropped rather than left holding a
    // slot, and its asker's allowance, for the rest of the hour. An id that has
    // been answered is left alone - the wallet was told the payment landed, and
    // the delivery path drops it once the browser has it.
    const held = pending.get(paymentid);
    if (held && !held.txid) pending.delete(paymentid);
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

    const held = pending.get(paymentid);

    // The id's own lifetime is the wait. A second clock here could only be
    // shorter - giving up on a wallet the id would still have accepted - or
    // longer, and therefore unreachable, because the entry is gone first.
    if (!held) {
      send(messageHelper.createErrorMessage('Payment request is no longer valid. Please request a new one.'));
      return;
    }

    if (held.txid) {
      // Delivered once, so the id is spent: dropped here rather than left to
      // time out. A later callback for it finds nothing, and its slot does not
      // hold the bound down for the rest of the hour. The txid is already in
      // hand, so the drop is safe before the send.
      pending.delete(paymentid);
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
