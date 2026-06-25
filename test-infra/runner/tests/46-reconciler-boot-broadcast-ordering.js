import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { waitForUp } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// B3 end-to-end: the first post-boot fluxapprunning broadcast.
//  (a) a peer's appsLocations rows for the rebooting node SURVIVE its first
//      post-boot broadcast (the deleted firstRun bypass used to broadcast an
//      empty snapshot, which wiped every row network-wide);
//  (b) NO empty v2 fluxapprunning is ever emitted - including by a node with
//      nothing installed (the wiped-node shape the bypass existed for);
//  (c) the first broadcast after boot is COMPLETE: it contains the app, i.e. it
//      waited for the reconciler's boot drain instead of racing the boot starts.
// (d - light) the started component reaches the peer as a fresh broadcast
//      shortly after boot, well inside the sigterm TTL window.

describe('first post-boot broadcast: complete, never empty, never destructive', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ebootbc${Date.now()}`;
  let idx; // node running the app
  let peerIdx; // observer peer

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName, { port: 31119 }));
    peerIdx = (idx + 1) % env.clients.length;
    await waitForUp(env.clients[idx], appName, 'app running before the reboot');
    // the peer must have learned the location before the reboot
    const peerDb = dbClient(peerIdx + 1);
    await env.clients[peerIdx].waitForEvent('network:apprunning', (d) => d.apps?.some((a) => a.name === appName), 90000).catch(() => {});
    const rows = await peerDb.getAppLocations(appName);
    expect(rows.length, 'peer must hold a location row before the reboot').to.be.greaterThan(0);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('peer rows survive the reboot; the first broadcast is complete and never empty', async function () {
    this.timeout(300000);
    const peerClient = env.clients[peerIdx];
    const peerDb = dbClient(peerIdx + 1);
    const afterId = peerClient.getLastEventId();

    // machine-reboot shape: the whole node container restarts (fluxos + dockerd
    // + app containers); the reconciler restarts the app at boot
    await env.restartNode(idx);
    const client = env.clients[idx];

    // (c)+(d): the first apprunning that mentions our node's app set after the
    // reboot must CONTAIN the app - a complete post-drain snapshot, arriving
    // well inside the TTL window
    await peerClient.waitForEvent(
      'network:apprunning',
      (d) => d.apps?.some((a) => a.name === appName),
      180000,
      { afterId },
    );

    // (b): at no point did ANY node emit an empty v2 snapshot (the peer's SSE
    // buffer holds every apprunning it received across the reboot window)
    const received = peerClient.getEventBuffer().filter((e) => e.id > afterId && e.event === 'network:apprunning');
    expect(received.length, 'buffer must hold the apprunning waitForEvent just matched (filter shape drift)').to.be.greaterThan(0);
    const empty = received.filter((e) => Array.isArray(e.data?.apps) && e.data.apps.length === 0);
    expect(empty, 'no empty fluxapprunning v2 snapshots').to.have.lengthOf(0);

    // (a): the peer's location rows for the app survived the whole sequence
    const rows = await peerDb.getAppLocations(appName);
    expect(rows.length, 'peer location rows survived the reboot broadcast').to.be.greaterThan(0);

    await waitForUp(client, appName, 'app running again after reboot');
  });
});
