const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('IOUtils checkFileExists', () => {
  const errorWithCode = (code) => Object.assign(new Error(code), { code });

  const load = (access) => {
    const log = { error: sinon.stub(), warn: sinon.stub(), info: sinon.stub() };
    const IOUtils = proxyquire('../../ZelBack/src/services/IOUtils', {
      fs: { promises: { access } },
      '../lib/log': log,
    });
    return { IOUtils, log };
  };

  it('answers true for a file that is there', async () => {
    const access = sinon.stub().resolves();
    const { IOUtils, log } = load(access);

    expect(await IOUtils.checkFileExists('/backup/local/backup_app.tar.gz')).to.equal(true);
    expect(access.calledOnceWith('/backup/local/backup_app.tar.gz'), 'the stub is actually wired in').to.equal(true);
    expect(log.error.called).to.equal(false);
  });

  it('answers false for an absent file without logging an error', async () => {
    const access = sinon.stub().rejects(errorWithCode('ENOENT'));
    const { IOUtils, log } = load(access);

    expect(await IOUtils.checkFileExists('/backup/local/backup_app.tar.gz')).to.equal(false);
    expect(access.calledOnce, 'the stub is actually wired in').to.equal(true);
    expect(log.error.called).to.equal(false);
  });

  it('answers false and logs the error when the path cannot be read', async () => {
    const denied = errorWithCode('EACCES');
    const { IOUtils, log } = load(sinon.stub().rejects(denied));

    expect(await IOUtils.checkFileExists('/backup/local/backup_app.tar.gz')).to.equal(false);
    expect(log.error.calledOnceWith(denied)).to.equal(true);
  });
});
