const chai = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const config = require('config');

const { expect } = chai;

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const resourceQueryService = require('../../ZelBack/src/services/appQuery/resourceQueryService');
const appSwapPoolService = require('../../ZelBack/src/services/appLifecycle/appSwapPoolService');

const GIB = 1024 * 1024 * 1024;
const { POOL_DIR } = appSwapPoolService;
const SWAP = config.fluxapps.defaultSwap;

describe('appSwapPoolService tests', () => {
  let savedFluxosPath;

  beforeEach(() => {
    savedFluxosPath = process.env.FLUXOS_PATH;
    appSwapPoolService.resetSupportCache();
  });

  afterEach(() => {
    if (savedFluxosPath === undefined) delete process.env.FLUXOS_PATH;
    else process.env.FLUXOS_PATH = savedFluxosPath;
    appSwapPoolService.resetSupportCache();
    sinon.restore();
  });

  /**
   * A node with /dat on `fsType`, outside a container, unless `inContainer`.
   */
  function hostIs({ fsType = 'xfs', inContainer = false } = {}) {
    process.env.FLUXOS_PATH = '/dat/usr/lib/fluxos';
    sinon.stub(fs, 'access').callsFake(async (p) => {
      if (inContainer && p === '/.dockerenv') return;
      throw new Error('ENOENT');
    });
    return fsType;
  }

  function installed(components, unreadable = []) {
    sinon.stub(resourceQueryService, 'appsResources').resolves({
      status: 'success',
      data: { componentsLocked: components, unreadable },
    });
  }

  /**
   * Chunk files on disk, by size in GiB, and which of them are active.
   */
  function poolHolds(sizesGb, { active = sizesGb.map((_, i) => i) } = {}) {
    const names = sizesGb.map((_, i) => `chunk-${String(i).padStart(4, '0')}.swap`);
    sinon.stub(fs, 'readdir').resolves([...names, 'unrelated.txt']);
    sinon.stub(fs, 'stat').callsFake(async (p) => ({ size: sizesGb[names.findIndex((n) => p.endsWith(n))] * GIB }));
    return active.map((i) => `${POOL_DIR}/${names[i]}`).join('\n');
  }

  /**
   * serviceHelper.runCommand answering as the host does: findmnt with `fsType`,
   * `swapon --show` with `activeList`, and any command named in `failing` with
   * an error.
   */
  function commands(fsType, activeList = '', failing = []) {
    return sinon.stub(serviceHelper, 'runCommand').callsFake(async (cmd, opts = {}) => {
      if (failing.includes(cmd)) return { error: new Error(`${cmd} refused`), stdout: '' };
      if (cmd === 'findmnt') return { error: null, stdout: `${fsType}\n` };
      if (cmd === 'swapon' && opts.params.includes('--show=NAME')) return { error: null, stdout: activeList };
      return { error: null, stdout: '' };
    });
  }

  const calls = (runCommand, cmd) => runCommand.getCalls().filter((c) => c.args[0] === cmd);
  const swapons = (runCommand) => calls(runCommand, 'swapon').filter((c) => !c.args[1].params.includes('--show=NAME'));

  describe('poolSupported', () => {
    it('is false on a node that is not Arcane, without asking the host anything', async () => {
      const runCommand = commands(hostIs());
      delete process.env.FLUXOS_PATH;

      expect(await appSwapPoolService.poolSupported()).to.equal(false);
      sinon.assert.notCalled(runCommand);
    });

    it('is false inside a container, whatever /dat is', async () => {
      const runCommand = commands(hostIs({ inContainer: true }));

      expect(await appSwapPoolService.poolSupported()).to.equal(false);
      sinon.assert.notCalled(runCommand);
    });

    it('is false when /dat is not XFS', async () => {
      commands(hostIs({ fsType: 'ext4' }));

      expect(await appSwapPoolService.poolSupported()).to.equal(false);
    });

    it('is true on an Arcane host with /dat on XFS, and asks the host once', async () => {
      const runCommand = commands(hostIs());

      expect(await appSwapPoolService.poolSupported()).to.equal(true);
      expect(await appSwapPoolService.poolSupported()).to.equal(true);
      expect(calls(runCommand, 'findmnt')).to.have.length(1);
      expect(calls(runCommand, 'findmnt')[0].args[1].params).to.deep.equal(['-n', '-o', 'FSTYPE', '--mountpoint', '/dat']);
    });
  });

  describe('computeNeed', () => {
    it('is the per-component swap times the components installed', async () => {
      installed(5);

      expect(await appSwapPoolService.computeNeed()).to.deep.equal({ needGb: 5 * SWAP, complete: true });
    });

    it('is incomplete when an installed app could not be read', async () => {
      installed(1, ['sealed']);

      expect(await appSwapPoolService.computeNeed()).to.deep.equal({ needGb: SWAP, complete: false });
    });
  });

  describe('doReconcile', () => {
    it('does nothing on a node without a pool', async () => {
      const runCommand = commands(hostIs({ fsType: 'ext4' }));
      const appsResources = sinon.stub(resourceQueryService, 'appsResources');

      await appSwapPoolService.doReconcile();

      expect(runCommand.getCalls().map((c) => c.args[0])).to.deep.equal(['findmnt']);
      sinon.assert.notCalled(appsResources);
    });

    it('creates the pool directory private to root', async () => {
      installed(0);
      poolHolds([]);
      const runCommand = commands(hostIs());

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'mkdir')[0].args[1].params).to.deep.equal(['-p', POOL_DIR]);
      expect(calls(runCommand, 'chmod')[0].args[1].params).to.deep.equal(['700', POOL_DIR]);
    });

    it('grows the pool with chunks the size of one component\'s swap and swaps each on', async () => {
      installed(3);
      poolHolds([]);
      const runCommand = commands(hostIs());

      await appSwapPoolService.doReconcile();

      const fallocate = calls(runCommand, 'fallocate');
      expect(fallocate.map((c) => c.args[1].params)).to.deep.equal([
        ['-l', `${SWAP}G`, `${POOL_DIR}/chunk-0000.swap`],
        ['-l', `${SWAP}G`, `${POOL_DIR}/chunk-0001.swap`],
        ['-l', `${SWAP}G`, `${POOL_DIR}/chunk-0002.swap`],
      ]);
      expect(calls(runCommand, 'mkswap')).to.have.length(3);
      expect(swapons(runCommand).map((c) => c.args[1].params[0])).to.deep.equal([
        `${POOL_DIR}/chunk-0000.swap`, `${POOL_DIR}/chunk-0001.swap`, `${POOL_DIR}/chunk-0002.swap`,
      ]);
      fallocate.forEach((c) => expect(c.args[1].runAsRoot).to.equal(true));
    });

    it('adds large chunks once the pool holds its small ones', async () => {
      const { SMALL_CHUNKS, LARGE_CHUNK_GB } = appSwapPoolService;
      installed(SMALL_CHUNKS + 1);
      const active = poolHolds(Array(SMALL_CHUNKS).fill(SWAP));
      const runCommand = commands(hostIs(), active);

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'fallocate').map((c) => c.args[1].params[1])).to.deep.equal([`${LARGE_CHUNK_GB}G`]);
      expect(calls(runCommand, 'swapoff'), 'the pass that grew the pool also shrank it').to.have.length(0);
    });

    it('stops at the chunk limit and says the rest comes from the host swapfile', async () => {
      const { MAX_CHUNKS } = appSwapPoolService;
      installed(1000);
      poolHolds([]);
      const runCommand = commands(hostIs());

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'fallocate')).to.have.length(MAX_CHUNKS);
    });

    it('does not grow when the pool already covers the need, and swaps on a chunk left inactive by a reboot', async () => {
      installed(2);
      poolHolds([SWAP, SWAP], { active: [0] });
      const runCommand = commands(hostIs(), `${POOL_DIR}/chunk-0000.swap`);

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'fallocate')).to.have.length(0);
      expect(swapons(runCommand).map((c) => c.args[1].params[0])).to.deep.equal([`${POOL_DIR}/chunk-0001.swap`]);
      expect(calls(runCommand, 'swapoff')).to.have.length(0);
    });

    it('removes a chunk whose creation failed part way, so it is never counted as capacity', async () => {
      installed(1);
      poolHolds([]);
      const runCommand = commands(hostIs(), '', ['mkswap']);

      await appSwapPoolService.doReconcile().catch(() => {});

      const rm = calls(runCommand, 'rm');
      expect(rm.map((c) => c.args[1].params)).to.deep.equal([['-f', `${POOL_DIR}/chunk-0000.swap`]]);
      expect(swapons(runCommand)).to.have.length(0);
    });

    it('shrinks to the need, smallest chunks first, switching each off before deleting it', async () => {
      installed(1);
      const active = poolHolds([SWAP, SWAP, 8]);
      const runCommand = commands(hostIs(), active);

      await appSwapPoolService.doReconcile();

      // 2 + 2 + 8 for a need of 2: both small chunks go, the 8 GiB one stays as
      // removing it would leave nothing.
      expect(calls(runCommand, 'swapoff').map((c) => c.args[1].params[0])).to.deep.equal([
        `${POOL_DIR}/chunk-0001.swap`, `${POOL_DIR}/chunk-0000.swap`,
      ]);
      expect(calls(runCommand, 'rm').map((c) => c.args[1].params[1])).to.deep.equal([
        `${POOL_DIR}/chunk-0001.swap`, `${POOL_DIR}/chunk-0000.swap`,
      ]);
      runCommand.getCalls().filter((c) => c.args[0] === 'rm').forEach((rmCall) => {
        const off = runCommand.getCalls().find((c) => c.args[0] === 'swapoff' && c.args[1].params[0] === rmCall.args[1].params[1]);
        expect(off.calledBefore(rmCall)).to.equal(true);
      });
    });

    it('removes every chunk when no app is installed', async () => {
      installed(0);
      const active = poolHolds([SWAP, SWAP]);
      const runCommand = commands(hostIs(), active);

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'rm')).to.have.length(2);
    });

    it('keeps a chunk the kernel will not switch off', async () => {
      installed(0);
      const active = poolHolds([SWAP]);
      const runCommand = commands(hostIs(), active, ['swapoff']);

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'swapoff')).to.have.length(1);
      expect(calls(runCommand, 'rm')).to.have.length(0);
    });

    it('never shrinks on a need it could not fully count', async () => {
      installed(0, ['sealed']);
      const active = poolHolds([SWAP, SWAP]);
      const runCommand = commands(hostIs(), active);

      await appSwapPoolService.doReconcile();

      expect(calls(runCommand, 'swapoff')).to.have.length(0);
      expect(calls(runCommand, 'rm')).to.have.length(0);
    });
  });

  describe('reconcile', () => {
    it('resolves when the reconcile fails, and the next call still runs', async () => {
      hostIs();
      commands('xfs');
      const appsResources = sinon.stub(resourceQueryService, 'appsResources');
      appsResources.onFirstCall().rejects(new Error('database down'));
      appsResources.onSecondCall().resolves({ status: 'success', data: { componentsLocked: 0, unreadable: [] } });
      poolHolds([]);

      await appSwapPoolService.reconcile();
      await appSwapPoolService.reconcile();

      sinon.assert.calledTwice(appsResources);
    });

    it('runs one call after the other', async () => {
      hostIs();
      commands('xfs');
      poolHolds([]);
      const order = [];
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const appsResources = sinon.stub(resourceQueryService, 'appsResources');
      appsResources.onFirstCall().callsFake(async () => {
        order.push('first start');
        await held;
        order.push('first end');
        return { status: 'success', data: { componentsLocked: 0, unreadable: [] } };
      });
      appsResources.onSecondCall().callsFake(async () => {
        order.push('second start');
        return { status: 'success', data: { componentsLocked: 0, unreadable: [] } };
      });

      const first = appSwapPoolService.reconcile();
      const second = appSwapPoolService.reconcile();
      await new Promise((resolve) => { setImmediate(resolve); });
      release();
      await Promise.all([first, second]);

      expect(order).to.deep.equal(['first start', 'first end', 'second start']);
    });
  });
});
