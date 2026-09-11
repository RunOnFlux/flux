// The harness's policy signing keys, and the bundle builder that uses them.
//
// It lives here, in the stub's build context, because the stub is what signs: it holds the
// documents, so a suite that changes one gets a bundle carrying the change without having to
// rebuild and re-sign anything itself. Docker builds this directory as its own context, so a
// shared module under test-infra/config could not be copied in.
//
// test-env.js imports this on the HOST to write PINNED_PUBLIC_HEX into each node's
// config.policy.publicKeys. That is why the keys are fixed rather than generated: the config
// is written before the stub is running. Importing the value rather than restating it is what
// stops the two drifting -- a literal in shared.js would be a second place to change.
//
// PINNED is what the fleet's config trusts. ROGUE is a perfectly valid ed25519 key that the
// fleet does not trust, which is the only way to test the case that matters -- a bundle whose
// signature is real and whose signer is not ours. It cannot be faked by corrupting bytes,
// because that produces an invalid signature rather than an untrusted one.
//
// These are test keys. They are in the repository on purpose and sign nothing outside a fleet
// of containers on 198.18.0.0/15.

const crypto = require('crypto');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// Ed25519 seeds are 32 bytes. Written as ASCII rather than base64 so the length is the one
// the eye counts -- the first pair of these were hand-encoded and decoded to 35.
const PINNED_SEED = 'flux-harness-policy-pinned-key01';
const ROGUE_SEED = 'flux-harness-policy-rogue-key001';

function privateKeyFromSeed(seedAscii) {
  const seed = Buffer.from(seedAscii, 'ascii');
  if (seed.length !== 32) throw new Error(`harness signing seed must be 32 bytes, got ${seed.length}`);
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicHex(privateKey) {
  return crypto.createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('hex');
}

const PINNED_KEY = privateKeyFromSeed(PINNED_SEED);
const ROGUE_KEY = privateKeyFromSeed(ROGUE_SEED);

/**
 * Build a signed bundle the way fluxos-network-policy does: the payload is signed and carried
 * as the exact bytes, so a consumer never has to agree with the signer about JSON key order.
 * @param {object} payload `{ seq, issued_at, documents, artifacts }`.
 * @param {boolean} [rogue] Sign with the key the fleet does NOT pin.
 * @returns {string} The bundle as it would be served.
 */
function signBundle(payload, rogue = false) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return JSON.stringify({
    payload_b64: bytes.toString('base64'),
    sig_b64: crypto.sign(null, bytes, rogue ? ROGUE_KEY : PINNED_KEY).toString('base64'),
  });
}

module.exports = {
  PINNED_PUBLIC_HEX: publicHex(PINNED_KEY),
  ROGUE_PUBLIC_HEX: publicHex(ROGUE_KEY),
  signBundle,
};
