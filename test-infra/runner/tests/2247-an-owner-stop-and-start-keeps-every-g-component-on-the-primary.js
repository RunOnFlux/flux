// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes, electionIndexOf } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding, electionDecisionCount } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, stopDaemon, startDaemon,
} from '../framework/syncthing-real.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An owner stops and starts an app with two single-writer (g:) components, on real
// syncthing daemons: the whole app on every node at once, and one component alone
// on its primary.
//
// Stopped and started everywhere, the app comes back on the node that was its
// primary, every g: component of it, not on whichever node the election order
// would pick: the primary is put below index 0 first, as in suite 2215. One
// component stopped on the primary stays down by its lock while the primary goes
// on running the other, and no other node starts either - the primary still holds
// the app. Started again, it comes back on the primary.

const APP_UID = 1000;
const HELD_PASSES = 3;

describe('an owner stop and start keeps every g: component on the primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2egowner${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  // The anchor: the first g: component, which keys the app's election records.
  const identifier = `db_${appName}`;
  // Placed in this order, so the election ranks them in it. A fourth node holds
  // nothing and keeps the discovery ring whole.
  const FIRST = 0;
  const HOLDERS = [0, 1, 2];
  let PRIMARY;
  let STANDBYS;

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost, holdsFor } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  const runners = async () => Object.entries(await oneHolderAtMost())
    .filter(([, running]) => running.length).map(([i]) => Number(i));
  const ownerAuth = async (i) => (await authenticate(client(i).url, appOwnerKey())).zelidauth;
  const owner = async (command, target, via, { global = false } = {}) => {
    const res = await client(via).getAuthed(`/apps/${command}/${target}${global ? '/true' : ''}`, await ownerAuth(via));
    expect(res?.status, `owner ${global ? 'global ' : ''}${command} of ${target} through node ${via}: ${JSON.stringify(res)}`).to.equal('success');
  };
  const evaluated = (nodes) => Promise.all(nodes.map((i) => electionDecisionCount(client(i), identifier, 'evaluated')));
  const folderTypes = async (i) => Promise.all(COMPONENTS.map(async (name) => (await getFolderConfig(client(i), folderOf(name)))?.type));

  // What every holder runs, asserted on every poll, until each of `nodes` has run
  // HELD_PASSES election passes over the app.
  const holdsThroughPasses = async (nodes, expected, label) => {
    const from = await evaluated(nodes);
    await waitHolding(async () => {
      expect(await oneHolderAtMost(), `${label}: what each holder runs`).to.deep.equal(expected);
      const now = await evaluated(nodes);
      return now.every((n, k) => n >= from[k] + HELD_PASSES);
    }, { timeout: 300000, interval: 2000, label: `${label}: ${HELD_PASSES} election passes on nodes ${nodes.join(', ')}` });
  };
  const nothingRuns = () => Object.fromEntries(HOLDERS.map((i) => [i, []]));
  const onPrimary = (running) => ({ ...nothingRuns(), [PRIMARY]: running });

  before(async function () {
    this.timeout(1500000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
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

    await pushTestApp(appName, 'v1', 'gowner', { user: APP_UID });
    const app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });

    // One at a time: a node learns of the app only when it is installed, so the
    // order is the placement order.
    await installOnNodes(env, app, [FIRST]);
    await waitHolding(async () => (await oneHolderAtMost())[FIRST].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the first holder runs every g: component',
    });
    for (const i of HOLDERS.filter((h) => h !== FIRST)) {
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, [i]);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(COMPONENTS.map((name) => waitFor(() => isFolderSynced(client(i), folderOf(name)), {
        timeout: 300000, interval: 3000, label: `holder ${i} has the first holder's ${name} data`,
      })));
    }

    // The first holder dies whole - process, containers and daemon - and another
    // takes the app over; then it comes back, as a standby still ranked ahead of
    // the primary.
    await crashFluxos(client(FIRST).container, { hold: true });
    await Promise.all(COMPONENTS.map((name) => execInContainer(client(FIRST).container, `docker kill ${folderOf(name)}`)));
    await stopDaemon(client(FIRST));
    await waitHolding(async () => {
      const running = await oneHolderAtMost();
      return HOLDERS.some((i) => i !== FIRST && running[i].length === COMPONENTS.length);
    }, { timeout: 300000, interval: 3000, label: 'another holder runs every g: component' });
    [PRIMARY] = await runners();
    STANDBYS = HOLDERS.filter((i) => i !== PRIMARY);

    await startDaemon(client(FIRST));
    await releaseFluxos(client(FIRST).container);
    await waitHolding(async () => {
      await oneHolderAtMost();
      return (await folderTypes(FIRST)).every((type) => type === 'receiveonly');
    }, { timeout: 300000, interval: 2000, label: 'the first holder is back as a standby of the whole app' });
    await Promise.all(COMPONENTS.map((name) => waitFor(() => isFolderSynced(client(FIRST), folderOf(name)), {
      timeout: 300000, interval: 3000, label: `the first holder has the primary's ${name} data`,
    })));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs the app on a primary the election order ranks below another holder', async function () {
    this.timeout(180000);
    await holdsFor(30000, onPrimary(COMPONENTS));
    expect(await electionIndexOf(env, appName, FIRST), 'the first holder\'s place').to.equal(0);
    expect(await electionIndexOf(env, appName, PRIMARY), 'the primary\'s place').to.be.above(0);
  });

  it('brings every g: component back on its primary when its owner stops the app everywhere and starts it everywhere', async function () {
    this.timeout(900000);
    await owner('appstop', appName, PRIMARY, { global: true });
    await waitHolding(async () => (await runners()).length === 0, {
      timeout: 180000, interval: 2000, label: 'the app stops everywhere',
    });
    await holdsThroughPasses(STANDBYS, nothingRuns(), 'stopped everywhere');

    await owner('appstart', appName, FIRST, { global: true });
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
      timeout: 300000, interval: 2000, label: 'started everywhere: the primary runs every g: component again',
    });
    await holdsThroughPasses(STANDBYS, onPrimary(COMPONENTS), 'started everywhere');
    expect(await folderTypes(PRIMARY), 'the primary\'s folders').to.deep.equal(['sendreceive', 'sendreceive']);
  });

  for (const [stopped, kept] of [['web', 'db'], ['db', 'web']]) {
    it(`keeps ${kept} on the primary and runs ${stopped} nowhere when its owner stops ${stopped} alone there, and brings it back there once started`, async function () {
      this.timeout(900000);
      await owner('appstop', `${stopped}_${appName}`, PRIMARY);
      await waitHolding(async () => {
        const running = await oneHolderAtMost();
        return running[PRIMARY].length === 1 && running[PRIMARY][0] === kept;
      }, { timeout: 180000, interval: 2000, label: `${stopped} stops on the primary` });
      await holdsThroughPasses(HOLDERS, onPrimary([kept]), `${stopped} stopped on the primary`);

      await owner('appstart', `${stopped}_${appName}`, PRIMARY);
      await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
        timeout: 300000, interval: 2000, label: `${stopped} started on the primary: it runs every g: component again`,
      });
      await holdsThroughPasses(STANDBYS, onPrimary(COMPONENTS), `${stopped} started again`);
    });
  }
});
