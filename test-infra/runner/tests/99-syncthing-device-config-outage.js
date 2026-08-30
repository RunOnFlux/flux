// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setDeviceConfigOutage, resetSyncState } from '../framework/syncthing-control.js';
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

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    // A folder this node holds writable, so there is something to withhold.
    await seedSyncthingApp(env, { name: appName, mode: 'g', index: 0 });

    await waitFor(async () => (await promoted(0)).ready === true, {
      timeout: 180000,
      label: 'node 0 publishes its promoted folders at all',
    });
  });

  after(async function () {
    this.timeout(60000);
    await setDeviceConfigOutage({ ip: subnet.nodeIp(1), enabled: false }).catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('keeps answering ready while its device configuration cannot be read', async function () {
    this.timeout(300000);
    const before = await promoted(0);
    expect(before.ready, 'precondition: the node was publishing before the outage').to.equal(true);

    await setDeviceConfigOutage({ ip: subnet.nodeIp(1), enabled: true });

    // Several monitor passes, every one of them failing the device read.
    await new Promise((resolve) => { setTimeout(resolve, 90000); });

    const during = await promoted(0);
    expect(during.ready, 'the node stopped answering because a device read failed').to.equal(true);
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
