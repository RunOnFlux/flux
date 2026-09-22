const chai = require('chai');
const sinon = require('sinon');
const { PassThrough } = require('stream');
const qs = require('qs');

const paymentRelayService = require('../../ZelBack/src/services/paymentRelayService');
const cacheManager = require('../../ZelBack/src/services/utils/cacheManager').default;

const { expect } = chai;

const pending = cacheManager.paymentRelayCache;

const generateResponse = () => {
  const res = { finishHandlers: [] };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => param);
  // The real response is an event emitter, and the refusal path waits on
  // 'finish' before it destroys the socket under it.
  res.on = sinon.fake((event, handler) => {
    if (event === 'finish') res.finishHandlers.push(handler);
    return res;
  });
  res.finish = () => res.finishHandlers.forEach((h) => h());
  return res;
};

/** A request that emits `body` once a listener is attached. */
const generateRequest = (body, query = {}) => {
  const req = new PassThrough();
  req.query = query;
  setTimeout(() => {
    if (body !== undefined) req.emit('data', body);
    req.emit('end');
  }, 0);
  return req;
};

/** Runs a handler that answers from a stream event, and resolves on res.json. */
const callWithBody = (body, query) => new Promise((resolve) => {
  const res = generateResponse();
  res.json = sinon.fake((param) => {
    resolve({ res, body: param });
    return param;
  });
  paymentRelayService.receivePaymentCallback(generateRequest(body, query), res);
});

const issueId = () => {
  const res = generateResponse();
  paymentRelayService.paymentRequest({}, res);
  return res.json.firstCall.args[0].data.paymentId;
};

const fakeSocket = () => ({
  send: sinon.fake(),
  close: sinon.fake(),
});

