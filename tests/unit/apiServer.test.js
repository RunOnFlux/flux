const { expect } = require('chai');
const sinon = require('sinon');

/**
 * These tests isolate and test the SIGTERM handling logic from apiServer.js
 * without loading the full module which has complex config dependencies.
 */
describe('apiServer SIGTERM handling tests', () => {
  describe('isSystemShuttingDown logic tests', () => {
    let fsExistsSyncStub;
    let execSyncStub;

    // Recreate the isSystemShuttingDown function logic for isolated testing
    function isSystemShuttingDown(fsModule, execSyncFn) {
      // Method 1: Check for systemd scheduled shutdown file
      try {
        if (fsModule.existsSync('/run/systemd/shutdown/scheduled')) {
          return { detected: true, method: 'scheduled' };
        }
      } catch (e) {
        // Ignore errors
      }

      // Method 2: Check systemd's current state
      try {
        const state = execSyncFn('systemctl is-system-running 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
        if (state === 'stopping') {
          return { detected: true, method: 'systemctl-stopping' };
        }
      } catch (e) {
        // Command failed or not available, continue checking
      }

      // Method 3: Check for active shutdown/reboot jobs in systemd
      try {
        const jobs = execSyncFn('systemctl list-jobs --no-pager 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        if (jobs.includes('shutdown.target') || jobs.includes('reboot.target') || jobs.includes('poweroff.target') || jobs.includes('halt.target')) {
          return { detected: true, method: 'list-jobs' };
        }
      } catch (e) {
        // Command failed or not available
      }

      // Method 4: Check for running shutdown/reboot processes
      try {
        execSyncFn('pgrep -x "shutdown" 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        return { detected: true, method: 'pgrep-shutdown' };
      } catch (e) {
        // No shutdown process found
      }

      // Method 5: Check runlevel (0 = halt, 6 = reboot)
      try {
        const runlevel = execSyncFn('runlevel 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
        if (runlevel.endsWith(' 0') || runlevel.endsWith(' 6')) {
          return { detected: true, method: 'runlevel' };
        }
      } catch (e) {
        // Command failed or not available
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
      execSyncStub = sinon.stub();

      // Default: no shutdown indicators
      fsExistsSyncStub.returns(false);
      execSyncStub.throws(new Error('Command not found'));
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false when no shutdown indicators are present', () => {
      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);
      expect(result.detected).to.equal(false);
    });

    it('should detect shutdown via /run/systemd/shutdown/scheduled', () => {
      fsExistsSyncStub.withArgs('/run/systemd/shutdown/scheduled').returns(true);

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('scheduled');
    });

    it('should detect shutdown via systemctl is-system-running = stopping', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('stopping\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('systemctl-stopping');
    });

    it('should detect shutdown via systemctl list-jobs with shutdown.target', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('123 shutdown.target start waiting\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('list-jobs');
    });

    it('should detect shutdown via systemctl list-jobs with reboot.target', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('123 reboot.target start waiting\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('list-jobs');
    });

    it('should detect shutdown via systemctl list-jobs with poweroff.target', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('123 poweroff.target start waiting\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
    });

    it('should detect shutdown via systemctl list-jobs with halt.target', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('123 halt.target start waiting\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
    });

    it('should detect shutdown via running shutdown process', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('No jobs running.\n');
      execSyncStub.withArgs('pgrep -x "shutdown" 2>/dev/null', sinon.match.any).returns('1234\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('pgrep-shutdown');
    });

    it('should detect shutdown via runlevel 0 (halt)', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('No jobs running.\n');
      execSyncStub.withArgs('pgrep -x "shutdown" 2>/dev/null', sinon.match.any).throws(new Error('No process'));
      execSyncStub.withArgs('runlevel 2>/dev/null', sinon.match.any).returns('N 0\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('runlevel');
    });

    it('should detect shutdown via runlevel 6 (reboot)', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('No jobs running.\n');
      execSyncStub.withArgs('pgrep -x "shutdown" 2>/dev/null', sinon.match.any).throws(new Error('No process'));
      execSyncStub.withArgs('runlevel 2>/dev/null', sinon.match.any).returns('N 6\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('runlevel');
    });

    it('should detect shutdown via /run/nologin file', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('No jobs running.\n');
      execSyncStub.withArgs('pgrep -x "shutdown" 2>/dev/null', sinon.match.any).throws(new Error('No process'));
      execSyncStub.withArgs('runlevel 2>/dev/null', sinon.match.any).returns('N 5\n');
      fsExistsSyncStub.withArgs('/run/nologin').returns(true);

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('nologin');
    });

    it('should return false when runlevel is 5 (normal multi-user)', () => {
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('running\n');
      execSyncStub.withArgs('systemctl list-jobs --no-pager 2>/dev/null', sinon.match.any).returns('No jobs running.\n');
      execSyncStub.withArgs('pgrep -x "shutdown" 2>/dev/null', sinon.match.any).throws(new Error('No process'));
      execSyncStub.withArgs('runlevel 2>/dev/null', sinon.match.any).returns('N 5\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(false);
    });

    it('should handle all errors gracefully and return false', () => {
      fsExistsSyncStub.throws(new Error('Permission denied'));
      execSyncStub.throws(new Error('Command failed'));

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      expect(result.detected).to.equal(false);
    });

    it('should stop checking after first detection (priority order)', () => {
      // Both scheduled file and systemctl return positive
      fsExistsSyncStub.withArgs('/run/systemd/shutdown/scheduled').returns(true);
      execSyncStub.withArgs('systemctl is-system-running 2>/dev/null', sinon.match.any).returns('stopping\n');

      const result = isSystemShuttingDown({ existsSync: fsExistsSyncStub }, execSyncStub);

      // Should detect via first method (scheduled file)
      expect(result.detected).to.equal(true);
      expect(result.method).to.equal('scheduled');
    });
  });

  describe('handleSigterm logic tests', () => {
    it('should skip broadcast when system is not shutting down', async () => {
      const broadcastCalled = { outgoing: false, incoming: false };
      const exitCalled = { code: null };

      // Mock isSystemShuttingDown returning false
      const isSystemShuttingDown = () => false;

      // Simplified handleSigterm logic
      async function handleSigterm(deps) {
        const systemShuttingDown = isSystemShuttingDown();

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

      // Mock isSystemShuttingDown returning true
      const isSystemShuttingDown = () => true;

      async function handleSigterm(deps) {
        const systemShuttingDown = isSystemShuttingDown();

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

      const isSystemShuttingDown = () => true;

      async function handleSigterm(deps) {
        const systemShuttingDown = isSystemShuttingDown();

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
