const chai = require('chai');

const { expect } = chai;
const sinon = require('sinon');

const verificationHelperUtils = require('../../ZelBack/src/services/verificationHelperUtils');
const {
  verifyPrivilege, verifyZelID, verifyMessage, signMessage,
} = require('../../ZelBack/src/services/verificationHelper');

// placeholders - verification functions are mocked, they have already been tested in verificationHelperUtils.test
const req = {
  headers: {
    zelidauth: {
      zelid: 'testing1',
      signature: 'testing2',
    },
  },
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

  describe('verifyZelID tests', () => {
    it('should throw error if ZelID is empty', () => {
      const isValid = verifyZelID();
      expect(isValid).to.be.an('error');
    });

    it('should return throw error if ZelID is invalid', () => {
      const isValid = verifyZelID('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo');
      expect(isValid).to.be.an('error');
    });

    it('should return true if ZelID is valid', () => {
      const isValid = verifyZelID('1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ');
      expect(isValid).to.be.true;
    });
  });

  describe('verifyMessage tests', () => {
    const message = 'test';
    const publicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const validSignature = 'G6wvdaMqtuQYqa5BAtKsLHFCYQwB4PXoTwG0YSGtWU6ude/brDNM5MraSBfT64HU3XPhObGohFjLLo6KjtMgnlc=';
    const address = '1KoXq8mLxpNt3BSnNLq2HzKC39Ne2pVJtF';

    it('should return true if message is signed properly with a public key', () => {
      const verification = verifyMessage(message, publicKey, validSignature);
      expect(verification).to.be.true;
    });

    it('should return true if message is signed properly with an address', () => {
      const verification = verifyMessage(message, address, validSignature);
      expect(verification).to.be.true;
    });

    it('should return error if the address is invalid', () => {
      const verification = verifyMessage(message, '12355', validSignature);
      expect(verification).to.be.an('error');
    });

    it('should return false if the publicKey is invalid', () => {
      const verification = verifyMessage(message, '0474eb4690689bb408139249eda7f361b7881c4254ccbe30', validSignature);
      expect(verification).to.be.false;
    });

    it('should return error if there is no signature', () => {
      const verification = verifyMessage(message, address);
      expect(verification).to.be.an('error');
    });

    it('should return false if the address is wrong', () => {
      const verification = verifyMessage(message, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', validSignature);
      expect(verification).to.be.false;
    });

    it('should return error if the signature is invalid', () => {
      const verification = verifyMessage(message, address, '1234567ASDFG');
      expect(verification).to.be.an('error');
    });
  });

  describe('signMessage tests', () => {
    it('should sign a message', async () => {
      const message = 'abc';
      const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';

      const signature = signMessage(message, privKey);

      expect(signature).to.be.a('string');
    });

    it('should sign an empty message', async () => {
      const message = '';
      const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';

      const signature = signMessage(message, privKey);

      expect(signature).to.be.a('string');
    });

    it('should throw error if private key is invalid', async () => {
      const message = 'abc';
      const privKey = 'test123';

      const signature = signMessage(message, privKey);

      expect(signature).to.be.an('error');
    });
  });
});
