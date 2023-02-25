/* eslint-disable no-underscore-dangle */
const config = require('config');
const zeltrezjs = require('zeltrezjs');
const nodecmd = require('node-cmd');
const fs = require('fs').promises;
const path = require('path');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
// eslint-disable-next-line import/no-extraneous-dependencies
const net = require('net');
const LRU = require('lru-cache');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const daemonServiceZelnodeRpcs = require('./daemonService/daemonServiceZelnodeRpcs');
const daemonServiceBenchmarkRpcs = require('./daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceWalletRpcs = require('./daemonService/daemonServiceWalletRpcs');
const benchmarkService = require('./benchmarkService');
const verificationHelper = require('./verificationHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const userconfig = require('../../../config/userconfig');
const {
  outgoingConnections, outgoingPeers, incomingPeers, incomingConnections,
} = require('./utils/establishedConnections');

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

let storedFluxBenchAllowed = null;

// my external Flux IP from benchmark
let myFluxIP = null;

let response = messageHelper.createErrorMessage();

const axiosConfig = {
  timeout: 5000,
};

const buckets = new Map();

class TokenBucket {
  constructor(capacity, fillPerSecond) {
    this.capacity = capacity;
    this.fillPerSecond = fillPerSecond;

    this.lastFilled = new Date().getTime();
    this.tokens = capacity;
  }

  take() {
    // Calculate how many tokens (if any) should have been added since the last request
    this.refill();

    if (this.tokens > 0) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  refill() {
    const now = new Date().getTime();
    const rate = (now - this.lastFilled) / (this.fillPerSecond * 1000);

    this.tokens = Math.min(this.capacity, this.tokens + Math.floor(rate * this.capacity));
    this.lastFilled = now;
  }
}

/**
 * Check if semantic version is bigger or equal to minimum version
 * @param {string} version Version to check
 * @param {string} minimumVersion minimum version that version must meet
 * @returns {boolean} True if version is equal or higher to minimum version otherwise false.
 */
function minVersionSatisfy(version, minimumVersion) {
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

/**
 * To perform a basic check if port on an ip is opened
 * This requires our port to be also open on out
 * @param {string} ip IP address.
 * @param {number} port Port.
 * @param {string} app Application name. Mostly for comsetic purposes, can be boolean. Defaults to undefined, as for testing main FluxOS not an app.
 * @param {number} timeout Timeout in ms.
 * @returns {boolean} Returns true if opened, otherwise false
 */
async function isPortOpen(ip, port, app, timeout = 5000) {
  let resp;
  try {
    let portResponse = true;
    // open port first
    // eslint-disable-next-line no-use-before-define
    resp = await allowOutPort(port).catch((error) => { // requires allow out for apps checking, for our ports both
      log.error(error);
    });
    if (!resp) {
      resp = {};
    }

    const promise = new Promise(((resolve, reject) => {
      const socket = new net.Socket();

      const onError = (err) => {
        socket.destroy();
        if (err.code && err.code === 'ETIMEDOUT') {
          log.info(`Connection on ${ip}:${port} ETIMEDOUT. Flux or Flux App is not running correctly`);
          reject();
        } else if (app) {
          resolve();
        } else if (port === 16129) {
          log.error(`Syncthing of Flux on ${ip}:${port} did not respond correctly but may be in use. Allowing`);
          log.error(err);
          resolve();
        } else {
          log.error(`Flux on ${ip}:${port} is not working correctly`);
          log.error(err);
          reject();
        }
      };

      const onTimeout = () => {
        log.error(`Connection on ${ip}:${port} timed out. Flux or Flux App is not running correctly`);
        socket.destroy();
        reject();
      };

      socket.setTimeout(timeout);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);

      socket.connect(port, ip, () => {
        socket.destroy();
        portResponse = 'listening';
        resolve();
      });
    }));
    await promise;
    setTimeout(() => { // timeout ensure return first
      if (app) {
        // delete the rule
        if (resp.message !== 'existing') { // new or updated rule
          // eslint-disable-next-line no-use-before-define
          deleteAllowOutPortRule(port); // no need waiting for response. Delete if was not present before to not create huge firewall list
        }
      }
    }, 10);
    return portResponse; // true for OK port. listening for port that is being listened to
  } catch (error) {
    setTimeout(() => { // timeout ensure return first
      if (app) {
        // delete the rule
        if (resp.message !== 'existing') { // new or updated rule
          // eslint-disable-next-line no-use-before-define
          deleteAllowOutPortRule(port); // no need waiting for response. Delete if was not present before to not create huge firewall list
        }
      }
    }, 10);
    return false;
  }
}

/**
 * To perform a basic check of current FluxOS version.
 * @param {string} ip IP address.
 * @param {string} port Port. Defaults to config.server.apiport.
 * @returns {boolean} False unless FluxOS version meets or exceeds the minimum allowed version.
 */
async function isFluxAvailable(ip, port = config.server.apiport) {
  try {
    const ipchars = /^[1-9.]+$/;
    if (!ipchars.test(ip)) {
      throw new Error('Invalid IP');
    }
    if (!config.server.allowedPorts.includes(+port)) {
      throw new Error('Invalid Port');
    }
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${port}/flux/version`, axiosConfig);
    if (fluxResponse.data.status !== 'success') return false;

    const fluxVersion = fluxResponse.data.data;
    const versionMinOK = minVersionSatisfy(fluxVersion, config.minimumFluxOSAllowedVersion);
    if (!versionMinOK) return false;

    const homePort = +port - 1;
    const fluxResponseUI = await serviceHelper.axiosGet(`http://${ip}:${homePort}`, axiosConfig);
    const UIok = fluxResponseUI.data.includes('<title>');
    if (!UIok) return false;

    const syncthingPort = +port + 2;
    const syncthingOpen = await isPortOpen(ip, syncthingPort);
    if (!syncthingOpen) return false;

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * To check Flux availability for specific IP address/port.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function checkFluxAvailability(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  let { port } = req.params;
  port = port || req.query.port;
  if (ip === undefined || ip === null) {
    const errMessage = messageHelper.createErrorMessage('No ip specified.');
    return res.json(errMessage);
  }

  const available = await isFluxAvailable(ip, port);

  if (available === true) {
    const message = messageHelper.createSuccessMessage('Asking Flux is available');
    response = message;
  } else {
    const message = messageHelper.createErrorMessage('Asking Flux is not available');
    response = message;
  }
  return res.json(response);
}

/**
 * To get app price.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function checkAppAvailability(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

      const processedBody = serviceHelper.ensureObject(body);

      const {
        ip, ports, appname, pubKey, signature,
      } = processedBody;

      const ipPort = processedBody.port;

      // pubkey of the message has to be on the list
      const zl = await fluxCommunicationUtils.deterministicFluxList(pubKey); // this itself is sufficient.
      const node = zl.find((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
      const dataToVerify = processedBody;
      delete dataToVerify.signature;
      const messageToVerify = JSON.stringify(dataToVerify);
      const verified = verificationHelper.verifyMessage(messageToVerify, pubKey, signature);
      if ((verified !== true || !node) && authorized !== true) {
        log.error('Unable to verify request authenticity');
        // throw new Error('Unable to verify request authenticity');
      }

      const portsListening = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        if (+port >= (config.fluxapps.portMin - 1000) && +port <= config.fluxapps.portMax) {
        // eslint-disable-next-line no-await-in-loop
          const isOpen = await isPortOpen(ip, port, appname, 30000);
          if (!isOpen) {
            throw new Error(`Flux Applications on ${ip}:${ipPort} are not available.`);
          } else if (isOpen === 'listening') { // this port is in use and listening. Later do check from other node on this port
            portsListening.push(+port);
          }
        } else {
          log.error(`Flux App port ${port} is outside allowed range.`);
        }
      }
      // if ip is my if, do a data response with ports that are listening
      const dataResponse = messageHelper.createDataMessage(portsListening);
      // eslint-disable-next-line no-use-before-define
      let myIP = await getMyFluxIPandPort();
      myIP = myIP.split(':')[0];
      if (ip === myIP) {
        res.json(dataResponse);
        return;
      }
      const successResponse = messageHelper.createSuccessMessage(`Flux Application on ${ip}:${ipPort} are available.`);
      res.json(successResponse);
    } catch (error) {
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Setter for myFluxIp.
 * Main goal for this is testing availability.
 *
 * @param {string} value new IP to be set
 */
function setMyFluxIp(value) {
  myFluxIP = value;
}

/**
 * Setter for dosMessage.
 * Main goal for this is testing availability.
 *
 * @param {string} message New message
 */
function setDosMessage(message) {
  dosMessage = message;
}

/**
 * Getter for dosMessage.
 * Main goal for this is testing availability.
 *
 * @returns {string} dosMessage
 */
function getDosMessage() {
  return dosMessage;
}

/**
 * Setter for dosState.
 * Main goal for this is testing availability.
 *
 * @param {number} sets dosState
 */
function setDosStateValue(value) {
  dosState = value;
}

/**
 * Getter for dosState.
 * Main goal for this is testing availability.
 *
 * @returns {number} dosState
 */
function getDosStateValue() {
  return dosState;
}

/**
 * To get Flux IP adress and port.
 * @returns {string} IP address and port.
 */
async function getMyFluxIPandPort() {
  const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  }
  setMyFluxIp(myIP);
  return myIP;
}

/**
 * To get FluxNode private key.
 * @param {string} privatekey Private Key.
 * @returns {string} Private key, if already input as parameter or otherwise from the daemon config.
 */
async function getFluxNodePrivateKey(privatekey) {
  const privKey = privatekey || daemonServiceUtils.getConfigValue('zelnodeprivkey');
  return privKey;
}

/**
 * To get FluxNode public key.
 * @param {string} privatekey Private key.
 * @returns {string} Public key.
 */
async function getFluxNodePublicKey(privatekey) {
  try {
    const pkWIF = await getFluxNodePrivateKey(privatekey);
    const privateKey = zeltrezjs.address.WIFToPrivKey(pkWIF);
    const pubKey = zeltrezjs.address.privKeyToPubKey(privateKey, false);
    return pubKey;
  } catch (error) {
    return error;
  }
}

/**
 * To get a random connection.
 * @returns {string} IP:Port or just IP if default.
 */
async function getRandomConnection() {
  const nodeList = await fluxCommunicationUtils.deterministicFluxList();
  const zlLength = nodeList.length;
  if (zlLength === 0) {
    return null;
  }
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const ip = nodeList[randomNode].ip || nodeList[randomNode].ipaddress;
  const apiPort = userconfig.initial.apiport || config.server.apiport;

  if (!ip || !myFluxIP || ip === userconfig.initial.ipaddress || ip === myFluxIP || ip === `${userconfig.initial.ipaddress}:${apiPort}` || ip.split(':')[0] === myFluxIP.split(':')[0]) {
    return null;
  }
  return ip;
}

/**
 * To close an outgoing connection.
 * @param {string} ip IP address.
 * @returns {object} Message.
 */
async function closeConnection(ip) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  const wsObj = outgoingConnections.find((client) => client._socket.remoteAddress === ip);
  if (!wsObj) {
    return messageHelper.createWarningMessage(`Connection to ${ip} does not exists.`);
  }
  const ocIndex = outgoingConnections.indexOf(wsObj);
  const foundPeer = outgoingPeers.find((peer) => peer.ip === ip);
  if (ocIndex === -1) {
    return messageHelper.createErrorMessage(`Unable to close connection ${ip}. Try again later.`);
  }
  wsObj.close(1000, 'purpusfully closed');
  log.info(`Connection to ${ip} closed`);
  outgoingConnections.splice(ocIndex, 1);
  if (foundPeer) {
    const peerIndex = outgoingPeers.indexOf(foundPeer);
    if (peerIndex > -1) {
      outgoingPeers.splice(peerIndex, 1);
    }
  }
  return messageHelper.createSuccessMessage(`Outgoing connection to ${ip} closed`);
}

/**
 * To close an incoming connection.
 * @param {string} ip IP address.
 * @param {object} expressWS Express web socket.
 * @param {object} clientToClose Web socket for client to close.
 * @returns {object} Message.
 */
async function closeIncomingConnection(ip, expressWS, clientToClose) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  const clientsSet = expressWS.clients || [];
  let wsObj = null || clientToClose;
  clientsSet.forEach((client) => {
    if (client._socket.remoteAddress === ip) {
      wsObj = client;
    }
  });
  if (!wsObj) {
    return messageHelper.createWarningMessage(`Connection from ${ip} does not exists.`);
  }
  const ocIndex = incomingConnections.indexOf(wsObj);
  const foundPeer = incomingPeers.find((peer) => peer.ip === ip);
  if (ocIndex === -1) {
    return messageHelper.createErrorMessage(`Unable to close incoming connection ${ip}. Try again later.`);
  }
  wsObj.close(1000, 'purpusfully closed');
  log.info(`Connection from ${ip} closed`);
  incomingConnections.splice(ocIndex, 1);
  if (foundPeer) {
    const peerIndex = incomingPeers.indexOf(foundPeer);
    if (peerIndex > -1) {
      incomingPeers.splice(peerIndex, 1);
    }
  }
  return messageHelper.createSuccessMessage(`Incoming connection to ${ip} closed`);
}

/**
 * To check rate limit.
 * @param {string} ip IP address.
 * @param {number} fillPerSecond Defaults to value of 10.
 * @param {number} maxBurst Defaults to value of 15.
 * @returns {boolean} True if a token is taken from the IP's token bucket. Otherwise false.
 */
function checkRateLimit(ip, fillPerSecond = 10, maxBurst = 15) {
  if (!buckets.has(ip)) {
    buckets.set(ip, new TokenBucket(maxBurst, fillPerSecond));
  }

  const bucketForIP = buckets.get(ip);

  if (bucketForIP.take()) {
    return true;
  }
  return false;
}

/**
 * To get IP addresses for incoming connections.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {object} expressWS Express web socket.
 */
function getIncomingConnections(req, res, expressWS) {
  const clientsSet = expressWS.clients;
  const connections = [];
  clientsSet.forEach((client) => {
    connections.push(client._socket.remoteAddress);
  });
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

/**
 * To get info for incoming connections.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function getIncomingConnectionsInfo(req, res) {
  const connections = incomingPeers;
  const message = messageHelper.createDataMessage(connections);
  response = message;
  return res ? res.json(response) : response;
}

/**
 * Setter for storedFluxBenchAllowed.
 * Main goal for this is testing availability.
 *
 * @param {number} value
 */
function setStoredFluxBenchAllowed(value) {
  storedFluxBenchAllowed = value;
}

/**
 * Getter for storedFluxBenchAllowed.
 * Main goal for this is testing availability.
 *
 * @returns {number} storedFluxBenchAllowed
 */
function getStoredFluxBenchAllowed() {
  return storedFluxBenchAllowed;
}

/**
 * To check if Flux benchmark version is allowed.
 * @returns {boolean} True if version is verified as allowed. Otherwise false.
 */
async function checkFluxbenchVersionAllowed() {
  if (storedFluxBenchAllowed) {
    const versionOK = minVersionSatisfy(storedFluxBenchAllowed, config.minimumFluxBenchAllowedVersion);
    return versionOK;
  }
  try {
    const benchmarkInfoResponse = await benchmarkService.getInfo();
    if (benchmarkInfoResponse.status === 'success') {
      log.info(benchmarkInfoResponse);
      const benchmarkVersion = benchmarkInfoResponse.data.version;
      setStoredFluxBenchAllowed(benchmarkVersion);
      const versionOK = minVersionSatisfy(benchmarkVersion, config.minimumFluxBenchAllowedVersion);
      if (versionOK) {
        return true;
      }
      dosState += 11;
      setDosMessage(`Fluxbench Version Error. Current lower version allowed is v${config.minimumFluxBenchAllowedVersion} found v${benchmarkVersion}`);
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    setDosMessage('Fluxbench Version Error. Error obtaining FluxBench Version.');
    log.error(dosMessage);
    return false;
  } catch (err) {
    log.error(err);
    log.error(`Error on checkFluxBenchVersion: ${err.message}`);
    dosState += 2;
    setDosMessage('Fluxbench Version Error. Error obtaining Flux Version.');
    return false;
  }
}

/**
 * To get node uptime in seconds
 * @param {object} req Request.
 * @param {object} res Response.
 */
function fluxUptime(req, res) {
  let message;
  try {
    const ut = process.uptime();
    const measureUptime = Math.floor(ut);
    message = messageHelper.createDataMessage(measureUptime);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    message = messageHelper.createErrorMessage('Error obtaining uptime');
    return res ? res.json(message) : message;
  }
}

/**
 * To check if sufficient communication is established. Minimum number of outgoing and incoming peers must be met.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function isCommunicationEstablished(req, res) {
  let message;
  if (outgoingPeers.length < config.fluxapps.minOutgoing) { // easier to establish
    message = messageHelper.createErrorMessage(`Not enough outgoing connections established to Flux network. Minimum required ${config.fluxapps.minOutgoing} found ${outgoingPeers.length}`);
  } else if (incomingPeers.length < config.fluxapps.minIncoming) { // depends on other nodes successfully connecting to my node, todo enforcement
    message = messageHelper.createErrorMessage(`Not enough incoming connections from Flux network. Minimum required ${config.fluxapps.minIncoming} found ${incomingPeers.length}`);
  } else {
    message = messageHelper.createSuccessMessage('Communication to Flux network is properly established');
  }
  return res ? res.json(message) : message;
}

/**
 * To check user's FluxNode availability.
 * @param {number} retryNumber Number of retries.
 * @returns {boolean} True if all checks passed.
 */
async function checkMyFluxAvailability(retryNumber = 0) {
  const fluxBenchVersionAllowed = await checkFluxbenchVersionAllowed();
  if (!fluxBenchVersionAllowed) {
    return false;
  }
  let askingIP = await getRandomConnection();
  if (typeof askingIP !== 'string' || typeof myFluxIP !== 'string' || myFluxIP === askingIP) {
    return false;
  }
  let askingIpPort = config.server.apiport;
  if (askingIP.includes(':')) { // has port specification
    // it has port specification
    const splittedIP = askingIP.split(':');
    askingIP = splittedIP[0];
    askingIpPort = splittedIP[1];
  }
  let myIP = myFluxIP;
  if (myIP.includes(':')) { // has port specification
    myIP = myIP.split(':')[0];
  }
  let availabilityError = null;
  const axiosConfigAux = {
    timeout: 7000,
  };
  const apiPort = userconfig.initial.apiport || config.server.apiport;
  const resMyAvailability = await serviceHelper.axiosGet(`http://${askingIP}:${askingIpPort}/flux/checkfluxavailability?ip=${myIP}&port=${apiPort}`, axiosConfigAux).catch((error) => {
    log.error(`${askingIP} is not reachable`);
    log.error(error);
    availabilityError = true;
  });
  if (!resMyAvailability || availabilityError) {
    dosState += 2;
    if (dosState > 10) {
      setDosMessage(dosMessage || 'Flux communication is limited');
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  if (resMyAvailability.data.status === 'error' || resMyAvailability.data.data.message.includes('not')) {
    log.error(`My Flux unavailability detected from ${askingIP}`);
    // Asked Flux cannot reach me lets check if ip changed
    log.info('Getting publicIp from FluxBench');
    const benchIpResponse = await benchmarkService.getPublicIp();
    if (benchIpResponse.status === 'success') {
      let benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
      if (benchMyIP && userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) {
        // add port
        benchMyIP += userconfig.initial.apiport;
      }
      if (benchMyIP && benchMyIP !== myIP) {
        log.info('New public Ip detected, updating the FluxNode info in the network');
        myIP = benchMyIP;
        daemonServiceWalletRpcs.createConfirmationTransaction();
        await serviceHelper.delay(4 * 60 * 1000); // lets wait 2 blocks time for the transaction to be mined
        return true;
      } if (benchMyIP && benchMyIP === myIP) {
        log.info('FluxBench reported the same Ip that was already in use');
      } else {
        setDosMessage('Error getting publicIp from FluxBench');
        dosState += 15;
        log.error('FluxBench wasnt able to detect flux node public ip');
      }
    } else {
      setDosMessage('Error getting publicIp from FluxBench');
      dosState += 15;
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    if (dosState > 10) {
      setDosMessage(dosMessage || 'Flux is not available for outside communication');
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  const measuredUptime = fluxUptime();
  if (measuredUptime.status === 'success' && measuredUptime.data > config.fluxapps.minUpTime) { // node has been running for 30 minutes. Upon starting a node, there can be dos that needs resetting
    const nodeList = await fluxCommunicationUtils.deterministicFluxList();
    // nodeList must include our fluxnode ip myIP
    let myCorrectIp = `${myIP}:${apiPort}`;
    if (apiPort === 16127 || apiPort === '16127') {
      myCorrectIp = myCorrectIp.split(':')[0];
    }
    const myNodeExists = nodeList.find((node) => node.ip === myCorrectIp);
    if (nodeList.length > config.fluxapps.minIncoming + config.fluxapps.minOutgoing && myNodeExists) { // our node MUST be in confirmed list in order to have some peers
      // check sufficient connections
      const connectionInfo = isCommunicationEstablished();
      if (connectionInfo.status === 'error') {
        dosState += 0.13; // slow increment, DOS after ~75 minutes. 0.13 per minute. This check depends on other nodes being able to connect to my node
        if (dosState > 10) {
          setDosMessage(connectionInfo.data.message || 'Flux does not have sufficient peers');
          log.error(dosMessage);
          return false;
        }
        return true; // availability ok
      }
    }
  } else if (measuredUptime.status === 'error') {
    log.error('Flux uptime is not available'); // introduce dos increment
  }
  dosState = 0;
  setDosMessage(null);
  return true;
}

/**
 * To adjust an external IP.
 * @param {string} ip IP address.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function adjustExternalIP(ip) {
  try {
    const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
    // https://github.com/sindresorhus/ip-regex/blob/master/index.js#L8
    const v4 = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}';
    const v4exact = new RegExp(`^${v4}$`);
    if (!v4exact.test(ip)) {
      log.warn(`Gathered IP ${ip} is not a valid format`);
      return;
    }
    if (ip === userconfig.initial.ipaddress) {
      return;
    }
    log.info(`Adjusting External IP from ${userconfig.initial.ipaddress} to ${ip}`);
    const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${ip}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamZelId}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
    development: ${userconfig.initial.development || false},
    apiport: ${Number(userconfig.initial.apiport || config.apiport)},
    decryptionkey: '${userconfig.initial.decryptionkey || ''}',
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);
  } catch (error) {
    log.error(error);
  }
}

/**
 * To check deterministic node collisions (i.e. if multiple FluxNode instances detected).
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkDeterministicNodesCollisions() {
  try {
    // get my external ip address
    // get node list with filter on this ip address
    // if it returns more than 1 object, shut down.
    // another precatuion might be comparing node list on multiple nodes. evaulate in the future
    const myIP = await getMyFluxIPandPort();
    if (myIP) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        setTimeout(() => {
          checkDeterministicNodesCollisions();
        }, 120 * 1000);
        return;
      }
      const nodeList = await fluxCommunicationUtils.deterministicFluxList();
      const result = nodeList.filter((node) => node.ip === myIP);
      const nodeStatus = await daemonServiceZelnodeRpcs.getZelNodeStatus();
      if (nodeStatus.status === 'success') { // different scenario is caught elsewhere
        const myCollateral = nodeStatus.data.collateral;
        const myNode = result.find((node) => node.collateral === myCollateral);
        if (result.length > 1) {
          log.warn('Multiple Flux Node instances detected');
          if (myNode) {
            const myBlockHeight = myNode.readded_confirmed_height || myNode.confirmed_height; // todo we may want to introduce new readded heights and readded confirmations
            const filterEarlierSame = result.filter((node) => (node.readded_confirmed_height || node.confirmed_height) <= myBlockHeight);
            // keep running only older collaterals
            if (filterEarlierSame.length >= 1) {
              log.error(`Flux earlier collision detection on ip:${myIP}`);
              dosState = 100;
              setDosMessage(`Flux earlier collision detection on ip:${myIP}`);
              setTimeout(() => {
                checkDeterministicNodesCollisions();
              }, 60 * 1000);
              return;
            }
          }
          // prevent new activation
        } else if (result.length === 1) {
          if (!myNode) {
            log.error('Flux collision detection');
            dosState = 100;
            setDosMessage('Flux collision detection');
            setTimeout(() => {
              checkDeterministicNodesCollisions();
            }, 60 * 1000);
            return;
          }
        }
      }
      // early stages of the network or testnet
      if (nodeList.length > config.fluxapps.minIncoming + config.fluxapps.minOutgoing) {
        const availabilityOk = await checkMyFluxAvailability();
        if (availabilityOk) {
          adjustExternalIP(myIP.split(':')[0]);
        }
      } else { // sufficient amount of nodes has to appear on the network within 6 hours
        const measuredUptime = fluxUptime();
        if (measuredUptime.status === 'success' && measuredUptime.data > (config.fluxapps.minUpTime * 12)) {
          const availabilityOk = await checkMyFluxAvailability();
          if (availabilityOk) {
            adjustExternalIP(myIP.split(':')[0]);
          }
        } else if (measuredUptime.status === 'error') {
          log.error('Flux uptime unavailable');
          const availabilityOk = await checkMyFluxAvailability();
          if (availabilityOk) {
            adjustExternalIP(myIP.split(':')[0]);
          }
        }
      }
    } else {
      dosState += 1;
      if (dosState > 10) {
        setDosMessage(dosMessage || 'Flux IP detection failed');
        log.error(dosMessage);
      }
    }
    setTimeout(() => {
      checkDeterministicNodesCollisions();
    }, 60 * 1000);
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkDeterministicNodesCollisions();
    }, 120 * 1000);
  }
}

/**
 * To get DOS state.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  response = messageHelper.createDataMessage(data);
  return res ? res.json(response) : response;
}

/**
 * To allow a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function allowPort(port) {
  const exec = `sudo ufw allow ${port} && sudo ufw allow out ${port}`;
  const cmdAsync = util.promisify(nodecmd.get);

  const cmdres = await cmdAsync(exec);
  const cmdStat = {
    status: false,
    message: null,
  };
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdres).includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To allow out a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function allowOutPort(port) {
  const exec = `sudo ufw allow out ${port}`;
  const cmdAsync = util.promisify(nodecmd.get);

  const cmdres = await cmdAsync(exec);
  const cmdStat = {
    status: false,
    message: null,
  };
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdres).includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To deny a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function denyPort(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (+port < (config.fluxapps.portMin - 1000) || +port > config.fluxapps.portMax) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }
  const exec = `sudo ufw deny ${port} && sudo ufw deny out ${port}`;
  const cmdAsync = util.promisify(nodecmd.get);

  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdres).includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To delete a ufw allow rule on port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function deleteAllowPortRule(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (+port < (config.fluxapps.portMin - 1000) || +port > config.fluxapps.portMax) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }
  const exec = `sudo ufw delete allow ${port} && sudo ufw delete allow out ${port}`;
  const cmdAsync = util.promisify(nodecmd.get);

  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To delete a ufw allow rule on port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function deleteAllowOutPortRule(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (+port < (config.fluxapps.portMin - 1000) || +port > config.fluxapps.portMax) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }
  const exec = `sudo ufw delete allow out ${port}`;
  const cmdAsync = util.promisify(nodecmd.get);

  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To allow a port via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function allowPortApi(req, res) {
  let { port } = req.params;
  port = port || req.query.port;
  if (port === undefined || port === null) {
    const errMessage = messageHelper.createErrorMessage('No Port address specified.');
    return res.json(errMessage);
  }
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized === true) {
    const portResponseOK = await allowPort(port);
    if (portResponseOK.status === true) {
      response = messageHelper.createSuccessMessage(portResponseOK.message, port, port);
    } else if (portResponseOK.status === false) {
      response = messageHelper.createErrorMessage(portResponseOK.message, port, port);
    } else {
      response = messageHelper.createErrorMessage(`Unknown error while opening port ${port}`);
    }
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }
  return res.json(response);
}

/**
 * To check if a firewall is active.
 * @returns {boolean} True if a firewall is active. Otherwise false.
 */
async function isFirewallActive() {
  try {
    const cmdAsync = util.promisify(nodecmd.get);
    const execA = 'sudo ufw status | grep Status';
    const cmdresA = await cmdAsync(execA);
    if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
      return true;
    }
    return false;
  } catch (error) {
    // command ufw not found is the most likely reason
    log.error(error);
    return false;
  }
}

/**
 * To adjust a firewall to allow ports for Flux.
 */
async function adjustFirewall() {
  try {
    const cmdAsync = util.promisify(nodecmd.get);
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const homePort = +apiPort - 1;
    const syncthingPort = +apiPort + 2;
    let ports = [apiPort, homePort, syncthingPort, 80, 443, 16125];
    const fluxCommunicationPorts = config.server.allowedPorts;
    ports = ports.concat(fluxCommunicationPorts);
    const firewallActive = await isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        const execB = `sudo ufw allow ${port}`;
        const execC = `sudo ufw allow out ${port}`;

        // eslint-disable-next-line no-await-in-loop
        const cmdresB = await cmdAsync(execB);
        if (serviceHelper.ensureString(cmdresB).includes('updated') || serviceHelper.ensureString(cmdresB).includes('existing') || serviceHelper.ensureString(cmdresB).includes('added')) {
          log.info(`Firewall adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall for port ${port}`);
        }

        // eslint-disable-next-line no-await-in-loop
        const cmdresC = await cmdAsync(execC);
        if (serviceHelper.ensureString(cmdresC).includes('updated') || serviceHelper.ensureString(cmdresC).includes('existing') || serviceHelper.ensureString(cmdresC).includes('added')) {
          log.info(`Firewall out adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall out for port ${port}`);
        }
      }
    } else {
      log.info('Firewall is not active. Adjusting not applied');
    }
  } catch (error) {
    log.error(error);
  }
}

const lruRateOptions = {
  max: 500,
  maxAge: 1000 * 15, // 15 seconds
};
const lruRateCache = new LRU(lruRateOptions);
/**
 * To check rate limit.
 * @param {string} ip IP address.
 * @param {number} limitPerSecond Defaults to value of 20
 * @returns {boolean} True if a ip is allowed to do a request, otherwise false
 */
function lruRateLimit(ip, limitPerSecond = 20) {
  const lruResponse = lruRateCache.get(ip);
  const newTime = new Date().getTime();
  if (lruResponse) {
    const oldTime = lruResponse.time;
    const oldTokensRemaining = lruResponse.tokens;
    const timeDifference = newTime - oldTime;
    const tokensToAdd = (timeDifference / 1000) * limitPerSecond;
    let newTokensRemaining = oldTokensRemaining + tokensToAdd;
    if (newTokensRemaining < 0) {
      const newdata = {
        time: newTime,
        tokens: newTokensRemaining,
      };
      lruRateCache.set(ip, newdata);
      log.warn(`${ip} rate limited`);
      return false;
    }
    if (newTokensRemaining > limitPerSecond) {
      newTokensRemaining = limitPerSecond;
      newTokensRemaining -= 1;
      const newdata = {
        time: newTime,
        tokens: newTokensRemaining,
      };
      lruRateCache.set(ip, newdata);
      return true;
    }
    newTokensRemaining -= 1;
    const newdata = {
      time: newTime,
      tokens: newTokensRemaining,
    };
    lruRateCache.set(ip, newdata);
    return true;
  }
  const newdata = {
    time: newTime,
    tokens: limitPerSecond,
  };
  lruRateCache.set(ip, newdata);
  return true;
}

module.exports = {
  minVersionSatisfy,
  isFluxAvailable,
  checkFluxAvailability,
  getMyFluxIPandPort,
  getRandomConnection,
  getFluxNodePrivateKey,
  getFluxNodePublicKey,
  checkDeterministicNodesCollisions,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  getDOSState,
  denyPort,
  deleteAllowPortRule,
  deleteAllowOutPortRule,
  allowPortApi,
  adjustFirewall,
  checkRateLimit,
  closeConnection,
  closeIncomingConnection,
  checkFluxbenchVersionAllowed,
  checkMyFluxAvailability,
  adjustExternalIP,
  allowPort,
  allowOutPort,
  isFirewallActive,
  // Exports for testing purposes
  setStoredFluxBenchAllowed,
  getStoredFluxBenchAllowed,
  setMyFluxIp,
  getDosMessage,
  setDosMessage,
  setDosStateValue,
  getDosStateValue,
  fluxUptime,
  isCommunicationEstablished,
  lruRateLimit,
  isPortOpen,
  checkAppAvailability,
};
