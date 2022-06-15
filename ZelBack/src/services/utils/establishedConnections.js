const incomingConnections = []; // websocket list
const incomingPeers = []; // array of objects containing ip
const outgoingConnections = []; // websocket list
const outgoingPeers = []; // array of objects containing ip, latency, lastPingTime

module.exports = {
  incomingConnections,
  incomingPeers,
  outgoingConnections,
  outgoingPeers,
};
