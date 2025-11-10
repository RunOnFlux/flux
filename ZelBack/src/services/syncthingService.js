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

const syncthingURL = `http://${config.syncthing.ip}:${config.syncthing.port}`;

const isArcane = Boolean(process.env.SYNCTHING_PATH);

/**
 * If the binary is executable
 */
let syncthingBinaryPresent = false;

let syncthingStatusOk = false;

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
 * @param {string} configDir The uesrs config dir
 * @param {string} syncthingDir The syncthing config dir
 * @param {string} configFile  The syncthing config file
 * @returns {Promise<boolean>}
 */
async function changeSyncthingOwnership(configDir, syncthingDir, configFile) {
  const user = os.userInfo().username;
  const owner = `${user}:${user}`;

  // As syncthing is running as root, we need to change owenership to running user
  const { error: chownConfigDirError } = await serviceHelper.runCommand('chown', {
    runAsRoot: true,
    logError: false,
    params: [owner, configDir],
  });

  if (chownConfigDirError) return false;

  const { error: chownSyncthingError } = await serviceHelper.runCommand('chown', {
    runAsRoot: true,
    logError: false,
    params: [owner, syncthingDir],
  });

  if (chownSyncthingError) return false;

  const { error: chmodError } = await serviceHelper.runCommand('chmod', {
    runAsRoot: true,
    logError: false,
    params: ['644', configFile],
  });

  if (chmodError) return false;

  return true;
}

/**
 * To get syncthing config xml file
 * @returns {Promise<(string | null)>} config file (XML).
 */
