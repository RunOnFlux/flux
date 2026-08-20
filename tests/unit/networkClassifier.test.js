const { expect } = require('chai');

const networkClassifier = require('../../ZelBack/src/services/utils/networkClassifier');

const { CLASSIFICATION, classifyNetwork, classifyPtr } = networkClassifier;

describe('networkClassifier tests', () => {
  describe('classifyPtr', () => {
    it('reads access-network vocabulary as residential', () => {
      expect(classifyPtr('n58-111-97-208.bla21.nsw.optusnet.com.au')).to.equal('residential');
      expect(classifyPtr('syn-072-132-072-095.res.spectrum.com')).to.equal('residential');
      expect(classifyPtr('ip-037-024-131-128.um08.pools.vodafone-ip.de')).to.equal('residential');
    });

    it('reads hosting vocabulary as datacenter', () => {
      expect(classifyPtr('vmi1539676.contaboserver.net')).to.equal('datacenter');
      expect(classifyPtr('ov-313f3b.infomaniak.ch')).to.equal('datacenter');
    });

    it('reads a name carrying both vocabularies as both, never as residential', () => {
      // Hetzner's own PTR does this: 'clients' matches access vocabulary while
      // 'your-server' matches hosting. Access vocabulary must never clear a
      // hosting name, so the pair is its own answer and classifyNetwork reads it
      // as a contradiction.
      expect(classifyPtr('static.63.10.201.195.clients.your-server.de')).to.equal('both');
    });

    it('reads a name carrying neither as neither, and no name as none', () => {
      expect(classifyPtr('example.com')).to.equal('neither');
      expect(classifyPtr('')).to.equal('none');
      expect(classifyPtr(null)).to.equal('none');
    });
  });

  describe('classifyNetwork verdicts', () => {
    it('is RESIDENTIAL on positive evidence with no contradiction', () => {
      const result = classifyNetwork({
        ptr: 'n58-111-97-208.bla21.nsw.optusnet.com.au',
        hosting: false,
        isp: 'SingTel Optus Pty Ltd',
        asn: 'AS4804 Microplex PTY LTD',
        uploadSpeed: 91,
        downloadSpeed: 907,
      });

      expect(result.classification).to.equal(CLASSIFICATION.RESIDENTIAL);
      expect(result.evidenceFor).to.have.lengthOf(2);
      expect(result.evidenceAgainst).to.be.empty;
    });

    it('is DATACENTER on contradiction with no positive evidence', () => {
      const result = classifyNetwork({
        ptr: 'static.63.10.201.195.clients.your-server.de',
        hosting: true,
        isp: 'Hetzner Online GmbH',
        asn: 'AS24940 Hetzner Online GmbH',
        uploadSpeed: 900,
        downloadSpeed: 950,
      });

      expect(result.classification).to.equal(CLASSIFICATION.DATACENTER);
      expect(result.evidenceFor).to.be.empty;
    });

    it('is CONFLICTED when both fire, and never RESIDENTIAL', () => {
      const result = classifyNetwork({
        ptr: 'dsl-pool-12.example.net',
        hosting: true,
        isp: 'Someone',
        asn: 'AS1 Someone',
      });

      expect(result.classification).to.equal(CLASSIFICATION.CONFLICTED);
      expect(result.evidenceFor).to.not.be.empty;
      expect(result.evidenceAgainst).to.not.be.empty;
    });

    it('is UNKNOWN when nothing is known', () => {
      const result = classifyNetwork({});

      expect(result.classification).to.equal(CLASSIFICATION.UNKNOWN);
      expect(result.evidenceFor).to.be.empty;
      expect(result.evidenceAgainst).to.be.empty;
    });

    it('is UNKNOWN, not RESIDENTIAL, when the PTR says nothing either way', () => {
      // The whole point of the four states: absence of evidence must not read as
      // evidence of a residential connection, which is what isDataCenter() does.
      const result = classifyNetwork({
        ptr: 'somehost.example.com',
        hosting: false,
        isp: 'Some Regional ISP',
        asn: 'AS64500 Some Regional ISP',
        uploadSpeed: 500,
        downloadSpeed: 500,
      });

      expect(result.classification).to.equal(CLASSIFICATION.UNKNOWN);
    });
  });

  describe('operator is read from isp/as, never from the registrant org', () => {
    it('catches Contabo through isp even when org names a reseller', () => {
      // 46.250.240.89 in the fleet: isp "Contabo Asia Private Limited",
      // org "Yorkshire Tech Limited". Reading org is why the old classifier
      // called this node residential.
      const result = classifyNetwork({
        ptr: 'vmi1539676.contaboserver.net',
        hosting: false,
        isp: 'Contabo Asia Private Limited',
        asn: 'AS141995 Contabo Asia Private Limited',
      });

      expect(result.classification).to.equal(CLASSIFICATION.DATACENTER);
      expect(result.evidenceAgainst.join(' ')).to.contain('Contabo');
    });

    it('matches the operator through the AS string alone', () => {
      const result = classifyNetwork({ asn: 'AS24940 Hetzner Online GmbH' });

      expect(result.classification).to.equal(CLASSIFICATION.DATACENTER);
    });
  });

  describe('link asymmetry', () => {
    it('never reaches a verdict on its own', () => {
      // A bench figure is a speed test's result, not a property of the link. On
      // its own it would call any node with a lopsided measurement residential,
      // and enforcement would then act on an instrument reading.
      const result = classifyNetwork({ uploadSpeed: 35, downloadSpeed: 923 });

      expect(result.classification).to.equal(CLASSIFICATION.UNKNOWN);
    });

    it('corroborates a residential verdict the real signals already reached', () => {
      // The ip-api answers are what make this a verdict rather than a guess.
      // Without them the PTR is the only thing that spoke and nothing was ever
      // asked that could contradict it, which is UNKNOWN - see the block below.
      const result = classifyNetwork({
        ptr: 'n58-111-97-208.bla21.nsw.optusnet.com.au',
        hosting: false,
        proxy: false,
        mobile: false,
        isp: 'Optus Internet',
        asn: 'AS4804 Optus',
        uploadSpeed: 35,
        downloadSpeed: 923,
      });

      expect(result.classification).to.equal(CLASSIFICATION.RESIDENTIAL);
      expect(result.evidenceFor.join(' ')).to.contain('asymmetric');
    });

    it('does not fight a contradiction', () => {
      // Hetzner nodes measure lopsided often enough that, counted as evidence,
      // one benchmark left 1,102 hosts unclassified whose PTR, registry object
      // and vendor flag all said hosting.
      const result = classifyNetwork({
        ptr: 'static.63.10.201.195.clients.your-server.de', hosting: true,
        isp: 'Hetzner Online GmbH', uploadSpeed: 183, downloadSpeed: 621,
      });

      expect(result.classification).to.equal(CLASSIFICATION.DATACENTER);
    });

    it('reads a symmetric link as no evidence at all', () => {
      // Symmetric FTTH is ordinary consumer service in France and Sweden, so it
      // must not count against residential either.
      const result = classifyNetwork({ uploadSpeed: 900, downloadSpeed: 940 });

      expect(result.classification).to.equal(CLASSIFICATION.UNKNOWN);
    });

    it('reads missing bench figures as no signal rather than a symmetric link', () => {
      const result = classifyNetwork({ uploadSpeed: 0, downloadSpeed: 0 });

      expect(result.classification).to.equal(CLASSIFICATION.UNKNOWN);
    });
  });

  describe('ip-api flags', () => {
    it('treats proxy as a contradiction', () => {
      // 92.240.66.189 - University of Latvia, flagged proxy, which the PR as
      // written would have DOSed as residential.
      const result = classifyNetwork({ proxy: true });

      expect(result.classification).to.equal(CLASSIFICATION.DATACENTER);
    });

    it('treats mobile as evidence of an access network', () => {
      const result = classifyNetwork({ mobile: true });

      expect(result.classification).to.equal(CLASSIFICATION.RESIDENTIAL);
    });
  });

  describe('a signal nobody asked for is not a signal that came back clean', () => {
    // The stats.runonflux.io fallback carries no hosting, proxy, mobile, isp or
    // asn: fluxstats never requests those fields from ip-api, and its
    // /fluxlocation endpoint projects away everything but location and org. On
    // that path every contradiction check reads undefined and passes, so a
    // datacentre host with an access-network PTR came out enforceably
    // RESIDENTIAL. Both hosts below are real, and are the entire
    // reverse-DNS-alone error row in the measurement this rule came from.
    const withoutIpApi = (ptr) => classifyNetwork({ ptr });
    const withIpApi = (ptr, extra) => classifyNetwork({
      ptr, hosting: false, proxy: false, mobile: false, isp: 'Example ISP', asn: 'AS1 Example', ...extra,
    });

    it('will not call an address residential on a PTR alone', () => {
      expect(withoutIpApi('213-44-137-57.abo.bbox.fr').classification)
        .to.equal(CLASSIFICATION.UNKNOWN);
      expect(withoutIpApi('212-83-170-245.rev.poneytelecom.eu').classification)
        .to.equal(CLASSIFICATION.UNKNOWN);
    });

    it('still calls it residential once the signals have actually been consulted', () => {
      // The same PTR, with an ip-api answer that contradicts nothing. The rule
      // is unchanged where the evidence exists; only the empty case moved.
      expect(withIpApi('213-44-137-57.abo.bbox.fr').classification)
        .to.equal(CLASSIFICATION.RESIDENTIAL);
    });

    it('reports whether the contradicting signals were gathered', () => {
      expect(withoutIpApi('213-44-137-57.abo.bbox.fr').contradictionSignalsGathered).to.equal(false);
      expect(withIpApi('213-44-137-57.abo.bbox.fr').contradictionSignalsGathered).to.equal(true);
    });

    it('counts a signal that came back false as having been asked', () => {
      // hosting: false is an answer. Only undefined is a question never put.
      const result = classifyNetwork({ ptr: '213-44-137-57.abo.bbox.fr', hosting: false });

      expect(result.contradictionSignalsGathered).to.equal(true);
      expect(result.classification).to.equal(CLASSIFICATION.RESIDENTIAL);
    });

    it('still names a datacentre without them, because that rests on what WAS found', () => {
      // DATACENTER enforces nothing and is reached by evidence present rather
      // than evidence absent, so it is unaffected.
      const result = withoutIpApi('static.63.10.201.195.clients.your-server.de');

      expect(result.classification).to.equal(CLASSIFICATION.DATACENTER);
    });
  });
});
