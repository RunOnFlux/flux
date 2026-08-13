import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import crypto from 'node:crypto';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage, mirrorExecutorImage, executorImageReference } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { execInContainer } from '../framework/container.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  volumeRoot, resetVolume, seedVolumeTree, treeOf, contentOf, exists,
} from '../framework/volume-fixture.js';

// Uploading, over HTTP, onto a real volume.
//
// The bytes go from the request into a container that writes them, so they
// never touch the node's own filesystem. Everything here therefore checks the
// VOLUME after going through the endpoint, rather than anything either side
// hands the other - which is the seam that hid two dead endpoints in an earlier
// session.
//
// The cases that matter most are the ones where the upload does NOT succeed.
// A container that has stopped reading never drains its input and never errors,
// so a naive implementation hangs the request instead of answering it, and a
// truncated stream looks exactly like a complete one to the command receiving
// it. Both are covered here because both are silent.

describe('app volume file upload', function () {
  let env;
  let node;
  let auth;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2eupload${ts}`;
  const root = volumeRoot(appName);

  // The app owner, not the flux team: the endpoint authorises at the OBJECT
  // level - is this caller the owner of THIS app.
  // Headers rather than a credential, so a test can send NONE. Passing
  // undefined would fall back to the default and quietly authenticate.
  const uploadTo = (folder, files, headers = null) => node.upload(
    `/ioutils/fileupload/volume/${appName}/${appName}/${encodeURIComponent(folder)}`,
    files,
    headers ?? { zelidauth: auth.zelidauth },
  );

  // The endpoint answers 200 whatever happened and writes a failure into the
  // body, because the status line is gone long before anything can go wrong.
  const failureIn = (body) => {
    const marker = body.indexOf('"status":"error"');
    if (marker < 0) return null;
    const opened = body.lastIndexOf('{', marker);
    let depth = 0;
    for (let i = opened; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1;
      if (body[i] === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(body.slice(opened, i + 1));
      }
    }
    return null;
  };

  // Leave only `leaveMegabytes` free on the volume, so a modest upload exceeds
  // it. fallocate reserves the blocks without writing them, where generating
  // hundreds of megabytes of random data inside the container takes longer than
  // the test it is setting up.
  //
  // The figure is READ rather than assumed - how much of a 1 GB volume is
  // usable depends on the filesystem - and the result is checked, because a
  // fixture that quietly did not fill anything would make the refusal below
  // pass for the wrong reason.
  const fillVolumeLeaving = async (leaveMegabytes) => {
    const free = async () => {
      const { stdout } = await execInContainer(node.container, `df -Pm ${root} | awk 'NR==2 {print $4}'`);
      return parseInt(stdout.trim(), 10);
    };

    const before = await free();
    const fill = before - leaveMegabytes;
    expect(fill, `volume already has less than ${leaveMegabytes}MB free`).to.be.greaterThan(0);

    const { exitCode } = await execInContainer(node.container,
      `fallocate -l ${fill}M ${root}/filler.bin || dd if=/dev/zero of=${root}/filler.bin bs=1M count=${fill} 2>/dev/null`);
    expect(exitCode, 'could not fill the volume').to.equal(0);

    const after = await free();
    expect(after, `expected about ${leaveMegabytes}MB free, got ${after}MB`).to.be.below(leaveMegabytes + 20);
    return after;
  };

  const artefacts = async () => {
    const tree = await treeOf(node.container, root);
    return tree.filter((entry) => entry.includes('.flux-op-') || entry.includes('.flux-old-'));
  };

  const executorContainers = async () => {
    const { stdout } = await execInContainer(node.container,
      'docker ps -a --filter label=runonflux.role=fileop --format "{{.ID}}" 2>/dev/null || true');
    return stdout.trim().split('\n').filter(Boolean);
  };

  before(async function () {
    this.timeout(600000);

    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: {
            image: executorImageReference(),
            // Short enough that a trickle crosses it several times over, and
            // far longer than any other upload here takes.
            stallTimeoutMs: 6000,
            // Scaled with the window, the same way. The trickle below sends
            // ~160 bit/s, so it clears this five times over while still moving
            // no whole filesystem block - which is the condition the test is
            // here to put the executor in.
            minUploadBitsPerSecond: 32,
          },
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
        description: 'file upload',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31611],
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
    await seedVolumeTree(node.container, appName, { 'photos/a.txt': 'first' });
  });

  describe('what lands', () => {
    it('writes an uploaded file onto the volume', async function () {
      this.timeout(120000);
      const { status, body } = await uploadTo('photos', { 'notes.txt': 'uploaded content' });

      expect(status).to.equal(200);
      expect(failureIn(body), body).to.equal(null);
      expect(await contentOf(node.container, `${root}/photos/notes.txt`)).to.equal('uploaded content');
      expect(await artefacts()).to.deep.equal([]);
    });

    it('carries a file whose sender is slower than the stall window', async function () {
      this.timeout(180000);
      // The stall check reads what the volume has consumed, and an upload only
      // moves that once enough bytes have arrived to fill a filesystem block. A
      // client on a slow link sending a small file moves nothing measurable for
      // the whole window, and being stopped for it is indistinguishable from
      // being stopped for wedging.
      const contents = 'trickled through a window it never fills\n'.repeat(10);

      const { status, body } = await node.uploadSlowly(
        `/ioutils/fileupload/volume/${appName}/${appName}/${encodeURIComponent('photos')}`,
        { name: 'slow.txt', contents },
        { zelidauth: auth.zelidauth },
        // Twenty seconds of sending against a six second window.
        { pieces: 20, everyMs: 1000 },
      );

      expect(status).to.equal(200);
      expect(failureIn(body), body).to.equal(null);
      expect(await contentOf(node.container, `${root}/photos/slow.txt`)).to.equal(contents);
      expect(await artefacts()).to.deep.equal([]);
    });

    // One request carrying several files is one operation. A request per file
    // would be refused after the first, because an app runs one at a time.
    it('writes every file in a single request', async function () {
      this.timeout(180000);
      const { body } = await uploadTo('photos', {
        'one.txt': 'first file',
        'two.txt': 'second file',
        'three.txt': 'third file',
      });

      expect(failureIn(body), body).to.equal(null);
      expect(await contentOf(node.container, `${root}/photos/one.txt`)).to.equal('first file');
      expect(await contentOf(node.container, `${root}/photos/two.txt`)).to.equal('second file');
      expect(await contentOf(node.container, `${root}/photos/three.txt`)).to.equal('third file');
      expect(await artefacts()).to.deep.equal([]);
    });

    it('names each file after itself, so they do not overwrite each other', async function () {
      this.timeout(180000);
      await uploadTo('photos', { 'first.txt': 'A', 'second.txt': 'B' });

      const tree = await treeOf(node.container, `${root}/photos`);
      expect(tree.filter((entry) => entry.endsWith('.txt')).length).to.be.at.least(3);
    });

    it('replaces a file that is already there', async function () {
      this.timeout(120000);
      await uploadTo('photos', { 'a.txt': 'replaced' });

      expect(await contentOf(node.container, `${root}/photos/a.txt`)).to.equal('replaced');
      expect(await artefacts()).to.deep.equal([]);
    });

    it('creates the destination folder when it is not there', async function () {
      this.timeout(120000);
      const { body } = await uploadTo('brand/new/place', { 'notes.txt': 'made the folder' });

      expect(failureIn(body), body).to.equal(null);
      expect(await contentOf(node.container, `${root}/brand/new/place/notes.txt`)).to.equal('made the folder');
    });

    // Large enough that the transfer is not one buffer, and checked by digest
    // rather than by length - a stream that loses its ordering still has the
    // right number of bytes.
    it('carries a large file through intact', async function () {
      this.timeout(300000);
      const payload = crypto.randomBytes(24 * 1024 * 1024);
      const digest = crypto.createHash('sha256').update(payload).digest('hex');

      const { body } = await uploadTo('photos', { 'large.bin': payload });
      expect(failureIn(body), body).to.equal(null);

      const { stdout } = await execInContainer(node.container, `sha256sum '${root}/photos/large.bin'`);
      expect(stdout.trim().split(/\s+/)[0]).to.equal(digest);
    });
  });

  describe('what is refused', () => {
    it('refuses a caller who is not the app owner', async function () {
      this.timeout(120000);
      // No credentials at all. The flux team key would NOT do: the privilege
      // checked is "app owner or above", and the team is above.
      const { body } = await uploadTo('photos', { 'sneaky.txt': 'x' }, {});

      const failure = failureIn(body);
      expect(failure, body).to.not.equal(null);
      expect(failure.data.code).to.equal(401);
      expect(await exists(node.container, `${root}/photos/sneaky.txt`)).to.equal(false);
    });

    it('refuses a filename that tries to leave its folder', async function () {
      this.timeout(120000);
      const { body } = await uploadTo('photos', { '../../escaped.txt': 'x' });

      expect(failureIn(body), body).to.not.equal(null);
      expect(await exists(node.container, `${volumeRoot(appName)}/../escaped.txt`)).to.equal(false);
      expect(await artefacts()).to.deep.equal([]);
    });

    it('refuses a folder that tries to leave the volume', async function () {
      this.timeout(120000);
      const { body } = await uploadTo('../../../etc', { 'passwd.txt': 'x' });

      expect(failureIn(body), body).to.not.equal(null);
      expect(await artefacts()).to.deep.equal([]);
    });

    // The volume is 1 GB. An upload larger than it is refused AS IT ARRIVES
    // rather than after filling the volume, and - the part that hangs a naive
    // implementation - it is refused with an answer rather than a stall.
    it('refuses an upload larger than the volume, and answers rather than hanging', async function () {
      this.timeout(300000);
      await fillVolumeLeaving(20);

      const started = Date.now();
      const { status, body } = await uploadTo('photos', {
        'toobig.bin': Buffer.alloc(80 * 1024 * 1024, 0x41),
      });

      expect(status).to.equal(200);
      expect(failureIn(body), `expected a refusal, got: ${body.slice(0, 400)}`).to.not.equal(null);
      // A container that stops reading never drains its input and never errors.
      // Without racing the transfer against the container's exit this request
      // never comes back at all.
      expect(Date.now() - started, 'the refusal took long enough to look like a stall').to.be.below(240000);
      expect(await exists(node.container, `${root}/photos/toobig.bin`)).to.equal(false);
      expect(await artefacts()).to.deep.equal([]);
    });

    it('leaves the volume as it was when an upload is refused', async function () {
      this.timeout(300000);
      await fillVolumeLeaving(20);
      await uploadTo('photos', { 'toobig.bin': Buffer.alloc(80 * 1024 * 1024, 0x42) });

      expect(await contentOf(node.container, `${root}/photos/a.txt`)).to.equal('first');
      expect(await exists(node.container, `${root}/photos/toobig.bin`)).to.equal(false);
    });
  });

  describe('what it leaves behind', () => {
    it('leaves no executor container running after an upload', async function () {
      this.timeout(180000);
      const before = await executorContainers();
      await uploadTo('photos', { 'notes.txt': 'x' });

      await waitFor(async () => (await executorContainers()).length <= before.length, {
        timeout: 30000, interval: 1000, label: 'executor containers reaped',
      });
    });

    it('frees the app for the next operation once an upload is done', async function () {
      this.timeout(240000);
      await uploadTo('photos', { 'first-batch.txt': 'x' });

      // Would be refused with 503 if the slot the upload took were still held.
      const second = await uploadTo('photos', { 'second-batch.txt': 'y' });
      expect(failureIn(second.body), second.body).to.equal(null);
      expect(await contentOf(node.container, `${root}/photos/second-batch.txt`)).to.equal('y');
    });
  });
});
