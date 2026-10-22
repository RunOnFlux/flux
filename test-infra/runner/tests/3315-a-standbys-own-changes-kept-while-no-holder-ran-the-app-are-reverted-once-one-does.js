// weight: heavy
/*
 * A standby's own changes are reverted only while another holder runs the app. The
 * primary's machine dies, and a change the standby made itself is kept: no holder
 * runs the app, so nothing says it is junk. The primary comes back and runs the app
 * again, and the standby, asking again on every pass, reverts the change: the
 * primary is authoritative and does not have it.
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
import {
  crashFluxos, releaseFluxos, execInContainer, stopAppContainer,
} from '../framework/container.js';
import {
  getConnectedDevices, getDeviceId, readPath, scanFolder, startDaemon, stopDaemon,
} from '../framework/syncthing-real.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
// A machine that dies closes none of its connections, so the standby's syncthing
// holds them until its own receive timeout (5 min).
const DISCONNECT_MS = 10 * 60 * 1000;
const PASSES_AFTER_RETURN = 3;
const STRAY = 'appdata/made-on-the-standby.txt';

function step(what) {
  console.log(`# 3315 ${new Date().toISOString()} ${what}`);
}

describe('a standby\'s own changes kept while no holder ran the app are reverted once one does', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2ekeptthenreverted${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  const passes = () => client(A).getDecisionCount('syncthing:folderPass', folder, 'evaluated');
  const eventsSince = (name, from) => client(A).getEventBuffer().filter((e) => e.id > from && e.event === name && e.data?.folder === folder);

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('keeps a change the standby made while no holder runs the app', async function () {
    this.timeout(DISCONNECT_MS + 300000);
    step('the primary\'s machine dies; FDM still names it');
    const primaryDevice = await getDeviceId(client(B));
    await crashFluxos(client(B).container, { hold: true });
    await stopAppContainer(client(B).container, appName, appName);
    await stopDaemon(client(B));
    await waitFor(async () => !(await getConnectedDevices(client(A))).includes(primaryDevice), {
      timeout: DISCONNECT_MS, interval: 5000, label: 'the standby\'s syncthing loses the primary',
    });

    step('the standby makes a change of its own');
    const from = client(A).getLastEventId();
    const wrote = await execInContainer(client(A).container, `printf 'standby' > ${root}/${STRAY}`);
    expect(wrote.exitCode, `fixture: ${wrote.output}`).to.equal(0);
    await scanFolder(client(A), folder);
    const kept = await client(A).waitForEvent('syncthing:localChangesKept', (d) => d.folder === folder, 300000, { afterId: from });
    expect(kept.data.reason, 'why the standby kept its change').to.equal('noHolderRunsTheApp');
    expect(eventsSince('syncthing:localChangesReverted', from), 'the standby reverted while no holder ran the app').to.deep.equal([]);
    expect(await readPath(client(A), `${root}/${STRAY}`), 'the standby\'s change').to.equal('standby');
  });

  it('reverts that change once the primary runs the app again', async function () {
    this.timeout(900000);
    step('the primary comes back and runs the app');
    const from = client(A).getLastEventId();
    await startDaemon(client(B), { paused: true });
    await releaseFluxos(client(B).container);
    await waitFor(() => fleet.isUp(B), { timeout: 600000, interval: 5000, label: 'the primary runs the app again' });

    const passesWithPrimaryUp = await passes();
    await waitFor(async () => await passes() >= passesWithPrimaryUp + PASSES_AFTER_RETURN, {
      timeout: 180000, interval: 2000, label: `${PASSES_AFTER_RETURN} of the standby's passes with the primary running`,
    });
    expect(eventsSince('syncthing:localChangesReverted', from).length, 'the standby kept its change beside a primary running the app').to.be.at.least(1);
    await waitFor(async () => (await readPath(client(A), `${root}/${STRAY}`)) === null, {
      timeout: 120000, interval: 2000, label: 'the standby\'s change is gone',
    });
    expect(fleet.twoRan, 'two nodes ran the app at once').to.deep.equal([]);
  });
});
