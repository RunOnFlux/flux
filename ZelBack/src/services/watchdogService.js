const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

const isArcane = Boolean(process.env.FLUXOS_PATH);

// Watchdog repository and paths
const WATCHDOG_REPO = 'https://github.com/RunOnFlux/fluxnode-watchdog.git';

/**
 * Get the watchdog directory path
 * @returns {string} Path to watchdog directory
 */
function getWatchdogPath() {
  const homedir = os.homedir();
  return path.join(homedir, 'watchdog');
}

/**
 * Get the watchdog config file path
 * @returns {string} Path to watchdog config.js
 */
function getWatchdogConfigPath() {
  return path.join(getWatchdogPath(), 'config.js');
}

/**
 * Check if a directory exists
 * @param {string} dirPath - Path to check
 * @returns {Promise<boolean>} True if directory exists
 */
async function directoryExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if watchdog is installed (directory exists with package.json and node_modules)
 * @returns {Promise<boolean>} True if watchdog is installed
 */
async function isWatchdogInstalled() {
  const watchdogPath = getWatchdogPath();
  const packageJsonPath = path.join(watchdogPath, 'package.json');
  const nodeModulesPath = path.join(watchdogPath, 'node_modules');

  const dirExists = await directoryExists(watchdogPath);
  if (!dirExists) {
    return false;
  }

  const packageExists = await fileExists(packageJsonPath);
  const modulesExist = await directoryExists(nodeModulesPath);

  return packageExists && modulesExist;
}

/**
 * Check if watchdog process is running via pm2
 * @returns {Promise<boolean>} True if watchdog is running in pm2
 */
async function isWatchdogRunning() {
  try {
    const { stdout, error } = await serviceHelper.runCommand('pm2', {
      params: ['jlist'],
      timeout: 30000,
    });

    if (error) {
      log.warn(`Failed to get pm2 process list: ${error.message}`);
      return false;
    }

    if (!stdout) {
      return false;
    }

    const processList = JSON.parse(stdout);
    const watchdogProcess = processList.find((proc) => proc.name === 'watchdog');

    if (!watchdogProcess) {
      return false;
    }

    // Check if the process is online
    return watchdogProcess.pm2_env && watchdogProcess.pm2_env.status === 'online';
  } catch (err) {
    log.warn(`Error checking watchdog status: ${err.message}`);
    return false;
  }
}

/**
 * Clone the watchdog repository
 * @returns {Promise<boolean>} True if clone was successful
 */
async function cloneWatchdog() {
  const homedir = os.homedir();
  const watchdogPath = getWatchdogPath();

  log.info('Cloning fluxnode-watchdog repository...');

  // Remove existing directory if it exists (incomplete installation)
  const exists = await directoryExists(watchdogPath);
  if (exists) {
    log.info('Removing incomplete watchdog installation...');
    const { error: rmError } = await serviceHelper.runCommand('rm', {
      params: ['-rf', watchdogPath],
      timeout: 60000,
    });
    if (rmError) {
      log.error(`Failed to remove existing watchdog directory: ${rmError.message}`);
      return false;
    }
  }

  const { error } = await serviceHelper.runCommand('git', {
    params: ['clone', WATCHDOG_REPO, 'watchdog'],
    cwd: homedir,
    timeout: 120000,
  });

  if (error) {
    log.error(`Failed to clone watchdog repository: ${error.message}`);
    return false;
  }

  log.info('Watchdog repository cloned successfully');
  return true;
}

/**
 * Install watchdog npm dependencies
 * @returns {Promise<boolean>} True if installation was successful
 */
async function installWatchdogDependencies() {
  const watchdogPath = getWatchdogPath();

  log.info('Installing watchdog dependencies...');

  const { error } = await serviceHelper.runCommand('npm', {
    params: ['install'],
    cwd: watchdogPath,
    timeout: 300000, // 5 minutes for npm install
  });

  if (error) {
    log.error(`Failed to install watchdog dependencies: ${error.message}`);
    return false;
  }

  log.info('Watchdog dependencies installed successfully');
  return true;
}

/**
 * Create default watchdog configuration file
 * @returns {Promise<boolean>} True if config was created successfully
 */
