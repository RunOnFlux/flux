const config = require('config');
const nodecmd = require('node-cmd');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
// const verificationHelper = require('./verificationHelper');
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

async function getConfigFile() {
  try {
    const homedir = os.homedir();
    const result = await fsPromises.readFile(`${homedir}/.config/syncthing/config.xml`, 'utf8');
    return result;
  } catch (error) {
    log.error(error);
    return null;
  }
}

async function getSyncthingApiKey() { // can throw
  const fileRead = await getConfigFile();
  if (!fileRead) {
    throw new Error('No Syncthing configuration found');
  }
  const jsonConfig = parser.parse(fileRead);
  const apiKey = jsonConfig.configuration.gui.apikey;
  return apiKey;
}

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

async function getMeta(req, res) {
  // does not require authentication
  const response = await performRequest('get', '/meta.js');
  // "var metadata = {\"deviceID\":\"K6VOO4G-5RLTF3B-JTUFMHH-JWITKGM-63DTTMT-I6BMON6-7E3LVFW-V5WAIAO\"};\n"
  return res ? res.json(response) : response;
}
async function getHealth(req, res) {
  const response = await performRequest('get', '/rest/noauth/health');
  return res ? res.json(response) : response;
}

// === STATISTICS ENDPOINTS ===
async function statsDevice(req, res) {
  const response = await performRequest('get', '/rest/stats/device');
  return res ? res.json(response) : response;
}

async function statsFolder(req, res) {
  const response = await performRequest('get', '/rest/stats/folder');
  return res ? res.json(response) : response;
}

