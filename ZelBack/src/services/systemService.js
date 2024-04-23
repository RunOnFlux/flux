const fs = require('node:fs/promises');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

/**
 * The running interval to check when syncthing was updated
 */
let timer = null;

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
 * Updates the apt cache and installs latest version of syncthing
 * @returns {Promise<Boolean>} If there was an error
 */
async function upgradeSyncthing() {
  const updateError = await updateAptCache();
  if (updateError) return true;

  const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['install', 'syncthing'] });
  return Boolean(error);
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
  let lastUpdate = 0;

  const runUpdate = async () => {
    const now = Date.now();
    if (lastUpdate + 30 * oneDay < now) {
      const upgradeError = await upgradeSyncthing();
      if (!upgradeError) {
        lastUpdate = now;
        log.info('Syncthing is on the latest version');
      }
    }
  };

  if (!lastUpdate) await runUpdate();
  timer = setInterval(runUpdate, oneDay);
}

if (require.main === module) {
  upgradeSyncthing().then((res) => console.log('Error:', res));
}

module.exports = {
  monitorSyncthingPackage,
  // testing exports
  cacheUpdateTime,
  resetTimer,
  updateAptCache,
  upgradeSyncthing,
};
