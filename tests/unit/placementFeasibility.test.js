const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const ipLocationTable = require('../../ZelBack/src/services/appPlacement/ipLocationTable');
const cidrUtils = require('../../ZelBack/src/services/utils/cidrUtils');

function v4Int(ip) {
  return Number(cidrUtils.parseIp(ip).value);
}

// Bahrain block + a Bulgarian block in the same /16, Hetzner's /15, and a
// German org - enough geography for every eligibility direction.
function fixtureArtifact() {
  return {
    format: 1,
    generated: '2026-07-30T00:00:00Z',
    sources: { ripencc: 'test' },
    countries: ['BH', 'BG', 'FI', 'DE'],
    continents: {
      BH: 'AS', BG: 'EU', FI: 'EU', DE: 'EU',
    },
    orgs: ['ripencc:etisalcom', 'ripencc:bg-isp', 'ripencc:hetzner', 'ripencc:de-isp'],
    regions: [],
    v4: [
      [v4Int('10.10.0.0'), v4Int('10.10.255.255'), null, 3], // DE block with no org id
      [v4Int('65.108.0.0'), v4Int('65.109.255.255'), 2, 2],
      [v4Int('80.95.16.0'), v4Int('80.95.19.255'), 1, 1],
      [v4Int('80.95.208.0'), v4Int('80.95.223.255'), 0, 0],
      [v4Int('91.20.0.0'), v4Int('91.20.255.255'), 3, 3],
    ],
    v6: [],
  };
}

const bhNodes = [
  { ip: '80.95.213.209:16127', tier: 'CUMULUS' },
  { ip: '80.95.215.209:16137', tier: 'CUMULUS' },
  { ip: '80.95.215.211:16167', tier: 'NIMBUS' },
];
const bgNode = { ip: '80.95.16.10:16127', tier: 'NIMBUS' };
const fiNodes = [
  { ip: '65.108.1.1:16127', tier: 'STRATUS' },
  { ip: '65.109.2.2:16127', tier: 'STRATUS' },
];
const deNodes = [
  { ip: '91.20.3.3:16127', tier: 'NIMBUS' },
  { ip: '10.10.4.4:16127', tier: 'CUMULUS' },
];

