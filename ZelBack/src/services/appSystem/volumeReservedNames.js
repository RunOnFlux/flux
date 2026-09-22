const path = require('node:path');
const fs = require('node:fs/promises');

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

/**
 * The ONE directory at the volume root that operations work in. Every staging
 * entry is a child of it, named with the operation's identifier.
 *
 * It used to be a prefix - `.flux-op-<id>` directly at the root - and that put
 * FluxOS's names in the owner's namespace, where three separate rules had to
 * agree on which names were ours: what the sweep deletes, what the browser
 * hides and refuses to delete, and what .stignore keeps off the network. They
 * did not agree. The sweep matched the prefix plus a full identifier, because
 * it DELETES what it matches and a folder an owner called `.flux-op-backups`
 * must survive; the ignore matched `/.flux-op-*`, every name carrying the
 * prefix. So that same folder was safe from deletion and silently never
 * replicated - the owner's data, on one node, invisible to the cluster.
 *
 * One directory removes the disagreement rather than settling it. There is no
 * shape to match in three places: the ignore is this exact name, the browser
 * hides this exact name, and the sweep reads inside it, where everything is
 * ours by construction.
 */
const STAGING_ROOT = '.flux-op';

/**
 * The identifier an operation's staging entry is named with. A randomUUID, so
 * the shape is exact.
 *
 * Still matched rather than assumed, though everything under STAGING_ROOT is
 * ours: the sweep DELETES what it matches, and an entry there whose name is not
 * one we mint is something we did not put there and cannot account for.
 */
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The staging path for an operation, relative to the volume root. */
const stagingRelative = (id) => `${STAGING_ROOT}/${id}`;

/**
 * MIGRATION, and it comes out one release after the one that introduces
 * STAGING_ROOT.
 *
 * Volumes in the field carry `.flux-op-<id>` directories at their root from
 * interrupted operations. Nothing else will ever reclaim them: the new sweep
 * reads inside STAGING_ROOT and they are not there. Left unrecognised they stop
 * being hidden, stop being ignored, and start replicating to every peer - so
 * the old shape is still swept, still hidden, and still kept off the network
 * until the field is clear of it.
 */
const LEGACY_STAGING_PREFIX = '.flux-op-';

const isLegacyStagingName = (name) => name.startsWith(LEGACY_STAGING_PREFIX)
  && OPERATION_ID.test(name.slice(LEGACY_STAGING_PREFIX.length));

const isStagingName = (name) => name === STAGING_ROOT || isLegacyStagingName(name);

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
 * directory keeps an operation's scratch off it: every byte a copy, extract or
 * upload stages would otherwise replicate to every peer only to be deleted
 * again on publish, and a peer's boot sweep could delete a replicated staging
 * directory a live operation on another node still needs.
 *
 * `lost+found` is the filesystem's, not the owner's: a component's volume root IS
 * its syncthing folder and every volume is formatted ext4, so it sits inside the
 * replicated tree. Syncthing's own internal names are `.stfolder`, `.stignore` and
 * `.stversions` and nothing else, so without this line whatever one node's fsck
 * recovers becomes every holder's copy.
 *
 * Each is anchored to the folder root, so none takes a name from the owner deeper
 * in their own tree.
 *
 * The staging line is now an exact name rather than a pattern, which is what
 * makes it the same rule the sweep and the browser apply. The legacy glob
 * beside it is the migration, and goes when the field is clear - see
 * LEGACY_STAGING_PREFIX. It is the one line here that still takes names from
 * the owner, which is why it is temporary.
 */
const SYNCTHING_IGNORE_LINES = ['/backup', '/lost+found', `/${STAGING_ROOT}`, `/${LEGACY_STAGING_PREFIX}*`];

/**
 * The full leading ignore block for one component: the lines FluxOS asserts on every
 * folder, followed by the ones its spec asks for.
 *
 * A component declares a directory unsynced with `ml:` and this turns those names into
 * anchored patterns. They join the leading block rather than the owner's own list
 * because they are equally non-overridable: an `!` above one would replicate the very
 * directory the spec asked to keep local, on a volume the owner shares with nobody.
 *
 * Derived from the spec, never from disk, so every node computes the same block for
 * the same app and no node's ignores depend on what it happens to be holding.
 *
 * @param {string[]} unsyncedSubdirs - volume-root names from mountParser.getUnsyncedSubdirs
 * @returns {string[]} the patterns that must lead this folder's .stignore, in order
 */
function syncthingIgnoreLines(unsyncedSubdirs = []) {
  const declared = unsyncedSubdirs.map((name) => `/${name}`);
  return [...SYNCTHING_IGNORE_LINES, ...declared.filter((line) => !SYNCTHING_IGNORE_LINES.includes(line))];
}

/**
 * The names syncthing never indexes whatever .stignore says - lib/fs/filesystem.go,
 * `internals`, and the whole of them. `.stversions` is here because syncthing would
 * skip it if versioning were ever configured, not because FluxOS writes it.
 */
const SYNCTHING_INTERNAL_NAMES = ['.stfolder', '.stignore', '.stversions'];

/** Whether an ignore line, anchored at the folder root, keeps this name off the network. */
function ignoreLineCovers(line, name) {
  const anchored = `/${name}`;
  return line.endsWith('*') ? anchored.startsWith(line.slice(0, -1)) : line === anchored;
}

