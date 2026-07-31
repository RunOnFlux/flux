// Placement feasibility for synced apps.
//
// A placement constraint may only reject a node when a better-placed candidate
// provably exists. This module supplies the proof: it computes, from the
// deterministic node list and the IP location table, how many distinct fault
// domains an app's eligible candidates span, and from that each domain's share
// of the app's instances - the smallest uniform level the domains can absorb.
// The spawner, the registration validator and the placement API all consume
// this one computation.
//
// Every approximation in here errs toward counting MORE candidates and MORE
// domains, which pushes the share toward 1 - i.e. toward the strict behaviour
// the network has today - never toward stacking instances. A missing table, an
// unresolvable location, a region-granularity pin the table cannot answer: all
// degrade to the status quo.
//
// The same principle at the entry level: an ALLOWED restriction the table
// cannot fully resolve over-includes (a region-level pin admits the whole
// country), while a FORBIDDEN restriction it cannot resolve is not applied at
// all. A constraint never strands an app on missing data, and a ban never
// applies to a node it cannot be proven to cover.

const config = require('config');
const log = require('../../lib/log');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const generalService = require('../generalService');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const cidrUtils = require('../utils/cidrUtils');
const mountParser = require('../utils/mountParser');
const { extractIp, socketAddressesMatch } = require('../utils/socketAddressUtils');
const ipLocationTable = require('./ipLocationTable');

