const nodecmd = require('node-cmd');
const path = require('path');
const config = require('config');
const fullnode = require('fullnode');
const util = require('util');
const fs = require('fs');

const fsPromises = fs.promises;

const log = require('../lib/log');
const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceZelnodeRpcs = require('./daemonService/daemonServiceZelnodeRpcs');
const daemonServiceBenchmarkRpcs = require('./daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceControlRpcs = require('./daemonService/daemonServiceControlRpcs');
const benchmarkService = require('./benchmarkService');
const appsService = require('./appsService');
const generalService = require('./generalService');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const userconfig = require('../../../config/userconfig');

let storedGeolocation = null;
let storedIp = null;

/**
 * To show the directory on the node machine where FluxOS files are stored.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function fluxBackendFolder(req, res) {
  const fluxBackFolder = path.join(__dirname, '../../');
  const message = messageHelper.createDataMessage(fluxBackFolder);
  return res.json(message);
}

/**
 * To update FluxOS version (executes the command `npm run updateflux` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function updateFlux(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const nodedpath = path.join(__dirname, '../../../');
  const exec = `cd ${nodedpath} && npm run updateflux`;
  nodecmd.get(exec, (err) => {
    if (err) {
      console.log(err);
      const errMessage = messageHelper.createErrorMessage(`Error updating Flux: ${err.message}`, err.name, err.code);
      return res.json(errMessage);
    }
    const message = messageHelper.createSuccessMessage('Flux successfully updated');
    return res.json(message);
  });
}

/**
 * To soft update FluxOS version (executes the command `npm run softupdate` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function softUpdateFlux(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const nodedpath = path.join(__dirname, '../../../');
  const exec = `cd ${nodedpath} && npm run softupdate`;
  nodecmd.get(exec, (err) => {
    if (err) {
      const errMessage = messageHelper.createErrorMessage(`Error softly updating Flux: ${err.message}`, err.name, err.code);
      return res.json(errMessage);
    }
    const message = messageHelper.createSuccessMessage('Flux successfully updated using soft method');
    return res.json(message);
  });
}

/**
 * To install the soft update of FluxOS (executes the command `npm run softupdateinstall` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function softUpdateFluxInstall(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const nodedpath = path.join(__dirname, '../../../');
  const exec = `cd ${nodedpath} && npm run softupdateinstall`;
  nodecmd.get(exec, (err) => {
    if (err) {
      const errMessage = messageHelper.createErrorMessage(`Error softly updating Flux with installation: ${err.message}`, err.name, err.code);
      return res.json(errMessage);
    }
    const message = messageHelper.createSuccessMessage('Flux successfully updated softly with installation');
    return res.json(message);
  });
}

/**
 * To hard update FluxOS version (executes the command `npm run hardupdateflux` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function hardUpdateFlux(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const nodedpath = path.join(__dirname, '../../../');
  const exec = `cd ${nodedpath} && npm run hardupdateflux`;
  nodecmd.get(exec, (err) => {
    if (err) {
      const errMessage = messageHelper.createErrorMessage(`Error hardupdating Flux: ${err.message}`, err.name, err.code);
      return res.json(errMessage);
    }
    const message = messageHelper.createSuccessMessage('Flux successfully updating');
    return res.json(message);
  });
}

/**
 * To rebuild FluxOS (executes the command `npm run homebuild` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function rebuildHome(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const nodedpath = path.join(__dirname, '../../../');
  const exec = `cd ${nodedpath} && npm run homebuild`;
  nodecmd.get(exec, (err) => {
    if (err) {
      const errMessage = messageHelper.createErrorMessage(`Error rebuilding Flux: ${err.message}`, err.name, err.code);
      return res.json(errMessage);
    }
    const message = messageHelper.createSuccessMessage('Flux successfully rebuilt');
    return res.json(message);
  });
}

/**
 * To update Flux daemon version (executes the command `bash updateDaemon.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function updateDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash updateDaemon.sh`;
    nodecmd.get(exec, (err) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error updating Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = messageHelper.createSuccessMessage('Daemon successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

/**
 * To update Flux benchmark version (executes the command `bash updateBenchmark.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function updateBenchmark(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash updateBenchmark.sh`;
    nodecmd.get(exec, (err) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error updating Benchmark: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = messageHelper.createSuccessMessage('Benchmark successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

/**
 * To start Flux benchmark (executes the command `fluxbenchd -daemon` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function startBenchmark(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    let exec = 'zelbenchd -daemon';
    if (fs.existsSync('/usr/local/bin/fluxbenchd')) {
      exec = 'fluxbenchd -daemon';
    }
    nodecmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error starting Benchmark: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message = messageHelper.createSuccessMessage('Benchamrk successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
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
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash restartBenchmark.sh`;
    nodecmd.get(exec, (err) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error restarting Benchmark: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = messageHelper.createSuccessMessage('Benchmark successfully restarted');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    console.log(errMessage);
    return res.json(errMessage);
  }
}

/**
 * To start Flux daemon (executes the command `fluxd` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function startDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    let exec = 'zelcashd';
    if (fs.existsSync('/usr/local/bin/fluxd')) {
      exec = 'fluxd';
    }
    nodecmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error starting Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message = messageHelper.createSuccessMessage('Daemon successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

/**
 * To restart Flux daemon (executes the command `bash restartDaemon.sh` on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function restartDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash restartDaemon.sh`;
    nodecmd.get(exec, (err) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error restarting Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = messageHelper.createSuccessMessage('Daemon successfully restarted');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    console.log(errMessage);
    return res.json(errMessage);
  }
}

/**
 * To reindex Flux daemon database (executes the command `bash reindexDaemon.sh` on the node machine). Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
// eslint-disable-next-line consistent-return
async function reindexDaemon(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash reindexDaemon.sh`;
    nodecmd.get(exec, (err) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error reindexing Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = messageHelper.createSuccessMessage('Daemon successfully reindexing');
      return res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
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
 * To show FluxOS IP address.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
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
 * To show the current user's ZelID that is being used to access FluxOS.
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
 * To download Flux daemon debug logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Debug.log file for Flux daemon.
 */
async function daemonDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (!authorized) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  // check daemon datadir
  const defaultDir = new fullnode.Config().defaultFolder();
  const datadir = daemonServiceMiscRpcs.getConfigValue('datadir') || defaultDir;
  const filepath = `${datadir}/debug.log`;

  return res.download(filepath, 'debug.log');
}

