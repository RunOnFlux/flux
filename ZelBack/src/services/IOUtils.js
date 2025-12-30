const df = require('node-df');
const fs = require('fs').promises;
const fs2 = require('fs');
const util = require('util');
const log = require('../lib/log');
const axios = require('axios');
const path = require('path');
const { formidable } = require('formidable');
const { URL } = require('url');
const dns = require('dns').promises;
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const exec = util.promisify(require('child_process').exec);

/**
 * Checks if an IP address is in a private/reserved range.
 * @param {string} ip - The IP address to check.
 * @returns {boolean} - True if the IP is private/reserved.
 */
function isPrivateIP(ip) {
  // IPv4 private and reserved ranges
  const privateRanges = [
    /^127\./, // Loopback
    /^10\./, // Class A private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
    /^192\.168\./, // Class C private
    /^169\.254\./, // Link-local
    /^0\./, // Current network
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Carrier-grade NAT
    /^192\.0\.0\./, // IETF protocol assignments
    /^192\.0\.2\./, // TEST-NET-1
    /^198\.51\.100\./, // TEST-NET-2
    /^203\.0\.113\./, // TEST-NET-3
    /^192\.88\.99\./, // 6to4 relay anycast
    /^198\.1[8-9]\./, // Benchmarking
    /^224\./, // Multicast
    /^240\./, // Reserved for future use
    /^255\.255\.255\.255$/, // Broadcast
  ];

  // IPv6 private and reserved ranges
  const ipv6PrivateRanges = [
    /^::1$/, // Loopback
    /^fe80:/i, // Link-local
    /^fc00:/i, // Unique local address
    /^fd00:/i, // Unique local address
    /^ff00:/i, // Multicast
    /^::ffff:127\./i, // IPv4-mapped loopback
    /^::ffff:10\./i, // IPv4-mapped Class A
    /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i, // IPv4-mapped Class B
    /^::ffff:192\.168\./i, // IPv4-mapped Class C
    /^::ffff:169\.254\./i, // IPv4-mapped link-local
  ];

  const allRanges = [...privateRanges, ...ipv6PrivateRanges];
  return allRanges.some((range) => range.test(ip));
}

/**
 * Validates a URL to prevent SSRF attacks.
 * Blocks private IP ranges, localhost, and metadata endpoints.
 * @param {string} urlString - The URL to validate.
 * @param {object} options - Validation options.
 * @param {boolean} options.allowHttp - Whether to allow HTTP (default: false, HTTPS only).
 * @returns {Promise<{valid: boolean, error?: string}>} - Validation result.
 */
