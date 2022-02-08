const cmd = require('node-cmd');
const path = require('path');
const config = require('config');
const fullnode = require('fullnode');
const util = require('util');
const fs = require('fs');

const fsPromises = fs.promises;

const log = require('../lib/log');
const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');
const daemonService = require('./daemonService');
const benchmarkService = require('./benchmarkService');
const appsService = require('./appsService');
const generalService = require('./generalService');
const fluxCommunication = require('./fluxCommunication');
const userconfig = require('../../../config/userconfig');

// eslint-disable-next-line consistent-return
async function fluxBackendFolder(req, res) {
  const fluxBackFolder = path.join(__dirname, '../../');
  const message = serviceHelper.createDataMessage(fluxBackFolder);
  return res.json(message);
}

// eslint-disable-next-line consistent-return
async function updateFlux(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${nodedpath} && npm run updateflux`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error updating Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Flux successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function softUpdateFlux(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${nodedpath} && npm run softupdate`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error softly updating Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Flux successfully updated using soft method');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function softUpdateFluxInstall(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${nodedpath} && npm run softupdateinstall`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error softly updating Flux with installation: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Flux successfully updated softly with installation');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function hardUpdateFlux(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${nodedpath} && npm run hardupdateflux`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error hardupdating Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Flux successfully updating');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function rebuildHome(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${nodedpath} && npm run homebuild`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error rebuilding Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Flux successfully rebuilt');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function updateDaemon(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash updateDaemon.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error updating Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Daemon successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function updateBenchmark(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash updateBenchmark.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error updating Benchmark: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Benchmark successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function startBenchmark(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    let exec = 'zelbenchd -daemon';
    if (fs.existsSync('/usr/local/bin/fluxbenchd')) {
      exec = 'fluxbenchd -daemon';
    }
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error starting Benchmark: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message = serviceHelper.createSuccessMessage('Benchamrk successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function restartBenchmark(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash restartBenchmark.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error restarting Benchmark: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Benchmark successfully restarted');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    console.log(errMessage);
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function startDaemon(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    let exec = 'zelcashd';
    if (fs.existsSync('/usr/local/bin/fluxd')) {
      exec = 'fluxd';
    }
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error starting Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message = serviceHelper.createSuccessMessage('Daemon successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function restartDaemon(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash restartDaemon.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error restarting Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Daemon successfully restarted');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    console.log(errMessage);
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function reindexDaemon(req, res) {
  const authorized = await serviceHelper.verifyAdminSession(req.headers);
  if (authorized === true) {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash reindexDaemon.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error reindexing Daemon: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('Daemon successfully reindexing');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

function getFluxVersion(req, res) {
  const { version } = packageJson;
  const message = serviceHelper.createDataMessage(version);
  return res ? res.json(message) : message;
}

async function getFluxIP(req, res) {
  const benchmarkResponse = await daemonService.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
    }
  }
  const message = serviceHelper.createDataMessage(myIP);
  return res ? res.json(message) : message;
}

function getFluxZelID(req, res) {
  const zelID = userconfig.initial.zelid;
  const message = serviceHelper.createDataMessage(zelID);
  return res ? res.json(message) : message;
}

function getFluxCruxID(req, res) {
  const cruxID = userconfig.initial.cruxid || null;
  const message = serviceHelper.createDataMessage(cruxID);
  return res ? res.json(message) : message;
}

function getFluxKadena(req, res) {
  const kadena = userconfig.initial.kadena || null;
  const message = serviceHelper.createDataMessage(kadena);
  return res ? res.json(message) : message;
}

async function daemonDebug(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  // check daemon datadir
  const defaultDir = new fullnode.Config().defaultFolder();
  const datadir = daemonService.getConfigValue('datadir') || defaultDir;
  const filepath = `${datadir}/debug.log`;

  return res.download(filepath, 'debug.log');
}

async function benchmarkDebug(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
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

async function tailDaemonDebug(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const defaultDir = new fullnode.Config().defaultFolder();
    const datadir = daemonService.getConfigValue('datadir') || defaultDir;
    const filepath = `${datadir}/debug.log`;
    const exec = `tail -n 100 ${filepath}`;
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error obtaining Daemon debug file: ${err.message}`, err.name, err.code);
        res.json(errMessage);
        return;
      }
      const message = serviceHelper.createSuccessMessage(data);
      res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function tailBenchmarkDebug(req, res) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../../');
    const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');
    let datadir = `${homeDirPath}.zelbenchmark`;
    if (fs.existsSync(newBenchmarkPath)) {
      datadir = newBenchmarkPath;
    }
    const filepath = `${datadir}/debug.log`;
    const exec = `tail -n 100 ${filepath}`;
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error obtaining Benchmark debug file: ${err.message}`, err.name, err.code);
        res.json(errMessage);
        return;
      }
      const message = serviceHelper.createSuccessMessage(data);
      res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function fluxLog(res, filelog) {
  const homeDirPath = path.join(__dirname, '../../../');
  const filepath = `${homeDirPath}${filelog}.log`;

  return res.download(filepath, `${filelog}.log`);
}

async function fluxErrorLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'error');
  } catch (error) {
    log.error(error);
  }
}

