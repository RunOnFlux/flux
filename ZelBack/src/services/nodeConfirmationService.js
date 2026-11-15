const config = require('config');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const networkStateService = require('./networkStateService');
const { AsyncGate } = require('./utils/asyncGate');
const { peerManager } = require('./utils/FluxPeerManager');
const fluxEventBus = require('./utils/fluxEventBus');
const log = require('../lib/log');

const DAEMON_STALE_MS = config.confirmation.daemonStaleMs;
const DAEMON_EXPIRED_MS = config.confirmation.daemonExpiredMs;

let ourPubkey = null;
let daemonConfirmed = null;
let daemonStale = false;
let messageCapable = false;
let started = false;
let lastSuccessfulPoll = null;
let capabilityCheck = Promise.resolve();

const confirmedGate = new AsyncGate();
const confirmationStatusGate = new AsyncGate();
const confirmationListeners = [];
const daemonStaleListeners = [];
const messageCapabilityListeners = [];

function isConfirmed() {
  return daemonConfirmed;
}

function canSendMessages() {
  return messageCapable;
}

function isDaemonStale() {
  return daemonStale;
}

function waitForConfirmed() {
  return confirmedGate.wait();
}

function waitForConfirmationStatus() {
  return confirmationStatusGate.wait();
}

function onConfirmationChange(callback) {
  confirmationListeners.push(callback);
}

function onDaemonStale(callback) {
  daemonStaleListeners.push(callback);
}

function onMessageCapabilityChange(callback) {
  messageCapabilityListeners.push(callback);
}

/**
 * Asks whether this node can be heard, when something that decides it may have
 * changed and the daemon holds it confirmed.
 * @returns {void}
 */
function recheckMessageCapability() {
  if (daemonConfirmed) checkMessageCapability().catch((error) => log.error(error));
}

/**
 * The node can no longer say what it is: asked again only while that can change
 * the answer, since the check itself reads the address.
 * @returns {void}
 */
function recheckWhileCapable() {
  if (messageCapable) recheckMessageCapability();
}

async function poll() {
  const prevDaemonConfirmed = daemonConfirmed;
  const prevMessageCapable = messageCapable;
  let rpcReachable = false;
  try {
    const response = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
    if (response.status === 'success') {
      rpcReachable = true;
      lastSuccessfulPoll = Date.now();
      daemonStale = false;
      daemonConfirmed = response.data?.status === 'CONFIRMED';
    }
  } catch (error) {
    // RPC unreachable — keep previous daemonConfirmed value
  }

  // Future: use in-band NAK-based confirmation check instead of timeout.
  // See dev/in-band-confirmation-check.md
  if (!rpcReachable && lastSuccessfulPoll !== null) {
    const elapsed = Date.now() - lastSuccessfulPoll;

    // 125 min — remove apps, but messageCapable preserved (can still broadcast)
    if (elapsed > DAEMON_STALE_MS && !daemonStale) {
      daemonStale = true;
      log.warn(`nodeConfirmationService - Daemon unreachable for ${Math.round(elapsed / 60000)} minutes, stale`);
      for (const cb of daemonStaleListeners) {
        try { cb(); } catch (e) { log.error(e); }
      }
    }

    // 320 min — definitively expired on-chain, set daemonConfirmed false
    if (elapsed > DAEMON_EXPIRED_MS && daemonConfirmed) {
      daemonConfirmed = false;
      confirmedGate.close();
      log.warn('nodeConfirmationService - Daemon unreachable for full expiration window, confirmation lost');
      fluxEventBus.publish('confirmation:changed', { confirmed: false });
      for (const cb of confirmationListeners) {
        try { cb(false); } catch (e) { log.error(e); }
      }
    }
  }

  if (rpcReachable) {
    if (daemonConfirmed) {
      confirmedGate.open();
    } else {
      confirmedGate.close();
    }
    if (prevDaemonConfirmed !== daemonConfirmed) {
      const direction = daemonConfirmed ? 'gained' : 'lost';
      log.info(`nodeConfirmationService - Confirmation ${direction}`);
      fluxEventBus.publish('confirmation:changed', { confirmed: daemonConfirmed });
      for (const cb of confirmationListeners) {
        try { cb(daemonConfirmed); } catch (e) { log.error(e); }
      }
    }
  }

  if (!daemonConfirmed) {
    messageCapable = false;
    if (prevMessageCapable !== messageCapable) {
      log.info('nodeConfirmationService - Node not confirmed by daemon, message capability lost');
      for (const cb of messageCapabilityListeners) {
        try { cb(false); } catch (e) { log.error(e); }
      }
    }
    return;
  }

  if (prevDaemonConfirmed !== daemonConfirmed) await checkMessageCapability();
}

