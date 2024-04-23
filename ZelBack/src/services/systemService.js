const fs = require('node:fs/promises');
const axios = require('axios');

const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

/**
 * The running interval to check when syncthing was updated
 */
let syncthingTimer = null;

/**
 * For testing
 */
function resetTimer() {
  clearInterval(syncthingTimer);
  syncthingTimer = null;
}

/**
 *  Gets the last time the cache was updated. This is a JS port
 * of how Ansible (python) does it, except this falls back to 0
 * if neither file found
 * @returns {Promise<number>}
 */
async function cacheUpdateTime() {
  const stampPath = '/var/lib/apt/periodic/update-success-stamp';
  const listsPath = '/var/lib/apt/lists';

  const stampStat = await fs.stat(stampPath).catch(() => null);

  if (!stampStat) {
    const listsStat = await fs.stat(listsPath).catch(() => ({ mtimeMs: 0 }));
    return listsStat.mtimeMs;
  }

  return stampStat.mtimeMs;
}

/**
 * Updates the apt cache, will only update if it hasn't
 * been updated within 24 hours
 * @returns {Promise<Boolean>} If there was an error
 */
async function updateAptCache() {
  const oneDay = 86400 * 1000;
  const lastUpdate = await cacheUpdateTime();

  if (lastUpdate + oneDay < Date.now()) {
    const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['update'] });
    if (!error) log.info('Apt Cache updated');
    return Boolean(error);
  }

  return false;
}

/**
 * Gets an installed packages version
 * @param systemPackage the target package to check
 * @returns {Promise<string>}
 */
async function getPackageVersion(systemPackage) {
  // eslint-disable-next-line no-template-curly-in-string
  const { stdout, error } = await serviceHelper.runCommand('dpkg-query', { runAsRoot: true, logError: false, params: ["--showformat='${Version}'", '--show', systemPackage] });

  if (error) return '';

  const parsed = serviceHelper.parseVersion(stdout.replace(/'/g, ''));

  if (parsed) {
    return parsed.version;
  }

  return '';
}

/**
 * Updates the apt cache and installs latest version of package
 * @param {string} package The package to update
 * @returns {Promise<Boolean>} If there was an error
 */
async function upgradePackage(systemPackage) {
  const updateError = await updateAptCache();
  if (updateError) return true;

  const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['install', systemPackage] });
  return Boolean(error);
}

/**
 *  Makes sure the package version is above the minimum version provided
 * @param {string} systemPackage The package version to check
 * @param {string} version The minimum acceptable version
 * @returns {Promise<void>}
 */
async function ensurePackageVersion(systemPackage, version) {
  const currentVersion = await getPackageVersion(systemPackage);

  if (!currentVersion) {
    await upgradePackage(systemPackage);
    return;
  }

  const versionOk = serviceHelper.minVersionSatisfy(currentVersion, version);

  if (versionOk) return;

  const upgradeError = await upgradePackage(systemPackage);
  if (!upgradeError) {
    log.info(`${systemPackage} is on the latest version`);
  }
}

/**
 * Checks daily if syncthing is updated (and updates apt cache)
 * If it's not at least minimum version - it will be updated
 * latest version
 * @returns {Promise<void>}
 */
async function monitorSyncthingPackage() {
  if (syncthingTimer) return;

  let syncthingVersion = config.minimumSyncthingAllowedVersion;
  let response = await axios.get('https://stats.runonflux.io/getmodulesminimumversions').catch((error) => log.error(error));
  if (response && response.data && response.data.status === 'success') {
    syncthingVersion = response.data.data.syncthing || config.minimumSyncthingAllowedVersion;
  }

  await ensurePackageVersion('syncthing', syncthingVersion);

  syncthingTimer = setInterval(async () => {
    syncthingVersion = config.minimumSyncthingAllowedVersion;
    response = await axios.get('https://stats.runonflux.io/getmodulesminimumversions').catch((error) => log.error(error));
    if (response && response.data && response.data.status === 'success') {
      syncthingVersion = response.data.data.syncthing || config.minimumSyncthingAllowedVersion;
    }
    ensurePackageVersion('syncthing', syncthingVersion);
  }, 1000 * 60 * 60 * 24); // 24 hours
}

/**
 * @returns {Promise<void>}
 */
async function monitorSystem() {
  await monitorSyncthingPackage();
}

module.exports = {
  getPackageVersion,
  monitorSyncthingPackage,
  monitorSystem,
  // testing exports
  cacheUpdateTime,
  resetTimer,
  updateAptCache,
  upgradePackage,
  ensurePackageVersion,
};
