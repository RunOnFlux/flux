const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const verificationHelper = require('./verificationHelper');

let response = messageHelper.createErrorMessage();

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_exportkey';
  let rpcparameters = [];
  if (zaddr) {
    rpcparameters = [zaddr];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_exportviewingkey';
  let rpcparameters = [];
  if (zaddr) {
    rpcparameters = [zaddr];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get account balance. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetBalance(req, res) {
  let { address, minconf } = req.params;
  address = address || req.query.address;
  minconf = minconf ?? req.query.minconf ?? 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_getbalance';
  let rpcparameters = [];
  if (address) {
    minconf = serviceHelper.ensureNumber(minconf);
    rpcparameters = [address, minconf];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_getmigrationstatus';

  response = await daemonServiceUtils.executeCall(rpccall);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_getnewaddress';
  const rpcparameters = [type];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  operationid = serviceHelper.ensureObject(operationid);
  const rpccall = 'z_getoperationresult';
  const rpcparameters = [operationid];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  operationid = serviceHelper.ensureObject(operationid);
  const rpccall = 'z_getoperationstatus';
  const rpcparameters = [operationid];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get total balance. Min conf (defaults to value of 1) and whether to include watch only (defaults to false) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zGetTotalBalance(req, res) {
  let { minconf, includewatchonly } = req.params;
  minconf = minconf ?? req.query.minconf ?? 1;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  minconf = serviceHelper.ensureNumber(minconf);
  includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
  const rpccall = 'z_gettotalbalance';
  const rpcparameters = [minconf, includewatchonly];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To import key. Key, rescan configuration (defaults to when key is new) and start height (defaults to value of 0) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportKey(req, res) {
  let { zkey, rescan, startheight } = req.params;
  zkey = zkey || req.query.zkey;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_importkey';
  let rpcparameters = [];
  if (zkey) {
    startheight = serviceHelper.ensureNumber(startheight);
    rpcparameters = [zkey, rescan, startheight];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To import viewing key. Viewing key, rescan configuration (defaults to when key is new) and start height (defaults to value of 0) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zImportViewingKey(req, res) {
  let { vkey, rescan, startheight } = req.params;
  vkey = vkey || req.query.vkey;
  rescan = rescan || req.query.rescan || 'whenkeyisnew';
  startheight = startheight || req.query.startheight || 0;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_importviewingkey';
  let rpcparameters = [];
  if (vkey) {
    startheight = serviceHelper.ensureNumber(startheight);
    rpcparameters = [vkey, rescan, startheight];
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
async function zImportWallet(req, res) {
  let { filename } = req.params;
  filename = filename || req.query.filename;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_importwallet';
  let rpcparameters = [];
  if (filename) {
    rpcparameters = [filename];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  includewatchonly = serviceHelper.ensureBoolean(includewatchonly);
  const rpccall = 'z_listaddresses';
  const rpcparameters = [includewatchonly];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

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
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_listoperationids';

  response = await daemonServiceUtils.executeCall(rpccall);

  return res ? res.json(response) : response;
}

/**
 * To list received by address. Address and min conf (defaults to value of 1) required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListReceivedByAddress(req, res) {
  let { address, minconf } = req.params;
  address = address || req.query.address;
  minconf = minconf ?? req.query.minconf ?? 1;
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
  const rpccall = 'z_listreceivedbyaddress';
  let rpcparameters = [];
  if (address) {
    minconf = serviceHelper.ensureNumber(minconf);
    rpcparameters = [address, minconf];
  }

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To list unspent. Min conf (defaults to value of 1), max conf (defaults to value of 9999999), whether to include watch only (defaults to false) and addresses required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zListUnspent(req, res) {
  let {
    minconf, maxconf, includewatchonly, addresses,
  } = req.params;
  minconf = minconf ?? req.query.minconf ?? 1;
  maxconf = maxconf || req.query.maxconf || 9999999;
  includewatchonly = includewatchonly ?? req.query.includewatchonly ?? false;
  addresses = addresses || req.query.addresses;

  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized !== true) {
    response = messageHelper.errUnauthorizedMessage();
    return res ? res.json(response) : response;
  }
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

  return res ? res.json(response) : response;
}

/**
 * To merge to address. Sender address, recipient address, fee (defaults to a value of 0.0001), transparent limit (defaults to a value of 50), shielded limit (defaults to a value of 20) and memo required as parameters for RPC call. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function zMergeToAddress(req, res) {
  let {
    fromaddresses, toaddress, fee, transparentlimit, shieldedlimit, memo,
  } = req.params;
  fromaddresses = fromaddresses || req.query.fromaddresses;
  toaddress = toaddress || req.query.toaddress;
  fee = fee || req.query.fee || 0.0001;
  transparentlimit = transparentlimit ?? req.query.transparentlimit ?? 50; // 0 for as many as can fit
  shieldedlimit = shieldedlimit ?? req.query.shieldedlimit ?? 20; // 0 for as many as can fit
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
  minconf = minconf ?? req.query.minconf ?? 1;
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
  enabled = enabled ?? req.query.enabled;
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

module.exports = {
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
};
