const { expect } = require('chai');
const config = require('config');
const appMessageChain = require('../../ZelBack/src/services/utils/appMessageChain');

describe('appMessageChain tests', () => {
  const fork = config.fluxapps.daemonPONFork;

  describe('appExpirationHeight', () => {
    it('should add expire to a post-fork height', () => {
      expect(appMessageChain.appExpirationHeight(fork + 100, 1000)).to.equal(fork + 1100);
    });

    it('should count the post-fork tail of a pre-fork registration 4x', () => {
      expect(appMessageChain.appExpirationHeight(fork - 100, 300)).to.equal(fork + 800);
    });

    it('should leave a pre-fork app that ended before the fork alone', () => {
      expect(appMessageChain.appExpirationHeight(fork - 1000, 500)).to.equal(fork - 500);
    });

    it('should use the default lifetime when expire is missing', () => {
      expect(appMessageChain.appExpirationHeight(fork + 1, undefined)).to.equal(fork + 1 + (config.fluxapps.blocksLasting * 4));
    });
  });

  describe('isInForce', () => {
    it('should end an app at its expiration height', () => {
      expect(appMessageChain.isInForce(fork + 100, 1000, fork + 1099)).to.equal(true);
      expect(appMessageChain.isInForce(fork + 100, 1000, fork + 1100)).to.equal(false);
    });
  });

  describe('isBefore', () => {
    const at = (height, timestamp) => ({ height, timestamp });

    it('should put an earlier block before', () => {
      expect(appMessageChain.isBefore(at(99, 500), 100, 1)).to.equal(true);
    });

    it('should put a later block after', () => {
      expect(appMessageChain.isBefore(at(101, 1), 100, 500)).to.equal(false);
    });

    it('should order a same-block pair by timestamp', () => {
      expect(appMessageChain.isBefore(at(100, 10), 100, 20)).to.equal(true);
      expect(appMessageChain.isBefore(at(100, 20), 100, 10)).to.equal(false);
      expect(appMessageChain.isBefore(at(100, 20), 100, 20)).to.equal(false);
    });

    it('should leave the whole block out without a timestamp', () => {
      expect(appMessageChain.isBefore(at(100, 0), 100)).to.equal(false);
    });
  });
});
