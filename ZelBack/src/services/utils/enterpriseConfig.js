const config = require('config');
const fs = require('fs');
const path = require('path');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

// helpers/ lives at the repo root, four levels up from this file.
const HELPERS_DIR = path.join(__dirname, '..', '..', '..', '..', 'helpers');
const FILE = 'enterprisenodes.json';
const URL = `${config.github.rawBaseUrl}/helpers/${FILE}`;

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 10 * 1000; // bound the github fetch so boot is never stuck on it

// Maps each enterprise node pubkey to the app-owner addresses allowed to install
// on it (many-to-many: an owner may appear under several nodes). `nodeOwnerMap`
// is the in-memory copy served to callers: seeded from helpers/enterprisenodes.json
// on disk by startSync(), then replaced only when a GitHub fetch succeeds with a
// valid payload. A failed or invalid fetch leaves the previous map in place (disk
// on the first run, last-good thereafter), so the relationships can be edited live
// on GitHub with no release.
let nodeOwnerMap = {};

let syncInterval = null;

// Memoized union of all owners (finding #6). Rebuilt only when nodeOwnerMap is
// replaced, keyed by reference: the map is always reassigned wholesale, never
// mutated in place, so reference identity is a sound invalidation signal.
let ownersUnionCache = null;
let ownersUnionCacheKey = null;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A valid node->owners map is a plain object whose every value is an array of
 * strings. Anything else (a non-array value, a non-string entry) is rejected
 * wholesale rather than silently coerced — a single malformed value would
 * otherwise make a node host nothing and uninstall everything (finding #2).
 */
function isValidNodeOwnerMap(value) {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (owners) => Array.isArray(owners) && owners.every((owner) => typeof owner === 'string'),
  );
}

async function readMapFromDisk() {
  try {
    const raw = await fs.promises.readFile(path.join(HELPERS_DIR, FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (isValidNodeOwnerMap(parsed)) return parsed;
    log.error(`enterpriseConfig - ${FILE} on disk is not a valid node->owners map, ignoring`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to read ${FILE} from disk: ${error.message}`);
  }
  return null;
}

async function syncFromGithub() {
  try {
    const res = await serviceHelper.axiosGet(URL, { timeout: FETCH_TIMEOUT_MS });
    if (res && isValidNodeOwnerMap(res.data)) {
      nodeOwnerMap = res.data;
      return true;
    }
    log.error(`enterpriseConfig - invalid ${FILE} payload from ${URL}, keeping current value`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to fetch ${FILE} from github, keeping current value: ${error.message}`);
  }
  return false;
}

/**
 * Seed the map from disk, run an immediate GitHub sync, then refresh every 6h.
 * Safe to call multiple times (no-ops if already started). The disk read and the
 * github fetch are both async and bounded, so awaiting this in startFluxFunctions
 * never blocks boot for more than the fetch timeout. Initialization is performed
 * here (not as a side effect of require) so module loading stays pure.
 */
async function startSync() {
  if (syncInterval) return;
  const onDisk = await readMapFromDisk();
  if (onDisk) nodeOwnerMap = onDisk;
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

/** The raw node-pubkey -> [ownerAddress] map. */
function getEnterpriseNodeOwnerMap() {
  return nodeOwnerMap;
}

/** Every enterprise node pubkey (the map keys). */
function getEnterpriseNodesPublicKeys() {
  return Object.keys(nodeOwnerMap);
}

/** Owner addresses allowed to install on a specific node pubkey. */
function getAllowedOwnersForNode(pubKey) {
  const owners = nodeOwnerMap[pubKey];
  return Array.isArray(owners) ? owners : [];
}

/**
 * The global set of enterprise app owners: the deduped union of every node's
 * allowed owners. Used for node-agnostic checks (datacenter validation, CPU
 * burst eligibility, excluding enterprise apps from public nodes). Memoized and
 * invalidated whenever nodeOwnerMap is replaced (finding #6).
 */
function getEnterpriseAppOwners() {
  if (ownersUnionCacheKey === nodeOwnerMap) return ownersUnionCache;
  const all = Object.values(nodeOwnerMap).filter(Array.isArray).flat();
  ownersUnionCache = [...new Set(all)];
  ownersUnionCacheKey = nodeOwnerMap;
  return ownersUnionCache;
}

/**
 * Whether an app owner is in the enterprise app owners whitelist (the deduped
 * union of every node's allowed owners). A convenience predicate over
 * getEnterpriseAppOwners(); called by the CPU-burst eligibility gate and the v8
 * enterprise stop-gaps (telemetry + graceful shutdown) in dockerService.appDockerCreate.
 * @param {string} owner - app owner address
 * @returns {boolean}
 */
function isEnterpriseOwner(owner) {
  return getEnterpriseAppOwners().includes(owner);
}

module.exports = {
  getAllowedOwnersForNode,
  getEnterpriseAppOwners,
  isEnterpriseOwner,
  getEnterpriseNodeOwnerMap,
  getEnterpriseNodesPublicKeys,
  startSync,
  stopSync,
  syncFromGithub,
};
