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
});
