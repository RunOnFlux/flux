/* eslint max-classes-per-file: 0 */
const { randomBytes } = require('node:crypto');

const axios = require('axios');
const config = require('config');
const splitargs = require('splitargs');
const qs = require('qs');
const util = require('node:util');
const execFile = util.promisify(require('node:child_process').execFile);

const dbHelper = require('./dbHelper');
const log = require('../lib/log');

class AsyncLock {
  ready = Promise.resolve();

  locked = false;

  constructor() {
    this.disable = () => { };
  }

  async enable() {
    if (this.locked) await this.ready;
    this.ready = new Promise((resolve) => {
      this.locked = true;
      this.disable = () => {
        this.reset();
        resolve();
      };
    });
  }

  reset() {
    this.disable = () => { };
    this.ready = Promise.resolve();
    this.locked = false;
  }
}

class FluxController extends AbortController {
  #timeouts = new Map();

  lock = new AsyncLock();

  get ['aborted']() {
    return this.signal.aborted;
  }

  get ['locked']() {
    return this.lock.locked;
  }

  /**
   * An interruptable sleep. If you call abort() on the controller,
   * The promise will reject immediately with { name: 'AbortError' }.
   * @param {number} ms How many milliseconds to sleep for
   * @returns
   */
  sleep(ms) {
    const id = randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      this.#timeouts.set(id, [reject, setTimeout(() => {
        this.#timeouts.delete(id);
        resolve();
      }, ms)]);
    });
  }

  async abort() {
    log.info("ABORT WAS CALLED")
    super.abort();
    // eslint-disable-next-line no-restricted-syntax
    for (const [reject, timeout] of this.#timeouts.values()) {
      clearTimeout(timeout);
      reject({ name: 'AbortError' });
    }
    this.#timeouts.clear();
    await this.lock.ready;
  }
}

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

subprocessLock = new AsyncLock()

/**
 *
 * @param {string} cmd The binary to run. Must be in PATH
 * @param {{params?: string[], runAsRoot?: Boolean, logError?: Boolean, cwd?: string, timeout?: number, signal?: AbortSignal, shell?: (Boolean|string)}} options
   @returns {Promise<{error: (Error|null), stdout: (string|null), stderr: (string|null)}>}
 */
async function runCommand(userCmd, options = {}) {
  // testing.
  await subprocessLock.enable();

  const res = { error: null, stdout: null, stderr: null }
  const params = options.params || [];

  log.info(`RUN COMMAND: ${userCmd} ${params.join(" ")}`)

  if (!userCmd) {
    res.error = new Error("Command must be present")
    subprocessLock.disable()
    return res
  }

  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string')) {
    res.error = new Error("Invalid params for command, must be an Array of strings")
    subprocessLock.disable()
    return res;
  }

  const { runAsRoot, logError, ...execOptions } = options;

  if (runAsRoot) {
    params.unshift(userCmd);
    cmd = 'sudo';
  } else {
    cmd = userCmd;
  }

  locked = true;
  const { stdout, stderr } = await execFile(cmd, params, execOptions).catch((err) => {
    const { stdout: errStdout, stderr: errStderr, ...error } = err;
    res.error = error;
    if (logError !== false) log.error(error);
    subprocessLock.disable()
    return [errStdout, errStderr];
  });

  res.stdout = stdout;
  res.stderr = stderr;

  subprocessLock.disable()
  return res;
}

/**
 * To check if a firewall is active.
 * @returns {Promise<boolean>} True if a firewall is active. Otherwise false.
 */
async function isFirewallActive() {
  const { stdout, error } = await runCommand('ufw', {
    runAsRoot: true,
    params: ['status'],
  });

  if (error) return false;

  // install jc. Then can get this command (and others, like iptables) as json
  if (ensureString(stdout).includes('Status: active')) {
    return true;
  }

  return false;
}

