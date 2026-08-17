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
 * Removing `.stfolder` stops syncthing replicating the folder at all, and
 * replacing `.stignore` changes what leaves the node. An operation's staging
 * directory is reserved for a different reason: the boot sweep deletes whatever
 * carries that name, so a folder an owner created and called one would be
 * deleted out from under them.
 *
 * ROOT ONLY, deliberately. `.stignore` means something to syncthing at the
 * folder root and nowhere else, and the sweep reads only the root - so
 * reserving these further down would take names away from the owner inside
 * their own data for no benefit, and leave a `photos/.stignore` they could
 * create and never manage.
 */

/** What a staging directory is called while an operation runs. */
const STAGING_PREFIX = '.flux-op-';

/**
 * The identifier flux-op names a staging directory with. A randomUUID, so the
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
 *
 * `backup` is deliberately absent for the opposite reason. It sits in the same
 * root and FluxOS writes it, but what it holds is the owner's own archives:
 * the upload path creates it when a restore needs one, and the backup
 * interface lists it through its own endpoint rather than this browser. Hiding
 * it would take away something they have a reason to reach, and refusing to
 * write it would break the restore that puts files there.
 */
const SYNCTHING_FOLDER_MARKER = '.stfolder';
const SYNCTHING_IGNORE_FILE = '.stignore';

/**
 * The .stignore lines FluxOS asserts on every folder it replicates.
 *
 * `/backup` keeps the owner's local archives off the network. The staging
 * pattern keeps an operation's scratch off it: every byte a copy, extract or
 * upload stages would otherwise replicate to every peer only to be deleted
 * again on publish, and a peer's boot sweep could delete a replicated staging
 * directory a live operation on another node still needs. Both are anchored to
 * the folder root, so neither takes a name from the owner deeper in their own
 * tree. Derived from STAGING_PREFIX so the pattern cannot drift from the names
 * the sweep owns.
 */
const SYNCTHING_IGNORE_LINES = ['/backup', `/${STAGING_PREFIX}*`];

const FOREIGN_NAMES = new Set([SYNCTHING_FOLDER_MARKER, SYNCTHING_IGNORE_FILE, 'lost+found']);

/**
 * Whether a name in the volume root belongs to something other than the owner.
 * @param {string} name - a single path component, not a path
 * @returns {boolean}
 */
function isReservedName(name) {
  if (typeof name !== 'string' || !name) return false;
  return FOREIGN_NAMES.has(name)
    || isStagingName(name);
}

module.exports = {
  STAGING_PREFIX,
  SYNCTHING_FOLDER_MARKER,
  SYNCTHING_IGNORE_FILE,
  SYNCTHING_IGNORE_LINES,
  isStagingName,
  isReservedName,
};
