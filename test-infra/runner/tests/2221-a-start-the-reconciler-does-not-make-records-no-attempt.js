import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, crashAppContainer } from '../framework/container.js';
import { resetFdm, electMaster } from '../framework/fdm-control.js';
import {
  waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged, waitForElectionDecisions, electionDecisionCount,
  assertNoEvent,
} from '../framework/wait.js';
import { setSynced, resetSyncState, injectSyncthingEvent } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { appId, destroyVolume } from '../framework/volume-fixture.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A reconcile pass that does not start a component records no restart attempt.
// The pass restarting a primary whose container died is held just before it
// checks for a controller opinion written since it read the verdict; the
// mount-safety block, which writes its opinion outside the pass, stops the
// component meanwhile. Released, the pass does not start the container, and the
// component's backoff ladder and burst window are as they were before it died.

const subnet = getSubnetConfig();
const BEFORE_START = 'reconciler:beforeStart';


async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a start the reconciler does not make records no attempt', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let holders;
  const appName = `e2enoattempt${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = appId(appName);

  const runningFlags = async () => Promise.all(holders.map((i) => isUp(env.clients[i], appName)));

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    holders = await installOnNodes(env, app, [0, 1]);
    await Promise.all(holders.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));

    await waitFor(async () => (await runningFlags()).filter(Boolean).length === 1, {
      timeout: 60000, interval: 2000, label: 'the election settles on one holder',
    });
  });

  after(async function () {
    this.timeout(60000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('leaves the ladder as it was when an opinion written during the pass stops the start', async function () {
    this.timeout(300000);
    const primary = holders[(await runningFlags()).indexOf(true)];
    const client = env.clients[primary];
    const ip = subnet.nodeIp(primary + 1);

    const observedBefore = await electionDecisionCount(client, identifier, 'primaryObserved');
    await electMaster(appName, ip);
    await waitForElectionDecisions(client, identifier, 'primaryObserved', 1, { from: observedBefore, timeout: 45000 });

    const before = await dbClient(primary + 1).restartAttempts(identifier);

    // The container dies, and the pass restarting it is held before its check.
    await client.holdCheckpoint(BEFORE_START, identifier);
    const beforeCrash = client.getLastEventId();
    await crashAppContainer(client.container, appName);
    await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_START && d.key === identifier, 120000, { afterId: beforeCrash });

    // The volume goes away and mount safety stops the component, writing its
    // opinion while the pass is held.
    const beforeBreak = client.getLastEventId();
    await destroyVolume(client.container, appName);
    await injectSyncthingEvent({ ip, type: 'FolderErrors', data: { folder, errors: [{ error: 'folder marker missing' }] } });
    await waitForReconcilerDesiredChanged(client, identifier, 'stopped', 120000, { afterId: beforeBreak });

    const beforeRelease = client.getLastEventId();
    await client.releaseCheckpoint(BEFORE_START, identifier);

    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 20000, { afterId: beforeRelease });
    expect(await isUp(client, appName), 'the held pass started the container').to.equal(false);
    expect(await dbClient(primary + 1).restartAttempts(identifier), 'a start the pass did not make was recorded as an attempt').to.deep.equal(before);
  });
});
