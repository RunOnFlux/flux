// weight: heavy
/*
 * A single-writer app's primary stops announcing while it carries on running: its
 * FluxOS is gone, its syncthing and its container are not. Its location expires.
 *
 * The standby drops it from the folder though its syncthing is still connected, so
 * what it writes from then on reaches no holder. Once FDM stops naming it, the
 * standby takes the app over beside it: a primary no location lists is out of the
 * app. What each writes stays on its own side, and a holder placed after the
 * location expired syncs the standby's copy and nothing of the old primary's.
 *
 * A = the standby, B = the primary, C = the holder placed later.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import {
  placeSilentPrimaryApp, A, B, C,
} from '../framework/silent-primary.js';
import { crashFluxos, execInContainer } from '../framework/container.js';
import {
  getDeviceId, getConnectedDevices, getFolderConfig, isDaemonUp, readPath, scanFolder,
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
const SAVE = 'appdata/save-b';
const SAVE_CONTENT = 'written by the primary';
const FENCED = 'appdata/written-after-expiry';
const FENCED_LATER = 'appdata/written-beside-the-new-primary';
const NEW_PRIMARY = 'appdata/written-by-the-new-primary';

function step(what) {
  console.log(`# 3316 ${new Date().toISOString()} ${what}`);
}

describe('a primary no location lists is fenced while it runs', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2efenced${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const client = (i) => fleet.env.clients[i];
  let primaryDevice;
  // How long the primary's write took to reach the standby while it was listed.
  let listedSyncMs;

  async function write(i, path, content) {
    const wrote = await execInContainer(client(i).container, `printf '${content}' > ${root}/${path}`);
    if (wrote.exitCode !== 0) throw new Error(`could not write on node ${i}: ${wrote.output}`);
    await scanFolder(client(i), folder);
  }

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    primaryDevice = await getDeviceId(client(B));
    const startedAt = Date.now();
    await write(B, SAVE, SAVE_CONTENT);
    await waitFor(async () => (await readPath(client(A), `${root}/${SAVE}`)) === SAVE_CONTENT, {
      timeout: 240000, interval: 1000, label: 'the primary\'s second file reached the standby',
    });
    listedSyncMs = Date.now() - startedAt;
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('drops the primary from the standby\'s folder once its location expires, though it still runs', async function () {
    this.timeout(300000);
    step('the primary stops announcing; its syncthing and app carry on');
    await crashFluxos(client(B).container, { hold: true });
    expect(await isDaemonUp(client(B)), 'the primary\'s syncthing went down with its FluxOS, so nothing here is tested').to.equal(true);
    const expired = await Promise.all([A, C].map((i) => dbClient(i + 1).expireAppLocation(appName, client(B).ip)));
    expect(expired[0], 'the standby held no location for the primary, so none expired').to.be.at.least(1);
    await sleepUnlessInfraDead(MONITOR_PASSES_MS);

    step('the primary writes after its location expired');
    await write(B, FENCED, 'written after expiry');
    await sleepUnlessInfraDead(Math.max(MONITOR_PASSES_MS, 5 * listedSyncMs));
    expect(await readPath(client(A), `${root}/${FENCED}`), 'the write of a primary no location lists reached the standby').to.equal(null);
    const devices = (await getFolderConfig(client(A), folder))?.devices?.map((d) => d.deviceID) ?? [];
    expect(devices, 'the standby kept a primary no location lists in the folder').to.not.include(primaryDevice);
    // Connected and fenced: the write would have arrived over this connection.
    expect(await getConnectedDevices(client(A)), 'the primary\'s syncthing is not connected to the standby').to.include(primaryDevice);
    expect(await fleet.isUp(B), 'the primary\'s app stopped, so nothing here is tested').to.equal(true);
  });

  it('takes the app over on the standby once FDM stops naming the primary, beside the primary still running it', async function () {
    this.timeout(TAKEOVER_MS + 60000);
    await clearMaster(appName);
    step('waiting for the takeover');
    await waitFor(() => fleet.isUp(A), {
      timeout: TAKEOVER_MS, interval: 5000, label: 'the standby takes the app over',
    });
    expect(await client(A).getDecisionCount('masterSlave:decision', fleet.identifier, 'previousPrimaryUnlisted'),
      'the standby took over without reading the primary as out of the app').to.be.at.least(1);
    expect(await fleet.isUp(B), 'the old primary stopped, so nothing here is tested').to.equal(true);
    expect(await readPath(client(A), `${root}/${SAVE}`), 'the old primary\'s data is gone from the new primary').to.equal(SAVE_CONTENT);
  });

  it('keeps what each primary writes on its own side, and a holder placed later syncs only the new primary\'s copy', async function () {
    this.timeout(900000);
    await write(A, NEW_PRIMARY, 'written by the new primary');
    await write(B, FENCED_LATER, 'written beside the new primary');

    step('a holder is placed after the old primary\'s location expired');
    await installOnNodes(fleet.env, fleet.app, [C]);
    await waitFor(async () => (await readPath(client(C), `${root}/${NEW_PRIMARY}`)) === 'written by the new primary', {
      timeout: 300000, interval: 5000, label: 'the new primary\'s write reached the holder placed later',
    });
    expect(await readPath(client(C), `${root}/${SAVE}`), 'the holder placed later lacks the data from before the expiry').to.equal(SAVE_CONTENT);
    expect(await readPath(client(C), `${root}/${FENCED}`), 'the old primary\'s write after its location expired reached the holder placed later').to.equal(null);
    expect(await readPath(client(C), `${root}/${FENCED_LATER}`), 'the old primary\'s later write reached the holder placed later').to.equal(null);
    expect(await readPath(client(A), `${root}/${FENCED_LATER}`), 'the old primary\'s later write reached the new primary').to.equal(null);
    expect(await readPath(client(B), `${root}/${NEW_PRIMARY}`), 'the new primary\'s write reached the old primary').to.equal(null);
  });
});
