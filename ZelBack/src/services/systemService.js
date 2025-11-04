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
const syncthingService = require('./syncthingService');
const fifoQueue = require('./utils/fifoQueue');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');

const isArcane = Boolean(process.env.FLUXOS_PATH);

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

  // any apt after 1.9.11 has the DPkg::Lock::Timeout option.
  const params = [
    '-y', // Auto-answer yes to prompts
    '-o', `DPkg::Lock::Timeout=${timeout}`, // How long to wait for a lock
    '-o', 'Dpkg::Options::=--force-confdef', // Use default for new config files
    '-o', 'Dpkg::Options::=--force-confold', // Keep old config files on conflict
    ...userParams,
  ];

  // Use env command to pass DEBIAN_FRONTEND through sudo (sudo strips env vars by default)
  const envParams = ['DEBIAN_FRONTEND=noninteractive', 'apt-get', ...params];
  const { error } = await serviceHelper.runCommand('env', {
    runAsRoot: true,
    params: envParams,
  });

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
  const components = ['stable-v2'];
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
 * Updates syncthing apt source component from 'stable' to 'stable-v2'
 * Supports both legacy (one-line) and deb822 format
 * @param {string} sourceContent The content of the apt source file
 * @returns {string|null} Updated content or null if update failed/not needed
 */
function updateSyncthingSourceComponent(sourceContent) {
  if (!sourceContent || typeof sourceContent !== 'string') {
    return null;
  }

  // Already migrated?
  if (sourceContent.includes('stable-v2')) {
    return null;
  }

  // Detect format: deb822 has "Types:", "URIs:", or "Components:" fields
  const isDeb822 = /^(?:Types|URIs|Components):/m.test(sourceContent);

  let newContent;
  if (isDeb822) {
    // deb822 format: "Components: stable" -> "Components: stable-v2"
    // Pattern explanation:
    // ^Components:(?<spacing>\s*) - match "Components:" and capture whitespace after
    // (?<prefix>.*?) - non-greedy match of any characters before stable
    // \bstable\b(?!-v2) - match word "stable" but not "stable-v2" (negative lookahead)
    // (?<suffix>.*?)$ - non-greedy match of everything after stable to end of line
    newContent = sourceContent.replace(
      /^Components:(?<spacing>\s*)(?<prefix>.*?)\bstable\b(?!-v2)(?<suffix>.*?)$/m,
      'Components:$<spacing>$<prefix>stable-v2$<suffix>',
    );
  } else {
    // Legacy format: "deb [...] url suite stable" -> "deb [...] url suite stable-v2"
    // Pattern explanation:
    // ^(?<prefix>deb(?:-src)?\s+(?:\[.*?\]\s+)?\S+\s+\S+\s+) - capture everything before stable:
    //   - deb(?:-src)? - match "deb" or "deb-src" (non-capturing group for -src)
    //   - \s+ - match one or more whitespace
    //   - (?:\[.*?\]\s+)? - optionally match options like [signed-by=...] (non-capturing)
    //   - \S+\s+\S+\s+ - match URL and suite with whitespace
    // stable\b(?!-v2) - match word "stable" but not "stable-v2" (negative lookahead)
    // (?<suffix>\s*)$ - capture optional trailing whitespace to end of line
    newContent = sourceContent.replace(
      /^(?<prefix>deb(?:-src)?\s+(?:\[.*?\]\s+)?\S+\s+\S+\s+)stable\b(?!-v2)(?<suffix>\s*)$/m,
      '$<prefix>stable-v2$<suffix>',
    );
  }

  // Validate that the replacement actually worked
  if (newContent === sourceContent) {
    log.error('Failed to update syncthing source: pattern did not match');
    return null;
  }

  if (!newContent.includes('stable-v2')) {
    log.error('Failed to update syncthing source: stable-v2 not found in result');
    return null;
  }

  return newContent;
}

/**
 * Updates the syncthing apt source from v1 to v2
 * @returns {Promise<boolean>} True if sources are ready for v2 (updated or already on v2), false on failure
 */
