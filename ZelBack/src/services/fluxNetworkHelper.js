/* eslint-disable no-underscore-dangle */
const config = require('config');
const zeltrezjs = require('zeltrezjs');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
// eslint-disable-next-line import/no-extraneous-dependencies
const { LRUCache } = require('lru-cache');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceBenchmarkRpcs = require('./daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceWalletRpcs = require('./daemonService/daemonServiceWalletRpcs');
const benchmarkService = require('./benchmarkService');
const verificationHelper = require('./verificationHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const {
  outgoingConnections, outgoingPeers, incomingPeers, incomingConnections,
} = require('./utils/establishedConnections');

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

let storedFluxBenchAllowed = null;

// default cache
const LRUoptions = {
  max: 1,
  ttl: 24 * 60 * 60 * 1000, // 1 day
  maxAge: 24 * 60 * 60 * 1000, // 1 day
};

const myCache = new LRUCache(LRUoptions);

// Flux Network Controller
let fnc = new serviceHelper.FluxController();
let sentinelTimeout = null;

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

    this.lastFilled = Date.now();
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
    const now = Date.now();
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
 * To get if port belongs to enterprise range
 * @returns {boolean} Returns true if enterprise
 */
function isPortEnterprise(port) {
  const { enterprisePorts } = config.fluxapps;
  let portEnterprise = false;
  enterprisePorts.forEach((portOrInterval) => {
    if (typeof portOrInterval === 'string') { // '0-10'
      const minPort = Number(portOrInterval.split('-')[0]);
      const maxPort = Number(portOrInterval.split('-')[1]);
      if (+port >= minPort && +port <= maxPort) {
        portEnterprise = true;
      }
    } else if (portOrInterval === +port) {
      portEnterprise = true;
    }
  });
  return portEnterprise;
}

/**
 * To get if port belongs to user blocked range
 * @returns {boolean} Returns true if port is user blocked
 */
function isPortUserBlocked(port) {
  try {
    let blockedPorts = userconfig.initial.blockedPorts || [];
    blockedPorts = serviceHelper.ensureObject(blockedPorts);
    let portBanned = false;
    blockedPorts.forEach((portOrInterval) => {
      if (portOrInterval === +port) {
        portBanned = true;
      }
    });
    return portBanned;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To get if port belongs to banned range
 * @returns {boolean} Returns true if port is banned
 */
function isPortBanned(port) {
  const { bannedPorts } = config.fluxapps;
  let portBanned = false;
  bannedPorts.forEach((portOrInterval) => {
    if (typeof portOrInterval === 'string') { // '0-10'
      const minPort = Number(portOrInterval.split('-')[0]);
      const maxPort = Number(portOrInterval.split('-')[1]);
      if (+port >= minPort && +port <= maxPort) {
        portBanned = true;
      }
    } else if (portOrInterval === +port) {
      portBanned = true;
    }
  });
  return portBanned;
}

/**
 * To get if port belongs to banned upnp range
 * @returns {boolean} Returns true if port is banned
 */
function isPortUPNPBanned(port) {
  let portBanned = false;
  const { upnpBannedPorts } = config.fluxapps;
  upnpBannedPorts.forEach((portOrInterval) => {
    if (typeof portOrInterval === 'string') { // '0-10'
      const minPort = Number(portOrInterval.split('-')[0]);
      const maxPort = Number(portOrInterval.split('-')[1]);
      if (+port >= minPort && +port <= maxPort) {
        portBanned = true;
      }
    } else if (portOrInterval === +port) {
      portBanned = true;
    }
  });
  return portBanned;
}

/**
 * To perform a basic check if port on an ip is opened
 * @param {string} ip IP address.
 * @param {number} port Port.
 * @returns {boolean} Returns true if opened, otherwise false
 */
async function isPortOpen(ip, port) {
  // -w = wait
  // -z = only check that SYN,ACK is received, don't send data
  const timeout = '5'; // seconds
  const { stdout, error } = await serviceHelper.runCommand('nc', {
    params: ['-w', timeout, '-z', ip, port],
  });

  // try {
  //   const exec = `nc -w 5 -z -v ${ip} ${port} </dev/null; echo $?`;
  //   const cmdAsync = util.promisify(nodecmd.get);
  //   const result = await cmdAsync(exec);
  //   return !+result;
  // } catch (error) {
  //   log.error(error);
  //   return false;
  // }
}

/**
 * To perform a basic check of current FluxOS version.
 * @param {string} ip IP address.
 * @param {string} port Port. Defaults to config.server.apiport.
 * @returns {boolean} False unless FluxOS version meets or exceeds the minimum allowed version.
 */
async function isFluxAvailable(ip, port = config.server.apiport) {
  try {
    const ipchars = /^[0-9.]+$/;
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
    const portOpen = await isPortOpen(ip, syncthingPort);
    return portOpen;
  } catch (e) {
    log.error(e);
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
 * To check if application is available
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
        ip, ports, pubKey, signature,
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
        throw new Error('Unable to verify request authenticity');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      const daemonHeight = syncStatus.data.height;
      const minPort = daemonHeight >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMinNew : config.fluxapps.portMin - 1000;
      const maxPort = daemonHeight >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMaxNew : config.fluxapps.portMax;
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        const iBP = isPortBanned(+port);
        if (+port >= minPort && +port <= maxPort && !iBP) {
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await isPortOpen(ip, port);
          if (!isOpen) {
            throw new Error(`Flux Applications on ${ip}:${ipPort} are not available. Failed port: ${port}`);
          }
        } else {
          log.error(`Flux App port ${port} is outside allowed range.`);
        }
      }
      const successResponse = messageHelper.createSuccessMessage(`Flux Applications on ${ip}:${ipPort} are available.`);
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
 * @returns {Promise<string>} IP address and port.
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
 * @returns {Promise<string>} Private key, if already input as parameter or otherwise from the daemon config.
 */
async function getFluxNodePrivateKey(privatekey) {
  const privKey = privatekey || daemonServiceUtils.getConfigValue('zelnodeprivkey');
  return privKey;
}

/**
 * To get FluxNode public key.
 * @param {string} privatekey Private key.
 * @returns {Promise<string>} Public key.
 */
async function getFluxNodePublicKey(privatekey) {
  try {
    const pkWIF = await getFluxNodePrivateKey(privatekey);
    const isCompressed = !pkWIF.startsWith('5');
    const privateKey = zeltrezjs.address.WIFToPrivKey(pkWIF);
    const pubKey = zeltrezjs.address.privKeyToPubKey(privateKey, isCompressed);
    return pubKey;
  } catch (error) {
    return error;
  }
}

/**
 * To get a random connection.
 * @returns {Promise<string>} IP:Port or just IP if default.
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
 * @param {string} port node API port.
 * @returns {Promise<object>} Message.
 */
async function closeOutboundConnection(ip, port) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  const peerIndex = outgoingPeers.findIndex((peer) => peer.ip === ip && peer.port === port);
  if (peerIndex > -1) {
    outgoingPeers.splice(peerIndex, 1);
  }
  const ocIndex = outgoingConnections.findIndex((client) => client.ip === ip && client.port === port);
  if (ocIndex < 0) {
    return messageHelper.createWarningMessage(`Connection to ${ip}:${port} does not exists.`);
  }
  const wsObj = outgoingConnections[ocIndex];
  wsObj.close(4009, 'purpusfully closed');
  log.info(`Connection to ${ip}:${port} closed with code 4009`);
  outgoingConnections.splice(ocIndex, 1);
  return messageHelper.createSuccessMessage(`Outgoing connection to ${ip}:${port} closed`);
}

/**
 * To close an incoming connection.
 * @param {string} ip IP address.
 * @param {string} port node API port.
 * @param {object} expressWS Express web socket.
 * @param {object} clientToClose Web socket for client to close.
 * @returns {Promise<object>} Message.
 */
async function closeIncomingConnection(ip, port, expressWS, clientToClose) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  let wsObj = clientToClose;
  if (expressWS && !wsObj) {
    const clientsSet = expressWS.clients || [];
    clientsSet.forEach((client) => {
      if (client.ip === ip && client.port === port) {
        wsObj = client;
      }
    });
  }
  if (!wsObj) {
    const clientsSet = incomingConnections;
    clientsSet.forEach((client) => {
      if (client.ip === ip && client.port === port) {
        wsObj = client;
      }
    });
  }
  if (!wsObj) {
    return messageHelper.createWarningMessage(`Connection from ${ip}:${port} does not exists.`);
  }
  const ocIndex = incomingConnections.findIndex((peer) => peer.ip === ip && peer.port === port);
  if (ocIndex === -1) {
    return messageHelper.createErrorMessage(`Unable to close incoming connection ${ip}:${port}. Try again later.`);
  }
  const peerIndex = incomingPeers.findIndex((peer) => peer.ip === ip && peer.port === port);
  if (peerIndex > -1) {
    incomingPeers.splice(peerIndex, 1);
  }
  wsObj.close(4010, 'purpusfully closed');
  log.info(`Connection from ${ip}:${port} closed with code 4010`);
  incomingConnections.splice(ocIndex, 1);
  return messageHelper.createSuccessMessage(`Incoming connection to ${ip}:${port} closed`);
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
    connections.push(client.ip);
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
 * @returns {Promise<boolean>} True if version is verified as allowed. Otherwise false.
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
 * To get system uptime in seconds
 * @param {object} req Request.
 * @param {object} res Response.
 */
function fluxSystemUptime(req, res) {
  let message;
  try {
    const uptime = os.uptime();
    const measureUptime = Math.floor(uptime);
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
  } else if ([...new Set(outgoingPeers.map((peer) => peer.ip))].length < config.fluxapps.minUniqueIpsOutgoing) { // depends on other nodes successfully connecting to my node, todo enforcement
    message = messageHelper.createErrorMessage(`Not enough outgoing unique ip's connections established to Flux network. Minimum required ${config.fluxapps.minUniqueIpsOutgoing} found ${[...new Set(outgoingPeers.map((peer) => peer.ip))].length}`);
  } else if ([...new Set(incomingPeers.map((peer) => peer.ip))].length < config.fluxapps.minUniqueIpsIncoming) { // depends on other nodes successfully connecting to my node, todo enforcement
    message = messageHelper.createErrorMessage(`Not enough incoming unique ip's connections from Flux network. Minimum required ${config.fluxapps.minUniqueIpsIncoming} found ${[...new Set(incomingPeers.map((peer) => peer.ip))].length}`);
  } else {
    message = messageHelper.createSuccessMessage('Communication to Flux network is properly established');
  }
  return res ? res.json(message) : message;
}

/**
 * To check user's FluxNode availability.
 * @param {number} retryNumber Number of retries.
 * @returns {Promise<boolean>} True if all checks passed.
 */
async function checkMyFluxAvailability(retryNumber = 0) {
  let userBlockedPorts = userconfig.initial.blockedPorts || [];
  userBlockedPorts = serviceHelper.ensureObject(userBlockedPorts);
  if (Array.isArray(userBlockedPorts)) {
    if (userBlockedPorts.length > 100) {
      dosState += 11;
      setDosMessage('User blocked ports above 100 limit');
      return false;
    }
  }
  let userBlockedRepositories = userconfig.initial.blockedRepositories || [];
  userBlockedRepositories = serviceHelper.ensureObject(userBlockedRepositories);
  if (Array.isArray(userBlockedRepositories)) {
    if (userBlockedRepositories.length > 10) {
      dosState += 11;
      setDosMessage('User blocked repositories above 10 limit');
      return false;
    }
  }
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
  const oldIP = myFluxIP;
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
    log.error(error.message);
    availabilityError = true;
  });
  if (!resMyAvailability || availabilityError) {
    dosState += 2;
    if (dosState > 10) {
      setDosMessage(dosMessage || 'Flux communication is limited, other nodes on the network cannot reach yours through API calls');
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
    if (retryNumber === 4 || dosState > 10) {
      log.info('Getting publicIp from FluxBench');
      const benchIpResponse = await benchmarkService.getPublicIp();
      if (benchIpResponse.status === 'success') {
        const benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
        if (benchMyIP && benchMyIP.split(':')[0] !== myIP.split(':')[0]) {
          await serviceHelper.delay(2 * 1000); // await two seconds
          const newIP = await getMyFluxIPandPort(); // to update node Ip on FluxOs;
          if (newIP && newIP !== oldIP) { // double check
            log.info('FluxBench reported a new IP');
            return true;
          }
        } if (benchMyIP && benchMyIP.split(':')[0] === myIP.split(':')[0]) {
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
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function adjustExternalIP(ip) {
  // why do this???!? the ip address should not be in the userconfig of all places. What is it used for? (figure out)
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
    const oldUserConfigIp = userconfig.initial.ipaddress;
    log.info(`Adjusting External IP from ${userconfig.initial.ipaddress} to ${ip}`);
    const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${ip}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamZelId}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
    development: ${userconfig.initial.development || false},
    apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
    routerIP: '${userconfig.initial.routerIP || ''}',
    pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
    pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
    blockedPorts: [${userconfig.initial.blockedPorts || ''}],
    blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);

    if (oldUserConfigIp && v4exact.test(oldUserConfigIp) && !myCache.has(ip)) {
      myCache.set(ip, ip);
      const newIP = userconfig.initial.apiport !== 16127 ? `${ip}:${userconfig.initial.apiport}` : ip;
      const oldIP = userconfig.initial.apiport !== 16127 ? `${oldUserConfigIp}:${userconfig.initial.apiport}` : oldUserConfigIp;
      log.info(`New public Ip detected: ${newIP}, old Ip:${oldIP} , updating the FluxNode info in the network`);
      // eslint-disable-next-line global-require
      const appsService = require('./appsService');
      let apps = await appsService.installedApps();
      if (apps.status === 'success' && apps.data.length > 0) {
        apps = apps.data;
        let appsRemoved = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const app of apps) {
          // eslint-disable-next-line no-await-in-loop
          const runningAppList = await appsService.getRunningAppList(app.name);
          const findMyIP = runningAppList.find((instance) => instance.ip.split(':')[0] === ip);
          if (findMyIP) {
            log.info(`Aplication: ${app.name}, was found on the network already running under the same ip, uninstalling app`);
            // eslint-disable-next-line no-await-in-loop
            await appsService.removeAppLocally(app.name, null, true, null, true).catch((error) => log.error(error));
            appsRemoved += 1;
          }
        }
        if (apps.length > appsRemoved) {
          const broadcastedAt = Date.now();
          const newIpChangedMessage = {
            type: 'fluxipchanged',
            version: 1,
            oldIP,
            newIP,
            broadcastedAt,
          };
          // broadcast messages about ip changed to all peers
          // eslint-disable-next-line global-require
          const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
          await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newIpChangedMessage);
          await serviceHelper.delay(500);
          await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newIpChangedMessage);
        }
      }
      const benchmarkResponse = await benchmarkService.getBenchmarks();
      if (benchmarkResponse.status === 'error') {
        await serviceHelper.delay(15 * 60 * 1000);
      } else if (benchmarkResponse.status === 'running') {
        await serviceHelper.delay(8 * 60 * 1000);
      }
      const result = await daemonServiceWalletRpcs.createConfirmationTransaction();
      log.info(`createConfirmationTransaction: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Dependent on network size (> 12) reaches out to other nodes and checks that this
 * node is reachable over the internet. If < 12, i.e. testnet, waits until node has been
 * up for 6 hours before reaching out to other nodes, unless there is an error, then it runs
 * immediately (this probably needs a little work)
 * @param {number} networkSize
 *
 * @returns  {Promise<void}
 */
async function ensureNodeIsReachable(networkSize, localEndpoint) {
  // pulled out of checkDeterministicNodesCollisions, was running every 60 seconds

  // minOut = 8, minIn = 4
  if (networkSize > config.fluxapps.minIncoming + config.fluxapps.minOutgoing) {
    const availabilityOk = await checkMyFluxAvailability();
    if (availabilityOk) {
      await adjustExternalIP(localEndpoint.split(':')[0]);
    }
  } else { // (testnet) wait 6 hours
    const measuredUptime = fluxUptime();
    if (measuredUptime.status === 'success' && measuredUptime.data > (config.fluxapps.minUpTime * 12)) {
      const availabilityOk = await checkMyFluxAvailability();
      if (availabilityOk) {
        await adjustExternalIP(localEndpoint.split(':')[0]);
      }
      // do this better, it should be it's own DOS score
    } else if (measuredUptime.status === 'error') {
      log.error('Flux uptime unavailable');
      const availabilityOk = await checkMyFluxAvailability();
      if (availabilityOk) {
        await adjustExternalIP(localEndpoint.split(':')[0]);
      }
    }
  }
}

/**
 * To check deterministic node collisions (i.e. same endPoint(ip:port)
 * @param {object[]} activatedNodes the deterministic node list
 * @param {object} nodeStatus the current status of the Fluxnode from fluxd
 * @returns {void}
 */
function detectCollision(activatedNodes, nodeStatus, localEndpoint) {
  // another precatuion might be comparing node list on multiple nodes. evaluate in the future

  const duplicateEndpoints = activatedNodes.filter((node) => node.ip === localEndpoint);
  const { collateral, confirmed_height: confirmedHeight } = nodeStatus;
  const activated = duplicateEndpoints.find((node) => node.collateral === collateral);

  const endpointCount = duplicateEndpoints.length;

  // This node is not activated and another node is using the same endpoint with a different confirmation tx
  if (!activated && endpointCount) {
    const msg = 'Flux collision detected. Another Fluxnode is confirmed on the Flux network with '
      + 'the same ip:port using a different confirmation tx. Disabling this node.';
    log.error(msg);
    dosState = 100;
    setDosMessage(msg);
  } else if (activated && endpointCount > 1) {
    log.warn(`Multiple Fluxnode instances detected on endPoint: ${localEndpoint}`);
    // todo we may want to introduce new readded heights and readded confirmations
    // I removed this, if and when it gets added, we can add it back in
    const olderNodes = duplicateEndpoints.filter((node) => node.confirmed_height <= confirmedHeight);
    // keep running only older collaterals
    if (olderNodes.length) {
      const msg = 'Older node found on same endpoint. Disabling this node.';
      log.error(msg);
      dosState = 100;
      setDosMessage(msg);
    }
  }
}

/**
 * Makes sure only this endpoint (ip:port) is activated on the network, if there
 * is more than one, the youngest Fluxnode is shut down. Also checks that this node
 * is reachable from other nodes.
 * @returns {Promise<number>} ms until the next run (60s by default)
 */
async function runNetworkSentinel() {
  if (fnc.aborted) return 0;

  fnc.lock.enable();

  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      return 2 * 60 * 1000;
    }

    const localEndpoint = await getMyFluxIPandPort();
    if (!localEndpoint) {
      dosState += 1;
      if (dosState > 10) {
        setDosMessage(dosMessage || 'Flux IP detection failed');
        log.error(dosMessage);
        return 60 * 1000;
      }
    }

    const activatedNodes = await fluxCommunicationUtils.deterministicFluxList();
    const statusRes = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();

    // different scenario is caught elsewhere ??? - where?
    if (!statusRes.status === 'success') {
      return 60 * 1000;
    }

    detectCollision(activatedNodes, statusRes.data, localEndpoint);
    await ensureNodeIsReachable(activatedNodes.length, localEndpoint);

    return 60 * 1000;
  } catch (error) {
    if (error.name !== 'AbortError') {
      log.error(error);
      return 2 * 60 * 1000;
    }
  } finally {
    fnc.lock.disable();
  }
  return 0;
}

async function loopRunNetworkSentinel() {
  const ms = await runNetworkSentinel();
  if (!ms) return;
  sentinelTimeout = setTimeout(loopRunNetworkSentinel, ms);
}

function startNetworkSentinel() {
  loopRunNetworkSentinel();
}

async function stopNetworkSentinel() {
  if (sentinelTimeout) clearTimeout(sentinelTimeout);
  sentinelTimeout = null;
  await fnc.abort();
  fnc = new serviceHelper.FluxController();
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

async function allowUfwPorts(ports, options = {}) {
  const allowIn = options.in || false
  const allowOut = options.out || false

  if (!allowIn && !allowOut) return;

  function logCmdStatus(stdout, direction, ports, proto) {
    if (serviceHelper.ensureString(stdout).includes('updated')
      || serviceHelper.ensureString(stdout).includes('existing')
      || serviceHelper.ensureString(stdout).includes('added')) {
      log.info(`Firewall adjusted ${direction} for ports: ${ports}/${proto}`);
    } else {
      log.warn(`Failed to adjust firewall ${direction} for ports: ${ports}/${proto}`);
    }
  }

  async function allowPorts(ports, proto) {
    if (!ports.length) return;

    if (allowIn) {
      // const inCmd = `sudo ufw allow ${ports}/${proto}`
      // const allowedIn = await cmdAsync(inCmd).catch(noop);
      const { stdout: allowedIn } = await serviceHelper.runCommand('ufw', {
        runAsRoot: true,
        logError: false,
        params: ['allow', `${ports}/${proto}`],
      });
      logCmdStatus(allowedIn, 'inbound', ports, proto);
    }

    if (allowOut) {
      // const outCmd = `sudo ufw allow out ${ports}/${proto}`;
      // const allowedOut = await cmdAsync(outCmd).catch(noop);
      const { stdout: allowedOut } = await serviceHelper.runCommand('ufw', {
        runAsRoot: true,
        logError: false,
        params: ['allow', 'out', `${ports}/${proto}`],
      });
      logCmdStatus(allowedOut, 'outbound', ports, proto);
    }
  }

  const parsedPorts = ports.reduce((acc, p) => {
    const [port, protocol] = p.toString().split("/");
    if (protocol) {
      acc[protocol].push(port);
    } else {
      acc["tcp"].push(port);
      acc["udp"].push(port);
    }
    return acc
  }, { 'tcp': [], 'udp': [] })

  await allowPorts(parsedPorts['tcp'], 'tcp');
  await allowPorts(parsedPorts['udp'], 'udp');
}

/**
 * To allow a port.
 * @param {string} port Port.
 * @returns {Promise<object>} Command status.
 */
async function allowPort(port) {
  // ToDo: Fix this
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }

  const { stdout: allowIn } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['allow', port],
  });

  const { stdout: allowOut } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['allow', 'out', port],
  });

  cmdStat.message = allowIn + allowOut;
  if (serviceHelper.ensureString(cmdStat.message).includes('updated') || serviceHelper.ensureString(cmdStat.message).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdStat.message).includes('existing')) {
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
 * @returns {Promise<object>} Command status.
 */
async function denyPort(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const portBanned = isPortBanned(+port);
  if (+port < (config.fluxapps.portMinNew) || +port > config.fluxapps.portMaxNew || portBanned) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }

  const { stdout: denyIn } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['deny', port],
  });

  const { stdout: denyOut } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['deny', 'out', port],
  });

  // const exec = `sudo ufw deny ${port} && sudo ufw deny out ${port}`;
  // const cmdres = await cmdAsync(exec);
  cmdStat.message = denyIn + denyOut;
  if (serviceHelper.ensureString(cmdStat.message).includes('updated') || serviceHelper.ensureString(cmdStat.message).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdStat.message).includes('existing')) {
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
 * @returns {Promise<object>} Command status.
 */
async function deleteAllowPortRule(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const portBanned = isPortBanned(+port);
  if (+port < (config.fluxapps.portMinNew) || +port > config.fluxapps.portMaxNew || portBanned) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }

  const { stdout: deleteAllowIn } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['delete', 'allow', port],
  });

  const { stdout: deleteAllowOut } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['delete', 'allow', 'out', port],
  });

  // const exec = `sudo ufw delete allow ${port} && sudo ufw delete allow out ${port}`;
  // const cmdres = await cmdAsync(exec);
  cmdStat.message = deleteAllowIn + deleteAllowOut;
  if (serviceHelper.ensureString(cmdStat.message).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To delete a ufw deny rule on port.
 * @param {string} port Port.
 * @returns {Promise<object>} Command status.
 */
async function deleteDenyPortRule(portWithOptionalProto) {
  const [port, proto] = portWithOptionalProto.split('/');

  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }

  if (proto && proto !== 'tcp' || proto !== 'udp') {
    cmdStat.message = 'Protocol must be tcp or udp';
  }

  const portBanned = isPortBanned(+port);
  if (+port < (config.fluxapps.portMinNew) || +port > config.fluxapps.portMaxNew || portBanned) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }

  const { stdout: deleteDenyIn } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['delete', 'deny', portWithOptionalProto],
  });

  const { stdout: deleteDenyOut } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['delete', 'deny', 'out', portWithOptionalProto],
  });

  // const exec = `sudo ufw delete deny ${port} && sudo ufw delete deny out ${port}`;
  // const cmdres = await cmdAsync(exec);
  cmdStat.message = deleteDenyIn + deleteDenyOut;
  if (serviceHelper.ensureString(cmdStat.message).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To delete a ufw allow rule on port.
 * @param {string} port Port.
 * @returns {Promise<object>} Command status.
 */
async function deleteAllowOutPortRule(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const portBanned = isPortBanned(+port);
  if (+port < (config.fluxapps.portMinNew) || +port > config.fluxapps.portMaxNew || portBanned) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }

  const { stdout } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['delete', 'allow', 'out', port],
  });

  // const exec = `sudo ufw delete allow out ${port}`;
  // const cmdres = await cmdAsync(exec);

  cmdStat.message = stdout;
  if (serviceHelper.ensureString(cmdStat.message).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
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
 * @returns {Promise<object>} Message.
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
 * To adjust a firewall to allow ports for Flux.
 * @returns {Prmoise<void>}
 */
async function adjustFirewall() {
  const firewallActive = await serviceHelper.isFirewallActive();

  if (!firewallActive) {
    log.info('Firewall is not active. Adjusting not applied');
    return;
  }

  const apiPort = userconfig.initial.apiport || config.server.apiport;
  const homePort = +apiPort - 1;
  const apiSSLPort = +apiPort + 1;
  const syncthingPort = +apiPort + 2;

  const localPorts = [homePort, apiPort, apiSSLPort, syncthingPort, 80, 443, 16125];
  const fluxCommunicationPorts = config.server.allowedPorts;
  // if you use a TypedArray, you don't need to pass a comparator to sort
  const allPorts = new Uint16Array(localPorts.concat(fluxCommunicationPorts));
  // just for logs output
  allPorts.sort();
  // there was double ups here
  const filteredPorts = new Set(allPorts);

  // only allow tcp NOT udp... as we aren't using it.
  const portsAsString = `${[...filteredPorts].join(",")}/tcp`;

  function logCmdStatus(stdout, direction) {
    if (serviceHelper.ensureString(stdout).includes('updated')
      || serviceHelper.ensureString(stdout).includes('existing')
      || serviceHelper.ensureString(stdout).includes('added')) {
      log.info(`Firewall adjusted ${direction} for ports: ${portsAsString}`);
    } else {
      log.warn(`Failed to adjust firewall ${direction} for ports: ${portsAsString}`);
    }
  }

  const { stdout: allowedIn } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['allow', portsAsString],
  });

  const { stdout: allowedOut } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['allow', 'out', portsAsString],
  });

  // const allowInCmd = `sudo ufw allow ${portsAsString}`;
  // const allowOutCmd = `sudo ufw allow out ${portsAsString}`;

  // const allowedIn = await cmdAsync(allowInCmd);
  logCmdStatus(allowedIn, 'inbound');

  // const allowedOut = await cmdAsync(allowOutCmd);
  logCmdStatus(allowedOut, 'outbound');
}

/**
 * To clean a firewall deny policies, and delete them from it.
 * @returns {Prmoise<void>}
 */
async function purgeUFW() {
  // this needs more work. Lots of situations it doesn't work in. Just use
  // jc and parse the output properly into json. Probably stop using ufw as well - just use iptables.
  const firewallActive = await serviceHelper.isFirewallActive();

  if (!firewallActive) return;

  const { stdout: ufwStatus, error } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['status'],
    logError: false
  });

  if (error) return;

  // matches any group of ports, single port or ports list, followed by an optional
  // tcp or udp, followed by any amount of whitespace, followed by a DENY or
  // DENY OUT, followed by any amount of whitespace and the literal Anywhere.
  // could add in the destination, but at this point, may as well install jc and
  // parse it as json. (I would have already installed jc but it's only available
  // on 22.04 via apt, or via pip on 20.04, could just download the tarball though)
  // has a named capture group of the port/proto. (if proto exists)
  // and a named group for the direction
  // won't match on v6 (can add it though)

  // will match the following formats:
  /**
    16198                      DENY        Anywhere
    16199                      DENY        Anywhere
    23333/tcp                  DENY OUT    Anywhere
    44321/udp                  DENY        Anywhere
    21555                      DENY OUT    Anywhere
    2655,3678,6543/tcp         DENY OUT    Anywhere
    2888:4311/udp              DENY        Anywhere
   */

  // it will not match rules like the following:
  /**
   169.254.44.254 80/tcp      DENY        Anywhere
   172.16.32.1                DENY OUT    Anywhere on docker0
  */

  const deniedPortsRegex = /(?<portgroup>^(?!\d{1,3}\.)(?:(?=\d{1,5}:)(?:\d{1,5}:)|(?:\d{1,5},)*)(?:\d{1,5})(?:\/tcp|\/udp)?)\s+(?<direction>DENY|DENY OUT)\s+Anywhere$/g;
  // matchAll returns an iterator, spread so we can get length
  const matches = [...ufwStatus.matchAll(deniedPortsRegex)];

  if (!matches.length) {
    log.info('No UFW deny rules found');
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const match of matches) {
    const portGroup = match.groups.portgroup;
    // for the meantime, just handle ports, not ranges (with optional /udp or /tcp)
    // need to modify the delete rule below so you can specify direction as it will try
    // delete both. If we took away the number check in the delete rule thing below, it would
    // work for ranges too, If there is bad input, just let it fail silently.
    // or just match the regex above again.
    if (portGroup.match(/\d+(?:\/[tcp|udp])?/)) {
      // eslint-disable-next-line no-await-in-loop
      await deleteDenyPortRule(portGroup);
    }
  }

  log.info('UFW app deny rules purged');

  // const execB = 'sudo ufw status | grep \'DENY\' | grep -E \'(3[0-9]{4})\''; // 30000 - 39999
  // const cmdresB = await cmdAsync(execB).catch(() => { }) || ''; // fail silently,
  // if (serviceHelper.ensureString(cmdresB).includes('DENY')) {
  //   const deniedPorts = cmdresB.split('\n'); // split by new line
  //   const portsToDelete = [];
  //   deniedPorts.forEach((port) => {
  //     const adjPort = port.substring(0, port.indexOf(' '));
  //     if (adjPort) { // last line is empty
  //       if (!portsToDelete.includes(adjPort)) {
  //         portsToDelete.push(adjPort);
  //       }
  //     }
  //   });
  //   // eslint-disable-next-line no-restricted-syntax
  //   for (const port of portsToDelete) {
  //     // eslint-disable-next-line no-await-in-loop
  //     await deleteDenyPortRule(port);
  //   }
  //   log.info('UFW app deny rules purged');
  // } else {
  //   log.info('No UFW deny rules found');
  // }
}

/**
 * This fix a docker security issue where docker containers can access private node operator networks, for example to create port forwarding on hosts.
 *
 * Docker should create a DOCKER-USER chain. If this doesn't exist - we create it, then jump to this chain immediately from the FORWARD CHAIN.
 * This allows rules to be added via -I (insert) and -A (append) to the DOCKER-USER chain individually, so we can ALWAYS append the
 * drop traffic rule, and insert the ACCEPT rules. If no matches are found in the DOCKER-USER chain, rule evaluation continues
 * from the next rule in the FORWARD chain.
 *
 * If needed in the future, we can actually create a JUMP from the DOCKER-USER chain to a custom chain. The reason why we MUST use the DOCKER-USER
 * chain is that whenever docker creates a new network, it re-jumps the DOCKER-USER chain at the head of the FORWARD chain.
 *
 * As can be seen in this example:
 *
 * Originally, was using the FLUX chain, but you can see docker inserted the br-72d1725e481c network ahead, as well as the JUMP to DOCKER-USER,
 * which invalidates any rules in the FLUX chain, as there is basically an accept any:
 *
 * FORWARD -i br-72d1725e481c ! -o br-72d1725e481c -j ACCEPT
 *
 * ```bash
 * -A INPUT -j ufw-track-input
 * -A FORWARD -j DOCKER-USER
 * -A FORWARD -j DOCKER-ISOLATION-STAGE-1
 * -A FORWARD -o br-72d1725e481c -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 * -A FORWARD -o br-72d1725e481c -j DOCKER
 * -A FORWARD -i br-72d1725e481c ! -o br-72d1725e481c -j ACCEPT
 * -A FORWARD -i br-72d1725e481c -o br-72d1725e481c -j ACCEPT
 * -A FORWARD -j FLUX
 * -A FORWARD -o br-048fde111132 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 * -A FORWARD -o br-048fde111132 -j DOCKER
 * -A FORWARD -i br-048fde111132 ! -o br-048fde111132 -j ACCEPT
 * -A FORWARD -i br-048fde111132 -o br-048fde111132 -j ACCEPT
 *```
 * This means if a user or someone was to delete a single rule, we are able to recover correctly from it.
 *
 * The other option - is just to Flush all rules on every run, and reset them all. This is what we are doing now.
 *
 * @param {string[]} fluxNetworkInterfaces The network interfaces, br-<12 character string>
 * @returns  {Promise<Boolean>}
 */
async function removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces) {
  // const cmdAsync = util.promisify(nodecmd.get);

  // const checkIptables = 'sudo iptables --version';
  // const iptablesInstalled = await cmdAsync(checkIptables).catch(() => {
  //   log.error('Unable to find iptables binary');
  //   return false;
  // });

  // if (!iptablesInstalled) return false;

  // this doesn't need to be run as root, but just checking it's in root's PATH
  const { iptablesExistsError } = await serviceHelper.runCommand('iptables', {
    runAsRoot: true,
    logError: false,
    params: ['--version'],
  });

  if (iptablesExistsError) {
    log.error('Unable to find iptables binary');
    return false;
  }

  // check if rules have been created, as iptables is NOT idempotent.
  // const checkDockerUserChain = 'sudo iptables -L DOCKER-USER';
  // iptables 1.8.4 doesn't return anything - so have updated command a little
  // const checkJumpChain = 'sudo iptables -C FORWARD -j DOCKER-USER && echo true';

  // const dockerUserChainExists = await cmdAsync(checkDockerUserChain).catch(async () => {
  //   try {
  //     await cmdAsync('sudo iptables -N DOCKER-USER');
  //     log.info('IPTABLES: DOCKER-USER chain created');
  //   } catch (err) {
  //     log.error('IPTABLES: Error adding DOCKER-USER chain');
  //     // if we can't add chain, we can't proceed
  //     return new Error();
  //   }
  //   return null;
  // });

  // if (dockerUserChainExists instanceof Error) return false;
  // if (dockerUserChainExists) log.info('IPTABLES: DOCKER-USER chain already created');

  const { error: noDockerUserChain } = await serviceHelper.runCommand(
    'iptables',
    { runAsRoot: true, logError: false, params: ['-L', 'DOCKER-USER'] }
  );

  if (noDockerUserChain) {
    const { error: createChainError } = await serviceHelper.runCommand(
      'iptables',
      { runAsRoot: true, logError: false, params: ['-N', 'DOCKER-USER'] }
    );

    if (createChainError) {
      log.error('IPTABLES: Error adding DOCKER-USER chain');
      return false;
    } else {
      log.info('IPTABLES: DOCKER-USER chain created');
    }
  } else {
    // could get rid of this log, just need to update tests
    log.info('IPTABLES: DOCKER-USER chain already created')
  }

  // const checkJumpToDockerChain = await cmdAsync(checkJumpChain).catch(async () => {

  //   const jumpToFluxChain = 'sudo iptables -I FORWARD -j DOCKER-USER';
  //   try {
  //     await cmdAsync(jumpToFluxChain);
  //     log.info('IPTABLES: New rule in FORWARD inserted to jump to DOCKER-USER chain');
  //   } catch (err) {
  //     log.error('IPTABLES: Error inserting FORWARD jump to DOCKER-USER chain');
  //     // if we can't jump, we need to bail out
  //     return new Error();
  //   }

  //   return null;
  // });

  // if (checkJumpToDockerChain instanceof Error) return false;
  // if (checkJumpToDockerChain) log.info('IPTABLES: Jump to DOCKER-USER chain already enabled');

  // Ubuntu 20.04 @ iptables 1.8.4 Error: "iptables: No chain/target/match by that name."
  // Ubuntu 22.04 @ iptables 1.8.7 Error: "iptables: Bad rule (does a matching rule exist in that chain?)."
  const { error: checkJumpChainError } = await serviceHelper.runCommand(
    'iptables',
    { runAsRoot: true, logError: false, params: ['-C', 'FORWARD', '-j', 'DOCKER-USER'] }
  );

  if (checkJumpChainError) {
    const { error: createJumpChainError } = await serviceHelper.runCommand(
      'iptables',
      { runAsRoot: true, logError: false, params: ['-I', 'FORWARD', '-j', 'DOCKER-USER'] }
    );

    if (createJumpChainError) {
      log.error('IPTABLES: Error inserting FORWARD jump to DOCKER-USER chain');
      return false;
    } else {
      log.info('IPTABLES: New rule in FORWARD inserted to jump to DOCKER-USER chain');
    }
  } else {
    log.info('IPTABLES: Jump to DOCKER-USER chain already enabled');
  }


  const rfc1918Networks = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  const fluxSrc = '172.23.0.0/16';

  // const baseDropCmd = `sudo iptables -A DOCKER-USER -s ${fluxSrc} -d #DST -j DROP`;
  // const baseAllowToFluxNetworksCmd = 'sudo iptables -I DOCKER-USER -i #INT -o #INT -j ACCEPT';
  // const baseAllowEstablishedCmd = `sudo iptables -I DOCKER-USER -s ${fluxSrc} -d #DST -m state --state RELATED,ESTABLISHED -j ACCEPT`;
  // const baseAllowDnsCmd = `sudo iptables -I DOCKER-USER -s ${fluxSrc} -d #DST -p udp --dport 53 -j ACCEPT`;

  // const addReturnCmd = 'sudo iptables -A DOCKER-USER -j RETURN';
  // const flushDockerUserCmd = 'sudo iptables -F DOCKER-USER';

  const baseAllowEstablishedParams = ['-I', 'DOCKER-USER', '-s', fluxSrc, '-d', '#DST', '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'];
  const baseAllowDnsParams = ['-I', 'DOCKER-USER', '-s', fluxSrc, '-d', '#DST', '-p', 'udp', '--dport', '53', '-j', 'ACCEPT'];
  const baseDropToPrivateParams = ['-A', 'DOCKER-USER', '-s', fluxSrc, '-d', '#DST', '-j', 'DROP'];
  const baseAllowToFluxNetworksParams = ['-I', 'DOCKER-USER', '-i', '#INT', '-o', '#INT', '-j', 'ACCEPT'];

  const addReturnParams = ['-A', 'DOCKER-USER', '-j', "RETURN"];
  const flushParams = ['-F', 'DOCKER-USER'];

  const { error: flushError } = await serviceHelper.runCommand('iptables', {
    runAsRoot: true,
    logError: false,
    params: flushParams,
  });

  if (flushError) {
    log.error(`IPTABLES: Error flushing DOCKER-USER table. ${err}`);
    return false;
  }

  log.info('IPTABLES: DOCKER-USER table flushed');

  // try {
  //   await cmdAsync(flushDockerUserCmd);
  //   log.info('IPTABLES: DOCKER-USER table flushed');
  // } catch (err) {
  //   log.error(`IPTABLES: Error flushing DOCKER-USER table. ${err}`);
  //   return false;
  // }

  // add for legacy apps
  fluxNetworkInterfaces.push('docker0');

  // eslint-disable-next-line no-restricted-syntax
  for (const int of fluxNetworkInterfaces) {
    // if this errors, we need to bail, as if the deny succeedes, we may cut off access
    const fluxNetworkAccessParams = baseAllowToFluxNetworksParams.map((item) => item === '#INT' ? int : item);
    // eslint-disable-next-line no-await-in-loop
    const { error: fluxNetworkAccessError } = await serviceHelper.runCommand(
      'iptables',
      { runAsRoot: true, logError: false, params: fluxNetworkAccessParams }
    );

    if (fluxNetworkAccessError) {
      log.error(`IPTABLES: Error allowing traffic on Flux interface ${int}. ${err}`);
      return false;
    }

    log.info(`IPTABLES: Traffic on Flux interface ${int} accepted`);

    // const giveFluxNetworkAccess = baseAllowToFluxNetworksCmd.replace(/#INT/g, int);
    // try {
    //   // eslint-disable-next-line no-await-in-loop
    //   await cmdAsync(giveFluxNetworkAccess);
    //   log.info(`IPTABLES: Traffic on Flux interface ${int} accepted`);
    // } catch (err) {
    //   log.error(`IPTABLES: Error allowing traffic on Flux interface ${int}. ${err}`);
    //   return false;
    // }
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const network of rfc1918Networks) {
    // if any of these error, we need to bail, as if the deny succeedes, we may cut off access

    const hostAccessParams = baseAllowEstablishedParams.map((item) => item === '#DST' ? network : item)
    // eslint-disable-next-line no-await-in-loop
    const { error: hostAccessToDockerNetworError } =
      await serviceHelper.runCommand('iptables', {
        runAsRoot: true,
        logError: false,
        params: hostAccessParams,
      });

    if (hostAccessToDockerNetworError) {
      log.error(`IPTABLES: Error allowing access to Flux containers from ${network}. ${err}`);
      return false;
    }

    log.info(`IPTABLES: Access to Flux containers from ${network} accepted`);

    const containerToDnsParams = baseAllowDnsParams.map((item) => item === '#DST' ? network : item)
    // eslint-disable-next-line no-await-in-loop
    const { error: containersToDnsError } = await serviceHelper.runCommand(
      'iptables',
      { runAsRoot: true, logError: false, params: containerToDnsParams }
    );

    if (containersToDnsError) {
      log.error(`IPTABLES: Error allowing DNS access to ${network} from Flux containers. ${err}`);
      return false;
    }

    log.info(`IPTABLES: DNS access to ${network} from Flux containers accepted`);

    const dropContainersToHostParams = baseDropToPrivateParams.map((item) => item === '#DST' ? network : item);
    // eslint-disable-next-line no-await-in-loop
    const { error: dropContainersToHostError } = await serviceHelper.runCommand(
      'iptables',
      { runAsRoot: true, logError: false, params: dropContainersToHostParams }
    );

    if (dropContainersToHostError) {
      log.error(`IPTABLES: Error denying access to ${network} from Flux containers. ${err}`);
      return false;
    }

    log.info(`IPTABLES: Access to ${network} from Flux containers removed`);

    // baseAllowToFluxNetworksParams.map((item) => item === '#INT' ? network : item)
    // const giveHostAccessToDockerNetwork = baseAllowEstablishedCmd.replace('#DST', network);
    // try {
    //   // eslint-disable-next-line no-await-in-loop
    //   await cmdAsync(giveHostAccessToDockerNetwork);
    //   log.info(`IPTABLES: Access to Flux containers from ${network} accepted`);
    // } catch (err) {
    //   log.error(`IPTABLES: Error allowing access to Flux containers from ${network}. ${err}`);
    //   return false;
    // }

    // const giveContainerAccessToDNS = baseAllowDnsCmd.replace('#DST', network);
    // try {
    //   // eslint-disable-next-line no-await-in-loop
    //   await cmdAsync(giveContainerAccessToDNS);
    //   log.info(`IPTABLES: DNS access to ${network} from Flux containers accepted`);
    // } catch (err) {
    //   log.error(`IPTABLES: Error allowing DNS access to ${network} from Flux containers. ${err}`);
    //   return false;
    // }

    // This always gets appended, so the drop is at the end
    // const dropAccessToHostNetwork = baseDropCmd.replace('#DST', network);
    // try {
    //   // eslint-disable-next-line no-await-in-loop
    //   await cmdAsync(dropAccessToHostNetwork);
    //   log.info(`IPTABLES: Access to ${network} from Flux containers removed`);
    // } catch (err) {
    //   log.error(`IPTABLES: Error denying access to ${network} from Flux containers. ${err}`);
    //   return false;
    // }
  }

  const { error: returnError } = await serviceHelper.runCommand('iptables', {
    runAsRoot: true,
    logError: false,
    params: addReturnParams,
  });

  if (returnError) {
    log.error(`IPTABLES: Error adding explicit return to Forward chain. ${err}`);
    return false;
  }

  log.info('IPTABLES: DOCKER-USER explicit return to FORWARD chain added');

  return true;

  // try {
  //   await cmdAsync(addReturnCmd);
  //   log.info('IPTABLES: DOCKER-USER explicit return to FORWARD chain added');
  // } catch (err) {
  //   log.error(`IPTABLES: Error adding explicit return to Forward chain. ${err}`);
  //   return false;
  // }
  // return true;
}

const lruRateOptions = {
  max: 500,
  ttl: 1000 * 15, // 15 seconds
  maxAge: 1000 * 15, // 15 seconds
};
const lruRateCache = new LRUCache(lruRateOptions);
/**
 * To check rate limit.
 * @param {string} ip IP address.
 * @param {number} limitPerSecond Defaults to value of 20
 * @returns {boolean} True if a ip is allowed to do a request, otherwise false
 */
function lruRateLimit(ip, limitPerSecond = 20) {
  const lruResponse = lruRateCache.get(ip);
  const newTime = Date.now();
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

/**
 * Allow Node to bind to privileged without sudo
 * @returns {Prmoise<void>}
 */
async function allowNodeToBindPrivilegedPorts() {
  await serviceHelper.runCommand('setcap', {
    runAsRoot: true,
    params: ['cap_net_bind_service=+ep', process.execPath],
  });

  // try {
  //   const exec = "sudo setcap 'cap_net_bind_service=+ep' `which node`";
  //   await cmdAsync(exec);
  // } catch (error) {
  //   log.error(error);
  // }
}

module.exports = {
  adjustExternalIP,
  adjustFirewall,
  allowPort,
  allowPortApi,
  allowUfwPorts,
  checkFluxAvailability,
  checkFluxbenchVersionAllowed,
  checkMyFluxAvailability,
  checkRateLimit,
  closeIncomingConnection,
  closeOutboundConnection,
  deleteAllowOutPortRule,
  deleteAllowPortRule,
  denyPort,
  getDOSState,
  getFluxNodePrivateKey,
  getFluxNodePublicKey,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  getMyFluxIPandPort,
  getRandomConnection,
  isFluxAvailable,
  minVersionSatisfy,
  purgeUFW,
  startNetworkSentinel,
  stopNetworkSentinel,
  // Exports for testing purposes
  allowNodeToBindPrivilegedPorts,
  checkAppAvailability,
  fluxSystemUptime,
  fluxUptime,
  getDosMessage,
  getDosStateValue,
  getStoredFluxBenchAllowed,
  isCommunicationEstablished,
  isPortBanned,
  isPortEnterprise,
  isPortOpen,
  isPortUPNPBanned,
  isPortUserBlocked,
  lruRateLimit,
  removeDockerContainerAccessToNonRoutable,
  setDosMessage,
  setDosStateValue,
  setMyFluxIp,
  setStoredFluxBenchAllowed,
};
