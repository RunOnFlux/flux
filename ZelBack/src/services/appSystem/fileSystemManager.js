// File System Manager - Manages filesystem operations for FluxOS applications
//
// Every mutating endpoint here runs its work in a throwaway container with only
// the target app's volume mounted (see volumeExecutor), and reaches that volume
// through a VolumeSession (see volumeSession) rather than by building paths of
// its own. A handler that skips a check does not produce an unsafe endpoint - it
// produces code that does not run.
//
// The two download endpoints are the exception, and deliberately so. They are
// reads: opening a file has no side effects, so the file can be opened and the
// DESCRIPTOR checked before a byte is sent, which is a stronger guarantee than
// re-checking a name that may since have come to mean something else. A write
// commits the moment it opens, which is why an upload cannot be made safe that
// way and runs in the container like everything else.
const archiver = require('archiver');
const { PassThrough } = require('stream');
const path = require('path');
const { formidable } = require('formidable');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const IOUtils = require('../IOUtils');
const log = require('../../lib/log');
const { sanitizePath, verifyRealPath, validateFilename } = require('../utils/pathSecurity');
const { openVolume, SPACE_HEADROOM } = require('./volumeSession');
const { sendFile } = require('../utils/fileTransfer');
const executor = require('./volumeExecutor');
const jobRegistry = require('../utils/jobRegistry');
const operationsController = require('../appManagement/operationsController');

/**
 * Report a failure.
 *
 * A refusal to START - the node or the app already has its allowance of
 * concurrent operations - answers 503 with a Retry-After rather than a generic
 * error, so a caller turned away learns it immediately instead of registering
 * an operation and polling to discover it never began.
 */
function respondError(res, error) {
  log.error(error);
  const errorResponse = messageHelper.createErrorMessage(
    error.message || error,
    error.name,
    error.code,
  );
  if (error.kind === 'busy') {
    if (error.retryAfterMs) {
      res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
    }
    // The operation being waited on travels in the body rather than only in the
    // message, so a client can link to it, poll it or cancel it instead of
    // retrying until it happens to succeed.
    if (error.operation) {
      errorResponse.data.operation = error.operation;
    }
    res.status(503).json(errorResponse);
    return;
  }
  res.json(errorResponse);
}

function respondSuccess(res, message) {
  res.json(messageHelper.createSuccessMessage(message));
}

/** A required parameter, from the path, the query string or a JSON body. */
function requiredParam(req, name) {
  const body = serviceHelper.ensureObject(req.body) || {};
  const value = req.params[name] || req.query[name] || body[name];
  if (!value) throw new Error(`${name} parameter is mandatory`);
  return value;
}

/**
 * WHICH SHAPE AN OPERATION ANSWERS IN
 *
 * An operation bounded by construction answers inline: a mkdir and a rename are
 * one syscall whatever the tree holds, so making a caller poll for them is
 * ceremony. An operation whose duration scales with the data registers a job
 * and answers 202 - a copy, a move, a compression, an extraction. The rule is
 * about the WORST case rather than the common one: `moveobject` is a job
 * because overwriting does an unbounded rm of what it displaced, not because
 * moving is usually slow.
 *
 * `removeobject` is a job by the same rule - `rm -rf` scales with the tree -
 * but it answered inline before jobs existed, and two dashboards call it. So it
 * keeps answering inline WHEN IT IS QUICK and becomes a job only when it
 * outlives its deadline.
 *
 * THAT CLAUSE IS COMPATIBILITY, NOT DESIGN, AND HERE IS HOW TO KNOW IT CAN GO.
 * The callers are fluxos-frontend's VolumeBrowser and the palworld dashboard's
 * ModManager, and today neither polls: a delete answering 202 would be read as
 * finished the moment it was accepted. Check them - if both poll a job through
 * to a terminal state, the only callers still needing an inline answer are ones
 * nobody here can see, and taking it away becomes a version boundary rather
 * than a surprise. Then delete REMOVE_INLINE_DEADLINE_MS, pass no
 * inlineDeadlineMs, and remove is a job like the others - along with the option
 * itself, which exists for nothing else.
 */

