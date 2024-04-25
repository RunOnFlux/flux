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
 * The running timeout to see if apt-cache is okay
 */
let aptCacheTimer = null;


/**
 * A FIFO queue used to store and run apt commands
 * @type {fifoQueue.FifoQueue}
 */
const aptQueue = new fifoQueue.FifoQueue()

/**
 * Runs an apt command, by default for any install commands, it will
 * use the native lock waiter and wait for 3 minutes, retrying 5 times.
 * For a total of 15 minutes + 50 seconds until failure.
 * @param {string} command
 * @param {Array<string>} userParams
 * @param {number} timeout
 */
async function aptRunner(options = {}) {
  const command = options.command;
  const userParams = [command, ...options.params];
  const timeout = options.timeout || 180;

  // using -o DPkg::Lock::Timeout=180, apt-get will wait for 3 minutes for a lock

  // I have teste this on 20.04, 22.04 and Debian 12
  // https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1053726
  // This might affect arm, but I don't have an arm to test with.

  // any apt after 1.9.11 has this option.
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
 * @param {{params?: Array, timeout?: number, retries?: number, wait?: Boolean}} options
 *
 * params: params to pass to command
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

  return aptQueue.push(wait, { commandOptions, workerOptions })
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
    // You can run apt-get update and apt-get install at the same time - they
    // don't affect each other.
    //
    // However, apt-get check will fail if apt-get install is hung.
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
 * If it's not at least minimum version - it will be updated to the
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

async function monitorAptCache(event) {
  if (aptCacheTimer) return;

  const { options, error } = event;

  // we don't care about apt-get update error, most likely
  // apt-get update was already running (this uses a different lock
  // thab apt-get install)
  if (options.command === 'update') {
    aptQueue.resume();
    return;
  }

  // if we are here and it is a default install command,
  // it took 15 minutes to fail. (unless the lock wait wasn't working
  // on arm or apt older than 1.9.11 or something. Then it took ~50 seconds)

  // can get multiple error messages here? Don't allways get the pid.

  // E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 1427823 (apt-get)
  // N: Be aware that removing the lock file is not a solution and may break your system.
  // E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), is another process using it?

  let nonLockError = null;
  // check the error message. This is brittle, as it is dependent on
  // apt-get not changing output etc.
  if (!error.message.includes('/var/lib/dpkg/lock-frontend')) {
    nonLockError = error;
  }

  // wait a further 30 minutes for lock to release. (seems a long time?)
  let retriesRemaining = 3;

  while (!nonLockError && retriesRemaining) {
    retriesRemaining -= 1;
    // 10 minutes
    await serviceHelper.delay(10 * 60 * 1000);
    const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['check'] });
    if (!error) break;

    if (!error.message.includes('/var/lib/dpkg/lock-frontend')) {
      // this will break loop
      nonLockError = error;
    }
  }

  if (nonLockError) {
    // we have another error, and it's not a lock. Try dpkg configure as
    // a last resort.
    await serviceHelper.runCommand('dpkg', { runAsRoot: true, params: ['--configure', '-a'] });
  }

  // check if we can resume
  const { error: checkError } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['check'] });

  if (!checkError) {
    aptCacheTimer = null;
    aptQueue.resume();
    return;
  }

  log.error('Unable to run apt-get command(s), all apt activities are halted, will resume in 12 hours');
  aptCacheTimer = setTimeout(() => aptQueue.resume(), 1000 * 3600 * 12)
}

/**
 * @returns {Promise<void>}
 */
async function monitorSystem() {
  try {
    aptQueue.addWorker(aptRunner);
    aptQueue.on('failed', monitorAptCache);

    // don't await these, let the queue deal with it

    // 20.04 == 1.206
    // 22.04 == 1.218
    // Debian 12 = 1.219
    ensurePackageVersion('netcat-openbsd', '1.206');
    monitorSyncthingPackage();
  } catch (error) {
    log.error(error);
  }
}

if (require.main === module) {
  aptQueue.addWorker(aptRunner);
  aptQueue.on('failed', monitorAptCache);
  // updateAptCache().then(res => {
  //   console.log("Cache update error:", res)
  // })
  // upgradePackage('syncthing').then(res => {
  //   console.log("Package upgrade error:", res)
  // })
  monitorSystem();
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
