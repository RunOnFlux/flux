const fs = require('node:fs/promises');
// we do this for node 14.18.1... it doesn't have constants on fs/promises
const { constants: fsConstants } = require('node:fs');

const os = require('node:os');
const path = require('node:path');

const axios = require('axios');
const yaml = require('js-yaml');
const config = require('config');
const hash = require('object-hash');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const fifoQueue = require('./utils/fifoQueue');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');

/**
 * The running interval to check when syncthing was updated
 */
let syncthingTimer = null;

/**
 * A FIFO queue used to store and run apt commands
 * @type {fifoQueue.FifoQueue}
 */
const aptQueue = new fifoQueue.FifoQueue();

/**
 * For testing
 * @returns {fifoQueue.FifoQueue}
 */
function getQueue() {
  return aptQueue;
}

/**
 * Runs an apt command, by default for any install commands, it will
 * use the native lock waiter and wait for 3 minutes, retrying 5 times.
 * For a total of 15 minutes + 5 minutes until failure. (1 minute between retries)
 * However, Ubuntu 18 only has apt 1.6.14, so can't use the lock feature.
 * @param {{command: string, params: Array<string>, timeout?: number}} options
 * @returns {Promise<void>}
 */
async function aptRunner(options = {}) {
  const userParams = [options.command, ...options.params];
  const timeout = options.timeout || 180;

  // ubuntu 18.04 only has apt 1.6.14 (1.16.17 after upgrade) - so doesn't have Lock
  // timeout. It is safe to use as apt will just ignore it

  // using -o DPkg::Lock::Timeout=180, apt-get will wait for 3 minutes for a lock

  // I have teste this on 20.04, 22.04 and Debian 12
  // https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1053726
  // This might affect arm, but I don't have an arm to test with.

  // any apt after 1.9.11 has this option.
  const params = ['-o', `DPkg::Lock::Timeout=${timeout}`, ...userParams];
  const { error } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params });

  // this is so this command can be retried by the worker runner
  if (error) throw error;

  log.info(`Command: apt-get ${userParams.join(' ')} ran successfully`);
  return { error: null };
}

/**
 * For testing
 */
function resetTimers() {
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
 * @returns {Promise<Object | void>}
 */
async function queueAptGetCommand(command, options = {}) {
  const params = options.params || [];

  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string')) {
    log.error('Malformed apt params. Must be an Array of strings... not running.');
    return Promise.resolve();
  }

  const wait = options.wait || false;
  const commandOptions = { command, params, timeout: options.timeout };
  const workerOptions = { retries: options.retries };
  return aptQueue.push({ commandOptions, workerOptions }, wait);
}

/**
 * Updates the apt cache, will only update if it hasn't
 * been updated within 24 hours.
 * @param {{force?: Boolean}} options
 * @returns {Promise<Boolean>} If there was an error
 */
