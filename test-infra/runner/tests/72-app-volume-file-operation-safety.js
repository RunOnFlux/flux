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

    it('extracts an archive that carries a link, and the link lands as a link', async function () {
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

      expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');

      // A link among an app's own files is data its owner put there, and what
      // bounds a hostile one is the container the extraction runs in. What
      // answers the link left behind is the reader: the walks here lstat and
      // the downloads open with O_NOFOLLOW, so the name is never followed. Had
      // the extraction followed it instead, the volume would now hold the
      // host's file as an ordinary file of its own.
      expect(await isSymlink(node.container, `${root}/unpacked/escape`)).to.equal(true);
      const target = await inNode(`readlink ${root}/unpacked/escape`);
      expect(target.stdout.trim()).to.equal('/etc/passwd');
      expect(await treeOf(node.container, `${root}/unpacked`))
        .to.deep.equal(['./escape', './ordinary.txt']);
    });

    it('refuses to extract an archive carrying an entry that is not data', async function () {
      this.timeout(300000);
      // Where the line is drawn instead. A FIFO is not data: whatever opens one
      // without O_NONBLOCK waits for a writer that never comes, so one
      // published onto a volume is a reader that hangs. tar both carries and
      // recreates them, so an archive is all it takes.
      //
      // Built outside the volume so the archive is all that arrives on it, and
      // on the NODE - the executor's rootfs is read-only, so an archive built
      // there is never created and every "refused" is a missing source file.
      const built = await inNode(
        'rm -rf /tmp/nondata && mkdir -p /tmp/nondata && mkfifo /tmp/nondata/pipe'
        + ' && echo plain > /tmp/nondata/ordinary.txt'
        + ` && (cd /tmp/nondata && tar -czf ${root}/piped.tar.gz .) && rm -rf /tmp/nondata`,
      );
      expect(built.exitCode, built.output).to.equal(0);

      // FIXTURE: without the FIFO this is an archive of one plain file, and the
      // refusal below would be about something else entirely.
      const listing = await inNode(`tar -tvzf ${root}/piped.tar.gz`);
      expect(listing.stdout, 'FIXTURE: the archive does not actually carry a FIFO')
        .to.match(/^p.*pipe$/m);

      const { job } = await settle('/apps/extractobject', {
        appname: appName, component: appName, source: 'piped.tar.gz', destination: 'unpacked',
      });

      expect(job.status).to.equal('Failed');
      expect(await exists(node.container, `${root}/unpacked`)).to.equal(false);

      // And it names the entry, which is what an owner acts on: which of their
      // files did this. Matched on the entry rather than on the reason - the
      // wording belongs to the image, and the image is free to rewrite it.
      const said = JSON.stringify(job.error);
      expect(said, `the refusal does not name the entry: ${said}`).to.match(/pipe/);
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

      // The user is handed a reason, not a bare exit code: filling the volume,
      // a corrupt archive and one holding non-data are three problems with
      // three answers. A word like "bytes" is not asserted here because tar's
      // own out-of-space message carries it whether or not anything meaningful
      // did - the ceiling itself, refusing BEFORE the volume fills, is proven
      // precisely in flux-op's container suite, where max-bytes is set
      // independent of the disk; here the oversized payload meets the disk
      // first, and what this proves is the refusal and the cleanup.
      const said = JSON.stringify(job.error);
      expect(said, `only a bare exit code: ${said}`).to.not.match(/"detail":"File operation failed with exit code \d+"/);
    });
  });

  describe('boot recovery', () => {
    // What a restart has to put right, and how little that now is.
    //
    // A publish is one atomic exchange, so there is no state where the caller's
    // data is parked under a second name waiting to be placed back - which is
    // what the marker, the recorded identity and most of this block used to be
    // about. Whichever side of the exchange a crash lands on, the destination
    // holds something complete and the staging entry holds something
    // disposable, so the whole of recovery is: delete the staging entry.
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
      //
      // A negative control needs proof the sweep RAN: "still there" otherwise
      // only means "the sweep has not run yet". So a real staging directory is
      // planted beside the lookalike and waited on - once THAT is reclaimed the
      // sweep has demonstrably run, and the lookalike is asked about then.
      await seedVolumeTree(node.container, appName, { '.flux-op-backups/keep.txt': 'mine' });
      await inNode(`mkdir -p ${root}/.flux-op-${STAGING_UUID} && echo scratch > ${root}/.flux-op-${STAGING_UUID}/partial`);

      await restartFluxos(node.container);

      await waitFor(async () => !await exists(node.container, `${root}/.flux-op-${STAGING_UUID}`), {
        timeout: 60000, interval: 2000, label: 'the sweep has run (its own staging reclaimed)',
      });
      expect(await exists(node.container, `${root}/.flux-op-backups/keep.txt`), 'a lookalike folder was swept').to.equal(true);
    });

    it("leaves the application's own data alone across a restart", async function () {
      this.timeout(300000);
      // The sweep runs over the volume root on every boot, deleting what it
      // recognises. What it must not recognise is anything the app owner put
      // there - including entries named like the artefacts an older image left,
      // which nothing places or reads any more.
      await seedVolumeTree(node.container, appName, {
        'photos/holiday.jpg': 'irreplaceable',
        'notes.txt': 'mine',
      });
      await inNode(`mkdir -p ${root}/.flux-old-${OPERATION_UUID} && echo mine > ${root}/.flux-old-${OPERATION_UUID}/keep.txt`);
      // A real staging directory beside them, so the survival assertions below
      // are made AFTER the sweep has provably run rather than merely after the
      // node is back up - a node that mounts the volume before the sweep fires
      // would pass a premature check trivially.
      await inNode(`mkdir -p ${root}/.flux-op-${STAGING_UUID} && echo scratch > ${root}/.flux-op-${STAGING_UUID}/partial`);

      await restartFluxos(node.container);
      await waitFor(async () => !await exists(node.container, `${root}/.flux-op-${STAGING_UUID}`), {
        timeout: 60000, interval: 2000, label: 'the sweep has run (its own staging reclaimed)',
      });

      expect(await exists(node.container, `${root}/photos/holiday.jpg`)).to.equal(true);
      expect(
        await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}/keep.txt`),
        'the sweep acted on an artefact nothing writes any more',
      ).to.equal(true);
    });
  });
});
