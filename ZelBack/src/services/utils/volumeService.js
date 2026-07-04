const fs = require('fs').promises;
const path = require('node:path');
const util = require('node:util');
const df = require('node-df');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');
const mountParser = require('./mountParser');
const log = require('../../lib/log');
const { appsFolder, appVolumesPath, legacyAppVolumesPath } = require('./appConstants');

const dfAsync = util.promisify(df);

/**
 * Whether a path currently has a filesystem mounted on it. Reads
 * /proc/self/mountinfo - one silent file read instead of forking
 * mountpoint(1), so callers can probe freely without process-spawn cost or
 * log noise. Falls back to the mountpoint binary if the read fails.
 * @param {string} dirPath Directory path to check.
 * @returns {Promise<boolean>} True if the path is a mountpoint.
 */
async function isPathMounted(dirPath) {
  const mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => null);
  if (mountinfo === null) {
    const result = await serviceHelper.runCommand('mountpoint', { params: ['-q', dirPath], logError: false });
    return !result.error;
  }
  const target = path.resolve(dirPath);
  // field 5 of each mountinfo line is the mount point, with space/tab/newline/
  // backslash octal-escaped
  const unescapeMount = (s) => s.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  return mountinfo.split('\n').some((line) => {
    const fields = line.split(' ');
    return fields.length > 4 && unescapeMount(fields[4]) === target;
  });
}

/**
 * Locates the backing FLUXFSVOL image for an app component deterministically,
 * without consulting the crontab (whose entries can silently vanish - relying
 * on them once orphaned images on removal and left volumes unmounted after
 * reboot). Candidates mirror where createAppVolume places images: the root of
 * each eligible host volume, or the appvolumes directory (proper and legacy
 * glued layout) when the root filesystem hosts them.
 * @param {string} appId Docker app identifier (e.g. fluxcomp_app).
 * @returns {Promise<string|null>} Absolute path of the image, or null.
 */
async function getVolumeFilePath(appId) {
  const volumeFileName = `${appId}FLUXFSVOL`;
  const candidates = [];

  try {
    const dfres = await dfAsync({});
    dfres.forEach((volume) => {
      const eligible = volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop')
        && !volume.mount.includes('boot') && volume.mount !== '/';
      if (eligible) {
        candidates.push(path.join(volume.mount, volumeFileName));
      }
    });
  } catch (error) {
    log.warn(`getVolumeFilePath - df failed (${error.message}), falling back to appvolumes locations only`);
  }

  candidates.push(path.join(appVolumesPath, volumeFileName));
  candidates.push(path.join(legacyAppVolumesPath, volumeFileName));

  // eslint-disable-next-line no-restricted-syntax
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await fs.access(candidate).then(() => true).catch(() => false);
    if (exists) return candidate;
  }

  return null;
}

/**
 * Derives the docker app identifiers of an app's components from the
 * FLUXFSVOL images present on disk - the image filename embeds the component
 * identifier (flux<component>_<app>FLUXFSVOL; legacy single-component apps
 * flux<app>FLUXFSVOL). Ground truth for apps whose local spec cannot
 * enumerate components: enterprise specs are stored with compose emptied and
 * decryption needs fluxbenchd, while the images need nothing.
 * @param {string} appName Application name.
 * @returns {Promise<string[]>} Docker app identifiers whose images exist on disk.
 */
async function getComponentAppIdsFromVolumeFiles(appName) {
  const appIds = new Set();
  const searchDirs = new Set([appVolumesPath, legacyAppVolumesPath]);

  try {
    const dfres = await dfAsync({});
    dfres.forEach((volume) => {
      const eligible = volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop')
        && !volume.mount.includes('boot') && volume.mount !== '/';
      if (eligible) {
        searchDirs.add(volume.mount);
      }
    });
  } catch (error) {
    log.warn(`getComponentAppIdsFromVolumeFiles - df failed (${error.message}), searching appvolumes locations only`);
  }

  const escapedName = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const componentImage = new RegExp(`^flux\\w+_${escapedName}FLUXFSVOL$`);
  const legacyImage = `flux${appName}FLUXFSVOL`;

  // eslint-disable-next-line no-restricted-syntax
  for (const dir of searchDirs) {
    // eslint-disable-next-line no-await-in-loop
    const entries = await fs.readdir(dir).catch(() => []);
    entries.forEach((entry) => {
      if (componentImage.test(entry) || entry === legacyImage) {
        appIds.add(entry.slice(0, -'FLUXFSVOL'.length));
      }
    });
  }

  return [...appIds];
}

