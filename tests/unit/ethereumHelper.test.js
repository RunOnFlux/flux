const chai = require('chai');

const { expect } = chai;

const ethereumHelper = require('../../ZelBack/src/services/ethereumHelper');

describe('ethereumHelper tests', () => {
  describe('isHexStrict tests', () => {
    it('should return false if not a hex', async () => {
      const testA = ethereumHelper.isHexStrict('notahexstring');
      const testB = ethereumHelper.isHexStrict(false);
      const testC = ethereumHelper.isHexStrict();
      const testD = ethereumHelper.isHexStrict(123456);
      const testE = ethereumHelper.isHexStrict(0xAACD);
      const testF = ethereumHelper.isHexStrict(0x1234);
      const testG = ethereumHelper.isHexStrict('aabbcc');
      expect(testA).to.be.false;
      expect(testB).to.be.false;
      expect(testC).to.be.false;
      expect(testD).to.be.false;
      expect(testE).to.be.false;
      expect(testF).to.be.false;
      expect(testG).to.be.false;
    });
    it('should return true if it is a hex', async () => {
      const testA = ethereumHelper.isHexStrict('0xABCD');
      const testB = ethereumHelper.isHexStrict('0x4444');
      const testC = ethereumHelper.isHexStrict('0x123');
      expect(testA).to.be.true;
      expect(testB).to.be.true;
      expect(testC).to.be.true;
    });
  });

  describe('toHex tests', () => {
    it('should return hex string from a string', async () => {
      const testA = ethereumHelper.toHex('somestring');
      const testB = ethereumHelper.toHex('12345');
      expect(testA).to.eql('736f6d65737472696e67');
      expect(testB).to.eql('3132333435');
    });
    it('should throw if supplied data is not string', async () => {
      const testA = () => { ethereumHelper.toHex(); };
      expect(testA).to.throw();
      const testB = () => { ethereumHelper.toHex(null); };
      expect(testB).to.throw();
      const testC = () => { ethereumHelper.toHex(undefined); };
      expect(testC).to.throw();
    });
  });

  describe('hexToBytes tests', () => {
    it('should return bytes array from a valid hex string', async () => {
      const testA = ethereumHelper.hexToBytes('0xAABBCCDD');
      const testB = ethereumHelper.hexToBytes('0x736f6d65737472696e67');
      expect(testA).to.eql([170, 187, 204, 221]);
      expect(testB).to.eql([
        115, 111, 109, 101,
        115, 116, 114, 105,
        110, 103,
      ]);
    });
    it('should throw if supplied data is not hex string', async () => {
      const testA = () => { ethereumHelper.hexToBytes(); };
      expect(testA).to.throw();
      const testB = () => { ethereumHelper.hexToBytes(null); };
      expect(testB).to.throw();
      const testC = () => { ethereumHelper.hexToBytes(undefined); };
      expect(testC).to.throw();
      const testD = () => { ethereumHelper.hexToBytes('somestring'); };
      expect(testD).to.throw();
    });
  });

  describe('hashMessage tests', () => {
    it('should create ethereum message hash for a string', async () => {
      const testA = ethereumHelper.hashMessage('testmessage123');
      const testB = ethereumHelper.hashMessage('01231asodimaiosd(**(@#ndasd>??asd!2');
      expect(testA).to.eql('0x518ae699da3f6dfe9b2109ec808b3054055e599e20594fd5370b2b018332bd6c');
      expect(testB).to.eql('0x63a42e64f2bd5c4747478bdc029fc0326befecd301233b311dbda8f50de94d77');
    });
    it('should throw if supplied data is not a string', async () => {
      const testA = () => { ethereumHelper.hashMessage(); };
      expect(testA).to.throw();
      const testB = () => { ethereumHelper.hashMessage(null); };
      expect(testB).to.throw();
      const testC = () => { ethereumHelper.hashMessage(undefined); };
      expect(testC).to.throw();
    });
  });

  describe('recoverSigner tests', () => {
    it('should recover ethereum signer given a signature and message', async () => {
      const testA = ethereumHelper.recoverSigner('testmessage123', '0xaaa09d14433ec40513a4ad70d6945ec8459cad37b7fe3102e443d91210fc5d3847fe0e262043a8b8bbeb33698970ab69dd759ddd52d0f2985b6d80f2e1c119ec1b');
      const testB = ethereumHelper.recoverSigner('01231asodimaiosd(**(@#ndasd>??asd!2', '0xe244f84b5cff70e11bd23bb3132103dc72d3e77658155b459978c4287ced73036e20efe70c3166a74c7b847bd260d9af848a9a68dae1a7d1881250bb6a4593941b');
      expect(testA).to.eql('0xfaA2cA6454F2815C0900da1d4BfbD53072C736eb');
      expect(testB).to.eql('0xfaA2cA6454F2815C0900da1d4BfbD53072C736eb');
    });
    it('should throw if supplied data for recovry is not sufficient', async () => {
      const testA = () => { ethereumHelper.recoverSigner(); };
      expect(testA).to.throw();
      const testB = () => { ethereumHelper.recoverSigner(null); };
      expect(testB).to.throw();
      const testC = () => { ethereumHelper.recoverSigner(undefined); };
      expect(testC).to.throw();
      const testD = () => { ethereumHelper.recoverSigner(undefined, '0xe244f84b5cff70e11bd23bb3132103dc72d3e77658155b459978c4287ced73036e20efe70c3166a74c7b847bd260d9af848a9a68dae1a7d1881250bb6a4593941b'); };
      expect(testD).to.throw();
      const testE = () => { ethereumHelper.recoverSigner('testmessage123', undefined); };
      expect(testE).to.throw();
    });
  });
});
