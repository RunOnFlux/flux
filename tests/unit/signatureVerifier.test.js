const { expect } = require('chai');

const signatureVerifier = require('../../ZelBack/src/services/signatureVerifier');

describe('signatureVerifier tests', () => {
  describe('isValidSigningIdentity tests', () => {
    it('should accept a Flux ID', () => {
      expect(signatureVerifier.isValidSigningIdentity('1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEg')).to.equal(true);
    });

    it('should accept an ethereum address', () => {
      expect(signatureVerifier.isValidSigningIdentity('0x2b8e7f6e8f0b6f4c6f8e2b8e7f6e8f0b6f4c6f8e')).to.equal(true);
    });

    it('should reject an arbitrary string', () => {
      expect(signatureVerifier.isValidSigningIdentity('TrippleCore')).to.equal(false);
    });

    it('should reject a Flux ID whose checksum does not hold', () => {
      expect(signatureVerifier.isValidSigningIdentity('1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEh')).to.equal(false);
    });

    it('should reject a Flux ID carrying characters outside the base58 alphabet', () => {
      expect(signatureVerifier.isValidSigningIdentity('1Jwh4djGdRPvgLwXNGsGC0PE7uu4vihbEg')).to.equal(false);
    });

    it('should reject an address that is too short or too long', () => {
      expect(signatureVerifier.isValidSigningIdentity('1Jwh4djGdRPvg')).to.equal(false);
      expect(signatureVerifier.isValidSigningIdentity('1Jwh4djGdRPvgLwXNGsGCoPE7uu4vihbEgZ12')).to.equal(false);
    });

    it('should reject an ethereum address of the wrong width', () => {
      expect(signatureVerifier.isValidSigningIdentity('0x2b8e7f6e8f0b6f4c6f8e2b8e7f6e8f0b6f4c6f')).to.equal(false);
    });

    it('should reject a public key, which verifySignature accepts but no login can hold', () => {
      expect(signatureVerifier.isValidSigningIdentity('04a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd5b8dec5235a0fa8722476c7709c02559e3aa73aa03918ba2d492eea75abea235')).to.equal(false);
    });

    it('should reject empty and non string input', () => {
      expect(signatureVerifier.isValidSigningIdentity('')).to.equal(false);
      expect(signatureVerifier.isValidSigningIdentity(undefined)).to.equal(false);
      expect(signatureVerifier.isValidSigningIdentity(null)).to.equal(false);
      expect(signatureVerifier.isValidSigningIdentity(12345)).to.equal(false);
    });
  });
});
