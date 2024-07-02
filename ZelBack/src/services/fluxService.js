const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

const config = require('config');

const log = require('../lib/log');
const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('./daemonService/daemonServiceBlockchainRpcs');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceBenchmarkRpcs = require('./daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceControlRpcs = require('./daemonService/daemonServiceControlRpcs');
const benchmarkService = require('./benchmarkService');
const appsService = require('./appsService');
const generalService = require('./generalService');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const geolocationService = require('./geolocationService');
const syncthingService = require('./syncthingService');
const dockerService = require('./dockerService');

// for streamChain endpoint
const zlib = require('node:zlib');
const tar = require('tar-fs');
// use non promises stream for node 14.x compatibility
// const stream = require('node:stream/promises');
const stream = require('node:stream');

/**
 * Stream chain lock, so only one request at a time
 */
let lock = false;

/**
 * For testing
 */
function unlockStreamLock() {
  lock = false;
}

/**
 * For testing
 */
function lockStreamLock() {
  lock = true;
}

/**
 * To show the directory on the node machine where FluxOS files are stored.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
async function fluxBackendFolder(req, res) {
  const fluxBackFolder = path.join(__dirname, '../../');
  const message = messageHelper.createDataMessage(fluxBackFolder);
  return res.json(message);
}

/**
 * To show the current short commit id.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
async function getCurrentCommitId(req, res) {
  // Fix - this breaks if head in detached state? (or something, can't remember)
  if (req) {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
  }

  const { stdout: commitId, error } = await serviceHelper.runCommand('git', {
    logError: false, params: ['rev-parse', '--short', 'HEAD'],
  });

  if (error) {
    const errMsg = messageHelper.createErrorMessage(
      `Error getting current commit id of Flux: ${error.message}`,
      error.name,
      error.code,
    );
    return res ? res.json(errMsg) : errMsg;
  }

  const successMsg = messageHelper.createSuccessMessage(commitId.trim());
  return res ? res.json(successMsg) : successMsg;
}

/**
 * To show the currently selected branch.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
async function getCurrentBranch(req, res) {
  // ToDo: Fix - this breaks if head in detached state (or something similar)
  if (req) {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
  }

  const { stdout: commitId, error } = await serviceHelper.runCommand('git', {
    logError: false, params: ['rev-parse', '--abbrev-ref', 'HEAD'],
  });

  if (error) {
    const errMsg = messageHelper.createErrorMessage(
      `Error getting current branch of Flux: ${error.message}`,
      error.name,
      error.code,
    );
    return res ? res.json(errMsg) : errMsg;
  }

  const successMsg = messageHelper.createSuccessMessage(commitId.trim());
  return res ? res.json(successMsg) : successMsg;
}

/**
 * Check out branch if it exists locally
 * @param {string} branch The branch to checkout
 * @param {{pull?: Boolean}} options
 * @returns {Promise<Boolean>}
 */
async function checkoutBranch(branch, options = {}) {
  // ToDo: this will break if multiple remotes
  const { error: verifyError } = await serviceHelper.runCommand('git', {
    params: ['rev-parse', '--verify', branch],
  });

  if (verifyError) return false;

  const { error: checkoutError } = await serviceHelper.runCommand('git', {
    params: ['checkout', branch],
  });

  if (checkoutError) return false;

  if (options.pull) {
    const { error: pullError } = await serviceHelper.runCommand('git', { params: ['pull'] });
    if (pullError) return false;
  }

  return true;
}

/**
 * To switch to master branch of FluxOS. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function enterMaster(req, res) {
  // why use npm for this?
  if (req) {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
  }
  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'entermaster'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error entering master branch of Flux: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Master branch successfully entered');
  return res ? res.json(message) : message;
}

/**
 * To switch to development branch of FluxOS. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function enterDevelopment(req, res) {
  if (req) {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
  }
  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'enterdevelopment'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error entering development branch of Flux: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Development branch successfully entered');
  return res ? res.json(message) : message;
}

/**
 * To update FluxOS version (executes the command `npm run updateflux` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Proimse<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function updateFlux(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'updateflux'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error updating Flux: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Flux successfully updated');
  return res ? res.json(message) : message;
}

/**
 * To soft update FluxOS version (executes the command `npm run softupdate` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function softUpdateFlux(req, res) {
  if (req) {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
  }

  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'softupdate'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error soft updating Flux: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Flux successfully soft updated');
  return res ? res.json(message) : message;
}

/**
 * To install the soft update of FluxOS (executes the command `npm run softupdateinstall` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function softUpdateFluxInstall(req, res) {
  if (req) {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errMessage) : errMessage;
    }
  }

  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'softupdateinstall'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error soft updating Flux with installation: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Flux successfully soft updated with installation');
  return res ? res.json(message) : message;
}

/**
 * To hard update FluxOS version (executes the command `npm run hardupdateflux` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function hardUpdateFlux(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'hardupdateflux'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error hard updating Flux: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Flux successfully hard updated');
  return res ? res.json(message) : message;
}

/**
 * To rebuild FluxOS (executes the command `npm run homebuild` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function rebuildHome(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../');

  const { error } = await serviceHelper.runCommand('npm', { cwd, params: ['run', 'homebuild'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error rebuilding Flux UI: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Flux UI successfully rebuilt');
  return res ? res.json(message) : message;
}

/**
 * To update Flux daemon version (executes the command `bash updateDaemon.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function updateDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../helpers');
  const scriptPath = path.join(cwd, 'updateDaemon.sh');

  const { error } = await serviceHelper.runCommand(scriptPath, { cwd });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error updating Daemon: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Daemon successfully updated');
  return res ? res.json(message) : message;
}

/**
 * To update Flux benchmark version (executes the command `bash updateBenchmark.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function updateBenchmark(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../helpers');
  const scriptPath = path.join(cwd, 'updateBenchmark.sh');

  const { error } = await serviceHelper.runCommand(scriptPath, { cwd });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error updating Benchmark: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Benchmark successfully updated');
  return res ? res.json(message) : message;
}

/**
 * To start Flux benchmark (executes the command `fluxbenchd -daemon` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function startBenchmark(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const bin = await fs
    .access('/usr/local/bin/fluxbenchd', fs.constants.F_OK)
    .then(() => 'fluxbenchd')
    .catch(() => 'zelbenchd');

  const { error } = await serviceHelper.runCommand(bin, { params: ['-daemon'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error starting Benchmark: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Benchmark successfully started');
  return res ? res.json(message) : message;
}

/**
 * To restart Flux benchmark (executes the command `bash restartBenchmark.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function restartBenchmark(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../helpers');
  const scriptPath = path.join(cwd, 'restartBenchmark.sh');

  const { error } = await serviceHelper.runCommand(scriptPath, { cwd });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error restarting Benchmark: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Benchmark successfully restarted');
  return res ? res.json(message) : message;
}

/**
 * To start Flux daemon (executes the command `fluxd` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function startDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const bin = await fs
    .access('/usr/local/bin/fluxd', fs.constants.F_OK)
    .then(() => 'fluxd')
    .catch(() => 'zelcashd');

  const { error } = await serviceHelper.runCommand(bin);

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error starting Daemon: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Daemon successfully started');
  return res ? res.json(message) : message;
}

/**
 * To restart Flux daemon (executes the command `bash restartDaemon.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function restartDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../helpers');
  const scriptPath = path.join(cwd, 'restartDaemon.sh');

  const { error } = await serviceHelper.runCommand(scriptPath, { cwd });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error restarting Daemon: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Daemon successfully restarted');
  return res ? res.json(message) : message;
}

/**
 * To reindex Flux daemon database (executes the command `bash reindexDaemon.sh` on the node machine). Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Proise<object>} Message.
 */
// eslint-disable-next-line consistent-return
async function reindexDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }

  const cwd = path.join(__dirname, '../../../helpers');
  const scriptPath = path.join(cwd, 'reindexDaemon.sh');

  const { error } = await serviceHelper.runCommand(scriptPath, { cwd });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error reindexing Daemon: ${error.message}`, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }

  const message = messageHelper.createSuccessMessage('Daemon successfully reindexing');
  return res ? res.json(message) : message;
}

/**
 * To show FluxOS version.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getFluxVersion(req, res) {
  const { version } = packageJson;
  const message = messageHelper.createDataMessage(version);
  return res ? res.json(message) : message;
}

/**
 * To show NodeJS version.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getNodeJsVersions(req, res) {
  const { versions } = process;
  const message = messageHelper.createDataMessage(versions);
  return res ? res.json(message) : message;
}

/**
 * To show FluxOS IP address.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
async function getFluxIP(req, res) {
  const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  }
  const message = messageHelper.createDataMessage(myIP);
  return res ? res.json(message) : message;
}

/**
 * To show the current user's Flux ID that is being used to access FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getFluxZelID(req, res) {
  const zelID = userconfig.initial.zelid;
  const message = messageHelper.createDataMessage(zelID);
  return res ? res.json(message) : message;
}

/**
 * To show the if FluxNode is running under a known static ip ISP/Org.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function isStaticIPapi(req, res) {
  const staticIp = geolocationService.isStaticIP();
  const message = messageHelper.createDataMessage(staticIp);
  return res ? res.json(message) : message;
}

/**
 * Returns FluxNode IP information/geolocation.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getFluxGeolocation(req, res) {
  const geo = geolocationService.getNodeGeolocation();
  const message = messageHelper.createDataMessage(geo);
  return res ? res.json(message) : message;
}

/**
 * To show the node pgp public key
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getFluxPGPidentity(req, res) {
  const pgp = userconfig.initial.pgpPublicKey;
  const message = messageHelper.createDataMessage(pgp);
  return res ? res.json(message) : message;
}

/**
 * To show the current CruxID that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getFluxCruxID(req, res) {
  const cruxID = userconfig.initial.cruxid || null;
  const message = messageHelper.createDataMessage(cruxID);
  return res ? res.json(message) : message;
}

/**
 * To show the current user's Kadena address (public key) that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getFluxKadena(req, res) {
  const kadena = userconfig.initial.kadena || null;
  const message = messageHelper.createDataMessage(kadena);
  return res ? res.json(message) : message;
}

/**
 * To show the current user's Router IP setup in configuration file that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getRouterIP(req, res) {
  const routerIP = userconfig.initial.routerIP || '';
  const message = messageHelper.createDataMessage(routerIP);
  return res ? res.json(message) : message;
}

/**
 * To show the current user's blocked Ports setup in configuration file that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getBlockedPorts(req, res) {
  const blockedPorts = userconfig.initial.blockedPorts || [];
  const message = messageHelper.createDataMessage(blockedPorts);
  return res ? res.json(message) : message;
}

/**
 * To show the current user's Api Port setup in configuration file that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getAPIPort(req, res) {
  const routerIP = userconfig.initial.apiport || '16127';
  const message = messageHelper.createDataMessage(routerIP);
  return res ? res.json(message) : message;
}

/**
 * To show the current user's blocked respositories setup in configuration file that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getBlockedRepositories(req, res) {
  const blockedPorts = userconfig.initial.blockedRepositories || [];
  const message = messageHelper.createDataMessage(blockedPorts);
  return res ? res.json(message) : message;
}

/**
 * To marketplace URL to show based on current development flag setup in configuration file that is being used with FluxOS.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getMarketplaceURL(req, res) {
  const development = userconfig.initial.development || false;
  let marketPlaceUrl = 'https://stats.runonflux.io/marketplace/listapps';
  if (development) {
    marketPlaceUrl = 'https://stats.runonflux.io/marketplace/listdevapps';
  }
  const message = messageHelper.createDataMessage(marketPlaceUrl);
  return res ? res.json(message) : message;
}

/**
 * To download Flux daemon debug logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Debug.log file for Flux daemon.
 */
async function daemonDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  // check daemon datadir
  const defaultDir = daemonServiceUtils.getFluxdDir();
  const datadir = daemonServiceUtils.getConfigValue('datadir') || defaultDir;
  const filepath = `${datadir}/debug.log`;

  return res.download(filepath, 'debug.log');
}

/**
 * To download Flux benchmark debug logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Debug.log file for Flux benchmark.
 */
async function benchmarkDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const homeDirPath = path.join(__dirname, '../../../../');
  const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');

  const datadir = await fs
    .access(newBenchmarkPath, fs.constants.F_OK)
    .then(() => newBenchmarkPath)
    .catch(() => path.join(homeDirPath, '.zelbenchmark'));

  const filepath = path.join(datadir, 'debug.log');

  return res.download(filepath, 'debug.log');
}

/**
 * To get Flux daemon tail debug logs (executes the command `tail -n 100 debug.log` in the relevent daemon directory on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailDaemonDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
    return;
  }

  const defaultDir = daemonServiceUtils.getFluxdDir();
  const datadir = daemonServiceUtils.getConfigValue('datadir') || defaultDir;
  const filepath = path.join(datadir, 'debug.log');

  const { stdout, error } = await serviceHelper.runCommand('tail', {
    params: ['-n', '100', filepath],
  });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error obtaining Daemon debug file: ${error.message}`, error.name, error.code);
    res.json(errMessage);
    return;
  }

  const message = messageHelper.createSuccessMessage(stdout);
  res.json(message);
}

