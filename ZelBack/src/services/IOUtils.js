const df = require('node-df');
const fs = require('fs').promises;
const util = require('util');
const log = require('../lib/log');
const axios = require('axios');
const path = require('path');
const { formidable } = require('formidable');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const exec = util.promisify(require('child_process').exec);

/**
 * Converts file sizes to a specified unit or the most appropriate unit based on the total size.
 * @param {number | Array<{ file_size: number }>} sizes - Total size in bytes or an array of file sizes.
 * @param {string} [targetUnit='auto'] - The desired unit for the result. Use 'auto' to determine the best unit automatically.
 * @param {number} [decimal=2] - The number of decimal places to round the result.
 * @param {boolean} [returnNumber=false] - If true, returns the numeric value only without formatting.
 * @returns {string | number | false} - The formatted result (string), numeric result, or false if input is invalid.
 */
function convertFileSize(sizes, targetUnit = 'auto', decimal = 2, returnNumber = false) {
  const multiplierMap = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };

  const getSizeWithMultiplier = (size, multiplier) => size / multiplierMap[multiplier.toUpperCase()];
  const formatResult = (result, unit) => `${result.toFixed(decimal)} ${unit}`;
  let totalSizeInBytes;

  if (Array.isArray(sizes)) {
    totalSizeInBytes = sizes.reduce((total, fileInfo) => total + fileInfo.file_size, 0);
  } else if (typeof sizes === 'number') {
    totalSizeInBytes = sizes;
  } else {
    return false;
  }
  if (targetUnit === 'auto') {
    let bestMatchUnit;
    let bestMatchResult = totalSizeInBytes;

    Object.keys(multiplierMap).forEach((unit) => {
      const result = getSizeWithMultiplier(totalSizeInBytes, unit);
      if (result >= 1 && result < bestMatchResult) {
        bestMatchResult = result;
        bestMatchUnit = unit;
      }
    });
    if (returnNumber) {
      return bestMatchResult;
    // eslint-disable-next-line no-else-return
    } else {
      return formatResult(bestMatchResult, bestMatchUnit);
    }
  // eslint-disable-next-line no-else-return
  } else {
    const result = getSizeWithMultiplier(totalSizeInBytes, targetUnit);
    if (returnNumber) {
      return result;
    // eslint-disable-next-line no-else-return
    } else {
      return formatResult(result, targetUnit);
    }
  }
}

/**
 * Get the total size of a folder, including its subdirectories and files.
 * @param {string} folderPath - The path to the folder.
 * @returns {string|boolean} - The total size of the folder formatted with the specified multiplier and decimal places, or false if an error occurs.
 */
async function getFolderSize(folderPath) {
  try {
    let totalSize = 0;
    const calculateSize = async (filePath) => {
      const stats = await fs.stat(filePath);

      if (stats.isFile()) {
        return stats.size;
      // eslint-disable-next-line no-else-return
      } else if (stats.isDirectory()) {
        const files = await fs.readdir(filePath);
        const sizes = await Promise.all(files.map((file) => calculateSize(path.join(filePath, file))));
        return sizes.reduce((acc, size) => acc + size, 0);
      }

      return 0; // Unknown file type
    };

    totalSize = await calculateSize(folderPath);
    return totalSize;
  } catch (err) {
    console.error(`Error getting folder size: ${err}`);
    return false;
  }
}

/**
 * Retrieves the size of the file at the specified path and formats it with an optional multiplier and decimal places.
 *
 * @param {string} filePath - The path of the file for which the size will be retrieved.
 * @returns {string|boolean} - The formatted file size as a string if successful, false on failure.
 */
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  } catch (err) {
    console.error(`Error getting file size: ${err}`);
    return false;
  }
}

/**
 * Fetches the size of a remote file without downloading it.
 *
 * @param {string} fileurl - The URL of the remote file.
 * @param {number} multiplier - The multiplier for converting the file size (e.g., 1024 for KB, 1048576 for MB).
 * @param {number} decimal - The number of decimal places to round the file size.
 * @returns {string|boolean} - The rounded file size as a string with specified decimal places, or false on failure.
 */
