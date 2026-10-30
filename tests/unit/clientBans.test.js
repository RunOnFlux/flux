const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// tests/unit/globalconfig lists 1.2.3.4 as a balancer.
const BALANCER = '1.2.3.4';
const BANNED = '43.134.95.84';
const NEIGHBOUR = '43.134.95.85';
const IN_RANGE = '101.32.7.9';
const BANNED_V6 = '2401:db00:1:2::77';
const SAME_64 = '2401:db00:1:2:ffff::1';
const OTHER_64 = '2401:db00:1:3::1';
const STRANGER = '198.51.100.25';

describe('clientBans tests', () => {
  let document;
  let seq;
  let clientBans;

  const entry = (value, fields = {}) => ({
    kind: 'client', value, reason: 'r', added: '2026-10-30', expires: '2027-01-28', ...fields,
  });
  const caller = (remoteAddress, headers = {}) => ({ remoteAddress, headers });

  beforeEach(() => {
    document = [entry(`${BANNED}/32`), entry('101.32.0.0/16'), entry('2401:db00:1:2::/64')];
    seq = 7;
    clientBans = proxyquire('../../ZelBack/src/services/appSecurity/clientBans', {
      '../policyStore': { getDocument: (name) => (name === 'blocklist' ? document : null), getSeq: () => seq },
    });
    sinon.useFakeTimers(new Date('2026-11-02T12:00:00Z'));
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('isBannedCaller', () => {
    it('refuses an address a /32 names, and not its neighbour', () => {
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(true);
      expect(clientBans.isBannedCaller(caller(NEIGHBOUR))).to.equal(false);
    });

    it('refuses every address inside a wider range', () => {
      expect(clientBans.isBannedCaller(caller(IN_RANGE))).to.equal(true);
    });

    it('refuses every address in a banned IPv6 /64, and none in the next', () => {
      expect(clientBans.isBannedCaller(caller(BANNED_V6))).to.equal(true);
      expect(clientBans.isBannedCaller(caller(SAME_64))).to.equal(true);
      expect(clientBans.isBannedCaller(caller(OTHER_64))).to.equal(false);
    });

    it('reads an IPv4-mapped socket address as the IPv4 address it carries', () => {
      expect(clientBans.isBannedCaller(caller(`::ffff:${BANNED}`))).to.equal(true);
    });

    it('refuses the caller a balancer forwards, and never the balancer', () => {
      expect(clientBans.isBannedCaller(caller(BALANCER, { 'x-forwarded-for': BANNED }))).to.equal(true);
      expect(clientBans.isBannedCaller(caller(BALANCER, { 'x-forwarded-for': STRANGER }))).to.equal(false);
    });

    it('never bans a balancer that forwards no caller, even inside a banned range', () => {
      document = [entry(`${BALANCER}/32`), entry('1.2.0.0/16')];
      seq = 11;
      expect(clientBans.isBannedCaller(caller(BALANCER))).to.equal(false);
      expect(clientBans.isBannedCaller(caller(BALANCER, { 'x-forwarded-for': 'not-an-address' }))).to.equal(false);
      // the canary: an address beside it in the same range is banned
      expect(clientBans.isBannedCaller(caller('1.2.3.5'))).to.equal(true);
    });

    it('judges a caller that is not a balancer by its own address, whatever it forwards', () => {
      expect(clientBans.isBannedCaller(caller(STRANGER, { 'x-forwarded-for': BANNED }))).to.equal(false);
      expect(clientBans.isBannedCaller(caller(BANNED, { 'x-forwarded-for': STRANGER }))).to.equal(true);
    });

    it('enforces an entry through the day it expires, and not the day after', () => {
      document = [entry(`${BANNED}/32`, { expires: '2026-11-02' })];
      seq = 8;
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(true);

      sinon.clock.setSystemTime(new Date('2026-11-03T00:00:01Z'));
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(false);
    });

    it('takes a new bundle\'s entries when its sequence changes', () => {
      expect(clientBans.isBannedCaller(caller(STRANGER))).to.equal(false);

      document = [entry('198.51.100.0/24')];
      seq = 8;
      expect(clientBans.isBannedCaller(caller(STRANGER))).to.equal(true);
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(false);
    });

    it('ignores every other kind, and client entries it cannot read', () => {
      document = [
        { kind: 'owner', value: BANNED },
        entry(BANNED),
        entry(`${BANNED}/33`),
        entry('not-an-ip/32'),
        entry(`${BANNED}/32`, { expires: 'never' }),
        entry(`${BANNED}/32`, { expires: undefined }),
      ];
      seq = 9;
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(false);
    });

    it('keeps the families apart: an IPv6 range never refuses an IPv4 caller', () => {
      document = [entry('::/32')];
      seq = 10;
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(false);
    });

    it('bans nobody on a node that holds no blocklist', () => {
      document = null;
      expect(clientBans.isBannedCaller(caller(BANNED))).to.equal(false);
    });
  });

  describe('refuseBannedCaller', () => {
    const request = (remoteAddress) => ({ socket: { remoteAddress }, headers: {} });
    const response = () => {
      const res = {};
      res.status = sinon.stub().returns(res);
      res.json = sinon.stub().returns(res);
      return res;
    };

    it('answers a banned caller 403 and runs nothing after it', () => {
      const res = response();
      const next = sinon.stub();

      clientBans.refuseBannedCaller(request(BANNED), res, next);

      sinon.assert.notCalled(next);
      sinon.assert.calledOnceWithExactly(res.status, 403);
      expect(res.json.firstCall.args[0]).to.deep.equal({
        status: 'error',
        data: { code: 403, name: 'Forbidden', message: 'App messages from this address are not accepted' },
      });
    });

    it('passes any other caller on', () => {
      const res = response();
      const next = sinon.stub();

      clientBans.refuseBannedCaller(request(STRANGER), res, next);

      sinon.assert.calledOnce(next);
      sinon.assert.notCalled(res.status);
    });
  });
});