async function updateSyncthingRepository() {
  const sourcePath = '/etc/apt/sources.list.d/syncthing.list';

  // Securely read the file as root (file may only be root-readable)
  const { stdout: sourceContent } = await serviceHelper
    .runCommand('cat', { runAsRoot: true, params: [sourcePath], logError: false });

  if (!sourceContent) {
    log.warn('Unable to read syncthing sources, unable to update syncthing');
    return false;
  }

  const newContent = updateSyncthingSourceComponent(sourceContent);

  if (!newContent) {
    // Already on v2 or failed to parse - function logs errors
    if (sourceContent.includes('stable-v2')) {
      log.info('Syncthing sources already on v2, nothing to do');
      return true; // Sources are ready for v2 upgrade
    }
    return false; // Failed to parse
  }

  log.info('Switching syncthing apt source from stable to stable-v2...');

  // Securely write the file: write to temp, then move as root
  // (file may only be root-writeable)
  const tempFile = './syncthing.list.tmp';
  const writeError = await fs
    .writeFile(tempFile, newContent, 'utf8')
    .catch(() => true);

  if (writeError) {
    log.warn('Unable to write to current directory, unable to update syncthing');
    return false;
  }

  const { error: moveError } = await serviceHelper.runCommand('mv', {
    runAsRoot: true,
    params: [tempFile, sourcePath],
  });

  if (moveError) {
    log.error('Failed to write syncthing apt source');
    await fs.rm(tempFile, { force: true }).catch(() => { });
    return false;
  }

  await updateAptCache({ force: true });
  log.info('Apt source updated to stable-v2');
  await fs.rm(tempFile, { force: true }).catch(() => { });
  return true;
}

/**
 *  Makes sure the package version is above the minimum version provided
 * @param {string} systemPackage The package version to check
 * @param {string} requiredVersion The minimum acceptable version of package
 * @param {string?} currentVersion Optional current version of package
 * @returns {Promise<boolean>} True if package was upgraded, false otherwise
 */
async function ensurePackageVersion(systemPackage, requiredVersion, currentVersion = null) {
  try {
    log.info(`Checking package ${systemPackage} is updated to version ${requiredVersion}`);

    const actualVersion = currentVersion || await getPackageVersion(systemPackage);

    if (!actualVersion) {
      log.info(`Package ${systemPackage} not found on system`);
      await upgradePackage(systemPackage);
      return true; // Package was installed/upgraded
    }

    log.info(`Package ${systemPackage} version ${actualVersion} found`);
    const versionOk = serviceHelper.minVersionSatisfy(actualVersion, requiredVersion);

    if (versionOk) return false; // Already at correct version, no upgrade

    const upgradeError = await upgradePackage(systemPackage);
    if (!upgradeError) {
      log.info(`${systemPackage} is on the latest version`);
    }
    return !upgradeError; // True if upgrade succeeded, false if it failed
  } catch (error) {
    log.error(error);
    return false; // Error occurred, no upgrade
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

      const minSyncthingVersion =
        data.syncthing || config.minimumSyncthingAllowedVersion;

      const currentSyncthingVersion = await getPackageVersion('syncthing');

      // We only check if the package / sources are up to date if it's installed
      if (currentSyncthingVersion) {
        const upToDate = serviceHelper.minVersionSatisfy(
          currentSyncthingVersion,
          minSyncthingVersion,
        );

        if (upToDate) return;

        // The sources changed at version 2.0.0 from stable, to stable-v2
        const hasNewSources = serviceHelper.minVersionSatisfy(
          currentSyncthingVersion,
          '2.0.0',
        );

        if (!hasNewSources) {
          const updated = await updateSyncthingRepository();
          if (!updated) {
            log.warn('Failed to update syncthing repository sources, skipping syncthing upgrade');
            return;
          }
        }
      }

      const upgraded = await ensurePackageVersion(
        'syncthing',
        minSyncthingVersion,
        currentSyncthingVersion,
      );

      // we only restart if the package was installed (and running) in the first place
      if (currentSyncthingVersion && upgraded) {
        log.info('Syncthing upgraded, restarting to load new binary...');
        await syncthingService.systemRestart(null, null).catch(() => { });
      }
    }

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
  if (isArcane) return;

  try {
    aptQueue.addWorker(aptRunner);
    aptQueue.on('failed', monitorAptCache);

    // don't await these, let the queue deal with it

    // ubuntu 18.04 -> 24.04 all share this package
    setImmediate(() => ensurePackageVersion('ca-certificates', '20230311'));
    // 18.04 == 1.187
    // 20.04 == 1.206
    // 22.04 == 1.218
    // Debian 12 = 1.219
    setImmediate(() => ensurePackageVersion('netcat-openbsd', '1.187'));
    setImmediate(() => monitorSyncthingPackage());
    setImmediate(() => ensureChronyd());
  } catch (error) {
    log.error(error);
  }
}

