import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, restartFluxos, execInContainer } from '../framework/container.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { waitForReconcileActuated, waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// R2 regression. A FluxOS *process* restart (`systemctl restart fluxos`) wipes the
// in-memory controllerDesired map while the inner dockerd and the app containers
// keep running. The reconciler must NOT bounce a running g:/r: syncthing app just
// because controllerDesired is unset on the fresh process - it must leave the
// container as-is until the syncthing/masterSlave decider re-derives intent.
//
// Old behaviour: the boot reconcile (and the reconnect sweep) saw an unset
// controllerDesired and stopped every running syncthing app on every FluxOS
// restart. This suite reproduces that exact path using restartFluxos (kills only
// the node process; dockerd + app containers survive) and asserts the container is
// never stopped or restarted - same StartedAt throughout.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

async function startedAt(client, containerName) {
  const r = await execInContainer(
    client.container,
    `docker inspect --format '{{.State.StartedAt}}' ${containerName} 2>/dev/null || echo ""`,
  );
  return r.stdout.trim();
}

describe('reconciler keeps a running syncthing app up across a FluxOS process restart', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx; let folder; let identifier;
  const appName = `e2efxrestart${Date.now()}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    ({ index: idx, folder, identifier } = await seedSyncthingApp(env, {
      name: appName, mode: 'r', forceNonLeader: true,
    }));
    // drive the r: folder to fully synced so the reconciler starts the container
    await setSynced({ folder });
    const client = env.clients[idx];
    await waitForReconcileActuated(client, identifier, 'started', 90000);
    await waitFor(() => isUp(client, appName), { timeout: 45000, interval: 2000, label: 'r: app running before FluxOS restart' });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('does not stop or restart the container when only the FluxOS process restarts', async function () {
    this.timeout(180000);
    const client = env.clients[idx];

    // baseline: container is Up; record when it started
    expect(await isUp(client, appName)).to.equal(true);
    const before = await startedAt(client, folder);
    expect(before, 'container should have a StartedAt before the restart').to.not.equal('');

    // restart ONLY the FluxOS process - dockerd and the app container keep running,
    // controllerDesired is wiped. (restartFluxos returns once /flux/version is back.)
    await restartFluxos(client.container);

    // Through the post-restart boot reconcile + reconnect sweep - the exact window
    // where the old code stopped it - the container must stay Up and must never be
    // restarted (StartedAt unchanged). Poll continuously to catch a transient stop.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await isUp(client, appName), 'container must stay Up across the FluxOS restart').to.equal(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await startedAt(client, folder), 'container must not be restarted (StartedAt unchanged)').to.equal(before);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 3000));
    }
  });
});
