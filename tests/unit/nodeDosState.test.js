const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('nodeDosState tests', () => {
  let nodeDosState;
  let publishStub;

  // proxyquire bypasses the require cache, so each load is a fresh module with
  // its state at the defaults.
  function loadModule() {
    publishStub = sinon.stub();
    return proxyquire('../../ZelBack/src/services/nodeDosState', {
      './utils/fluxEventBus': { publish: publishStub },
      '../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
    });
  }

  beforeEach(() => {
    nodeDosState = loadModule();
  });

  describe('the shared score', () => {
    it('starts at zero', () => {
      expect(nodeDosState.getDosStateValue()).to.equal(0);
    });

    it('sets the value and publishes the state a reader sees', () => {
      nodeDosState.setDosStateValue(42);
      expect(nodeDosState.getDosStateValue()).to.equal(42);
      sinon.assert.calledOnceWithExactly(publishStub, 'dos:changed', { dosState: 42, dosMessage: null });
    });

    it('adds a delta', () => {
      nodeDosState.addDosState(11);
      nodeDosState.addDosState(2);
      expect(nodeDosState.getDosStateValue()).to.equal(13);
      sinon.assert.calledWithExactly(publishStub.secondCall, 'dos:changed', { dosState: 13, dosMessage: null });
    });

    it('sets the score and its message as one write', () => {
      nodeDosState.setDos(100, 'collision');
      sinon.assert.calledOnceWithExactly(publishStub, 'dos:changed', { dosState: 100, dosMessage: 'collision' });
    });
  });

  describe('the message', () => {
    it('starts null', () => {
      expect(nodeDosState.getRawDosMessage()).to.equal(null);
      expect(nodeDosState.getDosMessage()).to.equal(null);
    });

    it('sets the message and publishes', () => {
      nodeDosState.setDosMessage('a reason');
      expect(nodeDosState.getRawDosMessage()).to.equal('a reason');
      sinon.assert.calledOnceWithExactly(publishStub, 'dos:changed', { dosState: 0, dosMessage: 'a reason' });
    });
  });

  describe('the availability points', () => {
    it('add to the score in what a reader sees, and leave the score itself alone', () => {
      nodeDosState.setDosStateValue(5);
      nodeDosState.addUnreachablePoints(2);
      nodeDosState.addShortfallPoints(0.5);
      expect(nodeDosState.effectiveDosState()).to.equal(7.5);
      expect(nodeDosState.getDosStateValue()).to.equal(5);
      expect(nodeDosState.getShortfallPoints()).to.equal(0.5);
    });

    // A check that resets the shared score must not wipe what the availability
    // check counted, nor the other way round.
    it('outlive a reset of the score, and clear one kind at a time', () => {
      nodeDosState.addUnreachablePoints(60);
      nodeDosState.addShortfallPoints(50);
      nodeDosState.setDosStateValue(0);
      expect(nodeDosState.isNodeDos()).to.equal(true);
      nodeDosState.clearUnreachablePoints();
      expect(nodeDosState.effectiveDosState()).to.equal(50);
      nodeDosState.clearShortfallPoints();
      expect(nodeDosState.effectiveDosState()).to.equal(0);
    });
  });

  describe('sticky DOS, held by owner', () => {
    const owners = () => nodeDosState.StickyDosOwner;

    it('reports no reason while no owner holds the node', () => {
      expect(nodeDosState.getStickyDosMessage()).to.equal(null);
      expect(nodeDosState.isNodeDos()).to.equal(false);
    });

    it('takes precedence over the score\'s message in the effective getter only', () => {
      nodeDosState.setDosMessage('regular reason');
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'sticky reason');
      expect(nodeDosState.getRawDosMessage()).to.equal('regular reason');
      expect(nodeDosState.getDosMessage()).to.equal('sticky reason');
    });

    // An availability pass ends a good run this way. A verdict that went with it
    // would let the node walk back into service with its condition in place.
    it('is not released by setDosMessage(null) or a zero score', () => {
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'sticky reason');
      nodeDosState.setDos(0, null);
      expect(nodeDosState.getDosData()).to.deep.equal({ dosState: 100, dosMessage: 'sticky reason' });
    });

    it('releases the owner that let go', () => {
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'tampering flag');
      nodeDosState.clearStickyDos(owners().APP_TAMPERING);
      expect(nodeDosState.isNodeDos()).to.equal(false);
      expect(nodeDosState.isStickyDosHeldBy(owners().APP_TAMPERING)).to.equal(false);
    });

    it('names every reason, because an operator has to lift all of them', () => {
      nodeDosState.setStickyDos(owners().RESIDENTIAL_DOS, 'residential');
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'tampering');
      expect(nodeDosState.getStickyDosMessage()).to.equal('residential; tampering');
    });

    it('keeps the node out of service while any other owner still holds it', () => {
      nodeDosState.setStickyDos(owners().RESIDENTIAL_DOS, 'residential');
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'tampering');
      nodeDosState.clearStickyDos(owners().RESIDENTIAL_DOS);
      expect(nodeDosState.isNodeDos(), 'one owner released the node for both').to.equal(true);
      expect(nodeDosState.getStickyDosMessage()).to.equal('tampering');
    });

    it('refuses an owner it does not know, rather than minting one', () => {
      expect(() => nodeDosState.setStickyDos('someFeature', 'a reason')).to.throw('unknown owner');
      expect(nodeDosState.isNodeDos()).to.equal(false);
    });

    it('says nothing when an owner restates the reason it already holds', () => {
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'sticky reason');
      const published = publishStub.callCount;
      nodeDosState.setStickyDos(owners().APP_TAMPERING, 'sticky reason');
      expect(publishStub.callCount).to.equal(published);
    });
  });

  describe('onStickyDos', () => {
    it('is told of an owner newly holding the node, and of each that already does', () => {
      nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.RESIDENTIAL_DOS, 'residential');
      const listener = sinon.stub();
      nodeDosState.onStickyDos(listener);
      sinon.assert.calledOnceWithExactly(listener, 'residentialDos', 'residential');
      nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.HOST_STALL, 'stalled');
      sinon.assert.calledWithExactly(listener.secondCall, 'hostStall', 'stalled');
      nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.HOST_STALL, 'stalled longer');
      expect(listener.callCount, 'a new reason from an owner already holding is not a new hold').to.equal(2);
    });

    it('stops when asked', () => {
      const listener = sinon.stub();
      const stop = nodeDosState.onStickyDos(listener);
      stop();
      nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.HOST_STALL, 'stalled');
      sinon.assert.notCalled(listener);
    });
  });

  describe('onNodeDos and onNodeDosCleared', () => {
    it('tell each crossing of the limit once, in either direction', () => {
      const entered = sinon.stub();
      const cleared = sinon.stub();
      nodeDosState.onNodeDos(entered);
      nodeDosState.onNodeDosCleared(cleared);

      nodeDosState.setDosStateValue(99);
      sinon.assert.notCalled(entered);
      nodeDosState.setDos(100, 'collision');
      sinon.assert.calledOnceWithExactly(entered, 'collision');
      nodeDosState.addDosState(50);
      nodeDosState.setDosMessage('still out of service');
      sinon.assert.calledOnce(entered);
      sinon.assert.notCalled(cleared);

      nodeDosState.setDos(0, null);
      sinon.assert.calledOnce(cleared);
      nodeDosState.setDosStateValue(100);
      sinon.assert.calledTwice(entered);
    });

    it('count the availability points toward the limit', () => {
      const entered = sinon.stub();
      nodeDosState.onNodeDos(entered);
      nodeDosState.addUnreachablePoints(98);
      sinon.assert.notCalled(entered);
      nodeDosState.addShortfallPoints(2);
      sinon.assert.calledOnce(entered);
    });

    it('tell an owner taking the node out of service, and not a second owner joining it', () => {
      const entered = sinon.stub();
      const cleared = sinon.stub();
      nodeDosState.onNodeDos(entered);
      nodeDosState.onNodeDosCleared(cleared);
      nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.APP_TAMPERING, 'tampering');
      nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.RESIDENTIAL_DOS, 'residential');
      sinon.assert.calledOnceWithExactly(entered, 'tampering');
      nodeDosState.clearStickyDos(nodeDosState.StickyDosOwner.APP_TAMPERING);
      sinon.assert.notCalled(cleared);
      nodeDosState.clearStickyDos(nodeDosState.StickyDosOwner.RESIDENTIAL_DOS);
      sinon.assert.calledOnce(cleared);
    });

    // A listener that reacts by writing the state again is told nothing twice:
    // the crossing is recorded before anyone is told of it.
    it('tell a crossing once when a listener writes the state in response', () => {
      const entered = sinon.stub().callsFake(() => {
        nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.HOST_STALL, 'held');
      });
      nodeDosState.onNodeDos(entered);
      nodeDosState.setDosStateValue(100);
      sinon.assert.calledOnce(entered);
      expect(nodeDosState.isStickyDosHeldBy(nodeDosState.StickyDosOwner.HOST_STALL)).to.equal(true);
    });

    it('a listener that throws does not stop the write or the other listeners', () => {
      const bad = sinon.stub().throws(new Error('boom'));
      const good = sinon.stub();
      nodeDosState.onNodeDos(bad);
      nodeDosState.onNodeDos(good);
      nodeDosState.setDosStateValue(100);
      sinon.assert.calledOnce(good);
      expect(nodeDosState.getDosStateValue()).to.equal(100);
    });

    it('stop when asked', () => {
      const entered = sinon.stub();
      const cleared = sinon.stub();
      nodeDosState.onNodeDos(entered)();
      nodeDosState.onNodeDosCleared(cleared)();
      nodeDosState.setDosStateValue(100);
      nodeDosState.setDosStateValue(0);
      sinon.assert.notCalled(entered);
      sinon.assert.notCalled(cleared);
    });
  });
});
