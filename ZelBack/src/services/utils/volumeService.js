const fs = require('fs').promises;
const path = require('node:path');
const dockerService = require('../dockerService');
const deviceHelper = require('../deviceHelper');
const serviceHelper = require('../serviceHelper');
const mountParser = require('./mountParser');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const log = require('../../lib/log');
const {
  appsFolder, appVolumesPath, legacyAppVolumesPath, APP_VOLUME_MOUNT_OPTIONS,
} = require('./appConstants');

/**
 * The unit node capacity is counted in, which is the unit it is spent in:
 * `fallocate -l <n>G` takes 1024^3 bytes per unit, so this is what an app's
 * `hdd` actually costs the filesystem.
 */
const BYTES_PER_GIB = 1024 ** 3;

/**
 * Filesystems whose contents do not survive a reboot. A volume image placed on
 * one would take the app's data with it, however much room it reports free.
 */
const EPHEMERAL_FSTYPES = new Set(['tmpfs', 'ramfs', 'devtmpfs', 'overlay', 'squashfs']);

/**
 * Filesystems whose bytes are on another machine. `fallocate` is unsupported on
 * CIFS and on NFSv3, so an image cannot be created on one at all, and where it
 * can the app's data is hostage to a share that can go away while the node
 * keeps running.
 *
 * `findmnt --real` excludes pseudo filesystems and nothing else, so these
 * arrive in the mount table looking like any local disk.
 */
const REMOTE_FSTYPES = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'smbfs',
  'afs', 'ncpfs', 'ceph', 'glusterfs', 'lustre', 'gpfs', 'beegfs',
  'virtiofs', '9p']);

/**
 * Filesystems an image is not PLACED on, though one already sitting on any of
 * them is still found.
 *
 * A volume is created with `fallocate` and loop-mounted with an ext4 inside
 * it. `vfat` and `msdos` cap a file at 4 GiB, under the size of most volumes;
 * for the rest that sequence is not established on anything the fleet runs,
 * and `fuseblk` does not even name the driver it would go through - ntfs-3g
 * and exfat-fuse both arrive under it. `createAppVolume` takes one candidate
 * and never falls back, so a filesystem that cannot carry the sequence puts
 * the node in DOS rather than costing it a disk.
 */
const UNPLACEABLE_FSTYPES = new Set(['vfat', 'msdos', 'exfat', 'ntfs', 'ntfs3', 'fuseblk']);

/**
 * Where a container runtime keeps the filesystems it owns.
 *
 * A runtime mounts each container's root under its own data directory, and on
 * a storage driver that uses real filesystems - ZFS, btrfs - those mounts are
 * indistinguishable from a disk by fstype alone. An image placed in one lands
 * inside somebody else's container, and is destroyed with it; an image LOOKED
 * FOR in one can be answered by a file the container's owner put there.
 *
 * Neither belongs to this node to use, on any filesystem, so the rule is not
 * about ZFS - it is that a runtime's storage is the runtime's.
 *
 * What is UNDER the directory, never the directory itself: an operator giving
 * docker its own disk mounts it at exactly this path, and that disk is an
 * ordinary one to place on. Nothing a container owns reaches the root of the
 * data directory - only the runtime writes there.
 */
const RUNTIME_DATA_DIRS = ['/var/lib/docker', '/var/lib/containerd', '/var/lib/lxd',
  '/var/snap/lxd/common/lxd', '/var/lib/kubelet', '/dat/var/lib/docker'];

/**
 * A mount row in the unit an app's storage is spent in.
 *
 * Whole GiB, because `createAppVolume` allocates with `fallocate -l <hdd>G`
 * and util-linux reads a bare `G` as 1024^3. Room worth exactly twenty of
 * those has to read as 20, and twenty decimal GB has to read as less, or a
 * node admits an app it is 7.4% short for and finds out at ENOSPC.
 *
 * @param {object} volume One mount row from deviceHelper.
 * @returns {{filesystem: string, mount: string, size: number, used: number,
 *   available: number}} The same mount, in whole GiB.
 */
