const config = require('config');

const daemonServiceUtils = require('./daemonService/daemonServiceUtils');

/**
 * The addresses an app message's payment is made to. The development address
 * receives payments only on a development node.
 * @returns {string[]}
 */
function appPaymentAddresses() {
  const addresses = [config.fluxapps.address, config.fluxapps.addressMultisig, config.fluxapps.addressMultisigB];
  if (config.development) addresses.push(config.fluxapps.addressDevelopment);
  return addresses;
}

/**
 * Every transaction paying an app payment address in a height range, with its
 * position in its block, from one address-index call.
 *
 * `blockindex` on a delta record is the transaction's position within its
 * block (fluxd's CAddressIndexKey.txindex); `index` on the same record is the
 * input or output index within the transaction.
 *
 * @param {number} start
 * @param {number} end
 * @returns {Promise<Map<string, {height: number, txIndex: number}>>} by txid
 */
async function appPaymentPositions(start, end) {
  const result = await daemonServiceUtils.executeCall(
    'getaddressdeltas',
    [{ addresses: appPaymentAddresses(), start, end }],
    { useCache: false },
  );
  if (result.status !== 'success') {
    throw new Error(`getaddressdeltas failed: ${result.data?.message ?? result.data}`);
  }
  const positions = new Map();
  for (const delta of result.data) {
    if (delta.satoshis > 0 && !positions.has(delta.txid)) {
      if (!Number.isInteger(delta.blockindex)) {
        throw new Error(`getaddressdeltas returned no blockindex for ${delta.txid}`);
      }
      positions.set(delta.txid, { height: delta.height, txIndex: delta.blockindex });
    }
  }
  return positions;
}

module.exports = { appPaymentAddresses, appPaymentPositions };
