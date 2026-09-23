const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const axios = require('axios');
const config = require('config');
const qs = require('qs');
const { XMLParser } = require('fast-xml-parser');

const { AsyncLock } = require('./utils/asyncLock');
const { FluxController } = require('./utils/fluxController');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const { Privilege, authOf } = require('./utils/privileges');

const syncthingURL = `http://${config.syncthing.ip}:${config.syncthing.port}`;

// Sent rather than inherited, so the page size a caller totals against is the one
// it asked for. syncthing's own default is this value; a default is not a contract.
const LOCAL_CHANGED_PAGE_SIZE = 65536;

// The most pages one folder is read across in a single pass - a bound of our own,
// because the entry count belongs to the app that writes the files and these requests
// are paid again every monitor pass.
//
// Sixteen pages is 1,048,576 entries, sixteen times the largest folder the network
// carries: across 456 syncthing folders the biggest holds 63,999 entries, the 99th
// percentile 40,771. So no app that resembles one reaches the bound, and one that
// does is reported truncated rather than walked for as long as it takes.
const LOCAL_CHANGED_MAX_PAGES = 16;

const isArcane = Boolean(process.env.FLUXOS_PATH);

// Whether this process is the one that installs, spawns and owns the syncthing
// daemon - the question the repair path, the ownership fix and the binary wait
// are really asking. "Is this Arcane" was only ever a proxy for it, and reading
// either environment variable alone gets a case wrong.
//
// Two conditions, because they are two different facts:
//   - Arcane ships syncthing and supervises it itself, so FluxOS stands back.
//   - A syncthing that is not on this host cannot be stopped, reinstalled or
//     chowned by this process whatever the node type. Today's code would try.
//
// config.syncthing.ip defaults to 127.0.0.1, so an ordinary legacy node
// supervises exactly as before and an ordinary Arcane node does not.
const SYNCTHING_LOCAL_ADDRESSES = ['127.0.0.1', 'localhost', '::1'];

/**
 * Whether this process owns the syncthing daemon, given where syncthing is and
 * whether this is Arcane. A pure function of the two facts so the rule can be
 * exercised - the module-level answer below is fixed at load and a test cannot
 * reach the other branches through it.
 * @param {string} syncthingIp config.syncthing.ip
 * @param {boolean} arcane
 * @returns {boolean}
 */
function supervisesSyncthing(syncthingIp, arcane) {
  return SYNCTHING_LOCAL_ADDRESSES.includes(syncthingIp) && !arcane;
}

const fluxosSupervisesSyncthing = supervisesSyncthing(config.syncthing.ip, isArcane);

/**
 * If the binary is executable
 */
let syncthingBinaryPresent = false;

/**
 * Whether the sentinel has already taken syncthing on.
 */
let sentinelStarted = false;

/**
 * What this node knows about syncthing, which is three answers and not two:
 * UNMEASURED is the absence of a verdict, not a soft one.
 */
const SYNCTHING_HEALTH = Object.freeze({
  OK: 'ok',
  UNHEALTHY: 'unhealthy',
  UNMEASURED: 'unmeasured',
});

/**
 * When the sentinel took responsibility for measuring syncthing, and when a
 * probe last found it up and configured. Health is DERIVED from these rather
 * than stored as a verdict, and only success is ever recorded.
 *
 * A stored boolean has to be lowered by somebody, so every path that fails to
 * reach the lowering line reports health it has no evidence for: a throw out of
 * the repair path, a sentinel that never starts because the binary is missing, a
 * probe that throws rather than returning, or the sentinel dying outright. None
 * of those can be fixed by patching the lowering line, because the fault is in a
 * default that asserts health with nothing behind it. Staleness cannot be
 * skipped - no fresh success IS the failure, whatever the reason.
 *
 * It also absorbs the blip tolerance. A window is what a consecutive-failure
 * counter was approximating, and it is right even on the passes that never ran.
 *
 * Staleness only means something once somebody is measuring, which is why there
 * are two stamps and not one. Before the sentinel starts there is no reading to
 * be stale, and inventing one gets it wrong in whichever direction it is
 * invented: a healthy default asserts a probe that never ran, and an unhealthy
 * one blames syncthing for a check this node has not made. So that state says
 * so, and the webserver can answer for the node while it holds.
 */
let measurementStartedAt = null;
let lastHealthyProbeAt = null;
/**
 * The health this node last said out loud, so a change is reported when it
 * HAPPENS rather than on every pass that finds the same thing - the same
 * bookkeeping idService keeps for the fitness verdict.
 */
let lastReportedHealth = SYNCTHING_HEALTH.UNMEASURED;

/**
 * Milliseconds on the monotonic clock. Both stamps are elapsed-time decisions
 * and nothing reads them outside this process, so wall time buys nothing and
 * costs the one case this window exists for: a node boots, ntp steps the clock,
 * and a window measured on Date.now() either expires on the spot or never.
 * @returns {number}
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}
const SYNCTHING_HEALTH_WINDOW_MS = config.syncthing.healthWindowMs;
const SYNCTHING_SENTINEL_INTERVAL_MS = config.syncthing.sentinelIntervalMs;
// The device id is the SHA-256 of syncthing's cert (protocol.NewDeviceID); it is
// fixed for the life of the install, so it is read once and served from here.
// Cleared when syncthing is stopped, the only point a new cert could appear.
let cachedDeviceId = null;

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
};
const parser = new XMLParser(parserOptions);

const goodSyncthingChars = /^[a-zA-Z0-9-_]+$/;

/**
 * Syncthing controller
 */
const asyncLock = new AsyncLock();
const stc = new FluxController();

/**
 *
 * Temporary function until Arcane is deployed
 * @param {string} configFile  The syncthing config file
 * @returns {Promise<boolean>}
 */
async function changeSyncthingOwnership(configFile) {
  const user = os.userInfo().username;
  const owner = `${user}:${user}`;

  // As syncthing is running as root, we need to change owenership to running user
  // eslint-disable-next-line no-use-before-define
  const dirs = syncthingOwnedDirs();

  // eslint-disable-next-line no-restricted-syntax
  for (const dir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await serviceHelper.runCommand('chown', {
      runAsRoot: true,
      logError: false,
      params: [owner, dir],
    });

    if (error) return false;
  }

  const { error: chmodError } = await serviceHelper.runCommand('chmod', {
    runAsRoot: true,
    logError: false,
    params: ['644', configFile],
  });

  if (chmodError) return false;

  return true;
}

/**
 * Whether this process owns the syncthing daemon on this node. The rule above,
 * answered for this process - exported so nothing else has to re-derive it from
 * the node type and get a different answer.
 * @returns {boolean}
 */
function ownsSyncthing() {
  return fluxosSupervisesSyncthing;
}

/**
 * Where syncthing's configuration and identity live. SYNCTHING_PATH relocates
 * it, so everything that creates, chowns, spawns into or reads that directory
 * has to resolve it the same way. Resolved in one place because they did not:
 * the repair path built ~/.config/syncthing directly while the config read
 * honoured the variable, so an operator who set it had FluxOS start a daemon in
 * one directory and read another's config.xml - and the api key it
 * authenticates every syncthing call with comes out of that file.
 * @returns {string}
 */
function syncthingHomeDir() {
  return process.env.SYNCTHING_PATH || path.join(os.homedir(), '.config', 'syncthing');
}

/**
 * The directories the FluxOS user has to own, since syncthing runs as root and
 * writes its config.xml there. The home always, and ~/.config above it only
 * while the home is still inside it: the parent is chowned so the user can
 * create the directory in the first place, and following the home wherever an
 * operator relocates it would hand the user something like /var/lib.
 * @returns {string[]}
 */
function syncthingOwnedDirs() {
  const syncthingDir = syncthingHomeDir();
  const configDir = path.join(os.homedir(), '.config');

  return path.dirname(syncthingDir) === configDir ? [configDir, syncthingDir] : [syncthingDir];
}

/**
 * To get syncthing config xml file
 * @returns {Promise<(string | null)>} config file (XML).
 */
async function getConfigFile() {
  const configFile = path.join(syncthingHomeDir(), 'config.xml');

  if (fluxosSupervisesSyncthing) {
    const ownershipChanged = await changeSyncthingOwnership(configFile);
    if (!ownershipChanged) return null;
  }

  let result = null;
  // this should never reject as chown would error first but just in case
  result = await fs.readFile(configFile, 'utf8').catch((error) => {
    log.error(error);
    return null;
  });

  return result;
}

/**
 * To get syncthing Api key
 * @returns {Promise<string|null>} Api key
 */
async function getSyncthingApiKey() {
  const fileRead = await getConfigFile();
  if (!fileRead) return null;

  let jsonConfig = null;
  try {
    jsonConfig = parser.parse(fileRead);
  } catch (error) {
    log.error(error);
    return null;
  }

  const apiKey = jsonConfig.configuration?.gui?.apikey || null;
  return apiKey;
}

/**
 * A simple 15 minute cache for the axios instance.
 */