/**
 * To download Flux benchmark debug logs. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Debug.log file for Flux benchmark.
 */
async function benchmarkDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (!authorized) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const homeDirPath = path.join(__dirname, '../../../../');
  const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');
  let datadir = `${homeDirPath}.zelbenchmark`;
  if (fs.existsSync(newBenchmarkPath)) {
    datadir = newBenchmarkPath;
  }
  const filepath = `${datadir}/debug.log`;

  return res.download(filepath, 'debug.log');
}

/**
 * To get Flux daemon tail debug logs (executes the command `tail -n 100 debug.log` in the relevent daemon directory on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailDaemonDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const defaultDir = new fullnode.Config().defaultFolder();
    const datadir = daemonServiceMiscRpcs.getConfigValue('datadir') || defaultDir;
    const filepath = `${datadir}/debug.log`;
    const exec = `tail -n 100 ${filepath}`;
    nodecmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error obtaining Daemon debug file: ${err.message}`, err.name, err.code);
        res.json(errMessage);
        return;
      }
      const message = messageHelper.createSuccessMessage(data);
      res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

/**
 * To get Flux benchmark tail debug logs (executes the command `tail -n 100 debug.log` in the relevent benchmark directory on the node machine). Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function tailBenchmarkDebug(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../../');
    const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');
    let datadir = `${homeDirPath}.zelbenchmark`;
    if (fs.existsSync(newBenchmarkPath)) {
      datadir = newBenchmarkPath;
    }
    const filepath = `${datadir}/debug.log`;
    const exec = `tail -n 100 ${filepath}`;
    nodecmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error obtaining Benchmark debug file: ${err.message}`, err.name, err.code);
        res.json(errMessage);
        return;
      }
      const message = messageHelper.createSuccessMessage(data);
      res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

/**
 * To download a specified FluxOS log file.
 * @param {object} res Response.
 * @param {string} filelog Log file name (excluding `.log`).
 * @returns {object} FluxOS .log file.
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
    if (!authorized) {
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
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxWarnLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
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
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxInfoLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
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
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function fluxDebugLog(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
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
 * @param {string} logfile Log file name (excluding `.log`).
 */
async function tailFluxLog(req, res, logfile) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../');
    const filepath = `${homeDirPath}${logfile}.log`;
    const exec = `tail -n 100 ${filepath}`;
    nodecmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = messageHelper.createErrorMessage(`Error obtaining Flux ${logfile} file: ${err.message}`, err.name, err.code);
        res.json(errMessage);
        return;
      }
      const message = messageHelper.createSuccessMessage(data);
      res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
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
      tailFluxLog(req, res, 'error');
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
      tailFluxLog(req, res, 'warn');
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
      tailFluxLog(req, res, 'info');
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
      tailFluxLog(req, res, 'debug');
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
 * @returns {object} Message.
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
 * @returns {object} Message.
 */