async function updateAptCache(options = {}) {
  const force = options.force || false;

  // for testing, if you want to reset the lastUpdate time, you can run:
  //  sudo touch -d '2007-01-31 8:46:26' /var/lib/apt/periodic/update-success-stamp
  const oneDay = 86400 * 1000;
  const lastUpdate = await cacheUpdateTime();

  if (force || lastUpdate + oneDay < Date.now()) {
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
    const { error } = await queueAptGetCommand('update', { wait: true, retries: 0, retainErrors: false });
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
  const { stdout, error } = await serviceHelper.runCommand('dpkg-query', {
    logError: false,
    // eslint-disable-next-line no-template-curly-in-string
    params: ["--showformat='${Version}|${Status}'", '--show', systemPackage],
  });

  if (error) return '';

  // At this point, we should just write a /var/lib/dpkg/status parser and do it ourselves,
  // Wouldn't take that much effort. The file is world readable.

  // response should be in this format '1.27.6:install ok installed'

  // Uninstalled but still with config files (without purge) show status of:
  //  deinstall ok config-files

  if (!stdout || !stdout.includes('|')) return '';

  const [version, status] = stdout.replace(/'/g, '').split('|');

  if (status !== 'install ok installed') return '';

  // The version format is: [epoch:]upstream_version[-debian_revision]

  const parsedVersion = serviceHelper.parseVersion(version);

  if (parsedVersion) {
    return parsedVersion.version;
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

  const { error } = await queueAptGetCommand('install', { wait: true, params: [systemPackage] });
  return Boolean(error);
}

/**
 * Downloads a gpg key and stores it in /usr/share/keyrings
 * @param {string} url  The url to fetch the key from
 * @param {string} keyringName The name of the keyring file
 * @returns {Promise<Boolean>} If the add action was successful
 */
async function addGpgKey(url, keyringName) {
  let keyring = '';

  let remainingAttempts = 3;
  while (!keyring && remainingAttempts) {
    remainingAttempts -= 1;
    // eslint-disable-next-line no-await-in-loop
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 }).catch(async () => {
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(30 * 1000);
      return { data: null };
    });
    if (data) keyring = Buffer.from(data, 'binary');
  }

  if (!keyring) {
    log.error('Unable to fetch gpg keyring');
    return false;
  }

  const filePath = `/usr/share/keyrings/${keyringName}`;

  // this is a hack until we fork a small nodejs process with IPC as root for apt management / fs management (idea)
  // check /usr/share/keyrings is writeable
  // eslint-disable-next-line no-bitwise
  const keyringAccessError = await fs.access(path.dirname(filePath), fsConstants.R_OK | fsConstants.W_OK).catch(async () => {
    const user = os.userInfo().username;
    const { error } = await serviceHelper.runCommand('chown', { runAsRoot: true, params: [`${user}:${user}`, path.dirname(filePath)] });
    if (error) return true;

    return false;
  });

  if (keyringAccessError) return false;

  let success = true;
  // as long as the directory exists, this shouldn't error
  await fs.writeFile(filePath, keyring).catch((error) => {
    log.error(error);
    success = false;
  });

  return success;
}

async function addAptSource(packageName, url, dist, components, options = {}) {
  const source = options.source || 'deb';
  const opts = options.options || [];

  const targetItems = [source, url, dist, ...components];

  if (opts.length) {
    targetItems.splice(1, 0, `[ ${opts.join(' ')} ]`);
  }

  const target = `${targetItems.join(' ')}\n`;

  const filePath = `/etc/apt/sources.list.d/${packageName}.list`;

  // this is a hack until we fork a smaller nodejs process as root for apt management (idea)
  // check /etc/apt/sources.list.d is writeable
  // eslint-disable-next-line no-bitwise
  const sourcesAccessError = await fs.access(path.dirname(filePath), fsConstants.R_OK | fsConstants.W_OK).catch(async () => {
    const user = os.userInfo().username;
    const { error } = await serviceHelper.runCommand('chown', { runAsRoot: true, params: [`${user}:${user}`, path.dirname(filePath)] });
    if (error) return true;

    return false;
  });

  if (sourcesAccessError) return false;

  let success = true;

  await fs.writeFile(filePath, target).catch((error) => {
    log.error(error);
    success = false;
  });

  return success;
}

/**
 * If the syncthing apt source doesn't exist, create it
 * @returns {Promise<void>}
 */
async function addSyncthingRepository() {
  const sourceExists = await fs.stat('/etc/apt/sources.list.d/syncthing.list').catch(() => false);
  if (sourceExists) return;

  // source vars
  const packageName = 'syncthing';
  // syncthing does this weird
  const dist = 'syncthing';
  const sourceUrl = 'https://apt.syncthing.net/';
  const components = ['stable'];
  const sourceOptions = ['signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg'];

  // keyring vars
  const keyUrl = 'https://syncthing.net/release-key.gpg';
  const keyringName = 'syncthing-archive-keyring.gpg';

  // this will log errors
  const keyAdded = await addGpgKey(keyUrl, keyringName);

  if (!keyAdded) return;

  const params = [packageName, sourceUrl, dist, components];
  // this will log errors
  const sourceAdded = await addAptSource(...params, { options: sourceOptions });

  if (!sourceAdded) return;

  await updateAptCache({ force: true });
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

    await addSyncthingRepository();

    const versionChecker = async () => {
      const {
        data: { data },
      } = await axios
        .get('https://stats.runonflux.io/getmodulesminimumversions', {
          timeout: 10000,
        })
        .catch((error) => {
          log.error(error);
          return { data: { data: {} } };
        });

      // we don't need to check that status here, if there is an error 'syncthing' won't
      // have a value
      const syncthingVersion = data.syncthing || config.minimumSyncthingAllowedVersion;
      // const dockerVersion = data.docker || config.minimumDockerAllowedVersion;

      await ensurePackageVersion('syncthing', syncthingVersion);
      // await ensurePackageVersion('docker', dockerVersion); commented as it needs extra love to work
    };

    await versionChecker();

    syncthingTimer = setInterval(versionChecker, 1000 * 60 * 60 * 24); // 24 hours
  } catch (error) {
    log.error(error);
  }
}

