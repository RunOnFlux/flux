/*
 * A node whose fluxd keeps no address index (flux.conf without insightexplorer=1)
 * is held out of service from its start: it serves its API saying why, every app
 * it holds is removed, its boot settles, and it starts nothing that reads the
 * index - the explorer first among them.
 *
 * The node is the upgrade case: it runs an app with the index, then starts again
 * with a flux.conf that lacks the key. The app is pinned to it, so the removal can
 * only be this node's.
 *
 * The daemon is the harness's stub, which answers the address index whatever
 * flux.conf says: what is under test is FluxOS's reading of flux.conf, not fluxd.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { removeFluxdConfKey } from '../framework/fluxd-conf.js';
import { assertNoEvent, waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const UNINDEXED = 'fluxd is running without insightexplorer=1';

describe('a node whose fluxd keeps no address index is held out of service', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const name = `e2enoindex${Date.now()}`;
  const HELD = 1;
  let held;
  let mark;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    held = env.clients[HELD];

    await pushImage(name, 'v1');
    const app = await buildSeedableApp({
      name,
      compose: [{
        name,
        description: 'test container',
        repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [HELD]);
    expect(held.getEventBuffer().some((e) => e.event === 'explorer:ready'), 'the explorer was ready at the first start').to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds the node out of service from its next start, and its API says why', async function () {
    this.timeout(300000);
    mark = held.getLastEventId();
    await removeFluxdConfKey(held.container, 'insightexplorer');

    await env.restartNode(HELD);

    await held.waitForEvent('dos:changed', (d) => d.dosState === 100 && d.dosMessage === UNINDEXED, 120000, { afterId: mark });
    await waitFor(async () => {
      const state = await held.get(`/flux/dosstate?_=${Date.now()}`);
      return state?.data?.dosState === 100 && state.data.dosMessage === UNINDEXED;
    }, { timeout: 60000, interval: 2000, label: 'the API reports the node out of service for its fluxd' });
  });

  it('removes every app the node holds', async function () {
    this.timeout(300000);
    await held.waitForEvent('app:removed', (d) => d.name === name, 240000, { afterId: mark });
    await waitFor(async () => {
      const installed = await held.get(`/apps/installedapps?_=${Date.now()}`);
      return installed?.status === 'success' && !installed.data.some((app) => app.name === name);
    }, { timeout: 60000, interval: 2000, label: 'the app is no longer installed on the held node' });
  });

  it('settles its boot', async function () {
    this.timeout(120000);
    await held.waitForEvent('boot:settled', () => true, 60000, { afterId: mark });
  });

  // The canary is the explorer:ready of the node's first start (asserted in
  // before) and the hold the restart reached (the first test).
  it('starts no explorer', async function () {
    this.timeout(180000);
    await assertNoEvent(held, 'explorer:ready', () => true, 120000, { afterId: mark });
  });
});
