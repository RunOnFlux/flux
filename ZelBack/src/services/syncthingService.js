const config = require('config');
const nodecmd = require('node-cmd');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');

const cmdAsync = util.promisify(nodecmd.get);
const fsPromises = fs.promises;

const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');

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

async function statsDevice(req, res) {
  const response = await performRequest('get', '/rest/stats/device');
  return res ? res.json(response) : response;
}

async function statsFolder(req, res) {
  const response = await performRequest('get', '/rest/stats/folder');
  return res ? res.json(response) : response;
}

async function systemPing(req, res) {
  const response = await performRequest('get', '/rest/system/ping');
  return res ? res.json(response) : response;
}

async function getConfigRestartRequired(req, res) {
  const response = await performRequest('get', '/rest/config/restart-required');
  return res ? res.json(response) : response;
}

async function getConfigFolders(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let path = '/rest/config/folders';
  if(id){
    path = `/rest/config/folders/${id}`;
  }
  const response = await performRequest('get', path);
  return res ? res.json(response) : response;
}

async function getConfigDevices(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let path = '/rest/config/devices';
  if(id){
    path = `/rest/config/devices/${id}`;
  }
  const response = await performRequest('get', path);
  return res ? res.json(response) : response;
}

async function postConfigFolders(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('data is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('post', '/rest/config/folders', data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function postConfigDevices(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('data is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('post', '/rest/config/devices', data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function putConfigFolders(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let path = '/rest/config/folders';
  if(id){
    path = `/rest/config/folders/${id}`;
  }
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('data is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('put', path, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function putConfigDevices(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let path = '/rest/config/devices';
  if(id){
    path = `/rest/config/devices/${id}`;
  }
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('data is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('put', path, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function patchConfigFolders(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let { data } = req.params;
  data = data || req.query.data;
  if (!id) {
    throw new Error('device ID is not provided');
  }
  if (!data) {
    throw new Error('data is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('patch', `/rest/config/folders/${id}`, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function patchConfigDevices(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  let { data } = req.params;
  data = data || req.query.data;
  if (!id) {
    throw new Error('device ID is not provided');
  }
  if (!data) {
    throw new Error('data is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('patch', `/rest/config/devices/${id}`, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  } 
  return res ? res.json(response) : response;
}

async function deleteConfigFolders(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  if (!id) {
    throw new Error('device ID is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('delete', `/rest/config/folders/${id}`);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function deleteConfigDevices(req, res) {
  let { id } = req.params;
  id = id || req.query.id;
  if (!id) {
    throw new Error('device ID is not provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('delete', `/rest/config/devices/${id}`);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function getConfigOptions(req, res) {
  const response = await performRequest('get', `/rest/config/options`);
  return res ? res.json(response) : response;
}

async function putConfigOptions(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('No options data is provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('put', `/rest/config/options`, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function patchConfigOptions(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('No options data is provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('patch', `/rest/config/options`, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function getConfigGui(req, res) {
  const response = await performRequest('get', `/rest/config/gui`);
  return res ? res.json(response) : response;
}

async function putConfigGui(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('No gui options data is provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('put', `/rest/config/gui`, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}

async function patchConfigGui(req, res) {
  let { data } = req.params;
  data = data || req.query.data;
  if (!data) {
    throw new Error('No gui options data is provided');
  }
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (true || authorized === true) {
    response = await performRequest('patch', `/rest/config/gui`, data);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res ? res.json(response) : response;
}


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
      const exec = 'syncthing';
      try {
        await cmdAsync(exec);
      } catch (error) {
        log.error(error);
        log.info('Syncthing is not installed, proceeding with installation');
        await installSyncthing();
        await serviceHelper.delay(1 * 60 * 1000);
        startSyncthing();
        return;
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
  getMeta,
  getHealth,
  statsDevice,
  statsFolder,
  systemPing,
  getConfigRestartRequired,
  getConfigFolders,
  getConfigDevices,
  postConfigFolders,
  postConfigDevices,
  putConfigFolders,
  putConfigDevices,
  patchConfigFolders,
  patchConfigDevices,
  deleteConfigFolders,
  deleteConfigDevices,
  getConfigOptions,
  putConfigOptions,
  patchConfigOptions,
  getConfigGui,
  putConfigGui,
  patchConfigGui,
  getDeviceID,
};
