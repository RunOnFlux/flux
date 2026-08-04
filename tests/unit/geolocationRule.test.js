// The geolocation rule: parse once, evaluate many.
//
// The rule decides which nodes may run an app, and it is consumed by the
// candidate count, the spawner's own selection and the installer. This suite
// holds two things: that the rule reproduces the eligibility the network
// already had - across every entry shape the format permits, not only the ones
// production carries - and that parsing once and reusing the rule cannot answer
// differently from parsing per node.
//
// The recorded verdicts live in data/geolocationVerdicts. They are not derived
// from the rule they check, so this is a real constraint on it rather than a
// restatement of it.

const { expect } = require('chai');

const geolocationRule = require('../../ZelBack/src/services/appPlacement/geolocationRule');
const { GEO_SPECS, NODE_LOCATIONS, VERDICTS } = require('./data/geolocationVerdicts');

const describeLocation = (loc) => (loc
  ? `${loc.continentCode}/${loc.countryCode}/${loc.region ?? '-'}`
  : 'no location');

describe('geolocationRule', () => {
  describe('reproduces the eligibility the network already had', () => {
    it('has a recorded verdict for every pair', () => {
      expect(VERDICTS).to.have.lengthOf(GEO_SPECS.length);
      VERDICTS.forEach((row, i) => {
        expect(row, `verdict row ${i}`).to.have.lengthOf(NODE_LOCATIONS.length);
      });
    });

    GEO_SPECS.forEach((spec, specIndex) => {
      it(`decides [${spec.join(', ')}] as recorded for every node location`, () => {
        NODE_LOCATIONS.forEach((loc, locIndex) => {
          const actual = geolocationRule.locationSatisfiesGeolocation(loc, spec);
          expect(actual, `${describeLocation(loc)} against [${spec.join(', ')}]`)
            .to.equal(VERDICTS[specIndex][locIndex]);
        });
      });
    });
  });

  describe('parsing once cannot answer differently from parsing per node', () => {
    it('gives identical verdicts for a reused rule across every location', () => {
      GEO_SPECS.forEach((spec) => {
        const rule = geolocationRule.parseGeolocation(spec);
        NODE_LOCATIONS.forEach((loc) => {
          const reused = geolocationRule.locationSatisfiesRule(rule, loc);
          const fresh = geolocationRule.locationSatisfiesGeolocation(loc, spec);
          expect(reused, `${describeLocation(loc)} against [${spec.join(', ')}]`).to.equal(fresh);
        });
      });
    });

    it('does not mutate the rule while evaluating', () => {
      const rule = geolocationRule.parseGeolocation(['acEU', 'a!cEU_FI_FI-18']);
      const before = JSON.stringify(rule);
      NODE_LOCATIONS.forEach((loc) => geolocationRule.locationSatisfiesRule(rule, loc));
      expect(JSON.stringify(rule)).to.equal(before);
    });
  });

  describe('the rules that decide eligibility', () => {
    const inFinland = { continentCode: 'EU', countryCode: 'FI', region: 'FI-18' };
    const finlandNoRegion = { continentCode: 'EU', countryCode: 'FI', region: null };

    it('answers a deny before an allow', () => {
      const rule = geolocationRule.parseGeolocation(['acEU', 'a!cEU_FI']);
      expect(geolocationRule.locationSatisfiesRule(rule, inFinland)).to.equal(false);
    });

    it('treats a _NONE region part as banning nothing', () => {
      const rule = geolocationRule.parseGeolocation(['a!cEU_FI_NONE']);
      expect(geolocationRule.locationSatisfiesRule(rule, inFinland)).to.equal(true);
      expect(geolocationRule.locationSatisfiesRule(rule, finlandNoRegion)).to.equal(true);
    });

    it('admits a region pin only where the region is known and equal', () => {
      const rule = geolocationRule.parseGeolocation(['acEU_FI_FI-18']);
      expect(geolocationRule.locationSatisfiesRule(rule, inFinland)).to.equal(true);
      expect(geolocationRule.locationSatisfiesRule(rule, finlandNoRegion)).to.equal(false);
    });

    it('applies a region deny only where the region is known and equal', () => {
      const rule = geolocationRule.parseGeolocation(['a!cEU_FI_FI-18']);
      expect(geolocationRule.locationSatisfiesRule(rule, inFinland)).to.equal(false);
      expect(geolocationRule.locationSatisfiesRule(rule, finlandNoRegion)).to.equal(true);
    });

    it('keeps a legacy region name at country granularity', () => {
      const rule = geolocationRule.parseGeolocation(['acEU_FI_Uusimaa']);
      expect(geolocationRule.locationSatisfiesRule(rule, inFinland)).to.equal(true);
      expect(geolocationRule.locationSatisfiesRule(rule, finlandNoRegion)).to.equal(true);
    });

    it('counts a location the table cannot resolve', () => {
      const rule = geolocationRule.parseGeolocation(['acAS_BH']);
      expect(geolocationRule.locationSatisfiesRule(rule, { continentCode: null, countryCode: null, region: null })).to.equal(true);
    });

    it('applies a legacy continent pin only without ac or a!c entries', () => {
      const alone = geolocationRule.parseGeolocation(['aAS']);
      expect(geolocationRule.locationSatisfiesRule(alone, inFinland)).to.equal(false);
      const withDeny = geolocationRule.parseGeolocation(['aAS', 'a!cNA']);
      expect(geolocationRule.locationSatisfiesRule(withDeny, inFinland)).to.equal(true);
    });

    it('applies a legacy country pin whenever no allow entry exists', () => {
      const alone = geolocationRule.parseGeolocation(['bDE']);
      expect(geolocationRule.locationSatisfiesRule(alone, inFinland)).to.equal(false);
      const withDeny = geolocationRule.parseGeolocation(['bDE', 'a!cNA']);
      expect(geolocationRule.locationSatisfiesRule(withDeny, inFinland)).to.equal(false);
    });
  });

  describe('entries that carry no constraint', () => {
    // The implementation this replaces threw on a non-string entry, which is
    // why no verdict is recorded for one. Skipping them is the only reading
    // that makes sense: no term can be derived, and failing an entire candidate
    // count over one entry would refuse an app the installer would accept.
    it('skips non-string entries rather than failing the computation', () => {
      const rule = geolocationRule.parseGeolocation([null, 42, { country: 'FI' }, 'acEU']);
      expect(rule.allows).to.have.lengthOf(1);
      expect(geolocationRule.locationSatisfiesRule(rule, { continentCode: 'EU', countryCode: 'FI', region: null })).to.equal(true);
      expect(geolocationRule.locationSatisfiesRule(rule, { continentCode: 'AS', countryCode: 'BH', region: null })).to.equal(false);
    });

    it('treats an absent geolocation array as unrestricted', () => {
      expect(geolocationRule.parseGeolocation(undefined).unrestricted).to.equal(true);
      expect(geolocationRule.locationSatisfiesGeolocation({ continentCode: 'EU', countryCode: 'FI', region: null }, undefined)).to.equal(true);
    });
  });

  describe('the parsed terms state their own granularity', () => {
    it('reads an allow of ALL as unconditional', () => {
      expect(geolocationRule.parseGeolocation(['acALL']).allows[0].granularity).to.equal('all');
    });

    it('reads an allow of CONT_ALL at continent granularity', () => {
      const [entry] = geolocationRule.parseGeolocation(['acEU_ALL']).allows;
      expect(entry.granularity).to.equal('continent');
      expect(entry.continent).to.equal('EU');
    });

    it('reads a deny of CONT_ALL as matching nothing', () => {
      // install-time compares the whole entry against the node's own location
      // string, where 'EU_ALL' never appears - the deny is inert, and reading
      // it as "the whole continent" would ban nodes the installer accepts
      const [entry] = geolocationRule.parseGeolocation(['a!cEU_ALL']).denies;
      expect(entry.granularity).to.equal('country');
      expect(entry.country).to.equal('ALL');
    });

    it('reads a deny with a legacy region part as matching nothing', () => {
      expect(geolocationRule.parseGeolocation(['a!cEU_FI_NONE']).denies[0].granularity).to.equal('never');
      expect(geolocationRule.parseGeolocation(['a!cNA_US_Hawaii']).denies[0].granularity).to.equal('never');
    });

    it('reads a table-vocabulary region part at region granularity', () => {
      const [entry] = geolocationRule.parseGeolocation(['acEU_FI_FI-18']).allows;
      expect(entry.granularity).to.equal('region');
      expect(entry.region).to.equal('FI-18');
    });
  });
});
