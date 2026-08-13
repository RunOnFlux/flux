const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('residentialNodeDosService tests', () => {
  let service;
  let fluxNetworkHelperStub;
  let geolocationServiceStub;
  let benchmarkServiceStub;
  let configStub;

  function loadService() {
    return proxyquire('../../ZelBack/src/services/residentialNodeDosService', {
      config: configStub,
      '../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
      },
      './fluxNetworkHelper': fluxNetworkHelperStub,
      './geolocationService': geolocationServiceStub,
      './benchmarkService': benchmarkServiceStub,
    });
  }

  beforeEach(() => {
    configStub = { residentialDos: { enabled: true } };

    // Stateful on purpose: the real fluxNetworkHelper reads back the message it
    // was given, and the ownership rules here are all written against that
    // read-back. A getter pinned to null would let a clear that must not happen
    // pass as if it had.
    let sticky = null;
    fluxNetworkHelperStub = {
      setStickyDosMessage: sinon.stub().callsFake((msg) => { sticky = msg; }),
      setStickyDosStateValue: sinon.stub(),
      clearStickyDosMessage: sinon.stub().callsFake(() => { sticky = null; }),
      getStickyDosMessage: sinon.stub().callsFake(() => sticky),
    };

    // Default: geolocation resolved, IP is not a data center -> residential.
    geolocationServiceStub = {
      getNodeGeolocation: sinon.stub().resolves({ ip: '1.2.3.4', org: 'Some Telecom' }),
      isDataCenter: sinon.stub().returns(false),
    };

    // Default: bench reachable, node is NOT ArcaneOS.
    benchmarkServiceStub = {
      getBenchmarks: sinon.stub().resolves({ status: 'success', data: { systemsecure: false } }),
    };

    service = loadService();
  });

  afterEach(() => {
    service.stop();
    sinon.restore();
  });

  describe('isArcaneOs', () => {
    it('returns true when bench reports systemsecure true', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: true } });

      expect(await service.isArcaneOs()).to.equal(true);
    });

    it('returns false when bench reports systemsecure false', async () => {
      expect(await service.isArcaneOs()).to.equal(false);
    });

    it('returns null when bench call errors', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'error', data: 'benchd down' });

      expect(await service.isArcaneOs()).to.equal(null);
    });

    it('returns null when systemsecure is not a boolean', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: null } });

      expect(await service.isArcaneOs()).to.equal(null);
    });

    it('returns null when bench throws', async () => {
      benchmarkServiceStub.getBenchmarks.rejects(new Error('socket hang up'));

      expect(await service.isArcaneOs()).to.equal(null);
    });
  });

  describe('isResidential', () => {
    it('returns true when geolocation resolved and the IP is not a data center', async () => {
      expect(await service.isResidential()).to.equal(true);
    });

    it('returns false when geolocation says the IP is a data center', async () => {
      geolocationServiceStub.isDataCenter.returns(true);

      expect(await service.isResidential()).to.equal(false);
    });

    it('returns null when no geolocation has resolved yet - the flag alone would read as residential', async () => {
      geolocationServiceStub.getNodeGeolocation.resolves(null);
      geolocationServiceStub.isDataCenter.returns(false);

      expect(await service.isResidential()).to.equal(null);
    });

    it('returns null when the geolocation lookup throws', async () => {
      geolocationServiceStub.getNodeGeolocation.rejects(new Error('db down'));

      expect(await service.isResidential()).to.equal(null);
    });
  });

  describe('enforceResidentialPolicy', () => {
    it('DOSes a residential node that is not running ArcaneOS', async () => {
      const decided = await service.enforceResidentialPolicy();

      expect(decided).to.equal(true);
      sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDosMessage);
      expect(fluxNetworkHelperStub.setStickyDosMessage.firstCall.args[0])
        .to.include(service.DOS_MESSAGE_PREFIX);
      sinon.assert.calledWith(fluxNetworkHelperStub.setStickyDosStateValue, 100);
      expect(service.isDosActive()).to.equal(true);
    });

    it('does not DOS a residential node running ArcaneOS', async () => {
      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: true } });

      await service.enforceResidentialPolicy();

      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });

    it('does not DOS a data center node that is not running ArcaneOS', async () => {
      geolocationServiceStub.isDataCenter.returns(true);

      await service.enforceResidentialPolicy();

      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });

    it('decides nothing when bench is unreachable, even on a residential IP', async () => {
      benchmarkServiceStub.getBenchmarks.rejects(new Error('benchd down'));

      const decided = await service.enforceResidentialPolicy();

      expect(decided).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosMessage);
      sinon.assert.notCalled(fluxNetworkHelperStub.clearStickyDosMessage);
    });

    it('decides nothing when geolocation has not resolved yet', async () => {
      geolocationServiceStub.getNodeGeolocation.resolves(null);

      const decided = await service.enforceResidentialPolicy();

      expect(decided).to.equal(false);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosMessage);
      sinon.assert.notCalled(fluxNetworkHelperStub.clearStickyDosMessage);
    });

    it('an unavailable input does not clear a DOS this service already set', async () => {
      await service.enforceResidentialPolicy();
      expect(service.isDosActive()).to.equal(true);

      benchmarkServiceStub.getBenchmarks.rejects(new Error('benchd down'));
      await service.enforceResidentialPolicy();

      sinon.assert.notCalled(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(true);
    });

    it('clears its own DOS once the node moves to ArcaneOS', async () => {
      await service.enforceResidentialPolicy();
      expect(service.isDosActive()).to.equal(true);

      benchmarkServiceStub.getBenchmarks.resolves({ status: 'success', data: { systemsecure: true } });
      await service.enforceResidentialPolicy();

      sinon.assert.calledOnce(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });

    it('clears a DOS left by a previous process when the condition no longer holds', async () => {
      fluxNetworkHelperStub.getStickyDosMessage.returns(`${service.DOS_MESSAGE_PREFIX}. Migrate this node`);
      geolocationServiceStub.isDataCenter.returns(true);

      await service.enforceResidentialPolicy();

      sinon.assert.calledOnce(fluxNetworkHelperStub.clearStickyDosMessage);
    });

    it('does not clear a sticky slot another owner took over after we set ours', async () => {
      await service.enforceResidentialPolicy();
      expect(service.isDosActive()).to.equal(true);

      // Another enforcer overwrote the single sticky slot with its own message.
      fluxNetworkHelperStub.getStickyDosMessage.returns('Node flagged via tampering blocklist: score 12');
      // ...and our own condition stops holding.
      geolocationServiceStub.isDataCenter.returns(true);
      await service.enforceResidentialPolicy();

      sinon.assert.notCalled(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });

    it('does not clear another owner\'s sticky slot when disabled by config', async () => {
      await service.enforceResidentialPolicy();
      fluxNetworkHelperStub.getStickyDosMessage.returns('Node flagged via tampering blocklist: score 12');

      configStub.residentialDos.enabled = false;
      await service.enforceResidentialPolicy();

      sinon.assert.notCalled(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });

    it('does not overwrite another owner\'s sticky DOS', async () => {
      fluxNetworkHelperStub.getStickyDosMessage.returns('Node flagged via tampering blocklist: score 12');

      const decided = await service.enforceResidentialPolicy();

      expect(decided).to.equal(true);
      sinon.assert.notCalled(fluxNetworkHelperStub.setStickyDosMessage);
      sinon.assert.notCalled(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
    });

    it('refreshes its own sticky DOS rather than treating it as foreign', async () => {
      fluxNetworkHelperStub.getStickyDosMessage.returns(`${service.DOS_MESSAGE_PREFIX}. Migrate this node`);

      await service.enforceResidentialPolicy();

      sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDosMessage);
      sinon.assert.calledWith(fluxNetworkHelperStub.setStickyDosStateValue, 100);
    });

    it('enforces nothing and releases its own DOS when disabled by config', async () => {
      await service.enforceResidentialPolicy();
      expect(service.isDosActive()).to.equal(true);

      configStub.residentialDos.enabled = false;
      const decided = await service.enforceResidentialPolicy();

      expect(decided).to.equal(true);
      sinon.assert.calledOnce(fluxNetworkHelperStub.clearStickyDosMessage);
      expect(service.isDosActive()).to.equal(false);
      sinon.assert.calledOnce(fluxNetworkHelperStub.setStickyDosMessage);
    });

    it('enforces when the config section is absent altogether', async () => {
      configStub = {};
      service = loadService();

      await service.enforceResidentialPolicy();

      sinon.assert.calledWith(fluxNetworkHelperStub.setStickyDosStateValue, 100);
    });
  });

  describe('start / stop scheduling', () => {
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('reschedules on the short retry delay after an inconclusive tick', async () => {
      geolocationServiceStub.getNodeGeolocation.resolves(null);

      await service.start();
      expect(geolocationServiceStub.getNodeGeolocation.callCount).to.equal(1);

      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      expect(geolocationServiceStub.getNodeGeolocation.callCount).to.equal(2);
    });

    it('doubles the retry delay while ticks stay inconclusive, capped at the full interval', async () => {
      geolocationServiceStub.getNodeGeolocation.resolves(null);
      const calls = () => geolocationServiceStub.getNodeGeolocation.callCount;

      await service.start();
      expect(calls()).to.equal(1);

      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      expect(calls()).to.equal(2);

      // Second retry is 2x, so the first delay alone is not enough.
      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      expect(calls()).to.equal(2);
      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      expect(calls()).to.equal(3);

      // Walk the doubling out to where it would exceed the interval.
      let expected = 3;
      for (let delay = service.RETRY_INTERVAL_MS * 4;
        delay < service.CHECK_INTERVAL_MS;
        delay *= 2) {
        // eslint-disable-next-line no-await-in-loop
        await clock.tickAsync(delay);
        expected += 1;
        expect(calls()).to.equal(expected);
      }

      // The next delay doubles past the interval and is capped to it exactly:
      // one tick short of the interval fires nothing, the interval fires once.
      await clock.tickAsync(service.CHECK_INTERVAL_MS - 1);
      expect(calls()).to.equal(expected);
      await clock.tickAsync(1);
      expect(calls()).to.equal(expected + 1);
    });

    it('resets the backoff once a tick decides again', async () => {
      geolocationServiceStub.getNodeGeolocation.resolves(null);
      await service.start();
      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      await clock.tickAsync(service.RETRY_INTERVAL_MS * 2);
      expect(geolocationServiceStub.getNodeGeolocation.callCount).to.equal(3);

      // Geolocation resolves: that tick decides, so the next inconclusive run
      // starts over at the short retry instead of the grown delay.
      geolocationServiceStub.getNodeGeolocation.resolves({ ip: '1.2.3.4' });
      await clock.tickAsync(service.RETRY_INTERVAL_MS * 4);
      expect(geolocationServiceStub.getNodeGeolocation.callCount).to.equal(4);

      geolocationServiceStub.getNodeGeolocation.resolves(null);
      await clock.tickAsync(service.CHECK_INTERVAL_MS);
      expect(geolocationServiceStub.getNodeGeolocation.callCount).to.equal(5);
      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      expect(geolocationServiceStub.getNodeGeolocation.callCount).to.equal(6);
    });

    it('reschedules on the full interval after a decided tick', async () => {
      await service.start();
      expect(benchmarkServiceStub.getBenchmarks.callCount).to.equal(1);

      await clock.tickAsync(service.RETRY_INTERVAL_MS);
      expect(benchmarkServiceStub.getBenchmarks.callCount).to.equal(1);

      await clock.tickAsync(service.CHECK_INTERVAL_MS);
      expect(benchmarkServiceStub.getBenchmarks.callCount).to.equal(2);
    });

    it('a second start does not add a second tick chain', async () => {
      await service.start();
      await service.start();

      await clock.tickAsync(service.CHECK_INTERVAL_MS);

      expect(benchmarkServiceStub.getBenchmarks.callCount).to.equal(2);
    });

    it('stop prevents any further tick', async () => {
      await service.start();
      service.stop();

      await clock.tickAsync(service.CHECK_INTERVAL_MS * 3);

      expect(benchmarkServiceStub.getBenchmarks.callCount).to.equal(1);
    });
  });
});
