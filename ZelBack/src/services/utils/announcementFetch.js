// Fetching an announced message from one peer at a time.
//
// A peer announces a message by its hash, and a node asks for what it does not
// hold. One announcer is asked; the others are remembered as fallbacks. A
// fallback is asked when the peer asked has not delivered within its timeout,
// or what it delivered did not verify. So a message arrives once however many
// peers announce it, and an announcer that never delivers costs a delay, not the
// message.
//
// A copy under verification holds the message's seen mark without yet being the
// message, so the sender of an announcement or of another copy arriving meanwhile
// is kept as a fallback for the copy failing. A second copy's bytes are dropped, so
// no number of forged copies costs memory or takes the place of a genuine one.
//
// A miss is charged to a peer that was asked and did not deliver, only once
// another peer delivers: that proves the message existed. A timer that fired late
// says this node is behind, not that the peer is: the copy may be in its own
// queue, so it waits again, asks nobody and charges nothing. Each further peer
// asked for a message gets twice as long, so a node that falls behind does not
// add to what it is behind on. Peers with the most misses are asked last, and a
// first announcer with misses is asked only after hashFetchBaseMs, for a better
// one to announce. Each message a peer delivers clears one of its misses.

const config = require('config');

const NO_LATENCY_MS = config.fluxapps.hashFetchDefaultMs;

/** @type {Map<string, {asked: ?string, fallbacks: Set<string>, timedOut: Set<string>, timer: ?NodeJS.Timeout, attempts: number}>} */
const fetches = new Map();
const verifying = new Set();
const missesOf = new Map();

let wiring = {
  request: () => {},
  latencyOf: () => null,
  seen: () => false,
  onMiss: () => {},
  onServed: () => {},
};

/**
 * How long a peer has to deliver: a multiple of its measured round trip, plus
 * what it takes to answer.
 * @param {string} peerKey
 * @param {number} [attempt] How many peers were asked before this one.
 * @returns {number} Milliseconds.
 */
function timeoutFor(peerKey, attempt = 0) {
  const oneWay = wiring.latencyOf(peerKey);
  const { hashFetchRttMultiplier, hashFetchBaseMs, hashFetchMaxBackoff } = config.fluxapps;
  const base = oneWay === null || oneWay === undefined ? NO_LATENCY_MS : hashFetchRttMultiplier * 2 * oneWay + hashFetchBaseMs;
  return base * 2 ** Math.min(attempt, hashFetchMaxBackoff);
}

function clearFetch(hash, entry) {
  if (entry.timer) clearTimeout(entry.timer);
  fetches.delete(hash);
}

function nextFallback(entry) {
  let next = null;
  entry.fallbacks.forEach((peerKey) => {
    if (next === null || (missesOf.get(peerKey) ?? 0) < (missesOf.get(next) ?? 0)) next = peerKey;
  });
  return next;
}

function arm(hash, entry, peerKey) {
  const timeout = timeoutFor(peerKey, entry.attempts);
  const armedAt = Date.now();
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (Date.now() - armedAt - timeout > config.fluxapps.hashFetchLateMs) {
      arm(hash, entry, peerKey);
      return;
    }
    entry.timedOut.add(peerKey);
    entry.attempts += 1;
    // eslint-disable-next-line no-use-before-define
    askNext(hash, entry);
  }, timeout);
}

function ask(hash, entry, peerKey) {
  entry.asked = peerKey;
  entry.fallbacks.delete(peerKey);
  wiring.request(peerKey, hash);
  arm(hash, entry, peerKey);
}

function askNext(hash, entry) {
  const next = nextFallback(entry);
  if (next === null) {
    if (verifying.has(hash)) entry.asked = null;
    else clearFetch(hash, entry);
    return;
  }
  ask(hash, entry, next);
}

/**
 * A peer announced `hash`.
 * @param {string} hash
 * @param {string} peerKey
 */
