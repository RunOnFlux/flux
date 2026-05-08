const { EventEmitter } = require('events');

const appSyncEvents = new EventEmitter();

const EVENTS = Object.freeze({
  EPHEMERAL_SYNC_COMPLETE: 'ephemeralSyncComplete',
  SPAWNER_READY: 'spawnerReady',
  READINESS_LOST: 'readinessLost',
  HASH_SYNC_COMPLETE: 'hashSyncComplete',
  HASH_RESPONSE_RECEIVED: 'hashResponseReceived',
  HASH_UNRESOLVED: 'hashUnresolved',
});

module.exports = { appSyncEvents, EVENTS };
