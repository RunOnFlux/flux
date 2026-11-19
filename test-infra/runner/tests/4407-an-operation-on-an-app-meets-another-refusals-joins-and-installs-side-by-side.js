/*
 * Each app's operations go through its own manager, and these are the meetings the unit suite
 * cannot see: an owner's start, stop or restart while a restore holds the app is refused and leaves
 * the restore's record as the restore wrote it; two removals of one app asked at once run one
 * teardown and answer both; a removal stops a redeploy held before its image pull and removes the
 * app; a removal stops a backup whose tar is running; and a second app installs while a first
 * app's install is held, because no node-wide lock stands between installs of different apps.
 *
 * Every meeting is made by holding the first operation at a checkpoint, or, for the running tar,
 * by an archive large enough that the tar is still running when the removal is asked for and a
 * tar process the test sees in the node.
 *
 * Each case has an app of its own, a plain one on one node of three (the ring needs three).
 */
import {
  describe, it, before, afterEach,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning, execInContainer } from '../framework/container.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  ORIGINAL, writeAppdata, readAppdata, appdataOf, stageLocalArchive, restoreLocal, restoreRecord,
} from '../framework/restore-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const RESTORED = Object.freeze({ 'restored.txt': 'restored' });

describe('an operation on an app meets another', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const SUBJECT = 1;
  const client = () => env.clients[SUBJECT];
  const ownerAuth = async () => (await authenticate(client().url, appOwnerKey())).zelidauth;
  const teamAuth = async () => (await authenticate(client().url, fluxTeamKey())).zelidauth;

  // An app of the case's own, running on the subject with its data in place.
  async function placedApp(tag) {
    const appName = `e2e${tag}${ts}`;
    const app = await buildSeedableApp({ name: appName, env, instances: 1 });
    await installOnNodes(env, app, [SUBJECT]);
    await waitForUp(client(), appName, `${appName} runs`, { timeout: 180000, interval: 2000 });
    await writeAppdata(client(), appName, appName, ORIGINAL);
    return appName;
  }

  async function removed(appName) {
    await waitFor(async () => !(await isAppContainerRunning(client().container, appName)), {
      timeout: 120000, interval: 2000, label: `${appName} is removed`,
    });
  }

  // Holds `name` for `key` and resolves once an operation has reached it, with that operation's
  // response in an object, so the caller's await does not wait for the held operation.
  async function heldAt(name, key, start) {
    await client().holdCheckpoint(name, key);
    const mark = client().getLastEventId();
    const running = start();
    running.catch(() => {});
    await client().waitForEvent('checkpoint:held', (d) => d.name === name && d.key === key, 180000, { afterId: mark });
    return { running };
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
  });

  // a case that fails while it holds an operation leaves the next case nothing held
  afterEach(async function () {
    await client()?.releaseAllCheckpoints();
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('refuses an owner\'s start, stop and restart while a restore holds the app, and leaves the restore\'s record', async function () {
    this.timeout(600000);
    const appName = await placedApp('ownerrefused');
    const folder = `flux${appName}_${appName}`;
    await stageLocalArchive(client(), appName, appName, RESTORED);
    const { running: restoring } = await heldAt('restore:beforeClear', folder, async () => restoreLocal(client(), appName, [appName], await ownerAuth()));
    expect(await restoreRecord(SUBJECT, `${appName}_${appName}`), 'the restore recorded the component held').to.equal(true);

    // eslint-disable-next-line no-restricted-syntax
    for (const action of ['appstart', 'appstop', 'apprestart']) {
      // eslint-disable-next-line no-await-in-loop
      const answer = await client().appControl(action, appName, await ownerAuth());
      expect(JSON.stringify(answer.data), `the ${action}`).to.include(`Refused: a restore of ${appName} is in progress`);
    }
    expect(await restoreRecord(SUBJECT, `${appName}_${appName}`), 'a refused owner action changed the restore\'s record').to.equal(true);

    await client().releaseCheckpoint('restore:beforeClear', folder);
    await restoring;
    expect(await readAppdata(client(), appName, appName, Object.keys(RESTORED)), 'the restored data').to.deep.equal(RESTORED);
    expect(await restoreRecord(SUBJECT, `${appName}_${appName}`), 'the restore cleared its record').to.equal(false);
  });

  it('runs one removal for two removals of an app asked at once, and answers both', async function () {
    this.timeout(600000);
    const appName = await placedApp('joined');
    const mark = client().getLastEventId();
    const { running: first } = await heldAt('removal:beforeTeardown', appName, async () => client().removeAppLocally(appName, await ownerAuth()));

    const second = client().removeAppLocally(appName, await ownerAuth());
    await client().releaseCheckpoint('removal:beforeTeardown', appName);
    const answers = await Promise.all([first, second]);

    expect(answers[1], 'the second removal').to.include(`Flux App ${appName} was being removed already`);
    await removed(appName);
    const teardowns = client().getEventBuffer().filter((e) => e.id > mark && e.event === 'app:removed' && e.data?.name === appName);
    expect(teardowns, 'the app was torn down more than once').to.have.lengthOf(1);
  });

  it('stops a redeploy held before its image pull for a removal, and removes the app', async function () {
    this.timeout(900000);
    const appName = await placedApp('redeploystop');
    const { running: redeploying } = await heldAt('install:beforePull', appName, async () => client().redeployApp(appName, await ownerAuth(), { force: false }));

    const mark = client().getLastEventId();
    const removing = client().removeAppLocally(appName, await ownerAuth());
    await client().waitForEvent('app:operationPreempted', (d) => d.appName === appName && d.operation === 'redeploy' && d.by === 'removal', 120000, { afterId: mark });
    await client().releaseCheckpoint('install:beforePull', appName);

    expect(await redeploying, 'the redeploy').to.include(`${appName}: stopped for its removal`);
    await removing;
    await removed(appName);
  });

  it('stops a backup whose tar is running for a removal, and removes the app', async function () {
    this.timeout(900000);
    const appName = await placedApp('tarstop');
    // incompressible, so the tar is still running when the removal is asked for
    const big = `${appdataOf(appName)}/big.bin`;
    const written = await execInContainer(client().container, `head -c 400M /dev/urandom > ${big} && stat -c %s ${big}`);
    expect(written.stdout.trim(), 'the data the backup archives').to.equal(String(400 * 1024 * 1024));

    // the bracket keeps the pattern from matching the shell that runs pgrep
    const backingUp = client().appendBackupTask(appName, [appName], await ownerAuth());
    await waitFor(async () => (await execInContainer(client().container, 'pgrep -f "[t]ar -czf"')).exitCode === 0, {
      timeout: 180000, interval: 200, label: `the backup of ${appName} is archiving`,
    });

    const mark = client().getLastEventId();
    const removing = client().removeAppLocally(appName, await ownerAuth());
    await client().waitForEvent('app:operationPreempted', (d) => d.appName === appName && d.operation === 'backup' && d.by === 'removal', 120000, { afterId: mark });

    expect(await backingUp, 'the backup').to.include(`${appName}: stopped for its removal`);
    expect((await execInContainer(client().container, 'pgrep -f "[t]ar -czf"')).exitCode, 'the archive kept running').to.not.equal(0);
    await removing;
    await removed(appName);
  });

  it('installs a second app while a first app\'s install is held', async function () {
    this.timeout(900000);
    const first = await buildSeedableApp({ name: `e2eheldinstall${ts}`, env, instances: 1 });
    const second = await buildSeedableApp({ name: `e2ebesideinstall${ts}`, env, instances: 1 });
    await deliverApp(env, first, [SUBJECT]);
    const { running: installingFirst } = await heldAt('install:beforeContainers', first.spec.name, async () => client().installAppLocally(first.spec.name, await teamAuth()));

    await installOnNodes(env, second, [SUBJECT]);
    await waitForUp(client(), second.spec.name, `${second.spec.name} runs while ${first.spec.name}'s install is held`, { timeout: 180000, interval: 2000 });
    expect(await isAppContainerRunning(client().container, first.spec.name), 'the held install ran').to.equal(false);

    await client().releaseCheckpoint('install:beforeContainers', first.spec.name);
    await installingFirst;
    await waitForUp(client(), first.spec.name, `${first.spec.name} runs once released`, { timeout: 180000, interval: 2000 });
  });
});
