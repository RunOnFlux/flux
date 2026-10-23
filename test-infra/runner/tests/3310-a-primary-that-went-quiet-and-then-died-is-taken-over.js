// weight: heavy
/*
 * A single-writer app's primary stops announcing while it carries on running: its
 * FluxOS is gone, its syncthing and its container are not.
 *
 * While its location is listed it stays in the standby's folder, across a restart
 * of the standby's FluxOS that leaves the standby unable to ask it for its device.
 * Once its location expires the standby drops it from the folder, though its
 * syncthing is still connected, and what it writes from then on reaches no holder.
 * FDM still names it, so the standby stays a standby.
 *
 * Then the machine dies. Changes on the standby's disk to a file and a directory the
 * primary wrote are held by no other device: syncthing reverts such a change by
 * deleting it, which a directory that is not empty refuses for ever. The rest of the
 * folder is unchanged, so the standby's copy still reads as synced and the revert is
 * due. The standby keeps the changes, takes the app over with the primary's data
 * intact, and a new standby syncs that copy.
 *
 * A = the standby, B = the primary, C = the new standby.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import {
  placeSilentPrimaryApp, A, B, C,
} from '../framework/silent-primary.js';
import {
  crashFluxos, execInContainer, releaseFluxos, stopAppContainer,
} from '../framework/container.js';
import {
  getDeviceId, getConnectedDevices, getFolderConfig, getFileInfo, isDaemonUp, readPath, scanFolder, stopDaemon,
} from '../framework/syncthing-real.js';
import { dbClient } from '../framework/db-client.js';
import { installOnNodes } from '../framework/reconciler-suite.js';
import { clearMaster } from '../framework/fdm-control.js';
import { waitFor } from '../framework/wait.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
// The harness's syncthing monitor passes every 3s; this is several of them.
const MONITOR_PASSES_MS = 30000;
// A few election passes and a container start.
const TAKEOVER_MS = 10 * 60 * 1000;
// syncthing's FlagLocalReceiveOnly
const RECEIVE_ONLY_CHANGE_FLAG = 8;
const SAVE = 'appdata/save-b';
const SAVE_CONTENT = 'written by the primary';
const LISTED = 'appdata/written-while-listed';
const FENCED = 'appdata/written-after-expiry';
// Lookups of the primary's device on the standby, each one pass.
const LOOKUP_PASSES = 3;
// Where a node's syncthing monitor took each device it looked up, counted per source.
const DEVICE_SOURCES = ['verified', 'verifiedNoDevice', 'introduced', 'withheld', 'held', 'unsigned', 'configured'];

function step(what) {
  console.log(`# 3310 ${new Date().toISOString()} ${what}`);
}

describe('a primary that went quiet and then died is taken over', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2equietdied${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  let primaryDevice;
  let afterDeath;
  // How long the primary's write took to reach the standby while it was listed.
  let listedSyncMs;
  const lookups = async () => {
    const counts = await Promise.all(DEVICE_SOURCES.map((source) => client(A)
      .getDecisionCount('syncthing:deviceSource', `${client(B).ip}:16127`, source)));
    return counts.reduce((sum, n) => sum + n, 0);
  };
  async function writeOnPrimary(path, content) {
    const wrote = await execInContainer(client(B).container, `printf '${content}' > ${root}/${path}`);
    if (wrote.exitCode !== 0) throw new Error(`could not write on the primary: ${wrote.output}`);
    await scanFolder(client(B), folder);
  }

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    primaryDevice = await getDeviceId(client(B));
    const wrote = await execInContainer(client(B).container, `printf '${SAVE_CONTENT}' > ${root}/${SAVE}`);
    if (wrote.exitCode !== 0) throw new Error(`could not write on the primary: ${wrote.output}`);
    await scanFolder(client(B), folder);
    await waitFor(async () => (await readPath(client(A), `${root}/${SAVE}`)) === SAVE_CONTENT, {
      timeout: 240000, interval: 3000, label: 'the primary\'s second file reached the standby',
    });
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('keeps a listed primary whose FluxOS does not answer in the folder, across a restart of the standby\'s FluxOS', async function () {
    this.timeout(600000);
    step('the primary stops announcing; its syncthing and app carry on');
    await crashFluxos(client(B).container, { hold: true });
    expect(await isDaemonUp(client(B)), 'the primary\'s syncthing went down with its FluxOS, so nothing here is tested').to.equal(true);

    step('the standby\'s FluxOS restarts, holding nothing for the primary\'s device');
    await crashFluxos(client(A).container, { hold: true });
    await releaseFluxos(client(A).container);
    await waitFor(async () => (await lookups()) >= LOOKUP_PASSES, {
      timeout: 240000, interval: 3000, label: `${LOOKUP_PASSES} lookups of the primary's device on the restarted standby`,
    });
    const devices = (await getFolderConfig(client(A), folder))?.devices?.map((d) => d.deviceID) ?? [];
    expect(devices, 'the standby dropped a listed primary from the folder once it could not ask it for its device').to.include(primaryDevice);
    expect(await client(A).getDecisionCount('syncthing:deviceSource', `${client(B).ip}:16127`, 'configured'),
      'the standby never took the primary\'s device from its own configuration').to.be.at.least(1);

    const startedAt = Date.now();
    await writeOnPrimary(LISTED, 'written while listed');
    await waitFor(async () => (await readPath(client(A), `${root}/${LISTED}`)) === 'written while listed', {
      timeout: 120000, interval: 1000, label: 'the listed primary\'s write reached the standby',
    });
    listedSyncMs = Date.now() - startedAt;
    expect(fleet.twoRan, 'the standby started beside a primary that still runs').to.deep.equal([]);
  });

  it('drops the primary from the folder once its location expires, and what it writes then reaches no holder', async function () {
    this.timeout(300000);
    const expired = await Promise.all([A, C].map((i) => dbClient(i + 1).expireAppLocation(appName, client(B).ip)));
    expect(expired[0], 'the standby held no location for the primary, so none expired').to.be.at.least(1);
    await waitFor(async () => !((await getFolderConfig(client(A), folder))?.devices ?? [])
      .some((d) => d.deviceID === primaryDevice), {
      timeout: 120000, interval: 3000, label: 'the standby drops the primary no location lists from the folder',
    });

    step('the primary writes after its location expired');
    await writeOnPrimary(FENCED, 'written after expiry');
    // Connected and fenced: the write would arrive over this connection if the
    // folder were still shared with it.
    expect(await getConnectedDevices(client(A)), 'the primary\'s syncthing is not connected to the standby').to.include(primaryDevice);
    await sleepUnlessInfraDead(Math.max(MONITOR_PASSES_MS, 5 * listedSyncMs));
    expect(await readPath(client(A), `${root}/${FENCED}`), 'the write of a primary no location lists reached the standby').to.equal(null);
    expect(fleet.twoRan, 'the standby started beside a primary that still runs').to.deep.equal([]);
  });

  it('takes over once that primary dies, keeping the primary\'s data only it holds', async function () {
    this.timeout(TAKEOVER_MS + 300000);
    step('the primary\'s machine dies');
    await stopAppContainer(client(B).container, appName, appName);
    await stopDaemon(client(B));

    step('the standby\'s copy of the primary\'s data changes on its disk');
    afterDeath = client(A).getLastEventId();
    const changed = await execInContainer(client(A).container, `chmod 600 ${root}/${SAVE} && chmod 700 ${root}/appdata`);
    expect(changed.exitCode, `could not change the standby's copy: ${changed.output}`).to.equal(0);
    await scanFolder(client(A), folder);
    // eslint-disable-next-line no-bitwise
    const heldOnlyHere = (record) => ((record?.global?.localFlags ?? 0) & RECEIVE_ONLY_CHANGE_FLAG) !== 0;
    let record;
    await waitFor(async () => {
      record = await getFileInfo(client(A), folder, SAVE);
      return heldOnlyHere(record) && heldOnlyHere(await getFileInfo(client(A), folder, 'appdata'));
    }, { timeout: 60000, interval: 2000, label: 'the file and the directory are changes no other device holds' });
    expect(record.local.version.some((counter) => counter.startsWith(`${primaryDevice.substring(0, 7)}:`)),
      'the changed file carries no history from the primary, so it is not the primary\'s data').to.equal(true);
    expect(heldOnlyHere(await getFileInfo(client(A), folder, 'appdata/seed-data')),
      'the unchanged file is held only here too, so the standby\'s copy no longer reads as synced').to.equal(false);

    // FDM still names the dead primary, so the standby stays a standby while its
    // passes judge the change; then FDM drops it, as it drops a primary whose app
    // stops answering.
    await sleepUnlessInfraDead(MONITOR_PASSES_MS);
    await clearMaster(appName);
    step('waiting for the takeover');
    await waitFor(() => fleet.isUp(A), {
      timeout: TAKEOVER_MS, interval: 5000, label: 'the standby takes the app over',
    });
    expect(await readPath(client(A), `${root}/${SAVE}`), 'the primary\'s file is gone from the standby').to.equal(SAVE_CONTENT);
    expect(await readPath(client(A), `${root}/${FENCED}`), 'the dead primary\'s write from after its location expired reached the standby').to.equal(null);
    expect((await readPath(client(A), `${root}/appdata/seed-data`))?.trim(), 'the primary\'s data is gone from the standby').to.equal('seeded');
    const kept = client(A).getEventBuffer().some((e) => e.id > afterDeath && e.event === 'syncthing:localChangesKept'
      && e.data?.folder === folder);
    expect(kept, 'the standby did not keep the change no other device holds').to.equal(true);
    expect(fleet.twoRan, 'two nodes ran the app at once').to.deep.equal([]);
  });

  it('gives a new standby the survivor\'s copy', async function () {
    this.timeout(600000);
    const afterInstall = client(C).getLastEventId();
    await installOnNodes(fleet.env, fleet.app, [C]);
    await waitFor(async () => (await readPath(client(C), `${root}/${SAVE}`)) === SAVE_CONTENT, {
      timeout: 300000, interval: 5000, label: 'the new standby holds the primary\'s data',
    });
    await client(C).waitForEvent('syncthing:folderReady', (d) => d.folder === folder, 240000, { afterId: afterInstall });
    expect(await readPath(client(C), `${root}/${FENCED}`), 'the dead primary\'s write from after its location expired reached the new standby').to.equal(null);
  });
});
