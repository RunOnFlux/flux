// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes, electionOrder } from '../framework/reconciler-suite.js';
import {
  waitFor, waitHolding, waitForGiveUpConsidered, waitForStartedGiveUpPasses,
} from '../framework/wait.js';
import {
  advanceBlock, driveUntil, getState, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, stopDaemon, startDaemon,
} from '../framework/syncthing-real.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Trimming a surplus copy of an app with two single-writer (g:) components, when
// the copy the surplus rule picks - the newest - is the app's primary, running its
// second g: component with the first stopped there by its owner. Real syncthing
// daemons.
//
// The newest copy stands aside unless it runs the app's writer, and every g:
// component is the writer: the primary runs them together. So the newest copy
// stays while it runs ANY of them, and the next copy trims instead, on the
// newest's own word that it holds the app (suite 96).
//
// THE SHAPE: the first holder places and seeds the app, the second takes it over
// when the first dies, and the first comes back as a standby - so the primary is
// the newest copy. A stub peer then announces the app, backdated so it is the most
// senior holder: three holders against an instance count of two.

const APP_UID = 1000;
const OLDER = 0;
const NEWEST = 1;
const RING = 2;
const STUB_INDEX = 3;
const HOLDERS = [OLDER, NEWEST];

describe('a surplus trim keeps the copy running any g: component', function () {
  let env;
  let held;
  dumpLogsOnFailure(() => env);

  const appName = `e2egsurplus${Date.now()}`;
  const COMPONENTS = ['db', 'web'];

  const client = (i) => env.clients[i];
  const { folderOf, oneHolderAtMost } = watchGComponents(() => env, {
    appName, components: COMPONENTS, holders: HOLDERS,
  });
  const ownerAuth = async (i) => (await authenticate(client(i).url, appOwnerKey())).zelidauth;
  const folderTypes = async (i) => Promise.all(COMPONENTS.map(async (name) => (await getFolderConfig(client(i), folderOf(name)))?.type));
  // Read from a holder's own list, senior first.
  const order = async (via) => {
    const res = await client(via).getAppLocations(appName);
    if (res?.status !== 'success' || !Array.isArray(res.data) || !res.data.length) {
      throw new Error(`app locations unreadable: ${JSON.stringify(res)?.slice(0, 200)}`);
    }
    return electionOrder(res.data).map((location) => location.ip.split(':')[0]);
  };
  // Whether a holder has the app installed, from an answer it gave: a read that
  // fails is asked again, never taken as the app gone.
  const installedOn = async (i) => {
    let installed = null;
    await waitFor(async () => {
      const res = await client(i).getInstalledApps();
      if (res?.status !== 'success' || !Array.isArray(res.data)) throw new Error(`installed apps unreadable on node ${i}: ${JSON.stringify(res)?.slice(0, 200)}`);
      installed = res.data.some((a) => a.name === appName);
      return true;
    }, { timeout: 60000, interval: 2000, label: `node ${i} answers what it has installed` });
    return installed;
  };
  // What the decision reads, asked the way the product asks it: the newest copy's
  // /apps/heldcomponents, from the next copy.
  const newestAnswersHeld = async () => {
    const res = await execInContainer(client(OLDER).container, `curl -sf -m 5 http://${client(NEWEST).ip}:16127/apps/heldcomponents`);
    return res.exitCode === 0 && res.output.includes(folderOf('web'));
  };

  before(async function () {
    this.timeout(1500000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: STUB_INDEX + 1,
      stubPeers: [STUB_INDEX],
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all([OLDER, NEWEST, RING].map((i) => waitFor(() => isDaemonUp(client(i)), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(appName, 'v1', 'gsurplus', { user: APP_UID });
    const app = await buildSeedableApp({
      env, name: appName, instances: HOLDERS.length, compose: COMPONENTS.map((name) => gComponent(appName, name)),
    });
    await installOnNodes(env, app, [OLDER]);
    await waitHolding(async () => (await oneHolderAtMost())[OLDER].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the first holder runs every g: component',
    });
    await installOnNodes(env, app, [NEWEST]);
    await Promise.all(COMPONENTS.map((name) => waitFor(() => isFolderSynced(client(NEWEST), folderOf(name)), {
      timeout: 300000, interval: 3000, label: `the second holder has the first holder's ${name} data`,
    })));

    // The first holder dies whole, the second takes the app over, and the first
    // comes back as its standby.
    await crashFluxos(client(OLDER).container, { hold: true });
    await Promise.all(COMPONENTS.map((name) => execInContainer(client(OLDER).container, `docker kill ${folderOf(name)}`)));
    await stopDaemon(client(OLDER));
    await waitHolding(async () => (await oneHolderAtMost())[NEWEST].length === COMPONENTS.length, {
      timeout: 300000, interval: 3000, label: 'the second holder runs every g: component',
    });
    await startDaemon(client(OLDER), { paused: true });
    await releaseFluxos(client(OLDER).container);
    await waitHolding(async () => {
      await oneHolderAtMost();
      return (await folderTypes(OLDER)).every((type) => type === 'receiveonly');
    }, { timeout: 300000, interval: 2000, label: 'the first holder is back as a standby of the whole app' });

    // Its owner stops the first g: component alone on the primary.
    const res = await client(NEWEST).getAuthed(`/apps/appstop/db_${appName}`, await ownerAuth(NEWEST));
    expect(res?.status, `owner stop of db on the primary: ${JSON.stringify(res)}`).to.equal('success');
    await waitHolding(async () => JSON.stringify((await oneHolderAtMost())[NEWEST]) === JSON.stringify(['web']), {
      timeout: 180000, interval: 2000, label: 'the primary runs web alone',
    });
    expect(await order(OLDER), 'fixture: the primary is the newest copy').to.deep.equal([client(OLDER).ip, client(NEWEST).ip]);
    await waitFor(newestAnswersHeld, {
      timeout: 180000, interval: 3000, label: 'the newest copy answers heldcomponents with web, asked from the next copy',
    });

    // The surplus has to survive until the test drives the trim pass, which runs
    // on block heights: every node is brought level with a frozen tip first, so
    // none processes its way onto one while the fixture is assembling, and a pass
    // a holder started on its way up has decided before the stub joins.
    await stopTicker();
    const real = [OLDER, NEWEST, RING];
    const seen = real.map((i) => client(i).getLastEventId());
    const { currentHeight } = await advanceBlock();
    await Promise.all(real.map((i, k) => client(i).waitForEvent(
      'block:processed', (d) => d.height >= currentHeight, 120000, { afterId: seen[k] },
    )));
    await waitForStartedGiveUpPasses(HOLDERS.map(client));

    const stub = env.stubPeerClients.get(STUB_INDEX);
    await waitFor(async () => (await stub.connectedNodes()) > 0, {
      timeout: 120000, interval: 2000, label: 'the fleet has connected to the stub peer',
    });
    held = stub.holdApp(appName, { hash: app.hash, runningSince: Date.now() - 24 * 60 * 60 * 1000 });
    await held.started;
    await Promise.all(HOLDERS.map((i) => waitFor(async () => (await order(i)).length === 3, {
      timeout: 120000, interval: 2000, label: `holder ${i} counts the stub as a third holder`,
    })));
  });

  after(async function () {
    this.timeout(120000);
    held?.stop();
    await startTicker().catch(() => {});
    await env?.teardown();
  });

  it('keeps the newest copy, which runs the second g: component with the first stopped, and trims the next copy instead', async function () {
    this.timeout(900000);
    // Each holder judges the pass's block on its own, and the next copy's trim
    // reaches the newest as soon as it is made. The newest therefore decides
    // first, with all three copies there: the next copy's explorer is held before
    // the pass's block until the newest copy has declined to stand aside.
    // The stub's tip: the drive has both holders process each block it mines.
    const { fluxapps } = loadSharedConfig();
    const tip = async () => (await getState()).currentHeight;
    const startedAt = await tip();
    const period = fluxapps.removeFluxAppsPeriod * (startedAt >= fluxapps.daemonPONFork ? 4 : 1);
    const passHeight = (Math.floor(startedAt / period) + 1) * period;
    await driveUntil(HOLDERS.map(client), async () => (await tip()) === passHeight - 1, {
      blocks: period, label: 'both holders are a block below the trim pass',
    });

    const seenOlder = client(OLDER).getLastEventId();
    const seenNewest = client(NEWEST).getLastEventId();
    await client(OLDER).holdCheckpoint('explorer:beforeBlock');
    await waitFor(newestAnswersHeld, {
      timeout: 120000, interval: 3000, label: 'the newest copy answers heldcomponents before the pass\'s block',
    });
    await advanceBlock();
    await client(OLDER).waitForEvent('checkpoint:held', (d) => d.name === 'explorer:beforeBlock', 60000, { afterId: seenOlder });
    const kept = (await waitForGiveUpConsidered(
      client(NEWEST), appName, (d) => d.giveUp === false && d.reason === 'SURPLUS', 120000, { afterId: seenNewest },
    )).data;
    expect(await installedOn(OLDER), 'the next copy had not trimmed when the newest decided').to.equal(true);

    await client(OLDER).releaseCheckpoint('explorer:beforeBlock');
    await waitForGiveUpConsidered(
      client(OLDER), appName, (d) => d.giveUp === true && d.reason === 'SURPLUS', 120000, { afterId: seenOlder },
    );
    await waitFor(async () => !await installedOn(OLDER), {
      timeout: 180000, interval: 3000, label: 'the next copy has removed itself',
    });
    await startTicker();

    expect(await installedOn(NEWEST), 'the newest copy, which runs web, is still installed').to.equal(true);
    expect(kept?.code, 'the newest copy declined to stand aside').to.equal('NEWEST_HOLDS_WRITER');
    expect(await installedOn(OLDER), 'the next copy is still installed').to.equal(false);
    expect(await oneHolderAtMost(), 'what each holder runs').to.deep.equal({ [OLDER]: [], [NEWEST]: ['web'] });
  });
});
