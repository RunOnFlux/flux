const util = require('node:util');
const execFile = util.promisify(require('node:child_process').execFile);

const axios = require('axios').default;
const config = require('config');
const splitargs = require('splitargs');
const qs = require('qs');

const asyncLock = require('./utils/asyncLock');
const dbHelper = require('./dbHelper');
const log = require('../lib/log');

const fluxController = require('./utils/fluxController');

/**
 * The Service Helper controller
 */
const shc = new fluxController.FluxController();

/**
 * The max time a child process can run for (15 minutes)
 */
const MAX_CHILD_PROCESS_TIME = 15 * 60 * 1000;

/**
 * Allows for exclusive locks when running child processes
 */
const locks = new Map();

/**
 * To delay by a number of milliseconds.
 * @param {number} ms Number of milliseconds.
 * @returns {Promise} Promise object.
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * To convert a parameter to a boolean.
 * @param {(string|number|boolean)} parameter True, false, 1 or 0 in either string, number or boolean form.
 * @returns {boolean} True or false.
 */
function ensureBoolean(parameter) {
  let param;
  if (parameter === 'false' || parameter === 0 || parameter === '0' || parameter === false) {
    param = false;
  }
  if (parameter === 'true' || parameter === 1 || parameter === '1' || parameter === true) {
    param = true;
  }
  return param;
}

/**
 * To convert a parameter to a number.
 * @param {*} parameter Parameter of any type.
 * @returns {number} Parameter converted to number type.
 */
function ensureNumber(parameter) {
  return Number(parameter);
}

/**
 * To check if a parameter is an object and if not, return an empty object.
 * @param {*} parameter Parameter of any type.
 * @returns {object} Returns the original parameter if it is an object or returns an empty object.
 */
function ensureObject(parameter) {
  if (typeof parameter === 'object') {
    return parameter;
  }
  if (!parameter) {
    return {};
  }
  let param;
  try {
    param = JSON.parse(parameter);
  } catch (e) {
    param = qs.parse(parameter);
  }
  if (typeof param !== 'object') {
    return {};
  }
  return param;
}

/**
 * To convert a parameter to a string.
 * @param {*} parameter Parameter of any type.
 * @returns {string} Parameter converted to string type.
 */
function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

/**
 * To return the owner of a FluxOS application.
 * @param {string} appName Name of app.
 * @returns {number} Owner.
 */
// helper owner flux app function
async function getApplicationOwner(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
      owner: 1,
    },
  };
  const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
  const appSpecs = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (appSpecs) {
    return appSpecs.owner;
  }
  // eslint-disable-next-line global-require
  const appsService = require('./appsService');
  const allApps = await appsService.availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  if (appInfo) {
    return appInfo.owner;
  }
  return null;
}

/**
 * To delete login phrase.
 * @param {string} phrase Login phrase.
 */
async function deleteLoginPhrase(phrase) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    const query = { loginPhrase: phrase };
    const projection = {};
    await dbHelper.findOneAndDeleteInDatabase(database, collection, query, projection);
  } catch (error) {
    log.error(error);
  }
}

/**
 * If a number or a string value has maximum of decimals
 * @param {(string|number)} value Number to check agains
 * @param {number} decimals Maximum number of allowed decimals. Defaults to 8 for satoshis
 */
function isDecimalLimit(value, decimals = 8) {
  const numberRepresentation = ensureNumber(value);
  if (Number.isNaN(numberRepresentation)) {
    return false;
  }
  const decimalValue = ensureString(value).split('.')[1] || '';
  if (decimalValue.length <= decimals) {
    return true;
  }
  return false;
}

/**
 * A central place for axios get requests. The defaults are set in apiServer.js
 * @param {string} url The request URL
 * @param {*} userOptions Standard axios options
 * @returns
 */
async function axiosGet(url, userOptions = {}) {
  const options = { ...userOptions };

  if (!options.signal) options.signal = shc.signal;

  return axios.get(url, options);
}

/**
 * A central place for axios post requests. The defaults are set in apiServer.js
 * @param {string} url The request URL
 * @param {object} userOptions Standard axios options
 * @param {any} data The data to post
 * @returns {Proimse<AxiosResponse>}
 */
async function axiosPost(url, data, userOptions = {}) {
  const options = { ...userOptions };

  if (!options.signal) options.signal = shc.signal;

  return axios.post(url, data, options);
}

