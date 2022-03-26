const chai = require('chai');
const LRU = require('lru-cache');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { expect } = chai;
let fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const daemonService = require('../../ZelBack/src/services/daemonService');
const fluxList = require('./data/listfluxnodes.json');

describe.only('fluxCommunicationUtils tests', () => {
  describe('deterministicFluxList tests', () => {
    const deterministicZelnodeListResponseBase = {
      data: [
        {
          collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: '47.199.51.61:16137',
          network: '',
          added_height: 1076533,
          confirmed_height: 1076535,
          last_confirmed_height: 1079888,
          last_paid_height: 1077653,
          tier: 'CUMULUS',
          payment_address: 't1Z6mWoCrFC2g3iTCFdFkYdTfwtG84E3y2o',
          pubkey: '04378c8585d45861c8783f9c8cd0c85478164c12ce3fd13af1b44ebc8fe1ad6c786e92b211cb9566c596b6e2454d394a06bc44f748afb3c9ee48caa096d704abac',
          activesince: '1647197272',
          lastpaid: '1647333786',
          amount: '1000.00',
          rank: 0,
        },
        {
          collateral: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
          txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
          outidx: '0',
          ip: '47.199.51.61:16147',
          network: '',
          added_height: 1079638,
          confirmed_height: 1079642,
          last_confirmed_height: 1079889,
          last_paid_height: 0,
          tier: 'CUMULUS',
          payment_address: 't1UHecy6WiSJXs4Zqt5UvVdRDF7PMbZJK7q',
          pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
          activesince: '1647572455',
          lastpaid: '1516980000',
          amount: '1000.00',
          rank: 1,
        },
        {
          collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
          txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
          outidx: '0',
          ip: '44.192.51.11:16147',
          network: '',
          added_height: 123456,
          confirmed_height: 1234567,
          last_confirmed_height: 123456,
          last_paid_height: 0,
          tier: 'CUMULUS',
          payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
          pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
          activesince: '1647572455',
          lastpaid: '1516980000',
          amount: '2000.00',
          rank: 1,
        },
      ],
    };
    let daemonStub;

    beforeEach(() => {
      daemonStub = sinon.stub(daemonService, 'viewDeterministicZelNodeList');
    });

    afterEach(() => {
      daemonStub.restore();
      sinon.restore();
    });

    it('should return the whole list if the filter was not provided', async () => {
      // Start with clear cache
      fluxCommunicationUtils = proxyquire('../../ZelBack/src/services/fluxCommunicationUtils',
        { 'lru-cache': LRU });
      const deterministicZelnodeListResponse = {
        ...deterministicZelnodeListResponseBase,
        status: 'success',
      };
      daemonStub.resolves(deterministicZelnodeListResponse);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList();

      expect(deterministicFluxListResult).to.eql(deterministicZelnodeListResponse.data);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return the list filtered out with proper public key', async () => {
      // Start with clear cache
      fluxCommunicationUtils = proxyquire('../../ZelBack/src/services/fluxCommunicationUtils',
        { 'lru-cache': LRU });
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [{
        collateral: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
        txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
        outidx: '0',
        ip: '47.199.51.61:16147',
        network: '',
        added_height: 1079638,
        confirmed_height: 1079642,
        last_confirmed_height: 1079889,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecy6WiSJXs4Zqt5UvVdRDF7PMbZJK7q',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '1000.00',
        rank: 1,
      },
      {
        collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
        txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
        outidx: '0',
        ip: '44.192.51.11:16147',
        network: '',
        added_height: 123456,
        confirmed_height: 1234567,
        last_confirmed_height: 123456,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '2000.00',
        rank: 1,
      }];

      const deterministicZelnodeListResponse = {
        ...deterministicZelnodeListResponseBase,
        status: 'success',
      };
      daemonStub.resolves(deterministicZelnodeListResponse);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList(filteredPubKey);

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return an empty list if the public key does not match', async () => {
      // Start with clear cache
      fluxCommunicationUtils = proxyquire('../../ZelBack/src/services/fluxCommunicationUtils',
        { 'lru-cache': LRU });
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424asdfde37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [];

      const deterministicZelnodeListResponse = {
        ...deterministicZelnodeListResponseBase,
        status: 'success',
      };
      daemonStub.resolves(deterministicZelnodeListResponse);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList(filteredPubKey);

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should get list from cache with no filter applied', async () => {
    // Stub cache to simulate the actual lru-cache called
      const getCacheStub = sinon.stub();
      const stubCache = sinon.stub().callsFake(() => ({
        get: getCacheStub,
      }));
      getCacheStub.withArgs('fluxList').returns(deterministicZelnodeListResponseBase.data);
      fluxCommunicationUtils = proxyquire('../../ZelBack/src/services/fluxCommunicationUtils',
        { 'lru-cache': stubCache });

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList();

      expect(deterministicFluxListResult).to.eql(deterministicZelnodeListResponseBase.data);
      sinon.assert.calledOnceWithExactly(getCacheStub, 'fluxList');
    });

    it('should get list from cache with filter applied', async () => {
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [{
        collateral: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
        txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
        outidx: '0',
        ip: '47.199.51.61:16147',
        network: '',
        added_height: 1079638,
        confirmed_height: 1079642,
        last_confirmed_height: 1079889,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecy6WiSJXs4Zqt5UvVdRDF7PMbZJK7q',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '1000.00',
        rank: 1,
      },
      {
        collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
        txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
        outidx: '0',
        ip: '44.192.51.11:16147',
        network: '',
        added_height: 123456,
        confirmed_height: 1234567,
        last_confirmed_height: 123456,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '2000.00',
        rank: 1,
      }];
      // Stub cache to simulate the actual lru-cache called
      const getCacheStub = sinon.stub();
      const stubCache = sinon.stub().callsFake(() => ({
        get: getCacheStub,
      }));
      getCacheStub.withArgs(`fluxList${filteredPubKey}`).returns(expectedResult);
      fluxCommunicationUtils = proxyquire('../../ZelBack/src/services/fluxCommunicationUtils',
        { 'lru-cache': stubCache });

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList(filteredPubKey);

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(getCacheStub, `fluxList${filteredPubKey}`);
    });
  });

  describe('verifyOriginalFluxBroadcast tests', () => {
    // Function extends the verifyFluxBroadcast function, only adding time verification.
    // Message can't be older than 5 minutes.
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test',
    };
    const message = JSON.stringify(data);

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, flux node list provided, no current timestamp provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return false if the message has been sent more than 5 minutes ago, no current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return true if broadcast is verifiable, flux node list provided, current timestamp provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };
      const providedTimestamp = Date.now() + 100;

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, fluxList, providedTimestamp);

      expect(isValid).to.equal(true);
    });

    it('should return false if the message has been sent more than 5 minutes ago, current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };
      const providedTimestamp = Date.now() + 100;

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, fluxList, providedTimestamp);

      expect(isValid).to.equal(false);
    });
  });
  describe('verifyFluxBroadcast tests', () => {
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const badPubKey = '074eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test',
    };
    const message = JSON.stringify(data);

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, flux node list provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return true if broadcast is verifiable, flux node list from deterministicFluxList', async () => {
      const deterministicZelnodeListResponse = {
        status: 'success',
        data: [
          {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
            txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
            outidx: '0',
            ip: '47.199.51.61:16137',
            network: '',
            added_height: 1076533,
            confirmed_height: 1076535,
            last_confirmed_height: 1079888,
            last_paid_height: 1077653,
            tier: 'CUMULUS',
            payment_address: 't1Z6mWoCrFC2g3iTCFdFkYdTfwtG84E3y2o',
            pubkey: '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab',
            activesince: '1647197272',
            lastpaid: '1647333786',
            amount: '1000.00',
            rank: 0,
          },
        ],
      };
      sinon.stub(daemonService, 'viewDeterministicZelNodeList').resolves(deterministicZelnodeListResponse);
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return false if public key is invalid', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey: badPubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if version is not 1', async () => {
      const timeStamp = Date.now();
      const version = 2;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if the message has timestamp greater than 120s in the future', async () => {
      const timeStamp = Date.now() + 240000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunicationUtils.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if the signature is invalid', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature: 'test12341234567',
      };

      const isValid = await fluxCommunicationUtils.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });
  });

  describe('verifyTimestampInFluxBroadcast tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return true if message timestamp is now, no current timestamp provided', async () => {
      const timeStamp = Date.now();
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(true);
    });

    it('should return true if message timestamp is now, timestamp provided', async () => {
      const timeStamp = Date.now();
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(true);
    });

    it('should return false if message timestamp is more than 5 minutes ago, current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(false);
    });

    it('should return false if message timestamp is more than 5 minutes ago, no current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(false);
    });
  });
});
