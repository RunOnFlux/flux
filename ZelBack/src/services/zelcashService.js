const zelcashrpc = require('zelcashrpc');
const fullnode = require('fullnode');
const serviceHelper = require('./serviceHelper');
const userconfig = require('../../../config/userconfig');

const config = new fullnode.Config();
const isTestnet = userconfig.initial.testnet;
const rpcuser = config.rpcuser() || 'rpcuser';
const rpcpassword = config.rpcpassword() || 'rpcpassword';
const rpcport = config.rpcport() || (isTestnet === true ? 26124 : 16124);

const client = new zelcashrpc.Client({
  port : rpcport,
  user : rpcuser,
  pass : rpcpassword,
  timeout : 60000,
});

let response = serviceHelper.createErrorMessage();

async function executeCall(rpc, params) {
  let callResponse;
  const rpcparameters = params || [];
  try {
    const data = await client[rpc](...rpcparameters);
    const successResponse = serviceHelper.createDataMessage(data);
    callResponse = successResponse;
  } catch (error) {
    const daemonError =
        serviceHelper.createErrorMessage(error.message, error.name, error.code);
    callResponse = daemonError;
  }

  return callResponse;
}

function getConfigValue(parameter) {
  const value = config.get(parameter);
  return value;
}

// == Control ==
async function help(req, res) {
  let {command} =
      req.params; // we accept both help/command and help?command=getinfo
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [ command ];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getInfo(req, res) {
  const rpccall = 'getInfo';

  response = await executeCall(rpccall);
  if (res) {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      delete response.data.balance;
    }
  } else {
    delete response.data.balance;
  }

  return res ? res.json(response) : response;
}

