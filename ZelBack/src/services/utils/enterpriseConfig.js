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

// Maps each enterprise node pubkey to the app-owner addresses allowed to install
// on it (many-to-many: an owner may appear under several nodes). `nodeOwnerMap`
// is the in-memory copy served to callers: seeded from helpers/enterprisenodes.json
// on disk at load, then replaced only when a GitHub fetch succeeds. A failed or
// invalid fetch leaves the previous map in place (disk on the first run, last-good
// thereafter), so the relationships can be edited live on GitHub with no release.
let nodeOwnerMap = {};

let syncInterval = null;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMapFromDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(HELPERS_DIR, FILE), 'utf8'));
    if (isPlainObject(parsed)) return parsed;
    log.warn(`enterpriseConfig - ${FILE} is not a JSON object, ignoring`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to read ${FILE} from disk: ${error.message}`);
  }
  return null;
}

// Seed synchronously at load so getters always return data, even before the
// first GitHub sync runs or if it never succeeds.
const onDisk = readMapFromDisk();
if (onDisk) nodeOwnerMap = onDisk;

async function syncFromGithub() {
  try {
    const res = await serviceHelper.axiosGet(URL);
    if (res && isPlainObject(res.data)) {
      nodeOwnerMap = res.data;
      return true;
    }
    log.warn(`enterpriseConfig - unexpected response shape from ${URL}, keeping current ${FILE}`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to fetch ${FILE} from github, keeping current value: ${error.message}`);
  }
  return false;
}

/**
 * Run an immediate GitHub sync, then refresh every 6h. Safe to call multiple
 * times (no-ops if already started). Getters work before this runs because the
 * map is seeded from disk at module load.
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
 * burst eligibility, excluding enterprise apps from public nodes).
 */
function getEnterpriseAppOwners() {
  const all = Object.values(nodeOwnerMap).filter(Array.isArray).flat();
  return [...new Set(all)];
}

module.exports = {
  getAllowedOwnersForNode,
  getEnterpriseAppOwners,
  getEnterpriseNodeOwnerMap,
  getEnterpriseNodesPublicKeys,
  startSync,
  stopSync,
  syncFromGithub,
};
