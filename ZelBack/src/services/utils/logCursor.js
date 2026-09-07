/**
 * The position a log reader has reached, as an opaque token.
 *
 * Docker's `since` is inclusive and resolves to milliseconds, so a reader cannot
 * ask for "everything after this line" - it can only ask for "everything from
 * this millisecond", and gets back the lines it already holds along with the new
 * ones. Advancing past them is what loses data: a line at .9265 is gone forever
 * to a reader that asked from .927.
 *
 * So the position is a pair - the millisecond reached, and how many lines were
 * already delivered from it. The re-read is deliberate, and the count is what
 * makes it exact: docker returns the same lines in the same order, so the first
 * `count` of them are the ones already held. Identical repeated lines within one
 * millisecond are handled by this and are not handled by comparing text.
 *
 * Opaque on the wire because clients and nodes upgrade independently: a reader
 * hands back what it was given without reading it, so this shape can change
 * without every client changing with it.
 */

/**
 * @param {{ms: number, count: number}} position
 * @returns {string} the token a reader hands back
 */
function encode(position) {
  return Buffer.from(JSON.stringify({ v: 1, ms: position.ms, count: position.count })).toString('base64url');
}

/**
 * A token that is absent, truncated, from a future version, or simply not one of
 * ours is not an error - it is a reader with no position, which is answered with
 * the most recent lines the same as a first request.
 *
 * @param {string} token
 * @returns {{ms: number, count: number}|null}
 */
function decode(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (parsed.v !== 1) return null;
    if (!Number.isFinite(parsed.ms) || !Number.isInteger(parsed.count)) return null;
    if (parsed.ms < 0 || parsed.count < 0) return null;
    return { ms: parsed.ms, count: parsed.count };
  } catch (error) {
    return null;
  }
}

module.exports = { encode, decode };
