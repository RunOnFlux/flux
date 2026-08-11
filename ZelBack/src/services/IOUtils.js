const fs = require('fs').promises;
const fs2 = require('fs');
const log = require('../lib/log');
const axios = require('axios');
const path = require('path');
const deviceHelper = require('./deviceHelper');
const serviceHelper = require('./serviceHelper');
const { URL } = require('url');
const { measureTree } = require('./utils/treeSize');
const { validateUrlWithDns } = require('./utils/urlSecurity');

/**
 * Maximum number of redirects to follow when validating each redirect target.
 */
const MAX_REDIRECTS = 5;

/**
 * Make an HTTP request with validated redirects.
 * Each redirect target is validated against SSRF checks before following.
 *
 * @param {string} url - The URL to request
 * @param {string} method - HTTP method ('GET' or 'HEAD')
 * @param {object} axiosOptions - Additional axios options
 * @returns {Promise<object>} Axios response object
 * @throws {Error} If URL is blocked or too many redirects
 */
async function requestWithValidatedRedirects(url, method = 'GET', axiosOptions = {}) {
  let currentUrl = url;
  let redirectCount = 0;

  // Validate the initial URL with DNS resolution
  await validateUrlWithDns(currentUrl);

  while (redirectCount < MAX_REDIRECTS) {
    // Make request without following redirects
    const response = await axios({
      method,
      url: currentUrl,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      ...axiosOptions,
    }).catch((error) => {
      // Axios throws on 3xx when maxRedirects is 0, extract the response
      if (error.response && error.response.status >= 300 && error.response.status < 400) {
        return error.response;
      }
      throw error;
    });

    // If not a redirect, return the response
    if (response.status < 300 || response.status >= 400) {
      // Attach the final URL to the response for caller's reference
      response.finalUrl = currentUrl;
      return response;
    }

    // Handle redirect
    const { location } = response.headers;
    if (!location) {
      throw new Error('Redirect response missing Location header');
    }

    // Resolve relative redirects
    const redirectUrl = new URL(location, currentUrl).href;

    // Validate the redirect target before following
    await validateUrlWithDns(redirectUrl);

    // Clean up stream if present (for responseType: 'stream')
    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy();
    }

    currentUrl = redirectUrl;
    redirectCount += 1;
  }

  throw new Error('Too many redirects');
}

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
 *
 * Follows no symlink. It used to `stat` its way down with unbounded recursion
 * and a Promise.all fan-out, which an app owner could turn on the node hosting
 * them: this measures volumes the apps themselves write to, so a `loop -> ..`
 * planted in one measured itself until the process died, and an `escape -> /`
 * measured the host. Both callers run as the FluxOS process, before any
 * container exists - a copy's capacity check, and the file browser, which
 * measures every directory it lists.
 *
 * Approximate upwards of nothing: an entry that cannot be stat'ed is skipped
 * and a directory that cannot be opened is walked no further, so a tree only
 * partly readable reports less than it holds. That is what a size in a listing
 * means, and what `du` does with the same problem. Anything deciding whether
 * something FITS needs a bound applied to what actually lands, not this.
 *
 * @param {string} folderPath - The path to the folder.
 * @returns {Promise<number>} - Total bytes.
 */
async function getFolderSize(folderPath) {
  // What the files say, which is what a listing means by the size of a folder
  // and what every file browser shows. Anything comparing a figure against
  // free space wants measureTree's `occupied` instead, because that is a count
  // of blocks and this is not.
  return measureTree(folderPath, fs);
}

/**
 * The size of a whole app volume's directory tree, in bytes. `du` walks it in
 * one process with bounded memory; getFolderSize recurses in-process and fans
 * out a Promise per entry at every level, which is fine for the handful of
 * entries a folder listing shows and unbounded on an app's real data.
 *
 * Null rather than false when the size cannot be established: zero is a real
 * answer for an empty directory, and a falsy sentinel makes the two
 * indistinguishable at every call site that tests the result for truth.
 *
 * @param {string} dirPath - The path of the directory to measure.
 * @returns {Promise<number|null>} - Size in bytes, or null if it could not be measured.
 */
