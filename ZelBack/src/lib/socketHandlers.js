const idService = require('../services/idService');
const paymentService = require('../services/paymentService');
const { peerManager } = require('../services/utils/peerState');

// these need to be most specific first (on the same route)
const socketHandlers = {
  '/ws/flux/:port': peerManager.validateAndAddInbound.bind(peerManager),
  '/ws/flux': peerManager.validateAndAddInbound.bind(peerManager),
  '/ws/id/:loginphrase': idService.wsRespondLoginPhrase,
  '/ws/sign/:message': idService.wsRespondSignature,
  '/ws/payment/:paymentid': paymentService.wsRespondPayment,
};

const FLUX_PEER_ROUTE = /^\/ws\/flux(\/|$)/;

/**
 * Whether a websocket upgrade may complete, decided before the handshake does.
 *
 * A node that is not yet accepting peer connections refuses here rather than
 * after the 101. Its HTTP server answers well before its application gate
 * opens, and its capabilities ride in the upgrade response headers, so a
 * completed handshake is enough for the dialling node to construct a peer,
 * count it toward its thresholds and write to it - a boot's state-sync requests
 * go into that socket and are lost when this side closes it. The dial fails
 * cleanly instead, and the reconnect machinery retries it.
 *
 * Only the peer routes. Browsers reach /ws/id, /ws/sign and /ws/payment, and
 * those have nothing to do with whether this node has peers yet.
 * @param {import('node:http').IncomingMessage} request
 * @returns {{status: number, message: string, reason: string}|null} null to admit.
 */
function admitUpgrade(request) {
  if (!FLUX_PEER_ROUTE.test(request?.url ?? '')) return null;
  if (peerManager.acceptingConnections) return null;

  return { status: 503, message: 'Service Unavailable', reason: 'node-not-accepting-connections' };
}

module.exports = { socketHandlers, admitUpgrade };
