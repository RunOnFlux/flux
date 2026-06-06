import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { getAppContainerStatus, killAppContainer } from '../framework/container.js';
import {
  waitFor, waitForReconcileActuated, waitForAppRemoved,
} from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A vanished container (no Docker event fires for absence) is recreated by the
// reconciler when Docker is reachable. If recreation itself fails (e.g. a broken/
// tampered image), the reconciler records the tampering signal and removes the
// app locally — the same behaviour the old containerHealthMonitor had.

async function waitForUp(client, appName, label) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName);
    return status && status.status.startsWith('Up');
  }, { timeout: 60000, interval: 2000, label });
}

describe('reconciler recreates a missing container', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  const appName = `e2emissing${Date.now()}`;
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

  it('recreates a container that was removed out from under it', async function () {
    this.timeout(150000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before removal');

    const afterId = client.getLastEventId();
    await killAppContainer(client.container, appName); // docker rm -f -> gone

    // docker is reachable, so exists:false is a genuine miss -> recreate
    await waitForReconcileActuated(client, identifier, 'recreated', 90000, { afterId });
    await waitForUp(client, appName, 'recreated and running again');
  });

  it('uninstalls locally when recreation fails (broken image -> tampering)', async function () {
    this.timeout(150000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before forced recreate failure');

    // tamper: point the installed image at an unpullable tag so the recreate's
    // installApplicationHard throws, then remove the container to trigger recreate.
    await dbClient(idx + 1).breakLocalAppImage(appName);

    const afterId = client.getLastEventId();
    await killAppContainer(client.container, appName);

    // recreate fails -> the reconciler reports it and removes the app locally
    await waitForReconcileActuated(client, identifier, 'recreateFailed', 90000, { afterId });
    await waitForAppRemoved(client, appName, 60000, { afterId });
  });
});