async function getConfigFile() {
  const homedir = os.homedir();
  const configDir = path.join(homedir, '.config');
  const syncthingDir = process.env.SYNCTHING_PATH || path.join(configDir, 'syncthing');
  const configFile = path.join(syncthingDir, 'config.xml');

  if (!isArcane) {
    const ownershipChanged = await changeSyncthingOwnership(configDir, syncthingDir, configFile);
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
async function performRequest(method = 'get', urlpath = '', data) {
  // now we cache the axios instance for 15 minutes. Means we don't have to create a new instance
  // on every call. It also means that if the syncthing api key changes, it will refetch it
  // after 15 minutes
  const instance = await axiosCache.instance();
  if (!instance) {
    return messageHelper.createErrorMessage('Unable to read syncthing apikey');
  }

  try {
    const response = await instance[method](urlpath, data);

    const successResponse = messageHelper.createDataMessage(response.data);
    return successResponse;
  } catch (error) {
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return errorResponse;
  }
}
/**
 * To get meta
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getMeta(req, res) {
  // does not require authentication
  const response = await performRequest('get', '/meta.js');
  // "var metadata = {\"deviceID\":\"K6VOO4G-5RLTF3B-JTUFMHH-JWITKGM-63DTTMT-I6BMON6-7E3LVFW-V5WAIAO\"};\n"
  return res ? res.json(response) : response;
}

/**
 * To get Syhcthing health
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} System health, {"status": "OK"}.
 */
async function getHealth(req, res) {
  const response = await performRequest('get', '/rest/noauth/health');
  return res ? res.json(response) : response;
}

// === STATISTICS ENDPOINTS ===

/**
 * To get device statistics
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} General statistics about devices.
 */
async function statsDevice(req, res) {
  const response = await performRequest('get', '/rest/stats/device');
  return res ? res.json(response) : response;
}

/**
 * To get folder statistics
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} General statistics about folders.
 */
async function statsFolder(req, res) {
  const response = await performRequest('get', '/rest/stats/folder');
  return res ? res.json(response) : response;
}

// === SYSTEM ENDPOINTS ===

/**
 * To get list of directories matching the path given by the optional parameter current
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} List of directories in json array format.
 */
async function systemBrowse(req, res) {
  let { current } = req.params;
  current = current || req.query.current;
  let apiPath = '/rest/system/browse';
  if (current) {
    apiPath += `?current=${current}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To get the list of configured devices and some metadata associated with them. The list also contains the local device itself as not connected.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} List of configured devices and some metadata in json format.
 */
async function systemConnections(req, res) {
  const response = await performRequest('get', '/rest/system/connections');
  return res ? res.json(response) : response;
}

/**
 * To get the set of debug facilities and which of them are currently enabled.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} List of debug facilities and which of them are currently enabled.
 */
async function systemDebug(req, res) {
  let method = 'get';
  let { disable } = req.params;
  disable = disable || req.query.disable;
  let { enable } = req.params;
  enable = enable || req.query.enable;
  let apiPath = '/rest/system/debug';
  if (enable || disable) {
    method = 'post';
  }
  if (enable && disable) {
    apiPath += `?enable=${enable}&disable=${disable}`;
  } else if (enable) {
    apiPath += `?enable=${enable}`;
  } else if (disable) {
    apiPath += `?disable=${disable}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest(method, apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To get the contents of the local discovery cache
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Contents of the local discovery cache
 */
async function systemDiscovery(req, res) {
  let method = 'get';
  let { device } = req.params;
  device = device || req.query.device;
  let { addr } = req.params;
  addr = addr || req.query.addr;
  let apiPath = '/rest/system/discovery';
  if (device || addr) {
    method = 'post';
  }
  if (device && addr) { // both must be defined otherwise get
    method = 'post';
    apiPath += `?device=${device}&addr=${addr}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest(method, apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Post with empty body to remove all recent errors.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemErrorClear(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', '/rest/system/error/clear');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Returns the list of recent errors. Post with an error message in the body (plain text) to register a new error.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemError(req, res) {
  let method = 'get';
  let { message } = req.params;
  message = message || req.query.message;
  const apiPath = '/rest/system/error';
  if (message) {
    method = 'post';
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest(method, apiPath, message);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest('post', '/rest/system/error', message);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

/**
 * To get the list of recent log entries. The optional {since} parameter limits the results to message newer than the given timestamp in RFC 3339 format.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemLog(req, res) {
  let { since } = req.params;
  since = since || req.query.since;
  let apiPath = '/rest/system/log';
  if (since) {
    apiPath += `?since=${since}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To get the list of recent log entries formatted as a text log instead of a JSON object. The optional {since} parameter limits the results to message newer than the given timestamp in RFC 3339 format.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemLogTxt(req, res) {
  let { since } = req.params;
  since = since || req.query.since;
  let apiPath = '/rest/system/log.txt';
  if (since) {
    apiPath += `?since=${since}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To get the path locations used internally for storing configuration, database, and others.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemPaths(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/system/paths');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To pause the given device or all devices. Takes the optional parameter {device} (device ID). When omitted, pauses all devices.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemPause(req, res) {
  let { device } = req.params;
  device = device || req.query.device;
  let apiPath = '/rest/system/pause';
  if (device) {
    apiPath += `?device=${device}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Returns a {"ping": "pong"} object.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemPing(req, res) {
  const response = await performRequest('get', '/rest/system/ping'); // can also be 'post', same
  return res ? res.json(response) : response;
}

/**
 * To erase the current index database and restart Syncthing. With no query parameters, the entire database is erased from disk. By specifying the {folder} parameter with a valid folder ID, only information for that folder will be erased.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemReset(req, res) {
  // note: scary call
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/system/reset';
  if (folder) {
    apiPath += `?folder=${folder}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To erase the current index folderId database and restart Syncthing.
 * @param {string} folderId Request.
 * @param {object} res Response.
 * @returns {object} returns the output of syncthing reponse of rest/system/reset
 */
async function systemResetFolderId(folderId) {
  let apiPath = '/rest/system/reset';
  if (folderId) {
    apiPath += `?folder=${folderId}`;
  } else {
    throw new Error('folder parameter is mandatory');
  }
  return performRequest('post', apiPath);
}

/**
 * To immediately restart Syncthing
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemRestart(req, res) {
  log.info('Restarting Syncthing...');
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', '/rest/system/restart');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  log.info('Syncthing restarted');
  return res ? res.json(response) : response;
}

/**
 * To resume the given device or all devices. Takes the optional parameter {device} (device ID). When omitted, resumes all devices
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemResume(req, res) {
  let { device } = req.params;
  device = device || req.query.device;
  let apiPath = '/rest/system/pause';
  if (device) {
    apiPath += `?device=${device}`;
  }
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', apiPath);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To cause Syncthing to exit and not restart.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemShutdown(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', '/rest/system/shutdown');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Returns information about current system status and resource usage.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemStatus(req, res) {
  const response = await performRequest('get', '/rest/system/status');
  return res ? res.json(response) : response;
}

/**
 * To Check for a possible upgrade, returns an object describing the newest version and upgrade possibility.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemUpgrade(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/system/upgrade');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To perform an upgrade to the newest released version and restart.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postSystemUpgrade(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('post', '/rest/system/upgrade');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Returns the current Syncthing version information.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function systemVersion(req, res) {
  const response = await performRequest('get', '/rest/system/version');
  return res ? res.json(response) : response;
}

// === CONFIG ENDPOINTS ===

/**
 * Returns the entire config.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfig(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/config');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest('put', '/rest/config', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

/**
 * Returns whether a restart of Syncthing is required for the current config to take effect.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigRestartRequired(req, res) {
  const response = await performRequest('get', '/rest/config/restart-required');
  return res ? res.json(response) : response;
}

/**
 * Returns the folder for the given ID.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigFolders(req, res) {
  if (!req) {
    // eslint-disable-next-line no-param-reassign
    req = {
      params: {},
      query: {},
    };
  }
  let { id } = req.params;
  id = id || req.query.id;
  let apiPath = '/rest/config/folders';
  if (id) {
    if (!goodSyncthingChars.test(id)) {
      const response = messageHelper.createErrorMessage('Invalid ID supplied');
      return res ? res.json(response) : response;
    }
    apiPath += `/${id}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
}

/**
 * Returns the device for the given ID.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigDevices(req, res) {
  if (!req) {
    // eslint-disable-next-line no-param-reassign
    req = {
      params: {},
      query: {},
    };
  }
  let { id } = req.params;
  id = id || req.query.id;
  let apiPath = '/rest/config/devices';
  if (id) {
    if (!goodSyncthingChars.test(id)) {
      const response = messageHelper.createErrorMessage('Invalid ID supplied');
      return res ? res.json(response) : response;
    }
    apiPath += `/${id}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await adjustConfigFolders(method, newConfig, id);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await adjustConfigDevices(method, newConfig, id);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

/**
 * Returns a template folder configuration object with all default values, which only needs a unique ID to be applied
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigDefaultsFolder(req, res) {
  const response = await performRequest('get', '/rest/config/defaults/folder');
  return res ? res.json(response) : response;
}

/**
 * Returns a template device configuration object with all default values, which only needs a unique ID to be applied
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigDefaultsDevice(req, res) {
  const response = await performRequest('get', '/rest/config/defaults/device');
  return res ? res.json(response) : response;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await adjustConfigDefaultsFolder(method, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/defaults/device', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

/**
 * returns an object listing ignore patterns to be used by default on folders, as an array of single-line strings
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigDefaultsIgnores(req, res) {
  const response = await performRequest('get', '/rest/config/defaults/ignores');
  return res ? res.json(response) : response;
}

/**
 * To replace the default ignore patterns from an object of the same format
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postConfigDefaultsIgnores(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const newConfig = processedBody.config;
      const method = 'put';
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/defaults/ignores', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

/**
 * Returns the options object
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigOptions(req, res) {
  const response = await performRequest('get', '/rest/config/options');

  return res ? res.json(response) : response;
}

/**
 * Returns the gui object
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigGui(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/config/gui');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Returns the ldap object
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getConfigLdap(req, res) {
  const response = await performRequest('get', '/rest/config/ldap');
  return res ? res.json(response) : response;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await adjustConfigOptions(method, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/gui', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/ldap', newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

// === CLUSTER ENDPOINTS ===

/**
 * Lists remote devices which have tried to connect, but are not yet configured in the instance.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getClusterPendigDevices(req, res) {
  const response = await performRequest('get', '/rest/cluster/pending/devices');
  return res ? res.json(response) : response;
}

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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

/**
 * Lists folders which remote devices have offered to us, but are not yet shared from our instance to them. Takes the optional {device} parameter to only return folders offered by a specific remote device.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getClusterPendigFolders(req, res) {
  const response = await performRequest('get', '/rest/cluster/pending/folders');
  return res ? res.json(response) : response;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
 * Returns the list of errors encountered during scanning or pulling. Takes one mandatory parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getFolderErrors(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    if (!folder) {
      throw new Error('folder parameter is mandatory');
    }
    const response = await getFolderIdErrors(folder);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns the list of archived files that could be recovered. Takes one mandatory parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getFolderVersions(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let apiPath = '/rest/folder/versions';
    if (folder) {
      apiPath += `?folder=${folder}`;
    } else {
      throw new Error('folder parameter is mandatory');
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To restore archived versions of a given set of files. Expects an object with attributes named after the relative file paths, with timestamps as values matching valid versionTime entries in the corresponding getFolderVersions() response object. Takes one mandatory parameter {folder}
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

// === DATABASE ENDPOINTS ===

/**
 * Returns the directory tree of the global model. takes one mandatory {folder} parameter and two optional parameters {levels} and {prefix}.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbBrowse(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let { levels } = req.params;
    levels = levels || req.query.levels;
    let { prefix } = req.params;
    prefix = prefix || req.query.prefix;
    let apiPath = '/rest/db/browse';
    if (!folder) {
      throw new Error('folder parameter is mandatory');
    }
    const qq = {
      folder,
      levels,
      prefix,
    };
    const qqStr = qs.stringify(qq);
    apiPath += `?${qqStr}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns the completion percentage (0 to 100) and byte / item counts. Takes optional {device} and {folder} parameters.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbCompletion(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let { device } = req.params;
    device = device || req.query.device;
    let apiPath = '/rest/db/completion';
    if (folder || device) apiPath += '?';
    const qq = {
      folder,
      device,
    };
    const qqStr = qs.stringify(qq);
    apiPath += `${qqStr}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns most data available about a given file, including version and availability. Takes {folder} and {file} parameters.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbFile(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let { file } = req.params;
    file = file || req.query.file;
    let apiPath = '/rest/db/file';
    if (folder || file) apiPath += '?';
    const qq = {
      folder,
      file,
    };
    const qqStr = qs.stringify(qq);
    apiPath += `${qqStr}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns the content of the .stignore as the ignore field. Takes one parameter, {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbIgnores(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let apiPath = '/rest/db/ignores';
    if (folder) apiPath += `?folder=${folder}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns the list of files which were changed locally in a receive-only folder. Takes one mandatory parameter, {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbLocalchanged(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let apiPath = '/rest/db/localchanged';
    if (folder) {
      apiPath += `?folder=${folder}`;
    } else {
      throw new Error('folder parameter is mandatory');
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns lists of files which are needed by this device in order for it to become in sync. Takes one mandatory parameter, {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbNeed(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let apiPath = '/rest/db/need';
    if (folder) {
      apiPath += `?folder=${folder}`;
    } else {
      throw new Error('folder parameter is mandatory');
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns the list of files which are needed by that remote device in order for it to become in sync with the shared folder. Takes the mandatory parameters {folder} and {device}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbRemoteNeed(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let { device } = req.params;
    device = device || req.query.device;
    let apiPath = '/rest/db/remoteneed';
    if (folder) {
      apiPath += `?folder=${folder}`;
    } else {
      throw new Error('folder parameter is mandatory');
    }
    if (device) {
      apiPath += `&device=${device}`;
    } else {
      throw new Error('device parameter is mandatory');
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns information about the current status of a folder. Takes the mandatory parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDbStatus(req, res) {
  try {
    const folder = req?.params?.folder || req?.query?.folder;
    let apiPath = '/rest/db/status';
    if (folder) {
      apiPath += `?folder=${folder}`;
    } else {
      throw new Error('folder parameter is mandatory');
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Updates the content of the .stignore echoing it back as a response. Takes one parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function postDbIgnores(req, res) {
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
      let apiPath = '/rest/db/ignores';
      if (folder) {
        apiPath += `?folder=${folder}`;
      }
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
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
      const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, apiPath, newConfig);
      } else {
        response = messageHelper.errUnauthorizedMessage();
      }
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

// === DEBUG ===

/**
 * Summarizes the completion precentage for each remote device.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugPeerCompletion(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/debug/peerCompletion');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * Returns statistics about each served REST API endpoint, to diagnose how much time was spent generating the responses.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugHttpmetrics(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/debug/httpmetrics');
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To capture a profile of what Syncthing is doing on the CPU
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugCpuprof(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    try {
      response = await axios.get('/rest/debug/cpuprof', {
        responseType: 'stream', // Specify response type as stream
        timeout: 60000,
      });
      if ('content-type' in response.data.headers) {
        res.setHeader('Content-Type', response.data.headers['content-type']);
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      return response.data.pipe(res);
    } catch (error) {
      return res ? res.json(error) : JSON.stringify(error);
    }
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To capture a profile of what Syncthing is doing with the heap memory.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugHeapprof(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    try {
      response = await axios.get('/rest/debug/heapprof', {
        responseType: 'stream', // Specify response type as stream
        timeout: 60000,
      });
      if ('content-type' in response.data.headers) {
        res.setHeader('Content-Type', response.data.headers['content-type']);
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      return response.data.pipe(res);
    } catch (error) {
      return res ? res.json(error) : JSON.stringify(error);
    }
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To Collect information about the running instance for troubleshooting purposes.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugSupport(req, res) {
  const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
  let response = null;
  if (authorized === true) {
    response = await performRequest('get', '/rest/debug/support', undefined, 60000);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

/**
 * To Show diagnostics about a certain file in a shared folder. Takes the {folder} and {file} parameters.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugFile(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let { file } = req.params;
    file = file || req.query.file;
    let apiPath = '/rest/debug/file';
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
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    let response = null;
    if (authorized === true) {
      try {
        response = await axios.get(apiPath, {
          responseType: 'stream', // Specify response type as stream
          timeout: 60000,
        });
        if ('content-type' in response.data.headers) {
          res.setHeader('Content-Type', response.data.headers['content-type']);
        } else {
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        return response.data.pipe(res);
      } catch (error) {
        return res ? res.json(error) : JSON.stringify(error);
      }
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

// === EVENT ENDPOINTS ===

/**
 * To receive Syncthing events. takes {events}, {since}, {limit} and {timeout} parameters to filter the result.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getEvents(req, res) {
  try {
    let { events } = req.params;
    events = events || req.query.events;
    let { since } = req.params;
    since = since || req.query.since;
    let { limit } = req.params;
    limit = limit || req.query.limit;
    let { timeout } = req.params;
    timeout = timeout || req.query.timeout;
    let apiPath = '/rest/events';
    if (events || since || limit || timeout) apiPath += '?';
    const qq = {
      events,
      since,
      limit,
      timeout,
    };
    const qqStr = qs.stringify(qq);
    apiPath += `${qqStr}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To receive LocalChangeDetected and RemoteChangeDetected event types. takes {since}, {limit} and {timeout} parameters to filter the result.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getEventsDisk(req, res) {
  try {
    let { since } = req.params;
    since = since || req.query.since;
    let { limit } = req.params;
    limit = limit || req.query.limit;
    let { timeout } = req.params;
    timeout = timeout || req.query.timeout;
    let apiPath = '/rest/events/disk';
    if (since || limit || timeout) apiPath += '?';
    const qq = {
      since,
      limit,
      timeout,
    };
    const qqStr = qs.stringify(qq);
    apiPath += `${qqStr}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

// === MISC SERVICES ENDPOINTS ===

/**
 * Verifies and formats a device ID. Takes one parameter, {id}.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getSvcDeviceID(req, res) {
  try {
    let { id } = req.params;
    id = id || req.query.id;
    let apiPath = '/rest/svc/deviceid';
    if (id) {
      apiPath += `?id=${id}`;
    } else {
      throw new Error('id parameter is mandatory');
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns a strong random generated string (alphanumeric) of the specified length. Takes the {length} parameter.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getSvcRandomString(req, res) {
  let { length } = req.params;
  length = length || req.query.length;
  let apiPath = '/rest/svc/random/string';
  try {
    if (length) {
      if (+length < 0 || +length > 10000) {
        const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
        if (authorized !== true) {
          const response = messageHelper.errUnauthorizedMessage();
          return res ? res.json(response) : response;
        }
      }
      apiPath += `?length=${length}`;
    }
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Returns the data sent in the anonymous usage report.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getSvcReport(req, res) {
  try {
    const response = await performRequest('get', '/rest/svc/report');
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

// === CUSTOM ===

/**
 * Returns device id, also checks that syncthing is installed and running and we have the api key.
 * @returns {Promise<null | string>} Message
 */
async function getDeviceId() {
  // not sure why this is necessary. If we only want one at a time, should implement a cache too.
  await asyncLock.enable();

  let meta = {};
  let healthy = {};
  let pingResponse = {};

  try {
    // if aborted, axios will reject immediately, without any network activity
    meta = await getMeta();
    healthy = await getHealth();
    // check that flux has proper api key
    pingResponse = await systemPing();
  } catch {
    // do nothing
  } finally {
    asyncLock.disable();
  }

  if (stc.aborted) return null;

  if (meta.status === 'success' && pingResponse.data?.ping === 'pong' && healthy.data?.status === 'OK') {
    syncthingStatusOk = true;
    const adjustedString = meta.data.slice(15).slice(0, -2);
    const deviceObject = JSON.parse(adjustedString);
    const { deviceID } = deviceObject;
    return deviceID;
  }

  syncthingStatusOk = false;

  // const { stdout } = await serviceHelper.runCommand('ps', {
  //   params: ['-fC', 'syncthing'],
  //   logError: false,
  // });

  // ToDo: tidy this up
  log.error('Syncthing is either not running or misconfigured');
  // log.error(stdout);
  // log.error(meta);
  // log.error(healthy);
  // log.error(pingResponse);
  return null;
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
 * Returns if syncthing service is running ok
 * @returns {Boolean} True if getDeviceId last execution was successful
 */
function isRunning() {
  return syncthingStatusOk;
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
    const currentConfigOptions = await getConfigOptions();
    const currentDefaultsFolderOptions = await getConfigDefaultsFolder();
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
    if (currentConfigOptions.status === 'success') {
      if (currentConfigOptions.data.globalAnnounceEnabled !== newConfig.globalAnnounceEnabled
        || currentConfigOptions.data.localAnnounceEnabled !== newConfig.localAnnounceEnabled
        || currentConfigOptions.data.natEnabled !== newConfig.natEnabled
        || serviceHelper.ensureString(currentConfigOptions.data.listenAddresses) !== serviceHelper.ensureString(newConfig.listenAddresses)) {
        // patch our config
        await adjustConfigOptions('patch', newConfig);
      }
    }
    if (currentDefaultsFolderOptions.status === 'success') {
      if (currentDefaultsFolderOptions.data.syncOwnership !== newConfigDefaultFolders.syncOwnership
        || currentDefaultsFolderOptions.data.sendOwnership !== newConfigDefaultFolders.sendOwnership
        || currentDefaultsFolderOptions.data.syncXattrs !== newConfigDefaultFolders.syncXattrs
        || currentDefaultsFolderOptions.data.sendXattrs !== newConfigDefaultFolders.sendXattrs) {
        // patch our defaults folder config
        await adjustConfigDefaultsFolder('patch', newConfigDefaultFolders);
      }
    }
    // remove default folder
    const allFolders = await getConfigFolders();
    if (allFolders.status === 'success') {
      const defaultFolderExists = allFolders.data.find((syncthingFolder) => syncthingFolder.id === 'default');
      if (defaultFolderExists) {
        await adjustConfigFolders('delete', undefined, 'default');
      }
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
    const restartRequired = await getConfigRestartRequired();
    if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
      await systemRestart();
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

  const homedir = os.homedir();
  const configDir = path.join(homedir, '.config');
  const syncthingDir = path.join(configDir, 'syncthing');

  const user = os.userInfo().username;
  const owner = `${user}:${user}`;

  await serviceHelper.runCommand('mkdir', {
    params: ['-p', syncthingDir],
  });

  await serviceHelper.runCommand('chown', {
    runAsRoot: true,
    params: [owner, configDir],
  });

  await serviceHelper.runCommand('chown', {
    runAsRoot: true,
    params: [owner, syncthingDir],
  });
}

/**
 * Stops syncthing if it is running.
 * @returns {Promise<void>}
 */
async function stopSyncthing() {
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
  log.info('Syncthing sentinel stopped');
}

/**
 * Temporary function until moved over to Arcane
 * @param {boolean} installed If syncthing is installed
 * @returns {Promise<void>}
 */
async function ensureSyncthingRunning(installed) {
  if (installed && await getDeviceId()) return;

  log.error('Unable to get syncthing deviceId. Reconfiguring syncthing.');
  await stopSyncthing();
  await installSyncthingIdempotently();
  await configureDirectories();

  const homedir = os.homedir();
  const syncthingHome = path.join(homedir, '.config/syncthing');
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
    `sudo nohup syncthing --logfile ${logFile} --logflags=3 --log-max-old-files=2 --log-max-size=26214400 --allow-newer-config --no-browser --home ${syncthingHome} >/dev/null 2>&1 </dev/null &`,
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
    if (!isArcane) {
      await ensureSyncthingRunning(installed);
    }

    if (stc.aborted) return 0;

    // every 8 minutes call adjustSyncthing to check service folders
    // this will also run on first iteration
    if (stc.loopCount % 8 === 0) {
      stc.resetLoopCount();
      await adjustSyncthing();
    }

    return 60 * 1000;
  } catch (error) {
    if (error.name === 'AbortError') return 0;

    log.error(error);
    return 2 * 60 * 1000;
  } finally {
    stc.lock.disable();
  }
}

/**
 * Starts the main syncthing monitoring loop
 * @returns {<void>}
 */
async function startSyncthingSentinel() {
  while (!isArcane && !syncthingBinaryPresent) {
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
 * Test helper
 * @param {Boolean} value
 */
function setSyncthingRunningState(value) {
  syncthingStatusOk = value;
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

    // Collect system errors
    try {
      const errorsResponse = await performRequest('get', '/rest/system/error');
      if (errorsResponse.status === 'success' && errorsResponse.data?.errors) {
        metrics.errors.system = errorsResponse.data.errors;
        if (metrics.errors.system.length > 0) {
          metrics.overall.healthy = false;
          metrics.overall.issues.push(`${metrics.errors.system.length}`);
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
    const authorized = res ? await verificationHelper.verifyPrivilege('fluxteam', req) : true;
    let response = null;
    if (authorized === true) {
      const metrics = await collectSyncthingMetrics();
      response = messageHelper.createDataMessage(metrics);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
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
    const authorized = res ? await verificationHelper.verifyPrivilege('fluxteam', req) : true;
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
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
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
    const authorized = res ? await verificationHelper.verifyPrivilege('fluxteam', req) : true;
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
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Periodic metrics collection (called by sentinel or scheduler)
 * @returns {Promise<object|void>} Collected metrics or void
 */
async function collectAndSaveMetrics() {
  try {
    if (!syncthingStatusOk) {
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

module.exports = {
  startSyncthingSentinel,
  stopSyncthingSentinel,
  getDeviceId,
  getDeviceIdApi,
  getMeta,
  getHealth,
  statsDevice,
  statsFolder,
  systemBrowse,
  systemConnections,
  systemDiscovery,
  systemDebug,
  systemErrorClear,
  systemError,
  postSystemError,
  systemLog,
  systemLogTxt,
  systemPaths,
  systemPause,
  systemReset,
  systemResetFolderId,
  systemRestart,
  systemResume,
  systemShutdown,
  systemStatus,
  systemUpgrade,
  postSystemUpgrade,
  systemVersion,
  systemPing,
  syncthingController,
  // CONFIG
  getConfig,
  postConfig,
  getConfigRestartRequired,
  getConfigFolders,
  getConfigDevices,
  postConfigFolders,
  postConfigDevices,
  getConfigDefaultsFolder,
  getConfigDefaultsDevice,
  postConfigDefaultsFolder,
  postConfigDefaultsDevice,
  getConfigDefaultsIgnores,
  postConfigDefaultsIgnores,
  getConfigOptions,
  getConfigGui,
  getConfigLdap,
  postConfigOptions,
  postConfigGui,
  postConfigLdap,
  // Cluster
  getClusterPendigDevices,
  postClusterPendigDevices,
  getClusterPendigFolders,
  postClusterPendigFolders,
  // Folder
  getFolderIdErrors,
  getFolderErrors,
  getFolderVersions,
  postFolderVersions,
  // DATABASE ENDPOINTS
  getDbBrowse,
  getDbCompletion,
  getDbFile,
  getDbIgnores,
  getDbLocalchanged,
  getDbNeed,
  getDbRemoteNeed,
  getDbStatus,
  postDbIgnores,
  postDbOverride,
  postDbPrio,
  postDbRevert,
  dbRevert,
  postDbScan,
  // EVENTS
  getEvents,
  getEventsDisk,
  // MISC
  getSvcDeviceID,
  getSvcRandomString,
  getSvcReport,
  // DEBUG
  debugCpuprof,
  debugFile,
  debugHttpmetrics,
  debugHeapprof,
  debugPeerCompletion,
  debugSupport,
  // helpers
  adjustConfigFolders,
  adjustConfigDevices,
  // status
  isRunning,
  // testing exports
  getAxiosCache,
  configureDirectories,
  installSyncthingIdempotently,
  setSyncthingRunningState,
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
};
