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
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Where the archive comes from is a whole branch of the restore that nothing
// exercised: every other restore suite passes `local`, so the archive is already
// on the node and no download happens at all. The incident's restore was
// `remote` - an IPFS URL - and every FluxDrive restore is, so the path that
// actually destroyed a customer's data was the one with no coverage.
//
// A `remote` restore also owns three checks nothing else reaches: the download
// itself, the comparison of what arrived against the content-length that was
// promised, and the removal of the archive afterwards - which happens only for
// remote, because only then is the copy ours to delete.
//
// One node, one component, `r:` mode: the election and the peer fan-out are
// suites 86 and 88, and none of that is what decides where an archive is read
// from.

const subnet = getSubnetConfig();

async function readFile(client, path) {
  const r = await execInContainer(client.container, `cat "${path}" 2>/dev/null || echo missing`);
  return r.stdout.trim();
}

async function exists(client, path) {
  const r = await execInContainer(client.container, `test -e "${path}" && echo yes || echo no`);
  return r.stdout.trim() === 'yes';
}

describe('a restore fetches its archive from where it was told', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2erem${ts}`;
  const comp = `${appName}c`;
  const folderId = `flux${comp}_${appName}`;
  const dir = `/mnt/appdata/flux-apps/${folderId}`;
  const remoteArchive = `${dir}/backup/remote/backup_${comp.toLowerCase()}.tar.gz`;
  const uploadArchive = `${dir}/backup/upload/backup_${comp.toLowerCase()}.tar.gz`;

  let auth;
  let nodeIp;
  let client;

  // Build a real tar.gz inside the node, then hand its bytes to the HTTP stub so
  // the node fetches them back over a real socket. Building it on the node keeps
  // the archive's tar flavour identical to one the node would have written.
  // `inflateBy` declares a content-length longer than the body without changing
  // what is sent, which is how a download that stops short is reproduced.
  async function publishArchive(name, marker, { inflateBy = 0 } = {}) {
    const r = await execInContainer(client.container,
      `rm -rf /tmp/pub && mkdir -p /tmp/pub && printf '${marker}\\n' > /tmp/pub/restored.txt `
      + '&& tar -czf - -C /tmp/pub . | base64 -w0');
    expect(r.exitCode, `building the archive failed: ${r.output}`).to.equal(0);
    const base64 = r.stdout.trim();
    expect(base64.length, 'archive bytes').to.be.greaterThan(0);
    const bytes = Buffer.from(base64, 'base64').length;
    const declaredLength = inflateBy ? bytes + inflateBy : null;
    const staged = await stageArtifact(name, base64, { declaredLength });
    expect(staged.ok, `staging the artifact failed: ${JSON.stringify(staged)}`).to.equal(true);
    return { bytes, declaredLength };
  }

  async function seedAppdata() {
    const r = await execInContainer(client.container,
      `rm -rf ${dir}/appdata/* && printf 'on-disk-original\\n' > ${dir}/appdata/marker.txt`);
    expect(r.exitCode, `seeding appdata failed: ${r.output}`).to.equal(0);
  }

  before(async function () {
    this.timeout(480000);
    // three is the smallest ring that closes at minOutgoing 1 - see suite 89
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

    const installAfter = client.getLastEventId();
    await installOnNodes(env, app, [0]);
    await waitForReconcileActuated(client, `${comp}_${appName}`, 'dataCleared', 90000, { afterId: installAfter });
    await setSynced({ ip: nodeIp, folder: folderId });

    auth = await authenticate(client.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(30000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('downloads the archive over http and replaces appdata with what arrived', async function () {
    this.timeout(300000);
    await seedAppdata();
    await publishArchive(`${appName}-good`, 'from-the-wire');

    const body = await client.appendRestoreTask(
      appName,
      [{ component: comp, restore: true, url: artifactUrl(`${appName}-good`) }],
      'remote',
      auth.zelidauth,
    );
    expect(body).to.not.match(/Unauthorized/i);
    expect(body).to.match(/Finalizing/);

    // Only a download that actually happened can put this content on disk: the
    // bytes existed nowhere on the node before the fetch.
    expect(await readFile(client, `${dir}/appdata/restored.txt`)).to.equal('from-the-wire');
    expect(await readFile(client, `${dir}/appdata/marker.txt`)).to.equal('missing');
  });

  it('removes the archive it downloaded, because that copy is its own', async function () {
    this.timeout(300000);
    await seedAppdata();
    await publishArchive(`${appName}-cleanup`, 'cleanup-run');

    await client.appendRestoreTask(
      appName,
      [{ component: comp, restore: true, url: artifactUrl(`${appName}-cleanup`) }],
      'remote',
      auth.zelidauth,
    );

    // the restore is what proves the download happened; the absence is only
    // meaningful alongside it
    expect(await readFile(client, `${dir}/appdata/restored.txt`)).to.equal('cleanup-run');
    expect(await exists(client, remoteArchive), 'downloaded archive left behind').to.equal(false);
  });

  it('refuses a download that stops short of what was promised, before clearing appdata', async function () {
    this.timeout(300000);
    await seedAppdata();
    // the header promises more than the body carries - what a dropped
    // connection, or an error page served as 200, looks like to a downloader
    await publishArchive(`${appName}-short`, 'never-lands', { inflateBy: 4096 });

    const body = await client.appendRestoreTask(
      appName,
      [{ component: comp, restore: true, url: artifactUrl(`${appName}-short`) }],
      'remote',
      auth.zelidauth,
    );

    // the transfer completes; what is refused is that it carried less than the
    // content-length promised
    expect(body).to.match(/incomplete/i);
    // the copy that was there is still there
    expect(await readFile(client, `${dir}/appdata/marker.txt`)).to.equal('on-disk-original');
    expect(await readFile(client, `${dir}/appdata/restored.txt`)).to.equal('missing');
  });

  it('restores an archive already on the node when the type is upload, and keeps it', async function () {
    this.timeout(300000);
    await seedAppdata();
    const r = await execInContainer(client.container,
      `rm -rf /tmp/up && mkdir -p /tmp/up && printf 'uploaded-copy\\n' > /tmp/up/restored.txt `
      + `&& mkdir -p ${dir}/backup/upload && tar -czf ${uploadArchive} -C /tmp/up .`);
    expect(r.exitCode, `staging the upload archive failed: ${r.output}`).to.equal(0);

    const body = await client.appendRestoreTask(
      appName,
      [{ component: comp, restore: true }],
      'upload',
      auth.zelidauth,
    );
    expect(body).to.match(/Finalizing/);

    expect(await readFile(client, `${dir}/appdata/restored.txt`)).to.equal('uploaded-copy');
    // an uploaded archive is the operator's copy, not ours to delete
    expect(await exists(client, uploadArchive), 'uploaded archive was removed').to.equal(true);
  });
});
