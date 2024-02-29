// change these to maps

const incomingConnections = []; // websocket list
const incomingPeers = []; // array of objects containing ip, port
const outgoingConnections = []; // websocket list
const outgoingPeers = []; // array of objects containing ip, port, latency, lastPingTime

module.exports = {
  incomingConnections,
  incomingPeers,
  outgoingConnections,
  outgoingPeers,
};
