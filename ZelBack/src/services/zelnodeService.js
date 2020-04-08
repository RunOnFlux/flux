const cmd = require('node-cmd');
const path = require('path');

const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');
const zelcashServices = require('./zelcashService');
const userconfig = require('../../../config/userconfig');

// eslint-disable-next-line consistent-return
async function updateZelFlux(req, res) {
  const authorized = await serviceHelper.verifyZelTeamSession(req.headers);
  if (authorized === true) {
    const zelnodedpath = path.join(__dirname, '../../../');
    const exec = `cd ${zelnodedpath} && npm run updatezelflux`;
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error updating ZelFlux: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelFlux successfully updaating'
      );
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
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error hardupdating ZelFlux: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelFlux successfully updating'
      );
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
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error rebuilding ZelFlux: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelFlux successfully rebuilt'
      );
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
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error updating ZelCash: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelCash successfully updated'
      );
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
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error updating ZelBench: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelBench successfully updated'
      );
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
        const errMessage = serviceHelper.createErrorMessage(
          `Error starting ZelCash: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      console.log(data);
      const message = serviceHelper.createSuccessMessage(
        'ZelCash successfully started'
      );
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
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error restarting ZelCash: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelCash successfully restarted'
      );
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
    cmd.get(exec, err => {
      if (err) {
        const errMessage = serviceHelper.createErrorMessage(
          `Error reindexing ZelCash: ${err.message}`,
          err.name,
          err.code
        );
        return res.json(errMessage);
      }
      const message = serviceHelper.createSuccessMessage(
        'ZelCash successfully reindexing'
      );
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
  return res.json(message);
}

async function getZelFluxIP(req, res) {
  const benchmarkResponse = await zelcashServices.getBenchmarks();
  let myIP = null;
  if (benchmarkResponse.status === 'success') {
    const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
    if (benchmarkResponseData.ipaddress) {
      myIP =
        benchmarkResponseData.ipaddress.length > 5
          ? benchmarkResponseData.ipaddress
          : null;
    }
  }
  const message = serviceHelper.createDataMessage(myIP);
  return res.json(message);
}

function getZelFluxZelID(req, res) {
  const zelID = userconfig.initial.zelid;
  const message = serviceHelper.createDataMessage(zelID);
  return res.json(message);
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
  getZelFluxZelID
};
