import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
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
// Suites 35, 51 and 52 install their holders in parallel, so every holder's
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

  // one app per scenario, all on the one fleet
  const orderApp = `e2eorder${stamp}`;
  const genesisApp = `e2egenloss${stamp}`;
  const fdmApp = `e2efdmling${stamp}`;

  const countUp = async (appName) => (await Promise.all(
    holders.map((i) => isUp(env.clients[i], appName)),
  )).filter(Boolean).length;

  const deploy = async (appName) => {
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
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

  it('starts the newborn app on the seed without serving the index stagger', async function () {
    this.timeout(240000);
    // The seed is the only holder that CAN seed: the others are receiveonly with
    // nothing to sync from. At index > 0 the plain stagger would hold it down for
    // index * 3 minutes first, waiting on nodes that provably cannot become ready.
    // 100s is comfortably inside that budget and comfortably outside a normal start.
    await waitFor(
      () => isUp(env.clients[seedIndex], orderApp),
      { timeout: 100000, interval: 3000, label: 'seed starts well inside its index stagger' },
    );
    expect(await countUp(orderApp), 'more than one holder started at genesis').to.equal(1);
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
    // election. Suite 52's recipe - here with the seed at index > 0.
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

  it('elects a new seed when the designated leader dies mid-genesis', async function () {
    this.timeout(600000);
    // Genesis has exactly one node that can seed, and it is chosen by lowest IP. If
    // that node dies before it seeds, the remaining holders must converge on a new
    // seed rather than defer to a corpse forever - the cold-start standoff, but with
    // the standoff-breaker removed after the fact. Nothing here is index 0, so the
    // stagger cannot rescue it either.
    await deploy(genesisApp);
    const position = await electionIndexOf(env, genesisApp, seedIndex);
    expect(position, 'fixture: seed must be off index 0 for this scenario to mean anything').to.be.greaterThan(0);

    // Kill the seed before it can promote and start. Full isolation, not a container
    // stop: the seed must stop participating in the election entirely, the way a lost
    // node does, rather than sit there as a stopped-but-present holder.
    await env.disconnectNode(seedIndex);

    const survivors = holders.filter((i) => i !== seedIndex);
    const survivorsUp = async () => (await Promise.all(
      survivors.map((i) => isUp(env.clients[i], genesisApp)),
    )).filter(Boolean).length;

    // The isolation is undone in a finally: a failing assertion must not leave the
    // node cut off, or every later test in this file dies on a connection error
    // against a node this one broke rather than on its own subject.
    try {
      await waitFor(async () => (await survivorsUp()) >= 1, {
        timeout: 420000, interval: 5000, label: 'a surviving holder seeds after the leader is lost',
      });
      expect(await survivorsUp(), 'both survivors seeded - split brain replacing the lost leader').to.equal(1);
    } finally {
      await env.reconnectNode(seedIndex);
      await env.startDiscovery([seedIndex]);
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
    // A node FDM names must be able to run it: pin the holder above the seed synced.
    const above = holders[holders.length - 1];
    await setSynced({ ip: subnet.nodeIp(above + 1), folder });
    await electMaster(fdmApp, env.clients[above].ip);
    await waitFor(() => isUp(env.clients[above], fdmApp), {
      timeout: 180000, interval: 3000, label: 'FDM-named primary runs',
    });

    // FDM goes quiet while its primary keeps running - its registration lag is a
    // routine state, not an exotic one. The seed must not read that silence as
    // permission to start alongside.
    await clearMaster(fdmApp);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(fdmApp), 'the seed started alongside the running FDM primary').to.equal(1);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
    expect(await isUp(env.clients[seedIndex], fdmApp), 'the seed must still be down').to.equal(false);
  });
});
