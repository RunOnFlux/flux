import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  waitFor, waitForReconcileActuated, assertNoEvent, waitForOperatorIntent,
} from '../framework/wait.js';
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
    // Anchored on the intent, not on the container settling: a pass that read the
    // lock before this landed and acted after it does so while waitForDown is
    // still running, which is in front of an anchor taken below it.
    const intent = await waitForOperatorIntent(client, identifier, true);
    await waitForDown(client, appName, 'stopped after appstop');

    // the die event from the stop triggers a reconcile; operatorStopped must win,
    // so it is never restarted.
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 8000, { afterId: intent.id });

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

  // A kill is the same desired state as a stop carrying a mode, so the mode is
  // the only thing that distinguishes them from outside. Asserting the container
  // stopped would pass just as well against a graceful stop.
  it('kills on appkill, and says the stop was forced', async function () {
    this.timeout(180000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before appkill');

    const auth = await authenticate(client.url, appOwnerKey());
    const beforeId = client.getLastEventId();
    const res = await client.getAuthed(`/apps/appkill/${appName}`, auth.zelidauth);
    expect(res.status, 'the endpoint exists and answers').to.equal('success');

    const stopped = await waitForReconcileActuated(client, identifier, 'stopped', 120000, { afterId: beforeId });
    expect(stopped.data.forced, 'a kill, not a graceful stop').to.equal(true);
    await waitForDown(client, appName, 'stopped after appkill');

    const auth2 = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/appstart/${appName}`, auth2.zelidauth);
    await waitForUp(client, appName, 'running again after appstart');
  });

  // The node operator hosts the container and keeps every ordinary lifecycle
  // control over it. Ending someone else's app abruptly is not theirs to order.
  // Both halves matter: a privilege check that refused everything would pass the
  // first assertion on its own.
  it('refuses the node operator a kill, while still allowing them a stop', async function () {
    this.timeout(180000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before the operator acts');

    const operator = await authenticate(client.url, nodeKey(idx + 1));

    const killed = await client.getAuthed(`/apps/appkill/${appName}`, operator.zelidauth);
    expect(killed.status, 'the node operator cannot order a kill').to.equal('error');
    expect(killed.data.code).to.equal(401);
    const stillUp = await getAppContainerStatus(client.container, appName);
    expect(stillUp && stillUp.status.startsWith('Up'), 'and the container is untouched').to.equal(true);

    const stopped = await client.getAuthed(`/apps/appstop/${appName}`, operator.zelidauth);
    expect(stopped.status, 'but a stop is still theirs to order').to.equal('success');
    await waitForDown(client, appName, 'stopped by the node operator');

    const auth = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/appstart/${appName}`, auth.zelidauth);
    await waitForUp(client, appName, 'running again for the suites that follow');
  });
});
