// The app geolocation rule, parsed once.
//
// A spec's geolocation array decides which nodes may run the app, and three
// places need that decision in different shapes: the candidate count asks it of
// every node on the list, the spawner asks it of this node against every app
// missing instances, and the installer asks it of this node against one app.
// Spelled out separately in each place the copies drift, so the meaning lives
// here and the callers only evaluate.
//
// parseGeolocation turns the entry array into terms. A term carries the
// granularity it applies at and, at region granularity, the proof it demands: a
// region pin is a promise, so it admits a node only where that node's region is
// known and equal, and a region ban excludes only where the same holds. Enforce
// on proof, ban on proof - a node the table cannot place at region granularity
// satisfies no region pin and is caught by no region deny.
//
// Parsing is separate from evaluating because the candidate count parses one
// spec and evaluates it against thousands of nodes; deriving the terms per node
// made that cost the product of the two.
//
// Allowed and forbidden entries are parsed by different functions, because the
// network's stored semantics differ: an allow of `<CONT>_ALL` admits the whole
// continent, while the matching deny is compared whole against the node's own
// location string and so excludes nothing. That asymmetry is the wire format's,
// not a choice made here.

// The table's own region vocabulary: a full ISO 3166-2 code belonging to the
// entry's country part. Anything else - ip-api region names, _NONE, _ALL,
// retired codes - is legacy-shaped and keeps country granularity, because
// matching it against the table's vocabulary would exclude nodes the installer
// accepts.
const TABLE_REGION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

/**
 * @typedef {object} GeoTerm
 * @property {'all'|'continent'|'country'|'region'|'never'} granularity What the
 *   term is capable of matching. 'never' is a term the wire format permits but
 *   which can match no node - a region part outside the table's vocabulary in a
 *   deny, where install-time compares the whole string and finds nothing.
 * @property {string|null} continent
 * @property {string|null} country
 * @property {string|null} region
 */

/**
 * @typedef {object} GeoRule
 * @property {boolean} unrestricted No entries at all - every node satisfies it
 * @property {Array<GeoTerm>} allows
 * @property {Array<GeoTerm>} denies
 * @property {string|null} legacyCountry The first `b<CC>` entry's country
 * @property {string|null} legacyContinent The first `a<CONT>` entry's continent
 */

/**
 * Whether a region part is an ISO 3166-2 code belonging to that country. Half of
 * the question a caller actually has - regionCodeOf is the whole of it, and is
 * what everything outside this module asks. Answering "is this a table region?"
 * without the vocabulary reports a name the table resolves as one it cannot.
 * @param {string} part The entry's region part
 * @param {string} countryPart The entry's country part
 * @returns {boolean}
 */
function isTableRegionPart(part, countryPart) {
  return TABLE_REGION.test(part ?? '') && part.slice(0, 2) === countryPart;
}

/**
 * @param {'all'|'continent'|'country'|'region'|'never'} granularity
 * @param {string|null} [continent]
 * @param {string|null} [country]
 * @param {string|null} [region]
 * @returns {GeoTerm}
 */
function term(granularity, continent = null, country = null, region = null) {
  return {
    granularity, continent, country, region,
  };
}

/**
 * The region code a third part names, in either vocabulary: an ISO 3166-2 code
 * as written, or a region name resolved through the published vocabulary. Null
 * when neither - the caller then answers the entry at country granularity,
 * which counts more nodes rather than fewer.
 * @param {string[]} parts The entry body, split on `_`
 * @param {(countryCode: string, regionName: string) => string|null} resolveRegion
 * @returns {string | null}
 */
function regionCodeOf(parts, resolveRegion = () => null) {
  if (isTableRegionPart(parts[2], parts[1])) return parts[2];
  // a name may carry the separator, and install-time compares the whole tail
  return resolveRegion(parts[1], parts.slice(2).join('_'));
}

/**
 * An allowed entry's body as a term. `ALL` admits everything and `<CONT>_ALL`
 * admits the continent; a third part naming a region in either vocabulary pins
 * it, and one that resolves to neither admits the whole country.
 * @param {string} body The entry with its `ac` prefix removed
 * @param {(countryCode: string, regionName: string) => string|null} resolveRegion
 * @returns {GeoTerm}
 */
function parseAllowedBody(body, resolveRegion) {
  if (body === 'ALL') return term('all');
  const parts = body.split('_');
  if (parts.length === 1) return term('continent', parts[0]);
  if (parts.length === 2) {
    return parts[1] === 'ALL' ? term('continent', parts[0]) : term('country', parts[0], parts[1]);
  }
  const code = regionCodeOf(parts, resolveRegion);
  if (code) return term('region', parts[0], parts[1], code);
  return term('country', parts[0], parts[1]);
}

/**
 * A forbidden entry's body as a term. A deny excludes only at the granularities
 * install-time resolves: continent, continent_country, and a region part in
 * either vocabulary - the table's own codes, or an ip-api name the published
 * artifact's region-name vocabulary maps onto one. Every other shape - `ALL`,
 * `<CONT>_ALL`, `_NONE`, a region part neither vocabulary resolves - bans
 * nothing, which is why `_NONE` must never be stripped: doing so would ban a
 * whole country the installer would accept.
 * @param {string} body The entry with its `a!c` prefix removed
 * @param {(countryCode: string, regionName: string) => string|null} resolveRegion
 * @returns {GeoTerm}
 */
