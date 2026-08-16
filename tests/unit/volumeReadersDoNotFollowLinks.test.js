const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const fileQueryService = require('../../ZelBack/src/services/appQuery/fileQueryService');
const IOUtils = require('../../ZelBack/src/services/IOUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

/**
 * A link on an app volume is content, and what keeps it from reaching off the
 * volume is that nothing here follows one.
 *
 * That is not a property of the file operation endpoints - an application has
 * its own volume mounted and can create a link in it at any time, with no
 * endpoint involved. So it is the READERS that have to hold, and these are the
 * ones that walk a volume on the host.
 *
 * Real symlinks in a real directory, deliberately. A stub can be given both stat
 * and lstat and answer either, so a test written against one proves which method
 * the code called only if the stub is written to care - and the failure it is
 * guarding against is exactly the one where the wrong method is used.
 */
describe('readers of an app volume do not follow links', () => {
  let volume;
  let outside;
  let secret;

  beforeEach(async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-outside-'));
    secret = path.join(outside, 'SECRET');
    // Long enough that a size read through the link cannot be mistaken for the
    // handful of bytes a link's own path measures.
    await fs.writeFile(secret, 'x'.repeat(65536));

    volume = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-volume-'));
    await fs.writeFile(path.join(volume, 'mine.txt'), 'mine');
    await fs.symlink(secret, path.join(volume, 'escape.tar.gz'));
    await fs.symlink(outside, path.join(volume, 'escape-dir'));
  });

  afterEach(async () => {
    sinon.restore();
    await fs.rm(volume, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('lists a link as a link, with its own size rather than its target', async () => {
    sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    sinon.stub(IOUtils, 'getVolumeInfo').resolves([{ mount: volume }]);

    const res = { json: sinon.stub() };
    await fileQueryService.getAppsFolder(
      { params: { appname: 'app', component: 'comp' }, query: {} },
      res,
    );

    const answer = res.json.firstCall.args[0];
    expect(answer.status).to.equal('success');

    const link = answer.data.find((entry) => entry.name === 'escape.tar.gz');
    expect(link.isSymbolicLink).to.equal(true);
    expect(link.isDirectory).to.equal(false);
    expect(link.size).to.be.below(1000);

    // And a linked DIRECTORY is not walked into for a size, which is the shape
    // that also never terminates when it points at its own parent.
    const linkedDirectory = answer.data.find((entry) => entry.name === 'escape-dir');
    expect(linkedDirectory.isDirectory).to.equal(false);
    expect(linkedDirectory.size).to.be.below(1000);
  });

  it('measures a folder without counting what its links point at', async () => {
    const measured = await IOUtils.getFolderSize(volume);

    // The 64KB behind the link is not in the figure; a few blocks for the real
    // entries are.
    expect(measured).to.be.below(65536);
  });

  it('lists backup files without reading through one', async () => {
    const listed = await IOUtils.getPathFileList(volume, 'B', 0, ['.tar.gz'], true);

    const link = listed.find((entry) => entry.name === 'escape.tar.gz');
    expect(link, 'the filtered listing should still contain the entry').to.not.equal(undefined);
    expect(link.size).to.be.below(1000);
  });
});