// geonames/ip-api continent convention - the same vocabulary the location
// table's country -> continent map uses
const CONTINENT_CODES = new Set(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']);

/**
 * Bare IP from a node-list or location entry. IPv6 literals pass through;
 * anything else is treated as ip[:port].
 * @param {string} address ip, ip:port, or IPv6 literal
 * @returns {string | null}
 */
function bareIp(address) {
  if (typeof address !== 'string' || !address) return null;
  if (address.includes('.') || !address.includes(':')) return extractIp(address);
  return address; // IPv6 literal - extractIp would truncate at the first colon
}

/**
 * The fault-domain key for an IP, on the ladder: organisation, else registry
 * allocation block, else /16 (v4) / /32 (v6) arithmetic when no table covers it.
 * @param {string} address ip or ip:port
 * @returns {string | null} null when the address does not parse
 */
function faultDomain(address) {
  const ip = bareIp(address);
  if (!ip) return null;
  const hit = ipLocationTable.lookup(ip);
  if (hit?.org) return `org:${hit.org}`;
  if (hit) return `blk:${hit.block}`;
  const parsed = cidrUtils.parseIp(ip);
  if (!parsed) return null;
  return `net:${cidrUtils.prefixKey(ip, parsed.version === 4 ? 16 : 32)}`;
}

/**
 * Whether a node location satisfies an app's geolocation specification.
 * Mirrors the install-time semantics of checkAppGeolocationRequirements:
 * exact match at continent, continent_country or the _ALL variants. Entries at
 * region granularity are matched at country granularity - the table's region
 * vocabulary (ISO 3166-2) differs from the spec's (ip-api region names), and
 * over-approximating errs strict.
 * @param {{continentCode: string|null, countryCode: string|null}} loc Node location
 * @param {string[]} geolocation App spec geolocation entries
 * @returns {boolean}
 */
function nodeLocationMatchesGeolocation(loc, geolocation) {
  const entries = geolocation ?? [];
  if (entries.length === 0) return true;
  if (!loc || !loc.countryCode || !loc.continentCode) return true; // cannot prove ineligible
  const contCountry = `${loc.continentCode}_${loc.countryCode}`;
  const allowed = entries.filter((x) => x.startsWith('ac'));
  const forbidden = entries.filter((x) => x.startsWith('a!c'));

  const matchesEntry = (value) => {
    const v = value.replace(/_NONE$/, '');
    if (v === 'ALL' || v === loc.continentCode || v === `${loc.continentCode}_ALL`) return true;
    const parts = v.split('_');
    // country level and deeper: continent_country must match; region granularity
    // is matched at country granularity (see module comment)
    return parts.length >= 2 && `${parts[0]}_${parts[1]}` === contCountry;
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of forbidden) {
    const v = entry.slice(3).replace(/_NONE$/, '');
    // forbidden entries exclude only at granularities the table resolves;
    // a region-level ban cannot be proven to apply, so it does not exclude
    if (v === loc.continentCode || v === contCountry) return false;
  }
  if (allowed.length) {
    return allowed.some((entry) => matchesEntry(entry.slice(2)));
  }
  // legacy bXX country pins apply unconditionally, matching install-time checks
  const appCountry = entries.find((x) => x.startsWith('b'));
  if (appCountry && appCountry.slice(1) !== loc.countryCode) return false;
  // legacy aXX continent pins only apply when no ac/a!c entries exist at all
  if (forbidden.length === 0) {
    const appContinent = entries.find((x) => x.startsWith('a') && !x.startsWith('a!c'));
    if (appContinent && appContinent.slice(1) !== loc.continentCode) return false;
  }
  return true;
}

/**
 * The node-list entries an app may be placed on. A spec carrying a non-empty
 * `nodes` list is a closed pool - v7 enforces it at install
 * (checkAppNodesRequirements) and only enterprise owners may carry it from v8
 * on - so the candidate set IS that list. Counting the whole network for such
 * an app computes a share against fault domains it can never use, which
 * strands it below its instance count.
 * @param {Array<object>} nodeList The deterministic node list
 * @param {string[]} pinned The spec's nodes entries (socket addresses or outpoints)
 * @returns {Array<object>}
 */
function pooledNodes(nodeList, pinned) {
  if (!pinned.length) return nodeList;
  const outpoints = new Set(pinned);
  return nodeList.filter((node) => pinned.some((entry) => socketAddressesMatch(entry, node.ip))
    || outpoints.has(`${node.txhash}:${node.outidx}`));
}

/**
 * The per-domain share: the smallest uniform level L at which the domains can
 * absorb all instances, i.e. sum(min(candidatesInDomain, L)) >= instances.
 * When every domain holds at least ceil(instances / domains) candidates this
 * is exactly ceil(instances / domains); when shallow domains cannot absorb
 * their share the level rises only as far as needed, so an app is never
 * stranded by domains too small to take what the average assumes.
 * @param {number[]} domainSizes Candidate count per fault domain
 * @param {number} instances Required instance count
 * @returns {number}
 */
function domainShareLevel(domainSizes, instances) {
  if (domainSizes.length === 0) return instances;
  let level = Math.ceil(instances / domainSizes.length);
  const absorbed = (l) => domainSizes.reduce((sum, size) => sum + Math.min(size, l), 0);
  while (level < instances && absorbed(level) < instances) level += 1;
  return level;
}

/**
 * Compute the placement feasibility of an app over the current network.
 * @param {object} appSpecifications App specifications (geolocation, hw fields)
 * @param {number} [minInstances] Required instance count; defaults to the spec's
 * @returns {Promise<{instances: number, candidateCount: number, domainCount: number,
 *   maxPerDomain: number, placeable: boolean, tableAvailable: boolean,
 *   tableGenerated: string|null}>}
 */
async function placementFeasibility(appSpecifications, minInstances) {
  const instances = minInstances ?? appSpecifications.instances ?? config.fluxapps.minimumInstances;
  const nodeList = await fluxCommunicationUtils.deterministicFluxList();
  if (!Array.isArray(nodeList) || nodeList.length === 0) {
    // an empty node list is missing data, not an empty network - reporting
    // zero candidates would read as proven impossibility to the callers
    const error = new Error('Node list is not available yet');
    error.statusCode = 503;
    throw error;
  }
  const tableAvailable = ipLocationTable.hasTable();
  const geoRestricted = (appSpecifications.geolocation ?? []).length > 0;

  const domains = new Map(); // fault domain -> candidate count
  // Tier is deliberately NOT a filter. A tier is a collateral class, not a
  // hardware guarantee: install-time sizes an app against the node's actual
  // CPU, RAM and disk, so a node whose hardware exceeds its tier's nominal
  // figure accepts apps this arithmetic would have ruled out. Excluding on
  // the nominal figure therefore refuses deployable apps, and no bound this
  // module can compute is a proof of unfitness. Install time enforces it.
  const candidates = pooledNodes(nodeList, appSpecifications.nodes ?? []);
  let candidateCount = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const node of candidates) {
    const ip = bareIp(node.ip);
    if (!ip) continue; // eslint-disable-line no-continue
    if (geoRestricted && tableAvailable) {
      const loc = ipLocationTable.lookup(ip);
      if (!nodeLocationMatchesGeolocation(loc, appSpecifications.geolocation)) continue; // eslint-disable-line no-continue
    }
    const domain = faultDomain(ip);
    if (!domain) continue; // eslint-disable-line no-continue
    candidateCount += 1;
    domains.set(domain, (domains.get(domain) ?? 0) + 1);
  }

  const domainCount = domains.size;
  return {
    instances,
    candidateCount,
    domainCount,
    maxPerDomain: domainShareLevel([...domains.values()], instances),
    placeable: domainCount > 0,
    tableAvailable,
    tableGenerated: ipLocationTable.tableInfo()?.generated ?? null,
  };
}

