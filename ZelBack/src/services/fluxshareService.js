const config = require('config');
const crypto = require('crypto');
const path = require('path');
const df = require('node-df');
const fs = require('fs');
const formidable = require('formidable');
const archiver = require('archiver');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');
const verificationHelper = require('./verificationHelper');
const generalService = require('./generalService');
const log = require('../lib/log');

/**
 * Delete a specific FluxShare file.
 * @param {string} file Name of file to be deleted.
 * @returns {boolean} Returns true unless an error is caught.
 */
async function fluxShareDatabaseFileDelete(file) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = { name: file };
    const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
    await dbHelper.findOneAndDeleteInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * Delete all FluxShare files that start with a specified path.
 * @param {string} pathstart Path of files to be deleted.
 * @returns {boolean} Returns true unless an error is caught.
 */
async function fluxShareDatabaseFileDeleteMultiple(pathstart) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = { name: new RegExp(`^${pathstart}`) }; // has to start with this path
    await dbHelper.removeDocumentsFromCollection(databaseFluxShare, sharedCollection, queryFluxShare);
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To add all files within a directory into an array of file paths/names.
 * @param {string} dirPath Directory path.
 * @param {string[]} arrayOfFiles Existing array of file paths/names or empty array.
 * @returns {string[]} Updated array of file paths/names.
 */
function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  // eslint-disable-next-line no-param-reassign
  arrayOfFiles = arrayOfFiles || [];

  files.forEach((file) => {
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(`${dirPath}/${file}`).isDirectory();
    } catch (error) {
      log.warn(error);
    }
    if (isDirectory) {
      // eslint-disable-next-line no-param-reassign
      arrayOfFiles = getAllFiles(`${dirPath}/${file}`, arrayOfFiles);
    } else {
      arrayOfFiles.push(`${dirPath}/${file}`);
    }
  });
  return arrayOfFiles;
}

/**
 * To get total size (GB) for all files within a directory.
 * @returns {number} Total file size (GB).
 */
function getFluxShareSize() {
  const dirpath = path.join(__dirname, '../../../');
  const directoryPath = `${dirpath}ZelApps/ZelShare`;

  const arrayOfFiles = getAllFiles(directoryPath);

  let totalSize = 0;

  arrayOfFiles.forEach((filePath) => {
    try {
      totalSize += fs.statSync(filePath).size;
    } catch (error) {
      log.warn(error);
    }
  });
  return (totalSize / 1e9); // in 'GB'
}

/**
 * To get total size (Bytes) for a specific folder.
 * @param {string} folder Directory path for folder.
 * @returns {number} Folder size (Bytes).
 */
function getFluxShareSpecificFolderSize(folder) {
  const arrayOfFiles = getAllFiles(folder);

  let totalSize = 0;

  arrayOfFiles.forEach((filePath) => {
    try {
      totalSize += fs.statSync(filePath).size;
    } catch (error) {
      log.warn(error);
    }
  });
  return (totalSize); // in 'B'
}

/**
 * To get a file from database or insert it into database if it doesn't already exist.
 * @param {string} file File name.
 * @returns {object} File detail (name and token).
 */
async function fluxShareDatabaseShareFile(file) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = { name: file };
    const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
    const result = await dbHelper.findOneInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
    if (result) {
      return result;
    }
    const string = file + new Date().getTime().toString() + Math.floor((Math.random() * 999999999999999)).toString();

    const fileDetail = {
      name: file,
      token: crypto.createHash('sha256').update(string).digest('hex'),
    };
    await dbHelper.insertOneToDatabase(databaseFluxShare, sharedCollection, fileDetail);
    return fileDetail;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To search for shared files.
 * @returns {object[]} Array of shared files.
 */
