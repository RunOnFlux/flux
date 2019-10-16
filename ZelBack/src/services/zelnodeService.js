const cmd = require('node-cmd');
const path = require('path');

const packageJson = require('../../../package.json');
const serviceHelper = require('./serviceHelper');

function updateFlux(req, res) {
  // eslint-disable-next-line consistent-return
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
              message: `Error updating ZelFlux: ${err.toString()}`,
            },
          };
          return res.json(errMessage);
        }
        const message = {
          status: 'success',
          data: {
            message: 'ZelFlux successfully updated',
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
  // eslint-disable-next-line consistent-return
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
              message: `Error rebuilding ZelFlux: ${err}`,
            },
          };
          return res.json(errMessage);
        }
        const message = {
          status: 'success',
          data: {
            message: 'ZelFlux successfully rebuilt',
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
  // eslint-disable-next-line consistent-return
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

function startZelCash(req, res) {
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const exec = 'zelcashd';
      cmd.get(exec, (err, data) => {
        if (err) {
          const errMessage = {
            status: 'error',
            data: {
              message: `Error starting ZelCash: ${err}`,
            },
          };
          return res.json(errMessage);
        }
        console.log(data);
        const message = {
          status: 'success',
          data: {
            message: 'ZelCash successfully started',
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

function restartZelCash(req, res) {
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const zelnodedpath = path.join(__dirname, '../../../helpers');
      const exec = `cd ${zelnodedpath} && sh restartZelCash.sh`;
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

function reindexZelCash(req, res) {
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const zelnodedpath = path.join(__dirname, '../../../helpers');
      const exec = `cd ${zelnodedpath} && sh reindexZelCash.sh`;
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
  startZelCash,
  updateFlux,
  rebuildZelFront,
  updateZelCash,
  restartZelCash,
  reindexZelCash,
  getFluxVersion,
};