async function fluxWarnLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'warn');
  } catch (error) {
    log.error(error);
  }
}

async function fluxInfoLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'info');
  } catch (error) {
    log.error(error);
  }
}

async function fluxDebugLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    fluxLog(res, 'debug');
  } catch (error) {
    log.error(error);
  }
}

async function tailFluxLog(req, res, logfile) {
  const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../');
    const filepath = `${homeDirPath}${logfile}.log`;
    const exec = `tail -n 100 ${filepath}`;
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error obtaining Flux ${logfile} file: ${err.message}`, err.name, err.code);
        res.json(errMessage);
        return;
      }
      const message = serviceHelper.createSuccessMessage(data);
      res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function tailFluxErrorLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
    if (authorized === true) {
      tailFluxLog(req, res, 'error');
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

async function tailFluxWarnLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
    if (authorized === true) {
      tailFluxLog(req, res, 'warn');
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

async function tailFluxInfoLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
    if (authorized === true) {
      tailFluxLog(req, res, 'info');
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

async function tailFluxDebugLog(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminAndFluxTeamSession(req.headers);
    if (authorized === true) {
      tailFluxLog(req, res, 'debug');
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
  }
}

function getFluxTimezone(req, res) {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const message = serviceHelper.createDataMessage(timezone);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    const message = 'Unknown';
    return res ? res.json(message) : message;
  }
}

async function getFluxInfo(req, res) {
  try {
    const info = {
      daemon: {},
      node: {},
      benchmark: {},
      flux: {},
      apps: {},
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
    const dosResult = await fluxCommunication.getDOSState();
    if (dosResult.status === 'error') {
      throw dosResult.data;
    }
    info.flux.dos = dosResult.data;

    const daemonInfoRes = await daemonService.getInfo();
    if (daemonInfoRes.status === 'error') {
      throw daemonInfoRes.data;
    }
    info.daemon.info = daemonInfoRes.data;

    const daemonNodeStatusRes = await daemonService.getZelNodeStatus();
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

    const response = serviceHelper.createDataMessage(info);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = serviceHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function adjustCruxID(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminSession(req.headers);
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
    cruxid: '${cruxid}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
  }
}`;

      await fsPromises.writeFile(fluxDirPath, dataToWrite);

      const successMessage = serviceHelper.createSuccessMessage('CruxID adjusted');
      res.json(successMessage);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function adjustKadenaAccount(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminSession(req.headers);
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
    cruxid: '${userconfig.initial.cruxid || ''}',
    kadena: '${kadenaURI}',
    testnet: ${userconfig.initial.testnet || false},
  }
}`;

      await fsPromises.writeFile(fluxDirPath, dataToWrite);

      const successMessage = serviceHelper.createSuccessMessage('Kadena account adjusted');
      res.json(successMessage);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

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
    const response = serviceHelper.createDataMessage(responseAux);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function InstallFluxWatchTower() {
  try {
    const nodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${nodedpath} && bash fluxwatchtower.sh`;
    const cmdAsync = util.promisify(cmd.get);
    const cmdres = await cmdAsync(exec);
    log.info(cmdres);
  } catch (error) {
    log.error(error);
  }
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
};
