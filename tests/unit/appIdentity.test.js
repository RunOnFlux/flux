const { expect } = require('chai');

const { isValidAppNameAndOwner, verifyAppNameAndOwner } = require('../../ZelBack/src/services/utils/appIdentity');

describe('appIdentity tests', () => {
  const fluxId = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
  const ethAddress = `0x${'aB3'.repeat(13)}c`;

  describe('isValidAppNameAndOwner tests', () => {
    [
      ['a Flux ID owner', 'my-app1', fluxId],
      ['an Ethereum owner', 'my-app1', ethAddress],
      ['a 63 character name', 'a'.repeat(63), fluxId],
      ['a one character name', 'a', fluxId],
    ].forEach(([description, name, owner]) => {
      it(`should accept ${description}`, () => {
        expect(isValidAppNameAndOwner(name, owner)).to.equal(true);
      });
    });

    [
      ['a name with an underscore', 'my_app', fluxId],
      ['a name with a space', 'my app', fluxId],
      ['a name starting with a hyphen', '-myapp', fluxId],
      ['a name ending with a hyphen', 'myapp-', fluxId],
      ['a name longer than 63 characters', 'a'.repeat(64), fluxId],
      ['an empty name', '', fluxId],
      ['a name that is not a string', ['myapp'], fluxId],
      ['no name', undefined, fluxId],
      ['an owner that is not a Flux ID or Ethereum address', 'myapp', 'my-owner'],
      ['an owner with a bad checksum', 'myapp', '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uD'],
      ['an Ethereum owner that is too long', 'myapp', `0x${'a'.repeat(41)}`],
      ['an owner that is not a string', 'myapp', { id: fluxId }],
      ['no owner', 'myapp', undefined],
    ].forEach(([description, name, owner]) => {
      it(`should refuse ${description}`, () => {
        expect(isValidAppNameAndOwner(name, owner)).to.equal(false);
      });
    });
  });

  describe('verifyAppNameAndOwner tests', () => {
    it('should return for a valid name and owner', () => {
      expect(() => verifyAppNameAndOwner('myapp', fluxId)).to.not.throw();
    });

    it('should throw for an invalid name', () => {
      expect(() => verifyAppNameAndOwner('my_app', fluxId)).to.throw('Invalid app name or owner');
    });

    it('should throw for an invalid owner', () => {
      expect(() => verifyAppNameAndOwner('myapp', 'my-owner')).to.throw('Invalid app name or owner');
    });
  });
});
