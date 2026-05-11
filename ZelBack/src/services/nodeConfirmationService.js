const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const networkStateService = require('./networkStateService');
const { AsyncGate } = require('./utils/asyncGate');
const log = require('../lib/log');

// 125 minutes — matches apprunning broadcast TTL. If we can't verify our
// status for a full broadcast cycle, remove apps but keep broadcasting
// (peers may still accept our messages).
const DAEMON_STALE_MS = 125 * 60 * 1000;
// 320 minutes — full confirmation expiration window (640 blocks × 30s).
// At this point the node has definitively expired on-chain.
const DAEMON_EXPIRED_MS = 320 * 60 * 1000;

let ourPubkey = null;
let daemonConfirmed = false;
let daemonStale = false;
let messageCapable = false;
let started = false;
let lastSuccessfulPoll = null;

const confirmedGate = new AsyncGate();
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

function onConfirmationChange(callback) {
  confirmationListeners.push(callback);
}

function onDaemonStale(callback) {
  daemonStaleListeners.push(callback);
}

function onMessageCapabilityChange(callback) {
  messageCapabilityListeners.push(callback);
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

  let newMessageCapable = false;
  try {
    if (!ourPubkey) {
      ourPubkey = await fluxNetworkHelper.getFluxNodePublicKey();
      if (!ourPubkey || typeof ourPubkey !== 'string') {
        ourPubkey = null;
      }
    }

    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (myIP && ourPubkey) {
      const node = await networkStateService.getFluxnodeBySocketAddress(myIP);
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
    for (const cb of messageCapabilityListeners) {
      try { cb(messageCapable); } catch (e) { log.error(e); }
    }
  }
}

function scheduleNext() {
  setTimeout(async () => {
    await poll();
    scheduleNext();
  }, 30 * 1000);
}

async function start() {
  if (started) return;
  started = true;
  await poll();
  scheduleNext();
  log.info(`nodeConfirmationService - Started (confirmed=${daemonConfirmed}, messageCapable=${messageCapable})`);
}

module.exports = {
  isConfirmed,
  isDaemonStale,
  canSendMessages,
  waitForConfirmed,
  onConfirmationChange,
  onDaemonStale,
  onMessageCapabilityChange,
  start,
};
