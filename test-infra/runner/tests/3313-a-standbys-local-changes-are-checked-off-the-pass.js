// weight: heavy
/*
 * Whether a standby's local changes hold the only copy of the primary's data is
 * checked off the monitor pass, and acted on only while the folder is the one it was
 * checked against. The primary is alive throughout, so every change here is held
 * elsewhere and is reverted in the end; what is tested is when.
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
import { crashFluxos, releaseFluxos, execInContainer } from '../framework/container.js';
import { readPath, scanFolder } from '../framework/syncthing-real.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
const BEFORE_ANSWER = 'syncthing:beforeLocalChangeAnswer';
const BEFORE_CHECK = 'syncthing:beforeLocalChangeCheck';
const FILES = 2000;
const PASSES_WHILE_HELD = 3;

function step(what) {
  console.log(`# 3313 ${new Date().toISOString()} ${what}`);
}

describe('a standby\'s local changes are checked off the monitor pass', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2echeckoffpass${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  const passes = () => client(A).getDecisionCount('syncthing:folderPass', folder, 'evaluated');
  const sh = async (i, command) => {
    const r = await execInContainer(client(i).container, command);
    if (r.exitCode !== 0) throw new Error(`${command}: ${r.output}`);
    return r.stdout;
  };
  const heldAt = (from) => client(A).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_ANSWER && d.key === folder, 300000, { afterId: from });
  const event = (name, from) => client(A).waitForEvent(name, (d) => d.folder === folder, 300000, { afterId: from });
  const eventsSince = (name, from) => client(A).getEventBuffer().filter((e) => e.id > from && e.event === name && e.data?.folder === folder);

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    await sh(B, `mkdir -p ${root}/appdata/many && for i in $(seq 1 ${FILES}); do printf 'primary %s' $i > ${root}/appdata/many/f$i; done`);
    await scanFolder(client(B), folder);
    await waitFor(async () => (await sh(A, `ls ${root}/appdata/many | wc -l`)).trim() === String(FILES), {
      timeout: 600000, interval: 5000, label: 'the primary\'s files reached the standby',
    });
  });

  after(async function () {
    this.timeout(60000);
    await client(A)?.releaseAllCheckpoints().catch(() => {});
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('runs the standby\'s passes while it checks a rewrite of every file the primary wrote, then reverts it', async function () {
    this.timeout(900000);
    await client(A).holdCheckpoint(BEFORE_ANSWER, folder);
    const from = client(A).getLastEventId();
    step(`the standby rewrites its copy of ${FILES} of the primary's files`);
    await sh(A, `for i in $(seq 1 ${FILES}); do printf ' standby' >> ${root}/appdata/many/f$i; done`);
    await scanFolder(client(A), folder);
    await heldAt(from);

    const passesAtHold = await passes();
    await waitFor(async () => await passes() >= passesAtHold + PASSES_WHILE_HELD, {
      timeout: 120000, interval: 2000, label: `${PASSES_WHILE_HELD} passes over the folder while its check is held`,
    });
    expect(eventsSince('syncthing:localChangesReverted', from), 'reverted before the check answered').to.deep.equal([]);

    await client(A).releaseCheckpoint(BEFORE_ANSWER, folder);
    await event('syncthing:localChangesReverted', from);
    await waitFor(async () => (await readPath(client(A), `${root}/appdata/many/f1`)) === 'primary 1', {
      timeout: 120000, interval: 2000, label: 'the standby holds the primary\'s copy again',
    });
  });

  it('does not revert on an answer from before a later write, and reverts once that write is checked', async function () {
    this.timeout(900000);
    await client(A).holdCheckpoint(BEFORE_ANSWER, folder);
    const from = client(A).getLastEventId();
    await sh(A, `printf ' first' >> ${root}/appdata/many/f1`);
    await scanFolder(client(A), folder);
    await heldAt(from);

    step('a second write lands while the first is being checked');
    await sh(A, `printf ' second' >> ${root}/appdata/many/f2`);
    await scanFolder(client(A), folder);
    const passesAfterWrite = await passes();
    await waitFor(async () => await passes() >= passesAfterWrite + 2, {
      timeout: 120000, interval: 2000, label: 'two passes have seen the second write',
    });

    // The check asked for since the second write is held before it starts, so the
    // passes find the answer from before it.
    await client(A).holdCheckpoint(BEFORE_CHECK, folder);
    const releasedAt = client(A).getLastEventId();
    await client(A).releaseCheckpoint(BEFORE_ANSWER, folder);
    await event('syncthing:localChangesChecked', releasedAt);
    const passesOnOldAnswer = await passes();
    await waitFor(async () => await passes() >= passesOnOldAnswer + 3, {
      timeout: 120000, interval: 2000, label: 'three passes with the answer from before the second write',
    });
    expect(eventsSince('syncthing:localChangesReverted', from), 'reverted on the answer from before the second write').to.deep.equal([]);

    await client(A).releaseCheckpoint(BEFORE_CHECK, folder);
    await event('syncthing:localChangesReverted', from);
  });

  it('checks again after FluxOS restarts mid-check, and reverts', async function () {
    this.timeout(900000);
    await client(A).holdCheckpoint(BEFORE_ANSWER, folder);
    const from = client(A).getLastEventId();
    await sh(A, `printf ' again' >> ${root}/appdata/many/f3`);
    await scanFolder(client(A), folder);
    await heldAt(from);

    step('the standby\'s FluxOS restarts with the check held');
    await crashFluxos(client(A).container, { hold: true });
    await releaseFluxos(client(A).container);
    await waitFor(async () => (await readPath(client(A), `${root}/appdata/many/f3`)) === 'primary 3', {
      timeout: 600000, interval: 5000, label: 'the restarted standby reverts to the primary\'s copy',
    });
  });
});
