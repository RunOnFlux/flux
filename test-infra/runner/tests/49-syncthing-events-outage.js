import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setSyncing, setSynced, injectSyncthingEvent, resetSyncthingEventIds, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The events consumer is the EDGE half of the level-triggered design: it only
// accelerates the same evaluation the periodic poll drives, so every stream
// failure must cost latency, never correctness. This suite breaks the stream
// the way a syncthing restart does (event ids regress to 1) and asserts:
//   - the consumer detects the discontinuity and requests a resync
//     (syncthing:eventsResync - lost events are handed to the level loop);
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

  it('detects the id regression as lost events and requests a resync', async function () {
    this.timeout(120000);
    const client = env.clients[app.index];
    const nodeIp = subnet.nodeIp(1);

    // advance the consumer's `since` past zero: deliver a couple of real events
    await injectSyncthingEvent({ ip: nodeIp, type: 'FolderSummary', data: { folder: app.folder, summary: {} } });
    await injectSyncthingEvent({ ip: nodeIp, type: 'FolderSummary', data: { folder: app.folder, summary: {} } });
    // give the long-poll a moment to deliver them (responds early on arrival)
    await new Promise((r) => { setTimeout(r, 8000); });

    // "syncthing restarted": ids regress to 1 - the next delivered event is a
    // discontinuity the consumer must surface as a resync, not silently absorb
    const afterId = client.getLastEventId();
    await resetSyncthingEventIds(nodeIp);
    await injectSyncthingEvent({ ip: nodeIp, type: 'FolderSummary', data: { folder: app.folder, summary: {} } });

    await client.waitForEvent('syncthing:eventsResync', () => true, 60000, { afterId });
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
