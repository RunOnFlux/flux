const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const isLocal = require('../../ZelBack/src/middlewares/isLocal');

describe('isLocal middleware tests', () => {
  function buildApp() {
    const app = express();
    app.get('/flux/backendfolder', isLocal, (req, res) => res.json({ status: 'success' }));
    return app;
  }

  // supertest dials the loopback interface, so the address Express reports is genuinely
  // local. Remote callers are covered by driving the middleware directly below.
  it('should admit a caller on the loopback interface', async () => {
    const res = await request(buildApp()).get('/flux/backendfolder');

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ status: 'success' });
  });

  ['localhost', '127.0.0.1', '::ffff:127.0.0.1', '::1'].forEach((address) => {
    it(`should admit ${address}`, () => {
      let advanced = false;
      isLocal({ ip: address, headers: {} }, {}, () => { advanced = true; });

      expect(advanced).to.be.true;
    });
  });

  it('should reject a remote caller with 401', () => {
    let advanced = false;
    let status;
    let body;
    const res = {
      status: (code) => { status = code; return res; },
      send: (payload) => { body = payload; },
    };

    isLocal({ ip: '8.8.8.8', headers: {} }, res, () => { advanced = true; });

    expect(advanced).to.be.false;
    expect(status).to.equal(401);
    expect(body).to.equal('Access denied');
  });

  it('should not let a forwarded-for header override a remote address', () => {
    let advanced = false;
    const res = { status: () => res, send: () => {} };

    isLocal(
      { ip: '8.8.8.8', headers: { 'x-forwarded-for': '127.0.0.1' } },
      res,
      () => { advanced = true; },
    );

    expect(advanced).to.be.false;
  });
});
