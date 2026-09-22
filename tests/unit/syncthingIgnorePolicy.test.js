// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const sinon = require('sinon');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const log = require('../../ZelBack/src/lib/log');
const policy = require('../../ZelBack/src/services/appSystem/syncthingIgnorePolicy');

describe('syncthingIgnorePolicy tests', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('ensureStignoreCovers', () => {
  // One folder per test. A set that has been posted and does not come back is not
  // posted again, which is state about THAT folder - so tests sharing an id would be
  // handing each other a folder that has already had its attempt.
    let ID;
    let folderCounter = 0;
    const ok = (data) => ({ status: 'success', data });
    const err = (message) => ({ status: 'error', data: { message } });

    beforeEach(() => {
      folderCounter += 1;
      ID = `fluxcomp_app_${folderCounter}`;
    });

    it('posts the set the spec derives, whatever the folder currently reads', async () => {
    // syncthing owns .stignore and writes it atomically; FluxOS sets the patterns
    // through it rather than touching the file. What may leave this node is decided
    // by the specification, so the whole set is derived rather than merged into
    // what happens to be on the volume.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/backup'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('seeds every line when the folder has no ignores yet', async () => {
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: null }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('posts nothing when the folder already reads exactly the derived set', async () => {
    // Idempotent: a converged folder is neither rewritten nor rescanned, which
    // is what keeps this safe to run on every monitor pass.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.notCalled(set);
    });

    it('adds the directories the spec declared local', async () => {
    // An ml: subdir is excluded from replication by the same mechanism that keeps
    // /backup off the network, and comes from the same place: the spec.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: [] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID, ['game']);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*', '/game']);
    });

    it('posts nothing when the declared directories are already the whole set', async () => {
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*', '/game'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID, ['game']);

      sinon.assert.notCalled(set);
    });

    it('removes an exclusion the spec no longer declares', async () => {
    // A spec that drops an ml: mount is asking for that directory to replicate.
    // The derived set is built afresh every pass and never accumulates, so the
    // line goes with the mount rather than outliving it as a silent exclusion.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*', '/game'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID, []);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('removes a pattern it did not write', async () => {
    // Only what the spec derives survives a pass. Every node computes the set
    // from the same specification, so a line present on one node's volume is not
    // an input the others have.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/backup', 'cache/**'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('removes a negation that would otherwise answer for a policy line', async () => {
    // syncthing takes the FIRST pattern that matches, so a negation ahead of a
    // derived line answers in its place. It is not demoted below the derived set
    // - the derived set is the whole file, so it is not there at all.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['!/backup', '/backup', '/.flux-op', '/.flux-op-*'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('collapses a policy line the folder holds more than once', async () => {
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/backup', 'cache/**', '/backup'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('rewrites a folder that holds the right lines in the wrong order', async () => {
    // syncthing takes the FIRST pattern that matches, so the same lines in another
    // order are not the same policy and the comparison is order-sensitive.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/.flux-op', '/.flux-op-*', '/backup'] }));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnceWithExactly(set, ID, ['/backup', '/lost+found', '/.flux-op', '/.flux-op-*']);
    });

    it('logs and posts nothing when the read fails, rather than failing the pass', async () => {
    // Every syncthing call returns its outcome in-band and never throws, so a
    // missed status check would silently skip the converge - it is checked.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(err('syncthing restarting'));
      const set = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));
      const logError = sandbox.stub(log, 'error');

      await policy.ensureStignoreCovers(ID);

      sinon.assert.notCalled(set);
      sinon.assert.calledOnce(logError);
    });

    // syncthing stores each ignore line as it parses it, and a line it does not hand
    // back verbatim is one no write can ever settle. Posted every pass, that rewrites
    // the file and rescans the folder every 30 s for as long as the app exists.
    it('posts a set that does not come back once, not on every pass', async () => {
    // The folder answers with something other than what was written, for ever.
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/elsewhere'] }));
      const write = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));
      const logError = sandbox.stub(log, 'error');

      await policy.ensureStignoreCovers(ID);
      await policy.ensureStignoreCovers(ID);
      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnce(write);
      sinon.assert.calledOnce(logError);
    });

    // The bound is a window, not a life sentence. What a folder stores is syncthing's
    // to decide and a later version may decide differently, so a set is offered again
    // once the window is out - which is also what drops the record of a folder nothing
    // asks about any more, so an uninstalled app leaves nothing behind.
    it('offers the set again once the window is out', async () => {
      const clock = sandbox.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/elsewhere'] }));
      const write = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));
      sandbox.stub(log, 'error');

      await policy.ensureStignoreCovers(ID);
      await policy.ensureStignoreCovers(ID);
      sinon.assert.calledOnce(write);

      clock.tick(30 * 60 * 1000);
      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledTwice(write);
    });

    // The bound is on the SET, not on the folder: a specification that asks for
    // different lines is a different question and gets its own attempt.
    it('posts again when the spec asks for a different set', async () => {
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: ['/elsewhere'] }));
      const write = sandbox.stub(syncthingService, 'setFolderIgnores').resolves(ok({}));
      sandbox.stub(log, 'error');

      await policy.ensureStignoreCovers(ID, ['cache']);
      await policy.ensureStignoreCovers(ID, ['cache']);
      await policy.ensureStignoreCovers(ID, ['cache', 'scratch']);

      sinon.assert.calledTwice(write);
    });

    it('logs when the write fails, rather than failing the pass', async () => {
      sandbox.stub(syncthingService, 'getFolderIgnores').resolves(ok({ ignore: [] }));
      sandbox.stub(syncthingService, 'setFolderIgnores').resolves(err('folder paused'));
      const logError = sandbox.stub(log, 'error');

      await policy.ensureStignoreCovers(ID);

      sinon.assert.calledOnce(logError);
    });
  });
});
