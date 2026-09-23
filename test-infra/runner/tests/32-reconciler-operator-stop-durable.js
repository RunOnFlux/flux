import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  waitFor, waitForReconcileActuated, assertNoEvent, waitForOperatorIntent, waitForBootSettled,
} from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
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

const subnet = getSubnetConfig();

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
    // THE BOOT RECONCILE IS THE SUBJECT, so the window has to contain it. It runs
    // behind dbReady, which waits for this node to re-peer and finish its app-state
    // sync - so "nothing started it" is also true of a node that has not begun
    // reconciling, and a fixed window that closes first asserts nothing at all.
    await waitForBootSettled(client);
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 10000);
    const afterRestart = await getAppContainerStatus(client.container, appName, { all: true });
    expect(afterRestart && afterRestart.status.startsWith('Up')).to.not.equal(true);

    // appstart clears the operatorStopped lock; the container comes back Up
    // (ground truth) and the reconciler keeps it running thereafter.
    const auth2 = await authenticate(client.url, appOwnerKey());
    // Answered, not fired and forgotten: the route sits behind requireBootSettled,
    // and a 503 discarded here surfaces a minute later as a container that never
    // started - which reads as the reconciler's fault rather than this call's.
    const startRes = await client.getAuthed(`/apps/appstart/${appName}`, auth2.zelidauth);
    expect(startRes.status, `appstart refused: ${JSON.stringify(startRes.data)}`).to.equal('success');
    await waitForUp(client, appName, 'running again after appstart');
  });

  // A stop is a run-state change, and the node's claim on the app is not. The
  // node still holds the app: it keeps its appsLocations row on its peers, and
  // the network must not place a replacement somewhere else while an owner has
  // their own app deliberately stopped.
  it('keeps its claim on peers while the app is stopped', async function () {
    this.timeout(240000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before operator stop');

    const auth = await authenticate(client.url, appOwnerKey());
    const stopRes = await client.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    expect(stopRes.status).to.equal('success');
    await waitForOperatorIntent(client, identifier, true);
    await waitForDown(client, appName, 'stopped after appstop');

    // A peer, not the stopped node itself: its own row proves nothing about what
    // the network believes, and it is the network's view the spawner counts.
    const peerIdx = (idx + 1) % env.clients.length;
    const peerDb = dbClient(peerIdx + 1);
    const nodeIp = subnet.nodeIp(idx + 1);

    // Started again whatever happens here. Left in the finally on purpose: when
    // this test fails it fails by timing out on an announcement that never comes,
    // and a restart written after the assertion would not run - leaving the app
    // stopped for every test below, which then fail on `running before ...` and
    // read as three faults instead of one.
    try {
      // Announced at least once more with the container down, rather than merely
      // not expired yet: a row that survives because its TTL is long says nothing.
      const peerClient = env.clients[peerIdx];
      const afterId = peerClient.getLastEventId();
      await peerClient.waitForEvent(
        'network:apprunning',
        (d) => d.ip?.startsWith(nodeIp) && d.apps?.some((a) => a.name === appName),
        200000,
        { afterId },
      );

      const rows = await peerDb.getAppLocations(appName);
      expect(
        rows.some((r) => r.ip.startsWith(nodeIp)),
        'the peer still holds the stopped app as a location on this node',
      ).to.be.true;
    } finally {
      const auth2 = await authenticate(client.url, appOwnerKey());
      await client.getAuthed(`/apps/appstart/${appName}`, auth2.zelidauth);
      await waitForUp(client, appName, 'running again after appstart');
    }
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

  // Hosting an app is not owning it: whether someone else's app runs is the
  // owner's decision, or the team's on their behalf, and the node operator is
  // admitted to none of the four verbs that make it.
  //
  // The owner half is the control, and it is what makes the refusals mean
  // anything - a gate that refused every caller would pass every refusal above on
  // its own. It runs against the same endpoint, on the same node.
  it('refuses the node operator every run-state verb, and still admits the owner', async function () {
    this.timeout(180000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before the operator acts');

    const operator = await authenticate(client.url, nodeKey(idx + 1));

    for (const verb of ['appkill', 'appstop', 'appstart', 'apprestart']) {
      // eslint-disable-next-line no-await-in-loop
      const refused = await client.getAuthed(`/apps/${verb}/${appName}`, operator.zelidauth);
      expect(refused.status, `the node operator cannot order ${verb}`).to.equal('error');
      expect(refused.data.code, `${verb} refused the node operator`).to.equal(401);
    }
    const stillUp = await getAppContainerStatus(client.container, appName);
    expect(stillUp && stillUp.status.startsWith('Up'), 'and the container is untouched').to.equal(true);

    const owner = await authenticate(client.url, appOwnerKey());
    const stopped = await client.getAuthed(`/apps/appstop/${appName}`, owner.zelidauth);
    expect(stopped.status, "the owner's stop lands on the same endpoint").to.equal('success');
    await waitForDown(client, appName, 'stopped by the app owner');

    await client.getAuthed(`/apps/appstart/${appName}`, owner.zelidauth);
    await waitForUp(client, appName, 'running again for the suites that follow');
  });
});