function announced(hash, peerKey) {
  const entry = fetches.get(hash);
  if (entry) {
    if (entry.asked !== peerKey && !entry.timedOut.has(peerKey)) entry.fallbacks.add(peerKey);
    return;
  }
  if (verifying.has(hash)) {
    fetches.set(hash, {
      asked: null, fallbacks: new Set([peerKey]), timedOut: new Set(), timer: null, attempts: 0,
    });
    return;
  }
  if (wiring.seen(hash)) return;
  if (fetches.size >= config.fluxapps.hashFetchesMax) return;
  const created = {
    asked: null, fallbacks: new Set(), timedOut: new Set(), timer: null, attempts: 0,
  };
  fetches.set(hash, created);
  if (!missesOf.get(peerKey)) {
    ask(hash, created, peerKey);
    return;
  }
  created.fallbacks.add(peerKey);
  created.timer = setTimeout(() => {
    created.timer = null;
    // eslint-disable-next-line no-use-before-define
    askNext(hash, created);
  }, config.fluxapps.hashFetchBaseMs);
}

/**
 * A copy of `hash` is being verified.
 * @param {string} hash
 */
function verifyingCopy(hash) {
  verifying.add(hash);
}

/**
 * A copy of `hash` arrived from `peerKey` while another is verified: its sender
 * holds the message, or claims to, and is asked if the copy verified fails. A
 * peer that sent a copy has answered, so its timer stops.
 * @param {string} hash
 * @param {string} peerKey
 * @returns {boolean} Whether the sender was kept.
 */
function copyWhileVerifying(hash, peerKey) {
  if (!verifying.has(hash)) return false;
  const entry = fetches.get(hash) ?? {
    asked: null, fallbacks: new Set(), timedOut: new Set(), timer: null, attempts: 0,
  };
  fetches.set(hash, entry);
  entry.fallbacks.add(peerKey);
  entry.timedOut.delete(peerKey);
  if (entry.asked !== peerKey) return true;
  entry.asked = null;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  return true;
}

/**
 * The copy of `hash` from `peerKey` verified. Peers that were asked and timed
 * out are charged a miss: the message existed.
 * @param {string} hash
 * @param {string} peerKey
 */
function delivered(hash, peerKey) {
  verifying.delete(hash);
  const owed = missesOf.get(peerKey);
  if (owed > 1) missesOf.set(peerKey, owed - 1);
  else missesOf.delete(peerKey);
  const entry = fetches.get(hash);
  if (!entry) return;
  wiring.onServed(peerKey);
  entry.timedOut.forEach((missed) => {
    if (missed === peerKey) return;
    missesOf.set(missed, (missesOf.get(missed) ?? 0) + 1);
    wiring.onMiss(missed);
  });
  clearFetch(hash, entry);
}

/**
 * The copy of `hash` did not verify: the next fallback is asked at once.
 * @param {string} hash
 */
function rejected(hash) {
  verifying.delete(hash);
  const entry = fetches.get(hash);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  askNext(hash, entry);
}

/**
 * A peer's connection ended: it answers nothing more, and its misses go with it.
 * @param {string} peerKey
 */
function peerGone(peerKey) {
  missesOf.delete(peerKey);
  fetches.forEach((entry, hash) => {
    entry.fallbacks.delete(peerKey);
    if (entry.asked !== peerKey) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    askNext(hash, entry);
  });
}

/**
 * @param {object} next
 * @param {function(string, string): void} next.request Asks a peer for a hash.
 * @param {function(string): ?number} next.latencyOf A peer's one-way latency.
 * @param {function(string): boolean} next.seen Whether the node has the message.
 * @param {function(string): void} next.onMiss A peer was charged a miss.
 * @param {function(string): void} next.onServed A peer delivered what was fetched.
 */
function wire(next) {
  wiring = next;
}

/** Test seam. */
function reset() {
  fetches.forEach((entry) => { if (entry.timer) clearTimeout(entry.timer); });
  fetches.clear();
  verifying.clear();
  missesOf.clear();
}

module.exports = {
  announced, verifyingCopy, copyWhileVerifying, delivered, rejected, peerGone, timeoutFor, wire, reset,
};