async function getFluxInfo(req, res) {
  try {
    const info = {
      daemon: {},
      node: {},
      benchmark: {},
      flux: {},
      apps: {},
      geolocation: storedGeolocation,
    };
    const versionRes = await getFluxVersion();
    if (versionRes.status === 'error') {
      throw versionRes.data;
    }
    info.flux.version = versionRes.data;
    const ipRes = await getFluxIP();
    if (ipRes.status === 'error') {
      throw ipRes.data;
    }
    info.flux.ip = ipRes.data;
    const zelidRes = await getFluxZelID();
    if (zelidRes.status === 'error') {
      throw zelidRes.data;
    }
    info.flux.zelid = zelidRes.data;
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

    const daemonInfoRes = await daemonServiceControlRpcs.getInfo();
    if (daemonInfoRes.status === 'error') {
      throw daemonInfoRes.data;
    }
    info.daemon.info = daemonInfoRes.data;

    const daemonNodeStatusRes = await daemonServiceZelnodeRpcs.getZelNodeStatus();
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
    info.apps.hashes = appHashes.data;
    const explorerScannedHeight = await explorerService.getScannedHeight();
    if (explorerScannedHeight.status === 'error') {
      throw explorerScannedHeight.data;
    }
    info.flux.explorerScannedHeigth = explorerScannedHeight.data;
    const connectionsOut = fluxCommunication.connectedPeersInfo();
    if (connectionsOut.status === 'error') {
      throw connectionsOut.data;
    }
    info.flux.connectionsOut = connectionsOut.data;
    const connectionsIn = fluxNetworkHelper.getIncomingConnectionsInfo();
    if (connectionsIn.status === 'error') {
      throw connectionsIn.data;
    }
    info.flux.connectionsIn = connectionsIn.data;

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
          zelid: '${userconfig.initial.zelid || config.fluxTeamZelId}',
          kadena: '${userconfig.initial.kadena || ''}',
          testnet: ${userconfig.initial.testnet || false},
          apiport: ${Number(userconfig.initial.apiport || config.apiport)},
        }
      }`;

      await fsPromises.writeFile(fluxDirPath, dataToWrite);

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
    zelid: '${userconfig.initial.zelid || config.fluxTeamZelId}',
    kadena: '${kadenaURI}',
    testnet: ${userconfig.initial.testnet || false},
    apiport: ${Number(userconfig.initial.apiport || config.apiport)},
  }
}`;

      await fsPromises.writeFile(fluxDirPath, dataToWrite);

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
async function InstallFluxWatchTower() {
  try {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash fluxwatchtower.sh`;
    const cmdAsync = util.promisify(nodecmd.get);
    const cmdres = await cmdAsync(exec);
    log.info(cmdres);
  } catch (error) {
    log.error(error);
  }
}

/**
 * Method responsable for setting node geolocation information
 */
async function setNodeGeolocation() {
  try {
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      throw new Error('Flux IP not detected. Flux geolocation service is awaiting');
    }
    if (!storedGeolocation || myIP !== storedIp) {
      log.info(`Checking geolocation of ${myIP}`);
      storedIp = myIP;
      // consider another service failover or stats db
      const ipApiUrl = `http://ip-api.com/json/${myIP.split(':')[0]}?fields=status,continent,continentCode,country,countryCode,region,regionName,lat,lon,query,org`;
      const ipRes = await serviceHelper.axiosGet(ipApiUrl);
      if (ipRes.data.status !== 'success') {
        throw new Error(`Geolocation of IP ${myIP} is unavailable`);
      }
      storedGeolocation = {
        ip: ipRes.data.query,
        continent: ipRes.data.continent,
        continentCode: ipRes.data.continentCode,
        country: ipRes.data.country,
        countryCode: ipRes.data.countryCode,
        region: ipRes.data.region,
        regionName: ipRes.data.regionName,
        lat: ipRes.data.lat,
        lon: ipRes.data.lon,
        org: ipRes.data.org,
      };
    }
    log.info(`Geolocation of ${myIP} is ${JSON.stringify(storedGeolocation)}`);
    setTimeout(() => { // executes again in 12h
      setNodeGeolocation();
    }, 12 * 60 * 60 * 1000);
  } catch (error) {
    log.error(`Failed to get Geolocation with ${error}`);
    log.error(error);
    setTimeout(() => {
      setNodeGeolocation();
    }, 5 * 60 * 1000);
  }
}

/**
 * Method responsable for getting stored node geolocation information
 */
function getNodeGeolocation() {
  return storedGeolocation;
}

module.exports = {
  startDaemon,
  updateFlux,
  softUpdateFlux,
  softUpdateFluxInstall,
  hardUpdateFlux,
  rebuildHome,
  updateDaemon,
  updateBenchmark,
  restartDaemon,
  reindexDaemon,
  getFluxVersion,
  getFluxIP,
  getFluxZelID,
  getFluxCruxID,
  getFluxKadena,
  daemonDebug,
  benchmarkDebug,
  getFluxTimezone,
  getFluxInfo,
  startBenchmark,
  restartBenchmark,
  tailDaemonDebug,
  tailBenchmarkDebug,
  tailFluxErrorLog,
  tailFluxWarnLog,
  tailFluxDebugLog,
  tailFluxInfoLog,
  fluxErrorLog,
  fluxWarnLog,
  fluxInfoLog,
  fluxDebugLog,
  adjustCruxID,
  adjustKadenaAccount,
  fluxBackendFolder,
  getNodeTier,
  InstallFluxWatchTower,
  setNodeGeolocation,
  getNodeGeolocation,
};
