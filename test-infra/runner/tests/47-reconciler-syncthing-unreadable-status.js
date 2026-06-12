import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setStatusUnreadable, setSynced, setPeerHasData, getNudges, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS data-safety gate: an unreadable folder status means the node can
// verify NOTHING - neither that its data is synced nor that any peer holds it.
// The old machinery removed the app after a threshold ("blind cleanup"); the
// contract is REVERSED: no removal without positive evidence, ever. The node
// stays receiveonly, never starts on unverified data, and recovers by itself
// the moment the status becomes readable again.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('reconciler never removes (or starts) on an unreadable sync status', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eunread${Date.now()}`;
  let app;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    app = await seedSyncthingApp(env, { name: appName, mode: 'r', forceNonLeader: true, index: 0 });
    // unreadable BEFORE the first evaluation; a connected synced peer exists,
    // but without a readable local status that is not evidence to act on
    await setStatusUnreadable({ ip: subnet.nodeIp(1), folder: app.folder });
    await setPeerHasData({ ip: subnet.nodeIp(1), folder: app.folder });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('waits with no removal, no start and no nudge while the status is unreadable', async function () {
    this.timeout(120000);
    const client = env.clients[app.index];
    // far past every compressed ladder window (nudge 6s, removal >=30s)
    await assertNoEvent(client, 'app:removed', (d) => d.name === appName, 60000);
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === app.identifier && d.action === 'started', 1000);
    const { nudges } = await getNudges(subnet.nodeIp(1));
    expect(nudges.filter((n) => n.action === 'pause')).to.have.lengthOf(0);
    expect(nudges.filter((n) => n.action === 'restart')).to.have.lengthOf(0);
    expect(await isUp(client, appName)).to.equal(false);
  });

  it('recovers by itself once the status is readable and synced', async function () {
    this.timeout(120000);
    const client = env.clients[app.index];
    const afterId = client.getLastEventId();
    await setSynced({ ip: subnet.nodeIp(1), folder: app.folder });
    await client.waitForEvent('reconciler:actuated', (d) => d.identifier === app.identifier && d.action === 'started', 90000, { afterId });
    expect(await isUp(client, appName)).to.equal(true);
  });
});
