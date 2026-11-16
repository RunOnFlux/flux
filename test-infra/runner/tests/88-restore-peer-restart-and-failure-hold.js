import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, getAppContainerStatus, crashFluxos, releaseFluxos,
} from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  setSynced, resetSyncState, resetFolderWrites, getFolderWrites,
} from '../framework/syncthing-control.js';
import { waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// An r:/s: component runs on EVERY instance at once, so after a restore the
// peers' containers are holding the data that was just replaced underneath
// them. They need restarting, and that is all: the old code sent them
// /apps/redeploy/<app>/true, which removes the app directory and the backing
// volume before reinstalling. Restart and hard redeploy are indistinguishable
// from "the app came back", so the assertion is on what SURVIVED - the volume,
// the directory, and the container's own identity, which a recreate replaces.
//
// The second half is the failure path. Once appdata has made way for an archive
// the directory is neither copy, and that is not something the other instances
// should be given. The folder is demoted and the container held, so the peers
// heal it instead - and the elected role, where there is one, moves off on its
// own because a demoted folder is not electable. A component that does not sync
// has no peer to heal it from: it is held stopped by a record that outlives a
// FluxOS restart, until a restore succeeds or its owner starts it.

const subnet = getSubnetConfig();

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;
const volFile = (name) => `/mnt/appdata/flux${name}_${name}FLUXFSVOL`;

async function inspectField(client, name, field) {
  const r = await execInContainer(client.container,
    `docker inspect -f '{{${field}}}' flux${name}_${name} 2>/dev/null || echo none`);
  return r.stdout.trim();
}

async function pathExists(client, path) {
  const r = await execInContainer(client.container, `test -e "${path}" && echo yes || echo no`);
  return r.stdout.trim() === 'yes';
}

describe('a restore restarts the other instances and never rebuilds them', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2erpeer${ts}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${appName}_${appName}`;

  let auth;

  async function stageArchive(client) {
    const target = `${appDir(appName)}/backup/local/backup_${appName}.tar.gz`;
    const r = await execInContainer(client.container,
      `rm -rf /tmp/stage && mkdir -p /tmp/stage && printf 'restored\\n' > /tmp/stage/restored.txt `
      + `&& mkdir -p ${appDir(appName)}/backup/local && tar -czf ${target} -C /tmp/stage .`);
    expect(r.exitCode, `staging the archive failed: ${r.output}`).to.equal(0);
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();

    // r: runs on every instance, which is the shape that makes the peers' own
    // containers stale after a restore
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'r' });
    const nodes = [0, 1, 2];
    const installAfters = nodes.map((i) => env.clients[i].getLastEventId());
    await installOnNodes(env, app, nodes);
    await Promise.all(nodes.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 90000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all(nodes.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));

    // The fan-out walks the app's LOCATION records, not the local install
    // state, so that is what has to have converged before "the peers were told"
    // means anything - an empty location list makes the fan-out a no-op and
    // every assertion below pass for the wrong reason.
    await waitFor(async () => {
      const res = await env.clients[0].getAppLocations(appName);
      return (res?.data?.length ?? 0) >= nodes.length;
    }, { timeout: 240000, interval: 3000, label: `${nodes.length} location records on node 0` });
    await Promise.all(nodes.map((i) => waitFor(
      async () => (await inspectField(env.clients[i], appName, '.State.Running')) === 'true',
      { timeout: 120000, interval: 2000, label: `app running on node ${i}` },
    )));

    auth = await authenticate(env.clients[0].url, appOwnerKey());
  });

  afterTeardown(async function () {
    // the immutable bit is set by the failure test; clear it whatever happened
    await execInContainer(env.clients[0].container, `chattr -i ${appDir(appName)}/appdata 2>/dev/null || true`).catch(() => {});
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(30000);
    await resetFolderWrites();
  });

  it('restarts the peers containers and leaves their volumes and identities intact', async function () {
    this.timeout(420000);
    const peers = [env.clients[1], env.clients[2]];
    const before = await Promise.all(peers.map(async (p) => ({
      id: await inspectField(p, appName, '.Id'),
      startedAt: await inspectField(p, appName, '.State.StartedAt'),
    })));
    before.forEach((b, i) => {
      // without a container to compare, every assertion below holds vacuously
      expect(b.id, `peer ${i + 1} container id`).to.not.equal('none');
    });

    await stageArchive(env.clients[0]);
    const body = await env.clients[0].appendRestoreTask(
      appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
    );
    expect(body).to.match(/Finalizing/);

    // the peers were told something: their containers restarted
    await Promise.all(peers.map((p, i) => waitFor(
      async () => (await inspectField(p, appName, '.State.StartedAt')) !== before[i].startedAt,
      { timeout: 240000, interval: 3000, label: `peer ${i + 1} container restarted` },
    )));

    // ...and it was a restart, not a rebuild. A hard redeploy removes the app
    // directory and the FLUXFSVOL, and the container that comes back is a new
    // one with a new id
    for (const [i, p] of peers.entries()) {
      // eslint-disable-next-line no-await-in-loop
      expect(await inspectField(p, appName, '.Id'), `peer ${i + 1} container identity`).to.equal(before[i].id);
      // eslint-disable-next-line no-await-in-loop
      expect(await pathExists(p, volFile(appName)), `peer ${i + 1} FLUXFSVOL`).to.equal(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await pathExists(p, appDir(appName)), `peer ${i + 1} app directory`).to.equal(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await execInContainer(p.container, `cat ${appDir(appName)}/appdata/seed-data 2>/dev/null || echo missing`)
        .then((r) => r.stdout.trim()), `peer ${i + 1} data`).to.equal('seeded');
    }
  });

  it('holds a copy that is neither the old one nor the new one out of sync', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    await stageArchive(client);
    // Make clearing appdata fail the way a volume that has gone read-only under
    // an ext4 error does: the operation reports failure having possibly removed
    // some of it, so what is on disk can no longer be called either copy.
    const lock = await execInContainer(client.container, `chattr +i ${appDir(appName)}/appdata`);
    expect(lock.exitCode, `could not make appdata immutable: ${lock.output}`).to.equal(0);

    // the hold is applied during the restore, so the mark has to be taken
    // before it runs - waiting afterwards races the event and passes or fails
    // on timing rather than on behaviour
    const afterId = client.getLastEventId();
    let body;
    try {
      body = await client.appendRestoreTask(
        appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
      );
      expect(body).to.match(/could not clear/i);

      // demoted, so nothing of this copy is sent to the peers...
      await waitFor(async () => {
        const writes = await getFolderWrites(subnet.nodeIp(1));
        return writes.some((w) => w.method === 'patch' && w.body?.type === 'receiveonly' && w.id === folder);
      }, { timeout: 120000, interval: 2000, label: 'folder demoted to receiveonly' });

      // ...and held, so its container is not started on it either
      await waitForReconcilerDesiredChanged(client, identifier, 'stopped', 120000, { afterId });
    } finally {
      await execInContainer(client.container, `chattr -i ${appDir(appName)}/appdata 2>/dev/null || true`);
    }
  });

  it('holds a component that does not sync, whose restore did not finish, stopped across a FluxOS restart until its owner starts it', async function () {
    this.timeout(600000);
    const subject = 3;
    const client = env.clients[subject];
    const lone = `e2erlone${ts}`;
    const loneId = `${lone}_${lone}`;
    const isUp = async () => (await getAppContainerStatus(client.container, lone))?.status?.startsWith('Up') === true;
    const held = () => client.getDecisionCount('reconciler:held', loneId, 'restoreUnfinished');
    const startedSince = (mark) => client.getEventBuffer().filter((e) => e.id > mark
      && e.event === 'reconciler:actuated' && e.data?.identifier === loneId
      && ['started', 'recreated', 'restarted'].includes(e.data?.action));
    // the reconciler has decided about the component: held for the restore, or started
    const decidedSince = (mark, label) => waitFor(async () => (await held()) >= 1 || startedSince(mark).length > 0, {
      timeout: 300000, interval: 2000, label,
    });

    await installOnNodes(env, await buildSeedableApp({ name: lone, env, instances: 1 }), [subject]);
    await waitFor(isUp, { timeout: 120000, interval: 2000, label: `${lone} runs before the restore` });
    const dir = appDir(lone);
    const staged = await execInContainer(client.container,
      `printf old > ${dir}/appdata/old.txt && rm -rf /tmp/stage-${lone} && mkdir -p /tmp/stage-${lone} `
      + `&& printf restored > /tmp/stage-${lone}/restored.txt && mkdir -p ${dir}/backup/local `
      + `&& tar -czf ${dir}/backup/local/backup_${lone}.tar.gz -C /tmp/stage-${lone} .`);
    expect(staged.exitCode, `fixture: staging failed: ${staged.output}`).to.equal(0);
    const lock = await execInContainer(client.container, `chattr +i ${dir}/appdata`);
    expect(lock.exitCode, `fixture: could not make appdata immutable: ${lock.output}`).to.equal(0);

    try {
      const owner = await authenticate(client.url, appOwnerKey());
      const restored = client.getLastEventId();
      const body = await client.appendRestoreTask(lone, [{ component: lone, restore: true }], 'local', owner.zelidauth);
      expect(body, 'fixture: the restore did not fail at the clear').to.match(/could not clear/i);
      await decidedSince(restored, 'the reconciler decides about the component after the restore');
      expect(startedSince(restored), 'started on a half-replaced folder').to.deep.equal([]);

      // a FluxOS restart forgets everything held in memory
      const restarted = client.getLastEventId();
      await crashFluxos(client.container, { hold: true });
      await releaseFluxos(client.container);
      await decidedSince(restarted, 'after the restart, the reconciler decides about the component');
      expect(startedSince(restarted), 'started on a half-replaced folder after a restart').to.deep.equal([]);
      expect(await isUp(), 'the component runs after the restart').to.equal(false);
    } finally {
      await execInContainer(client.container, `chattr -i ${dir}/appdata 2>/dev/null || true`);
    }

    // the owner accepts the folder as it is
    const owner = await authenticate(client.url, appOwnerKey());
    const accepted = client.getLastEventId();
    await client.getAuthed(`/apps/appstart/${lone}`, owner.zelidauth);
    await client.waitForEvent('reconciler:actuated', (d) => d.identifier === loneId
      && ['started', 'recreated', 'restarted'].includes(d.action), 120000, { afterId: accepted });
  });
});
