const net = require('node:net');
const { expect } = require('chai');
const { FluxHttpTestServer } = require('../../ZelBack/src/services/utils/fluxHttpTestServer');

// The pre-install port test asks a peer whether a port answers at this node's
// public address. Where several Flux nodes share that address the router
// forwards the port to one of them, so "something answered" can be a sibling's
// application - and the peer cannot tell, because from outside there is nothing
// to tell. This server can: it is the thing that would have been reached.
describe('FluxHttpTestServer', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = new FluxHttpTestServer();
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    ({ port } = server.address());
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Resolve on the SERVER's connection event, not the client's. The client is
  // connected as soon as its handshake completes, which is before the server has
  // necessarily emitted anything - waiting on the client makes every assertion
  // below a race, and one of these lost it while its neighbour won.
  const connect = () => new Promise((resolve, reject) => {
    server.once('connection', () => resolve());

    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => socket.end());
    socket.once('error', reject);
  });

  it('has been reached by nobody before anything connects', () => {
    expect(server.reachedBy('127.0.0.1')).to.equal(false);
  });

  it('records the address that reached it', async () => {
    await connect();

    expect(server.reachedBy('127.0.0.1')).to.equal(true);
  });

  // The verdict is about the peer we sent, so an unrelated caller arriving
  // during the test window must not read as proof the port is ours.
  it('does not answer for an address that never connected', async () => {
    await connect();

    expect(server.reachedBy('203.0.113.7')).to.equal(false);
  });

  // A connection over a dual-stack listener arrives as ::ffff:127.0.0.1, which
  // is the same address written the other way. Reading them as different hosts
  // would fail every install on a node listening that way.
  it('reads an IPv4-mapped caller as the address it is', async () => {
    await connect();

    expect(server.reachedBy('::ffff:127.0.0.1')).to.equal(true);
  });

  it('remembers a caller after its connection has closed', async () => {
    await connect();
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    // The port test reads this after the peer has been and gone, so the record
    // has to outlive the socket that made it.
    expect(server.reachedBy('127.0.0.1')).to.equal(true);
  });

  it('answers false for an address it cannot read', () => {
    expect(server.reachedBy(undefined)).to.equal(false);
    expect(server.reachedBy('')).to.equal(false);
  });

  // `reachedBy` is a snapshot, and the thing it asks about is still in flight:
  // a peer resolves its probe on its own `connect` and answers immediately,
  // while the accept it caused surfaces here on a later turn of this process's
  // event loop. Read once, a loaded node refuses an install for a connection
  // that did arrive. So the arrival is awaited.
  describe('reachedByWithin', () => {
    it('answers at once for a connection that already arrived', async () => {
      await connect();

      expect(await server.reachedByWithin('127.0.0.1', 5000)).to.equal(true);
    });

    // The defect, directly: the wait is already running when the connection
    // lands. Nothing polls - the connection handler resolves it.
    it('answers a connection that arrives while it is waiting', async () => {
      const waiting = server.reachedByWithin('127.0.0.1', 5000);

      await connect();

      expect(await waiting, 'a connection that landed during the wait was missed').to.equal(true);
    });

    // And expiring is the answer in the case this exists for: a sibling at the
    // same address holds the port, so the connection never comes at all.
    it('gives up when nothing arrives, rather than waiting forever', async () => {
      const started = Date.now();

      expect(await server.reachedByWithin('198.51.100.4', 150)).to.equal(false);
      expect(Date.now() - started, 'returned before its own wait was up').to.be.at.least(140);
    });

    it('answers false for an address it cannot read', async () => {
      expect(await server.reachedByWithin(undefined, 5000)).to.equal(false);
    });
  });
});
