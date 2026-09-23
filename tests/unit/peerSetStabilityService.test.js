const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();

const { makeStickyDosDouble } = require('./stickyDosTestDouble');
const { StickyDosOwner } = require('../../ZelBack/src/services/fluxNetworkHelper');

describe('peerSetStabilityService', () => {
  const OWNER = StickyDosOwner.PEER_SET_STABILITY;
  let service;
  let clock;
  let peerEmitter;
  let logStub;
  let fluxNetworkHelperStub;

  function makeNetworkHelper() {
    return makeStickyDosDouble();
  }

  // Why the node is out of service, as a reader of /flux/info sees it.
  const stickyMessage = () => fluxNetworkHelperStub.getStickyDosMessage();
  const heldByUs = () => fluxNetworkHelperStub.isStickyDosHeldBy(OWNER);

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
      isAboveThreshold: () => alreadyUp,
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
      expect(stickyMessage()).to.equal(null);
    });

    it('puts the node out of service on the fifth collapse inside the window', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(service.isDosActive()).to.equal(true);
      expect(stickyMessage()).to.contain(service.DOS_MESSAGE_PREFIX);
      expect(heldByUs(), 'the verdict was recorded under another identity').to.equal(true);
    });

    it('names the count and the window, because the operator has to act on it', () => {
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(stickyMessage()).to.contain('5 times');
      expect(stickyMessage()).to.contain('120 minutes');
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
      expect(stickyMessage()).to.not.equal(null);
    });

    it('releases once the peer set has been up for the whole window', () => {
      dosTheNode();

      clock.tick(service.WINDOW_MS + service.EVALUATE_INTERVAL_MS);

      expect(service.isDosActive()).to.equal(false);
      expect(stickyMessage(), 'the verdict was not given back').to.equal(null);
    });

    // A node with no peers cannot dip - the fall edge fires only from above the
    // rise threshold - so its quiet is quiet for want of anything to observe.
    it('does not release a node whose peer set never came back', () => {
      dosTheNode();
      peerEmitter.emit('peersBelowThreshold', 0, { deliberate: false });

      clock.tick(service.WINDOW_MS * 2);

      expect(service.isDosActive(), 'a node with no peers at all was declared stable').to.equal(true);
    });

    // A teardown this node performed on itself is not a collapse, so it never
    // reaches the tally - and the minutes it spent with no peers are still
    // minutes it had nothing to be stable with. Releasing on a window with that
    // hole in it credits the node for time it did not serve.
    it('does not credit a window the node broke with its own teardown', () => {
      dosTheNode();
      const beforeTheHole = service.WINDOW_MS - 10 * 60 * 1000;
      clock.tick(beforeTheHole);

      peerEmitter.emit('peersBelowThreshold', 0, { deliberate: true });
      peerEmitter.emit('peerThresholdReached', 12);

      // Past the window measured from the collapses, which is what a release
      // keyed on the tally alone would have used.
      clock.tick(service.WINDOW_MS - beforeTheHole + service.EVALUATE_INTERVAL_MS);
      expect(service.dipCount(), 'the teardown was counted as a collapse').to.equal(0);
      expect(service.isDosActive(), 'released on a window the peer set was not up for').to.equal(true);

      // And it does come back, once the run of peered time is whole. Without
      // this the assertion above is satisfied by a DOS that never lifts.
      clock.tick(service.WINDOW_MS);

      expect(service.isDosActive(), 'never released, even after a full window with the set up').to.equal(false);
    });
  });

  describe('one verdict per owner', () => {
    const OTHER = StickyDosOwner.RESIDENTIAL_DOS;
    const OTHER_REASON = 'Residential node not running ArcaneOS. Migrate this node.';

    it('records its own verdict beside another owner\'s', () => {
      fluxNetworkHelperStub.holds.set(OTHER, OTHER_REASON);
      startService(service, { alreadyUp: true });

      for (let i = 0; i < 5; i += 1) dipAndRecover(service);

      expect(service.isDosActive(), 'the verdict was dropped because another owner held one').to.equal(true);
      expect(stickyMessage(), 'overwrote a verdict this service does not own').to.contain('Residential');
      expect(stickyMessage()).to.contain(service.DOS_MESSAGE_PREFIX);
    });

    it('releases its own verdict and leaves another owner\'s standing', () => {
      startService(service, { alreadyUp: true });
      for (let i = 0; i < 5; i += 1) dipAndRecover(service);
      fluxNetworkHelperStub.holds.set(OTHER, OTHER_REASON);

      clock.tick(service.WINDOW_MS + service.EVALUATE_INTERVAL_MS);

      expect(heldByUs(), 'held its own DOS past the evidence for it').to.equal(false);
      expect(stickyMessage(), 'dropped another owner\'s DOS on the floor').to.contain('Residential');
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

      expect(stickyMessage(), 'the reason the node is out of service was erased on teardown').to.contain(service.DOS_MESSAGE_PREFIX);
    });
  });
});
