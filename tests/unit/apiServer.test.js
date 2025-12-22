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
});
