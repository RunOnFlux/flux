import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The blast radius of a restore is the node it runs on.
//
// A restore used to delete appdata before it had the archive, and then send
// every other instance `/apps/redeploy/<app>/true` - a hard redeploy, which
// removes the app directory AND the backing FLUXFSVOL image. So an archive of
// one config file, restored on an instance that had never synced, destroyed a
// 35 GB world on the one node that did hold it. The restoring node's own copy
// was never the problem; the peers' was.
//
// This drives the real endpoint against real volumes on two nodes, so what it
// establishes is that the peer's data survives a restore - a valid one, a
// refused one, and one whose archive holds almost nothing.
//
// What it does NOT establish: the harness's syncthing is a control-plane stub
// that moves no files, so nothing here shows the restored data reaching the
// peer, or a demoted node being healed by it. Those need a real daemon. A green
// run means nothing was destroyed, not that anything propagated.

const subnet = getSubnetConfig();

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;

async function containerId(client, name) {
  const r = await execInContainer(client.container, `docker inspect -f '{{.Id}}' ${appId(name)} 2>/dev/null || echo none`);
  return r.stdout.trim();
}

async function pathExists(client, path) {
  const r = await execInContainer(client.container, `test -e "${path}" && echo yes || echo no`);
  return r.stdout.trim() === 'yes';
}

async function containerRunning(client, name) {
  const r = await execInContainer(client.container, `docker inspect -f '{{.State.Running}}' ${appId(name)} 2>/dev/null || echo false`);
  return r.stdout.trim() === 'true';
}

async function readMarker(client, name) {
  const r = await execInContainer(client.container, `cat ${appDir(name)}/appdata/marker.txt 2>/dev/null || echo missing`);
  return r.stdout.trim();
}

async function listAppdata(client, name) {
  const r = await execInContainer(client.container, `ls -A ${appDir(name)}/appdata 2>/dev/null | sort | tr '\\n' ' '`);
  return r.stdout.trim();
}

// Write an archive into the app's local backup directory, which is where a
// `type: local` restore reads it from.
async function stageArchive(client, name, { corrupt = false } = {}) {
  const target = `${appDir(name)}/backup/local/backup_${name}.tar.gz`;
  const cmd = corrupt
    ? `mkdir -p ${appDir(name)}/backup/local && head -c 4096 /dev/urandom > ${target} && ls -l ${target}`
    : `rm -rf /tmp/stage && mkdir -p /tmp/stage/Config && printf 'Difficulty=None\\n' > /tmp/stage/Config/settings.ini `
      + `&& mkdir -p ${appDir(name)}/backup/local && tar -czf ${target} -C /tmp/stage . && ls -l ${target}`;
  const r = await execInContainer(client.container, cmd);
  expect(r.exitCode, `staging the archive failed: ${r.output}`).to.equal(0);
  return target;
}

