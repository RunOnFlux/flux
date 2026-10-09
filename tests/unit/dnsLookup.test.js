const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const { once } = require('node:events');
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const dnsLookup = require('../../ZelBack/src/services/utils/dnsLookup');

// A hostname no real resolver answers for, so only the stubbed sources can resolve it.
const HOSTNAME = 'flux-dns-lookup-test.invalid';

// A query the server never answers.
const NO_REPLY = 'NO_REPLY';

// The system servers the tests run with, as resolv.conf would list them.
const SYSTEM = '192.0.2.53';
const SECOND = '192.0.2.54';

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
  // What each source answers, by family: an array of addresses, or an error code. A probe -
  // a random name under .com - is answered by `probe[source]` instead.
  let answers;
  let asked;

  function sourceOf(resolver) {
    const servers = resolver.getServers().join(',');
    if (servers === dnsLookup.PUBLIC_DNS_SERVERS.join(',')) return 'public';
    if (servers === SECOND) return 'second';
    return 'system';
  }

  function isProbe(hostname) {
    return hostname !== HOSTNAME && /^[0-9a-f]{32}\.com$/.test(hostname);
  }

  function answerFrom(resolver, hostname, family, syscall) {
    const source = sourceOf(resolver);
    const probing = isProbe(hostname);
    asked.push(probing ? `${source}:probe` : `${source}:${family}`);
    const answer = probing ? answers.probe[source] : answers[source][family];
    if (answer === NO_REPLY) return new Promise(() => {});
    if (answer && answer.afterMs !== undefined) {
      return new Promise((resolve) => { setTimeout(() => resolve(answer.addresses), answer.afterMs); });
    }
    if (Array.isArray(answer)) return Promise.resolve(answer);
    return Promise.reject(dnsError(answer, syscall));
  }

  function fakeResolve4(hostname) {
    return answerFrom(this, hostname, 4, 'queryA');
  }

  function fakeResolve6(hostname) {
    return answerFrom(this, hostname, 6, 'queryAaaa');
  }

  // The operating system resolver answers every name, so a lookup that calls it is seen to.
  function fakeOsLookup() {
    asked.push('os');
    return Promise.resolve([{ address: '203.0.113.99', family: 4 }]);
  }

  beforeEach(() => {
    asked = [];
    answers = {
      system: { 4: 'ESERVFAIL', 6: 'ESERVFAIL' },
      second: { 4: 'ESERVFAIL', 6: 'ESERVFAIL' },
      public: { 4: 'ESERVFAIL', 6: 'ESERVFAIL' },
      probe: { system: 'ENOTFOUND', second: 'ENOTFOUND' },
    };
    dnsLookup.useSystemServers([SYSTEM]);
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

      let caught = null;
      try {
        await lookupAsync(HOSTNAME, { all: true });
      } catch (error) {
        caught = error;
      }

      expect(caught.code).to.equal('ENOTFOUND');
      expect(asked).to.deep.equal(['system:4', 'system:6']);
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

      expect(caught.code).to.equal('ENODATA');
      expect(asked).to.deep.equal(['system:4', 'system:6']);
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

      it('should wait for the IPv4 addresses when the AAAA query answers first', async () => {
        answers.system[4] = { afterMs: 1000, addresses: ['93.184.216.34'] };
        answers.system[6] = ['2606:2800:220:1::1'];
        let settled = false;

        const lookup = lookupAsync(HOSTNAME, { all: true });
        lookup.then(() => { settled = true; });
        await clock.tickAsync(999);
        expect(settled).to.equal(false);
        await clock.tickAsync(1);

        expect(await lookup).to.deep.equal([
          { address: '93.184.216.34', family: 4 },
          { address: '2606:2800:220:1::1', family: 6 },
        ]);
      });

      it('should answer with the IPv6 addresses when the A query fails after the AAAA query answered', async () => {
        answers.system[4] = 'ESERVFAIL';
        answers.system[6] = ['2606:2800:220:1::1'];

        expect(await lookupAsync(HOSTNAME, { all: true })).to.deep.equal([{ address: '2606:2800:220:1::1', family: 6 }]);
      });
    });

    describe('dns.ADDRCONFIG, as net.connect passes it', () => {
      const LOOPBACK_ONLY = {
        lo: [
          { address: '127.0.0.1', family: 'IPv4', internal: true },
          { address: '::1', family: 'IPv6', internal: true },
        ],
      };
      const IPV4 = { address: '198.51.100.7', family: 'IPv4', internal: false };
      const LINK_LOCAL = { address: 'fe80::d835:efff:feff:e29d', family: 'IPv6', internal: false };
      const GLOBAL_V6 = { address: '2001:db8::7', family: 'IPv6', internal: false };
      const UNIQUE_LOCAL = { address: 'fd00::7', family: 'IPv6', internal: false };
      let interfaces;

      const withAddrconfig = (extra = {}) => ({ all: true, hints: dns.ADDRCONFIG, ...extra });

      beforeEach(() => {
        interfaces = { ...LOOPBACK_ONLY, eth0: [IPV4] };
        sinon.stub(os, 'networkInterfaces').callsFake(() => interfaces);
        answers.system = { 4: ['203.0.113.80'], 6: ['2001:db8::80'] };
      });

      it('should ask for IPv4 only on a host with no IPv6 address but loopback', async () => {
        expect(await lookupAsync(HOSTNAME, withAddrconfig())).to.deep.equal([{ address: '203.0.113.80', family: 4 }]);
        expect(asked).to.deep.equal(['system:4']);
      });

      it('should not count a link-local IPv6 address', async () => {
        interfaces.eth0 = [IPV4, LINK_LOCAL];

        await lookupAsync(HOSTNAME, withAddrconfig());

        expect(asked).to.deep.equal(['system:4']);
      });

      it('should ask for both families on a host with a global IPv6 address', async () => {
        interfaces.eth0 = [IPV4, LINK_LOCAL, GLOBAL_V6];

        const result = await lookupAsync(HOSTNAME, withAddrconfig());

        expect(result).to.deep.equal([{ address: '203.0.113.80', family: 4 }, { address: '2001:db8::80', family: 6 }]);
        expect(asked).to.deep.equal(['system:4', 'system:6']);
      });

      it('should count a unique-local IPv6 address', async () => {
        interfaces.eth0 = [IPV4, UNIQUE_LOCAL];

        await lookupAsync(HOSTNAME, withAddrconfig());

        expect(asked).to.deep.equal(['system:4', 'system:6']);
      });

      it('should read the host\'s addresses on every lookup', async () => {
        await lookupAsync(HOSTNAME, withAddrconfig());
        interfaces.eth0 = [IPV4, GLOBAL_V6];
        await lookupAsync(HOSTNAME, withAddrconfig());

        expect(asked).to.deep.equal(['system:4', 'system:4', 'system:6']);
      });

      it('should ask for IPv6 only on a host with no IPv4 address but loopback', async () => {
        interfaces.eth0 = [GLOBAL_V6];

        await lookupAsync(HOSTNAME, withAddrconfig());

        expect(asked).to.deep.equal(['system:6']);
      });

      it('should ask for both families on a host with no address but loopback', async () => {
        interfaces = { ...LOOPBACK_ONLY };

        await lookupAsync(HOSTNAME, withAddrconfig());

        expect(asked).to.deep.equal(['system:4', 'system:6']);
      });

      it('should ask for the family a caller names, whatever the host holds', async () => {
        await lookupAsync(HOSTNAME, withAddrconfig({ family: 6 }));

        expect(asked).to.deep.equal(['system:6']);
      });

      it('should ask for both families without the hint', async () => {
        await lookupAsync(HOSTNAME, { all: true });

        expect(asked).to.deep.equal(['system:4', 'system:6']);
      });

      it('should answer localhost with 127.0.0.1 alone on a host with no IPv6 address', async () => {
        expect(await lookupAsync('localhost', withAddrconfig())).to.deep.equal([{ address: '127.0.0.1', family: 4 }]);
      });

      it('should leave a public lookup to the same families', async () => {
        answers.system = { 4: 'ESERVFAIL', 6: 'ESERVFAIL' };
        answers.public = { 4: ['203.0.113.81'], 6: ['2001:db8::81'] };

        expect(await lookupAsync(HOSTNAME, withAddrconfig())).to.deep.equal([{ address: '203.0.113.81', family: 4 }]);
        expect(asked).to.deep.equal(['system:4', 'public:4']);
      });
    });

    describe('a lookup no source answers with an address', () => {
      async function lookupError(options = { all: true }) {
        try {
          await lookupAsync(HOSTNAME, options);
        } catch (error) {
          return error;
        }
        return null;
      }

      it('should fail with the system server\'s error when it answers that the name does not exist', async () => {
        answers.system = { 4: 'ENOTFOUND', 6: 'ENOTFOUND' };

        const error = await lookupError();

        expect(error.code).to.equal('ENOTFOUND');
        expect(error.hostname).to.equal(HOSTNAME);
        expect(asked).to.deep.equal(['system:4', 'system:6']);
      });

      it('should fail with the public servers\' error when no server answers that the name has no address', async () => {
        answers.public = { 4: 'ETIMEOUT', 6: 'ETIMEOUT' };

        const error = await lookupError();

        expect(error.code).to.equal('ETIMEOUT');
        expect(asked).to.deep.equal(['system:4', 'system:6', 'public:4', 'public:6']);
      });

      it('should fail with the public servers\' answer that the name does not exist when the system server fails', async () => {
        answers.public = { 4: 'ENOTFOUND', 6: 'ENOTFOUND' };

        const error = await lookupError();

        expect(error.code).to.equal('ENOTFOUND');
      });

      it('should fail with the error of the family whose query failed, not of the one with no records', async () => {
        answers.system = { 4: 'ENODATA', 6: 'ESERVFAIL' };
        answers.public = { 4: 'ENODATA', 6: 'ETIMEOUT' };

        const error = await lookupError();

        expect(error.code).to.equal('ETIMEOUT');
      });

      it('should fail with the error of the one family asked for', async () => {
        answers.public = { 4: 'ETIMEOUT', 6: 'ENOTFOUND' };

        const error = await lookupError({ family: 6, all: true });

        expect(error.code).to.equal('ENOTFOUND');
        expect(asked).to.deep.equal(['system:6', 'public:6']);
      });

      it('should never ask the operating system resolver', async () => {
        await lookupError();

        expect(asked).to.include('public:4');
        expect(asked).to.not.include('os');
      });
    });

    describe('localhost', () => {
      it('should answer localhost with the loopback addresses, IPv4 first, without a query', async () => {
        const result = await lookupAsync('localhost', { all: true });

        expect(result).to.deep.equal([{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]);
        expect(asked).to.deep.equal([]);
      });

      it('should answer a name under localhost, in any case and with a trailing dot', async () => {
        const results = await Promise.all(['LocalHost', 'localhost.', 'shareddb.localhost', 'a.b.LOCALHOST.']
          .map((name) => lookupAsync(name, { all: true })));

        results.forEach((result) => expect(result).to.deep.equal([
          { address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 },
        ]));
        expect(asked).to.deep.equal([]);
      });

      it('should answer only the family asked for', async () => {
        expect(await lookupAsync('localhost', { family: 6 })).to.deep.equal({ address: '::1', family: 6 });
        expect(await lookupAsync('localhost', { family: 4 })).to.deep.equal({ address: '127.0.0.1', family: 4 });
        expect(await lookupAsync('localhost', {})).to.deep.equal({ address: '127.0.0.1', family: 4 });
      });

      it('should ask DNS for a name that only contains localhost', async () => {
        answers.system = { 4: ['203.0.113.70'], 6: 'ENODATA' };

        const results = await Promise.all(['localhost.example.com', 'notlocalhost']
          .map((name) => lookupAsync(name, { all: true })));

        results.forEach((result) => expect(result).to.deep.equal([{ address: '203.0.113.70', family: 4 }]));
        expect(asked).to.have.lengthOf(4);
      });
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

    it('should query only the family asked for', async () => {
      answers.system = { 4: ['203.0.113.60'], 6: ['2001:db8::60'] };

      const result = await lookupAsync(HOSTNAME, { family: 6, all: true });

      expect(result).to.deep.equal([{ address: '2001:db8::60', family: 6 }]);
      expect(asked).to.deep.equal(['system:6']);
    });
  });

  describe('query bounds tests', () => {
    it('should build every resolver it queries with one bounded try', () => {
      const built = [];
      class FakeResolver {
        constructor(options) { built.push(options); }

        getServers() { return ['127.0.0.53', '192.0.2.1']; }

        setServers() {}
      }
      proxyquire('../../ZelBack/src/services/utils/dnsLookup', {
        'node:dns': { ...dns, promises: { ...dns.promises, Resolver: FakeResolver } },
      });

      // The public resolver, the one that reads the system's server list, and one per system server.
      const queried = built.filter(Boolean);
      expect(built).to.have.length(4);
      expect(queried).to.deep.equal(Array(3).fill({ timeout: dnsLookup.QUERY_TIMEOUT_MS, tries: 1 }));
    });
  });

  describe('a system server that does not answer', () => {
    const silent = () => dnsLookup.systemServerStates().filter((state) => state.silent).map((state) => state.address);

    beforeEach(() => {
      answers.system = { 4: 'ETIMEOUT', 6: 'ETIMEOUT' };
      answers.public[4] = ['203.0.113.70'];
    });

    it('should probe it at once, and keep it in use when it resolves the probe: the name was the failure', async () => {
      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.70', family: 4 }]);
      expect(asked).to.deep.equal(['system:4', 'system:6', 'system:probe', 'public:4', 'public:6']);
      expect(silent()).to.deep.equal([]);

      answers.system[4] = ['203.0.113.71'];
      asked = [];
      expect(await lookupAsync(HOSTNAME, { all: true })).to.deep.equal([{ address: '203.0.113.71', family: 4 }]);
    });

    it('should count a probe answered with an address as resolving', async () => {
      answers.probe.system = ['198.51.100.1'];

      await lookupAsync(HOSTNAME, { all: true });

      expect(silent()).to.deep.equal([]);
    });

    it('should remember it as silent when the probe is not answered, and skip it after', async () => {
      answers.probe.system = 'ETIMEOUT';

      await lookupAsync(HOSTNAME, { all: true });
      expect(silent()).to.deep.equal([SYSTEM]);

      asked = [];
      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.70', family: 4 }]);
      expect(asked).to.deep.equal(['public:4', 'public:6']);
    });

    it('should remember it as silent when it answers the probe with SERVFAIL', async () => {
      answers.probe.system = 'ESERVFAIL';

      await lookupAsync(HOSTNAME, { all: true });

      expect(silent()).to.deep.equal([SYSTEM]);
    });

    it('should probe a server whose host refuses the query', async () => {
      answers.system = { 4: 'ECONNREFUSED', 6: 'ECONNREFUSED' };
      answers.probe.system = 'ECONNREFUSED';

      await lookupAsync(HOSTNAME, { all: true });

      expect(asked).to.include('system:probe');
      expect(silent()).to.deep.equal([SYSTEM]);
    });

    it('should not probe a server that answers with a failure', async () => {
      answers.system = { 4: 'ESERVFAIL', 6: 'ESERVFAIL' };

      await lookupAsync(HOSTNAME, { all: true });

      expect(asked).to.not.include('system:probe');
      expect(silent()).to.deep.equal([]);
    });

    it('should not let a name a caller chooses make it silent, however often it is asked for', async () => {
      await Promise.all(Array.from({ length: 8 }, () => lookupAsync(HOSTNAME, { all: true })));
      await lookupAsync(HOSTNAME, { all: true });

      expect(silent()).to.deep.equal([]);
    });

    it('should probe with a random 128-bit name under .com', async () => {
      await lookupAsync(HOSTNAME, { all: true });
      await lookupAsync(HOSTNAME, { all: true });

      const names = dns.promises.Resolver.prototype.resolve4.getCalls().map((call) => call.args[0]).filter((name) => name !== HOSTNAME);
      expect(names).to.have.length(2);
      names.forEach((name) => expect(name).to.match(/^[0-9a-f]{32}\.com$/));
      expect(names[0]).to.not.equal(names[1]);
    });

    it('should send one probe for lookups that meet the server together', async () => {
      answers.probe.system = 'ETIMEOUT';

      await Promise.all(Array.from({ length: 3 }, () => lookupAsync(HOSTNAME, { all: true })));

      expect(asked.filter((entry) => entry === 'system:probe')).to.have.length(1);
    });

    describe('while it is silent', () => {
      let clock;

      beforeEach(async () => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        answers.probe.system = 'ETIMEOUT';
        await lookupAsync(HOSTNAME, { all: true });
        asked = [];
      });

      afterEach(() => {
        clock.restore();
      });

      it('should not probe it again before REPROBE_MS has passed', async () => {
        await clock.tickAsync(dnsLookup.REPROBE_MS - 1);
        await lookupAsync(HOSTNAME, { all: true });

        expect(asked).to.deep.equal(['public:4', 'public:6']);
      });

      it('should probe it again once REPROBE_MS has passed, with a fresh name, without the lookup waiting on it', async () => {
        const probesBefore = [];
        dns.promises.Resolver.prototype.resolve4.getCalls().forEach((call) => {
          if (isProbe(call.args[0])) probesBefore.push(call.args[0]);
        });
        answers.probe.system = NO_REPLY;
        await clock.tickAsync(dnsLookup.REPROBE_MS);

        const result = await lookupAsync(HOSTNAME, { all: true });

        expect(result).to.deep.equal([{ address: '203.0.113.70', family: 4 }]);
        expect(asked).to.deep.equal(['system:probe', 'public:4', 'public:6']);
        const probeNames = dns.promises.Resolver.prototype.resolve4.getCalls().map((call) => call.args[0]).filter(isProbe);
        expect(probeNames.at(-1)).to.not.equal(probesBefore.at(-1));
      });

      it('should bring it back when a later probe resolves', async () => {
        answers.probe.system = 'ENOTFOUND';
        answers.system[4] = ['203.0.113.72'];
        await clock.tickAsync(dnsLookup.REPROBE_MS);

        await lookupAsync(HOSTNAME, { all: true });
        expect(silent()).to.deep.equal([]);
        asked = [];
        const result = await lookupAsync(HOSTNAME, { all: true });

        expect(result).to.deep.equal([{ address: '203.0.113.72', family: 4 }]);
        expect(asked).to.include('system:4');
      });
    });
  });

  describe('every outcome of the A query against every outcome of the AAAA query', () => {
    const SYSTEM_A = '203.0.113.81';
    const SYSTEM_AAAA = '2001:db8::81';
    const PUBLIC_A = '203.0.113.82';
    const PUBLIC_AAAA = '2001:db8::82';
    const OUTCOMES = {
      addresses: { 4: [SYSTEM_A], 6: [SYSTEM_AAAA] },
      'no records': 'ENODATA',
      'no such name': 'ENOTFOUND',
      SERVFAIL: 'ESERVFAIL',
      'no reply': 'ETIMEOUT',
      refused: 'ECONNREFUSED',
    };
    const system4 = [{ address: SYSTEM_A, family: 4 }];
    const system6 = [{ address: SYSTEM_AAAA, family: 6 }];
    const system46 = [...system4, ...system6];
    const fromPublic = [{ address: PUBLIC_A, family: 4 }, { address: PUBLIC_AAAA, family: 6 }];

    // A query          AAAA query       the lookup's answer   probe sent
    const CASES = [
      ['addresses', 'addresses', system46, false],
      ['addresses', 'no records', system4, false],
      ['addresses', 'no such name', system4, false],
      ['addresses', 'SERVFAIL', system4, false],
      ['addresses', 'no reply', system4, false],
      ['addresses', 'refused', system4, false],
      ['no records', 'addresses', system6, false],
      ['no records', 'no records', 'ENODATA', false],
      ['no records', 'no such name', 'ENODATA', false],
      ['no records', 'SERVFAIL', fromPublic, false],
      ['no records', 'no reply', fromPublic, true],
      ['no records', 'refused', fromPublic, true],
      ['no such name', 'addresses', system6, false],
      ['no such name', 'no records', 'ENOTFOUND', false],
      ['no such name', 'no such name', 'ENOTFOUND', false],
      ['no such name', 'SERVFAIL', fromPublic, false],
      ['no such name', 'no reply', fromPublic, true],
      ['no such name', 'refused', fromPublic, true],
      ['SERVFAIL', 'addresses', system6, false],
      ['SERVFAIL', 'no records', fromPublic, false],
      ['SERVFAIL', 'no such name', fromPublic, false],
      ['SERVFAIL', 'SERVFAIL', fromPublic, false],
      ['SERVFAIL', 'no reply', fromPublic, true],
      ['SERVFAIL', 'refused', fromPublic, true],
      ['no reply', 'addresses', system6, false],
      ['no reply', 'no records', fromPublic, true],
      ['no reply', 'no such name', fromPublic, true],
      ['no reply', 'SERVFAIL', fromPublic, true],
      ['no reply', 'no reply', fromPublic, true],
      ['no reply', 'refused', fromPublic, true],
      ['refused', 'addresses', system6, false],
      ['refused', 'no records', fromPublic, true],
      ['refused', 'no such name', fromPublic, true],
      ['refused', 'SERVFAIL', fromPublic, true],
      ['refused', 'no reply', fromPublic, true],
      ['refused', 'refused', fromPublic, true],
    ];

    it('should cover every pair of outcomes', () => {
      const outcomes = Object.keys(OUTCOMES);
      const pairs = CASES.map(([a, aaaa]) => `${a}|${aaaa}`);
      expect(new Set(pairs).size).to.equal(outcomes.length ** 2);
      outcomes.forEach((a) => outcomes.forEach((aaaa) => expect(pairs).to.include(`${a}|${aaaa}`)));
    });

    CASES.forEach(([a, aaaa, expected, probed]) => {
      const answer = Array.isArray(expected) ? (expected === fromPublic ? 'the public servers\' addresses' : 'its addresses') : expected;
      it(`A ${a}, AAAA ${aaaa}: should answer ${answer}, ${probed ? 'probing' : 'not probing'} the server`, async () => {
        answers.system = {
          4: a === 'addresses' ? OUTCOMES.addresses[4] : OUTCOMES[a],
          6: aaaa === 'addresses' ? OUTCOMES.addresses[6] : OUTCOMES[aaaa],
        };
        answers.public = { 4: [PUBLIC_A], 6: [PUBLIC_AAAA] };

        let result = null;
        let caught = null;
        try {
          result = await lookupAsync(HOSTNAME, { all: true });
        } catch (error) {
          caught = error;
        }

        if (Array.isArray(expected)) {
          expect(caught).to.equal(null);
          expect(result).to.deep.equal(expected);
        } else {
          expect(result).to.equal(null);
          expect(caught.code).to.equal(expected);
        }
        expect(asked.includes('system:probe'), 'probe sent').to.equal(probed);
        expect(asked.some((entry) => entry.startsWith('public:')), 'public servers asked').to.equal(expected === fromPublic);
        expect(dnsLookup.systemServerStates().filter((state) => state.silent), 'remembered as silent').to.deep.equal([]);
      });
    });
  });

  describe('more than one system server', () => {
    beforeEach(() => {
      dnsLookup.useSystemServers([SYSTEM, SECOND]);
    });

    it('should ask the next server when the first answers with a failure', async () => {
      answers.second[4] = ['203.0.113.80'];

      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.80', family: 4 }]);
      expect(asked).to.include.members(['system:4', 'second:4']);
    });

    it('should judge each server on its own: a silent first server is skipped and the next answers', async () => {
      answers.system = { 4: 'ETIMEOUT', 6: 'ETIMEOUT' };
      answers.probe.system = 'ETIMEOUT';
      answers.second[4] = ['203.0.113.81'];

      await lookupAsync(HOSTNAME, { all: true });
      asked = [];
      const result = await lookupAsync(HOSTNAME, { all: true });

      expect(result).to.deep.equal([{ address: '203.0.113.81', family: 4 }]);
      expect(asked).to.deep.equal(['second:4', 'second:6']);
      expect(dnsLookup.systemServerStates()).to.deep.equal([
        { address: SYSTEM, silent: true },
        { address: SECOND, silent: false },
      ]);
    });

    it('should not ask the public servers when a later server answers that the name does not exist', async () => {
      answers.second = { 4: 'ENOTFOUND', 6: 'ENOTFOUND' };
      answers.public[4] = ['203.0.113.82'];

      let caught = null;
      try {
        await lookupAsync(HOSTNAME, { all: true });
      } catch (error) {
        caught = error;
      }

      expect(caught.code).to.equal('ENOTFOUND');
      expect(asked).to.not.include('public:4');
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
