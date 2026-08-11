// The eligibility matrix the geolocation rule must reproduce.
//
// Every entry shape the spec format permits crossed with every kind of node
// location, and the verdict for each pair. The verdicts are not hand-written
// and they are not generated from the rule they check: they were taken from the
// implementation that decided eligibility before the rule existed, so this file
// is what holds the rule to the behaviour the network already had.
//
// A verdict that moves is a change in who may run an app. That is sometimes
// intended - but it is never incidental, and it must not pass unnoticed.

// Shapes past what production carries are deliberate. The malformed tail is
// where a tidier-looking rule quietly changes who is eligible: 'a' and 'b'
// alone pin an empty string, 'acEU_ALL_X' is not the continent wildcard it
// resembles, and 'FI-999' satisfies the region grammar while naming nothing.
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
  ['a!cALL'],
  ['a!cEU_ALL'],
  ['a!cEU_FI_ALL'],
  ['acEU', 'a!cEU_RU'],
  ['acEU_FI', 'acAS_BH'],
  ['acNA', 'a!cNA_US'],
  ['aEU'],
  ['bFI'],
  ['aEU', 'bFI'],
  ['acEU_FI_FI-18'],
  ['acNA_US_US-CA'],
  ['a!cEU_FI_FI-18'],
  ['a!cNA_US_US-HI'],
  ['acEU_FI_FI-18', 'acAS_BH'],
  ['acEU', 'a!cEU_FI_FI-18'],
  ['a!cEU_FI_FI-18', 'acEU'],
  ['a'],
  ['b'],
  ['ac'],
  ['a!c'],
  ['aEU', 'aAS'],
  ['bFI', 'bDE'],
  ['aEU', 'a!cEU_FI'],
  ['bFI', 'a!cEU_FI'],
  ['acEU_ALL_X'],
  ['acEU_FI_FI-999'],
  ['acEU_FI_fi-18'],
  ['xyz'],
  ['acEU', 'xyz'],
];

// Both sides of every boundary above, including the two kinds of unprovable
// location - no region, and no location at all - which must always count.
const NODE_LOCATIONS = [
  { continentCode: 'EU', countryCode: 'FI', region: 'FI-18' },
  { continentCode: 'EU', countryCode: 'FI', region: 'FI-11' },
  { continentCode: 'EU', countryCode: 'FI', region: null },
  { continentCode: 'EU', countryCode: 'DE', region: 'DE-BY' },
  { continentCode: 'EU', countryCode: 'RU', region: null },
  { continentCode: 'AS', countryCode: 'BH', region: 'BH-13' },
  { continentCode: 'NA', countryCode: 'US', region: 'US-CA' },
  { continentCode: 'NA', countryCode: 'US', region: 'US-HI' },
  { continentCode: 'NA', countryCode: 'CA', region: 'CA-ON' },
  { continentCode: 'SA', countryCode: 'BR', region: null },
  { continentCode: null, countryCode: null, region: null },
  { continentCode: 'EU', countryCode: null, region: null },
  { continentCode: null, countryCode: 'FI', region: null },
  null,
];

// VERDICTS[i][j] - does NODE_LOCATIONS[j] satisfy GEO_SPECS[i]
const VERDICTS = require('./geolocationVerdicts.json');

module.exports = { GEO_SPECS, NODE_LOCATIONS, VERDICTS };
