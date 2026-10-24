const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('config');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const hostStallService = require('../../ZelBack/src/services/hostStallService');

const { stuckIntervals, readIntervalMs } = config.hostStall;

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
  // The machine's uptime in the fake /proc, which a reading reads.
  let uptimeMs;
  function setUptime(ms) {
    uptimeMs = ms;
    fs.writeFileSync(path.join(procRoot, 'uptime'), `${(ms / 1000).toFixed(2)} 0.00\n`);
  }
  const passMs = (ms) => setUptime(uptimeMs + ms);
  // A reading one interval after the last, as the service's own timer takes them.
  const read = () => {
    passMs(readIntervalMs);
    return hostStallService.readOnce(paths);
  };
  const kept = () => JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
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
    paths = { procRoot, stateFile: path.join(procRoot, 'flux-host-stall.json') };
    setUptime(1000000);
  });

  afterEach(async () => {
    await hostStallService.stop();
    fluxNetworkHelper.clearPlacementHold(fluxNetworkHelper.PlacementHoldOwner.HOST_STALL);
    fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL);
    fs.rmSync(procRoot, { recursive: true, force: true });
    sinon.restore();
  });

  // A reading begun before a stop that ends after the next start's readings would
  // replace what they have counted with what it read.
  it('keeps nothing from a reading still under way when it stops', async () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hoststall-other-'));
    fs.mkdirSync(path.join(otherRoot, 'self'));
    fs.writeFileSync(path.join(otherRoot, 'self', 'status'), 'Name:\tnode\nNSpid:\t4242\n');
    fs.writeFileSync(path.join(otherRoot, 'uptime'), '1000.00 0.00\n');
    let finishReading = null;
    const readdir = fs.promises.readdir.bind(fs.promises);
    sinon.stub(fs.promises, 'readdir').callsFake((dir, ...rest) => (dir === otherRoot
      ? new Promise((resolve) => { finishReading = () => resolve([]); })
      : readdir(dir, ...rest)));
    stuckMongod();
    const underWay = hostStallService.readOnce({ ...paths, procRoot: otherRoot });
    while (!finishReading) await new Promise((resolve) => { setImmediate(resolve); }); // eslint-disable-line no-await-in-loop

    hostStallService.stop();
    await readTimes(2);
    finishReading();
    await underWay;
    await readTimes(stuckIntervals - 1);

    expect(outOfService(), 'a reading begun before the stop reset what came after it').to.equal(true);
    fs.rmSync(otherRoot, { recursive: true, force: true });
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

    it('tells a listener when a kept trip is restored at start', async () => {
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

  describe('the kept state', () => {
    async function restart() {
      await hostStallService.stop();
      fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL);
      await hostStallService.start(paths);
    }

    it('keeps the trip and every thread\'s count after each reading', async () => {
      stuckMongod();
      await readTimes(stuckIntervals + 1);

      const { trip, threads } = kept();
      expect(trip).to.equal(fluxNetworkHelper.getDosMessage());
      expect(threads.map(([, thread]) => [thread.tid, thread.intervals])).to.deep.equal([['101', stuckIntervals]]);
    });

    it('keeps no trip before the node goes out of service', async () => {
      stuckMongod();
      await readTimes(stuckIntervals);

      expect(kept().trip).to.equal(null);
    });

    it('restores the trip at a start', async () => {
      stuckMongod();
      await readTimes(stuckIntervals + 1);
      const reason = fluxNetworkHelper.getDosMessage();

      await restart();

      expect(outOfService()).to.equal(true);
      expect(fluxNetworkHelper.getDosMessage()).to.equal(reason);
    });

    it('carries a stuck thread\'s count through a restart', async () => {
      stuckMongod();
      await readTimes(stuckIntervals);
      await restart();
      expect(outOfService(), 'out of service before the readings reached the threshold').to.equal(false);

      await read();

      expect(outOfService(), 'the restart started the count again').to.equal(true);
    });

    it('starts the count again for a thread that ran while FluxOS was not running', async () => {
      stuckMongod();
      await readTimes(stuckIntervals);
      await restart();
      stuckMongod(41);

      await read();

      expect(outOfService()).to.equal(false);
    });

    it('starts in service with nothing kept', async () => {
      await restart();

      expect(outOfService()).to.equal(false);
    });

    it('starts in service when the kept state cannot be read', async () => {
      fs.writeFileSync(paths.stateFile, '{ not json');

      await restart();

      expect(outOfService()).to.equal(false);
    });

    describe('a stop while the state is being written', () => {
      let release;
      let reading;
      beforeEach(async () => {
        release = null;
        const writeFile = fs.promises.writeFile.bind(fs.promises);
        sinon.stub(fs.promises, 'writeFile').callsFake((file, ...rest) => (file.startsWith(paths.stateFile)
          ? new Promise((resolve) => { release = () => resolve(writeFile(file, ...rest)); })
          : writeFile(file, ...rest)));
        stuckMongod();
        reading = read();
        while (!release) await new Promise((resolve) => { setImmediate(resolve); }); // eslint-disable-line no-await-in-loop
      });

      it('still keeps the state being written', async () => {
        const stopped = hostStallService.stop();
        release();
        await Promise.all([stopped, reading]);

        expect(kept().threads.map(([, thread]) => thread.tid)).to.deep.equal(['101']);
      });

      it('resolves once the write has ended', async () => {
        let done = false;
        const stopped = hostStallService.stop().then(() => { done = true; });
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(done, 'the stop resolved before the write ended').to.equal(false);

        release();
        await stopped;
        await reading;
      });
    });

    describe('what is written', () => {
      const writesOfState = () => fs.promises.writeFile.getCalls().filter((call) => String(call.args[0]).startsWith(paths.stateFile)).length;
      beforeEach(() => {
        sinon.spy(fs.promises, 'writeFile');
      });

      it('writes nothing while nothing is stuck', async () => {
        processWith('100', 'mongod', [{ tid: '101', state: 'S', switches: 40 }]);

        await readTimes(3);

        expect(fs.existsSync(paths.stateFile)).to.equal(false);
      });

      it('writes nothing at a start with nothing kept while nothing is stuck', async () => {
        processWith('100', 'mongod', [{ tid: '101', state: 'S', switches: 40 }]);

        await restart();
        await readTimes(2);

        expect(fs.existsSync(paths.stateFile)).to.equal(false);
      });

      it('writes again at the next reading when a write fails', async () => {
        const rename = fs.promises.rename.bind(fs.promises);
        const renames = sinon.stub(fs.promises, 'rename').callsFake((from, ...rest) => rename(from, ...rest));
        renames.onFirstCall().rejects(new Error('no space left on device'));
        stuckMongod();
        await read();

        await hostStallService.readOnce(paths);

        expect(kept().threads.map(([, thread]) => thread.tid)).to.deep.equal(['101']);
      });

      it('writes nothing for a reading that changes nothing', async () => {
        stuckMongod();
        await read();
        const writes = writesOfState();

        await hostStallService.readOnce(paths);

        expect(writesOfState()).to.equal(writes);
      });

      it('writes nothing at a start that finds what it kept unchanged, and writes once something changes', async () => {
        stuckMongod();
        await readTimes(2);
        const writes = writesOfState();
        await restart();
        expect(writesOfState(), 'the start wrote back what it had just read').to.equal(writes);

        await read();

        expect(writesOfState()).to.equal(writes + 1);
      });

      it('writes again once the stuck thread runs', async () => {
        stuckMongod();
        await readTimes(2);
        processWith('100', 'mongod', [{ tid: '101', state: 'S', switches: 41 }]);

        await read();

        expect(kept().threads).to.deep.equal([]);
      });
    });

    describe('a write that does not end', () => {
      let releases;
      let holding;
      const until = async (done) => {
        for (let i = 0; i < 2000 && !done(); i += 1) await new Promise((resolve) => { setTimeout(resolve, 1); }); // eslint-disable-line no-await-in-loop
      };
      // A write left held would hold the stop after each test, and the node out of
      // service, for every test after it.
      afterEach(() => {
        holding = false;
        releases.forEach((release) => release());
      });
      beforeEach(() => {
        releases = [];
        holding = true;
        const writeFile = fs.promises.writeFile.bind(fs.promises);
        sinon.stub(fs.promises, 'writeFile').callsFake((file, ...rest) => (holding && String(file).startsWith(paths.stateFile)
          ? new Promise((resolve) => {
            let released = false;
            releases.push(() => {
              if (released) return;
              released = true;
              resolve(writeFile(file, ...rest));
            });
          })
          : writeFile(file, ...rest)));
      });

      it('holds up no start: a start returns once its first reading has acted', async () => {
        holding = false;
        stuckMongod();
        await readTimes(stuckIntervals);
        await hostStallService.stop();
        fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL);
        passMs(readIntervalMs);
        holding = true;

        await hostStallService.start(paths);

        expect(outOfService(), 'the start\'s reading did not act').to.equal(true);
        await until(() => releases.length > 0);
        expect(releases.length, 'fixture: the start asked for no write').to.equal(1);
      });

      it('lands the writes one at a time and in order, the last one asked for last', async () => {
        stuckMongod();
        passMs(readIntervalMs);
        const first = hostStallService.readOnce(paths);
        await until(() => releases.length === 1);
        expect(releases.length, 'fixture: the first reading asked for no write').to.equal(1);

        processWith('100', 'mongod', [{ tid: '101', state: 'S', switches: 41 }]);
        passMs(readIntervalMs);
        const second = hostStallService.readOnce(paths);
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(releases.length, 'the second write started beside the first').to.equal(1);

        releases[0]();
        await until(() => releases.length === 2);
        releases[1]();
        await Promise.all([first, second]);

        expect(kept().threads).to.deep.equal([]);
      });
    });

    describe('a FluxOS that may not make the state directory', () => {
      let stateDir;
      beforeEach(() => {
        stateDir = path.join(procRoot, 'run-fluxos');
        paths.stateFile = path.join(stateDir, 'host-stall.json');
        const mkdir = fs.promises.mkdir.bind(fs.promises);
        sinon.stub(fs.promises, 'mkdir').callsFake((dir, ...rest) => (dir === stateDir && !fs.existsSync(stateDir)
          ? Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
          : mkdir(dir, ...rest)));
      });

      const makesTheDirectory = async () => {
        fs.mkdirSync(stateDir);
        return { error: null, stdout: '', stderr: '' };
      };

      it('makes it through sudo, owned by its own account, and keeps the state in it', async () => {
        sinon.stub(serviceHelper, 'runCommand').callsFake(makesTheDirectory);
        const { uid, gid } = os.userInfo();
        stuckMongod();

        await read();

        sinon.assert.calledOnceWithExactly(serviceHelper.runCommand, 'install', {
          runAsRoot: true, params: ['-d', '-m', '755', '-o', String(uid), '-g', String(gid), stateDir],
        });
        expect(kept().threads.map(([, thread]) => thread.tid)).to.deep.equal(['101']);
      });

      it('tries again at the next reading when sudo fails', async () => {
        const runCommand = sinon.stub(serviceHelper, 'runCommand').resolves({ error: new Error('sudo: a password is required'), stdout: '', stderr: '' });
        stuckMongod();
        await read();
        expect(fs.existsSync(paths.stateFile), 'fixture: the state was kept though sudo failed').to.equal(false);
        runCommand.callsFake(makesTheDirectory);

        await hostStallService.readOnce(paths);

        expect(kept().threads.map(([, thread]) => thread.tid)).to.deep.equal(['101']);
      });
    });

    it('takes the node out of service and tells its listeners when the state cannot be kept', async () => {
      const writeFile = fs.promises.writeFile.bind(fs.promises);
      sinon.stub(fs.promises, 'writeFile').callsFake((file, ...rest) => (file.startsWith(paths.stateFile)
        ? Promise.reject(new Error('read-only'))
        : writeFile(file, ...rest)));
      const listener = sinon.stub();
      hostStallService.onTrip(listener);
      stuckMongod();

      await readTimes(stuckIntervals + 1);

      expect(outOfService()).to.equal(true);
      sinon.assert.calledOnce(listener);
    });
  });

  describe('the time between readings', () => {
    it('adds nothing for a reading taken before an interval has passed since the count moved', async () => {
      stuckMongod();
      await readTimes(stuckIntervals);
      passMs(readIntervalMs - 1000);

      await hostStallService.readOnce(paths);

      expect(outOfService()).to.equal(false);
      expect(kept().threads.map(([, thread]) => thread.intervals)).to.deep.equal([stuckIntervals - 1]);
    });

    it('counts a reading one interval after the count moved, by the uptime\'s resolution', async () => {
      stuckMongod();
      await readTimes(stuckIntervals);
      passMs(readIntervalMs - 10);

      await hostStallService.readOnce(paths);

      expect(outOfService()).to.equal(true);
    });

    it('goes out of service only once the thread has been held for the configured intervals, however often FluxOS restarts', async () => {
      const RESTART_EVERY_MS = 15000;
      stuckMongod();
      await read();
      const heldSince = uptimeMs;
      while (!outOfService()) {
        await hostStallService.stop(); // eslint-disable-line no-await-in-loop
        passMs(RESTART_EVERY_MS);
        await hostStallService.start(paths); // eslint-disable-line no-await-in-loop
        expect(uptimeMs - heldSince, 'never went out of service').to.be.below(2 * stuckIntervals * readIntervalMs);
      }

      expect(uptimeMs - heldSince).to.be.within(stuckIntervals * readIntervalMs, stuckIntervals * readIntervalMs + RESTART_EVERY_MS);
    });

    it('takes no reading while the uptime cannot be read', async () => {
      stuckMongod();
      await readTimes(2);
      fs.rmSync(path.join(procRoot, 'uptime'));
      stuckMongod(41);

      await hostStallService.readOnce(paths);

      expect(kept().threads.map(([, thread]) => thread.intervals)).to.deep.equal([1]);
      expect(placementHeld()).to.equal(true);
    });
  });

  it('names no wait point the kernel does not show', async () => {
    processWith('700', 'dockerd', [{ tid: '701', state: 'D', switches: 9, wchan: '0' }]);

    await readTimes(2);

    expect(fluxNetworkHelper.getPlacementHold()).to.include('dockerd thread 701 has been held in the kernel at unknown');
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
