const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const { once } = require('node:events');
const { expect } = require('chai');
const sinon = require('sinon');

const dnsLookup = require('../../ZelBack/src/services/utils/dnsLookup');

// A hostname no real resolver answers for, so only the stubbed sources can resolve it.
const HOSTNAME = 'flux-dns-lookup-test.invalid';

// A query the server never answers.
const NO_REPLY = 'NO_REPLY';

function dnsError(code, syscall) {
  const error = new Error(`${syscall} ${code} ${HOSTNAME}`);
  error.code = code;
  error.syscall = syscall;
  error.hostname = HOSTNAME;
  return error;
}

function lookupAsync(hostname, options) {
  return new Promise((resolve, reject) => {
    dnsLookup.lookup(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve(options.all ? address : { address, family });
    });
  });
}

describe('dnsLookup tests', () => {
  // What each source answers, by family: an array of addresses, or an error code.
  let answers;
  let asked;

  // The public resolver is the one whose servers are exactly the public list; the system
  // resolver's list may include one of those servers among its own.
  function sourceOf(resolver) {
    const servers = resolver.getServers().join(',');
    return servers === dnsLookup.PUBLIC_DNS_SERVERS.join(',') ? 'public' : 'system';
  }

  function answerFrom(resolver, family, syscall) {
    const source = sourceOf(resolver);
    asked.push(`${source}:${family}`);
    const answer = answers[source][family];
    if (answer === NO_REPLY) return new Promise(() => {});
    if (answer && answer.afterMs !== undefined) {
      return new Promise((resolve) => { setTimeout(() => resolve(answer.addresses), answer.afterMs); });
    }
    if (Array.isArray(answer)) return Promise.resolve(answer);
    return Promise.reject(dnsError(answer, syscall));
  }

  function fakeResolve4() {
    return answerFrom(this, 4, 'queryA');
  }

  function fakeResolve6() {
    return answerFrom(this, 6, 'queryAaaa');
  }

  function fakeOsLookup() {
    asked.push('os');
    const answer = answers.os;
    if (Array.isArray(answer)) return Promise.resolve(answer);
    return Promise.reject(dnsError(answer, 'getaddrinfo'));
  }

  beforeEach(() => {
    asked = [];
    answers = {
      system: { 4: 'ESERVFAIL', 6: 'ESERVFAIL' },
      public: { 4: 'ESERVFAIL', 6: 'ESERVFAIL' },
      os: 'ENOTFOUND',
    };
    sinon.stub(dns.promises.Resolver.prototype, 'resolve4').callsFake(fakeResolve4);
    sinon.stub(dns.promises.Resolver.prototype, 'resolve6').callsFake(fakeResolve6);
    sinon.stub(dns.promises, 'lookup').callsFake(fakeOsLookup);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('lookup tests', () => {
    it('should answer with the IPv4 addresses when the system servers fail the AAAA query', async () => {
      answers.system[4] = ['203.0.113.10'];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.10', family: 4 }]);
      expect(asked).to.have.members(['system:4', 'system:6']);
    });

    it('should ask the public servers when the system servers have no address', async () => {
      answers.public[4] = ['203.0.113.20'];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.20', family: 4 }]);
      expect(asked).to.include.members(['public:4', 'public:6']);
      expect(asked).to.not.include('os');
    });

    it('should ask the public servers when one family failed and the other has no address', async () => {
      answers.system = { 4: 'ENODATA', 6: 'ETIMEOUT' };
      answers.public[6] = ['2001:db8::20'];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '2001:db8::20', family: 6 }]);
    });

    it('should not ask the public servers when the system servers answer that the name does not exist', async () => {
      answers.system = { 4: 'ENOTFOUND', 6: 'ENOTFOUND' };
      answers.public[4] = ['203.0.113.21'];
      answers.os = [{ address: '203.0.113.22', family: 4 }];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.22', family: 4 }]);
      expect(asked).to.have.members(['system:4', 'system:6', 'os']);
    });

    it('should not ask the public servers when the system servers answer that the name has no records', async () => {
      answers.system = { 4: 'ENODATA', 6: 'ENODATA' };
      answers.public[4] = ['203.0.113.23'];

      let caught = null;
      try {
        await lookupAsync(HOSTNAME, { all: true });
      } catch (error) {
        caught = error;
      }

      expect(caught.code).to.equal('ENOTFOUND');
      expect(asked).to.have.members(['system:4', 'system:6', 'os']);
    });

    describe('a family that answers late or never', () => {
      let clock;

      beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      });

      afterEach(() => {
        clock.restore();
      });

      it('should answer with the IPv4 addresses once the delay passes when the AAAA query is never answered', async () => {
        answers.system[4] = ['93.184.216.34'];
        answers.system[6] = NO_REPLY;

        const lookup = lookupAsync(HOSTNAME, { all: true });
        await clock.tickAsync(dnsLookup.RESOLUTION_DELAY_MS);

        expect(await lookup).to.deep.equal([{ address: '93.184.216.34', family: 4 }]);
      });

      it('should not answer before the delay has passed', async () => {
        answers.system[4] = ['93.184.216.34'];
        answers.system[6] = NO_REPLY;
        let settled = false;

        lookupAsync(HOSTNAME, { all: true }).then(() => { settled = true; });
        await clock.tickAsync(dnsLookup.RESOLUTION_DELAY_MS - 1);

        expect(settled).to.equal(false);
      });

      it('should include the IPv6 addresses that answer within the delay', async () => {
        answers.system[4] = ['93.184.216.34'];
        answers.system[6] = { afterMs: dnsLookup.RESOLUTION_DELAY_MS - 1, addresses: ['2606:2800:220:1::1'] };

        const lookup = lookupAsync(HOSTNAME, { all: true });
        await clock.tickAsync(dnsLookup.RESOLUTION_DELAY_MS);

        expect(await lookup).to.deep.equal([
          { address: '93.184.216.34', family: 4 },
          { address: '2606:2800:220:1::1', family: 6 },
        ]);
      });

      it('should wait for the other family when the first has no address', async () => {
        // The delay starts only once a family has addresses: a family that answered empty
        // leaves the lookup waiting on the one that might have them.
        answers.system[4] = { afterMs: 1000, addresses: ['93.184.216.34'] };
        answers.system[6] = 'ENODATA';

        const lookup = lookupAsync(HOSTNAME, { all: true });
        await clock.tickAsync(1000);

        expect(await lookup).to.deep.equal([{ address: '93.184.216.34', family: 4 }]);
      });
    });

    it('should fall back to the operating system resolver when no DNS server has an address', async () => {
      answers.os = [{ address: '203.0.113.30', family: 4 }];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.30', family: 4 }]);
      expect(asked).to.include('os');
    });

    it('should pass on the operating system resolver\'s error when nothing has an address', async () => {
      let caught = null;
      try {
        await lookupAsync(HOSTNAME, { all: true });
      } catch (error) {
        caught = error;
      }

      expect(caught).to.not.equal(null);
      expect(caught.code).to.equal('ENOTFOUND');
      expect(caught.hostname).to.equal(HOSTNAME);
    });

    it('should return IPv4 addresses before IPv6 addresses', async () => {
      answers.system = { 4: ['203.0.113.40', '203.0.113.41'], 6: ['2001:db8::40'] };

      const all = await lookupAsync(HOSTNAME, { all: true });
      const first = await lookupAsync(HOSTNAME, {});

      expect(all).to.deep.equal([
        { address: '203.0.113.40', family: 4 },
        { address: '203.0.113.41', family: 4 },
        { address: '2001:db8::40', family: 6 },
      ]);
      expect(first).to.deep.equal({ address: '203.0.113.40', family: 4 });
    });

    it('should order the operating system resolver\'s addresses IPv4 first', async () => {
      answers.os = [{ address: '2001:db8::50', family: 6 }, { address: '203.0.113.50', family: 4 }];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([
        { address: '203.0.113.50', family: 4 },
        { address: '2001:db8::50', family: 6 },
      ]);
    });

    it('should query only the family asked for', async () => {
      answers.system = { 4: ['203.0.113.60'], 6: ['2001:db8::60'] };

      const result = await lookupAsync(HOSTNAME, { family: 6, all: true });

      expect(result).to.deep.equal([{ address: '2001:db8::60', family: 6 }]);
      expect(asked).to.deep.equal(['system:6']);
    });
  });

  describe('install tests', () => {
    let server;
    let port;
    let originalLookups;

    beforeEach(async () => {
      originalLookups = [http.globalAgent.options.lookup, https.globalAgent.options.lookup];
      server = http.createServer((req, res) => res.end('reached'));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      ({ port } = server.address());
      answers.system[4] = ['127.0.0.1'];
    });

    afterEach(async () => {
      [http.globalAgent, https.globalAgent].forEach((agent, index) => {
        if (originalLookups[index] === undefined) delete agent.options.lookup;
        else agent.options.lookup = originalLookups[index];
      });
      server.close();
      await once(server, 'close');
    });

    function get() {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://${HOSTNAME}:${port}/`, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
      });
    }

    it('should resolve a request on the global http agent through the lookup', async () => {
      dnsLookup.install();

      const body = await get();

      expect(body).to.equal('reached');
      expect(asked).to.include('system:4');
    });

    it('should not resolve the same request without it', async () => {
      // Canary for the test above: the hostname resolves only through the stubbed sources.
      let caught = null;
      try {
        await get();
      } catch (error) {
        caught = error;
      }

      expect(caught).to.not.equal(null);
      expect(asked).to.deep.equal([]);
    });
  });
});
