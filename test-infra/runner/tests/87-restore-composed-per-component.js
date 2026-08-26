import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import {
  setSynced, resetSyncState, resetFolderWrites, getPauseWrites, getFolderWrites,
} from '../framework/syncthing-control.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A composed app has one syncthing folder PER COMPONENT - flux<component>_<app>.
// The app name addresses none of them, so the restore's "stop syncthing for this
// app" step matched nothing and silently did nothing, for every v4+ app that has
// ever been restored. A restore also has to confine itself to the components it
// was asked for: the UI sends every component of the app on every request, with
// the unselected ones flagged false.
//
// Two synced components on one node, so what is asserted is purely which folder
// and which appdata each operation touched. Single instance and `r:` mode keep
// the election and the peer fan-out out of it - those are suites 86 and 88.

const subnet = getSubnetConfig();

async function readFile(client, path) {
  const r = await execInContainer(client.container, `cat "${path}" 2>/dev/null || echo missing`);
  return r.stdout.trim();
}

async function listDir(client, path) {
  const r = await execInContainer(client.container, `ls -A "${path}" 2>/dev/null | sort | tr '\\n' ' '`);
  return r.stdout.trim();
}

describe('a restore acts on the components it was asked for, by their own folders', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2ecomp${ts}`;
  const compA = `${appName}a`;
  const compB = `${appName}b`;

  const folderOf = (comp) => `flux${comp}_${appName}`;
  const dirOf = (comp) => `/mnt/appdata/flux-apps/${folderOf(comp)}`;
  const appLevelFolderId = `flux${appName}`;

  let auth;
  let nodeIp;

  // one small file, staged where a `type: local` restore reads it from
  async function stageArchive(comp) {
    const target = `${dirOf(comp)}/backup/local/backup_${comp.toLowerCase()}.tar.gz`;
    const r = await execInContainer(env.clients[0].container,
      `rm -rf /tmp/stage-${comp} && mkdir -p /tmp/stage-${comp} && printf 'restored\\n' > /tmp/stage-${comp}/restored.txt `
      + `&& mkdir -p ${dirOf(comp)}/backup/local && tar -czf ${target} -C /tmp/stage-${comp} .`);
    expect(r.exitCode, `staging ${comp} archive failed: ${r.output}`).to.equal(0);
  }

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    nodeIp = subnet.nodeIp(1);

    await pushImage(appName, 'v1');
    const component = (name, port) => ({
      name,
      description: 'r: sync component',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [port],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: 'r:/appdata',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    });
    const app = await buildSeedableApp({
      name: appName,
      compose: [component(compA, 31701), component(compB, 31702)],
    });

    const installAfter = env.clients[0].getLastEventId();
    await installOnNodes(env, app, [0]);
    // data goes down only after the sync layer's first-run reset has cleared
    // appdata, or the phantom-index guard holds the components down
    await Promise.all([compA, compB].map((comp) => waitForReconcileActuated(
      env.clients[0], `${comp}_${appName}`, 'dataCleared', 90000, { afterId: installAfter },
    )));
    for (const comp of [compA, compB]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await execInContainer(env.clients[0].container,
        `printf '%s-original\\n' ${comp} > ${dirOf(comp)}/appdata/marker.txt`);
      expect(r.exitCode, `seeding ${comp} failed: ${r.output}`).to.equal(0);
    }
    await Promise.all([compA, compB].map((comp) => setSynced({ ip: nodeIp, folder: folderOf(comp) })));

    auth = await authenticate(env.clients[0].url, appOwnerKey());
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(30000);
    // the monitor writes folder config continuously, so each test measures from
    // its own mark rather than from the start of the suite
    await resetFolderWrites();
  });

  it('restores one component without touching its sibling', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    await stageArchive(compA);

    const body = await client.appendRestoreTask(
      appName, [{ component: compA, restore: true }, { component: compB, restore: false }], 'local', auth.zelidauth,
    );
    expect(body).to.not.match(/Unauthorized/i);
    expect(body).to.match(/Finalizing/);

    // the asked-for component took the archive
    await waitFor(async () => (await listDir(client, `${dirOf(compA)}/appdata`)) === 'restored.txt', {
      timeout: 120000, interval: 2000, label: 'component A appdata replaced',
    });
    // the sibling is untouched - it was in the request, flagged false, exactly
    // as the UI sends it
    expect(await readFile(client, `${dirOf(compB)}/appdata/marker.txt`)).to.equal(`${compB}-original`);

    // and only its own folder was held still, by its own id
    const pauses = await getPauseWrites(nodeIp);
    expect(pauses).to.deep.equal([
      { id: folderOf(compA), paused: true },
      { id: folderOf(compA), paused: false },
    ]);
  });

  it('never addresses a folder by the app name, and never deletes one', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    await stageArchive(compA);

    await client.appendRestoreTask(
      appName, [{ component: compA, restore: true }], 'local', auth.zelidauth,
    );

    const writes = await getFolderWrites(nodeIp);
    // Every assertion below is an absence, and an empty log satisfies all of
    // them however the restore behaved - so establish first that this operation
    // wrote anything at all. Without this the test passed while the monitor was
    // deleting the folders out from under the restore.
    expect(writes.length, 'folder writes observed for this restore').to.be.greaterThan(0);
    // flux<app> is the id the old code went looking for; it matches no composed
    // app's folder, which is why the freeze silently never happened
    expect(writes.filter((w) => w.id === appLevelFolderId), 'writes to the app-level id').to.deep.equal([]);
    expect(writes.filter((w) => w.method === 'delete'), 'folder deletions').to.deep.equal([]);
  });

  it('holds both folders still when both components are restored', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    await stageArchive(compA);
    await stageArchive(compB);

    await client.appendRestoreTask(
      appName, [{ component: compA, restore: true }, { component: compB, restore: true }], 'local', auth.zelidauth,
    );

    const pauses = await getPauseWrites(nodeIp);
    expect(pauses.filter((p) => p.paused).map((p) => p.id).sort())
      .to.deep.equal([folderOf(compA), folderOf(compB)].sort());
    expect(pauses.filter((p) => !p.paused).map((p) => p.id).sort())
      .to.deep.equal([folderOf(compA), folderOf(compB)].sort());
    expect(await readFile(client, `${dirOf(compB)}/appdata/restored.txt`)).to.equal('restored');
  });

  it('refuses a component the app does not have, before anything is held or stopped', async function () {
    this.timeout(180000);
    const client = env.clients[0];
    const beforeA = await readFile(client, `${dirOf(compA)}/appdata/restored.txt`);

    const body = await client.appendRestoreTask(
      appName, [{ component: `${compA}; rm -rf /`, restore: true }], 'local', auth.zelidauth,
    );

    expect(body).to.match(/Refused/i);
    expect(await getPauseWrites(nodeIp), 'nothing was held still').to.deep.equal([]);
    expect(await readFile(client, `${dirOf(compA)}/appdata/restored.txt`)).to.equal(beforeA);
  });
});
