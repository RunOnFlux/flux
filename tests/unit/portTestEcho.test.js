const http = require('node:http');
const { expect } = require('chai');
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
