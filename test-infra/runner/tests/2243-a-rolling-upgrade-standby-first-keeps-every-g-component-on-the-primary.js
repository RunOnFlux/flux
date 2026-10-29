// upgrades-from: release
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { isDaemonUp, isFolderSynced, getFolderConfig } from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { upgradeBase } from '../framework/upgrade-base.js';

// An app with two single-writer (g:) components, held by two nodes on the release,
// upgraded to this tree one node at a time: the standby first, then the primary. Real
// syncthing daemons.
//
// The primary runs every g: component throughout. With the standby upgraded and the
// primary not, the upgraded standby stands aside for a primary that holds the app and
// starts nothing; with the primary upgraded too, the primary runs them all again and
// the standby still none. The primary's address sorts after the standby's, so the
// address order alone would name the standby. At no point does any g: component of
// the app run on two nodes.
//
// Node 2 runs this tree throughout and holds nothing: the third node of the ring.

const APP_UID = 1000;
const { tag: BASE_TAG } = upgradeBase(fileURLToPath(import.meta.url));

describe('a rolling upgrade, standby first, keeps every g: component on the primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eroll${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  const STANDBY = 0;
  const PRIMARY = 1;
  const RING = 2;
  const HOLDERS = [STANDBY, PRIMARY];

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost, holdsFor } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      nodeImageTags: { [STANDBY]: BASE_TAG, [PRIMARY]: BASE_TAG },
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
    expect(`${client(STANDBY).ip}:16127` < `${client(PRIMARY).ip}:16127`, 'fixture: the standby sorts before the primary by address').to.equal(true);

    await pushTestApp(appName, 'v1', 'roll', { user: APP_UID });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });
    await installOnNodes(env, app, [PRIMARY]);
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the primary on the release runs db and web',
    });
    await installOnNodes(env, app, [STANDBY]);
    await waitHolding(async () => {
      expect((await oneHolderAtMost())[STANDBY], 'the standby on the release').to.deep.equal([]);
      const synced = await Promise.all(COMPONENTS.map((name) => isFolderSynced(client(STANDBY), folderOf(name))));
      return synced.every(Boolean);
    }, { timeout: 300000, interval: 3000, label: 'the standby has the primary\'s data of every component' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('starts nothing on the upgraded standby while the primary on the release holds the app', async function () {
    this.timeout(420000);
    await env.upgradeNode(STANDBY, { tag: env.nodeImageTag(RING) });
    await holdsFor(90000, { [STANDBY]: [], [PRIMARY]: COMPONENTS });
  });

  it('runs every g: component on the primary once it is upgraded, and none on the standby', async function () {
    this.timeout(600000);
    await env.upgradeNode(PRIMARY, { tag: env.nodeImageTag(RING) });
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
      timeout: 420000, interval: 3000, label: 'the upgraded primary runs db and web',
    });
    await holdsFor(60000, { [STANDBY]: [], [PRIMARY]: COMPONENTS });
    expect((await getFolderConfig(client(PRIMARY), folderOf('web')))?.type, 'the primary\'s web folder').to.equal('sendreceive');
    expect((await getFolderConfig(client(STANDBY), folderOf('web')))?.type, 'the standby\'s web folder').to.equal('receiveonly');
  });
});
