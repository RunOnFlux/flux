const df = require('node-df');
const fs = require('fs').promises;
const util = require('util');
const log = require('../lib/log');
const axios = require('axios');
const tar = require('tar');
const nodecmd = require('node-cmd');

const cmdAsync = util.promisify(nodecmd.get);

/**
 * Convert file size from bytes to the specified unit.
 * @param {number} sizeInBytes - Size of the file in bytes.
 * @param {string} multiplier - Unit to convert to (B, KB, MB, GB).
 * @returns {number} - Converted file size.
 */
function convertFileSize(sizeInBytes, multiplier) {
  const multiplierMap = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  return sizeInBytes / multiplierMap[multiplier.toUpperCase()];
}

async function getFileSize(filePath, multiplier, decimal) {
  try {
    const stats = await fs.stat(filePath);
    const fileSizeInBytes = stats.size;
    const fileSize = convertFileSize(fileSizeInBytes, multiplier);
    const roundedFileSize = fileSize.toFixed(decimal);
    return roundedFileSize;
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
async function getRemoteFileSize(fileurl, multiplier, decimal) {
  try {
    const head = await axios.head(fileurl);
    const contentLengthHeader = head.headers['content-length'] || head.headers['Content-Length'];
    const fileSizeInBytes = parseInt(contentLengthHeader, 10);
    if (!Number.isFinite(fileSizeInBytes)) {
      throw new Error('Error fetching file size');
    }
    const fileSize = convertFileSize(fileSizeInBytes, multiplier);
    const roundedFileSize = fileSize.toFixed(decimal);
    return roundedFileSize;
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
 * @param {string} fields - Optional comma-separated list of fields to include in the response.
 * @param {string|false} path - Optional path to filter results. If provided, only entries matching the specified path will be included. Pass `false` to use the default component and appname-based filtering.
 * @returns {Array|boolean} - Array of objects containing volume information for the specified component, or false if no matching mount is found.
 */
async function getVolumeInfo(appname, component, multiplier, decimal, fields, path = false) {
  try {
    const options = {
      prefixMultiplier: multiplier,
      isDisplayPrefixMultiplier: false,
      precision: +decimal,
    };
    const dfAsync = util.promisify(df);
    const dfData = await dfAsync(options);
    let regex;
    if (path) {
      regex = new RegExp(`${path}`);
    } else {
      regex = new RegExp(`${component}_${appname}$`);
    }
    const allowedFields = fields ? fields.split(',') : null;
    const dfSorted = dfData
      .filter((entry) => regex.test(entry.mount))
      .map((entry) => {
        const filteredEntry = allowedFields
          ? Object.fromEntries(Object.entries(entry).filter(([key]) => allowedFields.includes(key)))
          : entry;
        return filteredEntry;
      });
    if (dfSorted.length === 0) {
      return false;
    }
    return dfSorted;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Get a list of file information for the specified path.
 * @param {string} path - The path of the directory.
 * @param {string} multiplier - Unit to convert file sizes (B, KB, MB, GB).
 * @param {number} decimal - Number of decimal places for file sizes.
 * @returns {Array} An array of file information or returns an empty array if there's an issue reading the directory or obtaining file information.
 */
async function getPathFileList(path, multiplier, decimal, filterKeywords = []) {
  try {
    const files = await fs.readdir(path);
    const filesArray = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const filePath = `${path}/${file}`;
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(filePath);
      // eslint-disable-next-line no-await-in-loop
      const passesFilter = filterKeywords.length === 0 || filterKeywords.some((keyword) => {
        const includes = file.includes(keyword);
        return includes;
      });
      if (passesFilter) {
        const fileSize = convertFileSize(stats.size, multiplier);
        const roundedFileSize = fileSize.toFixed(decimal);
        const fileInfo = {
          name: file,
          create: stats.birthtimeMs.toFixed(0),
          size: roundedFileSize,
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
 * @param {string} path - The local path to save the downloaded file.
 * @param {string} component - The component name for identification.
 * @param {string} appname - The application name for identification.
 * @param {boolean} rename - Flag indicating whether to rename the downloaded file.
 * @returns {boolean} - True if the file is downloaded and saved successfully, false on failure.
 */
async function downloadFileFromUrl(url, path, component, appname, rename = false) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const fileData = Buffer.from(response.data, 'binary');
    if (rename === true) {
      await fs.writeFile(`${path}/${component}_${appname}.tar.gz`, fileData);
    } else {
      const fileNameArray = url.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      await fs.writeFile(`${path}/${fileName}`, fileData);
    }
    return true;
  } catch (err) {
    log.error(err);
    return false;
  }
}

async function untarFile(extractPath, tarFilePath) {
  try {
    await fs.mkdir(extractPath, { recursive: true });
    await tar.x({
      file: tarFilePath,
      C: extractPath,
    });
    return true;
  } catch (err) {
    log.error('Error during extraction:', err);
    return false;
  }
}

async function createTarGz(sourceDirectory, outputFileName) {
  try {
    await tar.c(
      {
        gzip: true,
        file: outputFileName,
        cwd: sourceDirectory,
      },
      ['.'],
    );
    return true;
  } catch (error) {
    log.error('Error creating tarball:', error);
    return false;
  }
}

async function removeDirectory(path) {
  try {
    const execFinal = `sudo rm -rf ${path}`;
    await cmdAsync(execFinal);
    return true;
  } catch (error) {
    log.error(error);
    return false;
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
};
