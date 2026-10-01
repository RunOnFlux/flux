const chai = require('chai');
const sinon = require('sinon');
const net = require('node:net');
const fs = require('node:fs/promises');
const config = require('config');

const fluxRpc = require('../../ZelBack/src/services/utils/fluxRpc');

const { expect } = chai;

const SERVICE = '../../ZelBack/src/services/benchmarkService';

// The service caches its client, so each test starts from a fresh copy.
function freshService() {
  delete require.cache[require.resolve(SERVICE)];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(SERVICE);
}

function rpcError(code) {
  return Object.assign(new Error(`rpc failed: ${code}`), { code });
}

describe('benchmarkService transport tests', () => {
  const { socketPath } = config.benchmark;
  let server = null;
  let run;

  async function offerSocket() {
    await fs.rm(socketPath, { force: true });
    server = net.createServer();
    await new Promise((resolve) => { server.listen(socketPath, resolve); });
  }

  beforeEach(async () => {
    await fs.rm(socketPath, { force: true });
    run = sinon.stub(fluxRpc.FluxRpc.prototype, 'run');
  });

  afterEach(async () => {
    sinon.restore();
    if (server) await new Promise((resolve) => { server.close(resolve); });
    server = null;
    await fs.rm(socketPath, { force: true });
  });

  it('calls over the socket, with no credentials, when the daemon offers one', async () => {
    await offerSocket();
    run.resolves('ok');

    const response = await freshService().executeCall('getstatus');

    expect(response.status).to.equal('success');
    const client = run.firstCall.thisValue;
    expect(client.socketPath).to.equal(socketPath);
    expect(client.auth).to.equal(null);
  });

  it('calls over TCP with the bench credentials when there is no socket', async () => {
    run.resolves('ok');

    await freshService().executeCall('getstatus');

    const client = run.firstCall.thisValue;
    expect(client.socketPath).to.equal(null);
    expect(client.auth.username).to.match(/benchuser$/);
  });

  it('calls over TCP when the path holds something other than a socket', async () => {
    await fs.writeFile(socketPath, '');
    run.resolves('ok');

    await freshService().executeCall('getstatus');

    expect(run.firstCall.thisValue.socketPath).to.equal(null);
  });

  it('moves to the socket once the daemon offers it after a refused TCP call', async () => {
    run.onFirstCall().rejects(rpcError('ECONNREFUSED'));
    run.onSecondCall().resolves('ok');
    const service = freshService();

    const refused = await service.executeCall('getstatus');
    await offerSocket();
    const answered = await service.executeCall('getstatus');

    expect(refused.status).to.equal('error');
    expect(run.firstCall.thisValue.socketPath).to.equal(null);
    expect(answered.status).to.equal('success');
    expect(run.secondCall.thisValue.socketPath).to.equal(socketPath);
  });

  it('reports a refused socket as an error and does not fall back to TCP', async () => {
    await offerSocket();
    run.rejects(rpcError('EACCES'));
    const service = freshService();

    const first = await service.executeCall('getstatus');
    const second = await service.executeCall('getstatus');

    expect(first.status).to.equal('error');
    expect(first.data.code).to.equal('EACCES');
    expect(second.status).to.equal('error');
    expect(run.secondCall.thisValue.socketPath).to.equal(socketPath);
    expect(run.secondCall.thisValue).to.not.equal(run.firstCall.thisValue);
  });

  it('keeps its client when the daemon answers with an error', async () => {
    await offerSocket();
    run.rejects(rpcError(-32601));
    const service = freshService();

    await service.executeCall('nosuchmethod');
    await service.executeCall('nosuchmethod');

    expect(run.secondCall.thisValue).to.equal(run.firstCall.thisValue);
  });
});
