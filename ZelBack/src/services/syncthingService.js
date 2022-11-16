const config = require('config');
const axios = require('axios');
const fs = require('fs');

const fsPromises = fs.promises;

const xmlToJson = require('./xmlToJson');
const messageHelper = require('./messageHelper');
const log = require('../lib/log');

const syncthingURL = `http://${config.syncthing.ip}:${config.syncthing.port}`;

let syncthingApiKey = '';

async function getConfigFile() {
  try {
    const result = await fsPromises.readFile('$HOME/.config/syncthing');
    console.log(result);
    return result;
  } catch (error) {
    log.error(error);
    return null;
  }
}

async function getSyncthingApiKey() { // can throw
  const fileRead = await getConfigFile();
  const xmlDOM = new DOMParser().parseFromString(fileRead, 'text/xml');
  const jsonConfig = xmlToJson.xmlToJson(xmlDOM);
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
  const response = await performRequest('get', '/meta.js');
  console.log(response);
  return res ? res.json(response) : response;
}

async function getHealth(req, res) {
  const response = await performRequest('get', '/rest/noauth/health');
  console.log(response);
  return res ? res.json(response) : response;
}

async function statsDevice(req, res) {
  const response = await performRequest('get', '/rest/stats/device');
  console.log(response);
  return res ? res.json(response) : response;
}

async function statsFolder(req, res) {
  const response = await performRequest('get', '/rest/stats/folder');
  console.log(response);
  return res ? res.json(response) : response;
}

module.exports = {
  getMeta,
  getHealth,
  statsDevice,
  statsFolder,
};
