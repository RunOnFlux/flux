const http = require('node:http');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');
const { once, EventEmitter } = require('node:events');
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const express = require('express');
const compression = require('compression');
const config = require('config');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const permanentMessageLog = require('../../ZelBack/src/services/appMessaging/permanentMessageLog');
const { FluxServer } = require('../../ZelBack/src/lib/fluxServer');
const { requireMongo } = require('./dbTestHelper');

const { readMessageLog, writeMessageLog, MESSAGE_LOG_CONTENT_TYPE } = permanentMessageLog;

const message = (i, height = 1000 + i) => ({
  type: 'fluxappregister',
  version: 1,
  hash: `log-hash-${i}`,
  timestamp: 1700000000000 + i,
  signature: `sig${i}`,
  txid: `tx${i}`,
  height,
  valueSat: 100,
  appSpecifications: { name: `logapp${i}`, version: 4, owner: 'alice' },
});

async function collect(iterable) {
  const items = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const item of iterable) items.push(item);
  return items;
}

/**
 * Serves the route through the compression filter the node uses, and returns the server's base
 * URL and a way to close it.
 */
async function serve(handler) {
  const app = express();
  app.use(compression({ filter: FluxServer.shouldCompress }));
  app.get('/apps/permanentmessagesbyheight', handler);
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}/apps/permanentmessagesbyheight`, server };
}

/** GETs a URL, returning the response and its body decoded as a client asking for gzip sees it. */
async function get(url) {
  const res = await new Promise((resolve, reject) => {
    http.get(url, { headers: { 'Accept-Encoding': 'gzip' } }, resolve).on('error', reject);
  });
  const body = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
  return { res, body };
}

describe('permanentMessageLog tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('readMessageLog', () => {
    const closing = (count) => JSON.stringify({ status: 'success', data: { count } });
    const body = (...pieces) => Readable.from(pieces.map((piece) => Buffer.from(piece)));

    it('yields each message of a complete log, across chunk boundaries', async () => {
      const text = `${JSON.stringify(message(1))}\n${JSON.stringify(message(2))}\n${closing(2)}\n`;
      const read = await collect(readMessageLog(body(text.slice(0, 17), text.slice(17, 200), text.slice(200))));
      expect(read).to.deep.equal([message(1), message(2)]);
    });

    it('yields what arrived, then throws, for a log without its closing line', async () => {
      const read = [];
      let error;
      try {
        // eslint-disable-next-line no-restricted-syntax
        for await (const entry of readMessageLog(body(`${JSON.stringify(message(1))}\n`))) read.push(entry);
      } catch (e) {
        error = e;
      }
      expect(read).to.deep.equal([message(1)]);
      expect(error.message).to.equal('message log ended after 1 messages without its closing line');
    });

    it('throws for a log whose closing count does not match its lines', async () => {
      const text = `${JSON.stringify(message(1))}\n${closing(2)}\n`;
      await collect(readMessageLog(body(text))).then(
        () => expect.fail('read a short log as whole'),
        (error) => expect(error.message).to.equal('message log closed on 2 messages, 1 arrived'),
      );
    });

    it('throws for a line after the closing line', async () => {
      const text = `${closing(0)}\n${JSON.stringify(message(1))}\n`;
      await collect(readMessageLog(body(text))).then(
        () => expect.fail('read past the closing line'),
        (error) => expect(error.message).to.equal('message log continues past its closing line'),
      );
    });

    it('throws for a body cut off part way through a line', async () => {
      const text = `${JSON.stringify(message(1))}\n${JSON.stringify(message(2)).slice(0, 30)}`;
      await collect(readMessageLog(body(text))).then(
        () => expect.fail('read a cut-off line'),
        (error) => expect(error).to.be.instanceOf(SyntaxError),
      );
    });

    it('throws the server\'s reason for a request it refused', async () => {
      const refusal = JSON.stringify({ status: 'error', data: { code: undefined, name: 'Error', message: 'fromHeight must be a block height' } });
      await collect(readMessageLog(body(refusal))).then(
        () => expect.fail('read a refusal as a log'),
        (error) => expect(error.message).to.equal('peer could not read its message log: fromHeight must be a block height'),
      );
    });
  });

  describe('writeMessageLog', () => {
    // A response that takes nothing more until drained, as a client that stopped reading leaves it.
    function stalledResponse() {
      const res = new EventEmitter();
      res.written = [];
      res.write = sinon.stub().callsFake((piece) => { res.written.push(piece); return false; });
      res.end = sinon.stub();
      return res;
    }

    it('reads no further from the database while the client is not taking the log', async () => {
      const big = { ...message(0), padding: 'x'.repeat(70 * 1024) };
      let pulled = 0;
      async function* cursor() {
        for (let i = 0; i < 10; i += 1) {
          pulled += 1;
          yield { ...big, hash: `log-hash-${i}` };
        }
      }
      const res = stalledResponse();
      let closed = false;
      res.once('close', () => { closed = true; });
      const writing = writeMessageLog(res, cursor(), () => closed);
      await new Promise((resolve) => { setImmediate(resolve); });

      expect(pulled).to.equal(1);
      expect(res.write.callCount).to.equal(1);

      res.emit('drain');
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(pulled).to.equal(2);

      res.emit('close');
      await writing;
      expect(pulled).to.equal(2);
      expect(res.end.called).to.equal(false);
    });

    it('stops reading from the database once the client has gone', async () => {
      let pulled = 0;
      let closed = false;
      async function* cursor() {
        for (let i = 0; i < 10; i += 1) {
          pulled += 1;
          if (i === 3) closed = true;
          yield message(i);
        }
      }
      const res = stalledResponse();
      await writeMessageLog(res, cursor(), () => closed);

      expect(pulled).to.equal(4);
      expect(res.end.called).to.equal(false);
    });
  });

  describe('getPermanentMessagesByHeightAPI', () => {
    let server;

    afterEach(async () => {
      if (server) {
        server.closeAllConnections();
        server.close();
        server = null;
      }
    });

    /** The route served from a database that yields `messages`, then throws `failure`. */
    async function serveFrom(messages, failure) {
      const cursor = {
        closed: false,
        async* [Symbol.asyncIterator]() {
          // eslint-disable-next-line no-restricted-syntax
          for (const item of messages) yield item;
          if (failure) throw failure;
        },
        async close() {
          this.closed = true;
        },
      };
      const find = sinon.stub().returns({ sort: sinon.stub().returns(cursor) });
      const log = proxyquire('../../ZelBack/src/services/appMessaging/permanentMessageLog', {
        '../dbHelper': { databaseConnection: () => ({ db: () => ({ collection: () => ({ find }) }) }) },
        '../../lib/log': { error: sinon.stub() },
      });
      const served = await serve(log.getPermanentMessagesByHeightAPI);
      ({ server } = served);
      return { url: served.url, find, cursor };
    }

    it('serves a log compressed, as one message per line and a closing count', async () => {
      const messages = Array(2000).fill(null).map((_, i) => message(i));
      const { url, find, cursor } = await serveFrom(messages);

      const { res, body } = await get(`${url}?fromHeight=1000&toHeight=2999`);

      expect(res.headers['content-type']).to.equal(MESSAGE_LOG_CONTENT_TYPE);
      expect(res.headers['content-encoding']).to.equal('gzip');
      expect(await collect(readMessageLog(body))).to.deep.equal(messages);
      expect(find.firstCall.args[0]).to.deep.equal({ height: { $gte: 1000, $lte: 2999 } });
      expect(cursor.closed).to.equal(true);
    });

    it('ends a log it could not read to the end with an error line, after the messages it sent', async () => {
      const messages = Array(2000).fill(null).map((_, i) => message(i));
      const { url, cursor } = await serveFrom(messages, new Error('cursor killed'));

      const { body } = await get(`${url}?fromHeight=1000&toHeight=2999`);
      const read = [];
      let error;
      try {
        // eslint-disable-next-line no-restricted-syntax
        for await (const entry of readMessageLog(body)) read.push(entry);
      } catch (e) {
        error = e;
      }

      expect(read).to.deep.equal(messages);
      expect(error.message).to.equal('peer could not read its message log: cursor killed');
      expect(cursor.closed).to.equal(true);
    });

    it('answers an error envelope when the log fails before its first line', async () => {
      const { url } = await serveFrom([], new Error('database gone'));

      const { res, body } = await get(`${url}?fromHeight=1&toHeight=2`);

      expect(res.headers['content-type']).to.match(/^application\/json/);
      await collect(readMessageLog(body)).then(
        () => expect.fail('read a failure as a log'),
        (error) => expect(error.message).to.equal('peer could not read its message log: database gone'),
      );
    });

    [
      ['no heights', '', 'fromHeight must be a block height'],
      ['a height that is not a number', '?fromHeight=abc&toHeight=5', 'fromHeight must be a block height'],
      ['a negative height', '?fromHeight=-1&toHeight=5', 'fromHeight must be a block height'],
      ['a fractional height', '?fromHeight=1&toHeight=5.5', 'toHeight must be a block height'],
      ['a height given twice', '?fromHeight=1&fromHeight=2&toHeight=5', 'fromHeight must be a block height'],
      ['a range that runs backwards', '?fromHeight=6&toHeight=5', 'fromHeight must not be above toHeight'],
    ].forEach(([name, query, reason]) => {
      it(`refuses ${name} without reading the database`, async () => {
        const { url, find } = await serveFrom([]);

        const { body } = await get(`${url}${query}`);
        const [text] = await collect(body);

        expect(JSON.parse(text.toString())).to.deep.equal({ status: 'error', data: { name: 'Error', message: reason } });
        expect(find.called).to.equal(false);
      });
    });

    describe('against the database', () => {
      const { appsMessages } = config.database.appsglobal.collections;
      let collection;

      before(async function () {
        await requireMongo.call(this);
        collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(appsMessages);
      });

      beforeEach(async () => {
        await collection.deleteMany({ hash: /^log-hash-/ });
      });

      after(async () => {
        await collection?.deleteMany({ hash: /^log-hash-/ });
      });

      it('serves the messages paid within the range, inclusive, in height order, without their ids', async () => {
        await collection.insertMany([message(1, 1003), message(2, 999), message(3, 1000), message(4, 1005), message(5, 1006)]);
        const served = await serve(permanentMessageLog.getPermanentMessagesByHeightAPI);
        ({ server } = served);

        const { body } = await get(`${served.url}?fromHeight=1000&toHeight=1005`);
        const read = await collect(readMessageLog(body));

        expect(read.map((entry) => entry.height)).to.deep.equal([1000, 1003, 1005]);
        expect(read[0]).to.deep.equal(message(3, 1000));
      });
    });
  });
});
