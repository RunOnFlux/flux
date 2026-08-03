// File System Manager - Manages filesystem operations for FluxOS applications
//
// Every mutating endpoint here runs its work in a throwaway container with only
// the target app's volume mounted (see volumeExecutor), and reaches that volume
// through a VolumeSession (see volumeSession) rather than by building paths of
// its own. A handler that skips a check does not produce an unsafe endpoint - it
// produces code that does not run.
//
// The two download endpoints below still stream from the host. They are reads
// rather than writes and do not map onto "run a command and collect an exit
// code"; see future/FLUXOS_FILE_DOWNLOADS_EXECUTOR_MOVE.md in fluxModels.
const archiver = require('archiver');
const { PassThrough } = require('stream');
const path = require('path');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const IOUtils = require('../IOUtils');
const log = require('../../lib/log');
const { sanitizePath, verifyRealPath } = require('../utils/pathSecurity');
const { openVolume, SPACE_HEADROOM } = require('./volumeSession');
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
    res.status(503).json(errorResponse);
    return;
  }
  res.json(errorResponse);
}

function respondSuccess(res, message) {
  res.json(messageHelper.createSuccessMessage(message));
}

/** A required parameter, from either the path or the query string. */
function requiredParam(req, name) {
  const value = req.params[name] || req.query[name];
  if (!value) throw new Error(`${name} parameter is mandatory`);
  return value;
}

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

    await executor.run(volume, ['mkdir', '-p', target]);
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
    const { source, destination: target } = await volume.pair(oldpath, destination, { overwrite: true });

    await executor.run(volume, [], { publish: { staging: source, destination: target } });
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
async function removeAppsObject(req, res) {
  try {
    const volume = await openVolume(req);
    const object = requiredParam(req, 'object');
    const target = await volume.resolve(object, { mustExist: true });

    await executor.run(volume, ['rm', '-rf', target]);
    respondSuccess(res, 'File Removed');
  } catch (error) {
    respondError(res, error);
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
      const chmodResult = await serviceHelper.runCommand('chmod', { runAsRoot: true, params: ['777', filepath] });
      if (chmodResult.error) {
        throw chmodResult.error;
      }
      // beautify name
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      res.download(filepath, fileName, { dotfiles: 'allow' });
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
  const overwrite = (req.params.overwrite || req.query.overwrite) === 'true';
  return volume.pair(source, destination, { overwrite });
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
 * @param {{kind: string, status: string, owner: string|null}} meta
 * @param {function(object): Promise<void>} work - receives the executor options
 *   carrying progress and cancellation, and runs the operation
 */
function startOperation(res, volume, meta, work) {
  // Before the job exists, so a caller with no slot gets 503 + Retry-After now
  // rather than an operation that is only ever going to report that it never
  // started.
  executor.assertCapacity(volume);

  const handle = jobRegistry.start({
    kind: meta.kind,
    owner: meta.owner,
    detail: () => ({ app: volume.identifier, operation: meta.kind }),
  });

  // Deliberately not awaited: the response goes back now and the work reports
  // itself into the registry.
  //
  // Wrapped in a resolved promise so a SYNCHRONOUS throw from work() settles the
  // job too. Without it such a throw escapes past these handlers, and the job it
  // left behind stays Running - which never expires, because only terminal jobs
  // are retained on a clock.
  Promise.resolve()
    .then(() => work({
      status: meta.status,
      onProgress: (message) => jobRegistry.progress(handle.jobId, message),
      isCanceled: () => jobRegistry.isCanceled(handle.jobId),
    }))
    .then(() => {
      if (jobRegistry.isCanceled(handle.jobId)) jobRegistry.cancelled(handle.jobId);
      else jobRegistry.succeed(handle.jobId);
    })
    .catch((error) => {
      if (jobRegistry.isCanceled(handle.jobId)) jobRegistry.cancelled(handle.jobId);
      else jobRegistry.fail(handle.jobId, error);
    });

  return operationsController.accepted(res, handle);
}

/**
 * Which archive tool handles this name, or null if we do not handle it.
 *
 * @param {string} name
 * @returns {'zip'|'tar'|null}
 */
function archiveFormat(name) {
  if (name.endsWith('.zip')) return 'zip';
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tar';
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
    const { source, destination } = await resolveOperands(req, volume);

    // No command: the source IS the result, so publishing it is the whole
    // operation. Going through publish rather than a bare `mv` is what handles
    // an existing destination - rename(2) refuses a non-empty directory target
    // and cannot replace a file with a directory at all.
    return startOperation(res, volume, { kind: 'fileoperation.move', status: 'Moving...', owner: volume.owner }, (progress) => executor.run(volume, [], { ...progress, publish: { staging: source, destination } }));
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
    const { source, destination } = await resolveOperands(req, volume);

    volume.requireSpace(await volume.measure(source));

    const staging = volume.staging();
    // -a preserves ownership, timestamps and symlinks and implies -r; -T stops
    // cp copying INTO the staging directory instead of becoming it.
    return startOperation(res, volume, { kind: 'fileoperation.copy', status: 'Copying...', owner: volume.owner }, (progress) => executor.run(volume, ['cp', '-a', '-T', source, staging], { ...progress, publish: { staging, destination } }));
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
    const { source, destination } = await resolveOperands(req, volume);

    const format = archiveFormat(destination.relative);
    if (!format) {
      throw new Error('Destination must end in .zip, .tar.gz or .tgz');
    }

    // The archive cannot be larger than what goes into it by enough to matter,
    // and compressed output is normally far smaller - so the source size is a
    // safe over-estimate rather than a guess.
    volume.requireSpace(await volume.measure(source));

    const staging = volume.staging();
    const argv = format === 'zip'
      // -r recurses, -q keeps the per-file listing out of the container's output
      ? ['zip', '-r', '-q', staging, source]
      : ['tar', '-czf', staging, '-C', source, '.'];

    return startOperation(res, volume, { kind: 'fileoperation.compress', status: 'Compressing...', owner: volume.owner }, (progress) => executor.run(volume, argv, { ...progress, publish: { staging, destination } }));
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
    const { source, destination } = await resolveOperands(req, volume);

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

    return startOperation(res, volume, { kind: 'fileoperation.extract', status: 'Extracting...', owner: volume.owner }, (progress) => executor.run(volume, argv, {
      ...progress,
      publish: { staging, destination },
      // tar -C and unzip -d both need the directory to exist already.
      mkdirStaging: true,
      // The capacity check the other operations make up front cannot be made
      // here: an archive's declared uncompressed size is written by whoever
      // built it, so a bomb simply understates itself. The ceiling is applied
      // to what actually lands instead, and it is the free space on the volume,
      // so an extraction can fill what is available and no more.
      maxBytes: volume.availableBytes / SPACE_HEADROOM,
      // An archive that carries a link and then writes through it reaches
      // wherever the link points. Inside the container that is nowhere useful,
      // but the result is published onto a volume that the download endpoints
      // still read from the host and that syncthing replicates to other nodes.
      noLinks: true,
    }));
  } catch (error) {
    respondError(res, error);
  }
}

module.exports = {
  createAppsFolder,
  renameAppsObject,
  removeAppsObject,
  moveAppsObject,
  copyAppsObject,
  compressAppsObject,
  extractAppsObject,
  downloadAppsFolder,
  downloadAppsFile,
};
