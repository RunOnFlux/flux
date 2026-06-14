const fs = require('fs').promises;
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');
const mountParser = require('./mountParser');
const log = require('../../lib/log');
const { appsFolder } = require('./appConstants');

async function verifyAppVolumeMount(appName, isComponent, componentName) {
  const identifier = isComponent ? `${componentName}_${appName}` : appName;
  const appId = dockerService.getAppIdentifier(identifier);
  const mountPath = `${appsFolder}${appId}`;

  const result = await serviceHelper.runCommand('findmnt', { params: ['--target', mountPath, '--json'] });
  if (result.error) {
    const errorMessage = `Volume mount verification failed for ${mountPath}. Mount does not exist or is not accessible.`;
    log.error(`${errorMessage} Details: ${result.error.message}`);
    throw new Error(errorMessage);
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const mount = parsed.filesystems?.[0];
    if (mount && mount.target === mountPath) {
      log.info(`Volume mount verified for ${identifier} at ${mountPath}`);
      return true;
    }
  } catch (parseError) {
    log.error(`Volume mount verification: failed to parse findmnt output for ${mountPath}`);
  }

  throw new Error(`Volume mount verification failed for ${mountPath}. Mount does not exist or is not accessible.`);
}

/**
 * Creates a missing host mount path — a file (777) or a directory — as root.
 * Uses runCommand (execFile, no shell) so paths are passed as arguments and
 * cannot be shell-interpreted. Throws if the command fails.
 * @param {string} fullPath Absolute host path to create.
 * @param {boolean} isFile True for a file mount, false for a directory.
 */
async function createMountPath(fullPath, isFile) {
  if (isFile) {
    const touch = await serviceHelper.runCommand('touch', { runAsRoot: true, params: [fullPath] });
    if (touch.error) throw touch.error;
    const chmod = await serviceHelper.runCommand('chmod', { runAsRoot: true, params: ['777', fullPath] });
    if (chmod.error) throw chmod.error;
    log.info(`Created file mount with 777 permissions: ${fullPath}`);
  } else {
    const mkdir = await serviceHelper.runCommand('mkdir', { runAsRoot: true, params: ['-p', fullPath] });
    if (mkdir.error) throw mkdir.error;
    log.info(`Created directory: ${fullPath}`);
  }
}

/**
 * Ensures every host bind-mount path a component declares in its containerData
 * exists before its container is created or (re)started. Syncthing cleanup can
 * delete a mount source while a container is stopped, which would make the next
 * Docker start fail; recreating the directory/file here prevents that. Idempotent
 * and safe to call on every start — existing paths are left untouched.
 * @param {object} appSpecifications Component (or v<=3 app) specifications.
 * @param {string} appName Main app name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} fullAppSpecs Full app specifications (needed for component-reference mounts).
 * @returns {Promise<void>}
 */
async function ensureMountPathsExist(appSpecifications, appName, isComponent, fullAppSpecs) {
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  const appId = dockerService.getAppIdentifier(identifier);

  let parsedMounts;
  try {
    parsedMounts = mountParser.parseContainerData(appSpecifications.containerData);
  } catch (error) {
    log.error(`Failed to parse containerData for ${identifier}: ${error.message}`);
    throw error;
  }

  const requiredPaths = mountParser.getRequiredLocalPaths(parsedMounts);
  log.info(`Ensuring ${requiredPaths.length} local path(s) exist for ${appId}`);

  // Create all required directories and files (appdata and additional mounts at same level)
  // eslint-disable-next-line no-restricted-syntax
  for (const pathInfo of requiredPaths) {
    const fullPath = `${appsFolder}${appId}/${pathInfo.name}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(fullPath);
      log.info(`Path already exists: ${fullPath}`);
    } catch (error) {
      log.warn(`Path missing, creating: ${fullPath}`);
      // eslint-disable-next-line no-await-in-loop
      await createMountPath(fullPath, pathInfo.isFile);
    }
  }

  // Also ensure component reference paths exist — paths from OTHER components
  // that this component is trying to mount.
  const componentReferenceMounts = parsedMounts.allMounts.filter((mount) => (
    mount.type === mountParser.MountType.COMPONENT_PRIMARY
    || mount.type === mountParser.MountType.COMPONENT_DIRECTORY
    || mount.type === mountParser.MountType.COMPONENT_FILE
  ));

  if (componentReferenceMounts.length === 0) return;

  log.info(`Ensuring ${componentReferenceMounts.length} component reference path(s) exist for ${appId}`);

  // eslint-disable-next-line no-restricted-syntax
  for (const mount of componentReferenceMounts) {
    try {
      if (!fullAppSpecs) {
        throw new Error(`Component reference mount requires full app specifications: ${mount.containerPath}`);
      }

      let componentIdentifier;
      if (fullAppSpecs.version >= 4) {
        if (mount.componentIndex < 0 || mount.componentIndex >= fullAppSpecs.compose.length) {
          throw new Error(`Invalid component index: ${mount.componentIndex}`);
        }
        const componentName = fullAppSpecs.compose[mount.componentIndex].name;
        componentIdentifier = `${componentName}_${appName}`;
      } else {
        componentIdentifier = appName;
      }

      const componentAppId = dockerService.getAppIdentifier(componentIdentifier);
      const fullPath = mount.subdir === 'appdata'
        ? `${appsFolder}${componentAppId}/appdata`
        : `${appsFolder}${componentAppId}/${mount.subdir}`;

      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.access(fullPath);
        log.info(`Component reference path already exists: ${fullPath}`);
      } catch (error) {
        log.warn(`Component reference path missing, creating: ${fullPath}`);
        // eslint-disable-next-line no-await-in-loop
        await createMountPath(fullPath, mount.isFile);
      }
    } catch (error) {
      log.error(`Failed to ensure component reference path exists: ${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  verifyAppVolumeMount,
  ensureMountPathsExist,
};