/**
 * Checks the state of the apt cache. Checks if other processes have the cache
 * locked. If there is an error that doesn't involve a lock, it tries to configure the cache
 * to fix the error. If the error resolves, the queue is resumed, otherwise, it waits 12 hours and tries again.
 * @param {{options, error}} event The event emitted to trigger apt cache monitoring
 * @returns {Promise<void>}
 */
async function monitorAptCache(event) {
  // The options are what the worker was called with by the user
  const { options, error } = event;

  const dpkgLock = '/var/lib/dpkg/lock';
  const dpkgLockFrontend = '/var/lib/dpkg/lock-frontend';

  // we don't care about apt-get update error, most likely
  // apt-get update was already running (this uses a different lock
  // than apt-get install)
  if (options.command === 'update') {
    // we don't need to log here, as the error gets logged automatically by runCommand
    aptQueue.resume();
    return;
  }

  // if we are here and it is a default install command,
  // it took 20 minutes to fail. (unless the lock wait wasn't working
  // on arm or apt older than 1.9.11 or something. Then it took ~5 minutes)

  // can get multiple error messages here? Don't allways get the pid.

  // E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 1427823 (apt-get)
  // N: Be aware that removing the lock file is not a solution and may break your system.
  // E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), is another process using it?

  let lockError = false;
  let waitForLockFailed = false;

  // check the error message. This is brittle, as it is dependent on
  // apt-get not changing output etc, but error codes are just 0 or 100
  if (error.message.includes(dpkgLockFrontend)) {
    lockError = true;
  }

  // wait a further 30 minutes for lock to release. (seems a long time?)
  let retriesRemaining = 3;

  while (lockError && retriesRemaining) {
    retriesRemaining -= 1;
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(10 * 60 * 1000);
    // we can use the syscall fcntl provided by the fs-ext package to test the lock instead of
    // apt-get check. It would mean we don't have to run a shell command as it's just native C++.
    // However that means another dependency and I don't have the hardware (yet) to test on ARM etc.

    // eslint-disable-next-line no-await-in-loop
    const { error: lockCheckError } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['check'] });
    if (!lockCheckError) {
      aptQueue.resume();
      return;
    }

    if (!lockCheckError.message.includes(dpkgLockFrontend)) {
      break;
    }

    if (!retriesRemaining) waitForLockFailed = true;
  }

  if (waitForLockFailed) {
    // they've had enough time with the lock, time to move then on.
    const termParams = ['-k', '-TERM', dpkgLock, dpkgLockFrontend];
    const opts = { runAsRoot: true, timeout: 10000, params: termParams };
    const { error: fuserError } = await serviceHelper.runCommand('fuser', opts);
    if (fuserError) {
      // tests do weird stuff if you mutate the call properties
      const killParams = termParams.slice();
      killParams[1] = '-KILL';
      await serviceHelper.runCommand('fuser', { runAsRoot: true, timeout: 10000, params: killParams });
    }
  }

  // try recover any partial installs
  await serviceHelper.runCommand('dpkg', { runAsRoot: true, params: ['--configure', '-a'] });

  // at this point, either dns is unable to resolve the sources (or sources are corrupt), or apt-get is broken. Lets try and fix broken
  await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['install', '--fix-broken'] });

  const { error: checkError } = await serviceHelper.runCommand('apt-get', { runAsRoot: true, params: ['check'] });
  if (!checkError) {
    aptQueue.resume();
    return;
  }

  log.error('Unable to run apt-get command(s), clearing the queue and resetting state.');
  aptQueue.clear();
}

