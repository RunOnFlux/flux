// Production's limits on what a node takes from a peer, for suites that send
// either side of them. Held as constants because the product modules that own
// them read the node's config, which the runner cannot load;
// tests/unit/gossipMessageSize.test.js fails if any of them drifts from the
// product.
module.exports = {
  // fluxapps.gossipMessageMaxBytes: the largest broadcast frame, or event in a sync answer
  GOSSIP_MESSAGE_MAX_BYTES: 8 * 1024 * 1024,
  // fluxapps.peerFrameMaxBytes: the largest frame a node takes from a peer
  PEER_FRAME_MAX_BYTES: (8 * 1024 * 1024) + (64 * 1024),
  // appConstants MAX_ENTERPRISE_LENGTH: the longest v8 enterprise string
  MAX_ENTERPRISE_LENGTH: 2646396,
  // appConstants INSTALL_ERROR_MAX_LENGTH: the longest install error a node stores
  INSTALL_ERROR_MAX_LENGTH: 1000,
};
