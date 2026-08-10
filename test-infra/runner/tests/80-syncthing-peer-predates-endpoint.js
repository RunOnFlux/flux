import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetSyncState, setPeerCompletion } from '../framework/syncthing-control.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// What a node does about a holder it cannot ask.
//
// /apps/promotedfolders is new, so during a rollout every node that has not been
// upgraded yet answers 404. The asking node has to place that answer, and the two
// obvious readings are both wrong in opposite directions:
//
//   Read it as DEATH and the holder is dropped from the election. The asker
//   becomes the lowest address, finds nobody blocking - every peer looks dead -
//   and promotes a second writable copy alongside a holder that is still writing.
//
//   Read it as NOT READY YET and it blocks with no bound, which "not ready yet"
//   earns by resolving itself. A node that predates the endpoint never will. On a
//   cold start every other holder defers to that same lowest address, so one
//   un-upgraded peer stops the app starting anywhere at all.
//
// The reading under test is neither: a peer that answered is ALIVE, and a peer
// that cannot answer this particular question is simply not covered by the check
// - so that folder gets the behaviour it had before the check existed, decided by
// the election alone. Peers that CAN answer are still checked, so the cover grows
// as the fleet upgrades.
//
// This is the only place in the harness a version-mixed fleet exists. Every node
// runs one image and always will, so the peer that predates the endpoint has to
// be a stub told to answer as one.

const MONITOR_INTERVAL_MS = 3000;
// Enough passes to be sure the subject reached the question repeatedly and
// settled on an answer, rather than being caught mid-first-pass.
const PASSES_BEFORE_JUDGING = 3;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a syncthing holder that predates the folder endpoint', function () {
  let env;
  let stub;
  dumpLogsOnFailure(() => env);

  // The two cases need opposite orderings, because the election is by address:
  // one subject must sit ABOVE the stub so the stub is the elected holder it has
  // to judge, and one must sit BELOW so the subject wins and reaches the
  // promotion check itself. One stub, two subjects, one fleet - rather than two
  // fleets, which is a whole boot each.
  //
  // The stub goes at index 4 of six, not last. A stub only ever accepts, so it
  // supplies no connection: with minOutgoing 2 node i dials i+1 and i+2, and
  // index 0's only dialers are 4 and 5. Putting the stub at 5 would leave index 0
  // with one dialer that is a stub and one that is not; putting it at 4 leaves
  // index 5 dialing 0, and index 3 dialing 5, so every real node keeps an
  // inbound.
  const stubIndex = 4;
  const deferringSubject = 5; // above the stub - the stub is its elected holder
  const seedingSubject = 0; // below the stub - this node wins its own election
  const stubIp = getSubnetConfig().nodeIp(stubIndex + 1);

  const deferApp = `e2eold${Date.now()}`;
  const seedApp = `e2enew${Date.now()}`;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 6,
      stubPeers: [stubIndex],
      tickerAutostart: false,
      configOverrides: {
        syncthing: { monitorIntervalMs: MONITOR_INTERVAL_MS },
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

    // The peer that has not been upgraded. Set before either app is seeded, so
    // no pass ever sees it answer properly.
    await stub.answerPromotedFoldersWith(404);

    for (const [name, index] of [[deferApp, deferringSubject], [seedApp, seedingSubject]]) {
      // eslint-disable-next-line no-await-in-loop
      await seedSyncthingApp(env, { name, mode: 'r', index });
      // The un-upgraded node joins each app's holder list, which is what puts it
      // in front of the subject's election.
      // eslint-disable-next-line no-await-in-loop
      await dbClient(index + 1).seedAppLocation({ name, ip: stubIp });
    }
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('leaves it in the election and does not promote over it', async function () {
    this.timeout(300000);

    // The instrument first. "Did not promote" means nothing from a node that
    // never asked - it would read the same if the probe were broken, if the app
    // never installed, or if the holder list were empty. The subject has to have
    // put the question to this peer, repeatedly, and got the 404 each time.
    await waitFor(
      async () => (await stub.promotedFolderRequests()).length >= PASSES_BEFORE_JUDGING,
      { timeout: 120000, interval: 1000, label: 'the subject to ask the un-upgraded peer what it holds' },
    );

    // It answered, so it is alive, so it stays the elected holder - and this node
    // sits above it and must keep deferring. Promoting here is the second
    // writable copy: a 404 read as death drops it from the election and this node
    // takes over from a holder that never went anywhere.
    expect(
      await isUp(env.clients[deferringSubject], deferApp),
      'promoted over a holder that answered - it was read as dead',
    ).to.be.false;
  });

  it('still seeds a cold start rather than waiting to be upgraded', async function () {
    this.timeout(300000);

    // The opposite subject: it holds the lowest address, so it wins its own
    // election and reaches the promotion check with one peer it cannot ask. That
    // peer must not hold it open - nothing about it will ever change, and every
    // other holder is deferring to this same address, so blocking here is the app
    // never starting anywhere.
    await waitForUp(
      env.clients[seedingSubject], seedApp,
      'the cold start to seed past a peer it cannot ask',
      { timeout: 240000 },
    );

    // And it did reach the question rather than skipping it, so the pass above is
    // the check standing down, not the check never running.
    expect(
      (await stub.promotedFolderRequests()).length,
      'fixture: the seeding subject never asked the un-upgraded peer',
    ).to.be.greaterThan(0);
  });

  it('leaves a holder whose syncthing is still connected, when its API answers nothing at all', async function () {
    this.timeout(300000);

    // The other case in this suite is a holder that ANSWERS badly. This one
    // answers nothing: FluxOS is not listening, which is what a restart, a crash
    // or a redeploy looks like from here. Its syncthing and its container are
    // untouched and still writing, and those are separate processes that fail
    // separately - so silence from the API is not evidence the writer stopped.
    //
    // The peer's own syncthing cannot be asked: it binds to localhost. This
    // node's syncthing knows anyway, because it holds the connection, and that
    // is the evidence used here.
    await stub.refusePromotedFolders();
    const subject = env.clients[deferringSubject];
    await setPeerCompletion({
      ip: subject.ip, folder: deferApp, device: '*', completion: 100, remoteState: 'valid',
    });

    // The instrument, and it has to be the veto's own event rather than the
    // outcome. "Did not promote" is satisfied by too many other things here -
    // a peer reporting 100% makes this node defer for an entirely different
    // reason - so the outcome alone cannot tell the guard firing from the guard
    // never running.
    await subject.waitForEvent(
      'syncthing:holderRetained',
      (d) => d.folder.includes(deferApp),
      180000,
    );

    // And the decision that event describes: the holder keeps the folder, so this
    // node stays receiveonly. Without the veto its API silence drops it from the
    // election, this node wins, and a second writable copy runs beside a holder
    // that never stopped.
    expect(
      await isUp(subject, deferApp),
      'promoted over a holder whose syncthing was still connected',
    ).to.be.false;

    // Restored so the refusal cannot outlive this test.
    await stub.refusePromotedFolders(false);
    await stub.answerPromotedFoldersWith(404);
  });
});
