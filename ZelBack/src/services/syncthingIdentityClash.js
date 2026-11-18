/**
 * Two nodes holding one syncthing identity: one node's syncthing home copied to
 * another. Each skips the other as itself, so an app the two share has no peer
 * between them, and a third node that shares apps with both reaches one of them
 * in place of the other.
 *
 * A peer reporting this node's own device ID is a claim, and any node can make
 * one. It is acted on only once the peer's syncthing proves the identity in a
 * TLS handshake, which needs the identity's private key.
 *
 * Of the two holders, the one whose collateral sorts higher replaces its
 * identity, and each reaches that answer alone from the node list. The other
 * leaves its identity alone unless the clash is still proven an hour after it
 * was first: the higher holder may be unable to act - FluxOS does not run
 * syncthing on Arcane, and a node may not run this release.
 */

const log = require('../lib/log');
const generalService = require('./generalService');
const networkStateService = require('./networkStateService');
const syncthingService = require('./syncthingService');
const fluxEventBus = require('./utils/fluxEventBus');
const { presentedDeviceId } = require('./utils/syncthingDeviceId');
const { extractIp, extractPort } = require('./utils/socketAddressUtils');

const PROOF_INTERVAL_MS = 10 * 60 * 1000;
const LOWER_HOLDER_WAIT_MS = 60 * 60 * 1000;

const lastProofAt = new Map(); // peer -> when its claim was last tested
const provenSince = new Map(); // peer -> when this node, the lower holder, first proved the clash

function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * @param {string} txhash
 * @param {number} index
 * @returns {string}
 */
function outpoint(txhash, index) {
  return `${txhash}:${index}`;
}

/**
 * @returns {Promise<string|null>}
 */
async function ownCollateral() {
  return generalService.obtainNodeCollateralInformation()
    .then(({ txhash, txindex }) => outpoint(txhash, txindex), () => null);
}

/**
 * @param {string} peer Socket address.
 * @returns {Promise<string|null>}
 */
async function peerCollateral(peer) {
  const node = await networkStateService.getFluxnodeBySocketAddress(peer).catch(() => null);
  return node?.txhash ? outpoint(node.txhash, node.outidx) : null;
}

/**
 * A peer reported this node's own syncthing device ID. Tested at most once per
 * PROOF_INTERVAL_MS per peer; resolves once the test and anything it decides
 * are done.
 * @param {string} peer The peer's socket address.
 * @param {string} ownDeviceId
 * @returns {Promise<void>}
 */
async function noteClaimOfOwnDeviceId(peer, ownDeviceId) {
  const now = monotonicMs();
  const last = lastProofAt.get(peer);
  if (last !== undefined && now - last < PROOF_INTERVAL_MS) return;
  lastProofAt.set(peer, now);

  // syncthing listens on the API port + 2
  const proven = await presentedDeviceId(extractIp(peer), extractPort(peer) + 2);
  if (proven !== ownDeviceId) {
    provenSince.delete(peer);
    log.warn(`syncthingIdentityClash - ${peer} reports this node's syncthing device ID ${ownDeviceId}, and its syncthing proves ${proven ?? 'no identity'}`);
    return;
  }
  log.error(`syncthingIdentityClash - ${peer} holds this node's syncthing identity ${ownDeviceId}`);
  fluxEventBus.publish('syncthing:identityClash', { peer, deviceId: ownDeviceId });

  if (!syncthingService.ownsSyncthing()) return;
  const [mine, theirs] = await Promise.all([ownCollateral(), peerCollateral(peer)]);
  if (!mine) return;
  if (!theirs || mine < theirs) {
    if (!provenSince.has(peer)) provenSince.set(peer, now);
    if (now - provenSince.get(peer) < LOWER_HOLDER_WAIT_MS) return;
  }
  provenSince.delete(peer);
  syncthingService.requestIdentityRegeneration(`${peer} holds the same syncthing identity`);
}

/**
 * Test helper: forgets every test and proof.
 */
function reset() {
  lastProofAt.clear();
  provenSince.clear();
}

module.exports = {
  noteClaimOfOwnDeviceId,
  reset,
  PROOF_INTERVAL_MS,
  LOWER_HOLDER_WAIT_MS,
};
