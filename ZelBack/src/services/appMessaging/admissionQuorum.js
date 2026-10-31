// Admitting an unpaid app message by a write quorum.
//
// The node a client submits to (the entry node) admits an unpaid registration or
// update only while it holds admissionQuorum authenticated Arcane links on
// distinct IPs, and tells the client success only once peers on admissionQuorum
// distinct IPs hold the message. Until then nothing is stored or relayed
// anywhere, so a submission that fails leaves nothing on the network:
//
//   1. the entry node signs the message and sends it, as `appproposal`, to each
//      authenticated peer;
//   2. each peer answers `received` at once, runs every check it holds a network
//      message to, keeps it pending and answers `held`, or `refused` with why;
//   3. with `held` from admissionQuorum distinct IPs inside admissionTimeoutMs the
//      entry node sends `appcommit`, writes its own copy, sends the message to its
//      unauthenticated peers and answers success. Each peer writes the message on
//      the commit and relays it as any other.
//   4. otherwise nothing is committed: the entry node answers failure and each
//      peer drops its pending copy after admissionHoldMs.
//
// All three messages travel only in frames carrying a valid link MAC
// (FluxPeerSocket), so no other node can propose, hold or commit.

const config = require('config');
const { peerManager } = require('../utils/peerState');
const { serialiseAndSignFluxBroadcast } = require('../utils/fluxBroadcastHelper');
const fluxEventBus = require('../utils/fluxEventBus');
const unpaidAdmission = require('./unpaidAdmission');
const { insertTemporaryMessage, holdsTemporaryMessage } = require('./temporaryMessageRecord');

const PROPOSAL = 'appproposal';
const RECEIPT = 'appreceipt';
const COMMIT = 'appcommit';

const RECEIPT_STATE = Object.freeze({
  // The peer has the message and is checking it.
  RECEIVED: 'received',
  // The peer has checked the message and holds it.
  HELD: 'held',
  REFUSED: 'refused',
});

const MESSAGE_HASH = /^[0-9a-f]{64}$/;
const REASON_MAX = 300;

/**
 * Refused at the door: this node cannot admit unpaid messages now. Another node
 * may.
 */
class AdmissionUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdmissionUnavailable';
  }
}

// The entry node's open rounds, by message hash.
const rounds = new Map();
// The entry node's admissions in progress, by message hash, each settling once
// its message is committed and stored, or refused.
const admitting = new Map();
// A peer's pending copies awaiting a commit, by message hash.
const holds = new Map();

function isMessageHash(hash) {
  return typeof hash === 'string' && MESSAGE_HASH.test(hash);
}

/**
 * Refuse at the door unless this node holds admissionQuorum authenticated links
 * on distinct IPs. A legacy node never does.
 */
function requireQuorum() {
  const { admissionQuorum } = config.fluxapps;
  const count = peerManager.authenticatedIpCount();
  if (count < admissionQuorum) {
    throw new AdmissionUnavailableError(`This Flux node cannot admit app messages now: it holds authenticated links to ${count} of the ${admissionQuorum} nodes it needs. Try another node.`);
  }
}

function sendReceipt(peer, hash, state, reason) {
  const receipt = { type: RECEIPT, hash, state };
  if (reason) receipt.reason = String(reason).slice(0, REASON_MAX);
  peer.send(JSON.stringify(receipt));
}

// How long a proposed peer may go without answering before it no longer counts.
function silenceBoundMs(peer) {
  return Math.max(4 * (peer.latency ?? 0), 1000);
}

function settle(round, outcome) {
  if (round.settled) return;
  round.settled = true;
  clearTimeout(round.timeout);
  round.members.forEach((member) => clearTimeout(member.timer));
  round.finish(outcome);
}

function decide(round) {
  if (round.settled) return;
  const { admissionQuorum } = config.fluxapps;
  if (round.heldIps.size >= admissionQuorum) {
    settle(round, { ok: true });
    return;
  }
  const reachable = new Set(round.heldIps);
  round.members.forEach((member) => {
    if (member.state === 'sent' || member.state === RECEIPT_STATE.RECEIVED) reachable.add(member.ip);
  });
  if (reachable.size < admissionQuorum) {
    settle(round, { ok: false, reasons: round.reasons });
  }
}

function armSilence(round, member) {
  clearTimeout(member.timer);
  member.timer = setTimeout(() => {
    if (member.state !== 'sent' && member.state !== RECEIPT_STATE.RECEIVED) return;
    member.state = 'silent';
    decide(round);
  }, silenceBoundMs(member.peer));
}

function failureMessage(outcome) {
  const { admissionQuorum } = config.fluxapps;
  if (outcome.reasons?.length) {
    return `The network refused this app message: ${[...new Set(outcome.reasons)].join('; ')}`;
  }
  return `The network did not confirm this app message on ${admissionQuorum} nodes. Nothing was stored. Try again later.`;
}

