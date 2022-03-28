const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const daemonService = require('../../ZelBack/src/services/daemonService');

describe('fluxCommunicationMessagesSender tests', () => {
  describe('serialiseAndSignFluxBroadcast tests', () => {
    it('should return serialised and signed message', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const expectedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).pubKey).to.eql(expectedPubKey);
      expect(JSON.parse(signedData).data).to.eql(data);
    });

    it('should return serialised and signed empty message', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const data = '';
      const expectedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).pubKey).to.eql(expectedPubKey);
      expect(JSON.parse(signedData).data).to.eql(data);
    });

    it('should return serialised empty message without signature when no public key is provided', async () => {
      const privateKey = '';
      const data = '';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.empty;
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).data).to.eql(data);
      expect(JSON.parse(signedData).pubKey).to.eql({});
    });
  });

  describe('getFluxMessageSignature tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return signature if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';

      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey);

      expect(signature).to.be.a('string');
    });

    it('Should properly return signature if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';
      const daemonStub = sinon.stub(daemonService, 'getConfigValue').resolves(mockedPrivKey);

      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message);

      expect(signature).to.be.a('string');
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should throw error if private key is invalid', async () => {
      const privateKey = 'asdf';
      const message = 'testing1234';

      expect(async () => { await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey); }).to.throw;
    });
  });
});
