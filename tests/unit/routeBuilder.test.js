const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const apicache = require('apicache');

const {
  registerRoutes, chainFor, LIMITS,
} = require('../../ZelBack/src/routeBuilder');
const { requireBootSettled, rejectQueryParameters } = require('../../ZelBack/src/services/utils/routeGuards');

// apicache.clear() with no target empties the store but leaves each entry's
// expiry timer armed; clearing entry by entry stops both.
function clearCache() {
  apicache.getIndex().all.forEach((key) => apicache.clear(key));
}

function appWith(table) {
  const app = express();
  // express logs a handler's error to stderr outside test mode
  app.set('env', 'test');
  registerRoutes(app, table);
  return app;
}

describe('routeBuilder', () => {
  let handlers;

  beforeEach(() => {
    clearCache();
    handlers = {
      calls: 0,
      answer(req, res) {
        handlers.calls += 1;
        res.json({ answered: 'answer' });
      },
      reject() {
        return Promise.reject(new Error('handler failed'));
      },
    };
  });

  afterEach(() => {
    clearCache();
  });

  it('registers the guards in order, then the cache, then the limit, then the handler', () => {
    const chain = chainFor({
      method: 'get',
      path: '/x',
      guards: ['rejectQueryParameters', 'requireBootSettled'],
      cache: '30 seconds',
      limit: 'permanentMessageQuery',
      module: handlers,
      fn: 'answer',
    });

    expect(chain).to.have.length(5);
    expect(chain[0]).to.equal(rejectQueryParameters);
    expect(chain[1]).to.equal(requireBootSettled);
    expect(chain[2].name).to.equal('cache');
    expect(chain[3]).to.equal(LIMITS.permanentMessageQuery);
  });

  it('registers only the handler for a route with no guard, cache or limit', () => {
    expect(chainFor({ method: 'get', path: '/x', module: handlers, fn: 'answer' })).to.have.length(1);
  });

  it('reads the handler function from its module on every call', async () => {
    const app = appWith([{ method: 'get', path: '/live', module: handlers, fn: 'answer' }]);
    expect((await request(app).get('/live')).body).to.deep.equal({ answered: 'answer' });

    handlers.answer = (req, res) => res.json({ answered: 'replaced' });

    expect((await request(app).get('/live')).body).to.deep.equal({ answered: 'replaced' });
  });

  it('answers 500 for a handler that rejects, rather than dropping the promise', async () => {
    const app = appWith([{ method: 'get', path: '/fails', module: handlers, fn: 'reject' }]);

    expect((await request(app).get('/fails')).status).to.equal(500);
  });

  it('answers a cached route from its cache, without calling the handler again', async () => {
    const app = appWith([{ method: 'get', path: '/cached', cache: '30 seconds', module: handlers, fn: 'answer' }]);

    await request(app).get('/cached');
    await request(app).get('/cached');

    expect(handlers.calls).to.equal(1);
  });

  it('refuses to register a route naming an unknown guard, an unknown limit, or a function its module lacks', () => {
    expect(() => chainFor({ method: 'get', path: '/x', guards: ['noSuchGuard'], module: handlers, fn: 'answer' }))
      .to.throw(/GET \/x names unknown guard noSuchGuard/);
    expect(() => chainFor({ method: 'get', path: '/x', limit: 'noSuchLimit', module: handlers, fn: 'answer' }))
      .to.throw(/GET \/x names unknown limit noSuchLimit/);
    expect(() => chainFor({ method: 'post', path: '/x', module: handlers, fn: 'missing' }))
      .to.throw(/POST \/x names missing/);
    expect(() => chainFor({ method: 'post', path: '/x', fn: 'answer' }))
      .to.throw(/POST \/x names answer/);
  });
});
