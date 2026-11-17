/*
 * A g: component whose restore stopped part way through heals only from standbys
 * that hold the data: while held its folder never sends and its container never
 * runs, its deletions are reverted to the standbys' copy, and only then is it
 * released. Standbys that hold nothing heal nothing.
 *
 * Three holders placed in order on real syncthing daemons (the first is the primary,
 * the two after it hold the primary's data receive-only); a fourth node holds nothing
 * and keeps the ring whole. The data is damaged as a failed clear leaves it: two
 * files deleted, one kept in a directory the clear could not remove, so the only
 * local changes are deletions. The app whose standbys hold nothing is placed while
 * the primary's syncthing cannot reach theirs, so each holds an empty copy.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, isAppContainerRunning, crashFluxos, releaseFluxos, blockTraffic, unblockTraffic,
} from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getFolderStatus, getDeviceId, getConnectedDevices,
} from '../framework/syncthing-real.js';
import {
  ORIGINAL, DELETED_BY_CLEAR, appdataOf, writeAppdata, readAppdata, lockPart, unlockPart,
  stageLocalArchive, restoreRecord, restoreLocal, recordWrites,
} from '../framework/restore-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const API_PORT = 16127;
const SYNCTHING_PORT = API_PORT + 2;
const RESTORED = Object.freeze({ 'restored.txt': 'restored' });
// folder passes a held component is watched through
const PASSES = 3;

describe('a g: component a restore left part replaced heals only from standbys that hold the data', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const PRIMARY = 1;
  const STANDBYS = [2, 3];
  const HOLDERS = [PRIMARY, ...STANDBYS];
  const client = (i) => env.clients[i];
  const ownerAuth = async (i) => (await authenticate(client(i).url, appOwnerKey())).zelidauth;

  const appOf = (appName) => ({ appName, identifier: `${appName}_${appName}`, folder: `flux${appName}_${appName}` });
  const A = appOf(`e2eheal${ts}`);
  const EMPTY = appOf(`e2eempty${ts}`);

  const folderOf = async (i, app) => getFolderConfig(client(i), app.folder);
  const sending = async (i, app) => {
    const config = await folderOf(i, app);
    return config?.type === 'sendreceive' && config?.paused !== true;
  };
  const runners = async (app) => {
    const running = await Promise.all(HOLDERS.map((i) => isAppContainerRunning(client(i).container, app.appName)));
    return HOLDERS.filter((_, k) => running[k]);
  };
  // the one holder that runs the app, once exactly one does
  const currentRunner = async (app) => {
    let runner = null;
    await waitFor(async () => {
      const running = await runners(app);
      [runner] = running;
      return running.length === 1;
    }, { timeout: 600000, interval: 2000, label: `exactly one holder runs ${app.appName}` });
    return runner;
  };
  // node i's syncthing holds no connection to the given holders' (all others by default)
  const disconnectedFromPeers = async (i, from = HOLDERS.filter((h) => h !== i)) => {
    const ids = await Promise.all(from.map((h) => getDeviceId(client(h))));
    // a dropped connection ends on syncthing's own receive timeout, five minutes
    await waitFor(async () => {
      const connected = await getConnectedDevices(client(i));
      return ids.every((id) => !connected.includes(id));
    }, { timeout: 420000, interval: 2000, label: `node ${i}'s syncthing has lost its peers` });
  };
  const heldPasses = (i, app) => client(i).getDecisionCount('syncthing:restoreUnfinished', app.folder, 'held');
  // Asserted on every poll: at most one holder runs the app, and node i neither runs
  // nor sends it while its record holds it. The folder and container are read before
  // the record, which is cleared before either may start: a breach read this way
  // happened while the record stood.
  const heldInvariant = async (i, app) => {
    const running = await runners(app);
    const sends = await sending(i, app);
    expect(running.length, `more than one holder runs ${app.appName}: ${running.join(', ')}`).to.be.at.most(1);
    if (await restoreRecord(i, app.identifier)) {
      expect(sends, `node ${i}'s held folder sends`).to.equal(false);
      expect(running, `node ${i} runs its held component`).to.not.include(i);
    }
  };

  async function damageAndFail(i, app, auth = null) {
    await stageLocalArchive(client(i), app.appName, app.appName, RESTORED);
    await lockPart(client(i), app.appName);
    const mark = client(i).getLastEventId();
    const body = await restoreLocal(client(i), app.appName, [app.appName], auth ?? await ownerAuth(i));
    expect(body, 'fixture: the restore failed at the clear').to.match(/could not clear/i);
    const left = await readAppdata(client(i), app.appName, app.appName, Object.keys(ORIGINAL));
    DELETED_BY_CLEAR.forEach((path) => expect(left[path], `fixture: the clear deleted ${path}`).to.equal(null));
    expect(recordWrites(client(i), app.identifier, mark), 'the restore recorded the component held').to.deep.equal([true]);
    return mark;
  }

  // Places an app on the holders in order, and has the primary's data on every standby.
  async function place(app) {
    await pushImage(app.appName, 'v1');
    const spec = await buildSeedableSyncthingApp({ name: app.appName, mode: 'g', env, instances: HOLDERS.length });
    await installOnNodes(env, spec, [PRIMARY]);
    await waitForUp(client(PRIMARY), app.appName, `the primary runs ${app.appName}`, { timeout: 300000, interval: 3000 });
    await waitFor(() => sending(PRIMARY, app), { timeout: 180000, interval: 2000, label: `the primary's ${app.appName} folder sends` });
    await writeAppdata(client(PRIMARY), app.appName, app.appName, ORIGINAL);
    return spec;
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

    const spec = await place(A);
    // placed one at a time, so the election ranks them in this order
    // eslint-disable-next-line no-restricted-syntax
    for (const i of STANDBYS) {
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, spec, [i]);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await isFolderSynced(client(i), A.folder))
        && JSON.stringify(await readAppdata(client(i), A.appName, A.appName, Object.keys(ORIGINAL))) === JSON.stringify(ORIGINAL), {
        timeout: 300000, interval: 3000, label: `standby ${i} holds the primary's data`,
      });
    }
    expect(await runners(A), 'fixture: only the primary runs the component').to.deep.equal([PRIMARY]);
  });

  afterTeardown(async function () {
    if (env) {
      await Promise.all(HOLDERS.flatMap((i) => [A, EMPTY].map(async (app) => {
        await unlockPart(client(i), app.appName).catch(() => {});
        await execInContainer(client(i).container, `chattr -R -i ${appdataOf(app.appName)} 2>/dev/null; true`).catch(() => {});
      })));
    }
    await env?.teardown();
  });

  it('reverts a standby\'s local deletions to the copy its peers hold', async function () {
    this.timeout(420000);
    const standby = STANDBYS[1];
    const removed = await execInContainer(client(standby).container, `rm ${appdataOf(A.appName)}/a.txt`);
    expect(removed.exitCode, `fixture: deleting on the standby: ${removed.output}`).to.equal(0);
    // what syncthing reports for a receive-only folder whose only local change is a deletion
    let measured = null;
    await waitFor(async () => {
      const status = await getFolderStatus(client(standby), A.folder);
      measured = {
        state: status?.state,
        needFiles: status?.needFiles,
        inSyncBytes: status?.inSyncBytes,
        globalBytes: status?.globalBytes,
        receiveOnlyChangedFiles: status?.receiveOnlyChangedFiles,
        receiveOnlyChangedDeletes: status?.receiveOnlyChangedDeletes,
      };
      return (status?.receiveOnlyChangedDeletes ?? 0) > 0
        || (await readAppdata(client(standby), A.appName, A.appName, ['a.txt']))['a.txt'] !== null;
    }, { timeout: 120000, interval: 1000, label: 'syncthing has scanned the standby\'s deletion' });
    // eslint-disable-next-line no-console
    console.log(`# a receive-only folder with a local deletion, as db/status reports it: ${JSON.stringify(measured)}`);
    await waitHolding(async () => {
      const running = await runners(A);
      expect(running, 'a standby missing a file runs the component').to.deep.equal([PRIMARY]);
      return (await readAppdata(client(standby), A.appName, A.appName, ['a.txt']))['a.txt'] === ORIGINAL['a.txt'];
    }, { timeout: 300000, interval: 2000, label: `the standby's deleted file is back (${JSON.stringify(measured)})` });
  });

  it('never sends or runs the damaged copy, and heals it from the standbys', async function () {
    this.timeout(900000);
    const p = client(PRIMARY);
    try {
      const mark = await damageAndFail(PRIMARY, A);
      await waitHolding(async () => {
        await heldInvariant(PRIMARY, A);
        return recordWrites(p, A.identifier, mark).includes(false);
      }, { timeout: 600000, interval: 2000, label: 'the damaged copy heals from the standbys' });
    } finally {
      await unlockPart(p, A.appName);
    }
    expect(await heldPasses(PRIMARY, A), 'folder passes it was held for').to.be.at.least(1);
    expect(await readAppdata(p, A.appName, A.appName, Object.keys(ORIGINAL)), 'the healed copy').to.deep.equal(ORIGINAL);
    expect(await restoreRecord(PRIMARY, A.identifier), 'the record').to.equal(false);
    await currentRunner(A);
  });

  it('clears the record on the first passes of a restore that failed before deleting anything', async function () {
    this.timeout(420000);
    const p = client(PRIMARY);
    await stageLocalArchive(p, A.appName, A.appName, RESTORED);
    // every entry immutable, so the clear removes nothing
    const lock = await execInContainer(p.container, `chattr -R +i ${appdataOf(A.appName)}`);
    expect(lock.exitCode, `fixture: locking appdata: ${lock.output}`).to.equal(0);
    let mark;
    try {
      mark = p.getLastEventId();
      const body = await restoreLocal(p, A.appName, [A.appName], await ownerAuth(PRIMARY));
      expect(body, 'fixture: the restore failed at the clear').to.match(/could not clear/i);
    } finally {
      await execInContainer(p.container, `chattr -R -i ${appdataOf(A.appName)}`);
    }
    expect(await readAppdata(p, A.appName, A.appName, Object.keys(ORIGINAL)), 'fixture: nothing was deleted').to.deep.equal(ORIGINAL);
    await waitHolding(async () => {
      await heldInvariant(PRIMARY, A);
      return recordWrites(p, A.identifier, mark).includes(false);
    }, { timeout: 300000, interval: 2000, label: 'the record of a restore that deleted nothing is cleared' });
    expect(await heldPasses(PRIMARY, A), 'folder passes it was held for before clearing').to.be.at.most(2);
    await currentRunner(A);
  });

  it('keeps a new restore\'s record while that restore runs', async function () {
    this.timeout(600000);
    const p = client(PRIMARY);
    const auth = await ownerAuth(PRIMARY);
    await stageLocalArchive(p, A.appName, A.appName, RESTORED);
    await p.holdCheckpoint('restore:beforeClear', A.folder);
    const mark = p.getLastEventId();
    let restore;
    try {
      restore = restoreLocal(p, A.appName, [A.appName], auth);
      await p.waitForEvent('checkpoint:held', (d) => d.name === 'restore:beforeClear' && d.key === A.folder, 180000, { afterId: mark });
      expect(recordWrites(p, A.identifier, mark), 'fixture: the new restore recorded the component').to.deep.equal([true]);
      // the monitor passes over the node while the restore holds the folder
      const passes = () => p.getEventBuffer().filter((e) => e.id > mark && e.event === 'syncthing:passComplete').length;
      await waitHolding(async () => {
        expect(recordWrites(p, A.identifier, mark), 'record writes while the restore runs').to.deep.equal([true]);
        return passes() >= PASSES;
      }, { timeout: 300000, interval: 2000, label: 'monitor passes while a restore holds the record' });
    } finally {
      await p.releaseCheckpoint('restore:beforeClear', A.folder);
    }
    expect(await restore, 'the new restore').to.match(/Finalizing/);
    expect(recordWrites(p, A.identifier, mark), 'record writes over the restore').to.deep.equal([true, false]);
  });

  it('does not resume a held component as primary when FluxOS stops part way through its restore', async function () {
    this.timeout(1500000);
    const primary = await currentRunner(A);
    const p = client(primary);
    await waitFor(() => sending(primary, A), { timeout: 300000, interval: 2000, label: 'the primary\'s folder sends' });
    await writeAppdata(p, A.appName, A.appName, ORIGINAL);
    await stageLocalArchive(p, A.appName, A.appName, RESTORED);
    // a node whose syncthing no peer reaches refuses logins, so the session comes first
    const auth = await ownerAuth(primary);
    // It returns with no peer to heal from, so the record stands when its role is
    // decided. Cut off while it still runs the app, so no standby takes over meanwhile.
    const others = HOLDERS.filter((i) => i !== primary).map((i) => client(i).ip);
    await blockTraffic(p.container, others, SYNCTHING_PORT);
    await disconnectedFromPeers(primary);
    await p.holdCheckpoint('restore:beforeClear', A.folder);
    const mark = p.getLastEventId();
    const restore = restoreLocal(p, A.appName, [A.appName], auth).catch(() => null);
    await p.waitForEvent('checkpoint:held', (d) => d.name === 'restore:beforeClear' && d.key === A.folder, 180000, { afterId: mark });
    const folder = await folderOf(primary, A);
    expect({ type: folder?.type, paused: folder?.paused }, 'fixture: the primary\'s folder as the restore left it').to.deep.equal({ type: 'sendreceive', paused: true });
    // FluxOS stops part way through the clear: some of the data is already gone
    const cleared = await execInContainer(p.container, DELETED_BY_CLEAR.map((path) => `rm ${appdataOf(A.appName)}/${path}`).join(' && '));
    expect(cleared.exitCode, `fixture: the part of the clear that ran: ${cleared.output}`).to.equal(0);
    await crashFluxos(p.container, { hold: true });
    await restore;
    expect(await restoreRecord(primary, A.identifier), 'fixture: the record outlives the crash').to.equal(true);
    try {
      await releaseFluxos(p.container);
      await waitHolding(async () => {
        await heldInvariant(primary, A);
        return (await p.getDecisionCount('primaryRole:returned', A.identifier, 'restoreUnfinished')) > 0;
      }, { timeout: 300000, interval: 2000, label: 'the returning primary reads its record' });
    } finally {
      await unblockTraffic(p.container, others, SYNCTHING_PORT);
    }
    await waitHolding(async () => {
      await heldInvariant(primary, A);
      return !(await restoreRecord(primary, A.identifier));
    }, { timeout: 600000, interval: 2000, label: 'the record of a restore that deleted nothing is cleared' });
    expect(await readAppdata(p, A.appName, A.appName, Object.keys(ORIGINAL)), 'the healed data').to.deep.equal(ORIGINAL);
  });

  it('keeps a copy held whose standbys hold nothing', async function () {
    this.timeout(1500000);
    // a node whose syncthing no peer reaches refuses logins, so the session comes first
    const auth = await ownerAuth(PRIMARY);
    // the standbys' syncthing never reaches the primary's
    await Promise.all(STANDBYS.map((i) => blockTraffic(client(i).container, [client(PRIMARY).ip], SYNCTHING_PORT)));
    await disconnectedFromPeers(PRIMARY, STANDBYS);
    const spec = await place(EMPTY);
    await installOnNodes(env, spec, STANDBYS);
    await Promise.all(STANDBYS.map((i) => waitFor(async () => (await folderOf(i, EMPTY)) !== null, {
      timeout: 300000, interval: 3000, label: `standby ${i} holds a ${EMPTY.appName} folder`,
    })));
    // eslint-disable-next-line no-restricted-syntax
    for (const i of STANDBYS) {
      // eslint-disable-next-line no-await-in-loop
      const held = await readAppdata(client(i), EMPTY.appName, EMPTY.appName, Object.keys(ORIGINAL));
      expect(Object.values(held).every((v) => v === null), `fixture: standby ${i} holds none of the data`).to.equal(true);
    }
    await damageAndFail(PRIMARY, EMPTY, auth);
    const from = await heldPasses(PRIMARY, EMPTY);
    await waitHolding(async () => {
      expect(await restoreRecord(PRIMARY, EMPTY.identifier), 'the record').to.equal(true);
      expect(await sending(PRIMARY, EMPTY), 'the held folder sends').to.equal(false);
      expect(await isAppContainerRunning(client(PRIMARY).container, EMPTY.appName), 'the held component runs').to.equal(false);
      return (await heldPasses(PRIMARY, EMPTY)) >= from + PASSES;
    }, { timeout: 300000, interval: 2000, label: 'folder passes over a copy whose standbys hold nothing' });
  });
});
