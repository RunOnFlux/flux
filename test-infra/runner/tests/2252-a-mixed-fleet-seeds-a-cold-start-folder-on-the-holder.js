// base-image: FLUX_E2E_BASE_TAG
/*
 * A fleet part way through an upgrade decides a cold-start seed across both releases.
 *
 * Three nodes take an r: app at once. The one holding the owner's data runs the released
 * FluxOS, which ranks the field on its peers' signed holdings answers but does not read
 * which folders a peer has yet to measure. The other two run this build: the one at the
 * lowest address, which the address order would make the seed, and a third, held just
 * before it measures the folder.
 *
 * While the third has not measured, the new node waits on it, and the released holder,
 * reading the third as answering without a claim, falls to the address order and does
 * not lead either: nobody seeds. Once it has measured, both rank the same field and the
 * released holder seeds. It reaches that only by verifying the new nodes' answers,
 * which carry a field it does not know: an answer it could not verify would read as
 * unproven, which blocks its promotion for good.
 *
 * Without FLUX_E2E_BASE_TAG the suite fails before booting, naming the build it needs.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import { resetSyncState, pinColdStart, pinHolding } from '../framework/syncthing-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { syncthingSeedIndex } from '../framework/g-app-placement.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const BASE_TAG = process.env.FLUX_E2E_BASE_TAG;
const subnet = getSubnetConfig();
const HOLDERS = [0, 1, 2];
// The holder the address order would pick last, so that seeding it is a decision the
// address order cannot also have produced. It runs the released FluxOS.
const DATA_HOLDER = [...HOLDERS].sort((a, b) => (subnet.nodeIp(a + 1) < subnet.nodeIp(b + 1) ? -1 : 1)).pop();
const ADDRESS_WINNER = syncthingSeedIndex(HOLDERS);
const UNMEASURED = HOLDERS.find((i) => i !== ADDRESS_WINNER && i !== DATA_HOLDER);
const HOLDER_BYTES = 5821604997;
// The state machine's checkpoint before it measures what this node holds of a
// receive-only folder, keyed by folder id.
const BEFORE_HOLDINGS = 'syncthing:beforeHoldings';
// Passes over the folder the new address-order winner is counted deciding while the
// third holder is held: more than the leadership confirmation needs, so a win would
// have been acted on.
const HELD_PASSES = 4;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

function step(what) {
  console.log(`# 2252 ${new Date().toISOString()} ${what}`);
}

describe('a mixed fleet seeds a cold-start folder on the holder', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2emixedseed${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const countUp = async () => (await Promise.all(HOLDERS.map((i) => isUp(env.clients[i], appName)))).filter(Boolean).length;
  let releasedVersion;
  let thisVersion;
  let parked;
  let passesWhileHeld;
  let upWhileHeld;

  before(async function () {
    this.timeout(900000);
    if (!BASE_TAG) {
      throw new Error('FLUX_E2E_BASE_TAG names the node image of the released FluxOS: build it with FLUX_E2E_TAG=<base-tag> ./test-infra/build-release-image.sh <release ref>');
    }
    env = await createTestEnv({
      hookCtx: this, nodes: 10, tickerAutostart: false, nodeImageTags: { [DATA_HOLDER]: BASE_TAG },
    });
    if (BASE_TAG === env.nodeImageTag(ADDRESS_WINNER)) throw new Error('FLUX_E2E_BASE_TAG must name another build than FLUX_E2E_TAG');
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    releasedVersion = (await env.clients[DATA_HOLDER].getVersion())?.data;
    thisVersion = (await env.clients[ADDRESS_WINNER].getVersion())?.data;

    await pushImage(appName, 'v1');
    const spec = await buildSeedableSyncthingApp({ name: appName, mode: 'r' });
    await pinColdStart(HOLDERS, folder);
    await pinHolding(DATA_HOLDER, folder, HOLDER_BYTES);

    const passes = () => env.clients[ADDRESS_WINNER].getDecisionCount('syncthing:folderPass', folder, 'evaluated');
    await env.clients[UNMEASURED].holdCheckpoint(BEFORE_HOLDINGS, folder);
    const from = env.clients[UNMEASURED].getLastEventId();
    try {
      step('installing on all three holders, the third held before it measures the folder');
      await installOnNodes(env, spec, HOLDERS);
      parked = Boolean(await env.clients[UNMEASURED].waitForEvent(
        'checkpoint:held', (d) => d.name === BEFORE_HOLDINGS && d.key === folder, 120000, { afterId: from },
      ).catch(() => null));
      const passesFrom = await passes();
      await waitFor(async () => (await passes()) >= passesFrom + HELD_PASSES, {
        timeout: 120000, interval: 2000, label: `the address-order winner ran ${HELD_PASSES} passes over the folder`,
      }).catch(() => {});
      passesWhileHeld = (await passes()) - passesFrom;
      upWhileHeld = await countUp();
    } finally {
      await env.clients[UNMEASURED].releaseCheckpoint(BEFORE_HOLDINGS, folder);
    }
    step('released');
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('runs the data holder on another release than the other two', function () {
    expect(releasedVersion, 'the data holder answered no version').to.be.a('string');
    expect(releasedVersion, 'every holder runs the same release, so nothing below is mixed').to.not.equal(thisVersion);
  });

  it('held the third holder before it measured the folder, while the address-order winner decided it', function () {
    expect(parked, 'the third holder was never held, so nothing below was tested').to.equal(true);
    expect(passesWhileHeld, 'the address-order winner did not decide the folder while the third was held').to.be.at.least(HELD_PASSES);
  });

  it('seeds nothing while a holder of this build has not measured what it holds', function () {
    expect(upWhileHeld, 'a holder seeded while another had not yet measured what it holds').to.equal(0);
  });

  it('seeds the released data holder once every holder has measured, and only it', async function () {
    this.timeout(180000);
    await waitFor(async () => (await countUp()) >= 1, {
      timeout: 120000, interval: 3000, label: 'a holder seeds once every holder has measured what it holds',
    });
    await new Promise((r) => { setTimeout(r, 12000); });
    expect(await countUp(), 'more than one holder seeded the folder').to.equal(1);
    expect(await isUp(env.clients[DATA_HOLDER], appName), 'the released data holder did not seed').to.equal(true);
  });
});
