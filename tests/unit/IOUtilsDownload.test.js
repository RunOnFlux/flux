const { expect } = require('chai');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const proxyquire = require('proxyquire');

// A remote restore stops the app and then waits on this download, holding the
// app's restore lease until it settles. These run against a real HTTP server so
// that what is exercised is the stream plumbing itself: a body that goes silent
// or a socket that dies mid-body must fail the attempt, never leave it pending.
describe('IOUtils downloadFileFromUrl', () => {
  const body = Buffer.from(Array.from({ length: 64 * 1024 }, (_, i) => i % 251));
  let server;
  let baseUrl;
  let dir;
  let handler;
  const requests = [];
  const seen = [];

  // The SSRF check refuses loopback, which is all a test server can be.
  const IOUtils = proxyquire('../../ZelBack/src/services/IOUtils', {
    './utils/urlSecurity': { validateUrlWithDns: async () => {} },
    '../lib/log': { info: () => {}, error: () => {}, warn: () => {} },
  });

  const fast = { idleTimeoutMs: 200, retryDelayMs: 0 };
  const saved = () => fs.readFileSync(path.join(dir, 'backup_comp.tar.gz'));

  // Serves the body from the requested offset, honouring a Range header.
  const serve = (req, res, {
    honourRange = true, cutAt = null, stallAt = null, etag = '"v1"', content = body,
  } = {}) => {
    const match = /bytes=(\d+)-/.exec(req.headers.range || '');
    // If-Range that no longer matches: the whole (new) file, as RFC 9110 says
    const stale = req.headers['if-range'] && req.headers['if-range'] !== etag;
    const start = honourRange && match && !stale ? Number(match[1]) : 0;
    const headers = { 'content-length': content.length - start, etag };
    if (start > 0) headers['content-range'] = `bytes ${start}-${content.length - 1}/${content.length}`;
    res.writeHead(start > 0 ? 206 : 200, headers);
    const stopAt = cutAt ?? stallAt;
    if (stopAt === null) {
      res.end(content.subarray(start));
      return;
    }
    res.write(content.subarray(start, stopAt));
    if (cutAt !== null) setTimeout(() => req.socket.destroy(), 20);
    // a stall just never writes again, with the socket left open
  };

  beforeEach((done) => {
    requests.length = 0;
    seen.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxdl-'));
    server = http.createServer((req, res) => {
      requests.push(req.headers.range || null);
      seen.push(req.headers);
      handler(req, res, requests.length);
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/backup.tar.gz`;
      done();
    });
  });

  afterEach((done) => {
    server.closeAllConnections();
    server.close(() => done());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('saves a complete download in one attempt', async () => {
    handler = (req, res) => serve(req, res);

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(true);
    expect(requests).to.deep.equal([null]);
    expect(saved().equals(body)).to.equal(true);
  });

  it('abandons a body that goes silent and resumes it from the bytes on disk', async () => {
    handler = (req, res, n) => serve(req, res, n === 1 ? { stallAt: 20000 } : {});

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(true);
    expect(requests).to.deep.equal([null, 'bytes=20000-']);
    expect(saved().equals(body)).to.equal(true);
  });

  it('settles when the connection dies mid-body, and resumes', async () => {
    handler = (req, res, n) => serve(req, res, n === 1 ? { cutAt: 30000 } : {});

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(true);
    expect(requests[1]).to.equal('bytes=30000-');
    expect(saved().equals(body)).to.equal(true);
  });

  it('starts over when the server ignores the range', async () => {
    handler = (req, res, n) => serve(req, res, n === 1 ? { stallAt: 20000 } : { honourRange: false });

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(true);
    expect(saved().equals(body)).to.equal(true);
  });

  it('returns false, not a pending promise, when every attempt stalls', async () => {
    handler = (req, res) => serve(req, res, { stallAt: 1000, honourRange: false });

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, { ...fast, maxAttempts: 2 });

    expect(result).to.equal(false);
    expect(requests).to.have.length(2);
  });

  it('asks for the raw bytes, so a server that would compress cannot change the file', async () => {
    handler = (req, res) => serve(req, res);

    await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(seen[0]['accept-encoding']).to.equal('identity');
  });

  it('sends If-Range on a resume, and starts over when the file changed meanwhile', async () => {
    const changed = Buffer.from(body).reverse();
    handler = (req, res, n) => serve(req, res, n === 1 ? { stallAt: 20000 } : { etag: '"v2"', content: changed });

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(true);
    expect(seen[1]['if-range']).to.equal('"v1"');
    expect(saved().equals(changed), 'the new file alone, nothing spliced onto the old one').to.equal(true);
  });

  it('starts over from nothing after a 416', async () => {
    handler = (req, res, n) => {
      if (n === 2) {
        res.writeHead(416, { 'content-range': `bytes */${body.length}` });
        res.end();
        return;
      }
      serve(req, res, n === 1 ? { stallAt: 20000 } : {});
    };

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(true);
    expect(requests).to.deep.equal([null, 'bytes=20000-', null]);
    expect(saved().equals(body)).to.equal(true);
  });

  it('does not ask again after a 404, and leaves no file behind', async () => {
    handler = (req, res) => {
      res.writeHead(404);
      res.end();
    };

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(false);
    expect(requests).to.have.length(1);
    expect(fs.existsSync(path.join(dir, 'backup_comp.tar.gz'))).to.equal(false);
  });

  it('removes the partial archive when every attempt fails', async () => {
    handler = (req, res) => serve(req, res, { stallAt: 1000, honourRange: false });

    await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, { ...fast, maxAttempts: 2 });

    expect(fs.existsSync(path.join(dir, 'backup_comp.tar.gz'))).to.equal(false);
  });
});
