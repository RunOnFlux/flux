import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp, allocateAppPort } from '../framework/seed-helper.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  bootAndPeer, placeGAppInOrder, electionOrder, installedInstanceIndices,
} from '../framework/reconciler-suite.js';
import { setSynced, setPeerHasData, resetSyncState } from '../framework/syncthing-control.js';
import { electMaster, setFdmOutage, resetFdm } from '../framework/fdm-control.js';
import { advanceBlocks, startTicker, stopTicker } from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
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
// coincide on one node.
//
// The syncthing seed - the holder that gets the writable folder at a cold start
// and therefore RUNS the g: component - is the LOWEST IP among the holders. The
// instance order the surplus rule ranks is runningSince, which records the order
// the holders were placed. So placing the seed LAST makes it both the writer and
// the newest copy, which is exactly the collision this suite exists for.
//
// Electing a master does NOT do this. FDM only reports who the primary is; it
// cannot move a running container, and the election correctly refuses to start a
// second writer while a peer is running one. An earlier version of this suite
// tried to elect the newest holder into the role and sat waiting three minutes
// for a component that was never going to start there.
const HOLDERS = [0, 1, 2];
const SEED_INDEX = 0;                   // lowest IP of the three holders
// Derived, not written out: "the seed goes last" is the rule, and a hand-listed
// order silently stops meaning that the moment HOLDERS changes.
const PLACEMENT_ORDER = [...HOLDERS.filter((i) => i !== SEED_INDEX), SEED_INDEX];

describe('a surplus copy that is also the writer', function () {
  let env;
  let app;
  let appName;
  let held;
  let folder;
  let identifier;
  let order;
  dumpLogsOnFailure(() => env);

  const ipOf = (nodeIndex) => subnet.nodeIp(nodeIndex + 1);
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
      name: appName, mode: 'g', ports: [allocateAppPort()], instances: 3,
    });
    identifier = `${appName}_${appName}`;
    folder = `flux${identifier}`;
    order = await placeGAppInOrder(env, app, {
      placementOrder: PLACEMENT_ORDER, folder, identifier,
    });

    // Every holder's folder complete and a connected peer holding it, or the
    // safety gate refuses every removal and this suite measures the gate rather
    // than the rule.
    await setSynced({ folder });
    await setPeerHasData({ folder });

    await waitFor(async () => (await env.clients[0].getAppLocations(appName)).data?.length >= 3,
      { timeout: 300000, interval: 2000, label: 'three holders announce the app' });

    // The stub becomes the fourth holder - four against an instance count of
    // three - and it is backdated a day, so it is the most SENIOR holder and can
    // never be the one the rule picks.
    held = env.stubPeerClients.get(STUB_INDEX).holdApp(appName, {
      hash: app.hash,
      runningSince: Date.now() - 24 * 60 * 60 * 1000,
    });
    await held.started;
    await waitFor(async () => (await env.clients[0].getAppLocations(appName)).data?.length >= 4,
      { timeout: 120000, interval: 2000, label: 'the stub is counted as a fourth holder' });
  });

  after(async function () {
    this.timeout(120000);
    held?.stop();
    await startTicker().catch(() => {});
    // Explicitly, not via resetFdm: the FDM stub is shared infrastructure and an
    // outage left on leaks into whatever suite runs next. Whether /reset clears
    // that flag is the stub's business, and this suite should not depend on it.
    await setFdmOutage(false).catch(() => {});
    await resetFdm().catch(() => {});
    await resetSyncState().catch(() => {});
    if (env) await env.teardown();
  });

  it('leaves the writer in place and trims the next copy instead', async function () {
    this.timeout(900000);

    const newest = await holderAt(0);
    const nextNewest = await holderAt(1);
    const newestIp = newest.ip.split(':')[0];
    const nextIp = nextNewest.ip.split(':')[0];
    const newestIndex = order.find((i) => ipOf(i) === newestIp);
    const nextIndex = order.find((i) => ipOf(i) === nextIp);
    expect(newestIndex, 'the newest holder is a real node').to.not.equal(undefined);
    expect(nextIndex, 'the second-newest holder is a real node').to.not.equal(undefined);

    // A CONTROL ON THE FIXTURE, not on the code. Everything below rests on the
    // seed and the newest copy being the same node; if the seed rule ever moves,
    // this says so in one line rather than leaving the wait three lines down to
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

    await stopTicker();
    await waitFor(async () => {
      await advanceBlocks(4);
      const installed = await installedInstanceIndices(env, appName);
      return !installed.includes(nextIndex);
    }, { timeout: 600000, interval: 1000, label: 'the second-newest copy is trimmed' });
    await startTicker();

    // THE POINT. The writer was never stopped to make the count come out.
    expect(
      await runningComponents(env, newestIndex),
      'the writer was stopped in order to trim the surplus',
    ).to.include(folder);

    const stillInstalled = await installedInstanceIndices(env, appName);
    expect(stillInstalled, 'the writer left instead of the copy behind it').to.include(newestIndex);
  });

  it('trims nothing at all while the writer cannot be confirmed', async function () {
    this.timeout(900000);

    // The second-newest may only act on a POSITIVE confirmation that the newest
    // is running the writer. Every node ranks the same shared order, but "who is
    // writing" is each node's own reading and FDM's registration lags it - so a
    // node acting on anything weaker is how two copies leave at once, which is
    // the one outcome this design has to make impossible.
    //
    // With no FDM answering, no node can establish who the writer is. The
    // correct behaviour is that nobody trims: an app one copy over its count is
    // a cost, and it is a smaller one than an app a copy short of it.
    const before = await installedInstanceIndices(env, appName);
    await setFdmOutage(true);

    await stopTicker();
    await advanceBlocks(24);
    await startTicker();

    const after = await installedInstanceIndices(env, appName);
    // Restored here rather than only in teardown: an assertion below that fails
    // would otherwise leave the shared FDM stub down for the next suite.
    await setFdmOutage(false);

    expect(after.slice().sort(), 'a copy left while nobody could say who was writing')
      .to.deep.equal(before.slice().sort());
  });
});
