import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { clearMaster, electMaster, resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForReconcileActuated, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// MUST-PASS gate. Suite 35 covers g: election while FDM names a primary. Every
// branch that runs when FDM names NOBODY was untested - `clearMaster` existed in
// the framework and no suite had ever called it - which is the branch family the
// production incident lived in: an app whose FDM row had gone, on nodes that then
// had to work out between themselves who runs it.
//
// Three invariants, in the order a real app meets them:
//   1. bootstrap - no row has ever existed, someone must still start
//   2. no split-brain - the row vanishing under a live primary must not start a second
//   3. promotion - the primary genuinely gone, with no row, must promote a standby
//
// (2) is the one that matters most: FDM going quiet is indistinguishable from FDM
// being down, and "start it here too" is the answer that corrupts the save.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

async function waitForUp(client, appName, label, timeout = 90000) {
  await waitFor(() => isUp(client, appName), { timeout, interval: 2000, label });
}

async function waitForDown(client, appName, label, timeout = 60000) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    return status ? !status.status.startsWith('Up') : true;
  }, { timeout, interval: 2000, label });
}

describe('masterSlave election when FDM names no primary', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let holders;
  const appName = `e2enofdm${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    holders = await installOnNodes(env, app, [0, 1]);

    // both holders need a genuinely synced folder to be election-eligible (same
    // requirement as suite 35 - an empty global is not treated as synced)
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

  it('starts exactly one instance when FDM has never named a primary', async function () {
    this.timeout(180000);
    const clients = holders.map((i) => env.clients[i]);
    const runningCount = async () => (await Promise.all(clients.map((c) => isUp(c, appName)))).filter(Boolean).length;

    // FDM is empty from resetFdm, so the holders settle this between themselves.
    // Which one wins is not ours to predict: the election ranks candidates by their
    // position in the app's location list, not by harness node order. The invariant
    // is the count - one of them takes it, and the other holds off rather than
    // racing it onto the same shared volume.
    await waitFor(async () => await runningCount() === 1, {
      timeout: 90000, interval: 2000, label: 'exactly one holder elected with no FDM row',
    });
    expect(await runningCount(), 'both holders running - split brain on cold start').to.equal(1);
  });

  it('does not start a second instance when the FDM row disappears', async function () {
    this.timeout(180000);
    const [a, b] = holders.map((i) => env.clients[i]);

    // hand FDM a primary, let it settle, then take the row away entirely - the
    // shape of an FDM outage, or of a row ageing out while the app is healthy
    await electMaster(appName, a.ip);
    await waitForUp(a, appName, 'primary running before the row is cleared');

    await clearMaster(appName);

    // the standby must stay put: no row is not permission to start
    await assertNoEvent(b, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 30000);
    expect(await isUp(b, appName), 'standby started while the primary was still running').to.equal(false);
    expect(await isUp(a, appName), 'primary stopped itself when the FDM row vanished').to.equal(true);
  });

  it('promotes a standby when the primary is gone and FDM still has no row', async function () {
    this.timeout(240000);
    const [a, b] = holders.map((i) => env.clients[i]);

    // operator-stop the primary so it stays down (the reconciler will not
    // resurrect it, and the election correctly ignores an operator-stopped
    // component) - the standby is now the only candidate, with no FDM row to
    // tell it so. It has to reach that conclusion by probing the old primary.
    const auth = await authenticate(a.url, appOwnerKey());
    await a.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    await waitForDown(a, appName, 'primary stopped');

    await waitForUp(b, appName, 'standby promoted with no FDM row', 180000);
  });
});
