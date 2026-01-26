/**
 * Hardware Validation Service
 *
 * This module validates all installed applications against current node hardware
 * specifications during boot. Apps that no longer meet CPU/RAM/HDD requirements
 * (due to VM downsizing or other hardware changes) are automatically removed.
 *
 * Uses cumulative resource validation to handle scenarios where multiple apps
 * collectively exceed capacity. Apps are kept in order of installation (oldest first,
 * based on blockchain height) and newer apps are removed when capacity is exceeded.
 */

const log = require('../../lib/log');
const config = require('config');
const registryManager = require('../appDatabase/registryManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const appUninstaller = require('./appUninstaller');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');

const REMOVAL_DELAY = 5000; // 5 seconds between removals

/**
 * Main entry point - performs boot-time hardware validation
 * @returns {Promise<Object>} Results summary
 */
async function performBootTimeHardwareValidation() {
  const results = {
    appsChecked: 0,
    appsRemoved: [],
    appsFailed: [],
  };

  try {
    log.info('hardwareValidationService - Starting boot-time hardware validation');

    // STEP 1: Get all installed apps
    const installedApps = await registryManager.getInstalledApps();

    if (!installedApps || installedApps.length === 0) {
      log.info('hardwareValidationService - No installed apps found');
      return results;
    }

    results.appsChecked = installedApps.length;
    log.info(`hardwareValidationService - Found ${installedApps.length} installed apps`);

    // STEP 2: Perform cumulative validation (single pass)
    const appsToRemove = await validateAppsCumulatively(installedApps);

    // STEP 3: Remove non-compliant apps
    if (appsToRemove.length > 0) {
      log.warn(`hardwareValidationService - Found ${appsToRemove.length} apps to remove due to hardware constraints`);
      const removalResults = await removeNonCompliantApps(appsToRemove);
      results.appsRemoved = removalResults.removed;
      results.appsFailed = removalResults.failed;
    } else {
      log.info('hardwareValidationService - All installed apps meet hardware requirements');
    }

    return results;
  } catch (error) {
    log.error(`hardwareValidationService - Critical error: ${error.message}`);
    return results;
  } finally {
    log.info(
      'hardwareValidationService - Validation complete. '
      + `Apps checked: ${results.appsChecked}, `
      + `Apps removed: ${results.appsRemoved.length}, `
      + `Failed removals: ${results.appsFailed.length}`,
    );
  }
}

/**
 * Validate apps cumulatively against node resources
 * Keeps oldest apps (by blockchain height) and removes newer apps when capacity exceeded
 * @param {Array} installedApps - Array of installed app records
 * @returns {Promise<Array>} Array of {name, reason, height} objects to remove
 */