/**
 * How many of the given app locations sit in a fault domain.
 * @param {Array<{ip: string}>} locations Running or installing app locations
 * @param {string} domainKey A faultDomain() key
 * @returns {number}
 */
function countHeldInDomain(locations, domainKey) {
  if (!domainKey) return 0;
  return (locations ?? []).filter((location) => faultDomain(location.ip) === domainKey).length;
}

/**
 * Whether the app's spec explicitly pins this node, by socket address or by
 * collateral outpoint. A pinned placement is the owner's choice and bypasses
 * the diversity share.
 * @param {object} appSpecifications App specifications
 * @param {string} localSocketAddr This node's ip:port
 * @returns {Promise<boolean>}
 */
async function isNodePinnedHere(appSpecifications, localSocketAddr) {
  const nodes = appSpecifications.nodes ?? [];
  if (!nodes.length) return false;
  if (nodes.some((node) => socketAddressesMatch(node, localSocketAddr))) return true;
  try {
    const collateral = await generalService.obtainNodeCollateralInformation();
    return nodes.includes(`${collateral.txhash}:${collateral.txindex}`);
  } catch (error) {
    log.warn(`placementFeasibility - could not resolve node collateral: ${error.message}`);
    return false;
  }
}

/**
 * The placement category of a computed feasibility - the availability promise
 * the network can make for the spec:
 *   'impossible'  - fewer eligible nodes than instances, even though every
 *                   approximation counts TOWARD eligibility, so the shortfall
 *                   is proven. The spec can never reach its instance count;
 *                   registration rejects it.
 *   'constrained' - the instance count is reachable, but a synced app's
 *                   instances outnumber its fault domains, so some instances
 *                   must share a provider. Deliverable, with less resiliency
 *                   than the instance count implies; registration warns.
 *   'ok'          - the requested count and diversity are both deliverable.
 * @param {object} feasibility A placementFeasibility() result
 * @param {boolean} syncedApp Whether the spec has synced components
 * @returns {'impossible'|'constrained'|'ok'}
 */
function placementCategory(feasibility, syncedApp) {
  if (feasibility.candidateCount < feasibility.instances) return 'impossible';
  if (syncedApp && feasibility.domainCount < feasibility.instances) return 'constrained';
  return 'ok';
}

/**
 * The placement-relevant sizing of a spec: the fields that decide how many
 * nodes could hold it. Compared between an update and the spec it replaces.
 * @param {object} spec Formatted app specifications
 * @returns {string} A comparable digest
 */
