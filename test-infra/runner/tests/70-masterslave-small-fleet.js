import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetFdm } from '../framework/fdm-control.js';
import { resetSyncState, getSyncthingState } from '../framework/syncthing-control.js';
import { waitFor } from '../framework/wait.js';
import {
  bootAndPeer, placeGAppInOrder, electionIndexOf,
} from '../framework/reconciler-suite.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS gate. The election on a fleet small enough that a node has barely any
// peers at all.
//
// Before promoting over a holder it cannot reach, a node checks whether the silence
// is the peer's or its own - a node still trading pings with the fleet is watching
// one node fall over, a node whose peers have all gone quiet is the one that fell
// over. That check is proportional to the node's own peer count, and it has to be:
// an absolute floor is a fleet size in disguise. Production runs minOutgoing 8, so
// a threshold picked there looks harmless and quietly means "never" on a fleet like
// this one, where a node holds two peers at most - the app would refuse to recover
// from a genuinely dead holder for good, which is worse than the stall it replaces.
//
// Suites 68 and 69 run ten and six nodes, where peers are plentiful and that
// distinction cannot show up. This is three.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('masterSlave election on a three-node fleet', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2esmall${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const holders = [0, 1];
  const seedIndex = 0; // lowest IP of the two holders
  // Seed placed second, so it carries the later runningSince and lands at index 1.
  const placementOrder = [1, 0];

  const countUp = async () => (await Promise.all(
    holders.map((i) => isUp(env.clients[i], appName)),
  )).filter(Boolean).length;

  const writableHolders = async () => {
    const state = await getSyncthingState();
    return (state.nodes || [])
      .filter((node) => (node.folders || []).some((f) => f.id === folder && f.type === 'sendreceive'))
      .map((node) => node.ip);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        // A three-node fleet cannot reach the production peer floors - each node has
        // two peers at most. Lowered to what the topology can actually satisfy, which
        // is the point: this is the shape where an absolute connectivity threshold
        // would silently mean "never".
        peers: { wsPingIntervalMs: 3000 },
        fluxapps: { minOutgoing: 2, minIncoming: 1, appSyncDegradedThreshold: 0 },
      },
    });
    await bootAndPeer(env, { minOutbound: 2, minInbound: 1 });
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    await placeGAppInOrder(env, app, {
      placementOrder, folder, identifier: `${appName}_${appName}`,
    });
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('settles on one writable copy with only two peers per node', async function () {
    this.timeout(420000);
    const position = await electionIndexOf(env, appName, seedIndex);
    expect(position, 'fixture: the seed must not be index 0').to.be.greaterThan(0);

    await waitFor(async () => (await countUp()) >= 1, {
      timeout: 300000, interval: 3000, label: 'the app starts on one of the two holders',
    });

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const writable = await writableHolders();
      expect(writable.length, `both holders took the writable copy: ${writable.join(', ')}`).to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  });

  it('still recovers when a holder dies and this node has only one peer left', async function () {
    this.timeout(600000);
    // The case the proportional check exists for. With the other holder gone, the
    // survivor is down to a single peer - the non-holder - and its own connectivity
    // is nonetheless demonstrably fine, so the silence is the dead holder's. Under
    // an absolute floor written for a twelve-peer node it would conclude it was
    // itself isolated and never promote, and the app would stay down for good
    // rather than for the two hours the stale holder list already costs.
    const writableBefore = await writableHolders();
    expect(writableBefore.length, 'fixture: one holder must own the writable copy first').to.equal(1);

    // Which of the two is actually holding it, so the survivor is the other one.
    const holdingIp = writableBefore[0].split(':')[0];
    const holdingIndex = holders.find((i) => env.clients[i].ip.split(':')[0] === holdingIp);
    const survivor = holders.find((i) => i !== holdingIndex);

    await env.partitionGroups([holdingIndex], [survivor, 2], { awaitSever: false });

    try {
      await waitFor(async () => {
        const writable = await writableHolders();
        return writable.some((ip) => ip.split(':')[0] === env.clients[survivor].ip.split(':')[0]);
      }, {
        timeout: 420000,
        interval: 5000,
        label: 'the survivor takes the writable copy despite holding one peer',
      });
    } finally {
      await env.healPartition([holdingIndex], [survivor, 2]).catch(() => {});
      await env.startDiscovery().catch(() => {});
    }
  });
});
