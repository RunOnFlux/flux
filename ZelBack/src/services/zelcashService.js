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

let response = {
  status: 'error',
  data: {
    message: 'Unkown error',
  },
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

async function stop(req, res) { // practically useless
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.stop();
        response.status = 'success';
        response.data = data;
      } catch (err) {
        response.status = 'error';
        response.data = err;
      }
    } else {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Unauthorized. Access denied.',
        },
      };
      response = errMessage;
    }

    return res.json(response);
  });
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
    } else {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Unauthorized. Access denied.',
        },
      };
      response = errMessage;
    }

    return res.json(response);
  });
}

async function createZelNodeKey(req, res) { // practically useless
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === false) {
      try {
        const data = await client.createzelnodekey();
        response.status = 'success';
        response.data = data;
      } catch (err) {
        response.status = 'error';
        response.data = err;
      }
    } else {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Unauthorized. Access denied.',
        },
      };
      response = errMessage;
    }

    return res.json(response);
  });
}

async function znsync(req, res) {
  console.log(req.params);
  console.log(req.query);
  let { option } = req.params; // we accept both znsync/status and znsync?option=status
  option = option || req.query.option;
  const param = option || 'status'; // default to status.
  console.log(param);
  if (param === 'status') {
    try {
      const data = await client.znsync(param);
      response.status = 'success';
      response.data = data;
    } catch (err) {
      response.status = 'error';
      response.data = err;
    }
  } else {
    // eslint-disable-next-line consistent-return
    serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
      if (error) {
        return res.json(error);
      }
      if (authorized === true) {
        try {
          const data = await client.znsync(param);
          response.status = 'success';
          response.data = data;
        } catch (err) {
          response.status = 'error';
          response.data = err;
        }
      } else {
        const errMessage = {
          status: 'error',
          data: {
            message: 'Unauthorized. Access denied.',
          },
        };
        response = errMessage;
      }
    });
  }

  return res.json(response);
}

async function getNodeBenchmarks(req, res) {
  try {
    const data = await client.getnodebenchmarks();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    response.status = 'error';
    response.data = err;
  }

  return res.json(response);
}

// == Blockchain ==
async function getBestBlockHash(req, res) {
  try {
    const data = await client.getbestblockhash();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    response.status = 'error';
    response.data = err;
  }

  return res.json(response);
}

module.exports = {
  help,
  getInfo,
  stop,

  getBestBlockHash,

  // createZelNodeBroadcast,
  createZelNodeKey,
  // decodeZelNodeBroadcast,
  getNodeBenchmarks,
  // getZelNodeCount,
  // getZelNodeOutputs,
  // getZelNodeScores,
  getZelnNodeStatus,
  // getZelNodeWinners,
  listZelNodeConf,
  listZelNodes,
  // relayZelNodeBroadcast,
  // spork,
  // startZelNode,
  // zelNodeCurrentwinner,
  // zelNodeDebug,
  znsync,
};
