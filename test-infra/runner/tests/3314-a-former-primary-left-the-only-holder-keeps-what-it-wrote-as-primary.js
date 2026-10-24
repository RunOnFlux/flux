// weight: heavy
/*
 * A node that was a single-writer app's primary, and later its standby, is left the
 * only holder. What it wrote as the primary carries no other device's history, which
 * is also what a standby's own junk carries; but no other holder runs the app, so
 * this node holds its data, and a revert has nothing to restore it from. Its own
 * earlier file and directory change on its disk: it keeps both and takes the app
 * over with them.
 *
 * Reverted, the file is deleted - no other device holds it - and the directory, not
 * empty, can never be: the folder is reverted on every pass and never taken over.
 *
 * A = the standby, then the primary; B = the primary, then the standby; C = holds
 * nothing.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import {
  placeSilentPrimaryApp, A, B, C,
} from '../framework/silent-primary.js';
import {
  crashFluxos, releaseFluxos, execInContainer, stopAppContainer,
} from '../framework/container.js';
import {
  getDeviceId, getFolderConfig, getFileInfo, readPath, scanFolder, startDaemon, stopDaemon, waitForDaemonEvent, folderSaved,
} from '../framework/syncthing-real.js';
import { dbClient } from '../framework/db-client.js';
import { clearMaster, electMaster } from '../framework/fdm-control.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
// A machine that dies closes none of its connections, so a holder's syncthing keeps
// them until its own receive timeout (5 min). Then a few election passes and a start.
const TAKEOVER_MS = 10 * 60 * 1000;
// syncthing's FlagLocalReceiveOnly
const RECEIVE_ONLY_CHANGE_FLAG = 8;
const FILE = 'appdata/written-as-primary.txt';
const DIR = 'appdata/primary-dir';
const CONTENT = 'written by B as the primary';

function step(what) {
  console.log(`# 3314 ${new Date().toISOString()} ${what}`);
}

describe('a former primary left the only holder keeps what it wrote as the primary', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2eformerprimary${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  const sh = async (i, command) => {
    const r = await execInContainer(client(i).container, command);
    if (r.exitCode !== 0) throw new Error(`${command}: ${r.output}`);
    return r.stdout;
  };
  // eslint-disable-next-line no-bitwise
  const heldOnlyHere = (record) => ((record?.global?.localFlags ?? 0) & RECEIVE_ONLY_CHANGE_FLAG) !== 0;
  const historyOf = async (i, item) => (await getFileInfo(client(i), folder, item))?.local?.version ?? [];

  // The machine of node `dead` dies, and `holder` drops it from the folder.
  async function machineDies(dead, holder) {
    const deadDevice = await getDeviceId(client(dead));
    await crashFluxos(client(dead).container, { hold: true });
    await Promise.all([A, B, C].filter((i) => i !== dead)
      .map((i) => dbClient(i + 1).expireAppLocation(appName, client(dead).ip)));
    await stopAppContainer(client(dead).container, appName, appName);
    await stopDaemon(client(dead));
    await waitFor(async () => !((await getFolderConfig(client(holder), folder))?.devices ?? [])
      .some((d) => d.deviceID === deadDevice), {
      timeout: TAKEOVER_MS, interval: 5000, label: `node ${holder} drops node ${dead} from the folder`,
    });
  }

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    await sh(B, `mkdir -p ${root}/${DIR} && printf '${CONTENT}' > ${root}/${FILE} && printf 'inside' > ${root}/${DIR}/inside.txt`);
    await scanFolder(client(B), folder);
    await waitFor(async () => (await readPath(client(A), `${root}/${FILE}`)) === CONTENT, {
      timeout: 240000, interval: 3000, label: 'what the primary wrote reached the standby',
    });
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('hands the app to the standby when the primary dies', async function () {
    this.timeout(TAKEOVER_MS + 300000);
    step('B, the primary, dies');
    await machineDies(B, A);
    await clearMaster(appName);
    await waitFor(() => fleet.isUp(A), { timeout: TAKEOVER_MS, interval: 5000, label: 'A takes the app over' });
    await electMaster(appName, client(A).ip);
  });

  it('brings B back as a standby holding what it wrote as the primary', async function () {
    this.timeout(600000);
    step('B returns');
    await startDaemon(client(B), { paused: true });
    await releaseFluxos(client(B).container);
    await waitForDaemonEvent(client(B), folderSaved(folder, { type: 'receiveonly', paused: false }), {
      timeout: 300000, label: 'B\'s folder receiving',
    });
    expect(await readPath(client(B), `${root}/${FILE}`), 'B holds what it wrote').to.equal(CONTENT);
    const ownShortId = (await getDeviceId(client(B))).substring(0, 7);
    expect((await historyOf(B, FILE)).every((counter) => counter.startsWith(`${ownShortId}:`)),
      'fixture: the file\'s history names a device other than B, so this is not B\'s own data').to.equal(true);
    expect(fleet.twoRan, 'two nodes ran the app at once').to.deep.equal([]);
  });

  it('keeps B\'s changes to what it wrote as the primary once it is the only holder, and B takes the app over with them', async function () {
    this.timeout(TAKEOVER_MS * 2);
    step('A, now the primary, dies');
    await machineDies(A, B);

    step('B\'s copy of its own file and directory changes on its disk');
    const changedAt = client(B).getLastEventId();
    await sh(B, `chmod 600 ${root}/${FILE} && chmod 700 ${root}/${DIR}`);
    await scanFolder(client(B), folder);
    await waitFor(async () => heldOnlyHere(await getFileInfo(client(B), folder, FILE)), {
      timeout: 120000, interval: 2000, label: 'fixture: B\'s change is the only copy',
    });

    // Whichever B decides first: kept or reverted.
    const decisions = () => client(B).getEventBuffer().filter((e) => e.id > changedAt && e.data?.folder === folder
      && (e.event === 'syncthing:localChangesKept' || e.event === 'syncthing:localChangesReverted'));
    await waitFor(async () => decisions().length > 0, {
      timeout: 300000, interval: 2000, label: 'B decides what to do with its changes',
    });
    expect(decisions()[0].event, 'B reverted the only copy of what it wrote as the primary').to.equal('syncthing:localChangesKept');
    expect(decisions()[0].data.reason, 'why B kept its changes').to.equal('noHolderRunsTheApp');
    expect(await readPath(client(B), `${root}/${FILE}`), 'B\'s file is gone').to.equal(CONTENT);

    step('B takes the app over');
    await electMaster(appName, client(B).ip);
    await waitFor(() => fleet.isUp(B), { timeout: TAKEOVER_MS, interval: 5000, label: 'B takes the app over' });
    expect(await readPath(client(B), `${root}/${FILE}`), 'B took the app over without its file').to.equal(CONTENT);
    expect(fleet.twoRan, 'two nodes ran the app at once').to.deep.equal([]);
  });
});