describe('placementFeasibility tests', () => {
  let placementFeasibility;
  let deterministicFluxListStub;
  let collateralStub;
  let totalHWStub;
  let logStub;

  beforeEach(() => {
    ipLocationTable.clear();
    deterministicFluxListStub = sinon.stub().resolves([]);
    collateralStub = sinon.stub().resolves({ txhash: 'aa'.repeat(32), txindex: 0 });
    totalHWStub = sinon.stub().returns({ cpu: 1, ram: 1000, hdd: 10 });
    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    placementFeasibility = proxyquire('../../ZelBack/src/services/appPlacement/placementFeasibility', {
      '../fluxCommunicationUtils': { deterministicFluxList: deterministicFluxListStub },
      '../generalService': { obtainNodeCollateralInformation: collateralStub },
      '../appRequirements/hwRequirements': { totalAppHWRequirements: totalHWStub },
      '../../lib/log': logStub,
    });
  });

  after(() => ipLocationTable.clear());

  describe('faultDomain', () => {
    it('keys on organisation when the table resolves one', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      expect(placementFeasibility.faultDomain('65.108.1.1')).to.equal('org:ripencc:hetzner');
      expect(placementFeasibility.faultDomain('65.109.2.2:16127')).to.equal('org:ripencc:hetzner');
    });

    it('keys on the allocation block when the range has no organisation', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      expect(placementFeasibility.faultDomain('10.10.4.4')).to.equal('blk:10.10.0.0-10.10.255.255');
    });

    it('falls back to /16 arithmetic without a table or on a gap', () => {
      expect(placementFeasibility.faultDomain('80.95.213.209:16127')).to.equal('net:80.95.0.0/16');
      ipLocationTable.setArtifact(fixtureArtifact());
      expect(placementFeasibility.faultDomain('203.0.113.7')).to.equal('net:203.0.0.0/16');
    });

    it('separates the false /16 merges the old key made', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      // same /16, different countries and orgs - distinct domains now
      expect(placementFeasibility.faultDomain('80.95.213.209'))
        .to.not.equal(placementFeasibility.faultDomain('80.95.16.10'));
    });

    it('returns null on unparseable input', () => {
      expect(placementFeasibility.faultDomain('garbage')).to.equal(null);
      expect(placementFeasibility.faultDomain(null)).to.equal(null);
    });
  });

  describe('nodeLocationMatchesGeolocation', () => {
    const bh = { continentCode: 'AS', countryCode: 'BH' };
    const fi = { continentCode: 'EU', countryCode: 'FI' };
    const de = { continentCode: 'EU', countryCode: 'DE' };

    it('accepts everything when unrestricted or location unknown', () => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, [])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, undefined)).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(null, ['acAS_BH'])).to.equal(true);
    });

    it('matches allowed entries at continent and country granularity', () => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(bh, ['acAS_BH'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['acAS_BH'])).to.equal(false);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['acEU'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(bh, ['acEU'])).to.equal(false);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['acAS_BH', 'acEU_FI'])).to.equal(true);
    });

    it('honours the _ALL variants', () => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['acALL'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['acEU_ALL'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(bh, ['acEU_ALL'])).to.equal(false);
    });

    it('matches region-granularity pins at country granularity', () => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['acEU_FI_Uusimaa'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['acEU_FI_Uusimaa'])).to.equal(false);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['acEU_FI_NONE'])).to.equal(true);
    });

    it('applies forbidden entries at resolvable granularity only', () => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['a!cEU_DE'])).to.equal(false);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['a!cEU_DE'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['a!cEU'])).to.equal(false);
      // a region-level ban cannot be proven to cover the node - do not exclude
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['a!cEU_DE_Bavaria'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['a!cEU_DE_NONE'])).to.equal(false);
    });

    it('supports the legacy aXX/bXX style', () => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(bh, ['bBH'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['bBH'])).to.equal(false);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(fi, ['aEU'])).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation(bh, ['aEU'])).to.equal(false);
    });
  });

  describe('normalizeGeolocation', () => {
    it('passes spec strings through verbatim, including legacy styles', () => {
      const { normalized, coarsened } = placementFeasibility.normalizeGeolocation(['acAS_BH', 'a!cEU_DE', 'aEU', 'bFR', '']);
      expect(normalized).to.deep.equal(['acAS_BH', 'a!cEU_DE', 'aEU', 'bFR', '']);
      expect(coarsened).to.deep.equal([]);
    });

    it('normalises structured entries, upcasing and prefixing', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      const { normalized } = placementFeasibility.normalizeGeolocation([
        { continent: 'EU' },
        { continent: 'eu', country: 'fi' },
        { country: 'BH', forbidden: true },
      ]);
      expect(normalized).to.deep.equal(['acEU', 'acEU_FI', 'a!cAS_BH']);
    });

    it('derives the continent from the table and rejects contradictions', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      expect(placementFeasibility.normalizeGeolocation([{ country: 'FI' }]).normalized).to.deep.equal(['acEU_FI']);
      expect(() => placementFeasibility.normalizeGeolocation([{ continent: 'AS', country: 'FI' }]))
        .to.throw('is in EU, not AS');
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'CZ' }]))
        .to.throw('unknown country code CZ');
    });

    it('needs an explicit continent when no table can derive it', () => {
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'CZ' }]))
        .to.throw('include continent');
      // with the continent given, an unverifiable country passes through
      expect(placementFeasibility.normalizeGeolocation([{ continent: 'EU', country: 'CZ' }]).normalized)
        .to.deep.equal(['acEU_CZ']);
    });

    it('validates region entries and flags them as coarsened', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      const { normalized, coarsened } = placementFeasibility.normalizeGeolocation([
        { country: 'FI', region: 'FI-18' },
        'acEU_FI_Uusimaa',
        'acEU_FI_ALL',
      ]);
      expect(normalized).to.deep.equal(['acEU_FI_FI-18', 'acEU_FI_Uusimaa', 'acEU_FI_ALL']);
      expect(coarsened).to.deep.equal(['acEU_FI_FI-18', 'acEU_FI_Uusimaa']);
      expect(() => placementFeasibility.normalizeGeolocation([{ region: 'FI-18' }])).to.throw('requires its country');
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'DE', region: 'FI-18' }])).to.throw('does not belong to DE');
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'FI', region: 'Uusimaa' }])).to.throw('not an ISO 3166-2');
    });

    it('rejects malformed entries', () => {
      expect(() => placementFeasibility.normalizeGeolocation([42])).to.throw('Invalid geolocation');
      expect(() => placementFeasibility.normalizeGeolocation([null])).to.throw('Invalid geolocation');
      expect(() => placementFeasibility.normalizeGeolocation([[]])).to.throw('Invalid geolocation');
      expect(() => placementFeasibility.normalizeGeolocation([{}])).to.throw('continent or country is required');
      expect(() => placementFeasibility.normalizeGeolocation([{ continent: 'XX' }])).to.throw('unknown continent code XX');
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'FIN' }])).to.throw('not an ISO 3166-1');
      expect(() => placementFeasibility.normalizeGeolocation([{ continent: 'EU', forbidden: 'yes' }])).to.throw('forbidden must be a boolean');
      expect(() => placementFeasibility.normalizeGeolocation([`ac${'X'.repeat(60)}`])).to.throw('Invalid geolocation specified');
    });
  });

  describe('appFitsTier', () => {
    it('rejects a tier whose capacity the app exceeds and accepts larger tiers', () => {
      totalHWStub.callsFake((spec, tier) => (tier === 'basic'
        ? { cpu: 4, ram: 30000, hdd: 100 }
        : { cpu: 4, ram: 20000, hdd: 100 }));
      expect(placementFeasibility.appFitsTier({}, 'CUMULUS')).to.equal(false);
      expect(placementFeasibility.appFitsTier({}, 'NIMBUS')).to.equal(true);
      expect(placementFeasibility.appFitsTier({}, 'STRATUS')).to.equal(true);
    });

    it('treats unknown tiers and unsizable specs as fitting', () => {
      expect(placementFeasibility.appFitsTier({}, 'MYSTERY')).to.equal(true);
      totalHWStub.returns({ cpu: NaN, ram: NaN, hdd: NaN });
      expect(placementFeasibility.appFitsTier({}, 'CUMULUS')).to.equal(true);
      totalHWStub.throws(new Error('boom'));
      expect(placementFeasibility.appFitsTier({}, 'CUMULUS')).to.equal(true);
    });
  });

  describe('placementFeasibility', () => {
    it('computes the Bahrain incident: one domain takes the whole instance count', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      expect(result.candidateCount).to.equal(3);
      expect(result.domainCount).to.equal(1);
      expect(result.maxPerDomain).to.equal(3);
      expect(result.placeable).to.equal(true);
      expect(result.tableAvailable).to.equal(true);
    });

    it('keeps an unrestricted app spread across many domains', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: [], instances: 3 });
      // etisalcom, bg-isp, hetzner, de-isp, and the org-less DE block
      expect(result.domainCount).to.equal(5);
      expect(result.maxPerDomain).to.equal(1);
    });

    it('raises the share only as far as shallow domains require', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      // 3 BH candidates in one domain + 1 BG candidate in another; 3 instances
      // ceil(3/2)=2 but BG can only absorb 1, so the level settles at 2 anyway;
      // with 4 instances the level must reach 3
      deterministicFluxListStub.resolves([...bhNodes, bgNode]);
      const three = await placementFeasibility.placementFeasibility({ geolocation: [], instances: 3 });
      expect(three.domainCount).to.equal(2);
      expect(three.maxPerDomain).to.equal(2);
      const four = await placementFeasibility.placementFeasibility({ geolocation: [], instances: 4 });
      expect(four.maxPerDomain).to.equal(3);
    });

    it('degrades to status quo when the table is missing', async () => {
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      // no geo narrowing possible: all nodes counted, /16 arithmetic domains
      expect(result.tableAvailable).to.equal(false);
      expect(result.candidateCount).to.equal(8);
      expect(result.domainCount).to.equal(5); // 80.95, 65.108, 65.109, 91.20, 10.10
      expect(result.maxPerDomain).to.equal(1);
    });

    it('excludes nodes whose tier cannot hold the app', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      totalHWStub.callsFake((spec, tier) => (tier === 'basic'
        ? { cpu: 40, ram: 90000, hdd: 900 }
        : { cpu: 1, ram: 1000, hdd: 10 }));
      deterministicFluxListStub.resolves([...bhNodes, bgNode]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: [], instances: 3 });
      // the two CUMULUS Bahrain nodes drop out
      expect(result.candidateCount).to.equal(2);
      expect(result.domainCount).to.equal(2);
    });

    it('reports unplaceable when no candidate matches', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      expect(result.candidateCount).to.equal(0);
      expect(result.domainCount).to.equal(0);
      expect(result.placeable).to.equal(false);
    });
  });

  describe('countHeldInDomain', () => {
    it('counts locations by fault domain from socket addresses', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      const locations = [
        { ip: '80.95.215.211:16167' },
        { ip: '80.95.213.209:16127' },
        { ip: '80.95.16.10:16127' },
        { ip: '65.108.1.1:16127' },
      ];
      const bhDomain = placementFeasibility.faultDomain('80.95.213.209');
      expect(placementFeasibility.countHeldInDomain(locations, bhDomain)).to.equal(2);
      expect(placementFeasibility.countHeldInDomain([], bhDomain)).to.equal(0);
      expect(placementFeasibility.countHeldInDomain(locations, null)).to.equal(0);
    });
  });

  describe('placementCategory', () => {
    it('grades impossible, constrained and ok placements', () => {
      expect(placementFeasibility.placementCategory({ candidateCount: 2, domainCount: 2, instances: 3 }, true)).to.equal('impossible');
      expect(placementFeasibility.placementCategory({ candidateCount: 3, domainCount: 1, instances: 3 }, true)).to.equal('constrained');
      expect(placementFeasibility.placementCategory({ candidateCount: 3, domainCount: 3, instances: 3 }, true)).to.equal('ok');
      // diversity only constrains synced apps
      expect(placementFeasibility.placementCategory({ candidateCount: 3, domainCount: 1, instances: 3 }, false)).to.equal('ok');
      // impossible outranks constrained, and applies to non-synced apps too
      expect(placementFeasibility.placementCategory({ candidateCount: 1, domainCount: 1, instances: 3 }, false)).to.equal('impossible');
    });
  });

  describe('checkPlacementFeasibility', () => {
    const syncedBahrainSpec = {
      name: 'wordpressLike',
      version: 7,
      instances: 3,
      geolocation: ['acAS_BH'],
      compose: [{ name: 'wp', containerData: 'r:/var/www/html' }],
    };

    it('warns when a synced app spans fewer domains than instances and returns the feasibility', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes]);
      const result = await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller');
      expect(result.domainCount).to.equal(1);
      const warned = logStub.warn.args.some((a) => typeof a[0] === 'string'
        && a[0].includes('testCaller') && a[0].includes('will co-locate'));
      expect(warned).to.equal(true);
    });

    it('rejects a spec with fewer eligible nodes than instances', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...fiNodes]);
      await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller').then(
        () => { throw new Error('expected rejection'); },
        (error) => {
          expect(error.message).to.include('only 0 eligible nodes');
          expect(error.message).to.include('Widen the allowed locations');
        },
      );
    });

    it('rejects an impossible non-synced spec too', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...fiNodes]);
      await placementFeasibility.checkPlacementFeasibility({
        name: 'plain', version: 7, instances: 3, geolocation: ['acAS_BH'], compose: [{ containerData: '/data' }],
      }, 'testCaller').then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.message).to.include('eligible nodes'),
      );
    });

    it('accepts non-synced and unconstrained placements without warning', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes, ...deNodes, bgNode]);
      const nonSynced = await placementFeasibility.checkPlacementFeasibility({
        name: 'plain', version: 7, instances: 3, geolocation: ['acAS_BH'], compose: [{ containerData: '/data' }],
      }, 'testCaller');
      expect(nonSynced.candidateCount).to.equal(3);
      const spread = await placementFeasibility.checkPlacementFeasibility({
        ...syncedBahrainSpec, geolocation: [],
      }, 'testCaller');
      expect(spread.domainCount).to.be.greaterThan(2);
      expect(logStub.warn.called).to.equal(false);
    });

    it('a failed computation logs and returns null - only proven impossibility rejects', async () => {
      deterministicFluxListStub.rejects(new Error('state not ready'));
      const result = await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller');
      expect(result).to.equal(null);
      expect(logStub.warn.args.some((a) => a[0].includes('placement feasibility check failed'))).to.equal(true);
    });
  });

  describe('placementFeasibilityAPI', () => {
    function run(body) {
      const res = { json: sinon.stub() };
      return placementFeasibility.placementFeasibilityAPI({ body }, res).then(() => res.json.firstCall.args[0]);
    }

    it('answers the deploy-form question for a constrained geography', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes]);
      const response = await run({
        instances: 3,
        geolocation: ['acAS_BH'],
        compose: [{ containerData: 'g:/data' }],
      });
      expect(response.status).to.equal('success');
      expect(response.data.domainCount).to.equal(1);
      expect(response.data.maxPerDomain).to.equal(3);
      expect(response.data.syncedApp).to.equal(true);
      expect(response.data.constrained).to.equal(true);
      expect(response.data.satisfiable).to.equal(true);
    });

    it('reports an unsatisfiable request', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([bhNodes[0]]);
      const response = await run({ instances: 3, geolocation: ['acAS_BH'] });
      expect(response.data.satisfiable).to.equal(false);
      expect(response.data.category).to.equal('impossible');
    });

    it('treats a non-synced compose as unconstrained', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes]);
      const response = await run({
        instances: 3,
        geolocation: ['acAS_BH'],
        compose: [{ containerData: '/data' }],
      });
      expect(response.data.syncedApp).to.equal(false);
      expect(response.data.constrained).to.equal(false);
    });

    it('rejects invalid instances and geolocation input', async () => {
      const bad = await run({ instances: 'lots' });
      expect(bad.status).to.equal('error');
      const tooMany = await run({ instances: 101 });
      expect(tooMany.status).to.equal('error');
      const badGeo = await run({ instances: 3, geolocation: [42] });
      expect(badGeo.status).to.equal('error');
    });
  });

  describe('placementAdvice', () => {
    it('evaluates structured entries and echoes the normalised spec strings', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes]);
      const advice = await placementFeasibility.placementAdvice({
        instances: 3,
        geolocation: ['acAS_BH', { continent: 'EU', country: 'FI', forbidden: true }],
        compose: [{ containerData: 'g:/data' }],
      });
      expect(advice.normalizedGeolocation).to.deep.equal(['acAS_BH', 'a!cEU_FI']);
      expect(advice.candidateCount).to.equal(3);
      expect(advice.domainCount).to.equal(1);
      expect(advice.syncedApp).to.equal(true);
      expect(advice.constrained).to.equal(true);
      expect(advice.category).to.equal('constrained');
      expect(advice.coarsenedEntries).to.deep.equal([]);
    });

    it('narrows candidates by compose sizing', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      totalHWStub.callsFake((spec) => {
        if (spec.version <= 3) return { cpu: spec.cpu, ram: spec.ram, hdd: spec.hdd };
        let cpu = 0; let ram = 0; let hdd = 0;
        (spec.compose ?? []).forEach((component) => { cpu += component.cpu; ram += component.ram; hdd += component.hdd; });
        return { cpu, ram, hdd };
      });
      deterministicFluxListStub.resolves([...bhNodes, bgNode]);
      const advice = await placementFeasibility.placementAdvice({
        instances: 3,
        geolocation: [],
        compose: [{ containerData: 'g:/data', cpu: 4, ram: 4000, hdd: 50 }],
      });
      // the two CUMULUS Bahrain nodes cannot hold 4 cores
      expect(advice.candidateCount).to.equal(2);
      expect(advice.domainCount).to.equal(2);
    });

    it('narrows candidates by top-level sizing for containerData bodies', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      totalHWStub.callsFake((spec) => (spec.version <= 3
        ? { cpu: spec.cpu, ram: spec.ram, hdd: spec.hdd }
        : { cpu: 1, ram: 1000, hdd: 10 }));
      deterministicFluxListStub.resolves([...bhNodes, bgNode]);
      const advice = await placementFeasibility.placementAdvice({
        instances: 3,
        geolocation: [],
        containerData: 'g:/data',
        cpu: 4,
        ram: 4000,
        hdd: 50,
      });
      expect(advice.candidateCount).to.equal(2);
    });

    it('accepts the v9 placement shape and echoes the normalised spec strings', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes]);
      const advice = await placementFeasibility.placementAdvice({
        instances: 3,
        geoAllow: [{ continent: 'AS', country: 'BH' }],
        geoDeny: [{ country: 'FI' }],
        compose: [{ containerData: 'g:/data' }],
      });
      expect(advice.normalizedGeolocation).to.deep.equal(['acAS_BH', 'a!cEU_FI']);
      expect(advice.candidateCount).to.equal(3);
      expect(advice.domainCount).to.equal(1);
    });

    it('rejects mixing the flat and placement geolocation shapes', async () => {
      const mixed = placementFeasibility.placementAdvice({
        instances: 3,
        geolocation: ['acEU'],
        geoAllow: [{ continent: 'EU' }],
      });
      await mixed.then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.message).to.include('not both'),
      );
      const forbiddenInside = placementFeasibility.placementAdvice({
        instances: 3,
        geoAllow: [{ continent: 'EU', forbidden: true }],
      });
      await forbiddenInside.then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.message).to.include('Invalid geoAllow'),
      );
    });

    it('rejects invalid sizing and oversized geolocation lists', async () => {
      const rejects = async (body, message) => {
        try {
          await placementFeasibility.placementAdvice(body);
          throw new Error('expected rejection');
        } catch (error) {
          expect(error.message).to.include(message);
        }
      };
      await rejects({ instances: 3, compose: [{ cpu: 'lots' }] }, 'Invalid component 0 cpu');
      await rejects({ instances: 3, cpu: -1 }, 'Invalid cpu');
      await rejects({ instances: 3, compose: ['nope'] }, 'Invalid compose component');
      await rejects({ instances: 3, geolocation: Array(11).fill('acEU') }, 'Invalid geolocation');
      await rejects({ instances: 0 }, 'Invalid instances');
    });
  });

  describe('placementLocations', () => {
    it('builds the continent/country tree with domains and tier mixes', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes, { ip: '203.0.113.7:16127', tier: 'CUMULUS' }]);
      const locations = await placementFeasibility.placementLocations();
      expect(locations.tableAvailable).to.equal(true);
      expect(locations.tableGenerated).to.equal('2026-07-30T00:00:00Z');
      expect(locations.total).to.deep.equal({ nodes: 9, domains: 6 });
      expect(locations.unresolved).to.equal(1);
      expect(locations.continents.AS.countries.BH).to.deep.equal({ nodes: 3, domains: 1, tiers: { CUMULUS: 2, NIMBUS: 1 } });
      expect(locations.continents.EU.nodes).to.equal(5);
      expect(locations.continents.EU.domains).to.equal(4);
      expect(locations.continents.EU.countries.FI).to.deep.equal({ nodes: 2, domains: 1, tiers: { STRATUS: 2 } });
      expect(locations.continents.EU.countries.DE).to.deep.equal({ nodes: 2, domains: 2, tiers: { NIMBUS: 1, CUMULUS: 1 } });
    });

    it('serves totals only when no table is loaded', async () => {
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const locations = await placementFeasibility.placementLocations();
      expect(locations.tableAvailable).to.equal(false);
      expect(locations.total).to.deep.equal({ nodes: 8, domains: 5 });
      expect(locations.unresolved).to.equal(8);
      expect(locations.continents).to.deep.equal({});
    });
  });

  describe('isNodePinnedHere', () => {
    it('recognises a socket address pin', async () => {
      const pinned = await placementFeasibility.isNodePinnedHere(
        { nodes: ['1.2.3.4:16127', '80.95.213.209:16127'] },
        '80.95.213.209:16127',
      );
      expect(pinned).to.equal(true);
    });

    it('recognises a collateral outpoint pin', async () => {
      const pinned = await placementFeasibility.isNodePinnedHere(
        { nodes: [`${'aa'.repeat(32)}:0`] },
        '80.95.213.209:16127',
      );
      expect(pinned).to.equal(true);
    });

    it('is false without a pin list, on no match, or when collateral is unavailable', async () => {
      expect(await placementFeasibility.isNodePinnedHere({ nodes: [] }, '1.2.3.4:16127')).to.equal(false);
      expect(await placementFeasibility.isNodePinnedHere({}, '1.2.3.4:16127')).to.equal(false);
      expect(await placementFeasibility.isNodePinnedHere({ nodes: ['9.9.9.9:16127'] }, '1.2.3.4:16127')).to.equal(false);
      collateralStub.rejects(new Error('daemon unavailable'));
      expect(await placementFeasibility.isNodePinnedHere({ nodes: ['9.9.9.9:16127'] }, '1.2.3.4:16127')).to.equal(false);
    });
  });
});
