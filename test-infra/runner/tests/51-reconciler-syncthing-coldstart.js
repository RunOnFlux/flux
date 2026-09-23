import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getAppContainerStatus, blockPeerAccess, unblockPeerAccess, execInContainer,
} from '../framework/container.js';
import {
  setSyncState, setNoPeerData, resetSyncState,
} from '../framework/syncthing-control.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { syncthingSeedIndex } from '../framework/g-app-placement.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// COLD START: a sync app placed on several nodes AT ONCE, with NO node holding the
// data and NO connected peer that holds it. This is the one shape the forceNonLeader
// suites (36/37/47/...) deliberately do NOT cover: they pre-seed a real running source
// on a peer, so the subject always has someone to defer to.
//
// Here nobody is a source. Every holder broadcasts a placement runningSince the moment
// it is assigned the app (placement, not liveness), and the leader election must NOT
// defer to a peer merely because it carries runningSince - otherwise every holder
// defers to every other and NOBODY seeds (the cold-start standoff: the app deadlocks
// down forever). The election must seed EXACTLY ONE node (the deterministic tiebreaker
// winner = lowest IP) when no peer genuinely holds the data.
//
//   - r: the seed's reconciler starts its container directly.
//   - g: the seed's folder flips to sendreceive; masterSlave then starts it once the
//        FDM elects it primary.

const subnet = getSubnetConfig();

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

async function countUp(env, indices, appName) {
  const ups = await Promise.all(indices.map((i) => isUp(env.clients[i], appName)));
  return ups.filter(Boolean).length;
}

// pin a folder to a true cold-start shape on every holder: empty global of its own
// and no connected peer holding the data (set BEFORE install so the first election
// evaluation sees it, not the stub's default phantom-synced peer)
async function pinColdStart(holders, folder) {
  await Promise.all(holders.map((i) => Promise.all([
    setSyncState({
      ip: subnet.nodeIp(i + 1), folder, state: 'idle', globalBytes: 0, inSyncBytes: 0,
      // Honest only for a bare g:/r: app. A component declaring an f:/m:/ml: mount has
      // FluxOS scaffolding on its volume that a real daemon counts here, and the stub
      // cannot see a disk - so those shapes belong on syncthing: 'binary', not here.
      receiveOnlyChangedFiles: 0,
    }),
    setNoPeerData({ ip: subnet.nodeIp(i + 1), folder }),
  ])));
}

// One holder carries the owner's data, declared the way seedSyncScopedData declares it:
// the ENTRIES, not a count, because localHoldings totals the entry list and excludes the
// scaffolding in it by type and by name. Written after pinColdStart, which it overwrites
// for this one node.
async function pinHolding(index, folder, bytes) {
  const modified = new Date().toISOString();
  await setSyncState({
    ip: subnet.nodeIp(index + 1),
    folder,
    state: 'idle',
    globalBytes: 0,
    inSyncBytes: 0,
    localChanged: [
      {
        name: 'appdata', type: 'FILE_INFO_TYPE_DIRECTORY', size: 128, deleted: false, modified,
      },
      {
        name: 'appdata/seed-data', type: 'FILE_INFO_TYPE_FILE', size: bytes, deleted: false, modified,
      },
    ],
  });
  await setNoPeerData({ ip: subnet.nodeIp(index + 1), folder });
}

