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
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
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
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;

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
  rescan = rescan ?? req.query.rescan ?? true;

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
  rescan = rescan ?? req.query.rescan ?? true;
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
  includeempty = includeempty ?? req.query.includeempty ?? false;
  let { includewatchonly } = req.params;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
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
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
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
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
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
  unlock = unlock ?? req.query.unlock;
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
  substractfeefromamount = substractfeefromamount ?? req.query.substractfeefromamount ?? false;
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
    substractfeefromamount = substractfeefromamount ?? false;
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
  createConfirmationTransaction,

  // == NON Daemon ==
  isDaemonSynced,
  daemonBlockchainInfoService,
};
