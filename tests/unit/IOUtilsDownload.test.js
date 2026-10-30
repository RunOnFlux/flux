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

  // The URL check and the guarded agents refuse loopback, which is all a test
  // server can be, so both stand aside: without guarded agents a request goes
  // through the global ones. The guard is IOUtilsGuardedRequests.test.js's.
  const IOUtils = proxyquire('../../ZelBack/src/services/IOUtils', {
    './utils/urlSecurity': { validateUrl: () => {}, guardedRequestOptions: () => ({}) },
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

  it('does not write through a link at the destination', async () => {
    handler = (req, res) => serve(req, res);
    const elsewhere = path.join(dir, 'elsewhere');
    fs.writeFileSync(elsewhere, 'untouched');
    fs.symlinkSync(elsewhere, path.join(dir, 'backup_comp.tar.gz'));

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, { ...fast, maxAttempts: 1 });

    expect(result).to.equal(false);
    expect(fs.readFileSync(elsewhere, 'utf8')).to.equal('untouched');
  });

  it('asks once, not once per attempt, when the destination is a link', async () => {
    handler = (req, res) => serve(req, res);
    fs.writeFileSync(path.join(dir, 'elsewhere'), 'untouched');
    fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, 'backup_comp.tar.gz'));

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, fast);

    expect(result).to.equal(false);
    expect(requests).to.have.length(1);
    expect(fs.readFileSync(path.join(dir, 'elsewhere'), 'utf8')).to.equal('untouched');
    // the link is not a file this download made, and stays
    expect(fs.lstatSync(path.join(dir, 'backup_comp.tar.gz')).isSymbolicLink()).to.equal(true);
  });

  it('removes nothing through a directory that has become a link when beforeOpen refuses', async () => {
    handler = (req, res) => serve(req, res);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxdl-target-'));
    fs.writeFileSync(path.join(target, 'backup_comp.tar.gz'), 'someone else\'s file');
    const linked = path.join(dir, 'remote');
    fs.symlinkSync(target, linked);

    const result = await IOUtils.downloadFileFromUrl(baseUrl, linked, 'COMP', true, {
      ...fast,
      beforeOpen: async () => { throw new Error('Refused'); },
    });

    expect(result).to.equal(false);
    expect(fs.readFileSync(path.join(target, 'backup_comp.tar.gz'), 'utf8')).to.equal('someone else\'s file');
    fs.rmSync(target, { recursive: true, force: true });
  });

  it('stops without asking again when beforeOpen refuses, and writes nothing', async () => {
    handler = (req, res) => serve(req, res);
    let calls = 0;
    const beforeOpen = async () => {
      calls += 1;
      throw new Error('Refused');
    };

    const result = await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, { ...fast, beforeOpen });

    expect(result).to.equal(false);
    expect(calls).to.equal(1);
    expect(requests).to.have.length(1);
    expect(fs.existsSync(path.join(dir, 'backup_comp.tar.gz'))).to.equal(false);
  });

  it('calls beforeOpen once the server has answered and before the file is opened', async () => {
    handler = (req, res) => serve(req, res);
    let requestsSeen;
    let fileExisted;
    const beforeOpen = async () => {
      requestsSeen = requests.length;
      fileExisted = fs.existsSync(path.join(dir, 'backup_comp.tar.gz'));
    };

    await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, { ...fast, beforeOpen });

    expect(requestsSeen).to.equal(1);
    expect(fileExisted).to.equal(false);
    expect(saved().equals(body)).to.equal(true);
  });

  it('removes the partial archive when every attempt fails', async () => {
    handler = (req, res) => serve(req, res, { stallAt: 1000, honourRange: false });

    await IOUtils.downloadFileFromUrl(baseUrl, dir, 'COMP', true, { ...fast, maxAttempts: 2 });

    expect(fs.existsSync(path.join(dir, 'backup_comp.tar.gz'))).to.equal(false);
  });

  it('refuses a destination that really lies outside containedIn, and writes nothing there', async () => {
    handler = (req, res) => serve(req, res);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxout-'));
    const inside = path.join(dir, 'remote');
    fs.mkdirSync(path.join(dir, 'inner'));
    fs.symlinkSync(outside, inside);
    fs.writeFileSync(path.join(outside, 'backup_comp.tar.gz'), 'keep');
    try {
      const result = await IOUtils.downloadFileFromUrl(baseUrl, inside, 'COMP', true, { ...fast, containedIn: path.join(dir, 'inner') });
      expect(result).to.equal(false);
      expect(fs.readFileSync(path.join(outside, 'backup_comp.tar.gz'), 'utf8')).to.equal('keep');
      expect(requests.length).to.equal(1);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('writes when the destination is inside containedIn', async () => {
    handler = (req, res) => serve(req, res);
    const inner = path.join(dir, 'inner');
    fs.mkdirSync(inner);
    const result = await IOUtils.downloadFileFromUrl(baseUrl, inner, 'COMP', true, { ...fast, containedIn: inner });
    expect(result).to.equal(true);
    expect(fs.readFileSync(path.join(inner, 'backup_comp.tar.gz')).equals(body)).to.equal(true);
  });

  it('refuses a destination reached through a swapped directory when containedIn is the mount above it', async () => {
    handler = (req, res) => serve(req, res);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxout-'));
    const mount = path.join(dir, 'mount');
    fs.mkdirSync(mount);
    fs.symlinkSync(outside, path.join(mount, 'remote'));
    try {
      const result = await IOUtils.downloadFileFromUrl(baseUrl, path.join(mount, 'remote'), 'COMP', true, { ...fast, containedIn: mount });
      expect(result).to.equal(false);
      expect(fs.readdirSync(outside).filter((f) => fs.statSync(path.join(outside, f)).size > 0)).to.deep.equal([]);
      expect(requests.length).to.equal(1);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
