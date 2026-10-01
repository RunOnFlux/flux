import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, crashFluxos, releaseFluxos, execInContainer } from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import {
  setSynced, setPeerHasData, resetSyncState, getSyncthingState, getFolderWrites, getFolderConfig, setFolderConfig, severPeerSync,
} from '../framework/syncthing-control.js';
import { restartFluxos } from '../framework/container.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForElectionDecisions, electionDecisionCount } from '../framework/wait.js';
import {
  bootAndPeer, placeGAppInOrder, electionIndexOf,
} from '../framework/reconciler-suite.js';
import { syncthingSeedIndex, placementOrderWithSeedAt } from '../framework/g-app-placement.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';

// MUST-PASS gate. Primary election when the election order DISAGREES with the
// syncthing seed order - the one arrangement the other g: suites cannot make.
//
// The master/slave election, syncthing cold-start and operator-stop recovery
// suites install their holders in parallel, so every holder's
// runningSince lands in the same instant, the election sort falls through to its ip
// tiebreak, and the lowest-IP syncthing seed is always ALSO election index 0. Every
// rule that reads `index > 0` is therefore dead in those suites - including the
// seed's stagger skip, which is the whole mechanism this file exists to pin.
//
// Here the holders are placed one at a time (placeGAppInOrder) in an order chosen to
// put the seed in the MIDDLE: index > 0, with a peer ABOVE it. Each scenario gets its
// own app on the SAME fleet - FDM primary state is per-app, and a fresh app is an
// install rather than a fleet boot, so they cost a minute each and cannot disturb one
// another. Scenarios that need their own fleet topology (partition) or a wiped volume
// live in their own files, where the gate can run them in parallel.

const subnet = getSubnetConfig();

// Passes each node is counted deciding, after the change it is deciding on.
const HELD_PASSES = 3;

// The g: start path's checkpoint, declared in fluxEventBus.Checkpoint: a node
// paused here has committed to the start and runs nothing.
const BEFORE_START = 'masterSlave:beforeStart';

