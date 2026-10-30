const messageHelper = require('../messageHelper');

// The most characters a handler that reads its own request body will collect. The
// largest thing posted to these routes is an app specification or a raw
// transaction, well under this; what it bounds is a body that never ends, which
// as one string outgrows the longest string the runtime can hold.
const MAX_BODY_SIZE = 10 * 1024 * 1024;

// How long a refused request's socket is kept to read the rest of what is being sent.
const BODY_DRAIN_MS = 1000;

const refusedRequests = new WeakSet();

/**
 * Refuses a request whose body, as collected so far, is over the limit: a 413,
 * then the socket goes. Called from the handler's data listener, after each
 * chunk is added to `body`.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {string} body The body collected so far.
 * @param {number} [limit] The most characters this handler takes; MAX_BODY_SIZE by default.
 * @returns {boolean} Whether the request was refused.
 */
function refuseIfTooLarge(req, res, body, limit = MAX_BODY_SIZE) {
  if (body.length <= limit) return false;
  if (!refusedRequests.has(req)) {
    refusedRequests.add(req);
    // Answered before the socket goes: a write to a destroyed socket is
    // discarded without complaint, and the caller sees a reset in place of the
    // refusal.
    // The handler's own listeners must not run on what is left of the body: its
    // end callback would answer a second time. They are silenced rather than
    // removed, as other listeners on the request are not ours to take away.
    const emit = req.emit.bind(req);
    // eslint-disable-next-line no-param-reassign
    req.emit = (event, ...args) => (event === 'data' || event === 'end' ? false : emit(event, ...args));
    if (res.headersSent) {
      req.destroy();
    } else {
      res.set('Connection', 'close');
      res.status(413).json(messageHelper.createErrorMessage('Request body too large'));
      // what the client is still sending is read and dropped for a moment, so that the
      // refusal arrives before the reset that destroying a busy socket sends
      res.on('finish', () => {
        req.resume();
        setTimeout(() => req.destroy(), BODY_DRAIN_MS).unref();
      });
    }
  }
  return true;
}

module.exports = {
  MAX_BODY_SIZE,
  refuseIfTooLarge,
};