function placementShape(spec) {
  const components = spec.version <= 3
    ? [{ cpu: spec.cpu, ram: spec.ram, hdd: spec.hdd, tiered: spec.tiered }]
    : (spec.compose ?? []).map((c) => ({
      cpu: c.cpu, ram: c.ram, hdd: c.hdd, tiered: c.tiered,
    }));
  return JSON.stringify({
    instances: spec.instances ?? null,
    geolocation: [...(spec.geolocation ?? [])].sort(),
    components,
  });
}

/**
 * Whether an update changes anything placement depends on. An update that
 * touches none of it - an expire-only renewal, a cancellation (expire: 1), a
 * description or environment edit - must never be refused by the placement
 * gate: the owner is not making placement worse, and refusing would strand
 * them with an app they can neither renew nor cancel.
 * @param {object} next The update's formatted specifications
 * @param {object} previous The specifications it replaces
 * @returns {boolean}
 */
function changesPlacement(next, previous) {
  if (!previous) return true; // nothing to compare against - gate it
  // An enterprise spec is stored with its compose stripped, and a previous
  // spec that could not be decrypted arrives here in that stripped form. It
  // is not comparable, and reading the difference as a placement change would
  // gate exactly the renewals and cancellations this exists to let through.
  const strippedPrevious = previous.version >= 8
    && (previous.compose ?? []).length === 0
    && (next.compose ?? []).length > 0;
  if (strippedPrevious) return false;
  return placementShape(next) !== placementShape(previous);
}

/**
 * Enforce placement feasibility on the user-facing registration and update
 * paths: an impossible spec is rejected before it is paid for, a constrained
 * synced spec is accepted with a warning. Called from the API front door
 * only - never from p2p message verification, where nodes with different
 * table versions must not disagree about message validity. A failure to
 * COMPUTE feasibility never rejects: without the computation there is no
 * proof, and only proven impossibility may refuse a registration.
 *
 * On an update path, pass the previous specifications: an update that does
 * not change placement is never gated (see changesPlacement).
 * @param {object} appSpecFormatted Formatted app specifications
 * @param {string} caller Log prefix identifying the calling path
 * @param {object} [previousSpec] The specifications an update replaces
 * @returns {Promise<object|null>} The feasibility, or null when it could not
 *   be computed or the check did not apply
 * @throws When the spec provably cannot reach its instance count
 */
async function checkPlacementFeasibility(appSpecFormatted, caller, previousSpec) {
  if (previousSpec && !changesPlacement(appSpecFormatted, previousSpec)) return null;
  let synced;
  let feasibility;
  try {
    synced = appSpecFormatted.version <= 3
      ? mountParser.isSyncedComponent(appSpecFormatted.containerData)
      : (appSpecFormatted.compose ?? []).some((component) => mountParser.isSyncedComponent(component.containerData));
    feasibility = await placementFeasibility(appSpecFormatted);
  } catch (error) {
    log.warn(`${caller} - placement feasibility check failed: ${error.message}`);
    return null;
  }
  const category = placementCategory(feasibility, synced);
  const geoRestricted = (appSpecFormatted.geolocation ?? []).length > 0;
  if (category === 'impossible') {
    // A geo-restricted request that resolves to NO candidate at all is the one
    // shortfall this node cannot stand behind. Candidate countries come from
    // the published table (registry allocations plus geofeeds) while install
    // eligibility is decided by each node's own ip-api self-report, and the
    // two disagree for some ranges - a total miss is indistinguishable from
    // the table simply mis-attributing that geography. Some candidates
    // resolving proves the attribution works there, so a shortfall above zero
    // is real and refusable.
    if (geoRestricted && feasibility.candidateCount === 0) {
      log.warn(`${caller} - App ${appSpecFormatted.name} resolves no eligible node for its geolocation; the location table may not cover it, so the registration is allowed`);
      return feasibility;
    }
    throw new Error(`App ${appSpecFormatted.name} requests ${feasibility.instances} instances but only ${feasibility.candidateCount} eligible nodes exist for its geolocation and tier requirements. Widen the allowed locations or lower the instance count.`);
  }
  if (category === 'constrained') {
    log.warn(`${caller} - App ${appSpecFormatted.name} requests ${feasibility.instances} instances across ${feasibility.domainCount} fault domain(s); synced instances will co-locate up to ${feasibility.maxPerDomain} per domain`);
  }
  return feasibility;
}

