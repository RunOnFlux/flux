// base-image: FLUX_E2E_BASE_TAG
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

// An app with two single-writer (g:) components, held by two nodes on a release
// that starts only the first, upgraded to this tree one node at a time: the
// standby first, then the primary. Real syncthing daemons.
//
// On the release the primary runs the first g: component and never the second.
// With the standby upgraded and the primary not, nothing changes: the upgraded
// standby stands aside for a primary that holds the app, and starts nothing. With
// the primary upgraded too it starts the second component beside the first. The
// primary's address sorts after the standby's, so the second component's folder is
// seeded by the node that writes the app, not by the address order. At no point
// does any g: component of the app run on two nodes.
//
// Node 2 runs this tree throughout and holds nothing: the third node of the ring.
// Without FLUX_E2E_BASE_TAG the suite fails before booting, naming the build it needs.

const APP_UID = 1000;
const BASE_TAG = process.env.FLUX_E2E_BASE_TAG;

describe('a rolling upgrade, standby first, brings up every g: component', function () {
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
    if (!BASE_TAG) {
      throw new Error('FLUX_E2E_BASE_TAG names the node image of the released FluxOS the nodes upgrade from: build it with FLUX_E2E_TAG=<base-tag> ./test-infra/build-release-image.sh <release ref>');
    }
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
    if (BASE_TAG === env.nodeImageTag(RING)) throw new Error('FLUX_E2E_BASE_TAG must name another build than FLUX_E2E_TAG: the suite upgrades from the one to the other');
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

  it('runs only the first g: component on the release', async function () {
    this.timeout(180000);
    await holdsFor(60000, { [STANDBY]: [], [PRIMARY]: ['db'] });
  });

  it('starts nothing on the upgraded standby while the primary on the release holds the app', async function () {
    this.timeout(420000);
    await env.upgradeNode(STANDBY, { tag: env.nodeImageTag(RING) });
    await holdsFor(90000, { [STANDBY]: [], [PRIMARY]: ['db'] });
  });

  it('starts every g: component on the primary once it is upgraded', async function () {
    this.timeout(600000);
    await env.upgradeNode(PRIMARY, { tag: env.nodeImageTag(RING) });
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
      timeout: 420000, interval: 3000, label: 'the primary runs db and web',
    });
    expect((await getFolderConfig(client(PRIMARY), folderOf('web')))?.type, 'the primary\'s web folder').to.equal('sendreceive');
    await waitHolding(async () => {
      expect((await oneHolderAtMost())[STANDBY], 'the standby').to.deep.equal([]);
      return isFolderSynced(client(STANDBY), folderOf('web'));
    }, { timeout: 300000, interval: 3000, label: 'the standby has the primary\'s web data' });
    expect((await getFolderConfig(client(STANDBY), folderOf('web')))?.type, 'the standby\'s web folder').to.equal('receiveonly');
  });
});
