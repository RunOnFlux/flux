// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import {
  redirectOutbound, clearOutboundRedirect, getAppContainerStatus,
} from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import {
  waitFor, waitForReconcileActuated, waitForUp, waitForElectionDecisions, electionDecisionCount,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import {
  isDaemonUp, getDeviceId, getFolders, getConfiguredDevices, addDevice, listFolderFiles,
} from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A single-writer app on two nodes, the primary holding the world and the standby
// meant to hold a copy of it. The standby's router forwards by port alone, so
// every call it makes to the primary lands on a third node behind the same router
// - one that holds no copy, and says so truthfully.
//
// Taken as the primary's answers, those are: a syncthing device that is not the
// primary's, so the copy never syncs; and "not running", so the standby starts
// the component over a primary that is still writing. The primary's calls to the
// standby arrive intact, though, and when it asks the standby who it is it
// introduces itself - which is how the standby learns the primary's real device
// and receives its copy while its own calls are still redirected. All of it runs
// on real syncthing daemons here, because the device a node configures and the
// bytes that do or do not arrive are the facts in question, and the control-plane
// stub has neither.
//
// A = the standby behind the router, B = the primary, C = the node A's calls
// to B reach instead.

const A = 0;
const B = 1;
const C = 2;

const FLUX_PORTS = '16127:16129';

// Election passes the standby is watched deciding the same way, after the change
// it is deciding on.
const HELD_PASSES = 3;

// How long a misrouted verdict is held before the address is asked again, so a
// router fixed mid-suite is noticed within a pass or two.
const MISROUTED_TTL_MS = 10000;

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;

// Where a node's syncthing monitor took each device it looked up for `name`,
// counted per source.
const DEVICE_SOURCES = ['verified', 'verifiedNoDevice', 'introduced', 'withheld', 'held', 'unsigned'];
async function deviceSources(client, name) {
  const counts = await Promise.all(DEVICE_SOURCES.map((source) => client.getDecisionCount('syncthing:deviceSource', name, source)));
  return Object.fromEntries(DEVICE_SOURCES.map((source, i) => [source, counts[i]]));
}
const total = (sources) => Object.values(sources).reduce((sum, n) => sum + n, 0);

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a standby whose calls to its primary reach another node', function () {
  let env;
  let redirectRules = [];
  dumpLogsOnFailure(() => env);

  const appName = `e2ereroute${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const identifier = `${appName}_${appName}`;

  const addr = (i) => `${env.clients[i].ip}:16127`;
  const deviceIds = {};
  // Times the standby had verified the primary directly when the router went
  // in - it may have, at boot.
  let verifiedBeforeRedirect = 0;
  // The standby's last event before it was installed.
  let standbyInstalledFrom = 0;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          peerIdentityMisroutedTtlMs: MISROUTED_TTL_MS,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await Promise.all([A, B, C].map(async (i) => { deviceIds[i] = await getDeviceId(env.clients[i]); }));
    expect(new Set(Object.values(deviceIds)).size, 'three daemons, three identities').to.equal(3);

    // The router is in place before the standby ever asks about its primary, as it
    // was on the node this reproduces.
    verifiedBeforeRedirect = await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'verified');
    redirectRules = await redirectOutbound(env.clients[A].container, {
      toIps: [env.clients[B].ip],
      ports: FLUX_PORTS,
      landsOn: env.clients[C].ip,
    });

    await resetFdm();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    // The primary first, holding the world.
    await electMaster(appName, env.clients[B].ip);
    const primaryAfter = env.clients[B].getLastEventId();
    await installOnNodes(env, app, [B]);
    await waitForReconcileActuated(env.clients[B], identifier, 'dataCleared', 120000, { afterId: primaryAfter });
    await seedSyncScopedData(env, appName, B);
    await waitForUp(env.clients[B], appName, 'the primary is running', { timeout: 180000, interval: 3000 });

    // Then the standby.
    standbyInstalledFrom = env.clients[A].getLastEventId();
    await installOnNodes(env, app, [A]);
    await waitForReconcileActuated(env.clients[A], identifier, 'dataCleared', 120000, { afterId: standbyInstalledFrom });
  });

  after(async function () {
    this.timeout(60000);
    if (env && redirectRules.length) await clearOutboundRedirect(env.clients[A].container, redirectRules).catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('finds its calls to the primary answered by the other node', async function () {
    this.timeout(240000);
    // The canary for every assertion below: the standby did ask who is at the
    // primary's address, and learned it was someone else.
    await waitFor(
      async () => (await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'misrouted')) > 0,
      { timeout: 180000, interval: 3000, label: 'the standby asked who answers at the primary\'s address' },
    );
  });

  it('configures no device for the primary under the other node\'s identity', async function () {
    this.timeout(180000);
    // The device is written on a monitor pass, after the pass looks up where the
    // primary's device comes from, so HELD_PASSES lookups from here leave passes
    // that have written. None of them may take the answer the other node gave: the
    // primary's device comes from its signed identity, its introduction, or not
    // at all.
    const sources = () => deviceSources(env.clients[A], addr(B));
    const atStart = await sources();
    await waitFor(
      async () => total(await sources()) >= total(atStart) + HELD_PASSES,
      { timeout: 120000, interval: 2000, label: `${HELD_PASSES} lookups of the primary's device on the standby` },
    );
    const looked = await sources();
    expect(looked.unsigned - atStart.unsigned, 'the standby took an unsigned answer for the primary\'s device').to.equal(0);
    expect(looked.held - atStart.held, 'the standby kept a device it could not prove for the primary').to.equal(0);
    const devices = await getConfiguredDevices(env.clients[A]);
    expect(devices.map((d) => d.deviceID), 'the other node\'s device was configured on the standby')
      .to.not.include(deviceIds[C]);
    const folders = await getFolders(env.clients[A]);
    const standbyFolder = folders.find((f) => f.id === folder);
    expect(standbyFolder, 'the standby has the app\'s folder').to.not.equal(undefined);
    expect(standbyFolder.devices.map((d) => d.deviceID)).to.not.include(deviceIds[C]);
  });

  it('configures the primary\'s own device from its introduction, and receives its copy while still redirected', async function () {
    this.timeout(300000);
    await waitFor(
      async () => (await env.clients[A].getDecisionCount('peerIdentity:introduced', addr(B), 'accepted')) > 0,
      { timeout: 180000, interval: 3000, label: 'the primary introduced itself to the standby' },
    );
    await waitFor(async () => {
      const devices = await getConfiguredDevices(env.clients[A]);
      return devices.some((d) => d.name === addr(B) && d.deviceID === deviceIds[B]);
    }, { timeout: 180000, interval: 5000, label: 'the standby configured the primary\'s own device' });
    await waitFor(
      async () => (await listFolderFiles(env.clients[A], `${appDir(appName)}/appdata`)).split(' ').includes('seed-data'),
      { timeout: 240000, interval: 5000, label: 'the primary\'s data reached the standby through the primary\'s connection' },
    );
    // Still redirected: the data came in over the primary's connection, not the
    // standby's own call.
    expect(await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'verified'),
      'the standby reached the primary directly').to.equal(verifiedBeforeRedirect);
  });

  it('does not start the component on the other node\'s "not running" once FDM names no primary', async function () {
    this.timeout(300000);
    expect(await isUp(env.clients[B], appName), 'precondition: the primary is running').to.equal(true);
    // The standby has read the primary off FDM, so it knows which node it must not
    // start alongside once FDM goes quiet, and is ready, so the election reads it
    // as eligible to start.
    await waitForElectionDecisions(env.clients[A], identifier, 'primaryObserved', 1, { timeout: 60000 });
    await env.clients[A].waitForEvent('syncthing:folderReady', (d) => d.folder === folder, 60000,
      { afterId: standbyInstalledFrom });

    // Each pass with FDM quiet, the standby probes its previous primary and the
    // probe knows the answer was not the primary's. A standby that took "not
    // running" at its word would start on that pass instead - it is behind its
    // previous primary in the order, so it serves no stagger - or book a start.
    const decisions = () => Promise.all(['peerMisrouted', 'started', 'staggerBooked']
      .map((decision) => electionDecisionCount(env.clients[A], identifier, decision)));
    const atQuiet = await decisions();
    await clearMaster(appName);
    await waitForElectionDecisions(env.clients[A], identifier, 'peerMisrouted', HELD_PASSES,
      { from: atQuiet[0], timeout: 120000 });
    const settled = await decisions();
    expect(settled[1], 'the standby started a second writer').to.equal(atQuiet[1]);
    expect(settled[2], 'the standby queued to start a second writer').to.equal(atQuiet[2]);
    expect(await isUp(env.clients[A], appName), 'the standby is running the component').to.equal(false);
    expect(await isUp(env.clients[B], appName), 'the primary is still running').to.equal(true);

    await electMaster(appName, env.clients[B].ip);
  });

  it('removes a device configured for the primary under the other node\'s identity', async function () {
    this.timeout(180000);
    // What a node that took any answer at an address for that address's device
    // left behind, and what the node this reproduces carried for five days.
    await addDevice(env.clients[A], {
      deviceID: deviceIds[C],
      name: addr(B),
      address: `tcp://${env.clients[B].ip}:16129`,
    });
    expect((await getConfiguredDevices(env.clients[A])).map((d) => d.deviceID), 'precondition: the stale device is in place')
      .to.include(deviceIds[C]);

    await waitFor(
      async () => !(await getConfiguredDevices(env.clients[A])).some((d) => d.deviceID === deviceIds[C]),
      { timeout: 150000, interval: 3000, label: 'the standby dropped the device configured under the primary\'s name' },
    );
  });

  it('verifies the primary directly once its calls reach it again, and keeps its device', async function () {
    this.timeout(300000);
    await clearOutboundRedirect(env.clients[A].container, redirectRules);
    redirectRules = [];

    await waitFor(
      async () => (await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'verified')) > verifiedBeforeRedirect,
      { timeout: 240000, interval: 5000, label: 'the standby verified the primary directly' },
    );
    const devices = await getConfiguredDevices(env.clients[A]);
    expect(devices.filter((d) => d.name === addr(B)).map((d) => d.deviceID)).to.deep.equal([deviceIds[B]]);
    expect((await listFolderFiles(env.clients[A], `${appDir(appName)}/appdata`)).split(' ')).to.include('seed-data');
  });
});
