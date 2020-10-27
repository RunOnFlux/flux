const cmd = require('node-cmd');
const path = require('path');
const config = require('config');
const fs = require('fs').promises;

const log = require('../lib/log');
const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const zelbenchService = require('./zelbenchService');
const zelappsService = require('./zelappsService');
const zelfluxCommunication = require('./zelfluxCommunication');
const userconfig = require('../../../config/userconfig');

// eslint-disable-next-line consistent-return
async function updateZelFlux(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run updatezelflux`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error updating Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('Flux successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function hardUpdateZelFlux(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run hardupdatezelflux`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error hardupdating Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('Flux successfully updating');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function rebuildZelFront(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run zelfrontbuild`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error rebuilding Flux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('Flux successfully rebuilt');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function updateZelCash(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh updateZelCash.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error updating ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('ZelCash successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function updateZelBench(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh updateZelBench.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error updating ZelBench: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('ZelBench successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function startZelBench(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const exec = 'zelbenchd -daemon';
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error starting ZelBench: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message =
          serviceHelper.createSuccessMessage('ZelBench successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function restartZelBench(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh restartZelBench.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error restarting ZelBench: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('ZelBench successfully restarted');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    console.log(errMessage);
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function startZelCash(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const exec = 'zelcashd';
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error starting ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message =
          serviceHelper.createSuccessMessage('ZelCash successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function restartZelCash(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh restartZelCash.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error restarting ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('ZelCash successfully restarted');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    console.log(errMessage);
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function reindexZelCash(req, res) {
  const authorized = await serviceHelper.verifyAdminSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh reindexZelCash.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error reindexing ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message =
          serviceHelper.createSuccessMessage('ZelCash successfully reindexing');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

function getZelFluxVersion(req, res) {
  const {version} = packageJson;
  const message = serviceHelper.createDataMessage(version);
  return res ? res.json(message) : message;
}

async function getZelFluxIP(req, res) {
  const benchmarkResponse = await zelcashService.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP = benchmarkResponseData.ipaddress.length > 5
                 ? benchmarkResponseData.ipaddress
                 : null;
    }
  }
  const message = serviceHelper.createDataMessage(myIP);
  return res ? res.json(message) : message;
}

function getZelFluxZelID(req, res) {
  const zelID = userconfig.initial.zelid;
  const message = serviceHelper.createDataMessage(zelID);
  return res ? res.json(message) : message;
}

function getZelFluxCruxID(req, res) {
  const cruxID = userconfig.initial.cruxid || null;
  const message = serviceHelper.createDataMessage(cruxID);
  return res ? res.json(message) : message;
}

function getZelFluxKadena(req, res) {
  const kadena = userconfig.initial.kadena || null;
  const message = serviceHelper.createDataMessage(kadena);
  return res ? res.json(message) : message;
}

async function zelcashDebug(req, res) {
  const authorized =
      await serviceHelper.verifyPrivilege('adminandzelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  // check zelcash datadir
  const homeDirPath = path.join(__dirname, '../../../../');
  const datadir =
      zelcashService.getConfigValue('datadir') || `${homeDirPath}.zelcash`;
  const filepath = `${datadir}/debug.log`;

  return res.download(filepath, 'debug.log');
}

async function zelbenchDebug(req, res) {
  const authorized =
      await serviceHelper.verifyPrivilege('adminandzelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const homeDirPath = path.join(__dirname, '../../../../');
  const datadir = `${homeDirPath}.zelbenchmark`;
  const filepath = `${datadir}/debug.log`;

  return res.download(filepath, 'debug.log');
}

async function tailZelCashDebug(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../../');
    const datadir =
        zelcashService.getConfigValue('datadir') || `${homeDirPath}.zelcash`;
    const filepath = `${datadir}/debug.log`;
    const exec = `tail -n 100 ${filepath}`;
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error obtaining ZelBench debug file: ${err.message}`, err.name,
            err.code);
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

async function tailZelBenchDebug(req, res) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../../');
    const datadir = `${homeDirPath}.zelbenchmark`;
    const filepath = `${datadir}/debug.log`;
    const exec = `tail -n 100 ${filepath}`;
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error obtaining ZelBench debug file: ${err.message}`, err.name,
            err.code);
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

async function zelfluxLog(res, filelog) {
  const homeDirPath = path.join(__dirname, '../../../../');
  const datadir = `${homeDirPath}zelflux`;
  const filepath = `${datadir}/${filelog}.log`;

  return res.download(filepath, `${filelog}.log`);
}

async function zelfluxErrorLog(req, res) {
  try {
    const authorized =
        await serviceHelper.verifyPrivilege('adminandzelteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    zelfluxLog(res, 'error');
  } catch (error) {
    log.error(error);
  }
}

async function zelfluxWarnLog(req, res) {
  try {
    const authorized =
        await serviceHelper.verifyPrivilege('adminandzelteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    zelfluxLog(res, 'warn');
  } catch (error) {
    log.error(error);
  }
}

async function zelfluxInfoLog(req, res) {
  try {
    const authorized =
        await serviceHelper.verifyPrivilege('adminandzelteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    zelfluxLog(res, 'info');
  } catch (error) {
    log.error(error);
  }
}

async function zelfluxDebugLog(req, res) {
  try {
    const authorized =
        await serviceHelper.verifyPrivilege('adminandzelteam', req);
    if (!authorized) {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    zelfluxLog(res, 'debug');
  } catch (error) {
    log.error(error);
  }
}

async function tailFluxLog(req, res, logfile) {
  const authorized =
      await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
  if (authorized === true) {
    const homeDirPath = path.join(__dirname, '../../../../');
    const datadir = `${homeDirPath}zelflux`;
    const filepath = `${datadir}/${logfile}.log`;
    const exec = `tail -n 100 ${filepath}`;
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
            `Error obtaining Flux ${logfile} file: ${err.message}`, err.name,
            err.code);
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
    const authorized =
        await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
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
    const authorized =
        await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
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
    const authorized =
        await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
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
    const authorized =
        await serviceHelper.verifyAdminAndZelTeamSession(req.headers);
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

function getZelFluxTimezone(req, res) {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const message = serviceHelper.createDataMessage(timezone);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    const message = 'unkown';
    return res ? res.json(message) : message;
  }
}

async function getZelFluxInfo(req, res) {
  try {
    const info = {
      zelcash : {},
      zelnode : {},
      zelbench : {},
      zelflux : {},
      zelapps : {},
    };
    const versionRes = await getZelFluxVersion();
    if (versionRes.status === 'error') {
      throw versionRes.data;
    }
    info.zelflux.version = versionRes.data;
    const ipRes = await getZelFluxIP();
    if (ipRes.status === 'error') {
      throw ipRes.data;
    }
    info.zelflux.ip = ipRes.data;
    const zelidRes = await getZelFluxZelID();
    if (zelidRes.status === 'error') {
      throw zelidRes.data;
    }
    info.zelflux.zelid = zelidRes.data;
    const cruxidRes = await getZelFluxCruxID();
    if (cruxidRes.status === 'error') {
      throw cruxidRes.data;
    }
    info.zelflux.cruxid = cruxidRes.data;
    const timeResult = await getZelFluxTimezone();
    if (timeResult.status === 'error') {
      throw timeResult.data;
    }
    info.zelflux.timezone = timeResult.data;
    const dosResult = await zelfluxCommunication.getDOSState();
    if (dosResult.status === 'error') {
      throw dosResult.data;
    }
    info.zelflux.dos = dosResult.data;

    const zelcashInfoRes = await zelcashService.getInfo();
    if (zelcashInfoRes.status === 'error') {
      throw zelcashInfoRes.data;
    }
    info.zelcash.info = zelcashInfoRes.data;

    const zelcashZelnodeStatusRes = await zelcashService.getZelNodeStatus();
    if (zelcashZelnodeStatusRes.status === 'error') {
      throw zelcashZelnodeStatusRes.data;
    }
    info.zelnode.status = zelcashZelnodeStatusRes.data;

    const zelbenchInfoRes = await zelbenchService.getInfo();
    if (zelbenchInfoRes.status === 'error') {
      throw zelbenchInfoRes.data;
    }
    info.zelbench.info = zelbenchInfoRes.data;
    const zelbenchStatusRes = await zelbenchService.getStatus();
    if (zelbenchStatusRes.status === 'error') {
      throw zelbenchStatusRes.data;
    }
    info.zelbench.status = zelbenchStatusRes.data;
    const zelbenchBenchRes = await zelbenchService.getBenchmarks();
    if (zelbenchBenchRes.status === 'error') {
      throw zelbenchBenchRes.data;
    }
    info.zelbench.bench = zelbenchBenchRes.data;

    const zelapppsFluxUsage = await zelappsService.zelFluxUsage();
    if (zelapppsFluxUsage.status === 'error') {
      throw zelapppsFluxUsage.data;
    }
    info.zelapps.fluxusage = zelapppsFluxUsage.data;
    const zelappsRunning = await zelappsService.listRunningZelApps();
    if (zelappsRunning.status === 'error') {
      throw zelappsRunning.data;
    }
    info.zelapps.runningapps = zelappsRunning.data;
    const zelappsResources = await zelappsService.zelappsResources();
    if (zelappsResources.status === 'error') {
      throw zelappsResources.data;
    }
    info.zelapps.resources = zelappsResources.data;

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
      let {cruxid} = req.params;
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
    paddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
    zelid: '${userconfig.initial.zelid || config.zelTeamZelId}',
    cruxid: '${cruxid}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
  }
}`;

      await fs.writeFile(fluxDirPath, dataToWrite);

      const successMessage =
          serviceHelper.createSuccessMessage('CruxID adjusted');
      res.json(successMessage);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage =
        serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function adjustKadenaAccount(req, res) {
  try {
    const authorized = await serviceHelper.verifyAdminSession(req.headers);
    if (authorized === true) {
      let {account} = req.params;
      account = account || req.query.account;
      let {chainid} = req.params;
      chainid = chainid || req.query.chainid;
      if (!account) {
        throw new Error('No Kadena Account provided');
      }
      if (!chainid) {
        throw new Error('No Kadena Chain ID provided');
      }
      const chainIDNumber = serviceHelper.ensureNumber(chainid);
      if (chainIDNumber > 20 || chainIDNumber < 0 ||
          Number.isNaN(chainIDNumber)) {
        throw new Error(`Invalid Chain ID ${chainid} provided.`);
      }
      const kadenaURI = `kadena:${account}?chainid=${chainid}`;
      const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
      const dataToWrite = `module.exports = {
  initial: {
    paddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
    zelid: '${userconfig.initial.zelid || config.zelTeamZelId}',
    cruxid: '${userconfig.initial.cruxid || ''}',
    kadena: '${kadenaURI}',
    testnet: ${userconfig.initial.testnet || false},
  }
}`;

      await fs.writeFile(fluxDirPath, dataToWrite);

      const successMessage =
          serviceHelper.createSuccessMessage('Kadena account adjusted');
      res.json(successMessage);
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage =
        serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

module.exports = {
  startZelCash,
  updateZelFlux,
  hardUpdateZelFlux,
  rebuildZelFront,
  updateZelCash,
  updateZelBench,
  restartZelCash,
  reindexZelCash,
  getZelFluxVersion,
  getZelFluxIP,
  getZelFluxZelID,
  getZelFluxCruxID,
  getZelFluxKadena,
  zelcashDebug,
  zelbenchDebug,
  getZelFluxTimezone,
  getZelFluxInfo,
  startZelBench,
  restartZelBench,
  tailZelCashDebug,
  tailZelBenchDebug,
  tailFluxErrorLog,
  tailFluxWarnLog,
  tailFluxDebugLog,
  tailFluxInfoLog,
  zelfluxErrorLog,
  zelfluxWarnLog,
  zelfluxInfoLog,
  zelfluxDebugLog,
  adjustCruxID,
  adjustKadenaAccount,
};
