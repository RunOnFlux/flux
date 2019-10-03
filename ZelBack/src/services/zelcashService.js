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
    if (authorized === true) {
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

      return res.json(response);
    });
  }
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

    return res.json(response);
  });
}

async function decodeZelNodeBroadcast(req, res) {
  console.log(req.params);
  console.log(req.query);
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;
  try {
    if (hexstring) {
      const data = await client.decodezelnodebroadcast(hexstring);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.decodezelnodebroadcast(); // throw error help
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

    return res.json(response);
  });
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
  hexstring = hexstring || req.query.hexstring;
  try {
    if (hexstring) {
      const data = await client.relayzelnodebroadcast(hexstring);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.relayzelnodebroadcast(); // throw error help
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

    return res.json(response);
  });
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
    const data = await client.getBestBlockHash();
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

async function getBlock(req, res) {
  let { hashheight } = req.params;
  hashheight = hashheight || req.query.hashheight;
  let { verbosity } = req.params;
  verbosity = verbosity || req.query.verbosity || 2; // defaults to json object. CORRECT ZCASH verbosity is number, error says its not boolean
  try {
    if (typeof verbosity !== 'number') {
      verbosity = Number(verbosity);
    }
    const data = await client.getBlock(hashheight, verbosity);
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

async function getBlockchainInfo(req, res) {
  try {
    const data = await client.getBlockchainInfo();
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

async function getBlockCount(req, res) {
  try {
    const data = await client.getBlockCount();
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

async function getBlockHah(req, res) {
  let { index } = req.params;
  index = index || req.query.index; // no default value, show help
  try {
    if (index) {
      if (typeof index !== 'number') {
        index = Number(index);
      }
      const data = await client.getBlockHash(index);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getBlockHash(); // errors to help
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

async function getBlockHeader(req, res) {
  let { hash } = req.params;
  hash = hash || req.query.hash;
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || true;
  try {
    if (hash) {
      if (typeof verbose !== 'boolean') {
        if (verbose === 'false' || verbose === 0 || verbose === '0') {
          verbose = false;
        }
        if (verbose === 'true' || verbose === 1 || verbose === '1') {
          verbose = true;
        }
      }
      const data = await client.getBlockHeader(hash, verbose);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getBlockHeader(); // errors to help
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

async function getChainTips(req, res) {
  try {
    const data = await client.getChainTips();
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

async function getDifficulty(req, res) {
  try {
    const data = await client.getDifficulty();
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

async function getMempoolInfo(req, res) {
  try {
    const data = await client.getMempoolInfo();
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

async function getRawMemPool(req, res) {
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || false;
  try {
    if (typeof verbose !== 'boolean') {
      if (verbose === 'false' || verbose === 0 || verbose === '0') {
        verbose = false;
      }
      if (verbose === 'true' || verbose === 1 || verbose === '1') {
        verbose = true;
      }
    }
    const data = await client.getRawMemPool(verbose);
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

async function getTxOut(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { n } = req.params;
  n = n || req.query.n;
  let { includemempool } = req.params;
  includemempool = includemempool || req.query.includemempool || true; // we default to false
  try {
    if (txid && n) {
      if (typeof includemempool !== 'boolean') {
        if (includemempool === 'false' || includemempool === 0 || includemempool === '0') {
          includemempool = false;
        }
        if (includemempool === 'true' || includemempool === 1 || includemempool === '1') {
          includemempool = true;
        }
      }
      if (typeof n !== 'number') {
        n = Number(n);
      }
      const data = await client.getTxOut(txid, n, includemempool);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getTxOut(); // throw help error
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

async function getTxOutProof(req, res) {
  let { txids } = req.params;
  txids = txids || req.query.txids;
  let { blockhash } = req.params;
  blockhash = blockhash || req.query.blockhash;
  const txidsarray = txids.split(',');
  try {
    if (txids && blockhash) {
      const data = await client.getTxOutProof(txidsarray, blockhash);
      response.status = 'success';
      response.data = data;
    } else if (txids) {
      const data = await client.getTxOutProof(txidsarray);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getTxOutProof(); // throw help error
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

async function getTxOutSetInfo(req, res) {
  try {
    const data = await client.getTxOutSetInfo();
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

async function verifyChain(req, res) {
  let { checklevel } = req.params;
  checklevel = checklevel || req.query.checklevel || 3;
  let { numblocks } = req.params;
  numblocks = numblocks || req.query.numblocks || 288;
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      if (typeof checklevel !== 'number') {
        checklevel = Number(checklevel);
      }
      if (typeof numblocks !== 'number') {
        numblocks = Number(numblocks);
      }
      try {
        const data = await client.verifyChain(checklevel, numblocks);
        console.log(data);
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

async function verifyTxOutProof(req, res) {
  let { proof } = req.params;
  proof = proof || req.query.proof;
  try {
    if (proof) {
      const data = await client.verifyTxOutProof(proof);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.verifyTxOutProof(); // errors to help
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

// == Mining ==
async function getBlockSubsidy(req, res) {
  let { height } = req.params;
  height = height || req.query.height;
  try {
    if (height) {
      if (typeof height !== 'number') {
        height = Number(height);
      }
      const data = await client.getBlockSubsidy(height);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getBlockSubsidy(); // default to current height
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

async function getBlockTemplate(req, res) {
  let { jsonrequestobject } = req.params;
  jsonrequestobject = jsonrequestobject || req.query.jsonrequestobject;
  try {
    if (jsonrequestobject) {
      if (typeof jsonrequestobject !== 'object') {
        jsonrequestobject = JSON.parse(jsonrequestobject);
      }
      const data = await client.getBlockTemplate(jsonrequestobject);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getBlockTemplate();
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

async function getLocalSolPs(req, res) {
  try {
    const data = await client.getLocalSolPs();
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

async function getMiningInfo(req, res) {
  try {
    const data = await client.getMiningInfo();
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

async function getNetworkHashPs(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || 120;
  let { height } = req.params;
  height = height || req.query.height || -1;

  if (typeof blocks !== 'number') {
    blocks = Number(blocks);
  }
  if (typeof height !== 'number') {
    height = Number(height);
  }
  try {
    const data = await client.getNetworkHashPs(blocks, height);
    console.log(data);
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

async function getNetworkSolPs(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || 120;
  let { height } = req.params;
  height = height || req.query.height || -1;

  if (typeof blocks !== 'number') {
    blocks = Number(blocks);
  }
  if (typeof height !== 'number') {
    height = Number(height);
  }
  try {
    const data = await client.getNetworkSolPs(blocks, height);
    console.log(data);
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

async function prioritiseTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { prioritydelta } = req.params;
  prioritydelta = prioritydelta || req.query.prioritydelta;
  let { feedelta } = req.params;
  feedelta = feedelta || req.query.feedelta;
  serviceHelper.verifyUserSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (txid && prioritydelta && feedelta) {
          if (typeof prioritydelta !== 'number') {
            prioritydelta = Number(prioritydelta);
          }
          if (typeof feedelta !== 'number') {
            feedelta = Number(feedelta);
          }
          const data = await client.prioritiseTransaction(txid, prioritydelta, feedelta);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.prioritiseTransaction();
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

    return res.json(response);
  });
}

async function submitBlock(req, res) {
  let { hexdata } = req.params;
  hexdata = hexdata || req.query.hexdata;
  let { jsonparametersobject } = req.params;
  jsonparametersobject = jsonparametersobject || req.query.jsonparametersobject;
  serviceHelper.verifyUserSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (hexdata && jsonparametersobject) {
          if (typeof jsonparametersobject !== 'object') {
            jsonparametersobject = JSON.parse(jsonparametersobject);
          }
          const data = await client.submitBlock(hexdata, jsonparametersobject);
          response.status = 'success';
          response.data = data;
        } else if (hexdata) {
          const data = await client.submitBlock(hexdata);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.submitBlock(); // throw help error
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

    return res.json(response);
  });
}

// == Network ==
async function addNode(req, res) {
  let { node } = req.params;
  node = node || req.query.node;
  let { command } = req.params;
  command = command || req.query.command;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (node && command) {
          const data = await client.addNode(node, command);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.addNode(); // throw help error
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

    return res.json(response);
  });
}

async function clearBanned(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.clearBanned();
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

async function disconnectNode(req, res) {
  let { node } = req.params;
  node = node || req.query.node;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (node) {
          const data = await client.disconnectNode(node);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.disconnectNode(); // throw help error
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

    return res.json(response);
  });
}

async function getAddedNodeInfo(req, res) {
  let { dns } = req.params;
  dns = dns || req.query.dns;
  let { node } = req.params;
  node = node || req.query.node;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (dns && node) {
          if (typeof dns !== 'boolean') {
            if (dns === 'false' || dns === 0 || dns === '0') {
              dns = false;
            }
            if (dns === 'true' || dns === 1 || dns === '1') {
              dns = true;
            }
          }
          const data = await client.getAddedNodeInfo(dns, node);
          response.status = 'success';
          response.data = data;
        } else if (dns) {
          if (typeof dns !== 'boolean') {
            if (dns === 'false' || dns === 0 || dns === '0') {
              dns = false;
            }
            if (dns === 'true' || dns === 1 || dns === '1') {
              dns = true;
            }
          }
          const data = await client.getAddedNodeInfo(dns);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.getAddedNodeInfo(); // throw help error
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

    return res.json(response);
  });
}

async function getConnectionCount(req, res) {
  try {
    const data = await client.getConnectionCount();
    console.log(data);
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

async function getDeprecationInfo(req, res) {
  try {
    const data = await client.getDeprecationInfo();
    console.log(data);
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

async function getNetTotals(req, res) {
  try {
    const data = await client.getNetTotals();
    console.log(data);
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

async function getNetworkInfo(req, res) {
  try {
    const data = await client.getNetworkInfo();
    console.log(data);
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

async function getPeerInfo(req, res) {
  try {
    const data = await client.getPeerInfo();
    console.log(data);
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

async function listBanned(req, res) {
  try {
    const data = await client.listBanned();
    console.log(data);
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

async function ping(req, res) {
  serviceHelper.verifyZelTeamSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.ping();
        console.log(data);
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

async function setBan(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  let { command } = req.params;
  command = command || req.query.command;
  let { bantime } = req.params;
  bantime = bantime || req.query.bantime;
  let { absolute } = req.params;
  absolute = absolute || req.query.absolute;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (ip && command && bantime && absolute) {
          if (typeof absolute !== 'boolean') {
            if (absolute === 'false' || absolute === 0 || absolute === '0') {
              absolute = false;
            }
            if (absolute === 'true' || absolute === 1 || absolute === '1') {
              absolute = true;
            }
          }
          if (typeof bantime !== 'number') {
            bantime = Number(bantime);
          }
          const data = await client.setBan(ip, command, bantime, absolute);
          response.status = 'success';
          response.data = data;
        } else if (ip && command && bantime) {
          if (typeof bantime !== 'number') {
            bantime = Number(bantime);
          }
          const data = await client.setBan(ip, command, bantime);
          response.status = 'success';
          response.data = data;
        } else if (ip && command) {
          const data = await client.setBan(ip, command);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.setBan(); // throw help error
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

    return res.json(response);
  });
}

module.exports = {
  // == Control ==
  help,
  getInfo,
  stop,

  // == Zelnode ==
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

  // == Blockchain ==
  getBestBlockHash,
  getBlock,
  getBlockchainInfo,
  getBlockCount,
  getBlockHah,
  getBlockHeader,
  getChainTips,
  getDifficulty,
  getMempoolInfo,
  getRawMemPool,
  getTxOut,
  getTxOutProof,
  getTxOutSetInfo,
  verifyChain,
  verifyTxOutProof,

  // == Disclosure ==
  // intentionally left out as of experimental feature
  // == Generating ==
  // intentionally left out as cpu mining is discouraged on zelnodes

  // == Mining ==
  getBlockSubsidy,
  getBlockTemplate,
  getLocalSolPs,
  getMiningInfo,
  getNetworkHashPs,
  getNetworkSolPs,
  prioritiseTransaction,
  submitBlock,

  // == Network ==
  addNode,
  clearBanned,
  disconnectNode,
  getAddedNodeInfo,
  getConnectionCount,
  getDeprecationInfo,
  getNetTotals,
  getNetworkInfo,
  getPeerInfo,
  listBanned,
  ping,
  setBan,
};
