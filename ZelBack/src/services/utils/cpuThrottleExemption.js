const log = require('../../lib/log');
const policyStore = require('../policyStore');

// Which apps the CPU throttle leaves at their full specified allocation, read from the signed
// policy bundle. The document lists app name prefixes: the ones the games hub, and the
// dedicated sites before it, write for the game servers they deploy (mostly the lowercased
// marketplace name). Every one of them names a server `<prefix><Date.now()>`, so a prefix alone
// is not enough to qualify -- the rest of the name must be exactly that millisecond timestamp,
// and a plausible one.
//
// Game servers are exempt because a game's tick is a latency budget, not a throughput job.
// Taking 20% of a saturated server's cpu does not slow it down evenly, it makes every tick that
// overruns the budget arrive late, which players feel as lag and rubber-banding. The throttle
// then never lets go: it measures load against the reduced allocation, so a server that was
// saturated stays saturated, and stays at 80%.
//
// Exemption only ever holds an app at what its owner specified and paid for. It never grants
// more, so a name that qualifies without being a game gains nothing it was not already owed.
//
// Unknown policy answers "not exempt": the throttle is the default, and a node that has not read
// policy keeps doing what it did before this document existed.

const DOCUMENT = 'cputhrottleexempt';

// Date.now() in milliseconds is 13 digits from 2001 until the year 2286.
const TIMESTAMP_DIGITS = 13;
// The earliest game server the hub, or the dedicated sites before it, could have named.
const EARLIEST_TIMESTAMP_MS = Date.UTC(2023, 0, 1);
// A name is minted in the customer's browser before registration, so its timestamp can sit a
// little ahead of this node's clock. A day absorbs any skew; beyond that it is not a timestamp.
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

const PREFIX_PATTERN = /^[a-z0-9]+$/;

// Memoized prefix set, keyed by the document it was built from. The store hands back the same
// object until it adopts a new bundle, so reference identity is a sound signal.
let prefixCache = null;
let prefixCacheKey = null;

/**
 * A valid document is an array of lowercase alphanumeric prefixes.
 *
 * Still checked even though the bundle is signed: a signature says who published a document,
 * not that it is the shape this code expects.
 */
function isValidPrefixList(value) {
  return Array.isArray(value)
    && value.every((prefix) => typeof prefix === 'string' && PREFIX_PATTERN.test(prefix));
}

/**
 * The exempt prefixes as a Set, or null when the policy is unknown or malformed.
 * @returns {Set<string>|null}
 */
function getExemptPrefixes() {
  const document = policyStore.getDocument(DOCUMENT);
  if (document === null) return null;
  if (prefixCacheKey === document) return prefixCache;
  // The verdict is cached either way. A malformed document is asked about once per app per
  // throttle pass, and logging each time would bury the one line that matters.
  prefixCacheKey = document;
  if (!isValidPrefixList(document)) {
    log.error(`cpuThrottleExemption - ${DOCUMENT} in the signed bundle is not an array of lowercase alphanumeric prefixes`);
    prefixCache = null;
    return null;
  }
  prefixCache = new Set(document);
  return prefixCache;
}

/**
 * Whether an app is a hub game server the CPU throttle must leave alone.
 *
 * The timestamp is the last 13 characters, and the prefix is everything before them. Splitting
 * from the end rather than matching the prefix first is what keeps a prefix that itself ends in
 * a digit (eurotrucksimulator2) unambiguous, and keeps one prefix from claiming another's apps
 * (rustserver does not cover rustserveroxide; each is listed on its own).
 * @param {string} appName - The application name
 * @param {number} [now] - The current time in ms, for tests
 * @returns {boolean}
 */
function isCpuThrottleExempt(appName, now = Date.now()) {
  if (typeof appName !== 'string' || appName.length <= TIMESTAMP_DIGITS) return false;
  const prefixes = getExemptPrefixes();
  if (prefixes === null || prefixes.size === 0) return false;

  const name = appName.toLowerCase();
  const timestamp = name.slice(-TIMESTAMP_DIGITS);
  if (!/^\d+$/.test(timestamp)) return false;
  const ms = Number(timestamp);
  if (ms < EARLIEST_TIMESTAMP_MS || ms > now + FUTURE_TOLERANCE_MS) return false;

  return prefixes.has(name.slice(0, -TIMESTAMP_DIGITS));
}

module.exports = {
  getExemptPrefixes,
  isCpuThrottleExempt,
};
