const util = require('util');
const systemcrontab = require('crontab');
const nodecmd = require('node-cmd');
const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const { localAppsInformation, appsFolder } = require('../utils/appConstants');
const dockerService = require('../dockerService');
const appUninstaller = require('./appUninstaller');
const { isPathMounted } = require('../appMonitoring/syncthingFolderStateMachine');

const crontabLoad = util.promisify(systemcrontab.load);
const cmdAsync = util.promisify(nodecmd.run);

/**
 * Get all locally installed app IDs
 * @returns {Promise<Set<string>>} Set of installed app IDs
 */
async function getInstalledAppIds() {
  const installedAppIds = new Set();

  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const appsProjection = {
      projection: { _id: 0 },
    };

    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, {}, appsProjection);

    if (!apps || !Array.isArray(apps)) {
      return installedAppIds;
    }

    apps.forEach((app) => {
      if (app.version <= 3) {
        // Legacy app - single app ID
        const appId = dockerService.getAppIdentifier(app.name);
        installedAppIds.add(appId);
      } else {
        // Newer app - multiple components
        if (app.compose && Array.isArray(app.compose)) {
          app.compose.forEach((component) => {
            const appId = dockerService.getAppIdentifier(`${component.name}_${app.name}`);
            installedAppIds.add(appId);
          });
        }
      }
    });
  } catch (error) {
    log.error(`getInstalledAppIds - Error: ${error.message}`);
  }

  return installedAppIds;
}

/**
 * Extract app name from appId
 * AppIds are in format: fluxappname or fluxcomponent_appname
 * @param {string} appId - App ID (e.g., fluxwp_wordpress123)
 * @returns {string} App name (e.g., wordpress123)
 */
function extractAppNameFromAppId(appId) {
  // Remove 'flux' prefix
  const withoutFlux = appId.replace(/^flux/, '');

  // If contains underscore, it's a component: component_appname
  // We need the main app name (after the underscore)
  if (withoutFlux.includes('_')) {
    const parts = withoutFlux.split('_');
    // Return the app name (last part after component name)
    return parts.slice(1).join('_');
  }

  // Otherwise it's just the app name
  return withoutFlux;
}

/**
 * Check if a crontab mount command has the wait logic
 * @param {string} command - The crontab command
 * @returns {boolean} True if it has wait logic
 */
function hasWaitLogic(command) {
  return command.includes('while [ ! -f') && command.includes('do sleep') && command.includes('done &&');
}

/**
 * Extract volume file path from mount command
 * @param {string} command - The mount command
 * @returns {string|null} Volume file path or null
 */
function extractVolumeFile(command) {
  // Match: sudo mount -o loop /path/to/file /mount/point
  // Or: while ... && sudo mount -o loop /path/to/file /mount/point
  const match = command.match(/sudo mount -o loop\s+([^\s]+FLUXFSVOL)\s+/);
  return match ? match[1] : null;
}

/**
 * Extract app ID from crontab comment or mount path
 * @param {string} comment - Job comment
 * @param {string} command - Job command
 * @returns {string|null} App ID or null
 */
function extractAppIdFromJob(comment, command) {
  // Comment is typically the appId
  if (comment && comment.includes('flux')) {
    return comment;
  }

  // Try to extract from mount path
  const match = command.match(/\/([^/]+FLUXFSVOL)/);
  if (match) {
    // Remove FLUXFSVOL suffix to get appId
    return match[1].replace('FLUXFSVOL', '');
  }

  return null;
}

/**
 * Extract mount point from mount command
 * @param {string} command - The mount command
 * @returns {string|null} Mount point path or null
 */
function extractMountPoint(command) {
  // Match: sudo mount -o loop /path/to/file /mount/point
  const match = command.match(/sudo mount -o loop\s+[^\s]+FLUXFSVOL\s+([^\s]+)/);
  return match ? match[1] : null;
}

/**
 * Convert old mount command to new format with wait logic
 * @param {string} oldCommand - Old mount command without wait
 * @returns {string} New command with wait logic
 */
function addWaitLogicToCommand(oldCommand) {
  const volumeFile = extractVolumeFile(oldCommand);
  if (!volumeFile) {
    log.warn(`addWaitLogicToCommand - Could not extract volume file from: ${oldCommand}`);
    return oldCommand;
  }

  // Extract mount point
  const mountPoint = extractMountPoint(oldCommand);
  if (!mountPoint) {
    log.warn(`addWaitLogicToCommand - Could not extract mount point from: ${oldCommand}`);
    return oldCommand;
  }

  return `while [ ! -f ${volumeFile} ]; do sleep 5; done && sudo mount -o loop ${volumeFile} ${mountPoint}`;
}

