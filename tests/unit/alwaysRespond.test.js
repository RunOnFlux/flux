const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const alwaysRespond = require('../../ZelBack/src/middlewares/alwaysRespond');

// App control endpoints answer with the same body on every call, so Express's ETag
// makes a repeated request collapse to a bodiless 304 — the caller cannot tell whether
// the action ran. Each case below issues the request twice, replaying the ETag from the
// first response, exactly as a browser does.
describe('alwaysRespond middleware tests', () => {
  const controlResponse = { status: 'success', data: { message: 'Flux App stopped' } };

  function buildApp(middleware) {
    const app = express();
    const handler = (req, res) => res.json(controlResponse);
    if (middleware) {
      app.get('/apps/appstop', middleware, handler);
    } else {
      app.get('/apps/appstop', handler);
    }
    return app;
  }

  async function requestTwice(app) {
    const first = await request(app).get('/apps/appstop');
    const second = await request(app)
      .get('/apps/appstop')
      .set('If-None-Match', first.headers.etag);
    return { first, second };
  }

  it('should collapse a repeated call to an empty 304 without the middleware', async () => {
    const { first, second } = await requestTwice(buildApp(null));

    expect(first.status).to.equal(200);
    expect(first.body).to.deep.equal(controlResponse);
    expect(second.status).to.equal(304);
    expect(second.body).to.deep.equal({});
  });

  it('should answer a repeated call in full with the middleware', async () => {
    const { first, second } = await requestTwice(buildApp(alwaysRespond));

    expect(first.status).to.equal(200);
    expect(second.status).to.equal(200);
    expect(second.body).to.deep.equal(controlResponse);
  });

  it('should mark control responses as non-cacheable', async () => {
    const res = await request(buildApp(alwaysRespond)).get('/apps/appstop');

    expect(res.headers['cache-control']).to.equal('no-store');
  });

  it('should strip the validator so downstream handlers never see it', async () => {
    let seenHeaders;
    const app = express();
    app.get('/apps/appstop', alwaysRespond, (req, res) => {
      seenHeaders = { ...req.headers };
      res.json(controlResponse);
    });

    await request(app).get('/apps/appstop').set('If-None-Match', 'W/"cached"');

    expect(seenHeaders).to.not.have.property('if-none-match');
  });
});
