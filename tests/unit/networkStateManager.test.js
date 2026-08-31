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
    ).to.throw('The State Event is mandatory when state emitter is used');
  });

  it('should instantiate and set user provided values', () => {
    const options = {
      intervalMs: 60_000,
      stateEvent: 'blocksProcessed',
      stateEmitter: new EventEmitter(),
    };

    const nsm = new NetworkStateManager(fetcher, options);

    expect(nsm.intervalMs).to.be.equal(60_000);
    expect(nsm.stateEvent).to.be.equal('blocksProcessed');
    expect(nsm.started).to.be.equal(false);
  });

  it('should trigger fetch on progressEvent during sync', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blocksProcessed',
      progressEvent: 'syncProgress',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    let hrtimeCallCount = 0;
    const hrtimeStub = sinon.stub(process.hrtime, 'bigint');
    hrtimeStub.callsFake(() => {
      hrtimeCallCount += 1;
      if (hrtimeCallCount <= 3) {
        return BigInt(hrtimeCallCount * 100_000_000);
      }
      return BigInt(31_000_000_000 + (hrtimeCallCount - 4) * 100_000_000);
    });

    const nsm = new NetworkStateManager(fetcher, options);

    await nsm.start();
    sinon.assert.calledOnce(fetcher);

    blockEmitter.emit('syncProgress', 500000);
    await new Promise((r) => { setImmediate(r); });

    sinon.assert.calledTwice(fetcher);

    await nsm.stop();
    hrtimeStub.restore();
  });

  it('should remove progressEvent listener on stop', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blocksProcessed',
      progressEvent: 'syncProgress',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    await nsm.stop();

    expect(blockEmitter.listenerCount('blocksProcessed')).to.equal(0);
    expect(blockEmitter.listenerCount('syncProgress')).to.equal(0);
  });

  it('should start eventEmitter fetcher and get network state on start', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blocksProcessed',
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

    blockEmitter.emit('blocksProcessed', 1946562);
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
      stateEvent: 'blocksProcessed',
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
      stateEvent: 'blocksProcessed',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search('44.192.51.11:16147', 'socketAddress');

    expect(response).to.deep.equal(expectedResponse);
  });

  describe('default-port (16127) socketAddress normalization', () => {
    const mkNode = (ip, pubkey) => ({
      collateral: `COutPoint(${pubkey}, 0)`,
      txhash: pubkey,
      outidx: '0',
      ip,
      network: '',
      added_height: 1,
      confirmed_height: 1,
      last_confirmed_height: 1,
      last_paid_height: 0,
      tier: 'CUMULUS',
      payment_address: 't1abc',
      pubkey,
      activesince: '1',
      lastpaid: '1',
      amount: '1000.00',
      rank: 0,
    });
    // bareNode: default-port node the daemon list carries WITHOUT a port.
    // portedNode: default-port node the daemon list carries WITH :16127.
    // upnpNode: explicit non-default port (must be unaffected).
    const bareNode = mkNode('203.0.113.5', 'aa'.repeat(33));
    const portedNode = mkNode('203.0.113.6:16127', 'bb'.repeat(33));
    const upnpNode = mkNode('203.0.113.7:16137', 'cc'.repeat(33));
    const state = [bareNode, portedNode, upnpNode];

    let nsm;

    beforeEach(async () => {
      fetcher.resolves(state);
      nsm = new NetworkStateManager(fetcher, {
        stateEvent: 'blocksProcessed',
        stateEmitter: new EventEmitter(),
      });
      await nsm.start();
    });

    it('resolves a bare-listed default-port node when queried with :16127', async () => {
      expect(await nsm.search('203.0.113.5:16127', 'socketAddress')).to.deep.equal(bareNode);
    });

    it('resolves a bare-listed default-port node when queried bare', async () => {
      expect(await nsm.search('203.0.113.5', 'socketAddress')).to.deep.equal(bareNode);
    });

    it('resolves a :16127-listed default-port node when queried bare', async () => {
      expect(await nsm.search('203.0.113.6', 'socketAddress')).to.deep.equal(portedNode);
    });

    it('includes() matches both default-port representations', async () => {
      expect(await nsm.includes('203.0.113.5:16127', 'socketAddress')).to.equal(true);
      expect(await nsm.includes('203.0.113.6', 'socketAddress')).to.equal(true);
    });

    it('leaves explicit (UPnP) ports unaffected', async () => {
      expect(await nsm.search('203.0.113.7:16137', 'socketAddress')).to.deep.equal(upnpNode);
      // a bare query normalizes to :16127 and must NOT match a non-default-port node
      expect(await nsm.search('203.0.113.7', 'socketAddress')).to.equal(null);
    });
  });

  it('should return null if searching by non existent pubkey', async () => {
    const blockEmitter = new EventEmitter();

    const options = {
      stateEvent: 'blocksProcessed',
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
      stateEvent: 'blocksProcessed',
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
      stateEvent: 'blocksProcessed',
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
      stateEvent: 'blocksProcessed',
      stateEmitter: blockEmitter,
    };

    fetcher.resolves(defaultNetworkState);

    const nsm = new NetworkStateManager(fetcher, options);
    await nsm.start();

    const response = await nsm.search('1.1.1.1:16137', 'badSearchType');
    expect(response).to.equal(null);
  });

  describe('lookups before the first population', () => {
    const knownPubkey = '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';

    let nsm;
    let releaseFetch;

    async function flush() {
      await new Promise((r) => { setImmediate(r); });
    }

    beforeEach(() => {
      const blockEmitter = new EventEmitter();

      const options = {
        stateEvent: 'blocksProcessed',
        stateEmitter: blockEmitter,
      };

      const firstFetch = new Promise((resolve) => { releaseFetch = resolve; });

      fetcher.callsFake(async () => {
        await firstFetch;
        return defaultNetworkState;
      });

      nsm = new NetworkStateManager(fetcher, options);
    });

    it('does not report a node absent while the fleet is still unknown', async () => {
      const startPromise = nsm.start();

      let answered = false;
      let found = null;

      async function askEarly() {
        found = await nsm.includes(knownPubkey, 'pubkey');
        answered = true;
      }

      const lookup = askEarly();

      await flush();

      expect(answered).to.equal(false);

      releaseFetch();
      await startPromise;
      await lookup;

      expect(found).to.equal(true);

      await nsm.stop();
    });

    it('does not draw a null peer while the fleet is still unknown', async () => {
      const startPromise = nsm.start();

      let answered = false;
      let address = null;

      async function askEarly() {
        address = await nsm.getRandomSocketAddress('203.0.113.1:16127');
        answered = true;
      }

      const lookup = askEarly();

      await flush();

      expect(answered).to.equal(false);

      releaseFetch();
      await startPromise;
      await lookup;

      expect(address).to.be.a('string');

      await nsm.stop();
    });

    it('answers absent once a fetch has come back empty', async () => {
      fetcher.callsFake(async () => []);

      // start() does not resolve here: the loop keeps asking until it gets a
      // fleet. The lookup is what has to come back - an empty list is a
      // truthful "absent", not a state that cannot answer.
      const startPromise = nsm.start();

      const response = await nsm.search(knownPubkey, 'pubkey');

      expect(response).to.equal(null);

      await nsm.stop();

      try {
        await startPromise;
      } catch (error) {
        // stopping interrupts the retry sleep, which is how the loop ends here
      }
    });

    it('arms no refresh loop when the stop lands after a retry sleep', async () => {
      // The one way into it. A fetch that comes back empty sleeps before asking
      // again; aborting DURING that sleep rejects it and start() throws, so it
      // never reaches the updater. Aborting once the sleep has fired is the
      // narrow case that gets through: the loop wakes, sees the abort at the
      // top, breaks without populating, and start() carries on to arm a loop on
      // a manager that has just been torn down.
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });

      try {
        fetcher.callsFake(async () => []);

        const startPromise = nsm.start();

        // First fetch comes back empty and the retry sleep is armed.
        await clock.tickAsync(0);
        const askedBeforeSleep = fetcher.callCount;
        expect(askedBeforeSleep).to.be.greaterThan(0);

        // Fire the sleep rather than abort it: the timer is consumed here, so
        // the abort below has no timeout left to reject. tick() rather than
        // tickAsync() so the loop has not resumed and armed the NEXT sleep -
        // aborting that one rejects it and start() throws instead, which is the
        // path that already cannot arm anything.
        clock.tick(15_000);

        const stopPromise = nsm.stop();
        await startPromise;
        await stopPromise;

        // A refresh loop would keep asking. Nothing should be asking now.
        const askedAfterStop = fetcher.callCount;
        await clock.tickAsync(120_000);

        expect(fetcher.callCount).to.equal(askedAfterStop);
      } finally {
        clock.restore();
      }
    });

    describe('after a stop, on the same instance', () => {
      // stop() empties the indexes, so the instance must stop saying it can
      // answer from them - otherwise a restarted manager reports every node
      // absent until its own first fetch lands, which is the defect this whole
      // class of wait exists to close.
      //
      // Nothing restarts one in production: networkStateService drops the
      // instance and builds a fresh one. That is the service's arrangement
      // though, not a promise this class makes about itself.

      // A fetcher held shut until the test says otherwise, so a restart can be
      // examined in the window between start() and the fetch coming back.
      // Held by whichever promise is current when a run begins: the loop is
      // free to ask more than once, and every one of those waits.
      function gatedFetcher() {
        let open;
        let shut;

        function close() {
          shut = new Promise((resolve) => { open = resolve; });
        }

        close();

        fetcher.callsFake(async () => {
          await shut;
          return defaultNetworkState;
        });

        return {
          close,
          async release() {
            open();
            await flush();
          },
        };
      }

      async function startAndPopulate(gate) {
        const started = nsm.start();
        await gate.release();
        await started;
        gate.close();
      }

      it('reports itself un-started, so nothing arms a loop on it', async () => {
        // start() only switches on the refresh loop for a manager that got its
        // list. Leaving `started` true after a stop tells it - and isReady() -
        // that a torn-down manager is running.
        const gate = gatedFetcher();

        await startAndPopulate(gate);
        expect(nsm.started).to.equal(true);

        await nsm.stop();

        expect(nsm.started).to.equal(false);
      });

      it('does not answer from the empty index until its own fetch returns', async () => {
        const gate = gatedFetcher();

        await startAndPopulate(gate);
        expect(await nsm.includes(knownPubkey, 'pubkey')).to.equal(true);

        await nsm.stop();

        const restarted = nsm.start();

        let answered = false;
        const lookup = nsm.includes(knownPubkey, 'pubkey').then((found) => {
          answered = true;
          return found;
        });

        await flush();

        // The index is empty here. Answering at all would answer `false`.
        expect(answered).to.equal(false);

        await gate.release();
        await restarted;

        expect(await lookup).to.equal(true);

        await nsm.stop();
      });

      it('holds every lookup that can report a node absent, not just one', async () => {
        const gate = gatedFetcher();

        await startAndPopulate(gate);
        await nsm.stop();

        const restarted = nsm.start();

        const answered = { search: false, includes: false, random: false };
        const lookups = [
          nsm.search(knownPubkey, 'pubkey').then(() => { answered.search = true; }),
          nsm.includes(knownPubkey, 'pubkey').then(() => { answered.includes = true; }),
          nsm.getRandomSocketAddress('203.0.113.1:16127').then(() => { answered.random = true; }),
        ];

        await flush();

        expect(answered).to.deep.equal({ search: false, includes: false, random: false });

        await gate.release();
        await restarted;
        await Promise.all(lookups);

        expect(answered).to.deep.equal({ search: true, includes: true, random: true });

        await nsm.stop();
      });

      it('answers absent promptly when the restarted fleet comes back empty', async () => {
        // The rewind must not turn the legitimately empty fleet into a hang:
        // a fetch that comes back with nothing is a truthful "absent".
        const gate = gatedFetcher();

        await startAndPopulate(gate);
        await nsm.stop();

        fetcher.callsFake(async () => []);

        const restarted = nsm.start();

        expect(await nsm.includes(knownPubkey, 'pubkey')).to.equal(false);

        await nsm.stop();

        try {
          await restarted;
        } catch (error) {
          // the retry loop ends by being stopped, as it does elsewhere here
        }
      });

      it('rewinds on every stop, not only the first', async () => {
        const gate = gatedFetcher();

        await startAndPopulate(gate);
        await nsm.stop();
        await startAndPopulate(gate);
        await nsm.stop();

        const restarted = nsm.start();

        let answered = false;
        const lookup = nsm.includes(knownPubkey, 'pubkey').then(() => { answered = true; });

        await flush();

        expect(answered).to.equal(false);

        await gate.release();
        await restarted;
        await lookup;

        expect(answered).to.equal(true);

        await nsm.stop();
      });
    });

    it('releases a waiting lookup when the manager is stopped', async () => {
      const startPromise = nsm.start();

      const lookup = nsm.search(knownPubkey, 'pubkey');

      await flush();

      // The fleet never arrives here. A stop is the other way a lookup becomes
      // answerable: no population is coming, so a waiter still holding out for
      // one would never return.
      await nsm.stop();

      const response = await lookup;

      expect(response).to.equal(null);

      releaseFetch();
      await startPromise;
    });
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
      stateEvent: 'blocksProcessed',
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

    blockEmitter.emit('blocksProcessed', 1946562);
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
      stateEvent: 'blocksProcessed',
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

    blockEmitter.emit('blocksProcessed', 1946562);
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
      blockEmitter.emit('blocksProcessed', blockCount);
    };

    const options = {
      stateEvent: 'blocksProcessed',
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

  describe('drawing a peer to ask', () => {
    // A node that only needs an ip: the picker indexes on socketAddress and the
    // rest of the record is not read on this path.
    const nodeAt = (ip) => ({
      collateral: `COutPoint(${ip}, 0)`,
      txhash: ip,
      outidx: '0',
      ip,
      network: '',
      added_height: 1,
      confirmed_height: 1,
      last_confirmed_height: 1,
      last_paid_height: 1,
      tier: 'CUMULUS',
      payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
      pubkey: ip,
      activesince: '1',
      lastpaid: '1',
      amount: '1000.00',
      rank: 0,
    });

    async function fleetOf(...ips) {
      fetcher.callsFake(async () => ips.map(nodeAt));
      const nsm = new NetworkStateManager(fetcher);
      await nsm.start();
      return nsm;
    }

    it('never returns this node, however the draw lands', async () => {
      const nsm = await fleetOf('10.0.0.1:16127', '10.0.0.2:16127', '10.0.0.3:16127');

      for (let i = 0; i < 50; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        expect(await nsm.getRandomSocketAddress('10.0.0.1:16127')).to.not.equal('10.0.0.1:16127');
      }

      await nsm.stop();
    });

    it('answers nothing rather than throwing when this node is the only one', async () => {
      // The old draw took "the one before, or else the next" without checking
      // either existed, so a single-node fleet threw instead of answering absent.
      const nsm = await fleetOf('10.0.0.1:16127');

      expect(await nsm.getRandomSocketAddress('10.0.0.1:16127')).to.equal(null);

      await nsm.stop();
    });

    describe('an external observer', () => {
      it('is never a node at our own address', async () => {
        // Four nodes behind one router, one stranger. Only the stranger can
        // report what our address looks like from outside it.
        const nsm = await fleetOf(
          '10.0.0.1:16127', '10.0.0.1:16137', '10.0.0.1:16147', '10.0.0.1:16157',
          '203.0.113.9:16127',
        );

        for (let i = 0; i < 50; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          expect(await nsm.getRandomExternalObserver('10.0.0.1:16127')).to.equal('203.0.113.9:16127');
        }

        await nsm.stop();
      });

      it('is absent when every other node shares our address', async () => {
        // The answer that matters: not a neighbour drawn anyway, and not a
        // throw - nothing, so the caller can say it learned nothing.
        const nsm = await fleetOf('10.0.0.1:16127', '10.0.0.1:16137', '10.0.0.1:16147');

        expect(await nsm.getRandomExternalObserver('10.0.0.1:16127')).to.equal(null);

        await nsm.stop();
      });

      it('still excludes us when we are the only node', async () => {
        const nsm = await fleetOf('10.0.0.1:16127');

        expect(await nsm.getRandomExternalObserver('10.0.0.1:16127')).to.equal(null);

        await nsm.stop();
      });
    });
  });
});
