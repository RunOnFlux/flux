import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Every other restore suite has somewhere for the data to come back from. This
// one does not: one instance, no peers.
//
// That matters because the failure path is written around healing. When an
// extraction fails with appdata already cleared, what is on disk is neither the
// old copy nor the new one, so the folder is demoted and the container is held
// and the peers put the node right. With a single instance nobody is coming.
// The hold still has to happen - partial data is partial whether or not anything
// can repair it, and a container started on it writes fresh state over the
// wreckage, which is how a world gets regenerated empty.
//
// The second case has no sync flag at all, so there is no folder to demote and
// no healing machinery in the picture. The container must still not be started
// on the half-written copy.

const subnet = getSubnetConfig();

describe('a restore with no peer to fall back on', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const syncedApp = `e2esolo${ts}`;
  const plainApp = `e2eplain${ts}`;

  const idOf = (app) => `${app}c_${app}`;
  const folderOf = (app) => `flux${app}c_${app}`;
  const dirOf = (app) => `/mnt/appdata/flux-apps/${folderOf(app)}`;

  let auth;
  let client;

  function component(app, port, containerData) {
    return {
      name: `${app}c`,
      description: 'single instance component',
      repotag: `${REGISTRY_REPO_HOST}/${app}:v1`,
      ports: [port],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData,
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    };
  }

  async function stageArchive(app) {
    const target = `${dirOf(app)}/backup/local/backup_${app.toLowerCase()}c.tar.gz`;
    const r = await execInContainer(client.container,
      `rm -rf /tmp/s-${app} && mkdir -p /tmp/s-${app} && printf 'restored\\n' > /tmp/s-${app}/restored.txt `
      + `&& mkdir -p ${dirOf(app)}/backup/local && tar -czf ${target} -C /tmp/s-${app} .`);
    expect(r.exitCode, `staging ${app} archive failed: ${r.output}`).to.equal(0);
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await resetSyncState();
    client = env.clients[0];

    for (const [app, port, data] of [[syncedApp, 31901, 'r:/appdata'], [plainApp, 31902, '/appdata']]) {
      // eslint-disable-next-line no-await-in-loop
      await pushImage(app, 'v1');
      // eslint-disable-next-line no-await-in-loop
      const spec = await buildSeedableApp({
        name: app,
        instances: 1,
        compose: [component(app, port, data)],
      });
      const after = client.getLastEventId();
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, spec, [0]);
      if (data.startsWith('r:')) {
        // the sync layer clears appdata on a clean install, and seeding before
        // that lands would have the seed wiped out from under the test
        // eslint-disable-next-line no-await-in-loop
        await waitForReconcileActuated(client, idOf(app), 'dataCleared', 120000, { afterId: after });
      } else {
        // A component with no sync flag never enters the syncthing clean-install
        // path, so it never emits dataCleared - waiting for it here waits for an
        // event that cannot arrive. Its container running is the readiness that
        // exists for this shape of app.
        // eslint-disable-next-line no-await-in-loop
        await waitFor(async () => {
          const status = await getAppContainerStatus(client.container, app);
          return Boolean(status && /up/i.test(status.status ?? ''));
        }, { timeout: 120000, interval: 3000, label: `${app} container running` });
      }
      // eslint-disable-next-line no-await-in-loop
      await execInContainer(client.container, `mkdir -p ${dirOf(app)}/appdata && printf 'original\\n' > ${dirOf(app)}/appdata/marker.txt`);
    }
    await setSynced({ ip: subnet.nodeIp(1), folder: folderOf(syncedApp) });

    auth = await authenticate(client.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(60000);
    for (const app of [syncedApp, plainApp]) {
      // eslint-disable-next-line no-await-in-loop
      await execInContainer(client.container, `chattr -i ${dirOf(app)}/appdata 2>/dev/null || true`).catch(() => {});
    }
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('holds the only copy there is, rather than starting on it', async function () {
    this.timeout(300000);
    await stageArchive(syncedApp);
    // the clear fails the way a volume gone read-only under an ext4 error does
    const lock = await execInContainer(client.container, `chattr +i ${dirOf(syncedApp)}/appdata`);
    expect(lock.exitCode, `could not make appdata immutable: ${lock.output}`).to.equal(0);

    const afterId = client.getLastEventId();
    try {
      const body = await client.appendRestoreTask(
        syncedApp, [{ component: `${syncedApp}c`, restore: true }], 'local', auth.zelidauth,
      );
      expect(body).to.match(/could not clear/i);

      // Held: with no peer able to answer for this copy, the container must not
      // be started on it on the strength of the restore having run.
      //
      // What is NOT asserted here is a demotion WRITE. changeSyncthingFolderType
      // issues nothing when the folder is already receiveonly, which it is on a
      // single instance that has never been promoted - so a write assertion
      // would be asserting that the folder had first been in the other state.
      // Suite 88 covers the write, from a folder that was sendreceive.
      await waitForReconcilerDesiredChanged(client, idOf(syncedApp), 'stopped', 120000, { afterId });
    } finally {
      await execInContainer(client.container, `chattr -i ${dirOf(syncedApp)}/appdata 2>/dev/null || true`);
    }
  });

  it('holds an unsynced component too, which has no folder and no healing at all', async function () {
    this.timeout(300000);
    await stageArchive(plainApp);
    const lock = await execInContainer(client.container, `chattr +i ${dirOf(plainApp)}/appdata`);
    expect(lock.exitCode, `could not make appdata immutable: ${lock.output}`).to.equal(0);

    const afterId = client.getLastEventId();
    try {
      const body = await client.appendRestoreTask(
        plainApp, [{ component: `${plainApp}c`, restore: true }], 'local', auth.zelidauth,
      );
      expect(body).to.match(/could not clear/i);

      // Nothing here syncs, so there is no folder to demote and nothing that
      // could ever repair the directory. The container must still be held: what
      // is on disk is not a copy anyone chose, and starting on it writes new
      // state over the wreckage.
      await waitForReconcilerDesiredChanged(client, idOf(plainApp), 'stopped', 120000, { afterId });
    } finally {
      await execInContainer(client.container, `chattr -i ${dirOf(plainApp)}/appdata 2>/dev/null || true`);
    }
  });
});
