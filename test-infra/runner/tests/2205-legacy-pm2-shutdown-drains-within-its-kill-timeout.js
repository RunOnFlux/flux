import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { shutdownFluxosUnderPm2 } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { isDaemonUp, isFolderSynced, readPath } from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A legacy node's shutdown, with FluxOS run by pm2 the way the multitool starts
// it: pm2 -> start.sh -> npm start -> FluxOS.
//
// On a system shutdown the OS stops pm2, pm2 signals FluxOS and waits for it up
// to its kill timeout, and then the rest of the shutdown stops what is left -
// syncthing among it, which FluxOS started outside pm2's process tree. FluxOS
// stops the app's containers (the app writes its final save as it stops) and
// drains its folders to the standby, so what leaves the node is what FluxOS
// finishes inside pm2's kill timeout.
//
// Two single-writer apps, each with its primary on a pm2 node and its standby
// on a third. One pm2 node has the multitool's kill timeout, 60 s; the other
// has pm2's default, 1.6 s. The app takes 3 s over its final save, as a game
// server does: inside the first timeout, and longer than the second.

const APP_UID = 1000;
const FINAL_SAVE = 'final.sav';
const SAVE_TAKES_MS = 3000;
const MULTITOOL_KILL_TIMEOUT_MS = 60000;
// The node's event stream carries the rest after pm2 returns.
const DELIVERY_MS = 10000;

describe('a legacy node under pm2 drains within its kill timeout', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  // pm2 node, standby, pm2 node, and a node that holds nothing
  const TIMED = 0;
  const STANDBY = 1;
  const DEFAULT = 2;
  const client = (i) => env.clients[i];
  const eventsSince = (i, name, afterId) => client(i).getEventBuffer()
    .filter((e) => e.event === name && e.id > afterId);
  const apps = {
    [TIMED]: `e2epm2timed${stamp}`,
    [DEFAULT]: `e2epm2default${stamp}`,
  };
  const saveOnStandby = (primary) => {
    const folder = `flux${apps[primary]}_${apps[primary]}`;
    return `/mnt/appdata/flux-apps/${folder}/appdata/${FINAL_SAVE}`;
  };

  const buildApp = async (name) => {
    await pushTestApp(name, 'v1', name, { user: APP_UID });
    return buildSeedableApp({
      env,
      name,
      instances: 2,
      compose: [{
        name,
        description: 'single-writer app on a pm2 node',
        repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [
          'WRITE_FILE=/appdata/placed.txt',
          'WRITE_CONTENT=placed',
          `WRITE_ON_SIGNAL=/appdata/${FINAL_SAVE}`,
          `WRITE_ON_SIGNAL_DELAY_MS=${SAVE_TAKES_MS}`,
        ],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
  };

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      legacyNodes: [TIMED, DEFAULT],
      pm2Nodes: { [TIMED]: MULTITOOL_KILL_TIMEOUT_MS, [DEFAULT]: null },
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1, masterSlaveStaggerMs: 10000 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 300000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    for (const primary of [TIMED, DEFAULT]) {
      const name = apps[primary];
      // eslint-disable-next-line no-await-in-loop
      const app = await buildApp(name);
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, [primary]);
      // eslint-disable-next-line no-await-in-loop
      await waitForUp(client(primary), name, `node ${primary} runs ${name}`, { timeout: 300000, interval: 3000 });
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, [STANDBY]);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => isFolderSynced(client(STANDBY), `flux${name}_${name}`), {
        timeout: 300000, interval: 3000, label: `the standby holds ${name}`,
      });
    }
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('delivers the final save to the standby inside the multitool\'s kill timeout', async function () {
    this.timeout(300000);
    expect(await readPath(client(STANDBY), saveOnStandby(TIMED)), 'fixture: no final save yet').to.equal(null);
    const mark = client(TIMED).getLastEventId();

    const { stopMs } = await shutdownFluxosUnderPm2(client(TIMED).container, { stopSyncthingAfter: true });

    // pm2 waited for FluxOS itself, not for its timeout.
    expect(stopMs, 'pm2 reported FluxOS stopped').to.be.below(MULTITOOL_KILL_TIMEOUT_MS);
    const drained = await client(TIMED).waitForEvent('shutdown:drained', () => true, DELIVERY_MS, { afterId: mark });
    expect(drained.data, 'the drain completed').to.include({ complete: true });
    // One stop, one shutdown, however many processes pm2 signalled on the way.
    expect(eventsSince(TIMED, 'shutdown:started', mark), 'shutdowns started').to.have.length(1);

    await waitFor(async () => (await readPath(client(STANDBY), saveOnStandby(TIMED))) === 'written on signal\n', {
      timeout: 30000, interval: 1000, label: 'the final save on the standby',
    });
  });

  it('cuts the shutdown short at pm2\'s default kill timeout, and the final save stays behind', async function () {
    this.timeout(300000);
    const mark = client(DEFAULT).getLastEventId();
    const { stopMs } = await shutdownFluxosUnderPm2(client(DEFAULT).container, { stopSyncthingAfter: true });

    expect(stopMs, 'pm2 gave FluxOS its default time').to.be.below(SAVE_TAKES_MS);
    await client(DEFAULT).waitForEvent('shutdown:started', () => true, DELIVERY_MS, { afterId: mark });

    // Long past the save landing on the node that left: it never leaves, and
    // FluxOS never finished a drain.
    await sleepUnlessInfraDead(SAVE_TAKES_MS + 20000);
    expect(await readPath(client(STANDBY), saveOnStandby(DEFAULT)), 'the final save on the standby').to.equal(null);
    expect(eventsSince(DEFAULT, 'shutdown:drained', mark), 'drains that finished').to.have.length(0);
  });
});