const axiosCache = {
  syncthingApiKey: null,
  axiosInstance: null,
  lastUpdate: 0,

  async instance() {
    return this.axiosInstance && this.lastUpdate + (15 * 60 * 1000) > Date.now() ? this.axiosInstance : this.createInstance();
  },

  /**
   *
   * @returns {Promise<function | null>}
   */
  async createInstance() {
    this.syncthingApiKey = await getSyncthingApiKey();

    if (!this.syncthingApiKey) return null;

    log.info('Creating a new Axios instance for the Flux Syncthing Service');

    this.axiosInstance = axios.create({
      baseURL: syncthingURL,
      timeout: 5000,
      headers: {
        'X-API-Key': this.syncthingApiKey,
      },
      signal: stc.signal,
    });

    this.lastUpdate = Date.now();
    return this.axiosInstance;
  },

  /**
   * @return {void}
   */
  reset() {
    this.axiosInstance = null;
    this.syncthingApiKey = null;
    this.lastUpdate = 0;
  },
};

/**
 * @returns {object} The axios Cache
 */
function getAxiosCache() {
  return axiosCache;
}

/**
 *
 * @returns {FluxController} The syncthing Controller
 */
function syncthingController() {
  return stc;
}

/**
 * To perform http request
 * @param {string} method Method.
 * @param {string} urlpath URL to be called.
 * @param {object} data Request data.
 * @returns {object} Message.
 */
// eslint-disable-next-line default-param-last
async function performRequest(method = 'get', urlpath = '', data, config) {
  // now we cache the axios instance for 15 minutes. Means we don't have to create a new instance
  // on every call. It also means that if the syncthing api key changes, it will refetch it
  // after 15 minutes
  const instance = await axiosCache.instance();
  if (!instance) {
    return messageHelper.createErrorMessage('Unable to read syncthing apikey');
  }

  try {
    // axios bodyless methods take the request config as their second argument
    const response = ['post', 'put', 'patch'].includes(method)
      ? await instance[method](urlpath, data, config)
      : await instance[method](urlpath, config ?? data);

    const successResponse = messageHelper.createDataMessage(response.data);
    return successResponse;
  } catch (error) {
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    // The axios code is a category - ERR_BAD_REQUEST spans every 4xx - so the
    // HTTP status rides along as itself: a caller telling "no such folder"
    // (404) from a denial (403) needs the number, and the message's wording
    // belongs to axios, not to us. Null when no HTTP answer arrived at all.
    errorResponse.data.httpStatus = error.response?.status ?? null;
    return errorResponse;
  }
}

/**
 * The failure of a syncthing request, as an exception rather than an envelope.
 *
 * Carries the HTTP status because absence and refusal are different answers and
 * only the number separates them: a folder syncthing does not know answers 404,
 * a stale api key answers 403, and axios reports both as ERR_BAD_REQUEST. A
 * caller that acts on absence reads `httpStatus`; one that does not ignores it.
 */
class SyncthingError extends Error {
  constructor(message, { name, code, httpStatus } = {}) {
    super(message || 'syncthing request failed');
    // axios's own name and code, so the envelope the Api half rebuilds is the
    // one these endpoints have always answered
    this.name = name || 'SyncthingError';
    this.code = code;
    this.httpStatus = httpStatus ?? null;
  }
}

/**
 * A syncthing request: its data, or a throw.
 *
 * performRequest answers in band because that is the shape the wire needs, and
 * a route serialises it unchanged. Nothing above this line wants the envelope
 * or its vocabulary, so this is the seam - internal callers speak data and
 * exceptions, and the Api half puts the envelope back on.
 * @param {string} method HTTP method.
 * @param {string} urlpath Syncthing REST path.
 * @param {object} [data] Request body.
 * @param {object} [config] Axios config.
 * @returns {Promise<*>} The response data.
 */
async function request(method, urlpath, data, config) {
  const response = await performRequest(method, urlpath, data, config);
  if (response.status === 'success') return response.data;
  const details = response.data || {};
  throw new SyncthingError(details.message, {
    name: details.name,
    code: details.code,
    httpStatus: details.httpStatus,
  });
}

/**
 * To get meta
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getMeta() {
  // "var metadata = {\"deviceID\":\"K6VOO4G-5RLTF3B-JTUFMHH-JWITKGM-63DTTMT-I6BMON6-7E3LVFW-V5WAIAO\"};\n"
  return request('get', '/meta.js');
}

/**
 * Syncthing's own health check. The one syncthing endpoint that needs no api key.
 * @returns {Promise<object>} System health, {"status": "OK"}.
 */
async function getHealth() {
  return request('get', '/rest/noauth/health');
}

// === STATISTICS ENDPOINTS ===

// === SYSTEM ENDPOINTS ===

/**
 * Post with an error message in the body (plain text) to register a new error.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postSystemError(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const message = serviceHelper.ensureObject(body);
    try {
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest('post', '/rest/system/error', message);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * Pause a device, or every device when none is named. A paused device holds no
 * connection, so every folder shared with it stops moving data until it resumes.
 * @param {string} [device] Device ID.
 * @returns {Promise<*>} Syncthing's answer.
 */
async function systemPause(device) {
  let apiPath = '/rest/system/pause';
  if (device) {
    apiPath += `?device=${device}`;
  }
  return request('post', apiPath);
}

/**
 * Returns a {"ping": "pong"} object.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemPing() {
  return request('get', '/rest/system/ping'); // can also be 'post', same
}

/**
 * Restart the syncthing process. Every folder's transfers stop and start again,
 * which is why the folder-level nudge exists for the cases that only need one
 * folder's index re-exchanged.
 * @returns {Promise<*>} Syncthing's answer.
 */
async function systemRestart() {
  log.info('Restarting Syncthing...');
  const data = await request('post', '/rest/system/restart');
  log.info('Syncthing restarted');
  return data;
}

/**
 * Resume a device, or every device when none is named.
 * @param {string} [device] Device ID.
 * @returns {Promise<*>} Syncthing's answer.
 */
async function systemResume(device) {
  let apiPath = '/rest/system/resume';
  if (device) {
    apiPath += `?device=${device}`;
  }
  return request('post', apiPath);
}

/**
 * To perform an upgrade to the newest released version and restart.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postSystemUpgrade(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', '/rest/system/upgrade');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

/**
 * The running syncthing's version.
 * @returns {Promise<object>} Version information.
 */
async function systemVersion() {
  return request('get', '/rest/system/version');
}

// === CONFIG ENDPOINTS ===

/**
 * The entire syncthing configuration - every folder and every device.
 * @returns {Promise<object>} The configuration.
 */
async function getConfig() {
  return request('get', '/rest/config');
}

/**
 * Replaces the entire config.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfig(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest('put', '/rest/config', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * The configured folders, or the one folder with the given id.
 * @param {string} [id] Folder ID. Omitted, every folder.
 * @returns {Promise<Array|object>} The folder configuration.
 */
async function getConfigFolders(id) {
  let apiPath = '/rest/config/folders';
  if (id) {
    if (!goodSyncthingChars.test(id)) {
      throw new Error('Invalid ID supplied');
    }
    apiPath += `/${id}`;
  }
  return request('get', apiPath);
}

/**
 * The configured devices, or the one device with the given id.
 * @param {string} [id] Device ID. Omitted, every device.
 * @returns {Promise<Array|object>} The device configuration.
 */
async function getConfigDevices(id) {
  let apiPath = '/rest/config/devices';
  if (id) {
    if (!goodSyncthingChars.test(id)) {
      throw new Error('Invalid ID supplied');
    }
    apiPath += `/${id}`;
  }
  return request('get', apiPath);
}

/**
 * To modify config for folders. PUT replaces the entire config, PATCH replaces only the given child objects and DELETE removes the folder
 * @param {string} method Request method.
 * @param {string} newConfig new config to be replaced.
 * @param {string} id folder ID.
 * @returns {object} Message
 */
async function adjustConfigFolders(method, newConfig, id) {
  let apiPath = '/rest/config/folders';
  if (id) {
    if (!goodSyncthingChars.test(id)) {
      const response = messageHelper.createErrorMessage('Invalid ID supplied');
      return response;
    }
    apiPath += `/${id}`;
  }
  const response = await performRequest(method, apiPath, newConfig);
  return response;
}

/**
 * To modify config for folders. PUT replaces the entire config, PATCH replaces only the given child objects and DELETE removes the folder
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigFolders(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { id } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await adjustConfigFolders(method, newConfig, id);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To modify config for devices. PUT replaces the entire config, PATCH replaces only the given child objects and DELETE removes the device
 * @param {string} method Request method.
 * @param {string} newConfig new config.
 * @param {string} id device ID.
 * @returns {object} Message
 */
async function adjustConfigDevices(method, newConfig, id) {
  let apiPath = '/rest/config/devices';
  if (id) {
    if (!goodSyncthingChars.test(id)) {
      const response = messageHelper.createErrorMessage('Invalid ID supplied');
      return response;
    }
    apiPath += `/${id}`;
  }
  const response = await performRequest(method, apiPath, newConfig);
  return response;
}

/**
 * To modify config for devices. PUT replaces the entire config, PATCH replaces only the given child objects and DELETE removes the devices
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigDevices(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { id } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await adjustConfigDevices(method, newConfig, id);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * Returns a template folder configuration object with all default values, which only needs a unique ID to be applied
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigDefaultsFolder() {
  return request('get', '/rest/config/defaults/folder');
}

/**
 * To modify config for defult values for folders, PUT replaces the default config (omitted values are reset to the hard-coded defaults), PATCH replaces only the given child objects.
 * @param {string} method Request method.
 * @param {object} newConfig new config.
 * @returns {object} Message
 */
