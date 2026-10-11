const chai = require('chai');
const sinon = require('sinon');
const os = require('os');
const proxyquire = require('proxyquire');
const log = require('../../ZelBack/src/lib/log');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { requireMongo } = require('./dbTestHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const dockerService = require('../../ZelBack/src/services/dockerService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const nodeHealthService = require('../../ZelBack/src/services/nodeHealthService');

const { expect } = chai;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('nodeHealthService tests', () => {
  before(requireMongo);

  describe('confirmNodeTierHardware tests', () => {
    let osTotalmemStub;
    let osCpusStub;
    let collateralTierStub;
    let logSpy;

    beforeEach(() => {
      osTotalmemStub = sinon.stub(os, 'totalmem');
      osCpusStub = sinon.stub(os, 'cpus');
      collateralTierStub = sinon.stub(generalService, 'nodeCollateralTier');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return fail if stratus (100000) has less than 8 cpu threads', async () => {
      collateralTierStub.resolves({ collateral: 100000, tier: generalService.COLLATERAL_TIERS[100000] });
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Cpu Threads (4) below Stratus requirements' });
    });

    it('should return fail if stratus (100000) has less than 30gb ram', async () => {
      collateralTierStub.resolves({ collateral: 100000, tier: generalService.COLLATERAL_TIERS[100000] });
      osTotalmemStub.returns(29 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Total Ram (29) below Stratus requirements' });
    });

    it('should return ok if stratus (100000) matches requirements', async () => {
      collateralTierStub.resolves({ collateral: 100000, tier: generalService.COLLATERAL_TIERS[100000] });
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.OK });
      sinon.assert.notCalled(logSpy);
    });

    it('should return fail if stratus (40000) has less than 16 cpu threads', async () => {
      collateralTierStub.resolves({ collateral: 40000, tier: generalService.COLLATERAL_TIERS[40000] });
      osTotalmemStub.returns(61 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Cpu Threads (15) below new Stratus requirements' });
    });

    it('should return fail if stratus (40000) has less than 61gb ram', async () => {
      collateralTierStub.resolves({ collateral: 40000, tier: generalService.COLLATERAL_TIERS[40000] });
      osTotalmemStub.returns(60 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Total Ram (60) below new Stratus requirements' });
    });

    it('should return ok if stratus (40000) matches requirements', async () => {
      collateralTierStub.resolves({ collateral: 40000, tier: generalService.COLLATERAL_TIERS[40000] });
      osTotalmemStub.returns(61 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.OK });
      sinon.assert.notCalled(logSpy);
    });

    it('should return fail if Nimbus (25000) has less than 4 cpu threads', async () => {
      collateralTierStub.resolves({ collateral: 25000, tier: generalService.COLLATERAL_TIERS[25000] });
      osTotalmemStub.returns(7 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Cpu Threads (3) below Nimbus requirements' });
    });

    it('should return fail if Nimbus (25000) has less than 7gb ram', async () => {
      collateralTierStub.resolves({ collateral: 25000, tier: generalService.COLLATERAL_TIERS[25000] });
      osTotalmemStub.returns(6 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Total Ram (6) below Nimbus requirements' });
    });

    it('should return ok if Nimbus (25000) matches requirements', async () => {
      collateralTierStub.resolves({ collateral: 25000, tier: generalService.COLLATERAL_TIERS[25000] });
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.OK });
      sinon.assert.notCalled(logSpy);
    });

    it('should return fail if Nimbus (12500) has less than 8 cpu threads', async () => {
      collateralTierStub.resolves({ collateral: 12500, tier: generalService.COLLATERAL_TIERS[12500] });
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Cpu Threads (7) below new Nimbus requirements' });
    });

    it('should return fail if Nimbus (12500) has less than 30gb ram', async () => {
      collateralTierStub.resolves({ collateral: 12500, tier: generalService.COLLATERAL_TIERS[12500] });
      osTotalmemStub.returns(29 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Total Ram (29) below new Nimbus requirements' });
    });

    it('should return ok if Nimbus (12500) matches requirements', async () => {
      collateralTierStub.resolves({ collateral: 12500, tier: generalService.COLLATERAL_TIERS[12500] });
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.OK });
      sinon.assert.notCalled(logSpy);
    });

    it('should return fail if Cumulus (10000) has less than 2 cpu threads', async () => {
      collateralTierStub.resolves({ collateral: 10000, tier: generalService.COLLATERAL_TIERS[10000] });
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Cpu Threads (1) below Cumulus requirements' });
    });

    it('should return fail if Cumulus (10000) has less than 3gb ram', async () => {
      collateralTierStub.resolves({ collateral: 10000, tier: generalService.COLLATERAL_TIERS[10000] });
      osTotalmemStub.returns(2 * 1024 ** 3);
      osCpusStub.returns([1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Total Ram (2) below Cumulus requirements' });
    });

    it('should return ok if Cumulus (10000) matches requirements', async () => {
      collateralTierStub.resolves({ collateral: 10000, tier: generalService.COLLATERAL_TIERS[10000] });
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.OK });
      sinon.assert.notCalled(logSpy);
    });

    it('should return fail if Cumulus (1000) has less than 4 cpu threads', async () => {
      collateralTierStub.resolves({ collateral: 1000, tier: generalService.COLLATERAL_TIERS[1000] });
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Cpu Threads (3) below new Cumulus requirements' });
    });

    it('should return fail if Cumulus (1000) has less than 3gb ram', async () => {
      collateralTierStub.resolves({ collateral: 1000, tier: generalService.COLLATERAL_TIERS[1000] });
      osTotalmemStub.returns(2 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node Total Ram (2) below new Cumulus requirements' });
    });

    it('should return ok if Cumulus (1000) matches requirements', async () => {
      collateralTierStub.resolves({ collateral: 1000, tier: generalService.COLLATERAL_TIERS[1000] });
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await nodeHealthService.confirmNodeTierHardware();

      expect(response).to.eql({ result: nodeHealthService.CHECK.OK });
      sinon.assert.notCalled(logSpy);
    });
  });

  // The tier comes from the daemon. While it loads its block index or is not
  // listening there is no tier to measure against: the check says so and does
  // not log, because every daemon start passes through that state.
  describe('confirmNodeTierHardware while the daemon cannot answer', () => {
    const warming = { code: -28, name: 'Error', message: 'Loading block index...' };
    let collateralTierStub;
    let logSpy;

    beforeEach(() => {
      sinon.stub(os, 'totalmem').returns(1 * 1024 ** 3);
      sinon.stub(os, 'cpus').returns([1]);
      collateralTierStub = sinon.stub(generalService, 'nodeCollateralTier');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('is unmeasured, not ok, while the daemon is warming up', async () => {
      collateralTierStub.rejects(warming);

      expect(await nodeHealthService.confirmNodeTierHardware()).to.eql({ result: nodeHealthService.CHECK.UNMEASURED });
      sinon.assert.notCalled(logSpy);
    });

    it('is unmeasured while nothing listens on the daemon port', async () => {
      const refused = { code: 'ECONNREFUSED', name: 'Error', message: 'connect ECONNREFUSED 127.0.0.1:16124' };
      collateralTierStub.rejects(refused);

      expect(await nodeHealthService.confirmNodeTierHardware()).to.eql({ result: nodeHealthService.CHECK.UNMEASURED });
      sinon.assert.notCalled(logSpy);
    });

    it('is unmeasured and logs when the daemon answers the lookup with an error', async () => {
      const unknown = { code: -5, name: 'Error', message: 'No such mempool or blockchain transaction' };
      collateralTierStub.rejects(unknown);

      expect(await nodeHealthService.confirmNodeTierHardware()).to.eql({ result: nodeHealthService.CHECK.UNMEASURED });
      sinon.assert.calledOnceWithExactly(logSpy, unknown);
    });
  });

  // The daemon answered, and its answer is that this node is no Flux Node tier:
  // there is nothing to wait for, so the check fails and says why.
  describe('confirmNodeTierHardware when the collateral makes the node no tier', () => {
    beforeEach(() => {
      sinon.stub(os, 'totalmem').returns(64 * 1024 ** 3);
      sinon.stub(os, 'cpus').returns(new Array(16).fill(1));
    });

    afterEach(() => {
      sinon.restore();
    });

    it('fails when the node holds no collateral', async () => {
      sinon.stub(generalService, 'nodeCollateralTier').resolves({ collateral: null, tier: null });

      expect(await nodeHealthService.confirmNodeTierHardware()).to.eql({ result: nodeHealthService.CHECK.FAIL, reason: 'Node has no collateral' });
    });

    it('fails when the collateral is not a tier amount', async () => {
      sinon.stub(generalService, 'nodeCollateralTier').resolves({ collateral: 5000, tier: null });

      expect(await nodeHealthService.confirmNodeTierHardware()).to.eql({
        result: nodeHealthService.CHECK.FAIL, reason: 'Node collateral (5000) matches no Flux Node tier',
      });
    });
  });

  describe('nodeHealth / checkNodeFitness tests', () => {
    let osTotalmemStub;
    let osCpusStub;
    let collateralTierStub;
    let getDOSStateStub;
    let isDaemonSyncedStub;

    before(async () => {
      await dbHelper.initiateDB();
    });

    const daemonSynced = (synced) => isDaemonSyncedStub.returns({ status: 'success', data: { synced } });

    const healthyHardware = () => {
      collateralTierStub.resolves({ collateral: 1000, tier: generalService.COLLATERAL_TIERS[1000] });
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'success',
        data: { dosState: 0, dosMessage: null },
      });
    };

    beforeEach(() => {
      osTotalmemStub = sinon.stub(os, 'totalmem');
      osCpusStub = sinon.stub(os, 'cpus');
      collateralTierStub = sinon.stub(generalService, 'nodeCollateralTier');
      getDOSStateStub = sinon.stub(fluxNetworkHelper, 'getDOSState');
      isDaemonSyncedStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      daemonSynced(true);
      syncthingService.setSyncthingRunningState(true);
      sinon.stub(dockerService, 'dockerListImages').returns(true);
    });

    afterEach(() => {
      syncthingService.setSyncthingRunningState(true);
      sinon.restore();
    });

    it('nodeHealth reports success with per-check data when the node is fit', async () => {
      healthyHardware();
      const res = generateResponse();

      await nodeHealthService.nodeHealth(undefined, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'success',
        data: {
          db: 'ok', syncthing: 'ok', docker: 'ok', daemon: 'ok', hardware: 'ok', dos: 'ok', appsDos: 'ok',
        },
      });
    });

    it('checkNodeFitness returns ok with the checks when the node is fit', async () => {
      healthyHardware();

      const fitness = await nodeHealthService.checkNodeFitness();

      expect(fitness.ok).to.equal(true);
      expect(fitness.error).to.equal(null);
      expect(fitness.checks.syncthing).to.equal('ok');
    });

    it('nodeHealth gates on hardware exactly as loginPhrase does', async () => {
      collateralTierStub.resolves({ collateral: 1000, tier: generalService.COLLATERAL_TIERS[1000] });
      osTotalmemStub.returns(1 * 1024 ** 3);
      osCpusStub.returns([1]);
      const res = generateResponse();

      await nodeHealthService.nodeHealth(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Node Total Ram (1) below new Cumulus requirements',
          failed: 'hardware',
          checks: {
            db: 'ok', syncthing: 'ok', docker: 'ok', daemon: 'ok', hardware: 'fail',
          },
        },
      });
    });

    it('nodeHealth gates on syncthing - a sustained outage fails the node', async () => {
      healthyHardware();
      syncthingService.setSyncthingRunningState(false);
      const res = generateResponse();

      await nodeHealthService.nodeHealth(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Syncthing is not running properly',
          failed: 'syncthing',
          checks: { db: 'ok', syncthing: 'fail' },
        },
      });
    });

    // Until the sentinel has probed syncthing there is no verdict, and a slow
    // daemon at boot delays the sentinel.
    describe('with nothing having measured syncthing yet', () => {
      beforeEach(() => {
        syncthingService.setSyncthingUnmeasured();
      });

      it('does not refuse the node for a check it has not run', async () => {
        healthyHardware();

        const fitness = await nodeHealthService.checkNodeFitness();

        expect(fitness.ok, 'a node was taken off the network over a probe that had never happened').to.equal(true);
      });

      it('says unmeasured rather than claiming either verdict', async () => {
        healthyHardware();

        const fitness = await nodeHealthService.checkNodeFitness();

        expect(fitness.checks.syncthing).to.equal('unmeasured');
      });
    });

    // A daemon behind the chain or not answering is shown, and refuses nobody.
    describe('the daemon check', () => {
      it('reports a daemon that is behind or not answering as degraded, and keeps the node fit', async () => {
        healthyHardware();
        daemonSynced(false);

        const fitness = await nodeHealthService.checkNodeFitness();

        expect(fitness.ok, 'a node was refused over a daemon that may only be catching up').to.equal(true);
        expect(fitness.checks.daemon).to.equal('degraded');
        expect(fitness.checks.hardware, 'the checks after the daemon did not run').to.equal('ok');
      });

      it('reports a synced daemon as ok', async () => {
        healthyHardware();

        expect((await nodeHealthService.checkNodeFitness()).checks.daemon).to.equal('ok');
      });

      it('still refuses on a later check while the daemon is degraded', async () => {
        healthyHardware();
        daemonSynced(false);
        getDOSStateStub.returns({ status: 'success', data: { dosState: 100, dosMessage: 'Flux IP detection failed' } });

        const fitness = await nodeHealthService.checkNodeFitness();

        expect(fitness.ok).to.equal(false);
        expect(fitness.failed).to.equal('dos');
        expect(fitness.checks.daemon).to.equal('degraded');
      });
    });

    describe('with the daemon still warming up', () => {
      beforeEach(() => {
        healthyHardware();
        const warming = { code: -28, name: 'Error', message: 'Loading block index...' };
        collateralTierStub.rejects(warming);
        daemonSynced(false);
      });

      it('keeps the node fit and reports hardware as unmeasured', async () => {
        const res = generateResponse();

        await nodeHealthService.nodeHealth(undefined, res);

        sinon.assert.calledOnceWithExactly(res.json, {
          status: 'success',
          data: {
            db: 'ok', syncthing: 'ok', docker: 'ok', daemon: 'degraded', hardware: 'unmeasured', dos: 'ok', appsDos: 'ok',
          },
        });
      });
    });

    // /id/loginphrase is uncached and fluxbench retries it on a 30s sleep while a
    // node is failing, so a line per refusal is ~2,880 a day for one unchanged
    // state - and the line that says WHEN it started is buried under thousands
    // of copies of itself. The transition is the event; the condition is not.
    describe('fitness logging says when the verdict changed, not that it holds', () => {
      let warnStub;
      let infoStub;

      beforeEach(async () => {
        healthyHardware();
        // Normalise the module's remembered verdict through the real function,
        // so these tests do not inherit whatever the previous one left.
        await nodeHealthService.checkNodeFitness();
        warnStub = sinon.stub(log, 'warn');
        infoStub = sinon.stub(log, 'info');
      });

      it('says a node is unfit once, however often it is asked', async () => {
        getDOSStateStub.returns({
          status: 'success',
          data: { dosState: 11, dosMessage: 'Flux IP detection failed' },
        });

        await nodeHealthService.checkNodeFitness();
        await nodeHealthService.checkNodeFitness();
        await nodeHealthService.checkNodeFitness();

        expect(
          warnStub.callCount,
          'every refusal logged, so a node sitting in DOS writes a line every time anyone asks',
        ).to.equal(1);
      });

      // The case that makes keying on the code wrong: the score accrues while
      // the condition is the same one.
      it('does not speak again as the dos score climbs under the same message', async () => {
        getDOSStateStub.returns({
          status: 'success',
          data: { dosState: 11, dosMessage: 'Flux IP detection failed' },
        });
        await nodeHealthService.checkNodeFitness();

        getDOSStateStub.returns({
          status: 'success',
          data: { dosState: 13, dosMessage: 'Flux IP detection failed' },
        });
        await nodeHealthService.checkNodeFitness();

        expect(
          warnStub.callCount,
          'a climbing score counted as a new fault, which is the flood keying on the message exists to stop',
        ).to.equal(1);
      });

      it('speaks again when a different check is the one failing', async () => {
        getDOSStateStub.returns({
          status: 'success',
          data: { dosState: 11, dosMessage: 'Flux IP detection failed' },
        });
        await nodeHealthService.checkNodeFitness();

        getDOSStateStub.returns({
          status: 'success',
          data: { dosState: 0, dosMessage: null },
        });
        osTotalmemStub.returns(1 * 1024 ** 3);
        osCpusStub.returns([1]);
        await nodeHealthService.checkNodeFitness();

        expect(warnStub.callCount, 'the node started failing for a new reason and said nothing').to.equal(2);
        expect(warnStub.secondCall.args[0]).to.contain('hardware');
      });

      it('says so once when the node recovers, and not again', async () => {
        getDOSStateStub.returns({
          status: 'success',
          data: { dosState: 11, dosMessage: 'Flux IP detection failed' },
        });
        await nodeHealthService.checkNodeFitness();

        healthyHardware();
        await nodeHealthService.checkNodeFitness();
        await nodeHealthService.checkNodeFitness();

        const recovered = infoStub.getCalls().filter((c) => String(c.args[0]).includes('fit to serve'));
        expect(recovered.length, 'recovery was silent, or repeated on every healthy pass').to.equal(1);
      });
    });

    // The syncthing gate asks whether the operator has broken a syncthing FluxOS
    // can do something about, so it is held to the nodes that own the daemon -
    // the same question the repair path is held to. Where we do not own it,
    // FluxOS cannot restart it, and failing the node would take it off the
    // network for a fault it cannot repair. Reported, not fatal.
    //
    // Stubbed on ownsSyncthing, the question the gate asks, rather than reached
    // through the node type.
    describe('where FluxOS does not own syncthing, the outage is reported, not fatal', () => {
      beforeEach(() => {
        sinon.stub(syncthingService, 'ownsSyncthing').returns(false);
      });

      it('reports syncthing degraded and stays fit', async () => {
        healthyHardware();
        syncthingService.setSyncthingRunningState(false);

        const fitness = await nodeHealthService.checkNodeFitness();

        expect(fitness.ok, 'a node was failed for a syncthing it cannot restart').to.equal(true);
        expect(fitness.checks.syncthing, 'the outage went unreported instead of being shown').to.equal('degraded');
      });

      it('still fails on a check that is not syncthing', async () => {
        healthyHardware();
        syncthingService.setSyncthingRunningState(false);
        osTotalmemStub.returns(1 * 1024 ** 3);
        osCpusStub.returns([1]);

        const fitness = await nodeHealthService.checkNodeFitness();

        expect(fitness.ok, 'the carve-out let a genuinely unfit node through').to.equal(false);
        expect(fitness.error.message).to.equal('Node Total Ram (1) below new Cumulus requirements');
      });
    });

    // The other side of the same question: a node whose syncthing FluxOS does
    // own is refused for it.
    it('refuses a node whose own syncthing is broken', async () => {
      healthyHardware();
      sinon.stub(syncthingService, 'ownsSyncthing').returns(true);
      syncthingService.setSyncthingRunningState(false);

      const fitness = await nodeHealthService.checkNodeFitness();

      expect(fitness.ok).to.equal(false);
      expect(fitness.error.message).to.equal('Syncthing is not running properly');
    });

    // syncthingService names its own health states and /flux/health reports
    // its own CHECK values, so the report must not depend on the two spellings
    // agreeing.
    describe('under syncthing state names that are not CHECK values', () => {
      const renamed = Object.freeze({ OK: 'up', UNHEALTHY: 'down', UNMEASURED: 'pending' });
      let syncthingState;
      const healthWithRenamedStates = proxyquire('../../ZelBack/src/services/nodeHealthService', {
        './syncthingService': {
          SYNCTHING_HEALTH: renamed,
          healthState: () => syncthingState,
          ownsSyncthing: () => false,
        },
      });

      it('reports each syncthing state as its CHECK value', async () => {
        healthyHardware();
        const reported = {};
        for (const state of Object.values(renamed)) {
          syncthingState = state;
          // eslint-disable-next-line no-await-in-loop
          reported[state] = (await healthWithRenamedStates.checkNodeFitness()).checks.syncthing;
        }

        expect(reported).to.eql({ up: 'ok', pending: 'unmeasured', down: 'degraded' });
      });
    });
  });
});
