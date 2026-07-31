// Differential test: the candidate filter must never exclude a node the
// installer would accept.
//
// placementFeasibility.nodeLocationMatchesGeolocation decides who COUNTS as a
// candidate, and hwRequirements.checkAppGeolocationRequirements decides who may
// actually INSTALL. They are separate implementations of the same rule, over
// different data sources, and neither module's own suite owns the relationship
// between them. A candidate filter stricter than the installer under-counts,
// which drives the registration gate toward refusing deployable apps and the
// spawner toward standing down when it is the last eligible node.
//
// The asymmetry is deliberate and one-directional: over-counting is safe (the
// installer still refuses), under-counting is not. So this asserts implication,
// not equivalence - installer accepts => filter counts.

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const placementFeasibility = require('../../ZelBack/src/services/appPlacement/placementFeasibility');

// every geolocation shape the network actually carries, plus the shapes the
// spec permits but production has not exercised
const GEO_SPECS = [
  [],
  ['acEU'],
  ['acEU_FI'],
  ['acAS_BH'],
  ['acNA_US_California'],
  ['acEU_FI_Uusimaa'],
  ['acEU_FI_NONE'],
  ['acALL'],
  ['acEU_ALL'],
  ['acEU_FI_ALL'],
  ['a!cEU'],
  ['a!cEU_FI'],
  ['a!cNA_US_Hawaii'],
  ['a!cEU_DE_NONE'],
  ['acEU', 'a!cEU_RU'],
  ['acEU_FI', 'acAS_BH'],
  ['acNA', 'a!cNA_US'],
  ['aEU'],
  ['bFI'],
  ['aEU', 'bFI'],
  // the table's own region vocabulary - full ISO 3166-2
  ['acEU_FI_FI-18'],
  ['acNA_US_US-CA'],
  ['a!cEU_FI_FI-18'],
  ['a!cNA_US_US-HI'],
  ['acEU_FI_FI-18', 'acAS_BH'],
  ['acEU', 'a!cEU_FI_FI-18'],
];

// node locations spanning both sides of every boundary above. tableRegion is
// what the published table resolves for the node's address (null = the table
// carries no region there); regionName stays the ip-api self-report.
const NODE_LOCATIONS = [
  { continentCode: 'EU', countryCode: 'FI', regionName: 'Uusimaa', tableRegion: 'FI-18' },
  { continentCode: 'EU', countryCode: 'FI', regionName: 'Pirkanmaa', tableRegion: 'FI-11' },
  { continentCode: 'EU', countryCode: 'FI', regionName: 'Uusimaa', tableRegion: null },
  { continentCode: 'EU', countryCode: 'DE', regionName: 'Bavaria', tableRegion: 'DE-BY' },
  { continentCode: 'EU', countryCode: 'RU', regionName: 'Moscow', tableRegion: null },
  { continentCode: 'AS', countryCode: 'BH', regionName: 'Manama', tableRegion: 'BH-13' },
  { continentCode: 'NA', countryCode: 'US', regionName: 'California', tableRegion: 'US-CA' },
  { continentCode: 'NA', countryCode: 'US', regionName: 'Hawaii', tableRegion: 'US-HI' },
  { continentCode: 'NA', countryCode: 'CA', regionName: 'Ontario', tableRegion: 'CA-ON' },
  { continentCode: 'SA', countryCode: 'BR', regionName: 'Sao Paulo', tableRegion: null },
];

/**
 * The filter-side location for a node: what the candidate filter reads from
 * the nodelocations view. The SAME table values the installer's own lookup
 * resolves - one table, two consumers, which is the invariant under test.
 */
function filterLocation(nodeGeo) {
  return {
    continentCode: nodeGeo.continentCode,
    countryCode: nodeGeo.countryCode,
    region: nodeGeo.tableRegion ?? null,
  };
}

/**
 * Does the real install-time gate accept this node for this spec?
 * Runs the actual hwRequirements implementation with the node's geolocation
 * and its table lookup stubbed - not a reimplementation of it, which would
 * defeat the purpose. The lookup stub returns the same table values the
 * filter side sees, because on a real node they are the same table.
 */
const installerGates = new Map();

async function installerAccepts(geolocation, nodeGeo) {
  // one proxied module per node location, not per call - the stubs are fixed
  // per node and the grid re-visits each node once per spec shape
  const key = JSON.stringify(nodeGeo);
  if (!installerGates.has(key)) {
    installerGates.set(key, proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
      '../geolocationService': { getNodeGeolocation: sinon.stub().resolves({ ...nodeGeo, ip: '203.0.113.10' }) },
      '../appPlacement/ipLocationStore': {
        lookup: sinon.stub().resolves(nodeGeo.tableRegion === undefined ? null : {
          org: 'aabbccddeeff',
          block: { start: 0, end: 0 },
          countryCode: nodeGeo.countryCode,
          continentCode: nodeGeo.continentCode,
          region: nodeGeo.tableRegion,
        }),
        isStoreUnavailable: () => false,
      },
    }));
  }
  try {
    await installerGates.get(key).checkAppGeolocationRequirements({ version: 7, geolocation });
    return true;
  } catch (error) {
    return false;
  }
}

