// weight: heavy
/*
 * A standby's local changes are reverted while its primary keeps writing. Every pull
 * moves the folder's sequences, and none moves syncthing's counts of the standby's own
 * changes, so a check of them stands while the primary writes.
 *
 * A revert is of the changes checked and no others: one held before it reads the
 * folder's changes again, while a further change lands, does not go ahead until the
 * folder is checked again.
 *
 * And it is of the folder checked: one held while the primary's location expires and
 * the primary leaves the standby's folder, which makes the standby's change to the
 * primary's file the only copy, does not go ahead, and that change is kept.
 *
 * A = the standby, B = the primary, C = holds nothing.
 */
import {
  describe, it, before, after, afterEach,
} from 'mocha';
import { expect } from 'chai';
import {
  placeSilentPrimaryApp, A, B,
} from '../framework/silent-primary.js';
import { execInContainer, crashFluxos } from '../framework/container.js';
import { dbClient } from '../framework/db-client.js';
import {
  readPath, scanFolder, getFolderConfig, getDeviceId,
} from '../framework/syncthing-real.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
const BEFORE_REVERT = 'syncthing:beforeLocalChangeRevert';
// The primary writes this often for the whole suite: faster than the standby's passes.
const WRITE_EVERY_MS = 2000;
// Long enough for many passes, each finding the folder pulled since the one before.
const REVERT_MS = 5 * 60 * 1000;

function step(what) {
  console.log(`# 3317 ${new Date().toISOString()} ${what}`);
}

