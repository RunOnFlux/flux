import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetFdm, startFdmOutage, endFdmOutage } from '../framework/fdm-control.js';
import { resetSyncState } from '../framework/syncthing-control.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, placeGAppInOrder } from '../framework/reconciler-suite.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS gate. What a g: app does when FDM - the election authority - cannot be
// reached at all.
//
// FDM gives three answers, and only two of them are an answer. It names a primary,
// it says this app has none yet, or it says nothing. The first two arrive at the
// node alike, as a null ip; the third is meant to be told apart by fdmOk so the
// election stands down for the cycle instead of acting on evidence it does not have.
// Read as "no primary yet", an unreachable FDM is an invitation: the node checks its
// own copy looks synced and moves to promote itself, on precisely the observation
// that should have stopped it. On a shared volume that is a second writer.
//
// Every fdm-*.runonflux.io name for all four indices is an alias on the one stub
// container (test-env's fdmHostnames), so closing its socket is not one region
// failing over to another - it is the whole of FDM going silent, which is the only
// arrangement that reaches the third answer. clearMaster does not: clearing the
// primary is FDM answering, and that is the second.
//
// Three nodes, two holders, matching the small-fleet suite's arrangement so the
// promotion this suite must NOT see is one that suite already proves does happen.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('masterSlave election while FDM is unreachable', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2efdmout${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const holders = [0, 1];
  // Seed placed second, so it carries the later runningSince and lands at index 1.
  const placementOrder = [1, 0];

  const countUp = async () => (await Promise.all(
    holders.map((i) => isUp(env.clients[i], appName)),
  )).filter(Boolean).length;

  const someHolderStoodDown = () => holders.some((i) => env.nodeHasLog(i, 'All FDM services failed'));

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        peers: { wsPingIntervalMs: 3000 },
        // Three nodes can only carry minOutgoing 1 - the discovery ring needs
        // 2*minOutgoing+1 to close, and a fleet that cannot reach its own floor
        // dies in this hook instead of testing anything.
        fluxapps: { minOutgoing: 1, minIncoming: 1, appSyncDegradedThreshold: 0 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    // FDM goes silent BEFORE the app is placed, so no election cycle in this
    // suite ever sees an answer. Starting the outage after placement would race
    // the first cycle, and a promotion that had already happened would make the
    // stand-down assertion vacuous rather than false.
    await startFdmOutage('refuse');

    await placeGAppInOrder(env, app, {
      placementOrder, folder, identifier: `${appName}_${appName}`,
    });
  });

  after(async function () {
    this.timeout(60000);
    await endFdmOutage().catch(() => {});
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('keeps every holder down while FDM answers nothing, rather than promoting one', async function () {
    this.timeout(420000);
    // Positive proof the stand-down branch is what ran. Without this the test
    // passes on an app that simply never got as far as an election, which is a
    // different fact and not the one under test.
    await waitFor(someHolderStoodDown, {
      timeout: 300000,
      interval: 5000,
      label: 'a holder reports FDM unreachable and skips primary selection',
    });

    // Held over a window rather than sampled once: the election re-runs every
    // cycle, and a single look proves only that this instant was quiet.
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(), 'a holder promoted itself while FDM was unreachable').to.equal(0);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(5000);
    }
  });

  it('promotes as soon as FDM answers again, so the stand-down was the outage and not a stall', async function () {
    this.timeout(600000);
    // The vacuity guard for the test above. An app that could never have started
    // here - wrong fixture, unsynced folders, a peer holding it - would give that
    // test the same zero. Ending the outage changes exactly one input, and FDM's
    // answer is still "no primary yet", so what follows is the promotion the
    // silence was suppressing.
    await endFdmOutage();

    await waitFor(async () => (await countUp()) >= 1, {
      timeout: 420000, interval: 5000, label: 'a holder takes the primary once FDM answers',
    });

    // and only one of them, which is what the stand-down is protecting
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countUp(), 'both holders ran the g: component at once').to.be.lessThan(2);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(5000);
    }
  });
});