/**
 * To create a folder in app's volume. Only accessible by app owners and above.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function createAppsFolder(req, res) {
  try {
    const volume = await openVolume(req);
    const folder = requiredParam(req, 'folder');
    const target = await volume.resolve(folder);

    // No command: the folder is created as staging and published under the name
    // the caller asked for, which is the publish every other operation here
    // already uses. `mkdir` ran directly before, and the difference is what a
    // failure can say - a command reports one by exiting non-zero, so "that name
    // is taken" arrived as a status of 1 and a sentence worded by whichever
    // build of mkdir the image carries. The dashboard shows an owner a different
    // message for a name in use than for a folder that could not be made, and
    // noReplace is what lets it tell the two apart.
    const staging = volume.staging();
    await executor.run(volume, [], {
      publish: { staging, destination: target },
      mkdirStaging: true,
      noReplace: true,
    });
    respondSuccess(res, 'Folder Created');
  } catch (error) {
    respondError(res, error);
  }
}

/**
 * To rename a file or folder WITHIN its current directory.
 *
 * Kept for existing clients. moveAppsObject is the general form and handles
 * this case too; the difference is only that a new name here may not contain a
 * path separator, which is why this endpoint could never move anything.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function renameAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const oldpath = req.params.oldpath || req.query.oldpath;
    if (!oldpath) throw new Error('No file nor folder to rename specified');
    const newname = req.params.newname || req.query.newname;
    if (!newname) throw new Error('No new name specified');
    if (newname.includes('/')) throw new Error('New name is invalid');

    // The new name lands beside the old one, so the destination is built from
    // the SOURCE's directory rather than from anything else the caller sent.
    const destination = path.posix.join(path.posix.dirname(oldpath), newname);

    const { source, destination: target } = await volume.pair(oldpath, destination);

    // No command, and `source` rather than `staging`: a rename publishes the
    // caller's own entry where it stands, so there is nothing to run and
    // nothing a failure may throw away.
    //
    // Never overwrites, and takes no flag to say otherwise. Publishing over the
    // destination exchanges the two entries and removes what was displaced, and
    // that removal is unbounded - which is why moveAppsObject answers 202 and
    // runs as a job. This endpoint answers inline, so allowing an overwrite
    // would put an unbounded delete inside a held request. A caller that means
    // to replace something uses moveAppsObject, which is the general form and
    // handles this case too.
    await executor.run(volume, [], { publish: { source, destination: target }, noReplace: true });
    respondSuccess(res, 'Rename successful');
  } catch (error) {
    respondError(res, error);
  }
}

/**
 * To remove a file or folder from an app's volume. Only accessible by app
 * owners and above.
 * @param {object} req Request.
 * @param {object} res Response.
 */
/**
 * How long a remove may take before it becomes something to come back for.
 *
 * Deleting an ordinary folder is sub-second, so a caller written before jobs
 * existed keeps getting the completed answer it has always had. A tree big
 * enough to outlive this is the case where holding a request open was already
 * wrong.
 *
 * Temporary: see the shape rule at the top of this file for what has to be true
 * before this goes, and what goes with it.
 */
const REMOVE_INLINE_DEADLINE_MS = 10000;

async function removeAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const object = requiredParam(req, 'object');
    const target = await volume.resolve(object, { mustExist: true });

    return startOperation(
      res,
      volume,
      { kind: 'fileoperation.remove', status: 'Removing...', owner: volume.owner },
      (progress) => executor.run(volume, ['rm', '-rf', target], progress),
      { inlineDeadlineMs: REMOVE_INLINE_DEADLINE_MS },
    );
  } catch (error) {
    return respondError(res, error);
  }
}

