/*
 * A synced app's container that is gone from Docker is rebuilt, whether or not the
 * node is to run it: a standby's is rebuilt and kept stopped, and an r: copy's is
 * rebuilt and then started once its folder is synced.
 *
 * The standby holds a 'stopped' verdict from the election. The r: copy's container is
 * removed while FluxOS is down, so the process that comes back holds no verdict for it,
 * and its sync pass cannot form one about a container Docker does not have.
 *
 * Docker is the harness's own per-node dockerd; the container is removed with
 * `docker rm -f`, the state a node is in after its Docker storage was switched.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import {
  getAppContainerStatus, killAppContainer, crashFluxos, releaseFluxos,
} from '../framework/container.js';
import { resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  waitFor, waitForUp, waitForReconcileActuated, assertNoEvent,
} from '../framework/wait.js';
import {
  bootAndPeer, installOnNodes, seedSyncScopedData, seedSyncthingApp,
} from '../framework/reconciler-suite.js';
import { appId } from '../framework/volume-fixture.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { PRODUCTION_LOCATION_EXPIRIES } from '../framework/coupled-knobs.js';

const subnet = getSubnetConfig();

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!status?.status?.startsWith('Up');
}

describe("a synced app's missing container is rebuilt whatever its run decision", function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();

  before(async function () {
    this.timeout(300000);
    // The r: copy's node restarts, and its app must survive the restart, which the
    // harness does not compress.
    env = await createTestEnv({
      hookCtx: this, nodes: 5, tickerAutostart: false, configOverrides: { fluxapps: PRODUCTION_LOCATION_EXPIRIES },
    });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
  });

  after(async function () {
    this.timeout(60000);
    await resetFdm().catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it("rebuilds a standby's container and keeps it stopped", async function () {
    this.timeout(360000);
    const appName = `e2estandby${stamp}`;
    const identifier = `${appName}_${appName}`;
    const folder = appId(appName);
    const holders = [2, 3];

    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    const installAfters = holders.map((i) => env.clients[i].getLastEventId());
    await installOnNodes(env, app, holders);
    await Promise.all(holders.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));
    await waitFor(async () => (await Promise.all(holders.map((i) => isUp(env.clients[i], appName)))).filter(Boolean).length === 1, {
      timeout: 120000, interval: 2000, label: 'the election settles on one holder',
    });
    const running = await Promise.all(holders.map((i) => isUp(env.clients[i], appName)));
    const primary = env.clients[holders[running.indexOf(true)]];
    const standby = env.clients[holders[running.indexOf(false)]];
    expect(await getAppContainerStatus(standby.container, appName, { all: true }), 'the standby holds a stopped container').to.not.equal(null);

    const beforeRemoval = standby.getLastEventId();
    const removed = await killAppContainer(standby.container, appName);
    expect(removed.exitCode, removed.output).to.equal(0);

    await waitForReconcileActuated(standby, identifier, 'recreated', 120000, { afterId: beforeRemoval });
    const rebuilt = await getAppContainerStatus(standby.container, appName, { all: true });
    expect(rebuilt, 'the rebuilt container is in Docker').to.not.equal(null);
    // The rebuild is the canary: the pass reached the component, and did not start it.
    await assertNoEvent(standby, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 20000, { afterId: beforeRemoval });
    expect(await isUp(standby, appName), 'the standby stays stopped').to.equal(false);
    expect(await isUp(primary, appName), 'the primary runs throughout').to.equal(true);
  });

  it("rebuilds and starts an r: copy's container removed while FluxOS was down", async function () {
    this.timeout(420000);
    const appName = `e2ercopy${stamp}`;
    const { index, folder, identifier } = await seedSyncthingApp(env, {
      name: appName, mode: 'r', forceNonLeader: true, index: 2,
    });
    const client = env.clients[index];
    await setSynced({ folder });
    await waitForUp(client, appName, 'the r: copy runs before its container is removed', { timeout: 120000 });

    const beforeCrash = client.getLastEventId();
    await crashFluxos(client.container, { hold: true });
    const removed = await killAppContainer(client.container, appName);
    expect(removed.exitCode, removed.output).to.equal(0);
    await releaseFluxos(client.container);

    await waitForReconcileActuated(client, identifier, 'recreated', 240000, { afterId: beforeCrash });
    await waitForReconcileActuated(client, identifier, 'started', 120000, { afterId: beforeCrash });
    await waitForUp(client, appName, 'the rebuilt r: copy runs', { timeout: 60000 });
  });
});
