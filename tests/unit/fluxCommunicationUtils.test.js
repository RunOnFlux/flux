const chai = require('chai');
const cacheManager = require('../../ZelBack/src/services/utils/cacheManager').default;
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const sinon = require('sinon');

const { expect } = chai;
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');
const fluxList = require('./data/listfluxnodes.json');

describe('fluxCommunicationUtils tests', () => {
  describe('deterministicFluxList tests', () => {
    const deterministicFluxnodeListResponseBase = {
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
    let networkStateStub;
    let networkStateByPubkeyStub;

    beforeEach(() => {
      cacheManager.resetCaches();
      daemonStub = sinon.stub(daemonServiceFluxnodeRpcs, 'viewDeterministicFluxNodeList');
      sinon.stub(networkStateService, 'waitStarted').resolves();
      networkStateStub = sinon.stub(networkStateService, 'networkState');
      networkStateByPubkeyStub = sinon.stub(networkStateService, 'getFluxnodesByPubkey');
    });

    afterEach(() => {
      daemonStub.restore();
      sinon.restore();
    });

    it('should return the whole list if the filter was not provided', async () => {
      networkStateStub.returns(deterministicFluxnodeListResponseBase);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList();

      expect(deterministicFluxListResult).to.eql(deterministicFluxnodeListResponseBase);
      sinon.assert.calledOnce(networkStateStub);
    });

    it('should return the list filtered by public key', async () => {
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const stateResult = new Map(
        [
          ['47.199.51.61:16147',
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
            }], ['44.192.51.11:16147',
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
        ],
      );

      const expectedResult = [
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
      ];

      networkStateByPubkeyStub.resolves(stateResult);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList({ filter: filteredPubKey });

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnce(networkStateByPubkeyStub);
    });

    it('should return an array of socketAddresses if requested', async () => {
      const stateResult = [
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
      ];

      const expected = ['47.199.51.61:16147', '44.192.51.11:16147'];

      networkStateStub.returns(stateResult);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList({ addressOnly: true });

      expect(deterministicFluxListResult).to.eql(expected);
      sinon.assert.calledOnce(networkStateStub);
    });

    it('should return an array of socketAddresses if requested', async () => {
      const stateResult = [
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
      ];

      const expected = ['47.199.51.61:16147', '44.192.51.11:16147'];

      networkStateStub.returns(stateResult);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList({ addressOnly: true });

      expect(deterministicFluxListResult).to.eql(expected);
      sinon.assert.calledOnce(networkStateStub);
    });

    it('should return an empty list if the public key does not match', async () => {
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424asdfde37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [];

      networkStateByPubkeyStub.resolves(null);

      const deterministicFluxListResult = await fluxCommunicationUtils.deterministicFluxList({ filter: filteredPubKey });

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnce(networkStateByPubkeyStub);
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
      type: 'fluxapptestmessage',
    };
    const message = JSON.stringify(data);
    let networkStateByPubkeyStub;

    beforeEach(() => {
      networkStateByPubkeyStub = sinon.stub(networkStateService, 'getFluxnodesByPubkey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, no current timestamp provided', async () => {
      const timestamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timestamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp,
        data,
        signature,
      };

      const stateResult = new Map([['1.2.3.4:16127', { data: 'here' }]]);

      networkStateByPubkeyStub.resolves(stateResult);

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend);

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

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, null, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return true if broadcast is verifiable, current timestamp provided', async () => {
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

      const stateResult = new Map([['1.2.3.4:16127', { data: 'here' }]]);

      networkStateByPubkeyStub.resolves(stateResult);

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, providedTimestamp);

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

      const isValid = await fluxCommunicationUtils.verifyOriginalFluxBroadcast(dataToSend, providedTimestamp);

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

      const isValid = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(true);
    });

    it('should return true if message timestamp is now, timestamp provided', async () => {
      const timeStamp = Date.now();
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(true);
    });

    it('should return false if message timestamp is more than 5 minutes ago, current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(false);
    });

    it('should return false if message timestamp is more than 5 minutes ago, no current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = fluxCommunicationUtils.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(false);
    });
  });
});
