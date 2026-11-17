/*
 * A component whose restore stopped part way through is released only by data that
 * replaces what the restore left - a new volume from a hard redeploy, a hard update
 * reinstall or an install - or by its owner's start. A soft redeploy keeps its volume
 * and so keeps it held, and a FluxOS restart forgets nothing.
 *
 * Each case has an app of its own, one component that does not sync, on one node of
 * three (the ring needs three): with no peer to heal from, nothing but these releases
 * it. The data is damaged as a failed clear leaves it: two files deleted, one kept in
 * a directory the clear could not remove. An install over an old record is an app
 * whose removal could not delete its runtime record, as when the database refuses
 * that delete.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { crashFluxos, releaseFluxos, isAppContainerRunning } from '../framework/container.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { failCommands } from '../framework/mongo-control.js';
import { waitFor, waitHolding, waitForUp } from '../framework/wait.js';
import {
  ORIGINAL, DELETED_BY_CLEAR, writeAppdata, readAppdata, lockPart, unlockPart, stageLocalArchive,
  restoreRecord, restoreLocal, recordWrites,
} from '../framework/restore-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const RESTORED = Object.freeze({ 'restored.txt': 'restored' });
// reconciler passes a held component is watched through
const PASSES = 3;

describe('a restore left part replaced is released only by new data or its owner', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const SUBJECT = 1;
  const client = () => env.clients[SUBJECT];
  const ownerAuth = async () => (await authenticate(client().url, appOwnerKey())).zelidauth;
  const apps = [];

  const isUp = (appName) => isAppContainerRunning(client().container, appName);
  const heldPasses = (identifier) => client().getDecisionCount('reconciler:held', identifier, 'restoreUnfinished');
  // Holds "stopped and recorded" until the reconciler has decided about it PASSES more times.
  async function holdThroughPasses(appName, label) {
    const identifier = `${appName}_${appName}`;
    const from = await heldPasses(identifier);
    await waitHolding(async () => {
      expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(true);
      expect(await isUp(appName), 'the held component runs').to.equal(false);
      return (await heldPasses(identifier)) >= from + PASSES;
    }, { timeout: 300000, interval: 2000, label });
  }

  // An app of the case's own, running on the subject with its data in place, then held
  // by a restore that failed at the clear.
  async function heldApp(tag) {
    const appName = `e2e${tag}${ts}`;
    const app = await buildSeedableApp({ name: appName, env, instances: 1 });
    apps.push(appName);
    await installOnNodes(env, app, [SUBJECT]);
    await waitForUp(client(), appName, `${appName} runs before its restore`, { timeout: 180000, interval: 2000 });
    await writeAppdata(client(), appName, appName, ORIGINAL);
    await stageLocalArchive(client(), appName, appName, RESTORED);
    await lockPart(client(), appName);
    const identifier = `${appName}_${appName}`;
    const mark = client().getLastEventId();
    const body = await restoreLocal(client(), appName, [appName], await ownerAuth());
    expect(body, 'fixture: the restore failed at the clear').to.match(/could not clear/i);
    const left = await readAppdata(client(), appName, appName, Object.keys(ORIGINAL));
    DELETED_BY_CLEAR.forEach((path) => expect(left[path], `fixture: the clear deleted ${path}`).to.equal(null));
    expect(recordWrites(client(), identifier, mark), 'the restore recorded the component held').to.deep.equal([true]);
    await holdThroughPasses(appName, `${appName} held after its restore failed`);
    return { app, appName, identifier };
  }

  // The record is cleared, the component runs, and its data is not the half-replaced copy.
  async function released({ appName, identifier }, mark, label) {
    await waitFor(() => recordWrites(client(), identifier, mark).includes(false), {
      timeout: 600000, interval: 2000, label: `${label}: the record is cleared`,
    });
    expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(false);
    await waitForUp(client(), appName, `${label}: the component runs`, { timeout: 300000, interval: 3000 });
    expect(await readAppdata(client(), appName, appName, ['locked/kept.txt']), 'the data it runs on')
      .to.deep.equal({ 'locked/kept.txt': null });
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
  });

  afterTeardown(async function () {
    if (env) await Promise.all(apps.map((appName) => unlockPart(client(), appName).catch(() => {})));
    await env?.teardown();
  });

  it('holds it across a FluxOS restart until its owner starts it', async function () {
    this.timeout(900000);
    const held = await heldApp('rsnone');
    await crashFluxos(client().container, { hold: true });
    await releaseFluxos(client().container);
    await holdThroughPasses(held.appName, 'held after a FluxOS restart');
    await unlockPart(client(), held.appName);
    const mark = client().getLastEventId();
    await client().getAuthed(`/apps/appstart/${held.appName}`, await ownerAuth());
    await waitFor(() => recordWrites(client(), held.identifier, mark).includes(false), {
      timeout: 120000, interval: 1000, label: 'the owner\'s start clears the record',
    });
    await waitForUp(client(), held.appName, 'the started component runs', { timeout: 300000, interval: 3000 });
    expect(await readAppdata(client(), held.appName, held.appName, ['locked/kept.txt', 'a.txt']), 'the data it runs on')
      .to.deep.equal({ 'locked/kept.txt': ORIGINAL['locked/kept.txt'], 'a.txt': null });
  });

  it('keeps it held, and does not start it, through a soft redeploy', async function () {
    this.timeout(900000);
    const held = await heldApp('rssoft');
    const mark = client().getLastEventId();
    await client().redeployApp(held.appName, await ownerAuth(), { force: false });
    await client().waitForEvent('app:softRedeployed', (d) => d.name === held.appName, 300000, { afterId: mark });
    await holdThroughPasses(held.appName, 'held after a soft redeploy');
    expect(recordWrites(client(), held.identifier, mark), 'record writes since the redeploy').to.deep.equal([]);
  });

  it('releases it with the new volume of a hard redeploy', async function () {
    this.timeout(900000);
    const held = await heldApp('rshard');
    await unlockPart(client(), held.appName);
    const mark = client().getLastEventId();
    await client().redeployComponent(held.appName, held.appName, await ownerAuth(), { force: true });
    await released(held, mark, 'a hard redeploy');
  });

  it('releases it with the new volume of a hard update reinstall', async function () {
    this.timeout(1800000);
    const held = await heldApp('rsupd');
    await unlockPart(client(), held.appName);
    const updated = await buildSeedableUpdate(held.app, (spec) => {
      // a change of storage reinstalls the component hard
      // eslint-disable-next-line no-param-reassign
      spec.compose[0].hdd += 1;
    });
    const mark = client().getLastEventId();
    await deliverApp(env, updated, [SUBJECT]);
    await stopTicker();
    await driveUntil(client(), () => recordWrites(client(), held.identifier, mark).includes(false), {
      blocks: 216, label: 'the hard update reinstall clears the record',
    });
    await released(held, mark, 'a hard update reinstall');
  });

  it('does not hold an install made over a record its removal could not delete', async function () {
    this.timeout(900000);
    const held = await heldApp('rsinst');
    await unlockPart(client(), held.appName);
    const release = await failCommands(SUBJECT + 1, 'localzelapps', 'zelappsruntimestate', { commands: ['delete'] });
    try {
      await client().removeAppLocally(held.appName, await ownerAuth());
      await waitFor(async () => !(await client().get(`/apps/installedapps?_=${Date.now()}`))?.data?.some((a) => a.name === held.appName), {
        timeout: 300000, interval: 3000, label: 'the app is removed',
      });
    } finally {
      await release();
    }
    expect(await restoreRecord(SUBJECT, held.identifier), 'fixture: the record outlives the removal').to.equal(true);
    const mark = client().getLastEventId();
    await installOnNodes(env, held.app, [SUBJECT]);
    await released(held, mark, 'an install');
  });
});
