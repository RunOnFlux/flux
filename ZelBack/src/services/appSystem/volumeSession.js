const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const deviceHelper = require('../deviceHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const {
  sanitizePath, verifyRealPath, verifyRealPathOfExistingPath,
} = require('../utils/pathSecurity');
const { appsFolder, APP_NAME_REGEX, APP_NAME_REGEX_LEGACY } = require('../utils/appConstants');
const { STAGING_PREFIX, isReservedName } = require('./volumeReservedNames');
const { measureTree, BLOCK_UNIT } = require('../utils/treeSize');

/**
 * Where an app's volume is mounted inside the executor container. Operands in
 * argv are always expressed relative to this, never as host paths.
 */
const WORK_ROOT = '/work';

/**
 * Fraction of the required bytes held back on a capacity check. The measurement
 * races with whatever the application is writing, and a copy rounds every file
 * up to a filesystem block, so an exact fit is not a fit.
 */
const SPACE_HEADROOM = 1.05;

/**
 * A path inside one app's volume that has passed every containment check.
 *
 * Deliberately not a string. The executor accepts only these, so a handler that
 * skips the guards produces code that does not run rather than an endpoint that
 * is quietly unsafe - the checks are structural instead of a convention each
 * handler has to remember.
 *
 * Instances come only from VolumeSession. The constructor is not exported.
 */
class VolumePath {
  #hostPath;

  #relative;

  constructor(hostPath, relative, brand) {
    if (brand !== VolumePath) {
      throw new Error('VolumePath cannot be constructed directly - use VolumeSession.resolve');
    }
    this.#hostPath = hostPath;
    this.#relative = relative;
  }

  /**
   * The path as the executor container sees it. This is what goes into argv.
   *
   * Host paths never appear in a command: the container binds the volume at
   * WORK_ROOT and has nothing else mounted, so a path that somehow escaped the
   * checks would name a file that does not exist in there. That is a second
   * barrier which does not depend on the checks being right.
   */
  get containerPath() {
    return this.#relative === '' ? WORK_ROOT : path.posix.join(WORK_ROOT, this.#relative);
  }

  /** The resolved host path. For stat/realpath only - never for argv. */
  get hostPath() {
    return this.#hostPath;
  }

  /** Path relative to the mount root; '' is the root itself. */
  get relative() {
    return this.#relative;
  }
}

/**
 * Resolve which volume an (app, component) pair names, WITHOUT authorising.
 *
 * Internal callers - backup, restore, the reconciler, the boot sweep - act with
 * no request and no user, so they need this. Request paths must use openVolume
 * instead; see the note there for why that split exists rather than an
 * authorise-or-not flag on one function.
 *
 * @param {string} appname
 * @param {string} component - the component, or 'null' for the flat
 *   single-component form whose identifier is the bare app name
 * @returns {Promise<{mount: string, availableBytes: number, identifier: string}>}
 */
async function resolveVolumeMount(appname, component) {
  if (!appname) throw new Error('appname parameter is mandatory');
  if (!component) throw new Error('component parameter is mandatory');

  // Validated before either value reaches a comparison or a path. The charsets
  // happen to make the identifier unambiguous - neither may contain the
  // underscore that separates them - but that is a property to assert, not one
  // to rely on silently.
  if (!APP_NAME_REGEX.test(appname)) {
    throw new Error('appname contains disallowed characters');
  }
  if (component !== 'null' && !APP_NAME_REGEX_LEGACY.test(component)) {
    throw new Error('component contains disallowed characters');
  }

  const identifier = component === 'null' ? `flux${appname}` : `flux${component}_${appname}`;

  // SELECTED from the kernel's mount table, never built with path.join. FluxOS
  // holds the docker socket, so whatever decides a bind source decides host
  // access; sourcing the candidates from findmnt means a request can only ever
  // name a filesystem that is already mounted as an app volume. The worst a
  // hostile appname achieves is matching nothing.
  const mounts = await deviceHelper.listMountedFilesystems();
  const matched = mounts.filter((mount) => path.basename(mount.target) === identifier);

  if (!matched.length) throw new Error('Application volume not found');
  // Never [0]. One identifier resolving to several mounts means the assumption
  // behind this lookup no longer holds, and picking one silently operates on
  // arbitrary data - a restore into the wrong one overwrites what is live.
  if (matched.length > 1) {
    throw new Error(`${identifier} resolves to ${matched.length} mounts; refusing to guess`);
  }

  const [volume] = matched;
  // A mount table row that is not under the apps folder is not an app volume,
  // whatever its basename looks like.
  if (!volume.target.startsWith(appsFolder)) {
    throw new Error(`${identifier} is mounted outside the apps folder; refusing to use it`);
  }

  return { mount: volume.target, availableBytes: volume.availableBytes, identifier };
}

