const { expect } = require('chai');
const requireHttps = require('../../ZelBack/src/middlewares/requireHttps');

describe('requireHttps middleware tests', () => {
  function buildRes() {
    const res = {
      statusCode: null,
      body: null,
      status(code) { res.statusCode = code; return res; },
      json(payload) { res.body = payload; return res; },
    };
    return res;
  }

  it('should pass a secure request through', () => {
    let advanced = false;
    const res = buildRes();

    requireHttps({ secure: true }, res, () => { advanced = true; });

    expect(advanced).to.be.true;
    expect(res.statusCode).to.be.null;
  });

  it('should reject a plaintext request with 403', () => {
    let advanced = false;
    const res = buildRes();

    requireHttps({ secure: false }, res, () => { advanced = true; });

    expect(advanced).to.be.false;
    expect(res.statusCode).to.equal(403);
    expect(res.body.status).to.equal('error');
    expect(res.body.data.name).to.equal('ForbiddenProtocol');
    expect(res.body.data.code).to.equal(403);
    expect(res.body.data.message).to.equal('HTTPS required for ArcaneOS authentication endpoints');
  });
});
