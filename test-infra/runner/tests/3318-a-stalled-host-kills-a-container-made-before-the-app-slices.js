// base-image: FLUX_E2E_BASE_TAG
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { waitForUp, waitForAppInstalled } from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import {
  DOCKER_ROOT, stallDisk, resumeDisk, readsHeld, thawEveryNode, containerCgroup, processesThatCanRun,
} from '../framework/host-stall.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node upgraded from a release that gave app containers no slice of their own:
// the app's container, made by the release, lives in its runtime's scope under
// system.slice, and only docker's records on disk say which app it is. The node's
// docker disk then stops answering reads, so those records cannot be read, and the
// node goes out of service for the stall. Every container on a node is an app's,
// so it kills every container outside the slices: the app's container among them,
// and the app is reported as unable to run.
//
// Without FLUX_E2E_BASE_TAG the suite fails before booting, naming the build it needs.

const BASE_TAG = process.env.FLUX_E2E_BASE_TAG;
const READ_INTERVAL_MS = 5 * 1000;
const STUCK_INTERVALS = 6;
const STOP_WINDOW_MS = 10 * 1000;
const REMOVAL_DEADLINE_MS = 45 * 1000;
// what the node takes beyond the window to check and kill every app
const KILL_SLACK_MS = 10 * 1000;
const STALL_MS = READ_INTERVAL_MS * STUCK_INTERVALS;
const UPGRADED = 0;

const outOfServiceForTheStall = (data) => data.dosState >= 100 && String(data.dosMessage).includes('Host stall');
const containerOf = (appName) => `flux${appName}_${appName}`;

// What of a container's cgroup can still run; a cgroup that has gone holds nothing.
async function canRun(container, cgroupDir) {
  const exists = await execInContainer(container, `test -d '${cgroupDir}'`);
  return exists.exitCode === 0 ? processesThatCanRun(container, cgroupDir) : [];
}

describe('a stalled host kills a container made before the app slices', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eprestall${Date.now()}`;
  let client;
  let container;
  let scope;
  let runningBefore;
  let readsWereHeld;
  let trippedAt;
  let stopped;
  let runnableAfterWindow;

  before(async function () {
    this.timeout(900000);
    if (!BASE_TAG) {
      throw new Error('FLUX_E2E_BASE_TAG names the node image of the released FluxOS the node upgrades from: build it with FLUX_E2E_TAG=<base-tag> ./test-infra/build-release-image.sh <release ref>');
    }
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      nodeImageTags: { [UPGRADED]: BASE_TAG },
      tickerAutostart: false,
      freezableDockerRoot: [UPGRADED],
      configOverrides: {
        hostStall: { readIntervalMs: READ_INTERVAL_MS, stuckIntervals: STUCK_INTERVALS, stopWindowMs: STOP_WINDOW_MS },
        fluxapps: { appRemovalDeadlineMs: REMOVAL_DEADLINE_MS },
      },
    });
    if (BASE_TAG === env.nodeImageTag(1)) throw new Error('FLUX_E2E_BASE_TAG must name another build than FLUX_E2E_TAG: the suite upgrades from the one to the other');
    await bootAndPeer(env);
    client = env.clients[UPGRADED];
    ({ container } = client);

    // an app that writes a log line every 200 ms, so docker writes while its disk stalls
    await pushTestApp(appName);
    const app = await buildSeedableTestApp({ name: appName, logEveryMs: 200, instances: 1 });
    await seedSpawnerApp(env, app, [UPGRADED]);
    await waitForAppInstalled(client, appName, 180000);
    await waitForUp(client, appName, 'the app is up on the release');
    scope = await containerCgroup(container, containerOf(appName));

    await env.upgradeNode(UPGRADED, { tag: env.nodeImageTag(1) });
    await waitForUp(client, appName, 'the app is up after the upgrade');
    runningBefore = await canRun(container, scope);

    const anchor = client.getLastEventId();
    await stallDisk(container, DOCKER_ROOT);
    readsWereHeld = await readsHeld(container, `${DOCKER_ROOT}/containers`, { file: 'config.v2.json' });
    const trip = await client.waitForEvent('dos:changed', outOfServiceForTheStall, STALL_MS + READ_INTERVAL_MS * 4, { afterId: anchor })
      .catch(() => null);
    trippedAt = trip ? Date.now() : null;
    // the records' read waits one window, and the stop another
    stopped = (await client.waitForEvent('hostStall:appsStopped', () => true, STOP_WINDOW_MS * 2 + KILL_SLACK_MS, { afterId: anchor })
      .catch(() => null))?.data ?? null;
    runnableAfterWindow = await canRun(container, scope);
  });

  after(async function () {
    this.timeout(60000);
    if (container) await resumeDisk(container, DOCKER_ROOT).catch(() => {});
    if (client) await thawEveryNode([client]);
    await env?.teardown();
  });

  it('runs the app in a container the release made outside any app slice, still running after the upgrade', function () {
    expect(scope, 'fixture: the release put the app\'s container in a slice, so nothing below was tested').to.match(/\/system\.slice\/docker-[0-9a-f]{64}\.scope$/);
    expect(runningBefore, 'the app\'s container was not running after the upgrade, so there was nothing to kill').to.not.be.empty;
  });

  it('held every read of docker\'s records of its containers, and went out of service', function () {
    expect(readsWereHeld, 'a read of docker\'s container records returned, so the disk was never held').to.equal(true);
    expect(trippedAt, 'the node never went out of service for the stall, so nothing below was tested').to.not.equal(null);
  });

  it('kills the app\'s container though docker\'s records cannot say it is the app\'s', function () {
    expect(stopped, 'the node never said it had stopped its apps').to.not.equal(null);
    expect(runnableAfterWindow, 'the app\'s container can still run after the stop window').to.deep.equal([]);
  });

  it('says the app can no longer run', function () {
    const reported = stopped?.apps.find((a) => a.app === appName);
    expect(reported, 'the node did not name the app among those it stopped').to.not.equal(undefined);
    expect(reported.runnable, 'the node reports the app as one it cannot tell can still run, or names its processes').to.deep.equal([]);
  });
});
