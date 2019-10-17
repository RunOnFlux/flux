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

function ensureBoolean(parameter) {
  if (typeof parameter !== 'boolean') {
    if (parameter === 'false' || parameter === 0 || parameter === '0') {
      // eslint-disable-next-line no-param-reassign
      parameter = false;
    }
    if (parameter === 'true' || parameter === 1 || parameter === '1') {
      // eslint-disable-next-line no-param-reassign
      parameter = true;
    }
  }
  return parameter;
}

function ensureNumber(parameter) {
  if (typeof parameter !== 'number') {
    // eslint-disable-next-line no-param-reassign
    parameter = Number(parameter);
  }
  return parameter;
}

function ensureObject(parameter) {
  if (typeof parameter !== 'object') {
    // eslint-disable-next-line no-param-reassign
    parameter = JSON.parse(parameter);
  }
  return parameter;
}

let response = {
  status: 'error',
  data: {
    message: 'Unknown error',
  },
};

const errUnauthorizedMessage = {
  status: 'error',
  data: {
    message: 'Unauthorized. Access denied.',
  },
};

async function executeCall(rpc, params) {
  const callResponse = {
    status: 'error',
    data: {
      message: 'Unknown error',
    },
  };
  const rpcparameters = params || [];
  try {
    const data = await client[rpc](...rpcparameters);
    callResponse.status = 'success';
    callResponse.data = data;
  } catch (err) {
    const daemonerror = {
      code: err.code,
      message: err.message,
    };
    callResponse.status = 'error';
    callResponse.data = daemonerror;
  }

  return callResponse;
}

