// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { listAppContainers } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { isDaemonUp, isFolderSynced, getFolderConfig } from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A specification update adds a second single-writer (g:) component to a running
// app, on real syncthing daemons.
//
// Its folder is new on every holder and holds nothing anywhere, and the app's
// primary is the holder whose address sorts LAST. Seeded by the address order the
// new folder would be the standby's, and the primary - which runs every g:
// component of the app - would never hold a copy it may start the new one on. The
// primary seeds it and starts it, the standby never runs it, and at no point does
// any g: component of the app run on two nodes.
//
// DRIVEN BY BLOCKS: the reinstall pass fires on
// `blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0` (suite 85).

const APP_UID = 1000;

describe('a g: component a spec update adds is started by the primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eaddg${Date.now()}`;
  const folderOf = (component) => `flux${component}_${appName}`;
  // The standby sorts first by address; the primary is placed first, so it runs
  // the app, and sorts last.
  const STANDBY = 0;
  const PRIMARY = 1;
  const HOLDERS = [STANDBY, PRIMARY];
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
  const runningOn = async (i) => {
    const containers = await listAppContainers(client(i).container);
    return ['db', 'web'].filter((name) => containers.some((c) => c.name === folderOf(name) && c.status?.startsWith('Up')));
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
    expect(`${client(STANDBY).ip}:16127` < `${client(PRIMARY).ip}:16127`, `fixture: the standby (${client(STANDBY).ip}) sorts before the primary (${client(PRIMARY).ip}) by address`).to.equal(true);

    await pushTestApp(appName, 'v1', 'addg', { user: APP_UID });
    app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: [component('db')],
    });
    await installOnNodes(env, app, [PRIMARY]);
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].includes('db'), {
      timeout: 300000, interval: 3000, label: 'the primary runs db',
    });
    await installOnNodes(env, app, [STANDBY]);
    await waitFor(() => isFolderSynced(client(STANDBY), folderOf('db')), {
      timeout: 300000, interval: 3000, label: 'the standby has the primary\'s db data',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('seeds the new component\'s folder on the primary and starts it there, never on the standby', async function () {
    // A backstop: the block drive bounds this test (suite 85).
    this.timeout(1800000);
    const updated = await buildSeedableUpdate(app, (spec) => {
      spec.compose.push(component('web'));
    });
    await seedSpecUpdate(env, updated, HOLDERS);
    await stopTicker();

    let breach = null;
    await driveUntil(client(PRIMARY), async () => {
      try {
        const running = await oneHolderAtMost();
        return running[PRIMARY].length === 2;
      } catch (error) {
        if (error?.name !== 'AssertionError') throw error;
        breach = error;
        return true;
      }
    }, { blocks: 216, label: 'the primary runs db and web' });
    if (breach) throw breach;

    expect((await getFolderConfig(client(PRIMARY), folderOf('web')))?.type, 'the primary\'s web folder').to.equal('sendreceive');
    await waitFor(() => isFolderSynced(client(STANDBY), folderOf('web')), {
      timeout: 300000, interval: 3000, label: 'the standby has the primary\'s web data',
    });
    expect((await getFolderConfig(client(STANDBY), folderOf('web')))?.type, 'the standby\'s web folder').to.equal('receiveonly');
    expect((await oneHolderAtMost())[STANDBY], 'the standby').to.deep.equal([]);
  });
});