describe('paymentRelayService tests', () => {
  beforeEach(() => {
    pending.clear();
  });

  afterEach(() => {
    sinon.restore();
    pending.clear();
  });

  describe('paymentRequest', () => {
    it('issues an id and holds it with nothing delivered against it', () => {
      const res = generateResponse();

      paymentRelayService.paymentRequest({}, res);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      const { paymentId } = response.data;
      expect(paymentId).to.be.a('string');
      expect(pending.has(paymentId)).to.equal(true);
      expect(pending.get(paymentId)).to.deep.equal({ txid: null });
    });

    it('issues an id no caller could have guessed', () => {
      const first = issueId();
      const second = issueId();

      expect(first).to.not.equal(second);
      // timestamp, underscore, then 16 bytes of hex
      expect(first.split('_')[1]).to.match(/^[0-9a-f]{32}$/);
    });

    // The cache's own bound is what stops a flood costing memory, and it spends
    // the oldest id to stay inside it. A guard that refused at that size
    // instead would keep the cache below its maximum, so nothing would ever be
    // evicted - and every wallet, legitimate ones included, would be turned
    // away for as long as the flood's ids lived.
    it('still issues an id when the cache is at its bound', () => {
      Object.defineProperty(pending, 'size', { get: () => 20000, configurable: true });
      const res = generateResponse();

      paymentRelayService.paymentRequest({}, res);

      delete pending.size;
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data.paymentId).to.be.a('string');
    });
  });

  describe('receivePaymentCallback', () => {
    it('leaves the transaction id against the id the browser is waiting on', async () => {
      const paymentId = issueId();

      const { body } = await callWithBody(JSON.stringify({ txid: 'abc123', coin: 'flux' }), { paymentid: paymentId });

      expect(body.status).to.equal('success');
      expect(body.data.txid).to.equal('abc123');
      expect(pending.get(paymentId)).to.deep.equal({ txid: 'abc123' });
    });

    it('takes the wallet spelling of the field as well', async () => {
      const paymentId = issueId();

      await callWithBody(JSON.stringify({ transaction_id: 'wallet-spelling' }), { paymentid: paymentId });

      expect(pending.get(paymentId)).to.deep.equal({ txid: 'wallet-spelling' });
    });

    it('takes the payment id from the body when the query does not carry one', async () => {
      const paymentId = issueId();

      await callWithBody(JSON.stringify({ txid: 'abc123', paymentid: paymentId }), {});

      expect(pending.get(paymentId)).to.deep.equal({ txid: 'abc123' });
    });

    // express.json is mounted globally, so a JSON callback arrives parsed with
    // its stream already spent. Waiting on 'end' for one waits forever: no
    // answer is written, the connection is held open, and the browser on the
    // socket waits out the full timeout for a transaction id that was
    // delivered to the node and dropped.
    it('answers a callback whose body a parser already took', async () => {
      const paymentId = issueId();
      const res = generateResponse();
      const req = new PassThrough();
      req.query = { paymentid: paymentId };
      req.body = { txid: 'parsed-by-express' };
      req.push(null);
      req.resume();
      // awaited, not left in a listener: an assertion that runs after the test
      // has returned is an assertion the test never made
      await new Promise((resolve) => { req.on('end', resolve); });
      expect(req.readableEnded, 'the stream was not spent, so this is not the case under test').to.equal(true);

      paymentRelayService.receivePaymentCallback(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(pending.get(paymentId)).to.deep.equal({ txid: 'parsed-by-express' });
    });

    it('refuses an id nothing is waiting on, and leaves nothing behind', async () => {
      const unknown = `${Date.now()}_deadbeefdeadbeefdeadbeefdeadbeef`;

      const { body } = await callWithBody(JSON.stringify({ txid: 'abc123' }), { paymentid: unknown });

      expect(body.status).to.equal('error');
      expect(body.data.message).to.equal('Payment request not found or has expired');
      expect(pending.has(unknown)).to.equal(false);
    });

    it('refuses a callback carrying no transaction id', async () => {
      const paymentId = issueId();

      const { body } = await callWithBody(JSON.stringify({ coin: 'flux' }), { paymentid: paymentId });

      expect(body.status).to.equal('error');
      expect(body.data.message).to.equal('No transaction ID is specified');
      expect(pending.get(paymentId)).to.deep.equal({ txid: null });
    });

    it('refuses a transaction id longer than any chain produces', async () => {
      const paymentId = issueId();

      const { body } = await callWithBody(JSON.stringify({ txid: 'a'.repeat(501) }), { paymentid: paymentId });

      expect(body.status).to.equal('error');
      expect(body.data.message).to.equal('Invalid transaction ID length');
      expect(pending.get(paymentId)).to.deep.equal({ txid: null });
    });

    it('answers a body that overruns across several chunks exactly once', async () => {
      const paymentId = issueId();
      const res = generateResponse();
      const req = new PassThrough();
      req.query = { paymentid: paymentId };

      paymentRelayService.receivePaymentCallback(req, res);
      req.emit('data', 'a'.repeat(9000));
      req.emit('data', 'b'.repeat(9000));
      req.emit('data', 'c'.repeat(9000));
      req.emit('end');

      sinon.assert.calledOnce(res.json);
      sinon.assert.calledOnceWithExactly(res.status, 413);
      expect(pending.get(paymentId)).to.deep.equal({ txid: null });
    });

    // A write to a destroyed socket is discarded without complaint, so
    // destroying first leaves the caller a connection reset in place of the
    // refusal. The socket goes only once the refusal has been written.
    it('writes the refusal before it takes the socket away', () => {
      const paymentId = issueId();
      const res = generateResponse();
      const req = new PassThrough();
      req.query = { paymentid: paymentId };
      req.destroy = sinon.fake();

      paymentRelayService.receivePaymentCallback(req, res);
      req.emit('data', 'a'.repeat(20000));

      sinon.assert.calledWith(res.status, 413);
      sinon.assert.notCalled(req.destroy);

      res.finish();
      sinon.assert.calledOnce(req.destroy);
    });

    it('refuses a body too large to be a callback, and answers 413', async () => {
      const paymentId = issueId();

      const { res, body } = await callWithBody(JSON.stringify({ txid: 'a'.repeat(20000) }), { paymentid: paymentId });

      sinon.assert.calledWith(res.status, 413);
      expect(body.status).to.equal('error');
      expect(pending.get(paymentId)).to.deep.equal({ txid: null });
    });
  });

  describe('wsRespondPayment', () => {
    it('hands the waiting browser the transaction id and closes', () => {
      const paymentId = issueId();
      pending.set(paymentId, { txid: 'abc123' });
      const ws = fakeSocket();

      paymentRelayService.wsRespondPayment(ws, paymentId);

      const sent = qs.parse(ws.send.firstCall.args[0]);
      expect(sent.status).to.equal('success');
      expect(sent.data.txid).to.equal('abc123');
      sinon.assert.calledWith(ws.close, 4012);
    });

    // Delivered once, the id is spent: its slot frees on delivery rather than
    // sitting for the rest of the hour, and a second callback or listener for it
    // finds nothing to replace or re-read.
    it('spends the id on delivery, leaving nothing to replace or re-read', () => {
      const paymentId = issueId();
      pending.set(paymentId, { txid: 'abc123' });

      paymentRelayService.wsRespondPayment(fakeSocket(), paymentId);

      expect(pending.has(paymentId)).to.equal(false);
      const ws2 = fakeSocket();
      paymentRelayService.wsRespondPayment(ws2, paymentId);
      expect(qs.parse(ws2.send.firstCall.args[0]).status).to.equal('error');
    });

    it('carries nothing the wallet claimed beyond the transaction id', () => {
      const paymentId = issueId();
      pending.set(paymentId, { txid: 'abc123' });
      const ws = fakeSocket();

      paymentRelayService.wsRespondPayment(ws, paymentId);

      const sent = qs.parse(ws.send.firstCall.args[0]);
      expect(Object.keys(sent.data).sort()).to.deep.equal(['message', 'paymentId', 'txid']);
    });

    it('tells a listener on an id nothing holds that it is not valid', () => {
      const ws = fakeSocket();

      paymentRelayService.wsRespondPayment(ws, `${Date.now()}_deadbeefdeadbeefdeadbeefdeadbeef`);

      const sent = qs.parse(ws.send.firstCall.args[0]);
      expect(sent.status).to.equal('error');
      expect(sent.data.message).to.equal('Payment request is no longer valid. Please request a new one.');
      sinon.assert.calledWith(ws.close, undefined);
    });

    it('waits while nothing has been delivered, and answers when it is', () => {
      const clock = sinon.useFakeTimers();
      try {
        const paymentId = issueId();
        const ws = fakeSocket();

        paymentRelayService.wsRespondPayment(ws, paymentId);
        clock.tick(2000);
        sinon.assert.notCalled(ws.send);

        pending.set(paymentId, { txid: 'late-arrival' });
        clock.tick(500);

        const sent = qs.parse(ws.send.firstCall.args[0]);
        expect(sent.data.txid).to.equal('late-arrival');
        sinon.assert.calledWith(ws.close, 4012);
      } finally {
        clock.restore();
      }
    });

    // The id's own lifetime is the wait. Nothing here keeps a second clock, so
    // this is what a listener meets when the wallet never answers: the entry
    // is gone and it is told so.
    it('stops waiting once the id it is waiting on has gone', () => {
      const clock = sinon.useFakeTimers();
      try {
        const paymentId = issueId();
        const ws = fakeSocket();

        paymentRelayService.wsRespondPayment(ws, paymentId);
        clock.tick(2000);
        sinon.assert.notCalled(ws.send);

        pending.delete(paymentId);
        clock.tick(500);

        const sent = qs.parse(ws.send.firstCall.args[0]);
        expect(sent.status).to.equal('error');
        expect(sent.data.message).to.include('no longer valid');
      } finally {
        clock.restore();
      }
    });

    it('writes nothing to a browser that left while it was waiting', () => {
      const clock = sinon.useFakeTimers();
      try {
        const paymentId = issueId();
        const ws = fakeSocket();

        paymentRelayService.wsRespondPayment(ws, paymentId);
        clock.tick(1000);
        ws.onclose({ code: 1000 });

        pending.set(paymentId, { txid: 'nobody-is-listening' });
        clock.tick(5000);

        sinon.assert.notCalled(ws.send);
      } finally {
        clock.restore();
      }
    });
  });
});
