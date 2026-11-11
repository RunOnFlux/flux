/*
 * An installed app component whose data is gone from this node: an r: copy, while
 * another copy runs it, is rebuilt on a fresh volume and runs again once its folder is
 * synced; an app with no synced data, which nothing can restore, is removed from the
 * node, and the removal is told to the network.
 *
 * Each image is removed and its mount dropped under a running FluxOS. The syncthing stub stands in for the sync,
 * so the r: case establishes the decision and the rebuild, not a data transfer -
 * suite 4304 holds that with real syncthing.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { destroyFolderVolume, appId } from '../framework/volume-fixture.js';
import { waitForUp, waitForAppRemoved, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const R_COPY = 2;
const UNSYNCED = 3;

describe('an r: copy whose volume is gone is rebuilt, and an app with no synced data is removed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5 });
    await bootAndPeer(env);
    await resetSyncState();
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('rebuilds an r: copy whose volume is gone while another copy runs it', async function () {
    this.timeout(600000);
    const appName = `e2elostr${stamp}`;
    const { folder, identifier, peerIndex } = await seedSyncthingApp(env, {
      name: appName, mode: 'r', forceNonLeader: true, index: R_COPY,
    });
    const client = env.clients[R_COPY];
    await setSynced({ folder });
    await waitForUp(client, appName, 'the r: copy runs', { timeout: 120000 });
    await waitForUp(env.clients[peerIndex], appName, 'the other copy runs', { timeout: 120000 });

    const beforeLoss = client.getLastEventId();
    await destroyFolderVolume(client.container, folder);

    const decision = await client.waitForEvent('app:lostVolume', (d) => d.identifier === identifier, 180000, { afterId: beforeLoss });
    expect(decision.data.action, `the copy decided: ${JSON.stringify(decision.data)}`).to.equal('rebuild');
    await client.waitForEvent('app:componentRedeployed', (d) => d.name === appName && d.hard === true, 300000, { afterId: beforeLoss });
    await setSynced({ folder });
    await waitForUp(client, appName, 'the rebuilt r: copy runs', { timeout: 180000 });
  });

  it('removes an app with no synced data whose volume is gone', async function () {
    this.timeout(420000);
    const appName = `e2elostplain${stamp}`;
    const identifier = `${appName}_${appName}`;
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: appName,
        description: 'test container',
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
    await installOnNodes(env, app, [UNSYNCED]);
    const client = env.clients[UNSYNCED];
    await waitForUp(client, appName, 'the app runs before its volume is lost');

    const beforeLoss = client.getLastEventId();
    await destroyFolderVolume(client.container, appId(appName));

    const decision = await client.waitForEvent('app:lostVolume', (d) => d.identifier === identifier, 180000, { afterId: beforeLoss });
    expect(decision.data.action, `the node decided: ${JSON.stringify(decision.data)}`).to.equal('remove');
    await waitForAppRemoved(client, appName, 180000, { afterId: beforeLoss });
    await assertNoEvent(client, 'app:componentRedeployed', (d) => d.name === appName, 1000, { afterId: beforeLoss });
  });
});
