/**
 * Image Update Service
 *
 * Native FluxOS service that monitors installed apps for image updates
 * and triggers soft redeploys when newer images are available.
 * Replaces the external containrrr/watchtower Docker container.
 */

const log = require('../lib/log');
const dockerService = require('./dockerService');
const appQueryService = require('./appQuery/appQueryService');
const advancedWorkflows = require('./appLifecycle/advancedWorkflows');
const registryCredentialHelper = require('./utils/registryCredentialHelper');
const { ImageVerifier } = require('./utils/imageVerifier');
const serviceHelper = require('./serviceHelper');
const globalState = require('./utils/globalState');

// Rate limiting configuration
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const DELAY_BETWEEN_APPS = 5000; // 5 seconds between app checks
const DELAY_AFTER_REDEPLOY = 2 * 60 * 1000; // 2 minutes after redeploy
const INITIAL_DELAY = 10 * 60 * 1000; // 10 minutes after startup

// Track the interval timer
let checkIntervalTimer = null;

/**
 * Removes the existing flux_watchtower container if it exists.
 * Called during startup to clean up the old Watchtower approach.
 * @returns {Promise<boolean>} True if container was found and removed, false otherwise
 */
async function removeWatchtowerContainer() {
  try {
    const containers = await dockerService.dockerListContainers(true);
    const watchtowerContainer = containers.find(
      (container) => container.Names.some((name) => name === '/flux_watchtower'),
    );

    if (!watchtowerContainer) {
      log.info('No flux_watchtower container found to remove');
      return false;
    }

    log.info('Found flux_watchtower container, stopping and removing...');

    try {
      // Get the container object and stop it
      const container = dockerService.getDockerContainer(watchtowerContainer.Id);
      if (watchtowerContainer.State === 'running') {
        await container.stop();
        log.info('flux_watchtower container stopped');
      }
      await container.remove();
      log.info('flux_watchtower container removed');
    } catch (stopError) {
      // Container might already be stopped, try to remove directly
      log.warn(`Error stopping watchtower container: ${stopError.message}, attempting remove`);
      try {
        const container = dockerService.getDockerContainer(watchtowerContainer.Id);
        await container.remove({ force: true });
        log.info('flux_watchtower container force removed');
      } catch (removeError) {
        log.error(`Failed to remove flux_watchtower container: ${removeError.message}`);
        return false;
      }
    }

    // Optionally remove the watchtower image
    try {
      const images = await dockerService.dockerListImages();
      const watchtowerImage = images.find(
        (img) => img.RepoTags && img.RepoTags.some((tag) => tag.startsWith('containrrr/watchtower')),
      );
      if (watchtowerImage) {
        const docker = require('dockerode');
        const dockerInstance = new docker();
        const image = dockerInstance.getImage(watchtowerImage.Id);
        await image.remove();
        log.info('containrrr/watchtower image removed');
      }
    } catch (imageError) {
      // Image removal is optional, don't fail if it doesn't work
      log.warn(`Could not remove watchtower image: ${imageError.message}`);
    }

    return true;
  } catch (error) {
    log.error(`Error in removeWatchtowerContainer: ${error.message}`);
    return false;
  }
}

/**
 * Gets the local image digest for a container.
 * @param {string} containerName Full container name (e.g., 'fluxMyApp' or 'fluxweb_MyApp')
 * @returns {Promise<string|null>} The image digest (sha256:xxx) or null if not found
 */
async function getLocalImageDigest(containerName) {
  try {
    // Inspect the container to get the image ID
    const containerInfo = await dockerService.dockerContainerInspect(containerName);
    if (!containerInfo || !containerInfo.Image) {
      log.warn(`Container ${containerName} not found or has no image`);
      return null;
    }

    // Get the image digest from RepoDigests
    const images = await dockerService.dockerListImages();
    const containerImage = images.find((img) => img.Id === containerInfo.Image);

    if (!containerImage) {
      log.warn(`Image for container ${containerName} not found in local images`);
      return null;
    }

    // RepoDigests contains entries like "repo@sha256:xxx"
    if (containerImage.RepoDigests && containerImage.RepoDigests.length > 0) {
      // Extract digest from format "repo@sha256:xxx"
      const repoDigest = containerImage.RepoDigests[0];
      const digestMatch = repoDigest.match(/@(sha256:[a-f0-9]+)$/);
      if (digestMatch) {
        return digestMatch[1];
      }
    }

    log.warn(`No RepoDigests found for container ${containerName}`);
    return null;
  } catch (error) {
    log.warn(`Error getting local image digest for ${containerName}: ${error.message}`);
    return null;
  }
}

