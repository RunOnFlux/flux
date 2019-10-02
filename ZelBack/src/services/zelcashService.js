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
  console.log(req.params);
  console.log(req.query);
  let { command } = req.params; // we accept both help/command and help?command=getinfo
  command = command || req.query.command || '';
  try {
    const data = await client.help(command);
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function getInfo(req, res) {
  try {
    const data = await client.getInfo();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
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
        const daemonerror = {
          code: err.code,
          message: err.message,
        };
        response.status = 'error';
        response.data = daemonerror;
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
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function listZelNodes(req, res) {
  try {
    const data = await client.listzelnodes();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
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
        const daemonerror = {
          code: err.code,
          message: err.message,
        };
        response.status = 'error';
        response.data = daemonerror;
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
        const daemonerror = {
          code: err.code,
          message: err.message,
        };
        response.status = 'error';
        response.data = daemonerror;
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
  let { mode } = req.params; // we accept both znsync/status and znsync?mode=status
  mode = mode || req.query.mode || 'status'; // default to status
  if (mode === 'status') {
    try {
      const data = await client.znsync(mode);
      response.status = 'success';
      response.data = data;
    } catch (err) {
      const daemonerror = {
        code: err.code,
        message: err.message,
      };
      response.status = 'error';
      response.data = daemonerror;
    }
  } else {
    // eslint-disable-next-line consistent-return
    serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
      if (error) {
        return res.json(error);
      }
      if (authorized === true) {
        try {
          const data = await client.znsync(mode);
          response.status = 'success';
          response.data = data;
        } catch (err) {
          const daemonerror = {
            code: err.code,
            message: err.message,
          };
          response.status = 'error';
          response.data = daemonerror;
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

async function createZelNodeBroadcast(req, res) {
  let { command } = req.params;
  command = command || req.query.command || '';
  let { alias } = req.params;
  alias = alias || req.query.alias || '';
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.createzelnodebroadcast(command, alias);
        response.status = 'success';
        response.data = data;
      } catch (err) {
        const daemonerror = {
          code: err.code,
          message: err.message,
        };
        response.status = 'error';
        response.data = daemonerror;
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

  return res.json(response);
}

async function decodeZelNodeBroadcast(req, res) {
  console.log(req.params);
  console.log(req.query);
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring || '';
  try {
    const data = await client.decodezelnodebroadcast(hexstring);
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function getNodeBenchmarks(req, res) {
  try {
    const data = await client.getnodebenchmarks();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function getZelNodeCount(req, res) {
  try {
    const data = await client.getzelnodecount();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function getZelNodeOutputs(req, res) {
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.getzelnodeoutputs();
        response.status = 'success';
        response.data = data;
      } catch (err) {
        const daemonerror = {
          code: err.code,
          message: err.message,
        };
        response.status = 'error';
        response.data = daemonerror;
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

  return res.json(response);
}

async function getZelNodeScores(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10'; // defaults to 10 as default zelcash value
  try {
    const data = await client.getzelnodescores(blocks);
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function getZelNodeWinners(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10'; // defaults to 10 as default zelcash value
  let { filter } = req.params;
  filter = filter || req.query.filter;
  try {
    if (filter) {
      const data = await client.getzelnodewinners(blocks, filter);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getzelnodewinners(blocks);
      response.status = 'success';
      response.data = data;
    }
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function relayZelNodeBroadcast(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring || '';
  try {
    const data = await client.relayzelnodebroadcast(hexstring);
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function spork(req, res) {
  let { name } = req.params;
  name = name || req.query.name || 'show'; // name, show, active
  let { value } = req.params;
  value = value || req.query.value;
  try {
    if (value) {
      if (typeof value !== 'number') {
        value = Number(value);
      }
      const data = await client.spork(name, value);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.spork(name);
      response.status = 'success';
      response.data = data;
    }
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function startZelNode(req, res) {
  let { set } = req.params;
  set = set || req.query.set;
  let { lockwallet } = req.params;
  lockwallet = lockwallet || req.query.lockwallet;
  let { alias } = req.params;
  alias = alias || req.query.alias;
  console.log(set, lockwallet, alias);
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (alias) {
          const data = await client.startzelnode(set, lockwallet, alias);
          response.status = 'success';
          response.data = data;
        } else {
          console.log(set);
          console.log(lockwallet);
          const data = await client.startzelnode(set, lockwallet);
          response.status = 'success';
          response.data = data;
        }
      } catch (err) {
        const daemonerror = {
          code: err.code,
          message: err.message,
        };
        response.status = 'error';
        response.data = daemonerror;
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

  return res.json(response);
}

async function zelNodeCurrentWinner(req, res) {
  try {
    const data = await client.zelnodecurrentwinner();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

async function zelNodeDebug(req, res) {
  try {
    const data = await client.zelnodedebug();
    response.status = 'success';
    response.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
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
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    response.status = 'error';
    response.data = daemonerror;
  }

  return res.json(response);
}

module.exports = {
  help,
  getInfo,
  stop,

  getBestBlockHash,

  createZelNodeBroadcast,
  createZelNodeKey,
  decodeZelNodeBroadcast,
  getNodeBenchmarks,
  getZelNodeCount,
  getZelNodeOutputs,
  getZelNodeScores,
  getZelnNodeStatus,
  getZelNodeWinners,
  listZelNodeConf,
  listZelNodes,
  relayZelNodeBroadcast,
  spork,
  startZelNode,
  zelNodeCurrentWinner,
  zelNodeDebug,
  znsync,
};
