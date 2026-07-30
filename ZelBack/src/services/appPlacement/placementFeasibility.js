// Placement feasibility for synced apps.
//
// A placement constraint may only reject a node when a better-placed candidate
// provably exists. This module supplies the proof: it computes, from the
// deterministic node list and the IP location table, how many distinct fault
// domains an app's eligible candidates span, and from that each domain's share
// of the app's instances - ceil(instances / domains). The spawner, the
// registration validator and the placement API all consume this one
// computation.
//
// Every approximation in here errs toward counting MORE candidates and MORE
// domains, which pushes the share toward 1 - i.e. toward the strict behaviour
// the network has today - never toward stacking instances. A missing table, an
// unresolvable location, a region-granularity pin the table cannot answer: all
// degrade to the status quo.

const config = require('config');
const log = require('../../lib/log');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const generalService = require('../generalService');
const hwRequirements = require('../appRequirements/hwRequirements');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const cidrUtils = require('../utils/cidrUtils');
const mountParser = require('../utils/mountParser');
const { extractIp, socketAddressesMatch } = require('../utils/socketAddressUtils');
const ipLocationTable = require('./ipLocationTable');

// deterministic node list tier -> app spec tier suffix and fluxSpecifics key
const TIER_MAP = {
  CUMULUS: { hwTier: 'basic', capsKey: 'cumulus' },
  NIMBUS: { hwTier: 'super', capsKey: 'nimbus' },
  STRATUS: { hwTier: 'bamf', capsKey: 'stratus' },
};

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
 * Whether an app's hardware requirements fit a node tier's nominal capacity.
 * Unknown tiers count as fitting - over-approximation errs strict.
 * @param {object} appSpecifications App specifications
 * @param {string} listTier Tier as carried in the deterministic node list
 * @returns {boolean}
 */
function appFitsTier(appSpecifications, listTier) {
  const tier = TIER_MAP[listTier];
  if (!tier) return true;
  const caps = {
    cpu: config.fluxSpecifics.cpu[tier.capsKey] - config.lockedSystemResources.cpu,
    ram: config.fluxSpecifics.ram[tier.capsKey] - config.lockedSystemResources.ram,
    hdd: config.fluxSpecifics.hdd[tier.capsKey] - config.lockedSystemResources.hdd,
  };
  try {
    const needs = hwRequirements.totalAppHWRequirements(appSpecifications, tier.hwTier);
    if (!Number.isFinite(needs.cpu) || !Number.isFinite(needs.ram) || !Number.isFinite(needs.hdd)) {
      return true; // spec carries no sizing - cannot prove it does not fit
    }
    return needs.cpu * 10 <= caps.cpu && needs.ram <= caps.ram && needs.hdd <= caps.hdd;
  } catch (error) {
    log.warn(`placementFeasibility - could not size app for tier ${listTier}: ${error.message}`);
    return true;
  }
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
  const tableAvailable = ipLocationTable.hasTable();
  const geoRestricted = (appSpecifications.geolocation ?? []).length > 0;

  const domains = new Map(); // fault domain -> candidate count
  let candidateCount = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const node of nodeList) {
    const ip = bareIp(node.ip);
    if (!ip) continue; // eslint-disable-line no-continue
    if (!appFitsTier(appSpecifications, node.tier)) continue; // eslint-disable-line no-continue
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
 * Warn when a user-facing registration or update path accepts a synced app
 * whose requested geography cannot spread its instances. Called from the API
 * front door only - never from p2p message verification, where nodes with
 * different table versions must not disagree about message validity.
 * @param {object} appSpecFormatted Formatted app specifications
 * @param {string} caller Log prefix identifying the calling path
 * @returns {Promise<object|null>} The feasibility, or null when not applicable
 */
async function warnOnConstrainedPlacement(appSpecFormatted, caller) {
  try {
    const synced = appSpecFormatted.version <= 3
      ? mountParser.isSyncedComponent(appSpecFormatted.containerData)
      : (appSpecFormatted.compose ?? []).some((component) => mountParser.isSyncedComponent(component.containerData));
    if (!synced) return null;
    const feasibility = await placementFeasibility(appSpecFormatted);
    if (feasibility.candidateCount < feasibility.instances) {
      log.warn(`${caller} - App ${appSpecFormatted.name} requests ${feasibility.instances} instances but only ${feasibility.candidateCount} eligible nodes exist for its geolocation and tier`);
    } else if (feasibility.domainCount < feasibility.instances) {
      log.warn(`${caller} - App ${appSpecFormatted.name} requests ${feasibility.instances} instances across ${feasibility.domainCount} fault domain(s); synced instances will co-locate up to ${feasibility.maxPerDomain} per domain`);
    }
    return feasibility;
  } catch (error) {
    log.warn(`${caller} - placement feasibility check failed: ${error.message}`);
    return null;
  }
}

/**
 * API handler: POST /apps/placementfeasibility
 * Body: { instances, geolocation?, compose? | containerData?, hw fields... }.
 * Answers the deploy form's question before payment: how many fault domains
 * does this geography span, and how many instances can it truly hold.
 * @param {object} req Request
 * @param {object} res Response
 */
async function placementFeasibilityAPI(req, res) {
  try {
    const spec = req.body ?? {};
    const instances = serviceHelper.ensureNumber(spec.instances ?? config.fluxapps.minimumInstances);
    if (!Number.isInteger(instances) || instances < 1 || instances > config.fluxapps.maximumInstances) {
      throw new Error('Invalid instances specified');
    }
    const geolocation = spec.geolocation ?? [];
    if (!Array.isArray(geolocation) || geolocation.some((entry) => typeof entry !== 'string' || entry.length > 50)) {
      throw new Error('Invalid geolocation specified');
    }
    let synced = true;
    if (Array.isArray(spec.compose)) {
      synced = spec.compose.some((component) => mountParser.isSyncedComponent(component?.containerData));
    } else if (typeof spec.containerData === 'string') {
      synced = mountParser.isSyncedComponent(spec.containerData);
    }
    const feasibility = await placementFeasibility({ geolocation, instances }, instances);
    const response = messageHelper.createDataMessage({
      ...feasibility,
      syncedApp: synced,
      // diversity below the requested count: some fault domain must hold more than one instance
      constrained: synced && feasibility.domainCount < feasibility.instances,
      // with the water-filled share, any count up to the candidate pool is reachable
      satisfiable: feasibility.candidateCount >= feasibility.instances,
    });
    res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errorResponse);
  }
}

module.exports = {
  faultDomain,
  nodeLocationMatchesGeolocation,
  appFitsTier,
  placementFeasibility,
  countHeldInDomain,
  isNodePinnedHere,
  warnOnConstrainedPlacement,
  placementFeasibilityAPI,
};
