const { expect } = require('chai');
const ipLocationTable = require('../../ZelBack/src/services/appPlacement/ipLocationTable');
const cidrUtils = require('../../ZelBack/src/services/utils/cidrUtils');

function v4Int(ip) {
  return Number(cidrUtils.parseIp(ip).value);
}

// Mirrors the incident geography: the Bahrain /20 and a Bulgarian block inside
// the same /16, plus Hetzner's /15 spanning what /16 keying counted as two domains.
function fixtureArtifact() {
  return {
    format: 1,
    generated: '2026-07-30T00:00:00Z',
    sources: { ripencc: '1785362399' },
    countries: ['BH', 'BG', 'FI'],
    continents: { BH: 'AS', BG: 'EU', FI: 'EU' },
    orgs: ['ripencc:etisalcom', 'ripencc:bg-isp', 'ripencc:hetzner'],
    regions: ['FI-18'],
    v4: [
      [v4Int('65.108.0.0'), v4Int('65.109.255.255'), 2, 2, 0],
      [v4Int('80.95.16.0'), v4Int('80.95.19.255'), 1, 1],
      [v4Int('80.95.208.0'), v4Int('80.95.223.255'), 0, 0],
    ],
    v6: [
      ['2a01:4f9::', '2a01:4f9:ffff:ffff:ffff:ffff:ffff:ffff', 2, 2],
    ],
  };
}

describe('ipLocationTable tests', () => {
  beforeEach(() => ipLocationTable.clear());
  after(() => ipLocationTable.clear());

  it('reports no table before an artifact is set', () => {
    expect(ipLocationTable.hasTable()).to.equal(false);
    expect(ipLocationTable.tableInfo()).to.equal(null);
    expect(ipLocationTable.lookup('80.95.213.209')).to.equal(null);
  });

  it('loads an artifact and resolves the Bahrain block', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    expect(ipLocationTable.hasTable()).to.equal(true);
    const hit = ipLocationTable.lookup('80.95.213.209');
    expect(hit).to.eql({
      org: 'ripencc:etisalcom',
      block: '80.95.208.0-80.95.223.255',
      countryCode: 'BH',
      continentCode: 'AS',
      region: null,
    });
  });

  it('separates countries inside one /16', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    expect(ipLocationTable.lookup('80.95.16.10').countryCode).to.equal('BG');
    expect(ipLocationTable.lookup('80.95.215.211').countryCode).to.equal('BH');
  });

  it('resolves range boundaries inclusively and gaps to null', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    expect(ipLocationTable.lookup('80.95.208.0').countryCode).to.equal('BH');
    expect(ipLocationTable.lookup('80.95.223.255').countryCode).to.equal('BH');
    expect(ipLocationTable.lookup('80.95.207.255')).to.equal(null);
    expect(ipLocationTable.lookup('80.95.224.0')).to.equal(null);
    expect(ipLocationTable.lookup('9.9.9.9')).to.equal(null);
  });

  it('groups both Hetzner /16s into one allocation block with region', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    const a = ipLocationTable.lookup('65.108.1.1');
    const b = ipLocationTable.lookup('65.109.200.7');
    expect(a.block).to.equal(b.block);
    expect(a.org).to.equal('ripencc:hetzner');
    expect(a.countryCode).to.equal('FI');
    expect(a.region).to.equal('FI-18');
  });

  it('resolves IPv6 ranges', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    const hit = ipLocationTable.lookup('2a01:4f9:c010:1234::1');
    expect(hit.org).to.equal('ripencc:hetzner');
    expect(hit.countryCode).to.equal('FI');
    expect(ipLocationTable.lookup('2a02::1')).to.equal(null);
  });

  it('accepts the artifact as JSON text and as a Buffer', () => {
    ipLocationTable.setArtifact(JSON.stringify(fixtureArtifact()));
    expect(ipLocationTable.lookup('80.95.213.209').countryCode).to.equal('BH');
    ipLocationTable.clear();
    ipLocationTable.setArtifact(Buffer.from(JSON.stringify(fixtureArtifact())));
    expect(ipLocationTable.lookup('80.95.213.209').countryCode).to.equal('BH');
  });

  it('returns null for unparseable lookups including socket addresses', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    expect(ipLocationTable.lookup('80.95.213.209:16127')).to.equal(null);
    expect(ipLocationTable.lookup('garbage')).to.equal(null);
    expect(ipLocationTable.lookup(null)).to.equal(null);
  });

  it('rejects malformed artifacts and keeps the previous table', () => {
    ipLocationTable.setArtifact(fixtureArtifact());

    expect(() => ipLocationTable.setArtifact({ format: 2 })).to.throw('unsupported format');
    expect(() => ipLocationTable.setArtifact({ format: 1 })).to.throw('missing required sections');

    const unsorted = fixtureArtifact();
    unsorted.v4.reverse();
    expect(() => ipLocationTable.setArtifact(unsorted)).to.throw('unsorted or overlapping');

    const overlapping = fixtureArtifact();
    overlapping.v4[1][0] = overlapping.v4[0][1]; // starts inside the previous range
    expect(() => ipLocationTable.setArtifact(overlapping)).to.throw('unsorted or overlapping');

    const badIndex = fixtureArtifact();
    badIndex.v4[0][2] = 99;
    expect(() => ipLocationTable.setArtifact(badIndex)).to.throw('org index out of range');

    // previous good table still answers
    expect(ipLocationTable.lookup('80.95.213.209').countryCode).to.equal('BH');
  });

  it('tableInfo reports the loaded artifact', () => {
    ipLocationTable.setArtifact(fixtureArtifact());
    expect(ipLocationTable.tableInfo()).to.eql({
      generated: '2026-07-30T00:00:00Z',
      sources: { ripencc: '1785362399' },
      v4Ranges: 3,
      v6Ranges: 1,
    });
  });
});
