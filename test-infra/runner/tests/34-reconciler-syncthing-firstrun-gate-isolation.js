import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus, restartFluxos } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// One app whose volume can never be mounted must not stop the rest of the node
// working. The syncthing monitor's first-run mount-safety pass sets
// `syncthingAppsFirstRun`, and masterSlaveApps refuses to elect any g: primary
// node-wide until that flag clears. The monitor used to abandon the whole cycle
// the moment ANY app folder was unmounted, and it cleared the flag only after
// reaching the end - so a single app whose backing image is gone (unrepairable,
// so it never resolves) held the flag set forever and every masterSlave app on
// that node stopped electing, silently and permanently.
//
// The blast radius is not limited to syncthing apps: checkAppFolderMounts walks
// every component of every installed app with no containerData filter, so the
// app that jams the gate here is a PLAIN one - exactly the production shape,
// where an unrelated app's missing volume froze two customers' g: apps.
//
// The state is reached the way production reaches it: the volume is demolished
// (image deleted, so the monitor's own repair cannot succeed) and FluxOS is
// restarted, which re-enters the first-run path.

const subnet = getSubnetConfig();

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('one unmountable app does not block g: election node-wide', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const jamName = `e2ejam${ts}`; // plain app on node 0, volume demolished
  const gName = `e2egate${ts}`; // g: app held by nodes 0 and 1
  const jamIdentifier = `${jamName}_${jamName}`;
  const gIdentifier = `${gName}_${gName}`;
  const gFolder = appId(gName);

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();

    // the g: app, on the same node as the jammer plus one peer to fail over to
    await pushImage(gName, 'v1');
    const gApp = await buildSeedableSyncthingApp({ name: gName, mode: 'g' });
    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    await installOnNodes(env, gApp, [0, 1]);
    // real data on disk before the index claims bytes, and only after the sync
    // layer's first-run reset has cleared appdata - the ordering suites 35/61
    // established, without which the phantom-index guard holds the app down
    await Promise.all([0, 1].map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], gIdentifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, gName, i);
    }));
    await Promise.all([0, 1].map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder: gFolder })));

    // the jammer: a plain app sharing node 0
    await pushImage(jamName, 'v1');
    const jamApp = await buildSeedableApp({
      name: jamName,
      compose: [{
        name: jamName,
        description: 'test container',
        repotag: `${REGISTRY_REPO_HOST}/${jamName}:v1`,
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
    await installOnNodes(env, jamApp, [0]);

    // node 0 starts as the elected primary, running
    await electMaster(gName, env.clients[0].ip);
    await waitForReconcilerDesiredChanged(env.clients[0], gIdentifier, 'running', 90000);
    await waitFor(() => isUp(env.clients[0], gName), { timeout: 90000, interval: 2000, label: 'g: app running on node 0' });
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('jams node 0 with an app whose volume can never be mounted, then restarts FluxOS', async function () {
    this.timeout(240000);
    const client = env.clients[0];
    const afterId = client.getLastEventId();

    // Demolish the volume BEFORE stopping the container: a die event over a
    // still-healthy volume gets re-mounted and restarted by the self-heal. The
    // lazy unmount detaches the dir under the running container silently, and
    // deleting the backing image makes the repair permanently impossible -
    // which is what makes the old gate latch rather than merely stall.
    const r = await execInContainer(client.container,
      `umount -l ${appDir(jamName)} && rm -f ${volFile(jamName)} && docker stop ${appId(jamName)} >/dev/null 2>&1`);
    expect(r.exitCode, `jam setup failed: ${r.output}`).to.equal(0);
    await waitForReconcileActuated(client, jamIdentifier, 'volumeUnavailable', 90000, { afterId });

    // re-enter the first-run mount-safety path with the jam in place
    await restartFluxos(client.container);
  });

  it('still elects: the g: app follows the FDM primary away from the jammed node', async function () {
    this.timeout(180000);
    const a = env.clients[0];
    const b = env.clients[1];

    // Node 0 losing the role is the discriminating assertion. A g: container
    // already running is deliberately left alone while no decider has spoken
    // (an unset opinion must not bounce apps on every FluxOS restart), so only
    // an election that actually RUNS can stop it - if the first-run gate is
    // still latched, node 0 keeps running as a stale primary forever.
    await electMaster(gName, b.ip);

    await waitForReconcilerDesiredChanged(a, gIdentifier, 'stopped', 120000);
    await waitFor(async () => !(await isUp(a, gName)), { timeout: 90000, interval: 2000, label: 'stale primary stopped on the jammed node' });

    await waitForReconcileActuated(b, gIdentifier, 'started', 120000);
    await waitFor(() => isUp(b, gName), { timeout: 90000, interval: 2000, label: 'new primary running after failover' });
  });

  it('keeps the jammed app inert and writes nothing to its bare mount point', async function () {
    this.timeout(90000);
    const client = env.clients[0];

    expect(await isUp(client, jamName)).to.equal(false);
    const probe = await execInContainer(client.container, `find ${appDir(jamName)} -mindepth 1 2>/dev/null | head -5 | wc -l`);
    expect(probe.stdout.trim()).to.equal('0');
  });

  it('stops reporting the first-run mount-safety gate once syncthing is initialised', async function () {
    this.timeout(60000);
    // the gate line is what masterSlaveApps prints on every skipped cycle; on a
    // latched node it repeats every 30s forever. Only lines from a quiet window
    // after the failover count.
    const linesFor = (index) => env.nodeDiagnostics().find((n) => n.index === index)?.lines ?? [];
    const startAt = linesFor(0).length;
    await new Promise((resolve) => { setTimeout(resolve, 40000); });
    const fresh = linesFor(0).slice(startAt);
    const gateSkips = fresh.filter((l) => l.includes('syncthing first-run mount-safety not complete')).length;
    expect(gateSkips, 'masterSlaveApps first-run gate skips after syncthing came up').to.equal(0);
  });
});
