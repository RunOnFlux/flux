// The guards that run before a route's response cache.
//
// The cache keys on the full request URL, so the guard's job is to stop a
// parameter the handler never reads from becoming part of that key. These
// assert through a real express stack with the real cache middleware behind
// them, because the ordering - guard first, cache second - is the whole point
// and a direct call to the guard cannot show it.

const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const apicache = require('apicache');

const { rejectQueryParameters, requireBootSettled } = require('../../ZelBack/src/services/utils/routeGuards');
const globalState = require('../../ZelBack/src/services/utils/globalState');

describe('routeGuards', () => {
  describe('rejectQueryParameters', () => {
    let app;
    let server;
    let handlerCalls;

    // apicache's store and its expiry timers are module-global, so this suite
    // both starts clean and leaves nothing behind for whatever runs next
    beforeEach(() => {
      apicache.clear();
      handlerCalls = 0;
      app = express();
      app.get(
        '/answer',
        rejectQueryParameters,
        apicache.middleware('30 seconds', (req, res) => res.statusCode === 200),
        (req, res) => {
          handlerCalls += 1;
          res.json({ status: 'success', data: { answer: 42 } });
        },
      );
    });

    afterEach(() => {
      apicache.clear();
      if (server) { server.close(); server = null; }
    });

    // One server for the test, rather than one per request. supertest binds a
    // fresh ephemeral server on every request(app) call, and a test making
    // several of them opens several - which under a full-suite load produced a
    // transient 'Parse Error: Expected HTTP/' from a socket that was not the
    // one being spoken to. The lifetime is explicit here instead.
    const get = (path) => {
      if (!server) server = app.listen(0);
      return request(server).get(path);
    };

    it('answers a request that carries no query string', async () => {
      const res = await get('/answer');
      expect(res.status).to.equal(200);
      expect(res.body.data.answer).to.equal(42);
      expect(handlerCalls).to.equal(1);
    });

    it('refuses a query parameter the endpoint does not read', async () => {
      const res = await get('/answer?x=1');
      expect(res.status).to.equal(400);
      expect(res.body.status).to.equal('error');
      expect(res.body.data.message).to.equal('This endpoint takes no query parameters');
    });

    it('refuses a parameter with no value, and one repeated', async () => {
      expect((await get('/answer?x')).status).to.equal(400);
      expect((await get('/answer?x=1&x=2')).status).to.equal(400);
    });

    // express resolves '?=1' to an empty query object, so a guard reading
    // req.query waves it through - while the cache still files it under a key
    // of its own. The decision has to be made on the raw url.
    it('refuses a query string that parses to nothing but still varies the url', async () => {
      expect((await get('/answer?=1')).status).to.equal(400);
      expect((await get('/answer?&&')).status).to.equal(400);
    });

    it('answers a bare question mark, which carries no parameter', async () => {
      const res = await get('/answer?');
      expect(res.status).to.equal(200);
    });

    it('never lets a refused request reach the handler', async () => {
      await get('/answer?x=1');
      await get('/answer?y=2');
      expect(handlerCalls).to.equal(0);
    });

    // the defect this exists for: without the guard each novel query string is
    // a distinct cache key, so it both recomputes the answer and retains
    // another copy of it for the cache window
    it('keeps the cache to one entry however many parameters are tried', async () => {
      await get('/answer');
      await get('/answer?x=1');
      await get('/answer?x=2');
      await get('/answer?x=3');
      await get('/answer');

      expect(handlerCalls).to.equal(1);
      // scoped to this route: the index is module-global, so asserting on its
      // whole contents would make this test hostage to anything else cached
      const mine = apicache.getIndex().all.filter((key) => key.includes('/answer'));
      expect(mine).to.have.lengthOf(1);
    });
  });

  describe('requireBootSettled', () => {
    let app;
    let server;
    let handlerCalls;

    // The gate is process-global, and a node that has settled never unsettles,
    // so a test that opened it would leave every later one running against an
    // open gate. Restored either way.
    let settledBefore;

    beforeEach(() => {
      settledBefore = globalState.bootContainerStateSettled;
      globalState.bootContainerStateSettled = false;
      handlerCalls = 0;
      app = express();
      app.get('/apps/appstart/:appname', requireBootSettled, (req, res) => {
        handlerCalls += 1;
        res.json({ status: 'success', data: 'started' });
      });
    });

    afterEach(() => {
      globalState.bootContainerStateSettled = settledBefore;
      if (server) { server.close(); server = null; }
    });

    const get = (path) => {
      if (!server) server = app.listen(0);
      return request(server).get(path);
    };

    it('refuses while boot reconciliation has not decided which apps this node keeps', async () => {
      const res = await get('/apps/appstart/myapp');
      expect(res.status).to.equal(503);
      expect(res.body.status).to.equal('error');
      expect(res.body.data.message).to.equal('Node is still reconciling its applications after boot');
    });

    // A 503 with no Retry-After tells a caller to come back without saying when,
    // and a dashboard's answer to that is to poll as fast as it can.
    it('says when to come back', async () => {
      const res = await get('/apps/appstart/myapp');
      expect(res.headers['retry-after']).to.equal('15');
    });

    // The defect this exists for: an app created before the boot decision has no
    // location record to be kept by, so reconciliation removes it as one that
    // moved. A refusal the handler runs behind is not a refusal.
    it('never lets a refused call reach the handler', async () => {
      await get('/apps/appstart/myapp');
      await get('/apps/appstart/other');
      expect(handlerCalls).to.equal(0);
    });

    it('answers once the node has settled', async () => {
      globalState.bootContainerStateSettled = true;
      const res = await get('/apps/appstart/myapp');
      expect(res.status).to.equal(200);
      expect(handlerCalls).to.equal(1);
    });
  });
});
