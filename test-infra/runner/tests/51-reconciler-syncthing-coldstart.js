import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setSyncState, setNoPeerData, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// COLD START: a fresh r: app placed on several nodes AT ONCE, with NO node holding
// the data yet and NO connected peer that holds it. This is the one shape the
// forceNonLeader suites (36/37/47/...) deliberately do NOT cover: they pre-seed a
// real running source on a peer, so the subject always has someone to defer to.
//
// Here nobody is a source. The leader election must still pick EXACTLY ONE node to
// seed (go sendreceive + start) so the app comes up. The hazard this gate guards:
// every node broadcasts a placement runningSince the moment it is assigned the app
// (placement, not liveness), and isDesignatedLeader defers to ANY peer carrying
// runningSince - so if no node is genuinely serving the data, every node can defer
// to every other node's placement and NOBODY seeds (the app deadlocks down forever).
// The opposite failure - more than one node seeding - is split-brain. The contract
// is: exactly one seed.
//
// (Follower convergence once a seed exists - a receive-only node starting when its
// folder reaches 100% - is already covered by suite 36; this gate is only about the
// election picking one seed from a cold, sourceless start.)

const subnet = getSubnetConfig();

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

async function countUp(env, indices, appName) {
  const ups = await Promise.all(indices.map((i) => isUp(env.clients[i], appName)));
  return ups.filter(Boolean).length;
}

describe('reconciler r: cold start - fresh multi-node placement, no seeded source', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ecold${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const holders = [0, 1, 2];
  let app;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    await pushImage(appName, 'v1');
    app = await buildSeedableSyncthingApp({ name: appName, mode: 'r' });

    // TRUE cold start, pinned BEFORE install so the very first election evaluation
    // sees it (not the stub's default phantom-synced peer): every holder has an
    // EMPTY global of its own and NO connected peer holding the data.
    await Promise.all(holders.map((i) => Promise.all([
      setSyncState({
        ip: subnet.nodeIp(i + 1), folder, state: 'idle', globalBytes: 0, inSyncBytes: 0,
      }),
      setNoPeerData({ ip: subnet.nodeIp(i + 1), folder }),
    ])));

    // place the app on every holder AT ONCE (installOnNodes installs in parallel) so
    // they all broadcast placement before any confirms leadership - the standoff shape
    await installOnNodes(env, app, holders);
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('elects exactly one seed (no cold-start deadlock, no split-brain)', async function () {
    this.timeout(150000);
    // Well past the (compressed) leader-confirm window. With no source the election
    // must seed someone; a deadlock leaves this at 0 and times out here.
    await waitFor(
      async () => (await countUp(env, holders, appName)) >= 1,
      { timeout: 90000, interval: 3000, label: 'at least one holder seeds the cold-start app (no deadlock)' },
    );
    // Hold and confirm it settles at EXACTLY one seed - the non-elected holders have
    // an empty global and no connected source, so they must wait (never a second seed,
    // never a self-removal).
    await new Promise((r) => { setTimeout(r, 12000); });
    expect(await countUp(env, holders, appName)).to.equal(1);
  });
});
