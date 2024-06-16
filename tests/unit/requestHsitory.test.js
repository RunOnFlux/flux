const { expect } = require('chai');
const sinon = require('sinon');

const { RequestHistory } = require('../../ZelBack/src/services/utils/requestHistory');

describe('requestHistory tests', () => {
  beforeEach(async () => { });

  afterEach(() => {
    sinon.restore();
  });

  it('should instantiate and set maxAge correctly', () => {
    const testAge = 5_000;
    const historyDefault = new RequestHistory();
    const history = new RequestHistory({ maxAge: testAge });

    expect(historyDefault.maxAge).to.equal(RequestHistory.defaultMaxAge);
    expect(history.maxAge).to.equal(testAge);
  });

  it('should instantiate with an empty history', () => {
    const history = new RequestHistory();

    expect(history.allHistory).to.deep.equal({});
  });

  it('should return null instead of error if a URL parsing error occurs', () => {
    const parsed = RequestHistory.parseUrl('thisisnotaurl');

    expect(parsed).to.equal(null);
  });

  it('should store a request', () => {
    const timestamp = Date.now();
    const expected = {
      verb: 'get',
      timeout: 20_000,
      timestamp,
    };

    const request = {
      url: 'https:/testurl.com:4444/endpoint?query=123&more=234',
      ...expected,
    };

    const history = new RequestHistory();

    const id = history.storeRequest(request);

    const historyExpected = {
      'https://testurl.com:4444/endpoint': [{
        ...expected,
        params: {
          query: '123',
          more: '234',
        },
        id,
      }],
    };

    expect(history.allHistory).to.deep.equal(historyExpected);
  });

  it('should emit correct events when request stored', () => {
    let targetEmitted = false;
    let addEmitted = false;

    const request = {
      url: 'https:/testurl.com:4444/endpoint?query=123&more=234',
      verb: 'get',
      timeout: 20_000,
      timestamp: 0,
    };

    const history = new RequestHistory();

    history.on('targetAdded', () => { targetEmitted = true; });
    history.on('requestAdded', () => { addEmitted = true; });

    history.storeRequest(request);

    expect(targetEmitted).to.equal(true);
    expect(addEmitted).to.equal(true);
  });

  it('should not store a request if a url is not parseable', () => {
    const history = new RequestHistory();

    let emitted = false;

    history.on('parseError', () => { emitted = true; });

    const id = history.storeRequest({
      url: 'badurl', verb: 'get', timeout: 1_000, timestamp: 0,
    });

    expect(id).to.equal(null);
    expect(emitted).to.equal(true);
    expect(history.allHistory).to.deep.equal({});
  });

  it('should clear all values when clear called', async () => {
    const clock = sinon.useFakeTimers();

    let removeEmitted = false;

    const request = {
      url: 'https:/testurl.com:4444/endpoint?query=123&more=234',
      verb: 'get',
      timeout: 20_000,
      timestamp: 0,
    };

    const history = new RequestHistory({ maxAge: 5_000 });

    history.on('requestRemoved', () => { removeEmitted = true; });

    history.storeRequest(request);

    expect(Object.keys(history.allHistory).length).to.equal(1);
    history.clear();
    expect(Object.keys(history.allHistory).length).to.equal(0);

    await clock.tickAsync(6_000);
    expect(removeEmitted).to.equal(false);
  });

  it('should automatically remove request when maxAge reached', async () => {
    const clock = sinon.useFakeTimers();

    let removeEmitted = false;

    const request = {
      url: 'https:/testurl.com:4444/endpoint?query=123&more=234',
      verb: 'get',
      timeout: 20_000,
      timestamp: 0,
    };

    const history = new RequestHistory({ maxAge: 5_000 });

    history.on('requestRemoved', () => { removeEmitted = true; });

    history.storeRequest(request);
    await clock.tickAsync(6_000);
    expect(removeEmitted).to.equal(true);
  });
});
