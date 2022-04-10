/* eslint-disable no-underscore-dangle */
const config = require('config');
const bitcoinjs = require('bitcoinjs-lib');
const cmd = require('node-cmd');
const fs = require('fs').promises;
const path = require('path');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonService = require('./daemonService');
const benchmarkService = require('./benchmarkService');
const verificationHelper = require('./verificationHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const userconfig = require('../../../config/userconfig');
const { outgoingConnections } = require('./utils/outgoingConnections');
const { incomingConnections } = require('./utils/incomingConnections');
const { outgoingPeers } = require('./utils/outgoingPeers');
const { incomingPeers } = require('./utils/incomingPeers');

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

const minimumFluxBenchAllowedVersion = 300;
const minimumFluxOSAllowedVersion = 3100;
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

    this.lastFilled = Math.floor(Date.now() / 1000);
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
    const now = Math.floor(Date.now() / 1000);
    const rate = (now - this.lastFilled) / this.fillPerSecond;

    this.tokens = Math.min(this.capacity, this.tokens + Math.floor(rate * this.capacity));
    this.lastFilled = now;
  }
}

// basic check for a version of other flux.
async function isFluxAvailable(ip, port = config.server.apiport) {
  try {
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${port}/flux/version`, axiosConfig);
    if (fluxResponse.data.status !== 'success') return false;

    let fluxVersion = fluxResponse.data.data;
    fluxVersion = fluxVersion.replace(/\./g, '');
    if (fluxVersion >= minimumFluxOSAllowedVersion) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// basic check for a version of other flux.
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
 * Setter for myFluxIp.
 * Main goal for this is testing availability.
 *
 * @param {string} value new IP to be set
 */
function setMyFluxIp(value) {
  myFluxIP = value;
}

async function getMyFluxIPandPort() {
  const benchmarkResponse = await daemonService.getBenchmarks();
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

async function getFluxNodePrivateKey(privatekey) {
  const privKey = privatekey || daemonService.getConfigValue('zelnodeprivkey');
  return privKey;
}

async function getFluxNodePublicKey(privatekey) {
  try {
    const privKey = await getFluxNodePrivateKey(privatekey);
    const keyPair = bitcoinjs.ECPair.fromWIF(privKey);
    const pubKey = keyPair.publicKey.toString('hex');
    return pubKey;
  } catch (error) {
    return error;
  }
}

async function getRandomConnection() { // returns ip:port or just ip if default
  const nodeList = await fluxCommunicationUtils.deterministicFluxList();
  const zlLength = nodeList.length;
  if (zlLength === 0) {
    return null;
  }
  const randomNode = Math.floor((Math.random() * zlLength)); // we do not really need a 'random'
  const ip = nodeList[randomNode].ip || nodeList[randomNode].ipaddress;
  const apiPort = userconfig.initial.apiport || config.server.apiport;

  if (ip === userconfig.initial.ipaddress || ip === myFluxIP || ip === `${userconfig.initial.ipaddress}:${apiPort}`) {
    return null;
  }
  return ip;
}

async function closeConnection(ip) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  const wsObj = await outgoingConnections.find((client) => client._socket.remoteAddress === ip);
  if (!wsObj) {
    return messageHelper.createWarningMessage(`Connection to ${ip} does not exists.`);
  }
  const ocIndex = outgoingConnections.indexOf(wsObj);
  const foundPeer = await outgoingPeers.find((peer) => peer.ip === ip);
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
  const foundPeer = await incomingPeers.find((peer) => peer.ip === ip);
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

function getIncomingConnectionsInfo(req, res) {
  const connections = incomingPeers;
  const message = messageHelper.createDataMessage(connections);
  response = message;
  res.json(response);
}

/**
 * Setter for storedFluxBenchAllowed.
 * Main goal for this is testing availability.
 *
 * @param {number} value
 */
function setStoredFluxBenchAllowed(value) {
  storedFluxBenchAllowed = value ? +value : null;
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

async function checkFluxbenchVersionAllowed() {
  if (storedFluxBenchAllowed) {
    return storedFluxBenchAllowed >= minimumFluxBenchAllowedVersion;
  }
  try {
    const benchmarkInfoResponse = await benchmarkService.getInfo();
    if (benchmarkInfoResponse.status === 'success') {
      log.info(benchmarkInfoResponse);
      let benchmarkVersion = benchmarkInfoResponse.data.version;
      benchmarkVersion = benchmarkVersion.replace(/\./g, '');
      setStoredFluxBenchAllowed(benchmarkVersion);
      if (benchmarkVersion >= minimumFluxBenchAllowedVersion) {
        return true;
      }
      dosState += 11;
      dosMessage = `Fluxbench Version Error. Current lower version allowed is v${minimumFluxBenchAllowedVersion} found v${benchmarkVersion}`;
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    dosMessage = 'Fluxbench Version Error. Error obtaining Flux Version.';
    log.error(dosMessage);
    return false;
  } catch (err) {
    log.error(err);
    log.error(`Error on checkFluxBenchVersion: ${err.message}`);
    dosState += 2;
    dosMessage = 'Fluxbench Version Error. Error obtaining Flux Version.';
    return false;
  }
}

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
      dosMessage = dosMessage || 'Flux communication is limited';
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
    console.log(benchIpResponse);
    if (benchIpResponse.status === 'success') {
      let benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
      if (benchMyIP && userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) {
        // add port
        benchMyIP += userconfig.initial.apiport;
      }
      if (benchMyIP && benchMyIP !== myIP) {
        log.info('New public Ip detected, updating the FluxNode info in the network');
        myIP = benchMyIP;
        daemonService.createConfirmationTransaction();
        await serviceHelper.delay(4 * 60 * 1000); // lets wait 2 blocks time for the transaction to be mined
        return true;
      } if (benchMyIP && benchMyIP === myIP) {
        log.info('FluxBench reported the same Ip that was already in use');
      } else {
        dosMessage = 'Error getting publicIp from FluxBench';
        dosState += 15;
        log.error('FluxBench wasnt able to detect flux node public ip');
      }
    } else {
      dosMessage = 'Error getting publicIp from FluxBench';
      dosState += 15;
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    if (dosState > 10) {
      dosMessage = dosMessage || 'Flux is not available for outside communication';
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  dosState = 0;
  dosMessage = null;
  return true;
}

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
    apiport: ${Number(userconfig.initial.apiport || config.apiport)},
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);
  } catch (error) {
    log.error(error);
  }
}

async function checkDeterministicNodesCollisions() {
  try {
    // get my external ip address
    // get node list with filter on this ip address
    // if it returns more than 1 object, shut down.
    // another precatuion might be comparing node list on multiple nodes. evaulate in the future
    const myIP = await getMyFluxIPandPort();
    if (myIP) {
      const syncStatus = daemonService.isDaemonSynced();
      if (!syncStatus.data.synced) {
        setTimeout(() => {
          checkDeterministicNodesCollisions();
        }, 120 * 1000);
        return;
      }
      const nodeList = await fluxCommunicationUtils.deterministicFluxList();
      const result = nodeList.filter((node) => node.ip === myIP);
      const nodeStatus = await daemonService.getZelNodeStatus();
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
              log.error('Flux earlier collision detection');
              dosState = 100;
              dosMessage = 'Flux earlier collision detection';
              return;
            }
          }
          // prevent new activation
        } else if (result.length === 1) {
          if (!myNode) {
            log.error('Flux collision detection');
            dosState = 100;
            dosMessage = 'Flux collision detection';
            return;
          }
        }
      }
      const availabilityOk = await checkMyFluxAvailability();
      if (availabilityOk) {
        adjustExternalIP(myIP.split(':')[0]);
      }
    } else {
      dosState += 1;
      if (dosState > 10) {
        dosMessage = dosMessage || 'Flux IP detection failed';
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

async function getDOSState(req, res) {
  const data = {
    dosState,
    dosMessage,
  };
  response = messageHelper.createDataMessage(data);
  return res ? res.json(response) : response;
}

async function allowPort(port) {
  const exec = `sudo ufw allow ${port} && sudo ufw allow out ${port}`;
  const cmdAsync = util.promisify(cmd.get);

  const cmdres = await cmdAsync(exec);
  console.log(cmdres);
  const cmdStat = {
    status: false,
    message: null,
  };
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('existing') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

async function denyPort(port) {
  const exec = `sudo ufw deny ${port} && sudo ufw deny out ${port}`;
  const cmdAsync = util.promisify(cmd.get);

  const cmdres = await cmdAsync(exec);
  console.log(cmdres);
  const cmdStat = {
    status: false,
    message: null,
  };
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('existing') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

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

async function isFirewallActive() {
  try {
    const cmdAsync = util.promisify(cmd.get);
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

async function adjustFirewall() {
  try {
    const cmdAsync = util.promisify(cmd.get);
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const homePort = +apiPort - 1;
    let ports = [apiPort, homePort, 80, 443, 16125];
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
          log.info(`Firewall adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall for port ${port}`);
        }
      }
    } else {
      log.info('Firewall is not active. Adjusting not applied');
    }
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
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
  allowPortApi,
  adjustFirewall,
  checkRateLimit,
  closeConnection,
  closeIncomingConnection,
  checkFluxbenchVersionAllowed,
  checkMyFluxAvailability,
  adjustExternalIP,
  allowPort,
  isFirewallActive,
  // Exports for testing purposes
  setStoredFluxBenchAllowed,
  getStoredFluxBenchAllowed,
  setMyFluxIp,
};