async function validateAppsCumulatively(installedApps) {
  const appsToRemove = [];

  try {
    // Get node tier and specs
    const tier = await generalService.nodeTier();
    const nodeSpecs = await hwRequirements.getNodeSpecs();

    // Calculate available resources
    const totalCpuOnNode = nodeSpecs.cpuCores * 10;
    const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;

    const totalRamOnNode = nodeSpecs.ram;
    const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;

    const totalSpaceOnNode = nodeSpecs.ssdStorage;
    if (totalSpaceOnNode === 0) {
      log.error('hardwareValidationService - No storage detected, cannot validate apps');
      return appsToRemove;
    }
    const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;

    log.info(`hardwareValidationService - Available resources: CPU=${useableCpuOnNode / 10}, RAM=${useableRamOnNode}MB, HDD=${useableSpaceOnNode}GB`);

    // Sort apps by height (oldest first) - lower height = older
    const sortedApps = installedApps.sort((a, b) => (a.height || 0) - (b.height || 0));

    // Track cumulative resources
    let cumulativeCpu = 0;
    let cumulativeRam = 0;
    let cumulativeHdd = 0;

    // Process each app in order (oldest to newest)
    for (const app of sortedApps) {
      try {
        // Get full app spec (handles enterprise decryption)
        const appSpec = await registryManager.getApplicationGlobalSpecifications(app.name);

        if (!appSpec) {
          log.warn(`hardwareValidationService - No spec found for ${app.name}, skipping`);
          continue;
        }

        // Calculate resources needed by this app
        const appResources = hwRequirements.totalAppHWRequirements(appSpec, tier);
        const appCpu = appResources.cpu * 10;
        const appRam = appResources.ram;
        const appHdd = appResources.hdd + config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap;

        // Check if this app individually exceeds node capacity
        if (appCpu > useableCpuOnNode) {
          appsToRemove.push({
            name: app.name,
            reason: `App requires ${appResources.cpu} CPU but node only has ${useableCpuOnNode / 10} CPU available`,
            height: app.height || 0,
          });
          log.warn(`hardwareValidationService - ${app.name} individually exceeds CPU capacity`);
          continue;
        }

        if (appRam > useableRamOnNode) {
          appsToRemove.push({
            name: app.name,
            reason: `App requires ${appRam}MB RAM but node only has ${useableRamOnNode}MB available`,
            height: app.height || 0,
          });
          log.warn(`hardwareValidationService - ${app.name} individually exceeds RAM capacity`);
          continue;
        }

        if (appHdd > useableSpaceOnNode) {
          appsToRemove.push({
            name: app.name,
            reason: `App requires ${appHdd}GB storage but node only has ${useableSpaceOnNode}GB available`,
            height: app.height || 0,
          });
          log.warn(`hardwareValidationService - ${app.name} individually exceeds storage capacity`);
          continue;
        }

        // Check if adding this app would exceed cumulative capacity
        const newCumulativeCpu = cumulativeCpu + appCpu;
        const newCumulativeRam = cumulativeRam + appRam;
        const newCumulativeHdd = cumulativeHdd + appHdd;

        if (newCumulativeCpu > useableCpuOnNode) {
          appsToRemove.push({
            name: app.name,
            reason: `Cumulative CPU limit exceeded (${newCumulativeCpu / 10} > ${useableCpuOnNode / 10}). Removing newer apps.`,
            height: app.height || 0,
          });
          log.warn(`hardwareValidationService - ${app.name} causes cumulative CPU to exceed capacity`);
          continue;
        }

        if (newCumulativeRam > useableRamOnNode) {
          appsToRemove.push({
            name: app.name,
            reason: `Cumulative RAM limit exceeded (${newCumulativeRam}MB > ${useableRamOnNode}MB). Removing newer apps.`,
            height: app.height || 0,
          });
          log.warn(`hardwareValidationService - ${app.name} causes cumulative RAM to exceed capacity`);
          continue;
        }

        if (newCumulativeHdd > useableSpaceOnNode) {
          appsToRemove.push({
            name: app.name,
            reason: `Cumulative storage limit exceeded (${newCumulativeHdd}GB > ${useableSpaceOnNode}GB). Removing newer apps.`,
            height: app.height || 0,
          });
          log.warn(`hardwareValidationService - ${app.name} causes cumulative storage to exceed capacity`);
          continue;
        }

        // App fits! Update cumulative totals
        cumulativeCpu = newCumulativeCpu;
        cumulativeRam = newCumulativeRam;
        cumulativeHdd = newCumulativeHdd;

        log.info(`hardwareValidationService - ${app.name} fits (cumulative: CPU=${cumulativeCpu / 10}, RAM=${cumulativeRam}MB, HDD=${cumulativeHdd}GB)`);
      } catch (error) {
        log.error(`hardwareValidationService - Error validating ${app.name}: ${error.message}`);
      }
    }
  } catch (error) {
    log.error(`hardwareValidationService - Error in cumulative validation: ${error.message}`);
  }

  return appsToRemove;
}

/**
 * Remove apps that don't meet hardware requirements
 * @param {Array} appsToRemove - Array of {name, reason} objects
 * @returns {Promise<Object>} Removal results {removed: [], failed: []}
 */
async function removeNonCompliantApps(appsToRemove) {
  const results = { removed: [], failed: [] };

  for (const appInfo of appsToRemove) {
    try {
      log.warn(`REMOVAL REASON: Hardware downgrade - ${appInfo.name} (${appInfo.reason})`);
      log.info(`hardwareValidationService - Removing ${appInfo.name}`);

      await appUninstaller.removeAppLocally(
        appInfo.name,
        null,   // no res object
        true,   // force=true (aggressive removal)
        true,   // endResponse=true
        true,   // sendMessage=true (broadcast to network)
      );

      results.removed.push(appInfo.name);
      log.info(`hardwareValidationService - Successfully removed ${appInfo.name}`);

      // Delay between removals to avoid system overload
      await serviceHelper.delay(REMOVAL_DELAY);
    } catch (error) {
      log.error(`hardwareValidationService - Failed to remove ${appInfo.name}: ${error.message}`);
      results.failed.push({
        name: appInfo.name,
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  performBootTimeHardwareValidation,
  validateAppsCumulatively,
  removeNonCompliantApps,
};
