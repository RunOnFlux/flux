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

describe('app volume file operations - safety and recovery', function () {
  let env;
  let node;
  let auth;
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
          volumeOperations: { image: executorImageReference() },
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
        const listing = extension === 'zip'
          // eslint-disable-next-line no-await-in-loop
          ? await inNode(`unzip -l ${root}/archive.${extension}`)
          // eslint-disable-next-line no-await-in-loop
          : await inNode(`tar -tvzf ${root}/archive.${extension}`);
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
    });
  });

  describe('bounded output', () => {
    it('refuses an archive that expands past the volume, and leaves nothing behind', async function () {
      this.timeout(600000);
      // Built on the NODE, not inside the executor container - that one has a
      // read-only rootfs, so an archive built there is never created and every
      // "refused" is a missing source file.
      const build = await inNode(
        `mkdir -p ${root}/bomb && dd if=/dev/zero of=${root}/bomb/filler bs=1M count=1400 2>/dev/null`
        + ` && cd ${root}/bomb && tar -czf ${root}/bomb.tar.gz filler && rm -rf ${root}/bomb`,
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
        + ` && printf '%s' /etc/cron.d/pwn > ${root}/.flux-old-${OPERATION_UUID}.dest`,
      );
      const planted = await inNode(`cat ${root}/.flux-old-${OPERATION_UUID}.dest`);
      expect(planted.stdout.trim(), 'FIXTURE: the marker was not planted').to.equal('/etc/cron.d/pwn');
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
        + ` && printf '%s' photos > ${root}/.flux-old-${OPERATION_UUID}.dest`,
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
      await inNode(`printf '%s' photos > ${root}/.flux-old-${OPERATION_UUID}.dest`);

      await restartFluxos(node.container);

      await waitFor(async () => !await exists(node.container, `${root}/.flux-old-${OPERATION_UUID}.dest`), {
        timeout: 60000, interval: 2000, label: 'orphaned marker swept',
      });
    });
  });
});
