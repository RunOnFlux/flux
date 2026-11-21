/*
 * One operation holds an app at a time. A restore asked for while a backup of the
 * app runs is refused; a redeploy waits for the backup to finish and then runs; a
 * removal stops a running backup or restore at its next step and removes the app.
 *
 * Each case holds the running backup at backup:beforeArchive (or the restore at
 * restore:beforeClear) and asks for the second operation while it is held, so the
 * second always meets the first mid-way. Each case has an app of its own, a plain
 * one on one node of three (the ring needs three), with its data written before.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning, execInContainer } from '../framework/container.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  ORIGINAL, writeAppdata, readAppdata, stageLocalArchive, restoreLocal, localArchiveOf,
} from '../framework/restore-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const RESTORED = Object.freeze({ 'restored.txt': 'restored' });

describe('one operation holds an app: a removal stops its backup or restore, a redeploy waits for it, a restore is refused', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const SUBJECT = 1;
  const client = () => env.clients[SUBJECT];
  const ownerAuth = async () => (await authenticate(client().url, appOwnerKey())).zelidauth;

  // An app of the case's own, running on the subject with its data in place.
  async function placedApp(tag) {
    const appName = `e2e${tag}${ts}`;
    const app = await buildSeedableApp({ name: appName, env, instances: 1 });
    await installOnNodes(env, app, [SUBJECT]);
    await waitForUp(client(), appName, `${appName} runs`, { timeout: 180000, interval: 2000 });
    await writeAppdata(client(), appName, appName, ORIGINAL);
    return appName;
  }

  // What the app's local archive holds, or null when there is none.
  async function archiveListing(appName) {
    const r = await execInContainer(client().container, `tar -tzf ${localArchiveOf(appName)} 2>/dev/null`);
    return r.exitCode === 0 ? r.stdout : null;
  }

  // A backup of the app started and held before it archives anything; its
  // response, in an object so the caller's await does not wait for the backup.
  async function heldBackup(appName) {
    await client().holdCheckpoint('backup:beforeArchive', appName);
    const mark = client().getLastEventId();
    const backingUp = client().appendBackupTask(appName, [appName], await ownerAuth());
    await client().waitForEvent('checkpoint:held', (d) => d.name === 'backup:beforeArchive' && d.key === appName, 180000, { afterId: mark });
    return { backingUp };
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('refuses a restore of an app a backup holds, and the backup finishes whole', async function () {
    this.timeout(600000);
    const appName = await placedApp('brefuse');
    const { backingUp } = await heldBackup(appName);

    const restoreBody = await restoreLocal(client(), appName, [appName], await ownerAuth());
    expect(restoreBody, 'the restore').to.include(`Refused: a backup of ${appName} is in progress`);

    await client().releaseCheckpoint('backup:beforeArchive', appName);
    expect(await backingUp, 'the backup').to.match(/Finalizing/);
    expect(await archiveListing(appName), 'the archive').to.include('a.txt');
  });

  it('runs a redeploy asked for during a backup once the backup has finished', async function () {
    this.timeout(900000);
    const appName = await placedApp('bwait');
    const { backingUp } = await heldBackup(appName);

    const mark = client().getLastEventId();
    const redeploying = client().redeployApp(appName, await ownerAuth(), { force: false });
    await client().waitForEvent('app:operationWaiting', (d) => d.appName === appName && d.operation === 'redeploy' && d.for === 'backup', 120000, { afterId: mark });

    await client().releaseCheckpoint('backup:beforeArchive', appName);
    expect(await backingUp, 'the backup').to.match(/Finalizing/);
    expect(await archiveListing(appName), 'the archive the redeploy waited for').to.include('a.txt');
    expect(await redeploying, 'the redeploy').to.include(`Waiting for the backup of ${appName} to finish before redeploying`);
    await waitForUp(client(), appName, 'the redeployed app runs', { timeout: 300000, interval: 3000 });
  });

  it('stops a backup for a removal of the app, and removes the app', async function () {
    this.timeout(900000);
    const appName = await placedApp('bremove');
    const { backingUp } = await heldBackup(appName);

    const mark = client().getLastEventId();
    const removing = client().removeAppLocally(appName, await ownerAuth());
    await client().waitForEvent('app:operationPreempted', (d) => d.appName === appName && d.operation === 'backup' && d.by === 'removal', 120000, { afterId: mark });

    await client().releaseCheckpoint('backup:beforeArchive', appName);
    expect(await backingUp, 'the backup').to.include(`${appName}: stopped for its removal`);
    await removing;
    await waitFor(async () => !(await isAppContainerRunning(client().container, appName)), {
      timeout: 120000, interval: 2000, label: `${appName} is removed`,
    });
  });

  it('stops a restore for a removal of the app before it clears the data', async function () {
    this.timeout(900000);
    const appName = await placedApp('rremove');
    const folder = `flux${appName}_${appName}`;
    await stageLocalArchive(client(), appName, appName, RESTORED);
    await client().holdCheckpoint('restore:beforeClear', folder);
    await client().holdCheckpoint('removal:beforeTeardown', appName);
    let mark = client().getLastEventId();
    const restoring = restoreLocal(client(), appName, [appName], await ownerAuth());
    await client().waitForEvent('checkpoint:held', (d) => d.name === 'restore:beforeClear' && d.key === folder, 180000, { afterId: mark });

    mark = client().getLastEventId();
    const removing = client().removeAppLocally(appName, await ownerAuth());
    await client().waitForEvent('app:operationPreempted', (d) => d.appName === appName && d.operation === 'restore' && d.by === 'removal', 120000, { afterId: mark });
    await client().releaseCheckpoint('restore:beforeClear', folder);
    expect(await restoring, 'the restore').to.include(`${appName}: stopped for its removal`);

    // the removal has not torn anything down yet: what the restore left is the data as it was
    await client().waitForEvent('checkpoint:held', (d) => d.name === 'removal:beforeTeardown' && d.key === appName, 180000, { afterId: mark });
    expect(await readAppdata(client(), appName, appName, Object.keys(ORIGINAL)), 'the data the stopped restore left').to.deep.equal(ORIGINAL);
    await client().releaseCheckpoint('removal:beforeTeardown', appName);
    await removing;
    await waitFor(async () => !(await isAppContainerRunning(client().container, appName)), {
      timeout: 120000, interval: 2000, label: `${appName} is removed`,
    });
  });
});