async function adjustConfigDefaultsFolder(method, newConfig) {
  log.info('Patching Syncthing defaults for folder configuration...');
  const response = await performRequest(method, '/rest/config/defaults/folder', newConfig);
  log.info('Syncthing defaults for folder configuration patched...');
  return response;
}

/**
 * To modify config for defult values for folders, PUT replaces the default config (omitted values are reset to the hard-coded defaults), PATCH replaces only the given child objects.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigDefaultsFolder(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const method = (processedBody.method || 'put').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await adjustConfigDefaultsFolder(method, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To modify config for defult values for devices, PUT replaces the default config (omitted values are reset to the hard-coded defaults), PATCH replaces only the given child objects.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigDefaultsDevice(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const method = (processedBody.method || 'put').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/defaults/device', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * Returns the options object
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigOptions() {
  return request('get', '/rest/config/options');
}

/**
 * The syncthing GUI's own configuration.
 * @returns {Promise<object>} The gui configuration.
 */
async function getConfigGui() {
  return request('get', '/rest/config/gui');
}

/**
 * To modify options object, PUT replaces the entire object and PATCH replaces only the given child objects.
 * @param {string} method Request.
 * @param {object} newConfig Response.
 * @returns {object} Message
 */
async function adjustConfigOptions(method, newConfig) {
  log.info('Patching Syncthing configuration...');
  const response = await performRequest(method, '/rest/config/options', newConfig);
  log.info('Syncthing configuration patched...');
  return response;
}

/**
 * To modify options object, PUT replaces the entire object and PATCH replaces only the given child objects.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigOptions(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const method = (processedBody.method || 'put').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await adjustConfigOptions(method, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To modify gui object, PUT replaces the entire object and PATCH replaces only the given child objects.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigGui(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const method = (processedBody.method || 'put').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/gui', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To modify ldap object, PUT replaces the entire object and PATCH replaces only the given child objects.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigLdap(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const method = (processedBody.method || 'put').toLowerCase();
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/ldap', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

// === CLUSTER ENDPOINTS ===

/**
 * To remove records about a pending remote device which tried to connect.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postClusterPendigDevices(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { device } = processedBody;
      const method = (processedBody.method || 'delete').toLowerCase();
      let apiPath = '/rest/cluster/pending/devices';
      if (device) {
        apiPath += `?device=${device}`;
      }
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To remove records about a pending folder announced from a remote device.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postClusterPendigFolders(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { folder } = processedBody;
      const method = (processedBody.method || 'delete').toLowerCase();
      let apiPath = '/rest/cluster/pending/folders';
      if (folder) {
        apiPath += `?folder=${folder}`;
      }
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

// === FOLDER ENDPOINTS ===

/**
 * Returns the list of errors encountered during scanning or pulling. Takes one mandatory parameter {folderid}
 * @param {string} folderid FolderId.
 * @returns {object} returns the output of syncthing reponse of /rest/folder/errors
 */
async function getFolderIdErrors(folderid) {
  let apiPath = '/rest/folder/errors';
  if (folderid) {
    apiPath += `?folder=${folderid}`;
  } else {
    throw new Error('folder parameter is mandatory');
  }
  return performRequest('get', apiPath);
}

/**
 * To restore archived versions of a given set of files. Expects an object with attributes named after the relative file paths, with timestamps as values matching valid versionTime entries in syncthing's /rest/folder/versions response for the folder. Takes one mandatory parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postFolderVersions(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { folder } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      let apiPath = '/rest/folder/versions';
      if (folder) {
        apiPath += `?folder=${folder}`;
      }
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

// === DATABASE ENDPOINTS ===

/**
 * How complete a folder is, optionally as one device sees it.
 *
 * `remoteState` is only set when a device is named, and it is the connectivity
 * discriminator a caller needs: completion is computed from the last known
 * index, so an offline peer still reports 100.
 * @param {object} [selector] Selector.
 * @param {string} [selector.folder] Folder ID.
 * @param {string} [selector.device] Device ID.
 * @returns {Promise<object>} Completion percentage and byte/item counts.
 */
async function getDbCompletion({ folder, device } = {}) {
  let apiPath = '/rest/db/completion';
  const query = qs.stringify({ folder, device });
  if (query) apiPath += `?${query}`;
  return request('get', apiPath);
}

/**
 * Read a folder's ignore patterns, for internal callers. Returns the standard
 * message shape - { status, data: { ignore, expanded } } on success - and never
 * throws, so the caller checks status rather than catching.
 * @param {string} folderId syncthing folder id
 * @returns {Promise<object>} message
 */
async function getFolderIgnores(folderId) {
  return performRequest('get', `/rest/db/ignores?folder=${encodeURIComponent(folderId)}`);
}

/**
 * Set a folder's ignore patterns, for internal callers. Syncthing owns and
 * writes .stignore itself (atomically, and it never replicates it), so this is
 * how FluxOS sets the ignores rather than writing the file. REPLACES the whole
 * set - pass the complete desired list. Returns the standard message shape and
 * never throws.
 * @param {string} folderId syncthing folder id
 * @param {Array<string>} lines the full ignore pattern list
 * @returns {Promise<object>} message
 */
async function setFolderIgnores(folderId, lines) {
  return performRequest('post', `/rest/db/ignores?folder=${encodeURIComponent(folderId)}`, { ignore: lines });
}

/**
 * A folder's current status.
 *
 * Throws with `httpStatus` 404 when syncthing holds no such folder, which is an
 * answer rather than a failure - the caller that acts on absence reads it.
 * @param {string} folder Folder ID.
 * @returns {Promise<object>} The folder status.
 */
async function getDbStatus(folder) {
  if (!folder) {
    throw new Error('folder parameter is mandatory');
  }
  return request('get', `/rest/db/status?folder=${folder}`);
}

/**
 * The files a receive-only folder holds that the cluster's index does not.
 *
 * db/status counts them (receiveOnlyChangedFiles) but will not say WHAT they are, and
 * a count cannot tell a customer's world from the scaffolding FluxOS puts on every
 * volume - the zero-length file an f: mount needs so docker does not create a
 * directory in its place, and the directories m:/ml: mounts ask for. This returns the
 * entries themselves, each with its name, size and modification time, so the caller
 * can answer both "is any of this the owner's" and "how recently was it written"
 * without walking the volume.
 *
 * Only ever populated for a receiveonly or receiveencrypted folder; syncthing reports
 * nothing here for a sendreceive one whatever is on disk (folder_summary.go).
 *
 * PAGED, and the caller must read to the end of it. A page carries at most `perpage`
 * entries, so a caller that totals one page totals a PREFIX of the folder on anything
 * larger - and two nodes summing different prefixes of their own folders compare
 * numbers that no longer order by how much each holds.
 *
 * @param {string} folder Folder ID.
 * @param {number} [page] 1-based page number.
 * @param {number} [perpage] entries per page; syncthing's own default is 65536.
 * @returns {Promise<object>} { files: [{ name, size, modified, deleted, type }], page, perpage }
 */
async function getDbLocalChanged(folder, page = 1, perpage = LOCAL_CHANGED_PAGE_SIZE) {
  if (!folder) {
    throw new Error('folder parameter is mandatory');
  }
  return request('get', `/rest/db/localchanged?folder=${folder}&page=${page}&perpage=${perpage}`);
}

/**
 * A folder's local changes, handed to a caller one page at a time.
 *
 * The paging is syncthing's, so it is answered here rather than by each caller: a
 * caller that reads one page reads a PREFIX of any folder larger than it, and two
 * nodes each totalling their own prefix produce figures that no longer order by how
 * much each holds.
 *
 * A PAGE AT A TIME, never accumulated. How many entries exist is the app's to decide
 * - it writes the files into its own volume - so a list of them all is a list this
 * process does not get to size. A caller that folds each page costs the same whatever
 * the folder holds; one that collects them does not.
 *
 * Bounded for the same reason: these requests are paid every monitor pass, so an app
 * carrying enough files could make the pass itself the expense. A folder that reaches
 * the bound is reported truncated, and what the caller totalled is then a floor -
 * which is all the ranking needs, because a folder that large outranks a normal one
 * on any page of it.
 *
 * A short page ends it. A full page does not: the next request decides, and a folder
 * whose entry count is an exact multiple of the page size answers that one with no
 * list at all, which is the end rather than a failure. Only the FIRST page can say
 * the folder is unreadable.
 *
 * @param {string} folder Folder ID.
 * @param {Function} onBatch Receives each page's entries.
 * @returns {Promise<{read: boolean, pages: number, truncated: boolean}>} read false
 *   when the folder could not be read at all - which is not "holds nothing"
 */
async function eachDbLocalChanged(folder, onBatch) {
  for (let page = 1; ; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await getDbLocalChanged(folder, page, LOCAL_CHANGED_PAGE_SIZE);
    const batch = answer?.files;
    if (!Array.isArray(batch)) return { read: page > 1, pages: page - 1, truncated: false };
    onBatch(batch);
    if (batch.length < LOCAL_CHANGED_PAGE_SIZE) return { read: true, pages: page, truncated: false };
    if (page >= LOCAL_CHANGED_MAX_PAGES) return { read: true, pages: page, truncated: true };
  }
}

