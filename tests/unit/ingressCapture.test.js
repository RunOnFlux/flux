'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

// Answers get() and has() the way node-config does, so a key the stub does not
// name reads as it would on a node rather than as undefined.
const production = require('../../ZelBack/config/default');

const asConfig = (obj) => {
  const step = (root, key) => String(key).split('.')
    .reduce((acc, part) => (acc == null ? undefined : acc[part]), root);
  const resolve = (key) => {
    const own = step(obj, key);
    return own === undefined ? step(production, key) : own;
  };
  return { get: resolve, has: (key) => resolve(key) !== undefined };
};

// RFC 5737 / RFC 3849 documentation ranges throughout: a fixture that carries a
// real address invites someone to treat it as one.
const FDM = '192.0.2.10';
const OTHER_FDM = '192.0.2.11';
const DIRECT_PEER = '192.0.2.200';
const CALLER = '198.51.100.25';
const FORGED = '203.0.113.99';
const CALLER_V6 = '2001:db8::103';

function build(fdmAddresses) {
  return proxyquire('../../ZelBack/src/services/utils/ingressCapture', {
    config: asConfig({ fdmAddresses }),
  });
}

describe('ingressCapture.resolveClientIp tests', () => {
  describe('when the peer is not a known balancer', () => {
    it('ignores a forwarding header entirely', () => {
      // Every node is reachable directly on its public port, so this header was
      // written by the caller. Believing it would let anyone name themselves.
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(DIRECT_PEER, { 'x-forwarded-for': FORGED });

      expect(result).to.deep.equal({ ip: DIRECT_PEER, source: 'socket' });
    });

    it('ignores a header that names a balancer', () => {
      // Naming a trusted address does not make the caller one.
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(DIRECT_PEER, { 'x-forwarded-for': `${FORGED}, ${FDM}` });

      expect(result).to.deep.equal({ ip: DIRECT_PEER, source: 'socket' });
    });
  });

  describe('when the peer is a known balancer', () => {
    it('takes the only entry', () => {
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': CALLER });

      expect(result).to.deep.equal({ ip: CALLER, source: 'forwarded' });
    });

    it('takes the LAST entry when the caller forged one of their own', () => {
      // The shape observed on the wire: a request sent with a fabricated
      // X-Forwarded-For arrives with that value first and the balancer's own
      // view appended after it. A caller cannot write past what the balancer
      // adds, so only the final entry comes from something we trust.
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': `${FORGED},${CALLER}` });

      expect(result).to.deep.equal({ ip: CALLER, source: 'forwarded' });
    });

    it('reads the last entry across repeated headers', () => {
      // A chain of proxies produces several header lines rather than one list.
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': [FORGED, CALLER] });

      expect(result).to.deep.equal({ ip: CALLER, source: 'forwarded' });
    });

    it('accepts any balancer in the list, not just the first', () => {
      const { resolveClientIp } = build([FDM, OTHER_FDM]);

      const result = resolveClientIp(OTHER_FDM, { 'x-forwarded-for': CALLER });

      expect(result).to.deep.equal({ ip: CALLER, source: 'forwarded' });
    });

    it('falls back to the socket when no header arrives', () => {
      // A balancer that is not forwarding is a misconfiguration, not a licence to
      // guess: the node reports what it actually saw.
      const { resolveClientIp } = build([FDM]);

      expect(resolveClientIp(FDM, {})).to.deep.equal({ ip: FDM, source: 'socket' });
    });

    it('falls back to the socket when the last entry is not an address', () => {
      // The chain cannot be read, which is not a reason to read a different part
      // of it — an earlier entry is caller-controlled.
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': `${CALLER}, notanip` });

      expect(result).to.deep.equal({ ip: FDM, source: 'socket' });
    });

    it('strips the IPv4-mapped prefix from the forwarded value', () => {
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': `::ffff:${CALLER}` });

      expect(result).to.deep.equal({ ip: CALLER, source: 'forwarded' });
    });

    it('matches a balancer arriving IPv4-mapped', () => {
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(`::ffff:${FDM}`, { 'x-forwarded-for': CALLER });

      expect(result).to.deep.equal({ ip: CALLER, source: 'forwarded' });
    });

    it('keeps a genuine IPv6 caller intact', () => {
      const { resolveClientIp } = build([FDM]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': CALLER_V6 });

      expect(result).to.deep.equal({ ip: CALLER_V6, source: 'forwarded' });
    });
  });

  describe('when the list is unusable', () => {
    it('trusts nothing when the list is empty', () => {
      const { resolveClientIp } = build([]);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': CALLER });

      expect(result).to.deep.equal({ ip: FDM, source: 'socket' });
    });

    it('trusts nothing when the list is absent', () => {
      // A release without the setting must behave as it did before it existed.
      const { resolveClientIp } = build(undefined);

      const result = resolveClientIp(FDM, { 'x-forwarded-for': CALLER });

      expect(result).to.deep.equal({ ip: FDM, source: 'socket' });
    });
  });

  describe('when there is no peer at all', () => {
    it('reports no address rather than reading the header', () => {
      const { resolveClientIp } = build([FDM]);

      expect(resolveClientIp(null, { 'x-forwarded-for': CALLER }))
        .to.deep.equal({ ip: null, source: 'socket' });
    });
  });
});
