const fs = require('node:fs/promises');

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
  const oneDay = 86400;
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
 * @param package the target package to check
 * @returns {Promise<string>}
 */
async function getPackageVersion(package) {
  const { stdout, error } = await serviceHelper.runCommand('dpkg-query', { runAsRoot: true, logError: false, params: ["--showformat='${Version}'", '--show', package] });

  if (error) return '';

  return stdout.replace(/'/g, '');
}

/**
 * Updates the apt cache and installs latest version of package
 * @param {string} package The package to update
 * @returns {Promise<Boolean>} If there was an error
 */
async function upgradePackage(package) {
  const updateError = await updateAptCache();
  if (updateError) return true;

  const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['install', package] });
  return Boolean(error);
}

/**
 * Check if semantic version is bigger or equal to minimum version
 * @param {string} targetVersion Version to check
 * @param {string} minimumVersion minimum version that version must meet
 * @returns {boolean} True if version is equal or higher to minimum version otherwise false.
 */
function minVersionSatisfy(targetVersion, minimumVersion) {
  // remove any leading character that is not a digit i.e. v1.2.6 -> 1.2.6
  const version = targetVersion.replace(/[^\d.]/g, '');

  const splittedVersion = version.split('.');
  const major = Number(splittedVersion[0]);
  const minor = Number(splittedVersion[1]);
  const patch = Number(splittedVersion[2]);

  const splittedVersionMinimum = minimumVersion.split('.');
  const majorMinimum = Number(splittedVersionMinimum[0]);
  const minorMinimum = Number(splittedVersionMinimum[1]);
  const patchMinimum = Number(splittedVersionMinimum[2]);
  if (major < majorMinimum) {
    return false;
  }
  if (major > majorMinimum) {
    return true;
  }
  if (minor < minorMinimum) {
    return false;
  }
  if (minor > minorMinimum) {
    return true;
  }
  if (patch < patchMinimum) {
    return false;
  }
  return true;
}

async function ensurePackageVersion(package, version) {
  const currentVersion = getPackageVersion(package);

  if (!currentVersion) {
    await upgradePackage();
    return;
  }

  const versionOk = minVersionSatisfy(currentVersion, version)

  if (versionOk) return;

  const upgradeError = await upgradePackage(package);
  if (!upgradeError) {
    log.info(`${package} is on the latest version`);
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

  let minimumSyncthingAllowedVersion = config.minimumSyncthingAllowedVersion;
  const response = await axios.get('https://stats.runonflux.io/getmodulesminimumversions', axiosConfig).catch((error) => log.error(error));
  if (response && response.data && response.data.status === 'success') {
    minimumSyncthingAllowedVersion = response.data.data.syncthing || config.minimumSyncthingAllowedVersion;
  }

  await ensurePackageVersion('syncthing', minimumSyncthingAllowedVersion);

  syncthingTimer = setInterval(async () => {
    let minimumSyncthingAllowedVersion = config.minimumSyncthingAllowedVersion;
    const response = await axios.get('https://stats.runonflux.io/getmodulesminimumversions', axiosConfig).catch((error) => log.error(error));
    if (response && response.data && response.data.status === 'success') {
      minimumSyncthingAllowedVersion = response.data.data.syncthing || config.minimumSyncthingAllowedVersion;
    }
    ensurePackageVersion('syncthing', minimumSyncthingAllowedVersion);
  }, 1000 * 60 * 60 * 24); // 24 hours
};

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