/**
 * Run one round: propose to every authenticated peer and wait for the quorum.
 * @returns {Promise<{ok: boolean, reasons?: string[], members: Map}>}
 */
async function runRound(hash, envelope) {
  const { admissionTimeoutMs } = config.fluxapps;
  const round = {
    hash, members: new Map(), heldIps: new Set(), reasons: [], settled: false,
  };
  const finished = new Promise((resolve) => { round.finish = resolve; });
  rounds.set(hash, round);
  try {
    const proposal = JSON.stringify({ type: PROPOSAL, envelope });
    peerManager.getAuthenticatedPeers().forEach((peer) => {
      const member = {
        peer, ip: peer.ip, state: 'sent', timer: null,
      };
      round.members.set(peer.connectionId, member);
      if (peer.send(proposal)) armSilence(round, member);
      else member.state = 'gone';
    });
    round.timeout = setTimeout(() => settle(round, { ok: false, reasons: round.reasons }), admissionTimeoutMs);
    decide(round);
    const outcome = await finished;
    return { ...outcome, members: round.members };
  } finally {
    rounds.delete(hash);
  }
}

/**
 * Admit an unpaid app message this node has validated in full: propose it, and
 * on the quorum commit it, store it and send it to every other peer.
 * @param {object} message As unpaidAdmission.admittedMessage builds it.
 * @param {{daemonHeight: number}} context
 * @returns {Promise<void>} Rejects when the network did not take it; nothing is
 *   then stored here or committed anywhere.
 */
async function admit(message, { daemonHeight }) {
  const inProgress = admitting.get(message.hash);
  if (inProgress) return inProgress;
  const admission = admitOnce(message, { daemonHeight });
  admitting.set(message.hash, admission);
  try {
    return await admission;
  } finally {
    admitting.delete(message.hash);
  }
}

async function admitOnce(message, { daemonHeight }) {
  requireQuorum();
  const signed = await serialiseAndSignFluxBroadcast(message);
  if (!signed) throw new Error('This Flux node cannot sign app messages now. Try another node.');
  const envelope = JSON.parse(signed);
  // Asked of the frame's own message: admission takes a frame as the admitting
  // node's only when it carries that message.
  const admission = await unpaidAdmission.admitUnpaid(envelope.data, { frame: envelope, daemonHeight });
  if (admission.refused) throw new Error(`The network will not take this app message: ${admission.refused}`);

  const outcome = await runRound(message.hash, envelope);
  const heldBy = [...outcome.members.values()].filter((member) => member.state === RECEIPT_STATE.HELD).length;
  fluxEventBus.publish('appmessage:quorum', {
    hash: message.hash, committed: outcome.ok, heldBy, reasons: outcome.reasons ?? [],
  });
  if (!outcome.ok) throw new Error(failureMessage(outcome));

  const commit = JSON.stringify({ type: COMMIT, hash: message.hash });
  // A peer holding nothing for this hash ignores it.
  outcome.members.forEach((member) => member.peer.send(commit));
  await insertTemporaryMessage(message, admission.fields);
  peerManager.getUnauthenticatedPeers().forEach((peer) => peer.send(signed));
}

/**
 * Whether a message with this hash is already admitted: held here, or being
 * admitted by this node now, in which case this waits for that admission and
 * rejects as it does.
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function alreadyAdmitted(hash) {
  const inProgress = admitting.get(hash);
  if (inProgress) {
    await inProgress;
    return true;
  }
  return holdsTemporaryMessage(hash);
}

/**
 * A peer's receipt for a message this node proposed.
 * @param {object} peer
 * @param {object} receipt
 */
function onReceipt(peer, receipt) {
  const round = rounds.get(receipt?.hash);
  const member = round?.members.get(peer.connectionId);
  if (!member) return;
  if (member.state === RECEIPT_STATE.HELD || member.state === RECEIPT_STATE.REFUSED) return;
  if (receipt.state === RECEIPT_STATE.RECEIVED && member.state === 'sent') {
    member.state = RECEIPT_STATE.RECEIVED;
    armSilence(round, member);
  } else if (receipt.state === RECEIPT_STATE.HELD) {
    clearTimeout(member.timer);
    member.state = RECEIPT_STATE.HELD;
    round.heldIps.add(member.ip);
  } else if (receipt.state === RECEIPT_STATE.REFUSED) {
    clearTimeout(member.timer);
    member.state = RECEIPT_STATE.REFUSED;
    round.reasons.push(typeof receipt.reason === 'string' ? receipt.reason.slice(0, REASON_MAX) : 'no reason given');
  }
  decide(round);
}

/**
 * A proposed peer's connection closed.
 * @param {number} connectionId
 */