async function stop(req, res) { // practically useless
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'stop';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == Zelnode ==
async function getZelNodeStatus(req, res) {
  const rpccall = 'getzelnodestatus';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function listZelNodes(req, res) {
  let {filter} = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'listzelnodes';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function listZelNodeConf(req, res) { // practically useless
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  let {filter} = req.params;
  filter = filter || req.query.filter;
  if (authorized === true) {
    const rpccall = 'listzelnodeconf';
    const rpcparameters = [];
    if (filter) {
      rpcparameters.push(filter);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function createZelNodeKey(req, res) { // practically useless
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodekey';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function znsync(req, res) {
  let {mode} =
      req.params; // we accept both znsync/status and znsync?mode=status
  mode = mode || req.query.mode || 'status'; // default to status
  if (mode === 'status') {
    const rpccall = 'znsync';
    const rpcparameters = [ mode ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'znsync';
      const rpcparameters = [ mode ];

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }
  }
  return res ? res.json(response) : response;
}

async function createZelNodeBroadcast(req, res) {
  let {command} = req.params;
  command = command || req.query.command || '';
  let {alias} = req.params;
  alias = alias || req.query.alias || '';

  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodebroadcast';
    const rpcparameters = [ command, alias ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function decodeZelNodeBroadcast(req, res) {
  let {hexstring} = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodezelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getZelNodeCount(req, res) {
  const rpccall = 'getzelnodecount';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getDOSList(req, res) {
  const rpccall = 'getdoslist';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getStartList(req, res) {
  const rpccall = 'getstartlist';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getZelNodeOutputs(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getzelnodeoutputs';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getZelNodeScores(req, res) {
  let {blocks} = req.params;
  blocks = blocks || req.query.blocks || '10';

  const rpccall = 'getzelnodescores';
  const rpcparameters = [];
  rpcparameters.push(blocks);

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getZelNodeWinners(req, res) {
  let {blocks} = req.params;
  blocks = blocks || req.query.blocks ||
           '10'; // defaults to 10 as default zelcash value
  let {filter} = req.params;
  filter = filter || req.query.filter;

  const rpccall = 'getzelnodewinners';
  const rpcparameters = [];
  rpcparameters.push(blocks);
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function relayZelNodeBroadcast(req, res) {
  let {hexstring} = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'relayzelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function spork(req, res) {
  let {name} = req.params;
  name = name || req.query.name || 'show'; // name, show, active
  let {value} = req.params;
  value = value || req.query.value;

  const rpccall = 'spork';
  const rpcparameters = [];
  rpcparameters.push(name);
  if (value) {
    value = serviceHelper.ensureNumber(value);
    rpcparameters.push(value);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function startDeterministicZelNode(req, res) {
  let {alias} = req.params;
  alias = alias || req.query.alias;
  let {lockwallet} = req.params;
  lockwallet = lockwallet || req.query.lockwallet || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startdeterministiczelnode';
    const rpcparameters = [];
    rpcparameters.push(alias);
    if (lockwallet) {
      lockwallet = serviceHelper.ensureBoolean(lockwallet);
      rpcparameters.push(lockwallet);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function startZelNode(req, res) {
  let {set} = req.params;
  set = set || req.query.set;
  let {lockwallet} = req.params;
  lockwallet = lockwallet || req.query.lockwallet;
  let {alias} = req.params;
  alias = alias || req.query.alias;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
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
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function viewDeterministicZelNodeList(req, res) {
  let {filter} = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'viewdeterministiczelnodelist';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function zelNodeCurrentWinner(req, res) {
  const rpccall = 'zelnodecurrentwinner';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function zelNodeDebug(req, res) {
  const rpccall = 'zelnodedebug';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}
// == Blockchain ==
async function getBestBlockHash(req, res) {
  const rpccall = 'getBestBlockHash';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getBlock(req, res) {
  let {hashheight} = req.params;
  hashheight = hashheight || req.query.hashheight;
  hashheight = serviceHelper.ensureString(hashheight);
  let {verbosity} = req.params;
  verbosity = verbosity || req.query.verbosity ||
              2; // defaults to json object. CORRECT ZELCASH verbosity is
                 // number, error says its not boolean
  verbosity = serviceHelper.ensureNumber(verbosity);

  const rpccall = 'getBlock';
  const rpcparameters = [ hashheight, verbosity ];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getBlockchainInfo(req, res) {
  const rpccall = 'getBlockchainInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getBlockCount(req, res) {
  const rpccall = 'getBlockCount';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getBlockHash(req, res) {
  let {index} = req.params;
  index = index || req.query.index; // no default value, show help

  const rpccall = 'getBlockHash';
  const rpcparameters = [];
  if (index) {
    index = serviceHelper.ensureNumber(index);
    rpcparameters.push(index);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getBlockHeader(req, res) {
  let {hash} = req.params;
  hash = hash || req.query.hash;
  let {verbose} = req.params;
  verbose = verbose || req.query.verbose || true;

  const rpccall = 'getBlockHeader';
  const rpcparameters = [];
  if (hash) {
    verbose = serviceHelper.ensureBoolean(verbose);
    rpcparameters.push(hash);
    rpcparameters.push(verbose);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getChainTips(req, res) {
  const rpccall = 'getChainTips';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getDifficulty(req, res) {
  const rpccall = 'getDifficulty';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getMempoolInfo(req, res) {
  const rpccall = 'getMempoolInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getRawMemPool(req, res) {
  let {verbose} = req.params;
  verbose = verbose || req.query.verbose || false;

  verbose = serviceHelper.ensureBoolean(verbose);

  const rpccall = 'getRawMemPool';
  const rpcparameters = [ verbose ];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getTxOut(req, res) {
  let {txid} = req.params;
  txid = txid || req.query.txid;
  let {n} = req.params;
  n = n || req.query.n;
  let {includemempool} = req.params;
  includemempool = includemempool || req.query.includemempool || true;

  const rpccall = 'getTxOut';
  const rpcparameters = [];
  if (txid && n) {
    includemempool = serviceHelper.ensureBoolean(includemempool);
    n = serviceHelper.ensureNumber(n);
    rpcparameters.push(txid);
    rpcparameters.push(n);
    rpcparameters.push(includemempool);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getTxOutProof(req, res) {
  let {txids} = req.params;
  txids = txids || req.query.txids;
  let {blockhash} = req.params;
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

  return res ? res.json(response) : response;
}

async function getTxOutSetInfo(req, res) {
  const rpccall = 'getTxOutSetInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function verifyChain(req, res) {
  let {checklevel} = req.params;
  checklevel = checklevel || req.query.checklevel || 3;
  let {numblocks} = req.params;
  numblocks = numblocks || req.query.numblocks || 288;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    checklevel = serviceHelper.ensureNumber(checklevel);
    numblocks = serviceHelper.ensureNumber(numblocks);
    const rpccall = 'verifyChain';
    const rpcparameters = [ checklevel, numblocks ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function verifyTxOutProof(req, res) {
  let {proof} = req.params;
  proof = proof || req.query.proof;

  const rpccall = 'verifyTxOutProof';
  const rpcparameters = [];
  if (proof) {
    rpcparameters.push(proof);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

// == Mining ==
async function getBlockSubsidy(req, res) {
  let {height} = req.params;
  height = height || req.query.height;

  const rpccall = 'getBlockSubsidy';
  const rpcparameters = [];
  if (height) {
    height = serviceHelper.ensureNumber(height);
    rpcparameters.push(height);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getBlockTemplate(req, res) {
  let {jsonrequestobject} = req.params;
  jsonrequestobject = jsonrequestobject || req.query.jsonrequestobject;

  const rpccall = 'getBlockTemplate';
  const rpcparameters = [];
  if (jsonrequestobject) {
    jsonrequestobject = serviceHelper.ensureObject(jsonrequestobject);
    rpcparameters.push(jsonrequestobject);
  }

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getLocalSolPs(req, res) {
  const rpccall = 'getLocalSolPs';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getMiningInfo(req, res) {
  const rpccall = 'getMiningInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getNetworkHashPs(req, res) {
  let {blocks} = req.params;
  blocks = blocks || req.query.blocks || 120;
  let {height} = req.params;
  height = height || req.query.height || -1;

  blocks = serviceHelper.ensureNumber(blocks);
  height = serviceHelper.ensureNumber(height);

  const rpccall = 'getNetworkHashPs';
  const rpcparameters = [ blocks, height ];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getNetworkSolPs(req, res) {
  let {blocks} = req.params;
  blocks = blocks || req.query.blocks || 120;
  let {height} = req.params;
  height = height || req.query.height || -1;

  blocks = serviceHelper.ensureNumber(blocks);
  height = serviceHelper.ensureNumber(height);
  const rpccall = 'getNetworkSolPs';
  const rpcparameters = [ blocks, height ];

  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function prioritiseTransaction(req, res) {
  let {txid} = req.params;
  txid = txid || req.query.txid;
  let {prioritydelta} = req.params;
  prioritydelta = prioritydelta || req.query.prioritydelta;
  let {feedelta} = req.params;
  feedelta = feedelta || req.query.feedelta;
  const authorized = await serviceHelper.verifyPrivilege('user', req);
  if (authorized === true) {
    const rpccall = 'prioritiseTransaction';
    let rpcparameters = [];
    if (txid && prioritydelta && feedelta) {
      prioritydelta = serviceHelper.ensureNumber(prioritydelta);
      feedelta = serviceHelper.ensureNumber(feedelta);
      rpcparameters = [ txid, prioritydelta, feedelta ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function submitBlock(req, res) {
  let {hexdata} = req.params;
  hexdata = hexdata || req.query.hexdata;
  let {jsonparametersobject} = req.params;
  jsonparametersobject = jsonparametersobject || req.query.jsonparametersobject;
  const authorized = await serviceHelper.verifyPrivilege('user', req);
  if (authorized === true) {
    const rpccall = 'submitBlock';
    let rpcparameters = [];
    if (hexdata && jsonparametersobject) {
      jsonparametersobject = serviceHelper.ensureObject(jsonparametersobject);
      rpcparameters = [ hexdata, jsonparametersobject ];
    } else if (hexdata) {
      rpcparameters = [ hexdata ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function submitBlockPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {hexdata} = processedBody;
    let {jsonparametersobject} = processedBody;

    const authorized = await serviceHelper.verifyPrivilege('user', req);
    if (authorized === true) {
      const rpccall = 'submitBlock';
      let rpcparameters = [];
      if (hexdata && jsonparametersobject) {
        jsonparametersobject = serviceHelper.ensureObject(jsonparametersobject);
        rpcparameters = [ hexdata, jsonparametersobject ];
      } else if (hexdata) {
        rpcparameters = [ hexdata ];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

// == Network ==
async function addNode(req, res) {
  let {node} = req.params;
  node = node || req.query.node;
  let {command} = req.params;
  command = command || req.query.command;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'addNode';
    let rpcparameters = [];
    if (node && command) {
      rpcparameters = [ node, command ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function clearBanned(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'clearBanned';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function disconnectNode(req, res) {
  let {node} = req.params;
  node = node || req.query.node;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'disconnectNode';
    let rpcparameters = [];
    if (node) {
      rpcparameters = [ node ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getAddedNodeInfo(req, res) {
  let {dns} = req.params;
  dns = dns || req.query.dns;
  let {node} = req.params;
  node = node || req.query.node;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getAddedNodeInfo';
    const rpcparameters = [];
    if (dns) {
      dns = serviceHelper.ensureBoolean(dns);
      rpcparameters.push(dns);
      if (node) {
        rpcparameters.push(node);
      }
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getConnectionCount(req, res) {
  const rpccall = 'getConnectionCount';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getDeprecationInfo(req, res) {
  const rpccall = 'getDeprecationInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getNetTotals(req, res) {
  const rpccall = 'getNetTotals';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getNetworkInfo(req, res) {
  const rpccall = 'getNetworkInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getPeerInfo(req, res) {
  const rpccall = 'getPeerInfo';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function listBanned(req, res) {
  const rpccall = 'listBanned';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function ping(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const rpccall = 'ping';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function setBan(req, res) {
  let {ip} = req.params;
  ip = ip || req.query.ip;
  let {command} = req.params;
  command = command || req.query.command;
  let {bantime} = req.params;
  bantime = bantime || req.query.bantime;
  let {absolute} = req.params;
  absolute = absolute || req.query.absolute;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'setBan';
    const rpcparameters = [];
    if (ip && command) {
      rpcparameters.push(ip);
      rpcparameters.push(command);
      if (bantime) {
        bantime = serviceHelper.ensureNumber(bantime);
        rpcparameters.push(bantime);
        if (absolute) {
          absolute = serviceHelper.ensureBoolean(absolute);
          rpcparameters.push(absolute);
        }
      }
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == Rawtransactions ==
async function createRawTransaction(req, res) {
  let {transactions} = req.params;
  transactions = transactions || req.query.transactions;
  let {addresses} = req.params;
  addresses = addresses || req.query.addresses;
  let {locktime} = req.params;
  locktime = locktime || req.query.locktime || 0;
  const blockcount = await client.getBlockCount().catch((error) => {
    const daemonError =
        serviceHelper.createErrorMessage(error.message, error.name, error.code);
    response = daemonError;
    return res ? res.json(response) : response;
  });
  const defaultExpiryHeight = blockcount + 20;
  let {expiryheight} = req.params;
  expiryheight = expiryheight || req.query.expiryheight || defaultExpiryHeight;

  locktime = serviceHelper.ensureNumber(locktime);
  expiryheight = serviceHelper.ensureNumber(expiryheight);
  const rpccall = 'createRawTransaction';
  let rpcparameters = [];
  if (transactions && addresses) {
    transactions = serviceHelper.ensureObject(transactions);
    addresses = serviceHelper.ensureObject(addresses);
    rpcparameters = [ transactions, addresses, locktime, expiryheight ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function createRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let {transactions} = processedBody;
    let {addresses} = processedBody;
    let {locktime} = processedBody;
    locktime = locktime || 0;
    const blockcount = await client.getBlockCount().catch((error) => {
      const daemonError = serviceHelper.createErrorMessage(
          error.message, error.name, error.code);
      response = daemonError;
      return res.json(response);
    });
    const defaultExpiryHeight = blockcount + 20;
    let {expiryheight} = processedBody;
    expiryheight = expiryheight || defaultExpiryHeight;

    locktime = serviceHelper.ensureNumber(locktime);
    expiryheight = serviceHelper.ensureNumber(expiryheight);
    const rpccall = 'createRawTransaction';
    let rpcparameters = [];
    if (transactions && addresses) {
      transactions = serviceHelper.ensureObject(transactions);
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters = [ transactions, addresses, locktime, expiryheight ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function decodeRawTransaction(req, res) {
  let {hexstring} = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodeRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    rpcparameters = [ hexstring ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function decodeRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {hexstring} = processedBody;

    const rpccall = 'decodeRawTransaction';
    let rpcparameters = [];
    if (hexstring) {
      rpcparameters = [ hexstring ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function decodeScript(req, res) {
  let {hex} = req.params;
  hex = hex || req.query.hex;

  const rpccall = 'decodeScript';
  let rpcparameters = [];
  if (hex) {
    rpcparameters = [ hex ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function decodeScriptPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {hex} = processedBody;

    const rpccall = 'decodeScript';
    let rpcparameters = [];
    if (hex) {
      rpcparameters = [ hex ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function fundRawTransaction(req, res) {
  let {hexstring} = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'fundRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    rpcparameters = [ hexstring ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function fundRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {hexstring} = processedBody;

    const rpccall = 'fundRawTransaction';
    let rpcparameters = [];
    if (hexstring) {
      rpcparameters = [ hexstring ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function getRawTransaction(req, res) {
  let {txid} = req.params;
  txid = txid || req.query.txid;
  let {verbose} = req.params;
  verbose = verbose || req.query.verbose || 0;

  const rpccall = 'getRawTransaction';
  let rpcparameters = [];
  if (txid) {
    verbose = serviceHelper.ensureNumber(verbose);
    rpcparameters = [ txid, verbose ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function sendRawTransaction(req, res) {
  let {hexstring} = req.params;
  hexstring = hexstring || req.query.hexstring;
  let {allowhighfees} = req.params;
  allowhighfees = allowhighfees || req.query.allowhighfees || false;

  const rpccall = 'sendRawTransaction';
  let rpcparameters = [];
  if (hexstring) {
    allowhighfees = serviceHelper.ensureBoolean(allowhighfees);
    rpcparameters = [ hexstring, allowhighfees ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function sendRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {hexstring} = processedBody;
    let {allowhighfees} = processedBody;
    allowhighfees = allowhighfees || false;

    const rpccall = 'sendRawTransaction';
    let rpcparameters = [];
    if (hexstring) {
      allowhighfees = serviceHelper.ensureBoolean(allowhighfees);
      rpcparameters = [ hexstring, allowhighfees ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function signRawTransaction(req, res) {
  let {hexstring} = req.params;
  hexstring = hexstring || req.query.hexstring;
  let {prevtxs} = req.params;
  prevtxs = prevtxs || req.query.prevtxs;
  let {privatekeys} = req.params;
  privatekeys = privatekeys || req.query.privatekeys;
  let {sighashtype} = req.params;
  sighashtype = sighashtype || req.query.sighashtype || 'ALL';
  let {branchid} = req.params;
  branchid = branchid || req.query.branchid;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'signRawTransaction';
    const rpcparameters = [];
    if (hexstring) {
      rpcparameters.push(hexstring);
      if (prevtxs) {
        prevtxs = serviceHelper.ensureObject(prevtxs);
        rpcparameters.push(prevtxs);
        if (privatekeys) {
          privatekeys = serviceHelper.ensureObject(privatekeys);
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
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function signRawTransactionPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {hexstring} = processedBody;
    let {prevtxs} = processedBody;
    let {privatekeys} = processedBody;
    let {sighashtype} = processedBody;
    sighashtype = sighashtype || 'ALL';
    const {branchid} = processedBody;
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'signRawTransaction';
      const rpcparameters = [];
      if (hexstring) {
        rpcparameters.push(hexstring);
        if (prevtxs) {
          prevtxs = serviceHelper.ensureObject(prevtxs);
          rpcparameters.push(prevtxs);
          if (privatekeys) {
            privatekeys = serviceHelper.ensureObject(privatekeys);
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
      response = serviceHelper.errUnauthorizedMessage();
    }
    return res.json(response);
  });
}

// == Util ==
async function createMultiSig(req, res) {
  let {n} = req.params;
  n = n || req.query.n;
  let {keys} = req.params;
  keys = keys || req.query.keys;

  const rpccall = 'createMultiSig';
  let rpcparameters = [];
  if (n && keys) {
    n = serviceHelper.ensureNumber(n);
    keys = serviceHelper.ensureObject(keys);
    rpcparameters = [ n, keys ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function createMultiSigPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let {n} = processedBody;
    let {keys} = processedBody;

    const rpccall = 'createMultiSig';
    let rpcparameters = [];
    if (n && keys) {
      n = serviceHelper.ensureNumber(n);
      keys = serviceHelper.ensureObject(keys);
      rpcparameters = [ n, keys ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function estimateFee(req, res) {
  let {nblocks} = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimateFee';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = serviceHelper.ensureNumber(nblocks);
    rpcparameters = [ nblocks ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function estimatePriority(req, res) {
  let {nblocks} = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimatePriority';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = serviceHelper.ensureNumber(nblocks);
    rpcparameters = [ nblocks ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function validateAddress(req, res) {
  let {zelcashaddress} = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;

  const rpccall = 'validateAddress';
  let rpcparameters = [];
  if (zelcashaddress) {
    rpcparameters = [ zelcashaddress ];
  }
  response = await executeCall(rpccall, rpcparameters);

  if (res) {
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      delete response.data.ismine;
      delete response.data.iswatchonly;
    }
  } else {
    delete response.data.ismine;
    delete response.data.iswatchonly;
  }

  return res ? res.json(response) : response;
}

async function verifyMessage(req, res) {
  let {zelcashaddress} = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let {signature} = req.params;
  signature = signature || req.query.signature;
  let {message} = req.params;
  message = message || req.query.message;

  const rpccall = 'verifyMessage';
  let rpcparameters = [];
  if (zelcashaddress && signature && message) {
    rpcparameters = [ zelcashaddress, signature, message ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function verifyMessagePost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {zelcashaddress} = processedBody;
    const {signature} = processedBody;
    const {message} = processedBody;

    const rpccall = 'verifyMessage';
    let rpcparameters = [];
    if (zelcashaddress && signature && message) {
      rpcparameters = [ zelcashaddress, signature, message ];
    }
    response = await executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

async function zValidateAddress(req, res) {
  let {zaddr} = req.params;
  zaddr = zaddr || req.query.zaddr;

  const rpccall = 'z_validateaddress';
  let rpcparameters = [];
  if (zaddr) {
    rpcparameters = [ zaddr ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

// == Wallet == Admin Privilage. Benchmark zelteam privilage
async function addMultiSigAddress(req, res) {
  let {n} = req.params;
  n = n || req.query.n;
  let {keysobject} = req.params;
  keysobject = keysobject || req.query.keysobject;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'addMultiSigAddress';
    let rpcparameters = [];
    if (n && keysobject) {
      n = serviceHelper.ensureNumber(n);
      keysobject = serviceHelper.ensureObject(keysobject);
      rpcparameters = [ n, keysobject ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function addMultiSigAddressPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let {n} = processedBody;
    let {keysobject} = processedBody;
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'addMultiSigAddress';
      let rpcparameters = [];
      if (n && keysobject) {
        n = serviceHelper.ensureNumber(n);
        keysobject = serviceHelper.ensureObject(keysobject);
        rpcparameters = [ n, keysobject ];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function backupWallet(req, res) {
  let {destination} = req.params;
  destination = destination || req.query.destination;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'backupWallet';
    let rpcparameters = [];
    if (destination) {
      rpcparameters = [ destination ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function dumpPrivKey(req, res) {
  let {taddr} = req.params;
  taddr = taddr || req.query.taddr;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'dumpPrivKey';
    let rpcparameters = [];
    if (taddr) {
      rpcparameters = [ taddr ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getBalance(req, res) {
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getBalance';
    minconf = serviceHelper.ensureNumber(minconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpcparameters = [ '', minconf, includewatchonly ];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getNewAddress(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getNewAddress';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getRawChangeAddress(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getRawChangeAddress';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getReceivedByAddress(req, res) {
  let {zelcashaddress} = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getReceivedByAddress';
    let rpcparameters = [];
    if (zelcashaddress) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [ zelcashaddress, minconf ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getTransaction(req, res) {
  let {txid} = req.params;
  txid = txid || req.query.txid;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;

  const rpccall = 'getTransaction';
  let rpcparameters = [];
  if (txid) {
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    rpcparameters = [ txid, includewatchonly ];
  }
  response = await executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

async function getUnconfirmedBalance(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getUnconfirmedBalance';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function getWalletInfo(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getWalletInfo';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function importAddress(req, res) {
  let {address} = req.params;
  address = address || req.query.address;
  let {label} = req.params;
  label = label || req.query.label || '';
  let {rescan} = req.params;
  rescan = rescan || req.query.rescan || true;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importAddress';
    let rpcparameters = [];
    if (address) {
      rescan = serviceHelper.ensureBoolean(rescan);
      rpcparameters = [ address, label, rescan ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function importPrivKey(req, res) {
  let {zelcashprivkey} = req.params;
  zelcashprivkey = zelcashprivkey || req.query.zelcashprivkey;
  let {label} = req.params;
  label = label || req.query.label || '';
  let {rescan} = req.params;
  rescan = rescan || req.query.rescan || true;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importPrivKey';
    let rpcparameters = [];
    if (zelcashprivkey) {
      rescan = serviceHelper.ensureBoolean(rescan);
      rpcparameters = [ zelcashprivkey, label, rescan ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function importWallet(req, res) {
  let {filename} = req.params;
  filename = filename || req.query.filename;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importWallet';
    let rpcparameters = [];
    if (filename) {
      rpcparameters = [ filename ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function keyPoolRefill(req, res) {
  let {newsize} = req.params;
  newsize = newsize || req.query.newsize || 100;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'keyPoolRefill';
    newsize = serviceHelper.ensureNumber(newsize);
    const rpcparameters = [ newsize ];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function listAddressGroupings(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'listAddressGroupings';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function listLockUnspent(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'listLockUnspent';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function rescanBlockchain(req, res) {
  let {startheight} = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    startheight = serviceHelper.ensureNumber(startheight);
    const rpccall = 'rescanblockchain';
    const rpcparameters = [ startheight ];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function listReceivedByAddress(req, res) {
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {includeempty} = req.params;
  includeempty = includeempty || req.query.includeempty || false;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    includeempty = serviceHelper.ensureBoolean(includeempty);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listReceivedByAddress';
    const rpcparameters = [ minconf, includeempty, includewatchonly ];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function listSinceBlock(req, res) {
  let {blockhash} = req.params;
  blockhash = blockhash || req.query.blockhash || '';
  let {targetconfirmations} = req.params;
  targetconfirmations =
      targetconfirmations || req.query.targetconfirmations || 1;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    targetconfirmations = serviceHelper.ensureNumber(targetconfirmations);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listSinceBlock';
    const rpcparameters = [ blockhash, targetconfirmations, includewatchonly ];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function listTransactions(req, res) {
  const account = '*';
  let {count} = req.params;
  count = count || req.query.count || 10;
  let {from} = req.params;
  from = from || req.query.from || 0;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    count = serviceHelper.ensureNumber(count);
    from = serviceHelper.ensureNumber(from);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listTransactions';
    const rpcparameters = [ account, count, from, includewatchonly ];
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function listUnspent(req, res) {
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {maxconf} = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let {addresses} = req.params;
  addresses = addresses || req.query.addresses;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    maxconf = serviceHelper.ensureNumber(maxconf);
    const rpccall = 'listUnspent';
    const rpcparameters = [ minconf, maxconf ];
    if (addresses) {
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters.push(addresses);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function lockUnspent(req, res) {
  let {unlock} = req.params;
  unlock = unlock || req.query.unlock;
  let {transactions} = req.params;
  transactions = transactions || req.query.transactions;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'lockUnspent';
    let rpcparameters = [];
    if (unlock && transactions) {
      unlock = serviceHelper.ensureBoolean(unlock);
      transactions = serviceHelper.ensureObject(transactions);
      rpcparameters = [ unlock, transactions ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function sendFrom(req, res) {
  const account = '';
  let {tozelcashaddress} = req.params;
  tozelcashaddress = tozelcashaddress || req.query.tozelcashaddress;
  let {amount} = req.params;
  amount = amount || req.query.amount;
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {comment} = req.params;
  comment = comment || req.query.comment || '';
  let {commentto} = req.params;
  commentto = commentto || req.query.commentto || '';
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendFrom';
    let rpcparameters = [];
    if (tozelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters =
          [ account, tozelcashaddress, amount, minconf, comment, commentto ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function sendFromPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {tozelcashaddress} = processedBody;
    let {amount} = processedBody;
    let {minconf} = processedBody;
    let {comment} = processedBody;
    let {commentto} = processedBody;
    const account = '';
    minconf = minconf || 1;
    comment = comment || '';
    commentto = commentto || '';
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendFrom';
      let rpcparameters = [];
      if (tozelcashaddress && amount) {
        amount = serviceHelper.ensureNumber(amount);
        minconf = serviceHelper.ensureNumber(minconf);
        rpcparameters =
            [ account, tozelcashaddress, amount, minconf, comment, commentto ];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function sendMany(req, res) {
  const fromaccount = '';
  let {amounts} = req.params;
  amounts = amounts || req.query.amounts;
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {comment} = req.params;
  comment = comment || req.query.comment || '';
  let {substractfeefromamount} = req.params;
  substractfeefromamount =
      substractfeefromamount || req.query.substractfeefromamount;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendMany';
    let rpcparameters = [];
    if (amounts) {
      amounts = serviceHelper.ensureObject(amounts);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [ fromaccount, amounts, minconf, comment ];
      if (substractfeefromamount) {
        substractfeefromamount =
            serviceHelper.ensureObject(substractfeefromamount);
        rpcparameters.push(substractfeefromamount);
      }
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function sendManyPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let {amounts} = processedBody;
    let {minconf} = processedBody;
    let {comment} = processedBody;
    let {substractfeefromamount} = processedBody;
    const fromaccount = '';
    minconf = minconf || 1;
    comment = comment || '';
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendMany';
      let rpcparameters = [];
      if (amounts) {
        amounts = serviceHelper.ensureObject(amounts);
        minconf = serviceHelper.ensureNumber(minconf);
        rpcparameters = [ fromaccount, amounts, minconf, comment ];
        if (substractfeefromamount) {
          substractfeefromamount =
              serviceHelper.ensureObject(substractfeefromamount);
          rpcparameters.push(substractfeefromamount);
        }
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function sendToAddress(req, res) {
  let {zelcashaddress} = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let {amount} = req.params;
  amount = amount || req.query.amount;
  let {comment} = req.params;
  comment = comment || req.query.comment || '';
  let {commentto} = req.params;
  commentto = commentto || req.query.commentto || '';
  let {substractfeefromamount} = req.params;
  substractfeefromamount =
      substractfeefromamount || req.query.substractfeefromamount || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendToAddress';
    let rpcparameters = [];
    if (zelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      substractfeefromamount =
          serviceHelper.ensureBoolean(substractfeefromamount);
      rpcparameters = [
        zelcashaddress, amount, comment, commentto, substractfeefromamount
      ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function sendToAddressPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {zelcashaddress} = processedBody;
    let {amount} = processedBody;
    let {comment} = processedBody;
    let {commentto} = processedBody;
    let {substractfeefromamount} = processedBody;
    comment = comment || '';
    commentto = commentto || '';
    substractfeefromamount = substractfeefromamount || false;
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendToAddress';
      let rpcparameters = [];
      if (zelcashaddress && amount) {
        amount = serviceHelper.ensureNumber(amount);
        substractfeefromamount =
            serviceHelper.ensureBoolean(substractfeefromamount);
        rpcparameters = [
          zelcashaddress, amount, comment, commentto, substractfeefromamount
        ];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function setTxFee(req, res) {
  let {amount} = req.params;
  amount = amount || req.query.amount;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'setTxFee';
    let rpcparameters = [];
    if (amount) {
      amount = serviceHelper.ensureNumber(amount);
      rpcparameters = [ amount ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function signMessage(req, res) {
  let {taddr} = req.params;
  taddr = taddr || req.query.taddr;
  let {message} = req.params;
  message = message || req.query.message;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'signMessage';
    let rpcparameters = [];
    if (taddr && message) {
      rpcparameters = [ taddr, message ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function signMessagePost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {taddr} = processedBody;
    const {message} = processedBody;

    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'signMessage';
      let rpcparameters = [];
      if (taddr && message) {
        rpcparameters = [ taddr, message ];
      }

      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function zExportKey(req, res) {
  let {zaddr} = req.params;
  zaddr = zaddr || req.query.zaddr;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_exportkey';
    let rpcparameters = [];
    if (zaddr) {
      rpcparameters = [ zaddr ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zExportViewingKey(req, res) {
  let {zaddr} = req.params;
  zaddr = zaddr || req.query.zaddr;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_exportviewingkey';
    let rpcparameters = [];
    if (zaddr) {
      rpcparameters = [ zaddr ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zGetBalance(req, res) {
  let {address} = req.params;
  address = address || req.query.address;
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getbalance';
    let rpcparameters = [];
    if (address) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [ address, minconf ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zGetMigrationStatus(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getmigrationstatus';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zGetNewAddress(req, res) {
  let {type} = req.params;
  type = type || req.query.type || 'sapling';
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getnewaddress';
    const rpcparameters = [ type ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zGetOperationResult(req, res) {
  let {operationid} = req.params;
  operationid = operationid || req.query.operationid || [];
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    operationid = serviceHelper.ensureObject(operationid);
    const rpccall = 'z_getoperationresult';
    const rpcparameters = [ operationid ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zGetOperationStatus(req, res) {
  let {operationid} = req.params;
  operationid = operationid || req.query.operationid || [];
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    operationid = serviceHelper.ensureObject(operationid);
    const rpccall = 'z_getoperationstatus';
    const rpcparameters = [ operationid ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zGetTotalBalance(req, res) {
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'z_gettotalbalance';
    const rpcparameters = [ minconf, includewatchonly ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zImportKey(req, res) {
  let {zkey} = req.params;
  zkey = zkey || req.query.zkey;
  let {rescan} = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let {startheight} = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importkey';
    let rpcparameters = [];
    if (zkey) {
      startheight = serviceHelper.ensureNumber(startheight);
      rpcparameters = [ zkey, rescan, startheight ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zImportViewingKey(req, res) {
  let {vkey} = req.params;
  vkey = vkey || req.query.vkey;
  let {rescan} = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let {startheight} = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importviewingkey';
    let rpcparameters = [];
    if (vkey) {
      startheight = serviceHelper.ensureNumber(startheight);
      rpcparameters = [ vkey, rescan, startheight ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zImportWallet(req, res) {
  let {filename} = req.params;
  filename = filename || req.query.filename;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importwallet';
    let rpcparameters = [];
    if (filename) {
      rpcparameters = [ filename ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zListAddresses(req, res) {
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'z_listaddresses';
    const rpcparameters = [ includewatchonly ];

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zListOperationIds(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listoperationids';

    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zListReceivedByAddress(req, res) {
  let {address} = req.params;
  address = address || req.query.address;
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listreceivedbyaddress';
    let rpcparameters = [];
    if (address) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [ address, minconf ];
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zListUnspent(req, res) {
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {maxconf} = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let {includewatchonly} = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  let {addresses} = req.params;
  addresses = addresses || req.query.addresses;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listunspent';
    minconf = serviceHelper.ensureNumber(minconf);
    maxconf = serviceHelper.ensureNumber(maxconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpcparameters = [ minconf, maxconf, includewatchonly ];
    if (addresses) {
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters.push(addresses);
    }

    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zMergeToAddress(req, res) {
  let {fromaddresses} = req.params;
  fromaddresses = fromaddresses || req.query.fromaddresses;
  let {toaddress} = req.params;
  toaddress = toaddress || req.query.toaddress;
  let {fee} = req.params;
  fee = fee || req.query.fee || 0.0001;
  let {transparentlimit} = req.params;
  transparentlimit = transparentlimit || req.query.transparentlimit ||
                     50; // 0 for as many as can fit
  let {shieldedlimit} = req.params;
  shieldedlimit = shieldedlimit || req.query.shieldedlimit ||
                  20; // 0 for as many as can fit
  let {memo} = req.params;
  memo = memo || req.query.memo || '';
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_mergetoaddress';
    let rpcparameters = [];
    if (fromaddresses && toaddress) {
      fromaddresses = serviceHelper.ensureObject(fromaddresses);
      fee = serviceHelper.ensureNumber(fee);
      transparentlimit = serviceHelper.ensureNumber(transparentlimit);
      shieldedlimit = serviceHelper.ensureNumber(shieldedlimit);
      rpcparameters = [
        fromaddresses, toaddress, fee, transparentlimit, shieldedlimit, memo
      ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zSendMany(req, res) {
  let {fromaddress} = req.params;
  fromaddress = fromaddress || req.query.fromaddress;
  let {amounts} = req.params;
  amounts = amounts || req.query.amounts;
  let {minconf} = req.params;
  minconf = minconf || req.query.minconf || 1;
  let {fee} = req.params;
  fee = fee || req.query.fee || 0.0001;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_sendmany';
    let rpcparameters = [];
    if (fromaddress && amounts) {
      amounts = serviceHelper.ensureObject(amounts);
      minconf = serviceHelper.ensureNumber(minconf);
      fee = serviceHelper.ensureNumber(fee);
      rpcparameters = [ fromaddress, amounts, minconf, fee ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zSendManyPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {fromaddress} = processedBody;
    let {amounts} = processedBody;
    let {minconf} = processedBody;
    let {fee} = processedBody;
    minconf = minconf || 1;
    fee = fee || 0.0001;
    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'z_sendmany';
      let rpcparameters = [];
      if (fromaddress && amounts) {
        amounts = serviceHelper.ensureObject(amounts);
        minconf = serviceHelper.ensureNumber(minconf);
        fee = serviceHelper.ensureNumber(fee);
        rpcparameters = [ fromaddress, amounts, minconf, fee ];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function zSetMigration(req, res) {
  let {enabled} = req.params;
  enabled = enabled || req.query.enabled;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_setmigration';
    let rpcparameters = [];
    if (enabled) {
      enabled = serviceHelper.ensureBoolean(enabled);
      rpcparameters = [ enabled ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zShieldCoinBase(req, res) {
  let {fromaddress} = req.params;
  fromaddress = fromaddress || req.query.fromaddress; // '*' for all
  let {toaddress} = req.params;
  toaddress = toaddress || req.query.toaddress;
  let {fee} = req.params;
  fee = fee || req.query.fee || 0.0001;
  let {limit} = req.params;
  limit = limit || req.query.limit || 50; // 0 for as many as can fit
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_shieldcoinbase';
    let rpcparameters = [];
    if (fromaddress && toaddress) {
      fee = serviceHelper.ensureNumber(fee);
      limit = serviceHelper.ensureNumber(limit);
      rpcparameters = [ fromaddress, toaddress, fee, limit ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zcBenchmark(req, res) {
  let {benchmarktype} = req.params;
  benchmarktype = benchmarktype || req.query.benchmarktype;
  let {samplecount} = req.params;
  samplecount = samplecount || req.query.samplecount;
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const rpccall = 'zcbenchmark';
    let rpcparameters = [];
    if (benchmarktype && samplecount) {
      samplecount = serviceHelper.ensureNumber(samplecount);
      rpcparameters = [ benchmarktype, samplecount ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zcRawJoinSplit(req, res) {
  let {rawtx} = req.params;
  rawtx = rawtx || req.query.rawtx;
  let {inputs} = req.params;
  inputs = inputs || req.query.inputs;
  let {outputs} = req.params;
  outputs = outputs || req.query.outputs;
  let {vpubold} = req.params;
  vpubold = vpubold || req.query.vpubold;
  let {vpubnew} = req.params;
  vpubnew = vpubnew || req.query.vpubnew;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawjoinsplit';
    let rpcparameters = [];
    if (rawtx && inputs && outputs && vpubold && vpubnew) {
      inputs = serviceHelper.ensureObject(inputs);
      outputs = serviceHelper.ensureObject(outputs);
      rpcparameters = [ rawtx, inputs, outputs, vpubold, vpubnew ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zcRawJoinSplitPost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {rawtx} = processedBody;
    let {inputs} = processedBody;
    let {outputs} = processedBody;
    const {vpubold} = processedBody;
    const {vpubnew} = processedBody;

    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'zcrawjoinsplit';
      let rpcparameters = [];
      if (rawtx && inputs && outputs && vpubold && vpubnew) {
        inputs = serviceHelper.ensureObject(inputs);
        outputs = serviceHelper.ensureObject(outputs);
        rpcparameters = [ rawtx, inputs, outputs, vpubold, vpubnew ];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function zcRawKeygen(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawkeygen';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zcRawReceive(req, res) {
  let {zcsecretkey} = req.params;
  zcsecretkey = zcsecretkey || req.query.zcsecretkey;
  let {encryptednote} = req.params;
  encryptednote = encryptednote || req.query.encryptednote;
  const authorized = await serviceHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawreceive';
    let rpcparameters = [];
    if (zcsecretkey && encryptednote) {
      rpcparameters = [ zcsecretkey, encryptednote ];
    }
    response = await executeCall(rpccall, rpcparameters);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function zcRawReceivePost(req, res) {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {zcsecretkey} = processedBody;
    const {encryptednote} = processedBody;

    const authorized = await serviceHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'zcrawreceive';
      let rpcparameters = [];
      if (zcsecretkey && encryptednote) {
        rpcparameters = [ zcsecretkey, encryptednote ];
      }
      response = await executeCall(rpccall, rpcparameters);
    } else {
      response = serviceHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

async function zcSampleJoinSplit(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const rpccall = 'zcsamplejoinsplit';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// Benchmarks
async function getBenchmarks(req, res) {
  const rpccall = 'getbenchmarks';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function getBenchStatus(req, res) {
  const rpccall = 'getbenchstatus';

  response = await executeCall(rpccall);

  return res ? res.json(response) : response;
}

async function startZelBenchD(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const rpccall = 'startzelbenchd';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

async function stopZelBenchD(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const rpccall = 'stopzelbenchd';
    response = await executeCall(rpccall);
  } else {
    response = serviceHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

module.exports = {
  getConfigValue,
  // == Control ==
  help,
  getInfo,
  stop,

  // == Zelnode ==
  createZelNodeBroadcast,
  createZelNodeKey,
  decodeZelNodeBroadcast,
  getZelNodeCount,
  getZelNodeOutputs,
  getZelNodeScores,
  getZelNodeStatus,
  getZelNodeWinners,
  listZelNodeConf,
  listZelNodes,
  relayZelNodeBroadcast,
  spork,
  startDeterministicZelNode,
  startZelNode,
  viewDeterministicZelNodeList,
  zelNodeCurrentWinner,
  zelNodeDebug,
  znsync,
  getDOSList,
  getStartList,

  // == Blockchain ==
  getBestBlockHash,
  getBlock,
  getBlockchainInfo,
  getBlockCount,
  getBlockHash,
  // getBlockHashes, // intentionally left out as of experimental feataure
  getBlockHeader,
  getChainTips,
  getDifficulty,
  getMempoolInfo,
  getRawMemPool,
  // getSpentInfo, // intentionally left out as of experimental feature
  getTxOut,
  getTxOutProof,
  getTxOutSetInfo,
  verifyChain,
  verifyTxOutProof,

  // == AddressIndex ==
  // intentianlly left out as requires addressindex
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
  submitBlockPost,

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
  createRawTransactionPost,
  decodeRawTransaction,
  decodeRawTransactionPost,
  decodeScript,
  decodeScriptPost,
  fundRawTransaction,
  fundRawTransactionPost,
  getRawTransaction,
  sendRawTransaction,
  sendRawTransactionPost,
  signRawTransaction,
  signRawTransactionPost,

  // == Util ==
  createMultiSig,
  createMultiSigPost,
  estimateFee,
  estimatePriority,
  validateAddress,
  verifyMessage,
  verifyMessagePost,
  zValidateAddress,

  // == Wallet ==
  addMultiSigAddress,
  addMultiSigAddressPost,
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
  sendFrom,     // == available but DEPRECATED ==
  sendFromPost, // == available but DEPRECATED ==
  sendMany,
  sendManyPost,
  sendToAddress,
  sendToAddressPost,
  // setAccount, // == not available - DEPRECATED ==
  setTxFee,
  signMessage,
  signMessagePost,
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
  zSendManyPost,
  zSetMigration,
  zShieldCoinBase,
  zcBenchmark,
  zcRawJoinSplit,     // == available but DEPRECATED ==
  zcRawJoinSplitPost, // == available but DEPRECATED ==
  zcRawKeygen,        // == available but DEPRECATED ==
  zcRawReceive,       // == available but DEPRECATED ==
  zcRawReceivePost,   // == available but DEPRECATED ==
  zcSampleJoinSplit,

  // == Benchmarks ==
  getBenchmarks,
  getBenchStatus,
  startZelBenchD,
  stopZelBenchD,
};