describe('a restore does not reach the other instances data', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2erestore${ts}`;
  const identifier = `${appName}_${appName}`;
  const folder = appId(appName);

  let auth;
  let peerContainerBefore;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();

    // the incident's shape: a g: app with two instances, one elected
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    await installOnNodes(env, app, [0, 1]);
    // real data on disk, and only after the sync layer's first-run reset has
    // cleared appdata - otherwise the phantom-index guard holds the app down
    await Promise.all([0, 1].map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all([0, 1].map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));

    // something identifiable in each copy, so "untouched" is checkable rather
    // than inferred from the directory still existing
    await Promise.all([0, 1].map((i) => execInContainer(
      env.clients[i].container,
      `printf 'node-${i}-world\\n' > ${appDir(appName)}/appdata/marker.txt`,
    )));

    await electMaster(appName, env.clients[0].ip);
    await waitForReconcilerDesiredChanged(env.clients[0], identifier, 'running', 90000);
    await waitFor(() => pathExists(env.clients[1], volFile(appName)), {
      timeout: 60000, interval: 2000, label: 'peer volume present before any restore',
    });

    auth = await authenticate(env.clients[0].url, appOwnerKey());
    peerContainerBefore = await containerId(env.clients[1], appName);
    // the peer's container is compared before and after; without one to compare
    // that assertion is 'none' against 'none' and holds however the restore behaves
    expect(peerContainerBefore, 'peer container id').to.not.equal('none');
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('refuses on an instance that is not the one holding the live copy', async function () {
    this.timeout(180000);
    // node 1 is the standby: its copy is the one the primary overwrites, so a
    // restore landing there reports success and is quietly undone
    const standby = env.clients[1];
    await stageArchive(standby, appName);
    const before = await listAppdata(standby, appName);

    const body = await standby.appendRestoreTask(
      appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
    );

    expect(body).to.match(/Refused/i);
    expect(await listAppdata(standby, appName)).to.equal(before);
    expect(await readMarker(standby, appName)).to.equal('node-1-world');
  });

  it('does not clear appdata for an archive it cannot read', async function () {
    this.timeout(180000);
    // the ordering the incident inverted: this archive is unreadable, and the
    // data it would have replaced has to still be there afterwards
    const primary = env.clients[0];
    await stageArchive(primary, appName, { corrupt: true });
    const before = await listAppdata(primary, appName);
    expect(before).to.contain('marker.txt');

    const body = await primary.appendRestoreTask(
      appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
    );

    expect(body).to.match(/unreadable|Refused/i);
    expect(await listAppdata(primary, appName)).to.equal(before);
    expect(await readMarker(primary, appName)).to.equal('node-0-world');
  });

  it('replaces the primary copy and leaves the peer entirely alone', async function () {
    this.timeout(300000);
    const primary = env.clients[0];
    const peer = env.clients[1];
    // one small file, the shape of the archive that caused the incident. It is
    // a valid archive and a legitimate thing to restore - the fix is not that
    // this is refused, it is that it costs the peer nothing
    await stageArchive(primary, appName);

    const body = await primary.appendRestoreTask(
      appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
    );
    expect(body).to.not.match(/Unauthorized/i);
    expect(body).to.match(/Finalizing/);

    // the restoring node took the archive
    await waitFor(async () => (await listAppdata(primary, appName)) === 'Config', {
      timeout: 120000, interval: 2000, label: 'primary appdata replaced by the archive',
    });
    expect(await readMarker(primary, appName)).to.equal('missing');

    // and the peer kept everything: its volume, its directory, its data, and
    // the very container it was running. A hard redeploy removes all four, so
    // these four are the assertion - deliberately outcomes on disk rather than
    // the absence of a request in a log, which is only as trustworthy as the
    // lookup behind it and reads as a pass when that lookup is wrong.
    expect(await pathExists(peer, volFile(appName)), 'peer FLUXFSVOL').to.equal(true);
    expect(await pathExists(peer, appDir(appName)), 'peer app directory').to.equal(true);
    expect(await readMarker(peer, appName)).to.equal('node-1-world');
    expect(await containerId(peer, appName)).to.equal(peerContainerBefore);
  });


  // Its own app on the shared fleet, rather than the one every test above uses.
  // A forced restore CLEARS the node it runs on, and those tests assert the
  // standby's copy is exactly what the fixture wrote there - sharing an app would
  // make this test's placement load-bearing, and nothing enforces placement. The
  // fleet is the expensive part and stays shared; a second app is cheap.
  describe('a restore on a node the election did not choose', () => {
    const ownName = `e2eelect${ts}`;
    const ownIdentifier = `${ownName}_${ownName}`;
    const ownFolder = appId(ownName);

    before(async function () {
      this.timeout(420000);
      await pushImage(ownName, 'v1');
      const app = await buildSeedableSyncthingApp({ name: ownName, mode: 'g' });
      const afters = [0, 1].map((i) => env.clients[i].getLastEventId());
      await installOnNodes(env, app, [0, 1]);
      await Promise.all([0, 1].map(async (i, k) => {
        await waitForReconcileActuated(env.clients[i], ownIdentifier, 'dataCleared', 60000, { afterId: afters[k] });
        await seedSyncScopedData(env, ownName, i);
      }));
      await Promise.all([0, 1].map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder: ownFolder })));
      // node 0 holds it, so node 1 is a standby the election has stopped - which
      // is the state a restore must not undo
      await electMaster(ownName, env.clients[0].ip);
      await waitForReconcilerDesiredChanged(env.clients[0], ownIdentifier, 'running', 90000);
    });

    // The restore ends by starting the app, and a bare app name fans out to every
    // component - so on a node the election did not choose it would start the
    // elected container while the primary runs elsewhere. The folders go back to
    // sendreceive a few lines before that start, so it would be writing into live
    // replicated storage at once: the two-writers case the backup path has always
    // refused to create.
    //
    // force is what makes this reachable without breaking anything else - it
    // skips the FDM check, and it means "I accept the risk to this data", not
    // "start a second writer". An unreachable FDM arrives at the same place.
    it('does not start the elected container', async function () {
      this.timeout(180000);
      const standby = env.clients[1];
      await stageArchive(standby, ownName);

      expect(
        await containerRunning(standby, ownName),
        'the standby must be down before the restore, or a stopped container after it proves nothing',
      ).to.equal(false);

      const body = await standby.appendRestoreTask(
        ownName, [{ component: ownName, restore: true }], 'local', auth.zelidauth, { force: true },
      );

      expect(body, 'force must get past the refusal, or the start is never reached').to.not.match(/Refused/i);

      // The start is the last thing the restore does, so the window to be wrong
      // is after it returns. Held open rather than sampled once.
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        expect(
          await containerRunning(standby, ownName),
          'the election owns this container, and it is not the primary here',
        ).to.equal(false);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 2000); });
      }
    });
  });
});
