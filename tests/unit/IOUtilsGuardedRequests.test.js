const http = require('http');
const https = require('https');
const net = require('net');
const axios = require('axios');
const { expect } = require('chai');
const sinon = require('sinon');

const dnsLookup = require('../../ZelBack/src/services/utils/dnsLookup');
const IOUtils = require('../../ZelBack/src/services/IOUtils');

// A URL a user asks the node to fetch is someone else's choice of destination. Its name
// resolves to the node's own loopback here, where a local listener stands in for an internal
// service. The listener counts TCP connections, so a refusal that came after the connection was
// made would still be caught. The global agents resolve through dnsLookup, as they do once
// apiServer installs it, so a request that left the guarded agents would reach the listener.
describe('IOUtils requests to a URL someone else chose', () => {
  let internal;
  let port;
  let connections;
  let globalLookups;

  before((done) => {
    globalLookups = [http.globalAgent.options.lookup, https.globalAgent.options.lookup];
    const throughDnsLookup = (...args) => dnsLookup.lookup(...args);
    http.globalAgent.options.lookup = throughDnsLookup;
    https.globalAgent.options.lookup = throughDnsLookup;

    internal = net.createServer((socket) => { connections += 1; socket.destroy(); });
    internal.listen(0, '127.0.0.1', () => { ({ port } = internal.address()); done(); });
  });

  after(() => {
    [http.globalAgent.options.lookup, https.globalAgent.options.lookup] = globalLookups;
    internal.close();
  });

  beforeEach(() => {
    connections = 0;
    sinon.stub(dnsLookup, 'lookup').callsFake((hostname, options, callback) => (options.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(null, '127.0.0.1', 4)));
  });

  afterEach(() => {
    sinon.restore();
  });

  it('reaches the internal service through that name on the global agents', async () => {
    // Canary: the name does lead to the listener, so a zero below is the guard.
    await axios.head(`http://files.example.test:${port}/backup.tar.gz`).catch(() => {});

    expect(connections).to.equal(1);
  });

  it('refuses a file size request to a name that resolves internal without connecting', async () => {
    const size = await IOUtils.getRemoteFileSize(`http://files.example.test:${port}/backup.tar.gz`, 1, 0);

    expect(size).to.equal(false);
    expect(connections).to.equal(0);
  });
});