/**
 * Normalise one structured geolocation entry to the spec-string form the
 * network stores and matches (ac<CONT>, ac<CONT>_<CC>, ac<CONT>_<CC>_<REGION>,
 * a!c... when forbidden). Vocabulary is the location table's: two-letter
 * continent codes, ISO 3166-1 alpha-2 countries, ISO 3166-2 regions. The
 * continent may be omitted when the table can derive it from the country;
 * a continent that contradicts the table's pairing is an error rather than
 * a silent correction.
 * @param {{continent?: string, country?: string, region?: string,
 *   forbidden?: boolean}} entry Structured geolocation entry
 * @returns {string} Spec-string form
 */
function normalizeStructuredEntry(entry) {
  if (entry.forbidden !== undefined && typeof entry.forbidden !== 'boolean') {
    throw new Error('Invalid geolocation entry: forbidden must be a boolean');
  }
  const field = (value, name) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error(`Invalid geolocation entry: ${name} must be a string`);
    // capped before it can reach a rejection message: these endpoints are
    // unauthenticated, and an unbounded value echoed into an error would let
    // a caller write arbitrary volume into the node's logs
    if (value.length > 20) throw new Error(`Invalid geolocation entry: ${name} is too long`);
    return value.trim().toUpperCase();
  };
  const continent = field(entry.continent, 'continent');
  const country = field(entry.country, 'country');
  const region = field(entry.region, 'region');
  if (region && !country) {
    throw new Error(`Invalid geolocation entry: region ${region} requires its country`);
  }
  if (!continent && !country) {
    throw new Error('Invalid geolocation entry: a continent or country is required');
  }
  if (continent && !CONTINENT_CODES.has(continent)) {
    throw new Error(`Invalid geolocation entry: unknown continent code ${continent}`);
  }
  if (country && !/^[A-Z]{2}$/.test(country)) {
    throw new Error(`Invalid geolocation entry: ${country} is not an ISO 3166-1 alpha-2 country code`);
  }
  if (region && !/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(region)) {
    throw new Error(`Invalid geolocation entry: ${region} is not an ISO 3166-2 region code`);
  }
  if (region && region.slice(0, 2) !== country) {
    throw new Error(`Invalid geolocation entry: region ${region} does not belong to ${country}`);
  }
  const tableContinent = country ? ipLocationTable.continentForCountry(country) : null;
  if (country && ipLocationTable.hasTable() && !tableContinent) {
    throw new Error(`Invalid geolocation entry: unknown country code ${country}`);
  }
  if (continent && tableContinent && continent !== tableContinent) {
    throw new Error(`Invalid geolocation entry: country ${country} is in ${tableContinent}, not ${continent}`);
  }
  const resolvedContinent = continent ?? tableContinent;
  if (!resolvedContinent) {
    throw new Error(`Invalid geolocation entry: cannot derive the continent of ${country} without the location table - include continent`);
  }
  const parts = [resolvedContinent];
  if (country) parts.push(country);
  // The region is deliberately dropped rather than emitted. Install-time
  // matching compares a spec's region against the node's ip-api regionName
  // ('Uusimaa'), while this vocabulary is ISO 3166-2 ('FI-18'), so an emitted
  // region would match no node anywhere and the caller registers a spec that
  // installs nowhere. Coarsening to the country is reported back in
  // coarsenedEntries; the caller keeps what it asked for and learns that
  // placement answers it at country granularity.
  return `${entry.forbidden === true ? 'a!c' : 'ac'}${parts.join('_')}`;
}