/**
 * Execute mount command for an app if not already mounted
 * @param {string} appId - App ID
 * @param {string} volumeFile - Volume file path
 * @param {string} mountPoint - Mount point path
 * @returns {Promise<{mounted: boolean, error: string|null}>} Mount result
 */
async function ensureAppMounted(appId, volumeFile, mountPoint) {
  try {
    // Check if already mounted
    const isMounted = await isPathMounted(mountPoint);
    if (isMounted) {
      log.info(`ensureAppMounted - ${appId} is already mounted at ${mountPoint}`);
      return { mounted: true, error: null };
    }

    // Check if volume file exists
    try {
      const fs = require('node:fs');
      await fs.promises.access(volumeFile);
    } catch (err) {
      log.warn(`ensureAppMounted - Volume file ${volumeFile} does not exist for ${appId}`);
      return { mounted: false, error: 'Volume file does not exist' };
    }

    // Check if mount point directory exists
    try {
      const fs = require('node:fs');
      const stats = await fs.promises.stat(mountPoint);
      if (!stats.isDirectory()) {
        log.error(`ensureAppMounted - Mount point ${mountPoint} is not a directory for ${appId}`);
        return { mounted: false, error: 'Mount point is not a directory' };
      }
    } catch (err) {
      log.warn(`ensureAppMounted - Mount point ${mountPoint} does not exist for ${appId}, creating it`);
      try {
        await cmdAsync(`sudo mkdir -p ${mountPoint}`);
      } catch (mkdirErr) {
        log.error(`ensureAppMounted - Failed to create mount point ${mountPoint}: ${mkdirErr.message}`);
        return { mounted: false, error: `Failed to create mount point: ${mkdirErr.message}` };
      }
    }

    // Execute mount command
    log.info(`ensureAppMounted - Mounting ${appId}: ${volumeFile} -> ${mountPoint}`);
    await cmdAsync(`sudo mount -o loop ${volumeFile} ${mountPoint}`);
    log.info(`ensureAppMounted - Successfully mounted ${appId}`);
    return { mounted: true, error: null };
  } catch (error) {
    log.error(`ensureAppMounted - Failed to mount ${appId}: ${error.message}`);
    return { mounted: false, error: error.message };
  }
}

