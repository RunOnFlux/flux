// File System Manager - Manages filesystem operations for FluxOS applications
const archiver = require('archiver');
const { PassThrough } = require('stream');
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');
const IOUtils = require('../IOUtils');
const fs = require('fs').promises;
const log = require('../../lib/log');
const { sanitizePath, verifyRealPath, verifyRealPathOfExistingPath } = require('../utils/pathSecurity');

/**
 * To create a folder in app's volume. Only accessible by app owners and above.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function createAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        // Use appid level to access appdata and all other mount points
        // Sanitize folder path to prevent directory traversal attacks
        filepath = sanitizePath(folder, appVolumePath[0].mount);
        // Verify resolved path stays within the allowed base directory
        await verifyRealPathOfExistingPath(filepath, appVolumePath[0].mount);
      } else {
        throw new Error('Application volume not found');
      }
      const mkdirResult = await serviceHelper.runCommand('mkdir', { runAsRoot: true, params: [filepath] });
      if (mkdirResult.error) {
        throw mkdirResult.error;
      }
      const resultsResponse = messageHelper.createSuccessMessage('Folder Created');
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To rename a file or folder. Oldpath is relative path to default fluxshare directory; newname is just a new name of folder/file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function renameAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { oldpath } = req.params;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      oldpath = oldpath || req.query.oldpath;
      if (!oldpath) {
        throw new Error('No file nor folder to rename specified');
      }
      let { newname } = req.params;
      newname = newname || req.query.newname;
      if (!newname) {
        throw new Error('No new name specified');
      }
      if (newname.includes('/')) {
        throw new Error('New name is invalid');
      }
      // stop sharing of ALL files that start with the path
      const fileURI = encodeURIComponent(oldpath);
      let oldfullpath;
      let newfullpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        // Use appid level to access appdata and all other mount points
        // Sanitize paths to prevent directory traversal attacks
        oldfullpath = sanitizePath(oldpath, appVolumePath[0].mount);
        newfullpath = sanitizePath(newname, appVolumePath[0].mount);
      } else {
        throw new Error('Application volume not found');
      }
      const fileURIArray = fileURI.split('%2F');
      fileURIArray.pop();
      if (fileURIArray.length > 0) {
        const renamingFolder = fileURIArray.join('/');
        // Sanitize the combined path as well
        newfullpath = sanitizePath(`${renamingFolder}/${newname}`, appVolumePath[0].mount);
      }
      // Verify resolved paths stay within the allowed base directory
      await verifyRealPath(oldfullpath, appVolumePath[0].mount);
      await verifyRealPathOfExistingPath(newfullpath, appVolumePath[0].mount);
      const mvResult = await serviceHelper.runCommand('mv', { runAsRoot: true, params: ['-T', oldfullpath, newfullpath] });
      if (mvResult.error) {
        throw mvResult.error;
      }
      const response = messageHelper.createSuccessMessage('Rename successful');
      res.json(response);
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
 * To remove a specified shared file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function removeAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { object } = req.params;
      object = object || req.query.object;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!component) {
        throw new Error('component parameter is mandatory');
      }
      if (!object) {
        throw new Error('No object specified');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        // Use appid level to access appdata and all other mount points
        // Sanitize object path to prevent directory traversal attacks
        filepath = sanitizePath(object, appVolumePath[0].mount);
      } else {
        throw new Error('Application volume not found');
      }
      // Allow removing symlinks directly (rm removes the link itself, not the target).
      // For non-symlink targets (or symlinks in parent components), enforce real path containment.
      let isSymbolicLink = false;
      try {
        const stats = await fs.lstat(filepath);
        isSymbolicLink = stats.isSymbolicLink();
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      if (!isSymbolicLink) {
        // Verify resolved path stays within the allowed base directory
        await verifyRealPathOfExistingPath(filepath, appVolumePath[0].mount);
      }
      const rmResult = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-rf', filepath] });
      if (rmResult.error) {
        throw rmResult.error;
      }
      const response = messageHelper.createSuccessMessage('File Removed');
      res.json(response);
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
      res.download(filepath, fileName);
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

module.exports = {
  createAppsFolder,
  renameAppsObject,
  removeAppsObject,
  downloadAppsFolder,
  downloadAppsFile,
};
