// weight: heavy
/*
 * Syncthing drops a deleted device from every folder that lists it, outside
 * FluxOS's writes to those folders. A revert of a standby's changes holds the
 * folder against those writes from the moment it finds the folder the one it
 * checked until the revert is sent, so a device the monitor no longer wants
 * stays configured while any folder lists it, and leaves the folder through the
 * folder's own write.
 *
 * The primary's device becomes one the monitor deletes while the standby's revert
 * of a change to the primary's file is held after its last read: the primary
 * stops announcing, its location expires, and another device is configured under
 * its name. The standby's change is reverted with the primary still in the
 * folder, so it is not deleted, and the primary leaves the folder only once the
 * revert has been sent.
 *
 * A = the standby, B = the primary, C = holds nothing.
 */
import {
  describe, it, before, after, afterEach,
} from 'mocha';
import { expect } from 'chai';
import {
  placeSilentPrimaryApp, A, B, C,
} from '../framework/silent-primary.js';
import { execInContainer, crashFluxos } from '../framework/container.js';
import { dbClient } from '../framework/db-client.js';
import {
  readPath, scanFolder, getFolderConfig, getFolderStatus, getDeviceId, getConfiguredDevices, addDevice,
} from '../framework/syncthing-real.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
const REVERT_SENT = 'syncthing:beforeLocalChangeRevertSent';
const REVERT_MS = 5 * 60 * 1000;

function step(what) {
  console.log(`# 3320 ${new Date().toISOString()} ${what}`);
}

describe('a device is not removed from a folder a revert holds', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2eheldrevert${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  const sh = async (i, command) => {
    const r = await execInContainer(client(i).container, command);
    if (r.exitCode !== 0) throw new Error(`${command}: ${r.output}`);
    return r.stdout;
  };
  const folderDevices = async () => ((await getFolderConfig(client(A), folder))?.devices ?? []).map((d) => d.deviceID);

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
  });

  afterEach(async function () {
    await client(A)?.releaseAllCheckpoints().catch(() => {});
  });

  after(async function () {
    this.timeout(60000);
    await client(A)?.releaseAllCheckpoints().catch(() => {});
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('reverts the standby\'s change while the primary is still in the folder, and removes the primary from it after', async function () {
    this.timeout(REVERT_MS + 600000);
    const held = `${root}/appdata/held`;
    await sh(B, `printf primary > ${held}`);
    await scanFolder(client(B), folder);
    await waitFor(async () => (await readPath(client(A), held)) === 'primary', {
      timeout: 120000, interval: 2000, label: 'the primary\'s file reached the standby',
    });
    const primaryDevice = await getDeviceId(client(B));
    const primaryName = (await getConfiguredDevices(client(A))).find((d) => d.deviceID === primaryDevice)?.name;
    expect(primaryName, 'fixture: the standby has no device configured for the primary').to.be.a('string');

    await client(A).holdCheckpoint(REVERT_SENT, folder);
    const from = client(A).getLastEventId();
    step('the standby changes the primary\'s file, and its revert is held after its last read');
    await sh(A, `printf standby > ${held}`);
    await scanFolder(client(A), folder);
    await client(A).waitForEvent('checkpoint:held', (d) => d.name === REVERT_SENT && d.key === folder, REVERT_MS, { afterId: from });

    step('the primary stops announcing, its location expires, and another device is configured under its name');
    await crashFluxos(client(B).container, { hold: true });
    const expired = await dbClient(A + 1).expireAppLocation(appName, client(B).ip);
    expect(expired, 'fixture: the standby held no location for the primary, so none expired').to.be.at.least(1);
    await addDevice(client(A), {
      deviceID: await getDeviceId(client(C)),
      name: primaryName,
      address: `tcp://${client(B).ip}:16129`,
    });
    const passFrom = client(A).getLastEventId();
    await client(A).waitForEvent('syncthing:passComplete', () => true, 120000, { afterId: passFrom });
    const configuredWhileHeld = (await getConfiguredDevices(client(A))).some((d) => d.deviceID === primaryDevice);
    const inFolderWhileHeld = (await folderDevices()).includes(primaryDevice);

    const releasedAt = client(A).getLastEventId();
    await client(A).releaseCheckpoint(REVERT_SENT, folder);
    await client(A).waitForEvent('syncthing:localChangesReverted', (d) => d.folder === folder, REVERT_MS, { afterId: releasedAt })
      .catch(() => {
        throw new Error('the standby did not revert its change once the revert was released');
      });
    await waitFor(async () => !(await folderDevices()).includes(primaryDevice), {
      timeout: 300000, interval: 2000, label: 'the primary left the standby\'s folder',
    });
    await waitFor(async () => (await getFolderStatus(client(A), folder))?.state === 'idle', {
      timeout: 120000, interval: 2000, label: 'the standby\'s folder is idle',
    });

    // Reverted while the primary was in the folder, the file is the primary's
    // version once pulled, or the standby's while the primary cannot be reached;
    // reverted with no other device in the folder, it is deleted.
    expect(await readPath(client(A), held), 'the standby\'s file after its revert').to.be.oneOf(['primary', 'standby']);
    expect(configuredWhileHeld, 'the primary\'s device was deleted while a folder listed it').to.equal(true);
    expect(inFolderWhileHeld, 'the primary left the folder while its revert was held').to.equal(true);
  });
});