/**
 * To download a zip folder for a specified directory. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {boolean} authorized False until verified as an admin.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder;
      let { component } = req.params;
      component = component || req.query.component;
      if (!folder || !component) {
        const errorResponse = messageHelper.createErrorMessage('folder and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let folderpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        // Use appid level to access appdata and all other mount points
        // Sanitize folder path to prevent directory traversal attacks
        folderpath = sanitizePath(folder, appVolumePath[0].mount);
        // Verify real path after symlink resolution to prevent symlink escape attacks
        await verifyRealPath(folderpath, appVolumePath[0].mount);
      } else {
        throw new Error('Application volume not found');
      }
      const zip = archiver('zip');
      const sizeStream = new PassThrough();
      let compressedSize = 0;
      sizeStream.on('data', (chunk) => {
        compressedSize += chunk.length;
      });
      sizeStream.on('end', () => {
        const folderNameArray = folderpath.split('/');
        const folderName = folderNameArray[folderNameArray.length - 1];
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-disposition': `attachment; filename=${folderName}.zip`,
          'Content-Length': compressedSize,
        });
        // Now, pipe the compressed data to the response stream
        const zipFinal = archiver('zip');
        zipFinal.pipe(res);
        zipFinal.directory(folderpath, false);
        zipFinal.finalize();
      });
      zip.pipe(sizeStream);
      zip.directory(folderpath, false);
      zip.finalize();
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a specified file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFile(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      let { component } = req.params;
      component = component || req.query.component;
      if (!file || !component) {
        const errorResponse = messageHelper.createErrorMessage('file and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        // Use appid level to access appdata and all other mount points
        // Sanitize file path to prevent directory traversal attacks
        filepath = sanitizePath(file, appVolumePath[0].mount);
        // Verify real path after symlink resolution to prevent symlink escape attacks
        await verifyRealPath(filepath, appVolumePath[0].mount);
      } else {
        throw new Error('Application volume not found');
      }
      const fileName = path.basename(filepath);
      await sendFile(res, filepath, fileName);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * Read the operands the two-operand endpoints share.
 *
 * `destination` is the full target path INCLUDING the new name, not the parent
 * directory. That keeps -T semantics identical between copy and move and
 * removes the "paste into this directory" versus "paste as this name"
 * ambiguity - the client appends the basename itself.
 *
 * `overwrite` is opt-in. A client calls without it, and turns the resulting
 * 'Destination already exists' into a confirmation before retrying with it.
 */
async function resolveOperands(req, volume) {
  const source = requiredParam(req, 'source');
  const destination = requiredParam(req, 'destination');
  // A real boolean from a JSON body, or the string a form-encoded caller sends.
  // Anything else is false: overwrite has to be asked for, so an unparseable
  // value must not be read as consent to destroy something.
  const raw = serviceHelper.ensureObject(req.body)?.overwrite ?? req.query.overwrite;
  const overwrite = raw === true || raw === 'true';
  const pair = await volume.pair(source, destination);

  // Carried to the publish rather than settled here. What "the destination is
  // taken" means is decided by the rename that acts on it, in one step, on the
  // volume of an application that is writing to it the whole time - a look taken
  // now answers for a moment that has passed by the time the container runs.
  return { ...pair, noReplace: !overwrite };
}

/**
 * Start a file operation and answer 202 with a job to poll.
 *
 * All four long operations go through here, move included. Its visible part is
 * a rename, but paste is ONE gesture in a file browser: cut-paste returning a
 * result while copy-paste returned a job would put two response shapes inside a
 * single user action, and the way that gets misread is treating the 202 body's
 * status: 'Running' as terminal success. A move also does an unbounded rm -rf
 * of the displaced copy when it overwrites, so "instant" was a claim about the
 * common case rather than about the operation.
 *
 * The job is registered LAST, after every synchronous refusal has been decided,
 * so a caller turned away never sees an operation that existed briefly and then
 * failed for a reason it could have been told up front.
 *
 * @param {object} res
 * @param {VolumeSession} volume
 * @param {{kind: string, status: string, owner: string|null,
 *   trackBytes?: boolean, bytesTotal?: number}} meta - `trackBytes` for an
 *   operation that WRITES into staging, so its size means progress; `bytesTotal`
 *   only where a denominator is genuinely knowable
 * @param {function(object): Promise<void>} work - receives the executor options
 *   carrying progress, cancellation and byte reporting, and runs the operation
 * @param {{inlineDeadlineMs?: number}} [options] - answer inline if the work
 *   finishes within this, rather than 202 immediately. Compatibility for an
 *   operation that answered inline before jobs existed, and temporary: the
 *   shape rule at the top of this file records what removes it
 */