describe('placement eligibility parity with install-time geolocation', () => {
  it('counts every node the installer would accept, for every geolocation shape', async () => {
    const underCounted = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const geolocation of GEO_SPECS) {
      // eslint-disable-next-line no-restricted-syntax
      for (const nodeGeo of NODE_LOCATIONS) {
        // eslint-disable-next-line no-await-in-loop
        const accepted = await installerAccepts(geolocation, nodeGeo);
        const counted = placementFeasibility.nodeLocationMatchesGeolocation(filterLocation(nodeGeo), geolocation);
        if (accepted && !counted) {
          underCounted.push(`${JSON.stringify(geolocation)} vs ${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}/${nodeGeo.tableRegion}`);
        }
      }
    }
    expect(underCounted, `candidate filter excluded nodes the installer accepts:\n  ${underCounted.join('\n  ')}`).to.deep.equal([]);
  });

  it('does not count a node the installer refuses at a granularity the table resolves', async () => {
    // The reverse direction is allowed to differ ONLY where the table cannot
    // resolve the spec's granularity (region). At continent and country
    // granularity the two must agree, or the advice numbers are fiction.
    const overCounted = [];
    const resolvable = GEO_SPECS.filter((entries) => entries.every((entry) => {
      const body = entry.startsWith('a!c') ? entry.slice(3) : entry.slice(2);
      // a region part - including _NONE, which install-time treats as one -
      // is granularity the table cannot resolve, so divergence there is the
      // deliberate over-inclusion, not a defect
      return body.split('_').length <= 2;
    }));
    // eslint-disable-next-line no-restricted-syntax
    for (const geolocation of resolvable) {
      // eslint-disable-next-line no-restricted-syntax
      for (const nodeGeo of NODE_LOCATIONS) {
        // eslint-disable-next-line no-await-in-loop
        const accepted = await installerAccepts(geolocation, nodeGeo);
        const counted = placementFeasibility.nodeLocationMatchesGeolocation(filterLocation(nodeGeo), geolocation);
        if (!accepted && counted) {
          overCounted.push(`${JSON.stringify(geolocation)} vs ${nodeGeo.continentCode}_${nodeGeo.countryCode}`);
        }
      }
    }
    expect(overCounted, `candidate filter counted nodes the installer refuses:\n  ${overCounted.join('\n  ')}`).to.deep.equal([]);
  });

  it('agrees with the installer exactly at table-resolvable region granularity', async () => {
    // For region entries in the table's own vocabulary, on nodes whose region
    // the table knows, filter and installer read the same table - so they must
    // agree in BOTH directions. Divergence here is not over-inclusion, it is
    // one of the two implementations misreading the shared vocabulary.
    const isoRegionSpecs = GEO_SPECS.filter((entries) => entries.length
      && entries.every((entry) => {
        const body = entry.startsWith('a!c') ? entry.slice(3) : entry.slice(2);
        const parts = body.split('_');
        return parts.length <= 2 || /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(parts[2]);
      }));
    const regionKnown = NODE_LOCATIONS.filter((nodeGeo) => nodeGeo.tableRegion);
    const diverged = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const geolocation of isoRegionSpecs) {
      // eslint-disable-next-line no-restricted-syntax
      for (const nodeGeo of regionKnown) {
        // eslint-disable-next-line no-await-in-loop
        const accepted = await installerAccepts(geolocation, nodeGeo);
        const counted = placementFeasibility.nodeLocationMatchesGeolocation(filterLocation(nodeGeo), geolocation);
        if (accepted !== counted) {
          diverged.push(`${JSON.stringify(geolocation)} vs ${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.tableRegion}: installer=${accepted} filter=${counted}`);
        }
      }
    }
    expect(diverged, `filter and installer disagree on shared vocabulary:\n  ${diverged.join('\n  ')}`).to.deep.equal([]);
  });

  it('counts a node whose location the table cannot resolve at all', async () => {
    // the table not knowing where a node is must never make it ineligible
    GEO_SPECS.filter((entries) => entries.length).forEach((geolocation) => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(null, geolocation)).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation({ continentCode: null, countryCode: null }, geolocation)).to.equal(true);
    });
  });
});
