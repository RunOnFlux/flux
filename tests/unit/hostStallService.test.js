const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('config');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const hostStallService = require('../../ZelBack/src/services/hostStallService');

const { stuckIntervals } = config.hostStall;

describe('hostStallService tests', () => {
  let procRoot;
  let paths;

  /**
   * One process in the fake /proc.
   * @param {string} pid
   * @param {string} comm
   * @param {Array<{tid: string, state: string, switches: number, wchan?: string, startTime?: string}>} threads
   * @param {{inContainer?: boolean}} [options] In a PID namespace below FluxOS's.
   */
  function processWith(pid, comm, threads, { inContainer = false } = {}) {
    const dir = path.join(procRoot, pid);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'comm'), `${comm}\n`);
    // its id in FluxOS's namespace, then in each namespace below; no ns/ link,
    // which the kernel refuses to an account that is not the process's
    fs.writeFileSync(path.join(dir, 'status'), `Name:\t${comm}\nNSpid:\t${pid}${inContainer ? '\t1' : ''}\n`);
    threads.forEach(({
      tid, state, switches, wchan = 'kvm_async_pf_task_wait_schedule', startTime = '1000',
    }) => {
      const taskDir = path.join(dir, 'task', tid);
      fs.mkdirSync(taskDir, { recursive: true });
      const after = [state, ...Array(18).fill('0'), startTime, '0'].join(' ');
      fs.writeFileSync(path.join(taskDir, 'stat'), `${tid} (${comm} worker) ${after}\n`);
      fs.writeFileSync(path.join(taskDir, 'status'), `Name:\t${comm}\nvoluntary_ctxt_switches:\t${switches}\nnonvoluntary_ctxt_switches:\t7\n`);
      fs.writeFileSync(path.join(taskDir, 'wchan'), wchan);
    });
  }

  const stuckMongod = (switches = 40) => processWith('100', 'mongod', [{ tid: '101', state: 'D', switches }, { tid: '102', state: 'S', switches: 5 }]);
  const read = () => hostStallService.readOnce(paths);
  const bootIs = (id) => fs.writeFileSync(paths.bootIdPath, `${id}\n`);
  const record = () => JSON.parse(fs.readFileSync(paths.recordFile, 'utf8'));
  async function readTimes(n) {
    for (let i = 0; i < n; i += 1) await read(); // eslint-disable-line no-await-in-loop
  }
  const placementHeld = () => fluxNetworkHelper.isPlacementHeld();
  const outOfService = () => fluxNetworkHelper.isStickyDosHeldBy(fluxNetworkHelper.StickyDosOwner.HOST_STALL);

  beforeEach(() => {
    procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hoststall-'));
    // FluxOS may follow its own ns/ link; another account's, it may not
    fs.mkdirSync(path.join(procRoot, 'self', 'ns'), { recursive: true });
    fs.symlinkSync('pid:[4026531836]', path.join(procRoot, 'self', 'ns', 'pid'));
    fs.writeFileSync(path.join(procRoot, 'self', 'status'), 'Name:\tnode\nNSpid:\t4242\n');
    paths = { procRoot, recordFile: path.join(procRoot, 'hostStall.json'), bootIdPath: path.join(procRoot, 'boot_id') };
    bootIs('boot-one');
  });

  afterEach(() => {
    hostStallService.stop();
    fluxNetworkHelper.clearPlacementHold(fluxNetworkHelper.PlacementHoldOwner.HOST_STALL);
    fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL);
    fs.rmSync(procRoot, { recursive: true, force: true });
    sinon.restore();
  });

  it('holds the node back once a thread stays in D without running for one interval', async () => {
    stuckMongod();
    await read();
    expect(placementHeld()).to.equal(false);

    await read();

    expect(placementHeld()).to.equal(true);
    expect(fluxNetworkHelper.getPlacementHold()).to.include('mongod thread 101').and.include('kvm_async_pf_task_wait_schedule');
    expect(outOfService()).to.equal(false);
  });

  it('takes the node out of service once the thread has not run for the configured intervals', async () => {
    stuckMongod();
    await readTimes(stuckIntervals);
    expect(outOfService()).to.equal(false);

    await read();

    expect(outOfService()).to.equal(true);
    expect(fluxNetworkHelper.isNodeDos()).to.equal(true);
    expect(fluxNetworkHelper.getDosMessage()).to.include('Host stall: mongod thread 101');
  });

  it('keeps the reason it went out of service with while the thread stays stuck', async () => {
    stuckMongod();
    await readTimes(stuckIntervals + 1);
    const reason = fluxNetworkHelper.getDosMessage();

    await readTimes(3);

    expect(fluxNetworkHelper.getDosMessage()).to.equal(reason);
  });

  it('starts the count again for a thread that ran between readings, though it is in D again', async () => {
    stuckMongod(40);
    await readTimes(stuckIntervals);
    stuckMongod(41);
    await read();
    expect(placementHeld()).to.equal(false);

    await readTimes(stuckIntervals - 1);
    expect(outOfService()).to.equal(false);

    await read();

    expect(outOfService()).to.equal(true);
  });

  it('starts the count again for a thread that left D, and releases the hold', async () => {
    stuckMongod();
    await readTimes(3);
    expect(placementHeld()).to.equal(true);
    processWith('100', 'mongod', [{ tid: '101', state: 'S', switches: 40 }]);

    await read();

    expect(placementHeld()).to.equal(false);
  });

  it('counts a reused thread id as a new thread', async () => {
    stuckMongod();
    await read();
    processWith('100', 'mongod', [{
      tid: '101', state: 'D', switches: 40, startTime: '2000',
    }]);

    await read();

    expect(placementHeld()).to.equal(false);
  });

  it('reads every dependency, and no other program', async () => {
    processWith('200', 'nginx', [{ tid: '201', state: 'D', switches: 3 }]);
    processWith('300', 'kworker/0:1', [{ tid: '301', state: 'D', switches: 3 }]);
    await readTimes(3);
    expect(placementHeld()).to.equal(false);

    ['mongod', 'dockerd', 'containerd', 'syncthing', 'fluxd', 'fluxbenchd'].forEach((comm, i) => {
      fs.rmSync(path.join(procRoot, '100'), { recursive: true, force: true });
      processWith('100', comm, [{ tid: `10${i}`, state: 'D', switches: 3 }]);
    });
    await readTimes(2);

    expect(fluxNetworkHelper.getPlacementHold()).to.include('fluxbenchd thread 105');
  });

  it('does not read a dependency running in an app container', async () => {
    processWith('400', 'mongod', [{ tid: '401', state: 'D', switches: 3 }], { inContainer: true });

    await readTimes(stuckIntervals + 1);

    expect(placementHeld()).to.equal(false);
    expect(outOfService()).to.equal(false);
  });

  it('keeps the node out of service when the thread runs again', async () => {
    stuckMongod();
    await readTimes(stuckIntervals + 1);
    processWith('100', 'mongod', [{ tid: '101', state: 'S', switches: 99 }]);

    await read();

    expect(outOfService()).to.equal(true);
  });

  describe('onTrip', () => {
    it('tells a listener the moment the node goes out of service, and not before', async () => {
      const listener = sinon.stub();
      hostStallService.onTrip(listener);
      stuckMongod();
      await readTimes(stuckIntervals);
      sinon.assert.notCalled(listener);

      await read();

      sinon.assert.calledOnce(listener);
      await readTimes(2);
      sinon.assert.calledOnce(listener);
    });

    it('tells a listener at once when the node is already out of service', async () => {
      stuckMongod();
      await readTimes(stuckIntervals + 1);
      const listener = sinon.stub();

      hostStallService.onTrip(listener);

      sinon.assert.calledOnce(listener);
    });

    it('tells a listener when a trip recorded in this boot is restored at start', async () => {
      stuckMongod();
      await readTimes(stuckIntervals + 1);
      hostStallService.stop();
      fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL);
      const listener = sinon.stub();
      hostStallService.onTrip(listener);

      await hostStallService.start(paths);

      sinon.assert.calledOnce(listener);
    });
  });

  describe('the trip record', () => {
    async function trip() {
      stuckMongod();
      await readTimes(stuckIntervals + 1);
    }
    async function restart() {
      hostStallService.stop();
      fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL);
      await hostStallService.start(paths);
    }

    it('records the trip with this boot\'s id', async () => {
      await trip();

      expect(record()).to.deep.equal({ bootId: 'boot-one', reason: fluxNetworkHelper.getDosMessage() });
    });

    it('restores the trip at a start in the same boot', async () => {
      await trip();
      const reason = fluxNetworkHelper.getDosMessage();

      await restart();

      expect(outOfService()).to.equal(true);
      expect(fluxNetworkHelper.getDosMessage()).to.equal(reason);
    });

    it('discards a trip from an earlier boot, and stays in service', async () => {
      await trip();
      bootIs('boot-two');

      await restart();

      expect(outOfService()).to.equal(false);
      expect(fs.existsSync(paths.recordFile)).to.equal(false);
    });

    it('records nothing without a boot id, and is still out of service', async () => {
      fs.rmSync(paths.bootIdPath);

      await trip();

      expect(outOfService()).to.equal(true);
      expect(fs.existsSync(paths.recordFile)).to.equal(false);
    });

    it('restores nothing and discards nothing at a start without a boot id', async () => {
      await trip();
      fs.rmSync(paths.bootIdPath);

      await restart();

      expect(outOfService()).to.equal(false);
      expect(fs.existsSync(paths.recordFile)).to.equal(true);
    });

    it('starts in service when the record cannot be read', async () => {
      fs.writeFileSync(paths.recordFile, '{ not json');

      await restart();

      expect(outOfService()).to.equal(false);
    });
  });

  it('reads a thread whose command name holds spaces and parentheses', async () => {
    processWith('500', 'syncthing', []);
    const taskDir = path.join(procRoot, '500', 'task', '501');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'stat'), `501 (a) b (c) D ${Array(18).fill('0').join(' ')} 1000 0\n`);
    fs.writeFileSync(path.join(taskDir, 'status'), 'voluntary_ctxt_switches:\t3\nnonvoluntary_ctxt_switches:\t1\n');
    fs.writeFileSync(path.join(taskDir, 'wchan'), 'folio_wait_bit');

    await readTimes(2);

    expect(fluxNetworkHelper.getPlacementHold()).to.include('syncthing thread 501').and.include('folio_wait_bit');
  });
});