/**
 * @returns {Promise<void>}
 */
async function monitorSystem() {
  try {
    aptQueue.addWorker(aptRunner);
    aptQueue.on('failed', monitorAptCache);

    // don't await these, let the queue deal with it

    // ubuntu 18.04 -> 24.04 all share this package
    ensurePackageVersion('ca-certificates', '20230311');
    // 18.04 == 1.187
    // 20.04 == 1.206
    // 22.04 == 1.218
    // Debian 12 = 1.219
    ensurePackageVersion('netcat-openbsd', '1.187');
    monitorSyncthingPackage();
  } catch (error) {
    log.error(error);
  }
}

async function mongoDBConfig() {
  log.info('MongoDB file config verification...');
  try {
    const hashCurrent = hash(await fs.readFile('/etc/mongod.conf'));
    const vailidHashes = ['4646c649230b8125c7894d618313039f20d1901b', '1b20cbacf63c4400d0bf90188615db78b9a7602e'];
    if (vailidHashes.indexOf(hashCurrent) !== -1) {
      log.info('MongoDB config verification passed.');
      return;
    }
    log.info('MongoDB verification failed.');
    const ramSize = os.totalmem() / 1024 / 1024 / 1024;
    let cacheSizeGB;
    if (ramSize <= 6) {
      cacheSizeGB = 1;
    } else {
      cacheSizeGB = 2;
    }
    const data = {
      storage: {
        dbPath: '/var/lib/mongodb',
        wiredTiger: {
          engineConfig: {
            // eslint-disable-next-line object-shorthand
            cacheSizeGB: cacheSizeGB,
            configString: 'eviction_trigger=95,eviction_target=80',
          },
        },
      },
      systemLog: {
        destination: 'file',
        logAppend: true,
        path: '/var/log/mongodb/mongod.log',
      },
      net: {
        port: 27017,
        bindIp: '127.0.0.1',
      },
      processManagement: {
        timeZoneInfo: '/usr/share/zoneinfo',
      },
    };
    const yamlData = yaml.dump(data);
    await fs.writeFile('mongod.conf', yamlData, 'utf-8');
    await serviceHelper.runCommand('mv', { runAsRoot: true, params: ['./mongod.conf', '/etc/mongod.conf'] });
    await serviceHelper.runCommand('systemctl', { runAsRoot: true, params: ['restart', 'mongod'] });
    log.info('MongoDB config file created successfully.');
  } catch (error) {
    log.error('Error:', error);
  }
}