function inGib(volume) {
  return {
    filesystem: volume.source,
    mount: volume.target,
    size: Math.round(volume.sizeBytes / BYTES_PER_GIB),
    used: Math.round(volume.usedBytes / BYTES_PER_GIB),
    available: Math.round(volume.availableBytes / BYTES_PER_GIB),
  };
}

/**
 * One row per device.
 *
 * `findmnt` names a bind mount and a btrfs subvolume `<device>[<subpath>]`, so
 * a single disk is reported once per bind - in a containerised FluxOS that is
 * `/etc/hostname`, `/etc/hosts` and `/etc/resolv.conf` beside the data volume,
 * four views of one disk reporting its free space four times.
 *
 * Which view survives is an arbitrary tie-break on the shortest target. They
 * are views of one disk, so they agree on every number; all it settles is the
 * directory an image is written into, and the mount table says nothing about
 * which of two directories on a disk was meant for one.
 *
 * Device identity is not filesystem identity. ZFS names each dataset in a pool
 * separately while every one of them reports the pool's free space, so a pool
 * arrives here as one row per dataset and leaves that way. What each row has
 * USED is its own and adds up across rows; what it has FREE may belong to
 * another row too, and does not.
 *
 * @param {Array<object>} rows Mount rows from deviceHelper.
 * @returns {Array<object>} One row per distinct device.
 */
function oneRowPerDevice(rows) {
  const byDevice = new Map();
  rows.forEach((row) => {
    const device = String(row.source).split('[')[0];
    const held = byDevice.get(device);
    if (!held || row.target.length < held.target.length) byDevice.set(device, row);
  });
  return Array.from(byDevice.values());
}

/**
 * Whether an image may be FOUND on this filesystem: is it this machine's
 * storage, in a place one may sit.
 *
 * Location and ownership only. The filesystem's TYPE is not asked, because an
 * image already written to a disk is readable whatever the disk is formatted
 * as, and an earlier release placed images by source alone. Narrowing a search
 * by type reports those images missing, which is a tampering event against the
 * operator and an orphan on the disk.
 *
 * `findmnt --real` has already dropped the pseudo filesystems and a container's
 * own overlay, so what is left to exclude is storage on another machine, the
 * boot disk, and the app volumes this node has already placed: an app's image
 * is carved out of one of these filesystems, so counting it counts the same
 * bytes twice. A loop mount IS such an image - except at the root, where a loop
 * is the host disk itself.
 *
 * @param {object} mount One mount row from deviceHelper.
 * @returns {boolean} True when an image may be looked for on the filesystem.
 */
function isSearchableFilesystem(mount) {
  const fstype = String(mount.fstype || '');
  if (EPHEMERAL_FSTYPES.has(fstype)) return false;
  // A fuse type names the driver rather than the backing, and the drivers that
  // reach across a network are open-ended: gluster and sshfs arrive as
  // `fuse.glusterfs` and `fuse.sshfs`, the object stores as `fuse.rclone`,
  // `fuse.s3fs`, `fuse.gcsfuse`. A bare `fuse` is on libmount's pseudofs list
  // and never survives `findmnt --real`, so there is nothing here to test it
  // for. A local fuse pool loses nothing by the rule: the disks it pools are
  // mounted in their own right. `fuseblk` is the block-backed form and IS this
  // machine's storage, so it is searched - it is only refused a new image.
  if (REMOTE_FSTYPES.has(fstype) || fstype.startsWith('fuse.')) return false;
  if (mount.target === '/boot' || mount.target.startsWith('/boot/')) return false;
  const device = String(mount.source).split('[')[0];
  if (device.startsWith('/dev/loop') && mount.target !== '/') return false;
  // Strict descendants of each, never the directory itself: a runtime owns
  // what it mounts underneath its data directory, while the directory may be a
  // disk an operator gave it, and an app's volume is mounted at
  // <appsFolder>/<appId> while the folder itself is ordinary. An image sits at
  // <appId>FLUXFSVOL, which collides with no mount point.
  if (RUNTIME_DATA_DIRS.some((dir) => mount.target.startsWith(`${dir}/`))) return false;
  const appsRoot = appsFolder.replace(/\/+$/, '');
  return !mount.target.startsWith(`${appsRoot}/`);
}

