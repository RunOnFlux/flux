const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appInspector tests', () => {
  let appInspector;
  let dockerServiceStub;
  let messageHelperStub;
  let logStub;
  let configStub;
  let globalStateStub;
  let cpuBurstHelperStub;
  let appUtilitiesStub;

  beforeEach(() => {
    configStub = {
      database: {
        url: 'mongodb://localhost:27017',
      },
      // The sampler's own cadence. Absent, config.fluxapps throws the moment the
      // interval is armed, which is why nothing had ever entered the loop body.
      fluxapps: {
        statsSampleIntervalMs: 60000,
      },
    };

    dockerServiceStub = {
      appDockerInspect: sinon.stub(),
      appDockerStats: sinon.stub(),
      appDockerUpdateCpu: sinon.stub().resolves(),
      dockerContainerInspect: sinon.stub(),
    };

    cpuBurstHelperStub = {
      isBurstActive: sinon.stub().resolves(false),
    };

    // Hoisted so a test can drive the disk reading. A partial one is a floor
    // rather than a total, and what the store does with it is the difference
    // between a chart and a cliff.
    appUtilitiesStub = {
      getContainerStorage: sinon.stub().resolves(0),
    };

    messageHelperStub = {
      createDataMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub().returns({
        status: 'error',
        data: { code: 401, name: 'Unauthorized', message: 'Unauthorized. Access denied.' },
      }),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    globalStateStub = {
      appsMonitored: {},
    };

    appInspector = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
      config: configStub,
      '../utils/globalState': globalStateStub,
      '../dockerService': dockerServiceStub,
      '../messageHelper': messageHelperStub,
      '../../lib/log': logStub,
      '../appQuery/appQueryService': {
        decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
      },
      '../serviceHelper': {
        ensureString: sinon.stub().returnsArg(0),
      },
      '../dbHelper': {
        databaseConnection: sinon.stub(),
      },
      '../verificationHelper': {
        verifyPrivilege: sinon.stub().resolves(true),
      },
      '../utils/appConstants': {
        appConstants: {},
      },
      '../utils/appUtilities': appUtilitiesStub,
      '../utils/cpuBurstHelper': cpuBurstHelperStub,
      'node-cmd': {
        run: (cmd, callback) => callback(null, 'data', 'stderr'),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('startAppMonitoring - what one tick keeps', () => {
    // The first coverage of the docker -> stored direction. Everything else about
    // the sampler is asserted on samples handed to it already extracted, so what
    // extractSample chooses to keep was pinned only by the endpoints downstream.
    let clock;

    const reading = (memStats) => ({
      cpu_stats: {
        cpu_usage: { total_usage: 500, percpu_usage: [1, 2, 3, 4] },
        system_cpu_usage: 900,
        online_cpus: 4,
        throttling_data: { periods: 0 },
      },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 400 },
      memory_stats: { usage: 2048, limit: 8192, max_usage: 4096, ...memStats },
      blkio_stats: { io_service_bytes_recursive: [{ op: 'Read', value: 10 }, { op: 'Write', value: 20 }] },
      networks: { eth0: { rx_bytes: 30, tx_bytes: 40, rx_packets: 9 } },
    });

    const tickOnce = async (memStats) => {
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(reading(memStats));
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      clock = sinon.useFakeTimers();
      appInspector.startAppMonitoring('myapp');
      await clock.tickAsync(60000);
      const [stored] = globalStateStub.appsMonitored.myapp.statsStore;
      appInspector.stopAppMonitoring('myapp', false);
      return stored;
    };

    afterEach(() => {
      if (clock) clock.restore();
      clock = null;
    });

    // setInterval does not default a missing delay - it coerces to NaN and treats
    // anything below 1 as ONE MILLISECOND. So a config without this key does not
    // stop the sampler, it runs it about a thousand times a second, asking docker
    // for stats on every monitored component. This key has gone missing before.
    it('samples on a sane cadence when the interval is missing from config', async () => {
      delete configStub.fluxapps.statsSampleIntervalMs;
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(reading({}));
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      clock = sinon.useFakeTimers();

      appInspector.startAppMonitoring('myapp');
      await clock.tickAsync(1000);
      const early = globalStateStub.appsMonitored.myapp.statsStore.length;
      await clock.tickAsync(59000);
      const afterAMinute = globalStateStub.appsMonitored.myapp.statsStore.length;
      appInspector.stopAppMonitoring('myapp', false);

      expect(early, 'sampled inside the first second - the interval fell back to ~1ms').to.equal(0);
      expect(afterAMinute, 'did not sample once a minute').to.equal(1);
    });

    // A partial reading means some mount could not be sized, so the total is a
    // floor rather than a value. getContainerStorage already refuses to cache one
    // for sixty seconds; this store keeps a sample for seven days and draws the
    // customer's disk chart from it, so a single short reading rendered as a
    // week-long cliff on a disk that never changed.
    it('does not chart a partial disk reading as a real drop', async () => {
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(reading({}));
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      appUtilitiesStub.getContainerStorage
        .onFirstCall().resolves({ used: 41943040, status: 'success' })
        .onSecondCall().resolves({ used: 1024, status: 'partial', unmeasured: ['/data'] });
      clock = sinon.useFakeTimers();

      appInspector.startAppMonitoring('myapp');
      await clock.tickAsync(60000);
      await clock.tickAsync(60000);
      const { statsStore } = globalStateStub.appsMonitored.myapp;
      appInspector.stopAppMonitoring('myapp', false);

      expect(statsStore).to.have.lengthOf(2);
      expect(
        statsStore[1].disk.used,
        'the partial reading was charted - a drop the disk never had',
      ).to.equal(41943040);
    });

    // Not just 'partial'. getContainerStorage's catch returns
    // { used: 0, status: 'error' } - a dockerd blip inside the tick is enough -
    // and storing that charts a drop to the FLOOR, which is worse than the
    // partial dip the guard was written for.
    it('does not chart a failed disk reading as a drop to zero either', async () => {
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(reading({}));
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      appUtilitiesStub.getContainerStorage
        .onFirstCall().resolves({ used: 41943040, status: 'success' })
        .onSecondCall().resolves({
          bind: 0, volume: 0, rootfs: 0, used: 0, status: 'error', message: 'docker is busy',
        });
      clock = sinon.useFakeTimers();

      appInspector.startAppMonitoring('myapp');
      await clock.tickAsync(60000);
      await clock.tickAsync(60000);
      const { statsStore } = globalStateStub.appsMonitored.myapp;
      appInspector.stopAppMonitoring('myapp', false);

      expect(
        statsStore[1].disk.used,
        'a failed reading charted as zero - the very drop the carry-forward exists to prevent',
      ).to.equal(41943040);
    });

    // Storing null would be WORSE than the dip: the dashboards read
    // `disk_stats.used || 0`, so an absent figure charts as zero - a drop to the
    // floor rather than a partial one.
    it('does not blank the disk figure when there is nothing to carry forward', async () => {
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(reading({}));
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      appUtilitiesStub.getContainerStorage.resolves({ used: 1024, status: 'partial' });
      clock = sinon.useFakeTimers();

      appInspector.startAppMonitoring('myapp');
      await clock.tickAsync(60000);
      const { statsStore } = globalStateStub.appsMonitored.myapp;
      appInspector.stopAppMonitoring('myapp', false);

      // nothing measured yet, so the short reading is all there is
      expect(statsStore[0].disk.used).to.equal(1024);
    });

    it('keeps the page cache figure, so a consumer can subtract it', async () => {
      // Without this the memory a consumer reports is docker's raw usage, which
      // counts file data the kernel is only holding because the container read it
      // - a number that climbs with disk activity and never comes back down.
      const stored = await tickOnce({ stats: { inactive_file: 512, active_file: 99 } });

      expect(stored.memoryUsage).to.equal(2048);
      expect(stored.memoryLimit).to.equal(8192);
      expect(stored.memoryCache).to.equal(512);
    });

    it('takes the cgroup v1 name when the v2 one is absent', async () => {
      const stored = await tickOnce({ stats: { cache: 300 } });

      expect(stored.memoryCache).to.equal(300);
    });

    it('records no cache rather than a zero when the host reports neither', async () => {
      // Zero would read as "nothing cached" and be silently subtracted; null says
      // the figure is unavailable, and leaves the consumer where it was before.
      const stored = await tickOnce({});

      expect(stored.memoryCache).to.equal(null);
    });

    it('keeps only the values a consumer reads, not the whole reading', async () => {
      // The extract is what makes a week of samples affordable, so a field added
      // here should be one nothing can work without - this pins the set.
      const stored = await tickOnce({ stats: { inactive_file: 512 } });

      expect(Object.keys(stored).sort()).to.deep.equal([
        'cpuSystem', 'cpuSystemBefore', 'cpuTotal', 'cpuTotalBefore', 'disk',
        'elapsed', 'ioRead', 'ioWrite', 'memoryCache', 'memoryLimit',
        'memoryUsage', 'nanoCpus', 'networks', 'onlineCpus',
        'timestamp',
      ]);
    });

    // The keys alone were the whole contract: the docker -> stored direction was
    // asserted on NAMES plus three values, so every extraction could have been
    // wired to the wrong field, or defaulted away, without a test noticing. This
    // pins the values, from one known reading.
    it('extracts every field from the reading, not just the right key names', async () => {
      const stored = await tickOnce({ stats: { inactive_file: 512, active_file: 99 } });

      expect(stored.cpuTotal).to.equal(500);
      expect(stored.cpuTotalBefore).to.equal(100);
      expect(stored.cpuSystem).to.equal(900);
      // Defaulted with ?? 0, so a mis-wired read silently becomes a plausible
      // zero rather than an error - and this is one of the four the throttler
      // divides by.
      expect(stored.cpuSystemBefore).to.equal(400);
      expect(stored.onlineCpus).to.equal(4);
      expect(stored.nanoCpus).to.equal(2e9);
      expect(stored.memoryUsage).to.equal(2048);
      expect(stored.memoryLimit).to.equal(8192);
      expect(stored.memoryCache).to.equal(512);
      expect(stored.networks.eth0.rx_bytes).to.equal(30);
      expect(stored.networks.eth0.tx_bytes).to.equal(40);
    });

    // appNetworkLinker attaches a container to further networks when a spec
    // declares networkWith. Reading eth0 alone made that traffic vanish from a
    // reading the base returned in full, and no chart could ever show it again.
    it('keeps every network interface, not only eth0', async () => {
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      const twoInterfaces = reading({ stats: { inactive_file: 512 } });
      twoInterfaces.networks = {
        eth0: { rx_bytes: 30, tx_bytes: 40, rx_packets: 9 },
        eth1: { rx_bytes: 700, tx_bytes: 800, rx_packets: 11 },
      };
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(twoInterfaces);
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      clock = sinon.useFakeTimers();

      appInspector.startAppMonitoring('myapp');
      await clock.tickAsync(60000);
      const [stored] = globalStateStub.appsMonitored.myapp.statsStore;
      appInspector.stopAppMonitoring('myapp', false);

      expect(Object.keys(stored.networks).sort()).to.deep.equal(['eth0', 'eth1']);
      expect(stored.networks.eth1.rx_bytes, 'a secondary interface was dropped').to.equal(700);
      expect(stored.networks.eth1.tx_bytes).to.equal(800);
      // still a narrowing: the packet/error/dropped counters do not survive
      expect(stored.networks.eth0).to.deep.equal({ rx_bytes: 30, tx_bytes: 40 });
    });

    // THE WIRE CONTRACT MOST LIKELY TO BREAK SILENTLY. Docker emits capitalised
    // blkio ops - the fixture uses docker's own casing - and the extract matches
    // them case-insensitively. Drop the .toLowerCase() and every app reports 0
    // bytes of disk IO forever, with a green suite.
    it('matches docker\'s capitalised blkio ops', async () => {
      const stored = await tickOnce({ stats: { inactive_file: 512 } });

      expect(stored.ioRead, 'blkio op matching became case-sensitive').to.equal(10);
      expect(stored.ioWrite).to.equal(20);
    });
  });

  describe('startAppMonitoring - the guards around the sample', () => {
    // The interval body decides, every minute, whether there is anything worth
    // sampling. Each guard below is the difference between a store full of empty
    // readings and one the CPU throttler can act on, and none of them was reachable
    // by a test until the interval could be armed at all.
    let clock;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    const healthyReading = () => ({
      cpu_stats: { cpu_usage: { total_usage: 500 }, system_cpu_usage: 900, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 400 },
      memory_stats: { usage: 2048, limit: 8192, stats: { inactive_file: 128 } },
      blkio_stats: { io_service_bytes_recursive: [] },
      networks: { eth0: { rx_bytes: 30, tx_bytes: 40 } },
    });

    const arm = ({ container = { State: 'running' } } = {}) => {
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves(container);
      dockerServiceStub.dockerContainerStats = sinon.stub().resolves(healthyReading());
      dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 2e9 } });
      clock = sinon.useFakeTimers();
      appInspector.startAppMonitoring('myapp');
    };

    const ticks = async (n) => {
      for (let i = 0; i < n; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await clock.tickAsync(60000);
      }
    };

    const stored = () => globalStateStub.appsMonitored.myapp?.statsStore ?? [];

    afterEach(() => {
      if (clock) clock.restore();
      clock = null;
    });

    it('refuses to start without an app name', () => {
      expect(() => appInspector.startAppMonitoring()).to.throw('No App specified');
    });

    it('samples nothing while the container is not running', async () => {
      // A created, exited or dead container reports no usage. Sampling it fills the
      // store with empty readings and leaves the throttler deciding on noise.
      arm({ container: { State: 'exited' } });
      await ticks(1);

      expect(stored()).to.have.lengthOf(0);
      expect(dockerServiceStub.dockerContainerStats.called, 'asked docker for stats on a stopped container').to.be.false;
    });

    it('stops monitoring, and drops the data, once the container is gone', async () => {
      // The app was removed underneath us. Left armed, the interval asks about a
      // container that will never exist again, once a minute, forever.
      arm({ container: null });
      await ticks(1);

      expect(globalStateStub.appsMonitored).to.not.have.property('myapp');
    });

    it('asks docker nothing once the app has been dropped from the monitored set', async () => {
      // Asserted on the call NOT being made, not on something having been logged:
      // without the guard the body falls through to `appsMonitored[appName].run`
      // on an undefined, throws, and the outer catch logs too - so a test that only
      // checks log.error passes whether the guard is there or not.
      arm();
      delete globalStateStub.appsMonitored.myapp;

      await ticks(1);

      expect(dockerServiceStub.getDockerContainerOnly.called, 'sampled an app that is no longer monitored').to.be.false;
      expect(logStub.error.calledWithMatch(/already stopped/)).to.be.true;
    });

    it('re-reads the cpu allocation every third tick and carries it in between', async () => {
      // The allocation only moves when the throttler moves it, so it is read on the
      // same cadence as before the store was narrowed - and carried onto the samples
      // in between rather than left null on two samples out of three.
      arm();
      await ticks(4);

      expect(dockerServiceStub.dockerContainerInspect.callCount, 'inspected on ticks 1 and 4 only').to.equal(2);
      expect(stored().map((sample) => sample.nanoCpus)).to.deep.equal([2e9, 2e9, 2e9, 2e9]);
    });

    it('drops samples older than seven days and keeps the rest', async () => {
      // The filter runs on every tick but has never had anything to drop: with one
      // sample in the store it is green on a coverage report and unproven in fact.
      arm();
      globalStateStub.appsMonitored.myapp.statsStore.push(
        { timestamp: 1, elapsed: -SEVEN_DAYS - 60000, memoryUsage: 1 },
        { timestamp: 2, elapsed: -1000, memoryUsage: 2 },
      );

      await ticks(1);

      const kept = stored();
      expect(kept.map((sample) => sample.timestamp)).to.not.include(1);
      expect(kept.map((sample) => sample.timestamp)).to.include(2);
      expect(kept).to.have.lengthOf(2); // the recent one, plus this tick's
    });

    // The test above seeds one sample just over seven days old and one a second
    // old, so ANY retention between about a minute and seven days passes it.
    // Shorten the window to hours and the frontend's 2-, 3- and 7-day ranges come
    // back empty, with nothing red. This pins the far edge.
    it('keeps a sample from days ago, not just a recent one', async () => {
      arm();
      const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
      const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;
      globalStateStub.appsMonitored.myapp.statsStore.push(
        { timestamp: 3, elapsed: -TWO_DAYS, memoryUsage: 3 },
        { timestamp: 4, elapsed: -SIX_DAYS, memoryUsage: 4 },
      );

      await ticks(1);

      const kept = stored().map((sample) => sample.timestamp);
      expect(kept, 'a two-day-old sample was dropped - the retention window is too short').to.include(3);
      expect(kept, 'a six-day-old sample was dropped - the retention window is too short').to.include(4);
    });

    it('replaces its own interval rather than running two', async () => {
      // Monitoring is (re)started from several places - boot, the reconciler, an
      // install. Arming a second interval over a live one doubles the sample rate
      // for that app and leaves a timer nothing can ever clear.
      arm();
      appInspector.startAppMonitoring('myapp');

      await ticks(1);

      expect(stored(), 'two intervals would each store a sample').to.have.lengthOf(1);
    });

    it('records no allocation when the inspect comes back without one', async () => {
      // A container inspect that resolves but carries no HostConfig leaves the
      // allocation unknown. Null says so; a zero would read as "no cpu allotted"
      // and the throttler divides by it.
      arm();
      dockerServiceStub.dockerContainerInspect.resolves({});

      await ticks(1);

      expect(stored()[0].nanoCpus).to.equal(null);
    });

    it('logs a failing reading instead of letting it escape the interval', async () => {
      // An unhandled rejection out of a setInterval callback takes the process with
      // it, so this app failing must not be the node failing.
      arm();
      dockerServiceStub.dockerContainerStats.rejects(new Error('docker is busy'));

      await ticks(1);

      // Matched on the message, not merely on log.error having been called.
      // log.error is reachable from the outer catch AND from two guard branches,
      // so `called === true` was sound only because the store-length assertion
      // below happened to pin which path ran - a pairing nothing recorded.
      const logged = logStub.error.getCalls()
        .map((call) => String(call.args[0]?.message ?? call.args[0]));
      expect(
        logged.some((message) => message.includes('docker is busy')),
        `logged something, but not the reading failure: ${JSON.stringify(logged)}`,
      ).to.equal(true);
      expect(stored()).to.have.lengthOf(0);
    });
  });

  describe('appInspect', () => {
    it('should inspect app and return data', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      const mockInspectData = { Name: 'testapp', State: 'running' };
      dockerServiceStub.dockerContainerInspect.resolves(mockInspectData);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: mockInspectData });

      await appInspector.appInspect(req, res);

      expect(dockerServiceStub.dockerContainerInspect.called).to.be.true;
      expect(res.json.calledOnce).to.be.true;
    });

    it('should handle missing appname', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      await appInspector.appInspect(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('appTop tests', () => {
    it('should return error if no params were passed, response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appTop(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if no params were passed, no response passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      const result = await appInspector.appTop(req);

      expect(result).to.have.property('status', 'error');
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges, response passed', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': {
          decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
        },
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appTop(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return error if user has no appowner privileges, no response passed', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      const result = await appInspectorWithAuth.appTop(req);

      expect(result).to.have.property('status', 'error');
    });

    it('should top app, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };

      dockerServiceStub.appDockerTop = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      const result = await appInspector.appTop(req);

      expect(result).to.have.property('status', 'success');
      expect(dockerServiceStub.appDockerTop.calledWith('test_myappname')).to.be.true;
    });

    it('should top app, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };

      dockerServiceStub.appDockerTop = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      const result = await appInspector.appTop(req);

      expect(result).to.have.property('status', 'success');
      expect(dockerServiceStub.appDockerTop.calledWith('myappname')).to.be.true;
    });
  });

  describe('appLog tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should log app, underscore in the name', async () => {
      const appInspectorWithHelper = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': {
          ...dockerServiceStub,
          dockerContainerLogs: sinon.stub().resolves('some data'),
        },
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returns('some data'),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
          lines: '10',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspectorWithHelper.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should log app, no underscore in the name', async () => {
      const appInspectorWithHelper = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': {
          ...dockerServiceStub,
          dockerContainerLogs: sinon.stub().resolves('some data'),
        },
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returns('some data'),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'myappname',
          lines: '10',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspectorWithHelper.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should log app, no underscore in the name, no lines param', async () => {
      const appInspectorWithHelper = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': {
          ...dockerServiceStub,
          dockerContainerLogs: sinon.stub().resolves('some data'),
        },
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
          dockerBufferToString: sinon.stub().returns('some data'),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(true),
        },
        '../utils/appConstants': {
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspectorWithHelper.appLog(req, res);

      expect(res.json.calledOnce).to.be.true;
    });
  });

  describe('appStats tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appStats(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appStats(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app stats, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      const mockStats = { data: 1000 };
      dockerServiceStub.appDockerStats.resolves(mockStats);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockStats,
      });

      await appInspector.appStats(req, res);

      expect(res.json.called).to.be.true;
    });

    it('should return app stats, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      const mockStats = { data: 1000 };
      dockerServiceStub.appDockerStats.resolves(mockStats);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockStats,
      });

      await appInspector.appStats(req, res);

      expect(res.json.called).to.be.true;
    });

    // The node samples every running container already. Before this the live view
    // took the same three docker readings again on every five-second poll and threw
    // them away, so the copy that was kept was the one nothing read.
    describe('serving a held reading', () => {
      const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);
      let req;
      let res;

      function storedSample(ageMs, overrides = {}) {
        return {
          timestamp: Date.now() - ageMs,
          elapsed: monotonicNow() - ageMs,
          cpuTotal: 500,
          cpuTotalBefore: 100,
          cpuSystem: 800,
          cpuSystemBefore: 400,
          onlineCpus: 4,
          nanoCpus: 3e9,
          memoryUsage: 2048,
          memoryLimit: 8192,
          memoryCache: 512,
          ioRead: 1,
          ioWrite: 2,
          networks: { eth0: { rx_bytes: 3, tx_bytes: 4 } },
          disk: { bind: 7 },
          ...overrides,
        };
      }

      beforeEach(() => {
        req = { params: { appname: 'myapp' }, query: {} };
        res = { json: sinon.stub() };
        messageHelperStub.createDataMessage.returnsArg(0);
        dockerServiceStub.dockerContainerStats = sinon.stub().resolves({
          cpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 2, online_cpus: 1 },
          precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
          memory_stats: { usage: 1, limit: 2 },
        });
        dockerServiceStub.dockerContainerInspect.resolves({ HostConfig: { NanoCpus: 1e9 } });
      });

      it('should read what the sampler already collected rather than docker', async () => {
        globalStateStub.appsMonitored = { myapp: { statsStore: [storedSample(500)] } };

        await appInspector.appStats(req, res);

        expect(dockerServiceStub.dockerContainerStats.called).to.be.false;
        const reported = res.json.firstCall.args[0];
        expect(reported.memory_stats).to.deep.equal({
          usage: 2048, limit: 8192, stats: { inactive_file: 512 },
        });
        expect(reported.cpu_stats.online_cpus).to.equal(4);
      });

      it('should take one reading however many callers ask at once', async () => {
        // Started together and awaited together. Awaiting each in turn tests the
        // case that already worked - the first caller leaves a fresh reading and
        // the rest read it - and says nothing about callers that arrive while one
        // is still in flight, which is the case that costs a du walk apiece.
        globalStateStub.appsMonitored = { myapp: { statsStore: [] } };
        let release;
        dockerServiceStub.dockerContainerStats.returns(new Promise((resolve) => {
          release = () => resolve({
            cpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 2, online_cpus: 1 },
            precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
            memory_stats: { usage: 1, limit: 2 },
          });
        }));

        const calls = [
          appInspector.appStats(req, res),
          appInspector.appStats(req, { json: sinon.stub() }),
          appInspector.appStats(req, { json: sinon.stub() }),
        ];
        // All three are past the freshness check and inside the reading before any
        // of them can finish - the window this exists to close.
        await new Promise((resolve) => { setImmediate(resolve); });
        release();
        await Promise.all(calls);

        expect(dockerServiceStub.dockerContainerStats.calledOnce).to.be.true;
      });

      it('gives every concurrent caller the same reading', async () => {
        // Sharing the work is only right if it shares the ANSWER. Each call is made
        // to return different numbers, so three separate readings cannot look like
        // one: with a stub that answers identically every time this passes whether
        // the work is shared or not, and proves nothing.
        globalStateStub.appsMonitored = { myapp: { statsStore: [] } };
        const reading = (total) => ({
          cpu_stats: { cpu_usage: { total_usage: total }, system_cpu_usage: 2, online_cpus: 1 },
          precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
          memory_stats: { usage: 1, limit: 2 },
        });
        dockerServiceStub.dockerContainerStats.onCall(0).resolves(reading(100));
        dockerServiceStub.dockerContainerStats.onCall(1).resolves(reading(200));
        dockerServiceStub.dockerContainerStats.onCall(2).resolves(reading(300));
        const second = { json: sinon.stub() };
        const third = { json: sinon.stub() };

        await Promise.all([
          appInspector.appStats(req, res),
          appInspector.appStats(req, second),
          appInspector.appStats(req, third),
        ]);

        const totals = [res, second, third]
          .map((r) => r.json.firstCall.args[0].cpu_stats.cpu_usage.total_usage);
        expect(totals).to.deep.equal([100, 100, 100]);
      });

      it('does not hand a failed reading to the next caller', async () => {
        // The entry has to be dropped when the promise rejects too, or one docker
        // hiccup is replayed to everyone who asks until something else clears it.
        globalStateStub.appsMonitored = { myapp: { statsStore: [] } };
        dockerServiceStub.dockerContainerStats.rejects(new Error('docker is busy'));
        messageHelperStub.createErrorMessage.returns({ status: 'error' });

        await appInspector.appStats(req, res);

        dockerServiceStub.dockerContainerStats.resolves({
          cpu_stats: { cpu_usage: { total_usage: 9 }, system_cpu_usage: 2, online_cpus: 1 },
          precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
          memory_stats: { usage: 1, limit: 2 },
        });
        const after = { json: sinon.stub() };
        await appInspector.appStats(req, after);

        expect(dockerServiceStub.dockerContainerStats.calledTwice).to.be.true;
        expect(after.json.firstCall.args[0].cpu_stats.cpu_usage.total_usage).to.equal(9);
      });

      // Without this a permanently stuck reading passes the test above perfectly.
      it('should take a fresh reading once the held one has aged out', async () => {
        globalStateStub.appsMonitored = { myapp: { statsStore: [storedSample(30_000)] } };

        await appInspector.appStats(req, res);

        expect(dockerServiceStub.dockerContainerStats.calledOnce).to.be.true;
      });
    });
  });

  describe('appMonitor tests', () => {
    // Samples are held as the handful of values the consumers read; the endpoint
    // puts them back into the docker stats shape callers already parse.
    function sample(timestamp, overrides = {}) {
      return {
        timestamp,
        elapsed: timestamp,
        cpuTotal: 200,
        cpuTotalBefore: 100,
        cpuSystem: 400,
        cpuSystemBefore: 200,
        onlineCpus: 2,
        nanoCpus: 2e9,
        memoryUsage: 1024,
        memoryLimit: 4096,
        memoryCache: 256,
        ioRead: 10,
        ioWrite: 20,
        networks: { eth0: { rx_bytes: 30, tx_bytes: 40 } },
        disk: {
          bind: 5, volume: 0, rootfs: 0, used: 5, status: 'ok',
        },
        ...overrides,
      };
    }

    const stats = [sample(1_000), sample(2_000)];

    it('should return every collected sample when no range is given', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };

      const result = appInspector.appMonitor('test_myapp');

      expect(result.map((s) => s.timestamp)).to.deep.equal([1_000, 2_000]);
    });

    it('should report a sample in the shape consumers parse', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [sample(1_000)] } };

      const [{ data }] = appInspector.appMonitor('test_myapp');

      expect(data.cpu_stats.cpu_usage.total_usage).to.equal(200);
      expect(data.precpu_stats.cpu_usage.total_usage).to.equal(100);
      expect(data.cpu_stats.system_cpu_usage).to.equal(400);
      expect(data.precpu_stats.system_cpu_usage).to.equal(200);
      expect(data.cpu_stats.online_cpus).to.equal(2);
      expect(data.nanoCpus).to.equal(2e9);
      // The cache figure is what a consumer subtracts to get the memory the app
      // is actually using; usage alone climbs with every file the container reads.
      expect(data.memory_stats).to.deep.equal({
        usage: 1024, limit: 4096, stats: { inactive_file: 256 },
      });
      expect(data.networks.eth0).to.deep.equal({ rx_bytes: 30, tx_bytes: 40 });
      expect(data.disk_stats.bind).to.equal(5);
    });

    // The chart sums the blkio entries because docker reports one per device in
    // the stack. Reporting the totals as a read and a write entry gives the same
    // sum, and gives a caller that reads only the first entry the true figure.
    it('should report summed disk io as one read and one write entry', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [sample(1_000)] } };

      const [{ data }] = appInspector.appMonitor('test_myapp');

      expect(data.blkio_stats.io_service_bytes_recursive).to.deep.equal([
        { op: 'read', value: 10 },
        { op: 'write', value: 20 },
      ]);
    });

    it('should report absent disk io as absent rather than zero', () => {
      globalStateStub.appsMonitored = {
        test_myapp: { statsStore: [sample(1_000, { ioRead: null, ioWrite: null })] },
      };

      const [{ data }] = appInspector.appMonitor('test_myapp');

      expect(data.blkio_stats.io_service_bytes_recursive).to.be.null;
    });

    it('should drop samples older than the requested range', () => {
      const now = Date.now();
      globalStateStub.appsMonitored = {
        test_myapp: { statsStore: [sample(now - 60_000), sample(now - 1_000)] },
      };

      const result = appInspector.appMonitor('test_myapp', 30_000);

      expect(result.map((s) => s.timestamp)).to.deep.equal([now - 1_000]);
    });

    it('should accept a range given as a string', () => {
      const now = Date.now();
      globalStateStub.appsMonitored = { test_myapp: { statsStore: [sample(now - 1_000)] } };

      const result = appInspector.appMonitor('test_myapp', '30000');

      expect(result.map((s) => s.timestamp)).to.deep.equal([now - 1_000]);
    });

    it('should throw if no app name was passed', () => {
      expect(() => appInspector.appMonitor()).to.throw('No Flux App specified');
    });

    it('should throw if the range is not a positive integer', () => {
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };

      expect(() => appInspector.appMonitor('test_myapp', -1)).to.throw('Invalid range value');
      expect(() => appInspector.appMonitor('test_myapp', 'soon')).to.throw('Invalid range value');
    });

    it('should throw if the app is not monitored', () => {
      globalStateStub.appsMonitored = {};

      expect(() => appInspector.appMonitor('test_myapp')).to.throw('No data available');
    });

    // Beyond a day the series is thinned so a week of samples does not have to be sent
    // or drawn in full. The frontend offers 2, 3 and 7 day ranges, so this is the path
    // those take.
    describe('ranges beyond a day', () => {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const HOUR_MS = 60 * 60 * 1000;

      // A minute apart, which is the sampler's cadence.
      function seedMinutes(count) {
        const now = Date.now();
        const samples = Array.from(
          { length: count },
          (_, i) => sample(now - (count - 1 - i) * 60_000),
        );
        globalStateStub.appsMonitored = { test_myapp: { statsStore: samples } };
        return samples;
      }

      it('should thin to one sample an hour', () => {
        seedMinutes(6 * 60); // six hours of samples

        const result = appInspector.appMonitor('test_myapp', 2 * DAY_MS);

        const gaps = result.slice(1).map((s, i) => s.timestamp - result[i].timestamp);
        gaps.slice(0, -1).forEach((gap) => expect(gap).to.equal(HOUR_MS));
        // Exactly seven: six hours of minute samples thinned to one an hour, plus
        // the newest. A three-wide range absorbs an off-by-one in the
        // newest-sample append, which is the part most likely to break.
        expect(result.length).to.equal(7);
      });

      // Thinning by position would drop it whenever the count is not a multiple of
      // the stride, leaving the chart's right edge short of the present.
      it('should always include the most recent sample', () => {
        const samples = seedMinutes(6 * 60 + 7);

        const result = appInspector.appMonitor('test_myapp', 2 * DAY_MS);

        expect(result[result.length - 1].timestamp).to.equal(samples[samples.length - 1].timestamp);
      });

      // The store's cadence is the sampler's business, not the endpoint's: thinning
      // reads timestamps, so a denser or sparser series still comes back hourly.
      it('should thin to one an hour whatever the sampling cadence', () => {
        const now = Date.now();
        const samples = Array.from({ length: 72 }, (_, i) => sample(now - (71 - i) * 5 * 60_000));
        globalStateStub.appsMonitored = { test_myapp: { statsStore: samples } };

        const result = appInspector.appMonitor('test_myapp', 2 * DAY_MS);

        const gaps = result.slice(1).map((s, i) => s.timestamp - result[i].timestamp);
        gaps.slice(0, -1).forEach((gap) => expect(gap).to.equal(HOUR_MS));
      });

      it('should return every sample for a range of exactly one day', () => {
        seedMinutes(45);

        const result = appInspector.appMonitor('test_myapp', DAY_MS);

        expect(result).to.have.lengthOf(45);
      });

      it('should return every sample for ranges under a day', () => {
        seedMinutes(45);

        const result = appInspector.appMonitor('test_myapp', HOUR_MS);

        expect(result).to.have.lengthOf(45);
      });
    });
  });

  describe('appMonitorAPI authorization tests', () => {
    // An app's resource history belongs to its owner, so the check has to be proven by
    // showing the data does not come back — asserting only that some response was sent
    // passes just as well when the check is gone.
    function buildWithPrivilege(authorized) {
      return proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../utils/globalState': globalStateStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': {
          decryptEnterpriseApps: sinon.stub().returnsArg(0),
        },
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0) },
        '../dbHelper': { databaseConnection: sinon.stub() },
        '../verificationHelper': { verifyPrivilege: sinon.stub().resolves(authorized) },
        '../utils/appConstants': { appConstants: {} },
        '../utils/appUtilities': { getContainerStorage: sinon.stub().returns(0) },
        '../utils/cpuBurstHelper': { isBurstActive: sinon.stub().resolves(false) },
        'node-cmd': { run: sinon.stub() },
      });
    }

    const stats = [{ timestamp: 1, cpu: 5 }];
    let req;
    let res;

    beforeEach(() => {
      req = { params: { appname: 'test_myapp' }, query: {} };
      res = { json: sinon.stub() };
      globalStateStub.appsMonitored = { test_myapp: { statsStore: stats } };
    });

    it('should withhold monitoring data from an unauthorized caller', async () => {
      const unauthorized = buildWithPrivilege(false);

      await unauthorized.appMonitorAPI(req, res);

      sinon.assert.notCalled(messageHelperStub.createDataMessage);
      sinon.assert.calledOnce(messageHelperStub.errUnauthorizedMessage);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should return monitoring data to an authorized caller', async () => {
      const authorized = buildWithPrivilege(true);
      messageHelperStub.createDataMessage.returnsArg(0);

      await authorized.appMonitorAPI(req, res);

      const reported = messageHelperStub.createDataMessage.firstCall.args[0];
      expect(reported.map((s) => s.timestamp)).to.deep.equal(stats.map((s) => s.timestamp));
      sinon.assert.notCalled(messageHelperStub.errUnauthorizedMessage);
      sinon.assert.calledOnceWithExactly(res.json, reported);
    });

    it('should scope the privilege check to the parent app of a component', async () => {
      const verifyPrivilege = sinon.stub().resolves(true);
      const inspector = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../utils/globalState': globalStateStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../appQuery/appQueryService': { decryptEnterpriseApps: sinon.stub().returnsArg(0) },
        '../serviceHelper': { ensureString: sinon.stub().returnsArg(0) },
        '../dbHelper': { databaseConnection: sinon.stub() },
        '../verificationHelper': { verifyPrivilege },
        '../utils/appConstants': { appConstants: {} },
        '../utils/appUtilities': { getContainerStorage: sinon.stub().returns(0) },
        '../utils/cpuBurstHelper': { isBurstActive: sinon.stub().resolves(false) },
        'node-cmd': { run: sinon.stub() },
      });

      await inspector.appMonitorAPI(req, res);

      sinon.assert.calledOnceWithExactly(verifyPrivilege, 'appownerabove', req, 'myapp');
    });
  });

  describe('appMonitorAPI tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appMonitorAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appMonitorAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app monitor data, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };
      const stats = [{ timestamp: 1, cpu: 5 }];
      globalStateStub.appsMonitored = { test_myappname: { statsStore: stats } };

      const dataMessage = { status: 'success', data: stats };
      messageHelperStub.createDataMessage.returns(dataMessage);

      await appInspector.appMonitorAPI(req, res);

      expect(messageHelperStub.createDataMessage.calledOnce).to.be.true;
      expect(messageHelperStub.createDataMessage.firstCall.args[0].map((s) => s.timestamp))
        .to.deep.equal(stats.map((s) => s.timestamp));
      expect(res.json.calledOnceWithExactly(dataMessage)).to.be.true;
      expect(logStub.error.called).to.be.false;
    });

    it('should return app monitor data, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };
      const stats = [{ timestamp: 1, cpu: 5 }];
      globalStateStub.appsMonitored = { myappname: { statsStore: stats } };

      const dataMessage = { status: 'success', data: stats };
      messageHelperStub.createDataMessage.returns(dataMessage);

      await appInspector.appMonitorAPI(req, res);

      expect(messageHelperStub.createDataMessage.calledOnce).to.be.true;
      expect(messageHelperStub.createDataMessage.firstCall.args[0].map((s) => s.timestamp))
        .to.deep.equal(stats.map((s) => s.timestamp));
      expect(res.json.calledOnceWithExactly(dataMessage)).to.be.true;
      expect(logStub.error.called).to.be.false;
    });

    it('should return error if app is not monitored', async () => {
      const req = {
        params: {
          appname: 'test_nonexistent',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No data available',
        },
      });

      await appInspector.appMonitorAPI(req, res);

      expect(res.json.called).to.be.true;
    });
  });

  describe('appChanges tests', () => {
    it('should return error if no app name was passed', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Flux App specified',
        },
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if user has no appowner privileges', async () => {
      const appInspectorWithAuth = proxyquire('../../ZelBack/src/services/appManagement/appInspector', {
        config: configStub,
        '../dockerService': dockerServiceStub,
        '../messageHelper': messageHelperStub,
        '../../lib/log': logStub,
        '../serviceHelper': {
          ensureString: sinon.stub().returnsArg(0),
        },
        '../dbHelper': {
          databaseConnection: sinon.stub(),
        },
        '../verificationHelper': {
          verifyPrivilege: sinon.stub().resolves(false),
        },
        '../utils/appConstants': {
          '../appQuery/appQueryService': {
            decryptEnterpriseApps: sinon.stub().callsFake(async (apps) => ({ readable: apps, unreadable: [], inPlace: apps })),
          },
          appConstants: {},
        },
        '../utils/appUtilities': {
          getContainerStorage: sinon.stub().returns(0),
        },
        'node-cmd': {
          run: (cmd, callback) => callback(null, 'data', 'stderr'),
        },
      });

      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });

      await appInspectorWithAuth.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
    });

    it('should return app changes, underscore in the name', async () => {
      const req = {
        params: {
          appname: 'test_myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerContainerChanges = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(dockerServiceStub.dockerContainerChanges.calledWith('test_myappname')).to.be.true;
    });

    it('should return app changes, no underscore in the name', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerContainerChanges = sinon.stub().resolves('some data');
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: 'some data',
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(dockerServiceStub.dockerContainerChanges.calledWith('myappname')).to.be.true;
    });

    it('should return error if docker throws', async () => {
      const req = {
        params: {
          appname: 'myappname',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerContainerChanges = sinon.stub().rejects(new Error('Docker error'));
      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Docker error',
        },
      });

      await appInspector.appChanges(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });


  describe('listAppsImages tests', () => {
    it('should return error if dockerService throws, no response passed', async () => {
      dockerServiceStub.dockerListImages = sinon.stub().rejects(new Error('Error'));
      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });

      const result = await appInspector.listAppsImages();

      expect(result).to.have.property('status', 'error');
      expect(logStub.error.called).to.be.true;
    });

    it('should return error if dockerService throws, response passed', async () => {
      const res = {
        json: sinon.stub(),
      };
      dockerServiceStub.dockerListImages = sinon.stub().rejects(new Error('Error'));
      messageHelperStub.createErrorMessage.returns({
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Error',
        },
      });

      await appInspector.listAppsImages(undefined, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should return running apps, no response passed', async () => {
      const mockImages = [{ RepoTags: ['image1:latest'] }, { RepoTags: ['image2:latest'] }];
      dockerServiceStub.dockerListImages = sinon.stub().resolves(mockImages);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockImages,
      });

      const result = await appInspector.listAppsImages();

      expect(result).to.have.property('status', 'success');
    });

    it('should return running apps, response passed', async () => {
      const mockImages = [{ RepoTags: ['image1:latest'] }, { RepoTags: ['image2:latest'] }];
      const res = {
        json: sinon.stub(),
      };
      dockerServiceStub.dockerListImages = sinon.stub().resolves(mockImages);
      messageHelperStub.createDataMessage.returns({
        status: 'success',
        data: mockImages,
      });

      await appInspector.listAppsImages(undefined, res);

      expect(res.json.calledOnce).to.be.true;
    });
  });

  // The throttler physically re-allocates container CPU, so these pin the exact
  // decisions it makes for a given window of samples: which calls it emits, and
  // what it leaves behind for the next pass.
  describe('checkApplicationsCpuUSage', () => {
    // A sample carries its own cpu delta, so `ratio` is that sample's usage as a
    // fraction of one core-second: 1 is saturated, 0.5 is half loaded.
    // elapsed is the monotonic clock the decision window filters on; timestamp is
    // the wall clock the charts plot
    const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);

    // The monotonic clock counts from system boot, so a sample described as five
    // minutes old is only expressible on a host that has been up that long - on a
    // younger one it lands before the origin, falls outside the decision window,
    // and the throttler is asked to decide on fewer samples than it was given.
    // These tests are about which decisions a window of samples produces, so the
    // clock is pinned to a host of a settled age and the arithmetic stops
    // depending on the machine that happens to be running them.
    const hostUpMs = 6 * 60 * 60 * 1000;
    let realHrtimeBigint;

    beforeEach(() => {
      realHrtimeBigint = process.hrtime.bigint;
      const origin = realHrtimeBigint();
      process.hrtime.bigint = () => BigInt(hostUpMs) * 1000000n + (realHrtimeBigint() - origin);
    });

    afterEach(() => {
      process.hrtime.bigint = realHrtimeBigint;
    });

    function cpuSample(ratio, minutesAgo) {
      return {
        timestamp: Date.now() - minutesAgo * 60 * 1000,
        elapsed: monotonicNow() - minutesAgo * 60 * 1000,
        cpuTotal: 100 + 100 * ratio,
        cpuTotalBefore: 100,
        cpuSystem: 200,
        cpuSystemBefore: 100,
        onlineCpus: 2,
      };
    }

    function window(ratios) {
      return ratios.map((ratio, i) => cpuSample(ratio, ratios.length - i));
    }

    // nanoCpus over cpu over 1e9 is the allocation the node has actually applied
    // against what the spec asked for: 2e9 on a 2-cpu app is the full share.
    function installedAppsReturning(app) {
      return sinon.stub().resolves({ status: 'success', data: [app] });
    }

    const simpleApp = { name: 'myapp', version: 3, cpu: 2 };

    beforeEach(() => {
      dockerServiceStub.dockerContainerInspect.resolves({
        HostConfig: { NanoCpus: 2e9 },
        State: { Pid: 1234 },
      });
    });

    it('lowers cpu when load was high on at least 80% of the window', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('myapp', 1.8e9)).to.be.true;
    });

    // The window is snapshotted before two awaits, and stopAppMonitoring can land
    // in that gap - an uninstall, a reconciler recreate, or the sampler noticing
    // the container has gone. The watermark write then lands on undefined and
    // throws to the function-level catch, which abandons the pass: every app
    // ordered after it goes un-inspected, and unthrottled, until the next attempt
    // fifteen minutes later. Its sibling burst-skip write was already guarded.
    it('keeps throttling the rest when an app stops being monitored mid-pass', async () => {
      globalStateStub.appsMonitored = {
        appone: { statsStore: window([1, 1, 1, 1, 1]) },
        apptwo: { statsStore: window([1, 1, 1, 1, 1]) },
      };
      dockerServiceStub.dockerContainerInspect.callsFake(async (name) => {
        if (name === 'appone') delete globalStateStub.appsMonitored.appone;
        return { HostConfig: { NanoCpus: 2e9 }, State: { Pid: 1234 } };
      });
      const twoApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { name: 'appone', version: 3, cpu: 2 },
          { name: 'apptwo', version: 3, cpu: 2 },
        ],
      });

      await appInspector.checkApplicationsCpuUSage(globalStateStub.appsMonitored, twoApps);

      expect(
        dockerServiceStub.appDockerUpdateCpu.calledWith('apptwo', 1.8e9),
        'the app after the one that vanished was never throttled - the pass was abandoned',
      ).to.be.true;
    });

    it('does not strand a sample that arrives while the decision is being made', async () => {
      // The window is snapshotted before the inspect, so a sample landing during
      // it is not in this decision. Dating the watermark after the awaits would
      // also put that sample behind the NEXT window's floor, and no decision
      // would ever count it - the gap the watermark exists to close.
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };
      let midFlight;
      dockerServiceStub.dockerContainerInspect.callsFake(async () => {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        midFlight = cpuSample(1, 0);
        globalStateStub.appsMonitored.myapp.statsStore.push(midFlight);
        return { HostConfig: { NanoCpus: 2e9 }, State: { Pid: 1234 } };
      });

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(midFlight, 'the sample really did arrive mid-decision').to.not.be.undefined;
      expect(globalStateStub.appsMonitored.myapp.lastCpuDecisionAt)
        .to.be.below(midFlight.elapsed);
    });

    it('leaves cpu alone when load was high on less than 80% of the window', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 0.5, 0.5]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
    });

    it('restores cpu when the applied allocation is below the spec and load is not high', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        HostConfig: { NanoCpus: 1.6e9 },
        State: { Pid: 1234 },
      });
      globalStateStub.appsMonitored = { myapp: { statsStore: window([0.5, 0.5, 0.5, 0.5, 0.5]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('myapp', 1.7e9)).to.be.true;
    });

    it('makes no decision on four or fewer samples, and keeps them for the next pass', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.statsStore).to.have.lengthOf(4);
    });

    it('does not reuse a sample in a later decision', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );
      dockerServiceStub.appDockerUpdateCpu.resetHistory();
      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
    });

    it('makes no decision while cfs burst is applied, and consumes the window', async () => {
      cpuBurstHelperStub.isBurstActive.resolves(true);
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;

      // burst ends, but the samples it declined to judge are spent
      cpuBurstHelperStub.isBurstActive.resolves(false);
      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
    });

    it('keeps the window when docker cannot inspect the container', async () => {
      dockerServiceStub.dockerContainerInspect.resolves(null);
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1, 1]) } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(globalStateStub.appsMonitored.myapp.statsStore).to.have.lengthOf(5);
    });

    // THE TWO PROPERTIES THE WATERMARK DESIGN RESTS ON. Both survived mutation
    // until now: the tests that looked like they pinned them asserted statsStore
    // LENGTH, and checkApplicationsCpuUSage never writes statsStore - that is the
    // entire point of a watermark - so they were true by construction.

    // A pass that reaches no decision must leave the watermark where it was, or
    // the samples it declined to act on fall behind the next window's floor and
    // no decision ever counts them. A container docker cannot inspect would burn
    // its samples every fifteen minutes and never be throttled again.
    it('does not advance the watermark when it makes no decision', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1]), lastCpuDecisionAt: 0 } };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;
      expect(
        globalStateStub.appsMonitored.myapp.lastCpuDecisionAt,
        'the watermark moved on a pass that decided nothing - those samples can never be counted',
      ).to.equal(0);
    });

    // ...and the samples it kept must still be usable, which is the half a
    // length assertion could never show.
    it('counts the samples it declined to act on in the next decision', async () => {
      globalStateStub.appsMonitored = { myapp: { statsStore: window([1, 1, 1, 1]), lastCpuDecisionAt: 0 } };
      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );
      expect(dockerServiceStub.appDockerUpdateCpu.called).to.be.false;

      // one more sample arrives; the four above must still be in the window
      globalStateStub.appsMonitored.myapp.statsStore.push(cpuSample(1, 0));
      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledWith('myapp', 1.8e9)).to.be.true;
    });

    // The window is floored at max(watermark, an hour ago). Without the hour, a
    // component that has never been decided on accumulates every sample it has
    // ever taken, and a burst from last week still counts toward today's 80%.
    it('does not decide on samples older than the window, however long since the last decision', async () => {
      globalStateStub.appsMonitored = {
        myapp: {
          statsStore: [
            ...[70, 69, 68, 67, 66, 65, 64, 63, 62, 61].map((m) => cpuSample(1, m)),
            ...window([1, 1, 1, 1]),
          ],
          lastCpuDecisionAt: 0,
        },
      };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(
        dockerServiceStub.appDockerUpdateCpu.called,
        'decided using samples over an hour old - the window floor is not being applied',
      ).to.be.false;
    });

    // The floor is exclusive. A sample sitting exactly ON the watermark was
    // already counted by the decision that set it.
    it('excludes a sample sitting exactly on the watermark', async () => {
      const samples = window([1, 1, 1, 1, 1]);
      globalStateStub.appsMonitored = {
        myapp: { statsStore: samples, lastCpuDecisionAt: samples[0].elapsed },
      };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(simpleApp),
      );

      expect(
        dockerServiceStub.appDockerUpdateCpu.called,
        'counted the sample on the boundary - it was already used by the previous decision',
      ).to.be.false;
    });

    // The compose path has its own copy of the watermark write, and its own copy
    // of the guard. Both need covering: a composed app is the common shape.
    it('keeps throttling the rest when a COMPONENT stops being monitored mid-pass', async () => {
      const composed = {
        name: 'myapp',
        version: 4,
        compose: [{ name: 'db', cpu: 2 }, { name: 'web', cpu: 2 }],
      };
      globalStateStub.appsMonitored = {
        db_myapp: { statsStore: window([1, 1, 1, 1, 1]) },
        web_myapp: { statsStore: window([1, 1, 1, 1, 1]) },
      };
      dockerServiceStub.dockerContainerInspect.callsFake(async (name) => {
        if (name === 'db_myapp') delete globalStateStub.appsMonitored.db_myapp;
        return { HostConfig: { NanoCpus: 2e9 }, State: { Pid: 1234 } };
      });

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(composed),
      );

      expect(
        dockerServiceStub.appDockerUpdateCpu.calledWith('web_myapp', 1.8e9),
        'the component after the one that vanished was never throttled - the pass was abandoned',
      ).to.be.true;
    });

    it('decides per component for a composed app', async () => {
      const composed = {
        name: 'myapp',
        version: 4,
        compose: [{ name: 'db', cpu: 2 }, { name: 'web', cpu: 2 }],
      };
      globalStateStub.appsMonitored = {
        db_myapp: { statsStore: window([1, 1, 1, 1, 1]) },
        web_myapp: { statsStore: window([0.5, 0.5, 0.5, 0.5, 0.5]) },
      };

      await appInspector.checkApplicationsCpuUSage(
        globalStateStub.appsMonitored,
        installedAppsReturning(composed),
      );

      expect(dockerServiceStub.appDockerUpdateCpu.calledOnceWithExactly('db_myapp', 1.8e9)).to.be.true;
    });
  });

  describe('exported functions', () => {
    it('should export monitoring functions', () => {
      expect(appInspector.startAppMonitoring).to.be.a('function');
      expect(appInspector.stopAppMonitoring).to.be.a('function');
      expect(appInspector.appInspect).to.be.a('function');
      expect(appInspector.appTop).to.be.a('function');
      expect(appInspector.appLog).to.be.a('function');
      expect(appInspector.appStats).to.be.a('function');
      expect(appInspector.appMonitor).to.be.a('function');
      expect(appInspector.appChanges).to.be.a('function');
      expect(appInspector.listAppsImages).to.be.a('function');
    });
  });
});
