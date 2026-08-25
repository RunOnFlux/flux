import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, execInContainer } from '../framework/container.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// MUST-PASS gate. masterSlave (g:) election now WRITES desired state and the
// reconciler actuates: the FDM-elected primary runs, every standby stays stopped,
// the role follows the FDM primary on failover, and an operator-stopped component
// is never resurrected by the election (operatorStopped outranks the controller).

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}
async function waitForUp(client, appName, label) {
  await waitFor(() => isUp(client, appName), { timeout: 45000, interval: 2000, label });
}
async function waitForDown(client, appName, label) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    return status ? !status.status.startsWith('Up') : true;
  }, { timeout: 45000, interval: 2000, label });
}

describe('reconciler enforces masterSlave g: election', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let holders; // node indices that installed the app
  const appName = `e2egw${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    // targeted install on two specific nodes — deterministic g: holders
    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    holders = await installOnNodes(env, app, [0, 1]);
    // This suite exercises the FDM election/failover of a READY g: app, so pin both
    // holders' folders to a genuinely synced state (they promote to sendreceive and
    // become election-eligible). An empty global is correctly no longer treated as
    // synced, so without real data neither holder would ever become ready — that
    // sourceless cold-start path is covered separately by suite 51. A synced index
    // also requires matching data on disk (the promote gate refuses a claimed-bytes
    // index over an empty volume), written after each holder's first-run reset.
    const folder = `flux${appName}_${appName}`;
    await Promise.all(holders.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('runs only the FDM-elected primary; standbys stay stopped', async function () {
    this.timeout(120000);
    const a = env.clients[holders[0]];
    const b = env.clients[holders[1]];

    await electMaster(appName, a.ip);

    await waitForReconcilerDesiredChanged(a, identifier, 'running', 60000);
    await waitForReconcileActuated(a, identifier, 'started', 60000);
    await waitForUp(a, appName, 'elected primary running');

    // a standby holder is told to stay stopped and never starts
    await waitForReconcilerDesiredChanged(b, identifier, 'stopped', 60000);
    expect(await isUp(b, appName)).to.equal(false);
  });

  it('fails over to a standby when the FDM primary changes', async function () {
    this.timeout(120000);
    const a = env.clients[holders[0]];
    const b = env.clients[holders[1]];

    await electMaster(appName, b.ip);

    await waitForReconcileActuated(b, identifier, 'started', 60000);
    await waitForUp(b, appName, 'new primary running after failover');

    await waitForReconcileActuated(a, identifier, 'stopped', 60000);
    await waitForDown(a, appName, 'old primary stopped after failover');
  });

  it('does not resurrect an operator-stopped g: component', async function () {
    this.timeout(90000);
    const b = env.clients[holders[1]]; // currently the elected primary, running

    const auth = await authenticate(b.url, appOwnerKey());
    await b.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    await waitForDown(b, appName, 'operator-stopped primary down');

    // keep b elected; the election must NOT override the operator stop
    await electMaster(appName, b.ip);
    await assertNoEvent(b, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 15000);
    expect(await isUp(b, appName)).to.equal(false);
  });

  it('leaves an app mid-backup alone: the busy guard fires and no start is decided', async function () {
    this.timeout(300000);
    const a = env.clients[holders[0]];

    // stage: a is elected and running (b was operator-stopped above); the
    // backup's stop phase will then take the app down on the ELECTED node -
    // exactly the state where a dead busy-guard would promote mid-backup and
    // demote the folder / chmod against the tar. The guard reads the busy list
    // off globalState at the decision; a boot-time capture stayed empty forever
    // and this test is the wiring's end-to-end proof.
    await electMaster(appName, a.ip);
    await waitForReconcileActuated(a, identifier, 'started', 60000);
    await waitForUp(a, appName, 'primary running before backup');

    // bulk appdata so the tar phase is a real window (same shape as suite 44)
    const bulk = await execInContainer(
      a.container,
      `sh -c "d=\\$(ls -d /mnt/appdata/flux-apps/flux${appName}* | head -1) && dd if=/dev/urandom of=\\$d/appdata/bulk.bin bs=1M count=200 && ls -l \\$d/appdata/bulk.bin"`,
    );
    if (bulk.exitCode !== 0) {
      throw new Error(`appdata bulk-up failed (backup window would be too small): ${bulk.stderr || bulk.output}`);
    }

    // two election cycles of settle so the staging start above cannot land a
    // late 'started' tick after the baselines are read
    await new Promise((resolve) => { setTimeout(resolve, 7000); });
    const skippedBefore = await a.getDecisionCount('masterSlave:decision', appName, 'skippedBusy');
    const startedBefore = await a.getDecisionCount('masterSlave:decision', identifier, 'started');

    const auth = await authenticate(a.url, appOwnerKey());
    // the unresolved promise IS the busy window: the app is claimed in
    // backupInProgress for the whole run
    const backupDone = a.appendBackupTask(appName, [appName], auth.zelidauth);

    // the backup's stop phase takes the app down - the hold is live and the
    // elected-primary-not-running state the election would act on is real
    await waitForDown(a, appName, 'backup stopped the app (hold live)');

    // an election pass RAN and considered the busy app - the counter is the
    // proof, so the no-start assertion below cannot be vacuously green on a
    // pass that never happened
    await waitFor(
      async () => (await a.getDecisionCount('masterSlave:decision', appName, 'skippedBusy')) > skippedBefore,
      { timeout: 60000, interval: 1000, label: 'election pass skipped the busy app' },
    );

    // and no start was decided while the hold was live
    expect(await a.getDecisionCount('masterSlave:decision', identifier, 'started'),
      'the election must not decide a start during the backup hold').to.equal(startedBefore);
    await assertNoEvent(a, 'masterSlave:started', (d) => d.identifier === identifier, 3000);

    const body = await backupDone;
    expect(body).to.not.match(/Unauthorized/i);
    // What the app does AFTER the hold is released is not this test's property
    // and not this branch's behaviour: the backup's own stop earns a rung on the
    // restart ladder here, so the elected primary is paced back up over minutes.
    // The convergence assertion lives with the change that makes a deliberate
    // stop earn nothing.
  });
});