// The syncthing monitor's checkpoint between reading a folder's config and
// writing it, keyed by folder id.
const BEFORE_FOLDER_WRITE = 'syncthing:beforeFolderWrite';

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('primary election under a divergent placement order', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const holders = [0, 1, 2];
  const seedIndex = syncthingSeedIndex(holders);
  // Placed in this order, so the seed carries the MIDDLE runningSince and node 2 sits
  // above it.
  const placementOrder = placementOrderWithSeedAt(holders, 1);
  const stamp = Date.now();

  // One app per scenario, all on the one fleet. All five land on the same three
  // holders and a node can bind a port once: the spawner would never co-locate
  // two apps declaring the same port, but placeGAppInOrder force-places and
  // bypasses that check. Sharing a port, the apps play musical chairs - every
  // restart of one fails on the port a sibling holds, stop-history accumulates,
  // and the restart backoff climbs into minutes, which reads as an election
  // failure and is nothing of the sort. The seeding path hands each app a port
  // of its own, so none of them names one here.
  const orderApp = `e2eorder${stamp}`;
  const genesisApp = `e2egenloss${stamp}`;
  const fdmApp = `e2efdmling${stamp}`;
  const windowApp = `e2ewindow${stamp}`;
  const pairApp = `e2epair${stamp}`;
  const lossApp = `e2eloss${stamp}`;

  // Each holder's last event before orderApp was placed.
  let orderDeployedFrom = [];
  // The holder running fdmApp once FDM has named it.
  let fdmPrimary;

  const countUp = async (appName) => (await Promise.all(
    holders.map((i) => isUp(env.clients[i], appName)),
  )).filter(Boolean).length;

  const identifierOf = (appName) => `${appName}_${appName}`;
  const folderOf = (appName) => `flux${appName}_${appName}`;
  // One node's count of an election decision about an app.
  const electionCount = (i, appName, decision) => electionDecisionCount(env.clients[i], identifierOf(appName), decision);
  // One node's count of folder-election passes over an app's folder.
  const folderPasses = (i, appName) => env.clients[i].getDecisionCount('syncthing:folderPass', folderOf(appName), 'evaluated');
  // The g: starts the given nodes have committed to for an app.
  const startsOf = async (nodes, appName) => (await Promise.all(nodes.map((i) => electionCount(i, appName, 'started'))))
    .reduce((sum, n) => sum + n, 0);
  // Resolves once each node has run HELD_PASSES more passes, as `passes` counts
  // them, than when this was called: every one of them has decided since.
  const passesFromNow = async (nodes, passes, label) => {
    const from = await Promise.all(nodes.map(passes));
    await Promise.all(nodes.map((i, k) => waitFor(async () => (await passes(i)) >= from[k] + HELD_PASSES, {
      timeout: 180000, interval: 1000, label: `node ${i} ran ${HELD_PASSES} ${label} passes`,
    })));
  };
  const electionPasses = (appName) => (i) => electionCount(i, appName, 'evaluated');
  const folderElectionPasses = (appName) => (i) => folderPasses(i, appName);
  // The nodes that turned the app's folder writable after `from`, one event id
  // per node in `nodes`.
  const writableSince = (nodes, appName, from) => nodes.filter((i, k) => env.clients[i].getEventBuffer()
    .some((e) => e.event === 'syncthing:folderWritable' && e.data?.folder === folderOf(appName) && e.id > from[k]));

  const deploy = async (appName, order = placementOrder) => {
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    await placeGAppInOrder(env, app, {
      placementOrder: order,
      folder: `flux${appName}_${appName}`,
      identifier: `${appName}_${appName}`,
    });
    return app;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm(); // no FDM primary by default: these are the self-selection paths
    await resetSyncState();
    orderDeployedFrom = holders.map((i) => env.clients[i].getLastEventId());
    await deploy(orderApp);
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('places the syncthing seed at a non-zero election index, with a peer above it', async function () {
    this.timeout(120000);
    // The premise every later assertion rests on. If either ordering ever changes,
    // this fails loudly instead of the whole file passing vacuously - which is
    // exactly how 35/51/52 pass today.
    const position = await electionIndexOf(env, orderApp, seedIndex);
    expect(position, 'seed landed at index 0 - the fixture no longer diverges from the other g: suites').to.be.greaterThan(0);
    expect(position, 'seed landed last - no peer above it, so a lower-index probe would suffice').to.be.lessThan(holders.length - 1);
  });

  it('starts the newborn app without serving the index stagger', async function () {
    this.timeout(240000);
    // WHICH holder starts is the election's decision, not the fixture's, and there
    // are two legitimate winners: the first-placed node seeds while it is briefly
    // the only holder it knows of, or - when the placements land inside its confirm
    // window - the lowest-IP seed wins the full-list election and starts on its
    // confirmed designation. Which one it is comes down to broadcast timing, so
    // naming a node here would pin a race, not a behaviour. What genesis promises
    // either way: the winner never waits on peers that are receiveonly with nothing
    // to sync from, so it does not start from a booked stagger, and exactly one
    // holder starts.
    await waitFor(
      async () => (await countUp(orderApp)) >= 1,
      { timeout: 180000, interval: 3000, label: 'a holder starts the newborn app' },
    );
    expect(await countUp(orderApp), 'more than one holder started at genesis').to.equal(1);

    const identifier = `${orderApp}_${orderApp}`;
    const running = holders[(await Promise.all(holders.map((i) => isUp(env.clients[i], orderApp)))).indexOf(true)];
    expect(await env.clients[running].getDecisionCount('masterSlave:decision', identifier, 'staggeredStart'),
      'the winner started from a booked stagger').to.equal(0);
  });

  it('leaves exactly one holder seeding the empty folder at cold start', async function () {
    this.timeout(420000);
    // The mastership invariant is exactly one RUNNING CONTAINER - never "exactly one
    // writable folder". A standby that has genuinely synced promotes its own folder to
    // sendreceive with no reference to who the primary is, and that is correct: with a
    // single container running, only one node's data ever changes, so several writable
    // folders are harmless. Folder exclusivity is asserted HERE, and only here, because
    // this is a cold start: the standbys have nothing to sync from, so exactly one node
    // may seed the empty folder, and a second seeder is a second first-copy of the data.
    //
    // The two seeders come from two views of the same holder list. The first-placed node
    // is briefly the only holder it knows of and seeds on that basis - correct, since
    // somebody must seed an empty folder. A node that can see further then wins the
    // tiebreak among the holders IT can see and seeds too, and neither revisits it,
    // because a promoted folder never re-enters the election.
    //
    // The container count is asserted with it: it is the invariant that holds at
    // every point in the app's life, cold start included.
    //
    // The second promotion arrives seconds after the first, so every holder runs
    // HELD_PASSES folder-election passes and election passes after the app has
    // started, and only then are the seeds and the starts counted.
    await passesFromNow(holders, folderElectionPasses(orderApp), 'folder-election');
    await passesFromNow(holders, electionPasses(orderApp), 'election');
    const seeders = writableSince(holders, orderApp, orderDeployedFrom);
    expect(seeders, `more than one node seeded the empty folder: ${seeders.join(', ')}`).to.have.lengthOf(1);
    expect(await startsOf(holders, orderApp), 'two holders started the g: component').to.equal(1);
    expect(await countUp(orderApp), 'two holders ran the g: component at once').to.equal(1);
  });

  // The peer probe no longer reads a silence as a clearance: a holder whose FluxOS is
  // down mid-restart still has its syncthing connection open, and that connection is
  // the evidence the probe now demands before it will start beside a peer. Written
  // against the old probe this ran red in this fleet - a six-second outage was enough
  // to put a second writer on the volume - which is what makes it worth keeping rather
  // than trusting the unit coverage alone.
  it('does not read a restarting holder as free to start alongside', async function () {
    this.timeout(720000);
    // A node that has just restarted has not yet read its own folder config, so it
    // cannot tell "I hold nothing" from "I have not looked". It must answer the
    // second: answering the first tells a peer the component is going unrun and
    // invites it to start a second writer over a volume the restarting node is still
    // holding - and a fleet-wide restart puts every holder of an app in that state
    // together.
    //
    // Both halves of the cluster's real state are declared here, for every holder,
    // because the stub reports only what a fixture declares - it will not invent a
    // connected peer, which is what keeps it from manufacturing witnesses.
    //
    // SYNCED, because a standby with nothing to sync from is not election-eligible
    // and could not start a second container whatever the restarting node answered,
    // which would make this pass for no reason. Their folders legitimately go
    // sendreceive once synced, so the count that matters here is CONTAINERS - one
    // running container is the invariant, not one writable folder.
    //
    // CONNECTED, and this has to RETRACT the genesis declaration rather than add to
    // it. placeGAppInOrder declares no-peer-data under each viewer's own wildcard
    // key, and the stub resolves `viewer|folder|*` before `*|folder|<source device>`
    // - left standing it hides every per-source declaration underneath it and each
    // holder reads its peers as disconnected, which is a state a syncthing that never
    // stopped cannot be in. The fixture has moved past genesis: these holders hold
    // the data and are connected to one another, and the connection to the node whose
    // FluxOS is about to go away is the whole evidence the probe reads while its API
    // is silent.
    const orderFolder = `flux${orderApp}_${orderApp}`;
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder: orderFolder })));
    await Promise.all(holders.map((i) => setPeerHasData({ ip: subnet.nodeIp(i + 1), folder: orderFolder })));

    expect(await countUp(orderApp), 'fixture: exactly one holder must run the component before the restart').to.equal(1);
    // Restart the holder that is actually running it, rather than whichever node was
    // placed first: which of them took the component is the election's decision, not
    // the fixture's, and restarting a node that runs nothing tests nothing.
    const runningFlags = await Promise.all(holders.map((i) => isUp(env.clients[i], orderApp)));
    const running = holders[runningFlags.indexOf(true)];
    expect(running, 'fixture: a running holder must be identifiable to restart').to.not.equal(undefined);

    const peers = holders.filter((i) => i !== running);
    const peersStartedBefore = await startsOf(peers, orderApp);

    await restartFluxos(env.clients[running].container);

    // The window is while the restarted node is back up and answering but has not
    // completed a pass of its own. Only the FluxOS process cycles, so the holder's
    // own app container stays up throughout, and a start by a PEER across it is a
    // second writer on the shared volume. The restarted node's counters begin
    // again from zero; once it has run HELD_PASSES election passes its window is
    // over, and each peer then runs HELD_PASSES more.
    await waitForElectionDecisions(env.clients[running], identifierOf(orderApp), 'evaluated', HELD_PASSES, { timeout: 240000 });
    await passesFromNow(peers, electionPasses(orderApp), 'election');
    expect(await startsOf(peers, orderApp), 'a peer started a second writer while a holder was restarting').to.equal(peersStartedBefore);
    expect(await electionCount(running, orderApp, 'started'), 'the restarted holder started the component again').to.equal(0);
    expect(await countUp(orderApp)).to.equal(1);
  });

  it('starts no second writer when the primary is released back to the election', async function () {
    this.timeout(540000);
    // Exactly one holder runs the component, through the window where the primary is
    // stopped and handed back to the election. Two things can put a second writer on
    // the shared volume here: a seed claim still standing after genesis, which leaves
    // the index order; and a controller desire surviving the operator stop, which the
    // reconciler acts on with no election pass. The assertion is on the invariant,
    // not on either path.
    //
    // The primary is whichever holder runs the component - which one won genesis is
    // the election's decision, not the fixture's, and releasing a holder that runs
    // nothing releases nothing.
    expect(await countUp(orderApp), 'fixture: exactly one holder must run the component before the release').to.equal(1);
    const primary = holders[(await Promise.all(holders.map((i) => isUp(env.clients[i], orderApp)))).indexOf(true)];

    // The standbys have genuinely synced from the primary by now, so pin them synced
    // (over the data seeded at install) to make them election-eligible - otherwise
    // nothing could take over and this would pass for the wrong reason.
    await Promise.all(holders.filter((i) => i !== primary).map(
      (i) => setSynced({ ip: subnet.nodeIp(i + 1), folder: folderOf(orderApp) }),
    ));

    // Release the primary the way an operator does: appstop takes it down and locks it
    // out of the election, appstart releases the lock and hands the start back to the
    // election. The operator-stop recovery suite's recipe.
    const primaryClient = env.clients[primary];
    const auth = await authenticate(primaryClient.url, appOwnerKey());
    const startedBefore = await startsOf(holders, orderApp);
    const releasedFrom = holders.map((i) => env.clients[i].getLastEventId());
    await primaryClient.getAuthed(`/apps/appstop/${orderApp}`, auth.zelidauth);
    await waitFor(async () => !(await isUp(primaryClient, orderApp)), {
      timeout: 90000, interval: 2000, label: 'primary goes down',
    });
    await primaryClient.getAuthed(`/apps/appstart/${orderApp}`, auth.zelidauth);

    // The double start is a same-pass race, and a container that lost it may be
    // stopped again before anyone looks, so the starts are counted, not sampled:
    // one holder commits to the start, then every holder runs HELD_PASSES election
    // passes, and no second commitment may appear.
    await waitFor(async () => (await startsOf(holders, orderApp)) > startedBefore, {
      timeout: 150000, interval: 1000, label: 'a holder commits to starting the released app',
    });
    await passesFromNow(holders, electionPasses(orderApp), 'election');
    expect(await startsOf(holders, orderApp) - startedBefore, 'two holders started the g: component - split brain on the shared volume')
      .to.equal(1);
    // The one start is one promotion, carried through in order on one holder.
    const roleChanges = (i, k) => env.clients[i].getEventBuffer().filter((e) => e.id > releasedFrom[k]
      && e.event === 'primaryRole:changed' && e.data?.identifier === identifierOf(orderApp)).map((e) => e.data.to);
    const promoted = holders.filter((i, k) => roleChanges(i, k).includes('primary'));
    expect(promoted, 'not exactly one holder became the primary').to.have.lengthOf(1);
    expect(roleChanges(promoted[0], holders.indexOf(promoted[0]))).to.deep.equal(['promoting', 'primary']);
    await waitFor(async () => (await countUp(orderApp)) === 1, {
      timeout: 120000, interval: 2000, label: 'the app is back on one holder',
    });
  });

  it('starts only one holder while the one that committed has not started yet', async function () {
    this.timeout(600000);
    // A holder does not start its container the moment it is elected: its folder
    // has to send first. For that whole window it has committed but runs nothing,
    // and a peer that asks only for running containers is told the component is
    // free.
    //
    // The window is held open at the start path's checkpoint, on every holder
    // since any of them may win, for as long as the peers take to decide.
    const identifier = identifierOf(windowApp);
    await Promise.all(holders.map((i) => env.clients[i].holdCheckpoint(BEFORE_START, identifier)));
    try {
      const deployedFrom = holders.map((i) => env.clients[i].getLastEventId());
      await deploy(windowApp);
      const position = await electionIndexOf(env, windowApp, seedIndex);
      expect(position, 'fixture: seed must be off index 0').to.be.greaterThan(0);

      const committed = await Promise.any(holders.map((i, k) => env.clients[i].waitForEvent('checkpoint:held',
        (d) => d.name === BEFORE_START && d.key === identifier, 240000, { afterId: deployedFrom[k] }).then(() => i)));
      const peers = holders.filter((i) => i !== committed);
      await passesFromNow(peers, electionPasses(windowApp), 'election');
      expect(await startsOf(peers, windowApp), 'a peer started while another holder had committed').to.equal(0);
      expect(await countUp(windowApp), 'fixture: a container is running while the start is held').to.equal(0);
    } finally {
      await Promise.all(holders.map((i) => env.clients[i].releaseCheckpoint(BEFORE_START, identifier)
        .catch((err) => console.warn(`cleanup: checkpoint release on node ${i} failed: ${err.message}`))));
    }

    await waitFor(async () => (await countUp(windowApp)) === 1, {
      timeout: 180000, interval: 2000, label: 'the committed holder starts once released',
    });
    expect(await startsOf(holders, windowApp), 'more than one holder started').to.equal(1);
  });

  it('settles a two-holder app on one writable copy, with the seed off index 0', async function () {
    this.timeout(660000);
    // Two holders is the ordinary shape for a g: app, and the one every other suite
    // installs in parallel - which collapses the two orderings onto the same node
    // and hides every disagreement between them. Placed one at a time the seed is
    // index 1, and with only two holders there is no third opinion to fall back on:
    // whatever the pair decides is the answer.
    const app = await buildSeedableSyncthingApp({ name: pairApp, mode: 'g' });
    await pushImage(pairApp, 'v1');
    const pair = [0, 1];
    const placedFrom = pair.map((i) => env.clients[i].getLastEventId());
    await placeGAppInOrder(env, app, {
      placementOrder: placementOrderWithSeedAt([0, 1], 1),
      folder: `flux${pairApp}_${pairApp}`,
      identifier: `${pairApp}_${pairApp}`,
    });

    const position = await electionIndexOf(env, pairApp, seedIndex);
    expect(position, 'fixture: the seed must not be index 0, or this is operator-stop recovery again').to.be.greaterThan(0);

    const pairUp = async () => (await Promise.all(
      pair.map((i) => isUp(env.clients[i], pairApp)),
    )).filter(Boolean).length;

    await waitFor(async () => (await pairUp()) >= 1, {
      timeout: 240000, interval: 3000, label: 'the pair starts the app on one of them',
    });

    // Both holders run HELD_PASSES folder-election and election passes after the
    // start; then exactly one of them may hold the writable copy or have started.
    await passesFromNow(pair, folderElectionPasses(pairApp), 'folder-election');
    await passesFromNow(pair, electionPasses(pairApp), 'election');
    const writable = writableSince(pair, pairApp, placedFrom);
    expect(writable, `both holders took the writable copy: ${writable.join(', ')}`).to.have.lengthOf(1);
    expect(await startsOf(pair, pairApp), 'both holders started the component').to.equal(1);
    expect(await pairUp(), 'both holders ran the component').to.equal(1);
  });

  it('starts a newborn app on no holder while its seed is cut off, and on exactly one once it is back', async function () {
    this.timeout(900000);
    // Genesis has exactly one node that can seed, chosen by lowest IP. Here that
    // seed is cut off from the other holders before the app is placed, so none of
    // them has ever been connected to another: a silence with no connection behind
    // it is no evidence that the peer is gone, on either side of the cut. No holder
    // may start - the survivors cannot rule the seed out, and the seed cannot rule
    // them out. Once the cut heals, the holders can ask each other again and
    // exactly one of them starts it.
    //
    // The cut comes BEFORE the deploy, because that is the only ordering that
    // cannot race genesis: the runner reaches every node either way (a
    // partition drops node-to-node packets, not control traffic), so placement
    // proceeds - but the seed is born unreachable to its peers, and nothing can
    // have seeded when the election first looks.
    const survivors = holders.filter((i) => i !== seedIndex);
    const startedBefore = await startsOf(holders, genesisApp);
    await env.partitionGroups([seedIndex], survivors, { awaitSever: true });
    let healed = false;
    try {
      await deploy(genesisApp);
      const position = await electionIndexOf(env, genesisApp, seedIndex);
      expect(position, 'fixture: seed must be off index 0 for this scenario to mean anything').to.be.greaterThan(0);

      // Watched for as many election passes as the last holder's turn spans,
      // plus HELD_PASSES, on every holder.
      const { masterSlaveStaggerMs, masterSlaveIntervalMs } = loadSharedConfig().fluxapps;
      const span = Math.ceil(((holders.length - 1) * masterSlaveStaggerMs) / masterSlaveIntervalMs) + HELD_PASSES;
      const passesAtDeploy = await Promise.all(holders.map((i) => electionCount(i, genesisApp, 'evaluated')));
      await Promise.all(holders.map((i, k) => waitFor(async () => {
        expect(await countUp(genesisApp), 'a holder started the app while the seed is cut off').to.equal(0);
        return (await electionCount(i, genesisApp, 'evaluated')) >= passesAtDeploy[k] + span;
      }, { timeout: 420000, interval: 2000, label: `holder ${i} ran ${span} election passes with the seed cut off` })));
      expect(await startsOf(holders, genesisApp) - startedBefore, 'a holder committed to starting the app while the seed is cut off')
        .to.equal(0);

      await env.healPartition([seedIndex], survivors);
      healed = true;
      await env.startDiscovery();
      await waitFor(async () => (await countUp(genesisApp)) >= 1, {
        timeout: 420000, interval: 3000, label: 'a holder starts the app once the seed is back',
      });
      await passesFromNow(holders, electionPasses(genesisApp), 'election');
      expect(await startsOf(holders, genesisApp) - startedBefore, 'holders that committed to starting the app').to.equal(1);
      expect(await countUp(genesisApp), 'holders running the app').to.equal(1);
    } finally {
      // Cleanup must not throw - a cleanup error would replace the test's own
      // failure in the report - but a failed step is the first clue when the
      // NEXT test inherits its debris, so each one says so.
      if (!healed) {
        await env.healPartition([seedIndex], survivors).catch((err) => console.warn(`cleanup: heal failed: ${err.message}`));
        await env.startDiscovery().catch((err) => console.warn(`cleanup: discovery restart failed: ${err.message}`));
      }
    }
  });

  it('does not skip the stagger once FDM has named a primary', async function () {
    this.timeout(600000);
    // The genesis rationale - "every other instance is receiveonly with nothing to
    // sync from" - expires the moment a primary exists. Here FDM names one from the
    // start, so the seed never legitimately holds a live claim, and when FDM later
    // reports nothing the seed must queue behind the index order like any other
    // standby rather than jump it.
    const deployedFrom = holders.map((i) => env.clients[i].getLastEventId());
    await deploy(fdmApp);
    const position = await electionIndexOf(env, fdmApp, seedIndex);
    expect(position, 'fixture: seed must be off index 0').to.be.greaterThan(0);

    const folder = `flux${fdmApp}_${fdmApp}`;
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));
    // Every holder is ready, which is what the election reads as eligible to start.
    // A standby that is not stops each pass as not ready, so it has no decision to
    // make about the primary once FDM goes quiet.
    await Promise.all(holders.map((i, k) => env.clients[i].waitForEvent('syncthing:folderReady',
      (d) => d.folder === folder, 180000, { afterId: deployedFrom[k] })));

    // FDM is named AFTER discovering which holder actually runs it, because that is
    // all FDM ever does - it asks each candidate "are you running the container?"
    // and takes the first yes. Dictating a primary that is not running is a state
    // production cannot reach, and asserting on the fallout tests the fixture.
    await waitFor(async () => (await countUp(fdmApp)) >= 1, {
      timeout: 240000, interval: 3000, label: 'a holder starts the app',
    });
    const runningFlags = await Promise.all(holders.map((i) => isUp(env.clients[i], fdmApp)));
    const primary = holders[runningFlags.indexOf(true)];
    expect(primary, 'fixture: a holder must be running before FDM can name one').to.not.equal(undefined);
    fdmPrimary = primary;
    const identifier = `${fdmApp}_${fdmApp}`;
    const standbys = holders.filter((i) => i !== primary);
    const observedBefore = await Promise.all(standbys.map((i) => electionDecisionCount(env.clients[i], identifier, 'primaryObserved')));
    await electMaster(fdmApp, env.clients[primary].ip);
    // Every standby has read the primary off FDM, so each one knows the node it
    // must not start alongside once FDM goes quiet.
    await Promise.all(standbys.map((i, k) => waitForElectionDecisions(env.clients[i], identifier, 'primaryObserved',
      1, { from: observedBefore[k], timeout: 60000 })));

    // FDM goes quiet while its primary keeps running - its registration lag is a
    // routine state, not an exotic one. The seed must not read that silence as
    // permission to start alongside.
    //
    // The subject is no SECOND holder, not continuous uptime: the reconciler may
    // legitimately blip the primary's container meanwhile (a
    // detached-endpoint recreate, a restart backoff), and its commitment keeps
    // peers deferring throughout, so a dip to zero is recovery in progress, not a
    // second writer. What must then hold is that the same primary comes back.
    //
    // Each standby decides once a pass, and with FDM quiet every decision probes the
    // running primary. The window is HELD_PASSES of those decisions on each standby,
    // counted from the moment FDM goes quiet: a seed that skipped the queue would
    // have started instead of probing, and one queueing to start at the end of its
    // place would have booked it.
    const decisions = (i) => Promise.all(['heldOnPeer', 'started', 'staggerBooked']
      .map((decision) => electionDecisionCount(env.clients[i], identifier, decision)));
    const atQuiet = await Promise.all(standbys.map(decisions));
    await clearMaster(fdmApp);
    await Promise.all(standbys.map((i, k) => waitForElectionDecisions(env.clients[i], identifier, 'heldOnPeer',
      HELD_PASSES, { from: atQuiet[k][0], timeout: 120000 })));
    const settled = await Promise.all(standbys.map(decisions));
    standbys.forEach((i, k) => {
      expect(settled[k][1], `holder ${i} started alongside the running primary`).to.equal(atQuiet[k][1]);
      expect(settled[k][2], `holder ${i} queued to start alongside the running primary`).to.equal(atQuiet[k][2]);
    });
    await waitFor(async () => (await countUp(fdmApp)) === 1, {
      timeout: 180000, interval: 3000, label: 'exactly one holder running',
    });
    expect(await isUp(env.clients[primary], fdmApp), 'the running primary must still be the one up').to.equal(true);
  });

  it('stands a primary down by stopping its container before its folder stops sending', async function () {
    this.timeout(420000);
    // FDM names another holder while the primary runs, as its registration lag can
    // after a primary comes back from a partition. The running primary stands
    // down: its container stops, and only then does its folder stop sending,
    // scanned first so its last writes go out as its own version.
    const identifier = identifierOf(fdmApp);
    const oldPrimary = fdmPrimary;
    expect(oldPrimary, 'fixture: the previous test left no primary running').to.not.equal(undefined);
    const next = holders.find((i) => i !== oldPrimary);
    const from = env.clients[oldPrimary].getLastEventId();

    await electMaster(fdmApp, env.clients[next].ip);

    const ended = await env.clients[oldPrimary].waitForEvent('primaryRole:changed',
      (d) => d.identifier === identifier && d.from === 'demoting', 180000, { afterId: from });
    expect(ended.data.to, `the stand-down did not finish: ${ended.data.reason ?? ''}`).to.equal('standby');
    const seen = env.clients[oldPrimary].getEventBuffer().filter((e) => e.id > from);
    const began = seen.find((e) => e.event === 'primaryRole:changed' && e.data?.identifier === identifier && e.data?.to === 'demoting');
    const stopped = seen.find((e) => e.event === 'reconciler:actuated' && e.data?.identifier === identifier && e.data?.action === 'stopped');
    expect(began, 'the primary never began to stand down').to.not.equal(undefined);
    expect(stopped, 'the container was never stopped').to.not.equal(undefined);
    expect(began.id).to.be.below(stopped.id);
    expect(stopped.id, 'the folder stopped sending before the container stopped').to.be.below(ended.id);

    const state = await getSyncthingState();
    const folder = (state.nodes || []).find((node) => node.ip === subnet.nodeIp(oldPrimary + 1))
      ?.folders?.find((f) => f.id === folderOf(fdmApp));
    expect(folder?.type, 'the stood-down primary\'s folder still sends').to.equal('receiveonly');

    await waitFor(async () => (await countUp(fdmApp)) === 1 && (await isUp(env.clients[next], fdmApp)), {
      timeout: 180000, interval: 3000, label: 'the holder FDM named runs the app, alone',
    });
  });

  it('keeps a promotion that lands while the monitor holds a folder config read before it', async function () {
    this.timeout(480000);
    // The monitor reads every folder's config at the start of a pass and writes
    // the ones it has a change for at the end. A holder promoted in between has a
    // sending folder that the pass read as receiving. The pass changes the fields
    // it owns - here the folder's devices - and must leave the type the role set.
    const identifier = identifierOf(fdmApp);
    const folder = folderOf(fdmApp);
    const target = fdmPrimary;
    expect(target, 'fixture: an earlier test left no stood-down holder').to.not.equal(undefined);
    const targetIp = subnet.nodeIp(target + 1);
    const client = env.clients[target];
    expect((await getFolderConfig(targetIp, folder))?.type, 'fixture: the stood-down holder\'s folder receives').to.equal('receiveonly');

    const from = client.getLastEventId();
    const folderWrites = async () => (await getFolderWrites(targetIp)).filter((w) => w.id === folder);
    let writesBefore;
    await client.holdCheckpoint(BEFORE_FOLDER_WRITE, folder);
    try {
      // Syncthing holding only this node's own device gives the next pass a
      // change to write.
      await setFolderConfig({ ip: targetIp, folder, fields: { devices: [] } });
      await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_FOLDER_WRITE && d.key === folder, 120000, { afterId: from });
      writesBefore = (await folderWrites()).length;

      await electMaster(fdmApp, client.ip);
      const promoted = await client.waitForEvent('primaryRole:changed',
        (d) => d.identifier === identifier && d.from === 'promoting', 300000, { afterId: from });
      expect(promoted.data.to, `the promotion did not finish: ${promoted.data.reason ?? ''}`).to.equal('primary');
      expect((await folderWrites()).slice(writesBefore).map((w) => w.body?.type),
        'fixture: the promotion made the folder send while the pass was held').to.include('sendreceive');
    } finally {
      await client.releaseCheckpoint(BEFORE_FOLDER_WRITE, folder)
        .catch((err) => console.warn(`cleanup: checkpoint release failed: ${err.message}`));
    }

    // The held pass's write is the first since the hold that carries its peers'
    // devices: the promotion's carries a type and the settings, and nothing else.
    const heldWrite = async () => (await folderWrites()).slice(writesBefore).find((w) => (w.body?.devices?.length ?? 0) > 1);
    await waitFor(async () => !!(await heldWrite()), {
      timeout: 120000, interval: 1000, label: 'the held pass writes the folder\'s devices',
    });
    expect((await heldWrite()).body, 'the held pass wrote the type it read before the promotion').to.not.have.property('type');
    const settled = await getFolderConfig(targetIp, folder);
    expect(settled?.type, 'the promotion was undone').to.equal('sendreceive');
    expect(settled?.devices?.length, 'fixture: the held pass wrote its peers\' devices').to.be.above(1);
  });

  // Last in the file: it crashes a holder's FluxOS, and the scenarios above share
  // the holders.
  it('lets the senior standby take over first when FDM names no primary', async function () {
    this.timeout(900000);
    // With FDM silent, a standby counts its turn from the pass that finds the
    // component free, so every standby counts from the primary stopping and the
    // election order decides who comes due first. A turn booked while the primary
    // runs comes due at a time set by when that standby last looked instead.
    //
    // The seed is placed first, so the genesis winner is election index 0 and both
    // standbys are below it: each has a turn to book.
    const deployedFrom = holders.map((i) => env.clients[i].getLastEventId());
    await deploy(lossApp, placementOrderWithSeedAt(holders, 0));
    const folder = folderOf(lossApp);
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));
    await Promise.all(holders.map((i, k) => env.clients[i].waitForEvent('syncthing:folderReady',
      (d) => d.folder === folder, 180000, { afterId: deployedFrom[k] })));
    await waitFor(async () => (await countUp(lossApp)) === 1, {
      timeout: 240000, interval: 3000, label: 'a holder starts the app',
    });
    const primary = holders[(await Promise.all(holders.map((i) => isUp(env.clients[i], lossApp)))).indexOf(true)];
    const order = await Promise.all(holders.map((i) => electionIndexOf(env, lossApp, i)));
    const indexOf = (i) => order[holders.indexOf(i)];
    expect(indexOf(primary), 'fixture: the genesis winner is the senior holder').to.equal(0);
    const [senior, junior] = holders.filter((i) => i !== primary).sort((a, b) => indexOf(a) - indexOf(b));

    // While the primary runs, neither standby books a turn. Watched for as many
    // election passes as the junior's turn spans, plus HELD_PASSES: a turn booked
    // at genesis comes due inside that, finds the primary running, and a standby
    // that books while it runs books again.
    const { masterSlaveStaggerMs, masterSlaveIntervalMs } = loadSharedConfig().fluxapps;
    const span = Math.ceil((indexOf(junior) * masterSlaveStaggerMs) / masterSlaveIntervalMs) + HELD_PASSES;
    const bookedAtRun = await Promise.all([senior, junior].map((i) => electionCount(i, lossApp, 'staggerBooked')));
    const passesAtRun = await Promise.all([senior, junior].map((i) => electionCount(i, lossApp, 'evaluated')));
    await Promise.all([senior, junior].map((i, k) => waitFor(async () => (await electionCount(i, lossApp, 'evaluated')) >= passesAtRun[k] + span, {
      timeout: 300000, interval: 1000, label: `holder ${i} ran ${span} election passes beside the running primary`,
    })));
    for (const [k, i] of [senior, junior].entries()) {
      // eslint-disable-next-line no-await-in-loop
      expect(await electionCount(i, lossApp, 'staggerBooked') - bookedAtRun[k], `holder ${i} booked a turn while the primary runs it`)
        .to.equal(0);
    }

    // The primary dies outright: FluxOS and the container gone, and every
    // standby's syncthing sees its connection drop.
    const startedBefore = await Promise.all([senior, junior].map((i) => electionCount(i, lossApp, 'started')));
    const lostFrom = [senior, junior].map((i) => env.clients[i].getLastEventId());
    const { container } = env.clients[primary];
    await crashFluxos(container, { hold: true });
    try {
      await execInContainer(container, `docker kill ${folder}`);
      await severPeerSync({ folder, deviceIp: env.clients[primary].ip });

      await waitFor(async () => (await electionCount(senior, lossApp, 'started')) > startedBefore[0], {
        timeout: 240000, interval: 1000, label: `the senior standby (holder ${senior}) commits to the start`,
      });
      // The junior's turn comes one place later; it finds the senior running it.
      const juniorPasses = await electionCount(junior, lossApp, 'evaluated');
      const place = Math.ceil(masterSlaveStaggerMs / masterSlaveIntervalMs) + HELD_PASSES;
      await waitFor(async () => (await electionCount(junior, lossApp, 'evaluated')) >= juniorPasses + place, {
        timeout: 240000, interval: 1000, label: `holder ${junior} ran ${place} election passes after the senior committed`,
      });
      expect(await electionCount(junior, lossApp, 'started') - startedBefore[1], `the junior standby (holder ${junior}) started`)
        .to.equal(0);
      const promoted = [senior, junior].filter((i, k) => env.clients[i].getEventBuffer().some((e) => e.id > lostFrom[k]
        && e.event === 'primaryRole:changed' && e.data?.identifier === identifierOf(lossApp) && e.data?.to === 'primary'));
      expect(promoted, 'the standbys that became primary').to.deep.equal([senior]);
    } finally {
      await releaseFluxos(container);
    }
  });
});
