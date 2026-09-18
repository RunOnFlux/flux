const { expect } = require('chai');
const crypto = require('crypto');

const { verifyBundle, MAX_BUNDLE_BYTES } = require('../../ZelBack/src/services/utils/policySignature');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function makeKeypair() {
  const seed = crypto.randomBytes(32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicHex = crypto.createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('hex');
  return { privateKey, publicHex };
}

function sign(privateKey, inner) {
  const payload = Buffer.from(JSON.stringify(inner), 'utf8');
  return JSON.stringify({
    payload_b64: payload.toString('base64'),
    sig_b64: crypto.sign(null, payload, privateKey).toString('base64'),
  });
}

function payload(overrides = {}) {
  return {
    seq: 7,
    issued_at: '2026-09-11T10:42:16.331Z',
    documents: { blockedrepositories: ['a/b'], enterprisenodes: { pubA: ['ownerA'] } },
    artifacts: { 'iplocation.bin.gz': { file: 'iplocation-deadbeef.bin.gz', sha256: 'deadbeef', bytes: 10 } },
    ...overrides,
  };
}

describe('policySignature', () => {
  let key;
  let other;
  let rejections;
  let onReject;

  beforeEach(() => {
    key = makeKeypair();
    other = makeKeypair();
    rejections = [];
    onReject = (reason) => rejections.push(reason);
  });

  describe('verifyBundle', () => {
    it('returns the payload for a bundle signed by a pinned key', () => {
      const result = verifyBundle(sign(key.privateKey, payload()), { publicKeys: [key.publicHex], onReject });
      expect(result.seq).to.equal(7);
      expect(result.documents.blockedrepositories).to.deep.equal(['a/b']);
      expect(rejections).to.deep.equal([]);
    });

    it('accepts a bundle signed by ANY pinned key', () => {
      // What makes a key replaceable without every node updating first.
      const result = verifyBundle(sign(other.privateKey, payload()), {
        publicKeys: [key.publicHex, other.publicHex],
        onReject,
      });
      expect(result).to.not.equal(null);
    });

    it('refuses a bundle signed by a key that is not pinned', () => {
      const result = verifyBundle(sign(other.privateKey, payload()), { publicKeys: [key.publicHex], onReject });
      expect(result).to.equal(null);
      expect(rejections[0]).to.include('no pinned key verifies');
    });

    it('refuses a payload altered after signing', () => {
      const bundle = JSON.parse(sign(key.privateKey, payload()));
      const raw = Buffer.from(bundle.payload_b64, 'base64');
      raw[20] ^= 1; // one bit
      bundle.payload_b64 = raw.toString('base64');

      const result = verifyBundle(JSON.stringify(bundle), { publicKeys: [key.publicHex], onReject });
      expect(result).to.equal(null);
      expect(rejections[0]).to.include('no pinned key verifies');
    });

    it('refuses a bundle at or below the sequence floor', () => {
      // A source asked for something newer that answers with something older has not
      // answered. Accepting it is indistinguishable from there being nothing newer.
      const result = verifyBundle(sign(key.privateKey, payload({ seq: 6 })), {
        publicKeys: [key.publicHex], minSeq: 7, onReject,
      });
      expect(result).to.equal(null);
      expect(rejections[0]).to.include('below the floor');
    });

    it('accepts a bundle at the floor when asked for that floor exactly', () => {
      const result = verifyBundle(sign(key.privateKey, payload({ seq: 7 })), {
        publicKeys: [key.publicHex], minSeq: 7, onReject,
      });
      expect(result).to.not.equal(null);
    });

    it('refuses a signature of the wrong length rather than throwing', () => {
      // crypto.verify throws on a wrong-sized ed25519 signature instead of answering false,
      // and a throw here would reach a caller that has no reason to expect one.
      const bundle = JSON.parse(sign(key.privateKey, payload()));
      bundle.sig_b64 = Buffer.alloc(10).toString('base64');
      const result = verifyBundle(JSON.stringify(bundle), { publicKeys: [key.publicHex], onReject });
      expect(result).to.equal(null);
      expect(rejections[0]).to.include('not 64');
    });

    it('refuses a bundle over the size cap without parsing it', () => {
      const huge = Buffer.alloc(MAX_BUNDLE_BYTES + 1, 0x20);
      const result = verifyBundle(huge, { publicKeys: [key.publicHex], onReject });
      expect(result).to.equal(null);
      expect(rejections[0]).to.include('over the');
    });

    it('refuses when no pinned key is usable', () => {
      const result = verifyBundle(sign(key.privateKey, payload()), { publicKeys: ['not-a-key', ''], onReject });
      expect(result).to.equal(null);
      expect(rejections[0]).to.include('no usable pinned public keys');
    });

    it('refuses an empty or non-JSON bundle', () => {
      expect(verifyBundle('', { publicKeys: [key.publicHex], onReject })).to.equal(null);
      expect(verifyBundle('not json', { publicKeys: [key.publicHex], onReject })).to.equal(null);
      expect(verifyBundle('{"a":1}', { publicKeys: [key.publicHex], onReject })).to.equal(null);
    });

    it('refuses a verified payload whose seq is not a positive integer', () => {
      // The signature holding does not make the contents sane: a signer that emitted seq 0
      // or a string would otherwise be trusted because it signed it.
      [0, -1, '7', null].forEach((seq) => {
        const result = verifyBundle(sign(key.privateKey, payload({ seq })), { publicKeys: [key.publicHex], onReject });
        expect(result, `seq ${JSON.stringify(seq)}`).to.equal(null);
      });
    });

    it('refuses a verified payload with no documents object', () => {
      [undefined, null, [], 'x'].forEach((documents) => {
        const result = verifyBundle(sign(key.privateKey, payload({ documents })), { publicKeys: [key.publicHex], onReject });
        expect(result, `documents ${JSON.stringify(documents)}`).to.equal(null);
      });
    });
  });
});
