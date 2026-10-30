/*
 * A remote restore refuses an app volume whose backup folder, or the remote folder inside it, is a
 * link, before it removes or downloads anything: the volume's appdata stays as it was, and so does
 * the directory the link points at.
 *
 * The node runs the restore as root, and the volume is the app's to change: a link at backup or
 * backup/remote would send the download, and the archive's removal afterwards, wherever the app
 * pointed it. A restore through plain folders is the canary that the restore runs at all.
 *
 * One node holds the app, an r: component as suite 90's, so the archive is downloaded over a real
 * socket from the external HTTP stub.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { setSynced, resetSyncState } from '../framework/syncthing-control.js';
import { stageArtifact, artifactUrl } from '../framework/external-http-control.js';
import { waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import {
  volumeRoot, seedSymlink, contentOf, exists, isSymlink,
} from '../framework/volume-fixture.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

describe('a restore refuses a backup folder that is a link', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2erestlink${Date.now()}`;
  const root = volumeRoot(appName);
  // Outside the volume, on the node: where a link in the volume points.
  const outside = `/tmp/${appName}-outside`;

  let client;
  let auth;

  const run = async (command, what) => {
    const r = await execInContainer(client.container, command);
    expect(r.exitCode, `${what}: ${r.output}`).to.equal(0);
    return r.stdout;
  };
  // A real tar.gz built on the node, served by the HTTP stub at artifactUrl(name).
  const publishArchive = async (name, marker) => {
    const base64 = (await run(
      `rm -rf /tmp/pub && mkdir -p /tmp/pub && printf '${marker}\\n' > /tmp/pub/restored.txt && tar -czf - -C /tmp/pub . | base64 -w0`,
      'building the archive',
    )).trim();
    const staged = await stageArtifact(name, base64);
    expect(staged.ok, `staging ${name}: ${JSON.stringify(staged)}`).to.equal(true);
  };
  // appdata holding one file of its own, backup and backup/remote plain folders, and the outside
  // directory holding one file of its own.
  const resetVolume = async () => {
    await run(
      `rm -rf ${root}/backup ${outside} && mkdir -p ${root}/backup/remote ${outside} `
      + `&& rm -rf ${root}/appdata/* && printf 'on-disk-original\\n' > ${root}/appdata/marker.txt `
      + `&& printf 'outside-original\\n' > ${outside}/sentinel.txt`,
      'resetting the volume',
    );
  };
  const restore = (artifact) => client.appendRestoreTask(
    appName,
    [{ component: appName, restore: true, url: artifactUrl(artifact) }],
    'remote',
    auth.zelidauth,
  );
  const read = async (path) => (await contentOf(client.container, path)).trim();
  const outsideEntries = async () => (await run(`ls -A ${outside}`, 'listing the outside directory')).split('\n').filter(Boolean);
  const expectNothingChanged = async () => {
    expect(await read(`${root}/appdata/marker.txt`)).to.equal('on-disk-original');
    expect(await exists(client.container, `${root}/appdata/restored.txt`), 'the archive restored').to.equal(false);
    expect(await outsideEntries()).to.deep.equal(['sentinel.txt']);
    expect(await read(`${outside}/sentinel.txt`)).to.equal('outside-original');
  };

  before(async function () {
    this.timeout(480000);
    // three is the smallest ring that closes at minOutgoing 1 - see suite 89
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await resetSyncState();
    client = env.clients[0];

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
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
    const installAfter = client.getLastEventId();
    await installOnNodes(env, app, [0]);
    await waitForReconcileActuated(client, `${appName}_${appName}`, 'dataCleared', 90000, { afterId: installAfter });
    await setSynced({ ip: subnet.nodeIp(1), folder: `flux${appName}_${appName}` });

    auth = await authenticate(client.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('restores through plain backup folders', async function () {
    this.timeout(300000);
    await resetVolume();
    await publishArchive(`${appName}-plain`, 'from-the-wire');

    const body = await restore(`${appName}-plain`);

    expect(body).to.match(/Finalizing/);
    expect(await read(`${root}/appdata/restored.txt`)).to.equal('from-the-wire');
  });

  it('refuses a remote folder that is a link, and changes nothing on either side of it', async function () {
    this.timeout(300000);
    await resetVolume();
    await run(`rmdir ${root}/backup/remote`, 'removing the remote folder');
    await seedSymlink(client.container, appName, 'backup/remote', outside);
    await publishArchive(`${appName}-remote-link`, 'through-the-link');

    const body = await restore(`${appName}-remote-link`);

    expect(body).to.match(/Refused: backup\/remote in the volume is not a plain directory/);
    expect(await isSymlink(client.container, `${root}/backup/remote`), 'the link').to.equal(true);
    await expectNothingChanged();
  });

  it('refuses a backup folder that is a link, and changes nothing on either side of it', async function () {
    this.timeout(300000);
    await resetVolume();
    await run(`rm -rf ${root}/backup && mkdir -p ${outside}/remote`, 'removing the backup folder');
    await seedSymlink(client.container, appName, 'backup', outside);
    await publishArchive(`${appName}-backup-link`, 'through-the-link');

    const body = await restore(`${appName}-backup-link`);

    expect(body).to.match(/Refused: backup in the volume is not a plain directory/);
    expect(await read(`${root}/appdata/marker.txt`)).to.equal('on-disk-original');
    expect(await exists(client.container, `${root}/appdata/restored.txt`), 'the archive restored').to.equal(false);
    expect(await outsideEntries()).to.deep.equal(['remote', 'sentinel.txt']);
    expect((await run(`ls -A ${outside}/remote`, 'listing the remote folder behind the link')).trim()).to.equal('');
    expect(await read(`${outside}/sentinel.txt`)).to.equal('outside-original');
  });
});