function parseForbiddenBody(body, resolveRegion) {
  const parts = body.split('_');
  if (parts.length === 1) return term('continent', parts[0]);
  if (parts.length === 2) return term('country', parts[0], parts[1]);
  const code = regionCodeOf(parts, resolveRegion);
  if (code) return term('region', parts[0], parts[1], code);
  return term('never');
}

/**
 * Parse a spec's geolocation array into the rule it expresses. Entries that are
 * not strings carry no constraint and are skipped: a term cannot be derived
 * from them, and failing the whole computation over one would refuse an app the
 * installer has no objection to.
 * @param {Array<string>} entries A spec's geolocation array
 * @param {(countryCode: string, regionName: string) => string|null} [resolveRegion]
 *   Resolves a region an app named the way ip-api does to its ISO 3166-2 code.
 *   Without one, such an entry is answered at country granularity - what a node
 *   holding no vocabulary can prove, and the direction that counts more nodes.
 * @returns {GeoRule}
 */
function parseGeolocation(entries, resolveRegion = () => null) {
  const list = entries ?? [];
  const rule = {
    unrestricted: list.length === 0,
    allows: [],
    denies: [],
    legacyCountry: null,
    legacyContinent: null,
  };
  list.forEach((entry) => {
    if (typeof entry !== 'string') return;
    if (entry.startsWith('a!c')) {
      rule.denies.push(parseForbiddenBody(entry.slice(3), resolveRegion));
      return;
    }
    if (entry.startsWith('ac')) {
      rule.allows.push(parseAllowedBody(entry.slice(2), resolveRegion));
      return;
    }
    // legacy pins: the first of each wins, matching install-time's find()
    if (entry.startsWith('b')) {
      if (rule.legacyCountry === null) rule.legacyCountry = entry.slice(1);
      return;
    }
    if (entry.startsWith('a') && rule.legacyContinent === null) {
      rule.legacyContinent = entry.slice(1);
    }
  });
  return rule;
}

/**
 * Whether one term covers a node location.
 * @param {GeoTerm} geoTerm
 * @param {{continentCode: string|null, countryCode: string|null,
 *   region: string|null}} loc Node location
 * @returns {boolean}
 */
function termCoversLocation(geoTerm, loc) {
  switch (geoTerm.granularity) {
    case 'all':
      return true;
    case 'continent':
      return geoTerm.continent === loc.continentCode;
    case 'country':
      return geoTerm.continent === loc.continentCode && geoTerm.country === loc.countryCode;
    case 'region':
      // Proof, in both directions: a region term always carries an ISO 3166-2
      // code, and a node whose region the table does not carry holds null, so
      // the equality admits it to no pin and exposes it to no ban.
      return geoTerm.continent === loc.continentCode
        && geoTerm.country === loc.countryCode
        && geoTerm.region === loc.region;
    default:
      return false;
  }
}

/**
 * Whether a node location satisfies a parsed rule. A location the table cannot
 * resolve satisfies every rule: the rule cannot prove it ineligible, and only
 * proven ineligibility may exclude a node from the candidate count.
 *
 * Denies are answered before allows, so a deny beats an allow. The legacy pins
 * apply only in the absence of the current syntax, matching install-time: a
 * `b<CC>` country pin applies whenever no allow entry exists, and an
 * `a<CONT>` continent pin only when there are no allow AND no deny entries.
 * @param {GeoRule} rule A parseGeolocation() result
 * @param {{continentCode: string|null, countryCode: string|null,
 *   region: string|null}} loc Node location
 * @returns {boolean}
 */
function locationSatisfiesRule(rule, loc) {
  if (rule.unrestricted) return true;
  if (!loc || !loc.countryCode || !loc.continentCode) return true;
  if (rule.denies.some((geoTerm) => termCoversLocation(geoTerm, loc))) return false;
  if (rule.allows.length) {
    return rule.allows.some((geoTerm) => termCoversLocation(geoTerm, loc));
  }
  if (rule.legacyCountry !== null && rule.legacyCountry !== loc.countryCode) return false;
  if (rule.denies.length === 0
    && rule.legacyContinent !== null && rule.legacyContinent !== loc.continentCode) {
    return false;
  }
  return true;
}

/**
 * Parse and evaluate in one call, for the callers that answer about a single
 * node. Callers evaluating many nodes against one spec must parse once and
 * reuse the rule.
 * @param {{continentCode: string|null, countryCode: string|null,
 *   region: string|null}} loc Node location
 * @param {Array<string>} entries A spec's geolocation array
 * @param {(countryCode: string, regionName: string) => string|null} [resolveRegion]
 * @returns {boolean}
 */
function locationSatisfiesGeolocation(loc, entries, resolveRegion) {
  return locationSatisfiesRule(parseGeolocation(entries, resolveRegion), loc);
}

module.exports = {
  regionCodeOf,
  parseGeolocation,
  locationSatisfiesRule,
  locationSatisfiesGeolocation,
};
