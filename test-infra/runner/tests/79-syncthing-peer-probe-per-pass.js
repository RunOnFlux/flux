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

  // The stub goes LAST and the subject first, which is what makes the mesh close.
  //
  // Two nodes share ONE connection - outbound for whoever dialled, inbound for
  // the other - and a node will not dial a peer it already holds. So the lowest
  // index dials everyone before they reach it and ends on zero inbound unless
  // something it does NOT dial reaches back. At minOutgoing 2 node i dials i+1
  // and i+2, so index 0's inbound comes from index N-2, which is the one node it
  // never dials. Put the stub at index 0 and that wrap-around is dead, because a
  // stub only ever accepts - which is what starved the first real node however
  // the floors were set.
  //
  // Five addresses is the smallest fleet where the stub sits outside every real
  // node's inbound source. The floors are sized to it - all four, because the
  // harness base minUniqueIpsOutgoing of 3 is unreachable on a mesh this size.
  //
  // The subject holds the lowest address, so it WINS each folder's election and
  // reaches the "does anyone already hold this?" question - which asks every
  // other holder, and the stub answers that it does. So the subject never
  // promotes, stays deciding, and asks again next pass. That is the question
  // being counted: once per pass with the fix, once per folder without it.
  const stubIndex = 4;
  const subject = 0;
  const stubIp = getSubnetConfig().nodeIp(stubIndex + 1);
  const appOne = `e2eprobea${Date.now()}`;
  const appTwo = `e2eprobeb${Date.now()}`;
  // A single-component synced app's folder id is flux<component>_<app>, and
  // buildSeedableSyncthingApp names the component after the app.
  const heldFolders = [appOne, appTwo].map((name) => `flux${name}_${name}`);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      stubPeers: [stubIndex],
      tickerAutostart: false,
      configOverrides: {
        // The rate under measurement - pinned, not inherited.
        syncthing: { monitorIntervalMs: MONITOR_INTERVAL_MS },
        // Sized to a five-address mesh, one address of which never dials.
        fluxapps: {
          minOutgoing: 2,
          minIncoming: 1,
          minUniqueIpsOutgoing: 2,
          minUniqueIpsIncoming: 1,
          appSyncDegradedThreshold: 0,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await resetSyncState();

    stub = env.stubPeerClients.get(stubIndex);
    await stub.clear();

    // Two r: apps on one node, both waiting on sync before they may start. No
    // forceNonLeader: the subject must WIN its elections here, so that it reaches
    // the "does anyone already hold this?" question the stub answers.
    for (const name of [appOne, appTwo]) {
      // eslint-disable-next-line no-await-in-loop
      await seedSyncthingApp(env, { name, mode: 'r', index: subject });
      // The stub joins each app's holder list, so both folders put the same
      // question to the same peer - the shape that charged the probe twice.
      // eslint-disable-next-line no-await-in-loop
      await dbClient(subject + 1).seedAppLocation({ name, ip: stubIp });
    }

    // Claiming both folders is what holds the subject in the deciding state: a
    // peer that already has the writable copy blocks promotion, so the subject
    // stays receiveonly and asks again every pass instead of promoting once and
    // falling silent.
    await stub.setPromotedFolders({ ready: true, folders: heldFolders });
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

    // ONE call, because clear() drops the claim as well as the log. Cleared and
    // then restated, this peer claims to hold nothing for the width of a round
    // trip, and a subject polling inside it sees the folder free, promotes, and
    // stops asking - which is exactly what the assertions below then report, as
    // an app that started mid-measurement. Restating the claim and resetting the
    // log in the same request removes the window rather than narrowing it.
    await stub.setPromotedFolders({ ready: true, folders: heldFolders, resetRequests: true });

    // Three arrivals give two gaps to measure - enough to tell one question per
    // pass from two, without pinning how many passes it takes to get there.
    await waitFor(async () => (await stub.promotedFolderRequests()).length >= 3, {
      timeout: 240000,
      interval: 3000,
      label: 'the subject asks the holder across three passes',
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
