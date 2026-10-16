const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const proxyquire = require('proxyquire');

const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const portFile = require('../../ZelBack/src/services/utils/portFile');

const PORTS = { apiPort: 16137, apiPortHttps: 16138, uiPort: 16136 };

describe('portFile tests', () => {
  let root;
  let dir;
  let file;
  let infoStub;
  let warnStub;
  let errorStub;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfile-'));
    // A directory that does not exist yet, as /run/fluxos after a boot.
    dir = path.join(root, 'fluxos');
    file = path.join(dir, portFile.PORT_FILE_NAME);
    infoStub = sinon.stub(log, 'info');
    warnStub = sinon.stub(log, 'warn');
    errorStub = sinon.stub(log, 'error');
  });

  afterEach(() => {
    sinon.restore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('publishes /run/fluxos/fluxos.json by default', () => {
    expect(portFile.PORT_FILE_DIR).to.equal('/run/fluxos');
    expect(portFile.PORT_FILE_NAME).to.equal('fluxos.json');
  });

  it('writes the three ports and the process id, world-readable, in a directory it creates', async () => {
    expect(await portFile.writePortFile(PORTS, { dir })).to.equal(true);

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ ...PORTS, pid: process.pid });
    expect(fs.statSync(file).mode & 0o777).to.equal(0o644);
    expect(fs.statSync(dir).mode & 0o777).to.equal(0o755);
    sinon.assert.calledOnce(infoStub);
    sinon.assert.notCalled(errorStub);
  });

  it('keeps its modes under a restrictive umask', async () => {
    const umask = process.umask(0o077);
    try {
      await portFile.writePortFile(PORTS, { dir });
    } finally {
      process.umask(umask);
    }
    expect(fs.statSync(file).mode & 0o777).to.equal(0o644);
    expect(fs.statSync(dir).mode & 0o777).to.equal(0o755);
  });

  it('writes a temporary file in the same directory and renames it over the final name', async () => {
    const rename = sinon.spy(fsPromises, 'rename');

    await portFile.writePortFile(PORTS, { dir });

    sinon.assert.calledOnce(rename);
    const [from, to] = rename.firstCall.args;
    expect(to).to.equal(file);
    expect(path.dirname(from)).to.equal(dir);
    expect(from).to.not.equal(file);
    expect(fs.readdirSync(dir), 'no temporary file remains').to.deep.equal([portFile.PORT_FILE_NAME]);
  });

  it('replaces a malformed file already there', async () => {
    fs.mkdirSync(dir);
    fs.writeFileSync(file, '{"apiPort": 1612', { mode: 0o600 });

    expect(await portFile.writePortFile(PORTS, { dir })).to.equal(true);

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ ...PORTS, pid: process.pid });
    expect(fs.statSync(file).mode & 0o777).to.equal(0o644);
  });

  it('logs a failure to write at error level and does not throw', async () => {
    // A directory that cannot be created: its parent is a file.
    const blocker = path.join(root, 'blocker');
    fs.writeFileSync(blocker, '');

    expect(await portFile.writePortFile(PORTS, { dir: path.join(blocker, 'fluxos') })).to.equal(false);

    sinon.assert.calledOnce(errorStub);
    sinon.assert.notCalled(infoStub);
  });

  it('leaves no temporary file when the rename fails', async () => {
    sinon.stub(fsPromises, 'rename').rejects(new Error('EXDEV'));

    expect(await portFile.writePortFile(PORTS, { dir })).to.equal(false);

    sinon.assert.calledOnce(errorStub);
    expect(fs.readdirSync(dir)).to.deep.equal([]);
  });

  it('removes the file on a stop, logging once', async () => {
    await portFile.writePortFile(PORTS, { dir });
    infoStub.resetHistory();

    expect(portFile.removePortFile({ dir })).to.equal(true);

    expect(fs.existsSync(file)).to.equal(false);
    sinon.assert.calledOnce(infoStub);
  });

  it('removes nothing, quietly, when there is no file', () => {
    expect(portFile.removePortFile({ dir })).to.equal(false);
    sinon.assert.notCalled(infoStub);
    sinon.assert.notCalled(warnStub);
  });

  it('logs a failure to remove and does not throw', async () => {
    // A directory in the file's place cannot be unlinked.
    fs.mkdirSync(file, { recursive: true });

    expect(portFile.removePortFile({ dir })).to.equal(false);

    sinon.assert.calledOnce(warnStub);
  });

  describe('a directory this process may not make', () => {
    const denied = () => Object.assign(new Error('EACCES: permission denied, mkdir'), { code: 'EACCES' });

    it('is made through sudo on a legacy node, owned by this process\'s account', async () => {
      const mkdir = fsPromises.mkdir.bind(fsPromises);
      sinon.stub(fsPromises, 'mkdir').callsFake((target, options) => (target === dir ? Promise.reject(denied()) : mkdir(target, options)));
      const runCommand = sinon.stub(serviceHelper, 'runCommand').callsFake(async () => {
        fs.mkdirSync(dir, { mode: 0o755 });
        return { error: null };
      });

      expect(await portFile.writePortFile(PORTS, { dir })).to.equal(true);

      const { uid, gid } = os.userInfo();
      sinon.assert.calledOnceWithExactly(runCommand, 'install', {
        runAsRoot: true,
        params: ['-d', '-m', '755', '-o', String(uid), '-g', String(gid), dir],
      });
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ ...PORTS, pid: process.pid });
      sinon.assert.notCalled(errorStub);
    });

    it('is made through sudo when another account owns it and its mode cannot be set', async () => {
      fs.mkdirSync(dir);
      sinon.stub(fsPromises, 'chmod').callsFake(async (target) => {
        if (target === dir) throw Object.assign(new Error('EPERM: operation not permitted, chmod'), { code: 'EPERM' });
      });
      const runCommand = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });

      expect(await portFile.writePortFile(PORTS, { dir })).to.equal(true);

      sinon.assert.calledOnce(runCommand);
    });

    it('logs both failures and writes nothing when sudo fails too', async () => {
      sinon.stub(fsPromises, 'mkdir').rejects(denied());
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: new Error('sudo: a password is required') });

      expect(await portFile.writePortFile(PORTS, { dir })).to.equal(false);

      sinon.assert.calledOnce(errorStub);
      expect(errorStub.firstCall.args[0]).to.include('EACCES').and.to.include('sudo: a password is required');
      expect(fs.existsSync(dir)).to.equal(false);
    });

    it('is not retried through sudo on ArcaneOS, where the unit makes it', async () => {
      const runCommand = sinon.stub().resolves({ error: null });
      const saved = process.env.FLUXOS_PATH;
      process.env.FLUXOS_PATH = '/usr/lib/fluxos';
      let arcanePortFile;
      try {
        arcanePortFile = proxyquire('../../ZelBack/src/services/utils/portFile', { '../serviceHelper': { runCommand } });
      } finally {
        if (saved === undefined) delete process.env.FLUXOS_PATH;
        else process.env.FLUXOS_PATH = saved;
      }
      sinon.stub(fsPromises, 'mkdir').rejects(denied());

      expect(await arcanePortFile.writePortFile(PORTS, { dir })).to.equal(false);

      sinon.assert.notCalled(runCommand);
      sinon.assert.calledOnce(errorStub);
    });
  });
});