/**
 * Normalise a mixed geolocation array: spec strings pass through verbatim,
 * structured entries become spec strings. Also reports which normalised
 * entries carry a region part, which placement cannot honour at region
 * granularity - allowed entries match at country granularity, forbidden
 * entries cannot be applied at all.
 * @param {Array<string|object>} entries Geolocation entries, either syntax
 * @returns {{normalized: string[], coarsened: string[]}}
 */
function normalizeGeolocation(entries) {
  const coarsened = [];
  const normalized = entries.map((entry) => {
    if (typeof entry === 'string') {
      if (entry.length > 50) throw new Error('Invalid geolocation specified');
      // a spec string the caller already holds keeps its region part - it is
      // theirs to register - but placement still answers it at country
      // granularity, so report it
      const body = entry.startsWith('a!c') ? entry.slice(3) : (entry.startsWith('ac') ? entry.slice(2) : null);
      const parts = body ? body.split('_') : [];
      if (parts.length >= 3 && parts[2] !== 'ALL' && parts[2] !== 'NONE') coarsened.push(entry);
      return entry;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const value = normalizeStructuredEntry(entry);
      // the region was dropped on the way out (see normalizeStructuredEntry)
      if (entry.region) coarsened.push(value);
      return value;
    }
    throw new Error('Invalid geolocation specified');
  });
  return { normalized, coarsened };
}

/**
 * The geolocation input of a prospective spec, in either accepted shape: the
 * spec's flat geolocation array (spec strings and/or structured entries), or
 * the v9 placement shape - geoAllow/geoDeny arrays of structured entries,
 * exactly what a v9 spec's placement carries - so the deploy form can pass
 * one object to both this endpoint and the spec it registers. Returns the
 * mixed entry list normalizeGeolocation consumes.
 * @param {object} spec Request body
 * @returns {Array<string|object>}
 */
function geolocationEntries(spec) {
  const hasPlacementShape = spec.geoAllow !== undefined || spec.geoDeny !== undefined;
  if (!hasPlacementShape) {
    const entries = spec.geolocation ?? [];
    // 10 entries is the registration limit - nothing beyond it can be bought
    if (!Array.isArray(entries) || entries.length > 10) {
      throw new Error('Invalid geolocation specified');
    }
    return entries;
  }
  if (spec.geolocation !== undefined) {
    throw new Error('Provide either geolocation or geoAllow/geoDeny, not both');
  }
  const entries = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const [name, list, forbidden] of [['geoAllow', spec.geoAllow, false], ['geoDeny', spec.geoDeny, true]]) {
    if (list === undefined || list === null) continue; // eslint-disable-line no-continue
    // the v9 schema caps each list at 100 entries
    if (!Array.isArray(list) || list.length > 100) {
      throw new Error(`Invalid ${name} specified`);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.forbidden !== undefined) {
        throw new Error(`Invalid ${name} specified`);
      }
      entries.push({ ...entry, forbidden });
    }
  }
  return entries;
}

// The advice endpoint is unauthenticated and each answer costs a full pass
// over the node list, so identical questions share one computation for a
// short window. The node list and the table both change on far longer
// timescales than this, and the map is bounded so a caller cannot grow it.
const ADVICE_CACHE_TTL_MS = 30 * 1000;
const ADVICE_CACHE_MAX = 200;
const adviceCache = new Map();

/**
 * placementFeasibility for a normalised advice request, memoised.
 * @param {string[]} normalized Normalised geolocation spec strings
 * @param {number} instances Requested instance count
 * @returns {Promise<object>}
 */