function startOperation(res, volume, meta, work, { inlineDeadlineMs = 0 } = {}) {
  // Before the job exists, so a caller with no slot gets 503 + Retry-After now
  // rather than an operation that is only ever going to report that it never
  // started.
  executor.assertCapacity(volume);

  // detail() is read when a client polls, so anything here costs nothing while
  // nobody is watching - which is also why the byte figures belong here rather
  // than in `progress`, which is append-only and returned whole.
  //
  // bytesDone is read from the STAGING path, not from the copying process. No
  // counter on the source side sees the bytes: since coreutils 9.0 `cp` uses
  // copy_file_range(2) and the kernel moves them, so /proc/<pid>/io stays flat
  // and the fdinfo offset does not advance until the end. What grows the whole
  // way through is the destination inode.
  //
  // A denominator is only offered where one is real. A copy knows it, from the
  // measurement the capacity check already made. An extraction does not: the
  // only figure available is the archive's own declared uncompressed size,
  // which is written by whoever built the archive and is exactly what the size
  // ceiling refuses to believe. Nor does a compression, whose ratio is not
  // knowable in advance. Those two report bytes written and no percentage,
  // rather than a percentage derived from a number that can lie.
  let bytesDone = null;
  const handle = jobRegistry.start({
    kind: meta.kind,
    owner: meta.owner,
    detail: () => ({
      app: volume.identifier,
      operation: meta.kind,
      // Capped at the total while one is known. The running figure is what the
      // whole volume has consumed, and the application is writing to it too, so
      // its own activity would otherwise push a copy past 100% - which reads as
      // a broken bar rather than as the estimate it is. The figure a completed
      // operation reports is measured from what it published, so the cap only
      // ever applies mid-flight.
      ...(bytesDone === null ? {} : {
        bytesDone: meta.bytesTotal === undefined ? bytesDone : Math.min(bytesDone, meta.bytesTotal),
      }),
      ...(meta.bytesTotal === undefined ? {} : { bytesTotal: meta.bytesTotal }),
    }),
  });

  // Deliberately not awaited: the response goes back now and the work reports
  // itself into the registry.
  //
  // Wrapped in a resolved promise so a SYNCHRONOUS throw from work() settles the
  // job too. Without it such a throw escapes past these handlers, and the job it
  // left behind stays Running - which never expires, because only terminal jobs
  // are retained on a clock.
  const running = Promise.resolve()
    .then(() => work({
      status: meta.status,
      onProgress: (message) => jobRegistry.progress(handle.jobId, message),
      isCanceled: () => jobRegistry.isCanceled(handle.jobId),
      ...(meta.trackBytes ? { onBytes: (bytes) => { bytesDone = bytes; } } : {}),
    }))
    // Succeeded even if a cancel was asked for. Reaching here means the command
    // exited 0, which means it published - so the cancel lost the race, and
    // saying Canceled would tell the caller nothing happened while their
    // destination has in fact been replaced. For a move it would be worse
    // still: the source is gone, and the answer says it was not touched.
    // Cancellation is cooperative, so "we stopped if we could" is the promise,
    // and a stop that arrived too late is not a stop.
    .then(() => jobRegistry.succeed(handle.jobId))
    // A cancel that DID take effect lands here instead: flux-op traps the
    // signal and exits 143, so the executor throws rather than resolving.
    .catch((error) => {
      if (jobRegistry.isCanceled(handle.jobId)) jobRegistry.cancelled(handle.jobId);
      else jobRegistry.fail(handle.jobId, error);
    });

  if (!inlineDeadlineMs) return operationsController.accepted(res, handle);

  // An operation that used to answer inline still does when it is quick, so a
  // client written before jobs existed is never worse off: a delete of an
  // ordinary folder is sub-second and answers 200 exactly as it always has.
  // Only one that outlives the deadline becomes something to come back for -
  // and that is the case where holding the request was already wrong, since an
  // unbounded one is held open until an intermediate proxy kills it.
  return Promise.race([running.then(() => true), serviceHelper.delay(inlineDeadlineMs)])
    .then((finished) => (finished
      ? operationsController.completed(res, handle, meta.owner)
      : operationsController.accepted(res, handle)));
}