/**
 * Ensures an app component's data volume is loop-mounted at its app dir - the
 * level-based desired state FluxOS itself owns (a rw mount replays a dirty
 * ext4 journal automatically). Idempotent: a mounted volume is a no-op. Never
 * deletes anything: content found on the bare mountpoint is shadowed by the
 * mount, loudly, so it stays recoverable underneath.
 * @param {string} identifier Component identifier (comp_app), app name, or docker app id.
 * @returns {Promise<{mounted: boolean, alreadyMounted?: boolean, reason?: string}>}
 */
async function ensureAppVolumeMounted(identifier) {
  const appId = dockerService.getAppIdentifier(identifier);
  const mountPoint = path.join(appsFolder, appId);

  if (await isPathMounted(mountPoint)) {
    return { mounted: true, alreadyMounted: true };
  }

  const volumeFile = await getVolumeFilePath(appId);
  if (!volumeFile) {
    return { mounted: false, reason: 'volume_file_missing' };
  }

  let mountPointEntries;
  try {
    mountPointEntries = await fs.readdir(mountPoint);
  } catch (error) {
    const mkdir = await serviceHelper.runCommand('mkdir', { runAsRoot: true, params: ['-p', mountPoint] });
    if (mkdir.error) {
      return { mounted: false, reason: `mount_point_unavailable: ${mkdir.error.message}` };
    }
    mountPointEntries = [];
  }

  if (mountPointEntries.length === 0) {
    // An empty bare mountpoint is locked immutable before mounting so writes
    // through it while the volume is unmounted fail with EPERM instead of
    // silently landing on the host filesystem (bypassing the app's quota and
    // getting orphaned under the next mount). The mounted volume shadows the
    // flag. Both fleet filesystems (ext4, XFS) support it, so a failure is an
    // anomaly - but the flag is defense-in-depth on top of the mount itself,
    // so it must never block bringing the app's volume up.
    const chattr = await serviceHelper.runCommand('chattr', { runAsRoot: true, params: ['+i', mountPoint], logError: false });
    if (chattr.error) {
      log.error(`ensureAppVolumeMounted - could not set ${mountPoint} immutable (unexpected on ext4/XFS): ${chattr.error.message}`);
    }
  } else {
    log.warn(`ensureAppVolumeMounted - ${mountPoint} is not mounted but holds ${mountPointEntries.length} entries; they were written while unmounted and will be shadowed by the volume`);
  }

  const mountRes = await serviceHelper.runCommand('mount', {
    runAsRoot: true, params: ['-o', 'loop', volumeFile, mountPoint], logError: false,
  });
  if (mountRes.error) {
    // another actor (e.g. a legacy @reboot job on its last boot) may have
    // mounted in between - that is success, not an error
    if (await isPathMounted(mountPoint)) {
      return { mounted: true, alreadyMounted: true };
    }
    log.error(`ensureAppVolumeMounted - failed to mount ${volumeFile} at ${mountPoint}: ${mountRes.error.message}`);
    return { mounted: false, reason: `mount_failed: ${mountRes.error.message}` };
  }

  log.info(`ensureAppVolumeMounted - mounted ${volumeFile} at ${mountPoint}`);
  return { mounted: true, alreadyMounted: false };
}

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

  // Structure created on the bare app dir would land on the host filesystem
  // instead of the app's volume, so the volume must be mounted first - and it
  // is level-based desired state, so mount it rather than merely assert.
  const volumeMount = await ensureAppVolumeMounted(identifier);
  if (!volumeMount.mounted) {
    throw new Error(`Data volume for ${appId} is not mounted (${volumeMount.reason}); refusing to create mount paths on the bare directory`);
  }

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

      // the referenced component's own volume must back anything we create there
      // eslint-disable-next-line no-await-in-loop
      const refVolumeMount = await ensureAppVolumeMounted(componentIdentifier);
      if (!refVolumeMount.mounted) {
        throw new Error(`Data volume for referenced component ${componentAppId} is not mounted (${refVolumeMount.reason})`);
      }

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
  isPathMounted,
  getVolumeFilePath,
  getComponentAppIdsFromVolumeFiles,
  ensureAppVolumeMounted,
};
