import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus, restartFluxos } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableEnterpriseApp } from '../framework/seed-helper.js';
import {
  waitFor, waitForReconcileActuated, waitForAppRemoved, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp, seedSyncScopedData, installOnNodes } from '../framework/reconciler-suite.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

// FluxOS owns app volume mounting (no @reboot crontab), and an unmounted app
// dir is inert. These are the incident regressions:
//  - install creates NO crontab entry, and the volume is loop-mounted for real
//  - a machine reboot with an EMPTY crontab (the incident state: the entry had
//    silently vanished) still remounts the volume - old code only remounted
//    from crontab entries, so the app dir silently degraded to a bare host dir
//  - a legacy @reboot entry left by an older FluxOS is removed on start
//  - writes to an unmounted app dir fail (chattr +i) instead of landing on the
//    host filesystem, and FluxOS self-heals the mount without a restart
//  - an app whose backing image is GONE stays inert: no start, no structure
//    recreated on the bare dir
//  - uninstall deletes the backing image WITHOUT a crontab entry to parse
//    (old code orphaned the image when the entry was missing)
//  - a legacy @reboot entry whose volume CANNOT be mounted is KEPT - it is the
//    remaining safety net; removing entries on the strength of a possibly
//    blind inventory is how they kept vanishing in production
//  - all of the above hold for ENTERPRISE apps, whose local row stores compose
//    EMPTY (components only inside the encrypted blob) - the inventory that
//    took that as "not installed" ate their remount entries on every start

const subnet = getSubnetConfig();

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;

async function isMountpoint(container, dir) {
  const r = await execInContainer(container, `mountpoint -q ${dir}`);
  return r.exitCode === 0;
}

async function fileExists(container, path) {
  const r = await execInContainer(container, `test -e ${path}`);
  return r.exitCode === 0;
}

async function crontabVolumeEntries(container) {
  const r = await execInContainer(container, 'crontab -l 2>/dev/null | grep -c FLUXFSVOL || true');
  return parseInt(r.stdout.trim(), 10) || 0;
}

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

