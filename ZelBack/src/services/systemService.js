const fs = require('node:fs/promises');

const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

/**
 * The running interval to check when syncthing was updated
 */
let timer = null;

/**
 * The last time syncthing was attepted to be installed
 */
let lastUpgradeAttempt = 0;

/**
 * For testing
 */
function resetTimer() {
  clearInterval(timer);
  timer = null;
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
 * @returns {Promise<string>}
 */
async function getPackageVersion(package) {
  const { stdout, error } = await serviceHelper.runCommand('dpkg-query', { runAsRoot: true, logError: false, params: ["--showformat='${Version}'", '--show', package] });

  if (error) return '';

  return stdout.replace(/'/g, '');
}

/**
 * Updates the apt cache and installs latest version of syncthing
 * @returns {Promise<Boolean>} If there was an error
 */
async function upgradeSyncthing() {
  const now = Date.now();
  const oneHour = 3600 * 1000;

  if (lastUpgradeAttempt + oneHour > now) return;

  const updateError = await updateAptCache();
  if (updateError) return true;

  const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['install', 'syncthing'] });
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

/**
 * Checks daily if syncthing is updated (and updates apt cache)
 * If it hasn't been updated in the last 30 days, will install
 * latest version
 * @returns {Promise<void>}
 */
async function monitorSyncthingPackage() {
  if (timer) return;

  const oneDay = 86400 * 1000;

  const checkPackage = async () => {
    const currentVersion = getPackageVersion('syncthing');

    if (!currentVersion) {
      await upgradeSyncthing();
      return;
    }

    const versionOk = minVersionSatisfy(currentVersion, config.minimumSyncthingAllowedVersion)

    if (versionOk) return;

    const upgradeError = await upgradeSyncthing();
    if (!upgradeError) {
      log.info('Syncthing is on the latest version');
    }
  }

  await checkPackage();
  timer = setInterval(checkPackage, oneDay);
};

/**
 * @returns {Promise<void>}
 */
async function monitorSystem() {
  await monitorSyncthingPackage();
}

if (require.main === module) {
  // upgradeSyncthing().then((res) => console.log('Error:', res));
  getPackageVersion('blah').then(res => { console.log("Version:", res) });
}

module.exports = {
  getPackageVersion,
  monitorSyncthingPackage,
  monitorSystem,
  // testing exports
  cacheUpdateTime,
  resetTimer,
  updateAptCache,
  upgradeSyncthing,
};