/**
 * A resolved, authorised handle on one app's volume.
 *
 * Obtain one with openVolume. Every path that reaches the executor comes from
 * resolve() or staging() on one of these.
 */
class VolumeSession {
  #mount;

  #availableBytes;

  #identifier;

  #owner;

  constructor(mount, availableBytes, identifier, owner, brand) {
    if (brand !== VolumeSession) {
      throw new Error('VolumeSession cannot be constructed directly - use openVolume');
    }
    this.#mount = mount;
    this.#availableBytes = availableBytes;
    this.#identifier = identifier;
    this.#owner = owner;
  }

  /** Host mount path. This, and only this, is the executor's bind source. */
  get mount() {
    return this.#mount;
  }

  /** Free bytes on the volume, from the mount table row that resolved it. */
  get availableBytes() {
    return this.#availableBytes;
  }

  get identifier() {
    return this.#identifier;
  }

  /**
   * The FluxID this session was opened by, or null.
   *
   * Carried so an operation started from it is registered against the same
   * identity the status resource checks on a poll - otherwise a caller could
   * not read back the job they just started.
   */
  get owner() {
    return this.#owner;
  }

  /**
   * Turn a caller-supplied relative path into a VolumePath, or throw.
   *
   * Runs the lexical checks (null bytes, backslashes, absolute paths, traversal,
   * the character allowlist) and then the symlink-resolved containment check. A
   * directory inside the mount can itself be a symlink pointing anywhere on the
   * host, so the string check alone is not sufficient.
   *
   * @param {string} userPath - relative to the mount root
   * @param {{mustExist?: boolean, allowRoot?: boolean, allowReserved?: boolean}} [options]
   * @returns {Promise<VolumePath>}
   */
  async resolve(userPath, options = {}) {
    const { mustExist = false, allowRoot = false, allowReserved = false } = options;

    const hostPath = sanitizePath(userPath, this.#mount);
    const relative = path.relative(this.#mount, hostPath);

    if (!allowRoot && relative === '') {
      throw new Error('Refusing to operate on the volume root');
    }

    // The parent is checked because a directory inside the mount can itself be
    // a symlink pointing anywhere on the host. The volume root is the exception:
    // its parent is outside the mount by definition, and the mount IS the trust
    // boundary, so it is verified directly instead.
    const parent = relative === '' ? hostPath : path.dirname(hostPath);
    await verifyRealPathOfExistingPath(parent, this.#mount);

    // Names in the volume root that are not the owner's: syncthing's control
    // files, the filesystem's own recovery directory, and what an interrupted
    // operation leaves for the boot sweep. Refused here rather than at each
    // endpoint because every one of them arrives through this method, and being
    // able to write one of these is being able to stop a folder replicating or
    // to hand the sweep its input.
    //
    // Root only: these mean something to the reader that looks for them there
    // and nowhere else, and reserving them deeper would take names away from
    // the owner inside their own data.
    //
    // Which root is decided from where the path LANDS, not from how it was
    // spelled. An app can `ln -s . here` inside its own volume and reach the
    // root as `here/.stignore`: that carries a separator, so a test on the
    // string never fires, and it resolves inside the mount, so containment is
    // satisfied. Both are true, and neither is the question being asked.
    //
    // Only for a name that is reserved at all, so the ordinary path costs
    // nothing. verifyRealPath returns a path it cannot resolve unchanged, so a
    // name under a directory that does not exist yet compares as itself and
    // stays the owner's.
    if (!allowReserved && relative !== '' && isReservedName(path.basename(hostPath))) {
      const [realParent, realMount] = await Promise.all([
        verifyRealPath(parent, this.#mount),
        verifyRealPath(this.#mount, this.#mount),
      ]);
      if (realParent === realMount) {
        throw new Error(`${relative} is not an application's to write`);
      }
    }

    // Operations act on a link rather than through it (mv, rm and cp -a all
    // do), so verifying a link's TARGET would reject legitimate work on a
    // dangling one. The parent check above still holds.
    let isSymbolicLink = false;
    try {
      const stats = await fs.lstat(hostPath);
      isSymbolicLink = stats.isSymbolicLink();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (mustExist) throw new Error('Source does not exist');
    }
    if (!isSymbolicLink) {
      await verifyRealPath(hostPath, this.#mount);
    }

    return new VolumePath(hostPath, relative, VolumePath);
  }

  /**
   * Resolve a source and destination together, applying every guard that only
   * makes sense for a pair.
   *
   * All the two-operand endpoints go through here so the guard set stays in one
   * reviewable place rather than being re-inlined per endpoint.
   *
   * `destination` is the full target path INCLUDING the new name, not the
   * parent directory - which is what keeps -T semantics identical between copy
   * and move and removes the paste-into versus paste-as ambiguity.
   *
   * Whether an occupied destination is refused is NOT decided here. It is the
   * publish's `noReplace`, which refuses as part of the rename rather than from
   * a look taken beforehand - the application whose volume this is writes to it
   * throughout, so a verdict reached here is about a moment that has passed by
   * the time the container runs.
   *
   * @param {string} source
   * @param {string} destination
   * @returns {Promise<{source: VolumePath, destination: VolumePath}>}
   */
  async pair(source, destination) {
    const from = await this.resolve(source, { mustExist: true });
    const to = await this.resolve(destination);

    if (from.hostPath === to.hostPath) {
      throw new Error('Source and destination are the same');
    }

    // '' means identical; a '..'-prefixed or absolute result means the two sit
    // on separate branches. Anything else means one holds the other.
    //
    // Compared this way rather than by string prefix, which reads photos-2024 as
    // living inside photos.
    const holds = (ancestor, descendant) => {
      const within = path.relative(ancestor.hostPath, descendant.hostPath);
      return Boolean(within) && !within.startsWith('..') && !path.isAbsolute(within);
    };

    // For a directory copy this recurses until the volume fills.
    if (holds(from, to)) {
      throw new Error('Destination is inside the source');
    }

    // The other direction, which only overwrite lets through: replacing photos
    // with photos/2024. The executor cannot carry it out - displacing the
    // destination takes the source away inside it, so the publish stops between
    // its two renames and the caller's whole folder is parked under a name the
    // reserved names hide from them until the next boot sweep. Completing it
    // instead would delete everything else in photos, which they never named.
    //
    // Refused here as well as in the image so the caller is told in a sentence
    // rather than through a container's exit code. The image refuses it too,
    // because that invariant is not one it should hold on trust from a caller.
    if (holds(to, from)) {
      throw new Error('Destination contains the source');
    }

    return { source: from, destination: to };
  }

  /**
   * A fresh staging directory inside the volume.
   *
   * Everything is written here and renamed into place only on success, which is
   * what makes the guarantees the endpoints advertise true: a cancelled copy
   * and an extraction that trips its size cap on entry 900 of 1000 both leave
   * nothing the user can see, and an operation abandoned by a FluxOS restart
   * leaves a directory a boot sweep can recognise and reclaim.
   *
   * @returns {VolumePath}
   */
  staging() {
    const name = `${STAGING_PREFIX}${crypto.randomUUID()}`;
    return new VolumePath(path.join(this.#mount, name), name, VolumePath);
  }

  /**
   * A staging DIRECTORY with the operation's result entry inside it.
   *
   * For an operation whose tool writes scratch beside its output: Info-ZIP
   * builds an archive in a temp file in the output's directory, and at the
   * volume root that temp - ziXXXXXX, outside the shape the sweep may delete -
   * survived a SIGKILL forever, replicated mid-write, and sat in the owner's
   * listing. Inside the minted directory, the temp, a partial result and the
   * entry are one reclaim. The executor creates the directory and reclaims it
   * whole.
   *
   * The entry is named after the destination it will become, because the tool
   * writes THAT name and flux-op inspects it by name afterwards: zip appends
   * .zip to a name carrying no extension, so an entry called `result` is
   * written as `result.zip` and the inspection then lstats a path that does not
   * exist. Using the destination's own basename - which archiveFormat has
   * already required to be a valid archive extension - means the tool is given
   * the exact name it writes, and nothing is mutated.
   *
   * Takes the destination as a VolumePath, not a string: the name comes from a
   * path resolve() already produced, so this is not a second place a caller
   * string becomes a trusted path, and a basename cannot traverse.
   *
   * @param {VolumePath} destination the resolved path this result becomes
   * @returns {{directory: VolumePath, entry: VolumePath}}
   */
  stagingDir(destination) {
    if (!(destination instanceof VolumePath)) {
      throw new Error('stagingDir must be given the destination VolumePath to name its result after');
    }
    const name = `${STAGING_PREFIX}${crypto.randomUUID()}`;
    const relative = path.posix.join(name, path.posix.basename(destination.relative));
    return {
      directory: new VolumePath(path.join(this.#mount, name), name, VolumePath),
      entry: new VolumePath(path.join(this.#mount, relative), relative, VolumePath),
    };
  }

  /**
   * Whether this path is a directory, following nothing.
   *
   * A symlink answers false however it resolves, which is what the callers
   * want: an archiver is given the link itself, not the tree behind it.
   *
   * @param {VolumePath} volumePath
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line class-methods-use-this
  async isDirectory(volumePath) {
    if (!(volumePath instanceof VolumePath)) {
      throw new Error('isDirectory requires a VolumePath');
    }
    const stats = await fs.lstat(volumePath.hostPath).catch((error) => {
      if (error.code === 'ENOENT') throw new Error('Source does not exist');
      throw error;
    });
    return stats.isDirectory();
  }

  /**
   * The directory containing this path.
   *
   * Built rather than resolved: the path it derives from has already passed
   * every guard, and its parent was itself checked for containment on the way
   * through. Re-resolving would re-run those checks against a volume the app
   * can change underneath us, which is a second answer to a settled question
   * rather than a stronger one.
   *
   * @param {VolumePath} volumePath
   * @returns {VolumePath}
   */
  parent(volumePath) {
    if (!(volumePath instanceof VolumePath)) {
      throw new Error('parent requires a VolumePath');
    }
    const relative = path.dirname(volumePath.relative);
    // dirname of a top-level entry is '.', which as a relative path means the
    // mount root - the form VolumePath spells ''.
    const normalised = relative === '.' ? '' : relative;
    return new VolumePath(path.join(this.#mount, normalised), normalised, VolumePath);
  }

  /**
   * Byte cost of an operation whose source is this path.
   *
   * Symlinks measure zero - cp -a and the archivers copy the link, not what it
   * points at.
   *
   * NOTE: this reads the volume from the FluxOS process. When FluxOS is demoted
   * to an unprivileged system user it will no longer be able to, and this moves
   * into the executor alongside everything else that touches app data.
   *
   * @param {VolumePath} volumePath
   * @returns {Promise<number>} bytes
   */
  // eslint-disable-next-line class-methods-use-this
  async measure(volumePath) {
    if (!(volumePath instanceof VolumePath)) {
      throw new Error('measure requires a VolumePath');
    }
    const stats = await fs.lstat(volumePath.hostPath).catch((error) => {
      if (error.code === 'ENOENT') throw new Error('Source does not exist');
      throw error;
    });
    if (stats.isSymbolicLink()) return 0;

    // What it OCCUPIES, not what it says. This figure is handed to
    // requireSpace, which compares it against the volume's free space - a count
    // of blocks - and a file occupies whole blocks. A directory of ten thousand
    // one-byte files reports ten kilobytes for itself and costs forty megabytes,
    // so measuring what the files say passes a copy that cannot fit.
    const size = stats.isDirectory()
      ? await measureTree(volumePath.hostPath, fs, { occupied: true })
      : stats.blocks * BLOCK_UNIT;

    // An ESTIMATE, and low rather than high when it is wrong. The lstat above
    // throws on a source that cannot be reached at all, but measureTree skips
    // an entry it cannot stat and walks nothing under a directory it cannot
    // open - and this runs in the FluxOS process, root on ArcaneOS and an
    // ordinary user elsewhere, so a directory the app made private to its own
    // uid is exactly that case.
    //
    // Which is what it is for: refusing an operation early and in a sentence,
    // before anything starts. What makes the operation SAFE is the byte ceiling
    // its executor run carries - applied to what actually lands, by a container
    // that can read every part of the volume.
    return size;
  }

  /**
   * Throw unless `requiredBytes` plus headroom fits in the volume.
   *
   * Fails closed: a capacity that cannot be established is a refusal, because
   * an operation that runs out of space partway leaves a partial tree the user
   * has to identify and clean up, having consumed the space it failed to need.
   *
   * @param {number} requiredBytes
   */
  requireSpace(requiredBytes) {
    if (!Number.isFinite(this.#availableBytes)) {
      throw new Error('Unable to determine free space on the application volume');
    }
    const needed = Math.ceil(requiredBytes * SPACE_HEADROOM);
    if (needed > this.#availableBytes) {
      throw new Error(`Not enough free space: ${needed} bytes required, ${this.#availableBytes} bytes available`);
    }
  }

  /**
   * Throw unless the volume has room for anything at all.
   *
   * For the operations whose size cannot be known in advance - an extraction,
   * an upload - where the byte ceiling is the only bound and IS the volume's
   * free space. A full volume makes that ceiling zero, and a ceiling of zero is
   * how the executor and the image both spell "no ceiling was asked for", so
   * the one operation with nothing else protecting it would run unbounded until
   * the filesystem refused a write. Refused here instead, before a container
   * starts, which is also where the caller gets a sentence rather than whatever
   * tar says about ENOSPC.
   */
  requireCapacity() {
    if (!Number.isFinite(this.#availableBytes)) {
      throw new Error('Unable to determine free space on the application volume');
    }
    if (this.#availableBytes <= 0) {
      throw new Error('No free space on the application volume');
    }
  }
}

/**
 * The authorised way to reach an app's volume from a request.
 *
 * --- Why authorisation lives here and not in each handler ---
 *
 * The check this makes is OBJECT-level - "is this caller the owner of THIS
 * app" - not route-level - "is this caller logged in". The industry splits
 * those deliberately, and puts them in different places:
 *
 *   route-level   middleware, above the handler (express middleware, rails
 *                 before_action, spring security filters)
 *   object-level  fused with the lookup that fetches the object, so the
 *                 unauthorised object cannot be obtained at all (django's
 *                 get_object_or_404 over a user-scoped queryset, rails
 *                 pundit's policy_scope)
 *
 * Object-level checks are fused because the failure mode of scattering them is
 * that one gets forgotten, and that omission is invisible - the endpoint works
 * perfectly for its author. It is the most commonly missed check in the field:
 * Broken Object Level Authorization is number one on the OWASP API Security
 * Top 10.
 *
 * --- Why two functions rather than one with a flag ---
 *
 * resolveVolumeMount exists unauthorised for callers that genuinely have no
 * user: backup, restore, the reconciler, the boot sweep. Serving both from one
 * function would mean a `skipAuth` argument, and a guarantee that can be
 * switched off by a boolean is weaker than no guarantee at all, because it
 * reads as safe. Two names, one of which is the only thing request paths may
 * use, is the same shape django and rails settled on.
 *
 * @param {object} req - express request. appname and component are read from
 *   the JSON body for the endpoints that POST one, and from params or query for
 *   the older GET endpoints that still take them there.
 * @param {{privilege?: string}} [options]
 * @returns {Promise<VolumeSession>}
 */
async function openVolume(req, options = {}) {
  // This default is the gate on eight endpoints that write to a customer's app
  // volume - create, rename, move, copy, compress, extract, upload and remove -
  // and no caller overrides it. appownerorfluxteam refuses the node operator,
  // because uploading into, rewriting or deleting the data of an app you only
  // host is not the node operator's to do.
  const { privilege = 'appownerorfluxteam' } = options;

  // ensureObject for url-encoded parity: express.json() populates req.body for
  // application/json, and a form-encoded caller arrives as a string.
  const body = serviceHelper.ensureObject(req.body) || {};
  const appname = req.params.appname || req.query.appname || body.appname || '';
  const component = req.params.component || req.query.component || body.component || '';

  const authorized = await verificationHelper.verifyPrivilege(privilege, req, appname);
  if (!authorized) {
    // Carries the code so this reaches a client as the body
    // messageHelper.errUnauthorizedMessage() has always produced. Handlers used
    // to call that directly; they now throw, and dropping the 401 here would
    // silently change what every existing caller reads.
    const error = new Error('Unauthorized. Access denied.');
    error.name = 'Unauthorized';
    error.code = 401;
    throw error;
  }

  const { mount, availableBytes, identifier } = await resolveVolumeMount(appname, component);
  // Read after authorisation succeeded, so this is the identity that passed it.
  const auth = serviceHelper.ensureObject(req.headers && req.headers.zelidauth);
  const owner = (auth && auth.zelid) || null;
  return new VolumeSession(mount, availableBytes, identifier, owner, VolumeSession);
}

/**
 * A session on a volume named by the mount table rather than by a request.
 *
 * The boot sweep has no user to authorise and no app name to look up - it walks
 * the mount table and acts on whatever app volumes are mounted. It still needs a
 * session, because every path the executor accepts comes from resolve() on one
 * of these: a caller with no user is exactly the caller that must not be given a
 * way around the containment checks.
 *
 * @param {{target: string, availableBytes: number}} mountRow - a row from
 *   deviceHelper.listMountedFilesystems
 * @returns {VolumeSession}
 */
function sessionForMountedVolume(mountRow) {
  const target = mountRow && mountRow.target;
  // The same rule resolveVolumeMount applies to what it selected: a mount that
  // is not under the apps folder is not an app volume, whatever it is called.
  if (!target || !target.startsWith(appsFolder)) {
    throw new Error(`${target} is not an app volume mount; refusing to use it`);
  }
  return new VolumeSession(
    target,
    mountRow.availableBytes,
    path.basename(target),
    // No user. The sweep acts for the node, and openVolume is the only path
    // that may record an owner, because it is the only one that checked.
    null,
    VolumeSession,
  );
}

module.exports = {
  openVolume,
  resolveVolumeMount,
  sessionForMountedVolume,
  VolumePath,
  VolumeSession,
  WORK_ROOT,
  SPACE_HEADROOM,
};
