/*
 * At boot a node reads the network's location record of each app it holds: one whose
 * record has expired was placed elsewhere while the node was down. When the record
 * cannot be read, the node cannot tell, so it never starts the app: it removes it and
 * tells the network.
 *
 * The check runs for apps whose containers are stopped, which is what a machine reboot
 * leaves. Here FluxOS is killed and held down, the app's container is stopped, and the
 * node's reads of the location collection are refused before FluxOS comes back.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import {
  crashFluxos, getAppContainerId, isAppContainerRunning, releaseFluxos, stopAppContainer,
} from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { failCommands } from '../framework/mongo-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const HOLDER = 0;

function step(what) {
  console.log(`# 3308 ${new Date().toISOString()} ${what}`);
}

describe('boot removes an app whose location it cannot confirm', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ebootunread${Date.now()}`;
  let holder;
  let release;
  let anchors;
  let failedReads;
  let stoppedAtBoot;
  let heldAfterBoot;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    holder = env.clients[HOLDER];

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: appName,
        description: 'boot location test container',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [HOLDER]);
    await waitFor(async () => Boolean(await getAppContainerId(holder.container, appName, appName)), {
      timeout: 120000, interval: 2000, label: 'the app runs before the restart',
    });

    step('taking the node down, its app container stopped and its location reads refused');
    await crashFluxos(holder.container, { hold: true });
    const stopped = await stopAppContainer(holder.container, appName, appName);
    if (stopped.exitCode !== 0) throw new Error(`could not stop the app container: ${stopped.output}`);
    stoppedAtBoot = !(await isAppContainerRunning(holder.container, appName));
    anchors = env.clients.map((client) => client?.getLastEventId());
    release = await failCommands(HOLDER + 1, 'globalzelapps', 'zelappslocation', { commands: ['find'] });
    await releaseFluxos(holder.container, { readyTimeoutMs: 180000 });
    await holder.waitForEvent('boot:settled', () => true, 300000, { afterId: anchors[HOLDER] });
    // read at boot's end: the node's own spawner may place the app again later
    heldAfterBoot = (await holder.getInstalledApps()).data?.some((a) => a.name === appName) ?? null;
    failedReads = await release();
    release = null;
    step('booted');
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    await env?.teardown();
  });

  it('boots with the app\'s container stopped', function () {
    expect(stoppedAtBoot, 'the app\'s container was running when FluxOS came back, so boot had nothing to check').to.equal(true);
  });

  it('had its reads of the location records refused by the database', function () {
    expect(failedReads, 'the database refused none of the node\'s location reads, so nothing below was tested').to.be.at.least(1);
  });

  it('no longer holds the app once boot is over', function () {
    expect(heldAfterBoot, 'boot left an app it could not confirm installed').to.equal(false);
  });

  it('tells the network it no longer holds the app', async function () {
    this.timeout(90000);
    const peers = env.clients.filter((client, i) => client && i !== HOLDER);
    const heard = await Promise.any(peers.map((peer) => peer.waitForEvent(
      'network:appremoved',
      (d) => d.name === appName && d.ip.startsWith(holder.ip),
      60000,
      { afterId: anchors[env.clients.indexOf(peer)] },
    ))).catch(() => null);
    expect(heard, 'no node was told the app had gone').to.not.equal(null);
  });
});
