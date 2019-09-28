const zelcashrpc = require('zelcashrpc');
const fullnode = require('fullnode');
const serviceHelper = require('./serviceHelper');

const config = new fullnode.Config();
const rpcuser = config.rpcuser() || 'rpcuser';
const rpcpassword = config.rpcpassword() || 'rpcpassowrd';
const rpcport = config.rpcport() || 16124;

const client = new zelcashrpc.Client({
  port: rpcport,
  user: rpcuser,
  pass: rpcpassword,
  timeout: 60000,
});

const response = {
  status: 'error',
  data: 'Unkown Error',
};

// == Control ==
async function help(req, res) {
  try {
    const data = await client.help();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    response.status = 'error';
    response.data = err;
  }

  return res.json(response);
}

async function getInfo(req, res) {
  try {
    const data = await client.getInfo();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    response.status = 'error';
    response.data = err;
  }

  return res.json(response);
}

// == Zelnode ==
async function getZelnNodeStatus(req, res) {
  try {
    const data = await client.getzelnodestatus();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    response.status = 'error';
    response.data = err;
  }

  return res.json(response);
}

async function listZelNodes(req, res) {
  try {
    const data = await client.listzelnodes();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    response.status = 'error';
    response.data = err;
  }

  return res.json(response);
}

async function listZelNodeConf(req, res) { // practically useless
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.listzelnodeconf();
        response.status = 'success';
        response.data = data;
      } catch (err) {
        response.status = 'error';
        response.data = err;
      }

      return res.json(response);
    }
    const errMessage = {
      status: 'error',
      data: {
        message: 'Unauthorized. Access denied.',
      },
    };
    return res.json(errMessage);
  });
}

module.exports = {
  help,
  getInfo,
  getZelnNodeStatus,
  listZelNodes,
  listZelNodeConf,
};
