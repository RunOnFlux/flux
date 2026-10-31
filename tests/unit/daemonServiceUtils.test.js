const os = require('node:os');
const fs = require('node:fs/promises');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

const { FluxTTLCache } = require('../../ZelBack/src/services/utils/cacheManager');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

const proxyquire = require('proxyquire').noCallThru();

const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('daemonServiceUtils tests', () => {
  describe('reading flux.conf', () => {
    // A config whose parse can be held open, so the window between "being read" and "read"
    // is observable rather than a race.
    const heldConfig = () => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      class DaemonConfig {
        constructor() { this.configElements = {}; }

        async parseConfig() {
          await held;
          this.configElements = { zelnodeprivkey: 'akey' };
          return true;
        }

        get(name) { return this.configElements[name]; }
      }
      const module = proxyquire('../../ZelBack/src/services/daemonService/daemonServiceUtils', {
        '../utils/daemonConfig': { DaemonConfig },
      });
      return { module, release };
    };

    it('does not tell a caller arriving mid-parse that the config is ready', async () => {
      // Publishing the config before parsing it left a window where it was set and empty.
      // A caller in that window is not told "not yet" - it is told the file is read, and
      // goes on to find nothing in it. That is exactly when callers arrive, since
      // everything wants its key at boot.
      //
      // Asserting the value here would prove nothing: an unpublished config and a published
      // empty one both answer undefined. What separates them is what the second caller is
      // told, which is the thing that decides whether it waits.
      const { module, release } = heldConfig();

      const first = module.ensureConfigLoaded();
      await new Promise((resolve) => { setImmediate(resolve); });

      let secondDone = false;
      const second = module.ensureConfigLoaded().then(() => { secondDone = true; });
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(secondDone, 'it was told the config was ready while it was still being read')
        .to.equal(false);

      release();
      await Promise.all([first, second]);
      expect(module.getConfigValue('zelnodeprivkey')).to.equal('akey');
    });

    it('answers from the parsed config once it has one', async () => {
      const { module, release } = heldConfig();
      release();
      await module.ensureConfigLoaded();
      await module.ensureConfigLoaded();
      expect(module.getConfigValue('zelnodeprivkey')).to.equal('akey');
    });
  });

  describe('where fluxd is reached from', () => {
    // A node whose unit passes the node key as a credential: flux.conf must never
    // be read, the login is fluxd's cookie, and fluxd is asked about itself.
    const node = ({ credential = null, cookies = [], conf = null } = {}) => {
      const state = {
        cookieReads: 0, cookiePaths: [], clients: [], batches: [], parsed: 0, resolved: 0, delays: 0,
      };
      class DaemonConfig {
        constructor() { this.configElements = {}; }

        get dataDir() { return '/home/node/.flux'; }

        async parseConfig() {
          state.parsed += 1;
          this.configElements = conf ?? {
            zelnodeprivkey: 'filekey', insightexplorer: '1', addressindex: '0', rpcuser: 'u', rpcpassword: 'p',
          };
          return true;
        }

        async resolvePaths() { state.resolved += 1; }

        get rpcuser() { return this.configElements.rpcuser; }

        get rpcpassword() { return this.configElements.rpcpassword; }

        get rpcport() { return null; }

        get(name) { return this.configElements[name]; }

        async write() { state.written = true; }
      }
      class FluxRpc {
        constructor(uri, options) {
          this.auth = options.auth;
          state.clients.push(this);
        }

        async run(method) {
          if (state.refuse && state.refuse(this)) {
            const error = new Error('Request failed with status code 401');
            error.status = 401;
            throw error;
          }
          if (state.fail) throw state.fail;
          return `${method}-result`;
        }

        async runBatch(calls) {
          state.batches.push(calls.map((c) => c.method));
          if (state.batchFails) {
            state.batchFails -= 1;
            throw new Error('batch refused');
          }
          return calls.map(({ method }, id) => {
            if (state.methodFails?.[method]) {
              return { id, result: null, error: { code: -32601, message: 'Method not found' } };
            }
            const result = method === 'getindexinfo'
              ? (state.indexes ?? { txindex: {}, addressindex: {} })
              : [{ type: 'pubhashblock', address: 'tcp://127.0.0.1:16123' }];
            return { id, result, error: null };
          });
        }
      }
      const module = proxyquire('../../ZelBack/src/services/daemonService/daemonServiceUtils', {
        '../utils/daemonConfig': { DaemonConfig },
        '../utils/fluxRpc': { FluxRpc },
        // The retry delay is instant; the refetch spacing reads state.now.
        '../serviceHelper': { ...serviceHelper, delay: async () => { state.delays += 1; } },
        './fluxdCredentials': {
          loadNodeKey: async () => credential,
          RPC_COOKIE_FILE: '/run/fluxd/rpc.cookie',
          readRpcCookie: async (file) => {
            state.cookiePaths.push(file);
            state.cookieReads += 1;
            return cookies[Math.min(state.cookieReads, cookies.length) - 1] ?? null;
          },
        },
      });
      return { module, state };
    };
    const cookieA = { username: '__cookie__', password: 'a' };
    const cookieB = { username: '__cookie__', password: 'b' };

    it('reads flux.conf when the unit passes no node key', async () => {
      const { module, state } = node();
      expect(module.insightIndexes()).to.equal(null);
      expect(module.addressIndex()).to.equal(null);
      await module.buildFluxdClient();
      expect(state.parsed).to.equal(1);
      expect(module.isFluxdSelfReporting()).to.equal(false);
      expect(module.getConfigValue('zelnodeprivkey')).to.equal('filekey');
      expect(state.clients[0].auth).to.eql({ username: 'u', password: 'p' });
      expect(module.insightIndexes()).to.equal(true);
      expect(module.addressIndex()).to.equal(false);
      await module.executeCall('getblockcount', [], { useCache: false });
      expect(state.batches, 'fluxd is asked about itself only when it reports itself').to.eql([]);
    });

    it('never reads flux.conf when the unit passes the node key', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
      await module.buildFluxdClient();
      expect(state.parsed).to.equal(0);
      expect(state.resolved).to.equal(1);
      expect(module.isFluxdSelfReporting()).to.equal(true);
      expect(module.getConfigValue('zelnodeprivkey')).to.equal('credkey');
      expect(module.getConfigValue('rpcpassword')).to.equal(undefined);
      expect(state.clients[0].auth).to.eql(cookieA);
      await expect(module.writeFluxdConfig()).to.be.rejectedWith('not FluxOS');
      expect(state.written).to.equal(undefined);
    });

    it('learns fluxd\'s indexes and ZMQ notifications before its first answer returns', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
      await module.buildFluxdClient();
      expect(module.addressIndex()).to.equal(null);
      expect(module.insightIndexes()).to.equal(null);

      const answer = await module.executeCall('getblockcount', [], { useCache: false });
      expect(answer.status).to.equal('success');
      expect(state.batches).to.eql([['getindexinfo', 'getzmqnotifications']]);
      expect(module.addressIndex()).to.equal(true);
      expect(module.insightIndexes()).to.equal(true);
      expect(module.getConfigValue('zmqpubhashblock')).to.equal('tcp://127.0.0.1:16123');
      expect(module.getConfigValue('zmqpubrawtx')).to.equal(undefined);

      await module.executeCall('getblockcount', [], { useCache: false });
      expect(state.batches, 'asked once per start of fluxd').to.have.length(1);
    });

    it('answers no index when fluxd keeps none', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
      state.indexes = { txindex: {} };
      await module.executeCall('getblockcount', [], { useCache: false });
      expect(module.addressIndex()).to.equal(false);
      expect(module.insightIndexes()).to.equal(false);
    });

    it('reads the cookie again on a 401, and asks fluxd about itself again', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA, cookieB] });
      await module.executeCall('getblockcount', [], { useCache: false });
      expect(state.batches).to.have.length(1);

      // fluxd restarted: the old cookie is refused.
      state.refuse = (client) => client.auth?.password === 'a';
      const answer = await module.executeCall('getblockcount', [], { useCache: false });
      expect(answer.status).to.equal('success');
      expect(state.cookieReads).to.equal(2);
      expect(state.clients.at(-1).auth).to.eql(cookieB);
      expect(state.batches, 'what fluxd reported before it restarted is asked again').to.have.length(2);
    });

    it('reads the cookie once per refusal, and reports a second refusal', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
      await module.buildFluxdClient();
      state.refuse = () => true;
      const answer = await module.executeCall('getblockcount', [], { useCache: false });
      expect(answer.status).to.equal('error');
      expect(state.cookieReads).to.equal(2);
      expect(module.addressIndex()).to.equal(null);
    });

    it('does not read the cookie again for an error that is not a refused login', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
      await module.buildFluxdClient();
      state.fail = Object.assign(new Error('Loading block index...'), { code: -28 });
      const answer = await module.executeCall('getblockcount', [], { useCache: false });
      expect(answer.status).to.equal('error');
      expect(state.cookieReads).to.equal(1);
      expect(state.batches, 'fluxd is asked about itself only once it answers').to.eql([]);
    });

    describe('a flux.conf that sets no rpcpassword', () => {
      // fluxd then authenticates only with its cookie: an image that has moved
      // flux.conf to the cookie, run by FluxOS without the credential.
      [
        [{ rpccookiefile: '/run/fluxd/rpc.cookie' }, '/run/fluxd/rpc.cookie'],
        [{ rpccookiefile: 'rpc.cookie' }, '/home/node/.flux/rpc.cookie'],
        [{}, '/home/node/.flux/.cookie'],
      ].forEach(([extra, expected]) => {
        it(`logs in with the cookie at ${expected}`, async () => {
          const { module, state } = node({ cookies: [cookieA], conf: { zelnodeprivkey: 'filekey', ...extra } });
          await module.buildFluxdClient();
          expect(module.isFluxdSelfReporting()).to.equal(false);
          expect(state.cookiePaths).to.eql([expected]);
          expect(state.clients[0].auth).to.eql(cookieA);
        });
      });

      it('reads the cookie again on a 401, and is never asked about itself', async () => {
        const { module, state } = node({ cookies: [cookieA, cookieB], conf: { rpccookiefile: '/run/fluxd/rpc.cookie' } });
        await module.buildFluxdClient();
        state.refuse = (client) => client.auth?.password === 'a';
        const answer = await module.executeCall('getblockcount', [], { useCache: false });
        expect(answer.status).to.equal('success');
        expect(state.clients.at(-1).auth).to.eql(cookieB);
        expect(state.batches).to.eql([]);
      });
    });

    it('with no flux.conf, reads the cookie in fluxd\'s default directory and answers fluxd being down as an error', async () => {
      const hostPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      sinon.stub(os, 'homedir').returns('/home/node');
      sinon.stub(fs, 'stat').rejects(new Error('ENOENT'));
      const cookiePaths = [];
      class FluxRpc {
        // eslint-disable-next-line class-methods-use-this
        async run() { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }
      }
      const module = proxyquire('../../ZelBack/src/services/daemonService/daemonServiceUtils', {
        '../utils/fluxRpc': { FluxRpc },
        './fluxdCredentials': {
          loadNodeKey: async () => null,
          RPC_COOKIE_FILE: '/run/fluxd/rpc.cookie',
          readRpcCookie: async (file) => { cookiePaths.push(file); return null; },
        },
      });

      try {
        const answer = await module.executeCall('getblockcount', [], { useCache: false });
        expect(answer.status).to.equal('error');
        expect(cookiePaths).to.eql(['/home/node/.flux/.cookie']);
      } finally {
        Object.defineProperty(process, 'platform', { value: hostPlatform });
        sinon.restore();
      }
    });

    it('a 401 on a node that reads flux.conf is an error, not a cookie to read', async () => {
      const { module, state } = node({ cookies: [cookieA] });
      await module.buildFluxdClient();
      state.refuse = () => true;
      const answer = await module.executeCall('getblockcount', [], { useCache: false });
      expect(answer.status).to.equal('error');
      expect(state.cookieReads).to.equal(0);
    });

    describe('when fluxd does not report its facts', () => {
      let now;
      beforeEach(() => {
        now = 1_000_000;
        sinon.stub(Date, 'now').callsFake(() => now);
      });
      afterEach(() => sinon.restore());

      it('retries before fluxd\'s first answer returns, so one failure does not decide the address-index check', async () => {
        const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
        state.batchFails = 2;
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(state.batches).to.have.length(3);
        expect(state.delays).to.equal(2);
        expect(module.addressIndex()).to.equal(true);
      });

      it('keeps the indexes when only the ZMQ notifications fail, and asks only for those again', async () => {
        const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
        state.methodFails = { getzmqnotifications: true };
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(module.addressIndex(), 'the index answer is kept').to.equal(true);
        expect(module.getConfigValue('zmqpubhashblock')).to.equal(undefined);
        expect(state.batches.slice(1)).to.eql([['getzmqnotifications'], ['getzmqnotifications']]);

        state.methodFails = {};
        now += 30_000;
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(state.batches.at(-1)).to.eql(['getzmqnotifications']);
        expect(module.getConfigValue('zmqpubhashblock')).to.equal('tcp://127.0.0.1:16123');
      });

      it('does not ask again within 30 s of a fetch that left a fact unknown', async () => {
        const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
        state.batchFails = 10;
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(module.addressIndex()).to.equal(null);
        const asked = state.batches.length;

        now += 29_999;
        await module.executeCall('getblockcount', [], { useCache: false });
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(state.batches, 'no fetch inside 30 s').to.have.length(asked);

        state.batchFails = 0;
        now += 1;
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(module.addressIndex()).to.equal(true);
      });

      it('asks again at once after fluxd restarts, whatever failed before', async () => {
        const { module, state } = node({ credential: 'credkey', cookies: [cookieA, cookieB] });
        state.batchFails = 10;
        await module.executeCall('getblockcount', [], { useCache: false });
        state.batchFails = 0;
        state.refuse = (client) => client.auth?.password === 'a';
        await module.executeCall('getblockcount', [], { useCache: false });
        expect(module.addressIndex()).to.equal(true);
      });
    });

    it('shares one request among callers arriving together', async () => {
      const { module, state } = node({ credential: 'credkey', cookies: [cookieA] });
      await Promise.all([1, 2, 3].map(() => module.executeCall('getblockcount', [], { useCache: false })));
      expect(state.batches).to.have.length(1);
    });
  });

  describe('executeCall tests', () => {
    let getSpy;
    beforeEach(() => {
      getSpy = sinon.spy(FluxTTLCache.prototype, 'get');
    });

    afterEach(() => {
      daemonServiceUtils.setFluxdClient(null);
      sinon.restore();
    });

    it('should return getBlock from cache if it exists', async () => {
      const rpc = 'getBlock';
      const params = ['testing1', 'testing2'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      daemonServiceUtils.setBlockCache(key, data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
    });

    it('should return getRawTransaction from cache if it exists', async () => {
      const rpc = 'getRawTransaction';
      const params = ['testing3', 'testing4'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      daemonServiceUtils.setRawTxCache(key, data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
    });

    it('should return data from cache if it exists', async () => {
      const rpc = 'getInfo';
      const params = ['testing3', 'testing4'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      daemonServiceUtils.setStandardCache(key, data);

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
    });

    it('should call rpc client if getBlock data is not cached ', async () => {
      const rpc = 'getBlock';
      const params = ['getBlockParam'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      const daemonRpcClientStub = sinon.stub().resolves(data);

      daemonServiceUtils.setFluxdClient({ run: daemonRpcClientStub });
      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
      sinon.assert.calledOnceWithExactly(daemonRpcClientStub, rpc, { params });
      expect(daemonServiceUtils.getBlockCache(key)).to.eql(data);
    });

    it('should call rpc client if getRawTransaction data is not cached ', async () => {
      const rpc = 'getRawTransaction';
      const params = ['getRawTransactionParam'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      const daemonRpcClientStub = sinon.stub().resolves(data);
      daemonServiceUtils.setFluxdClient({ run: daemonRpcClientStub });

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
      sinon.assert.calledOnceWithExactly(daemonRpcClientStub, rpc, { params });
      expect(daemonServiceUtils.getRawTxCacheCache(key)).to.eql(data);
    });

    it('should call rpc client if any other rpc call data is not cached ', async () => {
      const rpc = 'getInfo';
      const params = ['testingcallParam'];
      const key = rpc + JSON.stringify(params);
      const data = 'testvalue';
      const expectedSuccessMessage = {
        status: 'success',
        data,
      };
      const daemonRpcClientStub = sinon.stub().resolves(data);
      daemonServiceUtils.setFluxdClient({ run: daemonRpcClientStub });

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(getSpy, key);
      sinon.assert.calledOnceWithExactly(daemonRpcClientStub, rpc, { params });
      expect(daemonServiceUtils.getStandardCache(key)).to.eql(data);
    });

    it('should return an error message if rpc call throws an error', async () => {
      const rpc = 'getInfo';
      const params = ['someParameterGetinfo'];
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Error',
          name: 'Error',
        },
      };
      const daemonRpcClientStub = sinon.stub().throws();
      daemonServiceUtils.setFluxdClient({ run: daemonRpcClientStub });

      const result = await daemonServiceUtils.executeCall(rpc, params);

      expect(result).to.eql(expectedErrorMessage);
    });
  });

  describe('executeBatchCall tests', () => {
    afterEach(() => {
      daemonServiceUtils.setFluxdClient(null);
      sinon.restore();
    });

    it('should delegate to fluxdClient.runBatch', async () => {
      const batchData = [{ id: 0, result: 'ok', error: null }];
      const runBatchStub = sinon.stub().resolves(batchData);
      daemonServiceUtils.setFluxdClient({ run: sinon.stub(), runBatch: runBatchStub });

      const calls = [{ method: 'getblockcount', params: [] }];
      const result = await daemonServiceUtils.executeBatchCall(calls);

      expect(result.status).to.equal('success');
      expect(result.data).to.eql(batchData);
      sinon.assert.calledOnceWithExactly(runBatchStub, calls);
    });

    it('should return error message on failure', async () => {
      const runBatchStub = sinon.stub().rejects(new Error('Connection refused'));
      daemonServiceUtils.setFluxdClient({ run: sinon.stub(), runBatch: runBatchStub });

      const calls = [{ method: 'getblockcount', params: [] }];
      const result = await daemonServiceUtils.executeBatchCall(calls);

      expect(result.status).to.equal('error');
      expect(result.data.message).to.equal('Connection refused');
    });

    it('should not use cache or lock', async () => {
      const getSpy = sinon.spy(FluxTTLCache.prototype, 'get');
      const batchData = [{ id: 0, result: 'ok', error: null }];
      const runBatchStub = sinon.stub().resolves(batchData);
      daemonServiceUtils.setFluxdClient({ run: sinon.stub(), runBatch: runBatchStub });

      await daemonServiceUtils.executeBatchCall([{ method: 'getblockcount', params: [] }]);

      sinon.assert.notCalled(getSpy);
    });
  });
});
