// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setDeviceConfigOutage, resetSyncState, setSynced } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Which folders a node holds writable is answered by syncthing's FOLDER
// configuration alone. Its DEVICE configuration is a second read on the same
// monitor pass, and it answers a different question.
//
// A pass that reads the folders and then fails to read the devices still knows
// which folders it holds. If it withholds that, every peer asking before it
// promotes a folder of its own is told to wait - and keeps being told, for as
// long as the device read keeps failing. Nothing bounds that: the asker treats
// an unready peer as a reason to wait rather than a clearance, which is right,
// and is why the answer must not go missing for a reason that has nothing to do
// with folders.
//
// The suite exists because nothing could produce that state before: the stub's
// device configuration had no failure path, so folders-succeed-devices-fail was
// unreachable and the ordering was untested at either tip.
const subnet = getSubnetConfig();

describe('a node that read its folders publishes them even when the device read fails', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2edevcfg${Date.now()}`;

  const promoted = async (index) => {
    const answer = await env.clients[index].get('/apps/promotedfolders');
    return answer?.data ?? { ready: false, folders: [] };
  };

  const linesFor = (index) => env.nodeDiagnostics().find((n) => n.index === index)?.lines ?? [];

  const sawLine = (index, pattern, timeout = 180000) => waitFor(
    () => linesFor(index).some((line) => pattern.test(line)),
    { timeout, label: `node ${index} logs ${pattern}` },
  );

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    // A folder this node holds WRITABLE, so there is something to withhold.
    //
    // Installing the app is not enough and `ready` does not say it is: a new
    // install's folder is created receiveonly, and the primary selection that
    // would promote it is skipped for as long as syncthing reports the app
    // unsynced - "not ready yet (syncthing not synced), skipping primary
    // selection for this cycle". So the node answers ready with an EMPTY list,
    // which is a true answer to a different question, and a suite that waits on
    // `ready` proceeds with nothing to withhold and can never fail.
    const seeded = await seedSyncthingApp(env, { name: appName, mode: 'g', index: 0 });
    await setSynced({ ip: subnet.nodeIp(1), folder: seeded.folder });

    await waitFor(async () => (await promoted(0)).folders.includes(seeded.folder), {
      timeout: 240000,
      label: `node 0 holds ${seeded.folder} writable`,
    });
  });

  after(async function () {
    this.timeout(60000);
    await setDeviceConfigOutage({ ip: subnet.nodeIp(1), enabled: false }).catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  // The node is RESTARTED with the device read already failing, and that is the
  // whole test rather than a detail of it.
  //
  // `ready` is `promotedFolderIds !== null`, and that set is assigned on the first
  // pass that completes and never cleared. So a node which has already published
  // once goes on publishing its last answer however many later passes fail - with
  // the fix and without it. Breaking the device read on a node that has already
  // answered therefore proves nothing: it was green against a build with the fix
  // reversed out, which is how this was found.
  //
  // The state the defect lives in is a node that has NOT published yet and cannot
  // finish a device read - a node booting, or a fleet-wide restart putting every
  // holder of an app there at once, which is the case globalState's own comment
  // describes. Sharing one try then means the folders are never published at all,
  // `ready` stays false, and every peer asking is told to wait for as long as the
  // device read keeps failing.
  it('publishes the folders it read on a node whose device read has never succeeded', async function () {
    this.timeout(300000);
    const before = await promoted(0);
    expect(before.ready, 'precondition: the node was publishing before the outage').to.equal(true);
    expect(before.folders, 'precondition: the node holds a folder there is something to withhold')
      .to.have.lengthOf.at.least(1);

    await setDeviceConfigOutage({ ip: subnet.nodeIp(1), enabled: true });
    // Clears promotedFolderIds back to null, so the next pass is a first pass.
    await env.restartNode(0);

    // Asserted, not assumed: an outage that silently failed to apply reads exactly
    // like the fix working.
    //
    // Matched on the device read having failed rather than on one wording of it.
    // A pass that cannot finish never reaches the line clearing
    // syncthingAppsFirstRun, so on a build without the fix every pass takes the
    // first-run WARN and the error form is never logged at all - and the two
    // builds word it differently besides. A pattern that pins one of them fails
    // the other for its phrasing rather than for its behaviour, which is the
    // assertion looking right while proving nothing.
    await sawLine(
      0,
      /Syncthing (device )?configuration not ready yet on first run|Failed to get Syncthing (devices )?configuration:/,
    );

    await waitFor(async () => (await promoted(0)).ready === true, {
      timeout: 180000,
      label: 'node 0 publishes its folders with the device read still failing',
    });

    const during = await promoted(0);
    expect([...during.folders].sort(), 'the folders it holds changed with the device read')
      .to.deep.equal([...before.folders].sort());
  });

  it('is still publishing once the device read recovers', async function () {
    this.timeout(300000);
    await setDeviceConfigOutage({ ip: subnet.nodeIp(1), enabled: false });

    await waitFor(async () => (await promoted(0)).ready === true, {
      timeout: 180000,
      label: 'node 0 publishing after recovery',
    });
  });
});
