const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('../verificationHelper');

let response = messageHelper.createErrorMessage();

// == Wallet == Admin Privilage. Benchmark fluxteam privilage
/**
 * To add a multi-signature address (requires multiple keys to authorize a transaction). Number of addresses/keys and keys object required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function addMultiSigAddress(req, res) {
  let { n, keysobject } = req.params;
  n = n || req.query.n;
  keysobject = keysobject || req.query.keysobject;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'addMultiSigAddress';
  let rpcparameters = [];
  if (n && keysobject) {
    n = serviceHelper.ensureNumber(n);
    keysobject = serviceHelper.ensureObject(keysobject);
    rpcparameters = [n, keysobject];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    if (authorized !== true) {
      response = messageHelper.errUnauthorizedMessage();
      return res.json(response);
    }
    const rpccall = 'addMultiSigAddress';
    let rpcparameters = [];
    if (n && keysobject) {
      n = serviceHelper.ensureNumber(n);
      keysobject = serviceHelper.ensureObject(keysobject);
      rpcparameters = [n, keysobject];
    }
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'backupWallet';
  let rpcparameters = [];
  if (destination) {
    rpcparameters = [destination];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'dumpPrivKey';
  let rpcparameters = [];
  if (taddr) {
    rpcparameters = [taddr];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get balance. Min conf (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getBalance(req, res) {
  let { minconf, includewatchonly } = req.params;
  minconf = minconf || req.query.minconf || 1;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getBalance';
  minconf = serviceHelper.ensureNumber(minconf);
  includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
  const rpcparameters = ['', minconf, includewatchonly];
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getNewAddress';
  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getRawChangeAddress';
  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To get received by address. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getReceivedByAddress(req, res) {
  let { zelcashaddress, minconf } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  minconf = minconf || req.query.minconf || 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getReceivedByAddress';
  let rpcparameters = [];
  if (zelcashaddress) {
    minconf = serviceHelper.ensureNumber(minconf);
    rpcparameters = [zelcashaddress, minconf];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get a transaction. Transaction ID and whether to include watch only (defaults to false) required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getTransaction(req, res) {
  let { txid, includewatchonly } = req.params;
  txid = txid || req.query.txid;
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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getUnconfirmedBalance';
  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'getWalletInfo';
  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To import address. Address, label and whether to rescan (defaults to true) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importAddress(req, res) {
  let { address, label, rescan } = req.params;
  address = address || req.query.address;
  label = label || req.query.label || '';
  rescan = rescan ?? req.query.rescan ?? true;

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'importAddress';
  let rpcparameters = [];
  if (address) {
    rescan = serviceHelper.ensureBoolean(rescan);
    rpcparameters = [address, label, rescan];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To import private key. Private key, label and whether to rescan (defaults to true) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function importPrivKey(req, res) {
  let { zelcashprivkey, label, rescan } = req.params;
  zelcashprivkey = zelcashprivkey || req.query.zelcashprivkey;
  label = label || req.query.label || '';
  rescan = rescan ?? req.query.rescan ?? true;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'importPrivKey';
  let rpcparameters = [];
  if (zelcashprivkey) {
    rescan = serviceHelper.ensureBoolean(rescan);
    rpcparameters = [zelcashprivkey, label, rescan];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'importWallet';
  let rpcparameters = [];
  if (filename) {
    rpcparameters = [filename];
  }
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'keyPoolRefill';
  newsize = serviceHelper.ensureNumber(newsize);
  const rpcparameters = [newsize];
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'listAddressGroupings';
  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'listLockUnspent';
  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  startheight = serviceHelper.ensureNumber(startheight);
  const rpccall = 'rescanblockchain';
  const rpcparameters = [startheight];
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To list received transactions by address. Min conf (defaults to value of 1), whether to include empty (defaults to false) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listReceivedByAddress(req, res) {
  let { minconf, includeempty, includewatchonly } = req.params;
  minconf = minconf || req.query.minconf || 1;
  includeempty = includeempty ?? req.query.includeempty ?? false;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  minconf = serviceHelper.ensureNumber(minconf);
  includeempty = serviceHelper.ensureBoolean(includeempty);
  includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
  const rpccall = 'listReceivedByAddress';
  const rpcparameters = [minconf, includeempty, includewatchonly];
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To list since a specified block. Block hash, target confirmations (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listSinceBlock(req, res) {
  let { blockhash, targetconfirmations, includewatchonly } = req.params;
  blockhash = blockhash || req.query.blockhash || '';
  targetconfirmations = targetconfirmations || req.query.targetconfirmations || 1;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  targetconfirmations = serviceHelper.ensureNumber(targetconfirmations);
  includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
  const rpccall = 'listSinceBlock';
  const rpcparameters = [blockhash, targetconfirmations, includewatchonly];
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  let { count, from, includewatchonly } = req.params;
  count = count || req.query.count || 10;
  from = from || req.query.from || 0;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  count = serviceHelper.ensureNumber(count);
  from = serviceHelper.ensureNumber(from);
  includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
  const rpccall = 'listTransactions';
  const rpcparameters = [account, count, from, includewatchonly];
  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To list unspent. Min conf (defaults to value of 1), max conf (defaults to value of 9999999) and address required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listUnspent(req, res) {
  let { minconf, maxconf, addresses } = req.params;
  minconf = minconf || req.query.minconf || 1;
  maxconf = maxconf || req.query.maxconf || 9999999;
  addresses = addresses || req.query.addresses;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  minconf = serviceHelper.ensureNumber(minconf);
  maxconf = serviceHelper.ensureNumber(maxconf);
  const rpccall = 'listUnspent';
  const rpcparameters = [minconf, maxconf];
  if (addresses) {
    addresses = serviceHelper.ensureObject(addresses);
    rpcparameters.push(addresses);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To lock unspent. Whether unlocked and transactions required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function lockUnspent(req, res) {
  let { unlock, transactions } = req.params;
  unlock = unlock ?? req.query.unlock;
  transactions = transactions || req.query.transactions;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'lockUnspent';
  let rpcparameters = [];
  if (unlock != null && transactions) {
    unlock = serviceHelper.ensureBoolean(unlock);
    transactions = serviceHelper.ensureObject(transactions);
    rpcparameters = [unlock, transactions];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  let {
    tozelcashaddress, amount, minconf, comment, commentto,
  } = req.params;
  tozelcashaddress = tozelcashaddress || req.query.tozelcashaddress;
  amount = amount || req.query.amount;
  minconf = minconf || req.query.minconf || 1;
  comment = comment || req.query.comment || '';
  commentto = commentto || req.query.commentto || '';
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'sendFrom';
  let rpcparameters = [];
  if (tozelcashaddress && amount) {
    amount = serviceHelper.ensureNumber(amount);
    minconf = serviceHelper.ensureNumber(minconf);
    rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    let {
      amount, minconf, comment, commentto,
    } = processedBody;
    const account = '';
    minconf = minconf || 1;
    comment = comment || '';
    commentto = commentto || '';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      response = messageHelper.errUnauthorizedMessage();
      return res.json(response);
    }
    const rpccall = 'sendFrom';
    let rpcparameters = [];
    if (tozelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      minconf = serviceHelper.ensureNumber(minconf);
      rpcparameters = [account, tozelcashaddress, amount, minconf, comment, commentto];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  let {
    amounts, minconf, comment, substractfeefromamount,
  } = req.params;
  amounts = amounts || req.query.amounts;
  minconf = minconf || req.query.minconf || 1;
  comment = comment || req.query.comment || '';
  substractfeefromamount = substractfeefromamount || req.query.substractfeefromamount;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'sendMany';
  let rpcparameters = [];
  if (!amounts) {
    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
    return res ? res.json(response) : response;
  }
  amounts = serviceHelper.ensureObject(amounts);
  minconf = serviceHelper.ensureNumber(minconf);
  rpcparameters = [fromaccount, amounts, minconf, comment];
  if (substractfeefromamount) {
    substractfeefromamount = serviceHelper.ensureObject(substractfeefromamount);
    rpcparameters.push(substractfeefromamount);
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    let {
      amounts, minconf, comment, substractfeefromamount,
    } = processedBody;
    const fromaccount = '';
    minconf = minconf || 1;
    comment = comment || '';
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      response = messageHelper.errUnauthorizedMessage();
      return res.json(response);
    }
    const rpccall = 'sendMany';
    let rpcparameters = [];
    if (!amounts) {
      response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);
      return res.json(response);
    }
    amounts = serviceHelper.ensureObject(amounts);
    minconf = serviceHelper.ensureNumber(minconf);
    rpcparameters = [fromaccount, amounts, minconf, comment];
    if (substractfeefromamount) {
      substractfeefromamount = serviceHelper.ensureObject(substractfeefromamount);
      rpcparameters.push(substractfeefromamount);
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  let {
    zelcashaddress, amount, comment, commentto, substractfeefromamount,
  } = req.params;
  zelcashaddress = zelcashaddress || req.query.zelcashaddress;
  amount = amount || req.query.amount;
  comment = comment || req.query.comment || '';
  commentto = commentto || req.query.commentto || '';
  substractfeefromamount = substractfeefromamount ?? req.query.substractfeefromamount ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'sendToAddress';
  let rpcparameters = [];
  if (zelcashaddress && amount) {
    amount = serviceHelper.ensureNumber(amount);
    substractfeefromamount = serviceHelper.ensureBoolean(substractfeefromamount);
    rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    if (authorized !== true) {
      response = messageHelper.errUnauthorizedMessage();
      return res.json(response);
    }
    const rpccall = 'sendToAddress';
    let rpcparameters = [];
    if (zelcashaddress && amount) {
      amount = serviceHelper.ensureNumber(amount);
      substractfeefromamount = serviceHelper.ensureBoolean(substractfeefromamount);
      rpcparameters = [zelcashaddress, amount, comment, commentto, substractfeefromamount];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'setTxFee';
  let rpcparameters = [];
  if (amount) {
    amount = serviceHelper.ensureNumber(amount);
    rpcparameters = [amount];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To sign message. Address and message required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function signMessage(req, res) {
  let { taddr, message } = req.params;
  taddr = taddr || req.query.taddr;
  message = message || req.query.message;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'signMessage';
  let rpcparameters = [];
  if (taddr && message) {
    rpcparameters = [taddr, message];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
    if (authorized !== true) {
      response = messageHelper.errUnauthorizedMessage();
      return res.json(response);
    }
    const rpccall = 'signMessage';
    let rpcparameters = [];
    if (taddr && message) {
      rpcparameters = [taddr, message];
    }

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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

module.exports = {
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
};
