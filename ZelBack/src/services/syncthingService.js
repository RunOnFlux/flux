const config = require('config');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const os = require('os');

const fsPromises = fs.promises;

const messageHelper = require('./messageHelper');
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

async function performRequest(method = 'get', path = '', data) {
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
    const response = await instance[method](path, data);
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

// our device id and also test that syncthing is installed and running and we have api key
async function getDeviceID(req, res) {
  try {
    const meta = await getMeta();
    const healthy = await getHealth(); // check that syncthing instance is healthy
    const pingResponse = await systemPing(); // check that flux has proper api key
    if (meta.status === 'success' && pingResponse.data.ping === 'pong' && healthy.data.status === 'OK') {
      const adjustedString = meta.data.slice(15).slice(0, -2);
      const deviceObject = JSON.parse(adjustedString);
      const successResponse = messageHelper.createDataMessage(deviceObject);
      return res ? res.json(successResponse) : successResponse;
    }
    throw new Error('Syncthing is not running properly');
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return errorResponse;
  }
}

module.exports = {
  getMeta,
  getHealth,
  statsDevice,
  statsFolder,
  systemPing,
  getDeviceID,
};
