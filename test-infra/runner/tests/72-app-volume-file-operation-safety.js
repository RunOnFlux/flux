import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartFluxos } from '../framework/container.js';
import { pushImage, mirrorExecutorImage, executorImageReference } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForOperation } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  volumeRoot, resetVolume, seedVolumeTree, seedSymlink,
  isSymlink, treeOf, exists,
} from '../framework/volume-fixture.js';

// The properties that make these endpoints safe to expose to an app owner, and
// the boot-time recovery that decides whether their data survives a crash.
//
// Every fixture here asserts itself before the test acts on it. Two of this
// feature's security tests have already passed for the wrong reason - one built
// its archive inside a read-only container so no archive existed and every
// "refused" was a missing file, another used `tar -czhf` where -h dereferences,
// so the "symlink" in the archive was a regular file. Both read as clean
// passes. A security test that cannot fail is worse than no test.

const OPERATION_UUID = '11111111-2222-4333-8444-555555555555';
// A second one, for a case that needs an entry the sweep WILL act on beside an
// entry it must not touch.
const STAGING_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

/**
 * A marker as an image before v1.2.0 wrote one: where the entry belongs, then
 * the identity of the object the publish was placing.
 *
 * LEGACY by construction. A publish is one atomic exchange now, so nothing is
 * parked under a swap name and no marker is written - what these tests plant is
 * what a node may still find on a volume an older image touched, and what the
 * sweep has to keep doing about it.
 *
 * The identity line is kept because that is the shape on disk, not because
 * anything reads it: the sweep compared it to decide whether a publish had
 * completed, and that comparison was not sound - neither an inode number nor an
 * inode timestamp is unique - so it is gone and only the path is read.
 *
 * Fed to `printf '%b'` so the escape becomes a real newline in the file.
 */
const marker = (destination, identity = '1 1 btime') => `${destination}\\n${identity}\\n`;

