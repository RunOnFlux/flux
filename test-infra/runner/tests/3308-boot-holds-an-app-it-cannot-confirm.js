// weight: heavy
/*
 * At boot a node reads its location record of each app whose containers are stopped,
 * which is every app a machine reboot leaves. One whose record has expired was placed
 * elsewhere while the node was down and is removed; one whose record is valid is
 * started. When the record cannot be read the node cannot tell, so boot reads it
 * again until it answers and does not settle before then: the node announces
 * nothing, starts nothing and takes no app request until every app is decided.
 * Past bootAppsReconcileTimeoutMs boot removes every app and settles.
 *
 * Here FluxOS is killed and held down, the apps' containers are stopped, and the
 * node's reads of the location collection are refused before FluxOS comes back. The
 * holder's records are made to outlive the restart, as a production record does and
 * the harness's compressed one would not.
 *
 * A record that has expired is one the holder last renewed longer ago than its TTL,
 * everywhere: the holder stays down that long. A node down that long whose boot
 * history says so removes every app at once; one with no boot history - a FluxOS
 * that never wrote one - decides app by app, which is the path tested here.
 *
 * The mixed app pairs an active-standby component, which only the election starts,
 * with a plain one boot starts. Boot holds the first of the two it reads and reads
 * the other only once that one is decided, so one app is held, whichever boot
 * reaches first. Its decision is held at a checkpoint once the database answers:
 * boot is watched not settling while an app is still undecided.
 *
 * Every app asks for as many instances as the fleet has nodes and is installed on
 * every node, the holder first so it is the mixed app's primary, before the holder
 * goes down: none is placed anew while the holder is away. A standby may take over
 * the mixed app's active-standby component in that time. The deadline case runs
 * last: it removes every app on the holder.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage, pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  bootAndPeer, installOnNodes, installSeededOnNodes, installedInstanceIndices,
} from '../framework/reconciler-suite.js';
import {
  crashFluxos, listAppContainers, releaseFluxos, stopAppContainer,
} from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { failCommands } from '../framework/mongo-control.js';
import { dbClient } from '../framework/db-client.js';
import { isDaemonUp } from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { loadSharedConfig, BOOT_DRIFT_MS } from '../framework/coupled-knobs.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';

const HOLDER = 0;
const NODES = 3;
const APP_UID = 1000;
const BEFORE_DECISION = 'boot:beforeLocationDecision';
// Longer than anything below, and far shorter than a production record's TTL.
const RECORD_OUTLIVES_MS = 60 * 60 * 1000;
// Down this long, every location record of the holder has expired on every node.
const RECORDS_EXPIRE_MS = loadSharedConfig().fluxapps.locationTtlS * 1000 + BOOT_DRIFT_MS;
// How long boot takes to decide its apps before it removes them all: longer than the
// valid-record case holds a read refused and a decision at its checkpoint.
const BOOT_APPS_RECONCILE_TIMEOUT_MS = 180000;

function step(what) {
  console.log(`# 3308 ${new Date().toISOString()} ${what}`);
}

function plainComponent(appName) {
  return {
    name: appName,
    description: 'boot location test container',
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  };
}

describe('boot holds an app whose location it cannot read', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  // decided at once when the database answers
  const plainApp = `e2ebootplain${stamp}`;
  // decided once the checkpoint is released
  const mixedApp = `e2ebootmixed${stamp}`;
  // its record is gone
  const lapsedApp = `e2ebootlapsed${stamp}`;
  const db = `db_${mixedApp}`;
  const web = `web_${mixedApp}`;
  const plain = `${plainApp}_${plainApp}`;
  const lapsed = `${lapsedApp}_${lapsedApp}`;
  let holder;
  let holderDb;
  const activeStandby = watchGComponents(() => env, {
    appName: mixedApp, components: ['db'], holders: [...Array(NODES).keys()],
  });

  const isUp = async (identifier) => (await listAppContainers(holder.container))
    .some((c) => c.name === `flux${identifier}` && c.status?.startsWith('Up'));
  const installedNames = () => holderDb.localAppNames();
  const heardRemoved = (appName, afterIds) => env.clients.some((client, i) => i !== HOLDER && client
    && client.getEventBuffer().some((e) => e.id > afterIds[i] && e.event === 'network:appremoved'
      && e.data?.name === appName && e.data?.ip?.startsWith(holder.ip)));
  const heardRunning = (appName, afterIds) => env.clients.some((client, i) => i !== HOLDER && client
    && client.getEventBuffer().some((e) => e.id > afterIds[i] && e.event === 'network:apprunning'
      && e.data?.ip?.startsWith(holder.ip) && (e.data?.apps ?? []).some((a) => a.name === appName)));
  // Whether the holder did `name` after `afterId`, read from its own events.
  const did = (name, afterId, predicate = () => true) => holder.getEventBuffer()
    .some((e) => e.id > afterId && e.event === name && predicate(e.data ?? {}));

  // Each step below records what it saw rather than throwing, so a node that does
  // not hold the app answers at the assertion that names what it did instead.
  const heard = (name, predicate, timeout, afterId) => holder.waitForEvent(name, predicate, timeout, { afterId })
    .catch(() => null);

  // FluxOS killed and held, the given containers stopped, the holder's records of
  // `keep` made to outlive the restart, and its reads of the location collection
  // refused from before FluxOS comes back. `expire` holds it down until every record
  // of it has expired, its boot history forgotten.
  async function rebootUnreadable(identifiers, { keep = [], expire = false }) {
    await crashFluxos(holder.container, { hold: true });
    for (const identifier of identifiers) {
      const [component, appName] = identifier.split('_');
      // eslint-disable-next-line no-await-in-loop
      const stopped = await stopAppContainer(holder.container, appName, component);
      if (stopped.exitCode !== 0) throw new Error(`could not stop ${identifier}: ${stopped.output}`);
    }
    for (const appName of keep) {
      // eslint-disable-next-line no-await-in-loop
      const kept = await holderDb.extendAppLocation(appName, holder.ip, RECORD_OUTLIVES_MS);
      if (kept < 1) throw new Error(`the holder has no location record of ${appName} to keep`);
    }
    if (expire) {
      await sleepUnlessInfraDead(RECORDS_EXPIRE_MS);
      await holderDb.forgetHeartbeat();
    }
    const anchors = env.clients.map((client) => client?.getLastEventId());
    const release = await failCommands(HOLDER + 1, 'globalzelapps', 'zelappslocation', { commands: ['find'] });
    await releaseFluxos(holder.container, { readyTimeoutMs: 180000 });
    return { anchors, release };
  }

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
        system: { bootAppsReconcileTimeoutMs: BOOT_APPS_RECONCILE_TIMEOUT_MS },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    holder = env.clients[HOLDER];
    holderDb = dbClient(HOLDER + 1);
    await Promise.all(env.clients.map((client, i) => waitFor(() => isDaemonUp(client), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(mixedApp, 'v1', 'bootmixed', { user: APP_UID });
    await pushImage(plainApp, 'v1');
    await pushImage(lapsedApp, 'v1');
    const apps = await Promise.all([
      buildSeedableApp({
        env,
        name: mixedApp,
        instances: NODES,
        compose: [gComponent(mixedApp, 'db'), { ...gComponent(mixedApp, 'web'), containerData: '/appdata' }],
      }),
      buildSeedableApp({ env, name: plainApp, instances: NODES, compose: [plainComponent(plainApp)] }),
      buildSeedableApp({ env, name: lapsedApp, instances: NODES, compose: [plainComponent(lapsedApp)] }),
    ]);
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, [HOLDER]);
    }
    await waitFor(async () => (await Promise.all([db, web, plain, lapsed].map(isUp))).every(Boolean), {
      timeout: 300000, interval: 3000, label: 'every app runs on the holder, the mixed app\'s db as its primary',
    });
    const peers = [...Array(NODES).keys()].filter((i) => i !== HOLDER);
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, peers);
    }
    await waitFor(async () => (await Promise.all([mixedApp, plainApp, lapsedApp].map((appName) => installedInstanceIndices(env, appName))))
      .every((holders) => holders.length === NODES), {
      timeout: 300000, interval: 5000, label: 'every app is on every node',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  describe('a record that reads valid once it can be read', function () {
    let anchors;
    let release;
    let failedReads;
    let held;
    let whileUnreadable;
    let parkedAtDecision;
    let whileHeld;
    let settled;
    let announcement;

    // What the holder is doing while an app is undecided: whether boot settled, it
    // announced, or any of the apps' containers runs, and what it has installed.
    const undecided = async (afterId) => ({
      settled: did('boot:settled', afterId),
      announced: did('app:running', afterId),
      running: (await Promise.all([db, web, plain].map(isUp))).some(Boolean),
      installed: await installedNames(),
    });

    before(async function () {
      this.timeout(900000);
      step('taking the node down, its containers stopped and its location reads refused');
      ({ anchors, release } = await rebootUnreadable([db, web, plain], { keep: [mixedApp, plainApp] }));
      // Held before boot's first read, which fails: the decision it holds comes at
      // least one retry interval after that. Only the app boot holds reaches it.
      const holdable = (await Promise.all([mixedApp, plainApp].map((appName) => holder.holdCheckpoint(BEFORE_DECISION, appName)
        .then(() => true, () => false)))).every(Boolean);
      held = (await heard('boot:appUnconfirmed', (d) => [mixedApp, plainApp].includes(d.name), 120000, anchors[HOLDER]))?.data?.name ?? null;
      // two read retries go by, refused
      await sleepUnlessInfraDead(35000);
      whileUnreadable = await undecided(anchors[HOLDER]);

      step('the database answers: the held app\'s decision held at its checkpoint');
      const answeredFrom = holder.getLastEventId();
      failedReads = await release();
      release = null;
      parkedAtDecision = holdable && held !== null && Boolean(await heard(
        'checkpoint:held', (d) => d.name === BEFORE_DECISION && d.key === held, 120000, answeredFrom,
      ));
      await sleepUnlessInfraDead(15000);
      whileHeld = await undecided(anchors[HOLDER]);

      step('the held app\'s decision released');
      const releasedFrom = holder.getLastEventId();
      await holder.releaseAllCheckpoints().catch(() => {});
      settled = Boolean(await heard('boot:settled', () => true, 120000, releasedFrom));
      announcement = (await heard('app:running', () => true, 180000, releasedFrom))?.data ?? null;
    });

    after(async function () {
      this.timeout(60000);
      await release?.().catch(() => {});
      await holder?.releaseAllCheckpoints().catch(() => {});
    });

    it('had its reads of the location records refused by the database', function () {
      expect(failedReads, 'the database refused none of the node\'s location reads, so nothing below was tested').to.be.at.least(1);
    });

    it('holds the app it cannot confirm, installed and stopped, and does not settle', function () {
      expect(held, 'boot held neither app whose location it could not read').to.not.equal(null);
      expect(whileUnreadable.installed, 'boot removed an app whose location it could not read').to.include.members([mixedApp, plainApp]);
      expect(whileUnreadable.running, 'a component of an app boot could not confirm is running').to.equal(false);
      expect(whileUnreadable.settled, 'boot settled with apps it could not confirm').to.equal(false);
      expect(whileUnreadable.announced, 'the node announced while boot could not confirm its apps').to.equal(false);
    });

    it('does not settle while the held app is still undecided once the database answers', function () {
      expect(parkedAtDecision, 'the held app\'s decision was not held, so boot was not watched with an app undecided').to.equal(true);
      expect(whileHeld.settled, 'boot settled with an app undecided').to.equal(false);
      expect(whileHeld.announced, 'the node announced with an app undecided').to.equal(false);
      expect(whileHeld.running, 'a component ran before boot had decided every app').to.equal(false);
    });

    it('settles once every app is decided, and announces both apps', function () {
      expect(settled, 'boot did not settle once every app was decided').to.equal(true);
      expect(announcement, 'the node announced nothing once boot settled').to.not.equal(null);
      expect(announcement.apps.map((a) => a.name)).to.include.members([mixedApp, plainApp]);
    });

    it('starts the apps, the active-standby component on one node', async function () {
      this.timeout(240000);
      await waitFor(async () => (await Promise.all([web, plain].map(isUp))).every(Boolean), {
        timeout: 200000, interval: 3000, label: 'the plain components run again',
      });
      await waitFor(async () => Object.values(await activeStandby.oneHolderAtMost()).some((running) => running.includes('db')), {
        timeout: 200000, interval: 3000, label: 'the mixed app\'s db runs on one node',
      });
      expect(await installedNames()).to.include.members([mixedApp, plainApp]);
    });

    it('tells the network nothing of an app it kept', async function () {
      this.timeout(120000);
      await waitFor(() => heardRunning(plainApp, anchors), {
        timeout: 100000, interval: 2000, label: 'a peer heard the holder announce once boot settled',
      });
      expect(heardRemoved(mixedApp, anchors), 'a peer was told the holder gave up an app it kept').to.equal(false);
      expect(heardRemoved(plainApp, anchors), 'a peer was told the holder gave up an app it kept').to.equal(false);
    });
  });

  describe('a record that reads expired once it can be read', function () {
    let anchors;
    let release;
    let failedReads;
    let heldAtBoot;
    let settledWhileUnreadable;
    let installedWhileUnreadable;
    let removed;
    let settled;
    let announcement;
    let installedAfter;

    before(async function () {
      this.timeout(900000);
      step('taking the node down again, for longer than its records live, its boot history forgotten');
      ({ anchors, release } = await rebootUnreadable([lapsed], { expire: true }));
      heldAtBoot = Boolean(await heard('boot:appUnconfirmed', (d) => d.name === lapsedApp, 120000, anchors[HOLDER]));
      await sleepUnlessInfraDead(35000);
      settledWhileUnreadable = did('boot:settled', anchors[HOLDER]);
      installedWhileUnreadable = await installedNames();

      step('the database answers');
      const answeredFrom = holder.getLastEventId();
      failedReads = await release();
      release = null;
      await heard('boot:appConfirmed', (d) => d.name === lapsedApp && d.valid === false, 120000, answeredFrom);
      removed = Boolean(await heard('app:removed', (d) => d.name === lapsedApp, 120000, answeredFrom));
      settled = Boolean(await heard('boot:settled', () => true, 120000, answeredFrom));
      announcement = (await heard('app:running', () => true, 180000, answeredFrom))?.data ?? null;
      installedAfter = await installedNames();
    });

    after(async function () {
      this.timeout(60000);
      await release?.().catch(() => {});
    });

    it('had its reads of the location records refused by the database', function () {
      expect(failedReads, 'the database refused none of the node\'s location reads, so nothing below was tested').to.be.at.least(1);
    });

    it('holds the app, installed, and does not settle while its record cannot be read', function () {
      expect(heldAtBoot, 'boot did not hold the app whose location it could not read').to.equal(true);
      expect(installedWhileUnreadable, 'boot removed an app whose location it could not read').to.include(lapsedApp);
      expect(settledWhileUnreadable, 'boot settled with an app it could not confirm').to.equal(false);
    });

    it('removes the app once its record reads expired, then settles', function () {
      expect(removed, 'the app whose record expired was not removed').to.equal(true);
      expect(installedAfter, 'the app whose record expired is still installed').to.not.include(lapsedApp);
      expect(settled, 'boot did not settle once every app was decided').to.equal(true);
    });

    it('announces without the app, and tells the network nothing of the removal', async function () {
      this.timeout(120000);
      expect(announcement, 'the node announced nothing once boot settled').to.not.equal(null);
      expect(announcement.apps.map((a) => a.name)).to.not.include(lapsedApp);
      // the plain app runs throughout, so boot does not check it and the holder names it
      await waitFor(() => heardRunning(plainApp, anchors), {
        timeout: 100000, interval: 2000, label: 'a peer heard the holder announce once boot settled',
      });
      expect(heardRemoved(lapsedApp, anchors), 'a peer was told of the removal of an app whose record had expired').to.equal(false);
    });
  });

  // Runs last: it removes every app on the holder.
  describe('a record that never answers before the deadline', function () {
    let anchors;
    let release;
    let heldAtBoot;
    let settledBeforeDeadline;
    let settled;
    let installedAfter;

    before(async function () {
      this.timeout(900000);
      step('taking the node down, its location reads refused for longer than boot waits');
      ({ anchors, release } = await rebootUnreadable([plain], { keep: [plainApp] }));
      heldAtBoot = Boolean(await heard('boot:appUnconfirmed', (d) => d.name === plainApp, 120000, anchors[HOLDER]));
      await sleepUnlessInfraDead(BOOT_APPS_RECONCILE_TIMEOUT_MS / 2);
      settledBeforeDeadline = did('boot:settled', anchors[HOLDER]);
      settled = Boolean(await heard('boot:settled', () => true, BOOT_APPS_RECONCILE_TIMEOUT_MS + 300000, anchors[HOLDER]));
      await waitFor(async () => (await installedNames()).length === 0, {
        timeout: 300000, interval: 5000, label: 'every app removed',
      }).catch(() => {});
      installedAfter = await installedNames();
    });

    after(async function () {
      this.timeout(60000);
      await release?.().catch(() => {});
    });

    it('holds the app and does not settle before the deadline', function () {
      expect(heldAtBoot, 'boot did not hold the app whose location it could not read').to.equal(true);
      expect(settledBeforeDeadline, 'boot settled before its deadline with an app undecided').to.equal(false);
    });

    it('removes every app at the deadline, and settles', function () {
      expect(settled, 'boot did not settle at its deadline').to.equal(true);
      expect(installedAfter, 'an app is still installed after boot gave up deciding').to.deep.equal([]);
    });
  });
});
