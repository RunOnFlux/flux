import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A volume image is a file named after the app, and a filename is not proof of
// anything: any process that can write where FluxOS looks can leave one. What
// makes an image this node's is that this node made it - it chose the path and
// stamped the filesystem with a UUID of its own, and it keeps both.
//
// The unit suite can only show the flag was passed and the pair was stored.
// These run it against a real mke2fs, a real loop mount and the reconciler
// that is running on every node:
//  - the filesystem carries the stamp, on the image actually written to disk
//  - a foreign filesystem left at that exact path is REFUSED, not mounted as
//    root over the app's directory
//  - and the genuine image still mounts once it is put back, so the refusal
//    above is a refusal and not a node that mounts nothing

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;
// Beside the image, so moving it there is a rename and not a copy, and its
// name matches no FLUXFSVOL pattern so nothing searches it up.
const ASIDE = '/mnt/appdata/genuine-under-test.img';

async function isMountpoint(container, dir) {
  const r = await execInContainer(container, `mountpoint -q ${dir}`);
  return r.exitCode === 0;
}

// Cache disabled: blkid keys on the path, so a file replaced at a path it has
// already probed is answered with the previous file's UUID - which is exactly
// what this suite substitutes, reported as though nothing had changed.
async function fsUuidOf(container, file) {
  const r = await execInContainer(container, `blkid -c /dev/null -o value -s UUID ${file}`);
  return r.stdout.trim();
}

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('an app volume is the image this node made, not the one under its name', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const name = `e2evolstamp${ts}`;
  const MARKER = 'ours.txt';
  const identifier = `${name}_${name}`;

  let container;
  let stamp;

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);

    await pushImage(name, 'v1');
    const app = await buildSeedableApp({
      name,
      compose: [{
        name,
        description: 'test container',
        repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [0]);
    container = env.clients[0].container;

    // a file inside the app's own volume, so a swapped image is visible as the
    // absence of data rather than having to be inferred
    await execInContainer(container, `sh -c 'echo ours > ${appDir(name)}/${MARKER}'`);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('stamps the filesystem it creates, on the image that is actually on disk', async function () {
    this.timeout(60000);

    const r = await execInContainer(container, `test -f ${volFile(name)}`);
    expect(r.exitCode, 'the volume image is not where the install put it').to.equal(0);

    stamp = await fsUuidOf(container, volFile(name));
    // mke2fs without -U generates one too, so the assertion that matters is
    // that it is there to be compared against later, on a real filesystem
    expect(stamp, 'the image carries no filesystem UUID').to.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(await isMountpoint(container, appDir(name)), 'the app directory is not a mountpoint').to.equal(true);
  });

  it('refuses a foreign filesystem left at the image path, rather than mounting it', async function () {
    this.timeout(180000);

    // One command, because the reconciler is running: a volume that is
    // unmounted while its image is still genuine gets re-mounted by the
    // self-heal, and the substitution would then be testing nothing. The
    // broken state has to exist in full before the next pass looks.
    //
    // The genuine image is MOVED aside on the same filesystem rather than
    // copied: a rename cannot half-succeed, and the canary below has to put
    // back the same bytes that were taken, not a copy that may not have fitted.
    const afterId = env.clients[0].getLastEventId();
    const r = await execInContainer(container,
      `umount -l ${appDir(name)} && mv ${volFile(name)} ${ASIDE} && fallocate -l 1G ${volFile(name)}`
      + ` && mke2fs -t ext4 ${volFile(name)} >/dev/null 2>&1 && docker stop ${appId(name)} >/dev/null 2>&1`);
    expect(r.exitCode, `substitution failed: ${r.output}`).to.equal(0);
    // the aside copy is what the canary depends on, so it is checked here
    // rather than discovered to be wrong two assertions later
    expect(await fsUuidOf(container, ASIDE), 'the genuine image was not the file moved aside').to.equal(stamp);

    const substitute = await fsUuidOf(container, volFile(name));
    expect(substitute, 'the substitute carries the same stamp, so this proves nothing').to.not.equal(stamp);

    // the reconciler must report the volume unavailable and never start it
    await waitForReconcileActuated(env.clients[0], identifier, 'volumeUnavailable', 90000, { afterId });

    expect(
      await isMountpoint(container, appDir(name)),
      'a filesystem this node did not make was mounted over the app directory',
    ).to.equal(false);
    expect(await isUp(env.clients[0], name), 'the app ran on a volume that is not its own').to.equal(false);
  });

  it('still mounts the genuine image, so the refusal above is a refusal', async function () {
    this.timeout(180000);

    // the canary: without this, a node that mounts nothing at all would pass
    // the test above
    const r = await execInContainer(container, `rm -f ${volFile(name)} && mv ${ASIDE} ${volFile(name)}`);
    expect(r.exitCode, `restore failed: ${r.output}`).to.equal(0);
    expect(await fsUuidOf(container, volFile(name)), 'the restored image is not the one that was taken').to.equal(stamp);

    // the reconciler retries the mount on its own timer
    await waitFor(
      async () => isMountpoint(container, appDir(name)),
      120000,
      'the genuine image was never remounted',
    );
    const marker = await execInContainer(container, `test -e ${appDir(name)}/${MARKER}`);
    expect(marker.exitCode, "the app's own data did not come back with it").to.equal(0);
  });
});