/**
 * Gets the remote manifest digest from a registry.
 * @param {string} repotag Image tag (e.g., 'nginx:latest')
 * @param {string|null} repoauth Authentication string (encrypted for v7, plain for v8+)
 * @param {number} specVersion Application specification version
 * @param {string} appName Application name (for credential caching)
 * @returns {Promise<string|null>} The manifest digest (sha256:xxx) or null on error
 */
async function getRemoteManifestDigest(repotag, repoauth, specVersion, appName) {
  try {
    const verifierOptions = {};

    // Get credentials if authentication is required
    if (repoauth && specVersion >= 7) {
      try {
        const credentials = await registryCredentialHelper.getCredentials(
          repotag,
          repoauth,
          specVersion,
          appName,
        );
        if (credentials) {
          verifierOptions.credentials = credentials;
        }
      } catch (credError) {
        log.warn(`Failed to get credentials for ${appName}/${repotag}: ${credError.message}`);
        return null;
      }
    }

    const verifier = new ImageVerifier(repotag, verifierOptions);

    if (verifier.parseError) {
      log.warn(`Failed to parse image tag ${repotag}: ${verifier.errorDetail}`);
      return null;
    }

    const digest = await verifier.fetchManifestDigestOnly();

    if (verifier.error) {
      const errorMeta = verifier.errorMeta;
      if (errorMeta && errorMeta.errorType === 'rate_limit') {
        log.warn(`Rate limited while checking ${repotag}`);
        // Signal to abort remaining checks
        throw new Error('RATE_LIMITED');
      }
      log.warn(`Failed to fetch manifest digest for ${repotag}: ${verifier.errorDetail}`);
      return null;
    }

    return digest;
  } catch (error) {
    if (error.message === 'RATE_LIMITED') {
      throw error; // Re-throw rate limit errors
    }
    log.warn(`Error getting remote manifest digest for ${repotag}: ${error.message}`);
    return null;
  }
}

/**
 * Checks if a specific app needs an update.
 * @param {object} appSpec Application specification
 * @returns {Promise<{needsUpdate: boolean, components: Array}>} Update status and components that need updates
 */
