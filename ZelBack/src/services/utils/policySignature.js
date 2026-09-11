const crypto = require('crypto');

// Verifies a signed policy bundle. Pure: no I/O, no config, no state -- it is handed bytes
// and a key list and answers. Everything about WHERE a bundle came from belongs to the
// caller, which is the point of signing it: once this says yes, the source stopped mattering
// and a peer is as good as github.
//
// The document is `{ payload_b64, sig_b64 }`. The signature covers the transmitted payload
// bytes rather than a re-serialisation of the parsed object, so verification never depends
// on this and the signer agreeing about JSON key order or whitespace. Parse only after the
// signature holds.
//
// Mirrors scripts/verify-policy.js in RunOnFlux/fluxos-network-policy, which is the reference
// the two are checked against.

// Ed25519 public keys are 32 raw bytes; node wants SPKI DER. The prefix is fixed for the
// algorithm, so prepending it is enough.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// A bundle is a few tens of kilobytes. Anything beyond this is a source that will not stop
// talking rather than a policy document, and reading it to the end is the cost it is trying
// to impose.
const MAX_BUNDLE_BYTES = 1024 * 1024;

function publicKeyFromHex(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  try {
    return crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return null;
  }
}

/**
 * Verify a signed policy bundle.
 *
 * Returns the parsed payload, or null. Null is the only failure signal on purpose: a caller
 * that cannot tell "forged" from "malformed" from "too old" treats all three the same way --
 * this is not a policy I can use -- and the ways of being wrong are not worth a caller
 * branching on. What went wrong goes to the log, not the return value.
 *
 * @param {Buffer|string} raw The bundle as served.
 * @param {object} options
 * @param {string[]} options.publicKeys Pinned raw ed25519 public keys, hex. A bundle signed by
 *   any one of them is accepted, so a key can be replaced without every node updating first.
 * @param {number} [options.minSeq] Refuse a bundle at or below this sequence. A source asked
 *   for something newer that answers with something older has not answered, and accepting it
 *   is indistinguishable from there being nothing newer -- which is the whole of a freeze.
 * @param {Function} [options.onReject] Called with a reason string when verification fails.
 * @returns {object|null} The payload `{ seq, issued_at, documents, artifacts }`, or null.
 */
function verifyBundle(raw, options = {}) {
  const { publicKeys = [], minSeq = 0, onReject = () => {} } = options;
  // Wrapped so the reason is reported and null is returned, always. Returning onReject's own
  // value would leak whatever the caller's logger happens to answer with.
  const reject = (reason) => { onReject(reason); };

  if (!raw || !raw.length) {
    reject('empty bundle');
    return null;
  }
  if (raw.length > MAX_BUNDLE_BYTES) {
    reject(`bundle is ${raw.length} bytes, over the ${MAX_BUNDLE_BYTES} cap`);
    return null;
  }

  const keys = publicKeys.map(publicKeyFromHex).filter(Boolean);
  if (!keys.length) {
    reject('no usable pinned public keys');
    return null;
  }

  let envelope;
  try {
    envelope = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
  } catch (error) {
    reject(`bundle is not JSON: ${error.message}`);
    return null;
  }
  if (!envelope || typeof envelope.payload_b64 !== 'string' || typeof envelope.sig_b64 !== 'string') {
    reject('bundle is not { payload_b64, sig_b64 }');
    return null;
  }

  const payload = Buffer.from(envelope.payload_b64, 'base64');
  const signature = Buffer.from(envelope.sig_b64, 'base64');
  // Checked before crypto.verify, which throws on a wrong-sized ed25519 signature rather
  // than answering false.
  if (signature.length !== 64) {
    reject(`signature is ${signature.length} bytes, not 64`);
    return null;
  }

  let verified = false;
  try {
    verified = keys.some((key) => crypto.verify(null, payload, key, signature));
  } catch (error) {
    reject(`signature check failed: ${error.message}`);
    return null;
  }
  if (!verified) {
    reject('no pinned key verifies this bundle');
    return null;
  }

  let inner;
  try {
    inner = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    reject(`signed payload is not JSON: ${error.message}`);
    return null;
  }

  if (!Number.isInteger(inner.seq) || inner.seq < 1) {
    reject(`seq is not a positive integer: ${inner.seq}`);
    return null;
  }
  if (minSeq && inner.seq < minSeq) {
    reject(`seq ${inner.seq} is below the floor of ${minSeq}`);
    return null;
  }
  if (!inner.documents || typeof inner.documents !== 'object' || Array.isArray(inner.documents)) {
    reject('documents is missing or not an object');
    return null;
  }

  return inner;
}

module.exports = {
  verifyBundle,
  MAX_BUNDLE_BYTES,
};
