const config = require('config');
const nodecmd = require('node-cmd');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const qs = require('qs');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies

const cmdAsync = util.promisify(nodecmd.get);
const fsPromises = fs.promises;

const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const syncthingURL = `http://${config.syncthing.ip}:${config.syncthing.port}`;

let syncthingApiKey = '';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
};
const parser = new XMLParser(parserOptions);

/**
 * To get syncthing config xml file
 * @returns {string} config gile (XML).
 */
async function getConfigFile() {
  try {
    const homedir = os.homedir();
    // fs may fail to read that as of eaccess
    // change permissions of the file first so we can read it and get api key properly
    const execDIRown = 'sudo chown $USER:$USER $HOME/.config'; // adjust .config folder for ownership of running user
    await cmdAsync(execDIRown).catch((error) => log.error(error));
    const execDIRownSyncthing = 'sudo chown $USER:$USER $HOME/.config/syncthing'; // adjust .config/syncthing folder for ownership of running user
    await cmdAsync(execDIRownSyncthing).catch((error) => log.error(error));
    const execPERM = `sudo chmod 644 ${homedir}/.config/syncthing/config.xml`;
    await cmdAsync(execPERM);
    const result = await fsPromises.readFile(`${homedir}/.config/syncthing/config.xml`, 'utf8');
    return result;
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * To get syncthing Api key
 * @returns {string} Api key.
 */
async function getSyncthingApiKey() { // can throw
  const fileRead = await getConfigFile();
  if (!fileRead) {
    throw new Error('No Syncthing configuration found');
  }
  const jsonConfig = parser.parse(fileRead);
  const apiKey = jsonConfig.configuration.gui.apikey;
  return apiKey;
}

/**
 * To perform http request
 * @param {string} method Method.
 * @param {string} urlpath URL to be called.
 * @param {object} data Request data.
 * @returns {object} Message.
 */
async function performRequest(method = 'get', urlpath = '', data) {
  try {
    if (!syncthingApiKey) {
      const apiKey = await getSyncthingApiKey();
      syncthingApiKey = apiKey;
    }
    const instance = axios.create({
      baseURL: syncthingURL,
      timeout: 5000,
      headers: {
        'X-API-Key': syncthingApiKey,
      },
    });
    const response = await instance[method](urlpath, data);
    const successResponse = messageHelper.createDataMessage(response.data);
    return successResponse;
  } catch (error) {
    log.error(error);
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
  let apiPath = 'rest/system/browse';
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
  let apiPath = 'rest/system/debug';
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
  let apiPath = 'rest/system/discovery';
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
  const apiPath = 'rest/system/error';
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
  let apiPath = 'rest/system/log';
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
  let apiPath = 'rest/system/log.txt';
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
  let apiPath = 'rest/system/pause';
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
  let apiPath = 'rest/system/reset';
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
  let apiPath = 'rest/system/pause';
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
  const response = await performRequest('get', '/rest/config/gui');
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
 * Returns the list of errors encountered during scanning or pulling. Takes one mandatory parameter {folder}
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getFolderErrors(req, res) {
  try {
    let { folder } = req.params;
    folder = folder || req.query.folder;
    let apiPath = '/rest/folder/errors';
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
    apiPath += `?${qqStr};`;
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
    apiPath += `${qqStr};`;
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
    apiPath += `${qqStr};`;
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
    let { folder } = req.params;
    folder = folder || req.query.folder;
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
      apiPath += `${qqStr};`;
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
  const response = await performRequest('get', '/rest/debug/peerCompletion');
  return res ? res.json(response) : response;
}

/**
 * Returns statistics about each served REST API endpoint, to diagnose how much time was spent generating the responses.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugHttpmetrics(req, res) {
  const response = await performRequest('get', '/rest/debug/httpmetrics');
  return res ? res.json(response) : response;
}

/**
 * To capture a profile of what Syncthing is doing on the CPU
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugCpuprof(req, res) {
  const response = await performRequest('get', '/rest/debug/cpuprof');
  return res ? res.json(response) : response;
}

/**
 * To capture a profile of what Syncthing is doing with the heap memory.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugHeapprof(req, res) {
  const response = await performRequest('get', '/rest/debug/heapprof');
  return res ? res.json(response) : response;
}

/**
 * To Collect information about the running instance for troubleshooting purposes.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function debugSupport(req, res) {
  const response = await performRequest('get', '/rest/debug/support');
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
    const response = await performRequest('get', apiPath);
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
    apiPath += `${qqStr};`;
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
    apiPath += `${qqStr};`;
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
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message
 */
async function getDeviceID(req, res) {
  try {
    const meta = await getMeta();
    const healthy = await getHealth(); // check that syncthing instance is healthy
    const pingResponse = await systemPing(); // check that flux has proper api key
    if (meta.status === 'success' && pingResponse.data.ping === 'pong' && healthy.data.status === 'OK') {
      const adjustedString = meta.data.slice(15).slice(0, -2);
      const deviceObject = JSON.parse(adjustedString);
      const { deviceID } = deviceObject;
      const successResponse = messageHelper.createDataMessage(deviceID);
      return res ? res.json(successResponse) : successResponse;
    }
    throw new Error('Syncthing is not running properly');
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To install Syncthing
 */
async function installSyncthing() { // can throw
  const nodedpath = path.join(__dirname, '../../../helpers');
  const exec = `cd ${nodedpath} && bash installSyncthing.sh`;
  await cmdAsync(exec);
  log.info('Syncthing installed');
}

/**
 * To Start Syncthing
 */
async function startSyncthing() {
  try {
    // check wether syncthing is running or not
    const myDevice = await getDeviceID();
    if (myDevice.status === 'error') {
      const execDIRcr = 'mkdir -p $HOME/.config'; // create .config folder first for it to have standard user ownership. With -p no error will be thrown in case of exists
      await cmdAsync(execDIRcr).catch((error) => log.error(error));
      const execDIRown = 'sudo chown $USER:$USER $HOME/.config'; // adjust .config folder for ownership of running user
      await cmdAsync(execDIRown).catch((error) => log.error(error));
      const execDIRownSyncthing = 'sudo chown $USER:$USER $HOME/.config/syncthing'; // adjust .config/syncthing folder for ownership of running user
      await cmdAsync(execDIRownSyncthing).catch((error) => log.error(error));
      // need sudo to be able to read/write properly
      const execKill = 'sudo killall syncthing';
      const execKillB = 'sudo pkill syncthing';
      await serviceHelper.delay(10 * 1000);
      await cmdAsync(execKill).catch((error) => log.error(error));
      await cmdAsync(execKillB).catch((error) => log.error(error));
      const exec = 'sudo syncthing --allow-newer-config --no-browser --home=$HOME/.config/syncthing';
      log.info('Spawning Syncthing instance...');
      let errored = false;
      nodecmd.get(exec, async (err) => {
        if (err) {
          errored = true;
          log.error(err);
          log.info('Syncthing is not installed, proceeding with installation');
        }
      });
      await serviceHelper.delay(30 * 1000);
      if (errored) {
        await installSyncthing();
        await serviceHelper.delay(60 * 1000);
      }
      startSyncthing();
    } else {
      const currentConfigOptions = await getConfigOptions();
      const currentDefaultsFolderOptions = await getConfigDefaultsFolder();
      const apiPort = userconfig.initial.apiport || config.server.apiport;
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
      const restartRequired = await getConfigRestartRequired();
      if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
        await systemRestart();
      }
      await serviceHelper.delay(8 * 60 * 1000);
      startSyncthing();
    }
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(2 * 60 * 1000);
    startSyncthing();
  }
}

module.exports = {
  startSyncthing,
  getDeviceID,
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
  systemRestart,
  systemResume,
  systemShutdown,
  systemStatus,
  systemUpgrade,
  postSystemUpgrade,
  systemVersion,
  systemPing,
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
};