/**
 * Whether an image may be PUT on this filesystem.
 *
 * Everywhere one may be found, less the types that cannot carry a new one.
 * The narrower question, and the one that must never be asked of a search:
 * a type refused here still holds every image an earlier release placed on it.
 *
 * @param {object} mount One mount row from deviceHelper.
 * @returns {boolean} True when an image may be created on the filesystem.
 */
function isHostFilesystem(mount) {
  if (!isSearchableFilesystem(mount)) return false;
  return !UNPLACEABLE_FSTYPES.has(String(mount.fstype || ''));
}

/**
 * The mount a path resolves through: the last row listed at that exact target.
 *
 * @param {string} target Absolute path of a mount point.
 * @param {Array<object>} mounts Mount rows, in mount table order.
 * @returns {object|null} The visible row, or null when nothing is mounted there.
 */
function visibleMountAt(target, mounts) {
  const at = String(target).replace(/\/+$/, '');
  const stack = mounts.filter((mount) => String(mount.target).replace(/\/+$/, '') === at);
  return stack.length ? stack[stack.length - 1] : null;
}

/**
 * Whether a FLUXFSVOL image can be created in this mount.
 *
 * The image is a file written into the mount point, so the mount point has to
 * be a directory and has to be writable. A device cannot answer either.
 *
 * A row with another mount stacked over it answers for a filesystem the path
 * no longer reaches - neither its `ro` flag nor its free space describes what
 * a write there would do - so only the mount a path resolves through is a
 * candidate. Asked of every mount the kernel holds and not of the block-backed
 * ones alone, because a tmpfs laid over a disk is the case that turns a
 * multi-gigabyte image into RAM the app loses at the next restart.
 *
 * @param {object} mount One mount row from deviceHelper.
 * @param {Array<object>} allMounts Every mount, in mount table order.
 * @returns {Promise<boolean>} True when an image can be written there.
 */
async function canHoldAppVolume(mount, allMounts) {
  const visible = visibleMountAt(mount.target, allMounts);
  // Only ever used to REFUSE: a candidate reaches here from the block-backed
  // table, so nothing this list contains can promote one. When no row at the
  // target names this mount's source the comparison has nothing to say and
  // the candidate is left to the rules below. Abstaining that way keeps the
  // disk; abstaining the other way would refuse EVERY disk the moment the two
  // readings disagreed about how to spell a source, and a node that can place
  // nothing is a worse answer than one that placed where it always has.
  if (visible && visible.source !== mount.source) return false;
  if (mount.readOnly) return false;
  const stats = await fs.stat(mount.target).catch(() => null);
  return Boolean(stats && stats.isDirectory());
}

/**
 * The filesystems an app's FLUXFSVOL image may be placed on, most free space
 * first, one row per filesystem, sized in whole GiB.
 *
 * Ranked rather than merely listed, because the caller takes the first that
 * fits: ordering by free space makes that the emptiest disk, where mount-table
 * order would make it whichever the kernel happened to report first.
 *
 * Deduplicated after the write check and not before, so a disk is not lost to a
 * bind of it that happens to be a file.
 *
 * @returns {Promise<Array<{filesystem: string, mount: string, size: number,
 *   used: number, available: number}>>}
 */