// === SYSTEM ENDPOINTS ===
async function systemBrowse(req, res) {
  let { current } = req.params;
  current = current || req.query.current;
  let apiPath = 'rest/system/browse';
  if (current) {
    apiPath += `?current=${current}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
}

async function systemConnections(req, res) {
  const response = await performRequest('get', '/rest/system/connections');
  return res ? res.json(response) : response;
}

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
  const response = await performRequest(method, apiPath);
  return res ? res.json(response) : response;
}

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
  const response = await performRequest(method, apiPath);
  return res ? res.json(response) : response;
}

async function systemErrorClear(req, res) {
  const response = await performRequest('post', '/rest/system/error/clear');
  return res ? res.json(response) : response;
}

async function systemError(req, res) {
  let method = 'get';
  let { message } = req.params;
  message = message || req.query.message;
  const apiPath = 'rest/system/error';
  if (message) {
    method = 'post';
  }
  const response = await performRequest(method, apiPath, message);
  return res ? res.json(response) : response;
}

async function postSystemError(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const message = serviceHelper.ensureObject(body);
    try {
      const response = await performRequest('post', '/rest/system/error', message);
      return res ? res.json(response) : response;
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
      return res ? res.json(errorResponse) : errorResponse;
    }
  });
}

async function systemLog(req, res) {
  let { since } = req.params;
  since = since || req.query.since;
  let apiPath = 'rest/system/log';
  if (since) {
    apiPath += `?since=${since}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
}

async function systemLogTxt(req, res) {
  let { since } = req.params;
  since = since || req.query.since;
  let apiPath = 'rest/system/log.txt';
  if (since) {
    apiPath += `?since=${since}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
}

async function systemPaths(req, res) {
  const response = await performRequest('get', '/rest/system/paths');
  return res ? res.json(response) : response;
}

async function systemPause(req, res) {
  let { device } = req.params;
  device = device || req.query.device;
  let apiPath = 'rest/system/pause';
  if (device) {
    apiPath += `?device=${device}`;
  }
  const response = await performRequest('post', apiPath);
  return res ? res.json(response) : response;
}

async function systemPing(req, res) {
  const response = await performRequest('get', '/rest/system/ping'); // can also be 'post', same
  return res ? res.json(response) : response;
}

async function systemReset(req, res) {
  // note: scary call
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = 'rest/system/reset';
  if (folder) {
    apiPath += `?folder=${folder}`;
  }
  const response = await performRequest('post', apiPath);
  return res ? res.json(response) : response;
}

// restarts syncthing
async function systemRestart(req, res) {
  log.info('Restarting Syncthing...');
  const response = await performRequest('post', '/rest/system/restart');
  log.info('Syncthing restarted');
  return res ? res.json(response) : response;
}

async function systemResume(req, res) {
  let { device } = req.params;
  device = device || req.query.device;
  let apiPath = 'rest/system/pause';
  if (device) {
    apiPath += `?device=${device}`;
  }
  const response = await performRequest('post', apiPath);
  return res ? res.json(response) : response;
}

// shutsdown syncthing
async function systemShutdown(req, res) {
  const response = await performRequest('post', '/rest/system/shutdown');
  return res ? res.json(response) : response;
}

async function systemStatus(req, res) {
  const response = await performRequest('get', '/rest/system/status');
  return res ? res.json(response) : response;
}

async function systemUpgrade(req, res) {
  const response = await performRequest('get', '/rest/system/upgrade');
  return res ? res.json(response) : response;
}

async function postSystemUpgrade(req, res) {
  const response = await performRequest('post', '/rest/system/upgrade');
  return res ? res.json(response) : response;
}

async function systemVersion(req, res) {
  const response = await performRequest('get', '/rest/system/version');
  return res ? res.json(response) : response;
}

// === CONFIG ENDPOINTS ===
async function getConfig(req, res) {
  const response = await performRequest('get', '/rest/config');
  return res ? res.json(response) : response;
}

async function postConfig(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function getConfigRestartRequired(req, res) {
  const response = await performRequest('get', '/rest/config/restart-required');
  return res ? res.json(response) : response;
}

async function getConfigFolders(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let apiPath = '/rest/config/folders';
  if (id) {
    apiPath += `/${id}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
}

async function getConfigDevices(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let apiPath = '/rest/config/devices';
  if (id) {
    apiPath += `/${id}`;
  }
  const response = await performRequest('get', apiPath);
  return res ? res.json(response) : response;
}

async function postConfigFolders(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { id } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/config/folders';
      if (id) {
        apiPath += `/${id}`;
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postConfigDevices(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { id } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/config/devices';
      if (id) {
        apiPath += `/${id}`;
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function getConfigDefaultsFolder(req, res) {
  const response = await performRequest('get', '/rest/config/defaults/folder');
  return res ? res.json(response) : response;
}

async function getConfigDefaultsDevice(req, res) {
  const response = await performRequest('get', '/rest/config/defaults/device');
  return res ? res.json(response) : response;
}

async function postConfigDefaultsFolder(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const method = (processedBody.method || 'put').toLowerCase();
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
      let response = null;
      if (authorized === true) {
        response = await performRequest(method, '/rest/config/defaults/folder', newConfig);
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

async function postConfigDefaultsDevice(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const method = (processedBody.method || 'put').toLowerCase();
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function getConfigDefaultsIgnores(req, res) {
  const response = await performRequest('get', '/rest/config/defaults/ignores');
  return res ? res.json(response) : response;
}

async function postConfigDefaultsIgnores(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const method = 'put';
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function getConfigOptions(req, res) {
  const response = await performRequest('get', '/rest/config/options');
  return res ? res.json(response) : response;
}

async function getConfigGui(req, res) {
  const response = await performRequest('get', '/rest/config/gui');
  return res ? res.json(response) : response;
}

async function getConfigLdap(req, res) {
  const response = await performRequest('get', '/rest/config/ldap');
  return res ? res.json(response) : response;
}

async function adjustConfigOptions(method, newConfig) {
  log.info('Patching Syncthing configuration...');
  const response = await performRequest(method, '/rest/config/options', newConfig);
  log.info('Syncthing configuration patched...');
  return response;
}

async function postConfigOptions(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const method = (processedBody.method || 'put').toLowerCase();
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postConfigGui(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const method = (processedBody.method || 'put').toLowerCase();
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postConfigLdap(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const method = (processedBody.method || 'put').toLowerCase();
    try {
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function getClusterPendigDevices(req, res) {
  const response = await performRequest('get', '/rest/cluster/pending/devices');
  return res ? res.json(response) : response;
}

async function postClusterPendigDevices(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { device } = processedBody;
    const method = (processedBody.method || 'delete').toLowerCase();
    try {
      let apiPath = '/rest/cluster/pending/devices';
      if (device) {
        apiPath += `?device=${device}`;
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function getClusterPendigFolders(req, res) {
  const response = await performRequest('get', '/rest/cluster/pending/folders');
  return res ? res.json(response) : response;
}

async function postClusterPendigFolders(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const method = (processedBody.method || 'delete').toLowerCase();
    try {
      let apiPath = '/rest/cluster/pending/folders';
      if (folder) {
        apiPath += `?folder=${folder}`;
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function folderErrors(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/folder/errors';
  try {
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

async function folderVersions(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/folder/versions';
  try {
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

async function postFolderVersions(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/folder/versions';
      if (folder) {
        apiPath += `?folder=${folder}`;
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function dbBrowse(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let { levels } = req.params;
  levels = levels || req.query.levels;
  let { prefix } = req.params;
  prefix = prefix || req.query.prefix;
  let apiPath = '/rest/db/browse';
  try {
    if (folder) {
      apiPath += `?folder=${folder}`;
    } else {
      throw new Error('folder parameter is mandatory');
    }
    if (levels) apiPath += `&levels=${levels}`;
    if (prefix) apiPath += `&prefix=${prefix}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function dbCompletion(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let { device } = req.params;
  device = device || req.query.device;
  let apiPath = '/rest/db/completion';
  try {
    if (folder || device) apiPath += '?';
    if (folder) apiPath += `folder=${folder}&`;
    if (device) apiPath += `device=${device}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function dbFile(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let { file } = req.params;
  file = file || req.query.file;
  let apiPath = '/rest/db/file';
  try {
    if (folder || file) apiPath += '?';
    if (folder) apiPath += `folder=${folder}&`;
    if (file) apiPath += `device=${file}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function dbIgnores(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/db/ignores';
  try {
    if (folder) apiPath += `?folder=${folder}`;
    const response = await performRequest('get', apiPath);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function dbLocalchanged(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/db/localchanged';
  try {
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

async function dbNeed(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/db/need';
  try {
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

async function dbRemoteNeed(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let { device } = req.params;
  device = device || req.query.device;
  let apiPath = '/rest/db/remoteneed';
  try {
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

async function dbStatus(req, res) {
  let { folder } = req.params;
  folder = folder || req.query.folder;
  let apiPath = '/rest/db/status';
  try {
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

async function postDbIgnores(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/db/ignores';
      if (folder) {
        apiPath += `?folder=${folder}`;
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postDbOverride(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/db/override';
      if (folder) {
        apiPath += `?folder=${folder}`;
      } else {
        throw new Error('folder parameter is mandatory');
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postDbPrio(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const { file } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
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
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postDbRevert(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/db/revert';
      if (folder) {
        apiPath += `?folder=${folder}`;
      } else {
        throw new Error('folder parameter is mandatory');
      }
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

async function postDbScan(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const newConfig = processedBody.config;
    const { folder } = processedBody;
    const { sub } = processedBody;
    const { next } = processedBody;
    const method = (processedBody.method || 'post').toLowerCase();
    try {
      let apiPath = '/rest/db/scan?';
      if (folder) apiPath += `folder=${folder}&`;
      if (sub) apiPath += `sub=${sub}&`;
      if (next) apiPath += `next=${next}`;
      const authorized = true; // await verificationHelper.verifyPrivilege('adminandfluxteam', req);
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

// === CUSTOM ===
// our device id and also test that syncthing is installed and running and we have api key
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

async function installSyncthing() { // can throw
  const nodedpath = path.join(__dirname, '../../../helpers');
  const exec = `cd ${nodedpath} && bash installSyncthing.sh`;
  await cmdAsync(exec);
  log.info('Syncthing installed');
}

async function startSyncthing() {
  try {
    // check wether syncthing is running or not
    const myDevice = await getDeviceID();
    if (myDevice.status === 'error') {
      const exec = 'syncthing --allow-newer-config --no-browser';
      try {
        log.info('Spawning Syncthing instance...');
        cmdAsync(exec);
        await serviceHelper.delay(30 * 1000);
        startSyncthing();
        return;
      } catch (error) {
        log.error(error);
        log.info('Syncthing is not installed, proceeding with installation');
        await installSyncthing();
        await serviceHelper.delay(1 * 60 * 1000);
        startSyncthing();
        return;
      }
    } else {
      const currentConfigOptions = await getConfigOptions();
      const apiPort = userconfig.initial.apiport || config.server.apiport;
      const myPort = apiPort + 2; // end with 9 eg 16139
      // adjust configuration
      const newConfig = {
        globalAnnounceEnabled: false,
        localAnnounceEnabled: false,
        listenAddresses: [`tcp://:${myPort}`, `quic://:${myPort}`],
      };
      if (currentConfigOptions.status === 'success') {
        if (currentConfigOptions.data.globalAnnounceEnabled !== newConfig.globalAnnounceEnabled
          || currentConfigOptions.data.localAnnounceEnabled !== newConfig.localAnnounceEnabled
          || currentConfigOptions.data.listenAddresses !== newConfig.listenAddresses) {
          // patch our config
          await adjustConfigOptions('patch', newConfig);
          const restartRequired = await getConfigRestartRequired();
          if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
            await systemRestart();
          }
        }
      }
    }
    await serviceHelper.delay(8 * 60 * 1000);
    startSyncthing();
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
  folderErrors,
  folderVersions,
  postFolderVersions,
  // DATABASE ENDPOINTS
  dbBrowse,
  dbCompletion,
  dbFile,
  dbIgnores,
  dbLocalchanged,
  dbNeed,
  dbRemoteNeed,
  dbStatus,
  postDbIgnores,
  postDbOverride,
  postDbPrio,
  postDbRevert,
  postDbScan,
};
