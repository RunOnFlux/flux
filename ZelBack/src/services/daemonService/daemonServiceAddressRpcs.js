const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');

let response = messageHelper.createErrorMessage();

/**
 * To get transaction IDs for specified address/es. Addresses, start and end required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressTxids(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { addresses, start, end } = processedBody;

    const options = {
      addresses,
      start,
      end,
    };

    const rpccall = 'getaddresstxids';
    const rpcparameters = [options];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get transaction IDs for single specified address. Address, start and end required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddresssTxids(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { start } = req.params;
  start = start || req.query.start;
  let { end } = req.params;
  end = end || req.query.end;

  const options = {
    addresses: [address],
  };

  if (start) {
    options.start = serviceHelper.ensureNumber(start);
  }
  if (end) {
    options.end = serviceHelper.ensureNumber(end);
  }

  const rpccall = 'getaddresstxids';
  const rpcparameters = [options];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get balance of address/es. Addresses required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressBalance(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const { addresses } = processedBody;

    const options = {
      addresses,
    };

    const rpccall = 'getaddressbalance';
    const rpcparameters = [options];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get balance of a single address. Address required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressBalance(req, res) {
  let { address } = req.params;
  address = address || req.query.address;

  const options = {
    addresses: [address],
  };

  const rpccall = 'getaddressbalance';
  const rpcparameters = [options];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get address deltas. Addresses, start, end and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressDeltas(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {
      addresses, start, end, chainInfo,
    } = processedBody;

    const options = {
      addresses,
      start,
      end,
      chainInfo,
    };

    const rpccall = 'getaddressdeltas';
    const rpcparameters = [options];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get deltas for a single address. Address, start, end and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressDeltas(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { start } = req.params;
  start = start || req.query.start;
  let { end } = req.params;
  end = end || req.query.end;
  let { chaininfo } = req.params;
  chaininfo = chaininfo || req.query.chaininfo;

  const options = {
    addresses: [address],
  };

  if (start) {
    options.start = serviceHelper.ensureNumber(start);
  }
  if (end) {
    options.end = serviceHelper.ensureNumber(end);
  }

  if (chaininfo) {
    options.chainInfo = serviceHelper.ensureBoolean(chaininfo);
  }

  const rpccall = 'getaddressdeltas';
  const rpcparameters = [options];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get UTXOs for multiple addresses. Addresses and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressUtxos(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {
      addresses, chainInfo,
    } = processedBody;

    const options = {
      addresses,
      chainInfo,
    };

    const rpccall = 'getaddressutxos';
    const rpcparameters = [options];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get UTXOs for a single address. Address and chain info required as parameters for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressUtxos(req, res) {
  let { address } = req.params;
  address = address || req.query.address;
  let { chaininfo } = req.params;
  chaininfo = chaininfo || req.query.chaininfo;

  const options = {
    addresses: [address],
    chainInfo: chaininfo,
  };

  const rpccall = 'getaddressutxos';
  const rpcparameters = [options];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get mempool (memory pool) for multiple addresses. Addresses required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getAddressMempool(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const {
      addresses,
    } = processedBody;

    const options = {
      addresses,
    };

    const rpccall = 'getaddressmempool';
    const rpcparameters = [options];

    response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

    return res.json(response);
  });
}

/**
 * To get mempool (memory pool) for a single address. Address required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getSingleAddressMempool(req, res) {
  let { address } = req.params;
  address = address || req.query.address;

  const options = {
    addresses: [address],
  };

  const rpccall = 'getaddressmempool';
  const rpcparameters = [options];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

module.exports = {
  getAddressTxids, // insight explorer
  getSingleAddresssTxids,
  getAddressBalance, // insight explorer
  getSingleAddressBalance,
  getAddressDeltas, // insight explorer
  getSingleAddressDeltas,
  getAddressUtxos, // insight explorer
  getSingleAddressUtxos,
  getAddressMempool, // insight explorer
  getSingleAddressMempool,
};
