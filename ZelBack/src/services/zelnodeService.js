const cmd = require('node-cmd');
const path = require('path');

const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');

function updateFlux(req, res) {
  serviceHelper.verifyZelTeamSession(req.headers, (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const zelnodedpath = path.join(__dirname, '../../../');
      const exec = `cd ${zelnodedpath} && npm run updateflux`;
      cmd.get(exec, (err) => {
        if (err) {
          const errMessage = {
            status: 'error',
            data: {
              message: `Error updating Flux: ${err.toString()}`,
            },
          };
          return res.json(errMessage);
        }
        const message = {
          status: 'success',
          data: {
            message: 'Flux successfully updated',
          },
        };
        return res.json(message);
      });
    } else {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Unauthorized. Access denied.',
        },
      };
      return res.json(errMessage);
    }
  });
}

function rebuildZelFront(req, res) {
  serviceHelper.verifyZelTeamSession(req.headers, (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const zelnodedpath = path.join(__dirname, '../../../');
      const exec = `cd ${zelnodedpath} && npm run zelfrontbuild`;
      cmd.get(exec, (err) => {
        if (err) {
          const errMessage = {
            status: 'error',
            data: {
              message: `Error rebuilding Flux: ${err}`,
            },
          };
          return res.json(errMessage);
        }
        const message = {
          status: 'success',
          data: {
            message: 'Flux successfully rebuilt',
          },
        };
        return res.json(message);
      });
    } else {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Unauthorized. Access denied.',
        },
      };
      return res.json(errMessage);
    }
  });
}

function updateZelCash(req, res) {
  serviceHelper.verifyZelTeamSession(req.headers, (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const zelnodedpath = path.join(__dirname, '../../../helpers');
      const exec = `cd ${zelnodedpath} && sh updateZelCash.sh`;
      cmd.get(exec, (err) => {
        if (err) {
          const errMessage = {
            status: 'error',
            data: {
              message: `Error updating ZelCash: ${err}`,
            },
          };
          return res.json(errMessage);
        }
        const message = {
          status: 'success',
          data: {
            message: 'ZelCash successfully updated',
          },
        };
        return res.json(message);
      });
    } else {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Unauthorized. Access denied.',
        },
      };
      return res.json(errMessage);
    }
  });
}

function getFluxVersion(req, res) {
  const { version } = packageJson;
  return res.json(version);
}

module.exports = {
  updateFlux,
  rebuildZelFront,
  updateZelCash,
  getFluxVersion,
};
