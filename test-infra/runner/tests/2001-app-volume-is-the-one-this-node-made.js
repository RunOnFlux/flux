import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus, restartFluxos } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A volume image is a file named after the app, and a filename is not proof of
// anything: any process that can write where FluxOS looks can leave one. What
// makes an image this node's is that this node made it - it chose the path and
// stamped the filesystem with a UUID of its own, and it keeps both.
//
// The unit suite can only show the flag was passed and the pair was stored.
// These run it against a real mke2fs, a real loop mount and a real restart:
//  - the filesystem carries the stamp, on the image actually written to disk
//  - a foreign filesystem left at that exact path is REFUSED, not mounted as
//    root over the app's directory
//  - and the genuine image still mounts across the same restart, so the
//    refusal above is a refusal and not a node that mounts nothing

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;

async function isMountpoint(container, dir) {
  const r = await execInContainer(container, `mountpoint -q ${dir}`);
  return r.exitCode === 0;
}

async function fsUuidOf(container, file) {
  const r = await execInContainer(container, `blkid -o value -s UUID ${file}`);
  return r.stdout.trim();
}

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

// A complete ext4 image that is NOT this node's: made the same way, so what
// distinguishes it is the stamp and nothing else.
async function makeForeignImage(container, at, marker) {
  await execInContainer(container, `fallocate -l 1G ${at}`);
  await execInContainer(container, `mke2fs -t ext4 ${at}`);
  await execInContainer(container, 'mkdir -p /tmp/foreignmnt');
  await execInContainer(container, `mount -o loop ${at} /tmp/foreignmnt`);
  await execInContainer(container, `sh -c 'echo ${marker} > /tmp/foreignmnt/${marker}'`);
  await execInContainer(container, 'umount /tmp/foreignmnt');
}

describe('an app volume is the image this node made, not the one under its name', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const name = `e2evolstamp${ts}`;
  const MARKER = 'ours.txt';
  const FOREIGN = 'theirs.txt';

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

    // keep the genuine image so the control below can put it back
    await execInContainer(container, `cp -a ${volFile(name)} /tmp/genuine.img`);
    // the running container holds the mount, so it goes first - a busy target
    // refuses the umount and the substitution below would then be testing
    // nothing
    await execInContainer(container, `docker stop ${appId(name)} >/dev/null 2>&1; umount -l ${appDir(name)} || true`);
    expect(await isMountpoint(container, appDir(name)), 'the volume did not unmount').to.equal(false);

    await execInContainer(container, `rm -f ${volFile(name)}`);
    await makeForeignImage(container, volFile(name), FOREIGN);
    const foreignStamp = await fsUuidOf(container, volFile(name));
    expect(foreignStamp, 'the substitute carries the same stamp, so this proves nothing').to.not.equal(stamp);

    await restartFluxos(env.clients[0]);

    // the boot pass reaches every installed component, so give it time to have
    // tried and then assert it did not take it
    await waitFor(async () => {
      const r = await execInContainer(container, `test -e ${appDir(name)}/${FOREIGN}`);
      return r.exitCode !== 0;
    }, 60000, 'the foreign filesystem became the app directory');

    expect(
      await isMountpoint(container, appDir(name)),
      'a filesystem this node did not make was mounted over the app directory',
    ).to.equal(false);
    expect(await isUp(env.clients[0], name), 'the app ran on a volume that is not its own').to.equal(false);
  });

  it('still mounts the genuine image across the same restart', async function () {
    this.timeout(180000);

    // the canary for the refusal above: without this, a node that mounts
    // nothing at all would pass that test
    await execInContainer(container, `rm -f ${volFile(name)}`);
    await execInContainer(container, `cp -a /tmp/genuine.img ${volFile(name)}`);
    expect(await fsUuidOf(container, volFile(name)), 'the restored image is not the one that was taken').to.equal(stamp);

    await restartFluxos(env.clients[0]);

    await waitFor(
      async () => isMountpoint(container, appDir(name)),
      120000,
      'the genuine image was never remounted',
    );
    const r = await execInContainer(container, `test -e ${appDir(name)}/${MARKER}`);
    expect(r.exitCode, "the app's own data did not come back with it").to.equal(0);
  });
});
