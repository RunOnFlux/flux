const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('node:events');

const { NetworkStateManager } = require('../../ZelBack/src/services/utils/networkStateManager');

describe('networkStateManager tests', () => {
  let fetcher;

  const defaultNetworkState = [
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
  ];

  beforeEach(async () => {
    fetcher = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should instantiate and set default values', () => {
    const nsm = new NetworkStateManager(fetcher);

    expect(nsm.intervalMs).to.be.equal(120_000);
    expect(nsm.stateEvent).to.be.equal(null);
    expect(nsm.started).to.be.equal(false);
  });

  it('should throw if state fetcher not provided on instantiation', () => {
    expect(
      () => new NetworkStateManager(),
    ).to.throw('State fetcher function is mandatory');
  });

  it('should throw if state event not provided when using a state emitter', () => {
    expect(
      () => new NetworkStateManager(fetcher, { stateEmitter: new EventEmitter() }),
    ).to.throw('The State Event is mandatory is state emitter is used');
  });

  it('should instantiate and set user provided values', () => {
    const options = {
      intervalMs: 60_000,
      stateEvent: 'blockReceived',
      stateEmitter: new EventEmitter(),
    };

    const nsm = new NetworkStateManager(fetcher, options);

    expect(nsm.intervalMs).to.be.equal(60_000);
    expect(nsm.stateEvent).to.be.equal('blockReceived');
    expect(nsm.started).to.be.equal(false);
  });

  it('should start eventEmitter fetcher and get network state on start', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    // Stub process.hrtime.bigint() to simulate time progression beyond throttle
    let hrtimeCallCount = 0;
    const hrtimeStub = sinon.stub(process.hrtime, 'bigint');
    hrtimeStub.callsFake(() => {
      hrtimeCallCount += 1;
      // First 3 calls are for initial fetch (start, end, index timing)
      if (hrtimeCallCount <= 3) {
        return BigInt(hrtimeCallCount * 100_000_000); // 0, 100ms, 200ms
      }
      // After initial fetch, simulate 31 seconds have passed for canFetch check
      return BigInt(31_000_000_000 + (hrtimeCallCount - 4) * 100_000_000);
    });

    const nsm = new NetworkStateManager(fetcher, options);

    sinon.assert.notCalled(fetcher);

    await nsm.start();

    sinon.assert.calledOnce(fetcher);

    blockEmitter.emit('blockReceived', 1946562);
    // we yield to the event queue here so the state fetcher has a chance to run
    await new Promise((r) => { setImmediate(r); });

    sinon.assert.calledTwice(fetcher);
  });

  it('should return filter map when searching state by pubkey', async () => {
    const expectedResponse = new Map(
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
          '44.192.51.11:16147',
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

    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search(
      '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
      'pubkey',
    );

    expect(response).to.deep.equal(expectedResponse);
  });

  it('should return fluxnode object when searching by socket address', async () => {
    const expectedResponse = {
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
    };

    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search('44.192.51.11:16147', 'socketAddress');

    expect(response).to.deep.equal(expectedResponse);
  });

  it('should return null if searching by non existent pubkey', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search('DOESNOTEXIST0a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc', 'pubkey');
    expect(response).to.equal(null);
  });

  it('should return null if searching by non existent socketAddress', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search('1.1.1.1:16137', 'socketAddress');
    expect(response).to.equal(null);
  });

  it('should return null if searching by malformed filter', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search(null, 'socketAddress');
    expect(response).to.equal(null);
  });

  it('should return null if searching by malformed type', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search('1.1.1.1:16137', 'badSearchType');
    expect(response).to.equal(null);
  });

  it('should set the indexesReady property to false if indexes are being built', async () => {
    const dummyElement = {
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
    };

    const networkState = Array(1001).fill(dummyElement);

    let networkFetchCount = 0;

    const nodeFetcher = async () => {
      if (!networkFetchCount) {
        networkFetchCount += 1;
        return defaultNetworkState;
      }

      return networkState;
    };

    fetcher.callsFake(nodeFetcher);

    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    // Stub process.hrtime.bigint() to simulate time progression beyond throttle
    let hrtimeCallCount = 0;
    const hrtimeStub = sinon.stub(process.hrtime, 'bigint');
    hrtimeStub.callsFake(() => {
      hrtimeCallCount += 1;
      // First 3 calls are for initial fetch (start, end, index timing)
      if (hrtimeCallCount <= 3) {
        return BigInt(hrtimeCallCount * 100_000_000); // 0, 100ms, 200ms
      }
      // After initial fetch, simulate 31 seconds have passed for canFetch check
      return BigInt(31_000_000_000 + (hrtimeCallCount - 4) * 100_000_000);
    });

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    // the process flow here is as follows:

    // the emit is synchronous, so the event emitter callback is run immediately,
    // however that is a call to setImmediate, so it then schedules the fetchNetwork
    // state task in the macrotask queue, then yields.

    // control flow then returns here. We then await a promise, which is as task in
    // // the microtask queue, and the executor schedules the setImmediate in
    // the next cycle. The macrotask queue then runs, which has
    // a callback to run in the macrotask queue, then yields.

    // the macrotask queue is then run, which is the fetchNetworkState, this hits an await
    // for the stateFetcher, so schedules than in the microtask queue then yields.

    // we then run the microtask queue, which has our promise below, so the setImmediate
    // is queued. We then schedule the buildIndexes in the microtask queue, which
    // schedules the lock enable. The build indexes then hits the setImmediate which
    // is what allows the promise below to resolve.

    // then the expect runs, where the index building is mid stroke. This only works
    // because our index is greater than 1k, so the setImmediate callback is scheduled

    // This may not be 100% correct - but it's pretty close (and works)

    blockEmitter.emit('blockReceived', 1946562);
    await new Promise((r) => { setImmediate(r); });

    expect(nsm.indexesReady).to.be.equal(false);

    await new Promise((r) => { setImmediate(r); });

    expect(nsm.indexesReady).to.be.equal(true);
  });

  it('should wait for the indexes to be ready if indexes are being built', async () => {
    const dummyElement = {
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
    };

    const networkState = Array(5000).fill(dummyElement);
    // add a different ip so the indexes are different
    networkState.push({
      collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
      txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
      outidx: '0',
      ip: '1.2.3.4:16147',
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
    });

    let networkFetchCount = 0;

    const nodeFetcher = async () => {
      if (!networkFetchCount) {
        networkFetchCount += 1;
        return defaultNetworkState;
      }

      return networkState;
    };

    fetcher.callsFake(nodeFetcher);

    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    // Stub process.hrtime.bigint() to simulate time progression beyond throttle
    let hrtimeCallCount = 0;
    const hrtimeStub = sinon.stub(process.hrtime, 'bigint');
    hrtimeStub.callsFake(() => {
      hrtimeCallCount += 1;
      // First 3 calls are for initial fetch (start, end, index timing)
      if (hrtimeCallCount <= 3) {
        return BigInt(hrtimeCallCount * 100_000_000); // 0, 100ms, 200ms
      }
      // After initial fetch, simulate 31 seconds have passed for canFetch check
      return BigInt(31_000_000_000 + (hrtimeCallCount - 4) * 100_000_000);
    });

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const indexBefore = await nsm.search('04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc', 'pubkey');

    blockEmitter.emit('blockReceived', 1946562);
    await new Promise((r) => { setImmediate(r); });

    expect(nsm.indexesReady).to.be.equal(false);

    const indexAfter = await nsm.search('04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc', 'pubkey');

    expect(nsm.indexesReady).to.be.equal(true);
    expect(indexBefore).to.not.be.deep.equal(indexAfter);
  });

  it('should handle multiple blocks immediately after each other', async () => {
    const networkIps = ['44.192.51.11:16147', '54.192.51.11:16147', '64.192.51.11:16147', '74.192.51.11:16147', '84.192.51.11:16147'];

    const dummyElement = {
      collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
      txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
      outidx: '0',
      ip: networkIps[0],
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
    };

    const networkState = Array(5000).fill(dummyElement);
    const blockEmitter = new EventEmitter();
    const fetchtime = 500;
    let callCounter = 0;

    const nodeFetcher = async () => {
      callCounter += 1;

      dummyElement.ip = networkIps[callCounter];
      networkState.push(dummyElement);

      await new Promise(((r) => { setTimeout(r, fetchtime); }));

      return networkState;
    };

    fetcher.callsFake(nodeFetcher);

    let blockCount = 1234567;

    const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });

    // Stub process.hrtime.bigint() to simulate time progression beyond throttle
    // We need to coordinate with the fake timer to ensure throttling allows fetches
    let hrtimeCallCount = 0;
    let fetchPhase = 0; // Track which fetch we're in (0=start, 1=first block, 2=queued, etc)
    const hrtimeStub = sinon.stub(process.hrtime, 'bigint');
    hrtimeStub.callsFake(() => {
      hrtimeCallCount += 1;
      // Each fetch phase gets 31+ seconds to ensure throttle allows it
      // Within a phase, time advances by small amounts for timing calculations
      const phaseBaseTime = BigInt(fetchPhase * 31_000_000_000);
      const withinPhaseTime = BigInt(hrtimeCallCount * 100_000_000);
      return phaseBaseTime + withinPhaseTime;
    });

    const emitBlock = () => {
      blockCount += 1;
      blockEmitter.emit('blockReceived', blockCount);
    };

    const options = {
      stateEvent: 'blockReceived',
      stateEmitter: blockEmitter,
    };

    const nsm = new NetworkStateManager(fetcher, options);
    const startPromise = nsm.start();
    await clock.tickAsync(fetchtime);
    await startPromise;

    // Advance to next fetch phase before emitting blocks
    fetchPhase = 1;

    emitBlock();
    emitBlock();
    emitBlock();

    // just to get the clock moving
    await clock.tickAsync(10);

    expect(nsm.fetchQueued).to.be.true;
    // one call was from the initial startup
    expect(callCounter).to.be.equal(2);

    // Advance to next fetch phase before the queued fetch runs
    fetchPhase = 2;

    await clock.tickAsync(fetchtime);
    expect(callCounter).to.be.equal(3);

    await clock.tickAsync(fetchtime);
    expect(callCounter).to.be.equal(3);

    await nsm.waitIndexesReady;
    expect(nsm.fetchQueued).to.be.false;
    expect(nsm.indexesReady).to.be.true;

    // do one more block, to make sure it will still process blocks
    // Advance to next fetch phase before emitting the block
    fetchPhase = 3;

    emitBlock();
    await clock.tickAsync(fetchtime);
    expect(callCounter).to.be.equal(4);
    expect(nsm.indexesReady).to.be.false;
    await nsm.waitIndexesReady;
    expect(nsm.indexesReady).to.be.true;
  });
});
