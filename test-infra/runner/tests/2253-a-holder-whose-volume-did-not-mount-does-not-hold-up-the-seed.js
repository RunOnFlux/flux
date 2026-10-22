import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { resetSyncState, pinColdStart } from '../framework/syncthing-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { syncthingSeedIndex } from '../framework/g-app-placement.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { destroyFolderVolume } from '../framework/volume-fixture.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A cold start of a g: app where one holder comes back from a restart with the
// app's volume gone: the image is removed, so the mount check cannot repair it and
// holds the folder out of every pass. That holder never measures the folder.
//
// The other holder, the lowest address, decides the seed. It waits on a holder
// that has not yet looked at the folder, so a held-out folder must read as looked
// at with no claim: read as not looked at, it holds the seed up for as long as the
// volume stays gone, and the app starts nowhere.
//
// The lowest address is held before it measures until the broken holder has held
// the folder out, so its decision is made against that answer.

const subnet = getSubnetConfig();
const APP_UID = 1000;
const BEFORE_HOLDINGS = 'syncthing:beforeHoldings';
const SETTLE_PASSES = 6;

describe('a holder whose volume did not mount does not hold up the seed', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eheldout${Date.now()}`;
  const COMPONENT = 'data';
  const HOLDERS = [0, 1];
  const LOWEST = syncthingSeedIndex(HOLDERS);
  const BROKEN = HOLDERS.find((i) => i !== LOWEST);

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost } = watchGComponents(() => env, {
    appName, components: [COMPONENT], holders: HOLDERS,
  });
  const folder = folderOf(COMPONENT);
  const seeded = (i) => client(i).getDecisionCount('syncthing:seedDecision', folder, 'seeded');
  const waitedOnLook = (i) => client(i).getDecisionCount('syncthing:seedDecision', folder, 'holderNotLookedAt');
  const folderPasses = (i) => client(i).getDecisionCount('syncthing:folderPass', folder, 'evaluated');
  const heldOutPasses = (i) => client(i).getDecisionCount('syncthing:folderPass', folder, 'mountUnsafe');

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 6, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();

    await pushTestApp(appName, 'v1', 'heldout', { user: APP_UID });
    const app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: [gComponent(appName, COMPONENT)],
    });
    await pinColdStart(HOLDERS, folder);
    await client(LOWEST).holdCheckpoint(BEFORE_HOLDINGS, folder);
    const from = client(LOWEST).getLastEventId();
    await installOnNodes(env, app, HOLDERS);
    await client(LOWEST).waitForEvent(
      'checkpoint:held',
      (d) => d.name === BEFORE_HOLDINGS && d.key === folder,
      300000,
      { afterId: from },
    );
  });

  after(async function () {
    this.timeout(60000);
    await client(LOWEST)?.releaseAllCheckpoints().catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('seeds on the lowest address while the other holder holds the folder out', async function () {
    this.timeout(600000);
    expect(subnet.nodeIp(LOWEST + 1) < subnet.nodeIp(BROKEN + 1), 'fixture: the broken holder is not the lowest address').to.equal(true);

    await crashFluxos(client(BROKEN).container, { hold: true });
    await destroyFolderVolume(client(BROKEN).container, folder);
    await releaseFluxos(client(BROKEN).container);
    await waitFor(async () => await heldOutPasses(BROKEN) >= 1, {
      timeout: 300000, interval: 2000, label: 'the restarted holder holds the folder out',
    });
    expect(await seeded(LOWEST), 'fixture: the lowest address seeded before it was released').to.equal(0);

    const from = await folderPasses(LOWEST);
    await client(LOWEST).releaseCheckpoint(BEFORE_HOLDINGS, folder);
    await waitHolding(async () => {
      await oneHolderAtMost();
      return await seeded(LOWEST) >= 1 || await folderPasses(LOWEST) >= from + SETTLE_PASSES;
    }, { timeout: 300000, interval: 2000, label: `the lowest address seeds, or ${SETTLE_PASSES} folder passes go by without it` });

    expect(await seeded(LOWEST), `seeds on the lowest address in ${SETTLE_PASSES} passes (passes it waited on a holder that had not looked: ${await waitedOnLook(LOWEST)})`).to.be.at.least(1);
    expect(await waitedOnLook(LOWEST), 'passes the lowest address waited on the held-out holder').to.equal(0);
    expect(await seeded(BROKEN), 'the broken holder seeded').to.equal(0);
    expect(await heldOutPasses(BROKEN), 'fixture: the broken holder still holds the folder out').to.be.at.least(1);
  });
});
