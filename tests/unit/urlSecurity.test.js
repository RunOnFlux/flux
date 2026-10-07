const http = require('http');
const https = require('https');
const net = require('net');
const axios = require('axios');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const proxyquire = require('proxyquire');

chai.use(chaiAsPromised);
const { expect } = chai;
const {
  validateUrl,
  isUrlSafe,
  isBlockedIP,
  isBlockedHostname,
  normalizeIpString,
  isBlockedAddressLiteral,
  guardedLookup,
  guardedRequestOptions,
  GuardedHttpAgent,
  GuardedHttpsAgent,
} = require('../../ZelBack/src/services/utils/urlSecurity');

describe('urlSecurity', () => {
  describe('validateUrl', () => {
    it('should allow valid external HTTPS URLs', () => {
      expect(validateUrl('https://example.com/file.tar.gz')).to.equal('https://example.com/file.tar.gz');
      expect(validateUrl('https://cdn.example.org/backup.zip')).to.equal('https://cdn.example.org/backup.zip');
    });

    it('should allow valid external HTTP URLs', () => {
      expect(validateUrl('http://example.com/file.tar.gz')).to.equal('http://example.com/file.tar.gz');
    });

    it('should block localhost', () => {
      expect(() => validateUrl('http://localhost/admin')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://localhost:8080/api')).to.throw('hostname is not allowed');
      expect(() => validateUrl('https://localhost/secret')).to.throw('hostname is not allowed');
    });

    it('should block loopback IP addresses', () => {
      expect(() => validateUrl('http://127.0.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://127.0.0.1:16127/flux/version')).to.throw('private/internal IP');
      expect(() => validateUrl('http://127.0.1.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://127.255.255.255/')).to.throw('private/internal IP');
    });

    it('should block private Class A addresses (10.x.x.x)', () => {
      expect(() => validateUrl('http://10.0.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://10.255.255.255/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://10.10.10.10:8080/api')).to.throw('private/internal IP');
    });

    it('should block private Class B addresses (172.16-31.x.x)', () => {
      expect(() => validateUrl('http://172.16.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://172.31.255.255/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://172.20.10.5/')).to.throw('private/internal IP');
    });

    it('should allow non-private 172.x.x.x addresses', () => {
      // 172.15.x.x and 172.32.x.x are not private
      expect(validateUrl('http://172.15.0.1/')).to.equal('http://172.15.0.1/');
      expect(validateUrl('http://172.32.0.1/')).to.equal('http://172.32.0.1/');
    });

    it('should block private Class C addresses (192.168.x.x)', () => {
      expect(() => validateUrl('http://192.168.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://192.168.1.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://192.168.255.255/')).to.throw('private/internal IP');
    });

    it('should block link-local/metadata addresses (169.254.x.x)', () => {
      expect(() => validateUrl('http://169.254.169.254/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://169.254.169.254/latest/meta-data/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://169.254.0.1/')).to.throw('private/internal IP');
    });

    it('should block cloud metadata hostnames', () => {
      expect(() => validateUrl('http://metadata.google.internal/')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://metadata.goog/')).to.throw('hostname is not allowed');
    });

    it('should block kubernetes internal hostnames', () => {
      expect(() => validateUrl('http://kubernetes.default/')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://kubernetes.default.svc/')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://kubernetes.default.svc.cluster.local/')).to.throw('hostname is not allowed');
    });

    it('should block non-HTTP protocols', () => {
      expect(() => validateUrl('file:///etc/passwd')).to.throw('Protocol');
      expect(() => validateUrl('ftp://example.com/file')).to.throw('Protocol');
      expect(() => validateUrl('gopher://evil.com/')).to.throw('Protocol');
      expect(() => validateUrl('data:text/html,<script>alert(1)</script>')).to.throw('Protocol');
    });

    it('should block IPv6 loopback', () => {
      expect(() => validateUrl('http://[::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[::1]:8080/')).to.throw('private/internal IP');
    });

    it('should block IPv6 link-local', () => {
      expect(() => validateUrl('http://[fe80::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[fe80::1234:5678]/')).to.throw('private/internal IP');
    });

    it('should block IPv6 unique local addresses', () => {
      expect(() => validateUrl('http://[fc00::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[fd00::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[fd12:3456:789a::1]/')).to.throw('private/internal IP');
    });

    it('should throw for invalid URL format', () => {
      expect(() => validateUrl('not-a-url')).to.throw('Invalid URL');
      expect(() => validateUrl('')).to.throw('non-empty string');
      expect(() => validateUrl(null)).to.throw('non-empty string');
      expect(() => validateUrl(undefined)).to.throw('non-empty string');
    });

    it('should allow private IPs when allowPrivate option is true', () => {
      const options = { allowPrivate: true };
      expect(validateUrl('http://127.0.0.1/', options)).to.equal('http://127.0.0.1/');
      expect(validateUrl('http://10.0.0.1/', options)).to.equal('http://10.0.0.1/');
      expect(validateUrl('http://192.168.1.1/', options)).to.equal('http://192.168.1.1/');
    });

    it('should respect allowedHosts option', () => {
      const options = { allowedHosts: ['trusted.com', 'cdn.trusted.org'] };
      expect(validateUrl('https://trusted.com/file', options)).to.equal('https://trusted.com/file');
      expect(validateUrl('https://cdn.trusted.org/file', options)).to.equal('https://cdn.trusted.org/file');
      expect(validateUrl('https://sub.trusted.com/file', options)).to.equal('https://sub.trusted.com/file');
      expect(() => validateUrl('https://evil.com/file', options)).to.throw('not in the allowed list');
    });

    it('should normalize URLs', () => {
      // URL constructor normalizes the URL
      expect(validateUrl('https://EXAMPLE.COM/path')).to.equal('https://example.com/path');
    });
  });

  describe('isBlockedIP', () => {
    it('should return true for loopback addresses', () => {
      expect(isBlockedIP('127.0.0.1')).to.be.true;
      expect(isBlockedIP('127.0.0.2')).to.be.true;
      expect(isBlockedIP('127.255.255.255')).to.be.true;
    });

    it('should return true for private addresses', () => {
      expect(isBlockedIP('10.0.0.1')).to.be.true;
      expect(isBlockedIP('172.16.0.1')).to.be.true;
      expect(isBlockedIP('192.168.1.1')).to.be.true;
    });

    it('should return true for link-local addresses', () => {
      expect(isBlockedIP('169.254.169.254')).to.be.true;
      expect(isBlockedIP('169.254.0.1')).to.be.true;
    });

    it('should return false for public addresses', () => {
      expect(isBlockedIP('8.8.8.8')).to.be.false;
      expect(isBlockedIP('1.1.1.1')).to.be.false;
      expect(isBlockedIP('93.184.216.34')).to.be.false;
    });

    it('should return true for the whole benchmarking range (198.18.0.0/15)', () => {
      expect(isBlockedIP('198.18.0.1')).to.be.true;
      expect(isBlockedIP('198.19.255.255')).to.be.true;
      expect(isBlockedIP('198.17.255.255')).to.be.false;
      expect(isBlockedIP('198.20.0.0')).to.be.false;
    });

    it('should return true for the whole multicast (224.0.0.0/4) and reserved (240.0.0.0/4) ranges', () => {
      expect(isBlockedIP('224.0.0.1')).to.be.true;
      expect(isBlockedIP('239.255.255.250')).to.be.true;
      expect(isBlockedIP('241.0.0.1')).to.be.true;
      expect(isBlockedIP('254.1.2.3')).to.be.true;
      expect(isBlockedIP('223.255.255.255')).to.be.false;
    });

    it('should return false for the harness fleet\'s addresses, which stand in for public ones', () => {
      expect(isBlockedIP('31.200.0.10')).to.be.false;
      expect(isBlockedIP('31.200.15.255')).to.be.false;
    });

    it('should return true for IPv6 loopback', () => {
      expect(isBlockedIP('::1')).to.be.true;
    });

    it('should return true for the whole unique local range (fc00::/7)', () => {
      expect(isBlockedIP('fc00::1')).to.be.true;
      expect(isBlockedIP('fc01::1')).to.be.true;
      expect(isBlockedIP('fcff::1')).to.be.true;
      expect(isBlockedIP('fd12:3456::1')).to.be.true;
      expect(isBlockedIP('fbff::1')).to.be.false;
      expect(isBlockedIP('fe00::1')).to.be.false;
    });

    it('should return true for null/undefined', () => {
      expect(isBlockedIP(null)).to.be.true;
      expect(isBlockedIP(undefined)).to.be.true;
      expect(isBlockedIP('')).to.be.true;
    });
  });

  describe('isBlockedHostname', () => {
    it('should return true for localhost', () => {
      expect(isBlockedHostname('localhost')).to.be.true;
      expect(isBlockedHostname('LOCALHOST')).to.be.true;
      expect(isBlockedHostname('localhost.localdomain')).to.be.true;
    });

    it('should return true for cloud metadata hostnames', () => {
      expect(isBlockedHostname('metadata.google.internal')).to.be.true;
      expect(isBlockedHostname('metadata.goog')).to.be.true;
    });

    it('should return true for subdomains of blocked hostnames', () => {
      expect(isBlockedHostname('sub.localhost')).to.be.true;
      expect(isBlockedHostname('api.metadata.google.internal')).to.be.true;
    });

    it('should return false for normal hostnames', () => {
      expect(isBlockedHostname('example.com')).to.be.false;
      expect(isBlockedHostname('google.com')).to.be.false;
      expect(isBlockedHostname('cdn.example.org')).to.be.false;
    });

    it('should return true for null/undefined', () => {
      expect(isBlockedHostname(null)).to.be.true;
      expect(isBlockedHostname(undefined)).to.be.true;
      expect(isBlockedHostname('')).to.be.true;
    });
  });

  describe('isUrlSafe', () => {
    it('should return true for safe URLs', () => {
      expect(isUrlSafe('https://example.com/file')).to.be.true;
      expect(isUrlSafe('http://cdn.example.org/backup.zip')).to.be.true;
    });

    it('should return false for unsafe URLs', () => {
      expect(isUrlSafe('http://127.0.0.1/')).to.be.false;
      expect(isUrlSafe('http://localhost/')).to.be.false;
      expect(isUrlSafe('http://169.254.169.254/')).to.be.false;
      expect(isUrlSafe('file:///etc/passwd')).to.be.false;
      expect(isUrlSafe('not-a-url')).to.be.false;
    });
  });

  describe('normalizeIpString', () => {
    it('should strip brackets from IPv6 addresses', () => {
      expect(normalizeIpString('[::1]')).to.equal('::1');
      expect(normalizeIpString('[fe80::1]')).to.equal('fe80::1');
      expect(normalizeIpString('[::ffff:127.0.0.1]')).to.equal('::ffff:127.0.0.1');
    });

    it('should remove zone identifiers', () => {
      expect(normalizeIpString('fe80::1%eth0')).to.equal('fe80::1');
      expect(normalizeIpString('fe80::1234%en0')).to.equal('fe80::1234');
    });

    it('should handle both brackets and zone identifiers', () => {
      expect(normalizeIpString('[fe80::1%eth0]')).to.equal('fe80::1');
    });

    it('should return IPv4 addresses unchanged', () => {
      expect(normalizeIpString('127.0.0.1')).to.equal('127.0.0.1');
      expect(normalizeIpString('10.0.0.1')).to.equal('10.0.0.1');
    });

    it('should handle null/undefined gracefully', () => {
      expect(normalizeIpString(null)).to.equal(null);
      expect(normalizeIpString(undefined)).to.equal(undefined);
      expect(normalizeIpString('')).to.equal('');
    });
  });

  describe('IPv6-mapped IPv4 blocking', () => {
    describe('isBlockedIP', () => {
      it('should block IPv6-mapped loopback addresses', () => {
        expect(isBlockedIP('::ffff:127.0.0.1')).to.be.true;
        expect(isBlockedIP('::ffff:7f00:1')).to.be.true;
        expect(isBlockedIP('[::ffff:127.0.0.1]')).to.be.true;
      });

      it('should block IPv6-mapped private addresses', () => {
        expect(isBlockedIP('::ffff:10.0.0.1')).to.be.true;
        expect(isBlockedIP('::ffff:172.16.0.1')).to.be.true;
        expect(isBlockedIP('::ffff:192.168.1.1')).to.be.true;
        expect(isBlockedIP('::ffff:c0a8:101')).to.be.true; // 192.168.1.1 in hex
      });

      it('should block IPv6-mapped link-local addresses', () => {
        expect(isBlockedIP('::ffff:169.254.169.254')).to.be.true;
        expect(isBlockedIP('::ffff:a9fe:a9fe')).to.be.true; // 169.254.169.254 in hex
      });

      it('should allow IPv6-mapped public addresses', () => {
        expect(isBlockedIP('::ffff:8.8.8.8')).to.be.false;
        expect(isBlockedIP('::ffff:1.1.1.1')).to.be.false;
        expect(isBlockedIP('::ffff:808:808')).to.be.false; // 8.8.8.8 in hex
      });
    });

    describe('validateUrl', () => {
      it('should block URLs with IPv6-mapped loopback', () => {
        expect(() => validateUrl('http://[::ffff:127.0.0.1]/')).to.throw('private/internal IP');
        expect(() => validateUrl('http://[::ffff:127.0.0.1]:8080/')).to.throw('private/internal IP');
      });

      it('should block URLs with IPv6-mapped private addresses', () => {
        expect(() => validateUrl('http://[::ffff:10.0.0.1]/')).to.throw('private/internal IP');
        expect(() => validateUrl('http://[::ffff:192.168.1.1]/')).to.throw('private/internal IP');
        expect(() => validateUrl('http://[::ffff:172.16.0.1]/')).to.throw('private/internal IP');
      });

      it('should block URLs with IPv6-mapped metadata addresses', () => {
        expect(() => validateUrl('http://[::ffff:169.254.169.254]/')).to.throw('private/internal IP');
      });
    });
  });

  describe('isBlockedAddressLiteral', () => {
    // The guarded agents' check on the address a connection is about to dial.
    it('blocks private and reserved literals', () => {
      expect(isBlockedAddressLiteral('127.0.0.1')).to.equal(true);
      expect(isBlockedAddressLiteral('10.0.0.5')).to.equal(true);
      expect(isBlockedAddressLiteral('192.168.1.1')).to.equal(true);
      expect(isBlockedAddressLiteral('169.254.169.254')).to.equal(true);
      expect(isBlockedAddressLiteral('::1')).to.equal(true);
    });

    it('permits a public literal', () => {
      expect(isBlockedAddressLiteral('8.8.8.8')).to.equal(false);
      expect(isBlockedAddressLiteral('1.1.1.1')).to.equal(false);
    });

    it('says nothing about hostnames - those are the lookup guard\'s job', () => {
      // Answering true here for a name would refuse it before it was resolved,
      // and answering on a guess is exactly what the connect-time check avoids.
      expect(isBlockedAddressLiteral('registry-1.docker.io')).to.equal(false);
      expect(isBlockedAddressLiteral('localhost')).to.equal(false);
      expect(isBlockedAddressLiteral('')).to.equal(false);
      expect(isBlockedAddressLiteral(undefined)).to.equal(false);
    });
  });

  describe('guardedLookup', () => {
    // A fake resolver throughout: the point is what the guard does with an
    // answer, and a real lookup would make these assertions depend on DNS.
    function withResolver(impl) {
      return proxyquire('../../ZelBack/src/services/utils/urlSecurity', {
        './dnsLookup': { lookup: impl },
      }).guardedLookup;
    }

    it('passes a public address through untouched', (done) => {
      const lookup = withResolver((host, opts, cb) => cb(null, '93.184.216.34', 4));
      lookup('example.com', {}, (err, address, family) => {
        expect(err).to.equal(null);
        expect(address).to.equal('93.184.216.34');
        expect(family).to.equal(4);
        done();
      });
    });

    it('refuses a name that resolves into a private range', (done) => {
      // This is the rebinding case: the name looks fine, the answer does not.
      const lookup = withResolver((host, opts, cb) => cb(null, '10.1.2.3', 4));
      lookup('sneaky.example.com', {}, (err) => {
        expect(err.code).to.equal('EBLOCKEDADDRESS');
        expect(err.message).to.include('10.1.2.3');
        done();
      });
    });

    it('keeps the safe answers when asked for all of them', (done) => {
      // Node picks among these, so a host with one public and one loopback
      // record would otherwise be a coin toss.
      const lookup = withResolver((host, opts, cb) => cb(null, [
        { address: '127.0.0.1', family: 4 },
        { address: '93.184.216.34', family: 4 },
      ]));
      lookup('mixed.example.com', { all: true }, (err, addresses) => {
        expect(err).to.equal(null);
        expect(addresses).to.deep.equal([{ address: '93.184.216.34', family: 4 }]);
        done();
      });
    });

    it('refuses when every answer is blocked', (done) => {
      const lookup = withResolver((host, opts, cb) => cb(null, [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 },
      ]));
      lookup('all-private.example.com', { all: true }, (err) => {
        expect(err.code).to.equal('EBLOCKEDADDRESS');
        done();
      });
    });

    it('passes a resolver failure straight back', (done) => {
      const notFound = Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
      const lookup = withResolver((host, opts, cb) => cb(notFound));
      lookup('nowhere.example.com', {}, (err) => {
        expect(err.code).to.equal('ENOTFOUND');
        done();
      });
    });

    it('accepts the options-omitted call signature', (done) => {
      const lookup = withResolver((host, opts, cb) => cb(null, '8.8.8.8', 4));
      lookup('dns.example.com', (err, address) => {
        expect(err).to.equal(null);
        expect(address).to.equal('8.8.8.8');
        done();
      });
    });
  });

  describe('guardedRequestOptions', () => {
    it('connects through the guarded agents, which resolve through guardedLookup, on both schemes', () => {
      const options = guardedRequestOptions();

      expect(options.httpAgent).to.be.instanceOf(GuardedHttpAgent);
      expect(options.httpsAgent).to.be.instanceOf(GuardedHttpsAgent);
      expect(options.httpAgent.options.lookup).to.equal(guardedLookup);
      expect(options.httpsAgent.options.lookup).to.equal(guardedLookup);
    });

    it('hands every caller the same agents, so connections are pooled across requests', () => {
      const first = guardedRequestOptions();
      const second = guardedRequestOptions();

      expect(second.httpAgent).to.equal(first.httpAgent);
      expect(second.httpsAgent).to.equal(first.httpsAgent);
    });

    it('keeps connections alive and times them out as the global agents do', () => {
      const { httpAgent, httpsAgent } = guardedRequestOptions();

      expect(http.globalAgent.keepAlive).to.equal(true);
      expect(httpAgent.keepAlive).to.equal(http.globalAgent.keepAlive);
      expect(httpsAgent.keepAlive).to.equal(https.globalAgent.keepAlive);
      expect(httpAgent.options.timeout).to.equal(http.globalAgent.options.timeout);
      expect(httpsAgent.options.timeout).to.equal(https.globalAgent.options.timeout);
    });

    describe('an address in any form URL parsing accepts', () => {
      // A local listener stands in for an internal service. It counts TCP connections, so a
      // refusal that came after the connection was made would still be caught.
      let internal;
      let port;
      let connections;

      before((done) => {
        internal = net.createServer((socket) => { connections += 1; socket.destroy(); });
        internal.listen(0, '127.0.0.1', () => { ({ port } = internal.address()); done(); });
      });

      after(() => {
        internal.close();
      });

      beforeEach(() => {
        connections = 0;
      });

      it('reaches the internal service through an encoded address without the guard', async () => {
        // Canary: the encoded form does reach the listener, so a zero below is the guard.
        await axios.get(`http://2130706433:${port}/`).catch(() => {});

        expect(connections).to.equal(1);
      });

      ['127.0.0.1', '2130706433', '127.1', '127.0.1', '0x7f.0.0.1', '0177.0.0.1', '0x7f000001', '0'].forEach((host) => {
        ['http', 'https'].forEach((scheme) => {
          it(`refuses ${scheme}://${host} before connecting`, async () => {
            const error = await axios.get(`${scheme}://${host}:${port}/`, guardedRequestOptions()).then(() => null, (e) => e);

            expect(error).to.have.property('code', 'EBLOCKEDADDRESS');
            expect(connections).to.equal(0);
          });
        });
      });
    });

    describe('a redirect into the internal network', () => {
      // A local server stands in for an internal service, and another for a registry that
      // answers with a redirect to it. The registry stands in for a public host, so its own
      // connection is let through and only the redirect is under test.
      let internal;
      let internalHits;
      let registryHits;
      let registry;
      let redirectTo;

      function listen(server) {
        return new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
      }

      before(async () => {
        internalHits = 0;
        internal = http.createServer((req, res) => { internalHits += 1; res.end('internal'); });
        const internalPort = await listen(internal);
        registry = http.createServer((req, res) => {
          registryHits += 1;
          res.writeHead(302, { location: redirectTo(internalPort) });
          res.end();
        });
        const registryPort = await listen(registry);
        registry.port = registryPort;
        registry.url = `http://127.0.0.1:${registryPort}/v2/`;
      });

      after(() => {
        internal.close();
        registry.close();
      });

      beforeEach(() => {
        internalHits = 0;
        registryHits = 0;
      });

      // Guarded agents of their own, with the connection to the registry let through.
      function guardedPastTheRegistry() {
        const agent = new GuardedHttpAgent();
        const guarded = agent.createConnection.bind(agent);
        agent.createConnection = (opts, callback) => (Number(opts.port) === registry.port
          ? http.Agent.prototype.createConnection.call(agent, opts, callback)
          : guarded(opts, callback));
        return { httpAgent: agent, httpsAgent: new GuardedHttpsAgent() };
      }

      it('reaches the internal service without the guard', async () => {
        // Canary: the fixture can detect a redirect that gets through.
        redirectTo = (port) => `http://127.0.0.1:${port}/`;

        await axios.get(registry.url);

        expect(internalHits).to.equal(1);
      });

      it('refuses a redirect to an internal address literal', async () => {
        redirectTo = (port) => `http://127.0.0.1:${port}/`;

        const error = await axios.get(registry.url, guardedPastTheRegistry()).then(() => null, (e) => e);

        expect(error).to.have.property('code', 'EBLOCKEDADDRESS');
        expect(registryHits).to.equal(1);
        expect(internalHits).to.equal(0);
      });

      it('refuses a redirect to an internal address in an encoded form', async () => {
        redirectTo = (port) => `http://2130706433:${port}/`;

        const error = await axios.get(registry.url, guardedPastTheRegistry()).then(() => null, (e) => e);

        expect(error).to.have.property('code', 'EBLOCKEDADDRESS');
        expect(registryHits).to.equal(1);
        expect(internalHits).to.equal(0);
      });

      it('refuses a redirect to a name that resolves internal', async () => {
        redirectTo = (port) => `http://localhost:${port}/`;

        const error = await axios.get(registry.url, guardedPastTheRegistry()).then(() => null, (e) => e);

        expect(error).to.have.property('code', 'EBLOCKEDADDRESS');
        expect(registryHits).to.equal(1);
        expect(internalHits).to.equal(0);
      });
    });
  });
});
