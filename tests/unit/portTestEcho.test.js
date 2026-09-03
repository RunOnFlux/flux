const http = require('node:http');
const { EventEmitter } = require('node:events');
const { expect } = require('chai');
const sinon = require('sinon');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const { FluxHttpTestServer } = require('../../ZelBack/src/services/utils/fluxHttpTestServer');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');
const { Privilege } = require('../../ZelBack/src/services/utils/privileges');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const dgram = require('node:dgram');
const net = require('node:net');

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
    const token = 'f00dcafe'.repeat(4);
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
    expect(portManager.portNotOurs([port], { [port]: answer }, 'f00dcafe'.repeat(4))).to.equal(port);
  });

  // The two halves meet here and nowhere else: the server decides where the
  // secret sits, the reader decides how much it keeps, and neither file
  // mentions the other. tokenEnd <= MAX_ECHO_BYTES is the whole contract.
  it('leaves the secret inside the prefix the peer keeps', async () => {
    const token = 'b'.repeat(32);
    await listen(new FluxHttpTestServer(token));

    const answer = await fluxNetworkHelper.portAnswered('127.0.0.1', port);

    expect(answer, 'the secret did not survive the cap').to.include(token);
    expect(answer.indexOf(token) + token.length)
      .to.be.below(fluxNetworkHelper.MAX_ECHO_BYTES);
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

  // Bound to loopback; "somewhere else" is a local address that is NOT the one
  // the server is on, so it refuses at once rather than spending a connect
  // timeout. ::1 rather than another 127 address: 127.0.0.2 is assigned to the
  // loopback on Linux and refuses there, and is not assigned on macOS, where
  // the dial hangs until the port test's own five-second timeout and the test
  // dies on mocha's two. Nothing here is about a platform - it is about an
  // address the caller named not being the address that gets probed - so it
  // runs everywhere rather than being skipped off Linux.
  const HERE = '127.0.0.1';
  const SOMEWHERE_ELSE = '::1';
  const TOKEN = 'deadbeefcafe0123456789abcdef0123';

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

  it('lets Flux team name an address by hand', async () => {
    verificationHelper.verifyPrivilege.resolves(true);

    const answer = await ask(
      {
        ip: HERE, port: 16127, ports: [port], pubKey: 'k', signature: 's', echo: true,
      },
      SOMEWHERE_ELSE,
    );

    expect(answer.status, 'the carve-out was lost').to.equal('success');
    expect(answer.data.answered[port]).to.include(TOKEN);
  });

  // Skipping the signature and choosing the address are the same question, so
  // there is one privilege and it is not node-local. NODE_OPERATOR_OR_FLUX_TEAM
  // would put a fetch primitive aimed anywhere behind thousands of separate
  // credentials, one per node, for a Flux team diagnostic.
  it('asks for Flux team, not for a privilege every node operator holds', async () => {
    await ask(
      {
        ip: HERE, port: 16127, ports: [port], pubKey: 'k', signature: 's', echo: true,
      },
      SOMEWHERE_ELSE,
    );

    sinon.assert.calledWith(verificationHelper.verifyPrivilege, Privilege.FLUX_TEAM);
    sinon.assert.neverCalledWith(
      verificationHelper.verifyPrivilege,
      Privilege.NODE_OPERATOR_OR_FLUX_TEAM,
    );
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

// The keep-alive is the availability endpoint's twin: a signed peer asks this
// node to connect to its ports. The address it connects to is the one the
// caller came from, for the same reason, under the same privilege to name one.
describe('keepUPNPPortsOpen pokes the address that asked', () => {
  let sandbox;
  const HERE = '198.51.100.7';
  const SOMEWHERE_ELSE = '203.0.113.9';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(fluxCommunicationUtils, 'deterministicFluxList').resolves([{ ip: `${HERE}:16127` }]);
    sandbox.stub(verificationHelper, 'verifyMessage').returns(true);
    sandbox.stub(verificationHelper, 'verifyPrivilege').resolves(false);
    // The connect-back to the caller's API port is the one observable that
    // carries the address; the pokes themselves return nothing to anyone.
    sandbox.stub(serviceHelper, 'axiosGet').resolves({ data: {} });
  });

  afterEach(() => sandbox.restore());

  const ask = async (body, remoteAddress) => {
    const req = { body, socket: { remoteAddress }, headers: {} };
    const res = { status: sinon.stub().returnsThis(), end: sinon.stub() };
    await fluxNetworkHelper.keepUPNPPortsOpen(req, res);
    return res;
  };

  const signedBody = (overrides = {}) => ({
    ip: SOMEWHERE_ELSE,
    apiPort: 16127,
    ports: [],
    pubKey: 'k',
    signature: 's',
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  });

  const connectedBackTo = () => serviceHelper.axiosGet.firstCall.args[0];

  it('ignores an address in the body and pokes the one that connected', async () => {
    const res = await ask(signedBody(), HERE);

    sinon.assert.calledWith(res.status, 202);
    expect(connectedBackTo()).to.equal(`http://${HERE}:16127/flux/uptime`);
  });

  it('reads an IPv4-mapped remote address as the address it is', async () => {
    await ask(signedBody(), `::ffff:${HERE}`);

    expect(connectedBackTo()).to.equal(`http://${HERE}:16127/flux/uptime`);
  });

  it('lets Flux team name an address by hand', async () => {
    verificationHelper.verifyPrivilege.resolves(true);

    await ask(signedBody(), HERE);

    expect(connectedBackTo()).to.equal(`http://${SOMEWHERE_ELSE}:16127/flux/uptime`);
  });

  it('asks for Flux team, not for a privilege every node operator holds', async () => {
    await ask(signedBody(), HERE);

    sinon.assert.calledWith(verificationHelper.verifyPrivilege, Privilege.FLUX_TEAM);
    sinon.assert.neverCalledWith(
      verificationHelper.verifyPrivilege,
      Privilege.NODE_OPERATOR_OR_FLUX_TEAM,
    );
  });

  it('refuses an ask that is neither signed by a listed Fluxnode nor from Flux team', async () => {
    verificationHelper.verifyMessage.returns(false);

    const res = await ask(signedBody(), HERE);

    sinon.assert.calledWith(res.status, 401);
    sinon.assert.notCalled(serviceHelper.axiosGet);
  });

  // maxAppsPerNode x MAX_TESTABLE_PORTS + the four node service ports: a bound
  // on how long one request can keep this node poking, and the honest list can
  // be that long.
  it('refuses more ports than a node could hold', async () => {
    const tooMany = Array.from({ length: fluxNetworkHelper.MAX_KEEPALIVE_PORTS + 1 }, (unused, i) => 20000 + i);

    const res = await ask(signedBody({ ports: tooMany }), HERE);

    sinon.assert.calledWith(res.status, 422);
    sinon.assert.notCalled(serviceHelper.axiosGet);
  });

  // No range or banned-port filter, unlike the availability endpoint: the
  // caller keeps its own service ports alive too - the API port minus one,
  // minus five, plus one and plus two - and those sit inside the banned
  // 16100-16299 block. The filter that is right there would end the keep-alive.
  it('pokes the caller\'s own service ports, which the app-port ban would refuse', async () => {
    const udp = { send: sinon.stub().callsArg(5), close: sinon.stub() };
    sandbox.stub(dgram, 'createSocket').returns(udp);
    sandbox.stub(net.Socket.prototype, 'connect');
    sandbox.stub(serviceHelper, 'delay').resolves();
    const servicePorts = [16126, 16122, 16128, 16129];

    await ask(signedBody({ ports: servicePorts }), HERE);

    const poked = udp.send.args.map((args) => args[3]);
    expect(poked).to.deep.equal(servicePorts);
    udp.send.args.forEach((args) => expect(args[4]).to.equal(HERE));
  });
});
