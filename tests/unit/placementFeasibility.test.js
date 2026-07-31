const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const cidrUtils = require('../../ZelBack/src/services/utils/cidrUtils');

function v4Int(ip) {
  return Number(cidrUtils.parseIp(ip).value);
}

const GENERATED = '2026-07-30T00:00:00Z';
const CONTINENTS = {
  BH: 'AS', BG: 'EU', FI: 'EU', DE: 'EU',
};

// Bahrain block + a Bulgarian block in the same /16, Hetzner's /15, a German
// org, and a German block with no organisation - enough geography for every
// eligibility direction and every rung of the fault-domain ladder.
const RANGES = [
  {
    start: '10.10.0.0', end: '10.10.255.255', o: null, c: 'DE',
  },
  {
    start: '65.108.0.0', end: '65.109.255.255', o: 'hetzner', c: 'FI', r: 'FI-11',
  },
  {
    start: '80.95.16.0', end: '80.95.19.255', o: 'bg-isp', c: 'BG',
  },
  {
    start: '80.95.208.0', end: '80.95.223.255', o: 'etisalcom', c: 'BH',
  },
  {
    start: '91.20.0.0', end: '91.20.255.255', o: 'de-isp', c: 'DE',
  },
];

function rangeFor(ip) {
  const value = v4Int(ip);
  return RANGES.find((range) => v4Int(range.start) <= value && value <= v4Int(range.end)) ?? null;
}

/** What ipLocationStore.lookup resolves for an address. */
function storeLookup(ip) {
  const range = rangeFor(ip);
  if (!range) return null;
  return {
    org: range.o,
    // no allocation means no block: the /16 rung applies instead
    block: range.o === null ? null : { start: v4Int(range.start), end: v4Int(range.end) },
    countryCode: range.c,
    continentCode: CONTINENTS[range.c],
    region: null,
  };
}

