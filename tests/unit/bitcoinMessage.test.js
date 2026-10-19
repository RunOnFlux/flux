const crypto = require('crypto');
const { expect } = require('chai');

const bitcoinMessage = require('../../ZelBack/src/services/utils/bitcoinMessage');
const { privKeyToPubKey, pubKeyToAddr } = require('../../ZelBack/src/services/utils/fluxCryptoUtils');
const fixtures = require('./data/bitcoinMessageFixtures.json');

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

describe('bitcoinMessage tests', () => {
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