// eslint-disable-next-line consistent-return
async function mongodGpgKeyVeryfity() {
  log.info('MongoDB GPG verification...');
  try {
    const { stdout, stderr, error } = await serviceHelper.runCommand('gpg', { runAsRoot: false, params: ['--no-default-keyring', '--keyring', '/usr/share/keyrings/mongodb-archive-keyring.gpg', '--list-keys'] });
    if (error) {
      throw new Error(`Executing gpg: ${error}`);
    }
    if (stderr) {
      throw new Error(`gpg stderr: ${stderr}`);
    }
    const expiredMatch = stdout.match(/\[expired: (\d{4}-\d{2}-\d{2})\]/);
    const versionMatch = stdout.match(/MongoDB (\d+\.\d+) Release Signing Key/);
    if (expiredMatch) {
      if (versionMatch) {
        const keyUrl = `https://pgp.mongodb.com/server-${versionMatch[1]}.asc`;
        const filePath = '/usr/share/keyrings/mongodb-archive-keyring.gpg';
        log.info(`MongoDB version: ${versionMatch[1]}`);
        log.info(`GPG URL: https://pgp.mongodb.com/server-${versionMatch[1]}.asc`);
        log.info(`The key has expired on ${expiredMatch[1]}`);
        const command = `curl -fsSL ${keyUrl} | sudo gpg --batch --yes -o ${filePath} --dearmor`;
        // eslint-disable-next-line no-shadow
        const { error, stderr } = await serviceHelper.runCommand(command, {
          shell: true,
          logError: true,
        });
        if (error) {
          throw new Error(`Update command failed: ${error}`);
        }
        if (stderr) {
          throw new Error(`Update command failed: ${stderr}`);
        }
        log.info('The key was updated successfully.');
        return true;
        // eslint-disable-next-line no-else-return
      } else {
        throw new Error('MongoDB version not found.');
      }
      // eslint-disable-next-line no-else-return
    } else {
      log.info('MongoDB GPG key is still valid.');
      return true;
    }
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function restartSystemdService(service) {
  const { error } = await serviceHelper.runCommand('systemctl', {
    runAsRoot: true,
    params: ['restart', service],
  });

  return !error;
}

async function enableZmq(zmqEndpoint) {
  const fluxConfigDir = daemonServiceUtils.getFluxdDir();
  const zmqEnabledPath = path.join(fluxConfigDir, '.zmqEnabled');

  const exists = Boolean(await fs.stat(zmqEnabledPath).catch(() => false));

  if (exists) return true;

  let parseError = false;

  try {
    const { protocol, hostname, port } = new URL(zmqEndpoint);

    if (!protocol === 'tcp' || !hostname || !port) parseError = true;
  } catch {
    parseError = true;
  }

  if (parseError) {
    log.error(`Error parsing zmqEndpoint: ${zmqEndpoint}. Unable to start zmq publisher`);
    return false;
  }

  // to keep things simple, we only config zmq if fluxd is running and working, that way it is
  // easier to revert config changes on error
  const { error: daemonError } = await serviceHelper.runCommand('flux-cli', { params: ['getblockcount'] });

  if (daemonError) {
    return false;
  }

  const topics = [
    'zmqpubhashtx',
    'zmqpubhashblock',
    'zmqpubrawblock',
    'zmqpubrawtx',
    'zmqpubsequence',
  ];

  try {
    const fluxdConfigPath = daemonServiceUtils.getFluxdConfigPath();
    const newFluxdConfig = 'flux.conf.new';
    const fluxdConfigBackup = 'flux.conf.bak';
    const newFluxdAbsolutePath = path.join(fluxConfigDir, newFluxdConfig);
    const fluxdConfigBackupAbsolutePath = path.join(fluxConfigDir, fluxdConfigBackup);

    topics.forEach((topic) => {
      daemonServiceUtils.setConfigValue(topic, zmqEndpoint, {
        replace: true,
      });
    });

    await daemonServiceUtils.writeFluxdConfig(newFluxdConfig);

    // we check to make sure the config file is parseable by fluxd. If not, the below will fail.
    const { error: semanticError } = await serviceHelper.runCommand('flux-cli', { params: [`-conf=${newFluxdAbsolutePath}`, 'getblockcount'] });

    await fs.rm(newFluxdAbsolutePath, { force: true }).catch(() => { });

    if (semanticError) {
      log.error('Parsing error on new zmq fluxd config file... skipping');
      return false;
    }

    await daemonServiceUtils.createBackupFluxdConfig(fluxdConfigBackup);

    // thi writes the actual file
    await daemonServiceUtils.writeFluxdConfig();

    const { error: restartError } = await restartSystemdService('zelcash.service');

    if (restartError) {
      log.error('Error restarting zelcash.service after config update');
      await fs.rename(fluxdConfigBackupAbsolutePath, fluxdConfigPath);
      await restartSystemdService('zelcash.service');
      return false;
    }

    await fs.writeFile(zmqEnabledPath, '').catch(() => { });

    log.info('ZMQ pub/sub enabled');

    return true;
  } catch (err) {
    log.info('ERROR HERE');
    log.error(err);
  }
}

module.exports = {
  monitorSystem,
  // testing exports
  addAptSource,
  addGpgKey,
  addSyncthingRepository,
  aptRunner,
  cacheUpdateTime,
  enableZmq,
  ensurePackageVersion,
  getPackageVersion,
  getQueue,
  monitorAptCache,
  monitorSyncthingPackage,
  queueAptGetCommand,
  resetTimers,
  updateAptCache,
  upgradePackage,
  mongoDBConfig,
  mongodGpgKeyVeryfity,
};