describe('a standby reverts its local changes while the primary keeps writing', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2ewriting${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  let writing = false;
  let writer = null;
  let lines = 0;
  const sh = async (i, command) => {
    const r = await execInContainer(client(i).container, command);
    if (r.exitCode !== 0) throw new Error(`${command}: ${r.output}`);
    return r.stdout;
  };
  const linesOnStandby = async () => Number((await sh(A, `wc -l < ${root}/appdata/live.log 2>/dev/null || echo 0`)).trim());
  const eventsSince = (name, from) => client(A).getEventBuffer().filter((e) => e.id > from && e.event === name && e.data?.folder === folder);
  const event = (name, from, timeout) => client(A).waitForEvent(name, (d) => d.folder === folder, timeout, { afterId: from });

  // The primary appends a line and has syncthing scan it, every WRITE_EVERY_MS.
  async function keepWriting() {
    while (writing) {
      lines += 1;
      // eslint-disable-next-line no-await-in-loop
      await sh(B, `echo line-${lines} >> ${root}/appdata/live.log`).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await scanFolder(client(B), folder).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, WRITE_EVERY_MS); });
    }
  }

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    writing = true;
    writer = keepWriting();
    await waitFor(async () => (await linesOnStandby()) >= 3, {
      timeout: 240000, interval: 2000, label: 'the primary\'s writes reach the standby',
    });
  });

  // A test that fails holding a revert would hold the next test's reverts too.
  afterEach(async function () {
    await client(A)?.releaseAllCheckpoints().catch(() => {});
  });

  after(async function () {
    this.timeout(60000);
    writing = false;
    await writer;
    await client(A)?.releaseAllCheckpoints().catch(() => {});
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('reverts its changes while the primary keeps writing', async function () {
    this.timeout(REVERT_MS + 120000);
    const from = client(A).getLastEventId();
    step('the standby changes the mode of one of the primary\'s files and makes a stray');
    await sh(A, `chmod 600 ${root}/appdata/seed-data && echo stray > ${root}/appdata/stray-1`);
    await scanFolder(client(A), folder);
    const linesAtChange = await linesOnStandby();

    await event('syncthing:localChangesReverted', from, REVERT_MS).catch(() => {
      throw new Error('the standby did not revert its changes while the primary kept writing');
    });
    // A revert resets syncthing's index; the pull that follows puts the primary's
    // version back.
    await waitFor(async () => (await readPath(client(A), `${root}/appdata/stray-1`)) === null, {
      timeout: 120000, interval: 2000, label: 'the stray is gone from the standby',
    });
    await waitFor(async () => (await sh(A, `stat -c %a ${root}/appdata/seed-data`)).trim() !== '600', {
      timeout: 120000, interval: 2000, label: 'the primary\'s file has the primary\'s mode again',
    });
    await waitFor(async () => (await linesOnStandby()) > linesAtChange, {
      timeout: 60000, interval: 2000, label: 'the primary\'s writes kept reaching the standby',
    });
  });

  it('does not revert a change made after the check until it has been checked', async function () {
    this.timeout(REVERT_MS + 300000);
    await client(A).holdCheckpoint(BEFORE_REVERT, folder);
    const from = client(A).getLastEventId();
    await sh(A, `echo stray > ${root}/appdata/stray-2`);
    await scanFolder(client(A), folder);
    await client(A).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_REVERT && d.key === folder, REVERT_MS, { afterId: from });

    step('a further change lands while the revert of the first is held');
    await sh(A, `echo stray > ${root}/appdata/stray-3`);
    await scanFolder(client(A), folder);
    await waitFor(async () => Number((await sh(A, `ls ${root}/appdata | grep -c '^stray-'`)).trim()) === 2, {
      timeout: 30000, interval: 1000, label: 'both strays are on the standby',
    });
    const releasedAt = client(A).getLastEventId();
    await client(A).releaseCheckpoint(BEFORE_REVERT, folder);

    const reverted = await event('syncthing:localChangesReverted', releasedAt, REVERT_MS);
    const checked = eventsSince('syncthing:localChangesChecked', releasedAt);
    expect(checked.filter((e) => e.id < reverted.id), 'reverted changes it had not checked').to.not.deep.equal([]);
    await waitFor(async () => (await readPath(client(A), `${root}/appdata/stray-2`)) === null
      && (await readPath(client(A), `${root}/appdata/stray-3`)) === null, {
      timeout: 120000, interval: 2000, label: 'both strays are gone from the standby',
    });
  });

  // Last: the primary is fenced from here on.
  it('keeps a change to the primary\'s file whose revert was held while the primary left the folder', async function () {
    this.timeout(REVERT_MS + 600000);
    writing = false;
    await writer;
    const kept = `${root}/appdata/kept`;
    await sh(B, `printf primary > ${kept}`);
    await scanFolder(client(B), folder);
    await waitFor(async () => (await readPath(client(A), kept)) === 'primary', {
      timeout: 120000, interval: 2000, label: 'the primary\'s file reached the standby',
    });

    await client(A).holdCheckpoint(BEFORE_REVERT, folder);
    const from = client(A).getLastEventId();
    step('the standby changes the primary\'s file, and its revert is held');
    await sh(A, `printf standby > ${kept}`);
    await scanFolder(client(A), folder);
    await client(A).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_REVERT && d.key === folder, REVERT_MS, { afterId: from });

    step('the primary stops announcing, its location expires, and it leaves the standby\'s folder');
    const primaryDevice = await getDeviceId(client(B));
    await crashFluxos(client(B).container, { hold: true });
    const expired = await dbClient(A + 1).expireAppLocation(appName, client(B).ip);
    expect(expired, 'fixture: the standby held no location for the primary, so none expired').to.be.at.least(1);
    await waitFor(async () => !((await getFolderConfig(client(A), folder))?.devices ?? []).some((d) => d.deviceID === primaryDevice), {
      timeout: 300000, interval: 2000, label: 'the primary left the standby\'s folder',
    });

    const releasedAt = client(A).getLastEventId();
    await client(A).releaseCheckpoint(BEFORE_REVERT, folder);
    const onlyCopy = await client(A).waitForEvent('syncthing:localChangesChecked', (d) => d.folder === folder && d.onlyCopy, REVERT_MS, { afterId: releasedAt })
      .catch(() => null);

    expect(eventsSince('syncthing:localChangesReverted', releasedAt), 'reverted the standby\'s change once it was the only copy').to.deep.equal([]);
    expect(await readPath(client(A), kept), 'the standby\'s change to the primary\'s file').to.equal('standby');
    expect(onlyCopy, 'the standby never checked the folder again and found its change the only copy').to.not.equal(null);
  });
});
