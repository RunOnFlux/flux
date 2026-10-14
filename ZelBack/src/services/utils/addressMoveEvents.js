const { EventEmitter } = require('events');

// Told each time a move is applied to the location table: `from`, the address a
// node left; `to`, the address its rows are at now; and `broadcastedAt`, when it
// moved (ms). Every path a move arrives by applies it the same way, so a
// listener hears each move however it reached this node.
const addressMoveEvents = new EventEmitter();

const EVENTS = Object.freeze({
  APPLIED: 'applied',
});

module.exports = { addressMoveEvents, EVENTS };
