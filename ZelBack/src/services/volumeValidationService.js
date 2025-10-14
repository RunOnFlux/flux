const util = require('util');
const nodecmd = require('node-cmd');
const systemcrontab = require('crontab');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const serviceHelper = require('./serviceHelper');

const cmdAsync = util.promisify(nodecmd.run);
const crontabLoad = util.promisify(systemcrontab.load);

/**
 * Check if a volume path contains the incorrect '/flux/' directory pattern
 * @param {string} volumePath - The volume path to check
 * @returns {boolean} - True if the path contains the incorrect pattern
 */
function hasIncorrectFluxPath(volumePath) {
  if (!volumePath || typeof volumePath !== 'string') {
    return false;
  }
  // Check if path contains /flux/ directory that should not be there
  return volumePath.includes('/flux/ZelApps');
}

/**
 * Extract app name from crontab command
 * @param {string} command - The crontab command
 * @returns {string|null} - The app name or null if not found
 */
function extractAppNameFromCrontabCommand(command) {
  try {
    // Example command: sudo mount -o loop /home/abcapp2TEMP /root/flux/ZelApps/abcapp2
    const parts = command.split(' ');
    if (parts.length < 6) {
      return null;
    }
    const mountPoint = parts[5]; // The mount point path
    const pathParts = mountPoint.split('/');
    // Get the last part which should be the app name
    const appName = pathParts[pathParts.length - 1];
    // Remove flux prefix if present
    if (appName.startsWith('flux')) {
      return appName.substring(4);
    }
    if (appName.startsWith('zel')) {
      return appName.substring(3);
    }
    return appName;
  } catch (error) {
    log.error(`Error extracting app name from command: ${error.message}`);
    return null;
  }
}

/**
 * Get all apps with incorrect volume mounts from crontab
 * @returns {Promise<Array<{appName: string, volumePath: string, mountPoint: string}>>}
 */
async function getAppsWithIncorrectVolumeMounts() {
  const appsWithIncorrectMounts = [];

  try {
    log.info('Loading crontab to check for incorrect volume mounts...');
    const crontab = await crontabLoad().catch((error) => {
      log.error(`Error loading crontab: ${error.message}`);
      return null;
    });

    if (!crontab) {
      log.info('No crontab found or error loading it');
      return appsWithIncorrectMounts;
    }

    const jobs = crontab.jobs();
    log.info(`Found ${jobs.length} crontab jobs to check`);

    jobs.forEach((job) => {
      const comment = job.comment();
      const command = job.command();

      // Check if this is an app mount job (comments are app IDs)
      if (comment && command && command.includes('mount') && command.includes('ZelApps')) {
        const parts = command.split(' ');
        if (parts.length >= 6) {
          const volumePath = parts[4]; // The source volume path
          const mountPoint = parts[5]; // The mount point

          // Check if volume path has incorrect /flux/ pattern
          if (hasIncorrectFluxPath(volumePath)) {
            const appName = extractAppNameFromCrontabCommand(command);
            if (appName) {
              log.warn(`Found app with incorrect volume mount: ${appName}`);
              log.warn(`  Volume path: ${volumePath}`);
              log.warn(`  Mount point: ${mountPoint}`);
              appsWithIncorrectMounts.push({
                appName,
                volumePath,
                mountPoint,
                appId: comment,
              });
            }
          }
        }
      }
    });

    log.info(`Found ${appsWithIncorrectMounts.length} apps with incorrect volume mounts`);
  } catch (error) {
    log.error(`Error checking crontab for incorrect mounts: ${error.message}`);
  }

  return appsWithIncorrectMounts;
}

/**
 * Manually unmount the incorrect volume path
 * @param {string} mountPoint - The mount point to unmount
 * @returns {Promise<boolean>} - True if unmount was successful
 */
async function unmountIncorrectVolume(mountPoint) {
  try {
    log.info(`Attempting to unmount incorrect volume at: ${mountPoint}`);
    const execUnmount = `sudo umount ${mountPoint}`;
    await cmdAsync(execUnmount);
    log.info(`Successfully unmounted volume at: ${mountPoint}`);
    return true;
  } catch (error) {
    log.warn(`Failed to unmount volume at ${mountPoint}: ${error.message}`);
    // Continue even if unmount fails - the volume might not be mounted
    return false;
  }
}

/**
 * Remove crontab entry with incorrect volume information
 * @param {string} appId - The app ID (crontab comment)
 * @param {string} incorrectVolumePath - The incorrect volume path to match
 * @returns {Promise<boolean>} - True if crontab entry was removed
 */
