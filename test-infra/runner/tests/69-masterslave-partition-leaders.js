import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import {
  bootAndPeer, placeGAppInOrder, electionIndexOf,
} from '../framework/reconciler-suite.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A g: app whose holders end up on opposite sides of a partition, with the syncthing
// seed at a non-zero election index (see 68 for why that arrangement needs building).
//
// WHAT THIS SUITE DOES NOT CLAIM. Mutual exclusion DURING a partition is a KNOWN OPEN
// LIMITATION, written into the code it exercises: the seed election is gossip plus
// lowest-IP and "guarantees neither a single master under partition (split-brain) nor
// that the seed holds the newest data" (syncthingFolderStateMachine.js, the residual-
// limitation note above the leader branch), and the peer probe that guards the start
// "fails open by design ... so a network fault cannot strand an app forever"
// (advancedWorkflows.js, checkPeersRunning). A partitioned minority therefore CAN start
// its own writer, by construction. Asserting otherwise would be asserting a fix that
// does not exist, so this suite does not - and a green run here is NOT evidence of
// mutual exclusion under partition. Closing that needs the consensus-grounded election
// and quorum lease those notes call out as a separate redesign.
//
// WHAT IT DOES PIN is the invariant a customer actually experiences: a partition must
// be SURVIVABLE. The fleet converges back to exactly one primary once the network
// heals, rather than staying permanently doubled or collapsing to none.

const subnet = getSubnetConfig();

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a partitioned g: app converges back to one primary on heal', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2epart${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const holders = [0, 1, 2];
  const seedIndex = 0; // lowest IP among the holders = the syncthing seed
  const placementOrder = [1, 0, 2]; // seed carries the middle runningSince
  // The seed's side and the standbys' side. Non-holders pad each group so both stay
  // above the peer floor and neither degrades - the partition must be a network event,
  // not a peer-count event.
  const groupA = [0, 3, 4];
  const groupB = [1, 2, 5];

  const countUp = async () => (await Promise.all(
    holders.map((i) => isUp(env.clients[i], appName)),
  )).filter(Boolean).length;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 6,
      tickerAutostart: false,
      configOverrides: {
        // partitionGroups only returns once the cross-group sockets are gone - until
        // then traffic is queued in TCP, not lost. That wait IS peer liveness, 45s on
        // production defaults; compressed here like every other cadence in this suite.
        // wsMaxMissedPongs stays at 3: three consecutive misses is a far safer signal
        // on a loaded box than one slow round-trip.
        peers: { wsPingIntervalMs: 3000 },
        fluxapps: {
          minOutgoing: 2,
          minIncoming: 1, // each side of the partition is three nodes
          appSyncDegradedThreshold: 0, // never degrade on peer count - this is a network split
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 2, minInbound: 1 });
    await resetFdm(); // no FDM primary: the self-selection path throughout
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    await placeGAppInOrder(env, app, {
      placementOrder, folder, identifier: `${appName}_${appName}`,
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.healPartition(groupA, groupB).catch(() => {});
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('settles on the seed before the split, with the seed off index 0', async function () {
    this.timeout(300000);
    const position = await electionIndexOf(env, appName, seedIndex);
    expect(position, 'fixture: seed must be off index 0 for the split to be interesting').to.be.greaterThan(0);

    await waitFor(() => isUp(env.clients[seedIndex], appName), {
      timeout: 180000, interval: 3000, label: 'seed becomes the pre-partition primary',
    });
    expect(await countUp(), 'more than one holder running before the partition').to.equal(1);
  });

  it('converges back to exactly one primary after the partition heals', async function () {
    this.timeout(600000);
    // The standbys are synced by now - pin that, so the minority side is genuinely
    // able to elect one of its own. A minority that could never start would make the
    // heal trivially clean and the assertion worthless.
    await Promise.all(holders.filter((i) => i !== seedIndex).map(
      (i) => setSynced({ ip: subnet.nodeIp(i + 1), folder }),
    ));

    await env.partitionGroups(groupA, groupB);

    // Let both sides act on their own view. Deliberately NOT asserted: how many
    // primaries exist right now. The probe fails open, so the minority may well start
    // a second writer, and that is the documented contract today (see the header).
    await sleepUnlessInfraDead(90000);

    await env.healPartition(groupA, groupB);

    // startDiscovery authenticates, and the login phrase is refused below the
    // outgoing-peer floor ("Minimum required 2 found 1"). Dropping the iptables
    // rules does not re-dial the dead cross-group sockets, so for a few seconds
    // after the heal a node legitimately sits at one peer. Wait for the fleet to
    // be able to answer before asking it to.
    await waitFor(async () => {
      const counts = await Promise.all(env.clients.map(async (c) => {
        const outgoing = await c.getPeers().catch(() => null);
        return outgoing?.data?.length ?? 0;
      }));
      return counts.every((n) => n >= 2);
    }, { timeout: 120000, interval: 3000, label: 'every node back above the outgoing-peer floor after heal' });

    await env.startDiscovery();

    // The real invariant: once the fleet can see itself again it must settle on ONE
    // primary. Not zero (every instance standing down is an outage), not two (a
    // permanent split-brain writing the same syncthing-shared volume).
    await waitFor(async () => (await countUp()) === 1, {
      timeout: 300000, interval: 5000, label: 'fleet reconverges on exactly one primary',
    });

    // and it HOLDS - a count that passes through 1 on its way somewhere else is not
    // convergence.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(), 'primary count moved after reconverging').to.equal(1);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  });
});
