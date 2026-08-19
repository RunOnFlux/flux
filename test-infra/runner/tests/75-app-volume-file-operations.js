import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage, mirrorExecutorImage, executorImageReference } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForOperation } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  APP_UID, APP_GID, volumeRoot, resetVolume, seedVolumeTree, seedLargeFile,
  ownerOf, treeOf, contentOf, exists,
} from '../framework/volume-fixture.js';

// The contract of the four long file operations, over HTTP, against a real
// volume.
//
// This exists because two of these endpoints - move and rename - failed on
// EVERY call while every layer's unit tests were green: FluxOS asserted the
// argv it built, the image's tests always supplied a command, and the manual
// testing typed one by hand. Three layers of green over a seam nobody crossed.
// So everything here goes through the HTTP endpoint and then reads the volume,
// rather than asserting on anything either side hands the other.

describe('app volume file operations - the contract', function () {
  let env;
  let node;
  let auth;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2efileops${ts}`;
  const root = volumeRoot(appName);

  // The app owner, not the flux team: openVolume authorises at the OBJECT level
  // - is this caller the owner of THIS app - and buildSeedableApp sets the
  // owner from appOwnerKey.
  const post = (path, body) => node.request('POST', path, { body, headers: { zelidauth: auth.zelidauth } });
  const get = (path) => node.request('GET', path, { headers: { zelidauth: auth.zelidauth } });

  async function startAndSettle(path, body) {
    const accepted = await post(path, body);
    expect(accepted.status, `${path}: ${JSON.stringify(accepted.data)}`).to.equal(202);
    const job = await waitForOperation(node, accepted.data.data.jobId, auth.zelidauth);
    return { accepted, job };
  }

  async function succeed(path, body) {
    const { accepted, job } = await startAndSettle(path, body);
    expect(job.status, `${path} failed: ${job.error}`).to.equal('Succeeded');
    return { accepted, job };
  }

  before(async function () {
    this.timeout(600000);

    // The nodes are pointed at the harness registry, not the public one: each
    // runs its own dockerd on a per-run volume, so every suite starts with an
    // empty image store and would otherwise pull the same image once per node
    // per suite from a rate-limited anonymous endpoint.
    //
    // The reference is known up front, but the COPY has to wait for the fleet:
    // the registry it copies into is one of the containers createTestEnv starts.
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
        description: 'file operations',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31601],
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
    // Each test starts from a known tree owned by an ordinary application user.
    // Seeding as root would make the ownership assertions meaningless, because
    // a copy trivially "preserves" root whether the capability is there or not.
    await resetVolume(node.container, appName);
    await seedVolumeTree(node.container, appName, {
      'photos/a.txt': 'first',
      'photos/sub/b.txt': 'nested',
    });
  });

  describe('the 202 contract', () => {
    it('answers 202 with the headers a client follows, and polls to Succeeded', async function () {
      this.timeout(120000);
      const { accepted, job } = await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });

      const { jobId } = accepted.data.data;
      expect(accepted.headers.location).to.equal(`/apps/operations/${jobId}`);
      expect(accepted.headers['operation-id']).to.equal(jobId);
      expect(accepted.headers['retry-after']).to.equal('2');
      expect(accepted.data.data.status).to.equal('Running');
      expect(job.kind).to.equal('fileoperation.copy');
    });

    it('answers a poll with 200 whatever the job did, so completion is read from the body', async function () {
      this.timeout(120000);
      // A destination that is already taken is refused at the publish, inside
      // the container, rather than pre-checked here - the check and the move
      // are one operation, so nothing can occupy the name in between. That
      // makes the refusal the JOB's outcome and not the POST's: the call is
      // accepted like any other, and the failure arrives in the body of a 200.
      // A client that read completion from the status would call this a success.
      await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });

      const { job } = await startAndSettle('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });
      expect(job.status).to.equal('Failed');
      expect(JSON.stringify(job.error)).to.match(/already exists/i);
    });

    it('answers 404 for a job nobody here started', async function () {
      this.timeout(30000);
      const res = await get('/apps/operations/op_00000000-0000-4000-8000-000000000000');
      expect(res.status).to.equal(404);
    });
  });

  describe('copy', () => {
    it('copies the tree, its contents, and the ownership the app depends on', async function () {
      this.timeout(180000);
      await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });

      expect(await treeOf(node.container, `${root}/copied`)).to.deep.equal(
        await treeOf(node.container, `${root}/photos`),
      );
      expect(await contentOf(node.container, `${root}/copied/sub/b.txt`)).to.equal('nested');

      // The CAP_CHOWN regression, and it fails silently: cp -a cannot restore
      // ownership without it and exits 0 having written root-owned files, so an
      // app running as a non-root user loses access to its own data with
      // nothing logged.
      expect(await ownerOf(node.container, `${root}/copied/a.txt`)).to.equal(`${APP_UID}:${APP_GID}`);
      expect(await ownerOf(node.container, `${root}/copied/sub`)).to.equal(`${APP_UID}:${APP_GID}`);
    });

    it('arrives at its total rather than stopping wherever the last tick landed', async function () {
      this.timeout(300000);
      const size = await seedLargeFile(node.container, appName, 'bulk.bin', 64);

      const { job } = await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'bulk.bin', destination: 'bulk-copy.bin',
      });

      // A copy is the one operation with a real denominator: the capacity check
      // has already measured the source. Compression's ratio is not knowable in
      // advance, and an extraction's only candidate is the archive's own
      // account of itself, which is exactly what the size ceiling refuses to
      // believe.
      expect(job.detail.bytesTotal).to.equal(size);

      // Exactly the total, not merely close to it. The running figure comes off
      // a ticker, so on its own it stops at whichever walk finished last and a
      // completed copy reports something like 87% forever - the job says
      // Succeeded while the bytes say it did not finish.
      expect(job.detail.bytesDone, 'no byte figure was reported at all').to.be.a('number');
      expect(job.detail.bytesDone).to.equal(job.detail.bytesTotal);
    });

    it('reports a total and reaches it for a FOLDER, not just a single file', async function () {
      this.timeout(300000);
      // The folder case is the one that used to be measured by re-walking the
      // tree every two seconds. The running figure now comes from the
      // filesystem and the final one from what was published, so this asserts
      // the bar both moves and lands.
      const size = await seedLargeFile(node.container, appName, 'photos/big.bin', 48);

      const { job } = await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'copied',
      });

      expect(job.detail.bytesTotal).to.be.a('number');
      expect(job.detail.bytesTotal).to.be.at.least(size);
      expect(job.detail.bytesDone).to.equal(job.detail.bytesTotal);
    });

    it('leaves nothing behind when it refuses', async function () {
      this.timeout(120000);
      const res = await post('/apps/copyobject', {
        appname: appName, component: appName, source: 'photos', destination: 'photos/inside',
      });

      expect(res.status).to.not.equal(202);
      expect(JSON.stringify(res.data)).to.match(/inside the source/i);
      const leftovers = await treeOf(node.container, root);
      expect(leftovers.filter((p) => p.includes('.flux-op-'))).to.deep.equal([]);
    });
  });

  describe('move', () => {
    // The endpoint that never worked. flux-op takes its own arguments, then --,
    // then a command - and a move has NO command, because the source already IS
    // the result. FluxOS passed three positional arguments where the usage
    // check demanded four, so every call exited 2.
    it('moves the tree end to end, and the source is gone', async function () {
      this.timeout(180000);
      const before = await treeOf(node.container, `${root}/photos`);

      await succeed('/apps/moveobject', {
        appname: appName, component: appName, source: 'photos', destination: 'moved',
      });

      expect(await exists(node.container, `${root}/photos`)).to.equal(false);
      expect(await treeOf(node.container, `${root}/moved`)).to.deep.equal(before);
      expect(await contentOf(node.container, `${root}/moved/a.txt`)).to.equal('first');
      expect(await ownerOf(node.container, `${root}/moved/a.txt`)).to.equal(`${APP_UID}:${APP_GID}`);
    });

    it('relocates into a subdirectory, which rename cannot express', async function () {
      this.timeout(180000);
      await seedVolumeTree(node.container, appName, { 'archive/keep': 'x' });

      await succeed('/apps/moveobject', {
        appname: appName, component: appName, source: 'photos', destination: 'archive/photos',
      });

      expect(await exists(node.container, `${root}/archive/photos/a.txt`)).to.equal(true);
      expect(await exists(node.container, `${root}/photos`)).to.equal(false);
    });

    it('reports no byte figures, because its staging is whole from the first tick', async function () {
      this.timeout(180000);
      const { job } = await succeed('/apps/moveobject', {
        appname: appName, component: appName, source: 'photos', destination: 'moved',
      });

      // A move publishes its source where it stands - there is no growing
      // scratch to measure, so a figure here would be a total from the start
      // and would read as instant completion.
      expect(job.detail.bytesDone ?? null).to.equal(null);
      expect(job.detail.bytesTotal ?? null).to.equal(null);
    });
  });

  // The destructive direction. Findings 1, 2 and 4 all live on the overwrite
  // path, and until now it was covered nowhere end to end - only the refusal
  // was. This is where the v1.4.2 collision contract is proven over HTTP: a
  // file replaces a file, a directory MERGES rather than replacing wholesale,
  // a cross-kind collision is refused as EDESTRUCTIVE with nothing touched, and
  // the copy a replace displaced is reclaimed.
  describe('overwrite', () => {
    it('replaces a file with consent, and reclaims what it displaced', async function () {
      this.timeout(180000);
      await seedVolumeTree(node.container, appName, { 'newer.txt': 'new', 'older.txt': 'old' });

      await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'newer.txt', destination: 'older.txt', overwrite: true,
      });

      expect(await contentOf(node.container, `${root}/older.txt`)).to.equal('new');
      const leftovers = await treeOf(node.container, root);
      expect(leftovers.filter((p) => p.includes('.flux-op-')), 'the displaced copy was not reclaimed').to.deep.equal([]);
    });

    it('merges a directory rather than replacing it, keeping what the source did not name', async function () {
      this.timeout(180000);
      // The property that separates a merge from a wholesale replace: an entry
      // only the destination holds survives. A replace would delete it.
      await seedVolumeTree(node.container, appName, {
        'target/keep.txt': 'destination only',
        'target/shared.txt': 'destination copy',
        'incoming/shared.txt': 'source copy',
        'incoming/added.txt': 'source only',
      });

      await succeed('/apps/copyobject', {
        appname: appName, component: appName, source: 'incoming', destination: 'target', overwrite: true,
      });

      // kept, overwritten, added - the three outcomes a merge produces
      expect(await contentOf(node.container, `${root}/target/keep.txt`), 'a merge deleted what the source did not name').to.equal('destination only');
      expect(await contentOf(node.container, `${root}/target/shared.txt`)).to.equal('source copy');
      expect(await contentOf(node.container, `${root}/target/added.txt`)).to.equal('source only');
    });

    it('refuses a file over a directory even with consent, and touches neither', async function () {
      this.timeout(180000);
      // A file cannot stand in for a tree, and seating it there would delete the
      // tree. Refused as EDESTRUCTIVE - distinct from a name simply being taken -
      // with the destination intact and nothing staged left behind.
      await seedVolumeTree(node.container, appName, {
        'afile': 'i am a file',
        'adir/inside.txt': 'a whole tree',
      });

      const { job } = await startAndSettle('/apps/copyobject', {
        appname: appName, component: appName, source: 'afile', destination: 'adir', overwrite: true,
      });

      expect(job.status, JSON.stringify(job.error)).to.equal('Failed');
      expect(job.error.code).to.equal('EDESTRUCTIVE');
      expect(await contentOf(node.container, `${root}/adir/inside.txt`), 'the tree under the destination was disturbed').to.equal('a whole tree');
      expect(await exists(node.container, `${root}/afile`)).to.equal(true);
      const leftovers = await treeOf(node.container, root);
      expect(leftovers.filter((p) => p.includes('.flux-op-'))).to.deep.equal([]);
    });

    it('refuses a taken name without consent, as a name simply being taken', async function () {
      this.timeout(180000);
      await seedVolumeTree(node.container, appName, { 'wanted.txt': 'incoming', 'taken.txt': 'existing' });

      const { job } = await startAndSettle('/apps/copyobject', {
        appname: appName, component: appName, source: 'wanted.txt', destination: 'taken.txt',
      });

      expect(job.status, JSON.stringify(job.error)).to.equal('Failed');
      expect(job.error.code).to.equal('EEXIST');
      expect(await contentOf(node.container, `${root}/taken.txt`), 'a refused copy still overwrote').to.equal('existing');
    });
  });

  describe('rename', () => {
    // Migrated onto the executor on this branch and inherited the same
    // empty-command shape, so it failed on every call too. Still a GET, still
    // synchronous - it has real clients.
    it('renames in place', async function () {
      this.timeout(120000);
      const res = await get(`/apps/renameobject/${appName}/${appName}/photos/renamed`);

      expect(res.status, JSON.stringify(res.data)).to.equal(200);
      expect(res.data.status).to.equal('success');
      expect(await exists(node.container, `${root}/renamed/a.txt`)).to.equal(true);
      expect(await exists(node.container, `${root}/photos`)).to.equal(false);
    });
  });

  describe('compress and extract', () => {
    for (const [label, extension] of [['zip', 'zip'], ['tar.gz', 'tar.gz']]) {
      it(`round-trips a directory through ${label}, contents at the top`, async function () {
        this.timeout(300000);
        const before = await treeOf(node.container, `${root}/photos`);

        await succeed('/apps/compressobject', {
          appname: appName, component: appName, source: 'photos', destination: `backup.${extension}`,
        });
        expect(await exists(node.container, `${root}/backup.${extension}`)).to.equal(true);

        await succeed('/apps/extractobject', {
          appname: appName, component: appName, source: `backup.${extension}`, destination: 'restored',
        });

        // The archive holds the source's CONTENTS, so extracting it to a
        // destination reproduces the source under that name. Before the layout
        // fix, zip stored the whole absolute path minus its leading slash, so
        // this came back as restored/work/photos/...
        expect(await treeOf(node.container, `${root}/restored`)).to.deep.equal(before);
        expect(await contentOf(node.container, `${root}/restored/sub/b.txt`)).to.equal('nested');
      });

      it(`archives a single file as ${label}`, async function () {
        this.timeout(300000);
        // tar -C cannot be pointed at a non-directory, so this shape failed
        // outright for .tar.gz while the same request with .zip succeeded.
        await succeed('/apps/compressobject', {
          appname: appName, component: appName, source: 'photos/a.txt', destination: `one.${extension}`,
        });

        await succeed('/apps/extractobject', {
          appname: appName, component: appName, source: `one.${extension}`, destination: 'restored',
        });
        expect(await contentOf(node.container, `${root}/restored/a.txt`)).to.equal('first');
      });
    }

    it('archives a file whose name begins with a dash', async function () {
      this.timeout(300000);
      // A name the component rule permits - it rejects only the separators and
      // the control characters - and one both archivers read as an option when
      // it reaches them bare, refusing the request with a usage error the owner
      // cannot act on. Round-tripped rather than merely accepted, so the name
      // is shown to survive into the archive and back out of it.
      await seedVolumeTree(node.container, appName, { '-dashfile.txt': 'dashed' });

      await succeed('/apps/compressobject', {
        appname: appName, component: appName, source: '-dashfile.txt', destination: 'dashed.tar.gz',
      });

      await succeed('/apps/extractobject', {
        appname: appName, component: appName, source: 'dashed.tar.gz', destination: 'dashed-out',
      });
      expect(await contentOf(node.container, `${root}/dashed-out/-dashfile.txt`)).to.equal('dashed');
    });

    it('refuses an extension it cannot produce, before doing any work', async function () {
      this.timeout(60000);
      const res = await post('/apps/compressobject', {
        appname: appName, component: appName, source: 'photos', destination: 'backup.rar',
      });

      expect(res.status).to.not.equal(202);
      expect(JSON.stringify(res.data)).to.match(/must end in/i);
    });

    it('accepts an extension in capitals', async function () {
      this.timeout(300000);
      await succeed('/apps/compressobject', {
        appname: appName, component: appName, source: 'photos', destination: 'SHOUTY.ZIP',
      });
      expect(await exists(node.container, `${root}/SHOUTY.ZIP`)).to.equal(true);
    });
  });

  describe('the migrated endpoints are unchanged', () => {
    it('createfolder still errors on an existing folder, with no -p', async function () {
      this.timeout(60000);
      // The dashboard shows "folder already exists" off the back of this error.
      const res = await get(`/apps/createfolder/${appName}/${appName}/photos`);
      expect(JSON.stringify(res.data)).to.match(/error/i);
    });

    it('removeobject deletes an already-gone path as a success, idempotently', async function () {
      this.timeout(120000);
      // A delete is idempotent: rm -rf exits 0 on a path that is not there, so a
      // client retrying a delete after a timeout is told success, not "does not
      // exist" - the behaviour before this endpoint became a job.
      const res = await get(`/apps/removeobject/${appName}/${appName}/never-existed.txt`);
      expect(res.data.status, JSON.stringify(res.data)).to.equal('success');
    });

    it('refuses a caller who is not the app owner', async function () {
      this.timeout(60000);
      // openVolume authorises at the OBJECT level and throws an error carrying
      // the 401, so this reaches a client as the body errUnauthorizedMessage
      // has always produced. Existing callers read that shape.
      const res = await node.request('POST', '/apps/copyobject', {
        body: { appname: appName, component: appName, source: 'photos', destination: 'copied' },
      });
      expect(res.data.status).to.equal('error');
      expect(res.data.data.code).to.equal(401);
      expect(res.data.data.name).to.equal('Unauthorized');
    });
  });
});
