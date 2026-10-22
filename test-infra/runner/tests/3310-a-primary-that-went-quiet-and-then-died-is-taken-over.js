// weight: heavy
/*
 * A single-writer app's primary stops announcing while it carries on running: its
 * FluxOS is gone, its syncthing and its container are not. Its location expires,
 * and the standby keeps it in the folder for as long as its syncthing is connected
 * and shares the folder; nothing starts beside it.
 *
 * Then the machine dies. The standby drops it from the folder, and changes on the
 * standby's disk to a file and a directory the primary wrote are now held by no other
 * device: syncthing reverts such a change by deleting it, which a directory that is
 * not empty refuses for ever. The rest of the folder is unchanged, so the standby's
 * copy still reads as synced and the revert is due. The standby keeps the changes,
 * takes the app over with the primary's data intact, and a new standby syncs that
 * copy.
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
import { crashFluxos, execInContainer, stopAppContainer } from '../framework/container.js';
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
// A machine that dies closes none of its connections, so the standby's syncthing
// holds them until its own receive timeout (5 min, not compressed by the harness).
// Then a few election passes and a container start.
const TAKEOVER_MS = 10 * 60 * 1000;
// syncthing's FlagLocalReceiveOnly
const RECEIVE_ONLY_CHANGE_FLAG = 8;
// syncthing's FlagLocalGlobal
const GLOBAL_VERSION_FLAG = 16;
const SAVE = 'appdata/save-b';
const SAVE_CONTENT = 'written by the primary';

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

  it('keeps a primary whose location expired in the folder while it is connected', async function () {
    this.timeout(300000);
    step('the primary stops announcing; its syncthing and app carry on');
    await crashFluxos(client(B).container, { hold: true });
    expect(await isDaemonUp(client(B)), 'the primary\'s syncthing went down with its FluxOS, so nothing here is tested').to.equal(true);
    const expired = await Promise.all([A, C].map((i) => dbClient(i + 1).expireAppLocation(appName, client(B).ip)));
    expect(expired[0], 'the standby held no location for the primary, so none expired').to.be.at.least(1);

    await sleepUnlessInfraDead(MONITOR_PASSES_MS);
    expect(await getConnectedDevices(client(A)), 'the primary\'s syncthing is not connected to the standby').to.include(primaryDevice);
    const host = (ip) => String(ip).split(':')[0];
    const primaryRows = (await dbClient(A + 1).getAppLocations(appName)).filter((row) => host(row.ip) === host(client(B).ip));
    expect(primaryRows.length, 'a location for the primary came back').to.equal(0);
    const devices = (await getFolderConfig(client(A), folder))?.devices?.map((d) => d.deviceID) ?? [];
    expect(devices, 'the standby dropped a connected primary from the folder').to.include(primaryDevice);
    expect(fleet.twoRan, 'the standby started beside a primary that still runs').to.deep.equal([]);
  });

  it('takes over once that primary dies, keeping the primary\'s data only it holds', async function () {
    this.timeout(TAKEOVER_MS + 300000);
    step('the primary\'s machine dies');
    await stopAppContainer(client(B).container, appName, appName);
    await stopDaemon(client(B));
    await waitFor(async () => !((await getFolderConfig(client(A), folder))?.devices ?? [])
      .some((d) => d.deviceID === primaryDevice), {
      timeout: 600000, interval: 5000, label: 'the standby drops the dead primary from the folder',
    });

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
    // eslint-disable-next-line no-bitwise
    expect((record.local.localFlags & GLOBAL_VERSION_FLAG) !== 0,
      'the standby\'s own record of the change is not marked the cluster\'s version, so its list of local changes cannot say no other device holds it').to.equal(true);
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
  });
});
