const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const ingressCapture = require('../../ZelBack/src/services/utils/ingressCapture');
const policyStore = require('../../ZelBack/src/services/policyStore');

const BALANCER = '10.20.0.2';
const APPSMONITOR = '37.59.187.37';
const TODAY = '2026-11-01';

describe('unpaidAllowances tests', () => {
  let document;
  let seq;
  let logError;
  let unpaidAllowances;

  const submitter = (fields = {}) => ({
    value: `${APPSMONITOR}/32`, cap: 100, reason: 'renews every customer\'s subscription', added: '2026-11-01', expires: '2027-01-30', ...fields,
  });
  const policy = (fields = {}) => ({
    clientTagCap: 20, originKeyCap: 100, submitters: [submitter()], ...fields,
  });
  const caller = (ip) => ({ remoteAddress: ip, headers: {} });
  const behindBalancer = (ip) => ({ remoteAddress: BALANCER, headers: { 'x-forwarded-for': ip } });

  beforeEach(() => {
    document = null;
    seq = 1;
    logError = sinon.stub();
    sinon.useFakeTimers({ now: Date.parse(`${TODAY}T12:00:00Z`), toFake: ['Date'] });
    unpaidAllowances = proxyquire('../../ZelBack/src/services/utils/unpaidAllowances', {
      config: { fluxapps: { clientTagCap: 20, originKeyCap: 100 } },
      '../../lib/log': { error: logError },
      '../policyStore': { getDocument: (name) => (name === 'unpaidallowances' ? document : null), getSeq: () => seq },
      './ingressCapture': {
        resolveClientIp: (remoteAddress, headers) => (remoteAddress === BALANCER && headers['x-forwarded-for']
          ? { ip: headers['x-forwarded-for'], source: 'header' }
          : { ip: remoteAddress, source: 'socket' }),
        isTrustedBalancer: (ip) => ip === BALANCER,
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should stub only names the real modules export', () => {
    expect(policyStore.getDocument).to.be.a('function');
    expect(policyStore.getSeq).to.be.a('function');
    expect(ingressCapture.resolveClientIp).to.be.a('function');
    expect(ingressCapture.isTrustedBalancer).to.be.a('function');
  });

  describe('allowances', () => {
    it('uses the release defaults, granting no submitter anything, while the node holds no document', () => {
      expect(unpaidAllowances.allowances()).to.deep.include({ clientTagCap: 20, originKeyCap: 100, largestClientCap: 20 });
      expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(null);
      sinon.assert.notCalled(logError);
    });

    it('takes both caps from the document, and the largest a submitter range grants', () => {
      document = policy({ clientTagCap: 15, originKeyCap: 90, submitters: [submitter({ cap: 40 }), submitter({ value: '203.0.113.0/24', cap: 60 })] });

      expect(unpaidAllowances.allowances()).to.deep.include({ clientTagCap: 15, originKeyCap: 90, largestClientCap: 60 });
    });

    [
      ['an array', []],
      ['a client cap that is not a positive whole number', policy({ clientTagCap: 2.5 })],
      ['an operator cap below the client cap', policy({ clientTagCap: 30, originKeyCap: 20, submitters: [] })],
      ['no submitter list', policy({ submitters: undefined })],
      ['a submitter cap below the client cap', policy({ submitters: [submitter({ cap: 10 })] })],
      ['a submitter cap above the operator cap', policy({ submitters: [submitter({ cap: 101 })] })],
      ['a submitter with no end date', policy({ submitters: [submitter({ expires: undefined })] })],
      ['a submitter range that is not text', policy({ submitters: [submitter({ value: 37 })] })],
    ].forEach(([label, malformed]) => {
      it(`uses the release defaults for a document with ${label}, and says so once`, () => {
        document = malformed;

        expect(unpaidAllowances.allowances()).to.deep.include({ clientTagCap: 20, originKeyCap: 100, largestClientCap: 20 });
        expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(null);
        sinon.assert.calledOnce(logError);
      });
    });

    it('reads a newly adopted bundle', () => {
      document = policy({ clientTagCap: 15 });
      expect(unpaidAllowances.allowances().clientTagCap).to.equal(15);

      document = policy({ clientTagCap: 25 });
      seq = 2;

      expect(unpaidAllowances.allowances().clientTagCap).to.equal(25);
    });
  });

  describe('submitterCap', () => {
    it('grants a caller in a submitter range that range\'s cap, and nobody else anything', () => {
      document = policy();

      expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(100);
      expect(unpaidAllowances.submitterCap(caller('37.59.187.38'))).to.equal(null);
    });

    it('grants the caller a balancer forwarded, and never the balancer itself', () => {
      document = policy({ submitters: [submitter(), submitter({ value: `${BALANCER}/32`, cap: 50 })] });

      expect(unpaidAllowances.submitterCap(behindBalancer(APPSMONITOR))).to.equal(100);
      expect(unpaidAllowances.submitterCap(caller(BALANCER))).to.equal(null);
    });

    it('matches every address in an IPv6 range, and none outside it', () => {
      document = policy({ submitters: [submitter({ value: '2001:db8:71:1::/64', cap: 40 })] });

      expect(unpaidAllowances.submitterCap(caller('2001:db8:71:1::99'))).to.equal(40);
      expect(unpaidAllowances.submitterCap(caller('2001:db8:71:2::1'))).to.equal(null);
    });

    it('grants the larger cap where two ranges hold the caller', () => {
      document = policy({ submitters: [submitter({ value: '37.59.187.0/24', cap: 30 }), submitter({ cap: 80 })] });

      expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(80);
    });

    it('holds an entry in force through the day it expires, and not after', () => {
      document = policy({ submitters: [submitter({ expires: TODAY })] });
      expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(100);

      document = policy({ submitters: [submitter({ expires: '2026-10-31' })] });
      seq = 2;
      expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(null);
      expect(unpaidAllowances.allowances().largestClientCap).to.equal(20);
    });

    it('grants nothing to a range wider than the policy floors, keeping the rest, and says so', () => {
      document = policy({ submitters: [submitter({ value: '0.0.0.0/0', cap: 90 }), submitter({ value: '37.59.0.0/16', cap: 80 }), submitter({ cap: 40 })] });

      expect(unpaidAllowances.submitterCap(caller('198.51.100.25'))).to.equal(null);
      expect(unpaidAllowances.submitterCap(caller('37.59.1.1'))).to.equal(null);
      expect(unpaidAllowances.submitterCap(caller(APPSMONITOR))).to.equal(40);
      expect(unpaidAllowances.allowances().largestClientCap).to.equal(40);
      sinon.assert.calledTwice(logError);
    });

    it('skips a range it cannot read, keeping the rest', () => {
      document = policy({ submitters: [submitter({ value: 'not-a-range', cap: 90 }), submitter({ value: '203.0.113.0/24', cap: 30 })] });

      expect(unpaidAllowances.submitterCap(caller('203.0.113.9'))).to.equal(30);
      expect(unpaidAllowances.allowances().largestClientCap).to.equal(30);
    });
  });
});