async function getDirectorySizeBytes(dirPath) {
  try {
    // Without -s, du reports each directory as it walks it and its own total
    // last, so the answer is unchanged while the walk becomes observable - which
    // is what an idle limit needs to mean anything. argv, no shell, for the same
    // reason as the tar calls.
    let total = null;
    const result = await serviceHelper.runStreamingCommand('du', {
      runAsRoot: true,
      params: ['-b', dirPath],
      idleTimeout: 5 * 60 * 1000,
      onLine: (line) => {
        const value = Number.parseInt(line.split(/\s+/)[0], 10);
        if (Number.isFinite(value)) total = value;
      },
    });
    if (result.error) {
      const message = (result.stderr || result.error.message || '').replace(/\n/g, ' ').trim();
      log.error(`Error measuring directory ${dirPath}: ${message}`);
      return null;
    }
    return total;
  } catch (error) {
    log.error(`Error measuring directory ${dirPath}: ${error.message}`);
    return null;
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
    // Use validated redirect-following request to prevent SSRF via redirects
    const response = await requestWithValidatedRedirects(fileurl, 'HEAD', { timeout: 15000 });
    const contentLengthHeader = response.headers['content-length'] || response.headers['Content-Length'];
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
 * @returns {Promise<Array|null>} - Array of objects containing volume information for the
 *          specified component, or null when no matching mount is found. df only reports
 *          MOUNTED filesystems, so null is the answer for an unmounted volume as well as an
 *          unknown one - callers must treat it as "this component's data is not reachable",
 *          never as "empty".
 */
async function getVolumeInfo(appname, component, multiplier, decimal, fields) {
  try {
    const mounts = await deviceHelper.listMountedFilesystems();

    // The identifier is `flux<component>_<app>`, and neither name may contain an
    // underscore (components are alphanumeric, app names alphanumeric plus
    // internal hyphens), so the pair cannot be ambiguous. Both are validated
    // against those charsets before reaching here, which is also what keeps them
    // safe to interpolate into a pattern.
    const identifier = component === 'null' ? `flux${appname}` : `flux${component}_${appname}`;

    // A path the KERNEL reports as a mountpoint, selected by the request - never
    // a path built from it. The worst a hostile appname can do is match nothing.
    const matched = mounts.filter((mount) => path.basename(mount.target) === identifier);
    if (!matched.length) return false;

    const divisor = {
      b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3,
    }[String(multiplier || 'B').toLowerCase()] ?? 1;
    // Two argument orders for this function exist in the codebase, so `decimal`
    // sometimes arrives as a field name. Anything non-numeric means "no rounding"
    // rather than NaN, which is what the previous implementation produced for
    // every size it returned to the file API.
    const precision = Number.isFinite(+decimal) ? +decimal : null;
    const toUnit = (bytes) => {
      const value = bytes / divisor;
      return precision === null ? value : Number(value.toFixed(precision));
    };

    const allowedFields = fields ? String(fields).split(',') : null;
    return matched.map((mount) => {
      const full = {
        filesystem: mount.source,
        size: toUnit(mount.sizeBytes),
        used: toUnit(mount.usedBytes),
        available: toUnit(mount.availableBytes),
        capacity: mount.usePercent / 100,
        mount: mount.target,
      };
      return allowedFields
        ? Object.fromEntries(Object.entries(full).filter(([key]) => allowedFields.includes(key)))
        : full;
    }).filter((entry) => Object.keys(entry).length > 0);
  } catch (error) {
    log.error(error);
    return null;
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
      // lstat, so every entry describes ITSELF. This lists a directory on an
      // application's own volume, where the application can put a link pointing
      // anywhere on the node - and following one would answer with the size and
      // creation time of whatever it names.
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.lstat(filePath);
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
async function downloadFileFromUrl(url, localpath, component, rename = false, retries = 0) {
  try {
    // Use validated redirect-following request to prevent SSRF via redirects
    const response = await requestWithValidatedRedirects(url, 'GET', {
      responseType: 'stream',
      timeout: 15000,
    });

    let filepath = `${localpath}/backup_${component.toLowerCase()}.tar.gz`;
    if (!rename) {
      // Extract filename from the final URL (after redirects)
      const finalUrl = response.finalUrl || url;
      const parsedUrl = new URL(finalUrl);
      const fileName = path.basename(parsedUrl.pathname) || 'download';
      filepath = `${localpath}/${fileName}`;
    }

    const dirPath = path.dirname(filepath);
    // Create directory if it doesn't exist
    await fs.mkdir(dirPath, { recursive: true });
    const writer = fs2.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        resolve(true);
      });
      writer.on('error', (err) => {
        log.error(`Error writing file: ${err.message}`);
        reject();
      });
    });
  } catch (err) {
    if (retries < 3) {
      log.error(err);
      // eslint-disable-next-line no-param-reassign
      retries += 1;
      log.error(`Error downloading file, retrying download:${retries}`);
      // eslint-disable-next-line no-return-await
      return await downloadFileFromUrl(url, localpath, component, rename, retries);
    }
    log.error('Error downloading file:', err);
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
    // argv, not a command string: a path reaching this from anywhere a user can
    // name a file would otherwise turn a filename containing $( ) into
    // arbitrary root execution on the node.
    //
    // -v is also gone. It printed every extracted filename into a 10MB buffer,
    // and a file-count-heavy tree overflowed it - which threw partway through
    // an extraction, leaving a half-extracted tree and no way back.
    const result = await serviceHelper.runCommand('tar', {
      runAsRoot: true,
      params: ['-xzf', tarFilePath, '-C', extractPath],
    });
    if (result.error) {
      const message = (result.stderr || result.stdout || result.error.message || '').replace(/\n/g, ' ');
      log.error(`Error during extraction: ${message}`);
      return { status: false, error: message };
    }
    return { status: true };
  } catch (error) {
    log.error('Error during extraction:', error);
    return { status: false, error: error.message };
  }
}

