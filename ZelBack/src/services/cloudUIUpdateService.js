const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const log = require('../lib/log');

const REPO = 'RunOnFlux/fluxos-frontend';
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const CLOUDUI_DIR = path.join(PROJECT_ROOT, 'CloudUI');
const VERSION_FILE = path.join(CLOUDUI_DIR, 'version');

/**
 * Checks if CloudUI folder exists and has content
 * @returns {boolean}
 */
function cloudUIExists() {
  try {
    if (!fs.existsSync(CLOUDUI_DIR)) {
      return false;
    }
    const files = fs.readdirSync(CLOUDUI_DIR);
    // Check if there are files (not just version file)
    return files.length > 1 || (files.length === 1 && files[0] !== 'version');
  } catch (error) {
    log.error(`Error checking CloudUI folder: ${error.message}`);
    return false;
  }
}

/**
 * Gets the local version hash from the version file
 * @returns {string|null}
 */
function getLocalVersionHash() {
  try {
    if (!fs.existsSync(VERSION_FILE)) {
      return null;
    }
    return fs.readFileSync(VERSION_FILE, 'utf8').trim();
  } catch (error) {
    log.error(`Error reading local version file: ${error.message}`);
    return null;
  }
}

/**
 * Fetches the latest release information from GitHub
 * @returns {Promise<{hash: string, tag: string}|null>}
 */
async function getRemoteVersionInfo() {
  try {
    const response = await axios.get(RELEASE_API, {
      timeout: 30000,
      headers: {
        'User-Agent': 'FluxOS',
      },
    });

    const release = response.data;

    // Verify release is from master branch
    if (release.target_commitish !== 'master') {
      log.info('CloudUI: Latest release is not from master branch, skipping');
      return null;
    }

    const tagName = release.tag_name || '';

    // Find dist.tar.gz asset
    if (!release.assets || release.assets.length === 0) {
      log.warn('CloudUI: No assets found in release');
      return null;
    }

    const distAsset = release.assets.find((asset) => asset.name === 'dist.tar.gz');
    if (!distAsset) {
      log.warn('CloudUI: dist.tar.gz not found in release assets');
      return null;
    }

    // Extract hash from digest (format: "sha256:hash")
    if (!distAsset.digest) {
      log.warn('CloudUI: No digest found for dist.tar.gz asset');
      return null;
    }

    const remoteHash = distAsset.digest.replace('sha256:', '');

    return {
      hash: remoteHash,
      tag: tagName,
    };
  } catch (error) {
    log.error(`Error fetching remote version info: ${error.message}`);
    return null;
  }
}

/**
 * Executes the update:cloudui script
 * @returns {Promise<boolean>}
 */
function runUpdateScript() {
  return new Promise((resolve) => {
    log.info('CloudUI: Running update script...');

    exec('npm run update:cloudui', { cwd: PROJECT_ROOT, timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        log.error(`CloudUI update script error: ${error.message}`);
        if (stderr) {
          log.error(`CloudUI update stderr: ${stderr}`);
        }
        resolve(false);
        return;
      }

      log.info('CloudUI: Update script completed');
      if (stdout) {
        // Log last few lines of output
        const lines = stdout.trim().split('\n');
        const lastLines = lines.slice(-5).join('\n');
        log.info(`CloudUI update output:\n${lastLines}`);
      }
      resolve(true);
    });
  });
}

/**
 * Main function to check and update CloudUI
 * Called on service manager startup
 */
async function checkAndUpdateCloudUI() {
  try {
    log.info('CloudUI: Starting update check...');

    // Check if CloudUI folder exists with content
    const exists = cloudUIExists();

    if (!exists) {
      log.info('CloudUI: Folder missing or empty, installing...');
      const success = await runUpdateScript();
      if (success) {
        log.info('CloudUI: Installation completed successfully');
      } else {
        log.error('CloudUI: Installation failed');
      }
      return;
    }

    // CloudUI exists, check for updates
    const localHash = getLocalVersionHash();
    if (!localHash) {
      log.info('CloudUI: No version file found, updating...');
      const success = await runUpdateScript();
      if (success) {
        log.info('CloudUI: Update completed successfully');
      } else {
        log.error('CloudUI: Update failed');
      }
      return;
    }

    // Fetch remote version info
    const remoteInfo = await getRemoteVersionInfo();
    if (!remoteInfo) {
      log.info('CloudUI: Could not fetch remote version info, skipping update check');
      return;
    }

    // Compare versions
    log.info(`CloudUI: Current version: ${localHash.substring(0, 8)}, Latest: ${remoteInfo.tag} (${remoteInfo.hash.substring(0, 8)})`);

    if (remoteInfo.hash !== localHash) {
      log.info('CloudUI: New version detected, updating...');
      log.info(`CloudUI: Local hash: ${localHash}`);
      log.info(`CloudUI: Remote hash: ${remoteInfo.hash}`);
      log.info(`CloudUI: Remote tag: ${remoteInfo.tag}`);

      const success = await runUpdateScript();
      if (success) {
        // Verify update was successful
        const newLocalHash = getLocalVersionHash();
        if (newLocalHash === remoteInfo.hash) {
          log.info(`CloudUI: Successfully updated to version ${remoteInfo.tag}`);
        } else {
          log.warn('CloudUI: Update completed but version hash does not match expected');
        }
      } else {
        log.error('CloudUI: Update failed');
      }
    } else {
      log.info('CloudUI: Already up to date');
    }
  } catch (error) {
    log.error(`CloudUI update check error: ${error.message}`);
  }
}

module.exports = {
  checkAndUpdateCloudUI,
  cloudUIExists,
  getLocalVersionHash,
  getRemoteVersionInfo,
  // Exported for testing
  CLOUDUI_DIR,
  VERSION_FILE,
};
