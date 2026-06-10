import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, crashAppContainer } from '../framework/container.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A container that crashes (non-zero exit) is restarted by the reconciler. The
// Docker `die` event enqueues the component; the reconciler sees desired=running,
// actual=stopped, and (first crash -> backoff ladder step 0) restarts immediately.

describe('reconciler restarts a crashed container', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let installedOnIndex;
  const appName = `e2ecrash${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: installedOnIndex } = await seedSimpleApp(env, appName));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('restarts after a non-zero exit and records the exit code', async function () {
    this.timeout(120000);
    const client = env.clients[installedOnIndex];

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'app container running before crash' });

    const afterId = client.getLastEventId();

    await crashAppContainer(client.container, appName); // docker kill -> exit 137

    // the reconciler restarts it and reports the exit it restarted from
    const evt = await waitForReconcileActuated(client, identifier, 'started', 90000, { afterId });
    expect(evt.data.exitCode).to.not.equal(0);

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'container running again after crash' });
  });
});
