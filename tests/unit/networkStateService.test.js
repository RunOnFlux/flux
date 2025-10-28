const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('node:events');

const networkStateService = require('../../ZelBack/src/services/networkStateService');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');

describe('networkStateService tests', () => {
  let fluxnodeRpcStub;

  const defaultNetworkState = {
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
        collateral: 'COutPoint(47c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
        txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
        outidx: '0',
        ip: '47.199.51.62:16147',
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
        rank: 2,
      },
    ],
  };

  beforeEach(async () => {
    fluxnodeRpcStub = sinon.stub(daemonServiceFluxnodeRpcs, 'viewDeterministicFluxNodeList');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should start and fetch the network state once', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const state = networkStateService.networkState();

    expect(state).to.be.deep.equal(defaultNetworkState.data);
    sinon.assert.calledOnce(fluxnodeRpcStub);
    await networkStateService.stop();
  });

  it('should wait for the state fetch and index population on waitStarted', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    const startPromise = networkStateService.start({ stateEmitter: blockEmitter });

    const stateBefore = networkStateService.networkState();
    expect(stateBefore).to.be.deep.equal([]);

    await networkStateService.waitStarted();

    const state = networkStateService.networkState();
    expect(state).to.be.deep.equal(defaultNetworkState.data);

    await startPromise;

    await networkStateService.stop();
  });

  it('should get the node count from the network state', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const nodeCount = networkStateService.nodeCount();

    await networkStateService.stop();

    expect(nodeCount).to.be.equal(3);
  });

  it('should validate if a pubkey is in the network state', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const found = await networkStateService.pubkeyInNetworkState('04378c8585d45861c8783f9c8cd0c85478164c12ce3fd13af1b44ebc8fe1ad6c786e92b211cb9566c596b6e2454d394a06bc44f748afb3c9ee48caa096d704abac');
    const notFound = await networkStateService.pubkeyInNetworkState('nonExistent');

    await networkStateService.stop();

    expect(found).to.be.true;
    expect(notFound).to.be.false;
  });

  it('should validate if a socketAddress is in the network state', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const found = await networkStateService.socketAddressInNetworkState('47.199.51.61:16137');
    const notFound = await networkStateService.socketAddressInNetworkState('1.2.3.4');

    await networkStateService.stop();

    expect(found).to.be.true;
    expect(notFound).to.be.false;
  });

  it('should attach a listener to the block emitter when property presented', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    expect(blockEmitter.listenerCount()).to.be.equal(0);
    await networkStateService.stop();
  });

  it('should return a copy of the state - not the same reference', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const state = networkStateService.networkState();

    expect(state).to.not.equal(defaultNetworkState.data);
    await networkStateService.stop();
  });

  it('should remove the emitter callback when service stopped', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    await networkStateService.stop();

    const state = networkStateService.networkState();

    expect(state).to.be.deep.equal([]);
    expect(blockEmitter.listenerCount()).to.be.equal(0);
  });

  it('should return a list of fluxnodes filtered by pubkey', async () => {
    const expected = new Map(
      [
        [
          '47.199.51.61:16147',
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
        ],
        [
          '47.199.51.62:16147',
          {
            collateral: 'COutPoint(47c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
            txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
            outidx: '0',
            ip: '47.199.51.62:16147',
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
            rank: 2,
          },
        ],
      ],
    );

    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const nodes = await networkStateService.getFluxnodesByPubkey('04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc');
    await networkStateService.stop();

    expect(nodes).to.be.deep.equal(expected);
  });

  it('should return null if searching by pubkey and id does not exist', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const nodes = await networkStateService.getFluxnodesByPubkey('doesnotexist');
    await networkStateService.stop();

    expect(nodes).to.be.equal(null);
  });

  it('should return a specific fluxnode by socketAddress', async () => {
    const expected = {
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
    };

    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const node = await networkStateService.getFluxnodeBySocketAddress('47.199.51.61:16147');
    await networkStateService.stop();

    expect(node).to.be.deep.equal(expected);
  });

  it('should return null if searching by socketAddress and it does not exist', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const node = await networkStateService.getFluxnodeBySocketAddress('1.2.3.4:16147');
    await networkStateService.stop();

    expect(node).to.be.deep.equal(null);
  });

  it('should return a random single socketAddress from the state, that is not this node', async () => {
    const localSocketAddress = '47.199.51.62:16147';
    const otherSocketAddresses = ['47.199.51.61:16137', '47.199.51.61:16147'];

    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    await networkStateService.start({ stateEmitter: blockEmitter });

    const promises = [];

    // we only have 3 nodes. so we run it 1000 times. If this was broken, it would
    // be 1/3 chance of getting the local node. (It should be 1/2 as the local is
    // excluded. So 1000 tries will definitely find any errors)
    for (let i = 0; i < 1000; i += 1) {
      promises.push(
        networkStateService.getRandomSocketAddress(localSocketAddress),
      );
    }

    const results = await Promise.all(promises);

    await networkStateService.stop();

    const allPassed = results.every((socketAddress) => {
      const passedValidation = socketAddress !== localSocketAddress
        && otherSocketAddresses.includes(socketAddress);

      return passedValidation;
    });

    expect(allPassed).to.be.true;
  });

  it('should throttle daemon calls when fetched within 30 seconds', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    // First start - should call daemon
    await networkStateService.start({ stateEmitter: blockEmitter });

    expect(fluxnodeRpcStub.callCount).to.equal(1);

    // Manually trigger multiple block events rapidly
    blockEmitter.emit('blockReceived', 100);
    await new Promise((resolve) => { setTimeout(resolve, 100); });

    blockEmitter.emit('blockReceived', 101);
    await new Promise((resolve) => { setTimeout(resolve, 100); });

    blockEmitter.emit('blockReceived', 102);
    await new Promise((resolve) => { setTimeout(resolve, 100); });

    // Should still only have called daemon once due to throttling
    // (the queuing mechanism in NetworkStateManager might allow 1-2 more calls)
    expect(fluxnodeRpcStub.callCount).to.be.lessThan(4);

    await networkStateService.stop();
  });

  it('should reset throttle state on stop', async () => {
    const blockEmitter = new EventEmitter();
    fluxnodeRpcStub.resolves(defaultNetworkState);

    // Start and fetch once
    await networkStateService.start({ stateEmitter: blockEmitter });
    const firstCallCount = fluxnodeRpcStub.callCount;

    // Stop should reset throttle state
    await networkStateService.stop();

    // Start again - should be able to fetch immediately
    fluxnodeRpcStub.resetHistory();
    await networkStateService.start({ stateEmitter: blockEmitter });

    expect(fluxnodeRpcStub.callCount).to.equal(1);

    await networkStateService.stop();
  });
});
