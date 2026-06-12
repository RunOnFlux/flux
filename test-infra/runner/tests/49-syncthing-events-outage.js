import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setSyncing, setSynced, injectSyncthingEvent, setEventsOutage, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The events consumer is the EDGE half of the level-triggered design: it only
// accelerates the same evaluation the periodic poll drives, so every stream
// failure must cost latency, never correctness. This suite breaks the stream
// the way a syncthing restart actually LOOKS to a consumer - transport errors
// for the restart window (the API never returns events below a stale `since`,
// so a bare id reset is invisible; verified against lib/events Since()) - and
// asserts:
//   - one syncthing:eventsResync once the stream recovers (the blind window is
//     handed to the level loop), not one per failed poll;
//   - the scenario still converges afterwards (the follower starts once synced),
//     i.e. behavior degraded to the poll cadence and nothing broke.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('syncthing events-stream outage degrades to the poll, never to wrong actions', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eevout${Date.now()}`;
  let app;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    app = await seedSyncthingApp(env, { name: appName, mode: 'r', forceNonLeader: true, index: 0 });
    // actively syncing - healthy, nothing for the ladder to do
    await setSyncing({ ip: subnet.nodeIp(1), folder: app.folder, percent: 40 });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('announces ONE resync when the stream recovers from an outage (syncthing restart shape)', async function () {
    this.timeout(120000);
    const client = env.clients[app.index];
    const nodeIp = subnet.nodeIp(1);

    // advance the consumer's `since` past zero: deliver a couple of real events
    await injectSyncthingEvent({ ip: nodeIp, type: 'FolderSummary', data: { folder: app.folder, summary: {} } });
    await injectSyncthingEvent({ ip: nodeIp, type: 'FolderSummary', data: { folder: app.folder, summary: {} } });
    // give the long-poll a moment to deliver them (responds early on arrival)
    await new Promise((r) => { setTimeout(r, 8000); });

    // "syncthing restarting": the events endpoint dies for a window long enough
    // for several failed polls (5s retry backoff) - events injected meanwhile
    // are the blind window the resync must hand to the level loop
    const afterId = client.getLastEventId();
    await setEventsOutage({ ip: nodeIp, enabled: true });
    await new Promise((r) => { setTimeout(r, 12000); });
    await injectSyncthingEvent({ ip: nodeIp, type: 'FolderSummary', data: { folder: app.folder, summary: {} } });
    await setEventsOutage({ ip: nodeIp, enabled: false });

    await client.waitForEvent('syncthing:eventsResync', () => true, 60000, { afterId });

    // one resync per outage, not one per failed poll: let the stream settle,
    // then count what actually arrived
    await new Promise((r) => { setTimeout(r, 8000); });
    const resyncs = client.getEventBuffer().filter((e) => e.id > afterId && e.event === 'syncthing:eventsResync');
    expect(resyncs).to.have.lengthOf(1);
  });

  it('still converges after the outage (degraded to poll cadence, nothing broken)', async function () {
    this.timeout(120000);
    const client = env.clients[app.index];
    const afterId = client.getLastEventId();
    await setSynced({ ip: subnet.nodeIp(1), folder: app.folder });
    await client.waitForEvent('reconciler:actuated', (d) => d.identifier === app.identifier && d.action === 'started', 90000, { afterId });
    expect(await isUp(client, appName)).to.equal(true);
  });
});
