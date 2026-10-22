// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { restartFluxos } from '../framework/container.js';
import { socketAddr } from '../framework/state-events.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node records when it took an app, once, and announces that as the app's
// runningSince for as long as the app stays on it. The network's copy of the
// node's own location row is not where it comes from: that row lapses while the
// app goes on running, and a redeploy removes and reinstalls the app without it
// leaving. The record goes with the app, and at boot the records are made to
// match what is installed, dating any missing one at the node's own row.

const REAL_NODES = 3;
const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('a node keeps its own record of when it took an app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let holder;
  let others;
  let placedAt;
  const appName = `e2eplacement${Date.now()}`;

  const placementOf = async (name) => (await dbClient(idx + 1).placements())[name];
  // The runningSince every other node holds for the holder, once each has stored
  // an announcement made after `since`.
  async function announcedSince(since) {
    const rows = await Promise.all(others.map((i) => dbClient(i + 1).appLocationAt(appName, holder)));
    if (!rows.every((row) => row && new Date(row.broadcastedAt).getTime() > since)) return null;
    return rows.map((row) => new Date(row.runningSince).getTime());
  }
  async function waitForAnnouncedSince(since, label) {
    let seen = null;
    await waitFor(async () => { seen = await announcedSince(since); return seen !== null; }, {
      timeout: 120000, interval: 3000, label,
    });
    return seen;
  }
  const teamAuth = async () => (await authenticate(env.clients[idx].url, fluxTeamKey())).zelidauth;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: REAL_NODES, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'placement record',
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
      }],
    });
    idx = await seedAndInstall(env, app);
    holder = socketAddr(idx + 1);
    others = realNodes.filter((i) => i !== idx);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('records when it took the app, and announces that', async function () {
    this.timeout(180000);
    const recorded = await placementOf(appName);
    expect(recorded, 'no record of when the holder took the app').to.be.instanceOf(Date);
    placedAt = recorded.getTime();

    const seen = await waitForAnnouncedSince(placedAt, 'every other node holds an announcement made since the install');
    expect(seen, 'the announced runningSince is not the recorded one').to.deep.equal(others.map(() => placedAt));
  });

  it('keeps announcing the recorded time after its own location rows lapse', async function () {
    this.timeout(180000);
    // Every node's row for the holder, the holder's own included, as after an
    // expiry, an eviction or a sigterm.
    await Promise.all(realNodes.map((i) => dbClient(i + 1).deleteAppLocation(appName, holder)));
    const lapsedAt = Date.now();

    const seen = await waitForAnnouncedSince(lapsedAt, 'every other node holds an announcement made since the rows lapsed');
    expect(seen, 'the holder re-dated the app when its row lapsed').to.deep.equal(others.map(() => placedAt));
    expect((await placementOf(appName)).getTime(), 'the record moved').to.equal(placedAt);
  });

  it('keeps the record through a hard redeploy', async function () {
    this.timeout(300000);
    const mark = env.clients[idx].getLastEventId();
    const body = await env.clients[idx].redeployApp(appName, await teamAuth(), { force: true });
    const rebuilt = await env.clients[idx].waitForEvent('app:rebuilt', (d) => d.name === appName, 240000, { afterId: mark });
    expect(rebuilt.outcome, `the redeploy did not reinstall the app: ${body.slice(-400)}`).to.equal('installed');
    const redeployedAt = Date.now();

    expect((await placementOf(appName)).getTime(), 'the redeploy moved the record').to.equal(placedAt);
    const seen = await waitForAnnouncedSince(redeployedAt, 'every other node holds an announcement made since the redeploy');
    expect(seen, 'the redeploy re-dated the app').to.deep.equal(others.map(() => placedAt));
  });

  // A node that took an app before it had these records gets one at boot, dated
  // at the runningSince its own row already carries; a record for an app it does
  // not hold is dropped.
  it('makes its records match its installed apps at boot, dating a missing one at its own row', async function () {
    this.timeout(420000);
    const rowSince = Date.now() - 3 * DAY_MS;
    const ghost = `e2eplacementghost${Date.now()}`;
    await dbClient(idx + 1).deletePlacement(appName);
    await dbClient(idx + 1).seedPlacement(ghost, Date.now() - DAY_MS);
    await dbClient(idx + 1).setAppLocationRunningSince(appName, holder, rowSince);

    // FluxOS alone, so the downtime is seconds and the node keeps its apps.
    const mark = env.clients[idx].getLastEventId();
    await restartFluxos(env.clients[idx].container);
    await waitForBootSettled(env.clients[idx], 240000, { afterId: mark });

    const records = await dbClient(idx + 1).placements();
    expect(records[appName]?.getTime(), 'the missing record was not dated at the node\'s own row').to.equal(rowSince);
    expect(records, 'the record of an app the node does not hold survived boot').to.not.have.property(ghost);
    const bootedAt = Date.now();
    const seen = await waitForAnnouncedSince(bootedAt, 'every other node holds an announcement made since the boot');
    expect(seen, 'the announced runningSince is not the recorded one').to.deep.equal(others.map(() => rowSince));
    placedAt = rowSince;
  });

  it('drops the record with the app, so a later install starts a new one', async function () {
    this.timeout(240000);
    const mark = env.clients[idx].getLastEventId();
    const body = await env.clients[idx].removeAppLocally(appName, await teamAuth());
    await env.clients[idx].waitForEvent('app:removed', (d) => d.name === appName, 180000, { afterId: mark });

    // The node's own spawner may take the app back at once; whichever record
    // stands is a new one, never the one the removal ended.
    const after = await placementOf(appName);
    expect(after?.getTime(), `the removal kept the record: ${body.slice(-400)}`).to.not.equal(placedAt);
    if (after) expect(after.getTime(), 'a record older than the removal').to.be.at.least(Date.now() - 180000);
  });
});
