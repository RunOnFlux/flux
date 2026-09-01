import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { execInContainer } from '../framework/container.js';
import {
  bootAndPeer, placeGAppInOrder, electionOrder, installedInstanceIndices,
} from '../framework/reconciler-suite.js';
import { syncthingSeedIndex, placementOrderWithSeedAt } from '../framework/g-app-placement.js';
import { setSynced, setPeerHasData, resetSyncState } from '../framework/syncthing-control.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { driveUntil, startTicker, stopTicker } from '../framework/daemon-control.js';
import { waitFor, waitForGiveUpConsidered } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Trimming a surplus copy, when the surplus copy is the one WRITING.
//
// Two rules meet here and neither knows about the other.
//
// An app that ends up on more nodes than it needs sheds one, and the rule is
// "the newest copy stands aside". Every node ranks the same shared order and
// works out for itself whether it is the newest, so exactly one node ever
// concludes that it is - that agreement is the whole reason two copies never
// leave at once.
//
// Separately, a `g:` app has one node WRITING to the volume while the rest hold
// synced copies with the component stopped. The election is allowed to seat that
// writer anywhere in the order: it will not start a node whose data has not
// finished syncing, so it works down the list until it finds one that is ready,
// and the designated-leader branch leaves the order outright.
//
// So the two rules can land on the same node, and "the newest stands aside" is
// then backwards. It is a stand-in for "the least valuable copy stands aside",
// and the writer is the most valuable copy on the network. The node stays, and
// the next copy trims instead - what must NOT happen is the writer being stopped
// to make the ordering come true. An app that is over-served is not down; an app
// whose writer was stopped to tidy up a count is.
//
// THE SURPLUS IS BUILT, not raced for. The spawner fills to N and stops, so a
// fleet left to itself never produces a surplus at all - which is why no suite
// could ask this question before. A stub peer announces that it holds the app,
// through the ordinary broadcast path, and that takes the count to N+1. It is
// backdated so it is the SENIOR holder: the surplus has to land on a real node,
// and a stub holds no containers and could not be observed leaving.
// Read through a helper that THROWS on an unreadable answer. `some(...)` over
// an empty list is false, so a failed request or an unexpected shape reads as
// "the component is not running" - and the assertion that matters most in this
// suite is that the writer IS still running. Suite 55 shipped that bug and it
// passed while the node was still writing.
async function runningComponents(env, nodeIndex) {
  const res = await env.clients[nodeIndex].get('/apps/listrunningapps');
  const list = res?.status === 'success' ? res.data : null;
  if (!Array.isArray(list)) throw new Error(`listrunningapps unreadable: ${JSON.stringify(res)?.slice(0, 200)}`);
  return list.flatMap((a) => a.Names || []).map((n) => n.replace(/^\//, ''));
}

const subnet = getSubnetConfig();
const REAL_NODES = 5;
const STUB_INDEX = REAL_NODES; // one past the real ones

// TWO ORDERINGS DECIDE THIS FIXTURE, and the whole point is to make them
// coincide on one node: the writer has to BE the newest copy, because the newest
// copy is the one the surplus rule picks.
//
// Placing the seed LAST is what does that - it carries the latest runningSince,
// so it is both the writer and the copy that would be trimmed. Why the seed is
// the writer, and why no amount of electing moves it, is g-app-placement.js's
// to explain; this suite says which shape it needs and lets that module work
// out the order.
const HOLDERS = [0, 1, 2];
const SEED_INDEX = syncthingSeedIndex(HOLDERS);
const PLACEMENT_ORDER = placementOrderWithSeedAt(HOLDERS, HOLDERS.length - 1);
const ipOfIndex = (index) => subnet.nodeIp(index + 1);

describe('a surplus copy that is also the writer', function () {
  let env;
  let app;
  let appName;
  let held;
  let folder;
  let identifier;
  let order;
  dumpLogsOnFailure(() => env);

  const holderAt = async (position) => {
    const res = await env.clients[0].getAppLocations(appName);
    // An unreadable answer must not read as an empty order: ranking nothing and
    // indexing into it yields undefined, and every assertion downstream then
    // compares undefined against undefined and passes.
    if (res?.status !== 'success' || !Array.isArray(res.data) || !res.data.length) {
      throw new Error(`app locations unreadable: ${JSON.stringify(res)?.slice(0, 200)}`);
    }
    const ranked = electionOrder(res.data);
    // electionOrder is senior-first; the surplus rule ranks the junior end.
    return [...ranked].reverse()[position];
  };

  before(async function () {
    this.timeout(600000);
    appName = `e2esurpluswriter${Date.now()}`;
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES + 1,
      stubPeers: [STUB_INDEX],
      tickerAutostart: false,
    });
    await bootAndPeer(env, { minOutbound: 2, minInbound: 2 });
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');

    // THREE instances, placed on three real nodes one at a time so their
    // runningSince values are distinct and ordered. Placed in parallel they all
    // land in the same instant, the ranking falls through to its ip tiebreak,
    // and "the newest" stops meaning anything a test can steer.
    app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', instances: 3,
    });
    identifier = `${appName}_${appName}`;
    folder = `flux${identifier}`;
    order = await placeGAppInOrder(env, app, {
      placementOrder: PLACEMENT_ORDER, folder, identifier,
    });

    // Every holder's folder complete and a connected peer holding it, or the
    // safety gate refuses every removal and this suite measures the gate rather
    // than the rule.
    //
    // PER HOLDER ON BOTH KEYS, never the '*' wildcard. placeGAppInOrder's cold
    // start writes a per-IP zero for each holder on BOTH the folder's own sync
    // state and its peer completion - that is HOW it forces a cold start - and
    // the stub reads `${ip}|${folder}` and only falls back to `*|${folder}`, so
    // a specific key shadows the wildcard on either one.
    //
    // This suite has now paid for that twice, one key each time. Setting only
    // '*' completion to 100 left every holder's own entry reading "completion=0
    // remoteState=unknown", so the safety gate refused every trim with
    // NO_SYNCED_PEER. Fixing that alone left every holder's own SYNC STATE at
    // 0/0, so masterSlaveApps would not start the writer at all - "registered as
    // primary on FDM but not ready yet (syncthing not synced)", every cycle -
    // and the positive control timed out against a node behaving correctly.
    // Both keys are written together here so neither can be fixed alone again.
    await Promise.all(HOLDERS.map((index) => Promise.all([
      setSynced({ ip: ipOfIndex(index), folder }),
      setPeerHasData({ ip: ipOfIndex(index), folder }),
    ])));

    await waitFor(async () => (await env.clients[0].getAppLocations(appName)).data?.length >= 3,
      { timeout: 300000, interval: 2000, label: 'three holders announce the app' });

    // The stub becomes the fourth holder - four against an instance count of
    // three - and it is backdated a day, so it is the most SENIOR holder and can
    // never be the one the rule picks.
    // THE PRECONDITION, established rather than raced. Everything this peer
    // says goes over sockets the fleet opens to it, so announcing before anyone
    // has dialled in is talking to an empty set - and that failure surfaces
    // minutes later as the fleet apparently ignoring a holder, which is where
    // this suite lost a run.
    const stub = env.stubPeerClients.get(STUB_INDEX);
    await waitFor(async () => (await stub.connectedNodes()) > 0,
      { timeout: 120000, interval: 2000, label: 'the fleet has connected to the stub peer' });

    held = stub.holdApp(appName, {
      hash: app.hash,
      runningSince: Date.now() - 24 * 60 * 60 * 1000,
    });
    // Throws if it reached nobody, naming the send rather than leaving the wait
    // below to time out against something that was never said.
    await held.started;

    // The count is carried out so a timeout reports what it SAW. "The stub is
    // not counted" and "the fleet lost a holder" are different faults with one
    // symptom, and a bare deadline separates neither.
    let holders = 0;
    let seen = [];
    await waitFor(async () => {
      const res = await env.clients[0].getAppLocations(appName);
      holders = Array.isArray(res.data) ? res.data.length : -1;
      seen = Array.isArray(res.data) ? res.data.map((d) => d.ip) : [];
      return holders >= 4;
    }, {
      timeout: 120000,
      interval: 2000,
      label: 'the stub is counted as a fourth holder',
    }).catch((error) => {
      // WHICH holder is missing, not how many there are. Three can mean the
      // stub's announcement never landed, or that a give-up pass trimmed a real
      // copy out from under the fixture the moment the surplus appeared - the
      // second is what happens when the pass period is compressed, and the count
      // alone cannot tell them apart. It cost a session to find that out once.
      const stubIp = ipOfIndex(STUB_INDEX);
      const hasStub = seen.some((ip) => String(ip).startsWith(stubIp));
      throw new Error(
        `${error.message} - the fleet counted ${holders} holder(s), not 4. `
        + `saw [${seen.join(', ')}]; stub ${stubIp} ${hasStub ? 'IS' : 'is NOT'} among them, `
        + `so ${hasStub ? 'a real copy was trimmed before the fixture was ready' : 'the stub was never counted'}.`,
      );
    });
  });

  after(async function () {
    this.timeout(120000);
    held?.stop();
    await startTicker().catch(() => {});
    await resetFdm().catch(() => {});
    await resetSyncState().catch(() => {});
    if (env) await env.teardown();
  });

  // The shape both tests rest on: which node is the newest copy, which sits
  // behind it, and the writer actually running on the newest.
  //
  // Established from a TEST rather than from before(), on purpose. A hook
  // failure writes no per-container logs, and this is precisely the step whose
  // failure needs them - it is where four earlier runs of this suite died, each
  // time on the fixture rather than on the rule. Memoised, so the second test
  // inherits the shape instead of re-deriving it and quietly disagreeing with
  // the first about which node it is talking about.
  let shape = null;
  const establishShape = async () => {
    if (shape) return shape;
    const newest = await holderAt(0);
    const nextNewest = await holderAt(1);
    const newestIp = newest.ip.split(':')[0];
    const nextIp = nextNewest.ip.split(':')[0];
    const newestIndex = order.find((i) => ipOfIndex(i) === newestIp);
    const nextIndex = order.find((i) => ipOfIndex(i) === nextIp);
    expect(newestIndex, 'the newest holder is a real node').to.not.equal(undefined);
    expect(nextIndex, 'the second-newest holder is a real node').to.not.equal(undefined);

    // A CONTROL ON THE FIXTURE, not on the code. Everything below rests on the
    // seed and the newest copy being the same node; if the seed rule ever moves,
    // this says so in one line rather than leaving a wait three lines down to
    // time out after three minutes looking like a product fault.
    expect(newestIndex, 'the fixture must land the writer on the newest copy')
      .to.equal(SEED_INDEX);

    // FDM is told what is already true, so the election has no reason to move
    // the role mid-test. It is not what puts the writer there - the cold-start
    // seed did that - and nothing here depends on FDM to create the shape.
    await electMaster(appName, newestIp);

    // Positive control. Without it a later "the writer never stopped" assertion
    // passes on a component that was never running in the first place.
    await waitFor(async () => (await runningComponents(env, newestIndex)).includes(folder),
      { timeout: 180000, interval: 3000, label: 'the newest copy is running the writer' });

    shape = { newestIndex, nextIndex };
    return shape;
  };

  it('trims nothing while it cannot confirm the newest copy is the writer', async function () {
    this.timeout(900000);
    const { newestIndex, nextIndex } = await establishShape();

    // The second-newest may act ONLY on a POSITIVE confirmation that the newest
    // is running the writer. Every node ranks the same shared order, but "who is
    // writing" is each node's own reading - so a node acting on anything weaker
    // is how two copies leave at once, which is the one outcome this design has
    // to make impossible.
    //
    // CONFIRMATION IS A DIRECT PROBE OF THE PEER'S OWN API, not an FDM lookup,
    // so the only way to take it away is to stop this node being able to read
    // that peer. An FDM outage does not do it, and this test used to try: it
    // leaves peerComponentState answering perfectly well, because that function
    // never asks FDM anything.
    //
    // The newest copy goes on running the writer throughout, which is the whole
    // point - if the rule ever trimmed on silence, the node doing it would be
    // removing a copy while the writer was up and healthy.
    //
    // THE SURPLUS MUST STILL BE HERE, which is why this runs before the test
    // that trims. After that trim the app sits at exactly its instance count,
    // the surplus rule is never entered at all, and the assertion below would
    // hold for a reason with nothing to do with confirming a writer.
    const locations = await env.clients[0].getAppLocations(appName);
    expect(locations.data?.length, 'a surplus must exist or this test declines nothing')
      .to.equal(HOLDERS.length + 1);

    const before = await installedInstanceIndices(env, appName);
    expect(before, 'the copy that would be trimmed is still here').to.include(nextIndex);

    await env.partitionGroups([nextIndex], [newestIndex], { awaitSever: false });
    try {
      // THE PASS SAYING IT SAW THE SURPLUS AND WOULD NOT ACT ON IT. Waiting for
      // "nothing was removed" on its own passes just as happily when the pass
      // never ran - which is how this test passed before, on a fleet where the
      // give-up pass fired once across five nodes and reported NONE.
      let declined = null;
      const refusal = waitForGiveUpConsidered(
        env.clients[nextIndex], appName,
        (d) => d.giveUp === false && d.reason === 'SURPLUS' && d.code === 'WRITER_UNCONFIRMED',
        600000,
      ).then((v) => { declined = v; return v; });
      refusal.catch(() => {});

      await stopTicker();
      await driveUntil(env.clients[nextIndex], async () => declined !== null, {
        timeoutMs: 600000,
        label: 'the second-newest reports a surplus it would not act on',
      });

      const after = await installedInstanceIndices(env, appName);
      expect(after.slice().sort(), 'a copy left while nobody could confirm the writer')
        .to.deep.equal(before.slice().sort());
      expect(
        await runningComponents(env, newestIndex),
        'the writer stopped while its peer could not see it',
      ).to.include(folder);
    } finally {
      await env.healPartition([nextIndex], [newestIndex]).catch(() => {});
      // healPartition's own comment makes this the caller's job - it drops the
      // iptables rules and leaves the dead cross-group sockets to be re-dialled.
      // 68, 70 and 71 all do it; this suite was the only one that did not, and
      // the pair never reconnected: node .12 logged nothing but timed-out
      // handshakes to .10 from the heal until the test gave up ten minutes later.
      await env.startDiscovery().catch(() => {});
      await startTicker().catch(() => {});
    }
  });

  it('leaves the writer in place and trims the next copy instead', async function () {
    this.timeout(900000);
    const { newestIndex, nextIndex } = await establishShape();

    // WAIT FOR THE FACT THE DECISION READS. The trim is allowed only when
    // peerComponentState confirms the newest copy holds the writer, and it asks
    // by GETting /apps/heldcomponents on that node - so this waits for exactly
    // that call to answer, made from the node that will make it.
    //
    // It used to wait for the pair to appear in each other's PEER LISTS, which
    // is a different fact and was satisfied while nothing could actually talk:
    // the two never reconnected after the partition above, the peer map still
    // carried the entry, and the one probe this test gets found the newest
    // silent and correctly declined. The suite then spent ten minutes waiting
    // for a trim that had already been refused for the right reason.
    //
    // It matters that this is the one probe. The give-up pass runs on
    // `blockHeight % (removeFluxAppsPeriod * speedMultiplier) === 0` - 44 blocks
    // - and driveUntil below spends about 53, so there is one attempt and no
    // second. A precondition that is merely usually true is a coin toss here.
    // Defined once and used twice: to get into the shape, and then to hold the
    // chain still whenever it lapses. Asked the way the product asks it, from
    // the node that will make the decision.
    const newestAnswersHeldComponents = async () => {
      const res = await execInContainer(
        env.clients[nextIndex].container,
        `curl -sf -m 5 http://${ipOfIndex(newestIndex)}:16127/apps/heldcomponents`,
      );
      return res.exitCode === 0 && res.output.includes(folder);
    };

    await waitFor(newestAnswersHeldComponents, {
      timeout: 180000,
      interval: 3000,
      label: 'the newest copy answers heldcomponents with the writer, asked from the second-newest',
    });

    await stopTicker();
    await driveUntil(env.clients[nextIndex], async () => {
      const installed = await installedInstanceIndices(env, appName);
      if (!installed.includes(nextIndex)) return true;
      // THE CHAIN DOES NOT ADVANCE WHILE THE DECISION'S PRECONDITION IS FALSE.
      // The give-up pass runs every removeFluxAppsPeriod * 4 = 44 blocks and
      // this drive spends about 53, so there is one attempt. The trim is allowed
      // only when peerComponentState confirms the newest copy holds the writer,
      // and that is a 10s HTTP probe from this node - so if the newest is quiet
      // in the moment the pass lands, it declines for entirely the right reason
      // and there is no second chance. That is how the b22117e5a gate failed
      // here: the newest answered the identical probe from this test a minute
      // earlier, then did not answer the product's.
      //
      // Waiting HERE rather than widening the budget is the difference between
      // removing the coin and tossing it again: driveUntil evaluates this before
      // every block, so a block is only ever driven while the peer is answering,
      // and the pass therefore cannot land in a window where it must refuse.
      await waitFor(newestAnswersHeldComponents, {
        timeout: 120000,
        interval: 3000,
        label: 'the newest copy is still answering heldcomponents before another block is driven',
      });
      return false;
    }, { timeoutMs: 600000, label: 'the second-newest copy is trimmed' });
    await startTicker();

    // THE POINT. The writer was never stopped to make the count come out.
    expect(
      await runningComponents(env, newestIndex),
      'the writer was stopped in order to trim the surplus',
    ).to.include(folder);

    const stillInstalled = await installedInstanceIndices(env, appName);
    expect(stillInstalled, 'the writer left instead of the copy behind it').to.include(newestIndex);
  });
});