async function placementVolumesInGib() {
  const mounts = await deviceHelper.listMountedFilesystems();
  // Every mount, for the shadowing question alone: what a write to a candidate
  // actually lands on is whatever the kernel resolves that path through, which
  // need not be block-backed and so need not appear above.
  const allMounts = await deviceHelper.listAllMounts();
  const hosts = mounts.filter(isHostFilesystem);
  const writable = [];
  for (const mount of hosts) {
    // eslint-disable-next-line no-await-in-loop
    if (await canHoldAppVolume(mount, allMounts)) writable.push(mount);
  }
  // A filesystem the node may use and cannot write to is worth a line: the
  // caller's only other output is "No useable volume found", which names
  // nothing, and a disk lost to a traversal denied or a path answering EIO
  // otherwise looks exactly like a disk the node never had.
  if (writable.length !== hosts.length) {
    const refused = hosts.filter((mount) => !writable.includes(mount)).map((mount) => mount.target);
    log.info(`placementVolumesInGib - not writable, so not offered: ${refused.join(', ')}`);
  }
  return oneRowPerDevice(writable)
    .sort((a, b) => b.availableBytes - a.availableBytes)
    .map(inGib);
}

/**
 * The mounts an app's FLUXFSVOL image may be found on.
 *
 * Where an image may be FOUND, which is a wider question than where one may be
 * PUT: an image on a filesystem that has since come up read-only is still
 * perfectly readable, and refusing to look there reports it missing. Placement
 * asks the write question; this asks only containment.
 *
 * The root is left out because an image the root hosts is written to the
 * appvolumes directory instead, which callers search separately.
 *
 * Not deduplicated: two directories on one disk are two places an image can
 * sit, and a search that visited only one of them would miss it.
 *
 * @returns {Promise<Array<object>>} mount rows from deviceHelper
 */
async function eligibleHostMounts() {
  const mounts = await deviceHelper.listMountedFilesystems();
  return mounts.filter((mount) => isSearchableFilesystem(mount) && mount.target !== '/');
}

/**
 * Whether the filesystem holding a path is mounted read-only.
 *
 * The deepest mount whose target the path sits under is the one holding it: a
 * path can be under several, and only the deepest describes the filesystem the
 * bytes are actually on.
 *
 * An unreadable mount table answers false. This decides which reason a caller
 * reports, never whether a volume is safe to touch, so a failure here should
 * not turn into a diagnosis of its own.
 * @param {string} target Absolute path.
 * @returns {Promise<boolean>} True when that filesystem is mounted `ro`.
 */
async function isOnReadOnlyFilesystem(target) {
  const mounts = await deviceHelper.listMountedFilesystems().catch(() => []);
  const holders = mounts.filter((mount) => {
    const at = String(mount.target).replace(/\/+$/, '');
    return target === at || target.startsWith(`${at}/`);
  });
  if (!holders.length) return false;
  // Holders of equal length are the same path, i.e. mounts stacked on it, and
  // findmnt lists them in mountinfo order where the last one is what the
  // kernel resolves through. So equality takes the later row.
  const deepest = holders.reduce((a, b) => (b.target.length >= a.target.length ? b : a));
  return Boolean(deepest.readOnly);
}

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
 * The image path this node recorded when it created the volume, and the
 * filesystem UUID it gave it.
 *
 * FluxOS chooses where an image goes, so it is the authority on where one is.
 * A search of the filesystem is not: it matches on a filename anything on the
 * node can write, which is why every place something else might write has to
 * be excluded by hand. A recorded path is looked up, and a recorded UUID says
 * the file found there is the one this node made.
 *
 * Lives on the component's runtime-state document, which is node-local and
 * already keyed per component - the grain a volume has. The installed-apps row
 * is the owner's signed specification and holds nothing this node observed.
 *
 * @param {string} identifier Component identifier or docker app id.
 * @returns {Promise<{path: string, fsUuid: string|null}|null>}
 */
async function recordedVolumeImage(identifier) {
  const state = await appsRuntimeState.getState(identifier);
  if (!state || !state.volumeImagePath) return null;
  return { path: state.volumeImagePath, fsUuid: state.volumeFsUuid || null };
}

