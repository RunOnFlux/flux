const { peerManager } = require('./FluxPeerManager');

module.exports = {
  peerManager,
  get incomingConnections() { return peerManager.incomingConnections; },
  get incomingPeers() { return peerManager.incomingPeers; },
  get outgoingConnections() { return peerManager.outgoingConnections; },
  get outgoingPeers() { return peerManager.outgoingPeers; },
};
