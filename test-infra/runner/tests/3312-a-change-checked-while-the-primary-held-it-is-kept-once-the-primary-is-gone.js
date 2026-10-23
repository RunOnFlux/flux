// weight: heavy
/*
 * A standby's copy of a file the primary wrote changes while the primary still holds
 * it. Whether the standby's changes hold the only copy of anything is checked off the
 * monitor pass, and this check answers that they do not: the primary holds the file.
 *
 * The check is held before it leaves that answer, and the primary's machine dies and
 * is dropped from the folder. From that moment the change is the only copy of the
 * primary's data. The answer, released, describes the folder as it was; a revert on
 * it deletes that copy. The check the standby asks for next is held before it starts,
 * so the old answer is the one its passes find. They revert nothing, and once that
 * check runs the standby keeps the change, with the primary's data still on its disk.
 *
 * A = the standby, B = the primary, C = holds nothing.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import {
  placeSilentPrimaryApp, A, B,
} from '../framework/silent-primary.js';
import { crashFluxos, execInContainer, stopAppContainer } from '../framework/container.js';
import {
  getDeviceId, getFolderConfig, getFileInfo, readPath, scanFolder, stopDaemon,
} from '../framework/syncthing-real.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
const BEFORE_ANSWER = 'syncthing:beforeLocalChangeAnswer';
const BEFORE_CHECK = 'syncthing:beforeLocalChangeCheck';
const PASSES_ON_THE_OLD_ANSWER = 3;
// syncthing's FlagLocalReceiveOnly
const RECEIVE_ONLY_CHANGE_FLAG = 8;
const SAVE = 'appdata/save-b';
const SAVE_CONTENT = 'written by the primary';

function step(what) {
  console.log(`# 3312 ${new Date().toISOString()} ${what}`);
}

describe('a change checked while the primary held it is kept once the primary is gone', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2echeckedstale${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  const passes = () => client(A).getDecisionCount('syncthing:folderPass', folder, 'evaluated');
  let primaryDevice;

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    primaryDevice = await getDeviceId(client(B));
    const wrote = await execInContainer(client(B).container, `printf '${SAVE_CONTENT}' > ${root}/${SAVE}`);
    if (wrote.exitCode !== 0) throw new Error(`could not write on the primary: ${wrote.output}`);
    await scanFolder(client(B), folder);
    await waitFor(async () => (await readPath(client(A), `${root}/${SAVE}`)) === SAVE_CONTENT, {
      timeout: 240000, interval: 3000, label: 'the primary\'s file reached the standby',
    });
  });

  after(async function () {
    this.timeout(60000);
    await client(A)?.releaseAllCheckpoints().catch(() => {});
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('keeps the change, though the check answered while the primary held it', async function () {
    this.timeout(1500000);
    // eslint-disable-next-line no-bitwise
    const heldOnlyHere = (record) => ((record?.global?.localFlags ?? 0) & RECEIVE_ONLY_CHANGE_FLAG) !== 0;

    step('the standby\'s copy of the primary\'s file changes, while the primary holds it');
    await client(A).holdCheckpoint(BEFORE_ANSWER, folder);
    const changedAt = client(A).getLastEventId();
    const changed = await execInContainer(client(A).container, `chmod 600 ${root}/${SAVE}`);
    expect(changed.exitCode, `could not change the standby's copy: ${changed.output}`).to.equal(0);
    await scanFolder(client(A), folder);
    expect(heldOnlyHere(await getFileInfo(client(A), folder, SAVE)), 'fixture: the primary does not hold the file').to.equal(false);
    await client(A).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_ANSWER && d.key === folder, 300000, { afterId: changedAt });

    step('the primary\'s machine dies and the standby drops it from the folder');
    await crashFluxos(client(B).container, { hold: true });
    await Promise.all([A, 2].map((i) => dbClient(i + 1).expireAppLocation(appName, client(B).ip)));
    await stopAppContainer(client(B).container, appName, appName);
    await stopDaemon(client(B));
    await waitFor(async () => !((await getFolderConfig(client(A), folder))?.devices ?? [])
      .some((d) => d.deviceID === primaryDevice), {
      timeout: 600000, interval: 5000, label: 'the standby drops the dead primary from the folder',
    });
    await waitFor(async () => heldOnlyHere(await getFileInfo(client(A), folder, SAVE)), {
      timeout: 60000, interval: 2000, label: 'fixture: the change is now the only copy',
    });

    step('the check, answered before the primary left, is released; the next is held before it starts');
    await client(A).holdCheckpoint(BEFORE_CHECK, folder);
    const releasedAt = client(A).getLastEventId();
    await client(A).releaseCheckpoint(BEFORE_ANSWER, folder);
    await client(A).waitForEvent('syncthing:localChangesChecked', (d) => d.folder === folder && d.onlyCopy === false, 300000, { afterId: releasedAt });
    const passesOnOldAnswer = await passes();
    await waitFor(async () => await passes() >= passesOnOldAnswer + PASSES_ON_THE_OLD_ANSWER, {
      timeout: 120000, interval: 2000, label: `${PASSES_ON_THE_OLD_ANSWER} passes with the answer from before the primary left`,
    });
    const revertedOnOldAnswer = client(A).getEventBuffer().some((e) => e.id > releasedAt && e.event === 'syncthing:localChangesReverted' && e.data?.folder === folder);
    expect(revertedOnOldAnswer, 'the standby reverted the only copy on the answer from before the primary left').to.equal(false);

    step('the check asked for since runs');
    await client(A).releaseCheckpoint(BEFORE_CHECK, folder);
    await client(A).waitForEvent('syncthing:localChangesKept', (d) => d.folder === folder, 300000, { afterId: releasedAt });

    const reverted = client(A).getEventBuffer().some((e) => e.id > changedAt && e.event === 'syncthing:localChangesReverted' && e.data?.folder === folder);
    expect(reverted, 'the standby reverted the only copy on an answer from before the primary left').to.equal(false);
    expect(await readPath(client(A), `${root}/${SAVE}`), 'the primary\'s file is gone from the standby').to.equal(SAVE_CONTENT);
  });
});
