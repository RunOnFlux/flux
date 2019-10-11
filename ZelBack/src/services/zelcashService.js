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

// eslint-disable-next-line consistent-return
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
    return res.json(response);
    // eslint-disable-next-line no-else-return
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
      try {
        if (typeof checklevel !== 'number') {
          checklevel = Number(checklevel);
        }
        if (typeof numblocks !== 'number') {
          numblocks = Number(numblocks);
        }
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

  try {
    if (typeof blocks !== 'number') {
      blocks = Number(blocks);
    }
    if (typeof height !== 'number') {
      height = Number(height);
    }
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

  try {
    if (typeof blocks !== 'number') {
      blocks = Number(blocks);
    }
    if (typeof height !== 'number') {
      height = Number(height);
    }
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

// == Rawtransactions ==
async function createRawTransaction(req, res) {
  let { transactions } = req.params;
  transactions = transactions || req.query.transactions;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  let { locktime } = req.params;
  locktime = locktime || req.query.locktime || 0;
  const blockcount = await client.getBlockCount().catch((error) => {
    const daemonerror = {
      code: error.code,
      message: error.message,
    };
    response.status = 'error';
    response.data = daemonerror;
    return res.json(response);
  });
  const defaultExpiryHeight = blockcount + 20;
  let { expiryheight } = req.params;
  expiryheight = expiryheight || req.query.expiryheight || defaultExpiryHeight;
  console.log(expiryheight);

  try {
    if (typeof locktime !== 'number') {
      locktime = Number(locktime);
    }
    if (typeof expiryheight !== 'number') {
      expiryheight = Number(expiryheight);
    }
    if (typeof transactions !== 'object') {
      transactions = JSON.parse(transactions);
    }
    if (typeof addresses !== 'object') {
      addresses = JSON.parse(addresses);
    }
    if (transactions && addresses) {
      const data = await client.createRawTransaction(transactions, addresses, locktime, expiryheight);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.createRawTransaction(); // throw error with help
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

async function decodeRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  try {
    if (hexstring) {
      const data = await client.decodeRawTransaction(hexstring);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.decodeRawTransaction(); // throw error with help
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

async function decodeScript(req, res) {
  let { hex } = req.params;
  hex = hex || req.query.hex;

  try {
    if (hex) {
      const data = await client.decodeScript(hex);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.decodeScript(); // throw error with help
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

async function fundRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  try {
    if (hexstring) {
      const data = await client.fundRawTransaction(hexstring);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.fundRawTransaction(); // throw error with help
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

async function getRawTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || 0;

  try {
    if (txid) {
      if (typeof verbose !== 'number') {
        verbose = Number(verbose);
      }
      console.log(verbose);
      const data = await client.getRawTransaction(txid, verbose);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getRawTransaction(); // throw error with help
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

async function sendRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;
  let { allowhighfees } = req.params;
  allowhighfees = allowhighfees || req.query.allowhighfees || false;

  try {
    if (hexstring) {
      if (typeof allowhighfees !== 'boolean') {
        if (allowhighfees === 'false' || allowhighfees === 0 || allowhighfees === '0') {
          allowhighfees = false;
        }
        if (allowhighfees === 'true' || allowhighfees === 1 || allowhighfees === '1') {
          allowhighfees = true;
        }
      }
      const data = await client.sendRawTransaction(hexstring, allowhighfees);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.sendRawTransaction(); // throw error with help
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

async function signRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;
  let { prevtxs } = req.params;
  prevtxs = prevtxs || req.query.prevtxs;
  let { privatekeys } = req.params;
  privatekeys = privatekeys || req.query.privatekeys;
  let { sighashtype } = req.params;
  sighashtype = sighashtype || req.query.sighashtype || 'ALL';
  let { branchid } = req.params;
  branchid = branchid || req.query.branchid;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (hexstring) {
          if (hexstring && prevtxs && privatekeys && branchid) {
            if (prevtxs) {
              if (typeof prevtxs !== 'object') {
                prevtxs = JSON.parse(prevtxs);
              }
            }
            if (privatekeys) {
              if (typeof privatekeys !== 'object') {
                privatekeys = JSON.parse(privatekeys);
              }
            }
            const data = await client.signRawTransaction(hexstring, prevtxs, privatekeys, sighashtype, branchid);
            response.status = 'success';
            response.data = data;
          } else if (hexstring && prevtxs && privatekeys) {
            if (prevtxs) {
              if (typeof prevtxs !== 'object') {
                prevtxs = JSON.parse(prevtxs);
              }
            }
            if (privatekeys) {
              if (typeof privatekeys !== 'object') {
                privatekeys = JSON.parse(privatekeys);
              }
            }
            const data = await client.signRawTransaction(hexstring, prevtxs, privatekeys, sighashtype);
            response.status = 'success';
            response.data = data;
          } else if (hexstring && prevtxs) {
            const data = await client.signRawTransaction(hexstring, prevtxs);
            response.status = 'success';
            response.data = data;
          } else {
            const data = await client.signRawTransaction(hexstring);
            response.status = 'success';
            response.data = data;
          }
        } else {
          const data = await client.signRawTransaction(); // throw error with help
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

// == Util ==
async function createMultiSig(req, res) {
  let { n } = req.params;
  n = n || req.query.n;
  let { keys } = req.params;
  keys = keys || req.query.keys;

  try {
    if (n && keys) {
      if (typeof n !== 'number') {
        n = Number(n);
      }
      if (typeof keys !== 'object') {
        keys = JSON.parse(keys);
      }
      const data = await client.createMultiSig(n, keys);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.createMultiSig(); // throw error with help
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

async function estimateFee(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  try {
    if (nblocks) {
      if (typeof nblocks !== 'number') {
        nblocks = Number(nblocks);
      }
      const data = await client.estimateFee(nblocks);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.estimateFee(); // throw error with help
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

async function estimatePriority(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  try {
    if (nblocks) {
      if (typeof nblocks !== 'number') {
        nblocks = Number(nblocks);
      }
      const data = await client.estimatePriority(nblocks);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.estimatePriority(); // throw error with help
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

async function validateAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;

  try {
    if (zelcashaddress) {
      const data = await client.validateAddress(zelcashaddress);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.validateAddress(); // throw error with help
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

async function verifyMessage(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { signature } = req.params;
  signature = signature || req.query.signature;
  let { message } = req.params;
  message = message || req.query.message;
  try {
    if (zelcashaddress && signature && message) {
      const data = await client.verifyMessage(zelcashaddress, signature, message);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.verifyMessage(); // throw error with help
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

async function zValidateAddress(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;

  try {
    if (zaddr) {
      const data = await client.z_validateaddress(zaddr);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.z_validateaddress(); // throw error with help
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

// == Wallet == Admin Privilage. Benchmark zelteam privilage
async function addMultiSigAddress(req, res) {
  let { n } = req.params;
  n = n || req.query.n;
  let { keysobject } = req.params;
  keysobject = keysobject || req.query.keysobject;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (n && keysobject) {
          if (typeof n !== 'number') {
            n = Number(n);
          }
          if (typeof privatekeys !== 'object') {
            keysobject = JSON.parse(keysobject);
          }
          const data = await client.addMultiSigAddress(n, keysobject);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.addMultiSigAddress(); // throw error with help
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

async function backupWallet(req, res) {
  let { destination } = req.params;
  destination = destination || req.query.destination;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (destination) {
          const data = await client.backupWallet(destination);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.backupWallet(); // throw error with help
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

async function dumpPrivKey(req, res) {
  let { taddr } = req.params;
  taddr = taddr || req.query.taddr;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (taddr) {
          const data = await client.dumpPrivKey(taddr);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.dumpPrivKey(); // throw error with help
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

async function getBalance(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof minconf !== 'number') {
          minconf = Number(minconf);
        }
        if (typeof includewatchonly !== 'boolean') {
          if (includewatchonly === 'false' || includewatchonly === 0 || includewatchonly === '0') {
            includewatchonly = false;
          }
          if (includewatchonly === 'true' || includewatchonly === 1 || includewatchonly === '1') {
            includewatchonly = true;
          }
        }
        const data = await client.getBalance('', minconf, includewatchonly);
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

async function getNewAddress(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.getNewAddress();
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

async function getRawChangeAddress(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.getRawChangeAddress();
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

async function getReceivedByAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (zelcashaddress) {
          if (typeof minconf !== 'number') {
            minconf = Number(minconf);
          }
          const data = await client.getReceivedByAddress(zelcashaddress, minconf);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.getReceivedByAddress(); // throw help
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

async function getTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  try {
    if (txid) {
      if (typeof includewatchonly !== 'boolean') {
        if (includewatchonly === 'false' || includewatchonly === 0 || includewatchonly === '0') {
          includewatchonly = false;
        }
        if (includewatchonly === 'true' || includewatchonly === 1 || includewatchonly === '1') {
          includewatchonly = true;
        }
      }
      const data = await client.getTransaction(txid, includewatchonly);
      response.status = 'success';
      response.data = data;
    } else {
      const data = await client.getTransaction(); // throw help
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

async function getUnconfirmedBalance(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.getUnconfirmedBalance();
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

async function getWalletInfo(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.getWalletInfo();
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

async function importAddress(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { label } = req.params;
  label = label || req.query.label || '';
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || true;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (address) {
          if (typeof rescan !== 'boolean') {
            if (rescan === 'false' || rescan === 0 || rescan === '0') {
              rescan = false;
            }
            if (rescan === 'true' || rescan === 1 || rescan === '1') {
              rescan = true;
            }
          }
          const data = await client.importAddress(address, label, rescan);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.importAddress(); // throw error with help
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

async function importPrivKey(req, res) {
  let { zelcashprivkey } = req.params;
  zelcashprivkey = zelcashprivkey || req.query.zelcashprivkey;
  let { label } = req.params;
  label = label || req.query.label || '';
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || true;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (zelcashprivkey) {
          if (typeof rescan !== 'boolean') {
            if (rescan === 'false' || rescan === 0 || rescan === '0') {
              rescan = false;
            }
            if (rescan === 'true' || rescan === 1 || rescan === '1') {
              rescan = true;
            }
          }
          const data = await client.importPrivKey(zelcashprivkey, label, rescan);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.importPrivKey(); // throw error with help
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

async function importWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (filename) {
          const data = await client.importWallet(filename);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.importWallet(); // throw error with help
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

async function keyPoolRefill(req, res) {
  let { newsize } = req.params;
  newsize = newsize || req.query.newsize || 100;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof newsize !== 'number') {
          newsize = Number(newsize);
        }
        const data = await client.keyPoolRefill(newsize);
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

async function listAddressGroupings(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.listAddressGroupings();
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

async function listLockUnspent(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.listLockUnspent();
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

async function listReceivedByAddress(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includeempty } = req.params;
  includeempty = includeempty || req.query.includeempty || false;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof includeempty !== 'boolean') {
          if (includeempty === 'false' || includeempty === 0 || includeempty === '0') {
            includeempty = false;
          }
          if (includeempty === 'true' || includeempty === 1 || includeempty === '1') {
            includeempty = true;
          }
        }
        if (typeof includewatchonly !== 'boolean') {
          if (includewatchonly === 'false' || includewatchonly === 0 || includewatchonly === '0') {
            includewatchonly = false;
          }
          if (includewatchonly === 'true' || includewatchonly === 1 || includewatchonly === '1') {
            includewatchonly = true;
          }
        }
        if (typeof minconf !== 'number') {
          minconf = Number(minconf);
        }
        const data = await client.listReceivedByAddress(minconf, includeempty, includewatchonly);
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

async function listSinceBlock(req, res) {
  let { blockhash } = req.params;
  blockhash = blockhash || req.query.blockhash || '';
  let { targetconfirmations } = req.params;
  targetconfirmations = targetconfirmations || req.query.targetconfirmations || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof targetconfirmations !== 'number') {
          targetconfirmations = Number(targetconfirmations);
        }
        if (typeof includewatchonly !== 'boolean') {
          if (includewatchonly === 'false' || includewatchonly === 0 || includewatchonly === '0') {
            includewatchonly = false;
          }
          if (includewatchonly === 'true' || includewatchonly === 1 || includewatchonly === '1') {
            includewatchonly = true;
          }
        }
        const data = await client.listSinceBlock(blockhash, targetconfirmations, includewatchonly);
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

async function listTransactions(req, res) {
  const account = '*';
  let { count } = req.params;
  count = count || req.query.count || 10;
  let { from } = req.params;
  from = from || req.query.from || 0;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof count !== 'number') {
          count = Number(count);
        }
        if (typeof from !== 'number') {
          from = Number(from);
        }
        if (typeof includewatchonly !== 'boolean') {
          if (includewatchonly === 'false' || includewatchonly === 0 || includewatchonly === '0') {
            includewatchonly = false;
          }
          if (includewatchonly === 'true' || includewatchonly === 1 || includewatchonly === '1') {
            includewatchonly = true;
          }
        }
        const data = await client.listTransactions(account, count, from, includewatchonly);
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

async function listUnspent(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { maxconf } = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof minconf !== 'number') {
          minconf = Number(minconf);
        }
        if (typeof maxconf !== 'number') {
          maxconf = Number(maxconf);
        }
        if (addresses) {
          if (typeof addresses !== 'object') {
            addresses = JSON.parse(addresses);
          }
          const data = await client.listUnspent(minconf, maxconf, addresses);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.listUnspent(minconf, maxconf);
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

async function lockUnspent(req, res) {
  let { unlock } = req.params;
  unlock = unlock || req.query.unlock;
  let { transactions } = req.params;
  transactions = transactions || req.query.transactions;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (unlock && transactions) {
          if (typeof unlock !== 'boolean') {
            if (unlock === 'false' || unlock === 0 || unlock === '0') {
              unlock = false;
            }
            if (unlock === 'true' || unlock === 1 || unlock === '1') {
              unlock = true;
            }
          }
          if (typeof transactions !== 'object') {
            transactions = JSON.parse(transactions);
          }
          const data = await client.lockUnspent(unlock, transactions);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.lockUnspent(); // throw help
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

async function sendFrom(req, res) {
  const account = '';
  let { tozelcashaddress } = req.params;
  tozelcashaddress = tozelcashaddress || req.query.tozelcashaddress;
  let { amount } = req.params;
  amount = amount || req.query.amount;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { comment } = req.params;
  comment = comment || req.query.comment || '';
  let { commentto } = req.params;
  commentto = commentto || req.query.commentto || '';
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (tozelcashaddress && amount) {
          if (typeof amount !== 'number') {
            amount = Number(amount);
          }
          if (typeof minconf !== 'number') {
            minconf = Number(minconf);
          }
          const data = await client.sendFrom(account, tozelcashaddress, amount, minconf, comment, commentto);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.sendFrom(); // throw help
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

async function sendMany(req, res) {
  const fromaccount = '';
  let { amounts } = req.params;
  amounts = amounts || req.query.amounts;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { comment } = req.params;
  comment = comment || req.query.comment || '';
  let { substractfeefromamount } = req.params;
  substractfeefromamount = substractfeefromamount || req.query.substractfeefromamount;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (amounts) {
          if (typeof amounts !== 'object') {
            amounts = JSON.parse(amounts);
          }
          if (typeof minconf !== 'number') {
            minconf = Number(minconf);
          }
          if (substractfeefromamount) {
            if (typeof substractfeefromamount !== 'object') {
              substractfeefromamount = JSON.parse(substractfeefromamount);
            }
            const data = await client.sendMany(fromaccount, amounts, minconf, comment, substractfeefromamount);
            response.status = 'success';
            response.data = data;
          } else {
            const data = await client.sendMany(fromaccount, amounts, minconf, comment);
            response.status = 'success';
            response.data = data;
          }
        } else {
          const data = await client.sendMany(); // throw help
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

async function sendToAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { amount } = req.params;
  amount = amount || req.query.amount;
  let { comment } = req.params;
  comment = comment || req.query.comment || '';
  let { commentto } = req.params;
  commentto = commentto || req.query.commentto || '';
  let { substractfeefromamount } = req.params;
  substractfeefromamount = substractfeefromamount || req.query.substractfeefromamount || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (zelcashaddress && amount) {
          if (typeof amount !== 'number') {
            amount = Number(amount);
          }
          if (typeof substractfeefromamount !== 'boolean') {
            if (substractfeefromamount === 'false' || substractfeefromamount === 0 || substractfeefromamount === '0') {
              substractfeefromamount = false;
            }
            if (substractfeefromamount === 'true' || substractfeefromamount === 1 || substractfeefromamount === '1') {
              substractfeefromamount = true;
            }
          }
          const data = await client.sendToAddress(zelcashaddress, amount, comment, commentto, substractfeefromamount);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.sendToAddress(); // throw help
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

async function setTxFee(req, res) {
  let { amount } = req.params;
  amount = amount || req.query.amount;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (amount) {
          if (typeof amount !== 'number') {
            amount = Number(amount);
          }
          const data = await client.setTxFee(amount);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.setTxFee(); // throw help
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

async function signMessage(req, res) {
  let { taddr } = req.params;
  taddr = taddr || req.query.taddr;
  let { message } = req.params;
  message = message || req.query.message;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (taddr && message) {
          const data = await client.signMessage(taddr, message);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.signMessage(); // throw help
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

async function zExportKey(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (zaddr) {
          const data = await client.z_exportkey(zaddr);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.z_exportkey(); // throw help
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

async function zExportViewingKey(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (zaddr) {
          const data = await client.z_exportviewingkey(zaddr);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.z_exportviewingkey(); // throw help
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

async function zGetBalance(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (address) {
          if (typeof minconf !== 'number') {
            minconf = Number(minconf);
          }
          const data = await client.z_getbalance(address, minconf);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.z_getbalance(); // throw help
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

async function zGetMigrationStatus(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.z_getmigrationstatus();
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

async function zGetNewAddress(req, res) {
  let { type } = req.params;
  type = type || req.query.type || 'sapling';
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        const data = await client.z_getnewaddress(type);
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

async function zGetOperationResult(req, res) {
  let { operationid } = req.params;
  operationid = operationid || req.query.operationid || [];
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof operationid !== 'object') {
          operationid = JSON.parse(operationid);
        }
        const data = await client.z_getoperationresult(operationid);
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

async function zGetOperationStatus(req, res) {
  let { operationid } = req.params;
  operationid = operationid || req.query.operationid || [];
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof operationid !== 'object') {
          operationid = JSON.parse(operationid);
        }
        const data = await client.z_getoperationstatus(operationid);
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

async function zGetTotalBalance(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (typeof transactions !== 'number') {
          minconf = Number(minconf);
        }
        if (typeof includewatchonly !== 'boolean') {
          if (includewatchonly === 'false' || includewatchonly === 0 || includewatchonly === '0') {
            includewatchonly = false;
          }
          if (includewatchonly === 'true' || includewatchonly === 1 || includewatchonly === '1') {
            includewatchonly = true;
          }
        }
        const data = await client.z_gettotalbalance(minconf, includewatchonly);
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

async function zImportKey(req, res) {
  let { zkey } = req.params;
  zkey = zkey || req.query.zkey;
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (zkey) {
          if (typeof startheight !== 'number') {
            startheight = Number(startheight);
          }
          const data = await client.z_importkey(zkey, rescan, startheight);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.z_importkey(zkey, rescan, startheight);
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

async function zImportViewingKey(req, res) {
  let { vkey } = req.params;
  vkey = vkey || req.query.vkey;
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (vkey) {
          if (typeof startheight !== 'number') {
            startheight = Number(startheight);
          }
          const data = await client.z_importviewingkey(vkey, rescan, startheight);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.z_importviewingkey(vkey, rescan, startheight);
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

async function zImportWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      try {
        if (filename) {
          const data = await client.z_importwallet(filename);
          response.status = 'success';
          response.data = data;
        } else {
          const data = await client.z_importwallet(); // throw error with help
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
  getNetworkHashPs, // == available but DEPRECATED ==
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

  // == Rawtransactions ==
  createRawTransaction,
  decodeRawTransaction,
  decodeScript,
  fundRawTransaction,
  getRawTransaction,
  sendRawTransaction,
  signRawTransaction,

  // == Util ==
  createMultiSig,
  estimateFee,
  estimatePriority,
  validateAddress,
  verifyMessage,
  zValidateAddress,

  // == Wallet ==
  addMultiSigAddress,
  backupWallet,
  dumpPrivKey,
  // encryptWallet, // == not available - EXPERIMENTAL FEATURE ==
  // getAccount, // == not available - DEPRECATED ==
  // getAccountAddress, // == not available - DEPRECATED ==
  // getAddressesByAccount, // == not available - DEPRECATED ==
  getBalance,
  getNewAddress,
  getRawChangeAddress,
  // getReceivedByAccount, // == not available - DEPRECATED ==
  getReceivedByAddress,
  getTransaction,
  getUnconfirmedBalance,
  getWalletInfo,
  importAddress,
  importPrivKey,
  importWallet, // == does not make much sense as no uploading method ==
  keyPoolRefill,
  // listAccounts, // == not available - DEPRECATED ==
  listAddressGroupings,
  listLockUnspent,
  // listReceivedByAccount, // == not available - DEPRECATED ==
  listReceivedByAddress,
  listSinceBlock,
  listTransactions,
  listUnspent,
  lockUnspent,
  // move, // == not available - DEPRECATED ==
  sendFrom, // == available but DEPRECATED ==
  sendMany,
  sendToAddress,
  // setAccount, // == not available - DEPRECATED ==
  setTxFee,
  signMessage,
  zExportKey,
  zExportViewingKey,
  zGetBalance,
  zGetMigrationStatus,
  zGetNewAddress,
  zGetOperationResult,
  zGetOperationStatus,
  zGetTotalBalance,
  zImportKey,
  zImportViewingKey,
  zImportWallet,
  // zListAddresses,
  // zListOperationIds,
  // zlistReceivedByAddress,
  // zListUnspent,
  // zMergeToAddress,
  // zSendMany,
  // zSetMigration,
  // zShieldCoinBase,
  // zcBenchmark,
  // zcRawJoinSplit,
  // zcRawKeygen,
  // zcRawReceive,
  // zcSampleJoinSplit,
};
