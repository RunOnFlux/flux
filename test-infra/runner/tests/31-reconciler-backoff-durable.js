import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, crashAppContainer } from '../framework/container.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The crash-recovery backoff escalates along the ladder [0, 30s, 5m, ...] and is
// DURABLE: restartHistory lives in appsRuntimeState (mongo), so a FluxOS restart
// no longer grants a crash-looping container a free immediate restart. The old
// in-memory Map was wiped on every reboot; this guards that regression.
//
// The backoff ladder is intentionally NOT compressed in test config (it is real
// recovery behaviour), so we observe the escalating waitMs from the events
// without sleeping them out, and prove durability by a single 30s step.

async function waitForUp(client, appName, label) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName);
    return status && status.status.startsWith('Up');
  }, { timeout: 60000, interval: 2000, label });
}

describe('reconciler backoff escalates and survives a FluxOS restart', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  const appName = `e2ebackoff${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('escalates the backoff ladder and keeps it across a restart', async function () {
    this.timeout(180000);
    let client = env.clients[idx];
    await waitForUp(client, appName, 'running before first crash');

    // crash #1 -> immediate restart (ladder step 0), restartHistory length 1
    let afterId = client.getLastEventId();
    await crashAppContainer(client.container, appName);
    await waitForReconcileActuated(client, identifier, 'started', 60000, { afterId });
    await waitForUp(client, appName, 'running after crash #1');

    // crash #2 -> first real backoff (~30s); read the waitMs, don't sleep it
    afterId = client.getLastEventId();
    await crashAppContainer(client.container, appName);
    const backoff1 = await waitForReconcileActuated(client, identifier, 'backoff', 60000, { afterId });
    expect(backoff1.data.waitMs).to.be.greaterThan(15000);
    expect(backoff1.data.waitMs).to.be.at.most(30000);

    // its scheduled retry fires -> restart, restartHistory length 2
    await waitForReconcileActuated(client, identifier, 'started', 60000, { afterId });
    await waitForUp(client, appName, 'running after crash #2 backoff retry');

    // crash #3 -> next ladder step (~5m); only observe the escalation
    afterId = client.getLastEventId();
    await crashAppContainer(client.container, appName);
    const backoff2 = await waitForReconcileActuated(client, identifier, 'backoff', 60000, { afterId });
    expect(backoff2.data.waitMs).to.be.greaterThan(backoff1.data.waitMs);
    expect(backoff2.data.waitMs).to.be.greaterThan(120000); // well past the 30s step

    // restart FluxOS mid-backoff. If restartHistory were ephemeral it would reset
    // and the boot reconcile would start the container immediately; because it is
    // durable, the boot reconcile must back off again instead.
    await env.restartNode(idx);
    client = env.clients[idx];
    const bootAfterId = client.getLastEventId();
    const bootBackoff = await waitForReconcileActuated(client, identifier, 'backoff', 120000, { afterId: bootAfterId });
    expect(bootBackoff.data.waitMs).to.be.greaterThan(60000); // elevated -> history survived

    // and the container is still down (not granted a free restart)
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    expect(status && status.status.startsWith('Up')).to.not.equal(true);
  });
});