// targeted install of a plain (non-sync) app on one node
async function installPlainApp(env, name, index, port) {
  await pushImage(name, 'v1');
  const app = await buildSeedableApp({
    name,
    compose: [{
      name,
      description: 'test container',
      repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
      ports: [port],
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
  await installOnNodes(env, app, [index]);
  return app;
}

describe('FluxOS-owned volume mounting (no crontab) + inert unmounted app dirs', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const syncName = `e2evolsync${ts}`; // r: app on node 0 (invariants, self-heal, legacy cleanup)
  const rebootName = `e2evolboot${ts}`; // plain app on node 1 (reboot remount regression)
  const inertName = `e2evolinert${ts}`; // plain app on node 2 (missing image stays inert)
  const rmName = `e2evolrm${ts}`; // plain app on node 3 (uninstall deletes image)
  const entName = `e2evolent${ts}`; // ENTERPRISE app on node 4 (reboot remount for the encrypted-compose class)
  const syncIdentifier = `${syncName}_${syncName}`;
  const inertIdentifier = `${inertName}_${inertName}`;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();

    // first-run reset first, real data on disk second, pin synced LAST - an
    // index claiming bytes over an empty disk is the phantom state the guard
    // demotes, and the demote/hold would latch the app down mid-suite
    const syncInstallAfter = env.clients[0].getLastEventId();
    await seedSyncthingApp(env, { name: syncName, mode: 'r', index: 0 });
    await waitForReconcileActuated(env.clients[0], syncIdentifier, 'dataCleared', 60000, { afterId: syncInstallAfter });
    await seedSyncScopedData(env, syncName, 0);
    // pin the folder synced so the leader promotes and the app runs steadily
    await setSynced({ ip: subnet.nodeIp(1), folder: appId(syncName) });
    await installPlainApp(env, rebootName, 1, 31201);
    await installPlainApp(env, inertName, 2, 31301);
    await installPlainApp(env, rmName, 3, 31401);

    await pushImage(entName, 'v1');
    const entApp = await buildSeedableEnterpriseApp({
      name: entName,
      compose: [{
        name: entName,
        description: 'test container',
        repotag: `${REGISTRY_REPO_HOST}/${entName}:v1`,
        ports: [31501],
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
    await installOnNodes(env, entApp, [4]);
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('install loop-mounts the volume and creates NO @reboot crontab entry', async function () {
    this.timeout(120000);
    const c0 = env.clients[0].container;
    await waitFor(() => isMountpoint(c0, appDir(syncName)), { timeout: 30000, interval: 2000, label: 'volume mounted after install' });
    expect(await fileExists(c0, volFile(syncName))).to.equal(true);
    expect(await crontabVolumeEntries(c0)).to.equal(0);
    expect(await crontabVolumeEntries(env.clients[1].container)).to.equal(0);
    await waitFor(() => isUp(env.clients[0], syncName), { timeout: 90000, interval: 2000, label: 'r: app running' });
  });

  it('rejects writes to the unmounted app dir (EPERM) and self-heals the mount without a restart', async function () {
    this.timeout(120000);
    const client = env.clients[0];
    const dir = appDir(syncName);

    // stop the container (releases the bind), unmount, then immediately probe a
    // write on the bare dir - all in ONE shell so the monitor's 3s repair cycle
    // cannot remount in between. The immutable mountpoint must refuse the write.
    const r = await execInContainer(client.container,
      `docker stop ${appId(syncName)} >/dev/null 2>&1; umount ${dir} || exit 9; touch ${dir}/leak-probe 2>/dev/null; echo TOUCH_EXIT:$?`);
    expect(r.exitCode, `umount failed: ${r.output}`).to.not.equal(9);
    const touchExit = r.output.match(/TOUCH_EXIT:(\d+)/)?.[1];
    expect(touchExit, `expected the bare-dir write to fail, got: ${r.output}`).to.not.equal('0');

    // FluxOS remounts the volume (reconciler / monitor repair) and restarts the app
    await waitFor(() => isMountpoint(client.container, dir), { timeout: 60000, interval: 2000, label: 'volume remounted (self-heal)' });
    await waitFor(() => isUp(client, syncName), { timeout: 90000, interval: 2000, label: 'app running again after self-heal' });
  });

  it('removes a legacy @reboot mount entry on FluxOS start and leaves the mount intact', async function () {
    this.timeout(180000);
    const client = env.clients[0];
    const c0 = client.container;
    const entry = `@reboot while [ ! -f ${volFile(syncName)} ]; do sleep 5; done && sudo mount -o loop ${volFile(syncName)} ${appDir(syncName)} #${appId(syncName)}`;
    await execInContainer(c0, `(crontab -l 2>/dev/null; echo '${entry}') | crontab -`);
    expect(await crontabVolumeEntries(c0)).to.equal(1);

    await restartFluxos(c0);

    await waitFor(async () => (await crontabVolumeEntries(c0)) === 0, { timeout: 120000, interval: 3000, label: 'legacy crontab entry removed' });
    expect(await isMountpoint(c0, appDir(syncName))).to.equal(true);
    await waitFor(() => isUp(client, syncName), { timeout: 90000, interval: 2000, label: 'app running after FluxOS restart' });
  });

  it('remounts the volume after a machine reboot with an EMPTY crontab (incident regression)', async function () {
    this.timeout(300000);
    let client = env.clients[1];
    const dir = appDir(rebootName);
    await waitFor(() => isUp(client, rebootName), { timeout: 60000, interval: 2000, label: 'running before reboot' });
    expect(await isMountpoint(client.container, dir)).to.equal(true);

    // the incident state: no remount entry exists anywhere
    await execInContainer(client.container, 'crontab -r 2>/dev/null || true');

    env.setBootId(1, `volreboot-${Date.now()}`);
    await env.restartNode(1);
    client = env.clients[1];

    await waitFor(() => isMountpoint(client.container, dir), { timeout: 150000, interval: 3000, label: 'volume remounted after reboot without crontab' });
    await waitFor(() => isUp(client, rebootName), { timeout: 120000, interval: 3000, label: 'app running after reboot' });
    expect(await crontabVolumeEntries(client.container)).to.equal(0);
  });

  it('holds an app inert when its backing image is missing: no start, nothing written to the bare dir', async function () {
    this.timeout(180000);
    const client = env.clients[2];
    const dir = appDir(inertName);
    await waitFor(() => isUp(client, inertName), { timeout: 60000, interval: 2000, label: 'running before image loss' });

    const afterId = client.getLastEventId();
    // Demolish the volume BEFORE stopping the container: the die event triggers
    // an immediate reconcile, so the broken state must fully exist when it
    // fires (a die over a still-healthy volume gets re-mounted and restarted by
    // the self-heal instead of reported unavailable). The lazy unmount detaches
    // the host dir under the running container without emitting any event.
    const r = await execInContainer(client.container,
      `umount -l ${dir} && rm -f ${volFile(inertName)} && docker stop ${appId(inertName)} >/dev/null 2>&1`);
    expect(r.exitCode, `teardown failed: ${r.output}`).to.equal(0);

    // the reconciler must report the unavailable volume and never start
    await waitForReconcileActuated(client, inertIdentifier, 'volumeUnavailable', 90000, { afterId });
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === inertIdentifier && d.action === 'started', 15000);
    expect(await isUp(client, inertName)).to.equal(false);

    // nothing recreated structure on the bare mountpoint (it stays empty)
    const probe = await execInContainer(client.container, `find ${dir} -mindepth 1 2>/dev/null | head -5 | wc -l`);
    expect(probe.stdout.trim()).to.equal('0');
  });

  it('keeps a legacy @reboot entry across FluxOS restart while its volume cannot be mounted', async function () {
    this.timeout(240000);
    // continues on node 2: the previous test deleted the app's backing image,
    // so its volume cannot mount. A legacy entry seeded now must SURVIVE the
    // startup cleanup - it is only superseded once the FluxOS-owned mount
    // demonstrably works, and here it demonstrably cannot.
    const client = env.clients[2];
    const c2 = client.container;
    const entry = `@reboot while [ ! -f ${volFile(inertName)} ]; do sleep 5; done && sudo mount -o loop ${volFile(inertName)} ${appDir(inertName)} #${appId(inertName)}`;
    await execInContainer(c2, `(crontab -l 2>/dev/null; echo '${entry}') | crontab -`);
    expect(await crontabVolumeEntries(c2)).to.equal(1);

    const afterId = client.getLastEventId();
    await restartFluxos(c2);
    // the reconciler reporting the unavailable volume proves startup (and the
    // crontab cleanup pass that precedes reconciliation) has completed
    await waitForReconcileActuated(client, inertIdentifier, 'volumeUnavailable', 120000, { afterId });

    expect(await crontabVolumeEntries(c2)).to.equal(1);
    expect(await isUp(client, inertName)).to.equal(false);
  });

  it('uninstall deletes the discovered backing image with NO crontab entry to parse (orphan regression)', async function () {
    this.timeout(180000);
    const client = env.clients[3];
    expect(await fileExists(client.container, volFile(rmName))).to.equal(true);
    // old code recovered the image path by parsing the crontab entry; make sure
    // there is none, as in the incident
    await execInContainer(client.container, 'crontab -r 2>/dev/null || true');

    const auth = await authenticate(client.url, fluxTeamKey());
    const res = await fetch(`${client.url}/apps/appremove/${rmName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text(); // streamed progress; completion is confirmed via the event
    await waitForAppRemoved(client, rmName, 120000);

    await waitFor(async () => !(await fileExists(client.container, volFile(rmName))), { timeout: 30000, interval: 2000, label: 'backing image deleted' });
    expect(await fileExists(client.container, appDir(rmName))).to.equal(false);
  });

  it('remounts an ENTERPRISE app volume after a reboot with an empty crontab (incident app class)', async function () {
    this.timeout(300000);
    let client = env.clients[4];
    const dir = appDir(entName);
    await waitFor(() => isUp(client, entName), { timeout: 120000, interval: 2000, label: 'enterprise app running' });
    expect(await isMountpoint(client.container, dir)).to.equal(true);

    // the local row must be in the production enterprise shape: compose emptied,
    // components only inside the encrypted blob - the exact shape the blind
    // inventory took for "not installed"
    const installed = await client.getInstalledApps();
    const row = installed.data.find((a) => a.name === entName);
    expect(row, 'enterprise app row present in local DB').to.exist;
    expect(row.compose, 'compose stored empty for enterprise').to.deep.equal([]);
    expect(row.enterprise, 'enterprise blob stored').to.be.a('string').and.not.equal('');
    // a local row stored without height is force-removed by the expiry sweep's
    // missing-height check - the install path must preserve it through the
    // enterprise decrypt+format
    expect(row.height, 'local row must keep spec height').to.be.a('number').greaterThan(0);

    // the incident state: no remount entry exists anywhere
    await execInContainer(client.container, 'crontab -r 2>/dev/null || true');

    env.setBootId(4, `entreboot-${Date.now()}`);
    await env.restartNode(4);
    client = env.clients[4];

    await waitFor(() => isMountpoint(client.container, dir), { timeout: 150000, interval: 3000, label: 'enterprise volume remounted after reboot' });
    await waitFor(() => isUp(client, entName), { timeout: 120000, interval: 3000, label: 'enterprise app running after reboot' });
    expect(await crontabVolumeEntries(client.container)).to.equal(0);
  });
});
