const chai = require('chai');
chai.use(require('chai-as-promised'));

const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { FluxRpc } = require('../../ZelBack/src/services/utils/fluxRpc');

const { expect } = chai;

const auth = { username: 'fluxbenchuser', password: 'fluxbenchpassword' };
const basicAuth = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;

describe('fluxRpc transport tests', () => {
  const socketPath = path.join(os.tmpdir(), `fluxos-unit-rpc-${process.pid}.sock`);
  let requests;
  let servers;

  // A daemon that answers every call, or every call in a batch, with the
  // transport it arrived on. Each reply closes its connection, so a call made
  // straight after a daemon stops never meets a pooled connection the client
  // has yet to see closed.
  function daemon(via, answer = (id) => ({ result: via, error: null, id })) {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ via, authorization: req.headers.authorization });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Connection', 'close');
        const payload = JSON.parse(body);
        const reply = Array.isArray(payload) ? payload.map((call) => answer(call.id)) : answer(payload.id);
        res.end(JSON.stringify(reply));
      });
    });
    servers.push(server);
    return server;
  }

  async function listen(server, ...args) {
    await new Promise((resolve) => { server.listen(...args, resolve); });
    return server;
  }

  async function close(server) {
    servers = servers.filter((s) => s !== server);
    await new Promise((resolve) => { server.close(resolve); });
  }

  async function tcpDaemon() {
    const server = await listen(daemon('tcp'), 0, '127.0.0.1');
    return `http://127.0.0.1:${server.address().port}`;
  }

  // An address nothing listens on.
  async function refusedUri() {
    const server = await listen(http.createServer(), 0, '127.0.0.1');
    const { port } = server.address();
    await new Promise((resolve) => { server.close(resolve); });
    return `http://127.0.0.1:${port}`;
  }

  function client(uri) {
    return new FluxRpc(uri, { auth, socketPath, mode: 'fluxbenchd' });
  }

  beforeEach(async () => {
    requests = [];
    servers = [];
    await fs.rm(socketPath, { force: true });
  });

  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => { s.close(resolve); })));
    await fs.rm(socketPath, { force: true });
  });

  it('calls over the socket, with no credentials, while the daemon serves one', async () => {
    const rpc = client(await tcpDaemon());
    await listen(daemon('socket'), socketPath);

    expect(await rpc.run('getstatus')).to.equal('socket');
    expect(requests).to.eql([{ via: 'socket', authorization: undefined }]);
  });

  it('calls over TCP with its credentials when there is no socket', async () => {
    const rpc = client(await tcpDaemon());

    expect(await rpc.run('getstatus')).to.equal('tcp');
    expect(requests).to.eql([{ via: 'tcp', authorization: basicAuth }]);
  });

  it('calls over TCP when the socket path holds something other than a socket', async () => {
    await fs.writeFile(socketPath, '');
    const rpc = client(await tcpDaemon());

    expect(await rpc.run('getstatus')).to.equal('tcp');
  });

  it('answers a refused TCP call over the socket the daemon has since bound', async () => {
    const rpc = client(await refusedUri());
    await expect(rpc.run('getstatus')).to.be.rejected.and.eventually.have.property('code', 'ECONNREFUSED');

    await listen(daemon('socket'), socketPath);

    expect(await rpc.run('getstatus')).to.equal('socket');
    expect(requests).to.eql([{ via: 'socket', authorization: undefined }]);
  });

  it('answers over TCP, with its credentials, once the socket is gone', async () => {
    const rpc = client(await tcpDaemon());
    const socketDaemon = await listen(daemon('socket'), socketPath);
    expect(await rpc.run('getstatus')).to.equal('socket');

    await close(socketDaemon);

    expect(await rpc.run('getstatus')).to.equal('tcp');
    expect(requests).to.eql([
      { via: 'socket', authorization: undefined },
      { via: 'tcp', authorization: basicAuth },
    ]);
  });

  it('carries a batch over the transport it moves to', async () => {
    const rpc = client(await tcpDaemon());
    const socketDaemon = await listen(daemon('socket'), socketPath);
    await rpc.run('getstatus');
    await close(socketDaemon);

    const [answer] = await rpc.runBatch([{ method: 'getstatus' }]);

    expect(answer.result).to.equal('tcp');
    expect(requests.map((r) => r.via)).to.eql(['socket', 'tcp']);
  });

  it('never sends a call again once it may have reached the daemon', async () => {
    const resetting = http.createServer((req) => {
      requests.push({ via: 'tcp' });
      req.socket.destroy();
    });
    servers.push(resetting);
    await listen(resetting, 0, '127.0.0.1');
    const rpc = client(`http://127.0.0.1:${resetting.address().port}`);
    await expect(rpc.run('getstatus')).to.be.rejected;
    await listen(daemon('socket'), socketPath);

    await expect(rpc.run('getstatus')).to.be.rejected;

    expect(requests.map((r) => r.via)).to.eql(['tcp', 'tcp']);
  });

  it('reports a daemon that is down on both transports', async () => {
    const rpc = client(await refusedUri());

    await expect(rpc.run('getstatus')).to.be.rejected.and.eventually.have.property('code', 'ECONNREFUSED');
  });

  it('keeps its transport when the daemon answers with an error', async () => {
    const rpc = client(await tcpDaemon());
    await listen(daemon('socket', (id) => ({ result: null, error: { code: -32601, message: 'Method not found' }, id })), socketPath);

    await expect(rpc.run('getstatus')).to.be.rejectedWith('Method not found');
    await expect(rpc.run('getstatus')).to.be.rejectedWith('Method not found');

    expect(requests.map((r) => r.via)).to.eql(['socket', 'socket']);
  });

  it('calls over TCP with its credentials when given no socket path', async () => {
    await listen(daemon('socket'), socketPath);
    const rpc = new FluxRpc(await tcpDaemon(), { auth, mode: 'fluxbenchd' });

    expect(await rpc.run('getstatus')).to.equal('tcp');
    expect(requests).to.eql([{ via: 'tcp', authorization: basicAuth }]);
  });
});
