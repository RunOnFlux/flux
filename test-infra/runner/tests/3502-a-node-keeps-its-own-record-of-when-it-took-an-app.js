// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitForBootSettled, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { restartFluxos } from '../framework/container.js';
import { socketAddr } from '../framework/state-events.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node records when it took an app, once (app:placementRecorded), and announces
// that as the app's runningSince for as long as the app stays on it. The
// network's copy of the node's own location row is not where it comes from: that
// row lapses while the app goes on running, and a redeploy removes and
// reinstalls the app without it leaving. The record goes with the app
// (app:placementRemoved), and at boot the records are made to match what is
// installed (app:placementsReconciled), dating a missing one at the node's own
// row.

const REAL_NODES = 3;
const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);
const DAY_MS = 24 * 60 * 60 * 1000;
const bare = (address) => String(address).replace(/:16127$/, '');

describe('a node keeps its own record of when it took an app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let holder;
  let others;
  // What the holder's announcements carry for the app, from the first one on.
  let announcedSince;
  const appName = `e2eplacement${Date.now()}`;

  const runningSinceIn = (data) => {
    const entry = data.apps?.find((a) => a.name === appName);
    return entry ? new Date(entry.runningSince).getTime() : null;
  };
  // The runningSince every other node stored from the holder's next announcement
  // after `afterIds`.
  async function nextStoredRunningSince(afterIds) {
    const events = await Promise.all(others.map((i) => env.clients[i].waitForEvent(
      'network:apprunning',
      (d) => bare(d.ip) === bare(holder) && d.apps?.some((a) => a.name === appName),
      120000,
      { afterId: afterIds[i] },
    )));
    return events.map(({ data }) => runningSinceIn(data));
  }
  const marks = () => realNodes.map((i) => env.clients[i].getLastEventId());
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
    const { data: first } = await env.clients[idx].waitForEvent('app:running', (d) => runningSinceIn(d) !== null, 120000);
    announcedSince = runningSinceIn(first);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('records when it took the app at install, and announces that', async function () {
    this.timeout(180000);
    const { data: recorded } = await env.clients[idx].waitForEvent('app:placementRecorded', (d) => d.name === appName, 10000);
    expect(recorded.source).to.equal('install');
    expect(new Date(recorded.placedAt).getTime(), 'the announced runningSince is not the recorded one').to.equal(announcedSince);

    const stored = await nextStoredRunningSince(marks());
    expect(stored, 'another node stored a different runningSince').to.deep.equal(others.map(() => announcedSince));
  });

  it('keeps announcing the same time after its own location rows lapse', async function () {
    this.timeout(180000);
    const afterIds = marks();
    // Every node's row for the holder, the holder's own included, as after an
    // expiry, an eviction or a sigterm.
    await Promise.all(realNodes.map((i) => dbClient(i + 1).deleteAppLocation(appName, holder)));

    const stored = await nextStoredRunningSince(afterIds);
    expect(stored, 'the holder re-dated the app when its row lapsed').to.deep.equal(others.map(() => announcedSince));
  });

  it('keeps the record, and the time it announces, through a hard redeploy', async function () {
    this.timeout(300000);
    const afterIds = marks();
    const body = await env.clients[idx].redeployApp(appName, await teamAuth(), { force: true });
    const { data: rebuilt } = await env.clients[idx].waitForEvent('app:rebuilt', (d) => d.name === appName, 240000, { afterId: afterIds[idx] });
    expect(rebuilt.outcome, `the redeploy did not reinstall the app: ${body.slice(-400)}`).to.equal('installed');

    await assertNoEvent(env.clients[idx], 'app:placementRemoved', (d) => d.name === appName, 0, { afterId: afterIds[idx] });
    await assertNoEvent(env.clients[idx], 'app:placementRecorded', (d) => d.name === appName, 0, { afterId: afterIds[idx] });
    const stored = await nextStoredRunningSince(marks());
    expect(stored, 'the redeploy re-dated the app').to.deep.equal(others.map(() => announcedSince));
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
    const afterIds = marks();
    await restartFluxos(env.clients[idx].container);
    await waitForBootSettled(env.clients[idx], 240000, { afterId: afterIds[idx] });

    const { data: reconciled } = await env.clients[idx].waitForEvent('app:placementsReconciled', () => true, 10000, { afterId: afterIds[idx] });
    expect(reconciled, 'the boot did not reconcile the records').to.deep.equal({ created: 1, fromLocationRows: 1, removed: 1 });
    const { data: recorded } = await env.clients[idx].waitForEvent('app:placementRecorded', (d) => d.name === appName, 10000, { afterId: afterIds[idx] });
    expect(recorded.source).to.equal('locationRow');
    expect(new Date(recorded.placedAt).getTime(), 'the missing record was not dated at the node\'s own row').to.equal(rowSince);

    const stored = await nextStoredRunningSince(marks());
    expect(stored, 'the announced runningSince is not the recorded one').to.deep.equal(others.map(() => rowSince));
  });

  it('drops the record with the app', async function () {
    this.timeout(240000);
    const afterIds = marks();
    const body = await env.clients[idx].removeAppLocally(appName, await teamAuth());
    await env.clients[idx].waitForEvent('app:removed', (d) => d.name === appName, 180000, { afterId: afterIds[idx] })
      .catch(() => { throw new Error(`the app was not removed: ${body.slice(-400)}`); });

    await env.clients[idx].waitForEvent('app:placementRemoved', (d) => d.name === appName, 30000, { afterId: afterIds[idx] });
  });
});
