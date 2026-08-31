import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import {
  setSynced, setSyncing, setStatusUnreadable, setSyncState, resetSyncState,
} from '../framework/syncthing-control.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// This is the check that would have stopped the 2026-08-04 loss at its source.
//
// The archive that destroyed a customer's world was 373 bytes, taken from an
// instance that had never synced - a node whose syncthing was jammed, so the
// folder held nothing but a stub config file. Everything downstream of that
// archive is now covered by suites 86 to 92; the gate that stops such an archive
// EXISTING had unit tests and nothing end to end. Suite 44 drives a backup, but
// it tests the lease.
//
// The refusal must land before anything is stopped: refusing a backup must not
// cost a healthy app an outage. That is asserted here, not assumed.

const subnet = getSubnetConfig();

describe('a backup refuses to archive a copy that is not there', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2egate${ts}`;
  const comp = `${appName}c`;
  const folderId = `flux${comp}_${appName}`;
  const dir = `/mnt/appdata/flux-apps/${folderId}`;
  const archive = `${dir}/backup/local/backup_${comp.toLowerCase()}.tar.gz`;

  let auth;
  let client;
  let nodeIp;

  async function archiveExists() {
    const r = await execInContainer(client.container, `test -e "${archive}" && echo yes || echo no`);
    return r.stdout.trim() === 'yes';
  }

  async function containerUp() {
    const status = await getAppContainerStatus(client.container, appName);
    return Boolean(status && /up/i.test(status.status ?? ''));
  }

  before(async function () {
    this.timeout(480000);
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
    nodeIp = subnet.nodeIp(1);

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: comp,
        description: 'r: sync component',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: 'r:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    const after = client.getLastEventId();
    await installOnNodes(env, app, [0]);
    await waitForReconcileActuated(client, `${comp}_${appName}`, 'dataCleared', 120000, { afterId: after });
    await execInContainer(client.container, `printf 'the-real-world\\n' > ${dir}/appdata/marker.txt`);

    auth = await authenticate(client.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(60000);
    await execInContainer(client.container, `rm -f ${archive}`);
    await setSynced({ ip: nodeIp, folder: folderId });
    await waitFor(() => containerUp(), { timeout: 60000, interval: 2000, label: 'app running before the attempt' });
  });

  it('refuses when syncthing cannot answer, and says that rather than blaming the data', async function () {
    this.timeout(300000);
    // Syncthing answering with an error is a fact about syncthing, not about
    // the copy. Refusing is still right - an archive of a copy nobody verified
    // is the one that looks fine now and loses data when it is restored months
    // later - but reporting it as "this instance has never synced" tells the
    // operator something false about their data at the moment they are trying
    // to protect it, and force is API-only by design so they cannot get past it.
    await setStatusUnreadable({ ip: nodeIp, folder: folderId });

    const body = await client.appendBackupTask(appName, [comp], auth.zelidauth);

    expect(body).to.match(/Refusing to back up an incomplete copy/i);
    expect(body).to.match(/could not be determined/i);
    expect(body, 'an unanswerable daemon is not a claim about the data').to.not.match(/never synced/i);
    expect(await archiveExists(), 'an archive was written anyway').to.equal(false);
    // a refusal must not cost a healthy app an outage - the gate runs before
    // anything is stopped, and this is what says so
    expect(await containerUp(), 'the app was stopped by a refused backup').to.equal(true);
  });

  it('refuses an empty index without calling it 100% synced', async function () {
    this.timeout(300000);
    // The incident's own shape: syncthing holds nothing for this app, so this
    // instance has never received the data. With no global index there is
    // nothing for the synced bytes to be a fraction of, and the percentage
    // falls back to 100 - which would tell the operator the copy is complete in
    // the same breath as refusing it.
    await setSyncState({
      ip: nodeIp, folder: folderId, state: 'idle', globalBytes: 0, inSyncBytes: 0,
    });

    const body = await client.appendBackupTask(appName, [comp], auth.zelidauth);

    expect(body).to.match(/Refusing to back up an incomplete copy/i);
    expect(body).to.match(/nothing in the sync index yet/i);
    expect(body, 'never claims completeness while refusing').to.not.match(/100\.00% synced/);
    expect(await archiveExists(), 'an archive was written anyway').to.equal(false);
    expect(await containerUp(), 'the app was stopped by a refused backup').to.equal(true);
  });

  it('refuses a partially synced copy, naming how far it got', async function () {
    this.timeout(300000);
    await setSyncing({ ip: nodeIp, folder: folderId, percent: 40 });

    const body = await client.appendBackupTask(appName, [comp], auth.zelidauth);

    expect(body).to.match(/Refusing to back up an incomplete copy/i);
    // the operator is told what it actually had, not just that it said no
    expect(body).to.match(/40\.00% synced/);
    expect(await archiveExists()).to.equal(false);
    expect(await containerUp(), 'the app was stopped by a refused backup').to.equal(true);
  });

  it('archives a fully synced copy', async function () {
    this.timeout(300000);
    // the control: the gate is a gate, not a wall
    const body = await client.appendBackupTask(appName, [comp], auth.zelidauth);

    expect(body).to.not.match(/Refusing/i);
    await waitFor(() => archiveExists(), { timeout: 120000, interval: 2000, label: 'archive written' });
  });

  it('archives an incomplete copy when force says so, and says it did', async function () {
    this.timeout(300000);
    await setSyncing({ ip: nodeIp, folder: folderId, percent: 40 });

    const body = await client.appendBackupTask(appName, [comp], auth.zelidauth, { force: true });

    expect(body).to.not.match(/Refusing/i);
    // forced is not silent: the stream says the copy was incomplete
    expect(body).to.match(/WARNING: backing up an incomplete copy/i);
    await waitFor(() => archiveExists(), { timeout: 120000, interval: 2000, label: 'forced archive written' });
  });
});
