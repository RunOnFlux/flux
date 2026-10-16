import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  resetSyncState, getFolderConfig, pinColdStart, pinHolding,
} from '../framework/syncthing-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitHolding } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { syncthingSeedIndex } from '../framework/g-app-placement.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A cold start of an app with two single-writer (g:) components, where the only
// data anywhere is one holder's copy of the SECOND component's folder.
//
// A holder ranks the claims on the whole app - every g: folder's holdings summed -
// so the node holding the owner's data seeds every g: component, the empty first
// folder included, and the lowest address seeds none. Ranked folder by folder, the
// empty first folder would fall to the address order and the app would be seeded on
// two nodes, one component each.
//
// The syncthing stub declares each folder's holdings, as suite 2214 does.

const subnet = getSubnetConfig();
const APP_UID = 1000;
const SETTLE_PASSES = 3;
const HOLDING_BYTES = 5821604997;


describe('a cold start seeds every g: component from the node holding any of its data', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2egcold${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  const HOLDERS = [0, 1];
  const LOWEST = syncthingSeedIndex(HOLDERS);
  const HOLDER = HOLDERS.find((i) => i !== LOWEST);

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  const seeded = (i, name) => client(i).getDecisionCount('syncthing:seedDecision', folderOf(name), 'seeded');
  const folderPasses = (i, name) => client(i).getDecisionCount('syncthing:folderPass', folderOf(name), 'evaluated');

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 6, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();

    await pushTestApp(appName, 'v1', 'gcold', { user: APP_UID });
    const app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });
    await Promise.all(COMPONENTS.map((name) => pinColdStart(HOLDERS, folderOf(name))));
    await pinHolding(HOLDER, folderOf('web'), HOLDING_BYTES);
    await installOnNodes(env, app, HOLDERS);
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('seeds and runs every g: component on the holder of the second one\'s data, and nothing on the lowest address', async function () {
    this.timeout(600000);
    expect(subnet.nodeIp(LOWEST + 1) < subnet.nodeIp(HOLDER + 1), 'fixture: the holder of the data is not the lowest address').to.equal(true);

    await waitHolding(async () => (await oneHolderAtMost())[HOLDER].length === COMPONENTS.length, {
      timeout: 300000, interval: 2000, label: 'the holder of the data runs every g: component',
    });
    const from = await Promise.all(HOLDERS.flatMap((i) => COMPONENTS.map((name) => folderPasses(i, name))));
    await waitHolding(async () => {
      expect(await oneHolderAtMost(), 'what each holder runs').to.deep.equal({ [HOLDER]: COMPONENTS, [LOWEST]: [] });
      const passes = await Promise.all(HOLDERS.flatMap((i) => COMPONENTS.map((name) => folderPasses(i, name))));
      return passes.every((n, k) => n >= from[k] + SETTLE_PASSES);
    }, { timeout: 180000, interval: 1000, label: `${SETTLE_PASSES} folder passes over every g: folder on every holder` });

    for (const name of COMPONENTS) {
      // eslint-disable-next-line no-await-in-loop
      expect(await seeded(HOLDER, name), `the holder seeded ${name}`).to.be.at.least(1);
      // eslint-disable-next-line no-await-in-loop
      expect(await seeded(LOWEST, name), `the lowest address seeded ${name}`).to.equal(0);
      // eslint-disable-next-line no-await-in-loop
      expect((await getFolderConfig(subnet.nodeIp(LOWEST + 1), folderOf(name)))?.type, `the lowest address's ${name} folder`).to.equal('receiveonly');
    }
  });
});