/**
 * Which archive tool handles this name, or null if we do not handle it.
 *
 * @param {string} name
 * @returns {'zip'|'tar'|null}
 */
function archiveFormat(name) {
  // Case-insensitive: an extension is a convention, not an identifier, and
  // plenty of software writes BACKUP.ZIP. Refusing to extract one with a
  // message listing the extension it plainly has reads as a broken endpoint.
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar';
  return null;
}

/**
 * Move a file or folder anywhere within the app's volume.
 *
 * This is what renameAppsObject could never do: that one rejects any new name
 * containing a path separator, so it can rename in place but not relocate.
 *
 * No capacity check - a rename within one filesystem moves no bytes.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function moveAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const { source, destination, noReplace } = await resolveOperands(req, volume);

    // No command: the source IS the result, so publishing it is the whole
    // operation. Going through publish rather than a bare `mv` is what handles
    // an existing destination - rename(2) refuses a non-empty directory target
    // and cannot replace a file with a directory at all.
    return startOperation(res, volume, { kind: 'fileoperation.move', status: 'Moving...', owner: volume.owner }, (progress) => executor.run(volume, [], { ...progress, publish: { source, destination }, noReplace }));
  } catch (error) {
    respondError(res, error);
  }
}

/**
 * Copy a file or folder within the app's volume.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function copyAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const { source, destination, noReplace } = await resolveOperands(req, volume);

    // The same measurement serves both the capacity check and the progress
    // denominator - a copy writes as many bytes as it reads, so the figure the
    // one needs is exactly the figure the other reports against.
    const bytesTotal = await volume.measure(source);
    volume.requireSpace(bytesTotal);

    const staging = volume.staging();
    // -a preserves ownership, timestamps and symlinks and implies -r; -T stops
    // cp copying INTO the staging directory instead of becoming it.
    return startOperation(res, volume, {
      kind: 'fileoperation.copy', status: 'Copying...', owner: volume.owner, trackBytes: true, bytesTotal,
    }, (progress) => executor.run(volume, ['cp', '-a', '-T', source, staging], {
      ...progress,
      publish: { staging, destination },
      noReplace,
      // The measurement above is what refuses this early and with a sentence.
      // It is not what makes it safe: it is taken by the FluxOS process, which
      // is root on ArcaneOS but an ordinary user elsewhere, and a directory the
      // app made private is one it cannot open. measureTree skips what it
      // cannot read, so the figure can be low - silently, and in the direction
      // that admits a copy which does not fit. The ceiling is applied to what
      // actually lands, by the container, which can read all of it.
      maxBytes: volume.availableBytes / SPACE_HEADROOM,
    }));
  } catch (error) {
    respondError(res, error);
  }
}

/**
 * Archive a file or folder, leaving the archive on the volume.
 *
 * Unlike downloadAppsFolder, which zips only to stream the result to the
 * browser, this produces an archive the app keeps - the thing you want before a
 * risky upgrade.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function compressAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const { source, destination, noReplace } = await resolveOperands(req, volume);

    const format = archiveFormat(destination.relative);
    if (!format) {
      throw new Error('Destination must end in .zip, .tar.gz or .tgz');
    }

    // The archive cannot be larger than what goes into it by enough to matter,
    // and compressed output is normally far smaller - so the source size is a
    // safe over-estimate rather than a guess.
    volume.requireSpace(await volume.measure(source));

    // An archive holds the source's CONTENTS at its top level, so extracting it
    // to a destination reproduces the source under that name - compress then
    // extract returns what went in.
    //
    // Both archivers decide their layout from where they run and what they are
    // handed, and neither infers anything useful from an absolute operand: zip
    // stores the whole path minus its leading slash, which would put an
    // internal mount directory the user has never seen inside their archive,
    // and tar's -C cannot be pointed at a file at all. Running in the right
    // directory and passing a bare operand is what makes the two agree, and is
    // the only form that works for a single file.
    const sourceIsDirectory = await volume.isDirectory(source);
    const workingDir = sourceIsDirectory ? source : volume.parent(source);
    const operand = sourceIsDirectory ? '.' : path.basename(source.relative);

    const staging = volume.staging();
    // `--` before the operand, because a name is not an option. A file may
    // legitimately begin with a dash - the component rule rejects only the
    // separators and the control characters - and both archivers would read one
    // as a flag and refuse the request. Ending option parsing is what makes the
    // operand a filename whatever it starts with, and unlike a `./` prefix it
    // leaves the name stored in the archive alone.
    const argv = format === 'zip'
      // -r recurses, -q keeps the per-file listing out of the container's
      // output, -y stores a symlink as a symlink instead of the file it points
      // at, which is what tar and cp -a already do.
      ? ['zip', '-r', '-q', '-y', staging, '--', operand]
      : ['tar', '-czf', staging, '--', operand];

    // Bytes written to the archive, with no total: how far a source of a known
    // size compresses is not knowable until it has.
    return startOperation(res, volume, {
      kind: 'fileoperation.compress', status: 'Compressing...', owner: volume.owner, trackBytes: true,
    }, (progress) => executor.run(volume, argv, {
      ...progress,
      workingDir,
      publish: { staging, destination },
      noReplace,
      // As for copy: the measurement above refuses this early, the ceiling is
      // what makes it safe. A source measured by a process that cannot open
      // every directory in it reads low, and an archive is written by one that
      // can read all of them.
      maxBytes: volume.availableBytes / SPACE_HEADROOM,
    }));
  } catch (error) {
    respondError(res, error);
  }
}

/**
 * Unpack an archive already on the volume into a directory.
 *
 * The only endpoint here whose CONTENT is attacker-supplied, so it is the one
 * the container configuration matters most for. Three things bound what a hostile archive
 * can do, none of which depend on inspecting it first:
 *
 *   a member named ../../etc/passwd resolves inside a container whose rootfs is
 *   read-only and which is discarded either way;
 *
 *   --no-same-owner ignores the uids the archive claims, and
 *   --no-same-permissions its modes, so it cannot plant a setuid binary - and
 *   the volume is mounted nosuid, so one would be inert even if it did;
 *
 *   a zip bomb fills the app's own volume, which is a fixed-size loop file, so
 *   it cannot reach the host disk.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function extractAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const { source, destination, noReplace } = await resolveOperands(req, volume);

    // Refused by extension rather than by sniffing the content: a caller who
    // has to name what they uploaded cannot have it interpreted as something
    // else.
    const format = archiveFormat(source.relative);
    if (!format) {
      throw new Error('Source must be a .zip, .tar.gz or .tgz archive');
    }

    const staging = volume.staging();
    const argv = format === 'zip'
      ? ['unzip', '-q', source, '-d', staging]
      : ['tar', '-xzf', source, '-C', staging, '--no-same-owner', '--no-same-permissions'];

    // Bytes unpacked so far, with no total: the only figure that could serve as
    // one is the archive's own account of itself, which is precisely what the
    // ceiling below refuses to take on trust.
    return startOperation(res, volume, {
      kind: 'fileoperation.extract', status: 'Extracting...', owner: volume.owner, trackBytes: true,
    }, (progress) => executor.run(volume, argv, {
      ...progress,
      publish: { staging, destination },
      noReplace,
      // tar -C and unzip -d both need the directory to exist already.
      mkdirStaging: true,
      // The capacity check the other operations make up front cannot be made
      // here: an archive's declared uncompressed size is written by whoever
      // built it, so a bomb simply understates itself. The ceiling is applied
      // to what actually lands instead, and it is the free space on the volume,
      // so an extraction can fill what is available and no more.
      maxBytes: volume.availableBytes / SPACE_HEADROOM,
      // A FIFO, socket or device node in the result is refused: none of them is
      // data, and whatever opens a FIFO without O_NONBLOCK waits for a writer
      // that is never coming, so one published here is a reader that hangs. tar
      // both carries and recreates a FIFO, so an archive is all it takes.
      //
      // Links pass. What bounds an archive this node cannot vouch for is the
      // container it is unpacked in - one volume mounted, a read-only rootfs -
      // and what bounds a link left in the result is the reader: every walk of a
      // volume here lstats, and the downloads open with O_NOFOLLOW.
      dataOnly: true,
    }));
  } catch (error) {
    respondError(res, error);
  }
}

/**
 * Where an upload's files land, relative to the volume root.
 *
 * The restore flow uploads an archive to a fixed place; everything else lands
 * where the file browser is pointed, which may be the volume root.
 */
