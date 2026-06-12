import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, restartDockerd, execInContainer } from '../framework/container.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { waitForUp, assertNoEvent, waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// B1 end-to-end: backup holds a lease on the WHOLE app under its bare main
// name. While the lease is held, no reconcile of any component may actuate -
// including the reconnect sweep fired by a dockerd restart mid-backup (the
// exact key-format seam the unit tests cannot see: the producer writes the
// bare name, the consumer derives it from the component identifier). After the
// backup releases, the app must be running again (the backup's own restart
// tail or the next reconcile both satisfy the level-based contract).

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('backup leases the whole app against the reconciler', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eblease${Date.now()}`;
  let app;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    // an r: app on its leader path: it starts immediately and uses syncthing,
    // so the backup flow takes the stop -> tar -> restart shape (the lease
    // window the reconciler must respect)
    app = await seedSyncthingApp(env, { name: appName, mode: 'r', index: 0 });
    await setSynced({ ip: subnet.nodeIp(1), folder: app.folder });
    await waitForUp(env.clients[0], appName, 'app running before backup');
    // bulk up appdata so the tar phase gives a real lease window
    await execInContainer(
      env.clients[0].container,
      `sh -c "dd if=/dev/urandom of=$(ls -d /root/zelflux/ZelApps/flux${appName}* | head -1)/appdata/bulk.bin bs=1M count=200 2>/dev/null || true"`,
    );
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('reconnect sweep mid-backup does not actuate the leased app; app runs again after release', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    const auth = await authenticate(client.url, appOwnerKey());

    const afterId = client.getLastEventId();
    // start the backup but do NOT await: the unresolved promise IS the lease window
    const backupDone = client.appendBackupTask(appName, [appName], auth.zelidauth);

    // fire the reconnect sweep inside the window
    await restartDockerd(client.container);

    // while leased, the reconciler must not start/stop/recreate any component
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === app.identifier && (d.action === 'started' || d.action === 'stopped' || d.action === 'recreated'), 10000);

    const body = await backupDone;
    expect(body).to.not.match(/Unauthorized/i);

    // lease released: the level-based contract converges the app back to running
    await waitFor(async () => isUp(client, appName), { timeout: 120000, interval: 3000, label: 'app running again after backup released the lease' });
  });
});