async function checkAppForUpdates(appSpec) {
  const result = { needsUpdate: false, components: [] };

  try {
    // Handle v1-v3 apps (single container)
    if (appSpec.version < 4) {
      const containerName = dockerService.getAppIdentifier(appSpec.name);
      const localDigest = await getLocalImageDigest(containerName);

      if (!localDigest) {
        log.debug(`Could not get local digest for ${appSpec.name}, skipping`);
        return result;
      }

      const remoteDigest = await getRemoteManifestDigest(
        appSpec.repotag,
        appSpec.repoauth || null,
        appSpec.version,
        appSpec.name,
      );

      if (!remoteDigest) {
        log.debug(`Could not get remote digest for ${appSpec.name}, skipping`);
        return result;
      }

      if (localDigest !== remoteDigest) {
        log.info(`Update available for ${appSpec.name}: ${localDigest} -> ${remoteDigest}`);
        result.needsUpdate = true;
        result.components.push({
          name: appSpec.name,
          repotag: appSpec.repotag,
          localDigest,
          remoteDigest,
        });
      }

      return result;
    }

    // Handle v4+ apps (compose with multiple components)
    if (!appSpec.compose || !Array.isArray(appSpec.compose)) {
      log.warn(`App ${appSpec.name} has no compose array, skipping`);
      return result;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      // Container naming: flux{componentName}_{appName}
      const containerName = `${dockerService.getAppIdentifier(component.name)}_${appSpec.name}`;

      // eslint-disable-next-line no-await-in-loop
      const localDigest = await getLocalImageDigest(containerName);

      if (!localDigest) {
        log.debug(`Could not get local digest for ${appSpec.name}/${component.name}, skipping component`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const remoteDigest = await getRemoteManifestDigest(
        component.repotag,
        component.repoauth || null,
        appSpec.version,
        appSpec.name,
      );

      if (!remoteDigest) {
        log.debug(`Could not get remote digest for ${appSpec.name}/${component.name}, skipping component`);
        // eslint-disable-next-line no-continue
        continue;
      }

      if (localDigest !== remoteDigest) {
        log.info(`Update available for ${appSpec.name}/${component.name}: ${localDigest} -> ${remoteDigest}`);
        result.needsUpdate = true;
        result.components.push({
          name: component.name,
          repotag: component.repotag,
          localDigest,
          remoteDigest,
        });
      }

      // Add delay between component checks for rate limiting
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1000);
    }

    return result;
  } catch (error) {
    if (error.message === 'RATE_LIMITED') {
      throw error;
    }
    log.warn(`Error checking updates for ${appSpec.name}: ${error.message}`);
    return result;
  }
}

/**
 * Triggers a soft redeploy for an app.
 * @param {object} appSpec Application specification
 * @returns {Promise<boolean>} True if redeploy was triggered, false otherwise
 */
async function triggerAppUpdate(appSpec) {
  try {
    // Double-check globalState flags before triggering
    if (
      globalState.removalInProgress
      || globalState.installationInProgress
      || globalState.softRedeployInProgress
      || globalState.hardRedeployInProgress
    ) {
      log.warn(`Skipping redeploy for ${appSpec.name}: another operation in progress`);
      return false;
    }

    log.info(`Triggering soft redeploy for ${appSpec.name}`);

    // Call softRedeploy without response object (internal call)
    await advancedWorkflows.softRedeploy(appSpec, null);

    return true;
  } catch (error) {
    log.error(`Error triggering redeploy for ${appSpec.name}: ${error.message}`);
    return false;
  }
}

/**
 * Main function that checks all installed apps for updates.
 * Called periodically by the interval timer.
 */
async function checkForImageUpdates() {
  log.info('Starting image update check cycle');

  // Check if any operation is in progress
  if (
    globalState.removalInProgress
    || globalState.installationInProgress
    || globalState.softRedeployInProgress
    || globalState.hardRedeployInProgress
  ) {
    log.info('Skipping image update check: another operation in progress');
    return;
  }

  try {
    // Get all installed apps
    const installedAppsResponse = await appQueryService.installedApps();

    if (installedAppsResponse.status !== 'success' || !installedAppsResponse.data) {
      log.warn('Could not get installed apps list');
      return;
    }

    const apps = installedAppsResponse.data;
    log.info(`Checking ${apps.length} installed apps for image updates`);

    let updatesTriggered = 0;
    let appsChecked = 0;

    // eslint-disable-next-line no-restricted-syntax
    for (const appSpec of apps) {
      // Re-check flags before each app
      if (
        globalState.removalInProgress
        || globalState.installationInProgress
        || globalState.softRedeployInProgress
        || globalState.hardRedeployInProgress
      ) {
        log.info('Aborting image update check: operation started');
        break;
      }

      try {
        appsChecked += 1;

        // eslint-disable-next-line no-await-in-loop
        const updateStatus = await checkAppForUpdates(appSpec);

        if (updateStatus.needsUpdate) {
          // eslint-disable-next-line no-await-in-loop
          const redeployTriggered = await triggerAppUpdate(appSpec);
          if (redeployTriggered) {
            updatesTriggered += 1;
            // Wait longer after triggering a redeploy
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(DELAY_AFTER_REDEPLOY);
          }
        }

        // Add delay between apps for rate limiting
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(DELAY_BETWEEN_APPS);
      } catch (error) {
        if (error.message === 'RATE_LIMITED') {
          log.warn('Rate limited by registry, aborting remaining checks this cycle');
          break;
        }
        log.warn(`Error checking app ${appSpec.name}: ${error.message}`);
      }
    }

    log.info(`Image update check cycle complete: checked ${appsChecked} apps, triggered ${updatesTriggered} updates`);
  } catch (error) {
    log.error(`Error in image update check cycle: ${error.message}`);
  }
}

/**
 * Starts the image update service.
 * Sets up the periodic check interval.
 */
function startImageUpdateService() {
  log.info('Starting native image update service');

  // Clear any existing interval
  if (checkIntervalTimer) {
    clearInterval(checkIntervalTimer);
  }

  // Set up periodic check
  checkIntervalTimer = setInterval(checkForImageUpdates, CHECK_INTERVAL);

  // Run initial check after a delay
  setTimeout(() => {
    log.info('Running initial image update check');
    checkForImageUpdates();
  }, INITIAL_DELAY);

  log.info(`Image update service started. Check interval: ${CHECK_INTERVAL / 1000 / 60 / 60} hours`);
}

/**
 * Stops the image update service.
 * Clears the periodic check interval.
 */
function stopImageUpdateService() {
  if (checkIntervalTimer) {
    clearInterval(checkIntervalTimer);
    checkIntervalTimer = null;
    log.info('Image update service stopped');
  }
}

module.exports = {
  removeWatchtowerContainer,
  startImageUpdateService,
  stopImageUpdateService,
  checkForImageUpdates,
  // Exported for testing
  getLocalImageDigest,
  getRemoteManifestDigest,
  checkAppForUpdates,
  triggerAppUpdate,
};
