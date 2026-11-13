const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');
const config = require('config');
const express = require('express');
const WebSocket = require('ws');

const apiSocket = require('../../ZelBack/src/services/utils/apiSocket');
const { FluxServer } = require('../../ZelBack/src/lib/fluxServer');
const isLocal = require('../../ZelBack/src/middlewares/isLocal');
const { resolveClientIp } = require('../../ZelBack/src/services/utils/ingressCapture');

function requestOverSocket(socketPath, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, ...options }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('apiSocket tests', () => {
  const before = process.env.FLUXOS_API_SOCKET;

  afterEach(() => {
    if (before === undefined) delete process.env.FLUXOS_API_SOCKET;
    else process.env.FLUXOS_API_SOCKET = before;
  });

  describe('off the socket', () => {
    beforeEach(() => { delete process.env.FLUXOS_API_SOCKET; });

    it('reads the connection, and no header', () => {
      const req = { socket: { remoteAddress: '1.2.3.4' }, headers: { 'x-forwarded-for': '9.9.9.9' } };
      expect(apiSocket.callerAddress(req)).to.equal('1.2.3.4');
    });

    it('prefers what Express decided', () => {
      expect(apiSocket.callerAddress({ ip: '1.2.3.4', socket: { remoteAddress: '5.6.7.8' } })).to.equal('1.2.3.4');
    });

    it('reads a balancer chain from X-Forwarded-For', () => {
      expect(apiSocket.forwardedChain({ 'x-forwarded-for': 'a', 'x-upstream-forwarded-for': 'b' })).to.equal('a');
    });
  });

  describe('router mappings behind the proxy', () => {
    const upnpService = require('../../ZelBack/src/services/upnpService');

    beforeEach(() => { process.env.FLUXOS_API_SOCKET = '/run/fluxos/api.sock'; });

    it('leaves the public ports to configd and is ready at once', async () => {
      expect(await upnpService.setupUPNP(16127)).to.equal(true);
      expect(await upnpService.startMapping(16127, { learn: () => {} })).to.equal(true);
      expect(upnpService.isUPNPReady()).to.equal(true);
    });
  });

  describe('behind the proxy', () => {
    let dir;
    let server;
    let socketPath;

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apisock-'));
      socketPath = path.join(dir, 'api.sock');
      process.env.FLUXOS_API_SOCKET = socketPath;
      const app = express();
      server = new FluxServer({ expressApp: app, routeBuilder: () => {} });
      app.set('trust proxy', apiSocket.TRUSTED_HOPS);
      app.get('/who', (req, res) => res.json({ ip: req.ip, helper: apiSocket.callerAddress(req), secure: req.secure }));
      app.get('/local', isLocal, (req, res) => res.send('local'));
      await server.listen({ path: socketPath, backlog: apiSocket.SOCKET_BACKLOG });
    });

    afterEach(async () => {
      await new Promise((resolve) => { server.close(resolve); });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reports no port and opens the socket 0660', () => {
      expect(server.port).to.equal(null);
      expect(fs.statSync(socketPath).mode & 0o777).to.equal(0o660);
    });

    it('takes the caller from the hop nginx wrote', async () => {
      const { body } = await requestOverSocket(socketPath, {
        path: '/who', headers: { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' },
      });
      expect(JSON.parse(body)).to.deep.equal({ ip: '203.0.113.7', helper: '203.0.113.7', secure: true });
    });

    it('keeps a claim out of the address: only the last entry is the hop nginx wrote', async () => {
      const { body } = await requestOverSocket(socketPath, {
        path: '/who', headers: { 'x-forwarded-for': '127.0.0.1, 203.0.113.7' },
      });
      expect(JSON.parse(body).ip).to.equal('203.0.113.7');
    });

    it('holds isLocal for a local caller and refuses a remote one', async () => {
      const local = await requestOverSocket(socketPath, { path: '/local', headers: { 'x-forwarded-for': '127.0.0.1' } });
      const remote = await requestOverSocket(socketPath, { path: '/local', headers: { 'x-forwarded-for': '203.0.113.7' } });
      expect(local.status).to.equal(200);
      expect(remote.status).to.equal(401);
    });

    it('never compresses', async () => {
      server.app.get('/big', (req, res) => res.type('text/plain').send('x'.repeat(10000)));
      const { headers } = await requestOverSocket(socketPath, { path: '/big', headers: { 'accept-encoding': 'gzip' } });
      expect(headers['content-encoding']).to.equal(undefined);
    });

    it('replaces a stale socket', async () => {
      await new Promise((resolve) => { server.close(resolve); });
      fs.writeFileSync(socketPath, '');
      await server.listen({ path: socketPath, backlog: apiSocket.SOCKET_BACKLOG });
      const { status } = await requestOverSocket(socketPath, { path: '/who' });
      expect(status).to.equal(200);
    });

    it('reads an upgrade request as Express reads a request', () => {
      const upgrade = { socket: {}, connection: {}, headers: { 'x-forwarded-for': '203.0.113.7' } };
      expect(apiSocket.callerAddress(upgrade)).to.equal('203.0.113.7');
    });

    it('takes a balancer chain from the header nginx passes it in', () => {
      expect(apiSocket.forwardedChain({ 'x-forwarded-for': 'a', 'x-upstream-forwarded-for': 'b' })).to.equal('b');
    });

    it('resolves a client behind a recognised balancer from that chain', function test() {
      if (!config.has('fdmAddresses') || !config.get('fdmAddresses').length) this.skip();
      const balancer = config.get('fdmAddresses')[0];
      const headers = { 'x-forwarded-for': balancer, 'x-upstream-forwarded-for': '203.0.113.7' };
      expect(resolveClientIp(balancer, headers)).to.deep.equal({ ip: '203.0.113.7', source: 'forwarded' });
    });

    it('takes a websocket through the socket', async () => {
      const opened = new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws+unix:${socketPath}:/ws/flux/nosuchroute`);
        ws.on('error', () => resolve('refused'));
        ws.on('close', () => resolve('closed'));
        ws.on('open', () => { ws.close(); resolve('opened'); });
        setTimeout(() => reject(new Error('no answer')), 3000);
      });
      expect(await opened).to.be.oneOf(['refused', 'closed', 'opened']);
    });
  });

  // Behind the proxy a request's socket is a Unix socket, which has no peer address: the caller
  // is read through callerAddress. The node service listens for apps on its own TCP socket, so its
  // peer is the app's container.
  describe('who reads a raw peer address', () => {
    const ROOT = path.join(__dirname, '../..');
    const RAW_PEER = /\b(socket|connection)\??\.remoteAddress\b/;

    it('is apiSocket and the node service alone', () => {
      const readers = execFileSync('git', ['-C', ROOT, 'ls-files', 'ZelBack/src'], { encoding: 'utf8' })
        .split('\n')
        .filter((file) => file.endsWith('.js'))
        .filter((file) => RAW_PEER.test(fs.readFileSync(path.join(ROOT, file), 'utf8')))
        .sort();

      expect(readers).to.deep.equal([
        'ZelBack/src/services/fluxNodeService.js',
        'ZelBack/src/services/utils/apiSocket.js',
      ]);
    });
  });
});
