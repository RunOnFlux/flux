// weight: heavy
/*
 * At boot a node reads its location record of each app whose containers are stopped,
 * which is every app a machine reboot leaves. One whose record has expired was placed
 * elsewhere while the node was down and is removed; one whose record is valid is
 * started. When the record cannot be read the node cannot tell, so the app is held:
 * not started, not elected, not announced. Boot reads the record again until it
 * answers, then starts or removes the app by the answer.
 *
 * Here FluxOS is killed and held down, the apps' containers are stopped, and the
 * node's reads of the location collection are refused before FluxOS comes back. The
 * holder's records are made to outlive the restart, as a production record does and
 * the harness's compressed one would not; a record meant to have expired is deleted.
 *
 * The mixed app pairs an active-standby component, which only the election starts,
 * with a plain one boot starts. Its decision is held at a checkpoint once the
 * database answers, so the announcement and the election that run then can be
 * watched leaving it alone. The plain app is decided as soon as the database
 * answers: it is the canary that the announcement and the decisions run at all.
 *
 * Every app asks for as many instances as the fleet has nodes and is installed on
 * every node, the holder first so it is the mixed app's primary, before the holder
 * goes down: none is placed anew while the holder is away. A standby may take over
 * the mixed app's active-standby component in that time.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage, pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, installedInstanceIndices } from '../framework/reconciler-suite.js';
import {
  crashFluxos, listAppContainers, releaseFluxos, stopAppContainer,
} from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { failCommands } from '../framework/mongo-control.js';
import { dbClient } from '../framework/db-client.js';
import { isDaemonUp } from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const HOLDER = 0;
const NODES = 3;
const APP_UID = 1000;
const BEFORE_DECISION = 'boot:beforeLocationDecision';
// Longer than anything below, and far shorter than a production record's TTL.
const RECORD_OUTLIVES_MS = 60 * 60 * 1000;

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
  const installedNames = async () => ((await holder.getInstalledApps()).data ?? []).map((a) => a.name);
  const heardRemoved = (appName, afterIds) => env.clients.some((client, i) => i !== HOLDER && client
    && client.getEventBuffer().some((e) => e.id > afterIds[i] && e.event === 'network:appremoved'
      && e.data?.name === appName && e.data?.ip?.startsWith(holder.ip)));
  const heardRunning = (appName, afterIds) => env.clients.some((client, i) => i !== HOLDER && client
    && client.getEventBuffer().some((e) => e.id > afterIds[i] && e.event === 'network:apprunning'
      && e.data?.ip?.startsWith(holder.ip) && (e.data?.apps ?? []).some((a) => a.name === appName)));
  // What the reconciler did with a component it was asked about after `afterId`:
  // deferred it or started it, resolved once it has done one of the two.
  const reconcilerAnswer = async (identifier, afterId) => {
    let answer = null;
    await waitFor(async () => {
      const started = holder.getEventBuffer().some((e) => e.id > afterId && e.event === 'reconciler:actuated'
        && e.data?.identifier === identifier && e.data?.action === 'started');
      if (started) {
        answer = 'started';
        return true;
      }
      if (await holder.getDecisionCount('reconciler:deferred', identifier, 'managedElsewhere') > 0) {
        answer = 'deferred';
        return true;
      }
      return false;
    }, { timeout: 120000, interval: 1000, label: `the reconciler answered for ${identifier}` });
    return answer;
  };
  const cycles = async () => (await holder.getTestCounters())?.['masterSlave:cycles'] ?? 0;

  // FluxOS killed and held, the given containers stopped, the holder's records of
  // `keep` made to outlive the restart and those of `drop` deleted, and its reads of
  // the location collection refused from before FluxOS comes back.
  async function rebootUnreadable(identifiers, { keep, drop }) {
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
    for (const appName of drop) {
      // eslint-disable-next-line no-await-in-loop
      const gone = await holderDb.expireAppLocation(appName, holder.ip);
      if (gone < 1) throw new Error(`the holder has no location record of ${appName} to expire`);
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
    let stoppedAtBoot;
    let sweptAfterBoot;
    let webWhileUnreadable;
    let plainWhileUnreadable;
    let upWhileUnreadable;
    let installedWhileUnreadable;
    let announcement;
    let electionCycles;
    let evaluatedWhileHeld;
    let skippedWhileHeld;
    let upWhileHeld;

    before(async function () {
      this.timeout(900000);
      step('taking the node down, its containers stopped and its location reads refused');
      ({ anchors, release } = await rebootUnreadable([db, web, plain], { keep: [mixedApp, plainApp], drop: [] }));
      // Held before boot's first read, which fails: the decision it holds comes at
      // least one retry interval after that.
      await holder.holdCheckpoint(BEFORE_DECISION, mixedApp);
      const settled = await holder.waitForEvent('boot:settled', () => true, 300000, { afterId: anchors[HOLDER] });
      await Promise.all([mixedApp, plainApp].map((appName) => holder.waitForEvent(
        'boot:appUnconfirmed', (d) => d.name === appName, 60000, { afterId: anchors[HOLDER] },
      )));
      stoppedAtBoot = !(await Promise.all([db, web, plain].map(isUp))).some(Boolean);

      step('the location records unreadable: the reconciler is asked about every component');
      sweptAfterBoot = Boolean(await holder.waitForEvent('reconciler:swept', () => true, 120000, { afterId: settled.id })
        .catch(() => null));
      [webWhileUnreadable, plainWhileUnreadable] = await Promise.all([
        reconcilerAnswer(web, settled.id), reconcilerAnswer(plain, settled.id),
      ]);
      upWhileUnreadable = (await Promise.all([db, web, plain].map(isUp))).some(Boolean);
      installedWhileUnreadable = await installedNames();

      step('the database answers: the plain app is decided, the mixed app held at its decision');
      const answeredFrom = holder.getLastEventId();
      const evaluatedBefore = await holder.getDecisionCount('masterSlave:decision', db, 'evaluated');
      failedReads = await release();
      release = null;
      await holder.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_DECISION && d.key === mixedApp, 120000, { afterId: answeredFrom });
      await holder.waitForEvent('boot:appConfirmed', (d) => d.name === plainApp && d.valid === true, 120000, { afterId: answeredFrom });
      announcement = (await holder.waitForEvent(
        'app:running', (d) => (d.apps ?? []).some((a) => a.name === plainApp), 120000, { afterId: answeredFrom },
      ).catch(() => null))?.data ?? null;
      const cyclesFrom = await cycles();
      await waitFor(async () => (await cycles()) >= cyclesFrom + 2, {
        timeout: 180000, interval: 2000, label: 'the election ran two passes while the mixed app was held',
      }).catch(() => {});
      electionCycles = (await cycles()) - cyclesFrom;
      evaluatedWhileHeld = (await holder.getDecisionCount('masterSlave:decision', db, 'evaluated')) - evaluatedBefore;
      skippedWhileHeld = await holder.getDecisionCount('masterSlave:decision', mixedApp, 'skippedUnconfirmed');
      upWhileHeld = (await Promise.all([db, web].map(isUp))).some(Boolean);

      step('the mixed app\'s decision released');
      await holder.releaseCheckpoint(BEFORE_DECISION, mixedApp);
      await holder.waitForEvent('boot:appConfirmed', (d) => d.name === mixedApp && d.valid === true, 60000, { afterId: answeredFrom });
    });

    after(async function () {
      this.timeout(60000);
      await release?.().catch(() => {});
      await holder?.releaseAllCheckpoints().catch(() => {});
    });

    it('boots with the apps\' containers stopped', function () {
      expect(stoppedAtBoot, 'a container was running when FluxOS came back, so boot had nothing to check').to.equal(true);
    });

    it('had its reads of the location records refused by the database', function () {
      expect(failedReads, 'the database refused none of the node\'s location reads, so nothing below was tested').to.be.at.least(1);
    });

    it('keeps an app it cannot confirm installed', function () {
      expect(installedWhileUnreadable, 'boot removed an app whose location it could not read').to.include.members([mixedApp, plainApp]);
    });

    it('starts no component of an app it cannot confirm, when the reconciler is asked to', function () {
      expect(sweptAfterBoot, 'no reconciler sweep ran while the records were unreadable, so nothing below was tested').to.equal(true);
      expect(webWhileUnreadable, 'the reconciler started a component of an app boot could not confirm').to.equal('deferred');
      expect(plainWhileUnreadable, 'the reconciler started an app boot could not confirm').to.equal('deferred');
      expect(upWhileUnreadable, 'a component of an app boot could not confirm is running').to.equal(false);
    });

    it('leaves an app it has not confirmed out of the announcement once the database answers', function () {
      expect(announcement, 'the node announced nothing once the database answered, so nothing below was tested').to.not.equal(null);
      expect(announcement.apps.map((a) => a.name), 'the announcement named an app boot had not confirmed').to.not.include(mixedApp);
    });

    it('leaves an app it has not confirmed out of the election', function () {
      expect(electionCycles, 'the election ran no pass while the app was held, so nothing below was tested').to.be.at.least(2);
      expect(evaluatedWhileHeld, 'the election decided an app boot had not confirmed').to.equal(0);
      expect(skippedWhileHeld, 'the election did not leave the held app alone').to.be.at.least(1);
      expect(upWhileHeld, 'a component of an app boot had not confirmed is running').to.equal(false);
    });

    it('starts the app once its record reads valid, its active-standby component on one node', async function () {
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
        timeout: 100000, interval: 2000, label: 'a peer heard the holder announce once the database answered',
      });
      expect(heardRemoved(mixedApp, anchors), 'a peer was told the holder gave up an app it kept').to.equal(false);
      expect(heardRemoved(plainApp, anchors), 'a peer was told the holder gave up an app it kept').to.equal(false);
    });
  });

  describe('a record that reads expired once it can be read', function () {
    let anchors;
    let release;
    let failedReads;
    let sweptAfterBoot;
    let lapsedWhileUnreadable;
    let installedWhileUnreadable;
    let removed;
    let installedAfter;

    before(async function () {
      this.timeout(900000);
      step('taking the node down again, the lapsed app\'s record deleted');
      ({ anchors, release } = await rebootUnreadable([lapsed, plain], { keep: [plainApp], drop: [lapsedApp] }));
      const settled = await holder.waitForEvent('boot:settled', () => true, 300000, { afterId: anchors[HOLDER] });
      await holder.waitForEvent('boot:appUnconfirmed', (d) => d.name === lapsedApp, 60000, { afterId: anchors[HOLDER] });
      sweptAfterBoot = Boolean(await holder.waitForEvent('reconciler:swept', () => true, 120000, { afterId: settled.id })
        .catch(() => null));
      lapsedWhileUnreadable = await reconcilerAnswer(lapsed, settled.id);
      installedWhileUnreadable = await installedNames();

      step('the database answers');
      const answeredFrom = holder.getLastEventId();
      failedReads = await release();
      release = null;
      await holder.waitForEvent('boot:appConfirmed', (d) => d.name === lapsedApp && d.valid === false, 120000, { afterId: answeredFrom });
      removed = Boolean(await holder.waitForEvent('app:removed', (d) => d.name === lapsedApp, 120000, { afterId: answeredFrom })
        .catch(() => null));
      installedAfter = await installedNames();
    });

    after(async function () {
      this.timeout(60000);
      await release?.().catch(() => {});
    });

    it('had its reads of the location records refused by the database', function () {
      expect(failedReads, 'the database refused none of the node\'s location reads, so nothing below was tested').to.be.at.least(1);
    });

    it('holds the app, installed and stopped, while its record cannot be read', function () {
      expect(sweptAfterBoot, 'no reconciler sweep ran while the records were unreadable, so nothing below was tested').to.equal(true);
      expect(installedWhileUnreadable, 'boot removed an app whose location it could not read').to.include(lapsedApp);
      expect(lapsedWhileUnreadable, 'the reconciler started an app boot could not confirm').to.equal('deferred');
    });

    it('removes the app once its record reads expired', function () {
      expect(removed, 'the app whose record expired was not removed').to.equal(true);
      expect(installedAfter, 'the app whose record expired is still installed').to.not.include(lapsedApp);
    });

    it('tells the network nothing of the removal, the network having dropped the record', async function () {
      this.timeout(120000);
      await waitFor(() => heardRunning(plainApp, anchors), {
        timeout: 100000, interval: 2000, label: 'a peer heard the holder announce once the database answered',
      });
      expect(heardRemoved(lapsedApp, anchors), 'a peer was told of the removal of an app whose record had expired').to.equal(false);
    });
  });
});
