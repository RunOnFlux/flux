import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// MUST-PASS gate. A g: app must survive being stopped through the API.
//
// `appstop` writes a durable operatorStopped lock into the node's local DB, and
// the election loop honours it by skipping the component entirely. That much is
// correct - a deliberate stop should not be undone by a scheduler. What was not
// correct is that the node could never get back afterwards:
//
//   - the election loop remembers the last primary it saw on FDM. When that is
//     THIS node, the node is disqualified from the no-history start (which needs
//     no remembered primary) AND from the previous-primary branch (which needs
//     the remembered primary to be a different node). The last primary was
//     therefore permanently unelectable.
//   - with every instance in that state - which is what happens when each one is
//     stopped in turn - the app could never come back at all, and only a FluxOS
//     restart cleared the in-memory map.
//
// Three production incidents in one morning came through this path: an unpaired
// appstop left the lock set, and for two of them both instances had been stopped,
// so the app stayed down for 12 and 25 hours respectively. Recovering them needed
// a hand-run appstart on each node and, in one case, a FluxOS restart.
//
// The invariant asserted here is the one that matters to the customer: after the
// instances are started again the app returns, and exactly one of them runs -
// never both, because both writing the same syncthing-shared volume corrupts it.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('masterSlave recovery after an operator stop', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let holders;
  const appName = `e2eopstop${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  const runningFlags = async () => Promise.all(holders.map((i) => isUp(env.clients[i], appName)));
  const runningCount = async () => (await runningFlags()).filter(Boolean).length;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    holders = await installOnNodes(env, app, [0, 1]);

    // both holders need a genuinely synced folder to be election-eligible: an
    // empty global is not treated as synced, so without this neither would ever
    // be a candidate and the suite would pass for the wrong reason.
    const folder = `flux${appName}_${appName}`;
    await Promise.all(holders.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));

    // settle the initial election so the tests start from a known primary
    await waitFor(async () => await runningCount() === 1, {
      timeout: 120000, interval: 2000, label: 'initial election settles on one holder',
    });
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('keeps an operator-stopped instance down instead of re-electing it', async function () {
    this.timeout(180000);
    const flags = await runningFlags();
    const primary = holders[flags.indexOf(true)];
    const client = env.clients[primary];

    const auth = await authenticate(client.url, appOwnerKey());
    const stopRes = await client.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    expect(stopRes.status).to.equal('success');

    await waitFor(async () => !(await isUp(client, appName)), {
      timeout: 60000, interval: 2000, label: 'operator-stopped instance goes down',
    });

    // the lock must hold: the election loop sees this component every 30s and
    // must keep skipping it rather than treating a stopped g: app as work to do
    await new Promise((resolve) => { setTimeout(resolve, 45000); });
    expect(await isUp(client, appName), 'election restarted an operator-stopped instance').to.equal(false);
  });

  it('brings the app back when the stopped instances are started again', async function () {
    this.timeout(300000);

    // Stop whatever else is still up, so every instance carries the lock - the
    // shape both multi-hour production outages were in.
    for (const i of holders) {
      const client = env.clients[i];
      // eslint-disable-next-line no-await-in-loop
      if (await isUp(client, appName)) {
        // eslint-disable-next-line no-await-in-loop
        const auth = await authenticate(client.url, appOwnerKey());
        // eslint-disable-next-line no-await-in-loop
        await client.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
      }
    }
    await waitFor(async () => await runningCount() === 0, {
      timeout: 90000, interval: 2000, label: 'both instances stopped',
    });

    // Clear the locks the way an operator would. appstart on a g: component whose
    // container is not running deliberately does not start docker itself - it
    // releases the lock and leaves the start to the election, which is exactly
    // why the election has to be able to elect a node that was the last primary.
    for (const i of holders) {
      const client = env.clients[i];
      // eslint-disable-next-line no-await-in-loop
      const auth = await authenticate(client.url, appOwnerKey());
      // eslint-disable-next-line no-await-in-loop
      await client.getAuthed(`/apps/appstart/${appName}`, auth.zelidauth);
    }

    // Without the stale-record eviction this never recovers: every holder is
    // disqualified by remembering itself, so the count stays at 0 forever.
    await waitFor(async () => await runningCount() === 1, {
      timeout: 180000, interval: 2000, label: 'app returns on exactly one holder',
    });

    // and it must be one, not both - two writers on the shared volume is the
    // failure this whole path exists to prevent
    expect(await runningCount(), 'both holders running - split brain after recovery').to.equal(1);
  });
});