/**
 * To get Flux benchmark tail debug logs (executes the command `tail -n 100 debug.log` in the relevent benchmark directory on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailBenchmarkDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
    return;
  }

  const homeDirPath = path.join(__dirname, '../../../../');
  const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');

  const datadir = await fs
    .access(newBenchmarkPath, fs.constants.F_OK)
    .then(() => newBenchmarkPath)
    .catch(() => path.join(homeDirPath, '.zelbenchmark'));

  const filepath = path.join(datadir, 'debug.log');

  const { stdout, error } = await serviceHelper.runCommand('tail', {
    params: ['-n', '100', filepath],
  });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error obtaining Benchmark debug file: ${error.message}`, error.name, error.code);
    res.json(errMessage);
    return;
  }

  const message = messageHelper.createSuccessMessage(stdout);
  res.json(message);
}

/**
 * To download a specified FluxOS log file.
 * @param {object} res Response.
 * @param {string} filelog Log file name (excluding `.log`).
 * @returns {Promise<object>} FluxOS .log file.
 */
async function fluxLog(res, filelog) {
  const homeDirPath = path.join(__dirname, '../../../');
  const filepath = `${homeDirPath}${filelog}.log`;

  return res.download(filepath, `${filelog}.log`);
}

/**
 * To download FluxOS error log. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxErrorLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'error');
  } catch (error) {
    log.error(error);
  }
}

/**
 * To download FluxOS warn log. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxWarnLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'warn');
  } catch (error) {
    log.error(error);
  }
}

/**
 * To download FluxOS info log. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxInfoLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'info');
  } catch (error) {
    log.error(error);
  }
}

/**
 * To download FluxOS debug log. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxDebugLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'debug');
  } catch (error) {
    log.error(error);
  }
}

/**
 * To get a specified FluxOS tail log file (executes the command `tail -n 100` for the specified .log file on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {Promise<string>} logfile Log file name (excluding `.log`).
 */