/**
 * Request override of a send only folder. Override means to make the local version latest, overriding changes made on other devices. This API call does nothing if the folder is not a send only folder. Takes the mandatory parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postDbOverride(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { folder } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      let apiPath = '/rest/db/override';
      if (folder) {
        apiPath += `?folder=${folder}`;
      } else {
        throw new Error('folder parameter is mandatory');
      }
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * Moves the file to the top of the download queue.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postDbPrio(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { folder } = processedBody;
      const { file } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      let apiPath = '/rest/db/prio';
      if (folder) {
        apiPath += `?folder=${folder}`;
      } else {
        throw new Error('folder parameter is mandatory');
      }
      if (file) {
        apiPath += `&file=${file}`;
      } else {
        throw new Error('file parameter is mandatory');
      }
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To request revert of a receive only folder. Reverting a folder means to undo all local changes. This API call does nothing if the folder is not a receive only folder. Takes the mandatory parameter {folder}.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postDbRevert(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { folder } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      let apiPath = '/rest/db/revert';
      if (folder) {
        apiPath += `?folder=${folder}`;
      } else {
        throw new Error('folder parameter is mandatory');
      }
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

/**
 * To request revert of a receive only folder. Reverting a folder means to undo all local changes. This API call does nothing if the folder is not a receive only folder. Takes the mandatory parameter {folder}.
 * @param {string} folder Request.
 */
async function dbRevert(folder) {
  let apiPath = '/rest/db/revert';
  if (folder) {
    apiPath += `?folder=${folder}`;
  } else {
    throw new Error('folder parameter is mandatory');
  }
  return performRequest('post', apiPath);
}

/**
 * To request immediate scan. Takes the optional parameters {folder} (folder ID), {sub} (path relative to the folder root) and {next} (time in seconds)
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postDbScan(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const { folder } = processedBody;
      const { sub } = processedBody;
      const { next } = processedBody;
      const method = (processedBody.method || 'post').toLowerCase();
      let apiPath = '/rest/db/scan';
      if (folder || sub || next) apiPath += '?';
      const qq = {
        folder,
        sub,
        next,
      };
      const qqStr = qs.stringify(qq);
      apiPath += `${qqStr}`;
      const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res.json(errorResponse);
    }
  });
}

// === DEBUG ===

// === EVENT ENDPOINTS ===

/**
 * Syncthing's event stream, from `since` onwards.
 *
 * The endpoint long-polls: with a `timeout` hold requested, syncthing keeps the
 * request open up to that many seconds before answering "nothing new", so the
 * client-side abort must come strictly after the server-side hold rather than
 * at the shared instance's 5s default.
 * @param {object} [options] Options.
 * @param {string} [options.events] Comma separated event types to subscribe to.
 * @param {number} [options.since] Last event id already seen.
 * @param {number} [options.limit] Maximum events to return.
 * @param {number} [options.timeout] Seconds syncthing may hold the request open.
 * @param {AbortSignal} [options.signal] Interrupts the long poll on shutdown.
 * @returns {Promise<Array>} The events.
 */
async function getEvents({
  events, since, limit, timeout, signal,
} = {}) {
  let apiPath = '/rest/events';
  const query = qs.stringify({
    events, since, limit, timeout,
  });
  if (query) apiPath += `?${query}`;
  const holdS = Number(timeout);
  const config = {};
  if (Number.isFinite(holdS) && holdS > 0) config.timeout = (holdS + 10) * 1000;
  // axios honours config.signal
  if (signal) config.signal = signal;
  // 3rd arg is the request body (none for GET); 4th is the axios config
  return request('get', apiPath, undefined, config);
}

// === MISC SERVICES ENDPOINTS ===

// === CUSTOM ===

/**
 * Returns device id, also checks that syncthing is installed and running and we have the api key.
 * @returns {Promise<null | string>} Message
 */
/**
 * One health probe of the local syncthing: it is up and configured when the
 * meta, health and ping endpoints all answer as expected. Reads no shared state
 * and sets no flag - the caller decides what a single result means.
 * @returns {Promise<{ok: boolean, deviceId: (string|null)}>}
 */
async function probeSyncthing() {
  // Serialised so concurrent callers do not each open three requests at once.
  await asyncLock.enable();

  let meta = null;
  let healthy = null;
  let pingResponse = null;

  let deviceId = null;

  try {
    // if aborted, axios will reject immediately, without any network activity
    meta = await getMeta();
    healthy = await getHealth();
    // check that flux has proper api key
    pingResponse = await systemPing();
    // Parsed in here too: a meta body that answers but does not parse is a
    // failed probe, not an exception thrown at whoever asked.
    if (meta && pingResponse?.ping === 'pong' && healthy?.status === 'OK') {
      deviceId = JSON.parse(meta.slice(15).slice(0, -2)).deviceID || null;
    }
  } catch {
    // do nothing
  } finally {
    asyncLock.disable();
  }

  if (stc.aborted) return { ok: false, deviceId: null };

  return deviceId ? { ok: true, deviceId } : { ok: false, deviceId: null };
}

/**
 * The node's own syncthing device id. Immutable for the life of the install, so
 * it is read once and cached; peers asking for it (getDeviceIdApi) then cost a
 * lookup rather than three requests to syncthing. Does not touch the health flag
 * - advertising the id and judging syncthing's health are separate concerns.
 * @returns {Promise<string|null>} The device id, or null if syncthing has not
 *   yet answered since start.
 */
async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;

  const { deviceId } = await probeSyncthing();
  if (deviceId) cachedDeviceId = deviceId;
  return cachedDeviceId;
}

/**
 * Probe syncthing and record the result. The sentinel calls this on its loop so
 * health reflects a deliberate schedule rather than whatever incoming peer
 * traffic last happened to trigger.
 *
 * Only a success is written, and it writes a time, not a verdict. There is
 * deliberately no "mark it down" branch to skip - see lastHealthyProbeAt.
 * @returns {Promise<boolean>} The probe result.
 */
async function refreshSyncthingHealth() {
  const { ok, deviceId } = await probeSyncthing();

  if (ok) {
    lastHealthyProbeAt = monotonicMs();
    if (deviceId) cachedDeviceId = deviceId;
  }

  // Said on the transition only. Every pass logging a failed probe would bury
  // the moment the node actually stopped being usable.
  //
  // Against what was last REPORTED, not against a reading taken at the top of
  // this same call. A derived state changes with the clock rather than with an
  // event, so the two readings either side of one probe are the same reading
  // almost every time: the window falls due between passes, not during one, and
  // a comparison that narrow fires only if it expires inside the probe itself.
  // Remembering what was said last is what makes arrival detectable at all, and
  // it catches UNMEASURED -> UNHEALTHY too - a syncthing that never once
  // answered, which is the more serious of the two.
  const state = healthState(); // eslint-disable-line no-use-before-define
  if (state !== lastReportedHealth) {
    if (state === SYNCTHING_HEALTH.UNHEALTHY) {
      log.error(`Syncthing has not answered a health probe for ${SYNCTHING_HEALTH_WINDOW_MS / 1000}s; marking syncthing not running`);
    } else if (state === SYNCTHING_HEALTH.OK && lastReportedHealth === SYNCTHING_HEALTH.UNHEALTHY) {
      // The other end of the same edge. Only from UNHEALTHY: a first probe
      // landing after boot is the node starting up, not a recovery.
      log.info('Syncthing answered a health probe; marking syncthing running');
    }
    lastReportedHealth = state;
  }

  return ok;
}

/**
 * Returns device id, also checks that syncthing is installed and running and we have the api key.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDeviceIdApi(_, res) {
  const deviceId = await getDeviceId();

  if (!deviceId) {
    const errMsg = 'Syncthing is not running properly';
    return res.json(messageHelper.createErrorMessage(errMsg));
  }

  return res.json(messageHelper.createDataMessage(deviceId));
}

/**
 * What this node can say about syncthing. Derived, so anything that stops
 * probes landing - a broken repair path, a sentinel that never started, a dead
 * loop - reads as UNHEALTHY rather than as healthy, and anything that stops
 * measurement beginning reads as UNMEASURED rather than as either.
 * @returns {string} A SYNCTHING_HEALTH value.
 */
function healthState() {
  if (measurementStartedAt === null) return SYNCTHING_HEALTH.UNMEASURED;

  if (lastHealthyProbeAt !== null) {
    return monotonicMs() - lastHealthyProbeAt < SYNCTHING_HEALTH_WINDOW_MS
      ? SYNCTHING_HEALTH.OK
      : SYNCTHING_HEALTH.UNHEALTHY;
  }

  // Measuring, with nothing good yet: one window to land a first probe, and
  // after that the silence is the answer. A legacy node whose syncthing binary
  // is missing waits here for ever, so this is the arm that reports it.
  return monotonicMs() - measurementStartedAt < SYNCTHING_HEALTH_WINDOW_MS
    ? SYNCTHING_HEALTH.UNMEASURED
    : SYNCTHING_HEALTH.UNHEALTHY;
}

/**
 * FluxOS is now the thing answering for syncthing's health, so from here
 * silence is a fault rather than an absence. The sentinel calls this before its
 * binary wait, not after: a legacy node missing the executable never leaves
 * that loop, and that is a node whose syncthing is broken, not one nobody has
 * looked at yet.
 */
function noteMeasurementStarted() {
  measurementStartedAt = monotonicMs();
}

/**
 * Whether syncthing is known to be up. Unmeasured is not up - nothing should
 * scrape or depend on a daemon no probe has reached - but it is not a fault
 * either, which is why fitness asks healthState instead.
 * @returns {Boolean}
 */
