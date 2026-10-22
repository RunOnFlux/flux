import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getDeviceId, getRemoteState, setFolderPaused, stopDaemon,
} from '../framework/syncthing-real.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app with two single-writer (g:) components, on real syncthing daemons. Its
// primary's FluxOS stops answering while its containers and its syncthing go on
// running, with one of the app's folders paused there and the other still shared.
//
// A standby reads a silent primary as gone only when its own syncthing shows the
// primary's connection gone for EVERY folder of the app. A folder still connected
// is a component the primary may still be writing, so the standby starts nothing:
// started, the app would run on both nodes. Once the whole machine is down - every
// folder's connection gone - the standby takes the app over.

const APP_UID = 1000;
const HELD_PASSES = 3;

describe('a silent primary is not started beside while any of its folders is connected', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2egsilent${Date.now()}`;
  const COMPONENTS = ['db', 'web'];
  // The anchor: the first g: component, which keys the app's election records.
  const identifier = `db_${appName}`;
  const PRIMARY = 0;
  const STANDBY = 1;
  const HOLDERS = [PRIMARY, STANDBY];

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  const silenceVerdicts = (verdict) => client(STANDBY).getDecisionCount('peer:silenceVerdict', identifier, verdict);

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

    await pushTestApp(appName, 'v1', 'gsilent', { user: APP_UID });
    const app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });
    await installOnNodes(env, app, [PRIMARY]);
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the primary runs every g: component',
    });
    await installOnNodes(env, app, [STANDBY]);
    await Promise.all(COMPONENTS.map((name) => waitFor(() => isFolderSynced(client(STANDBY), folderOf(name)), {
      timeout: 300000, interval: 3000, label: `the standby has the primary's ${name} data`,
    })));
  });

  after(async function () {
    this.timeout(120000);
    await releaseFluxos(client(PRIMARY).container).catch(() => {});
    await env?.teardown();
  });

  it('starts nothing beside a silent primary whose second folder is still connected', async function () {
    this.timeout(600000);
    await crashFluxos(client(PRIMARY).container, { hold: true });
    await setFolderPaused(client(PRIMARY), folderOf('db'), true);

    const primaryDevice = await getDeviceId(client(PRIMARY));
    await waitFor(async () => (await getRemoteState(client(STANDBY), folderOf('db'), primaryDevice)) !== 'valid', {
      timeout: 120000, interval: 2000, label: 'the standby\'s syncthing no longer sees the primary sharing db',
    });
    expect(await getRemoteState(client(STANDBY), folderOf('web'), primaryDevice), 'fixture: the standby\'s syncthing sees the primary sharing web').to.equal('valid');

    // Each is a pass in which the standby asked the silent primary and judged its
    // silence: alive, by the folder still connected.
    const gone = await silenceVerdicts('gone');
    const from = await silenceVerdicts('connectionAlive');
    await waitHolding(async () => {
      const running = await oneHolderAtMost();
      expect(running[PRIMARY], 'the silent primary').to.deep.equal(COMPONENTS);
      return await silenceVerdicts('connectionAlive') >= from + HELD_PASSES;
    }, { timeout: 300000, interval: 3000, label: `${HELD_PASSES} passes in which the standby judged the silent primary alive` });
    expect(await silenceVerdicts('gone') - gone, 'passes that read the silent primary as gone').to.equal(0);
    expect((await oneHolderAtMost())[STANDBY], 'the standby').to.deep.equal([]);
  });

  it('takes the app over once the primary\'s whole machine is down', async function () {
    this.timeout(600000);
    const gone = await silenceVerdicts('gone');
    await Promise.all(COMPONENTS.map((name) => execInContainer(client(PRIMARY).container, `docker kill ${folderOf(name)}`)));
    await stopDaemon(client(PRIMARY));

    await waitHolding(async () => (await oneHolderAtMost())[STANDBY].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the standby runs every g: component',
    });
    expect(await silenceVerdicts('gone') - gone, 'passes that read the primary as gone').to.be.above(0);
    await waitFor(async () => (await Promise.all(COMPONENTS.map(async (name) => (await getFolderConfig(client(STANDBY), folderOf(name)))?.type)))
      .every((type) => type === 'sendreceive'), {
      timeout: 120000, interval: 2000, label: 'every folder of the new primary sends',
    });
  });
});