async function getRemoteFileSize(fileurl, multiplier, decimal, number = false) {
  try {
    const head = await axios.head(fileurl);
    const contentLengthHeader = head.headers['content-length'] || head.headers['Content-Length'];
    const fileSizeInBytes = parseInt(contentLengthHeader, 10);
    if (!Number.isFinite(fileSizeInBytes)) {
      throw new Error('Error fetching file size');
    }
    const fileSize = convertFileSize(fileSizeInBytes, multiplier, decimal, number);
    return fileSize;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Get volume information for a specific application component.
 * @param {string} appname - Name of the application.
 * @param {string} component - Name of the component.
 * @param {string} multiplier - Unit multiplier for displaying sizes (B, KB, MB, GB).
 * @param {number} decimal - Number of decimal places for precision.
 * @param {string} fields - Optional comma-separated list of fields to include in the response. Possible fields: 'mount', 'size', 'used', 'available', 'capacity', 'filesystem'.
 * @param {string|false} pathfilter - Optional path to filter results. If provided, only entries matching the specified path will be included. Pass `false` to use the default component and appname-based filtering.
 * @returns {Array|boolean} - Array of objects containing volume information for the specified component, or false if no matching mount is found.
 */
async function getVolumeInfo(appname, component, multiplier, decimal, fields, pathfilter = false) {
  try {
    const options = {
      prefixMultiplier: multiplier,
      isDisplayPrefixMultiplier: false,
      precision: +decimal,
    };
    const dfAsync = util.promisify(df);
    const dfData = await dfAsync(options);
    let regex;
    if (pathfilter) {
      regex = new RegExp(`${pathfilter}`);
    } else {
      regex = new RegExp(`flux${component}_${appname}$`);
    }
    const allowedFields = fields ? fields.split(',') : null;
    const adjustValue = (value) => (multiplier.toLowerCase() === 'b' ? value * 1024 : value);
    const dfSorted = dfData
      .filter((entry) => {
        const testResult = regex.test(entry.mount);
        return testResult;
      })
      .map((entry) => {
        const filteredEntry = allowedFields
          ? Object.fromEntries(Object.entries(entry).filter(([key]) => allowedFields.includes(key)))
          : entry;

        if (allowedFields && allowedFields.some((field) => ['size', 'available', 'used'].includes(field))) {
          ['size', 'available', 'used'].forEach((property) => {
            if (filteredEntry[property] !== undefined) {
              filteredEntry[property] = adjustValue(filteredEntry[property]);
            }
          });
        }
        return filteredEntry;
      })
      .filter((entry) => {
        if (allowedFields) {
          return Object.keys(entry).length > 0;
        // eslint-disable-next-line no-else-return
        } else {
          return true;
        }
      });
    return dfSorted.length > 0 ? dfSorted : false;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Get a list of file information for the specified path.
 * @param {string} targetpath - The path of the directory.
 * @param {string} multiplier - Unit to convert file sizes (B, KB, MB, GB).
 * @param {number} decimal - Number of decimal places for file sizes.
 * @returns {Array} An array of file information or returns an empty array if there's an issue reading the directory or obtaining file information.
 */
async function getPathFileList(targetpath, multiplier, decimal, filterKeywords = [], number = false) {
  try {
    const files = await fs.readdir(targetpath);
    const filesArray = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const filePath = `${targetpath}/${file}`;
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(filePath);
      // eslint-disable-next-line no-await-in-loop
      const passesFilter = filterKeywords.length === 0 || filterKeywords.some((keyword) => {
        const includes = file.includes(keyword);
        return includes;
      });
      if (passesFilter) {
        const fileSize = convertFileSize(stats.size, multiplier, decimal, number);
        const fileInfo = {
          name: file,
          create: stats.birthtimeMs.toFixed(0),
          size: fileSize,
        };
        filesArray.push(fileInfo);
      }
    }
    log.info(filesArray);
    return filesArray;
  } catch (err) {
    log.error('Error reading directory:', err);
    return [];
  }
}

/**
 * Remove a file at the specified filePath.
 * @param {string} filePath - The path to the file to be removed.
 * @returns {boolean} - True if the file is removed successfully, false otherwise.
 */
async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Check if a file exists at the specified filePath.
 * @param {string} filePath - The path to the file.
 * @returns {boolean} - True if the file exists, false otherwise.
 */
async function checkFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Downloads a file from a remote URL and saves it locally.
 *
 * @param {string} url - The URL of the file to download.
 * @param {string} localpath - The local path to save the downloaded file.
 * @param {string} component - The component name for identification.
 * @param {boolean} rename - Flag indicating whether to rename the downloaded file.
 * @returns {boolean} - True if the file is downloaded and saved successfully, false on failure.
 */
async function downloadFileFromUrl(url, localpath, component, rename = false) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const fileData = Buffer.from(response.data, 'binary');
    if (rename === true) {
      await fs.writeFile(`${localpath}/backup_${component}.tar.gz`, fileData);
    } else {
      const fileNameArray = url.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      await fs.writeFile(`${localpath}/${fileName}`, fileData);
    }
    return true;
  } catch (err) {
    log.error(err);
    return false;
  }
}

/**
 * Extracts the contents of a tarball (tar.gz) file to the specified extraction path.
 *
 * @param {string} extractPath - The path where the contents of the tarball will be extracted.
 * @param {string} tarFilePath - The path of the tarball (tar.gz) file to be extracted.
 * @returns {boolean} - True if the extraction is successful, false on failure.
 */
async function untarFile(extractPath, tarFilePath) {
  try {
    await fs.mkdir(extractPath, { recursive: true });
    const unpackCmd = `sudo tar -xvzf ${tarFilePath} -C ${extractPath}`;
    await exec(unpackCmd, { maxBuffer: 1024 * 1024 * 10 });
    return { status: true };
  } catch (error) {
    const stringstderr = error.stderr.replace(/\n/g, ' ');
    const stringstdout = error.stdout.replace(/\n/g, ' ');
    log.error('Error during extraction:', error.stderr || error.stdout);
    return { status: false, error: stringstderr || stringstdout };
  }
}

/**
 * Creates a tarball (tar.gz) archive from the specified source directory.
 *
 * @param {string} sourceDirectory - The path of the directory to be archived.
 * @param {string} outputFileName - The name of the tarball archive file to be created.
 * @returns {boolean} - True if the tarball is successfully created, false on failure.
 */
async function createTarGz(sourceDirectory, outputFileName) {
  try {
    const outputDirectory = outputFileName.substring(0, outputFileName.lastIndexOf('/'));
    await fs.mkdir(outputDirectory, { recursive: true });
    const packCmd = `sudo tar -czvf ${outputFileName} -C ${sourceDirectory} .`;
    await exec(packCmd, { maxBuffer: 1024 * 1024 * 10 });
    return { status: true };
  } catch (error) {
    const stringstderr = error.stderr.replace(/\n/g, ' ');
    const stringstdout = error.stdout.replace(/\n/g, ' ');
    log.error('Error creating tarball:', error.stderr || error.stdout);
    return { status: false, error: stringstderr || stringstdout };
  }
}

/**
 * Removes the specified directory and its contents or only the contents.
 *
 * @param {string} rpath - The path of the directory to be removed.
 * @param {boolean} directory - Flag indicating whether to remove only the directory contents (true) or the entire directory (false).
 * @returns {boolean} - True if the directory or its contents are removed successfully, false on failure.
 */
async function removeDirectory(rpath, directory = false) {
  try {
    let execFinal;
    if (directory === false) {
      execFinal = `sudo rm -rf ${rpath}`;
    } else {
      execFinal = `sudo rm -rf ${rpath}/*`;
    }
    await exec(execFinal, { maxBuffer: 1024 * 1024 * 10 });
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To upload a specified folder to FluxShare. Checks that there is enough space available. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function fileUpload(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    if (!appname) {
      throw new Error('appname parameter is mandatory.');
    }
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      throw new Error('Unauthorized. Access denied.');
    }
    let { fullpath } = req.params;
    fullpath = fullpath || req.query.fullpath;

    let { filename } = req.params;
    filename = filename || req.query.filename || '';

    if (!fullpath) {
      throw new Error('fullpath parameter is mandatory');
    }

    const options = {
      multiples: true,
      uploadDir: `${fullpath}/`,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5gb
      hashAlgorithm: false,
      keepExtensions: true,
      // eslint-disable-next-line no-unused-vars
      filename: (name, ext, part, form) => {
        const { originalFilename } = part;
        return originalFilename;
      },
    };

    // const spaceAvailableForFluxShare = await getSpaceAvailableForFluxShare();
    // let spaceUsedByFluxShare = getFluxShareSize();
    // spaceUsedByFluxShare = Number(spaceUsedByFluxShare.toFixed(6));
    // const available = spaceAvailableForFluxShare - spaceUsedByFluxShare;
    // if (available <= 0) {
    //  throw new Error('FluxShare Storage is full');
    // }

    // eslint-disable-next-line no-bitwise
    // await fs.promises.access(uploadDir, fs.constants.F_OK | fs.constants.W_OK); // check folder exists and write ability
    await fs.mkdir(fullpath, { recursive: true });
    const form = formidable(options);

    form
      // eslint-disable-next-line no-unused-vars
      .on('fileBegin', (name, file) => {
        if (!filename) {
          // eslint-disable-next-line no-param-reassign
          file.filepath = `${fullpath}/${name}`;
        } else {
          // eslint-disable-next-line no-param-reassign
          file.filepath = `${fullpath}/${filename}`;
        }
      })
      .on('progress', (bytesReceived, bytesExpected) => {
        try {
          res.write(serviceHelper.ensureString([bytesReceived, bytesExpected]));
        } catch (error) {
          log.error(error);
        }
      })
      // eslint-disable-next-line no-unused-vars
      .on('field', (name, field) => {

      })
      // eslint-disable-next-line no-unused-vars
      .on('file', (name, file) => {
        try {
          res.write(serviceHelper.ensureString(name));
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

    form.parse(req);
  } catch (error) {
    log.error(error);
    if (res) {
      try {
        res.connection.destroy();
      } catch (e) {
        log.error(e);
      }
    }
  }
}

module.exports = {
  getVolumeInfo,
  getPathFileList,
  getRemoteFileSize,
  getFileSize,
  checkFileExists,
  removeFile,
  convertFileSize,
  downloadFileFromUrl,
  untarFile,
  createTarGz,
  removeDirectory,
  getFolderSize,
  fileUpload,
};
