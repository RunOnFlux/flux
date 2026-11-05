const crypto = require('crypto');
const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const installedSecp256k1 = require('secp256k1');
const pureJsSecp256k1 = require('secp256k1/elliptic');

const { privKeyToPubKey, pubKeyToAddr } = require('../../ZelBack/src/services/utils/fluxCryptoUtils');
const fixtures = require('./data/bitcoinMessageFixtures.json');

// A node with no binding for its platform loads secp256k1's pure-JS build, and
// every node must accept and refuse the same signatures, so each case runs on both.
const backends = [
  { name: 'installed secp256k1', secp256k1: installedSecp256k1 },
  { name: 'pure-JS secp256k1', secp256k1: pureJsSecp256k1 },
];

function messageOf(fixture) {
  if (typeof fixture === 'string') return fixture;
  if (fixture.hex !== undefined) return Buffer.from(fixture.hex, 'hex');
  return fixture.repeat.repeat(fixture.count);
}

function outcome(fn) {
  try {
    return String(fn());
  } catch {
    return 'throw';
  }
}

backends.forEach(({ name, secp256k1 }) => {
  const bitcoinMessage = proxyquire('../../ZelBack/src/services/utils/bitcoinMessage', { secp256k1 });

  describe(`bitcoinMessage tests (${name})`, () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should sign and verify through this backend', () => {
      const ecdsaSign = sinon.spy(secp256k1, 'ecdsaSign');
      const ecdsaRecover = sinon.spy(secp256k1, 'ecdsaRecover');
      const privateKey = Buffer.alloc(32, 7);
      const address = pubKeyToAddr(privKeyToPubKey(privateKey.toString('hex'), true), '00');

      const signature = bitcoinMessage.sign('backend message', privateKey, true, crypto.randomBytes(32));
      bitcoinMessage.verify('backend message', address, signature);

      sinon.assert.calledOnce(ecdsaSign);
      sinon.assert.calledOnce(ecdsaRecover);
    });

    describe('verify tests', () => {
      fixtures.verify.forEach(({
        tag, message, address, signature, expected,
      }, i) => {
        it(`should answer ${expected} for case ${i} (${tag})`, () => {
          expect(outcome(() => bitcoinMessage.verify(messageOf(message), address, signature))).to.equal(expected);
        });
      });
    });

    describe('sign tests', () => {
      fixtures.sign.forEach(({
        message, privateKey, compressed, extraEntropy, signature,
      }, i) => {
        it(`should produce the reference signature for case ${i}`, () => {
          const signed = bitcoinMessage.sign(messageOf(message), Buffer.from(privateKey, 'hex'), compressed, Buffer.from(extraEntropy, 'hex'));
          expect(signed.toString('base64')).to.equal(signature);
        });
      });

      [true, false].forEach((compressed) => {
        it(`should sign with fresh entropy so the ${compressed ? 'compressed' : 'uncompressed'} key's address verifies it`, () => {
          const privateKey = Buffer.alloc(32, 7);
          const address = pubKeyToAddr(privKeyToPubKey(privateKey.toString('hex'), compressed), '00');
          const signature = bitcoinMessage.sign('fresh message', privateKey, compressed, crypto.randomBytes(32));
          expect(bitcoinMessage.verify('fresh message', address, signature)).to.equal(true);
          expect(bitcoinMessage.verify('fresh message.', address, signature)).to.equal(false);
        });
      });
    });
  });
});
