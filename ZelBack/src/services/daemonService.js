const fullnode = require('fullnode');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('./daemonServiceBlockchainRpcs');

const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fnconfig = new fullnode.Config();
const isTestnet = userconfig.initial.testnet;

let currentDaemonHeight = 0;
let currentDaemonHeader = isTestnet === true ? 249187 : 1102828;
let isDaemonInsightExplorer = null;

let response = messageHelper.createErrorMessage();

/**
 * To get a value for a specified key from the configuration file.
 * @param {string} parameter Config key.
 * @returns {string} Config value.
 */
function getConfigValue(parameter) {
  const value = fnconfig.get(parameter);
  return value;
}

/**
 * To check if Insight Explorer is activated in the daemon configuration file.
 * @returns {boolean} True if the daemon is configured with Insight Explorer on.
 */
function isInsightExplorer() {
  if (isDaemonInsightExplorer != null) {
    return isDaemonInsightExplorer;
  }
  const insightValue = getConfigValue('insightexplorer');
  if (insightValue === 1 || insightValue === '1') {
    isDaemonInsightExplorer = true;
    return true;
  }
  isDaemonInsightExplorer = false;
  return false;
}

// == Control ==
/**
 * To request help message. Command required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function help(req, res) {
  let { command } = req.params; // we accept both help/command and help?command=getinfo
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [command];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get info on daemon version and RPC port. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getInfo(req, res) {
  const rpccall = 'getInfo';

  response = await daemonServiceUtils.executeCall(rpccall);
  if (res) {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      delete response.data.balance;
    }
  } else {
    delete response.data.balance;
  }

  return res ? res.json(response) : response;
}

/**
 * To stop node daemon. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stop(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'stop';

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == Zelnode ==
/**
 * To get node status.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeStatus(req, res) {
  const rpccall = 'getzelnodestatus';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To list nodes. Optional filter can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listZelNodes(req, res) {
  let { filter } = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'listzelnodes';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To list node configuration. Optional filter can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listZelNodeConf(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  let { filter } = req.params;
  filter = filter || req.query.filter;
  if (authorized === true) {
    const rpccall = 'listzelnodeconf';
    const rpcparameters = [];
    if (filter) {
      rpcparameters.push(filter);
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To create node key. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createZelNodeKey(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodekey';

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get node sync status. Mode (defaults to status) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function znsync(req, res) {
  let { mode } = req.params; // we accept both znsync/status and znsync?mode=status
  mode = mode || req.query.mode || 'status'; // default to status
  if (mode === 'status') {
    const rpccall = 'znsync';
    const rpcparameters = [mode];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'znsync';
      const rpcparameters = [mode];

      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }
  }
  return res ? res.json(response) : response;
}

/**
 * To create node broadcast. Command and alias required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createZelNodeBroadcast(req, res) {
  let { command } = req.params;
  command = command || req.query.command || '';
  let { alias } = req.params;
  alias = alias || req.query.alias || '';

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'createzelnodebroadcast';
    const rpcparameters = [command, alias];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To decode node broadcast. Optional hex string can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function decodeZelNodeBroadcast(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'decodezelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get node count.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeCount(req, res) {
  const rpccall = 'getzelnodecount';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get DOS list.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getDOSList(req, res) {
  const rpccall = 'getdoslist';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get start list.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getStartList(req, res) {
  const rpccall = 'getstartlist';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get node outputs. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeOutputs(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getzelnodeoutputs';

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get node scores. Optional number of blocks can be included as a parameter for RPC call. Otherwise defaults to 10 blocks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getZelNodeScores(req, res) {
  let { blocks } = req.params;
  blocks = blocks || req.query.blocks || '10';

  const rpccall = 'getzelnodescores';
  const rpcparameters = [];
  rpcparameters.push(blocks);

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get node winnners. Optional filter can be included as a parameter for RPC call. Optional number of blocks can be included as a parameter for RPC call. Otherwise defaults to 10 blocks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To relay node broadcast. Optional hex string can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function relayZelNodeBroadcast(req, res) {
  let { hexstring } = req.params;
  hexstring = hexstring || req.query.hexstring;

  const rpccall = 'relayzelnodebroadcast';
  const rpcparameters = [];
  if (hexstring) {
    rpcparameters.push(hexstring);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To show spork. Optional value can be included as a parameter for RPC call. Optional name can be included as a parameter for RPC call. Otherwise defaults to show.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function spork(req, res) {
  let { name } = req.params;
  name = name || req.query.name || 'show'; // name, show, active
  let { value } = req.params;
  value = value || req.query.value;

  const rpccall = 'spork';
  const rpcparameters = [];
  rpcparameters.push(name);
  if (value) {
    value = serviceHelper.ensureNumber(value);
    rpcparameters.push(value);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To start deterministic node. Alias required as a parameter for RPC call if not already specified. Optional lock wallet configuration can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startDeterministicZelNode(req, res) {
  let { alias } = req.params;
  alias = alias || req.query.alias;
  let { lockwallet } = req.params;
  lockwallet = lockwallet || req.query.lockwallet || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startdeterministiczelnode';
    const rpcparameters = [];
    rpcparameters.push(alias);
    if (lockwallet) {
      lockwallet = serviceHelper.ensureBoolean(lockwallet);
      rpcparameters.push(lockwallet);
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To start node. Set and lock wallet configurations required as parameters for RPC call if not already specified. Optional alias can be included as a parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startZelNode(req, res) {
  let { set } = req.params;
  set = set || req.query.set;
  let { lockwallet } = req.params;
  lockwallet = lockwallet || req.query.lockwallet;
  let { alias } = req.params;
  alias = alias || req.query.alias;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'startzelnode';
    const rpcparameters = [];
    rpcparameters.push(set);
    rpcparameters.push(lockwallet);
    if (alias) {
      rpcparameters.push(alias);
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To view list of deterministic nodes. Optional filter can be included as a parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function viewDeterministicZelNodeList(req, res) {
  let { filter } = req.params;
  filter = filter || req.query.filter;
  const rpccall = 'viewdeterministiczelnodelist';
  const rpcparameters = [];
  if (filter) {
    rpcparameters.push(filter);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To show current node winner.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zelNodeCurrentWinner(req, res) {
  const rpccall = 'zelnodecurrentwinner';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To debug node.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zelNodeDebug(req, res) {
  const rpccall = 'zelnodedebug';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

// == Blockchain ==

// == Util ==
/**
 * To create a multi-signature scheme (to require multiple keys to authorize a transaction). Number of signatures and keys object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createMultiSig(req, res) {
  let { n } = req.params;
  n = n || req.query.n;
  let { keys } = req.params;
  keys = keys || req.query.keys;

  const rpccall = 'createMultiSig';
  let rpcparameters = [];
  if (n && keys) {
    n = serviceHelper.ensureNumber(n);
    keys = serviceHelper.ensureObject(keys);
    rpcparameters = [n, keys];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To create a multi-signature scheme (to require multiple keys to authorize a transaction) after data is processed. Number of signatures and keys object required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createMultiSigPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { n } = processedBody;
    let { keys } = processedBody;

    const rpccall = 'createMultiSig';
    let rpcparameters = [];
    if (n && keys) {
      n = serviceHelper.ensureNumber(n);
      keys = serviceHelper.ensureObject(keys);
      rpcparameters = [n, keys];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To estimate a transaction fee. Number of blocks required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function estimateFee(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimateFee';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = serviceHelper.ensureNumber(nblocks);
    rpcparameters = [nblocks];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To estimate transaction priority. Number of blocks required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function estimatePriority(req, res) {
  let { nblocks } = req.params;
  nblocks = nblocks || req.query.nblocks;

  const rpccall = 'estimatePriority';
  let rpcparameters = [];
  if (nblocks) {
    nblocks = serviceHelper.ensureNumber(nblocks);
    rpcparameters = [nblocks];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To validate an address. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function validateAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;

  const rpccall = 'validateAddress';
  let rpcparameters = [];
  if (zelcashaddress) {
    rpcparameters = [zelcashaddress];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  if (res) {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
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

/**
 * To verify a message. Address, signature and message required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To verify a message after data is processed. Address, signature and message required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function verifyMessagePost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { zelcashaddress } = processedBody;
    const { signature } = processedBody;
    const { message } = processedBody;

    const rpccall = 'verifyMessage';
    let rpcparameters = [];
    if (zelcashaddress && signature && message) {
      rpcparameters = [zelcashaddress, signature, message];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To validate a Z address. Z address required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zValidateAddress(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;

  const rpccall = 'z_validateaddress';
  let rpcparameters = [];
  if (zaddr) {
    rpcparameters = [zaddr];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

// == Wallet == Admin Privilage. Benchmark fluxteam privilage
/**
 * To add a multi-signature address (requires multiple keys to authorize a transaction). Number of addresses/keys and keys object required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addMultiSigAddress(req, res) {
  let { n } = req.params;
  n = n || req.query.n;
  let { keysobject } = req.params;
  keysobject = keysobject || req.query.keysobject;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'addMultiSigAddress';
    let rpcparameters = [];
    if (n && keysobject) {
      n = serviceHelper.ensureNumber(n);
      keysobject = serviceHelper.ensureObject(keysobject);
      rpcparameters = [n, keysobject];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To add a multi-signature address (requires multiple keys to authorize a transaction) after data is processed. Number of addresses/keys and keys object required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addMultiSigAddressPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { n } = processedBody;
    let { keysobject } = processedBody;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'addMultiSigAddress';
      let rpcparameters = [];
      if (n && keysobject) {
        n = serviceHelper.ensureNumber(n);
        keysobject = serviceHelper.ensureObject(keysobject);
        rpcparameters = [n, keysobject];
      }
      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To backup wallet. Backup destination/directory required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function backupWallet(req, res) {
  let { destination } = req.params;
  destination = destination || req.query.destination;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'backupWallet';
    let rpcparameters = [];
    if (destination) {
      rpcparameters = [destination];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To dump private key. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function dumpPrivKey(req, res) {
  let { taddr } = req.params;
  taddr = taddr || req.query.taddr;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'dumpPrivKey';
    let rpcparameters = [];
    if (taddr) {
      rpcparameters = [taddr];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get balance. Min conf (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBalance(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getBalance';
    minconf = serviceHelper.ensureNumber(minconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpcparameters = ['', minconf, includewatchonly];
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get a new address. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getNewAddress(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getNewAddress';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get raw change address. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getRawChangeAddress(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getRawChangeAddress';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get received by address. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getReceivedByAddress(req, res) {
  let { zelcashaddress } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getReceivedByAddress';
    let rpcparameters = [];
    if (zelcashaddress) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [zelcashaddress, minconf];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get a transaction. Transaction ID and whether to include watch only (defaults to false) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTransaction(req, res) {
  let { txid } = req.params;
  txid = txid || req.query.txid;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;

  const rpccall = 'getTransaction';
  let rpcparameters = [];
  if (txid) {
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    rpcparameters = [txid, includewatchonly];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get unconfirmed balance. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getUnconfirmedBalance(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getUnconfirmedBalance';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get wallet info. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getWalletInfo(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'getWalletInfo';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import address. Address, label and whether to rescan (defaults to true) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importAddress(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { label } = req.params;
  label = label || req.query.label || '';
  let { rescan } = req.params;
  rescan = rescan == null ? req.query.rescan : rescan;
  rescan = rescan == null ? true : rescan;

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importAddress';
    let rpcparameters = [];
    if (address) {
      rescan = serviceHelper.ensureBoolean(rescan);
      rpcparameters = [address, label, rescan];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import private key. Private key, label and whether to rescan (defaults to true) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importPrivKey(req, res) {
  let { zelcashprivkey } = req.params;
  zelcashprivkey = zelcashprivkey || req.query.zelcashprivkey;
  let { label } = req.params;
  label = label || req.query.label || '';
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || true;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importPrivKey';
    let rpcparameters = [];
    if (zelcashprivkey) {
      rescan = serviceHelper.ensureBoolean(rescan);
      rpcparameters = [zelcashprivkey, label, rescan];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import wallet. File name required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'importWallet';
    let rpcparameters = [];
    if (filename) {
      rpcparameters = [filename];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To refill key pool. New size (defaults to value of 100) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function keyPoolRefill(req, res) {
  let { newsize } = req.params;
  newsize = newsize || req.query.newsize || 100;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'keyPoolRefill';
    newsize = serviceHelper.ensureNumber(newsize);
    const rpcparameters = [newsize];
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list address groupings. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listAddressGroupings(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'listAddressGroupings';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list lock unspent. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listLockUnspent(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'listLockUnspent';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To rescan the blockchain. Start height (defaults to value of 0) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function rescanBlockchain(req, res) {
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    startheight = serviceHelper.ensureNumber(startheight);
    const rpccall = 'rescanblockchain';
    const rpcparameters = [startheight];
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list received transactions by address. Min conf (defaults to value of 1), whether to include empty (defaults to false) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listReceivedByAddress(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includeempty } = req.params;
  includeempty = includeempty || req.query.includeempty || false;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    includeempty = serviceHelper.ensureBoolean(includeempty);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listReceivedByAddress';
    const rpcparameters = [minconf, includeempty, includewatchonly];
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list since a specified block. Block hash, target confirmations (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listSinceBlock(req, res) {
  let { blockhash } = req.params;
  blockhash = blockhash || req.query.blockhash || '';
  let { targetconfirmations } = req.params;
  targetconfirmations = targetconfirmations || req.query.targetconfirmations || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    targetconfirmations = serviceHelper.ensureNumber(targetconfirmations);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listSinceBlock';
    const rpcparameters = [blockhash, targetconfirmations, includewatchonly];
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list transactions. Account, count (defaults to value of 10), from (defaults to value of 0) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listTransactions(req, res) {
  const account = '*';
  let { count } = req.params;
  count = count || req.query.count || 10;
  let { from } = req.params;
  from = from || req.query.from || 0;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    count = serviceHelper.ensureNumber(count);
    from = serviceHelper.ensureNumber(from);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'listTransactions';
    const rpcparameters = [account, count, from, includewatchonly];
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list unspent. Min conf (defaults to value of 1), max conf (defaults to value of 9999999) and address required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listUnspent(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { maxconf } = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    maxconf = serviceHelper.ensureNumber(maxconf);
    const rpccall = 'listUnspent';
    const rpcparameters = [minconf, maxconf];
    if (addresses) {
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters.push(addresses);
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To lock unspent. Whether unlocked and transactions required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function lockUnspent(req, res) {
  let { unlock } = req.params;
  unlock = unlock || req.query.unlock;
  let { transactions } = req.params;
  transactions = transactions || req.query.transactions;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'lockUnspent';
    let rpcparameters = [];
    if (unlock && transactions) {
      unlock = serviceHelper.ensureBoolean(unlock);
      transactions = serviceHelper.ensureObject(transactions);
      rpcparameters = [unlock, transactions];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send transaction from address. Sender account, recipient address, amount, min conf (defaults to value of 1), comment and comment for recipient required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendFrom';
    let rpcparameters = [];
    if (tozelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send transaction from address after data is processed. Sender account, recipient address, amount, min conf (defaults to value of 1), comment and comment for recipient required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendFromPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { tozelcashaddress } = processedBody;
    let { amount } = processedBody;
    let { minconf } = processedBody;
    let { comment } = processedBody;
    let { commentto } = processedBody;
    const account = '';
    minconf = minconf || 1;
    comment = comment || '';
    commentto = commentto || '';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendFrom';
      let rpcparameters = [];
      if (tozelcashaddress && amount) {
        amount = serviceHelper.ensureNumber(amount);
        minconf = serviceHelper.ensureNumber(minconf);
        rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
      }

      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To send multiple transactions. Sender account, amounts, min conf (defaults to value of 1), comment and fee to substract from amount required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendMany';
    let rpcparameters = [];
    if (amounts) {
      amounts = serviceHelper.ensureObject(amounts);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [fromaccount, amounts, minconf, comment];
      if (substractfeefromamount) {
        substractfeefromamount = serviceHelper.ensureObject(substractfeefromamount);
        rpcparameters.push(substractfeefromamount);
      }
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send multiple transactions after data is processed. Sender account, amounts, min conf (defaults to value of 1), comment and fee to substract from amount required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendManyPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    let { amounts } = processedBody;
    let { minconf } = processedBody;
    let { comment } = processedBody;
    let { substractfeefromamount } = processedBody;
    const fromaccount = '';
    minconf = minconf || 1;
    comment = comment || '';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendMany';
      let rpcparameters = [];
      if (amounts) {
        amounts = serviceHelper.ensureObject(amounts);
        minconf = serviceHelper.ensureNumber(minconf);
        rpcparameters = [fromaccount, amounts, minconf, comment];
        if (substractfeefromamount) {
          substractfeefromamount = serviceHelper.ensureObject(substractfeefromamount);
          rpcparameters.push(substractfeefromamount);
        }
      }

      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To send transaction to address. Recipient address, amount, comment, comment for recipient and fee to substract from amount (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'sendToAddress';
    let rpcparameters = [];
    if (zelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      substractfeefromamount = serviceHelper.ensureBoolean(substractfeefromamount);
      rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send transaction to address after data is processed. Recipient address, amount, comment, comment for recipient and fee to substract from amount (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function sendToAddressPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { zelcashaddress } = processedBody;
    let { amount } = processedBody;
    let { comment } = processedBody;
    let { commentto } = processedBody;
    let { substractfeefromamount } = processedBody;
    comment = comment || '';
    commentto = commentto || '';
    substractfeefromamount = substractfeefromamount || false;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'sendToAddress';
      let rpcparameters = [];
      if (zelcashaddress && amount) {
        amount = serviceHelper.ensureNumber(amount);
        substractfeefromamount = serviceHelper.ensureBoolean(substractfeefromamount);
        rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
      }

      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To set transaction fee. Amount required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function setTxFee(req, res) {
  let { amount } = req.params;
  amount = amount || req.query.amount;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'setTxFee';
    let rpcparameters = [];
    if (amount) {
      amount = serviceHelper.ensureNumber(amount);
      rpcparameters = [amount];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To sign message. Address and message required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signMessage(req, res) {
  let { taddr } = req.params;
  taddr = taddr || req.query.taddr;
  let { message } = req.params;
  message = message || req.query.message;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'signMessage';
    let rpcparameters = [];
    if (taddr && message) {
      rpcparameters = [taddr, message];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To sign message after data is processed. Address and message required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signMessagePost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { taddr } = processedBody;
    const { message } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'signMessage';
      let rpcparameters = [];
      if (taddr && message) {
        rpcparameters = [taddr, message];
      }

      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To export key. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zExportKey(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_exportkey';
    let rpcparameters = [];
    if (zaddr) {
      rpcparameters = [zaddr];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To export viewing key. Address required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zExportViewingKey(req, res) {
  let { zaddr } = req.params;
  zaddr = zaddr || req.query.zaddr;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_exportviewingkey';
    let rpcparameters = [];
    if (zaddr) {
      rpcparameters = [zaddr];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get account balance. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetBalance(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getbalance';
    let rpcparameters = [];
    if (address) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [address, minconf];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get migration status. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetMigrationStatus(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getmigrationstatus';

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get new address. Type (defaults to sapling) required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetNewAddress(req, res) {
  let { type } = req.params;
  type = type || req.query.type || 'sapling';
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_getnewaddress';
    const rpcparameters = [type];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get operation result. Operation ID required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetOperationResult(req, res) {
  let { operationid } = req.params;
  operationid = operationid || req.query.operationid || [];
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    operationid = serviceHelper.ensureObject(operationid);
    const rpccall = 'z_getoperationresult';
    const rpcparameters = [operationid];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get operation status. Operation ID required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetOperationStatus(req, res) {
  let { operationid } = req.params;
  operationid = operationid || req.query.operationid || [];
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    operationid = serviceHelper.ensureObject(operationid);
    const rpccall = 'z_getoperationstatus';
    const rpcparameters = [operationid];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To get total balance. Min conf (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetTotalBalance(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    minconf = serviceHelper.ensureNumber(minconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'z_gettotalbalance';
    const rpcparameters = [minconf, includewatchonly];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import key. Key, rescan configuration (defaults to when key is new) and start height (defaults to value of 0) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportKey(req, res) {
  let { zkey } = req.params;
  zkey = zkey || req.query.zkey;
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importkey';
    let rpcparameters = [];
    if (zkey) {
      startheight = serviceHelper.ensureNumber(startheight);
      rpcparameters = [zkey, rescan, startheight];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import viewing key. Viewing key, rescan configuration (defaults to when key is new) and start height (defaults to value of 0) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportViewingKey(req, res) {
  let { vkey } = req.params;
  vkey = vkey || req.query.vkey;
  let { rescan } = req.params;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  let { startheight } = req.params;
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importviewingkey';
    let rpcparameters = [];
    if (vkey) {
      startheight = serviceHelper.ensureNumber(startheight);
      rpcparameters = [vkey, rescan, startheight];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To import wallet. File name required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_importwallet';
    let rpcparameters = [];
    if (filename) {
      rpcparameters = [filename];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list addresses. Whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListAddresses(req, res) {
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpccall = 'z_listaddresses';
    const rpcparameters = [includewatchonly];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list Operation IDs. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListOperationIds(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listoperationids';

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list received by address. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListReceivedByAddress(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listreceivedbyaddress';
    let rpcparameters = [];
    if (address) {
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [address, minconf];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To list unspent. Min conf (defaults to value of 1), max conf (defaults to value of 9999999), whether to include watch only (defaults to false) and addresses required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListUnspent(req, res) {
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { maxconf } = req.params;
  maxconf = maxconf || req.query.maxconf || 9999999;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly || req.query.includewatchonly || false;
  let { addresses } = req.params;
  addresses = addresses || req.query.addresses;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_listunspent';
    minconf = serviceHelper.ensureNumber(minconf);
    maxconf = serviceHelper.ensureNumber(maxconf);
    includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
    const rpcparameters = [minconf, maxconf, includewatchonly];
    if (addresses) {
      addresses = serviceHelper.ensureObject(addresses);
      rpcparameters.push(addresses);
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To merge to address. Sender address, recipient address, fee (defaults to a value of 0.0001), transparent limit (defaults to a value of 50), shielded limit (defaults to a value of 20) and memo required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_mergetoaddress';
    let rpcparameters = [];
    if (fromaddresses && toaddress) {
      fromaddresses = serviceHelper.ensureObject(fromaddresses);
      fee = serviceHelper.ensureNumber(fee);
      transparentlimit = serviceHelper.ensureNumber(transparentlimit);
      shieldedlimit = serviceHelper.ensureNumber(shieldedlimit);
      rpcparameters = [fromaddresses, toaddress, fee, transparentlimit, shieldedlimit, memo];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send multiple transactions. Sender account, amounts, min conf (defaults to value of 1) and fee (defaults to a value of 0.0001) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zSendMany(req, res) {
  let { fromaddress } = req.params;
  fromaddress = fromaddress || req.query.fromaddress;
  let { amounts } = req.params;
  amounts = amounts || req.query.amounts;
  let { minconf } = req.params;
  minconf = minconf || req.query.minconf || 1;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_sendmany';
    let rpcparameters = [];
    if (fromaddress && amounts) {
      amounts = serviceHelper.ensureObject(amounts);
      minconf = serviceHelper.ensureNumber(minconf);
      fee = serviceHelper.ensureNumber(fee);
      rpcparameters = [fromaddress, amounts, minconf, fee];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To send multiple transactions after data is processed. Sender account, amounts, min conf (defaults to value of 1) and fee (defaults to a value of 0.0001) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zSendManyPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { fromaddress } = processedBody;
    let { amounts } = processedBody;
    let { minconf } = processedBody;
    let { fee } = processedBody;
    minconf = minconf || 1;
    fee = fee || 0.0001;
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'z_sendmany';
      let rpcparameters = [];
      if (fromaddress && amounts) {
        amounts = serviceHelper.ensureObject(amounts);
        minconf = serviceHelper.ensureNumber(minconf);
        fee = serviceHelper.ensureNumber(fee);
        rpcparameters = [fromaddress, amounts, minconf, fee];
      }
      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To set migration. Enabled configuration required as parameter for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zSetMigration(req, res) {
  let { enabled } = req.params;
  enabled = enabled || req.query.enabled;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_setmigration';
    let rpcparameters = [];
    if (enabled) {
      enabled = serviceHelper.ensureBoolean(enabled);
      rpcparameters = [enabled];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To shield coin base. Sender address, recipient address, fee (defaults to a value of 0.0001) and limit (defaults to a value of 50) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zShieldCoinBase(req, res) {
  let { fromaddress } = req.params;
  fromaddress = fromaddress || req.query.fromaddress; // '*' for all
  let { toaddress } = req.params;
  toaddress = toaddress || req.query.toaddress;
  let { fee } = req.params;
  fee = fee || req.query.fee || 0.0001;
  let { limit } = req.params;
  limit = limit || req.query.limit || 50; // 0 for as many as can fit
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'z_shieldcoinbase';
    let rpcparameters = [];
    if (fromaddress && toaddress) {
      fee = serviceHelper.ensureNumber(fee);
      limit = serviceHelper.ensureNumber(limit);
      rpcparameters = [fromaddress, toaddress, fee, limit];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To perform benchmark. Benchmark type and sample count required as parameters for RPC call. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcBenchmark(req, res) {
  let { benchmarktype } = req.params;
  benchmarktype = benchmarktype || req.query.benchmarktype;
  let { samplecount } = req.params;
  samplecount = samplecount || req.query.samplecount;
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'zcbenchmark';
    let rpcparameters = [];
    if (benchmarktype && samplecount) {
      samplecount = serviceHelper.ensureNumber(samplecount);
      rpcparameters = [benchmarktype, samplecount];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To perform a raw join split. Raw transaction, inputs, outputs, old vpub and new vpub required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
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
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawjoinsplit';
    let rpcparameters = [];
    if (rawtx && inputs && outputs && vpubold && vpubnew) {
      inputs = serviceHelper.ensureObject(inputs);
      outputs = serviceHelper.ensureObject(outputs);
      rpcparameters = [rawtx, inputs, outputs, vpubold, vpubnew];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To perform a raw join split after data is processed. Raw transaction, inputs, outputs, old vpub and new vpub required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawJoinSplitPost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { rawtx } = processedBody;
    let { inputs } = processedBody;
    let { outputs } = processedBody;
    const { vpubold } = processedBody;
    const { vpubnew } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'zcrawjoinsplit';
      let rpcparameters = [];
      if (rawtx && inputs && outputs && vpubold && vpubnew) {
        inputs = serviceHelper.ensureObject(inputs);
        outputs = serviceHelper.ensureObject(outputs);
        rpcparameters = [rawtx, inputs, outputs, vpubold, vpubnew];
      }
      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To generate a raw key. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawKeygen(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawkeygen';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To receive raw transaction. Secret key and encrypted note required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawReceive(req, res) {
  let { zcsecretkey } = req.params;
  zcsecretkey = zcsecretkey || req.query.zcsecretkey;
  let { encryptednote } = req.params;
  encryptednote = encryptednote || req.query.encryptednote;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'zcrawreceive';
    let rpcparameters = [];
    if (zcsecretkey && encryptednote) {
      rpcparameters = [zcsecretkey, encryptednote];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To receive raw transaction after data is processed. Secret key and encrypted note required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcRawReceivePost(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { zcsecretkey } = processedBody;
    const { encryptednote } = processedBody;

    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized === true) {
      const rpccall = 'zcrawreceive';
      let rpcparameters = [];
      if (zcsecretkey && encryptednote) {
        rpcparameters = [zcsecretkey, encryptednote];
      }
      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    } else {
      response = messageHelper.errUnauthorizedMessage();
    }

    return res.json(response);
  });
}

/**
 * To perform a sample join split. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zcSampleJoinSplit(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'zcsamplejoinsplit';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To create confirmation transaction.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function createConfirmationTransaction(req, res) {
  const rpccall = 'createconfirmationtransaction';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

// == Benchmarks ==
/**
 * To get benchmarks.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBenchmarks(req, res) {
  const rpccall = 'getbenchmarks';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get benchmark status.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBenchStatus(req, res) {
  const rpccall = 'getbenchstatus';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To start benchmark daemon. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startBenchmarkD(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'startzelbenchd';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

/**
 * To stop benchmark daemon. Only accessible by admins and flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stopBenchmarkD(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const rpccall = 'stopzelbenchd';
    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == NON Daemon ==
/**
 * To check if daemon is synced.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function isDaemonSynced(req, res) {
  const isSynced = {
    header: currentDaemonHeader,
    height: currentDaemonHeight,
    synced: false,
  };
  if (currentDaemonHeight > currentDaemonHeader - 5) {
    isSynced.synced = true;
  }
  const successResponse = messageHelper.createDataMessage(isSynced);
  return res ? res.json(successResponse) : successResponse;
}

/**
 * To show flux daemon blockchain sync status in logs.
 */
