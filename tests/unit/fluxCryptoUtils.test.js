const { expect } = require('chai');
const bs58check = require('bs58check');

const { decodeWIF } = require('../../ZelBack/src/services/utils/fluxCryptoUtils');
const { privateKey, sameKey } = require('./data/wifFixtures');

describe('fluxCryptoUtils tests', () => {
  describe('decodeWIF tests', () => {
    sameKey.forEach(({ network, wif, compressed }) => {
      it(`should decode a ${network} ${compressed ? 'compressed' : 'uncompressed'} WIF`, () => {
        expect(decodeWIF(wif)).to.deep.equal({ privateKey, compressed });
      });
    });

    const key = Buffer.from(privateKey, 'hex');
    const malformed = [
      { shape: 'a key one byte short', payload: Buffer.concat([Buffer.from([0x80]), key.subarray(1)]) },
      { shape: 'a 34-byte payload whose last byte is not 0x01', payload: Buffer.concat([Buffer.from([0x80]), key, Buffer.from([0x02])]) },
      { shape: 'a compressed key with a byte after its flag', payload: Buffer.concat([Buffer.from([0x80]), key, Buffer.from([0x01, 0x01])]) },
    ];

    malformed.forEach(({ shape, payload }) => {
      it(`should refuse ${shape}`, () => {
        expect(() => decodeWIF(bs58check.encode(payload))).to.throw('Invalid WIF');
      });
    });

    it('should refuse a WIF whose checksum fails', () => {
      expect(() => decodeWIF('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAg')).to.throw('Invalid checksum');
    });
  });
});