/**
 * Whether this node can be heard: it is listed at the address it reports, under
 * its key, it holds the peers its messages travel by (the peer threshold), and
 * no move of its own is under way. Asked when any of those changes, and told to
 * the capability listeners when the answer does. One check runs at a time, so two
 * started together cannot both report the same change.
 * @returns {Promise<void>}
 */
function checkMessageCapability() {
  capabilityCheck = capabilityCheck.then(readMessageCapability, readMessageCapability);
  return capabilityCheck;
}

async function readMessageCapability() {
  const prevMessageCapable = messageCapable;
  let newMessageCapable = false;
  try {
    if (!ourPubkey) {
      ourPubkey = await fluxNetworkHelper.getFluxNodePublicKey();
      if (!ourPubkey || typeof ourPubkey !== 'string') {
        ourPubkey = null;
      }
    }

    // ASKED FRESH, NOT OF THE CACHE. This is the only reader here that establishes
    // whether this node can still be heard: it can when the network lists it at its
    // own address. An address the node cannot produce now is what makes it stop
    // claiming it can broadcast: neither fluxd's decided address nor one in
    // FluxBench's benchmark results. A value served from memory answers the
    // address and not the question.
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress({ fresh: true });
    if (localSocketAddr && ourPubkey && peerManager.isAboveThreshold() && !fluxNetworkHelper.ownMoveUnderway()) {
      const node = await networkStateService.getFluxnodeBySocketAddress(localSocketAddr);
      if (node && node.pubkey === ourPubkey) {
        newMessageCapable = true;
      }
    }
  } catch (error) {
    log.warn(`nodeConfirmationService - Message capability check failed: ${error.message}`);
  }

  messageCapable = newMessageCapable;

  if (prevMessageCapable !== messageCapable) {
    const direction = messageCapable ? 'gained' : 'lost';
    log.info(`nodeConfirmationService - Message capability ${direction} (confirmed=${daemonConfirmed}, messageCapable=${messageCapable})`);
    fluxEventBus.publish('messageCapability:changed', { capable: messageCapable });
    for (const cb of messageCapabilityListeners) {
      try { cb(messageCapable); } catch (e) { log.error(e); }
    }
  }
}

function scheduleNext() {
  setTimeout(async () => {
    await poll();
    scheduleNext();
  }, config.confirmation.pollIntervalMs);
}

async function start() {
  if (started) return;
  started = true;
  fluxNetworkHelper.onLocalSocketAddressKnown(recheckMessageCapability);
  fluxNetworkHelper.onLocalSocketAddressChange(recheckMessageCapability);
  fluxNetworkHelper.onLocalSocketAddressUnresolved(recheckWhileCapable);
  fluxNetworkHelper.onOwnMoveUnderwayChange(recheckMessageCapability);
  networkStateService.onUpdated(recheckMessageCapability);
  peerManager.on('peerThresholdReached', recheckMessageCapability);
  peerManager.on('peersBelowThreshold', recheckMessageCapability);
  await poll();
  confirmationStatusGate.open();
  scheduleNext();
  log.info(`nodeConfirmationService - Started (confirmed=${daemonConfirmed}, messageCapable=${messageCapable})`);
}

module.exports = {
  isConfirmed,
  isDaemonStale,
  canSendMessages,
  waitForConfirmed,
  waitForConfirmationStatus,
  onConfirmationChange,
  onDaemonStale,
  onMessageCapabilityChange,
  start,
};
