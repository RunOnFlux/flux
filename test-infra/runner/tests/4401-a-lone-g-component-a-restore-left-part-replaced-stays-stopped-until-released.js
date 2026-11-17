/*
 * A g: component with one holder, whose restore stopped part way through, is held:
 * its container stays stopped and its folder never sends, through election passes,
 * folder passes and a FluxOS restart, until a restore finishes or its owner starts it.
 *
 * With one holder syncthing's global index is this node's own, so the leftovers read
 * as fully synced: nothing on the folder's side says the data is damaged. The app is
 * placed on one node of three (the ring needs three) and FDM names that node its
 * primary throughout, so every input that could start the component points at it.
 * The data is damaged as a failed clear leaves it: two files deleted, one kept in a
 * directory the clear could not remove.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  crashFluxos, releaseFluxos, isAppContainerRunning, getAppContainerStatus,
} from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding, waitForUp, waitForOperatorIntent } from '../framework/wait.js';
import { isDaemonUp, getFolderConfig } from '../framework/syncthing-real.js';
import { electMaster } from '../framework/fdm-control.js';
import {
  ORIGINAL, DELETED_BY_CLEAR, writeAppdata, readAppdata, lockPart, unlockPart, stageLocalArchive,
  archiveDigest, restoreRecord, componentStates, restoreLocal, recordWrites,
} from '../framework/restore-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, otherOwnerKeys, fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const RESTORED = Object.freeze({ 'restored.txt': 'restored' });
// passes a held component is watched through, each kind
const PASSES = 3;

describe('a lone g: component a restore left part replaced stays stopped until a restore finishes or its owner starts it', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2elone${Date.now()}`;
  const mixName = `e2emix${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  const SUBJECT = 1;
  const client = () => env.clients[SUBJECT];
  const ownerAuth = async () => (await authenticate(client().url, appOwnerKey())).zelidauth;

  const folderType = async () => (await getFolderConfig(client(), folder))?.type ?? null;
  const isUp = () => isAppContainerRunning(client().container, appName);
  // one 'evaluated' per election pass over the app, one 'held' per folder pass over a held folder
  const electionPasses = () => client().getDecisionCount('masterSlave:decision', identifier, 'evaluated');
  const heldPasses = () => client().getDecisionCount('syncthing:restoreUnfinished', folder, 'held');
  // Asserted on every poll: the held component neither runs nor sends.
  const stillHeld = async () => {
    expect(await folderType(), 'the held folder sends').to.not.equal('sendreceive');
    expect(await isUp(), 'the held component runs').to.equal(false);
  };
  // Holds the invariant until both loops have passed over the component PASSES more times.
  const holdThroughPasses = async (label) => {
    const [elections, folders] = [await electionPasses(), await heldPasses()];
    await waitHolding(async () => {
      await stillHeld();
      return (await electionPasses()) >= elections + PASSES && (await heldPasses()) >= folders + PASSES;
    }, { timeout: 300000, interval: 2000, label });
  };

  // Damages the data and runs a restore that fails at the clear.
  let failedBody = null;
  let failedAt = 0;
  async function failRestore() {
    await writeAppdata(client(), appName, appName, ORIGINAL);
    await stageLocalArchive(client(), appName, appName, RESTORED);
    await lockPart(client(), appName);
    failedAt = client().getLastEventId();
    failedBody = await restoreLocal(client(), appName, [appName], await ownerAuth());
    expect(failedBody, 'fixture: the restore failed at the clear').to.match(/could not clear/i);
    const left = await readAppdata(client(), appName, appName, Object.keys(ORIGINAL));
    DELETED_BY_CLEAR.forEach((path) => expect(left[path], `fixture: the clear deleted ${path}`).to.equal(null));
    expect(left['locked/kept.txt'], 'fixture: the clear kept the locked file').to.equal(ORIGINAL['locked/kept.txt']);
  }

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', env, instances: 1 });
    await electMaster(appName, client().ip);
    await installOnNodes(env, app, [SUBJECT]);
    await waitForUp(client(), appName, 'the lone holder runs the component', { timeout: 300000, interval: 3000 });
    await waitFor(async () => (await folderType()) === 'sendreceive', {
      timeout: 180000, interval: 2000, label: 'the lone holder\'s folder sends',
    });

    await failRestore();
  });

  afterTeardown(async function () {
    if (env) {
      await unlockPart(client(), appName).catch(() => {});
      await Promise.all(['gs', 'ps'].map((c) => unlockPart(client(), mixName, c).catch(() => {})));
    }
    await env?.teardown();
  });

  it('records the component held before it clears anything', async function () {
    this.timeout(60000);
    expect(recordWrites(client(), identifier, failedAt), 'record writes during the restore').to.deep.equal([true]);
    expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(true);
  });

  it('says in its error line which component it left held and how it is released', async function () {
    const errorLine = failedBody.split('\n').find((line) => /could not clear/i.test(line));
    expect(errorLine, 'the error line').to.match(new RegExp(`^Error: could not clear ${appName} appdata before unpacking\\. ${appName} is kept stopped: restore it again, or start it to keep its data as it is and send it to the other instances\\.$`));
    expect(failedBody, 'a held restore reads as success to the UI').to.not.match(/Finalizing/);
  });

  it('never starts the component nor makes its folder send, through election and folder passes', async function () {
    this.timeout(360000);
    await holdThroughPasses('the held component through election and folder passes');
  });

  it('records no running opinion while FDM names this node the primary', async function () {
    this.timeout(360000);
    const mark = client().getLastEventId();
    await electMaster(appName, client().ip);
    await holdThroughPasses('election passes with this node named primary');
    const running = client().getEventBuffer().filter((e) => e.id > mark && e.data?.identifier === identifier
      && ((e.event === 'reconciler:desiredChanged' && e.data.state === 'running') || e.event === 'masterSlave:started'));
    expect(running, 'a running opinion or start for the held component').to.deep.equal([]);
  });

  it('holds it across a FluxOS restart', async function () {
    this.timeout(600000);
    await crashFluxos(client().container, { hold: true });
    await releaseFluxos(client().container);
    expect(await restoreRecord(SUBJECT, identifier), 'the record after the restart').to.equal(true);
    await holdThroughPasses('the held component after a FluxOS restart');
  });

  it('answers the reason to its owner and the Flux team, and refuses anyone else', async function () {
    this.timeout(120000);
    const expected = [{ component: identifier, running: false, desired: false, reason: 'restoreUnfinished' }];
    const owner = await componentStates(client(), appName, await ownerAuth());
    expect(owner.status, `owner: ${JSON.stringify(owner)}`).to.equal('success');
    expect(owner.data, 'to the owner').to.deep.equal(expected);
    const team = await componentStates(client(), appName, (await authenticate(client().url, fluxTeamKey())).zelidauth);
    expect(team.status, `Flux team: ${JSON.stringify(team)}`).to.equal('success');
    expect(team.data, 'to the Flux team').to.deep.equal(expected);
    const stranger = await componentStates(client(), appName, (await authenticate(client().url, otherOwnerKeys()[0])).zelidauth);
    expect(stranger.status, `another owner: ${JSON.stringify(stranger)}`).to.equal('error');
    expect(stranger.data, 'to another owner').to.not.be.an('array');
  });

  it('refuses a backup of the held component before stopping anything, and keeps the last archive', async function () {
    this.timeout(180000);
    const before = await archiveDigest(client(), appName);
    expect(before, 'fixture: an archive is in place').to.be.a('string');
    const mark = client().getLastEventId();
    const body = await client().appendBackupTask(appName, [appName], await ownerAuth());
    expect(body, 'the backup\'s response').to.match(new RegExp(`Refused: a restore of ${appName} did not finish`));
    expect(await archiveDigest(client(), appName), 'the archive').to.equal(before);
    const held = client().getEventBuffer().filter((e) => e.id > mark && e.event === 'reconciler:operationHold' && e.data?.identifier === identifier);
    expect(held, 'the backup held the component').to.deep.equal([]);
    expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(true);
  });

  it('releases it when a restore of it finishes: the record goes, the archive is in place, it runs', async function () {
    this.timeout(600000);
    await unlockPart(client(), appName);
    const mark = client().getLastEventId();
    const body = await restoreLocal(client(), appName, [appName], await ownerAuth());
    expect(body, 'the restore').to.match(/Finalizing/);
    expect(recordWrites(client(), identifier, mark), 'record writes during the restore').to.deep.equal([true, false]);
    expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(false);
    expect(await readAppdata(client(), appName, appName, ['restored.txt', 'a.txt']), 'appdata')
      .to.deep.equal({ 'restored.txt': 'restored', 'a.txt': null });
    await waitForUp(client(), appName, 'the restored component runs', { timeout: 300000, interval: 3000 });
    await waitFor(async () => (await folderType()) === 'sendreceive', {
      timeout: 180000, interval: 2000, label: 'the restored folder sends',
    });
  });

  it('keeps it held through its owner stopping and killing it', async function () {
    this.timeout(600000);
    await failRestore();
    const auth = await ownerAuth();
    const mark = client().getLastEventId();
    await client().getAuthed(`/apps/appstop/${appName}`, auth);
    await waitForOperatorIntent(client(), identifier, true, 120000, { afterId: mark });
    await client().getAuthed(`/apps/appkill/${appName}`, auth);
    await holdThroughPasses('the held component after its owner stops and kills it');
    expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(true);
    expect(recordWrites(client(), identifier, mark), 'record writes since the stop').to.deep.equal([]);
  });

  it('releases it when its owner starts it: the record goes, it runs on the data as it is, its folder sends', async function () {
    this.timeout(600000);
    const mark = client().getLastEventId();
    await client().getAuthed(`/apps/appstart/${appName}`, await ownerAuth());
    await waitFor(() => recordWrites(client(), identifier, mark).includes(false), {
      timeout: 120000, interval: 1000, label: 'the start clears the record',
    });
    expect(await restoreRecord(SUBJECT, identifier), 'the record').to.equal(false);
    await waitForUp(client(), appName, 'the started component runs', { timeout: 300000, interval: 3000 });
    await waitFor(async () => (await folderType()) === 'sendreceive', {
      timeout: 180000, interval: 2000, label: 'the started folder sends',
    });
    expect(await readAppdata(client(), appName, appName, ['locked/kept.txt', 'a.txt']), 'the data it runs on')
      .to.deep.equal({ 'locked/kept.txt': ORIGINAL['locked/kept.txt'], 'a.txt': null });
  });

  it('holds each component of a mixed app on its own record, and releasing one leaves the other held', async function () {
    this.timeout(900000);
    const component = (name, containerData) => ({
      name,
      description: `${name} component`,
      repotag: `${REGISTRY_REPO_HOST}/${mixName}:v1`,
      ports: [],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData,
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    });
    await pushImage(mixName, 'v1');
    const mix = await buildSeedableApp({
      name: mixName, env, instances: 1, compose: [component('gs', 'g:/appdata'), component('ps', '/appdata')],
    });
    await electMaster(mixName, client().ip);
    await installOnNodes(env, mix, [SUBJECT]);
    const up = async (c) => (await getAppContainerStatus(client().container, `${c}_${mixName}`))?.status?.startsWith('Up') === true;
    await waitFor(async () => (await up('gs')) && (await up('ps')), {
      timeout: 300000, interval: 3000, label: 'both components of the mixed app run',
    });
    const auth = await ownerAuth();
    // eslint-disable-next-line no-restricted-syntax
    for (const c of ['gs', 'ps']) {
      // eslint-disable-next-line no-await-in-loop
      await writeAppdata(client(), mixName, c, ORIGINAL);
      // eslint-disable-next-line no-await-in-loop
      await stageLocalArchive(client(), mixName, c, RESTORED);
      // eslint-disable-next-line no-await-in-loop
      await lockPart(client(), mixName, c);
      // eslint-disable-next-line no-await-in-loop
      const body = await restoreLocal(client(), mixName, [c], auth);
      expect(body, `fixture: ${c}'s restore failed at the clear`).to.match(/could not clear/i);
    }
    const records = async () => ({ gs: await restoreRecord(SUBJECT, `gs_${mixName}`), ps: await restoreRecord(SUBJECT, `ps_${mixName}`) });
    expect(await records(), 'each component\'s record').to.deep.equal({ gs: true, ps: true });

    await unlockPart(client(), mixName, 'ps');
    const mark = client().getLastEventId();
    await client().getAuthed(`/apps/appstart/ps_${mixName}`, auth);
    await waitFor(() => recordWrites(client(), `ps_${mixName}`, mark).includes(false), {
      timeout: 120000, interval: 1000, label: 'the start of one component clears its record',
    });
    const gsFolder = `fluxgs_${mixName}`;
    const from = await client().getDecisionCount('syncthing:restoreUnfinished', gsFolder, 'held');
    await waitHolding(async () => {
      expect((await records()).gs, 'the other component\'s record').to.equal(true);
      expect(await up('gs'), 'the other, held, component runs').to.equal(false);
      expect((await getFolderConfig(client(), gsFolder))?.type, 'the other, held, component\'s folder').to.not.equal('sendreceive');
      return (await up('ps')) && (await client().getDecisionCount('syncthing:restoreUnfinished', gsFolder, 'held')) >= from + PASSES;
    }, { timeout: 300000, interval: 2000, label: 'the started component runs and the other stays held' });
    expect(recordWrites(client(), `gs_${mixName}`, mark), 'record writes for the other component').to.deep.equal([]);
  });
});
