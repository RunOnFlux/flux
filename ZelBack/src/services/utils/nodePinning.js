const { socketAddressesMatch } = require('./socketAddressUtils');

// An app spec's `nodes` array pins the app to named nodes. An entry names a node
// EITHER by socket address OR by collateral outpoint (`txhash:txindex`), and both
// are in use on the live network: v7 specs carry addresses, and the validator sizes
// its length check for an outpoint (`// 64 for txhash, : separator, max 5 for outidx`).
//
// This exists because three places answered "does this spec name me?" separately and
// two of them agreed. appSpawner compared addresses only, so an outpoint-pinned spec
// matched nowhere - which for an enterprise-owned app meant it could be placed on no
// node at all, silently, since a filtered-out candidate produces no error to read.

/**
 * This node's collateral as a `nodes` entry, or null when it cannot be formed.
 * @param {{txhash: string, txindex: number|string}} [collateral] From
 *   generalService.obtainNodeCollateralInformation().
 * @returns {string|null}
 */
function collateralOutpoint(collateral) {
  if (!collateral || !collateral.txhash) return null;
  if (collateral.txindex === undefined || collateral.txindex === null) return null;
  return `${collateral.txhash}:${collateral.txindex}`;
}

/**
 * Whether a spec's `nodes` array names this node, by either identifier.
 *
 * Synchronous and takes the outpoint already resolved: the callers that run inside a
 * filter cannot await, and the ones that can resolve it once rather than per entry.
 * A missing outpoint narrows the match to addresses rather than failing it, so a node
 * that cannot reach its daemon still honours an address pin.
 * @param {string[]} nodes The spec's nodes array.
 * @param {string|null} localSocketAddr This node's socket address.
 * @param {string|null} [outpoint] This node's collateral outpoint.
 * @returns {boolean}
 */
function nodesNameThisNode(nodes, localSocketAddr, outpoint = null) {
  if (!Array.isArray(nodes) || !nodes.length) return false;
  if (localSocketAddr && nodes.some((node) => socketAddressesMatch(node, localSocketAddr))) return true;
  return Boolean(outpoint) && nodes.includes(outpoint);
}

module.exports = {
  collateralOutpoint,
  nodesNameThisNode,
};
