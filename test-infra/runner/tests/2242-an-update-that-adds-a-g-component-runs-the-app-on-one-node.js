// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { listAppContainers } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { allocatePortFor } from '../framework/port-allocator.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { isDaemonUp, isFolderSynced, getFolderConfig } from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A specification update gives a running app a second single-writer (g:)
// component, on real syncthing daemons.
//
// A change to the components is a structure change: each holder removes the app
// and installs it at the new specification, on its own reinstall pass. Between the
// two passes one holder is at the new specification and the other still runs the
// old one, and after both the app starts afresh. Through all of it no two nodes run
// any g: component of the app at once, and once settled one node runs both and the
// other runs neither.
//
// DRIVEN BY BLOCKS: the reinstall pass fires on
// `blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0` (suite 85).

const APP_UID = 1000;

describe('an update that adds a g: component runs the app on one node', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eaddg${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  const folderOf = (name) => `flux${name}_${appName}`;
  const HOLDERS = [0, 1];
  let app;

  const client = (i) => env.clients[i];
  const component = (name) => ({
    name,
    description: `${name} of an app that gains a writer`,
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [`WRITE_FILE=/appdata/${name}.txt`, `WRITE_CONTENT=${name}`],
    commands: [],
    containerPorts: [80],
    containerData: 'g:/appdata',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  });
  // The specification a holder has installed, by its hash.
  const installedHash = async (i) => {
    const res = await client(i).getInstalledApps();
    return (res.data ?? []).find((a) => a.name === appName)?.hash ?? null;
  };
  const runningOn = async (i) => {
    const containers = await listAppContainers(client(i).container);
    return COMPONENTS.filter((name) => containers.some((c) => c.name === folderOf(name) && c.status?.startsWith('Up')));
  };
  // Which holders run any of the app's g: components; asserted on every poll.
  const oneHolderAtMost = async () => {
    const running = await Promise.all(HOLDERS.map(runningOn));
    const holders = HOLDERS.filter((_, k) => running[k].length);
    expect(holders.length, `the app runs on more than one node: ${HOLDERS.map((i, k) => `node ${i} runs [${running[k]}]`).join(', ')}`).to.be.at.most(1);
    return Object.fromEntries(HOLDERS.map((i, k) => [i, running[k]]));
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

    await pushTestApp(appName, 'v1', 'addg', { user: APP_UID });
    app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: [component('db')],
    });
    await installOnNodes(env, app, [HOLDERS[0]]);
    await waitHolding(async () => (await oneHolderAtMost())[HOLDERS[0]].includes('db'), {
      timeout: 300000, interval: 3000, label: 'the first holder runs db',
    });
    await installOnNodes(env, app, [HOLDERS[1]]);
    await waitFor(() => isFolderSynced(client(HOLDERS[1]), folderOf('db')), {
      timeout: 300000, interval: 3000, label: 'the second holder has the primary\'s db data',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('never runs the app on two nodes, and settles with both g: components on one', async function () {
    // A backstop: the block drive bounds this test (suite 85).
    this.timeout(1800000);
    const updated = await buildSeedableUpdate(app, (spec) => {
      // The new component's port, allocated as registration allocates db's.
      spec.compose.push({ ...component('web'), ports: [allocatePortFor(appName, 1)] });
    });
    await seedSpecUpdate(env, updated, HOLDERS);
    await stopTicker();

    let breach = null;
    let settled = null;
    // Until both holders have reinstalled: each does on its own pass.
    await driveUntil(client(HOLDERS[0]), async () => {
      try {
        const running = await oneHolderAtMost();
        settled = HOLDERS.find((i) => running[i].length === COMPONENTS.length) ?? null;
        const hashes = await Promise.all(HOLDERS.map(installedHash));
        return settled !== null && hashes.every((hash) => hash === updated.hash);
      } catch (error) {
        if (error?.name !== 'AssertionError') throw error;
        breach = error;
        return true;
      }
    }, { blocks: 216, label: 'both holders are at the new specification and one runs db and web' });
    if (breach) throw breach;

    const other = HOLDERS.find((i) => i !== settled);
    expect((await getFolderConfig(client(settled), folderOf('web')))?.type, 'the primary\'s web folder').to.equal('sendreceive');
    await waitHolding(async () => {
      const running = await oneHolderAtMost();
      expect(running[settled], 'the primary').to.deep.equal(COMPONENTS);
      return isFolderSynced(client(other), folderOf('web'));
    }, { timeout: 300000, interval: 3000, label: 'the standby has the primary\'s web data' });
    expect((await getFolderConfig(client(other), folderOf('web')))?.type, 'the standby\'s web folder').to.equal('receiveonly');
    expect((await oneHolderAtMost())[other], 'the standby').to.deep.equal([]);
  });
});
