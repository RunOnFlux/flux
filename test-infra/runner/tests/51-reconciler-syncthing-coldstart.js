import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setSyncState, setNoPeerData, resetSyncState,
} from '../framework/syncthing-control.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
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
    }),
    setNoPeerData({ ip: subnet.nodeIp(i + 1), folder }),
  ])));
}

describe('reconciler cold start - fresh multi-node placement, no seeded source', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const rApp = `e2ecoldr${Date.now()}`;
  const gApp = `e2ecoldg${Date.now()}`;
  const holders = [0, 1, 2];
  const seedIndex = holders[0]; // lowest IP among the holders = the deterministic seed

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

    await pinColdStart(holders, `flux${rApp}_${rApp}`);
    await pinColdStart(holders, `flux${gApp}_${gApp}`);

    // place both apps on every holder AT ONCE (installOnNodes installs in parallel) so
    // they all broadcast placement before any confirms leadership - the standoff shape
    await installOnNodes(env, rSpec, holders);
    await installOnNodes(env, gSpec, holders);
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
