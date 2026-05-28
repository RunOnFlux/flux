const config = require('config');
const fs = require('fs');
const path = require('path');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

// helpers/ lives at the repo root, four levels up from this file.
const HELPERS_DIR = path.join(__dirname, '..', '..', '..', '..', 'helpers');

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Each list ships as a JSON array in helpers/ (the on-disk fallback) and is
// re-synced from the same path on GitHub. `value` is the in-memory copy served
// to callers: seeded from disk at load, then replaced only when a GitHub fetch
// succeeds. A failed fetch leaves the previous value in place (disk on the first
// run, last-good thereafter).
const lists = {
  appOwners: {
    file: 'enterpriseappowners.json',
    url: `${config.github.rawBaseUrl}/helpers/enterpriseappowners.json`,
    value: [],
  },
  nodesPublicKeys: {
    file: 'enterprisenodespublickeys.json',
    url: `${config.github.rawBaseUrl}/helpers/enterprisenodespublickeys.json`,
    value: [],
  },
};

let syncInterval = null;

function readListFromDisk(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(HELPERS_DIR, file), 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    log.warn(`enterpriseConfig - ${file} is not a JSON array, ignoring`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to read ${file} from disk: ${error.message}`);
  }
  return null;
}

// Seed synchronously at load so getters always return data, even before the
// first GitHub sync runs or if it never succeeds.
Object.values(lists).forEach((entry) => {
  const onDisk = readListFromDisk(entry.file);
  if (onDisk) entry.value = onDisk;
});

async function syncList(entry) {
  try {
    const res = await serviceHelper.axiosGet(entry.url);
    if (res && Array.isArray(res.data)) {
      entry.value = res.data;
      return true;
    }
    log.warn(`enterpriseConfig - unexpected response shape from ${entry.url}, keeping current ${entry.file}`);
  } catch (error) {
    log.warn(`enterpriseConfig - failed to fetch ${entry.file} from github, keeping current value: ${error.message}`);
  }
  return false;
}

async function syncFromGithub() {
  await Promise.all(Object.values(lists).map((entry) => syncList(entry)));
}

/**
 * Run an immediate GitHub sync, then refresh every 6h. Safe to call multiple
 * times (no-ops if already started). Getters work before this runs because the
 * lists are seeded from disk at module load.
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

function getEnterpriseAppOwners() {
  return lists.appOwners.value;
}

function getEnterpriseNodesPublicKeys() {
  return lists.nodesPublicKeys.value;
}

module.exports = {
  getEnterpriseAppOwners,
  getEnterpriseNodesPublicKeys,
  startSync,
  stopSync,
  syncFromGithub,
};