async function mongoDBConfig() {
  if (isArcane) return;

  log.info('MongoDB file config verification...');
  try {
    const hashCurrent = hash(await fs.readFile('/etc/mongod.conf'));
    const vailidHashes = [
      '4646c649230b8125c7894d618313039f20d1901b',
      '1b20cbacf63c4400d0bf90188615db78b9a7602e',
    ];
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
  if (isArcane) return true;

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

  return Boolean(error);
}

async function enableFluxdZmq(zmqEndpoint) {
  if (isArcane) return true;

  if (typeof zmqEndpoint !== 'string') return false;

  const fluxConfigDir = daemonServiceUtils.getFluxdDir();

  if (!fluxConfigDir) return false;

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
    log.error('Error getting blockcount via flux-cli to validate new zmq config, skipping');
    return false;
  }

  // this returns an error if the service doesn't exit or isn't running
  const { error: serviceError } = await serviceHelper.runCommand('systemctl', {
    asRoot: true,
    logError: false,
    params: ['status', 'zelcash.service'],
  });

  if (serviceError) {
    log.error('Unable to get Fluxd status via systemd, skipping config update');
    return false;
  }

  const topics = [
    'zmqpubhashtx',
    'zmqpubhashblock',
    'zmqpubrawblock',
    'zmqpubrawtx',
    'zmqpubsequence',
  ];

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
  const { error: syntaxError } = await serviceHelper.runCommand('flux-cli', { params: [`-conf=${newFluxdAbsolutePath}`, 'getblockcount'] });

  await fs.rm(newFluxdAbsolutePath, { force: true }).catch(() => { });

  if (syntaxError) {
    log.error('Parsing error on new zmq fluxd config file... skipping');
    return false;
  }

  await daemonServiceUtils.createBackupFluxdConfig(fluxdConfigBackup);

  // this writes the config to default location
  await daemonServiceUtils.writeFluxdConfig();

  const restartError = await restartSystemdService('zelcash.service');

  if (restartError) {
    log.error('Error restarting zelcash.service after config update');
    await fs.rename(fluxdConfigBackupAbsolutePath, fluxdConfigPath);
    await restartSystemdService('zelcash.service');
    return false;
  }

  await fs.writeFile(zmqEnabledPath, '').catch(() => { });

  log.info('ZMQ pub/sub enabled');

  return true;
}

/**
 * Ensures chrony is installed and running, replacing systemd-timesyncd.
 * Will stop and purge systemd-timesyncd after confirming chrony is working.
 * On failure to install chrony, restarts systemd-timesyncd if it was previously stopped.
 * @returns {Promise<boolean>} True if chrony is configured successfully, false otherwise
 */
