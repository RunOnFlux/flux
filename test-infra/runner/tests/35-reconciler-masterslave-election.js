import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import {
  waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedAndInstallMany } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

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
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    holders = await seedAndInstallMany(env, app, 2);
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
    const afterId = b.getLastEventId();
    await electMaster(appName, b.ip);
    await assertNoEvent(b, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 15000);
    expect(await isUp(b, appName)).to.equal(false);
  });
});
