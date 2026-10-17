import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { bootAndPeer, seedTestApp } from '../framework/reconciler-suite.js';
import {
  freezeDocker, thawDocker, stuckThreads, processesThatCanRun,
} from '../framework/host-stall.js';
import { journalCount, restartFluxos } from '../framework/systemd-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A host that stops returning the disk under docker, on a real kernel: the
// filesystem the node's docker keeps its data on is frozen (framework/host-stall.js)
// while an app writes a log line every 200 ms, so docker's own threads are held in
// the kernel and never run - the stall FluxOS's detector reads from /proc.
//
// A thread held for one reading interval holds the node back from new placements,
// and the hold lifts when the thread runs again. Held for stuckIntervals intervals,
// the node goes out of service until it reboots, and removes every app: the normal
// removal, which needs docker and so does not return, runs out of time, and the
// app's processes are killed through its slice without docker.
//
// The nodes run systemd, so docker uses its systemd cgroup driver and every app's
// containers live in the app's own slice, as on a production node.

const READ_INTERVAL_MS = 5 * 1000;
const STUCK_INTERVALS = 6;
const REMOVAL_DEADLINE_MS = 20 * 1000;
const STALL_MS = READ_INTERVAL_MS * STUCK_INTERVALS;

const HELD = 'Placement hold set by hostStall';
const RELEASED = 'Placement hold cleared by hostStall';
const OUT_OF_SERVICE = 'Sticky DOS set by hostStall';

function step(what) {
  console.log(`# 3303 ${new Date().toISOString()} ${what}`);
}

const fluxosLog = (container, text) => journalCount(container, 'fluxos', text, { processOnly: true });

describe('a stalled host takes the node out of service', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ehoststall${Date.now()}`;
  let node;
  let container;
  let frozen = false;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      tickerAutostart: false,
      systemdMode: true,
      freezableDockerRoot: [0, 1, 2, 3],
      configOverrides: {
        hostStall: { readIntervalMs: READ_INTERVAL_MS, stuckIntervals: STUCK_INTERVALS },
        fluxapps: { appRemovalDeadlineMs: REMOVAL_DEADLINE_MS },
      },
    });
    await bootAndPeer(env);
    ({ index: node } = await seedTestApp(env, { name: appName, logEveryMs: 200 }));
    ({ container } = env.clients[node]);
    await waitForUp(env.clients[node], appName, 'the app is up');
  });

  after(async function () {
    this.timeout(60000);
    if (frozen) await thawDocker(container).catch(() => {});
    await env?.teardown();
  });

  it('runs the app in its own slice', async function () {
    const pid = (await execInContainer(container, `docker inspect -f '{{.State.Pid}}' flux${appName}_${appName}`)).stdout.trim();
    const cgroup = (await execInContainer(container, `cat /proc/${pid}/cgroup`)).stdout;
    expect(cgroup, 'the app container is not in its slice, so the kill below has nothing to find').to.include(`/flux.slice/flux-${appName}.slice/`);
  });

  describe('a stall shorter than the threshold', function () {
    let counts;
    let stuck;

    before(async function () {
      this.timeout(STALL_MS * 2);
      counts = { held: await fluxosLog(container, HELD), released: await fluxosLog(container, RELEASED), out: await fluxosLog(container, OUT_OF_SERVICE) };
      step('freezing');
      await freezeDocker(container);
      frozen = true;
      try {
        stuck = await stuckThreads(container, 'dockerd');
        await waitFor(async () => (await fluxosLog(container, HELD)) > counts.held, {
          timeout: READ_INTERVAL_MS * 3, interval: 1000, label: 'the node holds itself back',
        });
      } finally {
        step('thawing');
        await thawDocker(container);
        frozen = false;
      }
    });

    it('held docker in the kernel', function () {
      expect(stuck, 'no dockerd thread was held across the freeze, so nothing below was tested').to.not.be.empty;
    });

    it('lifts the hold once docker runs again, and stays in service', async function () {
      this.timeout(READ_INTERVAL_MS * 6);
      await waitFor(async () => (await fluxosLog(container, RELEASED)) > counts.released, {
        timeout: READ_INTERVAL_MS * 4, interval: 1000, label: 'the hold lifts',
      });
      expect(await fluxosLog(container, OUT_OF_SERVICE), 'the node went out of service for a stall it recovered from').to.equal(counts.out);
      const app = await getAppContainerStatus(container, appName);
      expect(app && app.status.startsWith('Up'), 'the app is still up').to.equal(true);
    });
  });

  describe('a stall past the threshold', function () {
    let stuck;

    before(async function () {
      this.timeout(STALL_MS * 4);
      const out = await fluxosLog(container, OUT_OF_SERVICE);
      step('freezing');
      await freezeDocker(container);
      frozen = true;
      stuck = await stuckThreads(container, 'dockerd');
      await waitFor(async () => (await fluxosLog(container, OUT_OF_SERVICE)) > out, {
        timeout: STALL_MS + READ_INTERVAL_MS * 4, interval: 2000, label: 'the node goes out of service',
      });
      step('out of service');
    });

    it('held docker in the kernel', function () {
      expect(stuck, 'no dockerd thread was held across the freeze, so nothing below was tested').to.not.be.empty;
    });

    it('takes the node out of service, naming the stall', async function () {
      const { data } = await env.clients[node].getDOSState();
      expect(data.dosState).to.be.at.least(100);
      expect(data.dosMessage).to.include('Host stall').and.include('dockerd');
    });

    it('leaves nothing of the app that can run, though its removal could not finish', async function () {
      this.timeout(REMOVAL_DEADLINE_MS * 4);
      await waitFor(async () => (await fluxosLog(container, `${appName} can no longer run`)) > 0
        || (await fluxosLog(container, `${appName} could not be stopped`)) > 0, {
        timeout: REMOVAL_DEADLINE_MS * 3, interval: 2000, label: 'the node says what is left of the app',
      });
      const ranOut = (await fluxosLog(container, `${appName} was not removed`)) + (await fluxosLog(container, `${appName} still runs after its removal`));
      expect(ranOut, 'the app\'s removal finished, so its stall was never what removed it').to.be.above(0);
      expect(await fluxosLog(container, `${appName} could not be stopped`), 'the node could not stop the app').to.equal(0);
      expect(await processesThatCanRun(container, `/sys/fs/cgroup/flux.slice/flux-${appName}.slice`), 'a process of the app can still run').to.deep.equal([]);
    });

    it('stays out of service through a FluxOS restart in the same boot', async function () {
      this.timeout(300000);
      const restored = await fluxosLog(container, OUT_OF_SERVICE);
      step('restarting FluxOS');
      await restartFluxos(container, { timeout: 120000, readyTimeoutMs: 180000 });
      await waitFor(async () => (await fluxosLog(container, OUT_OF_SERVICE)) > restored, {
        timeout: 60000, interval: 2000, label: 'the restarted node restores its trip',
      });
      const { data } = await env.clients[node].getDOSState();
      expect(data.dosState, 'a FluxOS restart returned the node to service').to.be.at.least(100);
    });

    it('stays out of service once docker runs again', async function () {
      this.timeout(READ_INTERVAL_MS * 6);
      await thawDocker(container);
      frozen = false;
      await new Promise((resolve) => { setTimeout(resolve, READ_INTERVAL_MS * 3); });
      const { data } = await env.clients[node].getDOSState();
      expect(data.dosState, 'the node returned to service without a reboot').to.be.at.least(100);
    });
  });
});
