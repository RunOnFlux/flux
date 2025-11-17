const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const { PassThrough } = require('stream');
const qs = require('qs');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const paymentService = require('../../ZelBack/src/services/paymentService');

chai.use(chaiAsPromised);
const { expect } = chai;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => param);
  return res;
};

const generateRequest = (body = {}, query = {}, ip = '127.0.0.1') => {
  const req = new PassThrough();
  req.query = query;
  req.ip = ip;
  req.connection = { remoteAddress: ip };
  if (Object.keys(body).length > 0) {
    setTimeout(() => {
      req.emit('data', JSON.stringify(body));
      req.emit('end');
    }, 10);
  } else {
    setTimeout(() => {
      req.emit('end');
    }, 10);
  }
  return req;
};

describe('paymentService tests', () => {
  describe('paymentRequest tests', () => {
    let insertStub;

    beforeEach(() => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: sinon.stub().returns({
          collection: sinon.stub(),
        }),
      });
      insertStub = sinon.stub(dbHelper, 'insertOneToDatabase').resolves(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create a payment request successfully', async () => {
      const res = generateResponse();
      const req = { ip: '127.0.0.1', connection: { remoteAddress: '127.0.0.1' } };

      await paymentService.paymentRequest(req, res);

      sinon.assert.calledOnce(insertStub);
      sinon.assert.calledOnce(res.json);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data).to.have.property('paymentId');
      expect(response.data.paymentId).to.be.a('string');
      expect(response.data.paymentId.length).to.be.greaterThan(10);
    });

    it('should include timestamp in payment ID', async () => {
      const res = generateResponse();
      const req = { ip: '127.0.0.1', connection: { remoteAddress: '127.0.0.1' } };

      await paymentService.paymentRequest(req, res);

      const response = res.json.firstCall.args[0];
      const { paymentId } = response.data;
      const timestamp = paymentId.split('_')[0];
      const now = Date.now();

      expect(Number(timestamp)).to.be.closeTo(now, 1000);
    });

    it('should handle database errors gracefully', async () => {
      insertStub.rejects(new Error('Database connection failed'));
      const res = generateResponse();
      const req = { ip: '127.0.0.1', connection: { remoteAddress: '127.0.0.1' } };

      await paymentService.paymentRequest(req, res);

      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('Database connection failed');
    });
  });

  describe('verifyPayment tests', () => {
    let findOneStub;
    let insertStub;

    beforeEach(() => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: sinon.stub().returns({
          collection: sinon.stub(),
        }),
      });
      findOneStub = sinon.stub(dbHelper, 'findOneInDatabase');
      insertStub = sinon.stub(dbHelper, 'insertOneToDatabase').resolves(true);
      sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').resolves(true);
      sinon.stub(serviceHelper, 'ensureObject').callsFake((input) => {
        if (typeof input === 'string') {
          return JSON.parse(input);
        }
        return input;
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should reject request with body too large', (done) => {
      const res = generateResponse();
      const req = new PassThrough();
      req.query = {};
      req.destroy = sinon.fake();

      paymentService.verifyPayment(req, res);

      // Send data larger than MAX_BODY_SIZE (10000)
      const largeData = 'x'.repeat(15000);
      req.emit('data', largeData);

      setTimeout(() => {
        sinon.assert.calledOnce(req.destroy);
        sinon.assert.calledWith(res.status, 413);
        const response = res.json.firstCall.args[0];
        expect(response.data.message).to.include('Request body too large');
        done();
      }, 50);
    });

    it('should reject payment without payment ID', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456',
        coin: 'FLUX',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('No payment ID is specified');
        done();
      }, 50);
    });

    it('should reject payment with invalid payment ID format', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456',
        coin: 'FLUX',
        paymentid: 'short',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Invalid payment ID format');
        done();
      }, 50);
    });

    it('should reject payment without transaction ID', (done) => {
      const res = generateResponse();
      const body = {
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('No transaction ID is specified');
        done();
      }, 50);
    });

    it('should reject payment with transaction ID too long', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'a'.repeat(501), // Over 500 limit
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Invalid transaction ID length');
        done();
      }, 50);
    });

    it('should reject payment without coin', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('No coin is specified');
        done();
      }, 50);
    });

    it('should reject payment with coin name too long', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'A'.repeat(51), // Over 50 limit
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Invalid coin name length');
        done();
      }, 50);
    });

    it('should reject invalid from_address length', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
        from_address: 'short', // Less than 10 chars
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Invalid from address length');
        done();
      }, 50);
    });

    it('should reject invalid to_address length', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
        to_address: 'a'.repeat(501), // Over 500 limit
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Invalid to address length');
        done();
      }, 50);
    });

    it('should reject invalid amount', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
        amount: 'not-a-number',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Amount must be a positive number');
        done();
      }, 50);
    });

    it('should reject negative amount', (done) => {
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
        amount: -100,
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Amount must be a positive number');
        done();
      }, 50);
    });

    it('should reject payment request not found', (done) => {
      findOneStub.resolves(null);
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Payment request not found or has expired');
        done();
      }, 50);
    });

    it('should reject expired payment request', (done) => {
      const expiredTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      findOneStub.onFirstCall().resolves({
        paymentId: '1234567890123_randomstring',
        createdAt: new Date(expiredTime),
      });
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('error');
        expect(response.data.message).to.include('Payment request has expired');
        done();
      }, 50);
    });

    it('should successfully process valid payment', (done) => {
      const validTime = Date.now() - (30 * 60 * 1000); // 30 minutes ago
      findOneStub.onFirstCall().resolves({
        paymentId: '1234567890123_randomstring',
        createdAt: new Date(validTime),
      });
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'FLUX',
        paymentid: '1234567890123_randomstring',
        from_address: '1FluxAddress123',
        to_address: '1FluxAddress456',
        amount: '100',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        sinon.assert.calledOnce(insertStub);
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('success');
        expect(response.data.message).to.equal('Payment received successfully');
        expect(response.data.paymentId).to.equal('1234567890123_randomstring');
        expect(response.data.txid).to.equal('abc123def456789012345678901234567890');
        expect(response.data.success_url).to.equal('https://home.runonflux.io/successcheckout');
        done();
      }, 50);
    });

    it('should accept transaction_id field from ZelCore', (done) => {
      const validTime = Date.now() - (30 * 60 * 1000);
      findOneStub.onFirstCall().resolves({
        paymentId: '1234567890123_randomstring',
        createdAt: new Date(validTime),
      });
      const res = generateResponse();
      const body = {
        transaction_id: 'zelcore_transaction_id_123456789012', // ZelCore format
        coin: 'BTC',
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const response = res.json.firstCall.args[0];
        expect(response.status).to.equal('success');
        expect(response.data.txid).to.equal('zelcore_transaction_id_123456789012');
        done();
      }, 50);
    });

    it('should preserve coin case as provided', (done) => {
      const validTime = Date.now() - (30 * 60 * 1000);
      findOneStub.onFirstCall().resolves({
        paymentId: '1234567890123_randomstring',
        createdAt: new Date(validTime),
      });
      const res = generateResponse();
      const body = {
        txid: 'abc123def456789012345678901234567890',
        coin: 'flux', // lowercase
        paymentid: '1234567890123_randomstring',
      };
      const req = generateRequest(body);

      paymentService.verifyPayment(req, res);

      setTimeout(() => {
        const insertCall = insertStub.firstCall.args[2];
        expect(insertCall.coin).to.equal('flux');
        done();
      }, 50);
    });
  });

  describe('wsRespondPayment tests', () => {
    let findOneStub;

    beforeEach(() => {
      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: sinon.stub().returns({
          collection: sinon.stub(),
        }),
      });
      findOneStub = sinon.stub(dbHelper, 'findOneInDatabase');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send payment data when payment is found', (done) => {
      const paymentData = {
        paymentId: 'test_payment_id',
        txid: 'test_txid',
        coin: 'FLUX',
        chain: 'FLUX',
        explorer: 'https://explorer.runonflux.io',
        fromAddress: 'from_addr',
        toAddress: 'to_addr',
        amount: '100',
        createdAt: new Date(),
      };
      findOneStub.resolves(paymentData);

      const ws = {
        send: sinon.fake(),
        close: sinon.fake(),
        onclose: null,
        onerror: null,
      };

      paymentService.wsRespondPayment(ws, 'test_payment_id');

      setTimeout(() => {
        sinon.assert.calledOnce(ws.send);
        sinon.assert.calledWith(ws.close, 4012);

        const sentString = ws.send.firstCall.args[0];
        expect(sentString).to.include('status=success');
        expect(sentString).to.include('paymentId');
        expect(sentString).to.include('test_payment_id');
        expect(sentString).to.include('test_txid');
        done();
      }, 100);
    });

    it('should send error when payment request is no longer valid', (done) => {
      findOneStub.onFirstCall().resolves(null); // No completed payment
      findOneStub.onSecondCall().resolves(null); // No active request either

      const ws = {
        send: sinon.fake(),
        close: sinon.fake(),
        onclose: null,
        onerror: null,
      };

      paymentService.wsRespondPayment(ws, 'invalid_payment_id');

      setTimeout(() => {
        sinon.assert.calledOnce(ws.send);
        const sentString = ws.send.firstCall.args[0];
        expect(sentString).to.include('status=error');
        expect(sentString).to.include('Payment%20request%20is%20no%20longer%20valid');
        done();
      }, 100);
    });

    it('should handle WebSocket close event', (done) => {
      findOneStub.onFirstCall().resolves(null);
      findOneStub.onSecondCall().resolves({ paymentId: 'test' }); // Active request

      const ws = {
        send: sinon.fake(),
        close: sinon.fake(),
        onclose: null,
        onerror: null,
      };

      paymentService.wsRespondPayment(ws, 'test_payment_id');

      // Simulate close event
      setTimeout(() => {
        ws.onclose({ code: 1000 });
        // Give it time to potentially call searchDatabase again
        setTimeout(() => {
          // Should not have sent anything after close
          expect(ws.send.callCount).to.be.at.most(1);
          done();
        }, 600);
      }, 50);
    });

    it('should handle WebSocket error event', (done) => {
      findOneStub.onFirstCall().resolves(null);
      findOneStub.onSecondCall().resolves({ paymentId: 'test' });

      const ws = {
        send: sinon.fake(),
        close: sinon.fake(),
        onclose: null,
        onerror: null,
      };

      paymentService.wsRespondPayment(ws, 'test_payment_id');

      setTimeout(() => {
        ws.onerror({ code: 1006 });
        setTimeout(() => {
          expect(ws.send.callCount).to.be.at.most(1);
          done();
        }, 600);
      }, 50);
    });

    it('should handle database errors gracefully', (done) => {
      findOneStub.rejects(new Error('Database error'));

      const ws = {
        send: sinon.fake(),
        close: sinon.fake(),
        onclose: null,
        onerror: null,
      };

      paymentService.wsRespondPayment(ws, 'test_payment_id');

      setTimeout(() => {
        sinon.assert.calledOnce(ws.send);
        sinon.assert.calledWith(ws.close, 4011);
        const sentData = qs.parse(ws.send.firstCall.args[0]);
        expect(sentData.status).to.equal('error');
        done();
      }, 100);
    });
  });
});
