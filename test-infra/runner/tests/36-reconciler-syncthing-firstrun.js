import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setSyncing, setSynced, resetSyncState,
} from '../framework/syncthing-control.js';
import {
  waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An r: (receive-only sync) app must NOT start until its data is synced — starting
// on un-synced data would propagate an inconsistent state to peers. The syncthing
// readiness decider waits while the folder is incomplete and, once it reaches
// 100%, hands desired=running to the reconciler which starts the container.
//
// The node is forced non-leader (a remote running peer is seeded) so it takes the
// sync-gated path rather than starting immediately as the elected first-runner.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('reconciler waits for syncthing r: sync before first start', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx; let folder; let identifier;
  const appName = `e2esync${Date.now()}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    ({ index: idx, folder, identifier } = await seedSyncthingApp(env, {
      name: appName, mode: 'r', forceNonLeader: true,
    }));
    // start un-synced: actively syncing, only partway done
    await setSyncing({ folder, percent: 40 });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('keeps the container stopped while the folder is unsynced', async function () {
    this.timeout(60000);
    const client = env.clients[idx];
    // over a window spanning several decider cycles, it must never start
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 18000);
    expect(await isUp(client, appName)).to.equal(false);
  });

  it('starts the container once the folder reaches 100%', async function () {
    this.timeout(90000);
    const client = env.clients[idx];

    await setSynced({ folder }); // drive to fully synced

    await waitForReconcilerDesiredChanged(client, identifier, 'running', 60000);
    await waitForReconcileActuated(client, identifier, 'started', 60000);
    await waitFor(() => isUp(client, appName), { timeout: 45000, interval: 2000, label: 'r: app running after sync completed' });
  });
});
