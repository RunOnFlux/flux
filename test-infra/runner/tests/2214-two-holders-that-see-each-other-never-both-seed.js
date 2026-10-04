import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getAppContainerStatus, blockPeerAccess, unblockPeerAccess, execInContainer,
} from '../framework/container.js';
import {
  setSyncState, setNoPeerData, resetSyncState, getFolderConfig,
} from '../framework/syncthing-control.js';
import { resetFdm, electMaster } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { syncthingSeedIndex } from '../framework/g-app-placement.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Two holders of a cold-start app, each elected to seed it by its own view of the
// field, never both seed it - however their decisions fall in time.
//
// The field is split the way suite 51's third case splits it: one holder refuses the
// lowest address's calls, so the lowest address is missing a claim and elects itself
// by address order, while the holder of the owner's data sees every claim and elects
// itself by holdings. The two contenders can reach each other throughout; only the
// third holder is silent, and only to one of them.
//
// Each case holds one or both contenders at a checkpoint in their seed decision, so
// the order of the two decisions is chosen rather than raced for:
//   - before the decision reads its peers (syncthing:beforeSeedDecision), and
//   - after the read, before it records that it seeds (syncthing:beforeSeedRecord).

const subnet = getSubnetConfig();
const BEFORE_DECISION = 'syncthing:beforeSeedDecision';
const BEFORE_RECORD = 'syncthing:beforeSeedRecord';
const ELECTION = 'masterSlave:beforeDecision';
const SETTLE_PASSES = 3;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

// A cold start on every holder: no index of its own and no connected peer holding
// the data, set before install so the first election sees it.
async function pinColdStart(holders, folder) {
  await Promise.all(holders.map((i) => Promise.all([
    setSyncState({
      ip: subnet.nodeIp(i + 1), folder, state: 'idle', globalBytes: 0, inSyncBytes: 0, receiveOnlyChangedFiles: 0,
    }),
    setNoPeerData({ ip: subnet.nodeIp(i + 1), folder }),
  ])));
}

// The owner's data on one holder, declared as entries, the way localHoldings reads it.
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

