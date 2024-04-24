const fs = require('node:fs/promises');
const axios = require('axios');

const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const fifoQueue = require('./utils/fifoQueue');

/**
 * The running interval to check when syncthing was updated
 */
let syncthingTimer = null;

/**
 * A FIFO queue used to store and run apt commands
 * @type {fifoQueue.FifoQueue}
 */
const aptQueue = new fifoQueue.FifoQueue()

/**
 *
 * @param {string} command
 * @param {Array<string>} userParams
 * @param {number} timeout
 */
async function aptRunner(options = {}) {
  const command = options.command;
  const userParams = [command, ...options.params];
  const timeout = options.timeout || 180;

  // using -o DPkg::Lock::Timeout=180, apt-get will wait for 3 minutes for a lock

  // I have only tested this on ubuntu 20.04
  // https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1053726
  // However, I think it only affects apt-get update, not install.
  const params = ['-o', `DPkg::Lock::Timeout=${timeout}`, ...userParams];
  const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params });

  // this is so this command can be retried by the worker runner
  if (error) throw error;

  log.info(`Command: apt-get ${userParams.join(' ')} ran successfully`)
  return { error: null }
}

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
 * @param {string} command The command to run
 * @param {Array<string>} params The params to pass to command
 * @param {{params?: Array, timeout?: number, retries?: number, wait?: Boolean}} options
 *
 * timeout: how many seconds to wait (60 default)
 * retries: how many times to retry (3 default)
 * wait: should the queue item be awaited
 *
 * @returns {Promise<void>}
 */
async function queueAptGetCommand(command, options = {}) {
  const params = options.params || [];

  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string')) {
    log.error('Malformed apt params. Must be an Array of strings... not running.')
    return;
  }

  const wait = options.wait || false;
  const commandOptions = { command, params, timeout: options.timeout }
  const workerOptions = { retries: options.retries }

  return aptQueue.push(wait, { command, params, commandOptions, workerOptions })
}

/**
 * Updates the apt cache, will only update if it hasn't
 * been updated within 24 hours.
 * @returns {Promise<Boolean>} If there was an error
 */
async function updateAptCache() {
  // for testing, if you want to reset the lastUpdate time, you can run:
  //  sudo touch -d '2007-01-31 8:46:26' /var/lib/apt/periodic/update-success-stamp
  const oneDay = 86400 * 1000;
  const lastUpdate = await cacheUpdateTime();

  if (lastUpdate + oneDay < Date.now()) {
    // update uses the /var/lib/apt/lists dir for a lock.
    // This isn't affected by the DPkg::Lock::Timeout option. It only
    // seems to care about the install /var/lib/dpkg/lock-frontend lock.
    //
    // We can still get a race condition if another entity on the system
    // updates the cache before us. In that instance, the command throws,
    // since this is just a cache update, we assume it was fine and don't retry.
    const { error } = await queueAptGetCommand('update', { wait: true, retries: 0 })
    if (!error) log.info('Apt Cache updated');
    return Boolean(error);
  }

  return false;
}

/**
 * Gets an installed packages version. This doesn't use the apt lock
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
  // we don't care about any errors here.
  await updateAptCache();

  const { error } = await queueAptGetCommand('install', { wait: true, params: [systemPackage] })
  return Boolean(error);
}

/**
 *  Makes sure the package version is above the minimum version provided
 * @param {string} systemPackage The package version to check
 * @param {string} version The minimum acceptable version
 * @returns {Promise<void>}
 */
async function ensurePackageVersion(systemPackage, version) {
  try {
    log.info(`Checking package ${systemPackage} is updated to version ${version}`);
    const currentVersion = await getPackageVersion(systemPackage);

    if (!currentVersion) {
      log.info(`Package ${systemPackage} not found on system`);
      await upgradePackage(systemPackage);
      return;
    }
    log.info(`Package ${systemPackage} version ${currentVersion} found`);
    const versionOk = serviceHelper.minVersionSatisfy(currentVersion, version);

    if (versionOk) return;

    const upgradeError = await upgradePackage(systemPackage);
    if (!upgradeError) {
      log.info(`${systemPackage} is on the latest version`);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Checks daily if syncthing is updated (and updates apt cache)
 * If it's not at least minimum version - it will be updated
 * latest version
 * @returns {Promise<void>}
 */
async function monitorSyncthingPackage() {
  try {
    if (syncthingTimer) return;

    let syncthingVersion = config.minimumSyncthingAllowedVersion;
    const axiosConfig = {
      timeout: 10000,
    };
    let response = await axios.get('https://stats.runonflux.io/getmodulesminimumversions', axiosConfig).catch((error) => log.error(error));
    if (response && response.data && response.data.status === 'success') {
      syncthingVersion = response.data.data.syncthing || config.minimumSyncthingAllowedVersion;
    }

    await ensurePackageVersion('syncthing', syncthingVersion);

    syncthingTimer = setInterval(async () => {
      syncthingVersion = config.minimumSyncthingAllowedVersion;
      response = await axios.get('https://stats.runonflux.io/getmodulesminimumversions', axiosConfig).catch((error) => log.error(error));
      if (response && response.data && response.data.status === 'success') {
        syncthingVersion = response.data.data.syncthing || config.minimumSyncthingAllowedVersion;
      }
      ensurePackageVersion('syncthing', syncthingVersion);
    }, 1000 * 60 * 60 * 24); // 24 hours
  } catch (error) {
    log.error(error);
  }
}

/**
 * @returns {Promise<void>}
 */
async function monitorSystem() {
  try {
    aptQueue.addWorker(aptRunner);
    await monitorSyncthingPackage();
  } catch (error) {
    log.error(error);
  }
}

if (require.main === module) {
  aptQueue.addWorker(aptRunner);
  // updateAptCache().then(res => {
  //   console.log("Cache update error:", res)
  // })
  upgradePackage('syncthing').then(res => {
    console.log("Package upgrade error:", res)
  })
}

module.exports = {
  getPackageVersion,
  monitorSyncthingPackage,
  monitorSystem,
  queueAptGetCommand,
  // testing exports
  cacheUpdateTime,
  resetTimer,
  updateAptCache,
  upgradePackage,
  ensurePackageVersion,
};