/**
 * Records where this node put a component's image and what it stamped it with.
 *
 * Best effort: a volume that exists and cannot be written down is still a
 * working volume, and the fallback search still finds it. Failing the mount
 * over the record would make the bookkeeping more load-bearing than the thing
 * it describes.
 *
 * @param {string} identifier Component identifier or docker app id.
 * @param {string} volumeFile Absolute path of the image.
 * @param {string|null} fsUuid Filesystem UUID inside the image.
 */
async function recordVolumeImage(identifier, volumeFile, fsUuid) {
  await appsRuntimeState.setFields(identifier, {
    volumeImagePath: volumeFile,
    volumeFsUuid: fsUuid || null,
  }).catch((error) => {
    log.warn(`recordVolumeImage - could not record ${volumeFile} for ${identifier}: ${error.message}`);
  });
}

/**
 * The filesystem UUID inside a volume image, or null when it cannot be read.
 *
 * @param {string} volumeFile Absolute path of the image.
 * @returns {Promise<string|null>}
 */
async function imageFsUuid(volumeFile) {
  const res = await serviceHelper.runCommand('blkid', {
    runAsRoot: true, params: ['-o', 'value', '-s', 'UUID', volumeFile], logError: false,
  });
  if (res.error) return null;
  const uuid = String(res.stdout || '').trim();
  return uuid || null;
}

/**
 * The image behind a volume that is already mounted, read from the kernel.
 *
 * The authority for a node upgrading with its apps up: the loop device names
 * its own backing file, so the path this node used is readable without
 * searching for it and without trusting a filename.
 *
 * @param {string} dirPath The mount point.
 * @returns {Promise<string|null>} Absolute path of the backing image, or null.
 */
async function mountedImagePath(dirPath) {
  const mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => null);
  if (mountinfo === null) return null;
  const target = path.resolve(dirPath);
  const unescapeMount = (value) => value.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  const line = mountinfo.split('\n').find((entry) => {
    const fields = entry.split(' ');
    return fields.length > 4 && unescapeMount(fields[4]) === target;
  });
  if (!line) return null;
  // Everything after the ` - ` separator is fstype, mount source, super options
  const afterSeparator = line.split(' - ')[1];
  const source = afterSeparator ? afterSeparator.split(' ')[1] : null;
  const loop = /^\/dev\/(loop\d+)$/.exec(source || '');
  if (!loop) return null;
  const backing = await fs.readFile(`/sys/block/${loop[1]}/loop/backing_file`, 'utf8').catch(() => null);
  return backing ? unescapeMount(backing.trim()) : null;
}

/**
 * Locates the backing FLUXFSVOL image for an app component deterministically,
 * without consulting the crontab (whose entries can silently vanish - relying
 * on them once orphaned images on removal and left volumes unmounted after
 * reboot). Candidates mirror where createAppVolume places images: the root of
 * each eligible host volume, or the appvolumes directory (proper and legacy
 * glued layout) when the root filesystem hosts them.
 * An unreadable mount table leaves the appvolumes locations searchable and the
 * rest not, so the answer carries whether the search covered everywhere it
 * should have. A null path is only evidence the image is gone when it did:
 * callers decide what an image they could not look for means to them, and none
 * of them may treat it as one that is not there.
 *
 * @param {string} appId Docker app identifier (e.g. fluxcomp_app).
 * @returns {Promise<{path: string|null, conclusive: boolean, blocked: string|null}>}
 *   Absolute path of the image or null, whether every location was searched,
 *   and which fault stopped it if one did.
 */
