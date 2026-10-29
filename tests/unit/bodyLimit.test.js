const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const sinon = require('sinon');

const bodyLimit = require('../../ZelBack/src/services/utils/bodyLimit');

describe('bodyLimit', () => {
  const makeResponse = () => {
    const res = { handlers: {} };
    res.set = sinon.stub().returns(res);
    res.status = sinon.stub().returns(res);
    res.json = sinon.stub().returns(res);
    res.on = sinon.stub().callsFake((event, handler) => { res.handlers[event] = handler; });
    return res;
  };

  it('lets a body up to the limit through', () => {
    const res = makeResponse();

    const refused = bodyLimit.refuseIfTooLarge(new EventEmitter(), res, 'x'.repeat(bodyLimit.MAX_BODY_SIZE));

    expect(refused).to.equal(false);
    sinon.assert.notCalled(res.status);
  });

  it('answers 413 once, then reads out what is still arriving and destroys the request', () => {
    const clock = sinon.useFakeTimers();
    try {
      const req = new EventEmitter();
      req.destroy = sinon.stub();
      req.resume = sinon.stub();
      const res = makeResponse();
      const body = 'x'.repeat(bodyLimit.MAX_BODY_SIZE + 1);

      expect(bodyLimit.refuseIfTooLarge(req, res, body)).to.equal(true);
      expect(bodyLimit.refuseIfTooLarge(req, res, body)).to.equal(true);

      sinon.assert.calledOnceWithExactly(res.status, 413);
      sinon.assert.calledWithExactly(res.set, 'Connection', 'close');
      sinon.assert.notCalled(req.destroy);
      res.handlers.finish();
      sinon.assert.calledOnce(req.resume);
      sinon.assert.notCalled(req.destroy);
      clock.tick(1000);
      sinon.assert.calledOnce(req.destroy);
    } finally {
      clock.restore();
    }
  });

  it('silences the handler\'s own data and end listeners once it has refused', () => {
    const req = new EventEmitter();
    req.destroy = sinon.stub();
    const seen = [];
    req.on('data', (data) => seen.push(`data:${data}`));
    req.on('end', () => seen.push('end'));
    req.on('close', () => seen.push('close'));

    bodyLimit.refuseIfTooLarge(req, makeResponse(), 'x'.repeat(bodyLimit.MAX_BODY_SIZE + 1));
    req.emit('data', 'more');
    req.emit('end');
    req.emit('close');

    expect(seen).to.eql(['close']);
  });

  // A handler that reads its own body, as the ones this guards do, and answers
  // when the body ends. A body over the limit must be answered once, by the guard.
  describe('in a handler that reads its own body', () => {
    let app;
    let handled;
    let failures;
    let onUncaught;

    beforeEach(() => {
      handled = 0;
      failures = [];
      onUncaught = (error) => failures.push(error);
      process.on('uncaughtException', onUncaught);
      process.on('unhandledRejection', onUncaught);
      app = express();
      app.post('/echo', async (req, res) => {
        let body = '';
        req.on('data', (data) => {
          body += data;
          bodyLimit.refuseIfTooLarge(req, res, body);
        });
        req.on('end', async () => {
          handled += 1;
          res.json({ length: body.length });
        });
      });
    });

    afterEach(() => {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUncaught);
    });

    it('answers a body over the limit with 413, without running the handler or raising', async () => {
      const response = await request(app)
        .post('/echo')
        .set('Content-Type', 'text/plain')
        .send('x'.repeat(bodyLimit.MAX_BODY_SIZE + 1024 * 1024))
        .catch((error) => error.response || { status: 'reset' });
      await new Promise((resolve) => { setTimeout(resolve, 50); });

      expect(response.status === 413 || response.status === 'reset').to.equal(true);
      expect(handled).to.equal(0);
      expect(failures).to.eql([]);
    });

    it('answers a body within the limit as the handler does', async () => {
      const response = await request(app).post('/echo').set('Content-Type', 'text/plain').send('hello');

      expect(response.status).to.equal(200);
      expect(response.body).to.eql({ length: 5 });
    });
  });

  // A handler that reads its own body bypasses every parser's limit, so each one
  // bounds it here. Read from the source, so a new handler that forgets is refused.
  describe('every handler in ZelBack that reads its own request body', () => {
    const source = path.join(__dirname, '../../ZelBack/src');
    const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
    const count = (text, pattern) => (text.match(pattern) || []).length;
    const files = sourceFiles(source).map((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return {
        file: path.relative(source, file),
        reads: count(text, /req\.on\(\s*'data'/g),
        bounded: count(text, /bodyLimit\.refuseIfTooLarge\(/g),
      };
    });

    it('is found by the scan', () => {
      expect(files.filter(({ reads }) => reads > 0).length).to.be.above(10);
    });

    it('bounds the body with refuseIfTooLarge', () => {
      const unbounded = files.filter(({ reads, bounded }) => reads > bounded);
      expect(unbounded).to.eql([]);
    });
  });
});