/**
 * A generic axios instance. This allows for a central place to manage
 * all axios instance creations. All instances have the global interceptors
 * merged (if debug enabled this logs outbound requests). If no abort signal
 * is passed in, the global service helper controller signal is used.
 *
 * @param {object} options Standard axios options with extra disableGlobalInterceptors Boolean
 * @returns {object} AxiosInstance
 */
function axiosInstance(userOptions = {}) {
  const { disableGlobalInterceptors, ...options } = userOptions;

  if (!options.signal) options.signal = shc.signal;

  const instance = axios.create({
    ...axios.defaults,
    ...options,
  });

  if (!disableGlobalInterceptors) {
    axios.interceptors.request.handlers.forEach((h) => { instance.interceptors.request.handlers.push(h); });
    axios.interceptors.response.handlers.forEach((h) => { instance.interceptors.response.handlers.push(h); });
  }

  return instance;
}

/**
 * To convert a docker steam buffer to a string
 * @param {buffer} docker steam buffer
 * @returns {string}.
 */
function dockerBufferToString(dataBuffer) {
  let result = '';
  let auxDataBuffer = dataBuffer;
  while (auxDataBuffer.length >= 8) {
    const strToUnpack = auxDataBuffer.slice(0, 8);
    auxDataBuffer = auxDataBuffer.slice(8);
    // const sizeValue = strToUnpack.readUInt32BE(4);
    const bufferAux = Uint8Array.from(strToUnpack).buffer;
    const sizeValue = new DataView(bufferAux).getUint32(4, false);
    if (auxDataBuffer.length >= sizeValue) {
      const str = auxDataBuffer.slice(0, sizeValue).toString('utf8');
      auxDataBuffer = auxDataBuffer.slice(sizeValue);
      result += str;
    } else {
      break;
    }
  }
  return result;
}

/**
 * To convert string to array.
 * @param {string}
 * @returns {array}.
 */
function commandStringToArray(command) {
  return splitargs(command);
}

/**
 *
 * @param {*} ip ip address to check
 * @returns {Boolean}
 */
function validIpv4Address(ip) {
  // first octet must start with 1-9, then next 3 can be 0.
  const ipv4Regex = /^[1-9]\d{0,2}\.(\d{0,3}\.){2}\d{0,3}$/;

  if (!ipv4Regex.test(ip)) return false;

  const octets = ip.split('.');
  const isValid = octets.every((octet) => parseInt(octet, 10) < 256);
  return isValid;
}

/**
 * Check if an Ipv4 address is in the RFC1918 range. I.e. NOT routable on
 * the internet.
 * @param {string} ip Target IP
 * @returns {Boolean}
 */
function isPrivateAddress(ip) {
  if (!(validIpv4Address(ip))) return false;

  const quads = ip.split('.').map((quad) => +quad);

  if (quads.length !== 4) return false;

  if ((quads[0] === 10)) return true;
  if ((quads[0] === 192) && (quads[1] === 168)) return true;
  if ((quads[0] === 172) && (quads[1] >= 16) && (quads[1] <= 31)) return true;

  return false;
}

/**
 * To confirm if ip is in subnet
 * @param {string} ip
 * @param {string} subnet
 * @returns {Boolean}
 */
function ipInSubnet(ip, subnet) {
  const [network, mask] = subnet.split('/');

  if (!validIpv4Address(ip) || !validIpv4Address(network)) return false;

  // eslint-disable-next-line no-bitwise
  const ipAsInt = Number(ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet || 0, 10), 0));
  // eslint-disable-next-line no-bitwise
  const networkAsInt = Number(network.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet || 0, 10), 0));
  const maskAsInt = parseInt('1'.repeat(mask) + '0'.repeat(32 - mask), 2);
  // eslint-disable-next-line no-bitwise
  return (ipAsInt & maskAsInt) === (networkAsInt & maskAsInt);
}

/**
 * Runs a command as a child process, without a shell by default.
 * Using a shell is possible with the `shell` option.
 * @param {string} cmd The binary to run. Must be in PATH
 * @param {{params?: string[], runAsRoot?: Boolean, exclusive?: Boolean, logError?: Boolean, cwd?: string, timeout?: number, signal?: AbortSignal, shell?: (Boolean|string)}} options
   @returns {Promise<{error: (Error|null), stdout: (string|null), stderr: (string|null)}>}
 */
