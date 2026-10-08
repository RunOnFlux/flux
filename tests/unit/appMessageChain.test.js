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

  // Who holds a name is decided by the chain; an owner's own messages are ordered by when the
  // owner signed them. Heights here are post-fork, with terms long enough to stay in force
  // unless a test gives a short one.
  describe('messagesThatCount', () => {
    const h = fork + 1000;
    const msg = (hash, {
      type = 'fluxappupdate', owner = 'alice', height = h, timestamp = height, expire = 100_000,
    } = {}) => ({
      hash, type, height, timestamp, appSpecifications: { name: 'app', owner, expire },
    });
    const reg = (hash, options) => msg(hash, { ...options, type: 'fluxappregister' });
    const counted = (messages, positions) => appMessageChain.messagesThatCount(messages, positions).map((m) => m.hash);

    it('counts every message of a name only one owner registers, oldest first by height then timestamp', () => {
      expect(counted([
        msg('u2', { height: h + 20, timestamp: 5 }),
        reg('r', { height: h }),
        msg('u1b', { height: h + 10, timestamp: 9 }),
        msg('u1a', { height: h + 10, timestamp: 1 }),
      ])).to.deep.equal(['r', 'u1a', 'u1b', 'u2']);
    });

    it('does not count another owner\'s registration of a name whose app is in force at its block', () => {
      expect(counted([reg('holder'), reg('taker', { owner: 'mallory', height: h + 50 })])).to.deep.equal(['holder']);
    });

    it('counts another owner\'s registration once the holder\'s term has ended at its block', () => {
      expect(counted([reg('holder', { expire: 40 }), reg('next', { owner: 'bob', height: h + 50 })])).to.deep.equal(['holder', 'next']);
    });

    it('counts the holder registering its own name again', () => {
      expect(counted([reg('first'), reg('again', { height: h + 50 })])).to.deep.equal(['first', 'again']);
    });

    it('gives a free name registered by two owners in one block to the one earliest in the block, whatever the timestamps', () => {
      const messages = [reg('signed-first', { owner: 'mallory', timestamp: 1 }), reg('signed-last', { owner: 'alice', timestamp: 9 })];
      expect(counted(messages, new Map([['signed-first', 7], ['signed-last', 3]]))).to.deep.equal(['signed-last']);
      expect(counted(messages, new Map([['signed-first', 3], ['signed-last', 7]]))).to.deep.equal(['signed-first']);
    });

    it('places a registration whose position is unknown after every one whose position is known', () => {
      const messages = [reg('unplaced', { owner: 'mallory', timestamp: 1 }), reg('placed', { owner: 'alice', timestamp: 9 })];
      expect(counted(messages, new Map([['placed', 40]]))).to.deep.equal(['placed']);
    });

    it('keeps one owner\'s messages in a block in signing order, wherever each sits in the block', () => {
      const messages = [reg('r', { height: h - 10 }), msg('signed-last', { timestamp: 20 }), msg('signed-first', { timestamp: 10 })];
      expect(counted(messages, new Map([['signed-last', 1], ['signed-first', 6]]))).to.deep.equal(['r', 'signed-first', 'signed-last']);
    });

    it('orders equal timestamps in one block by hash, the same on every node', () => {
      expect(counted([msg('b', { timestamp: 5 }), msg('a', { timestamp: 5 })])).to.deep.equal(['a', 'b']);
    });
  });

  describe('governingMessage', () => {
    const h = fork + 1000;
    const reg = (hash, owner, height) => ({
      hash, type: 'fluxappregister', height, timestamp: height, appSpecifications: { name: 'app', owner, expire: 100_000 },
    });

    it('is the newest message that counts, not the newest message', () => {
      expect(appMessageChain.governingMessage([reg('holder', 'alice', h), reg('taker', 'mallory', h + 5)]).hash).to.equal('holder');
    });

    it('is null for a name with no messages', () => {
      expect(appMessageChain.governingMessage([])).to.equal(null);
    });
  });
});
