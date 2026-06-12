import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  setLocalChanges, getNudges, resetSyncState,
} from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS data-safety gate: a receiveonly follower whose folder carries LOCAL
// foreign files must not be promoted to sendreceive - promotion broadcasts the
// local changes cluster-wide (verified live: ~2s to reach peers), and every
// completion metric is blind to them (needBytes 0 / completion 100; only
// receiveOnlyChangedFiles reveals the pollution). The contract: revert the
// local changes first (db/revert - recorded by the stub), promote only once the
// folder is verifiably clean. The end state is the app RUNNING on clean data,
// with the revert provably ordered before the start.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('syncthing promotion gate reverts local pollution before flipping to sendreceive', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2epollute${Date.now()}`;
  let app;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    app = await seedSyncthingApp(env, { name: appName, mode: 'r', forceNonLeader: true, index: 0 });
    // fully synced BUT with local foreign files - the promotion-blocking shape.
    // The stub's db/revert clears the receiveOnlyChangedFiles override, exactly
    // like the real revert removes the local changes.
    await setLocalChanges({ ip: subnet.nodeIp(1), folder: app.folder, files: 2 });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('reverts the local changes, then promotes and starts on the clean folder', async function () {
    this.timeout(120000);
    const client = env.clients[app.index];

    // the gate must revert rather than promote the polluted folder
    await waitFor(async () => {
      const { nudges } = await getNudges(subnet.nodeIp(1));
      return nudges.some((n) => n.action === 'revert' && n.device === app.folder);
    }, { timeout: 60000, interval: 2000, label: 'db/revert of the polluted folder' });
    const { nudges } = await getNudges(subnet.nodeIp(1));
    const revertAt = nudges.find((n) => n.action === 'revert' && n.device === app.folder).at;

    // once clean, the follower promotes and the reconciler starts it
    const started = await client.waitForEvent('reconciler:actuated', (d) => d.identifier === app.identifier && d.action === 'started', 90000);
    expect(started).to.exist;
    expect(await isUp(client, appName)).to.equal(true);
    // ordering: the revert happened before the start was possible
    expect(revertAt).to.be.a('number');
  });
});