function onPeerGone(connectionId) {
  rounds.forEach((round) => {
    const member = round.members.get(connectionId);
    if (!member || member.state === RECEIPT_STATE.HELD || member.state === RECEIPT_STATE.REFUSED) return;
    clearTimeout(member.timer);
    member.state = 'gone';
    decide(round);
  });
  holds.forEach((entry) => {
    entry.committers.delete(connectionId);
    // eslint-disable-next-line no-param-reassign
    entry.proposers = entry.proposers.filter((proposer) => proposer.connectionId !== connectionId);
  });
}

// A proposal this peer is checking or holds, from its first proposer's arrival
// until a commit writes it, a refusal ends it, or admissionHoldMs passes.
function proposalAnswer(entry, state, reason) {
  entry.proposers.forEach((proposer) => sendReceipt(proposer, entry.hash, state, reason));
}

function closeProposal(hash, entry, written) {
  clearTimeout(entry.timer);
  holds.delete(hash);
  entry.resolve?.(written);
}

/**
 * A proposal arrived. The first for its hash opens the entry this peer answers
 * every proposer of it from, and is the one whose checks run; a later one joins
 * it, and is answered `held` at once when the checks have already passed.
 * @param {string} hash
 * @param {object} peer The proposer.
 * @returns {boolean|null} True for the first, false for one that joined, null
 *   when this peer holds as many proposals as it takes (it has answered refused).
 */
function openProposal(hash, peer) {
  const { admissionHoldMs, admissionHoldMax } = config.fluxapps;
  const entry = holds.get(hash);
  if (entry) {
    entry.committers.add(peer.connectionId);
    entry.proposers.push(peer);
    if (entry.held) sendReceipt(peer, hash, RECEIPT_STATE.HELD);
    return false;
  }
  if (holds.size >= admissionHoldMax) {
    sendReceipt(peer, hash, RECEIPT_STATE.REFUSED, 'this node holds as many pending proposals as it takes');
    return null;
  }
  const opened = {
    hash, committers: new Set([peer.connectionId]), proposers: [peer], held: false, committed: false, resolve: null,
  };
  opened.timer = setTimeout(() => closeProposal(hash, opened, false), admissionHoldMs);
  holds.set(hash, opened);
  return true;
}

/**
 * The proposal's checks passed: answer every proposer `held`. Resolves true when
 * one of them commits - at once if its commit arrived during the checks - and
 * false when admissionHoldMs passes first.
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
function hold(hash) {
  const entry = holds.get(hash);
  if (!entry) return Promise.resolve(false);
  entry.held = true;
  proposalAnswer(entry, RECEIPT_STATE.HELD);
  if (entry.committed) {
    closeProposal(hash, entry, true);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => { entry.resolve = resolve; });
}

/**
 * The proposal was refused, or the message is already held here: answer every
 * proposer and close the entry.
 * @param {string} hash
 * @param {string} state RECEIPT_STATE.REFUSED or RECEIPT_STATE.HELD.
 * @param {string} [reason]
 */
function answerProposal(hash, state, reason) {
  const entry = holds.get(hash);
  if (!entry) return;
  proposalAnswer(entry, state, reason);
  closeProposal(hash, entry, false);
}

function commitPending(hash, entry) {
  if (entry.resolve) closeProposal(hash, entry, true);
  else entry.committed = true;
}

/**
 * The commit of a message this peer was proposed, from a node that proposed it.
 * A commit that arrives while the checks still run is kept for when they pass.
 * @param {object} peer
 * @param {object} msg
 */
function onCommit(peer, msg) {
  const entry = holds.get(msg?.hash);
  if (!entry || !entry.committers.has(peer.connectionId)) return;
  commitPending(msg.hash, entry);
}

/**
 * Whether a relayed copy of a message is already in hand here: this node is
 * admitting it and writes it at its commit, or was proposed it. Only a committed
 * copy is relayed over an authenticated link, so such a relay commits the
 * proposal.
 * @param {string} hash
 * @param {boolean} authenticated Whether the relay arrived over an authenticated link.
 * @returns {boolean} True when the relay is not to be stored.
 */
function takeRelay(hash, authenticated) {
  if (admitting.has(hash)) return true;
  const entry = holds.get(hash);
  if (!entry) return false;
  if (authenticated) commitPending(hash, entry);
  return true;
}

peerManager.on('peerDisconnected', (_key, connectionId) => onPeerGone(connectionId));

/** Test seam: settle every round and drop every hold. */
function resetState() {
  rounds.forEach((round) => settle(round, { ok: false, reasons: [] }));
  rounds.clear();
  admitting.clear();
  holds.forEach((entry, hash) => closeProposal(hash, entry, false));
}

module.exports = {
  PROPOSAL,
  RECEIPT,
  COMMIT,
  RECEIPT_STATE,
  AdmissionUnavailableError,
  isMessageHash,
  requireQuorum,
  admit,
  alreadyAdmitted,
  sendReceipt,
  onReceipt,
  onPeerGone,
  openProposal,
  hold,
  answerProposal,
  onCommit,
  takeRelay,
  resetState,
};
