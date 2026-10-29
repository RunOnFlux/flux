// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { execInContainer } from '../framework/container.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import {
  waitFor, waitHolding, waitForReconcileActuated, waitForUp,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { isDaemonUp, listFolderFiles, getFolderConfig } from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node installing a g: app afresh clears the folder's local appdata before it
// takes any of the app's data: the folder syncthing is given is paused until the
// clear is done, and resumed by the pass after it. A file the primary holds then
// arrives once, onto a cleared disk, and stays.
//
// The clear is held open at its checkpoint for as long as syncthing takes to copy
// the primary's file, which is the order in which a copy that arrived first would
// be cleared with the rest - the disk empty under an index that still lists it.
//
// A = the node installing afresh; B = the primary, holding a file. The third node
// is a bystander the discovery ring needs.

const A = 0;
const B = 1;
const BEFORE_DATA_CLEAR = 'reconciler:beforeDataClear';
// Longer than real syncthing takes to copy a small file between connected peers.
const HELD_MS = 45000;
// How long the file is watched after it arrived.
const KEPT_MS = 60000;
const FILE = 'arrived-before-the-clear.txt';
const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}/appdata`;

describe('a fresh install takes no data until its folder is cleared', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eclearfirst${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  let app;
  const client = (i) => env.clients[i];
  const filesOn = async (i) => (await listFolderFiles(client(i), appDir(appName))).split(' ').filter((entry) => entry && !entry.startsWith('.'));

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await resetFdm();
    await pushImage(appName, 'v1');
    app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', instances: 2 });

    await electMaster(appName, client(B).ip);
    const primaryAfter = client(B).getLastEventId();
    await installOnNodes(env, app, [B]);
    await waitForReconcileActuated(client(B), identifier, 'dataCleared', 120000, { afterId: primaryAfter });
    await waitForUp(client(B), appName, 'the primary is running', { timeout: 180000, interval: 3000 });
    await waitFor(async () => (await client(B).getPromotedFolders())?.data?.folders?.includes(folder), {
      timeout: 120000, interval: 3000, label: 'the primary holds the writable copy',
    });
    await execInContainer(client(B).container, `echo held-by-the-primary > ${appDir(appName)}/${FILE}`);
  });

  after(async function () {
    this.timeout(60000);
    await client(A)?.releaseAllCheckpoints().catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('holds the folder paused, with nothing in it, while its clear is owed', async function () {
    this.timeout(600000);
    expect(await filesOn(B), 'fixture: the primary holds the file').to.include(FILE);

    const from = client(A).getLastEventId();
    await client(A).holdCheckpoint(BEFORE_DATA_CLEAR, identifier);
    await installOnNodes(env, app, [A]);
    await client(A).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_DATA_CLEAR && d.key === identifier, 300000, { afterId: from });

    // What arrives is the claim: a copy landing now is cleared with the rest.
    const heldFrom = Date.now();
    await waitHolding(async () => {
      expect(await filesOn(A), 'what reached the folder while its clear is owed').to.deep.equal([]);
      return Date.now() - heldFrom >= HELD_MS;
    }, { timeout: HELD_MS + 120000, interval: 2000, label: `the clear held for ${HELD_MS / 1000}s` });
    const config = await getFolderConfig(client(A), folder);
    expect(config, 'fixture: syncthing was given the folder').to.not.equal(null);
    expect(config.paused, 'the folder while its clear is owed').to.equal(true);
  });

  it('takes the primary\'s file once the clear is done, and keeps it', async function () {
    this.timeout(600000);
    const from = client(A).getLastEventId();
    await client(A).releaseCheckpoint(BEFORE_DATA_CLEAR, identifier);
    await waitForReconcileActuated(client(A), identifier, 'dataCleared', 120000, { afterId: from });

    await waitFor(async () => (await getFolderConfig(client(A), folder))?.paused === false
      && (await filesOn(A)).includes(FILE), {
      timeout: 180000, interval: 2000, label: 'the folder resumed and the primary\'s file arrived',
    });
    // it stays: nothing clears it after it arrived
    const arrivedAt = Date.now();
    await waitHolding(async () => {
      expect(await filesOn(A), 'the file on the node that installed afresh').to.include(FILE);
      return Date.now() - arrivedAt >= KEPT_MS;
    }, { timeout: KEPT_MS + 60000, interval: 5000, label: `the file kept for ${KEPT_MS / 1000}s` });
  });
});
