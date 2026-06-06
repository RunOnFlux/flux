import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { getAppContainerStatus, restartDockerd } from '../framework/container.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitFor, waitForReconcileActuated,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Must-pass fleet gate. A dockerd restart underneath a running FluxOS leaves the
// app containers exited with no die event reaching the watcher. When the docker
// event stream reconnects, containerCrashRecovery sweeps every component
// (enqueueAll('reconnect')) and the reconciler restarts the orphans. This is the
// "container exited for 1h30m until the hourly monitor" regression.

async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

async function seedAndWaitForInstall(env, appName) {
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    compose: [{
      name: appName,
      description: 'test container',
      repotag: `198.18.0.5:5000/${appName}:v1`,
      ports: [31111],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    }],
  });

  for (let i = 1; i <= env.nodeCount; i++) {
    const dc = dbClient(i);
    await dc.seedGlobalAppSpec(app.spec);
    await dc.seedPermanentMessage(app.permanentMessage);
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }

  const installed = await Promise.any(
    env.clients.map(async (c, i) => {
      await waitForAppInstalled(c, appName, 120000);
      return i;
    }),
  );
  return installed;
}

describe('reconciler recovers orphaned containers after a dockerd restart', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let installedOnIndex;
  const appName = `e2edockerd${Date.now()}`;
  const identifier = `${appName}_${appName}`; // bare component id the reconciler uses

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    installedOnIndex = await seedAndWaitForInstall(env, appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('restarts the orphaned container via the reconnect sweep', async function () {
    this.timeout(180000);
    const client = env.clients[installedOnIndex];

    // precondition: the app container is running before we bounce dockerd
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'app container running before dockerd restart' });

    // ignore the install-time reconcile events; only look at what the restart triggers
    const afterId = client.getLastEventId();

    await restartDockerd(client.container);

    // The orphaned (exited) container must be brought back by the reconciler. The
    // recovery can come from either the reconnect sweep or the deferred retry that
    // fires once docker is reachable again — both are valid; what matters is that
    // the container is restarted (never recreated/uninstalled, which the
    // docker-unreachable defer guards against).
    await waitForReconcileActuated(client, identifier, 'started', 120000, { afterId });

    // and Docker confirms it is actually Up again
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'orphaned container running after dockerd restart' });
  });
});
