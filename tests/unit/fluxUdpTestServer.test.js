const dgram = require('node:dgram');
const { once } = require('node:events');
const { expect } = require('chai');
const {
  FluxUdpTestServer, UDP_PROBE_MAGIC, UDP_PROBE_BYTES, MAX_REPLIES, udpReply,
} = require('../../ZelBack/src/services/utils/fluxUdpTestServer');

// The UDP half of the port test. A peer probes the port and hands back what
// replied; the requester looks for its secret in it. A UDP reply goes wherever
// the probe claims it came from, so what this server answers, and to whom, is
// the whole of its contract.
describe('FluxUdpTestServer', () => {
  const TOKEN = 'c0ffee00'.repeat(4);
  let server;
  let port;
  let client;

  const probe = (size = UDP_PROBE_BYTES, magic = UDP_PROBE_MAGIC) => {
    const datagram = Buffer.alloc(size);
    datagram.write(magic, 'latin1');
    return datagram;
  };

  // Sends a datagram from the client and collects what comes back in a short
  // window: silence is an answer here, so the wait is the assertion's.
  const exchange = async (datagram, count = 1) => {
    const replies = [];
    const onMessage = (message) => replies.push(message.toString());
    client.on('message', onMessage);
    for (let i = 0; i < count; i += 1) {
      client.send(datagram, port, '127.0.0.1');
    }
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    client.off('message', onMessage);
    return replies;
  };

  beforeEach(async () => {
    server = new FluxUdpTestServer(TOKEN);
    await server.listen(0, '127.0.0.1');
    ({ port } = server.address());
    client = dgram.createSocket('udp4');
    client.bind(0, '127.0.0.1');
    await once(client, 'listening');
  });

  afterEach(() => {
    server.close();
    client.close();
  });

  it('answers the allowed peer\'s probe with the token', async () => {
    server.allow('127.0.0.1');

    expect(await exchange(probe())).to.deep.equal([udpReply(TOKEN).toString()]);
  });

  it('answers nobody until a peer is allowed', async () => {
    expect(await exchange(probe())).to.deep.equal([]);
  });

  it('answers nobody but the allowed peer', async () => {
    server.allow('198.51.100.7');

    expect(await exchange(probe())).to.deep.equal([]);
  });

  it('reads an IPv4-mapped allowed address as the address it is', async () => {
    server.allow('::ffff:127.0.0.1');

    expect(await exchange(probe())).to.have.length(1);
  });

  it('never sends a reply larger than the probe it answers', async () => {
    server.allow('127.0.0.1');

    expect(await exchange(probe(UDP_PROBE_BYTES - 1))).to.deep.equal([]);
    expect(udpReply(TOKEN).length).to.be.at.most(UDP_PROBE_BYTES);
  });

  it('answers only a probe, not any datagram', async () => {
    server.allow('127.0.0.1');

    expect(await exchange(probe(UDP_PROBE_BYTES, 'HELLO!'))).to.deep.equal([]);
  });

  it('stops answering after its reply cap', async () => {
    server.allow('127.0.0.1');

    expect(await exchange(probe(), MAX_REPLIES + 8)).to.have.length(MAX_REPLIES);
  });

  it('refuses a token too long for a reply no larger than a probe', () => {
    expect(() => new FluxUdpTestServer('x'.repeat(UDP_PROBE_BYTES))).to.throw();
  });

  it('rejects listen when the port is taken', async () => {
    const second = new FluxUdpTestServer(TOKEN);
    let error = null;
    await second.listen(port, '127.0.0.1').catch((e) => { error = e; });
    second.close();

    expect(error && error.code).to.equal('EADDRINUSE');
  });

  it('closes twice without throwing', () => {
    server.close();
    expect(() => server.close()).to.not.throw();
  });
});