/**
 * Whether a volume-root name is inside the scope the syncthing index describes.
 *
 * READ FROM THE IGNORE LINES THEMSELVES, so the disk and the index count one set.
 * Kept off the network but counted on disk, a name makes a volume read occupied over
 * a synced payload that is empty - the reading the phantom guard exists to catch.
 * Counted by the index and skipped on disk, it reads empty over data. A second list
 * of the same names is a second rule that has to agree with this one, which is the
 * shape STAGING_ROOT above records the cost of.
 *
 * @param {string} name - a single volume-root path component, not a path
 * @param {string[]} unsyncedSubdirs - volume-root names the spec declared with ml:
 * @returns {boolean}
 */
function isSyncedRootName(name, unsyncedSubdirs = []) {
  if (SYNCTHING_INTERNAL_NAMES.includes(name)) return false;
  return !syncthingIgnoreLines(unsyncedSubdirs).some((line) => ignoreLineCovers(line, name));
}

/**
 * What a name may not carry to stand for itself as ONE LINE of .stignore.
 *
 * Pattern syntax, because the line is a pattern: `*` and `?` are wildcards, `[a]` is a
 * character class, `{x,y}` is an alternation and `\` escapes what follows.
 *
 * Control characters, because the file is line-oriented: the derived lines are joined
 * with a newline and written as one document, so a name carrying one IS two lines. It
 * is the class pathSecurity.UNSAFE_PATH_COMPONENT refuses, for the same reason.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_IGNORE_NAME = /[*?[\]{}\\\u0000-\u001F\u007F-\u009F]/;

/**
 * Whitespace where the line begins or ends, which syncthing reads off and FluxOS
 * cannot write back on.
 *
 * Every line is trimmed as the file is read (lib/ignore, `strings.TrimSpace` on each
 * line before it is parsed OR reported), so a name with whitespace at either edge
 * becomes a DIFFERENT name as a pattern: the directory the specification asked to keep
 * local replicates, and a directory whose name is the trimmed one stops. The trimmed
 * line is also what the API hands back, so the converge never sees the file it wrote
 * and rewrites and rescans the folder every pass for the life of the app.
 *
 * The edges only. Inside the name a space is the owner's and survives the round trip
 * intact.
 *
 * `\s` is a superset of what Go trims - Unicode's White_Space plus U+FEFF - and the
 * excess is a byte-order mark at the edge of a directory name.
 */
const EDGE_WHITESPACE_IGNORE_NAME = /^\s|\s$/;

/**
 * Whether a volume-root name written into .stignore means itself.
 *
 * An ignore line is a pattern AND a line, and a name that is neither excludes something
 * the specification did not name. `/[a]ppdata` excludes appdata - the component's synced
 * storage - and leaves the directory literally named `[a]ppdata` replicating. A name
 * holding a newline writes a second line of its own, and the converge then reads back
 * more lines than it derived, so it rewrites the file and rescans the folder every pass
 * for as long as the app exists.
 *
 * Refused rather than escaped: escaping takes a dependency on syncthing's own escape
 * syntax, and answers nothing about how many lines the name becomes. Whitespace at the
 * name's edges is refused for a third reason - see EDGE_WHITESPACE_IGNORE_NAME, where
 * the line that comes back is not the line that was written.
 *
 * @param {string} name - a single path component, not a path
 * @returns {boolean}
 */
function isLiteralIgnoreName(name) {
  return typeof name === 'string'
    && !UNSAFE_IGNORE_NAME.test(name)
    && !EDGE_WHITESPACE_IGNORE_NAME.test(name);
}

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

/**
 * Whether a path inside a volume reaches one of those names at its root.
 *
 * ASKED OF THE PATH, not of a listing. Hiding these from the browser's root listing
 * says what an owner is offered; it does not say what they may ask for by name, and the
 * two are different questions to every endpoint that takes a path. A read that filters
 * the listing and then serves whatever it is handed offers nothing and gives everything.
 *
 * Resolved on both sides before comparing: the volume root can itself be a symlink, and
 * the path may be one - a name that is reserved nowhere can still arrive in the same
 * place, which is the whole reason the write side resolves too.
 *
 * @param {string} realPath - the path being served, symlinks already resolved
 * @param {string} mountPath - the volume root it must be read relative to
 * @returns {Promise<boolean>}
 */
async function reachesReservedName(realPath, mountPath) {
  const base = path.resolve(mountPath);
  const realBase = await fs.realpath(base).catch(() => base);
  const relative = path.relative(realBase, path.resolve(realPath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const [first] = relative.split(path.sep);
  return isReservedName(first);
}

module.exports = {
  STAGING_ROOT,
  LEGACY_STAGING_PREFIX,
  OPERATION_ID,
  stagingRelative,
  isLegacyStagingName,
  SYNCTHING_FOLDER_MARKER,
  SYNCTHING_IGNORE_FILE,
  SYNCTHING_IGNORE_LINES,
  SYNCTHING_INTERNAL_NAMES,
  syncthingIgnoreLines,
  isSyncedRootName,
  isLiteralIgnoreName,
  isStagingName,
  isReservedName,
  reachesReservedName,
};