/** The nodelocations document the store's refresh pass writes for an address. */
function locationDoc(ip) {
  const range = rangeFor(ip);
  return {
    _id: ip,
    o: range?.o ?? null,
    bs: range?.o ? v4Int(range.start) : null,
    be: range?.o ? v4Int(range.end) : null,
    c: range?.c ?? null,
    n: range ? CONTINENTS[range.c] : null,
    r: range?.r ?? null,
    g: GENERATED,
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
const unresolvedNode = { ip: '203.0.113.7:16127', tier: 'CUMULUS' };

// every address any test puts in the node list; the view carries a document per
// node, exactly as the store's refresh pass leaves it
const VIEWED_IPS = [...bhNodes, bgNode, ...fiNodes, ...deNodes, unresolvedNode]
  .map((node) => node.ip.split(':')[0]);

describe('placementFeasibility tests', () => {
  let placementFeasibility;
  let deterministicFluxListStub;
  let collateralStub;
  let totalHWStub;
  let storeStub;
  let logStub;

  // The node holds the fixture baseline: the status is ready and the node
  // location view carries a document for every fixture address.
  function useTable() {
    storeStub.status.returns({ ready: true, generated: GENERATED, rowCount: RANGES.length });
    storeStub.continentForCountry.callsFake((country) => CONTINENTS[country] ?? null);
    storeStub.getNodeLocations.resolves(VIEWED_IPS.map(locationDoc));
  }

  beforeEach(() => {
    deterministicFluxListStub = sinon.stub().resolves([]);
    collateralStub = sinon.stub().resolves({ txhash: 'aa'.repeat(32), txindex: 0 });
    totalHWStub = sinon.stub().returns({ cpu: 1, ram: 1000, hdd: 10 });
    logStub = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
    storeStub = {
      status: sinon.stub().returns({ ready: false, generated: null, rowCount: 0 }),
      continentForCountry: sinon.stub().returns(null),
      getNodeLocations: sinon.stub().resolves([]),
      lookup: sinon.stub().callsFake(async (ip) => storeLookup(ip)),
    };
    placementFeasibility = proxyquire('../../ZelBack/src/services/appPlacement/placementFeasibility', {
      '../fluxCommunicationUtils': { deterministicFluxList: deterministicFluxListStub },
      '../generalService': { obtainNodeCollateralInformation: collateralStub },
      '../appRequirements/hwRequirements': { totalAppHWRequirements: totalHWStub },
      './ipLocationStore': storeStub,
      '../../lib/log': logStub,
    });
  });

  describe('faultDomain', () => {
    it('keys on organisation when the table resolves one', async () => {
      expect(await placementFeasibility.faultDomain('65.108.1.1')).to.equal('org:hetzner');
      expect(await placementFeasibility.faultDomain('65.109.2.2:16127')).to.equal('org:hetzner');
    });

    it('falls to /16 when the covering range has no organisation - no allocation, no block rung', async () => {
      expect(await placementFeasibility.faultDomain('10.10.4.4')).to.equal('net:10.10.0.0/16');
    });

    it('falls back to /16 arithmetic on a gap in the table', async () => {
      expect(await placementFeasibility.faultDomain('203.0.113.7')).to.equal('net:203.0.0.0/16');
    });

    it('separates the false /16 merges the old key made', async () => {
      // same /16, different countries and orgs - distinct domains now
      expect(await placementFeasibility.faultDomain('80.95.213.209'))
        .to.not.equal(await placementFeasibility.faultDomain('80.95.16.10'));
    });

    it('returns null on unparseable input', async () => {
      expect(await placementFeasibility.faultDomain('garbage')).to.equal(null);
      expect(await placementFeasibility.faultDomain(null)).to.equal(null);
    });

    // the degrade contract: a store that cannot be read is the same placement
    // decision as no table, never the absence of a domain
    it('falls back to /16 when the store cannot be read', async () => {
      const unavailable = new Error('connection reset');
      unavailable.code = 'IPLOCATION_STORE_UNAVAILABLE';
      storeStub.lookup.rejects(unavailable);
      expect(await placementFeasibility.faultDomain('65.108.1.1')).to.equal('net:65.108.0.0/16');
    });
  });

  describe('the computation domain function', () => {
    async function domainOf(address, nodes = [...bhNodes, ...deNodes, unresolvedNode]) {
      useTable();
      deterministicFluxListStub.resolves(nodes);
      const { domainOf: fromSnapshot } = await placementFeasibility.placementComputation({ instances: 1 }, 1);
      return fromSnapshot(address);
    }

    it('keys on the organisation the view carries', async () => {
      expect(await domainOf('80.95.213.209:16127')).to.equal('org:etisalcom');
    });

    it('keys on the allocation block when a document carries one without an organisation', async () => {
      useTable();
      storeStub.getNodeLocations.resolves([{
        _id: '80.95.213.209', o: null, bs: v4Int('80.95.208.0'), be: v4Int('80.95.223.255'), c: 'BH', n: 'AS', r: null, g: GENERATED,
      }]);
      deterministicFluxListStub.resolves([...bhNodes]);
      const { domainOf: fromSnapshot } = await placementFeasibility.placementComputation({ instances: 1 }, 1);
      expect(fromSnapshot('80.95.213.209:16127')).to.equal(`blk:${v4Int('80.95.208.0')}-${v4Int('80.95.223.255')}`);
    });

    it('falls to /16 for a document with neither, and for an address the view does not carry', async () => {
      expect(await domainOf('10.10.4.4:16127')).to.equal('net:10.10.0.0/16');
      expect(await domainOf('198.51.100.9:16127')).to.equal('net:198.51.0.0/16');
    });

    it('reads the view once, however many addresses are keyed', async () => {
      useTable();
      deterministicFluxListStub.resolves([...bhNodes, ...deNodes]);
      const { domainOf: fromSnapshot } = await placementFeasibility.placementComputation({ instances: 1 }, 1);
      [...bhNodes, ...deNodes].forEach((node) => fromSnapshot(node.ip));
      expect(storeStub.getNodeLocations.callCount).to.equal(1);
      expect(storeStub.lookup.called).to.equal(false);
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
      useTable();
      const { normalized } = placementFeasibility.normalizeGeolocation([
        { continent: 'EU' },
        { continent: 'eu', country: 'fi' },
        { country: 'BH', forbidden: true },
      ]);
      expect(normalized).to.deep.equal(['acEU', 'acEU_FI', 'a!cAS_BH']);
    });

    it('derives the continent from the table and rejects contradictions', () => {
      useTable();
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

    it('emits table-vocabulary regions and coarsens only legacy-shaped parts', () => {
      useTable();
      const { normalized, coarsened } = placementFeasibility.normalizeGeolocation([
        { country: 'FI', region: 'FI-18' },
        'acEU_FI_Uusimaa',
        'acEU_FI_ALL',
        'a!cNA_US_US-HI',
      ]);
      // the ISO region IS emitted - placement and the installer both resolve
      // it through the published table; only legacy-shaped parts (ip-api
      // names) are answered at country granularity and reported as coarsened
      expect(normalized).to.deep.equal(['acEU_FI_FI-18', 'acEU_FI_Uusimaa', 'acEU_FI_ALL', 'a!cNA_US_US-HI']);
      expect(coarsened).to.deep.equal(['acEU_FI_Uusimaa']);
      expect(() => placementFeasibility.normalizeGeolocation([{ region: 'FI-18' }])).to.throw('requires its country');
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'DE', region: 'FI-18' }])).to.throw('does not belong to DE');
      expect(() => placementFeasibility.normalizeGeolocation([{ country: 'FI', region: 'Uusimaa' }])).to.throw('not an ISO 3166-2');
    });

    it('matches table-vocabulary regions at region granularity', () => {
      const matches = placementFeasibility.nodeLocationMatchesGeolocation;
      const inRegion = { continentCode: 'EU', countryCode: 'FI', region: 'FI-18' };
      const outOfRegion = { continentCode: 'EU', countryCode: 'FI', region: 'FI-11' };
      const regionUnknown = { continentCode: 'EU', countryCode: 'FI', region: null };
      // allow: strict where the node's region is known, country-granularity where not
      expect(matches(inRegion, ['acEU_FI_FI-18'])).to.equal(true);
      expect(matches(outOfRegion, ['acEU_FI_FI-18'])).to.equal(false);
      expect(matches(regionUnknown, ['acEU_FI_FI-18'])).to.equal(true);
      // deny: applies only where provable
      expect(matches(inRegion, ['acEU', 'a!cEU_FI_FI-18'])).to.equal(false);
      expect(matches(outOfRegion, ['acEU', 'a!cEU_FI_FI-18'])).to.equal(true);
      expect(matches(regionUnknown, ['acEU', 'a!cEU_FI_FI-18'])).to.equal(true);
      // legacy-shaped parts keep country granularity in both directions
      expect(matches(outOfRegion, ['acEU_FI_Uusimaa'])).to.equal(true);
      expect(matches(inRegion, ['acEU', 'a!cEU_FI_Uusimaa'])).to.equal(true);
      // _NONE is never a table region part and never widens a ban
      expect(matches(inRegion, ['acEU', 'a!cEU_FI_NONE'])).to.equal(true);
      // a region part belonging to a different country than the entry names is
      // legacy-shaped, not a table pin
      expect(matches(outOfRegion, ['acEU_FI_DE-BY'])).to.equal(true);
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
      useTable();
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      expect(result.candidateCount).to.equal(3);
      expect(result.domainCount).to.equal(1);
      expect(result.maxPerDomain).to.equal(3);
      expect(result.placeable).to.equal(true);
      expect(result.tableAvailable).to.equal(true);
      expect(result.tableGenerated).to.equal(GENERATED);
    });

    it('keeps an unrestricted app spread across many domains', async () => {
      useTable();
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: [], instances: 3 });
      // etisalcom, bg-isp, hetzner, de-isp, and the org-less DE range on /16
      expect(result.domainCount).to.equal(5);
      expect(result.maxPerDomain).to.equal(1);
    });

    it('raises the share only as far as shallow domains require', async () => {
      useTable();
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

    // The degrade contract, at the level that matters most: an unreadable store
    // must land where "no table" lands, never on a proof of impossibility.
    it('a store that cannot be read never reads as zero candidates', async () => {
      useTable();
      const unavailable = new Error('MongoServerSelectionError');
      unavailable.code = 'IPLOCATION_STORE_UNAVAILABLE';
      storeStub.getNodeLocations.rejects(unavailable);
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      expect(result.candidateCount).to.equal(8);
      expect(result.domainCount).to.equal(5);
      expect(result.placeable).to.equal(true);
      expect(result.tableAvailable).to.equal(false);
      expect(result.tableGenerated).to.equal(null);
    });

    it('counts only the pinned pool when the spec carries a nodes list', async () => {
      // a nodes list is a closed pool - counting the whole network would
      // compute a share against fault domains the app can never use
      useTable();
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
      useTable();
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
      useTable();
      deterministicFluxListStub.resolves([...fiNodes, ...deNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      expect(result.candidateCount).to.equal(0);
      expect(result.domainCount).to.equal(0);
      expect(result.placeable).to.equal(false);
    });

    it('counts a node the view does not carry - a lagging view never excludes', async () => {
      useTable();
      storeStub.getNodeLocations.resolves(VIEWED_IPS.filter((ip) => !ip.startsWith('80.95.2')).map(locationDoc));
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes]);
      const result = await placementFeasibility.placementFeasibility({ geolocation: ['acAS_BH'], instances: 3 });
      // the three Bahrain nodes have no document yet, so their location cannot
      // be disproved: they count, on /16 domains
      expect(result.candidateCount).to.equal(3);
      expect(result.domainCount).to.equal(1);
    });
  });

  describe('countHeldInDomain', () => {
    const locations = [
      { ip: '80.95.215.211:16167' },
      { ip: '80.95.213.209:16127' },
      { ip: '80.95.16.10:16127' },
      { ip: '65.108.1.1:16127' },
    ];

    it('counts locations by fault domain from socket addresses', async () => {
      const bhDomain = await placementFeasibility.faultDomain('80.95.213.209');
      expect(await placementFeasibility.countHeldInDomain(locations, bhDomain)).to.equal(2);
      expect(await placementFeasibility.countHeldInDomain([], bhDomain)).to.equal(0);
      expect(await placementFeasibility.countHeldInDomain(locations, null)).to.equal(0);
    });

    it('keys from a computation snapshot when one is passed, without a lookup each', async () => {
      useTable();
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes]);
      const { domainOf } = await placementFeasibility.placementComputation({ instances: 3 }, 3);
      storeStub.lookup.resetHistory();
      expect(await placementFeasibility.countHeldInDomain(locations, 'org:etisalcom', domainOf)).to.equal(2);
      expect(await placementFeasibility.countHeldInDomain(locations, 'org:hetzner', domainOf)).to.equal(1);
      expect(storeStub.lookup.called).to.equal(false);
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
      useTable();
      deterministicFluxListStub.resolves([...bhNodes, ...fiNodes]);
      const result = await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller');
      expect(result.domainCount).to.equal(1);
      const warned = logStub.warn.args.some((a) => typeof a[0] === 'string'
        && a[0].includes('testCaller') && a[0].includes('will co-locate'));
      expect(warned).to.equal(true);
    });

    it('rejects a spec with fewer eligible nodes than instances', async () => {
      useTable();
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
      useTable();
      deterministicFluxListStub.resolves([...fiNodes, ...deNodes]);
      const result = await placementFeasibility.checkPlacementFeasibility(syncedBahrainSpec, 'testCaller');
      expect(result.candidateCount).to.equal(0);
      expect(logStub.warn.args.some((a) => a[0].includes('may not cover it'))).to.equal(true);
    });

    it('rejects a pure table-region pin that resolves zero candidates', async () => {
      // both ends read the same table for these entries, so a total miss is
      // proof, not mistrust - registering it sells a deployment that cannot start
      useTable();
      deterministicFluxListStub.resolves([...fiNodes, ...deNodes]);
      await placementFeasibility.checkPlacementFeasibility({
        name: 'regionPinned', version: 7, instances: 2, geolocation: ['acEU_FI_FI-18'], compose: [{ containerData: 'r:/data' }],
      }, 'testCaller').then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.message).to.include('Widen the allowed locations'),
      );
    });

    it('keeps the zero-candidate allowance when any allow entry is not a region pin', async () => {
      useTable();
      deterministicFluxListStub.resolves([...fiNodes, ...deNodes]);
      const result = await placementFeasibility.checkPlacementFeasibility({
        name: 'mixedPin', version: 7, instances: 2, geolocation: ['acEU_FI_FI-18', 'acAS_BH'], compose: [{ containerData: 'r:/data' }],
      }, 'testCaller');
      expect(result.candidateCount).to.equal(0);
      expect(logStub.warn.args.some((a) => a[0].includes('may not cover it'))).to.equal(true);
    });

    it('rejects an impossible non-synced spec too', async () => {
      useTable();
      deterministicFluxListStub.resolves([bhNodes[0], ...fiNodes]);
      await placementFeasibility.checkPlacementFeasibility({
        name: 'plain', version: 7, instances: 3, geolocation: ['acAS_BH'], compose: [{ containerData: '/data' }],
      }, 'testCaller').then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.message).to.include('eligible nodes'),
      );
    });

    it('accepts non-synced and unconstrained placements without warning', async () => {
      useTable();
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
      useTable();
      deterministicFluxListStub.resolves([...fiNodes]);
      const previous = { ...syncedBahrainSpec, expire: 22000 };
      const cancellation = { ...syncedBahrainSpec, expire: 1 };
      const result = await placementFeasibility.checkPlacementFeasibility(cancellation, 'testCaller', previous);
      expect(result).to.equal(null);
      expect(deterministicFluxListStub.called).to.equal(false);
    });

    it('gates an update that narrows placement', async () => {
      useTable();
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
      useTable();
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
      useTable();
      deterministicFluxListStub.resolves([bhNodes[0]]);
      const response = await run({ instances: 3, geolocation: ['acAS_BH'] });
      expect(response.data.satisfiable).to.equal(false);
      expect(response.data.category).to.equal('impossible');
    });

    it('treats a non-synced compose as unconstrained', async () => {
      useTable();
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
      useTable();
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
      useTable();
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
      useTable();
      deterministicFluxListStub.resolves([...bhNodes, bgNode, ...fiNodes, ...deNodes, unresolvedNode]);
      const locations = await placementFeasibility.placementLocations();
      expect(locations.tableAvailable).to.equal(true);
      expect(locations.tableGenerated).to.equal(GENERATED);
      expect(locations.total).to.deep.equal({ nodes: 9, domains: 6 });
      expect(locations.unresolved).to.equal(1);
      expect(locations.continents.AS.countries.BH).to.deep.equal({ nodes: 3, domains: 1, tiers: { CUMULUS: 2, NIMBUS: 1 } });
      expect(locations.continents.EU.nodes).to.equal(5);
      expect(locations.continents.EU.domains).to.equal(4);
      expect(locations.continents.EU.countries.FI).to.deep.equal({ nodes: 2, domains: 1, tiers: { STRATUS: 2 } });
      expect(locations.continents.EU.countries.DE).to.deep.equal({ nodes: 2, domains: 2, tiers: { NIMBUS: 1, CUMULUS: 1 } });
      // one pass over the view, not a lookup per node
      expect(storeStub.getNodeLocations.callCount).to.equal(1);
      expect(storeStub.lookup.called).to.equal(false);
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

    it('is unavailable when the view cannot be read', async () => {
      useTable();
      storeStub.getNodeLocations.rejects(new Error('MongoServerSelectionError'));
      deterministicFluxListStub.resolves([...bhNodes]);
      await placementFeasibility.placementLocations().then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.statusCode).to.equal(503),
      );
    });
  });

  describe('unavailable data states', () => {
    it('an empty node list is missing data, never zero candidates', async () => {
      useTable();
      deterministicFluxListStub.resolves([]);
      await placementFeasibility.placementFeasibility({ geolocation: [], instances: 3 }).then(
        () => { throw new Error('expected rejection'); },
        (error) => expect(error.statusCode).to.equal(503),
      );
    });

    it('an empty node list never rejects a registration as impossible', async () => {
      useTable();
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