describe('app volume file operations - safety and recovery', function () {
  let env;
  let node;
  let auth;
  let executorImage;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2efilesafe${ts}`;
  const root = volumeRoot(appName);

  const post = (path, body) => node.request('POST', path, { body, headers: { zelidauth: auth.zelidauth } });

  async function settle(path, body) {
    const accepted = await post(path, body);
    if (accepted.status !== 202) return { accepted, job: null };
    const job = await waitForOperation(node, accepted.data.data.jobId, auth.zelidauth);
    return { accepted, job };
  }

  async function inNode(command) {
    return execInContainer(node.container, command);
  }

  before(async function () {
    this.timeout(600000);
    // The reference is known up front; the COPY has to wait for the fleet,
    // because the registry it copies into is one of the containers
    // createTestEnv starts.
    executorImage = executorImageReference();
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        // A three-node fleet cannot reach the production peer floors: the
        // discovery mesh is a ring needing at least 2*minOutgoing+1 nodes to
        // close, so three can only carry minOutgoing 1. These suites exercise
        // one node's own volume, so the fleet exists to make that node a real
        // one rather than to be peered with.
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: { image: executorImage },
        },
      },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'file operation safety',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31701],
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

    node = env.clients[0];
    auth = await authenticate(node.url, appOwnerKey());
    await waitFor(async () => exists(node.container, root), {
      timeout: 60000, interval: 2000, label: 'app volume mounted',
    });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(60000);
    await resetVolume(node.container, appName);
  });

  describe('symlink containment', () => {
    it('copies a link as a link, so the host file it names is never read', async function () {
      this.timeout(180000);
      await seedVolumeTree(node.container, appName, { 'photos/ordinary.txt': 'plain' });
      // seedSymlink asserts this really IS a link and really points here.
      await seedSymlink(node.container, appName, 'photos/evil', '/etc/shadow');

      // The host's file must be readable from the node for the assertion below
      // to mean anything - if it did not exist, "the copy is not its contents"
      // would be true for the wrong reason.
      const shadow = await inNode('wc -c < /etc/shadow');
      expect(shadow.exitCode, 'the node has no /etc/shadow to protect').to.equal(0);
      const shadowBytes = parseInt(shadow.stdout.trim(), 10);
      expect(shadowBytes).to.be.greaterThan(0);

      const { job } = await settle('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });
      expect(job.status, job.error && JSON.stringify(job.error)).to.equal('Succeeded');

      // cp -a copies the LINK. If it had followed it, this would be a regular
      // file holding the host's shadow file.
      expect(await isSymlink(node.container, `${root}/copied/evil`)).to.equal(true);
      const copied = await inNode(`stat -c '%s' ${root}/copied/evil`);
      expect(parseInt(copied.stdout.trim(), 10)).to.equal('/etc/shadow'.length);
    });

    it('archives a link as a link, in both formats', async function () {
      this.timeout(300000);
      await seedVolumeTree(node.container, appName, { 'photos/ordinary.txt': 'plain' });
      await seedSymlink(node.container, appName, 'photos/evil', '/etc/shadow');

      for (const extension of ['zip', 'tar.gz']) {
        // eslint-disable-next-line no-await-in-loop
        const { job } = await settle('/apps/compressobject', {
          appname: appName, component: appName, source: 'photos', destination: `archive.${extension}`,
        });
        expect(job.status, `${extension}: ${JSON.stringify(job.error)}`).to.equal('Succeeded');

        // Read the archive's own listing. Info-ZIP without -y follows the link
        // and stores the CONTENTS of what it points at - which is how a link
        // the extract side would refuse becomes ordinary content it accepts.
        //
        // Listed with the executor image rather than with the node's own tools:
        // the node has tar but no unzip, and the image is the toolchain that
        // wrote the archive in the first place.
        // eslint-disable-next-line no-await-in-loop
        const listing = await inNode(
          `docker run --rm -v ${root}:/work --entrypoint sh ${executorImage} -c `
          + `"${extension === 'zip' ? `unzip -l /work/archive.${extension}` : `tar -tvzf /work/archive.${extension}`}"`,
        );
        expect(listing.exitCode, listing.output).to.equal(0);

        if (extension === 'tar.gz') {
          expect(listing.stdout, 'the archive holds a regular file where a link should be')
            .to.match(/lrwxrwxrwx.*evil/);
        } else {
          // zip's listing has no mode column; a stored link is the length of
          // its target, where a followed one is the size of /etc/shadow.
          expect(listing.stdout).to.match(new RegExp(`\\s${'/etc/shadow'.length}\\s.*evil`));
        }

        // The archive must not contain a path naming the container's own mount.
        expect(listing.stdout, 'the archive carries an internal mount path').to.not.match(/\bwork\/photos\b/);
        // eslint-disable-next-line no-await-in-loop
        await inNode(`rm -f ${root}/archive.${extension}`);
      }
    });

    it('survives a link pointing at its own parent, in the browser and in a copy', async function () {
      this.timeout(300000);
      // The regression that could take the node down. Measuring a folder used
      // to follow symlinks, so `ln -s .. loop` inside a volume measured itself
      // until the process died - reachable from a copy's capacity check AND
      // from the file browser, which sizes every directory it lists. Both run
      // as the FluxOS process before any container exists, so an app owner
      // could do it by opening their own file manager.
      await seedVolumeTree(node.container, appName, { 'photos/real.txt': 'content' });
      await seedSymlink(node.container, appName, 'photos/loop', '..');

      // The browser must LIST it, promptly, rather than walk forever.
      const listed = await node.request('GET', `/apps/getfolderinfo/${appName}/${appName}/photos`, {
        headers: { zelidauth: auth.zelidauth },
      });
      expect(listed.status).to.equal(200);
      const names = (listed.data.data ?? []).map((entry) => entry.name);
      expect(names, JSON.stringify(listed.data)).to.include.members(['real.txt', 'loop']);

      // And a copy of the same folder completes, carrying the link as a link.
      const { job } = await settle('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });
      expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
      expect(await isSymlink(node.container, `${root}/copied/loop`)).to.equal(true);
      expect(await treeOf(node.container, `${root}/copied`)).to.deep.equal(['./loop', './real.txt']);

      // FluxOS is still answering, which is the property the whole fix is about.
      const alive = await node.request('GET', '/flux/version');
      expect(alive.status).to.equal(200);
    });

    it('refuses to extract an archive that carries a link', async function () {
      this.timeout(300000);
      await seedVolumeTree(node.container, appName, { 'payload/ordinary.txt': 'plain' });
      await seedSymlink(node.container, appName, 'payload/escape', '/etc/passwd');

      // Built WITHOUT -h. With it, tar dereferences and the archive holds a
      // regular file - which is exactly how the first version of this test
      // passed while proving nothing.
      const built = await inNode(`cd ${root}/payload && tar -czf ${root}/linky.tar.gz .`);
      expect(built.exitCode, built.output).to.equal(0);

      const listing = await inNode(`tar -tvzf ${root}/linky.tar.gz`);
      expect(listing.stdout, 'FIXTURE: the archive does not actually carry a link')
        .to.match(/lrwxrwxrwx.*escape/);

      const { job } = await settle('/apps/extractobject', {
        appname: appName, component: appName, source: 'linky.tar.gz', destination: 'unpacked',
      });

      expect(job.status).to.equal('Failed');
      expect(await exists(node.container, `${root}/unpacked`)).to.equal(false);

      // And it SAYS so. Before the output was captured, this failure and a
      // corrupt archive and one too big for the volume were the same number.
      //
      // Matched on "ordinary" rather than on "link". The guard was widened and
      // renamed from --no-links to --ordinary-only, because it refuses anything
      // that is not a regular file or a directory - tar recreates FIFOs too, and
      // a flag named for links told the next reader something untrue. The
      // message moved with it, so matching "link" held the image to wording this
      // release deliberately changed, while the refusal itself was correct.
      const said = JSON.stringify(job.error);
      expect(said, `no reason given: ${said}`).to.match(/ordinary/i);
    });

    it('gives a different reason for a corrupt archive than for a refused one', async function () {
      this.timeout(300000);
      // The point of capturing the output: two failures a user must respond to
      // differently have to read differently.
      await inNode(`head -c 4096 /dev/urandom > ${root}/rubbish.tar.gz`);

      const { job } = await settle('/apps/extractobject', {
        appname: appName, component: appName, source: 'rubbish.tar.gz', destination: 'unpacked',
      });

      expect(job.status).to.equal('Failed');
      const said = JSON.stringify(job.error);
      expect(said, `no reason given: ${said}`).to.not.match(/^\{"title":"Error","detail":"File operation failed with exit code/);
      expect(said.length, 'the failure carries nothing but a code').to.be.greaterThan(60);
    });
  });

  describe('bounded output', () => {
    it('refuses an archive that expands past the volume, and leaves nothing behind', async function () {
      this.timeout(600000);
      // Built on the NODE, not inside the executor container - that one has a
      // read-only rootfs, so an archive built there is never created and every
      // "refused" is a missing source file.
      //
      // And built OUTSIDE the volume, because the whole point is that it does
      // not fit inside one: the app's volume is a 1 GB loop file, so staging
      // the uncompressed payload there fails before the test begins. Only the
      // finished archive is moved in, which is small.
      const build = await inNode(
        'rm -rf /tmp/bomb && mkdir -p /tmp/bomb'
        + ' && dd if=/dev/zero of=/tmp/bomb/filler bs=1M count=1400 2>/dev/null'
        + ` && (cd /tmp/bomb && tar -czf ${root}/bomb.tar.gz filler)`
        + ' && rm -rf /tmp/bomb',
      );
      expect(build.exitCode, build.output).to.equal(0);

      // FIXTURE: it must be small on disk and large on expansion, or it is not
      // a bomb and the refusal below would be about something else.
      const size = await inNode(`stat -c '%s' ${root}/bomb.tar.gz`);
      const compressed = parseInt(size.stdout.trim(), 10);
      expect(compressed).to.be.lessThan(50 * 1024 * 1024);

      const { job } = await settle('/apps/extractobject', {
        appname: appName, component: appName, source: 'bomb.tar.gz', destination: 'unpacked',
      });

      expect(job.status).to.equal('Failed');
      expect(await exists(node.container, `${root}/unpacked`)).to.equal(false);
      const leftovers = await treeOf(node.container, root);
      expect(leftovers.filter((p) => p.includes('.flux-op-')), 'staging was not reclaimed').to.deep.equal([]);

      // The user is told it was too big, not handed a number.
      const said = JSON.stringify(job.error);
      expect(said, `no reason given: ${said}`).to.match(/limit|bytes/i);
    });
  });

  describe('boot recovery', () => {
    it('does not follow a marker naming a path outside the volume', async function () {
      this.timeout(300000);
      // The D1 regression. The marker is written by flux-op from inside the
      // container, so it never describes a host path - but it lives where the
      // app owner can write, so its contents are input. Reading it as a host
      // path turned it into the destination of a root `mv` on the next restart.
      await inNode(
        `mkdir -p ${root}/.flux-old-${OPERATION_UUID}`
        + ` && echo displaced > ${root}/.flux-old-${OPERATION_UUID}/payload`
        + ` && printf '%b' "${marker('/etc/cron.d/pwn')}" > ${root}/.flux-old-${OPERATION_UUID}.dest`,
      );
      const planted = await inNode(`cat ${root}/.flux-old-${OPERATION_UUID}.dest`);
      expect(planted.stdout.split('\n')[0], 'FIXTURE: the marker was not planted').to.equal('/etc/cron.d/pwn');
      await inNode('rm -f /etc/cron.d/pwn');

      await restartFluxos(node.container);

      expect(await exists(node.container, '/etc/cron.d/pwn'), 'the boot sweep followed the marker').to.equal(false);
      // A marker that resolves to nothing is left in place rather than deleted:
      // it cannot be placed, and the entry beside it may be somebody's only copy.
      expect(await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}/payload`)).to.equal(true);
    });

    it('restores a displaced entry to the path its marker records', async function () {
      this.timeout(300000);
      await inNode(
        `mkdir -p ${root}/.flux-old-${OPERATION_UUID}`
        + ` && echo mine > ${root}/.flux-old-${OPERATION_UUID}/only-copy.txt`
        + ` && printf '%b' "${marker('photos')}" > ${root}/.flux-old-${OPERATION_UUID}.dest`,
      );
      expect(await exists(node.container, `${root}/photos`), 'FIXTURE: the destination already exists').to.equal(false);

      await restartFluxos(node.container);

      await waitFor(async () => exists(node.container, `${root}/photos/only-copy.txt`), {
        timeout: 60000, interval: 2000, label: 'displaced data restored to its recorded destination',
      });
      expect(await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}`)).to.equal(false);
      expect(await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}.dest`)).to.equal(false);
    });

    it('reclaims an abandoned staging directory', async function () {
      this.timeout(300000);
      await inNode(`mkdir -p ${root}/.flux-op-${OPERATION_UUID} && echo scratch > ${root}/.flux-op-${OPERATION_UUID}/partial`);

      await restartFluxos(node.container);

      await waitFor(async () => !await exists(node.container, `${root}/.flux-op-${OPERATION_UUID}`), {
        timeout: 60000, interval: 2000, label: 'abandoned staging reclaimed',
      });
    });

    it('leaves a folder whose name merely starts with a reserved prefix', async function () {
      this.timeout(300000);
      // Nothing reserves these prefixes at creation time, so `.flux-op-backups`
      // is a name a user can legitimately choose - and the sweep DELETES what it
      // matches. Matching by prefix alone made that folder vanish on every
      // restart.
      await seedVolumeTree(node.container, appName, { '.flux-op-backups/keep.txt': 'mine' });
      await inNode(`mkdir -p ${root}/.flux-old-notauuid && echo mine > ${root}/.flux-old-notauuid/keep.txt`);

      await restartFluxos(node.container);

      expect(await exists(node.container, `${root}/.flux-op-backups/keep.txt`)).to.equal(true);
      expect(await exists(node.container, `${root}/.flux-old-notauuid/keep.txt`)).to.equal(true);
    });

    it('sweeps a marker whose partner never arrived', async function () {
      this.timeout(300000);
      // An orphaned .dest was visited by nothing - the loop skipped it as a
      // marker and there was no directory to reach it from - so it accumulated
      // in the volume root, one per interruption, visible in the file browser.
      await inNode(`printf '%b' "${marker('photos')}" > ${root}/.flux-old-${OPERATION_UUID}.dest`);

      await restartFluxos(node.container);

      await waitFor(async () => !await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}.dest`), {
        timeout: 60000, interval: 2000, label: 'orphaned marker swept',
      });
    });

    // Restart, then wait for the sweep to have run before asking what it did.
    // restartFluxos returns when FluxOS answers HTTP, and the boot sweep is
    // still going then, so an assertion made at that point reads a sweep which
    // has not reached this entry and reports whatever it hoped for. A staging
    // directory is swept unconditionally, so its removal is the signal that the
    // sweep ran.
    const restartAndLetTheSweepFinish = async () => {
      await inNode(`mkdir -p ${root}/.flux-op-${STAGING_UUID}`);
      await restartFluxos(node.container);
      await waitFor(async () => !await exists(node.container, `${root}/.flux-op-${STAGING_UUID}`), {
        timeout: 60000, interval: 2000, label: 'boot sweep completed',
      });
    };

    // The same escape with the parked entry as a file and as a directory. flux-op
    // displaces whatever was at the destination, so both shapes occur, and `mv`
    // reaches the symlinked parent either way.
    [
      { shape: 'file', plant: `echo pwned > ${root}/.flux-old-${OPERATION_UUID}`, survivor: `${root}/.flux-old-${OPERATION_UUID}` },
      { shape: 'directory', plant: `mkdir -p ${root}/.flux-old-${OPERATION_UUID} && echo pwned > ${root}/.flux-old-${OPERATION_UUID}/payload`, survivor: `${root}/.flux-old-${OPERATION_UUID}/payload` },
    ].forEach(({ shape, plant, survivor }) => {
      it(`does not follow a marker whose parent directory is a link off the volume (${shape})`, async function () {
        this.timeout(300000);
        // Hostile in its RESOLUTION rather than its text: `appdata/escape/pwn`
        // normalises to a path inside the volume and passes every string rule.
        // `appdata/escape` is a link, which the app owner can make because
        // appdata is what its own container is bound at - and rename(2) follows
        // every component of a destination but the last.
        await inNode(`mkdir -p ${root}/appdata && rm -rf /etc/cron.d/pwn`);
        // seedSymlink asserts itself - it throws unless the link exists and
        // reads back as the target it was given.
        await seedSymlink(node.container, appName, 'appdata/escape', '/etc/cron.d');

        await inNode(`${plant} && printf '%b' "${marker('appdata/escape/pwn')}" > ${root}/.flux-old-${OPERATION_UUID}.dest`);
        const planted = await inNode(`cat ${root}/.flux-old-${OPERATION_UUID}.dest`);
        expect(planted.stdout.split('\n')[0], 'FIXTURE: the marker was not planted').to.equal('appdata/escape/pwn');

        await restartAndLetTheSweepFinish();

        expect(
          await exists(node.container, '/etc/cron.d/pwn'),
          'the boot sweep wrote through a link the app owner made',
        ).to.equal(false);
        // Refused, so the entry stays where it is: it may be somebody's only copy.
        expect(await exists(node.container, survivor)).to.equal(true);
      });
    });

    it('keeps displaced data when the destination is a link resolving to nothing', async function () {
      this.timeout(300000);
      // lstat succeeds on a broken link, so one at the destination is not
      // evidence the publish completed. It is equally what an app leaves at a
      // path nothing was ever published to, and one of those means the entry
      // beside it is the only copy.
      await seedSymlink(node.container, appName, 'photos', `${root}/no-such-target`);
      expect(
        await exists(node.container, `${root}/no-such-target`),
        'FIXTURE: the link resolves, so this is not the dangling case',
      ).to.equal(false);

      await inNode(
        `mkdir -p ${root}/.flux-old-${OPERATION_UUID}`
        + ` && echo mine > ${root}/.flux-old-${OPERATION_UUID}/only-copy.txt`
        + ` && printf '%b' "${marker('photos')}" > ${root}/.flux-old-${OPERATION_UUID}.dest`,
      );
      await restartAndLetTheSweepFinish();

      expect(
        await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}/only-copy.txt`),
        'the only copy of the data was deleted on the strength of a broken link',
      ).to.equal(true);
    });
  });
});
