const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const globalState = require('./globalState');

const FILE = 'enterprisenodes.json';
const URL = `${config.policy.baseUrl}/${FILE}`;

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 10 * 1000; // bound the github fetch so boot is never stuck on it

// Maps each enterprise node pubkey to the app-owner addresses allowed to install on it
// (many-to-many: an owner may appear under several nodes).
//
// `null` means this node has NOT obtained the map, and is not the same as an empty map.
// Every lookup below answers null in that state rather than an empty result, because the
// two are indistinguishable downstream and only one of them is a fact: `{}` says nobody is
// an enterprise node, absence says we do not know yet. Answering the first when the second
// is true is what let a node decide it was not an enterprise node, fill up with apps it must
// not host, and then have them removed from under it by the ownership sweep.
//
// Replaced only by a fetch that returns a valid payload; a failed or invalid fetch leaves the
// previous value, so the relationships can be edited live with no release.
let nodeOwnerMap = null;

let syncInterval = null;

// Memoized union of all owners. Rebuilt only when nodeOwnerMap is replaced, keyed by
// reference: the map is always reassigned wholesale, never mutated in place, so reference
// identity is a sound invalidation signal.
let ownersUnionCache = null;
let ownersUnionCacheKey = null;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A valid node->owners map is a plain object whose every value is an array of
 * strings. Anything else (a non-array value, a non-string entry) is rejected
 * wholesale rather than silently coerced — a single malformed value would
 * otherwise make a node host nothing and uninstall everything.
 */
function isValidNodeOwnerMap(value) {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (owners) => Array.isArray(owners) && owners.every((owner) => typeof owner === 'string'),
  );
}

/** Whether the node->owners map has been obtained. False means unknown, never "empty". */
function isPolicyKnown() {
  return nodeOwnerMap !== null;
}

async function syncFromGithub() {
  try {
    const res = await serviceHelper.axiosGet(URL, { timeout: FETCH_TIMEOUT_MS });
    if (res && isValidNodeOwnerMap(res.data)) {
      nodeOwnerMap = res.data;
      globalState.policyReady = true;
      return true;
    }
    log.error(`enterpriseConfig - invalid ${FILE} payload from ${URL}, keeping current value`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to fetch ${FILE}, keeping current value: ${error.message}`);
  }
  return false;
}

/**
 * Fetch the map, then refresh every 6h. Safe to call multiple times (no-ops if already
 * started). Initialization is performed here (not as a side effect of require) so module
 * loading stays pure.
 *
 * There is deliberately no on-disk seed. A copy shipped in the release is frozen at the
 * moment that release was cut, and seeding from it made every restart begin by enforcing
 * a snapshot that may name the wrong nodes and the wrong owners — which the ownership
 * sweep then acts on five minutes later. Starting from "unknown" costs a node the ability
 * to acquire apps until the first fetch lands, and costs it nothing else.
 */
async function startSync() {
  if (syncInterval) return;
  await syncFromGithub();
  syncInterval = setInterval(() => {
    syncFromGithub().catch((error) => log.error(`enterpriseConfig - sync error: ${error.message}`));
  }, SYNC_INTERVAL_MS);
}

function stopSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/** The raw node-pubkey -> [ownerAddress] map, or null when the policy is unknown. */
function getEnterpriseNodeOwnerMap() {
  return nodeOwnerMap;
}

/** Every enterprise node pubkey, or null when the policy is unknown. */
function getEnterpriseNodesPublicKeys() {
  if (nodeOwnerMap === null) return null;
  return Object.keys(nodeOwnerMap);
}

/** Owners allowed to install on a node pubkey, or null when the policy is unknown. */
function getAllowedOwnersForNode(pubKey) {
  if (nodeOwnerMap === null) return null;
  const owners = nodeOwnerMap[pubKey];
  return Array.isArray(owners) ? owners : [];
}

/**
 * The global set of enterprise app owners: the deduped union of every node's allowed
 * owners, or null when the policy is unknown. Used for node-agnostic checks (datacenter
 * validation, CPU burst eligibility, excluding enterprise apps from public nodes).
 */
function getEnterpriseAppOwners() {
  if (nodeOwnerMap === null) return null;
  if (ownersUnionCacheKey === nodeOwnerMap) return ownersUnionCache;
  const all = Object.values(nodeOwnerMap).filter(Array.isArray).flat();
  ownersUnionCache = [...new Set(all)];
  ownersUnionCacheKey = nodeOwnerMap;
  return ownersUnionCache;
}

module.exports = {
  getAllowedOwnersForNode,
  getEnterpriseAppOwners,
  getEnterpriseNodeOwnerMap,
  getEnterpriseNodesPublicKeys,
  isPolicyKnown,
  startSync,
  stopSync,
  syncFromGithub,
};
