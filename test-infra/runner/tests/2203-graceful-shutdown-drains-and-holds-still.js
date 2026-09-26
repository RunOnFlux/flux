import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  isAppContainerRunning, shutdownFluxosGracefully, releaseFluxos, blockTraffic, unblockTraffic,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, statPath, readPath, startDaemon,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node shutting down hands its single-writer (g:) data to the standby before
// it goes, and holds still while it does.
//
// On a system shutdown FluxOS stops the app's containers - the app writes its
// final save on SIGTERM - and then waits until every connected peer holds what
// this node's folders hold. Syncthing is stopped right after FluxOS exits, so
// whatever has not left by then leaves only after the next boot. The node's
// shutdown here is the real one: the shutdown marker FluxOS reads, SIGTERM, and
// the node's own syncthing stopped the moment FluxOS exits.
//
// While it waits, nothing on the node may start a container again: the stop it
// has just made is the reason the final save exists.

const APP_UID = 1000;
const SYNCTHING_PORT = 16129;
const FINAL_SAVE = 'final.sav';
const DRAIN_TIMEOUT_MS = 30000;

describe('a graceful shutdown drains to the standby and holds still', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eswdrain${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const HOLDERS = [0, 1];
  const [FIRST, SECOND] = HOLDERS;
  const client = (i) => env.clients[i];
  const running = async (i) => isAppContainerRunning(client(i).container, appName);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1, masterSlaveStaggerMs: 10000 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(appName, 'v1', 'swdrain', { user: APP_UID });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'single-writer drain',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed', `WRITE_ON_SIGNAL=/appdata/${FINAL_SAVE}`],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [FIRST]);
    await waitForUp(client(FIRST), appName, 'the first holder runs the app', { timeout: 300000, interval: 3000 });
    await installOnNodes(env, app, [SECOND]);
    await waitFor(() => isFolderSynced(client(SECOND), folder), {
      timeout: 300000, interval: 3000, label: 'the standby has the primary\'s data',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('delivers the app\'s final save to the standby before FluxOS exits', async function () {
    this.timeout(300000);
    expect(await readPath(client(SECOND), `${root}/appdata/${FINAL_SAVE}`), 'fixture: no final save yet').to.equal(null);

    // The primary's syncthing stops the moment FluxOS exits, so what has not
    // reached the standby by then does not reach it at all.
    await shutdownFluxosGracefully(client(FIRST).container, { hold: true, stopSyncthingAfter: true });
    await waitFor(() => env.nodeHasLog(FIRST, /Shutdown drain complete/), {
      timeout: 10000, interval: 500, label: 'the primary drained to completion',
    });

    const path = `${root}/appdata/${FINAL_SAVE}`;
    await waitFor(async () => (await readPath(client(SECOND), path)) === 'written on signal\n', {
      timeout: 30000, interval: 1000, label: 'the final save on the standby',
    });
    expect(await statPath(client(SECOND), path), 'the final save\'s owner on the standby').to.include({ uid: APP_UID });
  });

  it('starts nothing again while it waits for a peer that cannot receive', async function () {
    this.timeout(600000);
    // The standby took over from the node that left; the node that left comes
    // back as a standby, so the roles have swapped.
    await waitForUp(client(SECOND), appName, 'the standby takes over', { timeout: 300000, interval: 3000 });
    await startDaemon(client(FIRST));
    await releaseFluxos(client(FIRST).container);
    await waitFor(async () => (await getFolderConfig(client(FIRST), folder))?.type === 'receiveonly'
      && await isFolderSynced(client(FIRST), folder), {
      timeout: 300000, interval: 3000, label: 'the old primary is a synced standby again',
    });

    // The new primary's final save cannot reach anyone, so its drain runs to
    // the deadline - the longest a node holds still.
    await blockTraffic(client(SECOND).container, [client(FIRST).ip], SYNCTHING_PORT);
    try {
      const started = Date.now();
      const shutdown = shutdownFluxosGracefully(client(SECOND).container, { hold: true });
      let settled = false;
      shutdown.finally(() => { settled = true; }).catch(() => {});

      let stoppedAt = null;
      let restartedAt = null;
      while (!settled) {
        // eslint-disable-next-line no-await-in-loop
        const up = await running(SECOND);
        if (!up && stoppedAt === null) stoppedAt = Date.now();
        if (up && stoppedAt !== null && restartedAt === null) restartedAt = Date.now();
        // eslint-disable-next-line no-await-in-loop
        await sleepUnlessInfraDead(500);
      }
      await shutdown;

      expect(stoppedAt, 'the app was stopped for the shutdown').to.not.equal(null);
      expect(restartedAt, `the app started again ${restartedAt - stoppedAt}ms into the drain`).to.equal(null);
      expect(Date.now() - started, 'the drain held for its whole deadline').to.be.at.least(DRAIN_TIMEOUT_MS);
      await waitFor(() => env.nodeHasLog(SECOND, /Shutdown drain reached its deadline/), {
        timeout: 10000, interval: 500, label: 'the drain reached its deadline',
      });
    } finally {
      await unblockTraffic(client(SECOND).container, [client(FIRST).ip], SYNCTHING_PORT);
      await releaseFluxos(client(SECOND).container);
    }
  });
});
