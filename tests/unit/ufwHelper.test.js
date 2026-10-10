const fs = require('node:fs/promises');
const { expect } = require('chai');
const sinon = require('sinon');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const log = require('../../ZelBack/src/lib/log');
const ufwHelper = require('../../ZelBack/src/services/utils/ufwHelper');

describe('ufw helper', () => {
  const SHIPPED = Buffer.from('#!/usr/bin/env python3\n# the helper FluxOS ships\n');
  let readFile;
  let runCommand;

  // What the root-owned copy holds: its contents, or null for no file.
  const installedCopy = (contents) => {
    if (contents === null) readFile.withArgs(ufwHelper.UFW_HELPER).rejects(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    else readFile.withArgs(ufwHelper.UFW_HELPER).resolves(contents);
  };
  const installCalls = () => runCommand.getCalls().filter((call) => call.args[0] === 'install').map((call) => call.args[1].params);
  const DIR_INSTALL = ['-d', '-o', 'root', '-g', 'root', '-m', '0755', ufwHelper.UFW_HELPER_DIR];
  const FILE_INSTALL = ['-o', 'root', '-g', 'root', '-m', '0755', ufwHelper.UFW_HELPER_SOURCE, ufwHelper.UFW_HELPER];

  beforeEach(() => {
    readFile = sinon.stub(fs, 'readFile');
    readFile.withArgs(ufwHelper.UFW_HELPER_SOURCE).resolves(SHIPPED);
    runCommand = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '', stderr: '' });
    sinon.stub(log, 'error');
    sinon.stub(log, 'info');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('runs a root-owned copy outside the FluxOS tree', () => {
    expect(ufwHelper.UFW_HELPER).to.equal('/usr/local/lib/fluxos/apply-node-firewall.py');
    expect(ufwHelper.UFW_HELPER_SOURCE).to.match(/\/helpers\/ufw\/apply-node-firewall\.py$/);
  });

  it('runs the installed copy and installs nothing when it is the shipped helper', async () => {
    installedCopy(Buffer.from(SHIPPED));

    expect(await ufwHelper.install()).to.equal(ufwHelper.UFW_HELPER);
    expect(installCalls()).to.deep.equal([]);
  });

  it('creates the directory and installs the copy, root-owned, when there is none', async () => {
    installedCopy(null);

    expect(await ufwHelper.install()).to.equal(ufwHelper.UFW_HELPER);
    expect(installCalls()).to.deep.equal([DIR_INSTALL, FILE_INSTALL]);
    runCommand.getCalls().forEach((call) => expect(call.args[1].runAsRoot).to.equal(true));
  });

  it('replaces a copy that differs from the shipped helper', async () => {
    installedCopy(Buffer.from('#!/usr/bin/env python3\n# an older helper\n'));

    expect(await ufwHelper.install()).to.equal(ufwHelper.UFW_HELPER);
    expect(installCalls()).to.deep.equal([DIR_INSTALL, FILE_INSTALL]);
  });

  it('runs the shipped helper, and says so, when the directory cannot be created', async () => {
    installedCopy(null);
    runCommand.withArgs('install', sinon.match({ params: DIR_INSTALL })).resolves({ error: new Error('read-only file system'), stdout: '', stderr: '' });

    expect(await ufwHelper.install()).to.equal(ufwHelper.UFW_HELPER_SOURCE);
    expect(installCalls()).to.deep.equal([DIR_INSTALL]);
    sinon.assert.calledOnce(log.error);
  });

  it('runs the shipped helper, and says so, when the copy cannot be installed', async () => {
    installedCopy(null);
    runCommand.withArgs('install', sinon.match({ params: FILE_INSTALL })).resolves({ error: new Error('no space left on device'), stdout: '', stderr: '' });

    expect(await ufwHelper.install()).to.equal(ufwHelper.UFW_HELPER_SOURCE);
    sinon.assert.calledOnce(log.error);
  });

  it('installs once per start: every call after the first answers the same helper without reading or installing anything', async () => {
    installedCopy(null);
    runCommand.withArgs('install').resolves({ error: new Error('read-only file system'), stdout: '', stderr: '' });
    const first = await ufwHelper.path();
    readFile.resetHistory();
    runCommand.resetHistory();
    log.error.resetHistory();

    const later = await Promise.all([ufwHelper.path(), ufwHelper.path(), ufwHelper.path()]);

    expect(later).to.deep.equal([first, first, first]);
    sinon.assert.notCalled(readFile);
    sinon.assert.notCalled(runCommand);
    sinon.assert.notCalled(log.error);
  });
});