async function ensureChronyd() {
  if (isArcane) return true;

  try {
    log.info('Checking time synchronization service...');

    // Check if chrony is already installed
    const chronyVersion = await getPackageVersion('chrony');
    const chronyInstalled = Boolean(chronyVersion);

    // Check if systemd-timesyncd is active
    const { error: timedActiveCheck } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      logError: false,
      params: ['is-active', 'systemd-timesyncd'],
    });

    const timedActive = !timedActiveCheck; // No error means service is active

    // If chrony already installed and timesyncd not active, we're done
    if (chronyInstalled && !timedActive) {
      log.info('Chrony already configured');
      return true;
    }

    let timedWasStopped = false;

    // Stop and disable systemd-timesyncd if it's running
    if (timedActive) {
      log.info('Stopping systemd-timesyncd service...');

      await serviceHelper.runCommand('systemctl', {
        runAsRoot: true,
        params: ['stop', 'systemd-timesyncd'],
      });

      timedWasStopped = true;
    }

    // Install chrony if not already present
    if (!chronyInstalled) {
      log.info('Installing chrony...');

      // Update apt cache to ensure we have latest package info
      await updateAptCache();

      const { error: installError } = await queueAptGetCommand('install', {
        wait: true,
        params: ['chrony'],
      });

      if (installError) {
        log.error('Failed to install chrony');

        // Restart systemd-timesyncd if we stopped it
        if (timedWasStopped) {
          log.info('Restarting systemd-timesyncd due to chrony installation failure');
          await serviceHelper.runCommand('systemctl', {
            runAsRoot: true,
            params: ['start', 'systemd-timesyncd'],
          });
        }

        return false;
      }

      log.info('Chrony installed successfully');
    }

    // Enable and start chrony service
    log.info('Starting chrony service...');

    const { error: enableError } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['enable', 'chrony'],
    });

    if (enableError) {
      log.error('Failed to enable chrony service');

      // Restart systemd-timesyncd if we stopped it
      if (timedWasStopped) {
        log.info('Restarting systemd-timesyncd due to chrony enable failure');
        await serviceHelper.runCommand('systemctl', {
          runAsRoot: true,
          params: ['start', 'systemd-timesyncd'],
        });
      }

      return false;
    }

    await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['start', 'chrony'],
    });

    // Wait for chrony to initialize
    await serviceHelper.delay(3 * 1000);

    // Verify chrony is actually syncing time
    log.info('Verifying chrony time synchronization...');

    const { stdout: trackingOutput, error: trackingError } = await serviceHelper.runCommand('chronyc', {
      params: ['tracking'],
      logError: false,
    });

    if (trackingError || !trackingOutput) {
      log.error('Failed to verify chrony tracking status');

      // Restart systemd-timesyncd if we stopped it
      if (timedWasStopped) {
        log.info('Restarting systemd-timesyncd due to chrony verification failure');
        await serviceHelper.runCommand('systemctl', {
          runAsRoot: true,
          params: ['start', 'systemd-timesyncd'],
        });
      }

      return false;
    }

    // Check if chrony has a reference (is syncing or trying to sync)
    // The "Reference ID" line should not be "00000000" if it's working
    const hasReference = trackingOutput.includes('Reference ID') && !trackingOutput.includes('Reference ID    : 00000000');

    if (!hasReference) {
      log.warn('Chrony may not be synchronizing yet, but service is running');
      // We'll continue anyway as chrony might just need more time to find servers
    } else {
      log.info('Chrony is synchronizing time successfully');
    }

    // Now that chrony is working, purge systemd-timesyncd
    const timedInstalled = Boolean(await getPackageVersion('systemd-timesyncd'));

    if (timedInstalled) {
      log.info('Purging systemd-timesyncd package and config...');

      await serviceHelper.runCommand('systemctl', {
        runAsRoot: true,
        params: ['disable', 'systemd-timesyncd'],
      });

      const { error: purgeError } = await queueAptGetCommand('purge', {
        wait: true,
        params: ['systemd-timesyncd'],
      });

      if (purgeError) {
        log.warn('Failed to purge systemd-timesyncd, but chrony is running');
        // We don't fail here since chrony is working
      } else {
        log.info('systemd-timesyncd purged successfully');
      }
    }

    log.info('Chrony configured successfully');
    return true;
  } catch (error) {
    log.error('Error configuring chrony:', error);
    return false;
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
  enableFluxdZmq,
  ensureChronyd,
  ensurePackageVersion,
  getPackageVersion,
  getQueue,
  monitorAptCache,
  monitorSyncthingPackage,
  queueAptGetCommand,
  resetTimers,
  updateAptCache,
  updateSyncthingRepository,
  updateSyncthingSourceComponent,
  upgradePackage,
  mongoDBConfig,
  mongodGpgKeyVeryfity,
};
