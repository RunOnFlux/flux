const messageHelper = require('../messageHelper');

// The most characters a handler that reads its own request body will collect. The
// largest thing posted to these routes is an app specification or a raw
// transaction, well under this; what it bounds is a body that never ends, which
// as one string outgrows the longest string the runtime can hold.
const MAX_BODY_SIZE = 10 * 1024 * 1024;

const refusedRequests = new WeakSet();

/**
 * Refuses a request whose body, as collected so far, is over MAX_BODY_SIZE: a
 * 413, then the socket goes. Called from the handler's data listener, after each
 * chunk is added to `body`.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {string} body The body collected so far.
 * @returns {boolean} Whether the request was refused.
 */
function refuseIfTooLarge(req, res, body) {
  if (body.length <= MAX_BODY_SIZE) return false;
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
      res.status(413).json(messageHelper.createErrorMessage('Request body too large'));
      res.on('finish', () => req.destroy());
    }
  }
  return true;
}

module.exports = {
  MAX_BODY_SIZE,
  refuseIfTooLarge,
};
