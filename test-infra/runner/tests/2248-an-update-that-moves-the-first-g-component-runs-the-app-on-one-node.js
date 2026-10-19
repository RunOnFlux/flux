// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { isDaemonUp, isFolderSynced, getFolderConfig } from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Specification updates move the first single-writer (g:) component of a running
// app with two, on real syncthing daemons: one reverses the components, the next
// removes the one that became first.
//
// The first g: component names the app to the election - it keys the election's
// records, and it is the component a node on a release asks a peer about - so each
// update moves the app's election onto another component. Each holder reinstalls
// on its own pass (suite 2242); through all of it no two nodes run any g:
// component of the app at once (g-components.js), and once settled one node runs
// every g: component the app has and the other runs none.
//
// DRIVEN BY BLOCKS: the reinstall pass fires on
// `blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0` (suite 85).

const APP_UID = 1000;

describe('an update that moves the first g: component runs the app on one node', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2emoveg${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  const HOLDERS = [0, 1];
  let app;

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost, holdsFor } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  // The specification a holder has installed, by its hash.
  const installedHash = async (i) => {
    const res = await client(i).getInstalledApps();
    return (res.data ?? []).find((a) => a.name === appName)?.hash ?? null;
  };

  // Seeds the update and drives blocks until both holders are at it and one runs
  // exactly `expected`, then holds that. Returns the node that runs it.
  const settlesOnOneNode = async (updated, expected) => {
    await seedSpecUpdate(env, updated, HOLDERS);
    await stopTicker();

    let breach = null;
    let settled = null;
    await driveUntil(client(HOLDERS[0]), async () => {
      try {
        const running = await oneHolderAtMost();
        settled = HOLDERS.find((i) => running[i].length) ?? null;
        const hashes = await Promise.all(HOLDERS.map(installedHash));
        return settled !== null && JSON.stringify(running[settled]) === JSON.stringify(expected)
          && hashes.every((hash) => hash === updated.hash);
      } catch (error) {
        if (error?.name !== 'AssertionError') throw error;
        breach = error;
        return true;
      }
    }, { blocks: 216, label: `both holders are at the new specification and one runs [${expected}]` });
    if (breach) throw breach;

    const other = HOLDERS.find((i) => i !== settled);
    await holdsFor(60000, { [settled]: expected, [other]: [] });
    expect(await Promise.all(expected.map(async (name) => (await getFolderConfig(client(settled), folderOf(name)))?.type)), 'the primary\'s folders')
      .to.deep.equal(expected.map(() => 'sendreceive'));
    return settled;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(appName, 'v1', 'moveg', { user: APP_UID });
    app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });
    await installOnNodes(env, app, [HOLDERS[0]]);
    await waitHolding(async () => (await oneHolderAtMost())[HOLDERS[0]].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the first holder runs every g: component',
    });
    await installOnNodes(env, app, [HOLDERS[1]]);
    await Promise.all(COMPONENTS.map((name) => waitFor(() => isFolderSynced(client(HOLDERS[1]), folderOf(name)), {
      timeout: 300000, interval: 3000, label: `the second holder has the primary's ${name} data`,
    })));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs the app on one node once an update puts its second g: component first', async function () {
    // A backstop: the block drive bounds this test (suite 85).
    this.timeout(1800000);
    // Each component keeps the port it was registered with.
    app = await buildSeedableUpdate(app, (spec) => { spec.compose.reverse(); });
    expect(app.spec.compose.map((c) => c.name), 'fixture: the update\'s components').to.deep.equal(['web', 'db']);
    await settlesOnOneNode(app, COMPONENTS);
  });

  it('runs the app on one node once an update removes the g: component that is first', async function () {
    this.timeout(1800000);
    app = await buildSeedableUpdate(app, (spec) => { spec.compose = spec.compose.filter((c) => c.name !== 'web'); });
    expect(app.spec.compose.map((c) => c.name), 'fixture: the update\'s components').to.deep.equal(['db']);
    await settlesOnOneNode(app, ['db']);
  });
});