async function getVolumeFilePath(appId) {
  // Where this node put it, if it wrote that down. A lookup cannot be answered
  // by a file somebody else named, which is the whole weakness of the search
  // below.
  const recorded = await recordedVolumeImage(appId);
  if (recorded) {
    const present = await fs.access(recorded.path).then(() => true).catch(() => false);
    if (present) return { path: recorded.path, conclusive: true, blocked: null };
  }

  const volumeFileName = `${appId}FLUXFSVOL`;
  const candidates = [];
  // Which fault stopped the search covering everywhere, or null. A caller
  // reports the fault it actually met: naming the mount table for a disk that
  // answered EIO sends whoever reads it to the wrong thing.
  let blocked = null;

  try {
    const mounts = await eligibleHostMounts();
    mounts.forEach((mount) => {
      candidates.push(path.join(mount.target, volumeFileName));
    });
  } catch (error) {
    blocked = 'mount_table_unreadable';
    log.warn(`getVolumeFilePath - findmnt failed (${error.message}), searching the appvolumes locations only`);
  }

  candidates.push(path.join(appVolumesPath, volumeFileName));
  candidates.push(path.join(legacyAppVolumesPath, volumeFileName));

  // eslint-disable-next-line no-restricted-syntax
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const failure = await fs.access(candidate).then(() => null).catch((error) => error);
    // Finding it settles the question whatever the search could not reach.
    if (!failure) return { path: candidate, conclusive: true, blocked: null };
    // Only ENOENT says an image is not here. A path that could not be read -
    // the disk answering EIO, a directory that denies the lookup - has ruled
    // nothing out, and reporting it absent is how a failing disk becomes a
    // tampering event against the operator.
    if (failure.code !== 'ENOENT') {
      blocked = blocked || 'candidate_path_unreadable';
      log.warn(`getVolumeFilePath - ${candidate} could not be read (${failure.code || failure.message}), so the image is not ruled out`);
    }
  }

  return { path: null, conclusive: !blocked, blocked };
}

/**
 * Derives the docker app identifiers of an app's components from the
 * FLUXFSVOL images present on disk - the image filename embeds the component
 * identifier (flux<component>_<app>FLUXFSVOL; legacy single-component apps
 * flux<app>FLUXFSVOL). Ground truth for apps whose local spec cannot
 * enumerate components: enterprise specs are stored with compose emptied and
 * decryption needs fluxbenchd, while the images need nothing.
 * This list IS the component set for an app whose specification cannot be
 * read, so a short one is indistinguishable from an app with fewer
 * components. It therefore says whether every place was searched, the same
 * way getVolumeFilePath does, rather than answering short and looking
 * complete. A caller that cannot use a partial answer still gets what was
 * found, which is what keeps one unreadable directory from costing a node
 * every other app's boot.
 *
 * @param {string} appName Application name.
 * @returns {Promise<{appIds: string[], conclusive: boolean}>} Docker app
 *   identifiers whose images exist on disk, and whether every location was
 *   searched.
 */
