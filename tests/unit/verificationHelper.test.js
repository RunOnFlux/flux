const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;
const sinon = require('sinon');

const verificationHelperUtils = require('../../ZelBack/src/services/verificationHelperUtils');
const {
  verifyPrivilege, verifyZelID, verifyMessage, signMessage,
} = require('../../ZelBack/src/services/verificationHelper');
const { Privilege, APP_SCOPED, authOf } = require('../../ZelBack/src/services/utils/privileges');

// The verifiers are stubbed here - they are covered in verificationHelperUtils.test.
// zelidauth is a string because a header value always is: node folds duplicates
// into one comma-joined string, so no caller can make it anything else.
const zelidauth = 'zelid=testing1&loginPhrase=testing2&signature=testing3';
const req = { headers: { zelidauth } };
const appName = 'myTestAppName';

describe('verificationHelper tests', () => {
  describe('verifyPrivilege tests', () => {
    afterEach(() => sinon.restore());

    // Each privilege, the verifier that answers it, and whether it reads an app
    // name. A member missing from this table is a member nothing dispatches.
    const table = [
      [Privilege.USER, 'verifyUserSession', false],
      [Privilege.NODE_OPERATOR, 'verifyNodeOperatorSession', false],
      [Privilege.FLUX_TEAM, 'verifyFluxTeamSession', false],
      [Privilege.NODE_OPERATOR_OR_FLUX_TEAM, 'verifyNodeOperatorOrFluxTeamSession', false],
      [Privilege.APP_OWNER, 'verifyAppOwnerSession', true],
      [Privilege.APP_OWNER_OR_FLUX_TEAM, 'verifyAppOwnerOrFluxTeamSession', true],
    ];

    table.forEach(([privilege, verifier, scoped]) => {
      it(`${privilege} is answered by ${verifier}`, async () => {
        const stub = sinon.stub(verificationHelperUtils, verifier).resolves(true);

        const result = scoped
          ? await verifyPrivilege(privilege, authOf(req), { appName })
          : await verifyPrivilege(privilege, authOf(req));

        expect(result).to.be.true;
        if (scoped) sinon.assert.calledOnceWithExactly(stub, zelidauth, appName);
        else sinon.assert.calledOnceWithExactly(stub, zelidauth);
      });
    });

    // The table above is only exhaustive if it names every privilege there is.
    it('covers every privilege, so none can be added without a home here', () => {
      expect(table.map(([p]) => p).sort()).to.deep.equal(Object.values(Privilege).sort());
      expect(table.filter(([, , scoped]) => scoped).map(([p]) => p).sort())
        .to.deep.equal([...APP_SCOPED].sort());
    });

    // A privilege nothing recognises is not a refusal, it is a miswired call
    // site. Answering false would let it reach a caller as an ordinary 401 and
    // sit there - which is what 'appownerabove' would have done, having been a
    // real privilege that admitted the node operator.
    ['appownerabove', 'test', true, undefined].forEach((privilege) => {
      it(`refuses to answer for ${JSON.stringify(privilege)}, which is not a privilege`, async () => {
        await expect(verifyPrivilege(privilege, authOf(req))).to.be.rejectedWith(TypeError, 'is not a Privilege');
      });
    });

    // The guard that carries the migration: every call site hands over the
    // header's value, and anything else came from our own code rather than from
    // a caller. Answering false would make a miswired route a permanent 401
    // indistinguishable from a real refusal.
    [req, { zelid: 'x' }, ['a'], 7].forEach((wrong) => {
      it(`refuses ${JSON.stringify(wrong)} in place of the header value`, async () => {
        await expect(verifyPrivilege(Privilege.USER, wrong))
          .to.be.rejectedWith(TypeError, 'not the request');
      });
    });

    // An absent credential is not a miswiring - it is every unauthenticated
    // request there has ever been, and it answers like any other refusal.
    [null, undefined, authOf({ headers: {} }), authOf({})].forEach((absent) => {
      it(`answers false, not an error, when the caller carries ${JSON.stringify(absent)}`, async () => {
        const stub = sinon.stub(verificationHelperUtils, 'verifyUserSession').resolves(false);

        expect(await verifyPrivilege(Privilege.USER, absent)).to.be.false;

        // handed on as given: authOf is what normalises an absent credential
        // to null, and it is the way in that every route uses.
        sinon.assert.calledOnceWithExactly(stub, absent);
      });
    });

    // The nit that started this: a privilege resolving an identity was being
    // handed an app name it discarded, which read as app-scoped and was not.
    it('refuses an app name for a privilege that resolves an identity', async () => {
      await expect(verifyPrivilege(Privilege.NODE_OPERATOR, authOf(req), { appName }))
        .to.be.rejectedWith(TypeError, 'reads no app name');
    });
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

    it('should return false if the address is invalid', () => {
      const verification = verifyMessage(message, '12355', validSignature);
      expect(verification).to.be.false;
    });

    it('should return false if the publicKey is invalid', () => {
      const verification = verifyMessage(message, '0474eb4690689bb408139249eda7f361b7881c4254ccbe30', validSignature);
      expect(verification).to.be.false;
    });

    it('should return false if there is no signature', () => {
      const verification = verifyMessage(message, address);
      expect(verification).to.be.false;
    });

    it('should return false if the address is wrong', () => {
      const verification = verifyMessage(message, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', validSignature);
      expect(verification).to.be.false;
    });

    it('should return false if the signature is invalid', () => {
      const verification = verifyMessage(message, address, '1234567ASDFG');
      expect(verification).to.be.false;
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
