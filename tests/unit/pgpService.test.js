process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const chai = require('chai');
const sinon = require('sinon');
const fsPromises = require('fs').promises;

globalThis.userconfig = require('../../config/userconfig');

const { expect } = chai;

const pgpService = require('../../ZelBack/src/services/pgpService');
const workerRunner = require('../../ZelBack/src/services/utils/workerRunner');
const generalService = require('../../ZelBack/src/services/generalService');
const configManager = require('../../ZelBack/src/services/utils/configManager');

describe('pgpService tests', () => {
  describe('encryptMessage decryptMessage tests', () => {
    let runInWorkerStub;

    beforeEach(() => {
      runInWorkerStub = sinon.stub(workerRunner, 'runInWorker');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should encrypt a message to the keys given', async () => {
      runInWorkerStub.resolves('-----BEGIN PGP MESSAGE-----');

      const encryptedMessage = await pgpService.encryptMessage('Hello, my message', ['publicKey']);

      expect(encryptedMessage).to.be.eql('-----BEGIN PGP MESSAGE-----');
      sinon.assert.calledOnceWithExactly(runInWorkerStub, 'pgpWorker', {
        operation: 'encrypt', params: { message: 'Hello, my message', encryptionKeys: ['publicKey'] },
      });
    });

    it('should decrypt a message with the key given', async () => {
      runInWorkerStub.resolves('Hello, my message');

      const decryptedMessage = await pgpService.decryptMessage('encrypted', 'privateKey');

      expect(decryptedMessage).to.be.eql('Hello, my message');
      sinon.assert.calledOnceWithExactly(runInWorkerStub, 'pgpWorker', {
        operation: 'decrypt', params: { encryptedMessage: 'encrypted', decryptionKey: 'privateKey' },
      });
    });

    it('should answer null for a message it cannot encrypt or decrypt', async () => {
      runInWorkerStub.rejects(new Error('Error decrypting message'));

      expect(await pgpService.encryptMessage('Hello, my message', ['publicKey'])).to.be.eql(null);
      expect(await pgpService.decryptMessage('encrypted', 'privateKey')).to.be.eql(null);
    });
  });

  describe('identity tests', () => {
    let runInWorkerStub;
    let originalInitial;

    beforeEach(() => {
      originalInitial = { ...globalThis.userconfig.initial };
      runInWorkerStub = sinon.stub(workerRunner, 'runInWorker');
    });

    afterEach(() => {
      globalThis.userconfig.initial = originalInitial;
      sinon.restore();
    });

    it('should not run any pgp operation on a node that already has a keypair', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = 'storedPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'storedPublicKey';

      await pgpService.generateIdentity();

      sinon.assert.notCalled(runInWorkerStub);
    });

    it('should generate and store a keypair on a node that has none', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = '';
      globalThis.userconfig.initial.pgpPublicKey = '';
      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({ txhash: 'abcd', txindex: 0 });
      const writeStub = sinon.stub(fsPromises, 'writeFile').resolves();
      runInWorkerStub.resolves({ privateKey: 'newPrivateKey', publicKey: 'newPublicKey' });

      await pgpService.generateIdentity();

      sinon.assert.calledOnceWithMatch(runInWorkerStub, 'pgpWorker', { operation: 'generateKey' });
      sinon.assert.calledOnce(writeStub);
    });

    it('should verify its own keypair before first use of the private key, and only once', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = 'aPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'itsPublicKey';
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'derivePublicKey' })).resolves('itsPublicKey');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'decrypt' })).resolves('plaintext');

      const first = await pgpService.decryptMessage('encrypted');
      const second = await pgpService.decryptMessage('encrypted');

      expect(first).to.be.eql('plaintext');
      expect(second).to.be.eql('plaintext');

      const derivations = runInWorkerStub.getCalls().filter((call) => call.args[1].operation === 'derivePublicKey');
      expect(derivations.length).to.be.eql(1);
    });

    it('should replace a keypair whose public key does not belong to its private key', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = 'aCorruptPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'someoneElsesPublicKey';
      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({ txhash: 'abcd', txindex: 0 });
      sinon.stub(fsPromises, 'writeFile').resolves();
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'derivePublicKey' })).resolves('aDifferentPublicKey');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'generateKey' })).resolves({ privateKey: 'newPrivateKey', publicKey: 'newPublicKey' });
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'decrypt' })).resolves('plaintext');

      await pgpService.decryptMessage('encrypted');

      sinon.assert.calledWithMatch(runInWorkerStub, 'pgpWorker', { operation: 'generateKey' });
    });

    it('should not verify its own keypair when the caller supplies a key', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = 'anUncheckedPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'itsPublicKey';
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'decrypt' })).resolves('plaintext');

      await pgpService.decryptMessage('encrypted', 'aCallerSuppliedKey');

      const derivations = runInWorkerStub.getCalls().filter((call) => call.args[1].operation === 'derivePublicKey');
      expect(derivations.length).to.be.eql(0);
    });

    it('should repair a corrupt keypair once, however many callers find it at the same time', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = 'aCorruptPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'someoneElsesPublicKey';
      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({ txhash: 'abcd', txindex: 0 });
      const writeStub = sinon.stub(fsPromises, 'writeFile').resolves();
      sinon.stub(configManager, 'reloadConfig');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'derivePublicKey' })).resolves('aDifferentPublicKey');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'generateKey' })).resolves({ privateKey: 'newPrivateKey', publicKey: 'newPublicKey' });
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'decrypt' })).resolves('plaintext');

      await Promise.all([
        pgpService.decryptMessage('encrypted'),
        pgpService.decryptMessage('encrypted'),
        pgpService.decryptMessage('encrypted'),
      ]);

      const generations = runInWorkerStub.getCalls().filter((call) => call.args[1].operation === 'generateKey');
      expect(generations.length).to.be.eql(1);
      sinon.assert.calledOnce(writeStub);
    });

    it('should not derive or replace again once the new identity is in place', async () => {
      function applyWrittenIdentity() {
        globalThis.userconfig.initial.pgpPrivateKey = 'newPrivateKey';
        globalThis.userconfig.initial.pgpPublicKey = 'newPublicKey';
      }
      globalThis.userconfig.initial.pgpPrivateKey = 'aCorruptPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'someoneElsesPublicKey';
      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({ txhash: 'abcd', txindex: 0 });
      sinon.stub(fsPromises, 'writeFile').resolves();
      sinon.stub(configManager, 'reloadConfig').callsFake(applyWrittenIdentity);
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'derivePublicKey' })).resolves('aDifferentPublicKey');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'generateKey' })).resolves({ privateKey: 'newPrivateKey', publicKey: 'newPublicKey' });
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'decrypt' })).resolves('plaintext');

      await pgpService.decryptMessage('encrypted');
      await pgpService.decryptMessage('encrypted');

      const generations = runInWorkerStub.getCalls().filter((call) => call.args[1].operation === 'generateKey');
      const derivations = runInWorkerStub.getCalls().filter((call) => call.args[1].operation === 'derivePublicKey');
      expect(generations.length).to.be.eql(1);
      expect(derivations.length).to.be.eql(1);
    });

    it('should leave the repair to be attempted again when the new identity could not be stored', async () => {
      globalThis.userconfig.initial.pgpPrivateKey = 'aCorruptPrivateKey';
      globalThis.userconfig.initial.pgpPublicKey = 'someoneElsesPublicKey';
      sinon.stub(generalService, 'obtainNodeCollateralInformation').resolves({ txhash: 'abcd', txindex: 0 });
      sinon.stub(fsPromises, 'writeFile').rejects(new Error('read-only filesystem'));
      sinon.stub(configManager, 'reloadConfig');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'derivePublicKey' })).resolves('aDifferentPublicKey');
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'generateKey' })).resolves({ privateKey: 'newPrivateKey', publicKey: 'newPublicKey' });
      runInWorkerStub.withArgs('pgpWorker', sinon.match({ operation: 'decrypt' })).resolves('plaintext');

      await pgpService.decryptMessage('encrypted');
      await pgpService.decryptMessage('encrypted');

      const generations = runInWorkerStub.getCalls().filter((call) => call.args[1].operation === 'generateKey');
      expect(generations.length).to.be.eql(2);
    });
  });
});
