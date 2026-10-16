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

// A specification update that changes only the plain sibling of an app's single
// single-writer (g:) component, on real syncthing daemons.
//
// Each holder applies it in place: it redeploys the sibling and then restarts the
// app. The restart bounces what this node runs and starts nothing it keeps
// stopped, so the standby's g: component stays down through the update and after
// it, and the primary goes on running it. Started, the app would run on both
// nodes. The plain sibling runs on every holder throughout.
//
// DRIVEN BY BLOCKS: the reinstall pass fires on
// `blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0` (suite 85).

const APP_UID = 1000;

describe('an update applied in place leaves a standby\'s g: component stopped', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2einplace${Date.now()}`;
  const PRIMARY = 0;
  const STANDBY = 1;
  const HOLDERS = [PRIMARY, STANDBY];
  const web = (content) => ({
    ...gComponent(appName, 'web'),
    containerData: '/appdata',
    environmentParameters: ['WRITE_FILE=/appdata/web.txt', `WRITE_CONTENT=${content}`],
  });
  let app;

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost, holdsFor } = watchGComponents(() => env, {
    appName, components: ['db'], holders: HOLDERS,
  });
  const plain = watchGComponents(() => env, { appName, components: ['web'], holders: HOLDERS });
  const installedHash = async (i) => {
    const res = await client(i).getInstalledApps();
    return (res.data ?? []).find((a) => a.name === appName)?.hash ?? null;
  };
  const redeployed = (i, from) => client(i).getEventBuffer().some((e) => e.id > from
    && e.event === 'app:componentRedeployed' && e.data?.name === appName && e.data?.component === 'web');

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

    await pushTestApp(appName, 'v1', 'inplace', { user: APP_UID });
    app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: [gComponent(appName, 'db'), web('first')],
    });
    await installOnNodes(env, app, [PRIMARY]);
    await waitHolding(async () => (await oneHolderAtMost())[PRIMARY].includes('db'), {
      timeout: 300000, interval: 3000, label: 'the primary runs db',
    });
    await installOnNodes(env, app, [STANDBY]);
    await waitFor(() => isFolderSynced(client(STANDBY), folderOf('db')), {
      timeout: 300000, interval: 3000, label: 'the standby has the primary\'s db data',
    });
    await waitFor(async () => (await plain.runningOn(STANDBY)).includes('web'), {
      timeout: 180000, interval: 3000, label: 'the standby runs the plain sibling',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('keeps the standby\'s g: component stopped through an update that redeploys its sibling in place', async function () {
    // A backstop: the block drive bounds this test (suite 85).
    this.timeout(1800000);
    const updated = await buildSeedableUpdate(app, (spec) => {
      spec.compose[1].environmentParameters = web('second').environmentParameters;
    });
    const from = Object.fromEntries(HOLDERS.map((i) => [i, client(i).getLastEventId()]));
    await seedSpecUpdate(env, updated, HOLDERS);
    await stopTicker();

    let breach = null;
    await driveUntil(client(PRIMARY), async () => {
      try {
        await oneHolderAtMost();
        const hashes = await Promise.all(HOLDERS.map(installedHash));
        return hashes.every((hash) => hash === updated.hash) && HOLDERS.every((i) => redeployed(i, from[i]));
      } catch (error) {
        if (error?.name !== 'AssertionError') throw error;
        breach = error;
        return true;
      }
    }, { blocks: 216, label: 'both holders redeployed the sibling in place at the new specification' });
    if (breach) throw breach;

    // The restart each holder asked for, carried out.
    await holdsFor(60000, { [PRIMARY]: ['db'], [STANDBY]: [] });
    expect((await getFolderConfig(client(STANDBY), folderOf('db')))?.type, 'the standby\'s db folder').to.equal('receiveonly');
    expect((await getFolderConfig(client(PRIMARY), folderOf('db')))?.type, 'the primary\'s db folder').to.equal('sendreceive');
    for (const i of HOLDERS) {
      // eslint-disable-next-line no-await-in-loop
      expect(await plain.runningOn(i), `node ${i} runs the plain sibling`).to.deep.equal(['web']);
    }
  });
});