// == Control ==
async function help(req, res) {
  let { command } = req.params; // we accept both help/command and help?command=getinfo
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [command];

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getInfo(req, res) {
  const rpccall = 'getInfo';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function stop(req, res) { // practically useless
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'stop';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

// == Zelnode ==
async function getZelnNodeStatus(req, res) {
  const rpccall = 'getzelnodestatus';

  response = await executeCall(rpccall);

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
      const rpccall = 'listzelnodeconf';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'createzelnodekey';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
    const rpccall = 'znsync';
    const rpcparameters = [mode];

    response = await executeCall(rpccall, rpcparameters);
    return res.json(response);
    // eslint-disable-next-line no-else-return
  } else {
    serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
      if (error) {
        return res.json(error);
      }
      if (authorized === true) {
        const rpccall = 'znsync';
        const rpcparameters = [mode];

        response = await executeCall(rpccall, rpcparameters);
      } else {
        response = errUnauthorizedMessage;
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

  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === false) {
      const rpccall = 'createzelnodebroadcast';
      const rpcparameters = [command, alias];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function decodeZelNodeBroadcast(req, res) {
  console.log(req.params);
  console.log(req.query);
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodezelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getNodeBenchmarks(req, res) {
  const rpccall = 'getnodebenchmarks';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getZelNodeCount(req, res) {
  const rpccall = 'getzelnodecount';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getZelNodeOutputs(req, res) {
  // eslint-disable-next-line consistent-return
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'getzelnodeoutputs';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function getZelNodeScores(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10'; // defaults to 10 as default zelcash value

  const rpccall = 'getzelnodescores';
  const rpcparameters = [];
  rpcparameters.push(blocks);

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getZelNodeWinners(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10'; // defaults to 10 as default zelcash value
  let { filter } = req.params;
  filter = filter || req.query.filter;

  const rpccall = 'getzelnodewinners';
  const rpcparameters = [];
  rpcparameters.push(blocks);
  if (filter) {
    rpcparameters.push(filter);
  }
  console.log(rpcparameters);

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function relayZelNodeBroadcast(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'relayzelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function spork(req, res) {
  let { name } = req.params;
  name = name || req.query.name || 'show'; // name, show, active
  let { value } = req.params;
  value = value || req.query.value;

  const rpccall = 'spork';
  const rpcparameters = [];
  rpcparameters.push(name);
  if (value) {
    value = ensureNumber(value);
    rpcparameters.push(value);
  }

  response = await executeCall(rpccall, rpcparameters);

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
      const rpccall = 'startzelnode';
      const rpcparameters = [];
      rpcparameters.push(set);
      rpcparameters.push(lockwallet);
      if (alias) {
        rpcparameters.push(alias);
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zelNodeCurrentWinner(req, res) {
  const rpccall = 'zelnodecurrentwinner';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function zelNodeDebug(req, res) {
  const rpccall = 'zelnodedebug';

  response = await executeCall(rpccall);

  return res.json(response);
}
// == Blockchain ==
async function getBestBlockHash(req, res) {
  const rpccall = 'getBestBlockHash';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getBlock(req, res) {
  let { hashheight } = req.params;
  hashheight = hashheight || req.query.hashheight;
  let { verbosity } = req.params;
  verbosity = verbosity || req.query.verbosity || 2; // defaults to json object. CORRECT ZELCASH verbosity is number, error says its not boolean
  verbosity = ensureNumber(verbosity);

  const rpccall = 'getBlock';
  const rpcparameters = [hashheight, verbosity];

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getBlockchainInfo(req, res) {
  const rpccall = 'getBlockchainInfo';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getBlockCount(req, res) {
  const rpccall = 'getBlockCount';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getBlockHah(req, res) {
  let { index } = req.params;
  index = index || req.query.index; // no default value, show help

  const rpccall = 'getBlockHah';
  const rpcparameters = [];
  if (index) {
    index = ensureNumber(index);
    rpcparameters.push(index);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getBlockHeader(req, res) {
  let { hash } = req.params;
  hash = hash || req.query.hash;
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || true;

  const rpccall = 'getBlockHeader';
  const rpcparameters = [];
  if (hash) {
    verbose = ensureBoolean(verbose);
    rpcparameters.push(hash);
    rpcparameters.push(verbose);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getChainTips(req, res) {
  const rpccall = 'getChainTips';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getDifficulty(req, res) {
  const rpccall = 'getDifficulty';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getMempoolInfo(req, res) {
  const rpccall = 'getMempoolInfo';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getRawMemPool(req, res) {
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || false;

  verbose = ensureBoolean(verbose);

  const rpccall = 'getRawMemPool';
  const rpcparameters = [verbose];

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getTxOut(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { n } = req.params;
  n = n || req.query.n;
  let { includemempool } = req.params;
  includemempool = includemempool || req.query.includemempool || true;

  const rpccall = 'getTxOut';
  const rpcparameters = [];
  if (txid && n) {
    includemempool = ensureBoolean(includemempool);
    n = ensureNumber(n);
    rpcparameters.push(txid);
    rpcparameters.push(n);
    rpcparameters.push(includemempool);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getTxOutProof(req, res) {
  let { txids } = req.params;
  txids = txids || req.query.txids;
  let { blockhash } = req.params;
  blockhash = blockhash || req.query.blockhash;
  const txidsarray = txids.split(',');

  const rpccall = 'getTxOutProof';
  const rpcparameters = [];
  if (txids && blockhash) {
    rpcparameters.push(txidsarray);
    rpcparameters.push(blockhash);
  } else if (txids) {
    rpcparameters.push(txidsarray);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getTxOutSetInfo(req, res) {
  const rpccall = 'getTxOutSetInfo';

  response = await executeCall(rpccall);

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
      checklevel = ensureNumber(checklevel);
      numblocks = ensureNumber(numblocks);
      const rpccall = 'verifyChain';
      const rpcparameters = [checklevel, numblocks];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function verifyTxOutProof(req, res) {
  let { proof } = req.params;
  proof = proof || req.query.proof;

  const rpccall = 'verifyTxOutProof';
  const rpcparameters = [];
  if (proof) {
    rpcparameters.push(proof);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

// == Mining ==
async function getBlockSubsidy(req, res) {
  let { height } = req.params;
  height = height || req.query.height;

  const rpccall = 'getBlockSubsidy';
  const rpcparameters = [];
  if (height) {
    height = ensureNumber(height);
    rpcparameters.push(height);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getBlockTemplate(req, res) {
  let { jsonrequestobject } = req.params;
  jsonrequestobject = jsonrequestobject || req.query.jsonrequestobject;

  const rpccall = 'getBlockTemplate';
  const rpcparameters = [];
  if (jsonrequestobject) {
    jsonrequestobject = ensureObject(jsonrequestobject);
    rpcparameters.push(jsonrequestobject);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getLocalSolPs(req, res) {
  const rpccall = 'getLocalSolPs';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getMiningInfo(req, res) {
  const rpccall = 'getMiningInfo';

  response = await executeCall(rpccall);


  return res.json(response);
}

async function getNetworkHashPs(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || 120;
  let { height } = req.params;
  height = height || req.query.height || -1;

  blocks = ensureNumber(blocks);
  height = ensureNumber(height);

  const rpccall = 'getNetworkHashPs';
  const rpcparameters = [blocks, height];

  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getNetworkSolPs(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || 120;
  let { height } = req.params;
  height = height || req.query.height || -1;

  blocks = ensureNumber(blocks);
  height = ensureNumber(height);
  const rpccall = 'getNetworkSolPs';
  const rpcparameters = [blocks, height];

  response = await executeCall(rpccall, rpcparameters);

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
      const rpccall = 'prioritiseTransaction';
      let rpcparameters = [];
      if (txid && prioritydelta && feedelta) {
        prioritydelta = ensureNumber(prioritydelta);
        feedelta = ensureNumber(feedelta);
        rpcparameters = [txid, prioritydelta, feedelta];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'submitBlock';
      let rpcparameters = [];
      if (hexdata && jsonparametersobject) {
        jsonparametersobject = ensureObject(jsonparametersobject);
        rpcparameters = [hexdata, jsonparametersobject];
      } else if (hexdata) {
        rpcparameters = [hexdata];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'addNode';
      let rpcparameters = [];
      if (node && command) {
        rpcparameters = [node, command];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'clearBanned';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'disconnectNode';
      let rpcparameters = [];
      if (node) {
        rpcparameters = [node];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'getAddedNodeInfo';
      const rpcparameters = [];
      if (dns) {
        dns = ensureBoolean(dns);
        rpcparameters.push(dns);
        if (node) {
          rpcparameters.push(node);
        }
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function getConnectionCount(req, res) {
  const rpccall = 'getConnectionCount';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getDeprecationInfo(req, res) {
  const rpccall = 'getDeprecationInfo';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getNetTotals(req, res) {
  const rpccall = 'getNetTotals';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getNetworkInfo(req, res) {
  const rpccall = 'getNetworkInfo';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function getPeerInfo(req, res) {
  const rpccall = 'getPeerInfo';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function listBanned(req, res) {
  const rpccall = 'listBanned';

  response = await executeCall(rpccall);

  return res.json(response);
}

async function ping(req, res) {
  serviceHelper.verifyZelTeamSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'ping';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'setBan';
      const rpcparameters = [];
      if (ip && command) {
        rpcparameters.push(ip);
        rpcparameters.push(command);
        if (bantime) {
          bantime = ensureNumber(bantime);
          rpcparameters.push(bantime);
          if (absolute) {
            absolute = ensureBoolean(absolute);
            rpcparameters.push(absolute);
          }
        }
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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

  locktime = ensureNumber(locktime);
  expiryheight = ensureNumber(expiryheight);
  const rpccall = 'createRawTransaction';
  let rpcparameters = [];
  if (transactions && addresses) {
    transactions = ensureObject(transactions);
    addresses = ensureObject(addresses);
    rpcparameters = [transactions, addresses, locktime, expiryheight];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function decodeRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodeRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    rpcparameters = [hexstring];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function decodeScript(req, res) {
  let { hex } = req.params;
  hex = hex || req.query.hex;

  const rpccall = 'decodeScript';
  let rpcparameters = [];
  if (hex) {
    rpcparameters = [hex];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function fundRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'fundRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    rpcparameters = [hexstring];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getRawTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { verbose } = req.params;
  verbose = verbose || req.query.verbose || 0;

  const rpccall = 'getRawTransaction';
  let rpcparameters = [];
  if (txid) {
    verbose = ensureNumber(verbose);
    rpcparameters = [txid, verbose];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function sendRawTransaction(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;
  let { allowhighfees } = req.params;
  allowhighfees = allowhighfees || req.query.allowhighfees || false;

  const rpccall = 'sendRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    allowhighfees = ensureBoolean(allowhighfees);
    rpcparameters = [hexstring, allowhighfees];
  }
  response = await executeCall(rpccall, rpcparameters);

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
      const rpccall = 'signRawTransaction';
      const rpcparameters = [];
      if (hexstring) {
        rpcparameters.push(hexstring);
        if (prevtxs) {
          prevtxs = ensureObject(prevtxs);
          rpcparameters.push(prevtxs);
          if (privatekeys) {
            privatekeys = ensureObject(privatekeys);
            rpcparameters.push(privatekeys);
            rpcparameters.push(sighashtype);
            if (branchid) {
              rpcparameters.push(branchid);
            }
          }
        }
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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

  const rpccall = 'createMultiSig';
  let rpcparameters = [];
  if (n && keys) {
    n = ensureNumber(n);
    keys = ensureObject(keys);
    rpcparameters = [n, keys];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function estimateFee(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimateFee';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = ensureNumber(nblocks);
    rpcparameters = [nblocks];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function estimatePriority(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimatePriority';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = ensureNumber(nblocks);
    rpcparameters = [nblocks];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function validateAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;

  const rpccall = 'validateAddress';
  let rpcparameters = [];
  if (zelcashaddress) {
    rpcparameters = [zelcashaddress];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function verifyMessage(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { signature } = req.params;
  signature = signature || req.query.signature;
  let { message } = req.params;
  message = message || req.query.message;

  const rpccall = 'verifyMessage';
  let rpcparameters = [];
  if (zelcashaddress && signature && message) {
    rpcparameters = [zelcashaddress, signature, message];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function zValidateAddress(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;

  const rpccall = 'z_validateaddress';
  let rpcparameters = [];
  if (zaddr) {
    rpcparameters = [zaddr];
  }
  response = await executeCall(rpccall, rpcparameters);

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
      const rpccall = 'addMultiSigAddress';
      let rpcparameters = [];
      if (n && keysobject) {
        n = ensureNumber(n);
        keysobject = ensureObject(keysobject);
        rpcparameters = [n, keysobject];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'backupWallet';
      let rpcparameters = [];
      if (destination) {
        rpcparameters = [destination];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'dumpPrivKey';
      let rpcparameters = [];
      if (taddr) {
        rpcparameters = [taddr];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'getBalance';
      minconf = ensureNumber(minconf);
      includewatchonly = ensureBoolean(includewatchonly);
      const rpcparameters = ['', minconf, includewatchonly];
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'getNewAddress';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'getRawChangeAddress';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'getReceivedByAddress';
      let rpcparameters = [];
      if (zelcashaddress) {
        minconf = ensureNumber(minconf);
        rpcparameters = [zelcashaddress, minconf];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function getTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;

  const rpccall = 'getTransaction';
  let rpcparameters = [];
  if (txid) {
    includewatchonly = ensureBoolean(includewatchonly);
    rpcparameters = [txid, includewatchonly];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res.json(response);
}

async function getUnconfirmedBalance(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'getUnconfirmedBalance';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'getWalletInfo';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'importAddress';
      let rpcparameters = [];
      if (address) {
        rescan = ensureBoolean(rescan);
        rpcparameters = [address, label, rescan];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'importPrivKey';
      let rpcparameters = [];
      if (zelcashprivkey) {
        rescan = ensureBoolean(rescan);
        rpcparameters = [zelcashprivkey, label, rescan];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'importWallet';
      let rpcparameters = [];
      if (filename) {
        rpcparameters = [filename];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'keyPoolRefill';
      newsize = ensureNumber(newsize);
      const rpcparameters = [newsize];
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'listAddressGroupings';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'listLockUnspent';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function rescanBlockchain(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === false) {
      const rpccall = 'rescanblockchain';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      minconf = ensureNumber(minconf);
      includeempty = ensureBoolean(includeempty);
      includewatchonly = ensureBoolean(includewatchonly);
      const rpccall = 'listReceivedByAddress';
      const rpcparameters = [minconf, includeempty, includewatchonly];
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      targetconfirmations = ensureNumber(targetconfirmations);
      includewatchonly = ensureBoolean(includewatchonly);
      const rpccall = 'listSinceBlock';
      const rpcparameters = [blockhash, targetconfirmations, includewatchonly];
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      count = ensureNumber(count);
      from = ensureNumber(from);
      includewatchonly = ensureBoolean(includewatchonly);
      const rpccall = 'listTransactions';
      const rpcparameters = [account, count, from, includewatchonly];
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      minconf = ensureNumber(minconf);
      maxconf = ensureNumber(maxconf);
      const rpccall = 'listUnspent';
      const rpcparameters = [minconf, maxconf];
      if (addresses) {
        addresses = ensureObject(addresses);
        rpcparameters.push(addresses);
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'lockUnspent';
      let rpcparameters = [];
      if (unlock && transactions) {
        unlock = ensureBoolean(unlock);
        transactions = ensureObject(transactions);
        rpcparameters = [unlock, transactions];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'sendFrom';
      let rpcparameters = [];
      if (tozelcashaddress && amount) {
        amount = ensureNumber(amount);
        minconf = ensureNumber(minconf);
        rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'sendMany';
      let rpcparameters = [];
      if (amounts) {
        amounts = ensureObject(amounts);
        minconf = ensureNumber(minconf);
        rpcparameters = [fromaccount, amounts, minconf, comment];
        if (substractfeefromamount) {
          substractfeefromamount = ensureObject(substractfeefromamount);
          rpcparameters.push(substractfeefromamount);
        }
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'sendToAddress';
      let rpcparameters = [];
      if (zelcashaddress && amount) {
        amount = ensureNumber(amount);
        substractfeefromamount = ensureBoolean(substractfeefromamount);
        rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'setTxFee';
      let rpcparameters = [];
      if (amount) {
        amount = ensureNumber(amount);
        rpcparameters = [amount];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'signMessage';
      let rpcparameters = [];
      if (taddr && message) {
        rpcparameters = [taddr, message];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_exportkey';
      let rpcparameters = [];
      if (zaddr) {
        rpcparameters = [zaddr];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_exportviewingkey';
      let rpcparameters = [];
      if (zaddr) {
        rpcparameters = [zaddr];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_getbalance';
      let rpcparameters = [];
      if (address) {
        minconf = ensureNumber(minconf);
        rpcparameters = [address, minconf];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_getmigrationstatus';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_getnewaddress';
      const rpcparameters = [type];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      operationid = ensureObject(operationid);
      const rpccall = 'z_getoperationresult';
      const rpcparameters = [operationid];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      operationid = ensureObject(operationid);
      const rpccall = 'z_getoperationstatus';
      const rpcparameters = [operationid];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      minconf = ensureNumber(minconf);
      includewatchonly = ensureBoolean(includewatchonly);
      const rpccall = 'z_gettotalbalance';
      const rpcparameters = [minconf, includewatchonly];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_importkey';
      let rpcparameters = [];
      if (zkey) {
        startheight = ensureNumber(startheight);
        rpcparameters = [zkey, rescan, startheight];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_importkey';
      let rpcparameters = [];
      if (vkey) {
        startheight = ensureNumber(startheight);
        rpcparameters = [vkey, rescan, startheight];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
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
      const rpccall = 'z_importwallet';
      let rpcparameters = [];
      if (filename) {
        rpcparameters = [filename];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zListAddresses(req, res) {
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      includewatchonly = ensureBoolean(includewatchonly);
      const rpccall = 'z_listaddresses';
      const rpcparameters = [includewatchonly];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zListOperationIds(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_listoperationids';

      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zListReceivedByAddress(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_listreceivedbyaddress';
      let rpcparameters = [];
      if (address) {
        minconf = ensureNumber(minconf);
        rpcparameters = [address, minconf];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zListUnspent(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { maxconf } = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_listunspent';
      minconf = ensureNumber(minconf);
      maxconf = ensureNumber(maxconf);
      includewatchonly = ensureBoolean(includewatchonly);
      const rpcparameters = [minconf, maxconf, includewatchonly];
      if (addresses) {
        addresses = ensureObject(addresses);
        rpcparameters.push(addresses);
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zMergeToAddress(req, res) {
  let { fromaddresses } = req.params;
  fromaddresses = fromaddresses || req.query.fromaddresses;
  let { toaddress } = req.params;
  toaddress = toaddress || req.query.toaddress;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  let { transparentlimit } = req.params;
  transparentlimit = transparentlimit || req.query.transparentlimit || 50; // 0 for as many as can fit
  let { shieldedlimit } = req.params;
  shieldedlimit = shieldedlimit || req.query.shieldedlimit || 20; // 0 for as many as can fit
  let { memo } = req.params;
  memo = memo || req.query.memo || '';
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_mergetoaddress';
      let rpcparameters = [];
      if (fromaddresses && toaddress) {
        fromaddresses = ensureObject(fromaddresses);
        fee = ensureNumber(fee);
        transparentlimit = ensureNumber(transparentlimit);
        shieldedlimit = ensureNumber(shieldedlimit);
        rpcparameters = [fromaddresses, toaddress, fee, transparentlimit, shieldedlimit, memo];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zSendMany(req, res) {
  let { fromaddress } = req.params;
  fromaddress = fromaddress || req.query.fromaddress;
  let { amounts } = req.params;
  amounts = amounts || req.query.amounts;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_sendmany';
      let rpcparameters = [];
      if (fromaddress && amounts) {
        amounts = ensureObject(amounts);
        minconf = ensureNumber(minconf);
        fee = ensureNumber(fee);
        rpcparameters = [fromaddress, amounts, minconf, fee];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zSetMigration(req, res) {
  let { enabled } = req.params;
  enabled = enabled || req.query.enabled;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_setmigration';
      let rpcparameters = [];
      if (enabled) {
        enabled = ensureBoolean(enabled);
        rpcparameters = [enabled];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zShieldCoinBase(req, res) {
  let { fromaddress } = req.params;
  fromaddress = fromaddress || req.query.fromaddress; // '*' for all
  let { toaddress } = req.params;
  toaddress = toaddress || req.query.toaddress;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  let { limit } = req.params;
  limit = limit || req.query.limit || 50; // 0 for as many as can fit
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'z_shieldcoinbase';
      let rpcparameters = [];
      if (fromaddress && toaddress) {
        fee = ensureNumber(fee);
        limit = ensureNumber(limit);
        rpcparameters = [fromaddress, toaddress, fee, limit];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zcBenchmark(req, res) {
  let { benchmarktype } = req.params;
  benchmarktype = benchmarktype || req.query.benchmarktype;
  let { samplecount } = req.params;
  samplecount = samplecount || req.query.samplecount;
  serviceHelper.verifyZelTeamSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'zcbenchmark';
      let rpcparameters = [];
      if (benchmarktype && samplecount) {
        samplecount = ensureNumber(samplecount);
        rpcparameters = [benchmarktype, samplecount];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zcRawJoinSplit(req, res) {
  let { rawtx } = req.params;
  rawtx = rawtx || req.query.rawtx;
  let { inputs } = req.params;
  inputs = inputs || req.query.inputs;
  let { outputs } = req.params;
  outputs = outputs || req.query.outputs;
  let { vpubold } = req.params;
  vpubold = vpubold || req.query.vpubold;
  let { vpubnew } = req.params;
  vpubnew = vpubnew || req.query.vpubnew;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'zcrawjoinsplit';
      let rpcparameters = [];
      if (rawtx && inputs && outputs && vpubold && vpubnew) {
        inputs = ensureObject(inputs);
        outputs = ensureObject(outputs);
        rpcparameters = [rawtx, inputs, outputs, vpubold, vpubnew];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zcRawKeygen(req, res) {
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'zcrawkeygen';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zcRawReceive(req, res) {
  let { zcsecretkey } = req.params;
  zcsecretkey = zcsecretkey || req.query.zcsecretkey;
  let { encryptednote } = req.params;
  encryptednote = encryptednote || req.query.encryptednote;
  serviceHelper.verifyAdminSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'zcrawreceive';
      let rpcparameters = [];
      if (zcsecretkey && encryptednote) {
        rpcparameters = [zcsecretkey, encryptednote];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = errUnauthorizedMessage;
    }

    return res.json(response);
  });
}

async function zcSampleJoinSplit(req, res) {
  serviceHelper.verifyZelTeamSession(req.headers, async (error, authorized) => {
    if (error) {
      return res.json(error);
    }
    if (authorized === true) {
      const rpccall = 'zcsamplejoinsplit';
      response = await executeCall(rpccall);
    } else {
      response = errUnauthorizedMessage;
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
  rescanBlockchain,
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
  zListAddresses,
  zListOperationIds,
  zListReceivedByAddress,
  zListUnspent,
  zMergeToAddress,
  zSendMany,
  zSetMigration,
  zShieldCoinBase,
  zcBenchmark,
  zcRawJoinSplit, // == available but DEPRECATED ==
  zcRawKeygen, // == available but DEPRECATED ==
  zcRawReceive, // == available but DEPRECATED ==
  zcSampleJoinSplit,
};
