import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, restartDockerd, execInContainer } from '../framework/container.js';
import {
  setSynced, resetSyncState, resetFolderWrites, getPauseWrites,
} from '../framework/syncthing-control.js';
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
    // (FLUX_APPS_FOLDER relocates the apps dir in the harness image)
    const bulk = await execInContainer(
      env.clients[0].container,
      `sh -c "d=\\$(ls -d /mnt/appdata/flux-apps/flux${appName}* | head -1) && dd if=/dev/urandom of=\\$d/appdata/bulk.bin bs=1M count=200 && ls -l \\$d/appdata/bulk.bin"`,
    );
    if (bulk.exitCode !== 0) {
      throw new Error(`appdata bulk-up failed (lease window would be too small): ${bulk.stderr || bulk.output}`);
    }
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

  it('a monitor pass during the backup does not un-pause the folder it is holding', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    const auth = await authenticate(client.url, appOwnerKey());
    // node numbers are 1-based in subnet-config (clients[0] is nodeIp(1)) - the
    // suite's own setSynced above uses the same offset. nodeIp(0) is .9, an
    // address nothing occupies, and its write log reads empty forever.
    const nodeIp = subnet.nodeIp(1);

    // the stub's write log is cumulative and the test above backed up this same
    // app on this same node, leaving a paused:true/paused:false pair in it. Read
    // unreset, that pair satisfies the hold-wait below before this test's backup
    // has taken any hold (making it vacuous) and then fails the assertion with
    // the PREVIOUS backup's legitimate resume. Suites 87 and 88 reset for the
    // same reason - the window has to be this test's own.
    await resetFolderWrites();

    // the unresolved promise is the lease window; the backup pauses the folder
    // inside it, and the app is held in backupInProgress for the whole run
    const backupDone = client.appendBackupTask(appName, [appName], auth.zelidauth);

    // the backup takes its hold - proves the window is real before we assert on it
    await waitFor(async () => (await getPauseWrites(nodeIp)).some((w) => w.id === app.folder && w.paused === true), {
      timeout: 120000, interval: 1000, label: 'backup paused the folder',
    });

    // taken AFTER the hold is observed, so the pass awaited below is one that
    // completed inside the window. Taken before the backup started, the wait
    // would be satisfied by a pass that finished before the folder was ever
    // paused - which proves a pass ran, not that one ran while it was held.
    const afterId = client.getLastEventId();

    // a real monitor pass runs inside the window (the event proves it ran, so the
    // assertion below is not vacuously green on a pass that never happened), and
    // its write set must not carry the held folder - un-pausing it mid-backup is
    // the propagated-deletion incident this whole change exists to prevent
    const pass = await client.waitForEvent('syncthing:passComplete', () => true, 120000, { afterId });
    expect(pass.data.wrote, 'the monitor pass must not write the folder a backup is holding')
      .to.not.include(app.folder);

    // and nothing un-paused it: the only pause writes for this folder in the
    // window are the backup's own, and no paused:false lands before the backup
    // itself resumes on release
    const pausesDuringHold = (await getPauseWrites(nodeIp)).filter((w) => w.id === app.folder);
    expect(pausesDuringHold.every((w) => w.paused === true), 'no un-pause of the held folder before release').to.equal(true);

    const body = await backupDone;
    expect(body).to.not.match(/Unauthorized/i);
    await waitFor(async () => isUp(client, appName), { timeout: 120000, interval: 3000, label: 'app running again after the hold released' });
  });
});