/**
 *  Parse a human readable time string into milliseconds, for timers
 * @param {number|string} userInterval the time period to parse. In the format
 * ```<amount of time>[<unit of time>]+``` For example:
 * ```
 *   200  = 200 milliseconds
 *   15s  = 15 seconds
 *   2m   = 2 minutes
 *   4h   = 4 hours
 *   1d   = 1 day
 *
 *   3m30s   = 3 minutes 30 seconds
 *   1h30m    = 1 hour 30 minutes
 *   1d8h30m5s  = 1 day 8 hours 30 minutes 5 seconds
 * ```
 * @returns number milliseconds
 */
function parseInterval(userInterval) {
  // if only numbers are provided, we assume they are ms
  if (/^\d+$/.test(userInterval)) return userInterval;

  // allows unlimited numbers followed by zero or one of of sSmMhHdD, then allows unlimited repeating of the
  // previous match, except that if a number is provided, it must be followed with one of sSmMhHdD.
  if (!/^[0-9]+[s|S|m|M|h|H|d|D]?(?:[0-9]+[s|S|m|M|h|H|d|D]+)*$/.test(userInterval)) return 0;

  const intervalAsArray = userInterval.match(/[0-9]+|[a-zA-Z]+/g);
  // this should always be true because of the middle regex
  if (intervalAsArray.length % 2 !== 0) return 0;

  let ms = 0;
  // iterate of the array objects as pairs
  for (let i = 0; i < intervalAsArray.length; i += 2) {
    const measure = intervalAsArray[i];
    const unit = intervalAsArray[i + 1];

    switch (unit.toLowerCase()) {
      case 's':
        ms += measure * 1000;
        break;
      case 'm':
        ms += measure * 1000 * 60;
        break;
      case 'h':
        ms += measure * 1000 * 3600;
        break;
      case 'd':
        ms += measure * 1000 * 86400;
        break;
      default:
      // do nothing
    }
  }
  return ms;
}

/**
 * Generates a random amount of milliseconds between two human
 * readable strings.
 *
 * I.e. 15m and 30m Would return an amount of ms somewhere between
 * 15 minutes and 30 minutes.
 * @param {string|number} minInterval Human readable time string
 * @param {string|number} maxInterval Human readable time string
 * @returns number milliseconds
 */
async function randomMsBetween(minInterval, maxInterval) {
  // eslint-disable-next-line no-param-reassign
  if (minInterval > maxInterval) [minInterval, maxInterval] = [maxInterval, minInterval];

  const min = parseInterval(minInterval);
  const max = parseInterval(maxInterval);
  const interval = (Math.floor(Math.random() * (max - min + 1)) + min);
  return interval;
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
 * To handle timeouts on axios connection.
 * @param {string} url URL.
 * @param {object} options Options object.
 * @returns {object} Response.
 */
// helper function for timeout on axios connection
const axiosGet = (url, options = {}) => {
  if (!options.timeout) {
    // eslint-disable-next-line no-param-reassign
    options.timeout = 20000;
  }
  const abort = axios.CancelToken.source();
  const id = setTimeout(
    () => abort.cancel(`Timeout of ${options.timeout}ms.`),
    options.timeout,
  );
  return axios
    .get(url, { cancelToken: abort.token, ...options })
    .then((res) => {
      clearTimeout(id);
      return res;
    });
};

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
 * Install Package from apt idempotently
 * @returns {Prmoise<void>}
 */
async function installAptPackage(packageName) {
  const { error: notInstalled } = await runCommand('dpkg', {
    params: ['-l', packageName],
    logError: false
  });

  if (notInstalled) {
    await runCommand('apt', {
      runAsRoot: true,
      params: ['install', packageName, '-y'],
    });
  }

  // await cmdAsync(`dpkg -l ${packageName}`).catch(async () => {
  //   await cmdAsync(`sudo apt install ${packageName} -y`).catch((err) => log.error(err));
  // });
}

module.exports = {
  axiosGet,
  commandStringToArray,
  delay,
  deleteLoginPhrase,
  dockerBufferToString,
  ensureBoolean,
  ensureNumber,
  ensureObject,
  ensureString,
  FluxController,
  getApplicationOwner,
  installAptPackage,
  ipInSubnet,
  isDecimalLimit,
  isFirewallActive,
  parseInterval,
  randomMsBetween,
  runCommand,
  validIpv4Address,
};