async function createDefaultConfig() {
  const configPath = getWatchdogConfigPath();

  // Check if config already exists
  const exists = await fileExists(configPath);
  if (exists) {
    log.info('Watchdog config.js already exists, skipping creation');
    return true;
  }

  log.info('Creating default watchdog configuration...');

  // Default configuration with auto-updates enabled and no notifications
  const defaultConfig = `module.exports = {
  label: '',
  tier_eps_min: '0',
  zelflux_update: '1',
  zelcash_update: '1',
  zelbench_update: '1',
  action: '1',
  ping: '',
  web_hook_url: '',
  telegram_alert: '0',
  telegram_bot_token: '',
  telegram_chat_id: ''
}
`;

  try {
    await fs.writeFile(configPath, defaultConfig, 'utf8');
    log.info('Watchdog default configuration created successfully');
    return true;
  } catch (err) {
    log.error(`Failed to create watchdog config: ${err.message}`);
    return false;
  }
}

/**
 * Start watchdog via pm2
 * @returns {Promise<boolean>} True if watchdog was started successfully
 */
async function startWatchdog() {
  const watchdogPath = getWatchdogPath();
  const watchdogScript = path.join(watchdogPath, 'watchdog.js');

  log.info('Starting watchdog via pm2...');

  // First, try to delete any existing watchdog process (in case it's in error state)
  await serviceHelper.runCommand('pm2', {
    params: ['delete', 'watchdog'],
    timeout: 30000,
    logError: false, // Expected to fail if watchdog isn't running
  });

  // Start watchdog with pm2, using --watch flag for auto-restart on file changes
  const { error } = await serviceHelper.runCommand('pm2', {
    params: [
      'start',
      watchdogScript,
      '--name', 'watchdog',
      '--watch', watchdogPath,
      '--ignore-watch', '"./**/*.git" "./**/*node_modules" "./**/*watchdog_error.log"',
      '--watch-delay', '20',
    ],
    cwd: watchdogPath,
    timeout: 60000,
  });

  if (error) {
    log.error(`Failed to start watchdog: ${error.message}`);
    return false;
  }

  // Save pm2 process list
  const { error: saveError } = await serviceHelper.runCommand('pm2', {
    params: ['save'],
    timeout: 30000,
  });

  if (saveError) {
    log.warn(`Failed to save pm2 process list: ${saveError.message}`);
    // Not a critical error, watchdog is still running
  }

  log.info('Watchdog started successfully via pm2');
  return true;
}

/**
 * Install and start watchdog on legacy OS nodes
 * This function is called on service manager startup
 * @returns {Promise<void>}
 */
async function ensureWatchdogRunning() {
  try {
    // Skip on ArcaneOS - watchdog is managed differently there (systemd service)
    if (isArcane) {
      log.info('ArcaneOS detected, skipping pm2 watchdog setup (managed by systemd)');
      return;
    }

    log.info('Legacy OS detected, checking watchdog status...');

    // Check if watchdog is installed
    const installed = await isWatchdogInstalled();

    if (!installed) {
      log.info('Watchdog is not installed, proceeding with installation...');

      // Clone the repository
      const cloned = await cloneWatchdog();
      if (!cloned) {
        log.error('Failed to clone watchdog repository, will retry on next restart');
        return;
      }

      // Install dependencies
      const depsInstalled = await installWatchdogDependencies();
      if (!depsInstalled) {
        log.error('Failed to install watchdog dependencies, will retry on next restart');
        return;
      }

      // Create default config only for fresh installations
      const configCreated = await createDefaultConfig();
      if (!configCreated) {
        log.error('Failed to create watchdog config, will retry on next restart');
        return;
      }

      log.info('Watchdog installed successfully');
    } else {
      log.info('Watchdog is already installed');
    }

    // Check if watchdog is running
    const running = await isWatchdogRunning();

    if (!running) {
      log.info('Watchdog is not running, starting it...');
      const started = await startWatchdog();
      if (!started) {
        log.error('Failed to start watchdog, will retry on next restart');
        return;
      }
    } else {
      log.info('Watchdog is already running');
    }

    log.info('Watchdog service check completed successfully');
  } catch (err) {
    log.error(`Error in ensureWatchdogRunning: ${err.message}`);
  }
}

module.exports = {
  ensureWatchdogRunning,
  isWatchdogInstalled,
  isWatchdogRunning,
  getWatchdogPath,
  getWatchdogConfigPath,
  // Exported for testing
  cloneWatchdog,
  installWatchdogDependencies,
  createDefaultConfig,
  startWatchdog,
  directoryExists,
  fileExists,
};
