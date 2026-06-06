import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// On a FluxOS restart the inner dockerd's app containers come back exited.
// appStartupManager enqueues each installed component once the boot gate opens,
// and the reconciler restarts the ones that should run (default always policy).
// (No reconciler:swept{boot} event — boot uses per-component enqueue.)

describe('reconciler restarts app containers on FluxOS boot', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  const appName = `e2eboot${Date.now()}`;
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

  it('brings a stopped-on-boot container back up after the boot gate', async function () {
    this.timeout(180000);
    let client = env.clients[idx];
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 2000, label: 'running before restart' });

    // restart FluxOS: the inner dockerd restarts and the app container comes back
    // exited, with nothing actuated until the boot gate opens.
    await env.restartNode(idx);
    client = env.clients[idx];
    const afterId = client.getLastEventId();

    // the boot reconcile enqueues the component and the reconciler starts it
    await waitForReconcileActuated(client, identifier, 'started', 120000, { afterId });
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 2000, label: 'running again after boot reconcile' });
  });
});