async function cachedFeasibility(normalized, instances) {
  const key = JSON.stringify([instances, normalized]);
  const hit = adviceCache.get(key);
  const now = process.hrtime.bigint();
  if (hit && Number(now - hit.at) / 1e6 < ADVICE_CACHE_TTL_MS) return hit.value;
  const value = await placementFeasibility({ geolocation: normalized, instances }, instances);
  if (adviceCache.size >= ADVICE_CACHE_MAX) adviceCache.clear();
  adviceCache.set(key, { at: now, value });
  return value;
}

/**
 * The placement advice for a prospective app spec, before payment: how many
 * fault domains the requested geography spans, how many instances it can
 * truly hold, and the spec-string geolocation that was evaluated.
 * Geolocation entries are spec strings ('acEU_CZ', 'a!cEU', legacy
 * 'aEU'/'bFR') or structured { continent?, country?, region?, forbidden? }
 * objects; the v9 placement shape ({ geoAllow, geoDeny } arrays) is accepted
 * in place of the flat array. The structured forms are normalised to spec
 * strings, and normalizedGeolocation echoes exactly what was evaluated so
 * the caller can register it verbatim. coarsenedEntries lists entries whose
 * region part placement cannot honour at region granularity. Compose or
 * top-level sizing narrows candidates to the tiers that can hold the app.
 * Throws on invalid input.
 * @param {object} spec Prospective spec { instances?, geolocation? |
 *   geoAllow?/geoDeny?, compose? | containerData?, cpu/ram/hdd? }
 * @returns {Promise<object>} Feasibility plus the advice fields
 */
async function placementAdvice(spec) {
  // An unparsed body reaches here as {} - answering about a default spec would
  // advise a purchase the caller never described. This endpoint requires
  // Content-Type: application/json, which is what makes req.body exist.
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).length === 0) {
    throw new Error('Empty or unparsed request body - send JSON with Content-Type: application/json');
  }
  const instances = serviceHelper.ensureNumber(spec.instances ?? config.fluxapps.minimumInstances);
  if (!Number.isInteger(instances) || instances < 1 || instances > config.fluxapps.maximumInstances) {
    throw new Error('Invalid instances specified');
  }
  const { normalized, coarsened } = normalizeGeolocation(geolocationEntries(spec));
  // advice differs from enforcement here: the registration gate stays
  // permissive without a table (nothing is provable), but serving a
  // geo-restricted ANSWER computed over the whole network would advise a
  // purchase on numbers that mean nothing - say unavailable instead
  if (normalized.some((value) => value !== '') && !ipLocationTable.hasTable()) {
    const error = new Error('The IP location table is not available yet - geolocation feasibility cannot be answered');
    error.statusCode = 503;
    throw error;
  }
  let synced = true;
  if (Array.isArray(spec.compose)) {
    synced = spec.compose.some((component) => mountParser.isSyncedComponent(component?.containerData));
  } else if (typeof spec.containerData === 'string') {
    synced = mountParser.isSyncedComponent(spec.containerData);
  }
  const feasibility = await cachedFeasibility(normalized, instances);
  return {
    ...feasibility,
    syncedApp: synced,
    category: placementCategory(feasibility, synced),
    // diversity below the requested count: some fault domain must hold more than one instance
    constrained: synced && feasibility.domainCount < feasibility.instances,
    // with the water-filled share, any count up to the candidate pool is reachable
    satisfiable: feasibility.candidateCount >= feasibility.instances,
    normalizedGeolocation: normalized,
    coarsenedEntries: coarsened,
  };
}

/**
 * API handler: POST /apps/placementfeasibility.
 * @param {object} req Request
 * @param {object} res Response
 */