/**
 * Cleanup and fix crontab mount entries
 * - Updates mount commands without wait logic to include it
 * - Removes mount entries for apps that are no longer installed
 * - Ensures all installed apps with crontab entries have active mounts
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupCrontabAndMounts() {
  const results = {
    crontab: {
      updated: [],
      removed: [],
      unchanged: [],
      errors: [],
    },
    mounts: {
      mounted: [],
      alreadyMounted: [],
      failed: [],
    },
  };

  try {
    log.info('cleanupCrontabAndMounts - Starting crontab and mounts cleanup');

    // Get installed app IDs
    const installedAppIds = await getInstalledAppIds();
    log.info(`cleanupCrontabAndMounts - Found ${installedAppIds.size} installed apps`);

    // Load crontab
    const crontab = await crontabLoad();
    const jobs = crontab.jobs();

    if (!jobs || jobs.length === 0) {
      log.info('cleanupCrontabAndMounts - No crontab jobs found');
      return results;
    }

    const jobsToRemove = [];
    const jobsToUpdate = [];
    const mountsToVerify = [];

    // Analyze each job
    jobs.forEach((job) => {
      if (!job || !job.isValid()) {
        return;
      }

      const command = job.command ? job.command() : '';
      const comment = job.comment ? job.comment() : '';

      // Check if this is a mount job
      if (!command.includes('sudo mount -o loop') || !command.includes('FLUXFSVOL')) {
        return;
      }

      const appId = extractAppIdFromJob(comment, command);
      if (!appId) {
        log.warn(`cleanupCrontabAndMounts - Could not extract appId from job: ${comment}`);
        return;
      }

      // Check if app is still installed
      if (!installedAppIds.has(appId)) {
        log.info(`cleanupCrontabAndMounts - App ${appId} not installed, marking for removal`);
        jobsToRemove.push({ job, appId, comment });
        return;
      }

      // Extract mount info for verification
      const volumeFile = extractVolumeFile(command);
      const mountPoint = extractMountPoint(command);
      if (volumeFile && mountPoint) {
        mountsToVerify.push({ appId, volumeFile, mountPoint });
      }

      // Check if mount command has wait logic
      if (!hasWaitLogic(command)) {
        log.info(`cleanupCrontabAndMounts - App ${appId} mount missing wait logic, marking for update`);
        jobsToUpdate.push({
          job, appId, comment, oldCommand: command,
        });
      } else {
        results.crontab.unchanged.push(appId);
      }
    });

    // Remove jobs for uninstalled apps
    jobsToRemove.forEach(({ job, appId, comment }) => {
      try {
        crontab.remove(job);
        results.crontab.removed.push(appId);
        log.info(`cleanupCrontabAndMounts - Removed mount job for uninstalled app: ${appId} (comment: ${comment})`);
      } catch (error) {
        log.error(`cleanupCrontabAndMounts - Failed to remove job for ${appId}: ${error.message}`);
        results.crontab.errors.push({ appId, action: 'remove', error: error.message });
      }
    });

    // Update jobs without wait logic
    // eslint-disable-next-line no-restricted-syntax
    for (const {
      job, appId, comment, oldCommand,
    } of jobsToUpdate) {
      try {
        const newCommand = addWaitLogicToCommand(oldCommand);
        if (newCommand !== oldCommand) {
          // Remove old job and create new one
          crontab.remove(job);
          const newJob = crontab.create(newCommand, '@reboot', comment);
          if (newJob && newJob.isValid()) {
            results.crontab.updated.push(appId);
            log.info(`cleanupCrontabAndMounts - Updated mount job for ${appId} to include wait logic`);
          } else {
            log.error(`cleanupCrontabAndMounts - Failed to create updated job for ${appId}, uninstalling app`);
            results.crontab.errors.push({ appId, action: 'update', error: 'Failed to create new job' });
            // Uninstall the app locally and notify peers
            const appName = extractAppNameFromAppId(appId);
            log.warn(`cleanupCrontabAndMounts - Removing app ${appName} due to crontab update failure`);
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(appName, null, true, false, true).catch((uninstallError) => {
              log.error(`cleanupCrontabAndMounts - Failed to uninstall ${appName}: ${uninstallError.message}`);
            });
            // Remove from mounts to verify since app is being uninstalled
            const mountIndex = mountsToVerify.findIndex((m) => m.appId === appId);
            if (mountIndex !== -1) {
              mountsToVerify.splice(mountIndex, 1);
            }
          }
        }
      } catch (error) {
        log.error(`cleanupCrontabAndMounts - Failed to update job for ${appId}: ${error.message}`);
        results.crontab.errors.push({ appId, action: 'update', error: error.message });
      }
    }

    // Save crontab changes if any modifications were made
    if (results.crontab.updated.length > 0 || results.crontab.removed.length > 0) {
      crontab.save();
      log.info(`cleanupCrontabAndMounts - Crontab saved. Updated: ${results.crontab.updated.length}, Removed: ${results.crontab.removed.length}`);
    } else {
      log.info('cleanupCrontabAndMounts - No crontab changes needed');
    }

    // Verify and create missing mounts for installed apps
    log.info(`cleanupCrontabAndMounts - Verifying ${mountsToVerify.length} mounts for installed apps`);
    // eslint-disable-next-line no-restricted-syntax
    for (const { appId, volumeFile, mountPoint } of mountsToVerify) {
      // eslint-disable-next-line no-await-in-loop
      const mountResult = await ensureAppMounted(appId, volumeFile, mountPoint);
      if (mountResult.error) {
        results.mounts.failed.push({ appId, error: mountResult.error });
      } else if (mountResult.mounted) {
        // Check if we actually mounted it or it was already mounted
        const wasMounted = await isPathMounted(mountPoint);
        if (wasMounted) {
          // It's mounted now - but was it before?
          // We'll track it as mounted regardless
          results.mounts.mounted.push(appId);
        }
      }
    }

    log.info(
      `cleanupCrontabAndMounts - Cleanup complete. `
      + `Crontab: Updated ${results.crontab.updated.length}, Removed ${results.crontab.removed.length}, Unchanged ${results.crontab.unchanged.length}, Errors ${results.crontab.errors.length}. `
      + `Mounts: Ensured ${results.mounts.mounted.length}, Failed ${results.mounts.failed.length}`,
    );

    return results;
  } catch (error) {
    log.error(`cleanupCrontabAndMounts - Critical error: ${error.message}`);
    results.crontab.errors.push({ appId: 'global', action: 'cleanup', error: error.message });
    return results;
  }
}

module.exports = {
  cleanupCrontabAndMounts,
  getInstalledAppIds,
  hasWaitLogic,
  extractVolumeFile,
  extractAppIdFromJob,
  extractMountPoint,
  addWaitLogicToCommand,
  extractAppNameFromAppId,
  ensureAppMounted,
};
