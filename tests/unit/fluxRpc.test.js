const chai = require('chai');
chai.use(require('chai-as-promised'));

const { expect } = chai;

const sinon = require('sinon');

const axios = require('axios');

const { FluxRpc } = require('../../ZelBack/src/services/utils/fluxRpc');

describe('fluxRpc tests', () => {
  const goodUrl = 'http://127.0.0.1:16126';
  let postStub;
  let createStub;

  beforeEach(async () => {
    postStub = sinon.stub().resolves();
    createStub = sinon.stub(axios, 'create').returns({ post: postStub });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should throw on malformed URL', () => {
    expect(() => new FluxRpc()).to.throw('Invalid URL');
    expect(() => new FluxRpc('http://')).to.throw('Invalid URL');
    expect(() => new FluxRpc('notaurl')).to.throw('Invalid URL');
  });

  it('should throw if mode not fluxd or fluxbenchd', () => {
    expect(() => new FluxRpc(goodUrl, { mode: 'invalidmode' })).to.throw(
      'mode must be one of fluxd | fluxbenchd',
    );
  });

  it('should create axios instance with correct params', () => {
    // eslint-disable-next-line no-unused-vars
    const rpc = new FluxRpc(goodUrl);

    sinon.assert.calledOnceWithExactly(createStub, {
      baseURL: goodUrl,
      auth: null,
      timeout: 60_000,
    });
  });

  it('should throw if unknown method called', async () => {
    const rpc = new FluxRpc(goodUrl);

    await expect(rpc.run('unknowntestmethod')).to.eventually.be.rejectedWith(
      'Invalid Method: unknowntestmethod',
    );
  });

  it('should throw partial axios error if axios error', async () => {
    const rpc = new FluxRpc(goodUrl);

    postStub.callsFake(async () => {
      const err = new Error('Test axios err');
      err.code = 401;
      throw err;
    });

    await expect(rpc.run('getblockcount')).to.eventually.be.rejectedWith(
      'Test axios err',
    );
  });

  it('should create a json rpc payload with params', async () => {
    const rpc = new FluxRpc(goodUrl);

    postStub.resolves({ status: 200, data: 'blah' });

    await rpc.run('getblockhash', { params: [12345] });

    sinon.assert.calledOnceWithMatch(postStub, '/', {
      jsonrpc: '2.0', id: 0, method: 'getblockhash', params: [12345],
    }, sinon.match.any);
  });

  it('should return the rpc result', async () => {
    const rpc = new FluxRpc(goodUrl);

    postStub.resolves({ status: 200, data: { result: 'RPC RES HERE' } });

    const res = await rpc.run('getblockhash', { params: [12345] });
    expect(res).to.equal('RPC RES HERE');
  });

  it('should increment the id and reset at 999', async () => {
    const rpc = new FluxRpc(goodUrl);

    postStub.resolves({ status: 200, data: { result: '' } });

    await rpc.run('getblockhash', { params: [12345] });

    sinon.assert.calledOnceWithMatch(postStub, '/', {
      jsonrpc: '2.0', id: 0, method: 'getblockhash', params: [12345],
    }, sinon.match.any);

    const first500 = Array(500).fill(0).map(() => rpc.run('getblockcount'));

    await Promise.all(first500);

    expect(postStub.getCall(-1).args[1].id).to.equal(500);

    const last500 = Array(500).fill(0).map(() => rpc.run('getblockcount'));

    await Promise.all(last500);

    expect(postStub.getCall(-1).args[1].id).to.equal(0);
  });

  describe('runBatch tests', () => {
    it('should return empty array for empty calls', async () => {
      const rpc = new FluxRpc(goodUrl);
      const result = await rpc.runBatch([]);
      expect(result).to.eql([]);
      sinon.assert.notCalled(postStub);
    });

    it('should send array payload and parse response', async () => {
      postStub.resolves({
        status: 200,
        data: [
          { id: 0, result: 'hash123', error: null },
          { id: 1, result: 500000, error: null },
        ],
      });
      const rpc = new FluxRpc(goodUrl);
      const result = await rpc.runBatch([
        { method: 'getblockhash', params: [1] },
        { method: 'getblockcount', params: [] },
      ]);
      expect(result).to.have.length(2);
      expect(result[0].result).to.equal('hash123');
      expect(result[1].result).to.equal(500000);
      const payload = postStub.getCall(0).args[1];
      expect(payload).to.be.an('array').with.length(2);
      expect(payload[0].method).to.equal('getblockhash');
      expect(payload[1].method).to.equal('getblockcount');
    });

    it('should sort out-of-order responses by id', async () => {
      postStub.resolves({
        status: 200,
        data: [
          { id: 1, result: 'second', error: null },
          { id: 0, result: 'first', error: null },
        ],
      });
      const rpc = new FluxRpc(goodUrl);
      const result = await rpc.runBatch([
        { method: 'getblockhash', params: [1] },
        { method: 'getblockhash', params: [2] },
      ]);
      expect(result[0].result).to.equal('first');
      expect(result[1].result).to.equal('second');
    });

    it('should include partial failures without throwing', async () => {
      postStub.resolves({
        status: 200,
        data: [
          { id: 0, result: 'ok', error: null },
          { id: 1, result: null, error: { code: -5, message: 'Not found' } },
        ],
      });
      const rpc = new FluxRpc(goodUrl);
      const result = await rpc.runBatch([
        { method: 'getblockhash', params: [1] },
        { method: 'getrawtransaction', params: ['deadbeef', 1] },
      ]);
      expect(result[0].result).to.equal('ok');
      expect(result[1].error.message).to.equal('Not found');
    });

    it('should throw on HTTP failure', async () => {
      postStub.rejects(new Error('Connection refused'));
      const rpc = new FluxRpc(goodUrl);
      await expect(rpc.runBatch([{ method: 'getblockcount', params: [] }]))
        .to.be.rejectedWith('Connection refused');
    });

    it('should throw on invalid method before HTTP call', async () => {
      const rpc = new FluxRpc(goodUrl);
      await expect(rpc.runBatch([{ method: 'invalidmethod', params: [] }]))
        .to.be.rejectedWith('Invalid Method');
      sinon.assert.notCalled(postStub);
    });

    it('should throw if response is not an array', async () => {
      postStub.resolves({ status: 200, data: { result: 'not an array' } });
      const rpc = new FluxRpc(goodUrl);
      await expect(rpc.runBatch([{ method: 'getblockcount', params: [] }]))
        .to.be.rejectedWith('Batch response is not an array');
    });
  });
});
