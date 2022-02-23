const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');

const verificationHelperUtils = require("../../ZelBack/src/services/verificationHelperUtils");
const { verifyPrivilege } = require("../../ZelBack/src/services/verificationHelper");

//placeholders - verification functions are mocked, they have already been tested in verificationHelperUtils.test
const req = {
  headers: {
    zelidauth: {
      zelid: 'testing1',
      signature: 'testing2'
    }
  }
};
const appName = 'myTestAppName';


describe('verificationHelper tests', () => {
  it('should call verifyAdminSession when flag "admin" is passed', async () => {
    const privilege = 'admin';
    const stub = sinon.stub(verificationHelperUtils, 'verifyAdminSession').resolves(true);
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req);

    sinon.assert.calledOnceWithExactly(stub, req.headers);
    expect(verifyPrivilegeResult).to.be.true;
    stub.reset();
  });

  it('should call verifyFluxTeamSession when flag "fluxteam" is passed', async () => {
    const privilege = 'fluxteam';
    const stub = sinon.stub(verificationHelperUtils, 'verifyFluxTeamSession').resolves(true);
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req);

    sinon.assert.calledOnceWithExactly(stub, req.headers);
    expect(verifyPrivilegeResult).to.be.true;
    stub.reset();
  });

  it('should call verifyAdminAndFluxTeamSession when flag "adminandfluxteam" is passed', async () => {
    const privilege = 'adminandfluxteam';
    const stub = sinon.stub(verificationHelperUtils, 'verifyAdminAndFluxTeamSession').resolves(true);
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req);

    sinon.assert.calledOnceWithExactly(stub, req.headers);
    expect(verifyPrivilegeResult).to.be.true;
    stub.reset();
  });

  it('should call verifyAppOwnerOrHigherSession when flag "appownerabove" is passed', async () => {
    const privilege = 'appownerabove';
    const stub = sinon.stub(verificationHelperUtils, 'verifyAppOwnerOrHigherSession').resolves(true);
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req, appName);

    sinon.assert.calledOnceWithExactly(stub, req.headers, appName);
    expect(verifyPrivilegeResult).to.be.true;
    stub.reset();
  });

  it('should call verifyAppOwnerSession when flag "appowner" is passed', async () => {
    const privilege = 'appowner';
    const stub = sinon.stub(verificationHelperUtils, 'verifyAppOwnerSession').resolves(true);
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req, appName);

    sinon.assert.calledOnceWithExactly(stub, req.headers, appName);
    expect(verifyPrivilegeResult).to.be.true;
    stub.reset();
  });

  it('should call verifyUserSession when flag "user" is passed', async () => {
    const privilege = 'user';
    const stub = sinon.stub(verificationHelperUtils, 'verifyUserSession').resolves(true);
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req);

    sinon.assert.calledOnceWithExactly(stub, req.headers);
    expect(verifyPrivilegeResult).to.be.true;
    stub.reset();
  });

  it('should return false when a wrong flag - string "test" is passed', async () => {
    const privilege = 'test';
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req);

    expect(verifyPrivilegeResult).to.be.false;
  });

  it('should return false when a wrong flag - bool true is passed', async () => {
    const privilege = true;
    const verifyPrivilegeResult = await verifyPrivilege(privilege, req);

    expect(verifyPrivilegeResult).to.be.false;
  });
});