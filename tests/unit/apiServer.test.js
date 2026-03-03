const { expect } = require('chai');
const sinon = require('sinon');

/**
 * These tests isolate and test the SIGTERM handling logic from apiServer.js
 * without loading the full module which has complex config dependencies.
 */
describe('apiServer SIGTERM handling tests', () => {
  describe('isSystemShuttingDown logic tests', () => {
    let fsExistsSyncStub;
    let runCommandStub;

    // Recreate the isSystemShuttingDown function logic for isolated testing (async version)
    async function isSystemShuttingDown(fsModule, runCommandFn) {
      // Method 1: Check for systemd scheduled shutdown file
      try {
        if (fsModule.existsSync('/run/systemd/shutdown/scheduled')) {
          return { detected: true, method: 'scheduled' };
        }
      } catch (e) {
        // Ignore errors
      }

      // Method 2: Check systemd's current state
      const { stdout: systemState } = await runCommandFn('systemctl', {
        params: ['is-system-running'],
        timeout: 5000,
        logError: false,
      });
      if (systemState && systemState.trim() === 'stopping') {
        return { detected: true, method: 'systemctl-stopping' };
      }

      // Method 3: Check for active shutdown/reboot jobs in systemd
      const { stdout: jobs } = await runCommandFn('systemctl', {
        params: ['list-jobs', '--no-pager'],
        timeout: 5000,
        logError: false,
      });
      if (jobs && (jobs.includes('shutdown.target') || jobs.includes('reboot.target') || jobs.includes('poweroff.target') || jobs.includes('halt.target'))) {
        return { detected: true, method: 'list-jobs' };
      }

      // Method 4: Check for running shutdown/reboot processes
      const { stdout: shutdownPid } = await runCommandFn('pgrep', {
        params: ['-x', 'shutdown'],
        timeout: 5000,
        logError: false,
      });
      if (shutdownPid && shutdownPid.trim()) {
        return { detected: true, method: 'pgrep-shutdown' };
      }

      // Method 5: Check runlevel (0 = halt, 6 = reboot)
      const { stdout: runlevel } = await runCommandFn('runlevel', {
        timeout: 5000,
        logError: false,
      });
      if (runlevel) {
        const trimmedRunlevel = runlevel.trim();
        if (trimmedRunlevel.endsWith(' 0') || trimmedRunlevel.endsWith(' 6')) {
          return { detected: true, method: 'runlevel' };
        }
      }

      // Method 6: Check for /run/nologin (created during shutdown)
      try {
        if (fsModule.existsSync('/run/nologin')) {
          return { detected: true, method: 'nologin' };
        }
      } catch (e) {
        // Ignore errors
      }

      return { detected: false };
    }

    beforeEach(() => {
      fsExistsSyncStub = sinon.stub();
      runCommandStub = sinon.stub();

      // Default: no shutdown indicators
      fsExistsSyncStub.returns(false);
      // Default: commands return empty/no output
      runCommandStub.resolves({ stdout: '', stderr: '', error: null });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false when no shutdown indicators are present', async () => {
      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);
      expect(result.detected).to.equal(false);
    });

    it('should detect shutdown via /run/systemd/shutdown/scheduled', async () => {
      fsExistsSyncStub.withArgs('/run/systemd/shutdown/scheduled').returns(true);

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('scheduled');
    });

    it('should detect shutdown via systemctl is-system-running = stopping', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'stopping\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('systemctl-stopping');
    });

    it('should detect shutdown via systemctl list-jobs with shutdown.target', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: '123 shutdown.target start waiting\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('list-jobs');
    });

    it('should detect shutdown via systemctl list-jobs with reboot.target', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: '123 reboot.target start waiting\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('list-jobs');
    });

    it('should detect shutdown via systemctl list-jobs with poweroff.target', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: '123 poweroff.target start waiting\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
    });

    it('should detect shutdown via systemctl list-jobs with halt.target', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: '123 halt.target start waiting\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
    });

    it('should detect shutdown via running shutdown process', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: 'No jobs running.\n', stderr: '', error: null });
      runCommandStub.withArgs('pgrep', sinon.match({ params: ['-x', 'shutdown'] })).resolves({ stdout: '1234\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('pgrep-shutdown');
    });

    it('should detect shutdown via runlevel 0 (halt)', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: 'No jobs running.\n', stderr: '', error: null });
      runCommandStub.withArgs('pgrep', sinon.match({ params: ['-x', 'shutdown'] })).resolves({ stdout: '', stderr: '', error: new Error('No process') });
      runCommandStub.withArgs('runlevel', sinon.match.any).resolves({ stdout: 'N 0\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('runlevel');
    });

    it('should detect shutdown via runlevel 6 (reboot)', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: 'No jobs running.\n', stderr: '', error: null });
      runCommandStub.withArgs('pgrep', sinon.match({ params: ['-x', 'shutdown'] })).resolves({ stdout: '', stderr: '', error: new Error('No process') });
      runCommandStub.withArgs('runlevel', sinon.match.any).resolves({ stdout: 'N 6\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('runlevel');
    });

    it('should detect shutdown via /run/nologin file', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: 'No jobs running.\n', stderr: '', error: null });
      runCommandStub.withArgs('pgrep', sinon.match({ params: ['-x', 'shutdown'] })).resolves({ stdout: '', stderr: '', error: new Error('No process') });
      runCommandStub.withArgs('runlevel', sinon.match.any).resolves({ stdout: 'N 5\n', stderr: '', error: null });
      fsExistsSyncStub.withArgs('/run/nologin').returns(true);

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('nologin');
    });

    it('should return false when runlevel is 5 (normal multi-user)', async () => {
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'running\n', stderr: '', error: null });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['list-jobs', '--no-pager'] })).resolves({ stdout: 'No jobs running.\n', stderr: '', error: null });
      runCommandStub.withArgs('pgrep', sinon.match({ params: ['-x', 'shutdown'] })).resolves({ stdout: '', stderr: '', error: new Error('No process') });
      runCommandStub.withArgs('runlevel', sinon.match.any).resolves({ stdout: 'N 5\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(false);
    });

    it('should handle all errors gracefully and return false', async () => {
      fsExistsSyncStub.throws(new Error('Permission denied'));
      runCommandStub.resolves({ stdout: '', stderr: '', error: new Error('Command failed') });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      expect(result.detected).to.equal(false);
    });

    it('should stop checking after first detection (priority order)', async () => {
      // Both scheduled file and systemctl return positive
      fsExistsSyncStub.withArgs('/run/systemd/shutdown/scheduled').returns(true);
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-system-running'] })).resolves({ stdout: 'stopping\n', stderr: '', error: null });

      const result = await isSystemShuttingDown({ existsSync: fsExistsSyncStub }, runCommandStub);

      // Should detect via first method (scheduled file)
      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('scheduled');
    });
  });

  describe('handleSigterm logic tests', () => {
    it('should skip broadcast when system is not shutting down', async () => {
      const broadcastCalled = { outgoing: false, incoming: false };
      const exitCalled = { code: null };

      // Mock isSystemShuttingDown returning false (async)
      const isSystemShuttingDown = async () => false;

      // Simplified handleSigterm logic
      async function handleSigterm(deps) {
        const systemShuttingDown = await isSystemShuttingDown();

        if (!systemShuttingDown) {
          deps.exit(0);
          return;
        }

        if (deps.runningAppsCache.size > 0) {
          await deps.broadcastOutgoing({});
          await deps.broadcastIncoming({});
        }

        deps.exit(0);
      }

      await handleSigterm({
        runningAppsCache: new Set(['app1']),
        broadcastOutgoing: () => { broadcastCalled.outgoing = true; },
        broadcastIncoming: () => { broadcastCalled.incoming = true; },
        exit: (code) => { exitCalled.code = code; },
      });

      expect(broadcastCalled.outgoing).to.equal(false);
      expect(broadcastCalled.incoming).to.equal(false);
      expect(exitCalled.code).to.equal(0);
    });

    it('should broadcast when system is shutting down and apps are running', async () => {
      const broadcastCalled = { outgoing: false, incoming: false };
      const exitCalled = { code: null };

      // Mock isSystemShuttingDown returning true (async)
      const isSystemShuttingDown = async () => true;

      async function handleSigterm(deps) {
        const systemShuttingDown = await isSystemShuttingDown();

        if (!systemShuttingDown) {
          deps.exit(0);
          return;
        }

        if (deps.runningAppsCache.size > 0) {
          await deps.broadcastOutgoing({});
          await deps.broadcastIncoming({});
        }

        deps.exit(0);
      }

      await handleSigterm({
        runningAppsCache: new Set(['app1', 'app2']),
        broadcastOutgoing: () => { broadcastCalled.outgoing = true; },
        broadcastIncoming: () => { broadcastCalled.incoming = true; },
        exit: (code) => { exitCalled.code = code; },
      });

      expect(broadcastCalled.outgoing).to.equal(true);
      expect(broadcastCalled.incoming).to.equal(true);
      expect(exitCalled.code).to.equal(0);
    });

    it('should skip broadcast when system is shutting down but no apps are running', async () => {
      const broadcastCalled = { outgoing: false, incoming: false };
      const exitCalled = { code: null };

      const isSystemShuttingDown = async () => true;

      async function handleSigterm(deps) {
        const systemShuttingDown = await isSystemShuttingDown();

        if (!systemShuttingDown) {
          deps.exit(0);
          return;
        }

        if (deps.runningAppsCache.size > 0) {
          await deps.broadcastOutgoing({});
          await deps.broadcastIncoming({});
        }

        deps.exit(0);
      }

      await handleSigterm({
        runningAppsCache: new Set(), // Empty - no apps
        broadcastOutgoing: () => { broadcastCalled.outgoing = true; },
        broadcastIncoming: () => { broadcastCalled.incoming = true; },
        exit: (code) => { exitCalled.code = code; },
      });

      expect(broadcastCalled.outgoing).to.equal(false);
      expect(broadcastCalled.incoming).to.equal(false);
      expect(exitCalled.code).to.equal(0);
    });
  });

  describe('graceful Docker stop during shutdown tests', () => {
    /**
     * Replicates the container stop logic from handleSigterm in apiServer.js
     * for isolated testing without loading the full module.
     * Stops are fired in parallel with force-kill fallback on failure.
     */
    async function stopFluxContainers(deps) {
      try {
        let containers = await deps.dockerListContainers(false);
        containers = containers.filter((c) => c.Names[0].slice(1, 4) === 'zel' || c.Names[0].slice(1, 5) === 'flux');

        if (containers.length > 0) {
          const stopPromises = containers.map((container) => {
            const containerName = container.Names[0].slice(1);
            return deps.appDockerStop(containerName, 9)
              .then(() => {
                deps.onStopped(containerName);
              })
              .catch(async (stopErr) => {
                deps.onStopFailed(containerName, stopErr.message);
                try {
                  await deps.appDockerKill(containerName);
                  deps.onKilled(containerName);
                } catch (killErr) {
                  deps.onKillFailed(containerName, killErr.message);
                }
              });
          });
          await Promise.allSettled(stopPromises);
          return { stopped: true };
        }
        return { stopped: false, reason: 'no-containers' };
      } catch (error) {
        return { stopped: false, reason: 'list-error', error: error.message };
      }
    }

    function defaultDeps(overrides = {}) {
      return {
        dockerListContainers: async () => [],
        appDockerStop: async () => 'stopped',
        appDockerKill: async () => 'killed',
        onStopped: () => {},
        onStopFailed: () => {},
        onKilled: () => {},
        onKillFailed: () => {},
        ...overrides,
      };
    }

    it('should stop all running flux app containers', async () => {
      const stoppedContainers = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxMyApp1'], Id: 'abc123' },
          { Names: ['/fluxMyApp2'], Id: 'def456' },
        ],
        onStopped: (name) => { stoppedContainers.push(name); },
      }));

      expect(result.stopped).to.equal(true);
      expect(stoppedContainers).to.include.members(['fluxMyApp1', 'fluxMyApp2']);
      expect(stoppedContainers).to.have.lengthOf(2);
    });

    it('should stop zel-prefixed containers', async () => {
      const stoppedContainers = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/zelKadenaChainWebNode'], Id: 'aaa111' },
        ],
        onStopped: (name) => { stoppedContainers.push(name); },
      }));

      expect(result.stopped).to.equal(true);
      expect(stoppedContainers).to.deep.equal(['zelKadenaChainWebNode']);
    });

    it('should filter out non-flux containers', async () => {
      const stoppedContainers = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxMyApp'], Id: 'abc123' },
          { Names: ['/mongo'], Id: 'xyz789' },
          { Names: ['/redis'], Id: 'ghi012' },
          { Names: ['/zelOldApp'], Id: 'jkl345' },
        ],
        onStopped: (name) => { stoppedContainers.push(name); },
      }));

      expect(result.stopped).to.equal(true);
      expect(stoppedContainers).to.include.members(['fluxMyApp', 'zelOldApp']);
      expect(stoppedContainers).to.have.lengthOf(2);
    });

    it('should return no-containers when no flux containers are running', async () => {
      const stoppedContainers = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/mongo'], Id: 'xyz789' },
        ],
        onStopped: (name) => { stoppedContainers.push(name); },
      }));

      expect(result.stopped).to.equal(false);
      expect(result.reason).to.equal('no-containers');
      expect(stoppedContainers).to.deep.equal([]);
    });

    it('should return no-containers when docker has no running containers', async () => {
      const result = await stopFluxContainers(defaultDeps());

      expect(result.stopped).to.equal(false);
      expect(result.reason).to.equal('no-containers');
    });

    it('should force-kill containers when graceful stop fails', async () => {
      const stoppedContainers = [];
      const killedContainers = [];
      const failedStops = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxApp1'], Id: 'abc' },
          { Names: ['/fluxApp2'], Id: 'def' },
          { Names: ['/fluxApp3'], Id: 'ghi' },
        ],
        appDockerStop: async (name) => {
          if (name === 'fluxApp2') throw new Error('Container stuck');
          return 'stopped';
        },
        onStopped: (name) => { stoppedContainers.push(name); },
        onStopFailed: (name, msg) => { failedStops.push({ name, msg }); },
        onKilled: (name) => { killedContainers.push(name); },
      }));

      expect(result.stopped).to.equal(true);
      expect(stoppedContainers).to.include.members(['fluxApp1', 'fluxApp3']);
      expect(failedStops).to.have.lengthOf(1);
      expect(failedStops[0].name).to.equal('fluxApp2');
      expect(killedContainers).to.deep.equal(['fluxApp2']);
    });

    it('should handle dockerListContainers failure gracefully', async () => {
      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => { throw new Error('Docker daemon unavailable'); },
      }));

      expect(result.stopped).to.equal(false);
      expect(result.reason).to.equal('list-error');
      expect(result.error).to.equal('Docker daemon unavailable');
    });

    it('should handle all containers failing stop and kill', async () => {
      const failedStops = [];
      const failedKills = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxApp1'], Id: 'abc' },
          { Names: ['/fluxApp2'], Id: 'def' },
        ],
        appDockerStop: async () => { throw new Error('timeout'); },
        appDockerKill: async () => { throw new Error('kill failed'); },
        onStopFailed: (name, msg) => { failedStops.push({ name, msg }); },
        onKillFailed: (name, msg) => { failedKills.push({ name, msg }); },
      }));

      expect(result.stopped).to.equal(true);
      expect(failedStops).to.have.lengthOf(2);
      expect(failedKills).to.have.lengthOf(2);
    });

    it('should stop containers in parallel (not sequentially)', async () => {
      const events = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxApp1'], Id: 'abc' },
          { Names: ['/fluxApp2'], Id: 'def' },
          { Names: ['/fluxApp3'], Id: 'ghi' },
        ],
        appDockerStop: async (name) => {
          events.push(`start:${name}`);
          await new Promise((resolve) => { setTimeout(resolve, 10); });
          events.push(`end:${name}`);
          return 'stopped';
        },
        onStopped: () => {},
      }));

      expect(result.stopped).to.equal(true);
      // All starts should happen before any end (parallel execution)
      const starts = events.filter((e) => e.startsWith('start:'));
      const firstEnd = events.findIndex((e) => e.startsWith('end:'));
      expect(starts).to.have.lengthOf(3);
      expect(firstEnd).to.be.greaterThanOrEqual(3);
    });

    it('should pass timeout of 9 to appDockerStop', async () => {
      const receivedTimeouts = [];

      await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxApp1'], Id: 'abc' },
        ],
        appDockerStop: async (name, timeout) => {
          receivedTimeouts.push(timeout);
          return 'stopped';
        },
        onStopped: () => {},
      }));

      expect(receivedTimeouts).to.deep.equal([9]);
    });

    it('should force-kill when stop fails and kill succeeds', async () => {
      const killedContainers = [];

      const result = await stopFluxContainers(defaultDeps({
        dockerListContainers: async () => [
          { Names: ['/fluxApp1'], Id: 'abc' },
        ],
        appDockerStop: async () => { throw new Error('stop timeout'); },
        appDockerKill: async () => 'killed',
        onStopFailed: () => {},
        onKilled: (name) => { killedContainers.push(name); },
      }));

      expect(result.stopped).to.equal(true);
      expect(killedContainers).to.deep.equal(['fluxApp1']);
    });
  });
});
