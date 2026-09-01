import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import {
  isDaemonUp, getDeviceId, getVersion, getConnectedDevices, listFolderFiles,
} from '../framework/syncthing-real.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The restore no longer tells the other instances to rebuild themselves; it
// relies on syncthing carrying the restored folder to them. Every other suite
// runs against the control-plane stub, which moves no files - so they can show
// that nothing was destroyed and cannot show that anything arrived. That is
// exactly the mechanism the fix depends on, so it is tested here against real
// daemons.
//
// Two nodes, each running its own syncthing from the image (pinned at build
// time - the harness supplies the binary rather than letting FluxOS fetch one),
// and a few hundred bytes of data. FluxOS configures the folders and devices
// itself, the same way it does on a node.

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;

describe('a restore reaches the other instances through syncthing', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2ereal${ts}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${appName}_${appName}`;

  let auth;

  before(async function () {
    this.timeout(600000);
    // Two instances is what the propagation needs, but two NODES cannot peer at
    // all: the discovery mesh is a ring needing 2*minOutgoing+1 nodes to close,
    // so at two each node is the other's forward AND backward target and the
    // direction-blind peerManager.has() refuses the second connection (4001).
    // Three is the floor for minOutgoing 1, and the app still installs on two of
    // them - the third exists so the ring can close, not to hold an instance.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    // nothing below means anything if the daemons are not actually up
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'r' });
    const nodes = [0, 1];
    const installAfters = nodes.map((i) => env.clients[i].getLastEventId());
    await installOnNodes(env, app, nodes);
    await Promise.all(nodes.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 120000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));

    auth = await authenticate(env.clients[0].url, appOwnerKey());
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('gives each node its own daemon, and they find each other', async function () {
    this.timeout(300000);
    const [a, b] = env.clients;

    const versions = await Promise.all([getVersion(a), getVersion(b)]);
    // the image pins this; a mismatch means the nodes are not running what the
    // build installed
    expect(versions[0], 'both nodes run the same syncthing').to.equal(versions[1]);

    const ids = await Promise.all([getDeviceId(a), getDeviceId(b)]);
    expect(ids[0], 'node 0 device id').to.have.length.greaterThan(0);
    // a shared identity is the failure mode of copying one config to every node:
    // the daemons never peer, and every sync assertion below would time out
    // without saying why
    expect(ids[0], 'the nodes must have distinct identities').to.not.equal(ids[1]);

    // FluxOS wires the devices from the app's locations, so this is its work,
    // not the harness's
    await waitFor(async () => (await getConnectedDevices(a)).includes(ids[1]), {
      timeout: 240000, interval: 5000, label: 'node 0 connected to node 1',
    });
  });

  it('carries a restore to the other instance without redeploying it', async function () {
    this.timeout(420000);
    const [a, b] = env.clients;

    // an archive holding one identifiable file, so its arrival on the peer is
    // unambiguous rather than inferred from a byte count
    const target = `${appDir(appName)}/backup/local/backup_${appName}.tar.gz`;
    const staged = await execInContainer(a.container,
      `rm -rf /tmp/stage && mkdir -p /tmp/stage && printf 'the-restored-world\\n' > /tmp/stage/world.sav `
      + `&& mkdir -p ${appDir(appName)}/backup/local && tar -czf ${target} -C /tmp/stage .`);
    expect(staged.exitCode, `staging failed: ${staged.output}`).to.equal(0);

    const peerBefore = await listFolderFiles(b, `${appDir(appName)}/appdata`);
    expect(peerBefore, 'the peer starts with the seeded data, not the restore').to.not.contain('world.sav');

    const body = await a.appendRestoreTask(
      appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
    );
    expect(body).to.match(/Finalizing/);

    // the restoring node took it
    await waitFor(async () => (await listFolderFiles(a, `${appDir(appName)}/appdata`)) === 'world.sav', {
      timeout: 180000, interval: 3000, label: 'restore applied on node 0',
    });

    // ...and the peer received it, through syncthing alone. Nothing asked it to
    // redeploy, and its volume was never touched.
    await waitFor(async () => {
      const content = await execInContainer(b.container, `cat ${appDir(appName)}/appdata/world.sav 2>/dev/null || echo missing`);
      return content.stdout.trim() === 'the-restored-world';
    }, { timeout: 300000, interval: 5000, label: 'restored file arrived on the peer' });
  });
});