async function removeCrontabEntry(appId, incorrectVolumePath) {
  try {
    log.info(`Attempting to remove crontab entry for app ID: ${appId}`);

    const crontab = await crontabLoad().catch((error) => {
      log.error(`Error loading crontab: ${error.message}`);
      return null;
    });

    if (!crontab) {
      log.warn('No crontab found, skipping crontab cleanup');
      return false;
    }

    const jobs = crontab.jobs();
    let jobRemoved = false;

    jobs.forEach((job) => {
      if (job.comment() === appId) {
        const command = job.command();
        // Check if this job contains the incorrect volume path
        if (command.includes(incorrectVolumePath)) {
          log.info(`Found crontab job with incorrect path: ${command}`);
          crontab.remove(job);
          jobRemoved = true;
        }
      }
    });

    if (jobRemoved) {
      try {
        crontab.save();
        log.info(`Successfully removed crontab entry for ${appId}`);
        return true;
      } catch (error) {
        log.error(`Error saving crontab: ${error.message}`);
        return false;
      }
    }

    log.info(`No crontab entry found for ${appId} with incorrect path`);
    return false;
  } catch (error) {
    log.error(`Error removing crontab entry: ${error.message}`);
    return false;
  }
}

/**
 * Get app specifications for redeployment
 * @param {string} appName - The app name
 * @returns {Promise<object|null>} - App specifications or null
 */
async function getAppSpecifications(appName) {
  try {
    // Import here to avoid circular dependency
    // eslint-disable-next-line global-require
    const appsService = require('./appsService');

    const specifications = await appsService.getApplicationSpecifications(appName);
    return specifications;
  } catch (error) {
    log.error(`Error getting app specifications for ${appName}: ${error.message}`);
    return null;
  }
}

/**
 * Hard redeploy app with incorrect volume mount
 * This removes the app completely and reinstalls it with correct volume paths
 * @param {string} appName - The app name to redeploy
 * @returns {Promise<boolean>} - True if redeploy was successful
 */
async function hardRedeployApp(appName) {
  try {
    log.info(`Attempting to hard redeploy app ${appName} due to incorrect volume mount`);

    // Get app specifications first
    const appSpecs = await getAppSpecifications(appName);
    if (!appSpecs) {
      log.error(`Cannot redeploy ${appName}: App specifications not found`);
      return false;
    }

    // Import here to avoid circular dependency
    // eslint-disable-next-line global-require
    const { hardRedeploy } = require('./appLifecycle/advancedWorkflows');

    // Perform hard redeploy (removes and reinstalls with correct paths)
    await hardRedeploy(appSpecs, null);

    log.info(`Successfully redeployed app ${appName} with correct volume paths`);
    return true;
  } catch (error) {
    log.error(`Error redeploying app ${appName}: ${error.message}`);
    return false;
  }
}

/**
 * Check and fix apps with incorrect volume mounts
 * This function runs on FluxOS startup
 * @returns {Promise<void>}
 */
async function checkAndFixIncorrectVolumeMounts() {
  try {
    log.info('=== Volume Validation Service: Starting check for incorrect volume mounts ===');

    const appsWithIncorrectMounts = await getAppsWithIncorrectVolumeMounts();

    if (appsWithIncorrectMounts.length === 0) {
      log.info('=== Volume Validation Service: No apps with incorrect volume mounts found ===');
      return;
    }

    log.warn(`=== Volume Validation Service: Found ${appsWithIncorrectMounts.length} apps with incorrect mounts ===`);

    // Process each app with incorrect mount sequentially
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsWithIncorrectMounts) {
      log.warn(`Processing app: ${app.appName}`);
      log.warn(`  App ID: ${app.appId}`);
      log.warn(`  Incorrect volume path: ${app.volumePath}`);
      log.warn(`  Mount point: ${app.mountPoint}`);

      // Step 1: Manually unmount the incorrect volume
      log.info(`Step 1: Unmounting incorrect volume for ${app.appName}...`);
      // eslint-disable-next-line no-await-in-loop
      await unmountIncorrectVolume(app.mountPoint);

      // Step 2: Remove the crontab entry with incorrect volume information
      log.info(`Step 2: Removing crontab entry for ${app.appName}...`);
      // eslint-disable-next-line no-await-in-loop
      await removeCrontabEntry(app.appId, app.volumePath);

      // Step 3: Hard redeploy the app (removes and reinstalls with correct volume paths)
      log.info(`Step 3: Hard redeploying app ${app.appName} with correct volume paths...`);
      // eslint-disable-next-line no-await-in-loop
      const redeployed = await hardRedeployApp(app.appName);
    }

    log.info('=== Volume Validation Service: Completed fixing incorrect volume mounts ===');
  } catch (error) {
    log.error(`Volume Validation Service error: ${error.message}`);
  }
}

module.exports = {
  checkAndFixIncorrectVolumeMounts,
  hasIncorrectFluxPath,
  getAppsWithIncorrectVolumeMounts,
  unmountIncorrectVolume,
  removeCrontabEntry,
  hardRedeployApp,
};
