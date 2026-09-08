const net = require('node:net');
const { expect } = require('chai');
const { FluxHttpTestServer } = require('../../ZelBack/src/services/utils/fluxHttpTestServer');

// The pre-install port test asks a peer whether a port answers at this node's
// public address. Where several Flux nodes share that address the router
// forwards the port to one of them, so "something answered" can be a
// neighbour's application - and the peer cannot tell, because from outside
// there is nothing to tell.
//
// This server makes it tellable. It answers with a secret the requester never
// hands out, so only the thing the requester started can produce it.
describe('FluxHttpTestServer', () => {
  let server;
  let port;

  const start = async (token) => {
    server = new FluxHttpTestServer(token);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    ({ port } = server.address());
  };

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  // Read the way a peer reads it - a raw socket, not an HTTP client - because
  // that is what has to work, and because the peer caps what it takes.
  const CLOSE = 'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n';

  const fetchRaw = (request = CLOSE) => new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(request);
    });
    let received = '';
    socket.on('data', (chunk) => { received += chunk.toString('utf8'); });
    socket.on('end', () => resolve(received));
    socket.on('error', reject);
    // A server that does not close is a difference worth SEEING: answer with
    // what arrived so the assertion below reports the bytes, rather than the
    // run ending on a harness timeout that says nothing about which byte moved.
    socket.setTimeout(500, () => { socket.destroy(); resolve(received); });
  });

  it('answers with the token it was given', async () => {
    await start('cafebabe');

    expect(await fetchRaw()).to.include('cafebabe');
  });

  // Two tests running at once must not be able to satisfy each other, so the
  // token has to be what distinguishes them rather than the shape of the reply.
  it('answers with its own token, not another run\'s', async () => {
    await start('mine');

    expect(await fetchRaw()).to.not.include('theirs');
  });

  // Nothing in this codebase constructs it without one today, but a server that
  // answered a default when it had no secret would prove whatever asked it.
  it('gives nothing away when it has no token', async () => {
    await start(null);
    const answer = await fetchRaw();

    expect(answer).to.include('204');
    expect(answer).to.not.include('token');
  });

  it('answers every request, so a peer that retries still gets it', async () => {
    await start('twice');

    expect(await fetchRaw()).to.include('twice');
    expect(await fetchRaw()).to.include('twice');
  });

  // A peer keeps a bounded prefix of this answer and nothing else, so where the
  // secret sits is what decides whether the check can work. Any prefix reaches
  // the header block. A prefix reached the body only while everything in front
  // of it stayed small enough - and almost none of that was ours to keep small.
  it('carries the secret in the headers, not the body', async () => {
    const token = 'a'.repeat(32);
    await start(token);

    const answer = await fetchRaw();
    const headersEnd = answer.indexOf('\r\n\r\n');

    expect(headersEnd, 'no header block at all').to.be.above(0);
    expect(answer.indexOf(token), 'the secret is in the body').to.be.below(headersEnd);
  });

  // Unless told otherwise Node writes Date, the transfer framing, and a
  // Connection it copies from what the CLIENT sent - so the size of this answer
  // used to be settled partly by the peer reading it, from a request string in
  // another service that nothing marks as load-bearing.
  it('answers the same bytes whatever the peer asks for', async () => {
    await start('a'.repeat(32));

    const requests = [
      CLOSE,
      'GET / HTTP/1.1\r\nHost: localhost\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n',
      'GET / HTTP/1.0\r\nHost: localhost\r\n\r\n',
    ];

    const answers = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const request of requests) {
      // eslint-disable-next-line no-await-in-loop
      answers.push(await fetchRaw(request));
    }

    answers.forEach((answer) => expect(answer).to.equal(answers[0]));
  });
});