describe('reconciler cold start - fresh multi-node placement, no seeded source', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const rApp = `e2ecoldr${Date.now()}`;
  const gApp = `e2ecoldg${Date.now()}`;
  const claimApp = `e2ecoldclaim${Date.now()}`;
  const splitApp = `e2ecoldsplit${Date.now()}`;
  const holders = [0, 1, 2];
  // Asked rather than assumed. `holders[0]` is the lowest address only while the
  // list happens to be written in order, and it silently names the wrong node
  // for the first fixture that is not.
  const seedIndex = syncthingSeedIndex(holders);
  // The holder the address order would pick LAST, so that seeding it is a decision the
  // address order cannot also have produced. The subnet's last octets are .10 upwards,
  // which order the same way under the product's string compare and this helper's
  // numeric one - so the two cannot disagree about who would otherwise have won.
  const claimHolder = [...holders].sort((a, b) => (subnet.nodeIp(a + 1) < subnet.nodeIp(b + 1) ? -1 : 1)).pop();
  const claimBytes = 5821604997;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    await pushImage(rApp, 'v1');
    await pushImage(gApp, 'v1');
    const rSpec = await buildSeedableSyncthingApp({ name: rApp, mode: 'r' });
    const gSpec = await buildSeedableSyncthingApp({ name: gApp, mode: 'g' });

    await pushImage(claimApp, 'v1');
    const claimSpec = await buildSeedableSyncthingApp({ name: claimApp, mode: 'r' });

    await pinColdStart(holders, `flux${rApp}_${rApp}`);
    await pinColdStart(holders, `flux${gApp}_${gApp}`);
    await pinColdStart(holders, `flux${claimApp}_${claimApp}`);
    // Declared BEFORE install, like the cold start itself, so the first election
    // evaluation already has a field where one candidate holds the owner's data.
    await pinHolding(claimHolder, `flux${claimApp}_${claimApp}`, claimBytes);

    // place both apps on every holder AT ONCE (installOnNodes installs in parallel) so
    // they all broadcast placement before any confirms leadership - the standoff shape
    await installOnNodes(env, rSpec, holders);
    await installOnNodes(env, gSpec, holders);
    await installOnNodes(env, claimSpec, holders);
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('r: elects exactly one seed and starts it (no deadlock, no split-brain)', async function () {
    this.timeout(150000);
    // With no source the election must seed someone; a deadlock leaves this at 0 and
    // times out here.
    await waitFor(
      async () => (await countUp(env, holders, rApp)) >= 1,
      { timeout: 90000, interval: 3000, label: 'at least one holder seeds the cold-start r: app (no deadlock)' },
    );
    // settle and confirm EXACTLY one seed - the non-elected holders have an empty
    // global and no connected source, so they must wait (no second seed, no removal)
    await new Promise((r) => { setTimeout(r, 12000); });
    expect(await countUp(env, holders, rApp)).to.equal(1);
    // the seed is the deterministic tiebreaker winner (lowest IP)
    expect(await isUp(env.clients[seedIndex], rApp)).to.equal(true);
  });

  // THE ELECTION'S OTHER QUESTION. The two tests above are a field where nobody holds
  // anything and any candidate is as good a seed as another, which the address order
  // answers. This is the field where one candidate holds the owner's data: seeding
  // anyone else publishes an empty folder over it, and the full one's files then become
  // local changes that a later revert deletes.
  //
  // Everything between the claim and the outcome is the product's: the holder totals its
  // own local-change list, publishes what it holds, and each peer asks for it over the
  // signed endpoint and ranks the field on the answers. A unit test reaches the
  // comparator with a claims object handed to it; only a fleet reaches it through a
  // node's own reading of its volume and a peer's reading of that node.
  it('r: the holder seeds, against the address the field would otherwise elect', async function () {
    this.timeout(180000);
    // The premise, asserted so a fixture that stops being divergent fails here rather
    // than passing for the wrong reason: seeding the holder has to be a different
    // answer from seeding the lowest address.
    expect(claimHolder, 'the holder IS the address-order winner, so this proves nothing').to.not.equal(seedIndex);

    await waitFor(
      async () => (await countUp(env, holders, claimApp)) >= 1,
      { timeout: 90000, interval: 3000, label: 'a holder seeds the cold-start r: app' },
    );
    // Settle, then read the whole field: a second seed is a split, and the wrong seed is
    // an empty volume published over the owner's data.
    await new Promise((r) => { setTimeout(r, 12000); });
    expect(await countUp(env, holders, claimApp)).to.equal(1);
    expect(
      await isUp(env.clients[claimHolder], claimApp),
      'the node holding the data did not seed',
    ).to.equal(true);
    expect(
      await isUp(env.clients[seedIndex], claimApp),
      'the lowest address seeded over a peer that holds the owner data',
    ).to.equal(false);
  });

  // THE ELECTION'S THIRD QUESTION, and the one the two above cannot ask: what happens
  // when the field does not look the same from every node.
  //
  // The ranking is used only when every candidate's claim can be compared, and that is
  // decided from the answers ONE node received. A candidate silent to one node and
  // answering another puts the two on different rules over the same field - the address
  // order on one, the ranking on the other - and two rules elect two winners, both of
  // which flip the same folder to sendreceive. The address order does not have that
  // property, which is why it is still the fallback.
  //
  // One directional block is the whole fixture: the holder stays visible to everyone, so
  // the ranking still has a right answer, and only the address-order winner is missing a
  // claim it needs to reach it.
  it('r: elects one seed even when a candidate is silent to only one node', async function () {
    this.timeout(300000);
    const folder = `flux${splitApp}_${splitApp}`;
    // The candidate to silence is neither the address-order winner nor the holder: it
    // has to be a claim whose ABSENCE changes which rule the winner applies, without
    // changing what the ranking would answer for anyone who can see the whole field.
    const silenced = holders.find((i) => i !== seedIndex && i !== claimHolder);
    expect(silenced, 'the fixture needs a third holder to silence').to.not.equal(undefined);

    await pushImage(splitApp, 'v1');
    const splitSpec = await buildSeedableSyncthingApp({ name: splitApp, mode: 'r' });
    await pinColdStart(holders, folder);
    await pinHolding(claimHolder, folder, claimBytes);

    // Refused, not dropped: a refusal fails the probe at once, so the divergence is in
    // place for the first election evaluation rather than a timeout later. Applied to
    // the silenced node's INPUT from the seed only, so every other pair still talks and
    // the seed keeps its own connectivity floor against the rest of the fleet.
    await blockPeerAccess(env.clients[silenced].container, [subnet.nodeIp(seedIndex + 1)], 16127);
    try {
      // THE DIVERGENCE ITSELF, ASSERTED. One seed is also what a run where the rule
      // never took effect produces, and that run would pass this test while proving
      // nothing. Both directions are checked, because a block that stopped everyone
      // would be a partition rather than the split view under test.
      const askSilenced = async (from) => execInContainer(
        env.clients[from].container,
        `curl -s -o /dev/null -w '%{http_code}' -m 4 http://${subnet.nodeIp(silenced + 1)}:16127/apps/promotedfolders`,
      );
      const fromSeed = await askSilenced(seedIndex);
      const fromHolder = await askSilenced(claimHolder);
      expect(fromSeed.stdout.trim(), 'the seed can still reach the silenced candidate').to.not.equal('200');
      expect(fromHolder.stdout.trim(), 'the holder cannot reach the silenced candidate either, so this is a partition').to.equal('200');

      await installOnNodes(env, splitSpec, holders);
      await waitFor(
        async () => (await countUp(env, holders, splitApp)) >= 1,
        { timeout: 120000, interval: 3000, label: 'a holder seeds the split-view r: app' },
      );
      // Settle past LEADER_CONFIRM_COUNT so a second winner has confirmed too, then read
      // the whole field at once. Two seeds on one folder is the split this election
      // exists to prevent, and syncthing has no way to merge them.
      await new Promise((r) => { setTimeout(r, 15000); });
      const up = await countUp(env, holders, splitApp);
      expect(up, 'more than one node seeded the same folder from one field').to.equal(1);
    } finally {
      await unblockPeerAccess(env.clients[silenced].container, [subnet.nodeIp(seedIndex + 1)], 16127);
    }
  });

  it('g: the seed reaches sendreceive and starts once FDM-elected (no deadlock)', async function () {
    this.timeout(150000);
    // The cold-start seed (lowest IP) flips its g: folder to sendreceive even though no
    // peer serves the data; masterSlave then starts it when the FDM elects it primary.
    // Without the seed, the folder never reaches sendreceive and masterSlave waits forever.
    await electMaster(gApp, env.clients[seedIndex].ip);
    await waitFor(
      () => isUp(env.clients[seedIndex], gApp),
      { timeout: 90000, interval: 3000, label: 'the FDM-elected seed starts the cold-start g: app' },
    );
    // standbys were never seeded and are not the FDM primary - they stay down
    expect(await countUp(env, holders.slice(1), gApp)).to.equal(0);
  });
});