async function fluxDaemonBlockchainInfo() {
  try {
    const daemonBlockChainInfo = await daemonServiceBlockchainRpcs.getBlockchainInfo();
    if (daemonBlockChainInfo.status === 'success') {
      currentDaemonHeight = daemonBlockChainInfo.data.blocks;
      if (daemonBlockChainInfo.data.headers >= currentDaemonHeader) {
        currentDaemonHeader = daemonBlockChainInfo.data.headers;
      }
      log.info(`Daemon Sync status: ${currentDaemonHeight}/${currentDaemonHeader}`);
    } else {
      log.error(daemonBlockChainInfo.data.message || daemonBlockChainInfo.data);
    }
  } catch (error) {
    log.warn(error);
  }
}

/**
 * To call the flux daemon blockchain info function at set intervals.
 */
function daemonBlockchainInfoService() {
  fluxDaemonBlockchainInfo();
  setInterval(() => {
    fluxDaemonBlockchainInfo();
  }, 60 * 1000);
}

module.exports = {
  getConfigValue,
  isInsightExplorer,
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

  // == Disclosure ==
  // intentionally left out as of experimental feature
  // == Generating ==
  // intentionally left out as cpu mining is discouraged on zelnodes

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
  sendFrom, // == available but DEPRECATED ==
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
  zcRawJoinSplit, // == available but DEPRECATED ==
  zcRawJoinSplitPost, // == available but DEPRECATED ==
  zcRawKeygen, // == available but DEPRECATED ==
  zcRawReceive, // == available but DEPRECATED ==
  zcRawReceivePost, // == available but DEPRECATED ==
  zcSampleJoinSplit,
  createConfirmationTransaction,

  // == Benchmarks ==
  getBenchmarks,
  getBenchStatus,
  startBenchmarkD,
  stopBenchmarkD,

  // == NON Daemon ==
  isDaemonSynced,
  daemonBlockchainInfoService,
};