async function placementFeasibilityAPI(req, res) {
  try {
    const response = messageHelper.createDataMessage(await placementAdvice(req.body ?? {}));
    res.json(response);
  } catch (error) {
    // rejected input and unavailable data are both ordinary answers on an
    // unauthenticated endpoint - a stack per bad request would let anyone
    // fill the error log
    log.warn(`placementFeasibilityAPI - ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    if (error.statusCode) res.status(error.statusCode);
    res.json(errorResponse);
  }
}

/**
 * The live placement geography in one pass over the node list: node, fault
 * domain and tier counts per continent and country, from the node's own
 * location table. Nodes the table cannot resolve are counted in unresolved
 * rather than guessed at; without a table the tree is empty and only the
 * totals (with /16 fault domains) are served.
 * @returns {Promise<{tableAvailable: boolean, tableGenerated: string|null,
 *   total: {nodes: number, domains: number}, unresolved: number,
 *   continents: object}>}
 */
async function placementLocations() {
  if (!ipLocationTable.hasTable()) {
    // the tree IS the product here - totals over /16 fallback domains are
    // not the placement geography, so absence of the table is unavailability
    const error = new Error('The IP location table is not available yet');
    error.statusCode = 503;
    throw error;
  }
  const nodeList = await fluxCommunicationUtils.deterministicFluxList();
  const tableAvailable = ipLocationTable.hasTable();
  const totalDomains = new Set();
  let totalNodes = 0;
  let unresolved = 0;
  const continents = new Map();
  // eslint-disable-next-line no-restricted-syntax
  for (const node of nodeList) {
    const ip = bareIp(node.ip);
    if (!ip) continue; // eslint-disable-line no-continue
    totalNodes += 1;
    const domain = faultDomain(ip);
    if (domain) totalDomains.add(domain);
    const loc = tableAvailable ? ipLocationTable.lookup(ip) : null;
    if (!loc?.countryCode || !loc.continentCode) {
      unresolved += 1;
      continue; // eslint-disable-line no-continue
    }
    const tier = typeof node.tier === 'string' ? node.tier : 'UNKNOWN';
    let continent = continents.get(loc.continentCode);
    if (!continent) {
      continent = { nodes: 0, domains: new Set(), tiers: {}, countries: new Map() };
      continents.set(loc.continentCode, continent);
    }
    continent.nodes += 1;
    if (domain) continent.domains.add(domain);
    continent.tiers[tier] = (continent.tiers[tier] ?? 0) + 1;
    let country = continent.countries.get(loc.countryCode);
    if (!country) {
      country = { nodes: 0, domains: new Set(), tiers: {} };
      continent.countries.set(loc.countryCode, country);
    }
    country.nodes += 1;
    if (domain) country.domains.add(domain);
    country.tiers[tier] = (country.tiers[tier] ?? 0) + 1;
  }
  const continentsOut = {};
  // eslint-disable-next-line no-restricted-syntax
  for (const [code, continent] of continents) {
    const countriesOut = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const [cc, country] of continent.countries) {
      countriesOut[cc] = { nodes: country.nodes, domains: country.domains.size, tiers: country.tiers };
    }
    continentsOut[code] = {
      nodes: continent.nodes,
      domains: continent.domains.size,
      tiers: continent.tiers,
      countries: countriesOut,
    };
  }
  return {
    tableAvailable,
    tableGenerated: ipLocationTable.tableInfo()?.generated ?? null,
    total: { nodes: totalNodes, domains: totalDomains.size },
    unresolved,
    continents: continentsOut,
  };
}

/**
 * API handler: GET /apps/placementlocations.
 * @param {object} req Request
 * @param {object} res Response
 */
async function placementLocationsAPI(req, res) {
  try {
    const response = messageHelper.createDataMessage(await placementLocations());
    res.json(response);
  } catch (error) {
    log.warn(`placementLocationsAPI - ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    if (error.statusCode) res.status(error.statusCode);
    res.json(errorResponse);
  }
}

module.exports = {
  faultDomain,
  nodeLocationMatchesGeolocation,
  placementFeasibility,
  placementCategory,
  changesPlacement,
  countHeldInDomain,
  isNodePinnedHere,
  checkPlacementFeasibility,
  normalizeGeolocation,
  placementAdvice,
  placementFeasibilityAPI,
  placementLocations,
  placementLocationsAPI,
};
