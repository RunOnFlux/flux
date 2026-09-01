const http = require('node:http');
const { EventEmitter } = require('node:events');
const { expect } = require('chai');
const sinon = require('sinon');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const { FluxHttpTestServer } = require('../../ZelBack/src/services/utils/fluxHttpTestServer');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');

// The three parts of the port test, wired together, because each is sound alone
// and the thing that matters is that they compose: this node publishes a secret
// on the port, the peer reads the port and hands back what it found, and this
// node compares. Tested end to end because the previous design passed every
// unit test it had and could not work at all against a real peer.
describe('the pre-install port test, end to end', () => {
  let server;
  let port;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  const listen = async (s) => {
    server = s;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    ({ port } = server.address());
    return port;
  };

  it('proves the port when our own test server is what answers', async () => {
    const token = 'f00dcafe';
    await listen(new FluxHttpTestServer(token));

    const answer = await fluxNetworkHelper.portAnswered('127.0.0.1', port);

    expect(answer, 'the peer read nothing back').to.be.a('string');
    expect(portManager.portNotOurs([port], { [port]: answer }, token)).to.equal(null);
  });

  // The collision, as the requester actually experiences it: something is on
  // the port and answers the peer perfectly well, and it is not us. A neighbour
  // behind the same router holding the forward looks exactly like this.
  it('refuses the port when a different application answers it', async () => {
    const neighbour = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello from someone else entirely');
    });
    await listen(neighbour);

    const answer = await fluxNetworkHelper.portAnswered('127.0.0.1', port);

    expect(answer, 'the neighbour answered nothing at all').to.be.a('string');
    expect(portManager.portNotOurs([port], { [port]: answer }, 'f00dcafe')).to.equal(port);
  });

  // Nothing listening is not a port to install on either.
  it('reads nothing back from a port with nothing on it', async () => {
    const answer = await fluxNetworkHelper.portAnswered('127.0.0.1', 1, { timeout: 1000 });

    expect(answer).to.equal(null);
  });

  // The peer relays bytes it read from a stranger's port, so what it will carry
  // has to be bounded - otherwise a node can be asked to shuttle a payload.
  it('caps what it will carry back from a port', async function () {
    this.timeout(20000);
    const flood = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('x'.repeat(512 * 1024));
    });
    await listen(flood);

    const answer = await fluxNetworkHelper.portAnswered('127.0.0.1', port);

    expect(answer.length, 'a port could hand the peer an unbounded payload').to.be.at.most(256);
  });
});

// The address this node connects to when a peer asks it to test some ports.
//
// It is NOT taken from the request body. A caller that names the address picks
// where every Flux node in the fleet will connect, and the echo hands back the
// first bytes of what answered - so the body form is a fetch primitive pointed
// at anything a signed peer likes. The honest caller is asking about its OWN
// ports, so the address it means is the one it is connecting from.
describe('checkAppAvailability probes the address that asked', () => {
  let server;
  let port;
  let sandbox;

  // Bound to loopback; the "somewhere else" address below is a different
  // loopback address with nothing on it, so it refuses at once rather than
  // spending a connect timeout.
  const HERE = '127.0.0.1';
  const SOMEWHERE_ELSE = '127.0.0.2';
  const TOKEN = 'deadbeefcafe';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    server = new FluxHttpTestServer(TOKEN);
    await new Promise((resolve) => server.listen(0, HERE, resolve));
    ({ port } = server.address());

    // A listed Fluxnode signed the body. That is all this endpoint has ever
    // established, and it is not a statement about the address.
    sandbox.stub(fluxCommunicationUtils, 'deterministicFluxList').resolves([{ ip: '198.51.100.7:16127' }]);
    sandbox.stub(verificationHelper, 'verifyMessage').returns(true);
    sandbox.stub(verificationHelper, 'verifyPrivilege').resolves(false);
  });

  afterEach(async () => {
    sandbox.restore();
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  const ask = (body, remoteAddress) => {
    const req = new EventEmitter();
    req.socket = { remoteAddress };
    req.headers = {};

    let answer;
    const answered = new Promise((resolve) => { answer = resolve; });
    const res = { json: (payload) => answer(payload) };

    fluxNetworkHelper.checkAppAvailability(req, res);
    req.emit('data', JSON.stringify(body));
    req.emit('end');

    return answered;
  };

  it('ignores an address in the body and tests the one that connected', async () => {
    const answer = await ask(
      {
        ip: HERE, port: 16127, ports: [port], pubKey: 'k', signature: 's', echo: true,
      },
      SOMEWHERE_ELSE,
    );

    expect(answer.status, 'the body address was used to pick the target').to.equal('error');
    expect(answer.data.message).to.include(`Failed port: ${port}`);
  });

  it('answers the honest caller, whose body address is the one it dialled from', async () => {
    const answer = await ask(
      {
        ip: HERE, port: 16127, ports: [port], pubKey: 'k', signature: 's', echo: true,
      },
      HERE,
    );

    expect(answer.status).to.equal('success');
    expect(answer.data.answered[port]).to.include(TOKEN);
  });

  // An IPv4 connection to a dual-stack listener arrives as ::ffff:127.0.0.1,
  // and an address that does not match itself would refuse every honest caller.
  it('reads an IPv4-mapped remote address as the address it is', async () => {
    const answer = await ask(
      {
        ip: HERE, port: 16127, ports: [port], pubKey: 'k', signature: 's', echo: true,
      },
      `::ffff:${HERE}`,
    );

    expect(answer.status).to.equal('success');
  });

  it('lets this node\'s own operator name an address by hand', async () => {
    verificationHelper.verifyPrivilege.resolves(true);

    const answer = await ask(
      {
        ip: HERE, port: 16127, ports: [port], pubKey: 'k', signature: 's', echo: true,
      },
      SOMEWHERE_ELSE,
    );

    expect(answer.status, 'the operator carve-out was lost').to.equal('success');
    expect(answer.data.answered[port]).to.include(TOKEN);
  });

  // maxComponents (10) x ports per component (5) in appValidator. Each port
  // costs a connect timeout and they are tested in sequence.
  it('refuses more ports than an application could hold', async () => {
    const tooMany = Array.from({ length: 51 }, (unused, i) => 40000 + i);

    const answer = await ask(
      {
        ip: HERE, port: 16127, ports: tooMany, pubKey: 'k', signature: 's', echo: true,
      },
      HERE,
    );

    expect(answer.status).to.equal('error');
    expect(answer.data.message).to.include('Too many ports');
  });
});