function isRunning() {
  return healthState() === SYNCTHING_HEALTH.OK;
}

/**
 * Check if syncthing is installed, and if not, install it
 */
async function installSyncthingIdempotently() {
  if (stc.aborted) return;

  log.info('Checking if Syncthing is installed...');

  const { stdout: installed } = await serviceHelper.runCommand('syncthing', {
    params: ['--version'],
    logError: false,
  });

  if (installed) {
    log.info(`Syncthing already installed. Version: ${installed.split(' ')[1]} `);
    return;
  }

  log.info('Installing Syncthing...');
  const helpersPath = path.join(process.cwd(), 'helpers');
  // Git will store the executable bit, so have updated the scripts to be executable,
  // now they can just be called by themselves.
  const installScript = path.join(helpersPath, 'installSyncthing.sh');

  const { error } = await serviceHelper.runCommand(installScript);

  if (!error) {
    log.info('Syncthing installed');
  } else {
    log.error('Error installing syncthing');
  }
}

/**
 * Function that adjusts syncthing folders and restarts the service if needed
 * @returns {Promise<void>}
 */
async function adjustSyncthing() {
  if (stc.aborted) return;

  log.info('Adjusting syncthing.');

  try {
    // best effort, as before: a read that fails leaves that block's settings
    // alone and the next pass retries, rather than abandoning the whole adjust
    const currentConfigOptions = await getConfigOptions().catch(() => null);
    const currentDefaultsFolderOptions = await getConfigDefaultsFolder().catch(() => null);
    // use env so can run this module as standalone for testing
    const apiPort = process.env.FLUX_APIPORT || userconfig?.initial.apiport || config.server?.apiport;
    const myPort = +apiPort + 2; // end with 9 eg 16139
    // adjust configuration
    const newConfig = {
      globalAnnounceEnabled: false,
      localAnnounceEnabled: false,
      natEnabled: false, // let flux handle upnp and nat port mapping
      listenAddresses: [`tcp://:${myPort}`, `quic://:${myPort}`],
    };
    const newConfigDefaultFolders = {
      syncOwnership: true,
      sendOwnership: true,
      syncXattrs: true,
      sendXattrs: true,
      maxConflicts: 0,
    };
    if (currentConfigOptions) {
      if (currentConfigOptions.globalAnnounceEnabled !== newConfig.globalAnnounceEnabled
        || currentConfigOptions.localAnnounceEnabled !== newConfig.localAnnounceEnabled
        || currentConfigOptions.natEnabled !== newConfig.natEnabled
        || serviceHelper.ensureString(currentConfigOptions.listenAddresses) !== serviceHelper.ensureString(newConfig.listenAddresses)) {
        // patch our config
        await adjustConfigOptions('patch', newConfig);
      }
    }
    if (currentDefaultsFolderOptions) {
      if (currentDefaultsFolderOptions.syncOwnership !== newConfigDefaultFolders.syncOwnership
        || currentDefaultsFolderOptions.sendOwnership !== newConfigDefaultFolders.sendOwnership
        || currentDefaultsFolderOptions.syncXattrs !== newConfigDefaultFolders.syncXattrs
        || currentDefaultsFolderOptions.sendXattrs !== newConfigDefaultFolders.sendXattrs) {
        // patch our defaults folder config
        await adjustConfigDefaultsFolder('patch', newConfigDefaultFolders);
      }
    }
    // remove default folder
    // best effort: a configuration that cannot be read leaves the default folder
    // in place, exactly as an unsuccessful read did before
    const allFolders = await getConfigFolders().catch(() => []);
    if (allFolders.find((syncthingFolder) => syncthingFolder.id === 'default')) {
      await adjustConfigFolders('delete', undefined, 'default');
    }
    // enable gui debugging for development nodes only
    if (config.development) {
      const currentGUIOptions = await getConfigGui();
      if (currentGUIOptions.status === 'success') {
        const newGUIOptions = currentGUIOptions.data;
        if (newGUIOptions.debugging !== true) {
          log.info('Applying SyncthingGUI debuggin options...');
          newGUIOptions.debugging = true;
          await performRequest('patch', '/rest/config/gui', newGUIOptions);
        } else {
          log.info('Syncthing GUI in debugging options.');
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Sets up syncthing directory so current user can use it.
 * @returns {Promise<void>}
 */
async function configureDirectories() {
  if (stc.aborted) return;

  const user = os.userInfo().username;
  const owner = `${user}:${user}`;

  await serviceHelper.runCommand('mkdir', {
    params: ['-p', syncthingHomeDir()],
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const dir of syncthingOwnedDirs()) {
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.runCommand('chown', {
      runAsRoot: true,
      params: [owner, dir],
    });
  }
}

/**
 * Stops syncthing if it is running.
 * @returns {Promise<void>}
 */
async function stopSyncthing() {
  // The device id is derived from syncthing's cert; a stop is the only window in
  // which that cert could be replaced, so the cached id is dropped here.
  cachedDeviceId = null;
  if (stc.aborted) return;

  const { stdout: syncthingRunningA } = await serviceHelper.runCommand('pgrep', {
    params: ['syncthing'],
    logError: false,
  });

  if (!syncthingRunningA) return;

  log.info('Stopping syncthing service gracefully');

  // killall will error if process not found (Sends SIGTERM by default)
  await serviceHelper.runCommand('killall', {
    runAsRoot: true,
    params: ['syncthing'],
    logError: false,
  });

  // pkill will error if process not found (Sends SIGTERM by default)
  await serviceHelper.runCommand('pkill', {
    runAsRoot: true,
    params: ['syncthing'],
    logError: false,
  });

  await serviceHelper.delay(1 * 1000);

  const { stdout: syncthingRunningB } = await serviceHelper.runCommand('pgrep', {
    params: ['syncthing'],
    logError: false,
  });

  if (syncthingRunningB) {
    log.info('Sending SIGKILL to syncthing service');
    await serviceHelper.runCommand('kill', {
      runAsRoot: true,
      params: ['-9', 'syncthing'],
    });
  }
}

/**
 * Calls for syncthing servie to stop, and waits for it to happen.
 * @returns {Promise<void>}
 */
async function stopSyncthingSentinel() {
  log.info('Stopping syncthing sentinel');
  await stc.abort();
  // so axios gets a new sigal
  axiosCache.reset();
  // Stop metrics collection
  stopMetricsCollection(); // eslint-disable-line no-use-before-define
  // Cleared last: a start arriving during the stop is a second sentinel beside
  // the one being torn down.
  sentinelStarted = false;
  log.info('Syncthing sentinel stopped');
}

/**
 * Temporary function until moved over to Arcane
 * @param {boolean} installed If syncthing is installed
 * @returns {Promise<void>}
 */
async function ensureSyncthingRunning(installed) {
  if (installed && (await probeSyncthing()).ok) return;

  log.error('Unable to get syncthing deviceId. Reconfiguring syncthing.');
  await stopSyncthing();
  await installSyncthingIdempotently();
  await configureDirectories();

  const syncthingHome = syncthingHomeDir();
  const logFile = path.join(syncthingHome, 'syncthing.log');

  log.info('Spawning Syncthing instance...');

  // if nodeJS binary has the CAP_SETUID capability, can then set the uid to 0,
  // without having to call sudo. IMO, Flux should be run as it's own user, not just
  // whatever the operator installed as.
  // this can throw

  // having issues with nodemon and pm2. Using pm2 --no-treekill stops syncthing getting
  // killed, but then get issues with nodemon not dying.

  // adding old spawn with shell in the interim.

  childProcess.spawn(
    // Quoted: both paths come from SYNCTHING_PATH, and this runs through a shell.
    `sudo nohup syncthing --logfile '${logFile}' --logflags=3 --log-max-old-files=2 --log-max-size=26214400 --allow-newer-config --no-browser --home '${syncthingHome}' >/dev/null 2>&1 </dev/null &`,
    { shell: true },
  ).unref();

  // childProcess.spawn(
  //   'sudo',
  //   [
  //     'nohup',
  //     'syncthing',
  //     '--logfile',
  //     logFile,
  //     '--logflags=3',
  //     '--log-max-old-files=2',
  //     '--log-max-size=26214400',
  //     '--allow-newer-config',
  //     '--no-browser',
  //     '--home',
  //     syncthingHome,
  //   ],
  //   {
  //     detached: true,
  //     stdio: 'ignore',
  //     // uid: 0,
  //   },
  // ).unref();

  // let syncthing set itself up
  await stc.sleep(5 * 1000);
}

/**
 * Main syncthing runner. Controller (stc) will loop this function
 * @returns {number} ms until next iteration
 */
async function runSyncthingSentinel() {
  await stc.lock.enable();

  let installed = axiosCache.axiosInstance;
  if (!installed) {
    installed = await axiosCache.createInstance();
  }

  try {
    if (fluxosSupervisesSyncthing) {
      await ensureSyncthingRunning(installed);
    }

    // The health signal is maintained here, deliberately, on every node type -
    // not as a side effect of peer deviceid requests, and not skipped on Arcane.
    await refreshSyncthingHealth();

    if (stc.aborted) return 0;

    // every 8 minutes call adjustSyncthing to check service folders
    // this will also run on first iteration
    if (stc.loopCount % 8 === 0) {
      stc.resetLoopCount();
      await adjustSyncthing();
    }

    return SYNCTHING_SENTINEL_INTERVAL_MS;
  } catch (error) {
    if (error.name === 'AbortError') return 0;

    log.error(error);
    return 2 * SYNCTHING_SENTINEL_INTERVAL_MS;
  } finally {
    stc.lock.disable();
  }
}

/**
 * Starts the main syncthing monitoring loop. Start-once, because boot asks more
 * than once: startFluxFunctions retries itself every 15s after a throw and each
 * retry arrives here. The loop and the metrics interval already refuse a second
 * start; the stamp and the binary wait above them do not, so the guard sits at
 * the top. Restarting the window on every retry would leave a node whose
 * syncthing never answered permanently unmeasured - the one state that refuses
 * nobody - and stack another binary waiter on each pass.
 * @returns {Promise<void>}
 */
async function startSyncthingSentinel() {
  if (sentinelStarted) return;
  sentinelStarted = true;

  noteMeasurementStarted();

  while (fluxosSupervisesSyncthing && !syncthingBinaryPresent) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await serviceHelper.runCommand('syncthing', { logError: false, params: ['--version'] });

    if (error) log.warn('Unable to find syncthing excutable... trying again in 15s.');

    // eslint-disable-next-line no-await-in-loop
    syncthingBinaryPresent = !error || await serviceHelper.delay(15 * 1000);
  }

  // idempotent
  stc.startLoop(runSyncthingSentinel);

  // Start metrics collection (every 60 seconds by default)
  startMetricsCollection(60_000); // eslint-disable-line no-use-before-define
}

/**
 * Test helper: puts the node in a measured state and moves the last-healthy
 * stamp so isRunning() answers `value`.
 * @param {Boolean} value
 */
function setSyncthingRunningState(value) {
  measurementStartedAt = monotonicMs() - SYNCTHING_HEALTH_WINDOW_MS;
  lastHealthyProbeAt = value ? monotonicMs() : monotonicMs() - SYNCTHING_HEALTH_WINDOW_MS;
  lastReportedHealth = value ? SYNCTHING_HEALTH.OK : SYNCTHING_HEALTH.UNHEALTHY;
}

/**
 * Test helper: unsets the measurement stamp and the start latch, as on a node
 * whose sentinel has not started.
 */
function setSyncthingUnmeasured() {
  measurementStartedAt = null;
  lastHealthyProbeAt = null;
  lastReportedHealth = SYNCTHING_HEALTH.UNMEASURED;
  sentinelStarted = false;
}

/**
 * Test helper: clears the cached device id and restores the health window.
 */
function resetDeviceIdCache() {
  cachedDeviceId = null;
  measurementStartedAt = monotonicMs() - SYNCTHING_HEALTH_WINDOW_MS;
  lastHealthyProbeAt = monotonicMs();
  lastReportedHealth = SYNCTHING_HEALTH.OK;
}

// handy for testing
if (require.main === module) {
  startSyncthingSentinel();

  process.stdin.on('data', async (data) => {
    const cmd = data.toString().trim();
    if (cmd === 'start') startSyncthingSentinel();
    if (cmd === 'stop') await stopSyncthingSentinel();
  });
}

// === METRICS AND MONITORING ===

/**
 * Storage for metrics history
 */
const metricsHistory = {
  snapshots: [],
  maxSnapshots: 100, // Keep last 100 snapshots
};

/**
 * Collects comprehensive metrics from Syncthing
 * @returns {Promise<object>} Aggregated metrics object
 */
async function collectSyncthingMetrics() {
  try {
    const timestamp = Date.now();
    const metrics = {
      timestamp,
      health: {
        status: 'unknown',
        error: null,
      },
      system: {
        status: 'unknown',
        uptime: 0,
        cpuPercent: 0,
        error: null,
      },
      connections: {
        total: 0,
        connected: 0,
        devices: {},
        error: null,
      },
      folders: {
        total: 0,
        syncing: 0,
        idle: 0,
        error: 0,
        details: {},
      },
      stats: {
        device: null,
        folder: null,
        error: null,
      },
      errors: {
        system: [],
        folder: {},
      },
      overall: {
        healthy: true,
        syncProgress: 0,
        issues: [],
      },
    };

    // Collect health status
    try {
      const healthResponse = await performRequest('get', '/rest/noauth/health');
      if (healthResponse.status === 'success') {
        metrics.health.status = healthResponse.data?.status || 'ok';
      } else {
        metrics.health.error = healthResponse.data?.message || 'Unknown error';
        metrics.overall.healthy = false;
        metrics.overall.issues.push('Health check failed');
      }
    } catch (error) {
      metrics.health.error = error.message;
      metrics.overall.healthy = false;
      metrics.overall.issues.push(`Health check error: ${error.message}`);
    }

    // Collect system status
    try {
      const systemResponse = await performRequest('get', '/rest/system/status');
      if (systemResponse.status === 'success') {
        const systemData = systemResponse.data;
        metrics.system = {
          status: 'ok',
          uptime: systemData.uptime || 0,
          cpuPercent: systemData.cpuPercent || 0,
          goroutines: systemData.goroutines || 0,
          myID: systemData.myID || '',
          pathSeparator: systemData.pathSeparator || '/',
          startTime: systemData.startTime || '',
          error: null,
        };
      } else {
        metrics.system.error = systemResponse.data?.message || 'Failed to get system status';
        metrics.overall.issues.push('System status unavailable');
      }
    } catch (error) {
      metrics.system.error = error.message;
      metrics.overall.issues.push(`System status error: ${error.message}`);
    }

    // Collect connections
    try {
      const connectionsResponse = await performRequest('get', '/rest/system/connections');
      if (connectionsResponse.status === 'success') {
        const connectionsData = connectionsResponse.data;
        const devices = connectionsData.connections || {};
        let connected = 0;
        const deviceDetails = {};

        Object.keys(devices).forEach((deviceId) => {
          const device = devices[deviceId];
          if (device.connected) {
            connected += 1;
          }
          deviceDetails[deviceId] = {
            connected: device.connected || false,
            address: device.address || '',
            clientVersion: device.clientVersion || '',
            type: device.type || '',
            inBytesTotal: device.inBytesTotal || 0,
            outBytesTotal: device.outBytesTotal || 0,
          };
        });

        metrics.connections = {
          total: Object.keys(devices).length,
          connected,
          devices: deviceDetails,
          error: null,
        };
      } else {
        metrics.connections.error = connectionsResponse.data?.message || 'Failed to get connections';
      }
    } catch (error) {
      metrics.connections.error = error.message;
    }

    // Collect folder statistics
    try {
      const statsResponse = await performRequest('get', '/rest/stats/folder');
      if (statsResponse.status === 'success') {
        metrics.stats.folder = statsResponse.data;
      }
    } catch (error) {
      metrics.stats.error = error.message;
    }

    // Collect device statistics
    try {
      const deviceStatsResponse = await performRequest('get', '/rest/stats/device');
      if (deviceStatsResponse.status === 'success') {
        metrics.stats.device = deviceStatsResponse.data;
      }
    } catch (error) {
      if (!metrics.stats.error) metrics.stats.error = error.message;
    }

    // Collect folder status (get config first to know which folders exist)
    try {
      const configResponse = await performRequest('get', '/rest/config/folders');
      if (configResponse.status === 'success' && Array.isArray(configResponse.data)) {
        const folders = configResponse.data;
        metrics.folders.total = folders.length;
        let totalGlobalBytes = 0;
        let totalInSyncBytes = 0;

        // eslint-disable-next-line no-restricted-syntax
        for (const folder of folders) {
          const folderId = folder.id;
          try {
            // Get folder status
            // eslint-disable-next-line no-await-in-loop
            const statusResponse = await performRequest('get', `/rest/db/status?folder=${folderId}`);
            if (statusResponse.status === 'success') {
              const folderStatus = statusResponse.data;
              const state = folderStatus.state || 'unknown';
              const globalBytes = folderStatus.globalBytes || 0;
              const inSyncBytes = folderStatus.inSyncBytes || 0;
              const needBytes = folderStatus.needBytes || 0;
              const pullErrors = folderStatus.pullErrors || 0;
              const errors = folderStatus.errors || 0;

              metrics.folders.details[folderId] = {
                label: folder.label || folderId,
                state,
                globalBytes,
                inSyncBytes,
                needBytes,
                pullErrors,
                errors,
                syncPercentage: globalBytes > 0 ? ((inSyncBytes / globalBytes) * 100).toFixed(2) : 100,
              };

              totalGlobalBytes += globalBytes;
              totalInSyncBytes += inSyncBytes;

              // Count states
              if (state === 'syncing' || state === 'sync-preparing') {
                metrics.folders.syncing += 1;
              } else if (state === 'idle') {
                metrics.folders.idle += 1;
              } else if (state === 'error') {
                metrics.folders.error += 1;
                metrics.overall.issues.push(`Folder ${folder.label || folderId} in error state`);
              }

              // Track errors
              if (errors > 0 || pullErrors > 0) {
                metrics.errors.folder[folderId] = {
                  pullErrors,
                  errors,
                };
                metrics.overall.issues.push(`Folder ${folder.label || folderId} has ${errors + pullErrors} error(s)`);
                // The counts alone cannot be diagnosed from a log dump -
                // surface the file-level causes, bounded so a sick folder
                // cannot flood the log.
                // eslint-disable-next-line no-await-in-loop
                const folderErrorsResponse = await getFolderIdErrors(folderId);
                const fileErrors = folderErrorsResponse.status === 'success' ? (folderErrorsResponse.data?.errors ?? []) : [];
                const shown = fileErrors.slice(0, 5);
                shown.forEach((fileError) => {
                  log.error(`Syncthing folder ${folder.label || folderId}: ${fileError.path}: ${fileError.error}`);
                });
                if (fileErrors.length > shown.length) {
                  log.error(`Syncthing folder ${folder.label || folderId}: ${fileErrors.length - shown.length} further file error(s) not shown`);
                }
              }
            }
          } catch (error) {
            log.warn(`Failed to get status for folder ${folderId}: ${error.message}`);
            metrics.folders.details[folderId] = {
              label: folder.label || folderId,
              state: 'unknown',
              error: error.message,
            };
          }
        }

        // Calculate overall sync progress
        if (totalGlobalBytes > 0) {
          metrics.overall.syncProgress = parseFloat(((totalInSyncBytes / totalGlobalBytes) * 100).toFixed(2));
        } else {
          metrics.overall.syncProgress = 100;
        }

        // Update overall health based on folder states
        if (metrics.folders.error > 0) {
          metrics.overall.healthy = false;
        }
      }
    } catch (error) {
      metrics.folders.error = error.message;
      metrics.overall.issues.push(`Failed to collect folder metrics: ${error.message}`);
    }

    // Drain syncthing's system error buffer. The buffer is cumulative for
    // the daemon's lifetime and the daemon outlives FluxOS restarts, so each
    // entry is an occurrence, not a state: log its content, clear the
    // buffer, and report unhealthy only for the pass the errors arrived in.
    try {
      const errorsResponse = await performRequest('get', '/rest/system/error');
      if (errorsResponse.status === 'success' && errorsResponse.data?.errors?.length) {
        metrics.errors.system = errorsResponse.data.errors;
        metrics.overall.healthy = false;
        metrics.overall.issues.push(`${metrics.errors.system.length} syncthing system error(s) this pass`);
        metrics.errors.system.forEach((systemError) => {
          log.error(`Syncthing system error at ${systemError.when}: ${systemError.message}`);
        });
        const clearResponse = await performRequest('post', '/rest/system/error/clear');
        if (clearResponse.status !== 'success') {
          log.warn(`Failed to clear syncthing system errors, they will re-log next pass: ${clearResponse.data?.message}`);
        }
      }
    } catch (error) {
      log.warn(`Failed to get system errors: ${error.message}`);
    }

    return metrics;
  } catch (error) {
    log.error(`Failed to collect syncthing metrics: ${error.message}`);
    return {
      timestamp: Date.now(),
      error: error.message,
      overall: { healthy: false, issues: [`Metrics collection failed: ${error.message}`] },
    };
  }
}

/**
 * Saves a metrics snapshot to history
 * @param {object} metrics Metrics object to save
 */
function saveMetricsSnapshot(metrics) {
  metricsHistory.snapshots.push(metrics);

  // Keep only the last N snapshots
  if (metricsHistory.snapshots.length > metricsHistory.maxSnapshots) {
    metricsHistory.snapshots.shift();
  }
}

/**
 * Gets current syncthing metrics
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Current metrics
 */
async function getSyncthingMetrics(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    let response = null;
    if (authorized === true) {
      const metrics = await collectSyncthingMetrics();
      response = messageHelper.createDataMessage(metrics);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res.json(errorResponse);
  }
}

/**
 * Gets syncthing health summary
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Health summary
 */
async function getSyncthingHealthSummary(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    let response = null;
    if (authorized === true) {
      const metrics = await collectSyncthingMetrics();
      const summary = {
        timestamp: metrics.timestamp,
        healthy: metrics.overall.healthy,
        syncProgress: metrics.overall.syncProgress,
        issues: metrics.overall.issues,
        health: {
          status: metrics.health.status,
          error: metrics.health.error,
        },
        system: {
          uptime: metrics.system.uptime,
          status: metrics.system.status,
        },
        connections: {
          connected: metrics.connections.connected,
          total: metrics.connections.total,
        },
        folders: {
          total: metrics.folders.total,
          syncing: metrics.folders.syncing,
          idle: metrics.folders.idle,
          error: metrics.folders.error,
        },
        errors: {
          systemErrors: metrics.errors.system.length,
          folderErrors: Object.keys(metrics.errors.folder).length,
        },
      };
      response = messageHelper.createDataMessage(summary);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res.json(errorResponse);
  }
}

/**
 * Gets syncthing metrics history
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Metrics history
 */
async function getSyncthingMetricsHistory(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    let response = null;
    if (authorized === true) {
      let { limit } = req.params;
      limit = limit || req.query.limit || metricsHistory.maxSnapshots;
      limit = parseInt(limit, 10);

      const snapshots = metricsHistory.snapshots.slice(-limit);
      response = messageHelper.createDataMessage({
        snapshots,
        count: snapshots.length,
        maxSnapshots: metricsHistory.maxSnapshots,
      });
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res.json(errorResponse);
  }
}

/**
 * Periodic metrics collection (called by sentinel or scheduler)
 * @returns {Promise<object|void>} Collected metrics or void
 */
async function collectAndSaveMetrics() {
  try {
    if (!isRunning()) {
      log.debug('Syncthing not running, skipping metrics collection');
      return undefined;
    }

    const metrics = await collectSyncthingMetrics();
    saveMetricsSnapshot(metrics);

    // Log warnings for any issues
    if (!metrics.overall.healthy) {
      log.warn(`Syncthing health issues detected: ${metrics.overall.issues.join(', ')}`);
    }

    return metrics;
  } catch (error) {
    log.error(`Error in periodic metrics collection: ${error.message}`);
    return undefined;
  }
}

/**
 * Starts periodic metrics collection
 * @param {number} intervalMs Interval in milliseconds (default: 60000 = 1 minute)
 */
let metricsCollectionInterval = null;
function startMetricsCollection(intervalMs = 60_000) {
  if (metricsCollectionInterval) {
    log.info('Metrics collection already running');
    return;
  }

  log.info(`Starting syncthing metrics collection with ${intervalMs}ms interval`);
  metricsCollectionInterval = setInterval(collectAndSaveMetrics, intervalMs);

  // Collect initial metrics immediately
  collectAndSaveMetrics();
}

/**
 * Stops periodic metrics collection
 */
function stopMetricsCollection() {
  if (metricsCollectionInterval) {
    clearInterval(metricsCollectionInterval);
    metricsCollectionInterval = null;
    log.info('Stopped syncthing metrics collection');
  }
}

/**
 * Gets comprehensive peer sync diagnostics for all folders
 * Identifies:
 * - Which peers are connected/disconnected
 * - Local sync status vs global
 * - Whether peers have more updated data
 * - Sync issues and recommendations
 * @returns {Promise<Object>} Peer sync diagnostics
 */
async function getPeerSyncDiagnostics() {
  try {
    // Get config for folders and devices
    const configResponse = await performRequest('get', '/rest/config');
    if (!configResponse || configResponse.status !== 'success') {
      throw new Error('Failed to fetch Syncthing configuration');
    }
    const syncthingConfig = configResponse.data;

    // Get system connections status
    const connectionsResponse = await performRequest('get', '/rest/system/connections');
    if (!connectionsResponse || connectionsResponse.status !== 'success') {
      throw new Error('Failed to fetch connection status');
    }
    const connections = connectionsResponse.data.connections || {};

    // Get local device ID
    const statusResponse = await performRequest('get', '/rest/system/status');
    const localDeviceId = statusResponse?.data?.myID || 'unknown';

    const diagnostics = {
      timestamp: Date.now(),
      localDeviceId,
      summary: {
        totalFolders: 0,
        foldersWithIssues: 0,
        cannotSyncFolders: [],
        peersMoreUpdated: [],
        disconnectedPeers: [],
        connectedPeers: [],
      },
      folders: {},
      devices: {},
      issues: [],
      recommendations: [],
    };

    // Build device info map
    const deviceMap = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const device of (syncthingConfig.devices || [])) {
      if (device.deviceID === localDeviceId) {
        deviceMap[device.deviceID] = {
          name: device.name || 'Local',
          isLocal: true,
          connected: true,
        };
      } else {
        const connInfo = connections[device.deviceID] || {};
        const isConnected = connInfo.connected || false;
        deviceMap[device.deviceID] = {
          name: device.name || device.deviceID.substring(0, 7),
          isLocal: false,
          connected: isConnected,
          address: connInfo.address || 'N/A',
          clientVersion: connInfo.clientVersion || 'N/A',
          inBytesTotal: connInfo.inBytesTotal || 0,
          outBytesTotal: connInfo.outBytesTotal || 0,
        };

        if (isConnected) {
          diagnostics.summary.connectedPeers.push(device.deviceID);
        } else {
          diagnostics.summary.disconnectedPeers.push(device.deviceID);
        }
      }
    }
    diagnostics.devices = deviceMap;

    // Analyze each folder
    const folders = syncthingConfig.folders || [];
    diagnostics.summary.totalFolders = folders.length;

    // eslint-disable-next-line no-restricted-syntax
    for (const folder of folders) {
      const folderId = folder.id;
      const folderDiagnostic = {
        id: folderId,
        label: folder.label || folderId,
        type: folder.type,
        devices: [],
        localStatus: null,
        peerStatuses: [],
        issues: [],
        canSync: true,
        peersAreMoreUpdated: false,
      };

      // Get local folder status
      try {
        // eslint-disable-next-line no-await-in-loop
        const folderStatusResponse = await performRequest('get', `/rest/db/status?folder=${encodeURIComponent(folderId)}`);
        if (folderStatusResponse?.status === 'success') {
          const status = folderStatusResponse.data;
          const globalBytes = status.globalBytes || 0;
          const inSyncBytes = status.inSyncBytes || 0;
          const syncPercentage = globalBytes > 0 ? (inSyncBytes / globalBytes) * 100 : 100;

          folderDiagnostic.localStatus = {
            globalBytes,
            inSyncBytes,
            needBytes: status.needBytes || 0,
            needFiles: status.needFiles || 0,
            syncPercentage: Math.round(syncPercentage * 100) / 100,
            state: status.state || 'unknown',
            errors: status.errors || 0,
            pullErrors: status.pullErrors || 0,
            globalFiles: status.globalFiles || 0,
            localFiles: status.localFiles || 0,
            outOfSyncFiles: (status.globalFiles || 0) - (status.localFiles || 0),
          };

          // Check if local is not fully synced
          if (syncPercentage < 100 && globalBytes > 0) {
            folderDiagnostic.issues.push({
              type: 'incomplete_sync',
              message: `Local is ${syncPercentage.toFixed(2)}% synced (missing ${status.needBytes} bytes, ${status.needFiles} files)`,
            });
          }
        }
      } catch (err) {
        folderDiagnostic.issues.push({
          type: 'status_error',
          message: `Cannot get local status: ${err.message}`,
        });
      }

      // Check each device's completion for this folder
      const folderDevices = folder.devices || [];
      let hasConnectedPeer = false;
      let anyPeerMoreUpdated = false;

      // eslint-disable-next-line no-restricted-syntax
      for (const folderDevice of folderDevices) {
        const deviceId = folderDevice.deviceID;
        if (deviceId === localDeviceId) {
          // eslint-disable-next-line no-continue
          continue;
        }

        const deviceInfo = deviceMap[deviceId] || { name: deviceId.substring(0, 7), connected: false };
        const peerStatus = {
          deviceId,
          deviceName: deviceInfo.name,
          connected: deviceInfo.connected,
          completion: null,
          needBytes: null,
          needItems: null,
          globalBytes: null,
        };

        if (deviceInfo.connected) {
          hasConnectedPeer = true;
          // Get what this peer needs FROM us (tells us if they're behind us)
          try {
            // eslint-disable-next-line no-await-in-loop
            const completionResponse = await performRequest('get', `/rest/db/completion?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(deviceId)}`);
            if (completionResponse?.status === 'success') {
              const comp = completionResponse.data;
              peerStatus.completion = comp.completion || 0;
              peerStatus.needBytes = comp.needBytes || 0;
              peerStatus.needItems = comp.needItems || 0;
              peerStatus.globalBytes = comp.globalBytes || 0;

              // If peer completion is 100%, they have all our data
              // But check if their globalBytes > our inSyncBytes to see if they have MORE
              if (folderDiagnostic.localStatus) {
                const localInSync = folderDiagnostic.localStatus.inSyncBytes;
                const peerGlobal = comp.globalBytes || 0;

                // Peer has more data if their global is larger than what we have synced
                if (peerGlobal > localInSync && folderDiagnostic.localStatus.syncPercentage < 100) {
                  peerStatus.hasMoreData = true;
                  anyPeerMoreUpdated = true;
                } else {
                  peerStatus.hasMoreData = false;
                }
              }
            }
          } catch (err) {
            peerStatus.error = err.message;
          }
        } else {
          peerStatus.error = 'Device disconnected';
        }

        folderDiagnostic.peerStatuses.push(peerStatus);
      }

      // Determine if folder can sync
      if (folderDevices.length <= 1) {
        // Only local device
        folderDiagnostic.canSync = true; // No peers to sync with
        folderDiagnostic.issues.push({
          type: 'no_peers',
          message: 'No remote peers configured for this folder',
        });
      } else if (!hasConnectedPeer) {
        folderDiagnostic.canSync = false;
        folderDiagnostic.issues.push({
          type: 'no_connection',
          message: 'Cannot sync: All peers are disconnected',
        });
        diagnostics.summary.cannotSyncFolders.push(folderId);
        diagnostics.summary.foldersWithIssues += 1;
      } else if (anyPeerMoreUpdated && folderDiagnostic.localStatus?.syncPercentage < 100) {
        folderDiagnostic.peersAreMoreUpdated = true;
        folderDiagnostic.issues.push({
          type: 'peers_more_updated',
          message: 'Connected peers have more updated data than local instance',
        });
        diagnostics.summary.peersMoreUpdated.push(folderId);
        diagnostics.summary.foldersWithIssues += 1;
      }

      diagnostics.folders[folderId] = folderDiagnostic;
    }

    // Generate overall issues and recommendations
    if (diagnostics.summary.disconnectedPeers.length > 0) {
      diagnostics.issues.push({
        severity: 'warning',
        message: `${diagnostics.summary.disconnectedPeers.length} peer(s) disconnected`,
        details: diagnostics.summary.disconnectedPeers.map((id) => deviceMap[id]?.name || id.substring(0, 7)),
      });
      diagnostics.recommendations.push('Check network connectivity to disconnected peers');
    }

    if (diagnostics.summary.cannotSyncFolders.length > 0) {
      diagnostics.issues.push({
        severity: 'critical',
        message: `${diagnostics.summary.cannotSyncFolders.length} folder(s) cannot sync with any peer`,
        details: diagnostics.summary.cannotSyncFolders,
      });
      diagnostics.recommendations.push('Ensure at least one peer is connected for each folder');
    }

    if (diagnostics.summary.peersMoreUpdated.length > 0) {
      diagnostics.issues.push({
        severity: 'warning',
        message: `${diagnostics.summary.peersMoreUpdated.length} folder(s) have peers with more updated data`,
        details: diagnostics.summary.peersMoreUpdated,
      });
      diagnostics.recommendations.push('Check for sync conflicts or network issues preventing data reception');
    }

    if (diagnostics.summary.connectedPeers.length === 0 && diagnostics.summary.totalFolders > 0) {
      diagnostics.issues.push({
        severity: 'critical',
        message: 'No peers connected - instance is isolated',
        details: [],
      });
      diagnostics.recommendations.push('Check firewall settings and network configuration');
    }

    return diagnostics;
  } catch (error) {
    log.error(`getPeerSyncDiagnostics error: ${error.message}`);
    throw error;
  }
}

/**
 * API endpoint for peer sync diagnostics
 * @param {object} req Request
 * @param {object} res Response
 * @returns {object} Peer sync diagnostics
 */
async function getPeerSyncDiagnosticsApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    let response = null;
    if (authorized === true) {
      const diagnostics = await getPeerSyncDiagnostics();
      response = messageHelper.createDataMessage(diagnostics);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res.json(errorResponse);
  }
}

module.exports = {
  startSyncthingSentinel,
  stopSyncthingSentinel,
  getDeviceId,
  getDeviceIdApi,
  probeSyncthing,
  refreshSyncthingHealth,
  supervisesSyncthing,
  ownsSyncthing,
  getMeta,
  getHealth,
  postSystemError,
  systemPause,
  systemRestart,
  systemResume,
  postSystemUpgrade,
  systemVersion,
  systemPing,
  syncthingController,
  // CONFIG
  getConfig,
  postConfig,
  getConfigFolders,
  getConfigDevices,
  postConfigFolders,
  postConfigDevices,
  postConfigDefaultsFolder,
  postConfigDefaultsDevice,
  postConfigOptions,
  postConfigGui,
  postConfigLdap,
  // Cluster
  postClusterPendigDevices,
  postClusterPendigFolders,
  // Folder
  getFolderIdErrors,
  postFolderVersions,
  // DATABASE ENDPOINTS
  getDbCompletion,
  getFolderIgnores,
  setFolderIgnores,
  getDbStatus,
  getDbLocalChanged,
  eachDbLocalChanged,
  postDbOverride,
  postDbPrio,
  postDbRevert,
  dbRevert,
  postDbScan,
  // EVENTS
  getEvents,
  // MISC
  // DEBUG
  // helpers
  adjustConfigFolders,
  adjustConfigDevices,
  // status
  isRunning,
  healthState,
  syncthingHomeDir,
  SYNCTHING_HEALTH,
  noteMeasurementStarted,
  // testing exports
  getAxiosCache,
  configureDirectories,
  installSyncthingIdempotently,
  setSyncthingRunningState,
  setSyncthingUnmeasured,
  resetDeviceIdCache,
  adjustSyncthing,
  getConfigFile,
  runSyncthingSentinel,
  stopSyncthing,
  // METRICS AND MONITORING
  getSyncthingMetrics,
  getSyncthingHealthSummary,
  getSyncthingMetricsHistory,
  collectSyncthingMetrics,
  startMetricsCollection,
  stopMetricsCollection,
  // PEER SYNC DIAGNOSTICS
  getPeerSyncDiagnostics,
  getPeerSyncDiagnosticsApi,
};
