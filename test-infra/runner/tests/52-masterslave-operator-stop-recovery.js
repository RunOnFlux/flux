import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, restartFluxos } from '../framework/container.js';
import { resetFdm, clearMaster, electMaster } from '../framework/fdm-control.js';
import { countPattern } from '../framework/log-reader.js';
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
//
// The third case is the other half of the same lock, and it arrived with the
// retirement of apppause. An owner editing their master used to pause it: a paused
// container stays in `docker ps`, so FDM's health check passed, the election saw a
// running primary, and the role never moved. With pause gone the only lever left is
// `appstop`, and what stopped a peer electing over the gap was controllerDesired -
// in-memory, written only at the moment a node WINS an election and never
// re-asserted while it goes on being the primary. So a FluxOS restart emptied it,
// and whether the owner kept their master turned on whether their node's FluxOS had
// happened to restart since it was elected. That is what this asserts is no longer
// true: the durable lock answers the peer probe now, so the hold survives.

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

  it('keeps the primary with its owner across a FluxOS restart, instead of letting a peer elect over it', async function () {
    this.timeout(300000);

    const flags = await runningFlags();
    const primary = holders[flags.indexOf(true)];
    const standby = holders.find((i) => i !== primary);
    const primaryClient = env.clients[primary];
    const standbyClient = env.clients[standby];

    // Name the primary on FDM and let the standby see it. This is not scene
    // dressing: observing a primary is what clears any staggered start the standby
    // is still carrying from the recovery above and records who the primary was, so
    // that when FDM drops it the standby reaches the previous-primary branch - the
    // one that probes - rather than a scheduled start that never asks anyone.
    await electMaster(appName, subnet.nodeIp(primary + 1));
    await new Promise((resolve) => { setTimeout(resolve, 15000); }); // ~5 election passes at the harness cadence

    // Lines already in the standby's log. The assertion below is that a NEW one
    // appears, not that one ever has.
    const heldLinesBefore = await countPattern(standbyClient.container, 'is held on peer node');

    // The owner stops their master to work on its files. This is the whole of what
    // pause used to be for, and the only lever left now pause is retired.
    const auth = await authenticate(primaryClient.url, appOwnerKey());
    const stopRes = await primaryClient.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    expect(stopRes.status).to.equal('success');
    await waitFor(async () => !(await isUp(primaryClient, appName)), {
      timeout: 60000, interval: 2000, label: 'the owner-stopped master goes down',
    });

    // The process only - dockerd and every other container survive. This is what
    // empties controllerDesired, and it is routine in production: an update, a
    // reboot, a crash.
    await restartFluxos(primaryClient.container);

    // FDM now has no primary to name, so the standby's election opens on its next
    // pass rather than after the health-check grace. The takeover is brought
    // forward so the suite asserts a decision and not a delay.
    await clearMaster(appName);

    // The durable lock is the only thing left that can answer, and it survived the
    // restart. Polled rather than read once: the node has to reconnect to its own
    // database first, and until it can it refuses to answer at all - which is also
    // the safe answer, because a peer reads a refusal as "cannot be ruled out".
    await waitFor(async () => {
      const res = await primaryClient.get('/apps/heldcomponents').catch(() => null);
      return Array.isArray(res?.data) && res.data.includes(`flux${identifier}`);
    }, { timeout: 120000, interval: 2000, label: 'the restarted node still reports the stopped component as held' });

    // And the standby acts on it. Asserted on the standby's own recorded decision
    // rather than on time passing: a standby that is merely waiting out a stagger
    // is indistinguishable from one correctly holding off, if all you check is that
    // nothing started.
    await waitFor(async () => (await countPattern(standbyClient.container, 'is held on peer node')) > heldLinesBefore, {
      timeout: 120000, interval: 3000, label: 'the standby probes, is told the component is held, and refuses',
    });

    expect(await runningCount(), 'a peer elected itself over a master its owner had stopped').to.equal(0);
  });
});