function uploadFolder(req) {
  const type = req.params.type || req.query.type || '';
  if (type === 'backup') return 'backup/upload';
  return req.params.folder || req.query.folder || '';
}

/**
 * Receive uploaded files onto an app's volume.
 *
 * The bytes go from the request straight into a container that writes them, so
 * they never touch the node's own filesystem. That is the whole reason this
 * moved: a write commits the moment it opens - it creates or truncates whatever
 * the name pointed at - so checking a path first and writing to it afterwards
 * cannot be made safe, and node has no way to say "open this only if it is
 * inside that directory". The container has nothing else mounted, so the
 * question does not arise.
 *
 * Each file is published atomically on its own, so one that fails leaves the
 * others alone and leaves nothing half-written at its destination.
 *
 * The request holds ONE operation slot however many files it carries, and the
 * files are handled one at a time inside it. A slot per file would refuse the
 * second one; a slot per file with no serialisation would put an unbounded
 * number of containers on the node for a single request.
 *
 * The response is a stream of progress figures, then each file's name as it
 * lands, and its shape is unchanged - a client reads bytes received against
 * bytes expected while the upload runs. A failure is written into it as the
 * standard error envelope, because by then the status line has long gone.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function uploadAppsFiles(req, res) {
  const folder = uploadFolder(req);
  let volume = null;
  let releaseSlot = null;

  const fail = (error) => {
    log.error(error);
    const envelope = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
    // Before anything has been written the status line is still ours, so a
    // refusal can be answered as one. Once the body has started it cannot, and
    // the envelope goes into the stream where a client parses it out.
    if (res.headersSent) {
      try {
        res.write(serviceHelper.ensureString(envelope));
        res.end();
      } catch (writeError) {
        log.error(writeError);
      }
      return;
    }
    respondError(res, error);
  };

  try {
    volume = await openVolume(req);
    // Resolved once, before anything is received, so a folder that resolves
    // outside the volume is refused while the caller can still be told.
    const target = await volume.resolve(folder, { allowRoot: true });

    // One slot for the request. Taken before the first byte is read, so a
    // caller with no slot is refused with a 503 and a Retry-After rather than
    // after uploading a gigabyte.
    releaseSlot = executor.acquireSlot(volume.identifier);

    // Created if it is not there. The restore flow uploads into backup/upload
    // on volumes that have never held a restore, so an upload has always
    // brought its own destination into existence.
    const present = await volume.isDirectory(target).catch(() => null);
    if (present === false) {
      throw new Error('Upload destination is not a folder');
    }
    if (present === null) {
      await executor.run(volume, ['mkdir', '-p', target], { slotHeld: true });
    }
  } catch (error) {
    if (releaseSlot) releaseSlot();
    fail(error);
    return;
  }

  // The most that may be written, from the volume itself rather than a figure
  // chosen here. flux-op enforces the same number as the bytes arrive, so an
  // upload that would fill the volume is refused at the limit instead of
  // filling it and being refused afterwards.
  const ceiling = Math.floor(volume.availableBytes / SPACE_HEADROOM);

  // Files are handled strictly in turn. A multipart body delivers its parts in
  // order anyway; this makes the operations follow them, so a request never has
  // two containers of its own running at once.
  let queue = Promise.resolve();
  let failure = null;
  // The stream currently being received, so a request that fails or goes away
  // can settle the operation waiting on it rather than leaving a container
  // holding an input nothing will ever close.
  let receiving = null;

  const receiveOne = async (file, incoming) => {
    if (failure) {
      // Drained rather than left: formidable is writing into it, and a stream
      // nobody reads holds the request open behind a file that is not going to
      // be stored.
      incoming.resume();
      return;
    }
    receiving = incoming;
    try {
      const name = validateFilename(uploadNames.get(file));
      const destination = await volume.resolve(path.posix.join(folder, name));
      const staging = volume.staging();

      await executor.run(volume, [], {
        input: incoming,
        publish: { staging, destination },
        maxBytes: ceiling,
        slotHeld: true,
        status: 'Uploading...',
      });

      res.write(serviceHelper.ensureString(name));
      if (res.flush) res.flush();
    } catch (error) {
      failure = error;
      incoming.resume();
    } finally {
      receiving = null;
    }
  };

  const form = formidable({
    multiples: true,
    hashAlgorithm: false,
    // No parser limit. The container is the only ceiling, and it is the only
    // one that can be exact: it refuses AS the bytes arrive, where a parser
    // that gives up mid-request leaves the caller a broken connection instead
    // of a reason. What may be written is capped either way.
    maxFileSize: Infinity,
    fileWriteStreamHandler: (file) => {
      const incoming = new PassThrough();
      // Nothing reads this until its turn comes, so formidable is held at the
      // buffer's own high-water mark rather than racing ahead of a container
      // that does not exist yet.
      queue = queue.then(() => receiveOne(file, incoming));
      return incoming;
    },
  });

  // An explicit filename parameter wins over the form field name, which is what
  // the restore flow relies on to name the archive it uploads. Read here rather
  // than from the file object because formidable does not put the field name on
  // one - fileBegin is the only place it is available, and it fires immediately
  // before the write stream is asked for.
  const requestedFilename = req.params.filename || req.query.filename || '';
  const uploadNames = new WeakMap();

  // Reached from three directions - the body ended, the parser gave up, or the
  // client went away - and it has to run exactly once from whichever arrives
  // first. Missing one of them leaks the app's operation slot for as long as
  // FluxOS runs, which takes that app's whole file browser with it.
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    // After the queue, not before: the last container is still running long
    // after the parser has finished with the request.
    queue
      .then(() => {
        releaseSlot();
        if (failure) fail(failure);
        else res.end();
      })
      .catch((error) => {
        releaseSlot();
        fail(error);
      });
  };

  const abandon = (error) => {
    failure = failure || error;
    // Settles whatever operation is waiting on this stream. Without it the
    // container sits on an input that will never close, until the stall check
    // notices minutes later.
    if (receiving) receiving.destroy(error);
    finish();
  };

  form
    .on('fileBegin', (name, file) => {
      uploadNames.set(file, requestedFilename || name);
    })
    .on('progress', (bytesReceived, bytesExpected) => {
      try {
        res.write(serviceHelper.ensureString([bytesReceived, bytesExpected]));
        if (res.flush) res.flush();
      } catch (error) {
        log.error(error);
      }
    })
    .on('error', (error) => abandon(error))
    .on('end', finish);

  req.on('aborted', () => abandon(new Error('The upload did not complete')));

  form.parse(req);
}

module.exports = {
  createAppsFolder,
  renameAppsObject,
  removeAppsObject,
  uploadAppsFiles,
  moveAppsObject,
  copyAppsObject,
  compressAppsObject,
  extractAppsObject,
  downloadAppsFolder,
  downloadAppsFile,
};