async function fluxShareSharedFiles() {
  try {
    const dbopen = dbHelper.databaseConnection();
    const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
    const sharedCollection = config.database.fluxshare.collections.shared;
    const queryFluxShare = {};
    const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
    const results = await dbHelper.findInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
    return results;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To get shared files. Only accessible by admins.
 * @param {object} req Requet.
 * @param {object} res Response.
 */
async function fluxShareGetSharedFiles(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      const files = await fluxShareSharedFiles();
      const resultsResponse = messageHelper.createDataMessage(files);
      res.json(resultsResponse);
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
 * To unshare a file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareUnshareFile(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      file = encodeURIComponent(file);
      await fluxShareDatabaseFileDelete(file);
      const resultsResponse = messageHelper.createSuccessMessage('File sharing disabled');
      res.json(resultsResponse);
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
 * To share a file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareShareFile(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      file = encodeURIComponent(file);
      const fileDetails = await fluxShareDatabaseShareFile(file);
      const resultsResponse = messageHelper.createDataMessage(fileDetails);
      res.json(resultsResponse);
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
async function fluxShareDownloadFolder(req, res, authorized = false) {
  try {
    let auth = authorized;
    if (!auth) {
      auth = await verificationHelper.verifyPrivilege('admin', req);
    }

    if (auth) {
      let { folder } = req.params;
      folder = folder || req.query.folder;

      if (!folder) {
        const errorResponse = messageHelper.createErrorMessage('No folder specified');
        res.json(errorResponse);
        return;
      }

      const dirpath = path.join(__dirname, '../../../');
      const folderpath = `${dirpath}ZelApps/ZelShare/${folder}`;

      // beautify name
      const folderNameArray = folderpath.split('/');
      const folderName = folderNameArray[folderNameArray.length - 1];

      // const size = getFluxShareSpecificFolderSize(folderpath);

      // Tell the browser that this is a zip file.
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-disposition': `attachment; filename=${folderName}.zip`,
      });

      const zip = archiver('zip');

      // Send the file to the page output.
      zip.pipe(res);
      zip.glob('**/*', { cwd: folderpath });
      zip.finalize();
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
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
async function fluxShareDownloadFile(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;

      if (!file) {
        const errorResponse = messageHelper.createErrorMessage('No file specified');
        res.json(errorResponse);
        return;
      }

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;

      // beautify name
      const fileNameArray = file.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];

      res.download(filepath, fileName);
    } else {
      let { file } = req.params;
      file = file || req.query.file;
      let { token } = req.params;
      token = token || req.query.token;
      if (!file || !token) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }
      const fileURI = encodeURIComponent(file);
      const dbopen = dbHelper.databaseConnection();
      const databaseFluxShare = dbopen.db(config.database.fluxshare.database);
      const sharedCollection = config.database.fluxshare.collections.shared;
      const queryFluxShare = { name: fileURI, token };
      const projectionFluxShare = { projection: { _id: 0, name: 1, token: 1 } };
      const result = await dbHelper.findOneInDatabase(databaseFluxShare, sharedCollection, queryFluxShare, projectionFluxShare);
      if (!result) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }

      // check if file is file. If directory use zelshareDwonloadFolder
      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;
      const fileStats = await fs.promises.lstat(filepath);
      const isDirectory = fileStats.isDirectory();

      if (isDirectory) {
        const modifiedReq = req;
        modifiedReq.params.folder = req.params.file;
        modifiedReq.query.folder = req.query.file;
        fluxShareDownloadFolder(modifiedReq, res, true);
      } else {
        // beautify name
        const fileNameArray = filepath.split('/');
        const fileName = fileNameArray[fileNameArray.length - 1];

        res.download(filepath, fileName);
      }
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
 * To rename a file or folder. Oldpath is relative path to default fluxshare directory; newname is just a new name of folder/file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareRename(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { oldpath } = req.params;
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
      await fluxShareDatabaseFileDeleteMultiple(fileURI);

      const dirpath = path.join(__dirname, '../../../');
      const oldfullpath = `${dirpath}ZelApps/ZelShare/${oldpath}`;
      let newfullpath = `${dirpath}ZelApps/ZelShare/${newname}`;
      const fileURIArray = fileURI.split('%2F');
      fileURIArray.pop();
      if (fileURIArray.length > 0) {
        const renamingFolder = fileURIArray.join('/');
        newfullpath = `${dirpath}ZelApps/ZelShare/${renamingFolder}/${newname}`;
      }
      await fs.promises.rename(oldfullpath, newfullpath);

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
async function fluxShareRemoveFile(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      const fileURI = encodeURIComponent(file);
      if (!file) {
        throw new Error('No file specified');
      }
      // stop sharing

      await fluxShareDatabaseFileDelete(fileURI);

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;
      await fs.promises.unlink(filepath);

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
 * To remove a specified shared folder. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareRemoveFolder(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder;
      if (!folder) {
        throw new Error('No folder specified');
      }

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;
      await fs.promises.rmdir(filepath);

      const response = messageHelper.createSuccessMessage('Folder Removed');
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
 * To get a list of files with their details for all files within a shared folder. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareGetFolder(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;
      const options = {
        withFileTypes: false,
      };
      const files = await fs.promises.readdir(filepath, options);
      const filesWithDetails = [];
      let sharedFiles = await fluxShareSharedFiles().catch((error) => {
        log.error(error);
      });
      sharedFiles = sharedFiles || [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const fileStats = await fs.promises.lstat(`${filepath}/${file}`);
        let fileURI = encodeURIComponent(file);
        if (folder) {
          fileURI = encodeURIComponent(`${folder}/${file}`);
        }
        const fileShared = sharedFiles.find((sharedfile) => sharedfile.name === fileURI);
        let shareToken;
        let shareFile;
        if (fileShared) {
          shareToken = fileShared.token;
          shareFile = fileShared.name;
        }
        const isDirectory = fileStats.isDirectory();
        const isFile = fileStats.isFile();
        const isSymbolicLink = fileStats.isSymbolicLink();
        let fileFolderSize = fileStats.size;
        if (isDirectory) {
          fileFolderSize = getFluxShareSpecificFolderSize(`${filepath}/${file}`);
        }
        const detailedFile = {
          name: file,
          size: fileFolderSize, // bytes
          isDirectory,
          isFile,
          isSymbolicLink,
          createdAt: fileStats.birthtime,
          modifiedAt: fileStats.mtime,
          shareToken,
          shareFile,
        };
        filesWithDetails.push(detailedFile);
      }
      const resultsResponse = messageHelper.createDataMessage(filesWithDetails);
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
 * To create a folder. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareCreateFolder(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${folder}`;

      await fs.promises.mkdir(filepath);

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
 * To check if a file exists. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareFileExists(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;

      const dirpath = path.join(__dirname, '../../../');
      const filepath = `${dirpath}ZelApps/ZelShare/${file}`;
      let fileExists = true;
      try {
        await fs.promises.access(filepath, fs.constants.F_OK); // check file exists and write ability
      } catch (error) {
        fileExists = false;
      }
      const data = {
        fileExists,
      };
      const resultsResponse = messageHelper.createDataMessage(data);
      res.json(resultsResponse);
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
 * To check the quantity of space (GB) available for FluxShare. This is the space available after space already reserved for the FluxNode.
 * @returns {number} The quantity of space available (GB).
 */
async function getSpaceAvailableForFluxShare() {
  const dfAsync = util.promisify(df);
  // we want whole numbers in GB
  const options = {
    prefixMultiplier: 'GB',
    isDisplayPrefixMultiplier: false,
    precision: 0,
  };

  const dfres = await dfAsync(options);
  const okVolumes = [];
  dfres.forEach((volume) => {
    if (volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop') && !volume.mount.includes('boot')) {
      okVolumes.push(volume);
    } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
      okVolumes.push(volume);
    }
  });

  // now we know that most likely there is a space available. IF user does not have his own stuff on the node or space may be sharded accross hdds.
  let totalSpace = 0;
  okVolumes.forEach((volume) => {
    totalSpace += serviceHelper.ensureNumber(volume.size);
  });
  // space that is further reserved for flux os and that will be later substracted from available space. Max 30.
  const tier = await generalService.getNewNodeTier();
  const lockedSpaceOnNode = config.fluxSpecifics.hdd[tier];

  const extraSpaceOnNode = totalSpace - lockedSpaceOnNode > 0 ? totalSpace - lockedSpaceOnNode : 0; // shall always be above 0. Put precaution to place anyway
  // const extraSpaceOnNode = availableSpace - lockedSpaceOnNode > 0 ? availableSpace - lockedSpaceOnNode : 0;
  const spaceAvailableForFluxShare = 2 + extraSpaceOnNode;
  return spaceAvailableForFluxShare;
}

/**
 * To show FluxShare storage stats (GB available, GB used and GB total). Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareStorageStats(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized) {
      const spaceAvailableForFluxShare = await getSpaceAvailableForFluxShare();
      let spaceUsedByFluxShare = getFluxShareSize();
      spaceUsedByFluxShare = Number(spaceUsedByFluxShare.toFixed(6));
      const data = {
        available: spaceAvailableForFluxShare - spaceUsedByFluxShare,
        used: spaceUsedByFluxShare,
        total: spaceAvailableForFluxShare,
      };
      const resultsResponse = messageHelper.createDataMessage(data);
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
 * To upload a specified folder to FluxShare. Checks that there is enough space available. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fluxShareUpload(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (!authorized) {
      throw new Error('Unauthorized. Access denied.');
    }
    let { folder } = req.params;
    folder = folder || req.query.folder || '';
    if (folder) {
      folder += '/';
    }
    const dirpath = path.join(__dirname, '../../../');
    const uploadDir = `${dirpath}ZelApps/ZelShare/${folder}`;
    const options = {
      multiples: true,
      uploadDir,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5gb
      hash: true,
      keepExtensions: true,
    };
    const spaceAvailableForFluxShare = await getSpaceAvailableForFluxShare();
    let spaceUsedByFluxShare = getFluxShareSize();
    spaceUsedByFluxShare = Number(spaceUsedByFluxShare.toFixed(6));
    const available = spaceAvailableForFluxShare - spaceUsedByFluxShare;
    if (available <= 0) {
      throw new Error('FluxShare Storage is full');
    }
    // eslint-disable-next-line no-bitwise
    await fs.promises.access(uploadDir, fs.constants.F_OK | fs.constants.W_OK); // check folder exists and write ability
    const form = formidable(options);
    form.parse(req)
      .on('fileBegin', (name, file) => {
        try {
          res.write(serviceHelper.ensureString(file.name));
          const filepath = `${dirpath}ZelApps/ZelShare/${folder}${file.name}`;
          // eslint-disable-next-line no-param-reassign
          file.path = filepath;
        } catch (error) {
          log.error(error);
        }
      })
      .on('progress', (bytesReceived, bytesExpected) => {
        try {
          // console.log('PROGRESS');
          res.write(serviceHelper.ensureString([bytesReceived, bytesExpected]));
        } catch (error) {
          log.error(error);
        }
      })
      .on('field', (name, field) => {
        console.log('Field', name, field);
        // console.log(name);
        // console.log(field);
        // res.write(serviceHelper.ensureString(field));
      })
      .on('file', (name, file) => {
        try {
          // console.log('Uploaded file', name, file);
          res.write(serviceHelper.ensureString(file));
        } catch (error) {
          log.error(error);
        }
      })
      .on('aborted', () => {
        console.error('Request aborted by the user');
      })
      .on('error', (error) => {
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
      })
      .on('end', () => {
        try {
          res.end();
        } catch (error) {
          log.error(error);
        }
      });
  } catch (error) {
    log.error(error);
    if (res) {
      // res.set('Connection', 'close');
      try {
        res.connection.destroy();
      } catch (e) {
        log.error(e);
      }
    }
  }
}

module.exports = {
  fluxShareDownloadFile,
  fluxShareGetFolder,
  fluxShareCreateFolder,
  fluxShareUpload,
  fluxShareRemoveFile,
  fluxShareRemoveFolder,
  fluxShareFileExists,
  fluxShareStorageStats,
  fluxShareUnshareFile,
  fluxShareShareFile,
  fluxShareGetSharedFiles,
  fluxShareRename,
  fluxShareDownloadFolder,

  // exports for testing purposes
  fluxShareDatabaseFileDelete,
  fluxShareDatabaseFileDeleteMultiple,
  getAllFiles,
  getFluxShareSize,
  getFluxShareSpecificFolderSize,
  fluxShareDatabaseShareFile,
  fluxShareSharedFiles,
};
