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
];

// node locations spanning both sides of every boundary above
const NODE_LOCATIONS = [
  { continentCode: 'EU', countryCode: 'FI', regionName: 'Uusimaa' },
  { continentCode: 'EU', countryCode: 'FI', regionName: 'Pirkanmaa' },
  { continentCode: 'EU', countryCode: 'DE', regionName: 'Bavaria' },
  { continentCode: 'EU', countryCode: 'RU', regionName: 'Moscow' },
  { continentCode: 'AS', countryCode: 'BH', regionName: 'Manama' },
  { continentCode: 'NA', countryCode: 'US', regionName: 'California' },
  { continentCode: 'NA', countryCode: 'US', regionName: 'Hawaii' },
  { continentCode: 'NA', countryCode: 'CA', regionName: 'Ontario' },
  { continentCode: 'SA', countryCode: 'BR', regionName: 'Sao Paulo' },
];

/**
 * Does the real install-time gate accept this node for this spec?
 * Runs the actual hwRequirements implementation with the node's geolocation
 * stubbed - not a reimplementation of it, which would defeat the purpose.
 */
async function installerAccepts(geolocation, nodeGeo) {
  const hwRequirements = proxyquire('../../ZelBack/src/services/appRequirements/hwRequirements', {
    '../geolocationService': { getNodeGeolocation: sinon.stub().resolves(nodeGeo) },
  });
  try {
    await hwRequirements.checkAppGeolocationRequirements({ version: 7, geolocation });
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
        const counted = placementFeasibility.nodeLocationMatchesGeolocation(
          { continentCode: nodeGeo.continentCode, countryCode: nodeGeo.countryCode },
          geolocation,
        );
        if (accepted && !counted) {
          underCounted.push(`${JSON.stringify(geolocation)} vs ${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`);
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
        const counted = placementFeasibility.nodeLocationMatchesGeolocation(
          { continentCode: nodeGeo.continentCode, countryCode: nodeGeo.countryCode },
          geolocation,
        );
        if (!accepted && counted) {
          overCounted.push(`${JSON.stringify(geolocation)} vs ${nodeGeo.continentCode}_${nodeGeo.countryCode}`);
        }
      }
    }
    expect(overCounted, `candidate filter counted nodes the installer refuses:\n  ${overCounted.join('\n  ')}`).to.deep.equal([]);
  });

  it('counts a node whose location the table cannot resolve at all', async () => {
    // the table not knowing where a node is must never make it ineligible
    GEO_SPECS.filter((entries) => entries.length).forEach((geolocation) => {
      expect(placementFeasibility.nodeLocationMatchesGeolocation(null, geolocation)).to.equal(true);
      expect(placementFeasibility.nodeLocationMatchesGeolocation({ continentCode: null, countryCode: null }, geolocation)).to.equal(true);
    });
  });
});
