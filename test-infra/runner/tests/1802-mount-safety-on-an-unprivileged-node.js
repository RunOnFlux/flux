import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import {
  setSyncState, setSynced, setSyncing, getSyncthingState, resetSyncState,
  injectSyncthingEvent,
} from '../framework/syncthing-control.js';
import {
  waitFor, waitForReconcilerDesiredChanged, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedSyncthingApp } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The mount-safety guard on a node whose FluxOS is not root.
//
// FluxOS is root on Arcane and the account the operator installed it under
// everywhere else, and syncthing is spawned with sudo either way. So on an
// unprivileged node the index describes a volume the node process itself can be
// refused: a container owns its mount point and chooses its mode - postgres holds
// PGDATA at 0700 on every start and refuses to run otherwise - while syncthing,
// as root, indexes every file in it.
//
// That is the whole of what this suite exists for. The phantom-index guard answers
// "the index claims files, does the disk hold them" by reading the disk, and a
// refused read is not an empty disk: acted on as one it demotes a healthy folder
// and stops a running app, on every unprivileged node holding such an app, at the
// first monitor pass after an upgrade. A node that cannot see a volume asks root,
// and only a definite answer moves the folder.
//
// Node 0 alone is unprivileged, so the fleet around it is the ordinary one and the
// difference under test is the node's own account.

const subnet = getSubnetConfig();

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

async function folderType(nodeIp, folderId) {
  const state = await getSyncthingState();
  const node = state.nodes.find((n) => n.ip === nodeIp);
  return node?.folders?.find((f) => f.id === folderId)?.type ?? null;
}

// The account the node's own FluxOS process holds, read off the process the
// entrypoint supervises rather than off the container, which stays root.
async function fluxosAccount(client) {
  const r = await execInContainer(client.container, 'sh -c \'ps -o user= -p "$(cat /tmp/fluxos.pid)"\'');
  return r.output.trim();
}

describe('mount safety decides on what a node can actually read', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const name = `e2eunpriv${Date.now()}`;
  const folder = appId(name);
  const identifier = `${name}_${name}`;
  const ip0 = subnet.nodeIp(1);

  // What a container that owns its data leaves behind: the mount point belongs to
  // the container's own uid and admits nobody else. Applied from the container,
  // which is root, because it is root's to do on a real node too - the app does it
  // from inside itself.
  const lockAppdataToTheContainer = async (client) => {
    const r = await execInContainer(client.container,
      `sh -c 'chown -R 999:999 ${appDir(name)}/appdata && chmod 700 ${appDir(name)}/appdata'`);
    expect(r.exitCode, `could not lock appdata: ${r.output}`).to.equal(0);
  };

  const claimsFilesOnDisk = () => setSyncState({
    ip: ip0, folder, state: 'idle', globalBytes: 100000, globalFiles: 12, inSyncBytes: 100000, receiveOnlyChangedFiles: 0,
  });

  // Steady state is never swept, so the verify runs when syncthing flags the folder.
  const flagFolder = () => injectSyncthingEvent({
    ip: ip0, type: 'FolderErrors', data: { folder, errors: [{ error: 'pull failed' }] },
  });

  const linesFor = (index) => env.nodeDiagnostics().find((n) => n.index === index)?.lines ?? [];
  const privilegedReads = (from) => linesFor(0).slice(from)
    .filter((line) => line.includes(`Run Cmd: sudo find ${appDir(name)}`)).length;

  before(async function () {
    this.timeout(600000);
    // Three nodes because the discovery mesh is a ring and needs 2*minOutgoing+1 to
    // close; the app lives on the unprivileged one.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      unprivilegedNodes: [0],
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await resetSyncState();

    await seedSyncthingApp(env, { name, mode: 'r', index: 0 });
    await setSynced({ ip: ip0, folder });
    await waitFor(async () => (await folderType(ip0, folder)) === 'sendreceive', { timeout: 90000, interval: 3000, label: `${folder} sendreceive` });
    await waitFor(() => isUp(env.clients[0], name), { timeout: 90000, interval: 2000, label: 'app running' });
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  // The premise, asserted rather than assumed: every test below is vacuous against a
  // FluxOS that turns out to be root, and it would pass exactly as well.
  it('runs FluxOS under an unprivileged account on the declared node only', async function () {
    this.timeout(60000);
    expect(await fluxosAccount(env.clients[0]), 'node 0 FluxOS account').to.equal('fluxuser');
    expect(await fluxosAccount(env.clients[1]), 'node 1 FluxOS account').to.equal('root');

    // and the account really is refused the volume, which is what the guard meets
    const asFluxos = await execInContainer(env.clients[0].container,
      `sh -c 'su fluxuser -s /bin/sh -c "ls ${appDir(name)}/appdata"'`);
    expect(asFluxos.exitCode, 'the FluxOS account must not be able to list appdata').to.not.equal(0);
  });

  it('leaves a folder alone when the data is there and the node is refused it', async function () {
    this.timeout(120000);
    const client = env.clients[0];
    await lockAppdataToTheContainer(client);
    const from = linesFor(0).length;
    await claimsFilesOnDisk();
    await flagFolder();

    await assertNoEvent(client, 'reconciler:desiredChanged', (d) => d.identifier === identifier && d.state === 'stopped', 20000);
    expect(await folderType(ip0, folder), 'folder stays writable').to.equal('sendreceive');
    expect(await isUp(client, name), 'app stays running').to.equal(true);
    // The verdict must have been ASKED of root, not inherited from a walk that found
    // nothing and shrugged: the two are the same outcome here and only this separates
    // them.
    expect(privilegedReads(from), 'the refused volume is read as root').to.be.greaterThan(0);
  });

  it('demotes the folder when root confirms the volume it cannot read is empty', async function () {
    this.timeout(120000);
    const client = env.clients[0];
    const afterId = client.getLastEventId();
    const wipe = await execInContainer(client.container,
      `sh -c 'find ${appDir(name)}/appdata -mindepth 1 -delete && chmod 700 ${appDir(name)}/appdata'`);
    expect(wipe.exitCode, `could not empty appdata: ${wipe.output}`).to.equal(0);
    const from = linesFor(0).length;
    await claimsFilesOnDisk();
    await flagFolder();

    await waitFor(async () => (await folderType(ip0, folder)) === 'receiveonly', { timeout: 60000, interval: 3000, label: 'folder demoted to receiveonly' });
    await waitForReconcilerDesiredChanged(client, identifier, 'stopped', 60000, { afterId });
    expect(privilegedReads(from), 'the refused volume is read as root').to.be.greaterThan(0);

    // park the folder mid-sync before asserting the stop: the stub's static "fully
    // synced" index would otherwise let the receiveonly machinery re-promote
    await setSyncing({ ip: ip0, folder, percent: 40 });
    await waitFor(async () => !(await isUp(client, name)), { timeout: 60000, interval: 2000, label: 'app container held (stopped)' });
  });
});
