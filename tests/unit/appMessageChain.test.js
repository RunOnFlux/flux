const { expect } = require('chai');
const config = require('config');
const appMessageChain = require('../../ZelBack/src/services/utils/appMessageChain');

describe('appMessageChain tests', () => {
  const fork = config.fluxapps.daemonPONFork;
  const message = (type, hash, height, expire, timestamp = height) => ({
    type, hash, height, timestamp, appSpecifications: { name: 'ChainApp', expire },
  });

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

  describe('governingAppMessage', () => {
    // dragonwilds1790467903997, in the order the renewal was SIGNED (before the 01:01 update)
    const incident = [
      message('fluxappregister', 'reg', 2985989, 20160),
      message('fluxappupdate', 'cancel', 3003260, 100),
      message('fluxappupdate', 'late', 3003381, 88072, 3003300),
      message('fluxappupdate', 'cancel2', 3003310, 56, 3003310),
    ];

    it('should skip an update that confirmed after its app expired', () => {
      expect(appMessageChain.governingAppMessage(incident).hash).to.equal('cancel2');
    });

    it('should not let anything after the expiry carry the app on', () => {
      const after = [...incident, message('fluxappupdate', 'later', 3003400, 88000)];
      expect(appMessageChain.governingAppMessage(after).hash).to.equal('cancel2');
    });

    it('should start again from a new registration of the name', () => {
      const reRegistered = [...incident, message('fluxappregister', 'newreg', 3003500, 88000), message('fluxappupdate', 'newupd', 3003600, 88000)];
      expect(appMessageChain.governingAppMessage(reRegistered).hash).to.equal('newupd');
    });

    it('should give the same answer whatever order the messages come in', () => {
      expect(appMessageChain.governingAppMessage([...incident].reverse()).hash).to.equal('cancel2');
      expect(appMessageChain.governingAppMessage([incident[2], incident[0], incident[3], incident[1]]).hash).to.equal('cancel2');
    });

    it('should only look below the given block', () => {
      expect(appMessageChain.governingAppMessage(incident, 3003310).hash).to.equal('cancel');
      expect(appMessageChain.governingAppMessage(incident, 2985989)).to.equal(null);
    });

    it('should ignore updates before any registration', () => {
      const activation = appMessageChain.expiredAppUpdatesIgnoredBlock();
      expect(appMessageChain.governingAppMessage([message('fluxappupdate', 'orphan', activation, 1000)])).to.equal(null);
    });

    describe('below the activation block (expiredAppUpdatesIgnoredBlock)', () => {
      // owncast: renewed 57 blocks after it expired in 2022, renewed ever since, alive today
      const legacy = [
        message('fluxappregister', 'reg', 1306201, 22000),
        message('fluxappupdate', 'late', 1328258, 22000),
        message('fluxappupdate', 'since', 2938092, 88000),
      ];

      it('should read the history as the network always did: the newest message carries the app on', () => {
        expect(appMessageChain.expiredAppUpdatesIgnoredBlock()).to.be.above(2938092);
        expect(appMessageChain.governingAppMessage(legacy).hash).to.equal('since');
      });

      it('should treat every update below it as in force, as promotion did before', () => {
        expect(appMessageChain.isUpdateInForce(legacy, 1328258)).to.equal(true);
      });

      it('should still end an app for an update at or after it', () => {
        const activation = appMessageChain.expiredAppUpdatesIgnoredBlock();
        const after = [message('fluxappregister', 'reg', activation, 100), message('fluxappupdate', 'late', activation + 101, 88000)];
        expect(appMessageChain.isUpdateInForce(after, activation + 101)).to.equal(false);
        expect(appMessageChain.governingAppMessage(after).hash).to.equal('reg');
      });
    });

    it('should count a registration paid in the same block as its first update as before it', () => {
      const sameBlock = [message('fluxappregister', 'reg', 3003000, 300, 10), message('fluxappupdate', 'upd', 3003000, 88000, 20)];
      expect(appMessageChain.isUpdateInForce(sameBlock, 3003000, 20)).to.equal(true);
      expect(appMessageChain.governingAppMessage(sameBlock, 3003000, 20).hash).to.equal('reg');
      // and the rebuild, which reads the whole log, ends on the update too
      expect(appMessageChain.governingAppMessage(sameBlock).hash).to.equal('upd');
    });

    it('should break a same-block tie by timestamp', () => {
      const tie = [message('fluxappregister', 'reg', 100, 88000), message('fluxappupdate', 'b', 200, 88000, 2), message('fluxappupdate', 'a', 200, 88000, 1)];
      expect(appMessageChain.governingAppMessage(tie).hash).to.equal('b');
    });
  });

  describe('isUpdateInForce', () => {
    const chain = [message('fluxappregister', 'reg', 3003000, 300)];

    it('should accept an update up to and including the last block of the app', () => {
      expect(appMessageChain.isUpdateInForce(chain, 3003300)).to.equal(true);
    });

    it('should refuse an update one block after', () => {
      expect(appMessageChain.isUpdateInForce(chain, 3003301)).to.equal(false);
    });

    it('should refuse an update with no registration', () => {
      expect(appMessageChain.isUpdateInForce([], 3003000)).to.equal(false);
    });
  });

  describe('assertUpdateConfirmsBeforeExpiry', () => {
    const app = { name: 'ChainApp', height: 3003000, expire: 1000 };
    const margin = appMessageChain.updateExpiryMarginBlocks();

    it('should allow an update with exactly the margin left', () => {
      expect(() => appMessageChain.assertUpdateConfirmsBeforeExpiry(app, 3004000 - margin)).to.not.throw();
    });

    it('should refuse one block later', () => {
      expect(() => appMessageChain.assertUpdateConfirmsBeforeExpiry(app, 3004000 - margin + 1))
        .to.throw(`expires in ${margin - 1} blocks`);
    });

    it('should cover the hour a signed update waits for its payment, with headroom', () => {
      expect(margin).to.be.at.least(120);
    });
  });
});
