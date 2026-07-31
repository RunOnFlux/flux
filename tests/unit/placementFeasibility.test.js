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
      // _NONE is a region part: install-time compares it against the node's
      // real region name and bans nothing, so neither may this
      expect(placementFeasibility.nodeLocationMatchesGeolocation(de, ['a!cEU_DE_NONE'])).to.equal(true);
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

    it('coarsens structured region entries to their country and flags them', () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      const { normalized, coarsened } = placementFeasibility.normalizeGeolocation([
        { country: 'FI', region: 'FI-18' },
        'acEU_FI_Uusimaa',
        'acEU_FI_ALL',
      ]);
      // the ISO region is NOT emitted: install-time matching compares against
      // ip-api region names, so a spec carrying 'FI-18' would match no node
      expect(normalized).to.deep.equal(['acEU_FI', 'acEU_FI_Uusimaa', 'acEU_FI_ALL']);
      expect(coarsened).to.deep.equal(['acEU_FI', 'acEU_FI_Uusimaa']);
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


    it('counts only the pinned pool when the spec carries a nodes list', async () => {
      // a nodes list is a closed pool - counting the whole network would
      // compute a share against fault domains the app can never use
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({
        geolocation: [],
        instances: 3,
        nodes: bhNodes.map((node) => node.ip),
      });
      expect(result.candidateCount).to.equal(3);
      expect(result.domainCount).to.equal(1);
      // one domain absorbs all three - the pool converges instead of stranding
      expect(result.maxPerDomain).to.equal(3);
    });

    it('matches a pinned pool by collateral outpoint as well as socket address', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([
        { ...bhNodes[0], txhash: 'ab'.repeat(32), outidx: 0 },
        { ...fiNodes[0], txhash: 'cd'.repeat(32), outidx: 1 },
      ]);
      const result = await placementFeasibility.placementFeasibility({
        geolocation: [],
        instances: 1,
        nodes: [`${'cd'.repeat(32)}:1`],
      });
      expect(result.candidateCount).to.equal(1);
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
      deterministicFluxListStub.resolves([bhNodes[0], ...fiNodes]);
      await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller').then(
        () => { throw new Error('expected rejection'); },
        (error) => {
          expect(error.message).to.include('only 1 eligible nodes');
          expect(error.message).to.include('Widen the allowed locations');
        },
      );
    });

    it('does not reject when the geography resolves no candidate at all', async () => {
      // zero is indistinguishable from the table mis-attributing that
      // geography, and install eligibility is decided by each node's own
      // ip-api self-report - not provable, so not refusable
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...fiNodes, ...deNodes]);
      const result = await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller');
      expect(result.candidateCount).to.equal(0);
      expect(logStub.warn.args.some((a) => a[0].includes('may not cover it'))).to.equal(true);
    });

    it('rejects an impossible non-synced spec too', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([bhNodes[0], ...fiNodes]);
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

    it('never gates an update that changes nothing placement-relevant', async () => {
      // renewals and cancellations are expire-only updates; an app that is
      // already infeasible must still be renewable and cancellable
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([...fiNodes]);
      const previous = { ...syncedBahrainSpec, expire: 22000 };
      const cancellation = { ...syncedBahrainSpec, expire: 1 };
      const result = await placementFeasibility.checkPlacementFeasibility(cancellation, 'testCaller', previous);
      expect(result).to.equal(null);
      expect(deterministicFluxListStub.called).to.equal(false);
    });

    it('gates an update that narrows placement', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([bhNodes[0], ...fiNodes]);
      const previous = { ...syncedBahrainSpec, geolocation: [] };
      await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller', previous).then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.message).to.include('eligible nodes'),
      );
    });

    it('changesPlacement sees geolocation, instances and sizing, and ignores the rest', () => {
      const base = {
        version: 7, instances: 3, geolocation: ['acEU'], compose: [{ cpu: 1, ram: 100, hdd: 1 }],
      };
      const { changesPlacement } = placementFeasibility;
      expect(changesPlacement(base, { ...base, expire: 5000 })).to.equal(false);
      expect(changesPlacement(base, { ...base, geolocation: ['acEU'] })).to.equal(false);
      // order alone is not a change
      expect(changesPlacement({ ...base, geolocation: ['acEU', 'acNA'] }, { ...base, geolocation: ['acNA', 'acEU'] })).to.equal(false);
      expect(changesPlacement(base, { ...base, instances: 5 })).to.equal(true);
      expect(changesPlacement(base, { ...base, geolocation: ['acAS_BH'] })).to.equal(true);
      expect(changesPlacement(base, { ...base, compose: [{ cpu: 8, ram: 100, hdd: 1 }] })).to.equal(true);
      // no previous spec to compare against - gate it
      expect(changesPlacement(base, null)).to.equal(true);
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
      const res = { json: sinon.stub(), status: sinon.stub() };
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

    it('refuses an empty or unparsed body instead of answering about a default spec', async () => {
      const rejectsEmpty = async (body) => {
        try {
          await placementFeasibility.placementAdvice(body);
          throw new Error('expected rejection');
        } catch (error) {
          expect(error.message).to.include('Empty or unparsed request body');
        }
      };
      await rejectsEmpty({});
      await rejectsEmpty(undefined);
      await rejectsEmpty([]);
    });

    it('rejects oversized geolocation lists and bad instance counts', async () => {
      const rejects = async (body, message) => {
        try {
          await placementFeasibility.placementAdvice(body);
          throw new Error('expected rejection');
        } catch (error) {
          expect(error.message).to.include(message);
        }
      };
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

    it('is unavailable without a table - the tree is the product', async () => {
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      await placementFeasibility.placementLocations().then(
        () => { throw new Error('expected rejection'); },
        (error) => {
          expect(error.statusCode).to.equal(503);
          expect(error.message).to.include('not available yet');
        },
      );
    });
  });

  describe('unavailable data states', () => {
    it('an empty node list is missing data, never zero candidates', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([]);
      await placementFeasibility.placementFeasibility({ geolocation: [], instances: 3 }).then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.statusCode).to.equal(503),
      );
    });

    it('an empty node list never rejects a registration as impossible', async () => {
      ipLocationTable.setArtifact(fixtureArtifact());
      deterministicFluxListStub.resolves([]);
      const result = await placementFeasibility.checkPlacementFeasibility({
        name: 'bootWindow', version: 7, instances: 3, geolocation: ['acAS_BH'], compose: [{ containerData: 'g:/data' }],
      }, 'testCaller');
      expect(result).to.equal(null);
      expect(logStub.warn.args.some((a) => a[0].includes('placement feasibility check failed'))).to.equal(true);
    });

    it('geo-restricted advice without a table is unavailable, not whole-network numbers', async () => {
      deterministicFluxListStub.resolves([...bhNodes, bgNode]);
      await placementFeasibility.placementAdvice({ instances: 3, geolocation: ['acAS_BH'] }).then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.statusCode).to.equal(503),
      );
    });

    it('unrestricted advice still answers without a table', async () => {
      deterministicFluxListStub.resolves([...bhNodes, bgNode]);
      const advice = await placementFeasibility.placementAdvice({ instances: 3, geolocation: [''] });
      expect(advice.tableAvailable).to.equal(false);
      expect(advice.candidateCount).to.equal(4);
    });

    it('the API answers 503 for unavailable states', async () => {
      const res = { json: sinon.stub(), status: sinon.stub() };
      await placementFeasibility.placementFeasibilityAPI({ body: { instances: 3, geolocation: ['acAS_BH'] } }, res);
      expect(res.status.calledWith(503)).to.equal(true);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      const locationsRes = { json: sinon.stub(), status: sinon.stub() };
      await placementFeasibility.placementLocationsAPI({}, locationsRes);
      expect(locationsRes.status.calledWith(503)).to.equal(true);
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
