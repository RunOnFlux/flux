import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning, shutdownFluxosGracefully, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { advanceBlock, driveUntil, startTicker, stopTicker } from '../framework/daemon-control.js';
import { waitFor, waitForUp, waitForAppRemoved } from '../framework/wait.js';
import { isDaemonUp, isFolderSynced } from '../framework/syncthing-real.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A surplus copy is removed only when a connected peer holds all of its data -
// and never on the strength of a peer that is shutting down.
//
// A node in a system shutdown stops its FluxOS first and its syncthing last, so
// for a while its syncthing is still connected and still reports every folder
// complete while the machine is going away. A copy given up to it then is given
// up to nobody. The shutdown is announced before any of that, and a node that
// has announced it and not reported running since is not a holder the trim may
// rely on; with no other full peer, the trim waits for a later pass.
//
// Two holders of an app that wants one, so the junior copy is surplus and its
// only full peer is the primary. The trim pass runs on blocks, which this suite
// drives itself, so it runs only when the fixture is ready for it.

const APP_UID = 1000;
// The shutdown's window, widened from the fleet's 30s so that a trim pass driven
// after the announcement lands inside it; still below the location lifetime.
const SIGTERM_EXPIRY_S = 55;

describe('a surplus trim waits for a peer that is leaving', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eswtrim${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const PRIMARY = 0;
  const SURPLUS = 1;
  const client = (i) => env.clients[i];

  // One block at a time until the surplus holder's trim pass reports its safety
  // verdict on the app, which it does only when it wants to give the app up.
  const nextSafetyVerdict = async () => {
    const afterId = client(SURPLUS).getLastEventId();
    let verdict = null;
    await driveUntil(client(SURPLUS), async () => {
      const event = client(SURPLUS).getEventBuffer().find((e) => e.id > afterId
        && e.event === 'giveUp:safety' && e.data?.appName === appName);
      verdict = event?.data ?? null;
      return verdict !== null;
    }, { blocks: 40, label: 'the surplus holder\'s trim pass reports its safety verdict' });
    return verdict;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1, minIncoming: 1, masterSlaveStaggerMs: 10000, sigtermExpiryS: SIGTERM_EXPIRY_S,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    // Blocks move only when a test drives them, so no trim pass runs early.
    await stopTicker();
    const seenBefore = env.clients.map((c) => c.getLastEventId());
    const { currentHeight } = await advanceBlock();
    await Promise.all(env.clients.map((c, i) => c.waitForEvent(
      'block:processed', (d) => d.height >= currentHeight, 120000, { afterId: seenBefore[i] },
    )));
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(appName, 'v1', 'swtrim', { user: APP_UID });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'single-writer surplus',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed'],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [PRIMARY]);
    await waitForUp(client(PRIMARY), appName, 'the primary runs the app', { timeout: 300000, interval: 3000 });
    await installOnNodes(env, app, [SURPLUS]);
    await waitFor(() => isFolderSynced(client(SURPLUS), folder), {
      timeout: 300000, interval: 3000, label: 'the surplus copy holds the primary\'s data',
    });
    await waitFor(async () => (await client(SURPLUS).getAppLocations(appName)).data?.length === 2, {
      timeout: 120000, interval: 2000, label: 'both holders announced, so the app is over its count',
    });
  });

  after(async function () {
    this.timeout(60000);
    await startTicker().catch(() => {});
    await env?.teardown();
  });

  it('keeps the surplus copy while its only full peer is shutting down', async function () {
    this.timeout(300000);
    // Held down with its syncthing still running: connected, and complete.
    await shutdownFluxosGracefully(client(PRIMARY).container, { hold: true });
    const [sigterm] = await dbClient(SURPLUS + 1).getAppStateEvents({ ip: socketAddr(PRIMARY + 1), type: 'sigterm' });
    expect(sigterm, 'fixture: the surplus holder heard the shutdown').to.not.equal(undefined);

    const verdict = await nextSafetyVerdict();
    const sinceShutdown = Date.now() - sigterm.broadcastedAt.getTime();
    expect(sinceShutdown, 'fixture: the pass ran after the shutdown\'s window closed')
      .to.be.below(SIGTERM_EXPIRY_S * 1000);
    expect(verdict.safe, `the surplus copy was given up to a peer that is leaving: ${JSON.stringify(verdict)}`).to.equal(false);
    expect(await client(SURPLUS).getInstalledApps().then((r) => r.data.map((a) => a.name)), 'the surplus copy')
      .to.include(appName);
  });

  it('trims the surplus copy once that peer is back and holding again', async function () {
    this.timeout(600000);
    await releaseFluxos(client(PRIMARY).container);
    await waitForUp(client(PRIMARY), appName, 'the primary runs the app again', { timeout: 300000, interval: 3000 });
    await waitFor(async () => {
      const events = await dbClient(SURPLUS + 1).getAppStateEvents({ ip: socketAddr(PRIMARY + 1) });
      const sigterm = events.find((e) => e.type === 'sigterm');
      const running = events.find((e) => e.type === 'apprunning');
      return running && (!sigterm || running.broadcastedAt > sigterm.broadcastedAt);
    }, { timeout: 180000, interval: 2000, label: 'the primary reported running after its shutdown' });

    const verdict = await nextSafetyVerdict();
    expect(verdict.safe, `the trim refused a peer that is back: ${JSON.stringify(verdict)}`).to.equal(true);
    await waitForAppRemoved(client(SURPLUS), appName, 180000);
    expect(await isAppContainerRunning(client(PRIMARY).container, appName), 'the primary still runs the app').to.equal(true);
  });
});
