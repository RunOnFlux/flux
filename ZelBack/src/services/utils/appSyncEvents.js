const { EventEmitter } = require('events');

const appSyncEvents = new EventEmitter();

const EVENTS = Object.freeze({
  EPHEMERAL_SYNC_COMPLETE: 'ephemeralSyncComplete',
  EPHEMERAL_SYNC_REFUSED: 'ephemeralSyncRefused',
  EPHEMERAL_SYNC_UNVERIFIED: 'ephemeralSyncUnverified',
  EPHEMERAL_SYNC_WRITE_FAILED: 'ephemeralSyncWriteFailed',
  EPHEMERAL_SYNC_PROGRESS: 'ephemeralSyncProgress',
  SPAWNER_READY: 'spawnerReady',
  READINESS_LOST: 'readinessLost',
  HASH_RESPONSE_RECEIVED: 'hashResponseReceived',
  HASH_UNRESOLVED: 'hashUnresolved',
  // An operator asked for a check of every missing app message; the orchestrator
  // runs it once no hash sync or registry build holds the node.
  HASH_CHECK_REQUESTED: 'hashCheckRequested',
});

module.exports = { appSyncEvents, EVENTS };
