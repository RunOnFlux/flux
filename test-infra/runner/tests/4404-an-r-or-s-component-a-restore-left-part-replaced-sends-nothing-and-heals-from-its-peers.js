/*
 * An r: or s: component whose restore stopped part way through sends nothing of what
 * the restore left and heals from the peers that hold the data: while held its folder
 * receives, its container does not run, it claims no holdings, and its peers keep
 * their copy; once synced from them with no local change left, it is released. A soft
 * redeploy does not start it, a FluxOS crash part way through its restore does not
 * make it send, and the restore another instance broadcasts leaves its record and its
 * owner's stop as they are.
 *
 * Three holders on real syncthing daemons and a fourth node that keeps the ring whole.
 * Every copy sends once its holder is ready; the data is written on one and reaches the
 * others through syncthing. It is damaged as a failed clear leaves it: two files deleted, one kept in
 * a directory the clear could not remove.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  isAppContainerRunning, crashFluxos, releaseFluxos, blockTraffic,
} from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { isDaemonUp, isFolderSynced, getFolderConfig } from '../framework/syncthing-real.js';
import {
  ORIGINAL, DELETED_BY_CLEAR, writeAppdata, readAppdata, lockPart, unlockPart, stageLocalArchive,
  restoreRecord, restoreLocal, recordWrites, componentStates,
} from '../framework/restore-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const API_PORT = 16127;
const SYNCTHING_PORT = API_PORT + 2;
const RESTORED = Object.freeze({ 'restored.txt': 'restored' });
const NO_CLAIM = Object.freeze({ unreadable: true });

describe('an r: or s: component a restore left part replaced sends nothing and heals from its peers', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const HOLDERS = [1, 2, 3];
  const client = (i) => env.clients[i];
  const ownerAuth = async (i) => (await authenticate(client(i).url, appOwnerKey())).zelidauth;
  const teamAuth = async (i) => (await authenticate(client(i).url, fluxTeamKey())).zelidauth;

  const appOf = (appName, mode) => ({
    appName, mode, identifier: `${appName}_${appName}`, folder: `flux${appName}_${appName}`,
  });
  const R = appOf(`e2erheal${ts}`, 'r');
  const S = appOf(`e2esheal${ts}`, 's');

  const sending = async (i, app) => {
    const config = await getFolderConfig(client(i), app.folder);
    return config?.type === 'sendreceive' && config?.paused !== true;
  };
  const isUp = (i, app) => isAppContainerRunning(client(i).container, app.appName);
  const holds = async (i, app) => JSON.stringify(await readAppdata(client(i), app.appName, app.appName, Object.keys(ORIGINAL))) === JSON.stringify(ORIGINAL);
  const heldPasses = (i, app) => client(i).getDecisionCount('syncthing:restoreUnfinished', app.folder, 'held');
  const healed = (i, app) => client(i).getDecisionCount('syncthing:restoreUnfinished', app.folder, 'healed');
  // Asserted on every poll while node i's record holds the component: its folder
  // does not send, its container does not run, and every other holder keeps the data.
  const heldInvariant = async (i, app, peers = HOLDERS.filter((h) => h !== i)) => {
    if (!(await restoreRecord(i, app.identifier))) return;
    expect(await sending(i, app), `node ${i}'s held folder sends`).to.equal(false);
    expect(await isUp(i, app), `node ${i} runs its held component`).to.equal(false);
    // eslint-disable-next-line no-restricted-syntax
    for (const peer of peers) {
      // eslint-disable-next-line no-await-in-loop
      expect(await holds(peer, app), `node ${peer} lost the data the held copy deleted`).to.equal(true);
    }
  };

  async function damageAndFail(i, app) {
    await stageLocalArchive(client(i), app.appName, app.appName, RESTORED);
    await lockPart(client(i), app.appName);
    const mark = client(i).getLastEventId();
    const body = await restoreLocal(client(i), app.appName, [app.appName], await ownerAuth(i));
    expect(body, 'fixture: the restore failed at the clear').to.match(/could not clear/i);
    const left = await readAppdata(client(i), app.appName, app.appName, Object.keys(ORIGINAL));
    DELETED_BY_CLEAR.forEach((path) => expect(left[path], `fixture: the clear deleted ${path}`).to.equal(null));
    expect(recordWrites(client(i), app.identifier, mark), 'the restore recorded the component held').to.deep.equal([true]);
    return mark;
  }

  // Holds the invariant until node i's record is cleared by healing, and checks the
  // healed copy.
  async function healsFromPeers(i, app, mark, label, { peers } = {}) {
    const from = await healed(i, app);
    await waitHolding(async () => {
      await heldInvariant(i, app, peers);
      return recordWrites(client(i), app.identifier, mark).includes(false);
    }, { timeout: 600000, interval: 2000, label });
    expect(await healed(i, app), 'the record was cleared by healing').to.be.above(from);
    expect(await holds(i, app), 'the healed copy').to.equal(true);
  }

  async function place(app) {
    await pushImage(app.appName, 'v1');
    const spec = await buildSeedableSyncthingApp({ name: app.appName, mode: app.mode, env, instances: HOLDERS.length });
    await installOnNodes(env, spec, HOLDERS);
    await Promise.all(HOLDERS.map((i) => waitFor(() => isUp(i, app), {
      timeout: 300000, interval: 3000, label: `node ${i} runs ${app.appName}`,
    })));
    // every copy sends once its holder is ready, and the data reaches the rest from one
    await Promise.all(HOLDERS.map((i) => waitFor(() => sending(i, app), {
      timeout: 300000, interval: 3000, label: `node ${i}'s ${app.appName} folder sends`,
    })));
    await writeAppdata(client(HOLDERS[0]), app.appName, app.appName, ORIGINAL);
    await Promise.all(HOLDERS.map((i) => waitFor(async () => (await isFolderSynced(client(i), app.folder)) && holds(i, app), {
      timeout: 300000, interval: 3000, label: `node ${i} holds the ${app.appName} data`,
    })));
  }

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await place(R);
    await place(S);
  });

  afterTeardown(async function () {
    if (env) {
      await Promise.all(HOLDERS.flatMap((i) => [R, S].map((app) => unlockPart(client(i), app.appName).catch(() => {}))));
    }
    await env?.teardown();
  });

  it('turns a held r: copy that was sending receive-only, claims nothing of it, and heals it from its peers', async function () {
    this.timeout(900000);
    const writer = HOLDERS[0];
    const mark = await damageAndFail(writer, R);
    const auth = await teamAuth(writer);
    await waitHolding(async () => {
      await heldInvariant(writer, R);
      if (!(await restoreRecord(writer, R.identifier)) || (await heldPasses(writer, R)) < 1) return false;
      const { data } = await client(writer).getAuthed('/apps/promotedfolders', auth);
      expect(data?.holding?.[R.folder], 'what the held folder claims to its peers').to.deep.equal(NO_CLAIM);
      return true;
    }, { timeout: 300000, interval: 2000, label: 'a folder pass over the held copy' });
    await unlockPart(client(writer), R.appName);
    await healsFromPeers(writer, R, mark, 'the held r: copy heals from its peers');
    await waitFor(() => isUp(writer, R), { timeout: 300000, interval: 3000, label: 'the healed component runs' });
  });

  it('does not start a held r: component through a soft redeploy', async function () {
    this.timeout(900000);
    const subject = HOLDERS[1];
    const mark = await damageAndFail(subject, R);
    await client(subject).redeployApp(R.appName, await ownerAuth(subject), { force: false });
    await client(subject).waitForEvent('app:softRedeployed', (d) => d.name === R.appName, 300000, { afterId: mark });
    await unlockPart(client(subject), R.appName);
    await healsFromPeers(subject, R, mark, 'the soft-redeployed held copy heals from its peers');
  });

  it('does not make a held r: copy send when FluxOS stops part way through its restore', async function () {
    this.timeout(900000);
    const writer = HOLDERS[2];
    await waitFor(() => sending(writer, R), { timeout: 300000, interval: 3000, label: 'the folder sends before its restore' });
    const p = client(writer);
    await stageLocalArchive(p, R.appName, R.appName, RESTORED);
    await p.holdCheckpoint('restore:beforeClear', R.folder);
    const mark = p.getLastEventId();
    const restore = restoreLocal(p, R.appName, [R.appName], await ownerAuth(writer)).catch(() => null);
    await p.waitForEvent('checkpoint:held', (d) => d.name === 'restore:beforeClear' && d.key === R.folder, 180000, { afterId: mark });
    const folder = await getFolderConfig(p, R.folder);
    expect({ type: folder?.type, paused: folder?.paused }, 'fixture: the folder as the restore left it').to.deep.equal({ type: 'sendreceive', paused: true });
    await crashFluxos(p.container, { hold: true });
    await restore;
    expect(await restoreRecord(writer, R.identifier), 'fixture: the record outlives the crash').to.equal(true);
    await releaseFluxos(p.container);
    await waitHolding(async () => {
      await heldInvariant(writer, R);
      return !(await restoreRecord(writer, R.identifier));
    }, { timeout: 600000, interval: 2000, label: 'the record of a restore that deleted nothing is cleared' });
    expect(await holds(writer, R), 'the data').to.equal(true);
  });

  it('heals a held s: copy from its peers, and its peers keep their data meanwhile', async function () {
    this.timeout(900000);
    const subject = HOLDERS[1];
    const mark = await damageAndFail(subject, S);
    await unlockPart(client(subject), S.appName);
    await healsFromPeers(subject, S, mark, 'the held s: copy heals from its peers');
  });

  it('leaves another instance\'s record and its owner\'s stop as they are when a restore broadcasts its restart', async function () {
    this.timeout(900000);
    const [restorer, , held] = HOLDERS;
    const others = HOLDERS.filter((i) => i !== held);
    // its syncthing reaches no peer, so nothing heals it meanwhile
    await blockTraffic(client(held).container, others.map((i) => client(i).ip), SYNCTHING_PORT);
    await damageAndFail(held, S);
    const heldAuth = await ownerAuth(held);
    const stopped = client(held).getLastEventId();
    await client(held).getAuthed(`/apps/appstop/${S.appName}`, heldAuth);
    await client(held).waitForEvent('app:operatorIntent', (d) => d.identifier === S.identifier && d.stopped === true, 120000, { afterId: stopped });

    await unlockPart(client(restorer), S.appName);
    await stageLocalArchive(client(restorer), S.appName, S.appName, RESTORED);
    const mark = client(held).getLastEventId();
    const body = await restoreLocal(client(restorer), S.appName, [S.appName], await ownerAuth(restorer));
    expect(body, 'the other instance\'s restore').to.match(/Finalizing/);
    // the restart reached the held instance
    await client(held).waitForEvent('app:operatorIntent', (d) => d.identifier === S.identifier && d.restartRequested === true, 180000, { afterId: mark });

    expect(await restoreRecord(held, S.identifier), 'the held instance\'s record').to.equal(true);
    expect(recordWrites(client(held), S.identifier, mark), 'record writes on the held instance').to.deep.equal([]);
    const states = await componentStates(client(held), S.appName, heldAuth);
    expect(states.data?.[0]?.reason, 'why the held instance is stopped').to.equal('operatorStopped');
  });
});
