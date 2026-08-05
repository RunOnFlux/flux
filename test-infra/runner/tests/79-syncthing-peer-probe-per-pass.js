import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetSyncState } from '../framework/syncthing-control.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node asks a peer what it is holding once per monitor pass, not once per
// folder.
//
// Every folder awaiting promotion asks the same question of the same peers on
// the same endpoint, and the reply carries that peer's whole folder list - so
// the question belongs to the peer, not the folder. Asked inside the folder
// loop it was charged per folder, and that loop is sequential behind a 10s
// probe timeout: a node recovering nine folders behind one unreachable holder
// spent ninety seconds on a single answer, outran its own 30s interval, and the
// monitor's re-entrancy guard then dropped whole cycles - promotions, stall
// detection and error draining stopped for every folder on the node.
//
// A dead peer cannot report what it was asked, so the peer here is alive and
// counting. It holds the lowest address, which makes it the elected holder every
// folder defers to, so the subject node stays in the deciding state and keeps
// asking pass after pass. What the arrival times show is the whole point: two
// arrivals milliseconds apart are one pass asking twice.

// The cadence this suite pins its nodes to, and the window derived from it. The
// measurement is a rate, so the interval is not something to inherit and hope
// for: it is set in configOverrides below and both halves come from here.
// Production runs 30s; the harness compresses it, and a threshold written for
// either one while the nodes run the other reads a correct run as a failure.
const MONITOR_INTERVAL_MS = 3000;
// A second question inside ONE pass arrives back-to-back in the same sequential
// loop - milliseconds later. A legitimate one arrives a whole pass later.
const SAME_PASS_MS = MONITOR_INTERVAL_MS / 2;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('syncthing asks a peer once per pass, not once per folder', function () {
  let env;
  let stub;
  dumpLogsOnFailure(() => env);

  // Index 0 is the stub, so it holds the lowest address in the fleet and wins
  // every folder's election. 1 decides; 2 and 3 close the mesh.
  //
  // Dial depth is load-bearing whenever a stub sits in the fleet. A node does not
  // wait to be dialled: it takes an INBOUND by calling /flux/addoutgoingpeer on
  // the nodes BEHIND it in the sorted list, i = 1..minOutgoing
  // (fluxCommunication.js:1310). A stub serves two endpoints and 404s the rest,
  // so every candidate that lands on it is spent.
  //
  // The real node directly after the stub is both the worst affected and the one
  // bootAndPeer probes, so no arrangement of the subject avoids this - only depth
  // does. At 2 it had a single real candidate left and peered or did not
  // depending on whether that one node's dial happened to land; at 3, on a fleet
  // this size, every node offers every other node, so no single dial is decisive.
  const stubIndex = 0;
  const subject = 1;
  const stubIp = getSubnetConfig().nodeIp(stubIndex + 1);
  const appOne = `e2eprobea${Date.now()}`;
  const appTwo = `e2eprobeb${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      stubPeers: [stubIndex],
      tickerAutostart: false,
      configOverrides: {
        // The rate under measurement - pinned, not inherited.
        syncthing: { monitorIntervalMs: MONITOR_INTERVAL_MS },
        // A fleet this small cannot reach the production floors - each node holds
        // three peers at most, one of which never dials.
        fluxapps: { minOutgoing: 3, minIncoming: 1, appSyncDegradedThreshold: 0 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await resetSyncState();

    stub = env.stubPeerClients.get(stubIndex);
    await stub.clear();
    // Answering at all is what keeps it elected: a holder that answers is not
    // gone, so the subject defers to it and never leaves the deciding state.
    await stub.setPromotedFolders({ ready: true, folders: [] });

    // Two r: apps on one node, both waiting on sync before they may start. No
    // forceNonLeader: the stub already holds the lowest address in every one of
    // these apps' holder lists, so it wins the election and the subject defers -
    // which is the state that keeps asking. (forceNonLeader would install on
    // index 0 to make a running peer, and index 0 is the stub.)
    for (const name of [appOne, appTwo]) {
      // eslint-disable-next-line no-await-in-loop
      await seedSyncthingApp(env, { name, mode: 'r', index: subject });
      // The stub joins each app's holder list as the lowest address, so both
      // folders elect the same peer - which is the shape that charged the probe
      // twice.
      // eslint-disable-next-line no-await-in-loop
      await dbClient(subject + 1).seedAppLocation({ name, ip: stubIp });
    }
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('asks the shared holder once a pass while two folders both wait on it', async function () {
    this.timeout(300000);

    // Both folders must be undecided throughout, or one pending folder would
    // produce one question per pass whatever the code did.
    expect(await isUp(env.clients[subject], appOne), 'fixture: the first app must still be waiting').to.be.false;
    expect(await isUp(env.clients[subject], appTwo), 'fixture: the second app must still be waiting').to.be.false;

    await stub.clear();
    await stub.setPromotedFolders({ ready: true, folders: [] });

    // Three arrivals give two gaps to measure - enough to tell one question per
    // pass from two, without pinning how many passes it takes to get there.
    await waitFor(async () => (await stub.promotedFolderRequests()).length >= 3, {
      timeout: 240000,
      interval: 3000,
      label: 'the subject asks the elected holder across three passes',
    });

    const arrivals = await stub.promotedFolderRequests();
    const gaps = arrivals.slice(1).map((at, i) => at - arrivals[i]);
    const closest = Math.min(...gaps);

    expect(
      closest,
      `two questions ${closest}ms apart - one pass asked once per folder (arrivals: ${arrivals.join(', ')})`,
    ).to.be.greaterThan(SAME_PASS_MS);

    // Still undecided, so every one of those passes had both folders waiting.
    expect(await isUp(env.clients[subject], appOne), 'the first app started mid-measurement').to.be.false;
    expect(await isUp(env.clients[subject], appTwo), 'the second app started mid-measurement').to.be.false;
  });
});