async function tailFluxLog(req, res, logfile) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
    return;
  }

  const homeDirPath = path.join(__dirname, '../../../');
  const filepath = path.join(homeDirPath, `${logfile}.log`);

  const { stdout, error } = await serviceHelper.runCommand('tail', {
    params: ['-n', '100', filepath],
  });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(`Error obtaining Flux log file: ${error.message}`, error.name, error.code);
    res.json(errMessage);
    return;
  }

  const message = messageHelper.createSuccessMessage(stdout);
  res.json(message);
}

/**
 * To get FluxOS tail error logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailFluxErrorLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await tailFluxLog(req, res, 'error');
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To get FluxOS tail warn logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailFluxWarnLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await tailFluxLog(req, res, 'warn');
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To get FluxOS tail info logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailFluxInfoLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await tailFluxLog(req, res, 'info');
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To get FluxOS tail debug logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailFluxDebugLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await tailFluxLog(req, res, 'debug');
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To get FluxOS time zone.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
function getFluxTimezone(req, res) {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const message = messageHelper.createDataMessage(timezone);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    const message = 'Unknown';
    return res ? res.json(message) : message;
  }
}

/**
 * To get info (version, status etc.) for daemon, node, benchmark, FluxOS and apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>} Message.
 */
async function getFluxInfo(req, res) {
  try {
    const info = {
      daemon: {},
      node: {},
      benchmark: {},
      flux: {},
      apps: {},
      geolocation: geolocationService.getNodeGeolocation(),
    };
    const versionRes = await getFluxVersion();
    if (versionRes.status === 'error') {
      throw versionRes.data;
    }
    info.flux.version = versionRes.data;
    const nodeJsVersionsRes = await getNodeJsVersions();
    if (nodeJsVersionsRes.status === 'error') {
      throw nodeJsVersionsRes.data;
    }
    info.flux.nodeJsVersion = nodeJsVersionsRes.data.node;
    const syncthingVersion = await syncthingService.systemVersion();
    if (syncthingVersion.status === 'error') {
      throw syncthingVersion.data;
    }
    info.flux.syncthingVersion = syncthingVersion.data.version;
    const dockerVersion = await dockerService.dockerVersion();
    info.flux.dockerVersion = dockerVersion.Version;
    const ipRes = await getFluxIP();
    if (ipRes.status === 'error') {
      throw ipRes.data;
    }
    info.flux.ip = ipRes.data;
    info.flux.staticIp = geolocationService.isStaticIP();
    const zelidRes = await getFluxZelID();
    if (zelidRes.status === 'error') {
      throw zelidRes.data;
    }
    info.flux.zelid = zelidRes.data;
    const pgp = await getFluxPGPidentity();
    if (pgp.status === 'error') {
      throw pgp.data;
    }
    const cruxidRes = await getFluxCruxID();
    if (cruxidRes.status === 'error') {
      throw cruxidRes.data;
    }
    info.flux.cruxid = cruxidRes.data;
    const timeResult = await getFluxTimezone();
    if (timeResult.status === 'error') {
      throw timeResult.data;
    }
    info.flux.timezone = timeResult.data;
    const dosResult = await fluxNetworkHelper.getDOSState();
    if (dosResult.status === 'error') {
      throw dosResult.data;
    }
    info.flux.dos = dosResult.data;
    const dosAppsResult = await appsService.getAppsDOSState();
    if (dosResult.status === 'error') {
      throw dosAppsResult.data;
    }
    info.flux.appsDos = dosAppsResult.data;
    info.flux.development = userconfig.initial.development || false;
    const daemonInfoRes = await daemonServiceControlRpcs.getInfo();
    if (daemonInfoRes.status === 'error') {
      throw daemonInfoRes.data;
    }
    info.daemon.info = daemonInfoRes.data;
    const daemonNodeStatusRes = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
    if (daemonNodeStatusRes.status === 'error') {
      throw daemonNodeStatusRes.data;
    }
    info.node.status = daemonNodeStatusRes.data;
    const benchmarkInfoRes = await benchmarkService.getInfo();
    if (benchmarkInfoRes.status === 'error') {
      throw benchmarkInfoRes.data;
    }
    info.benchmark.info = benchmarkInfoRes.data;
    const benchmarkStatusRes = await benchmarkService.getStatus();
    if (benchmarkStatusRes.status === 'error') {
      throw benchmarkStatusRes.data;
    }
    info.benchmark.status = benchmarkStatusRes.data;
    const benchmarkBenchRes = await benchmarkService.getBenchmarks();
    if (benchmarkBenchRes.status === 'error') {
      throw benchmarkBenchRes.data;
    }
    info.benchmark.bench = benchmarkBenchRes.data;

    const apppsFluxUsage = await appsService.fluxUsage();
    if (apppsFluxUsage.status === 'error') {
      throw apppsFluxUsage.data;
    }
    info.apps.fluxusage = apppsFluxUsage.data;
    const appsRunning = await appsService.listRunningApps();
    if (appsRunning.status === 'error') {
      throw appsRunning.data;
    }
    info.apps.runningapps = appsRunning.data;
    const appsResources = await appsService.appsResources();
    if (appsResources.status === 'error') {
      throw appsResources.data;
    }
    info.apps.resources = appsResources.data;
    const appHashes = await appsService.getAppHashes();
    if (appHashes.status === 'error') {
      throw appHashes.data;
    }
    const hashesOk = appHashes.data.filter((data) => data.height >= 694000);
    info.appsHashesTotal = hashesOk.length;
    const mesOK = hashesOk.filter((mes) => mes.message === true);
    info.hashesPresent = mesOK.length;
    const explorerScannedHeight = await explorerService.getScannedHeight();
    if (explorerScannedHeight.status === 'error') {
      throw explorerScannedHeight.data;
    }
    info.flux.explorerScannedHeigth = explorerScannedHeight.data;
    const connectionsOut = fluxCommunication.connectedPeersInfo();
    if (connectionsOut.status === 'error') {
      throw connectionsOut.data;
    }
    info.flux.numberOfConnectionsOut = connectionsOut.data.length;
    const connectionsIn = fluxNetworkHelper.getIncomingConnectionsInfo();
    if (connectionsIn.status === 'error') {
      throw connectionsIn.data;
    }
    info.flux.numberOfConnectionsIn = connectionsIn.data.length;

    const response = messageHelper.createDataMessage(info);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To adjust the current CruxID that is being used with FluxOS. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function adjustCruxID(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      let { cruxid } = req.params;
      cruxid = cruxid || req.query.cruxid;
      if (!cruxid) {
        throw new Error('No Crux ID provided');
      }
      if (!cruxid.includes('@')) {
        throw new Error('Invalid Crux ID provided');
      }
      if (!cruxid.includes('.crux')) {
        throw new Error('Invalid Crux ID provided');
      }
      const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
      const dataToWrite = `module.exports = {
        initial: {
          ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
          zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
          kadena: '${userconfig.initial.kadena || ''}',
          testnet: ${userconfig.initial.testnet || false},
          development: ${userconfig.initial.development || false},
          apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
          routerIP: '${userconfig.initial.routerIP || ''}',
          pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
          pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
          blockedPorts: ${JSON.stringify(userconfig.initial.blockedPorts || [])},
          blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
        }
      }`;

      await fs.writeFile(fluxDirPath, dataToWrite);

      const successMessage = messageHelper.createSuccessMessage('CruxID adjusted');
      res.json(successMessage);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To update the current Kadena account (address/public key and chain ID) that is being used with FluxOS. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function adjustKadenaAccount(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      let { account } = req.params;
      account = account || req.query.account;
      let { chainid } = req.params;
      chainid = chainid || req.query.chainid;
      if (!account) {
        throw new Error('No Kadena Account provided');
      }
      if (!chainid) {
        throw new Error('No Kadena Chain ID provided');
      }
      const chainIDNumber = serviceHelper.ensureNumber(chainid);
      if (chainIDNumber > 20 || chainIDNumber < 0 || Number.isNaN(chainIDNumber)) {
        throw new Error(`Invalid Chain ID ${chainid} provided.`);
      }
      const kadenaURI = `kadena:${account}?chainid=${chainid}`;
      const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
      const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
    kadena: '${kadenaURI}',
    testnet: ${userconfig.initial.testnet || false},
    development: ${userconfig.initial.development || false},
    apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
    routerIP: '${userconfig.initial.routerIP || ''}',
    pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
    pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
    blockedPorts: ${JSON.stringify(userconfig.initial.blockedPorts || [])},
    blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
  }
}`;

      await fs.writeFile(fluxDirPath, dataToWrite);

      const successMessage = messageHelper.createSuccessMessage('Kadena account adjusted');
      res.json(successMessage);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To update the current routerIP that is being used with FluxOS. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function adjustRouterIP(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      let { routerip } = req.params;
      routerip = routerip || req.query.routerip || '';

      const dataToWrite = `module.exports = {
        initial: {
          ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
          zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
          kadena: '${userconfig.initial.kadena || ''}',
          testnet: ${userconfig.initial.testnet || false},
          development: ${userconfig.initial.development || false},
          apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
          routerIP: '${routerip}',
          pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
          pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
          blockedPorts: ${JSON.stringify(userconfig.initial.blockedPorts || [])},
          blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
        }
      }`;
      const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
      await fs.writeFile(fluxDirPath, dataToWrite);

      const successMessage = messageHelper.createSuccessMessage('Router IP adjusted');
      res.json(successMessage);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To update the current user blocked ports that is being used with FluxOS. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function adjustBlockedPorts(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
    return;
  }

  try {
    if (!req.body) {
      throw new Error('Missing Blocked Ports Information.');
    }
    const processedBody = serviceHelper.ensureObject(req.body);
    const { blockedPorts } = processedBody;
    log.info(`blockedPorts: ${JSON.stringify(blockedPorts)}`);
    if (!Array.isArray(blockedPorts)) {
      throw new Error('Blocked Ports is not a valid array');
    }
    const dataToWrite = `module.exports = {
            initial: {
              ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
              zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
              kadena: '${userconfig.initial.kadena || ''}',
              testnet: ${userconfig.initial.testnet || false},
              development: ${userconfig.initial.development || false},
              apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
              routerIP: '${userconfig.initial.routerIP || ''}',
              pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
              pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
              blockedPorts: ${JSON.stringify(blockedPorts || [])},
              blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
            }
          }`;
    const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
    await fs.writeFile(fluxDirPath, dataToWrite);
    const successMessage = messageHelper.createSuccessMessage('User Blocked Ports adjusted');
    res.json(successMessage);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To update the current api port that is being used with FluxOS. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function adjustAPIPort(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      let { apiport } = req.params;
      apiport = apiport || req.query.apiport || '';

      const allowedAPIPorts = [16127, 16137, 16147, 16157, 16167, 16177, 16187, 16197];
      if (!allowedAPIPorts.includes(apiport)) {
        const errMessage = messageHelper.createErrorMessage('API Port not valid');
        res.json(errMessage);
        return;
      }

      const dataToWrite = `module.exports = {
        initial: {
          ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
          zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
          kadena: '${userconfig.initial.kadena || ''}',
          testnet: ${userconfig.initial.testnet || false},
          development: ${userconfig.initial.development || false},
          apiport: ${Number(+apiport)},
          routerIP: '${userconfig.initial.routerIP || ''}',
          pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
          pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
          blockedPorts: ${JSON.stringify(userconfig.initial.blockedPorts || [])},
          blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
        }
      }`;
      const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
      await fs.writeFile(fluxDirPath, dataToWrite);

      const successMessage = messageHelper.createSuccessMessage('API Port adjusted. A restart of FluxOS is necessary');
      res.json(successMessage);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To update the current user blocked repositories that is being used with FluxOS. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function adjustBlockedRepositories(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
    return;
  }

  try {
    if (!req.body) {
      throw new Error('Missing Blocked Repositories Information.');
    }
    log.info(`body: ${JSON.stringify(req.body)}`);
    // this is redundant now
    const processedBody = serviceHelper.ensureObject(req.body);
    const { blockedRepositories } = processedBody;
    log.info(`blockedRepositories: ${JSON.stringify(blockedRepositories)}`);
    if (!Array.isArray(blockedRepositories)) {
      throw new Error('Blocked Repositories is not a valid array');
    }
    blockedRepositories.forEach((parameter) => {
      if (typeof parameter !== 'string') {
        throw new Error('Blocked Repositories are invalid');
      }
    });

    const dataToWrite = `module.exports = {
            initial: {
              ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
              zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
              kadena: '${userconfig.initial.kadena || ''}',
              testnet: ${userconfig.initial.testnet || false},
              development: ${userconfig.initial.development || false},
              apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
              routerIP: '${userconfig.initial.routerIP || ''}',
              pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
              pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
              blockedPorts: ${JSON.stringify(userconfig.initial.blockedPorts || [])},
              blockedRepositories: ${JSON.stringify(blockedRepositories || []).replace(/"/g, "'")},
            }
          }`;
    const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
    await fs.writeFile(fluxDirPath, dataToWrite);
    const successMessage = messageHelper.createSuccessMessage('User Blocked Repositories adjusted');
    res.json(successMessage);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get the tier of the FluxNode (Cumulus, Nimbus or Stratus). Checks the node tier against the node collateral.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getNodeTier(req, res) {
  try {
    let responseAux;
    const tier = await generalService.nodeTier();
    const nodeCollateral = await generalService.nodeCollateral();
    if (tier === 'basic' && nodeCollateral === 10000) {
      responseAux = 'cumulus';
    } else if (tier === 'super' && nodeCollateral === 25000) {
      responseAux = 'nimbus';
    } else if (tier === 'bamf' && nodeCollateral === 100000) {
      responseAux = 'stratus';
    } else if (tier === 'basic' && nodeCollateral === 1000) {
      responseAux = 'cumulus_new';
    } else if (tier === 'super' && nodeCollateral === 12500) {
      responseAux = 'nimbus_new';
    } else if (tier === 'bamf' && nodeCollateral === 40000) {
      responseAux = 'stratus_new';
    } else {
      throw new Error('Unrecognised Flux node tier'); // shall not happen as nodeTier throws
    }
    const response = messageHelper.createDataMessage(responseAux);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To install Flux Watch Tower (executes the command `bash fluxwatchtower.sh` in the relevent directory on the node machine).
 */
async function installFluxWatchTower() {
  const cwd = path.join(__dirname, '../../../helpers');
  const scriptPath = path.join(cwd, 'fluxwatchtower.sh');

  const { stdout, error } = await serviceHelper.runCommand(scriptPath, { cwd });

  if (error) return;

  const lines = stdout.split('\n');
  // this always has length
  if (lines.slice(-1)[0] === '') lines.pop();

  lines.forEach((line) => log.info(line));
}

/**
 * Restart FluxOS via nodemon (executes the command `touch ` on package.json).
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function restartFluxOS(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
    return;
  }

  log.info('Restarting FluxOS..');

  const { error } = await serviceHelper.runCommand('pm2', { params: ['restart', 'flux'] });

  if (error) {
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    return;
  }

  const response = messageHelper.createDataMessage('Restarting FluxOS');
  res.json(response);
}

/**
 * Streams the blockchain via http at breakneck speeds.
 *
 * Designed for UPnP nodes.
 *
 * Leverages the fact that a lot of nodes run on the same hypervisor, where
 * they share a brige or v-switch. In this case - the transfer is as fast as your
 * SSD. Real life testing showed speeds of 3.2Gbps on an Evo 980+ SSD. Able to
 * download the entire chain UNCOMPRESED in 90 seconds.
 *
 * Even in a traditional LAN, most consumer grade hardware is 1Gbps - this should be
 * easily achievable in your average home network.
 *
 * During normal operation, the flux daemon (fluxd) must NOT be running, this is so
 * the database is in a consistent state when it is read. However, during testing,
 * and WITHOUT compression, as long as the chain transfer is reasonably fast, there is
 * minimal risk of a db compaction happening, and corrupting the new data.
 *
 * This method can transfer data compressed (using gzip) or uncompressed. It is recommended
 * to only stream the data uncompressed. If using compression on the fly, this uses a lot of
 * CPU and will slow the transfers down by 10-20 times, while only saving ~30% on file size.
 * If the daemon is still running during this time, IT WILL CORRUPT THE NEW DATA. (tested)
 * Due to this, if compression is used, the daemon MUST not be running.
 *
 * There is an unsafe mode, where a user can transfer the chain while the daemon is still
 * running, USE AT YOUR OWN RISK. Of note, the data being copied will not be corrupted,
 * only the new chain.
 *
 * Only allows one stream at a time - will return 503 if stream in progress.
 *
 *  Able to be used by curl. Result is a tarfile.
 *
 * If passing in options, the `Content-Type` header must be set to `application/json`
 *
 * **Example:**
 * ```bash
 *   curl -X POST http://<Node IP>:16187/flux/streamchain -o flux_explorer_bootstrap.tar.gz
 * ```
 *
 * **Post Data:**
 *
 * `unsafe:` <boolean> Will overide the flux daemon running check and run anyway. Only
 *   overideable if compress is not used.
 *
 * `compress:` <boolean> If the file stream should use gzip compression. Very slow.
 *
 * @param {Request} req HTTP request
 * @param {Response} res HTTP response
 * @returns {Promise<void>}
 */
async function streamChain(req, res) {
  if (lock) {
    res.statusMessage = 'Streaming of chain already in progress, server busy.';
    res.status(503).end();
    return;
  }

  try {
    lock = true;

    /**
   * Use the remote address here, don't need to worry about x-forwarded-for headers as
   * we only allow the local network. Also, using the remote address is fine as FluxOS
   * won't confirm if the upstream is natting behind a private address. I.e public
   * connections coming in via a private address. (Flux websockets need the remote address
   * or they think there is only one inbound connnection)
   */
    let ip = req.socket.remoteAddress;
    if (!ip) {
      res.statusMessage = 'Socket closed.';
      res.status(400).end();
      lock = false;
      return;
    }

    // convert from IPv4-mapped IPv6 address format to straight IPv4 (from socket)
    ip = ip.replace(/^.*:/, ''); // this is greedy, so will remove ::ffff:

    if (!serviceHelper.isPrivateAddress(ip)) {
      res.statusMessage = 'Request must be from an address on the same private network as the host.';
      res.status(403).end();
      lock = false;
      return;
    }

    log.info(`Stream chain request received from: ${ip}`);

    const homeDir = os.homedir();
    const base = path.join(homeDir, '.flux');

    const folders = [
      'blocks',
      'chainstate',
      'determ_zelnodes',
    ];

    const folderPromises = folders.map(async (f) => {
      try {
        const stats = await fs.stat(path.join(base, f));
        return stats.isDirectory();
      } catch {
        return false;
      }
    });

    const foldersExist = await Promise.all(folderPromises);
    const chainExists = foldersExist.every((x) => x);

    if (!chainExists) {
      res.statusMessage = 'Unable to find chain at $HOME/.flux';
      res.status(500).end();
      lock = false;
      return;
    }

    let fluxdRunning = null;
    let compress = false;
    let safe = true;

    const processedBody = serviceHelper.ensureObject(req.body);

    // use unsafe for the client end to illistrate that they should think twice before using
    // it, and use safe here for readability
    safe = processedBody.unsafe !== true;
    compress = processedBody.compress || false;

    if (!safe && compress) {
      res.statusMessage = 'Unable to compress blockchain in unsafe mode, it will corrupt new db.';
      res.status(422).end();
      lock = false;
      return;
    }

    if (safe) {
      const blockInfoRes = await daemonServiceBlockchainRpcs.getBlockchainInfo();
      fluxdRunning = !(blockInfoRes.status === 'error' && blockInfoRes.data.code === 'ECONNREFUSED');
    }

    if (safe && fluxdRunning) {
      res.statusMessage = 'Flux daemon still running, unable to clone blockchain.';
      res.status(503).end();
      lock = false;
      return;
    }

    const workflow = [];

    workflow.push(tar.pack(base, {
      entries: folders,
    }));

    if (compress) {
      log.info('Compression requested... adding gzip. This can be 10-20x slower than sending uncompressed');
      workflow.push(zlib.createGzip());
    }

    workflow.push(res);

    const pipeline = promisify(stream.pipeline);

    const error = await pipeline(...workflow).catch((err) => err);

    if (error) log.warn(`Stream error: ${error.code}`);
  } finally {
    lock = false;
  }
}

module.exports = {
  adjustAPIPort,
  adjustBlockedPorts,
  adjustBlockedRepositories,
  adjustCruxID,
  adjustKadenaAccount,
  adjustRouterIP,
  benchmarkDebug,
  checkoutBranch,
  daemonDebug,
  enterDevelopment,
  enterMaster,
  fluxBackendFolder,
  fluxDebugLog,
  fluxErrorLog,
  fluxInfoLog,
  fluxWarnLog,
  getAPIPort,
  getBlockedPorts,
  getBlockedRepositories,
  getCurrentBranch,
  getCurrentCommitId,
  getFluxCruxID,
  getFluxGeolocation,
  getFluxInfo,
  getFluxIP,
  getFluxKadena,
  getFluxPGPidentity,
  getFluxTimezone,
  getFluxVersion,
  getFluxZelID,
  getMarketplaceURL,
  getNodeJsVersions,
  getNodeTier,
  getRouterIP,
  hardUpdateFlux,
  installFluxWatchTower,
  isStaticIPapi,
  lockStreamLock,
  rebuildHome,
  reindexDaemon,
  restartBenchmark,
  restartDaemon,
  restartFluxOS,
  softUpdateFlux,
  softUpdateFluxInstall,
  startBenchmark,
  startDaemon,
  streamChain,
  tailBenchmarkDebug,
  tailDaemonDebug,
  tailFluxDebugLog,
  tailFluxErrorLog,
  tailFluxInfoLog,
  tailFluxWarnLog,
  unlockStreamLock,
  updateBenchmark,
  updateDaemon,
  updateFlux,
  // Exports for testing purposes
  fluxLog,
  tailFluxLog,
};
