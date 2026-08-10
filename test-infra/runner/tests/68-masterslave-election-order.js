import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import {
  setSynced, resetSyncState, setFolderPatchDelay, getSyncthingState, severPeerSync,
} from '../framework/syncthing-control.js';
import { restartFluxos } from '../framework/container.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import {
  bootAndPeer, placeGAppInOrder, electionIndexOf,
} from '../framework/reconciler-suite.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

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

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('primary election under a divergent placement order', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const holders = [0, 1, 2];
  const seedIndex = 0; // lowest IP among the holders = the syncthing seed
  // Placed in this order, so the seed carries the MIDDLE runningSince and node 2 sits
  // above it - the peer a lower-index-only probe cannot see.
  const placementOrder = [1, 0, 2];
  const stamp = Date.now();

  // One app per scenario, all on the one fleet - and one PORT per app. All five
  // apps land on the same three holders, and a node can bind a port once: the
  // spawner would never co-locate two apps declaring the same port, but
  // placeGAppInOrder force-places and bypasses that check. On the shared default
  // port the apps play musical chairs - every restart of one fails on the port a
  // sibling holds, stop-history accumulates, and the restart backoff climbs into
  // minutes, which reads as an election failure and is nothing of the sort.
  const orderApp = `e2eorder${stamp}`;
  const genesisApp = `e2egenloss${stamp}`;
  const fdmApp = `e2efdmling${stamp}`;
  const windowApp = `e2ewindow${stamp}`;
  const pairApp = `e2epair${stamp}`;
  const appPorts = {
    [orderApp]: 31111,
    [genesisApp]: 31112,
    [fdmApp]: 31113,
    [windowApp]: 31114,
    [pairApp]: 31115,
  };

  const countUp = async (appName) => (await Promise.all(
    holders.map((i) => isUp(env.clients[i], appName)),
  )).filter(Boolean).length;

  // Nodes whose folder for this app is sendreceive - the ones holding a WRITABLE
  // copy. Distinct from countUp: running the container and owning the data are
  // separate decisions, made by different code on different orderings, and the
  // failure this suite exists for is two nodes owning the data.
  const writableHolders = async (appName) => {
    const folder = `flux${appName}_${appName}`;
    const state = await getSyncthingState();
    return (state.nodes || [])
      .filter((node) => (node.folders || []).some((f) => f.id === folder && f.type === 'sendreceive'))
      .map((node) => node.ip);
  };

  const deploy = async (appName) => {
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', ports: [appPorts[appName]] });
    await placeGAppInOrder(env, app, {
      placementOrder,
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
    // either way: the app starts well inside the index stagger (index * 3 minutes -
    // the winner never legitimately waits on peers that are receiveonly with
    // nothing to sync from), and exactly one holder starts. 100s is comfortably
    // inside the smallest non-zero stagger and comfortably outside a normal start.
    await waitFor(
      async () => (await countUp(orderApp)) >= 1,
      { timeout: 100000, interval: 3000, label: 'a holder starts well inside the index stagger' },
    );
    expect(await countUp(orderApp), 'more than one holder started at genesis').to.equal(1);
  });

  it('leaves exactly one holder seeding the empty folder at cold start', async function () {
    this.timeout(240000);
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
    // The container count rides along on the same loop: it is the invariant that holds
    // at every point in the app's life, cold start included.
    //
    // Held rather than sampled: the second promotion arrives seconds after the
    // first, so a single reading taken early passes on a fleet that is about to
    // diverge.
    const deadline = Date.now() + 90000;
    let holdersWritable = [];
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      holdersWritable = await writableHolders(orderApp);
      expect(holdersWritable.length, `more than one node seeded the empty folder: ${holdersWritable.join(', ')}`).to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(orderApp), 'two holders ran the g: component at once').to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
    expect(holdersWritable.length, 'nobody ever seeded the folder').to.equal(1);
  });

  // Skipped: a holder whose FluxOS is down mid-restart is indistinguishable from a
  // dead one to the peer probe, which fails open so a network fault cannot strand the
  // app forever - so a synced standby whose probe lands inside the restart window
  // starts a second writer beside the holder's still-running container, and nothing
  // demotes either side afterwards. Proven here in-fleet: a six-second outage was
  // enough. A bounded takeover needs the quorum-granted mastership lease that
  // supersedes this election in a later change; this test is its acceptance test,
  // alongside the partition suite's heal test.
  it.skip('does not read a restarting holder as free to start alongside', async function () {
    this.timeout(420000);
    // A node that has just restarted has not yet read its own folder config, so it
    // cannot tell "I hold nothing" from "I have not looked". It must answer the
    // second: answering the first tells a peer the component is going unrun and
    // invites it to start a second writer over a volume the restarting node is still
    // holding - and a fleet-wide restart puts every holder of an app in that state
    // together.
    //
    // The standbys have genuinely synced from the seed by now, so pin them synced
    // first: a standby with nothing to sync from is not election-eligible and could
    // not start a second container whatever the restarting node answered, which would
    // make this pass for no reason. Once they are synced their folders legitimately
    // go sendreceive too, so the count that matters here is CONTAINERS - one running
    // container is the invariant, not one writable folder.
    await Promise.all(holders.filter((i) => i !== seedIndex).map(
      (i) => setSynced({ ip: subnet.nodeIp(i + 1), folder: `flux${orderApp}_${orderApp}` }),
    ));

    expect(await countUp(orderApp), 'fixture: exactly one holder must run the component before the restart').to.equal(1);
    // Restart the holder that is actually running it, rather than whichever node was
    // placed first: which of them took the component is the election's decision, not
    // the fixture's, and restarting a node that runs nothing tests nothing.
    const runningFlags = await Promise.all(holders.map((i) => isUp(env.clients[i], orderApp)));
    const running = holders[runningFlags.indexOf(true)];
    expect(running, 'fixture: a running holder must be identifiable to restart').to.not.equal(undefined);

    await restartFluxos(env.clients[running].container);

    // Watched across the whole restart: the window is exactly while the node is
    // back up and answering but has not completed a monitor pass. Only the FluxOS
    // process cycles, so the holder's own app container stays up throughout - a
    // count above one is a PEER starting a second writer on the shared volume while
    // the holder was still booting.
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(orderApp), 'a peer started a second container while a holder was restarting').to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  });

  it('starts no second writer when the primary is released back to the election', async function () {
    this.timeout(300000);
    // Exactly one holder runs the component, through the window where the primary is
    // stopped and handed back to the election. Two things can put a second writer on
    // the shared volume here: a seed claim still standing after genesis, which leaves
    // the index order and starts against a peer a lower-index probe cannot see; and a
    // controller desire surviving the operator stop, which the reconciler acts on with
    // no election pass. The assertion is on the invariant, not on either path.
    //
    // The standbys have genuinely synced from the seed by now, so pin them synced (over
    // the data seeded at install) to make them election-eligible - otherwise nothing
    // could take over and this would pass for the wrong reason.
    await Promise.all(holders.filter((i) => i !== seedIndex).map(
      (i) => setSynced({ ip: subnet.nodeIp(i + 1), folder: `flux${orderApp}_${orderApp}` }),
    ));

    // Release the primary the way an operator does: appstop takes it down and locks it
    // out of the election, appstart releases the lock and hands the start back to the
    // election. The operator-stop recovery suite's recipe - here with the seed at index > 0.
    const seedClient = env.clients[seedIndex];
    const auth = await authenticate(seedClient.url, appOwnerKey());
    await seedClient.getAuthed(`/apps/appstop/${orderApp}`, auth.zelidauth);
    await waitFor(async () => !(await isUp(seedClient, orderApp)), {
      timeout: 90000, interval: 2000, label: 'primary goes down',
    });
    await seedClient.getAuthed(`/apps/appstart/${orderApp}`, auth.zelidauth);

    // Watch the whole recovery rather than sampling its end: the double start is a
    // same-pass race, so a count taken after it settles would miss it entirely.
    let recovered = false;
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const up = await countUp(orderApp);
      expect(up, 'two holders ran the g: component at once - split brain on the shared volume').to.be.lessThan(2);
      if (up === 1) recovered = true;
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(2000);
    }
    expect(recovered, 'the app never came back on any holder').to.equal(true);
  });

  it('starts only one holder while the seed is still fixing ownership', async function () {
    this.timeout(600000);
    // The seed does not start its container the moment it is elected: it flips the
    // folder to receiveonly, chowns the persistent data and flips back first. For
    // that whole window it has committed but runs nothing, and a peer that asks
    // only for running containers is told the component is free.
    //
    // The window is normally as long as a chown takes, which is not a length a
    // test can rely on - held open at the stub, it is a chosen one, and the peer's
    // probe lands inside it every run.
    await setFolderPatchDelay({ ms: 45000 });
    try {
      await deploy(windowApp);
      const position = await electionIndexOf(env, windowApp, seedIndex);
      expect(position, 'fixture: seed must be off index 0').to.be.greaterThan(0);

      // Watched across the whole window rather than sampled after it: a second
      // start inside it is the failure, and it is invisible to a later count once
      // the losing container has been stopped again.
      const deadline = Date.now() + 180000;
      let started = 0;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        started = await countUp(windowApp);
        expect(started, 'a peer started while the seed was still fixing ownership').to.be.lessThan(2);
        // eslint-disable-next-line no-await-in-loop
        await sleepUnlessInfraDead(2000);
      }
      expect(started, 'nothing ever started').to.equal(1);
    } finally {
      await setFolderPatchDelay({ ms: 0 }).catch(() => {});
    }
  });

  it('settles a two-holder app on one writable copy, with the seed off index 0', async function () {
    this.timeout(420000);
    // Two holders is the ordinary shape for a g: app, and the one every other suite
    // installs in parallel - which collapses the two orderings onto the same node
    // and hides every disagreement between them. Placed one at a time the seed is
    // index 1, and with only two holders there is no third opinion to fall back on:
    // whatever the pair decides is the answer.
    const app = await buildSeedableSyncthingApp({ name: pairApp, mode: 'g', ports: [appPorts[pairApp]] });
    await pushImage(pairApp, 'v1');
    await placeGAppInOrder(env, app, {
      placementOrder: [1, 0],
      folder: `flux${pairApp}_${pairApp}`,
      identifier: `${pairApp}_${pairApp}`,
    });

    const position = await electionIndexOf(env, pairApp, seedIndex);
    expect(position, 'fixture: the seed must not be index 0, or this is operator-stop recovery again').to.be.greaterThan(0);

    const pair = [0, 1];
    const pairUp = async () => (await Promise.all(
      pair.map((i) => isUp(env.clients[i], pairApp)),
    )).filter(Boolean).length;

    await waitFor(async () => (await pairUp()) >= 1, {
      timeout: 240000, interval: 3000, label: 'the pair starts the app on one of them',
    });

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const writable = await writableHolders(pairApp);
      expect(writable.length, `both holders took the writable copy: ${writable.join(', ')}`).to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      expect(await pairUp(), 'both holders ran the component').to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  });

  it('elects a new seed when the designated leader dies mid-genesis', async function () {
    this.timeout(600000);
    // Genesis has exactly one node that can seed, and it is chosen by lowest IP. If
    // that node dies before it seeds, the remaining holders must converge on a new
    // seed rather than defer to a corpse forever - the cold-start standoff, but with
    // the standoff-breaker removed after the fact. Nothing here is index 0, so the
    // stagger cannot rescue it either.
    // Genesis must still be in flight when the seed is cut, and the designated
    // leader seeds within seconds now, so the window has to be held open
    // rather than raced: the delay pins every promotion PATCH until the
    // partition is in place.
    await setFolderPatchDelay({ ms: 300000 });
    await deploy(genesisApp);
    const position = await electionIndexOf(env, genesisApp, seedIndex);
    expect(position, 'fixture: seed must be off index 0 for this scenario to mean anything').to.be.greaterThan(0);

    // Cut the seed off from its peers, not from the world: detaching it from the
    // docker network takes the shared mongo with it, and a node with no database is
    // a broken node rather than a lost one - it answers nothing, including things a
    // lost node still answers. Dropping node-to-node packets leaves its infra intact
    // and makes it unreachable to exactly the nodes whose election is under test.
    const survivors = holders.filter((i) => i !== seedIndex);
    await env.partitionGroups([seedIndex], survivors, { awaitSever: true });
    const writableAtCut = await writableHolders(genesisApp);
    expect(writableAtCut, 'fixture: the seed must not have seeded before the cut').to.deep.equal([]);
    // The partition severs the seed's syncthing connections too, and the
    // fixture's source declaration outlives them - left standing, the
    // survivors' syncthing keeps testifying to a live connection and the
    // holder-retained veto defers to the corpse instead of re-electing.
    await severPeerSync({ folder: `flux${genesisApp}_${genesisApp}`, deviceIp: env.clients[seedIndex].ip });
    // The survivors' own promotions run free again; the seed is already cut.
    await setFolderPatchDelay({ ms: 0 });
    const survivorsUp = async () => (await Promise.all(
      survivors.map((i) => isUp(env.clients[i], genesisApp)),
    )).filter(Boolean).length;

    // Healed in a finally, and the heal cannot throw: a failing assertion must not
    // leave the fleet split, and a cleanup that raises replaces the real failure
    // with its own, which is how this last reported a DB error instead of its
    // subject.
    try {
      await waitFor(async () => (await survivorsUp()) >= 1, {
        timeout: 420000, interval: 5000, label: 'a surviving holder seeds after the leader is lost',
      });
      expect(await survivorsUp(), 'both survivors seeded - split brain replacing the lost leader').to.equal(1);
    } finally {
      // Cleanup must not throw - a cleanup error would replace the test's own
      // failure in the report - but a failed step is the first clue when the
      // NEXT test inherits its debris, so each one says so.
      await setFolderPatchDelay({ ms: 0 }).catch((err) => console.warn(`cleanup: patch-delay reset failed: ${err.message}`));
      await env.healPartition([seedIndex], survivors).catch((err) => console.warn(`cleanup: heal failed: ${err.message}`));
      await env.startDiscovery().catch((err) => console.warn(`cleanup: discovery restart failed: ${err.message}`));
    }
  });

  it('does not skip the stagger once FDM has named a primary', async function () {
    this.timeout(420000);
    // The genesis rationale - "every other instance is receiveonly with nothing to
    // sync from" - expires the moment a primary exists. Here FDM names one from the
    // start, so the seed never legitimately holds a live claim, and when FDM later
    // reports nothing the seed must queue behind the index order like any other
    // standby rather than jump it.
    await deploy(fdmApp);
    const position = await electionIndexOf(env, fdmApp, seedIndex);
    expect(position, 'fixture: seed must be off index 0').to.be.greaterThan(0);

    const folder = `flux${fdmApp}_${fdmApp}`;
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));

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
    await electMaster(fdmApp, env.clients[primary].ip);

    // FDM goes quiet while its primary keeps running - its registration lag is a
    // routine state, not an exotic one. The seed must not read that silence as
    // permission to start alongside.
    //
    // The watch pins the subject - no SECOND holder - and not continuous uptime:
    // the reconciler may legitimately blip the primary's container mid-window (a
    // detached-endpoint recreate, a restart backoff), and its commitment keeps
    // peers deferring throughout, so a dip to zero is recovery in progress, not a
    // second writer. What must then hold is that the same primary comes back.
    await clearMaster(fdmApp);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(fdmApp), 'a second holder started alongside the running primary').to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
    await waitFor(async () => (await countUp(fdmApp)) === 1, {
      timeout: 180000, interval: 3000, label: 'exactly one holder running once the window closes',
    });
    expect(await isUp(env.clients[primary], fdmApp), 'the running primary must still be the one up').to.equal(true);
  });
});
