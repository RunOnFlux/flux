import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { getAppContainerStatus } from '../framework/container.js';
import { waitFor, waitForReconcileActuated, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An operator appstop is durable: operatorStopped is persisted in appsRuntimeState
// and is the highest-priority desired-state input, so the reconciler must never
// auto-restart the component — not on a reconcile sweep, not across a FluxOS
// restart. appstart clears the lock and the reconciler keeps it running again.

async function waitForUp(client, appName, label) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName);
    return status && status.status.startsWith('Up');
  }, { timeout: 60000, interval: 2000, label });
}

async function waitForDown(client, appName, label) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    return status && !status.status.startsWith('Up');
  }, { timeout: 60000, interval: 2000, label });
}

describe('reconciler honours a durable operator stop', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  const appName = `e2eopstop${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('stays stopped across a sweep and a restart, then resumes on appstart', async function () {
    this.timeout(180000);
    let client = env.clients[idx];
    await waitForUp(client, appName, 'running before operator stop');

    // operator stop (authed as the app owner)
    const auth = await authenticate(client.url, appOwnerKey());
    const stopRes = await client.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    expect(stopRes.status).to.equal('success');
    await waitForDown(client, appName, 'stopped after appstop');

    // the die event from the stop triggers a reconcile; operatorStopped must win,
    // so it is never restarted.
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 8000);

    // durable across a FluxOS restart: the boot reconcile re-enqueues every
    // component, but operatorStopped (mongo) keeps this one stopped.
    await env.restartNode(idx);
    client = env.clients[idx];
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 10000);
    const afterRestart = await getAppContainerStatus(client.container, appName, { all: true });
    expect(afterRestart && afterRestart.status.startsWith('Up')).to.not.equal(true);

    // appstart clears the operatorStopped lock; the container comes back Up
    // (ground truth) and the reconciler keeps it running thereafter.
    const auth2 = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/appstart/${appName}`, auth2.zelidauth);
    await waitForUp(client, appName, 'running again after appstart');
  });
});
