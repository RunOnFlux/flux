const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/cpuThrottleExemption';

const PREFIXES = ['enshrouded', 'palworld', 'rustserver', 'rustserveroxide', 'eurotrucksimulator2', '7daystodie'];

// A fixed clock, so a timestamp "in the future" means the same thing on every run.
const NOW = Date.UTC(2026, 9, 17, 18, 0, 0);
const TS = String(Date.UTC(2026, 9, 16, 18, 56, 43, 381));

function load(document) {
  const log = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
  const policyStore = { getDocument: sinon.stub().returns(document) };
  return { module: proxyquire(MODULE_PATH, { '../policyStore': policyStore, '../../lib/log': log }), log, policyStore };
}

describe('cpuThrottleExemption', () => {
  afterEach(() => sinon.restore());

  describe('when the policy is unknown', () => {
    it('exempts nothing, so the throttle keeps its current behaviour', () => {
      const { module: m } = load(null);
      expect(m.getExemptPrefixes()).to.equal(null);
      expect(m.isCpuThrottleExempt(`enshrouded${TS}`, NOW)).to.equal(false);
    });
  });

  describe('when the document is malformed', () => {
    it('exempts nothing and says so, rather than trusting part of it', () => {
      const { module: m, log } = load(['enshrouded', 'Palworld']);
      expect(m.getExemptPrefixes()).to.equal(null);
      expect(m.isCpuThrottleExempt(`enshrouded${TS}`, NOW)).to.equal(false);
      expect(log.error.called).to.equal(true);
    });

    it('rejects a document that is not an array', () => {
      const { module: m } = load({ enshrouded: true });
      expect(m.getExemptPrefixes()).to.equal(null);
    });
  });

  describe('when the bundle carries the document', () => {
    it('exempts a hub game server: a listed prefix followed by its timestamp', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt(`enshrouded${TS}`, NOW)).to.equal(true);
      expect(m.isCpuThrottleExempt(`palworld${TS}`, NOW)).to.equal(true);
    });

    it('compares case-insensitively, as app names are', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt(`PalWorld${TS}`, NOW)).to.equal(true);
    });

    it('reads a prefix that itself ends in a digit unambiguously', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt(`eurotrucksimulator2${TS}`, NOW)).to.equal(true);
      expect(m.isCpuThrottleExempt(`7daystodie${TS}`, NOW)).to.equal(true);
    });

    it('matches the whole prefix, so one prefix never claims another product', () => {
      const { module: m } = load(['rustserver']);
      expect(m.isCpuThrottleExempt(`rustserver${TS}`, NOW)).to.equal(true);
      expect(m.isCpuThrottleExempt(`rustserveroxide${TS}`, NOW)).to.equal(false);
    });

    it('does not exempt the prefix alone, or a name the hub did not mint', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt('enshrouded', NOW)).to.equal(false);
      expect(m.isCpuThrottleExempt('enshroudedserver', NOW)).to.equal(false);
      expect(m.isCpuThrottleExempt(`enshrouded${TS}x`, NOW)).to.equal(false);
      expect(m.isCpuThrottleExempt(`enshrouded_${TS}`, NOW)).to.equal(false);
      expect(m.isCpuThrottleExempt(`myenshrouded${TS}`, NOW)).to.equal(false);
    });

    it('does not exempt a prefix the document does not list', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt(`wordpress${TS}`, NOW)).to.equal(false);
    });

    it('requires a plausible timestamp, not just thirteen digits', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt('enshrouded0000000000000', NOW), 'before the hub existed').to.equal(false);
      expect(m.isCpuThrottleExempt('enshrouded9999999999999', NOW), 'centuries ahead').to.equal(false);
      expect(m.isCpuThrottleExempt(`enshrouded${NOW + 2 * 24 * 60 * 60 * 1000}`, NOW), 'two days ahead').to.equal(false);
    });

    it('tolerates a browser clock running a little ahead of the node', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt(`enshrouded${NOW + 60 * 60 * 1000}`, NOW)).to.equal(true);
    });

    it('answers false for anything that is not a name', () => {
      const { module: m } = load(PREFIXES);
      expect(m.isCpuThrottleExempt(undefined, NOW)).to.equal(false);
      expect(m.isCpuThrottleExempt(null, NOW)).to.equal(false);
      expect(m.isCpuThrottleExempt(1792177003381, NOW)).to.equal(false);
    });

    it('treats an empty list as known, with nothing exempt', () => {
      const { module: m } = load([]);
      expect(m.getExemptPrefixes()).to.deep.equal(new Set());
      expect(m.isCpuThrottleExempt(`enshrouded${TS}`, NOW)).to.equal(false);
    });

    it('rebuilds the set only when the store adopts a new bundle', () => {
      const document = [...PREFIXES];
      const { module: m, policyStore } = load(document);
      const first = m.getExemptPrefixes();
      expect(m.getExemptPrefixes()).to.equal(first);

      policyStore.getDocument.returns(['valheim']);
      const second = m.getExemptPrefixes();
      expect(second).to.not.equal(first);
      expect(m.isCpuThrottleExempt(`valheim${TS}`, NOW)).to.equal(true);
      expect(m.isCpuThrottleExempt(`enshrouded${TS}`, NOW)).to.equal(false);
    });
  });
});
