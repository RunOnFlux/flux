const cmd = require('node-cmd');
const path = require('path');

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
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run updatezelflux`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error updating ZelFlux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelFlux successfully updaating');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function hardUpdateZelFlux(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run hardupdatezelflux`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error hardupdating ZelFlux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelFlux successfully updating');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function rebuildZelFront(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run zelfrontbuild`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error rebuilding ZelFlux: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelFlux successfully rebuilt');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function updateZelCash(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh updateZelCash.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error updating ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelCash successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function updateZelBench(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh updateZelBench.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error updating ZelBench: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelBench successfully updated');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function startZelCash(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const exec = 'zelcashd';
    cmd.get(exec, (err, data) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error starting ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      console.log(data);
      const message = serviceHelper.createSuccessMessage('ZelCash successfully started');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

// eslint-disable-next-line consistent-return
async function restartZelCash(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../helpers');
    const exec = `cd ${zelnodedpath} && sh restartZelCash.sh`;
    cmd.get(exec, (err) => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(`Error restarting ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelCash successfully restarted');
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
        const errMessage = serviceHelper.createErrorMessage(`Error reindexing ZelCash: ${err.message}`, err.name, err.code);
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage('ZelCash successfully reindexing');
      return res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

function getZelFluxVersion(req, res) {
  const { version } = packageJson;
  const message = serviceHelper.createDataMessage(version);
  return res ? res.json(message) : message;
}

async function getZelFluxIP(req, res) {
  const benchmarkResponse = await zelcashService.getBenchmarks();
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

function getZelFluxZelID(req, res) {
  const zelID = userconfig.initial.zelid;
  const message = serviceHelper.createDataMessage(zelID);
  return res ? res.json(message) : message;
}

async function zelcashDebug(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  // check zelcash datadir
  const homeDirPath = path.join(__dirname, '../../../../');
  const datadir = zelcashService.getConfigValue('datadir') || `${homeDirPath}.zelcash`;
  const filepath = `${datadir}/debug.log`;

  return res.sendFile(filepath);
}

async function zelbenchDebug(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const homeDirPath = path.join(__dirname, '../../../../');
  const datadir = `${homeDirPath}.zelbenchmark`;
  const filepath = `${datadir}/debug.log`;

  return res.sendFile(filepath);
}

async function zelfluxErrorLog(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (!authorized) {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  const homeDirPath = path.join(__dirname, '../../../../');
  const datadir = `${homeDirPath}zelflux`;
  const filepath = `${datadir}/error.log`;

  return res.sendFile(filepath);
}

function getZelFluxTimezone(req, res) {
  const timezone = process.env.TZ;
  const message = serviceHelper.createDataMessage(timezone);
  return res ? res.json(message) : message;
}

async function getZelFluxInfo(req, res) {
  try {
    const info = {
      zelcash: {},
      zelnode: {},
      zelbench: {},
      zelflux: {},
      zelapps: {},
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
    const dosResult = await zelfluxCommunication.getDOSState();
    if (dosResult.status === 'error') {
      throw dosResult.data;
    }
    info.zelflux.dos = dosResult.data;
    const timeResult = await zelfluxCommunication.getZelFluxTimezone();
    if (timeResult.status === 'error') {
      throw timeResult.data;
    }
    info.zelflux.timezone = timeResult.data;

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
  zelcashDebug,
  zelbenchDebug,
  zelfluxErrorLog,
  getZelFluxTimezone,
  getZelFluxInfo,
};