async function runCommand(userCmd, options = {}) {
  const res = { error: null, stdout: '', stderr: '' };
  const {
    runAsRoot, logError, exclusive, ...execOptions
  } = options;

  const params = options.params || [];
  delete execOptions.params;

  // Default max of 15 minutes
  if (!Object.prototype.hasOwnProperty.call(execOptions, 'timeout')) {
    execOptions.timeout = MAX_CHILD_PROCESS_TIME;
  }

  if (!userCmd) {
    res.error = new Error('Command must be present');
    return res;
  }

  // number seems to get coerced to string in the execFile command, so have allowed
  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string' || typeof p === 'number')) {
    res.error = new Error('Invalid params for command, must be an Array of strings');
    return res;
  }

  let cmd;
  if (runAsRoot) {
    params.unshift(userCmd);
    cmd = 'sudo';
  } else {
    cmd = userCmd;
  }

  log.debug(`Run Cmd: ${cmd} ${params.join(' ')}`);

  // delete the locks after no waiters?
  if (exclusive) {
    if (!locks.has(userCmd)) {
      locks.set(userCmd, new asyncLock.AsyncLock());
    }
    await locks.get(userCmd).enable();

    log.info(`Exclusive lock enabled for command: ${userCmd}`);
  }

  const { stdout, stderr } = await execFile(cmd, params, execOptions).catch((err) => {
    // do this so we can standardize the return value for errors vs non errors
    const { stdout: errStdout, stderr: errStderr } = err;

    // eslint-disable-next-line no-param-reassign
    delete err.stdout;
    // eslint-disable-next-line no-param-reassign
    delete err.stderr;

    res.error = err;
    if (logError !== false) log.error(err);
    return { stdout: errStdout, stderr: errStderr };
  });

  if (exclusive) {
    locks.get(userCmd).disable();
    log.info(`Exclusive lock disabled for command: ${userCmd}`);
  }

  res.stdout = stdout;
  res.stderr = stderr;

  return res;
}

/**
 * Parses a raw version string from dpkg-query into an object
 * @param {string} rawVersion version string from dpkg-query. Eg:
 * 0.36.1-4ubuntu0.1 (ufw)
 * @returns {{version, major, minor, patch} | null} The parsed version
 */
function parseVersion(rawVersion) {
  // modified this to allow for just major and minor or just major. (and also ~ instead of - after version)
  // I.e:
  //    dpkg-query --showformat='${Version}' --show netcat-openbsd    1.218-4ubuntu1
  //    dpkg-query --showformat='${Version}' --show ca-certificates   20230311ubuntu0.22.04.1

  const versionRegex = /^[^\d]?(?:(?<epoch>[0-9]+):)?(?<version>(?<major>0|[1-9][0-9]*)(?:\.(?<minor>0|[1-9][0-9]*)(?:\.(?<patch>0|[1-9][0-9]*))?)?)/;

  const match = versionRegex.exec(rawVersion);

  if (match) {
    const {
      groups: {
        epoch, version, major, minor, patch,
      },
    } = match;
    return {
      epoch, version, major, minor, patch,
    };
  }
  return null;
}

/**
 * Check if semantic version is bigger or equal to minimum version
 * @param {string} targetVersion Version to check
 * @param {string} minimumVersion minimum version that version must meet
 * @returns {boolean} True if version is equal or higher to minimum version otherwise false.
 */
function minVersionSatisfy(targetVersion, minimumVersion) {
  // remove any leading character that is not a digit i.e. v1.2.6 -> 1.2.6
  const version = targetVersion.replace(/[^\d.]/g, '');

  const splittedVersion = version.split('.');
  const major = Number(splittedVersion[0]);
  const minor = Number(splittedVersion[1]);
  const patch = Number(splittedVersion[2]);

  const splittedVersionMinimum = minimumVersion.split('.');
  const majorMinimum = Number(splittedVersionMinimum[0]);
  const minorMinimum = Number(splittedVersionMinimum[1]);
  const patchMinimum = Number(splittedVersionMinimum[2]);
  if (major < majorMinimum) {
    return false;
  }
  if (major > majorMinimum) {
    return true;
  }
  if (minor < minorMinimum) {
    return false;
  }
  if (minor > minorMinimum) {
    return true;
  }
  if (patch < patchMinimum) {
    return false;
  }
  return true;
}

module.exports = {
  axiosGet,
  axiosPost,
  commandStringToArray,
  axiosInstance,
  delay,
  deleteLoginPhrase,
  dockerBufferToString,
  ensureBoolean,
  ensureNumber,
  ensureObject,
  ensureString,
  getApplicationOwner,
  ipInSubnet,
  isDecimalLimit,
  isPrivateAddress,
  minVersionSatisfy,
  parseVersion,
  runCommand,
  validIpv4Address,
};
