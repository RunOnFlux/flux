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
// Three keys, because the fleet's config holds a LIST and the list has a purpose:
//
//   PINNED     the key that normally signs.
//   SECONDARY  also pinned, and never used unless a suite asks for it. Production pins a
//              cold second key so signing can move to it without every node needing a
//              release first - that is the only thing a second key buys, and it is worth
//              nothing until something has actually verified against it.
//   ROGUE      a perfectly valid ed25519 key the fleet does NOT pin. The only way to test
//              an untrusted bundle: corrupting bytes gives an INVALID signature, which is
//              a different refusal from an untrusted one.
//
// These are test keys. They are in the repository on purpose and sign nothing outside a fleet
// of containers on 198.18.0.0/15.

const crypto = require('crypto');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// Ed25519 seeds are 32 bytes. Written as ASCII rather than base64 so the length is the one
// the eye counts -- the first pair of these were hand-encoded and decoded to 35.
const PINNED_SEED = 'flux-harness-policy-pinned-key01';
const SECONDARY_SEED = 'flux-harness-policy-second-key01';
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
const SECONDARY_KEY = privateKeyFromSeed(SECONDARY_SEED);
const ROGUE_KEY = privateKeyFromSeed(ROGUE_SEED);

const SIGNERS = { pinned: PINNED_KEY, secondary: SECONDARY_KEY, rogue: ROGUE_KEY };

/**
 * Build a signed bundle the way fluxos-network-policy does: the payload is signed and carried
 * as the exact bytes, so a consumer never has to agree with the signer about JSON key order.
 * @param {object} payload `{ seq, issued_at, documents, artifacts }`.
 * @param {'pinned'|'secondary'|'rogue'} [signer] Which key signs it.
 * @returns {string} The bundle as it would be served.
 */
function signBundle(payload, signer = 'pinned') {
  const key = SIGNERS[signer];
  if (!key) throw new Error(`unknown signer '${signer}'`);
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return JSON.stringify({
    payload_b64: bytes.toString('base64'),
    sig_b64: crypto.sign(null, bytes, key).toString('base64'),
  });
}

module.exports = {
  PINNED_PUBLIC_HEX: publicHex(PINNED_KEY),
  SECONDARY_PUBLIC_HEX: publicHex(SECONDARY_KEY),
  ROGUE_PUBLIC_HEX: publicHex(ROGUE_KEY),
  signBundle,
};