async function getComponentAppIdsFromVolumeFiles(appName) {
  const appIds = new Set();
  const searchDirs = new Set([appVolumesPath, legacyAppVolumesPath]);
  let conclusive = true;

  try {
    const mounts = await eligibleHostMounts();
    mounts.forEach((mount) => searchDirs.add(mount.target));
  } catch (error) {
    conclusive = false;
    log.warn(`getComponentAppIdsFromVolumeFiles - findmnt failed (${error.message}), so ${appName}'s component list is not complete`);
  }

  const escapedName = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const componentImage = new RegExp(`^flux\\w+_${escapedName}FLUXFSVOL$`);
  const legacyImage = `flux${appName}FLUXFSVOL`;

  // eslint-disable-next-line no-restricted-syntax
  for (const dir of searchDirs) {
    // eslint-disable-next-line no-await-in-loop
    const failure = await fs.readdir(dir).then((entries) => {
      entries.forEach((entry) => {
        if (componentImage.test(entry) || entry === legacyImage) {
          appIds.add(entry.slice(0, -'FLUXFSVOL'.length));
        }
      });
      return null;
    }).catch((error) => error);
    // A directory that is not there held no images. One that could not be read
    // may have held any of them, and the same argument applies as to the mount
    // table: a list short by an unknown amount is not a component set.
    if (failure && failure.code !== 'ENOENT') {
      conclusive = false;
      log.warn(`getComponentAppIdsFromVolumeFiles - ${dir} could not be read (${failure.code || failure.message}), so ${appName}'s component list is not complete`);
    }
  }

  return { appIds: [...appIds], conclusive };
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
    // A node that upgrades with its apps running never has to search for their
    // images: the loop device names its own backing file, so the path this
    // node used is readable from the kernel. Taken once, when there is nothing
    // recorded yet.
    if (!await recordedVolumeImage(appId)) {
      const backing = await mountedImagePath(mountPoint);
      if (backing) await recordVolumeImage(appId, backing, await imageFsUuid(backing));
    }
    return { mounted: true, alreadyMounted: true };
  }

  const discovered = await getVolumeFilePath(appId);
  if (!discovered.path) {
    return { mounted: false, reason: discovered.conclusive ? 'volume_file_missing' : discovered.blocked };
  }
  const volumeFile = discovered.path;

  // A disk the kernel remounted read-only after an I/O error still holds the
  // image and still reads, and mount would loop-mount it read-only rather
  // than fail - APP_VOLUME_MOUNT_OPTIONS asks for no explicit `rw`, and
  // util-linux falls back when the backing file cannot be opened for writing.
  // An app whose volume cannot be written to is down regardless, so the
  // volume is refused here by choice, under the reason that names the disk:
  // calling the image missing blames an operator for a hardware fault.
  if (await isOnReadOnlyFilesystem(volumeFile)) {
    return { mounted: false, reason: 'host_filesystem_readonly' };
  }

  let mountPointEntries;
  try {
    mountPointEntries = await fs.readdir(mountPoint);
  } catch (error) {
    const mkdir = await serviceHelper.runCommand('mkdir', { runAsRoot: true, params: ['-p', mountPoint] });
    if (mkdir.error) {
      // mkdir -p fails both when the parent denies it and when the path is
      // already there as something other than a directory, and only the
      // second says an app's directory has been replaced. Asked of the path
      // rather than read out of the error, so the two do not share a string.
      const stats = await fs.lstat(mountPoint).catch(() => null);
      if (stats && !stats.isDirectory()) {
        return { mounted: false, reason: 'mount_point_not_a_directory' };
      }
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

  // An image this node stamped identifies itself. A file that is not it -
  // whatever it is called and wherever it was found - is not mounted as root
  // over an app's data.
  const stamped = await recordedVolumeImage(appId);
  if (stamped && stamped.fsUuid) {
    const found = await imageFsUuid(volumeFile);
    // A UUID that cannot be read says nothing either way, and the mount itself
    // refuses anything that is not a filesystem. Only a positive mismatch is a
    // refusal here.
    if (found && found !== stamped.fsUuid) {
      log.error(`ensureAppVolumeMounted - ${volumeFile} carries ${found}, not the ${stamped.fsUuid} this node created for ${appId}`);
      return { mounted: false, reason: 'volume_image_unrecognised' };
    }
  }

  const mountRes = await serviceHelper.runCommand('mount', {
    runAsRoot: true, params: ['-o', APP_VOLUME_MOUNT_OPTIONS, volumeFile, mountPoint], logError: false,
  });
  if (mountRes.error) {
    // another actor (e.g. a legacy @reboot job on its last boot) may have
    // mounted in between - that is success, not an error
    if (await isPathMounted(mountPoint)) {
      return { mounted: true, alreadyMounted: true };
    }
    log.error(`ensureAppVolumeMounted - failed to mount ${volumeFile} at ${mountPoint}: ${mountRes.error.message}`);
    // A failed mount is evidence about the image only once the host is known
    // to be able to loop-mount anything at all, and /dev/loop-control is that
    // condition itself - present exactly when the kernel offers the machinery.
    // Read directly rather than inferred from a command's exit status, which
    // cannot tell "no free device" from "not permitted to ask": a host fault
    // suppresses the only record an overwritten image ever gets, so the
    // narrow, positively-established case is the only one that may claim it.
    const loopMachinery = await fs.access('/dev/loop-control').then(() => true).catch(() => false);
    if (!loopMachinery) {
      return { mounted: false, reason: 'loop_unavailable' };
    }
    return { mounted: false, reason: `mount_failed: ${mountRes.error.message}` };
  }

  log.info(`ensureAppVolumeMounted - mounted ${volumeFile} at ${mountPoint}`);
  // An image found by the search is recorded now that it is known to mount, so
  // the search runs once for it and the lookup answers ever after.
  if (!stamped) await recordVolumeImage(appId, volumeFile, await imageFsUuid(volumeFile));
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

/**
 * Delete everything an app holds in its volume, leaving the volume itself mounted
 * @param {string} identifier - Component identifier
 * @returns {Promise<void>}
 */
async function clearAppVolumeData(identifier) {
  const appId = dockerService.getAppIdentifier(identifier);
  const appDataPath = path.join(appsFolder, appId, 'appdata');

  // Enumerated AND deleted as root, in one command.
  //
  // Listing the directory host-side runs as the FluxOS user while the rm runs
  // under sudo, and that asymmetry is fatal for exactly the apps g: mode exists
  // to serve: a hardening image chmods its data dir (postgres does `chmod 700
  // $PGDATA`, and for a component mounting /var/lib/postgresql/data that dir IS
  // this appdata), so readdir fails EACCES. The caller treats that as a failed
  // wipe - correctly - and holds dataDesired at 'clear' with a paced retry, so
  // the component would never start again. Refusing to wipe is the right answer
  // to a wipe that failed; it is the wrong answer to one that could have
  // succeeded as root.
  //
  // find, not a shell glob: `rm -rf <dir>/*` was the old shape and hits E2BIG on
  // a large directory, misses dotfiles, and needs a shell. -mindepth 1 empties
  // the directory without removing it - the mount structure has to stay - and
  // -exec ... + batches, so this is one process rather than the concurrent,
  // uncapped rm-per-entry it replaces.
  const wipe = await serviceHelper.runCommand('find', {
    runAsRoot: true,
    params: [appDataPath, '-mindepth', '1', '-maxdepth', '1', '-exec', 'rm', '-rf', '{}', '+'],
  });

  if (wipe.error) {
    // Nothing to clear is not a failed clear: an app whose volume was never
    // populated must not hold the reconciler on a retry forever.
    //
    // Classified by exit code, never by find's message: that text is strerror
    // output, rendered in the node's locale (sudo keeps LANG/LC_* through
    // env_keep), so matching the English words works only on English nodes -
    // anywhere else a missing directory reads as a failed wipe and the
    // reconciler retries it every 5s forever. `test -d` answers with its exit
    // status alone. As root, like the wipe: an unprivileged check paired with
    // a root action fails on a data dir the image chmods to 700.
    //
    // And classified AFTER the wipe rather than checked before it: check-first
    // races toward "falsely clean" when the directory appears inside the
    // window, where this order races toward a throw - and the next pass wipes
    // whatever arrived.
    const probe = await serviceHelper.runCommand('test', {
      runAsRoot: true,
      logError: false,
      params: ['-d', appDataPath],
    });
    if (probe.error) {
      log.info(`No data to delete for app ${appId}`);
      return;
    }
    throw new Error(`Failed to delete data for app ${appId}: ${wipe.stderr || wipe.error.message || wipe.error}`);
  }

  log.info(`Deleted data for app ${appId}`);
}


module.exports = {
  verifyAppVolumeMount,
  placementVolumesInGib,
  isOnReadOnlyFilesystem,
  ensureMountPathsExist,
  isPathMounted,
  getVolumeFilePath,
  imageFsUuid,
  mountedImagePath,
  recordVolumeImage,
  recordedVolumeImage,
  getComponentAppIdsFromVolumeFiles,
  ensureAppVolumeMounted,
  clearAppVolumeData,
};
