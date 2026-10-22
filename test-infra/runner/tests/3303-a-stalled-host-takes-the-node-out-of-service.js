import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import {
  waitFor, waitForUp, waitForAppInstalled, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import {
  freezeDocker, thawDocker, freezeConfig, thawConfig, FLUXOS_CONFIG,
  thawEveryNode, stuckThreads, processesThatCanRun, containerCgroup,
} from '../framework/host-stall.js';
import {
  DOCKERD_UNIT, freezeUnit, restartFluxos, unitCgroup,
} from '../framework/systemd-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A host that stops returning the disk under docker, on a real kernel: the
// filesystem the node's docker keeps its data on is frozen (framework/host-stall.js)
// while an app writes a log line every 200 ms, so docker's own threads are held in
// the kernel and never run - the stall FluxOS's detector reads from /proc.
//
// A thread held for one reading interval holds the node back from new placements,
// and the hold lifts when the thread runs again. Held for stuckIntervals intervals,
// the node goes out of service until it reboots: every app is asked to stop at
// once, whatever of them can still run after one shared stop window is killed
// through its slice, and then each is removed within a deadline. On a frozen disk
// docker still delivers the stop signal, so the app is stopped though its removal
// runs out. With docker frozen as well (systemd-control.freezeUnit), docker
// cannot act at all, and the app is killed without docker. A node holding several
// apps has every one of them stopped within that one window, long before even one
// removal's deadline. A node whose FluxOS config directory, where the trip is
// recorded, is frozen as well stops its apps all the same, and records the trip
// once the directory takes writes again.
//
// The nodes run systemd, so docker uses its systemd cgroup driver and every app's
// containers live in the app's own slice, as on a production node. The node the
// kill case runs on is a legacy node whose FluxOS runs as the operator's account,
// not root: it reads docker's threads, asks systemd and kills through sudo.
//
// Each case first asserts, independently of FluxOS, that docker was held: on a tree
// without the detector that canary passes and the assertions after it fail.

const READ_INTERVAL_MS = 5 * 1000;
const STUCK_INTERVALS = 6;
const REMOVAL_DEADLINE_MS = 45 * 1000;
const STOP_WINDOW_MS = 10 * 1000;
// what the node takes beyond the window to check and kill every app
const KILL_SLACK_MS = 10 * 1000;
const STALL_MS = READ_INTERVAL_MS * STUCK_INTERVALS;
const OWNER = 'hostStall';
const ARCANE = [0, 1, 2];
const LEGACY_UNPRIVILEGED = 3;

const byOwner = (data) => data.owner === OWNER;
const outOfServiceForTheStall = (data) => data.dosState >= 100
  && String(data.dosMessage).includes('Host stall') && String(data.dosMessage).includes('dockerd');
// the app names here have no '-', which a slice name escapes
const sliceOf = (appName) => `flux-${appName}.slice`;
const containerOf = (appName) => `flux${appName}_${appName}`;
// what of the app can still run, read from its slice, which outlives its containers
async function sliceProcessesThatCanRun(container, appName) {
  return processesThatCanRun(container, await unitCgroup(container, sliceOf(appName)));
}

function step(what) {
  console.log(`# 3303 ${new Date().toISOString()} ${what}`);
}

// An app that writes a log line every 200 ms, installed on one of `indices` only.
async function installOn(env, name, indices) {
  await pushTestApp(name);
  const app = await buildSeedableTestApp({ name, logEveryMs: 200, instances: 1 });
  await seedSpawnerApp(env, app, indices);
  return Promise.any(indices.map(async (i) => {
    await waitForAppInstalled(env.clients[i], name, 120000);
    return i;
  }));
}

describe('a stalled host takes the node out of service', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ehoststall${Date.now()}`;
  let node;
  let client;
  let container;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      tickerAutostart: false,
      freezableDockerRoot: [0, 1, 2, 3],
      freezableConfig: [0, 1, 2, 3],
      legacyNodes: [LEGACY_UNPRIVILEGED],
      unprivilegedNodes: [LEGACY_UNPRIVILEGED],
      configOverrides: {
        hostStall: { readIntervalMs: READ_INTERVAL_MS, stuckIntervals: STUCK_INTERVALS, stopWindowMs: STOP_WINDOW_MS },
        fluxapps: { appRemovalDeadlineMs: REMOVAL_DEADLINE_MS },
      },
    });
    await bootAndPeer(env);
    node = await installOn(env, appName, ARCANE);
    client = env.clients[node];
    ({ container } = client);
    await waitForUp(client, appName, 'the app is up');
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs the app in its own slice', async function () {
    const cgroup = await containerCgroup(container, containerOf(appName));
    const slice = await unitCgroup(container, sliceOf(appName)).catch(() => null);
    expect(slice !== null && cgroup.startsWith(`${slice}/`), `the app container is in ${cgroup}, not in its slice ${slice}, so the kill below has nothing to find`).to.equal(true);
  });

  describe('a stall shorter than the threshold', function () {
    let anchor;

    before(async function () {
      anchor = client.getLastEventId();
      step('freezing');
      await freezeDocker(container);
    });

    after(async function () {
      await thawEveryNode([client]);
    });

    it('held docker in the kernel', async function () {
      const stuck = await stuckThreads(container, 'dockerd');
      expect(stuck, 'no dockerd thread was held across the freeze, so nothing below was tested').to.not.be.empty;
    });

    it('holds the node back from new placements', async function () {
      this.timeout(READ_INTERVAL_MS * 4);
      await client.waitForEvent('placementHold:set', byOwner, READ_INTERVAL_MS * 3, { afterId: anchor });
    });

    it('lifts the hold once docker runs again, and stays in service', async function () {
      this.timeout(READ_INTERVAL_MS * 6);
      step('thawing');
      await thawDocker(container);
      await client.waitForEvent('placementHold:cleared', byOwner, READ_INTERVAL_MS * 4, { afterId: anchor });
      await assertNoEvent(client, 'dos:changed', (data) => data.dosState >= 100, 0, { afterId: anchor });
      const app = await getAppContainerStatus(container, appName);
      expect(app && app.status.startsWith('Up'), 'the app is still up').to.equal(true);
    });
  });

  describe('a stall past the threshold', function () {
    let anchor;

    before(async function () {
      anchor = client.getLastEventId();
      step('freezing');
      await freezeDocker(container);
    });

    after(async function () {
      await thawEveryNode([client]);
    });

    it('held docker in the kernel', async function () {
      const stuck = await stuckThreads(container, 'dockerd');
      expect(stuck, 'no dockerd thread was held across the freeze, so nothing below was tested').to.not.be.empty;
    });

    it('takes the node out of service, naming the stall', async function () {
      this.timeout(STALL_MS + READ_INTERVAL_MS * 6);
      await client.waitForEvent('dos:changed', outOfServiceForTheStall, STALL_MS + READ_INTERVAL_MS * 4, { afterId: anchor });
      step('out of service');
    });

    it('leaves nothing of the app that can run, though its removal could not finish', async function () {
      this.timeout(REMOVAL_DEADLINE_MS * 4);
      const { data } = await client.waitForEvent('hostStall:appUnloaded', (d) => d.app === appName, REMOVAL_DEADLINE_MS * 3, { afterId: anchor });
      expect(data.removal, 'the app\'s removal finished, so its stall was never what removed it').to.not.equal('removed');
      expect(data.runnable, 'the node reports a process of the app that can still run').to.deep.equal([]);
      expect(await sliceProcessesThatCanRun(container, appName), 'a process of the app can still run').to.deep.equal([]);
    });

    it('stays out of service through a FluxOS restart in the same boot', async function () {
      this.timeout(300000);
      const restartAnchor = client.getLastEventId();
      step('restarting FluxOS');
      await restartFluxos(container, { timeout: 120000, readyTimeoutMs: 180000 });
      await client.waitForEvent('dos:changed', outOfServiceForTheStall, 60000, { afterId: restartAnchor });
    });

    it('stays out of service once docker runs again', async function () {
      this.timeout(READ_INTERVAL_MS * 6);
      const thawAnchor = client.getLastEventId();
      step('thawing');
      await thawDocker(container);
      await assertNoEvent(client, 'dos:changed', (data) => data.dosState < 100, READ_INTERVAL_MS * 3, { afterId: thawAnchor });
      const { data } = await client.getDOSState();
      expect(data.dosState, 'the node returned to service without a reboot').to.be.at.least(100);
    });
  });

  describe('a stall past the threshold, with docker unable to act at all, on a legacy node whose FluxOS is not root', function () {
    const killedName = `e2ehoststallkill${Date.now()}`;
    let killClient;
    let killContainer;
    let anchor;
    let runnableAtTrip;
    // the app's container's own cgroup, wherever this tree puts it
    let appCgroup;

    before(async function () {
      this.timeout(240000);
      const index = await installOn(env, killedName, [LEGACY_UNPRIVILEGED]);
      killClient = env.clients[index];
      ({ container: killContainer } = killClient);
      await waitForUp(killClient, killedName, 'the app is up');
      appCgroup = await containerCgroup(killContainer, containerOf(killedName));
      anchor = killClient.getLastEventId();
      step(`freezing node ${index}`);
      await freezeDocker(killContainer);
    });

    after(async function () {
      if (killClient) await thawEveryNode([killClient]);
    });

    it('runs FluxOS as an account that is not root', async function () {
      const owner = await execInContainer(killContainer, 'stat -c %U /proc/$(systemctl show -p MainPID --value fluxos)');
      expect(owner.stdout.trim(), 'FluxOS runs as root, so nothing below tested an operator\'s own install').to.equal('fluxuser');
    });

    it('held docker in the kernel', async function () {
      const stuck = await stuckThreads(killContainer, 'dockerd');
      expect(stuck, 'no dockerd thread was held across the freeze, so nothing below was tested').to.not.be.empty;
    });

    it('left docker unable to answer', async function () {
      this.timeout(30000);
      await freezeUnit(killContainer, DOCKERD_UNIT);
      const answer = await execInContainer(killContainer, 'timeout 5 docker version');
      expect(answer.exitCode, 'docker still answers, so it could still stop the app itself').to.not.equal(0);
      const stuck = await stuckThreads(killContainer, 'dockerd');
      expect(stuck, 'docker\'s held thread was released by its freeze, so the detector has nothing to read').to.not.be.empty;
      expect(await processesThatCanRun(killContainer, appCgroup), 'the app is not running, so there is nothing to kill').to.not.be.empty;
    });

    it('takes the node out of service', async function () {
      this.timeout(STALL_MS + READ_INTERVAL_MS * 6);
      await killClient.waitForEvent('dos:changed', outOfServiceForTheStall, STALL_MS + READ_INTERVAL_MS * 4, { afterId: anchor });
      // read before the removal's deadline, while only a kill can end the app
      runnableAtTrip = await processesThatCanRun(killContainer, appCgroup);
    });

    it('kills the app its removal could not stop, and nothing of it can run', async function () {
      // every app on the node is removed in turn, each within its deadline
      this.timeout(REMOVAL_DEADLINE_MS * 7);
      expect(runnableAtTrip, 'nothing of the app could run when the node went out of service, so there was nothing to kill').to.not.be.empty;
      const { data } = await killClient.waitForEvent('hostStall:appUnloaded', (d) => d.app === killedName, REMOVAL_DEADLINE_MS * 6, { afterId: anchor });
      expect(data.removal, 'the app\'s removal finished, so docker could act').to.not.equal('removed');
      expect(data.killed, 'the node never killed the app').to.equal(true);
      expect(data.runnable, 'the node reports a process of the app that can still run').to.deep.equal([]);
      expect(await sliceProcessesThatCanRun(killContainer, killedName), 'a process of the app can still run').to.deep.equal([]);
    });
  });

  describe('a stall past the threshold, with docker unable to act at all, on a node holding several apps', function () {
    const stamp = Date.now();
    const names = [1, 2, 3].map((n) => `e2ehoststallmany${n}${stamp}`);
    let manyClient;
    let manyContainer;
    let anchor;
    let runningBefore;
    let trippedAt;
    let stopped;
    let runnableAfterWindow;

    before(async function () {
      this.timeout(480000);
      const index = ARCANE.find((i) => i !== node);
      manyClient = env.clients[index];
      ({ container: manyContainer } = manyClient);
      // eslint-disable-next-line no-restricted-syntax
      for (const name of names) {
        // eslint-disable-next-line no-await-in-loop
        await installOn(env, name, [index]);
        // eslint-disable-next-line no-await-in-loop
        await waitForUp(manyClient, name, `${name} is up`);
      }
      anchor = manyClient.getLastEventId();
      step(`freezing node ${index}, which holds ${names.length} apps`);
      await freezeDocker(manyContainer);
      await freezeUnit(manyContainer, DOCKERD_UNIT);
      runningBefore = await Promise.all(names.map((name) => sliceProcessesThatCanRun(manyContainer, name)));
      const trip = await manyClient.waitForEvent('dos:changed', outOfServiceForTheStall, STALL_MS + READ_INTERVAL_MS * 4, { afterId: anchor })
        .catch(() => null);
      trippedAt = trip ? Date.now() : null;
      stopped = (await manyClient.waitForEvent('hostStall:appsStopped', () => true, STOP_WINDOW_MS + KILL_SLACK_MS, { afterId: anchor })
        .catch(() => null))?.data ?? null;
      // read once the window and the kill are over, and before even one removal's deadline
      runnableAfterWindow = trippedAt
        ? await Promise.all(names.map((name) => sliceProcessesThatCanRun(manyContainer, name)))
        : null;
      step('read every app after the stop window');
    });

    after(async function () {
      if (manyClient) await thawEveryNode([manyClient]);
    });

    it('held docker in the kernel, unable to answer, while every app could run', async function () {
      const stuck = await stuckThreads(manyContainer, 'dockerd');
      expect(stuck, 'no dockerd thread was held across the freeze, so nothing below was tested').to.not.be.empty;
      const answer = await execInContainer(manyContainer, 'timeout 5 docker version');
      expect(answer.exitCode, 'docker still answers, so it could still stop the apps itself').to.not.equal(0);
      runningBefore.forEach((running, i) => expect(running, `${names[i]} was not running, so there was nothing to stop`).to.not.be.empty);
    });

    it('takes the node out of service', function () {
      expect(trippedAt, 'the node never went out of service for the stall, so nothing below was tested').to.not.equal(null);
    });

    it('stops every app within one stop window, before even one removal\'s deadline', function () {
      expect(STOP_WINDOW_MS + KILL_SLACK_MS, 'fixture: the window and the kill do not fit inside one removal\'s deadline').to.be.below(REMOVAL_DEADLINE_MS);
      runnableAfterWindow.forEach((runnable, i) => expect(runnable, `${names[i]} can still run one stop window after the node went out of service`).to.deep.equal([]));
    });

    it('says every app was stopped, and that nothing of any can run', function () {
      expect(stopped, 'the node never said its apps were stopped').to.not.equal(null);
      expect(stopped.apps.map((a) => a.app), 'the apps the node stopped').to.include.members(names);
      stopped.apps.filter((a) => names.includes(a.app))
        .forEach((a) => expect(a.runnable, `the node reports a process of ${a.app} that can still run`).to.deep.equal([]));
    });
  });

  describe('a stall past the threshold, on a node whose config directory stalls too', function () {
    const recordName = `e2ehoststallrec${Date.now()}`;
    const record = `${FLUXOS_CONFIG}/hostStall.json`;
    let recClient;
    let recContainer;
    let anchor;
    let trippedAt;
    let stopped;
    let recordedWhileFrozen;

    before(async function () {
      this.timeout(480000);
      // the Arcane node no other case here uses
      const index = ARCANE.filter((i) => i !== node).at(-1);
      recClient = env.clients[index];
      ({ container: recContainer } = recClient);
      await installOn(env, recordName, [index]);
      await waitForUp(recClient, recordName, `${recordName} is up`);
      anchor = recClient.getLastEventId();
      step(`freezing node ${index}'s docker and its config directory`);
      await freezeConfig(recContainer);
      await freezeDocker(recContainer);
      const trip = await recClient.waitForEvent('dos:changed', outOfServiceForTheStall, STALL_MS + READ_INTERVAL_MS * 4, { afterId: anchor })
        .catch(() => null);
      trippedAt = trip ? Date.now() : null;
      stopped = (await recClient.waitForEvent('hostStall:appsStopped', () => true, STOP_WINDOW_MS + KILL_SLACK_MS, { afterId: anchor })
        .catch(() => null))?.data ?? null;
      recordedWhileFrozen = (await execInContainer(recContainer, `test -e ${record}`)).exitCode === 0;
    });

    after(async function () {
      if (recClient) await thawEveryNode([recClient]);
    });

    it('held the config directory: a write to it does not return', async function () {
      const write = await execInContainer(recContainer, `timeout 3 touch ${FLUXOS_CONFIG}/.probe`);
      expect(write.exitCode, 'a write to the config directory returned, so the record was never held').to.equal(124);
    });

    it('takes the node out of service', function () {
      expect(trippedAt, 'the node never went out of service for the stall, so nothing below was tested').to.not.equal(null);
    });

    it('stops its apps though the trip cannot be recorded', function () {
      expect(recordedWhileFrozen, 'fixture: the trip was recorded on a frozen directory').to.equal(false);
      expect(stopped, 'the node never stopped its apps while its trip could not be recorded').to.not.equal(null);
      expect(stopped.apps.map((a) => a.app), 'the apps the node stopped').to.include(recordName);
    });

    it('records the trip once the config directory takes writes again', async function () {
      this.timeout(60000);
      await thawConfig(recContainer);
      await thawDocker(recContainer);
      await waitFor(async () => (await execInContainer(recContainer, `grep -q 'Host stall' ${record}`)).exitCode === 0, {
        timeout: 30000, interval: 1000, label: 'the trip recorded once the config directory came back',
      });
    });
  });
});
