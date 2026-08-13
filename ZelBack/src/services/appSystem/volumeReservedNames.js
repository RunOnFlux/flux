/**
 * The names an app volume's root does not belong to its owner.
 *
 * Three kinds live there and none of them are the owner's data: what an
 * interrupted file operation leaves behind, what syncthing needs in the folder
 * it replicates, and what the filesystem keeps for its own recovery. The
 * browser reaches that root deliberately - it is how an app with several mounts
 * shows them - so every one of these was listable, downloadable, renameable and
 * deletable by whoever owns the app.
 *
 * That is the root of two problems rather than one. Removing `.stfolder` stops
 * syncthing replicating the folder at all; replacing `.stignore` changes what
 * leaves the node. And the operation artefacts are read by the boot sweep,
 * which decides from them whether to restore data or delete it - so being able
 * to write one is being able to hand that sweep its input.
 *
 * ROOT ONLY, deliberately. `.stignore` means something to syncthing at the
 * folder root and nowhere else, and the sweep reads only the root - so
 * reserving these further down would take names away from the owner inside
 * their own data for no benefit, and leave a `photos/.stignore` they could
 * create and never manage.
 */

/** What a staging directory is called while an operation runs. */
const STAGING_PREFIX = '.flux-op-';

/** What the entry an interrupted publish displaced is called. */
const SWAP_PREFIX = '.flux-old-';

/** Suffix of the file recording where a displaced entry belongs. */
const MARKER_SUFFIX = '.dest';

/**
 * The identifier flux-op derives both names from - the staging directory's, and
 * the swap directory's after it strips the staging prefix. A randomUUID, so the
 * shape is exact.
 *
 * Names are matched against this rather than by prefix alone because the sweep
 * DELETES what it matches, in a directory the app owner can also write to.
 * Nothing reserves these prefixes at creation time, so a folder called
 * `.flux-op-backups` is a name a user can legitimately choose - and would lose
 * on the next restart if a prefix test were the whole rule.
 */
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isStagingName = (name) => name.startsWith(STAGING_PREFIX)
  && OPERATION_ID.test(name.slice(STAGING_PREFIX.length));

const isSwapName = (name) => name.startsWith(SWAP_PREFIX)
  && OPERATION_ID.test(name.slice(SWAP_PREFIX.length));

const isSwapMarkerName = (name) => name.endsWith(MARKER_SUFFIX)
  && isSwapName(name.slice(0, -MARKER_SUFFIX.length));

/**
 * Names something other than FluxOS puts in the volume root and depends on.
 *
 * `.stfolder` is how syncthing knows the folder is really mounted: without it
 * the folder is unhealthy and stops replicating. `.stignore` is what keeps the
 * backup directory from being replicated to every other node running the app.
 *
 * `lost+found` is ext4's, and reserved for the owner's own sake rather than
 * ours - fsck puts orphaned inodes there after an unclean shutdown, so a volume
 * without one recovers worse.
 *
 * `.stversions` is deliberately absent: file versioning is not configured on
 * any folder FluxOS creates, so that name never appears and reserving it would
 * be reserving a name we do not use.
 */
const SYNCTHING_FOLDER_MARKER = '.stfolder';
const SYNCTHING_IGNORE_FILE = '.stignore';

const FOREIGN_NAMES = new Set([SYNCTHING_FOLDER_MARKER, SYNCTHING_IGNORE_FILE, 'lost+found']);

/**
 * Whether a name in the volume root belongs to something other than the owner.
 * @param {string} name - a single path component, not a path
 * @returns {boolean}
 */
function isReservedName(name) {
  if (typeof name !== 'string' || !name) return false;
  return FOREIGN_NAMES.has(name)
    || isStagingName(name)
    || isSwapName(name)
    || isSwapMarkerName(name);
}

module.exports = {
  STAGING_PREFIX,
  SYNCTHING_FOLDER_MARKER,
  SYNCTHING_IGNORE_FILE,
  SWAP_PREFIX,
  MARKER_SUFFIX,
  isStagingName,
  isSwapName,
  isSwapMarkerName,
  isReservedName,
};
