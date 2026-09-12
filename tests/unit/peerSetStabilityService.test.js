const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();

describe('peerSetStabilityService', () => {
  let service;
  let clock;
  let peerEmitter;
  let logStub;
  let sticky;
  let stickyValue;
  let fluxNetworkHelperStub;

  // The real sticky slot, not a pair of spies: the whole ownership rule is
  // "read it back and see whose message is in it", and a stub that records
  // calls without holding a value cannot exercise a rule about reading it back.
  function makeNetworkHelper() {
    sticky = null;
    stickyValue = 0;
    return {
      getStickyDosMessage: sinon.stub().callsFake(() => sticky),
      setStickyDosMessage: sinon.stub().callsFake((m) => { sticky = m; }),
      setStickyDosStateValue: sinon.stub().callsFake((v) => { stickyValue = v; }),
      clearStickyDosMessage: sinon.stub().callsFake(() => { sticky = null; stickyValue = 0; }),
    };
  }

  function load(fluxappsOverrides) {
    const realConfig = require('config');
    return proxyquire('../../ZelBack/src/services/peerSetStabilityService', {
      config: { ...realConfig, fluxapps: { ...realConfig.fluxapps, ...fluxappsOverrides } },
      '../lib/log': logStub,
      './fluxNetworkHelper': fluxNetworkHelperStub,
      './utils/fluxEventBus': { publish: sinon.stub() },
    });
  }

  function startService(svc, { alreadyUp = false } = {}) {
    svc.start({
      onPeerEvent: (event, cb) => peerEmitter.on(event, cb),
      offPeerEvent: (event, cb) => peerEmitter.removeListener(event, cb),
      peerCountIfAboveThreshold: () => (alreadyUp ? 12 : 0),
    });
  }

  // A collapse and a recovery, as FluxPeerManager emits them.
  function dipAndRecover(svc, { deliberate = false } = {}) {
    peerEmitter.emit('peersBelowThreshold', 2, { deliberate });
    peerEmitter.emit('peerThresholdReached', 12);
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_600_000_000_000, shouldAdvanceTime: false });
    peerEmitter = new EventEmitter();
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    fluxNetworkHelperStub = makeNetworkHelper();
    service = load({ peerSetDipDosThreshold: 5, peerSetDipWindowMinutes: 120 });
  });

  afterEach(() => {
    service.stop();
    clock.restore();
    sinon.restore();
  });

  describe('what counts as a dip', () => {
    it('does not DOS the node below the threshold, however close', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 4; i += 1) dipAndRecover(service);

      expect(service.isDosActive(), 'four collapses is not five').to.equal(false);
      expect(sticky).to.equal(null);
    });

    it('puts the node out of service on the fifth collapse inside the window', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(service.isDosActive()).to.equal(true);
      expect(sticky).to.contain(service.DOS_MESSAGE_PREFIX);
      expect(stickyValue, 'a DOS below 100 leaves isNodeDos() false and removes nothing').to.equal(100);
    });

    it('names the count and the window, because the operator has to act on it', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(sticky).to.contain('5 times');
      expect(sticky).to.contain('120 minutes');
    });

    // disconnectAll() on confirmation loss crosses the same edge and is this
    // node's own doing. nodeStatusMonitor already removes the apps of an
    // unconfirmed node; counting the teardown here would punish it twice for
    // one fault.
    it('does not count a teardown this node performed on itself', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 10; i += 1) dipAndRecover(service, { deliberate: true });

      expect(service.isDosActive(), 'our own teardown was counted as instability').to.equal(false);
      expect(service.dipCount()).to.equal(0);
    });

    it('counts a real collapse that follows a deliberate one', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 4; i += 1) dipAndRecover(service, { deliberate: true });
      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(service.isDosActive()).to.equal(true);
    });
  });

  describe('the window is rolling', () => {
    it('forgets a collapse once it has aged out', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 4; i += 1) dipAndRecover(service);
      // Past the window, so the four above are no longer inside it.
      clock.tick(service.WINDOW_MS + 1000);
      dipAndRecover(service);

      expect(service.isDosActive(), 'a fifth collapse two hours later is not a pattern').to.equal(false);
    });

    it('fires when five land inside the window even though they are spread across it', () => {
      startService(service, { alreadyUp: true });

      // One every 25 minutes: the fifth is 100 minutes after the first, inside
      // the 120-minute window.
      for (let i = 0; i < 5; i += 1) {
        dipAndRecover(service);
        if (i < 4) clock.tick(25 * 60 * 1000);
      }

      expect(service.isDosActive()).to.equal(true);
    });

    it('keeps no more timestamps than the threshold needs', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 40; i += 1) dipAndRecover(service);

      expect(service.dipCount(), 'the tally grew without bound').to.equal(service.DIP_THRESHOLD);
    });
  });

  describe('coming back needs positive evidence, not just quiet', () => {
    function dosTheNode() {
      startService(service, { alreadyUp: true });
      for (let i = 0; i < 5; i += 1) dipAndRecover(service);
      expect(service.isDosActive()).to.equal(true);
    }

    it('holds the DOS while any collapse is still inside the window', () => {
      dosTheNode();

      clock.tick(service.WINDOW_MS - 60 * 1000);

      expect(service.isDosActive(), 'released before the window had passed').to.equal(true);
      expect(sticky).to.not.equal(null);
    });

    it('releases once the peer set has been up for the whole window', () => {
      dosTheNode();

      clock.tick(service.WINDOW_MS + service.EVALUATE_INTERVAL_MS);

      expect(service.isDosActive()).to.equal(false);
      expect(sticky, 'the slot was not given back').to.equal(null);
    });

    // A node that is out of service loses confirmation, drops every peer, and
    // then cannot dip because it has none. Quiet is what that node looks like,
    // and it is not evidence of anything.
    it('does not release a node whose peer set never came back', () => {
      dosTheNode();
      peerEmitter.emit('peersBelowThreshold', 0, { deliberate: false });

      clock.tick(service.WINDOW_MS * 2);

      expect(service.isDosActive(), 'a node with no peers at all was declared stable').to.equal(true);
    });
  });

  describe('the single sticky slot has one owner at a time', () => {
    it('leaves another owner\'s DOS alone', () => {
      sticky = 'Residential node not running ArcaneOS. Migrate this node.';
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(sticky, 'took a slot another owner was holding').to.contain('Residential');
      expect(service.isDosActive()).to.equal(false);
    });

    it('does not clear a slot that is no longer ours', () => {
      startService(service, { alreadyUp: true });
      for (let i = 0; i < 5; i += 1) dipAndRecover(service);
      // Another owner takes the slot while we hold our claim.
      sticky = 'Node flagged via tampering blocklist: score 40';

      clock.tick(service.WINDOW_MS + service.EVALUATE_INTERVAL_MS);

      expect(sticky, 'dropped another owner\'s DOS on the floor').to.contain('tampering');
      expect(service.isDosActive()).to.equal(false);
    });
  });

  describe('the thresholds are configuration', () => {
    it('honours a threshold other than five', () => {
      service.stop();
      service = load({ peerSetDipDosThreshold: 2, peerSetDipWindowMinutes: 120 });
      startService(service, { alreadyUp: true });

      dipAndRecover(service);
      expect(service.isDosActive()).to.equal(false);
      dipAndRecover(service);

      expect(service.isDosActive()).to.equal(true);
    });

    it('honours a window other than two hours', () => {
      service.stop();
      service = load({ peerSetDipDosThreshold: 2, peerSetDipWindowMinutes: 5 });
      startService(service, { alreadyUp: true });

      dipAndRecover(service);
      clock.tick(6 * 60 * 1000);
      dipAndRecover(service);

      expect(service.isDosActive(), 'the first dip should have aged out of a five-minute window').to.equal(false);
    });
  });

  describe('stop', () => {
    it('stops listening and stops evaluating', () => {
      startService(service, { alreadyUp: true });
      service.stop();

      for (let i = 0; i < 10; i += 1) dipAndRecover(service);
      clock.tick(service.WINDOW_MS * 2);

      expect(service.isDosActive()).to.equal(false);
      expect(service.dipCount()).to.equal(0);
    });

    // A node going down does not become stable by going down, and the slot it
    // holds is the only record of why it was taken out.
    it('leaves a DOS it set standing', () => {
      startService(service, { alreadyUp: true });
      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      service.stop();

      expect(sticky, 'the reason the node is out of service was erased on teardown').to.contain(service.DOS_MESSAGE_PREFIX);
    });
  });
});