/**
 * Read a gzipped tar without extracting it. One decompression pass, nothing
 * written to disk and no space consumed, establishing that the archive is
 * complete and readable BEFORE anything is deleted to make room for its
 * contents, and yielding the numbers needed to decide whether those contents
 * will fit.
 *
 * The whole stream has to be inflated: gzip's CRC is in the trailing bytes, so
 * a truncated or corrupt archive cannot be recognised any other way, and the
 * ISIZE field beside it wraps at 4 GiB - useless on exactly the archives where
 * the size answer matters. The listing is counted as it arrives and never held,
 * so an archive of any member count costs the same to read.
 *
 * @param {string} tarFilePath - The path of the tarball (tar.gz) file to read.
 * @returns {Promise<{status: boolean, entries?: number, bytes?: number, error?: string}>}
 *          entries is the member count; bytes is their total uncompressed size.
 */
async function inspectTarGz(tarFilePath) {
  try {
    let entries = 0;
    let bytes = 0;
    let sized = 0;

    // argv, and no shell: root is the only reason this is a child process, and
    // a path reaches tar as an argument rather than as anything parsed.
    //
    // `sized` counts the members whose size column actually parsed as a number,
    // which is what separates a differently-shaped listing from an archive whose
    // members are all genuinely zero length.
    const result = await serviceHelper.runStreamingCommand('tar', {
      runAsRoot: true,
      params: ['-tzvf', tarFilePath],
      // Bounded by work rather than by size. These archives are the largest
      // thing the node handles, and a total limit can only kill the ones that
      // are merely big - which this then reports to an operator as their backup
      // being unreadable. Every line of the listing is proof of progress, so
      // silence this long is a read that has stalled.
      idleTimeout: 5 * 60 * 1000,
      onLine: (line) => {
        entries += 1;
        const size = line.split(/\s+/)[2];
        if (/^[0-9]+$/.test(size)) {
          sized += 1;
          bytes += Number(size);
        }
      },
    });

    if (result.error) {
      const message = (result.stderr || result.error.message || '').replace(/\n/g, ' ').trim();
      log.error(`Error reading archive: ${message}`);
      return { status: false, error: message };
    }
    // The size column is the third field of GNU tar's verbose listing. If no
    // member's third field parsed as a number the listing is a different tar's
    // column layout, and reporting its total as zero would walk an unmeasured
    // archive through the free-space check. Testing the total rather than the
    // parse would also condemn an archive whose members are all genuinely empty,
    // which is a real thing to restore.
    if (entries > 0 && sized === 0) {
      return { status: false, error: 'archive listing not in the expected format' };
    }
    return { status: true, entries, bytes };
  } catch (error) {
    log.error('Error reading archive:', error);
    return { status: false, error: error.message };
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
    // argv, and without -v, for the same two reasons as untarFile above.
    const result = await serviceHelper.runCommand('tar', {
      runAsRoot: true,
      params: ['-czf', outputFileName, '-C', sourceDirectory, '.'],
    });
    if (result.error) {
      const message = (result.stderr || result.stdout || result.error.message || '').replace(/\n/g, ' ');
      log.error(`Error creating tarball: ${message}`);
      return { status: false, error: message };
    }
    return { status: true };
  } catch (error) {
    log.error('Error creating tarball:', error);
    return { status: false, error: error.message };
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
    // argv, not a command string. fluxshareService passes a path built from a
    // caller-supplied folder name straight into this, so a name containing
    // $( ) or a backtick was arbitrary root execution the moment the character
    // rule that happened to exclude them was relaxed.
    const result = directory
      ? await serviceHelper.runCommand('find', {
        runAsRoot: true,
        params: [rpath, '-mindepth', '1', '-exec', 'rm', '-rf', '{}', '+'],
      })
      : await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-rf', rpath] });

    if (result.error) {
      log.error(result.error);
      return false;
    }
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
  inspectTarGz,
  createTarGz,
  removeDirectory,
  getFolderSize,
  getDirectorySizeBytes,
};
