/*
 * An installed app component whose data is gone from this node: an r: copy, while
 * another copy runs it, is rebuilt on a fresh volume and runs again once its folder is
 * synced; an app with no synced data, which nothing can restore, is removed from the
 * node, and the removal is told to the network.
 *
 * Each image is removed and its mount dropped while the node's FluxOS is down, and
 * found gone when it starts: a node that lost the disk holding it, rebooted. The syncthing stub stands in for the sync,
 * so the r: case establishes the decision and the rebuild, not a data transfer -
 * suite 4304 holds that with real syncthing.
 *
 * A volume whose image this node recorded on a disk that is not mounted is not gone:
 * the disk may come back. The image is moved onto a second disk - a device-mapper
 * device, which the image search reads as a disk, unlike a loop mount - and the node
 * restarts with that disk unmounted.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import {
  destroyFolderVolume, appId, mountDisk, unmountDisk, moveFolderImage, unmountFolderVolume,
} from '../framework/volume-fixture.js';
import {
  waitForUp, waitForAppRemoved, waitForReconcileActuated, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { PRODUCTION_LOCATION_EXPIRIES } from '../framework/coupled-knobs.js';

const R_COPY = 2;
const UNSYNCED = 3;
const ON_SECOND_DISK = 4;
const SECOND_DISK = '/mnt/disk2';

describe('an r: copy whose volume is gone is rebuilt, an app with no synced data is removed, and a volume on an absent disk is waited for', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();

  before(async function () {
    this.timeout(300000);
    // Each node restarts with its apps installed, which the harness does not compress.
    env = await createTestEnv({
      hookCtx: this, nodes: 5, configOverrides: { fluxapps: PRODUCTION_LOCATION_EXPIRIES },
    });
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
    await crashFluxos(client.container, { hold: true });
    await destroyFolderVolume(client.container, folder);
    await releaseFluxos(client.container);

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
    await crashFluxos(client.container, { hold: true });
    await destroyFolderVolume(client.container, appId(appName));
    await releaseFluxos(client.container);

    const decision = await client.waitForEvent('app:lostVolume', (d) => d.identifier === identifier, 180000, { afterId: beforeLoss });
    expect(decision.data.action, `the node decided: ${JSON.stringify(decision.data)}`).to.equal('remove');
    await waitForAppRemoved(client, appName, 180000, { afterId: beforeLoss });
    await assertNoEvent(client, 'app:componentRedeployed', (d) => d.name === appName, 1000, { afterId: beforeLoss });
  });
  it('waits for a volume whose disk is not mounted, and runs the app again once it is', async function () {
    this.timeout(900000);
    const appName = `e2elostdisk${stamp}`;
    const identifier = `${appName}_${appName}`;
    const folder = appId(appName);
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
    await installOnNodes(env, app, [ON_SECOND_DISK]);
    const client = env.clients[ON_SECOND_DISK];
    await waitForUp(client, appName, 'the app runs on its first disk');

    // The image moves to the second disk, and the node mounts it from there.
    const beforeMove = client.getLastEventId();
    await crashFluxos(client.container, { hold: true });
    await mountDisk(client.container, SECOND_DISK);
    await moveFolderImage(client.container, folder, SECOND_DISK);
    await releaseFluxos(client.container);
    await waitForUp(client, appName, 'the app runs from its image on the second disk', { timeout: 240000 });

    // The node restarts without the second disk.
    await crashFluxos(client.container, { hold: true });
    await unmountFolderVolume(client.container, folder, `${SECOND_DISK}/${folder}FLUXFSVOL`);
    await unmountDisk(client.container, SECOND_DISK);
    const beforeAbsent = client.getLastEventId();
    await releaseFluxos(client.container);

    const unavailable = await waitForReconcileActuated(client, identifier, 'volumeUnavailable', 240000, { afterId: beforeAbsent });
    expect(unavailable.data.reason, 'the volume of an image on a disk that is not mounted').to.equal('host_filesystem_absent');
    await assertNoEvent(client, 'app:lostVolume', (d) => d.identifier === identifier, 60000, { afterId: beforeMove });
    await assertNoEvent(client, 'app:removed', (d) => d.name === appName, 1000, { afterId: beforeMove });

    await mountDisk(client.container, SECOND_DISK);
    await waitForUp(client, appName, 'the app runs again once its disk is back', { timeout: 240000 });
  });
});