describe('two holders that can reach each other never both seed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  const holders = [0, 1, 2];
  const lowest = syncthingSeedIndex(holders);
  const holder = [...holders].sort((a, b) => (subnet.nodeIp(a + 1) < subnet.nodeIp(b + 1) ? -1 : 1)).pop();
  const silenced = holders.find((i) => i !== lowest && i !== holder);
  const contenders = [lowest, holder];
  const holdingBytes = 5821604997;

  const client = (i) => env.clients[i];
  const runners = async (appName) => {
    const up = await Promise.all(holders.map((i) => isUp(client(i), appName)));
    return holders.filter((_, k) => up[k]);
  };
  const decisions = (i, folder, outcome) => client(i).getDecisionCount('syncthing:seedDecision', folder, outcome);
  const folderPasses = (i, folder) => client(i).getDecisionCount('syncthing:folderPass', folder, 'evaluated');

  // A fresh cold-start app on the split field, with the given checkpoints held on the
  // given nodes before it is installed, so its first decision meets them.
  const placeSplitApp = async (tag, holds, mode = 'r') => {
    const name = `e2eseed${tag}${stamp}`;
    const folder = `flux${name}_${name}`;
    await pushImage(name, 'v1');
    const spec = await buildSeedableSyncthingApp({ name, mode });
    await pinColdStart(holders, folder);
    await pinHolding(holder, folder, holdingBytes);
    const from = Object.fromEntries(holders.map((i) => [i, client(i).getLastEventId()]));
    await Promise.all(holds.map(([i, checkpoint, key = folder]) => client(i).holdCheckpoint(checkpoint, key)));
    await installOnNodes(env, spec, holders);
    return { name, folder, from };
  };
  const heldAt = (i, checkpoint, app) => client(i).waitForEvent(
    'checkpoint:held',
    (d) => d.name === checkpoint && d.key === app.folder,
    240000,
    { afterId: app.from[i] },
  );
  const release = (i, checkpoint, app) => client(i).releaseCheckpoint(checkpoint, app.folder);

  // Exactly the holder runs the app, asserted on every poll until every holder has
  // run SETTLE_PASSES more folder passes over it: a second seed fails at once.
  const settlesOnTheHolder = async (app) => {
    await waitHolding(async () => {
      const now = await runners(app.name);
      expect(now.length, `more than one holder seeded ${app.name}: ${now.join(', ')}`).to.be.at.most(1);
      return now.length === 1;
    }, { timeout: 240000, interval: 1000, label: `a holder seeds ${app.name}` });
    const from = await Promise.all(holders.map((i) => folderPasses(i, app.folder)));
    await waitHolding(async () => {
      const now = await runners(app.name);
      expect(now, `who seeded ${app.name}`).to.deep.equal([holder]);
      const passes = await Promise.all(holders.map((i) => folderPasses(i, app.folder)));
      return passes.every((n, k) => n >= from[k] + SETTLE_PASSES);
    }, { timeout: 120000, interval: 1000, label: `${SETTLE_PASSES} folder passes on every holder of ${app.name}` });
    // The contender that did not seed goes on as a standby: receiving, not running.
    expect((await getFolderConfig(subnet.nodeIp(lowest + 1), app.folder))?.type, 'the lowest address\'s folder').to.equal('receiveonly');
  };

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    // Refused, not dropped, and only the silenced holder's input from the lowest
    // address: every other pair still talks, the two contenders included.
    await blockPeerAccess(client(silenced).container, [subnet.nodeIp(lowest + 1)], 16127);
    const ask = (from, to) => execInContainer(
      client(from).container,
      `curl -s -o /dev/null -w '%{http_code}' -m 4 http://${subnet.nodeIp(to + 1)}:16127/apps/promotedfolders`,
    );
    expect((await ask(lowest, silenced)).stdout.trim(), 'fixture: the lowest address can still reach the silenced holder').to.not.equal('200');
    expect((await ask(holder, silenced)).stdout.trim(), 'fixture: the holder cannot reach the silenced holder either').to.equal('200');
    expect((await ask(lowest, holder)).stdout.trim(), 'fixture: the contenders cannot reach each other').to.equal('200');
    expect((await ask(holder, lowest)).stdout.trim(), 'fixture: the contenders cannot reach each other').to.equal('200');
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all(holders.map((i) => client(i)?.releaseAllCheckpoints().catch(() => {})));
    if (env) await unblockPeerAccess(client(silenced).container, [subnet.nodeIp(lowest + 1)], 16127).catch(() => {});
    await env?.teardown();
  });

  it('seeds once, on the holder, when both contenders decide at the same moment', async function () {
    this.timeout(600000);
    const app = await placeSplitApp('same', contenders.map((i) => [i, BEFORE_DECISION]));
    await Promise.all(contenders.map((i) => heldAt(i, BEFORE_DECISION, app)));

    await Promise.all(contenders.map((i) => release(i, BEFORE_DECISION, app)));

    await settlesOnTheHolder(app);
    expect(await decisions(holder, app.folder, 'seeded'), 'the holder recorded its seed').to.be.at.least(1);
    expect(await decisions(lowest, app.folder, 'yieldedToRank'), 'the lowest address yielded to the holder\'s claim').to.be.at.least(1);
    expect(await decisions(lowest, app.folder, 'seeded'), 'the lowest address recorded a seed').to.equal(0);
  });

  it('seeds once, on the holder, when the lowest address decides while the holder is deciding', async function () {
    this.timeout(600000);
    const app = await placeSplitApp('lowfirst', contenders.map((i) => [i, BEFORE_DECISION]));
    await Promise.all(contenders.map((i) => heldAt(i, BEFORE_DECISION, app)));

    // The holder stays held mid-decision; the lowest address goes on and decides,
    // on passes of its own, and must see it.
    await release(lowest, BEFORE_DECISION, app);
    const from = await folderPasses(lowest, app.folder);
    await waitHolding(async () => {
      expect(await runners(app.name), 'a holder seeded while the holder of the data was deciding').to.deep.equal([]);
      return (await folderPasses(lowest, app.folder)) >= from + SETTLE_PASSES;
    }, { timeout: 120000, interval: 1000, label: `${SETTLE_PASSES} passes on the lowest address while the holder decides` });
    expect(await decisions(lowest, app.folder, 'yieldedToRank'), 'the lowest address yielded to the deciding holder').to.be.at.least(1);

    await release(holder, BEFORE_DECISION, app);
    await settlesOnTheHolder(app);
    expect(await decisions(lowest, app.folder, 'seeded')).to.equal(0);
  });

  it('seeds once, on the holder, when the holder has decided before the lowest address reads it', async function () {
    this.timeout(600000);
    const app = await placeSplitApp('holderfirst', [[lowest, BEFORE_DECISION]]);
    await heldAt(lowest, BEFORE_DECISION, app);

    await waitFor(async () => (await runners(app.name)).includes(holder), {
      timeout: 120000, interval: 1000, label: 'the holder seeds while the lowest address is held',
    });

    await release(lowest, BEFORE_DECISION, app);
    await settlesOnTheHolder(app);
    expect(await decisions(lowest, app.folder, 'yieldedToDecided'), 'the lowest address yielded to the holder\'s decision').to.be.at.least(1);
    expect(await decisions(lowest, app.folder, 'seeded')).to.equal(0);
  });

  it('decides nothing when its decision took longer than a pass, and seeds on the next', async function () {
    this.timeout(600000);
    const app = await placeSplitApp('slow', [[holder, BEFORE_RECORD]]);
    await heldAt(holder, BEFORE_RECORD, app);

    // Held past its read for longer than a pass: two of the lowest address's own
    // folder passes, each a full pass apart.
    const from = await folderPasses(lowest, app.folder);
    await waitFor(async () => (await folderPasses(lowest, app.folder)) >= from + 2, {
      timeout: 120000, interval: 1000, label: 'two passes on the lowest address while the holder is held',
    });
    expect(await runners(app.name), 'a holder seeded while the holder was still deciding').to.deep.equal([]);

    await release(holder, BEFORE_RECORD, app);
    await waitFor(async () => (await decisions(holder, app.folder, 'overBudget')) >= 1, {
      timeout: 60000, interval: 1000, label: 'the holder decides nothing on its slow pass',
    });
    await settlesOnTheHolder(app);
  });

  // A single-writer app's seed decision is the folder monitor's, and who runs the
  // app is the election's. Decided here and then run elsewhere, the decision is
  // withdrawn, so a holder reaching a cold start later does not stand aside for a
  // node that will never seed: the lowest address, standing aside for the holder's
  // decision, seeds it as the primary FDM names.
  it('withdraws a seed decision of a single-writer app once the election names another node', async function () {
    this.timeout(600000);
    const identifier = (app) => `${app.name}_${app.name}`;
    const name = `e2eseedgwithdraw${stamp}`;
    const app = await placeSplitApp('gwithdraw', [[holder, ELECTION, `${name}_${name}`]], 'g');
    const team = (await authenticate(client(holder).url, fluxTeamKey())).zelidauth;
    // The seed decisions a node publishes go to a node or the Flux team, on the POST
    // form of the route; the open GET carries none.
    const seeding = async () => (await client(holder).post('/apps/promotedfolders', {}, { zelidauth: team }))?.data?.seeding?.[app.folder];
    try {
      await heldAt(holder, ELECTION, { ...app, folder: identifier(app) });
      await waitFor(async () => (await seeding())?.stage === 'decided', {
        timeout: 240000, interval: 1000, label: 'the holder decides to seed, its election held',
      });

      await electMaster(app.name, client(lowest).ip);
    } finally {
      await release(holder, ELECTION, { ...app, folder: identifier(app) });
    }

    await waitFor(async () => (await client(holder).getDecisionCount('syncthing:seedMark', app.folder, 'withdrawn')) >= 1, {
      timeout: 120000, interval: 1000, label: 'the holder withdraws its seed decision',
    });
    expect(await seeding(), 'the seed decision the holder published').to.equal(undefined);

    await waitHolding(async () => {
      const now = await runners(app.name);
      expect(now, `the holder runs ${app.name}, its seed decision withdrawn`).to.not.include(holder);
      return now.includes(lowest);
    }, { timeout: 120000, interval: 1000, label: `the lowest address seeds ${app.name} as FDM's primary` });
    const from = await Promise.all(holders.map((i) => folderPasses(i, app.folder)));
    await waitHolding(async () => {
      expect(await runners(app.name), `who runs ${app.name}`).to.deep.equal([lowest]);
      const passes = await Promise.all(holders.map((i) => folderPasses(i, app.folder)));
      return passes.every((n, k) => n >= from[k] + SETTLE_PASSES);
    }, { timeout: 120000, interval: 1000, label: `${SETTLE_PASSES} folder passes on every holder of ${app.name}` });
  });
});