async function validateUrl(urlString, options = {}) {
  const { allowHttp = false } = options;

  try {
    const parsedUrl = new URL(urlString);

    // Check protocol
    if (parsedUrl.protocol === 'http:' && !allowHttp) {
      return { valid: false, error: 'HTTP protocol not allowed. Use HTTPS.' };
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { valid: false, error: `Invalid protocol: ${parsedUrl.protocol}` };
    }

    // Block common metadata endpoints
    const blockedHostnames = [
      'metadata.google.internal',
      'metadata.gcp.internal',
      '169.254.169.254', // AWS/GCP/Azure metadata
      '169.254.170.2', // AWS ECS metadata
      'localhost',
      'localhost.localdomain',
    ];

    const hostname = parsedUrl.hostname.toLowerCase();
    if (blockedHostnames.includes(hostname)) {
      return { valid: false, error: `Blocked hostname: ${hostname}` };
    }

    // Check if hostname is already an IP
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^[\da-fA-F:]+$/;

    if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
      if (isPrivateIP(hostname)) {
        return { valid: false, error: `Private/reserved IP address not allowed: ${hostname}` };
      }
    } else {
      // Resolve hostname to IP and check
      try {
        const addresses = await dns.resolve4(hostname).catch(() => []);
        const addresses6 = await dns.resolve6(hostname).catch(() => []);
        const allAddresses = [...addresses, ...addresses6];

        // eslint-disable-next-line no-restricted-syntax
        for (const ip of allAddresses) {
          if (isPrivateIP(ip)) {
            return { valid: false, error: `Hostname resolves to private IP: ${hostname} -> ${ip}` };
          }
        }
      } catch (dnsError) {
        // If DNS resolution fails, log but allow (might be a valid external host)
        log.warn(`DNS resolution failed for ${hostname}: ${dnsError.message}`);
      }
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid URL: ${error.message}` };
  }
}

/**
 * Validates and sanitizes a user-provided path to prevent path traversal attacks.
 * Ensures the resolved path stays within the allowed base directory.
 * @param {string} basePath - The allowed base directory (e.g., app volume mount path).
 * @param {string} userPath - The user-provided relative path to validate.
 * @returns {string} The validated absolute path.
 * @throws {Error} If the path would escape the base directory.
 */
function sanitizePath(basePath, userPath) {
  // Normalize and resolve the base path
  const normalizedBase = path.resolve(basePath);

  // Handle empty or root-only user paths
  if (!userPath || userPath === '/' || userPath === '.') {
    return normalizedBase;
  }

  // Resolve the full path (this normalizes .. and . sequences)
  const fullPath = path.resolve(normalizedBase, userPath);

  // Ensure the resolved path starts with the base path
  // Add trailing separator to prevent prefix attacks (e.g., /app vs /app-other)
  const baseWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
  const isWithinBase = fullPath === normalizedBase || fullPath.startsWith(baseWithSep);

  if (!isWithinBase) {
    throw new Error('Access denied: Path traversal attempt detected');
  }

  return fullPath;
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
 * Validates URL to prevent SSRF attacks.
 *
 * @param {string} fileurl - The URL of the remote file.
 * @param {number} multiplier - The multiplier for converting the file size (e.g., 1024 for KB, 1048576 for MB).
 * @param {number} decimal - The number of decimal places to round the file size.
 * @returns {string|boolean} - The rounded file size as a string with specified decimal places, or false on failure.
 */
async function getRemoteFileSize(fileurl, multiplier, decimal, number = false) {
  try {
    // Validate URL to prevent SSRF attacks (SEC-03 fix)
    const urlValidation = await validateUrl(fileurl, { allowHttp: true });
    if (!urlValidation.valid) {
      log.error(`URL validation failed: ${urlValidation.error}`);
      return false;
    }

    const head = await axios.head(fileurl, { timeout: 10000 });
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
 * @returns {Array|boolean} - Array of objects containing volume information for the specified component, or false if no matching mount is found.
 */
async function getVolumeInfo(appname, component, multiplier, decimal, fields) {
  try {
    const options = {
      prefixMultiplier: multiplier,
      isDisplayPrefixMultiplier: false,
      precision: +decimal,
    };
    const dfAsync = util.promisify(df);
    const dfData = await dfAsync(options);
    let regex;
    if (component === 'null') {
      regex = new RegExp(`flux${appname}$`);
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
 * Validates URL to prevent SSRF attacks and enforces size limits.
 *
 * @param {string} url - The URL of the file to download.
 * @param {string} localpath - The local path to save the downloaded file.
 * @param {string} component - The component name for identification.
 * @param {boolean} rename - Flag indicating whether to rename the downloaded file.
 * @param {number} retries - Current retry count.
 * @param {number} maxSizeBytes - Maximum allowed download size in bytes (default: 10GB).
 * @returns {boolean} - True if the file is downloaded and saved successfully, false on failure.
 */
async function downloadFileFromUrl(url, localpath, component, rename = false, retries = 0, maxSizeBytes = 10 * 1024 * 1024 * 1024) {
  try {
    // Validate URL to prevent SSRF attacks (SEC-03 fix)
    const urlValidation = await validateUrl(url, { allowHttp: true });
    if (!urlValidation.valid) {
      log.error(`URL validation failed: ${urlValidation.error}`);
      return false;
    }

    let filepath = `${localpath}/backup_${component.toLowerCase()}.tar.gz`;
    if (!rename) {
      const fileNameArray = url.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      filepath = `${localpath}/${fileName}`;
    }

    // First check the file size via HEAD request
    try {
      const headResponse = await axios.head(url, { timeout: 10000 });
      const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10);
      if (contentLength > maxSizeBytes) {
        log.error(`File too large: ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`);
        return false;
      }
    } catch (headErr) {
      // HEAD request failed, proceed with caution but enforce size during download
      log.warn(`HEAD request failed, will enforce size limit during download: ${headErr.message}`);
    }

    const response = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 15000,
      maxContentLength: maxSizeBytes,
      maxBodyLength: maxSizeBytes,
    });
    const dirPath = path.dirname(filepath);
    // Create directory if it doesn't exist
    await fs.mkdir(dirPath, { recursive: true });
    const writer = fs2.createWriteStream(filepath);

    // Track downloaded bytes for size enforcement
    let downloadedBytes = 0;
    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (downloadedBytes > maxSizeBytes) {
        response.data.destroy();
        writer.destroy();
        log.error(`Download exceeded size limit at ${downloadedBytes} bytes`);
      }
    });

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
      return await downloadFileFromUrl(url, localpath, component, rename, retries, maxSizeBytes);
    }
    log.error('Error downloading file:', err);
    return false;
  }
}

/**
 * Validates tar archive contents for path traversal attacks.
 * Checks that no archive members would extract outside the target directory.
 * @param {string} tarFilePath - The path of the tarball to validate.
 * @param {string} extractPath - The intended extraction directory.
 * @returns {Promise<{safe: boolean, error?: string}>} - Validation result.
 */
async function validateTarArchive(tarFilePath, extractPath) {
  try {
    const normalizedExtractPath = path.resolve(extractPath);
    // SEC-08 fix: Use runCommand with params array instead of shell string interpolation
    // List archive contents without extracting
    const { error, stdout } = await serviceHelper.runCommand('tar', {
      params: ['-tzf', tarFilePath],
    });
    if (error) {
      return { safe: false, error: `Failed to list archive: ${error.message}` };
    }
    const members = stdout.trim().split('\n').filter((m) => m.length > 0);

    // eslint-disable-next-line no-restricted-syntax
    for (const member of members) {
      // Check for absolute paths
      if (path.isAbsolute(member)) {
        return { safe: false, error: `Archive contains absolute path: ${member}` };
      }
      // Resolve the full extraction path for this member
      const resolvedMemberPath = path.resolve(normalizedExtractPath, member);
      // Ensure it stays within the extraction directory
      const extractPathWithSep = normalizedExtractPath.endsWith(path.sep)
        ? normalizedExtractPath
        : normalizedExtractPath + path.sep;
      const isWithinExtractPath = resolvedMemberPath === normalizedExtractPath
        || resolvedMemberPath.startsWith(extractPathWithSep);

      if (!isWithinExtractPath) {
        return { safe: false, error: `Archive member would escape extraction directory: ${member}` };
      }
    }
    return { safe: true };
  } catch (error) {
    log.error('Error validating tar archive:', error);
    return { safe: false, error: `Failed to validate archive: ${error.message}` };
  }
}

/**
 * Extracts the contents of a tarball (tar.gz) file to the specified extraction path.
 * Validates archive contents before extraction to prevent path traversal attacks.
 *
 * @param {string} extractPath - The path where the contents of the tarball will be extracted.
 * @param {string} tarFilePath - The path of the tarball (tar.gz) file to be extracted.
 * @returns {boolean} - True if the extraction is successful, false on failure.
 */
async function untarFile(extractPath, tarFilePath) {
  try {
    // Validate archive contents before extraction (SEC-02 fix)
    const validation = await validateTarArchive(tarFilePath, extractPath);
    if (!validation.safe) {
      log.error('Tar archive validation failed:', validation.error);
      return { status: false, error: validation.error };
    }

    await fs.mkdir(extractPath, { recursive: true });
    // SEC-08 fix: Use runCommand with params array instead of shell string interpolation
    // Use --no-same-owner to avoid ownership issues
    const { error, stderr } = await serviceHelper.runCommand('tar', {
      params: ['-xvzf', tarFilePath, '-C', extractPath, '--no-same-owner'],
    });
    if (error) {
      log.error('Error during extraction:', error.message);
      return { status: false, error: stderr || error.message };
    }
    return { status: true };
  } catch (error) {
    log.error('Error during extraction:', error.message);
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
    // SEC-08 fix: Use runCommand with params array instead of shell string interpolation
    const { error, stderr } = await serviceHelper.runCommand('tar', {
      runAsRoot: true,
      params: ['-czvf', outputFileName, '-C', sourceDirectory, '.'],
    });
    if (error) {
      log.error('Error creating tarball:', error.message);
      return { status: false, error: stderr || error.message };
    }
    return { status: true };
  } catch (error) {
    log.error('Error creating tarball:', error.message);
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
    // SEC-08 fix: Use runCommand with params array instead of shell string interpolation
    let result;
    if (directory === false) {
      result = await serviceHelper.runCommand('rm', {
        runAsRoot: true,
        params: ['-rf', rpath],
      });
    } else {
      // For directory contents only, use find with -delete for safety
      result = await serviceHelper.runCommand('find', {
        runAsRoot: true,
        params: [rpath, '-mindepth', '1', '-delete'],
      });
    }
    if (result.error) {
      log.error('Error removing directory:', result.error.message);
      return false;
    }
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
    let { component } = req.params;
    component = component || req.query.component || '';
    let { filename } = req.params;
    filename = filename || req.query.filename || '';
    let { folder } = req.params;
    folder = folder || req.query.folder || '';
    if (folder) {
      folder += '/';
    }
    let { type } = req.params;
    type = type || req.query.type || '';
    if (!type || !component) {
      throw new Error('component and type parameters are mandatory');
    }
    let filepath;
    const appVolumePath = await getVolumeInfo(appname, component, 'B', 'mount', 0);
    if (appVolumePath.length > 0) {
      const basePath = appVolumePath[0].mount;
      if (type === 'backup') {
        filepath = sanitizePath(basePath, 'backup/upload/');
      } else {
        // Use appid level to access appdata and all other mount points
        // Sanitize path to prevent directory traversal attacks
        filepath = sanitizePath(basePath, folder);
      }
    } else {
      throw new Error('Application volume not found');
    }
    const options = {
      multiples: true,
      uploadDir: `${filepath}`,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5gb
      hashAlgorithm: false,
      keepExtensions: true,
      // eslint-disable-next-line no-unused-vars
      filename: (name, ext, part, form) => {
        const { originalFilename } = part;
        return originalFilename;
      },
    };
    await fs.mkdir(filepath, { recursive: true });
    // SEC-08 fix: Use runCommand with params array instead of shell string interpolation
    // Note: chmod 755 is more secure than 777 while still allowing uploads
    await serviceHelper.runCommand('chmod', { runAsRoot: true, params: ['755', filepath] });
    const form = formidable(options);

    form
      // eslint-disable-next-line no-unused-vars
      .on('fileBegin', (name, file) => {
        if (!filename) {
          // eslint-disable-next-line no-param-reassign
          file.filepath = `${filepath}${name}`;
        } else {
          // eslint-disable-next-line no-param-reassign
          file.filepath = `${filepath}${filename}`;
        }
      })
      .on('progress', (bytesReceived, bytesExpected) => {
        try {
          res.write(serviceHelper.ensureString([bytesReceived, bytesExpected]));
          if (res.flush) res.flush();
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
          if (res.flush) res.flush();
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
          if (res.flush) res.flush();
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
  validateTarArchive,
  validateUrl,
  isPrivateIP,
  createTarGz,
  removeDirectory,
  getFolderSize,
  fileUpload,
  sanitizePath,
};
