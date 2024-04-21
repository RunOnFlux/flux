const chai = require('chai');

const { expect } = chai;
const sinon = require('sinon');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

const deviceHelper = require('../../ZelBack/src/services/deviceHelper');

describe('deviceHelper tests', () => {
  let runCmdStub;

  beforeEach(() => {
    runCmdStub = sinon.stub(serviceHelper, 'runCommand');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('Should return true if mount target has quota option', async () => {
    const findmnt = `TARGET SOURCE    FSTYPE OPTIONS
    /      /dev/sda2 xfs   rw,relatime,attr2,inode64,logbufs=8,logbsize=32k,prjquota`;

    runCmdStub.resolves({ stdout: findmnt });

    const response = await deviceHelper.hasQuotaOptionForMountTarget('/var/lib/docker');
    expect(response).to.eql(true);
    sinon.assert.calledWithExactly(runCmdStub, 'findmnt', { logError: false, params: ['--target', '/var/lib/docker', '--options', 'prjquota'] });
  });

  it('Should return false if mount target has no quota option', async () => {
    runCmdStub.resolves({ stdout: '' });

    const response = await deviceHelper.hasQuotaOptionForMountTarget('/var/lib/docker');
    expect(response).to.eql(false);
    sinon.assert.calledWithExactly(runCmdStub, 'findmnt', { logError: false, params: ['--target', '/var/lib/docker', '--options', 'prjquota'] });
  });
});
