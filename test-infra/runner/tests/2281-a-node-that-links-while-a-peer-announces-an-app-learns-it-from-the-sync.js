// weight: heavy
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { blockTraffic } from '../framework/container.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installSeededOnNodes } from '../framework/reconciler-suite.js';
import { deliverAppByBlock } from '../framework/app-delivery.js';
import { advanceBlock, startTicker, stopTicker } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const subnet = getSubnetConfig();

// A node that links to a peer while that peer is announcing an app it has just
// started is given the app's location by the state sync its link starts: the
// peer records its announcement before it sends it. A node that read the app as
// missing would place it a second time.
//
// The holder is held between recording its first announcement of the app and
// sending it. A node started then, which can reach the holder alone, links to it
// and syncs from it while the announcement has not gone out.

const HOLDER = 0;
const BYSTANDERS = [1, 2];
const NEWCOMER = 3;
const BEFORE_SENT = 'apps:beforeAnnouncementSent';
const SPAWNER_BEFORE_PASS = 'spawner:beforePass';
const API_PORT = 16127;

describe('a node that links while a peer announces an app learns it from the sync', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2elinkmid${Date.now()}`;
  const client = (i) => env.clients[i];
  const holderAt = () => subnet.nodeIp(HOLDER + 1);
  // The install answers once the app's announcement is sent, so it is awaited only
  // once the held announcement is released.
  let installing;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      deferredNodes: 1,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    // The newcomer reaches the holder alone: the bystanders already hold the
    // app's location from the holder once it is sent, and would answer for it.
    await Promise.all(BYSTANDERS.map((i) => blockTraffic(client(i).container, [subnet.nodeIp(NEWCOMER + 1)], API_PORT)));

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'an app announced while a node links',
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
    // No node but the holder places the app: the others are held between spawner
    // passes for the whole suite.
    const online = [HOLDER, ...BYSTANDERS];
    const parkedFrom = BYSTANDERS.map((i) => client(i).getLastEventId());
    await Promise.all(BYSTANDERS.map((i) => client(i).holdCheckpoint(SPAWNER_BEFORE_PASS)));
    await Promise.all(BYSTANDERS.map((i, k) => client(i).waitForEvent('checkpoint:held', (d) => d.name === SPAWNER_BEFORE_PASS, 180000, { afterId: parkedFrom[k] })));
    await stopTicker();
    await deliverAppByBlock(env, app, online);
    await advanceBlock();
    await startTicker();
    await waitFor(async () => (await Promise.all(online.map((i) => dbClient(i + 1).globalAppSpec(appName))))
      .every((row) => row?.hash === app.hash), { timeout: 120000, interval: 2000, label: 'every node online holds the app' });

    // The holder runs no app yet, so it announces nothing; its first announcement
    // is the one that carries this app, and it is held once recorded.
    const heldFrom = client(HOLDER).getLastEventId();
    await client(HOLDER).holdCheckpoint(BEFORE_SENT);
    installing = installSeededOnNodes(env, app, [HOLDER]);
    installing.catch(() => {});
    await client(HOLDER).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_SENT, 300000, { afterId: heldFrom });
  });

  afterTeardown(async function () {
    await Promise.all([HOLDER, ...BYSTANDERS, NEWCOMER].map((i) => client(i)?.releaseAllCheckpoints().catch(() => {})));
    await env?.teardown();
  });

  it('gives a node that links before the announcement is sent the app\'s location', async function () {
    this.timeout(420000);
    const sentBefore = await dbClient(BYSTANDERS[0] + 1).getAppLocations(appName);
    expect(sentBefore, 'fixture: the held announcement reached a bystander').to.deep.equal([]);

    // Parked before it starts, so the newcomer places nothing either.
    const newcomer = await env.startNode(NEWCOMER);
    const from = newcomer.getLastEventId();
    await newcomer.holdCheckpoint(SPAWNER_BEFORE_PASS);
    await newcomer.waitForEvent(
      'ephemeralSync:peerComplete',
      (d) => d.syncType === 'apprunning' && String(d.peer).split(':')[0] === holderAt(),
      300000,
      { afterId: from },
    );

    const locations = await dbClient(NEWCOMER + 1).getAppLocations(appName);
    expect(locations.map((row) => String(row.ip).split(':')[0]), 'where the newcomer holds the app').to.deep.equal([holderAt()]);
    expect(await dbClient(BYSTANDERS[0] + 1).getAppLocations(appName), 'fixture: the announcement was still held').to.deep.equal([]);

    await client(HOLDER).releaseCheckpoint(BEFORE_SENT);
    await installing;
  });
});
