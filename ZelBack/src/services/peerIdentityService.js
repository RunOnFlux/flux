/**
 * Which Flux node answers when this node dials an address.
 *
 * Every node-to-node call is made to an address, and every answer is acted on as
 * that address's answer. Nothing on the wire says so. A router that forwards by
 * port alone - for traffic leaving the network as well as arriving - sends a call
 * for another node's address to a machine behind the same router, and that
 * machine answers in good faith: it holds no such app, its syncthing is this other
 * device, it is not running that component. Each answer is true of the node that
 * gave it and false of the address it is filed under.
 *
 * The answer here is signed by the node that gives it, over the address it holds
 * and a challenge only this call carries, and it is accepted as the dialled
 * address's answer only when the key that signed it is the one the deterministic
 * list holds at that address.
 *
 * A caller also introduces itself: the ask carries its own identity, signed for
 * the node it is asking. A node whose outgoing calls are redirected cannot learn
 * who its partners are by asking them, but its incoming calls arrive intact, and
 * a partner that asks it who it is has told it who the partner is.
 */

const crypto = require('node:crypto');
const axios = require('axios');
const config = require('config');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const syncthingService = require('./syncthingService');
const fluxEventBus = require('./utils/fluxEventBus');
const nodeSigner = require('./utils/nodeSigner');
const {
  extractIp, extractPort, normalizeSocketAddress, socketAddressesMatch,
} = require('./utils/socketAddressUtils');

/**
 * Names what the signature is over. The node's key signs other messages too,
 * and each of those is verified by rebuilding the signed text from the fields a
 * message carries. An identity answer carries none of their required fields -
 * no `target`, no `timestamp`, no `ports` - so no verifier of another kind can
 * accept one, and this field keeps it that way for any kind added later.
 */
const IDENTITY_PURPOSE = 'fluxnodeIdentity';

/**
 * Names what an introduction's signature is over. Its time and recipient are
 * `issuedAt` and `recipient`, never `timestamp` and `target`, which the verifiers
 * of node-to-node asks read - so an introduction cannot stand in for one.
 */
const INTRODUCTION_PURPOSE = 'fluxnodeIntroduction';

/**
 * Names what a signed answer to one question is over, so an answer to one
 * question cannot be read as an answer to another, or as an identity.
 */
const AnswerPurpose = Object.freeze({
  HELD_COMPONENTS: 'fluxnodeHeldComponents',
  PROMOTED_FOLDERS: 'fluxnodePromotedFolders',
});

/**
 * The challenge a caller sends, and the only caller-chosen text a node signs
 * here. Fixed shape so the signed message cannot be steered into anything but a
 * fresh random value.
 */
const CHALLENGE_PATTERN = /^[0-9a-f]{32}$/;

const IdentityVerdict = Object.freeze({
  // Signed by the node the deterministic list holds at the dialled address.
  VERIFIED: 'verified',
  // Signed by a listed node, and not the one listed at the dialled address.
  // Proof that the call reached another node: nothing but that node's key could
  // have produced the signature over this call's challenge.
  MISROUTED: 'misrouted',
  // An answer that proves nothing either way: a peer without the endpoint, one
  // that could not sign, an address the list does not yet hold.
  UNVERIFIABLE: 'unverifiable',
  // No answer at all.
  UNREACHABLE: 'unreachable',
});

const TIMEOUT_MS = config.fluxapps.peerIdentityTimeoutMs ?? 10 * 1000;

// How long each verdict is reused. A verified identity changes only when the
// address changes hands, so it is held longest. A misroute is rechecked soon,
// because the fault is on this node's side and its operator is expected to fix
// it. A peer too old to answer is not asked again every pass. Silence is held
// only briefly: long enough that a pass reaching one dead peer from several
// folders pays its timeout once.
const TTL_MS = Object.freeze({
  [IdentityVerdict.VERIFIED]: config.fluxapps.peerIdentityVerifiedTtlMs ?? 30 * 60 * 1000,
  [IdentityVerdict.MISROUTED]: config.fluxapps.peerIdentityMisroutedTtlMs ?? 2 * 60 * 1000,
  [IdentityVerdict.UNVERIFIABLE]: config.fluxapps.peerIdentityUnverifiableTtlMs ?? 10 * 60 * 1000,
  [IdentityVerdict.UNREACHABLE]: config.fluxapps.peerIdentityUnreachableTtlMs ?? 60 * 1000,
});

// How long an introduction is relied on. A partner introduces itself each time
// it verifies this node, which is once per verified TTL, so twice that spans one
// missed introduction.
const INTRODUCTION_TTL_MS = config.fluxapps.peerIdentityIntroductionTtlMs ?? 60 * 60 * 1000;

// How old an introduction may be when it arrives. It is signed for the call that
// carries it, so any delay beyond a request's own is a recording.
const INTRODUCTION_VALIDITY_MS = 60 * 1000;

// An identity answer is a few hundred bytes. Bounded because this address is
// only as trustworthy as whatever is answering on it.
const MAX_ANSWER_BYTES = 16 * 1024;

/**
 * @returns {number}
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * address -> { result, at }. One entry per dialled address, whatever asked.
 * @type {Map<string, {result: object, at: number}>}
 */
const verdicts = new Map();

// One request per address in flight, however many callers ask at once.
const inFlight = new Map();

/**
 * Introducer's address -> { identity, at }. What partners have proven about
 * themselves by calling in.
 * @type {Map<string, {identity: object, at: number}>}
 */
const introductions = new Map();

/**
 * This node's signed identity, addressed to the node it is about to ask, or null
 * when it cannot sign or does not know its own address.
 * @param {string} recipient Normalised address of the node being asked.
 * @returns {Promise<object|null>}
 */
async function introductionFor(recipient) {
  const socketAddress = await fluxNetworkHelper.getLocalSocketAddress();
  if (!socketAddress) return null;
  const signer = await nodeSigner.nodeSigner();
  if (!signer) return null;
  const deviceId = await syncthingService.getDeviceId().catch(() => null);
  const introduction = {
    purpose: INTRODUCTION_PURPOSE,
    socketAddress: normalizeSocketAddress(socketAddress),
    pubKey: signer.pubKey,
    deviceId: deviceId || null,
    recipient,
    issuedAt: Date.now(),
  };
  const signature = signer.sign(JSON.stringify(introduction));
  return signature ? { ...introduction, signature } : null;
}

/**
 * Record a caller's introduction when it proves itself: addressed to this node,
 * issued for this call, and signed by the key the list holds at the address it
 * names. Anything else is ignored - an introduction is an addition to an ask,
 * never a condition of answering it.
 * @param {object} introduction
 * @returns {Promise<boolean>} Whether it was recorded.
 */
async function acceptIntroduction(introduction) {
  if (!introduction || introduction.purpose !== INTRODUCTION_PURPOSE
    || typeof introduction.socketAddress !== 'string' || typeof introduction.recipient !== 'string') {
    return false;
  }
  const issuedAt = Number(introduction.issuedAt);
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || issuedAt < now - INTRODUCTION_VALIDITY_MS
    || issuedAt > now + fluxCommunicationUtils.BROADCAST_CLOCK_SKEW_MS) {
    return false;
  }
  const localSocketAddress = await fluxNetworkHelper.getLocalSocketAddress();
  if (!socketAddressesMatch(introduction.recipient, localSocketAddress)) return false;

  const introducer = normalizeSocketAddress(introduction.socketAddress);
  const proven = await fluxNetworkHelper.verifySignedFluxnodeMessage(introduction, { socketAddress: introducer });
  if (!proven) return false;

  introductions.set(introducer, {
    identity: { socketAddress: introducer, pubKey: introduction.pubKey, deviceId: introduction.deviceId || null },
    at: monotonicMs(),
  });
  fluxEventBus.count('peerIdentity:introduced', introducer, 'accepted');
  return true;
}

/**
 * What the node at `socketAddress` has proven about itself by calling in, while
 * that is recent enough to rely on.
 * @param {string} socketAddress
 * @returns {{socketAddress: string, pubKey: string, deviceId: string|null}|null}
 */
function introducedPeer(socketAddress) {
  const held = introductions.get(normalizeSocketAddress(socketAddress));
  if (!held || monotonicMs() - held.at >= INTRODUCTION_TTL_MS) return null;
  return held.identity;
}

/**
 * This node's identity, signed over the caller's challenge.
 *
 * @param {object} body The request body.
 * @param {string} body.challenge 32 lowercase hex characters.
 * @returns {Promise<object>} The signed answer.
 */
async function identityAnswer(body) {
  const challenge = body?.challenge;
  if (typeof challenge !== 'string' || !CHALLENGE_PATTERN.test(challenge)) {
    throw new Error('challenge must be 32 lowercase hex characters');
  }

  const socketAddress = await fluxNetworkHelper.getLocalSocketAddress();
  if (!socketAddress) throw new Error('This node does not know its own address yet');

  const signer = await nodeSigner.nodeSigner();
  if (!signer) throw new Error('This node cannot sign as itself');

  // Null while this node's syncthing has not answered. The identity stands
  // without it; a caller that needs the device asks again later.
  const deviceId = await syncthingService.getDeviceId().catch(() => null);

  await acceptIntroduction(body.introduction).catch((error) => {
    log.warn(`identityAnswer - could not judge the caller's introduction: ${error.message}`);
  });

  const answer = {
    purpose: IDENTITY_PURPOSE,
    socketAddress: normalizeSocketAddress(socketAddress),
    pubKey: signer.pubKey,
    deviceId: deviceId || null,
    challenge,
  };
  const signature = signer.sign(JSON.stringify(answer));
  if (!signature) throw new Error('This node could not sign its identity');

  return { ...answer, signature };
}

/**
 * `fields` as this node's answer to one call, signed over the caller's challenge
 * and the purpose that names the question.
 *
 * @param {string} purpose One of AnswerPurpose.
 * @param {string} challenge 32 lowercase hex characters.
 * @param {object} fields The answer.
 * @returns {Promise<object>} The signed answer.
 */
async function signedAnswer(purpose, challenge, fields) {
  if (typeof challenge !== 'string' || !CHALLENGE_PATTERN.test(challenge)) {
    throw new Error('challenge must be 32 lowercase hex characters');
  }

  const socketAddress = await fluxNetworkHelper.getLocalSocketAddress();
  if (!socketAddress) throw new Error('This node does not know its own address yet');

  const signer = await nodeSigner.nodeSigner();
  if (!signer) throw new Error('This node cannot sign as itself');

  const answer = {
    ...fields,
    purpose,
    socketAddress: normalizeSocketAddress(socketAddress),
    pubKey: signer.pubKey,
    challenge,
  };
  const signature = signer.sign(JSON.stringify(answer));
  if (!signature) throw new Error('This node could not sign its answer');

  return { ...answer, signature };
}

/**
 * What a handler applies to its answer before sending it: signed when the request
 * carries a challenge, and as it is when it carries none.
 *
 * @param {string} purpose One of AnswerPurpose.
 * @param {object} body The request body.
 * @returns {function(object): Promise<object>}
 */
function answerSealer(purpose, body) {
  const challenge = body?.challenge;
  return async (fields) => (challenge === undefined ? fields : signedAnswer(purpose, challenge, fields));
}

/**
 * POST /flux/identity
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>}
 */
async function identityAnswerAPI(req, res) {
  try {
    const answer = await identityAnswer(serviceHelper.ensureObject(req.body));
    return res.json(messageHelper.createDataMessage(answer));
  } catch (error) {
    log.warn(`identityAnswer - ${error.message}`);
    return res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
  }
}

/**
 * Judge one answer against the address it was asked of.
 *
 * @param {string} dialled The address that was dialled.
 * @param {string} challenge What this call sent.
 * @param {object} answer The `data` of the reply.
 * @param {string} [purpose] What the answer must be signed as.
 * @returns {Promise<object>} A verdict result.
 */
async function judgeAnswer(dialled, challenge, answer, purpose = IDENTITY_PURPOSE) {
  if (!answer || answer.purpose !== purpose || answer.challenge !== challenge
    || typeof answer.socketAddress !== 'string') {
    return { verdict: IdentityVerdict.UNVERIFIABLE, reason: 'the answer is not signed for this call' };
  }

  const atDialled = await fluxNetworkHelper.verifySignedFluxnodeMessage(answer, { socketAddress: dialled });
  if (atDialled) {
    return {
      verdict: IdentityVerdict.VERIFIED,
      identity: { socketAddress: dialled, pubKey: answer.pubKey, deviceId: answer.deviceId || null },
    };
  }

  // Misrouted only when BOTH ends are established: the dialled address is a
  // node the list holds, and the answer is provably another listed node's.
  // A dialled address missing from the list is an address change the list has
  // not caught up with, and the node answering may well be the one that moved.
  const dialledListed = await fluxCommunicationUtils.socketAddressInFluxList(dialled);
  const answeredAs = normalizeSocketAddress(answer.socketAddress);
  const signedAtClaim = !socketAddressesMatch(answeredAs, dialled)
    && await fluxNetworkHelper.verifySignedFluxnodeMessage(answer, { socketAddress: answeredAs });

  if (dialledListed && signedAtClaim) {
    return { verdict: IdentityVerdict.MISROUTED, answeredAs };
  }
  return { verdict: IdentityVerdict.UNVERIFIABLE, reason: 'the signature does not bind the answer to any listed address' };
}

/**
 * Ask one address who it is.
 *
 * @param {string} dialled Normalised socket address.
 * @returns {Promise<object>} A verdict result.
 */
async function askIdentity(dialled) {
  const challenge = crypto.randomBytes(16).toString('hex');
  const url = `http://${extractIp(dialled)}:${extractPort(dialled)}/flux/identity`;
  const introduction = await introductionFor(dialled).catch(() => null);

  let response;
  try {
    response = await axios.post(url, introduction ? { challenge, introduction } : { challenge }, {
      timeout: TIMEOUT_MS,
      maxContentLength: MAX_ANSWER_BYTES,
      maxBodyLength: MAX_ANSWER_BYTES,
    });
  } catch (error) {
    // A status is an answer from something alive that cannot say who it is:
    // a node too old for the endpoint answers 404.
    if (error.response) {
      return { verdict: IdentityVerdict.UNVERIFIABLE, reason: `answered ${error.response.status}` };
    }
    return { verdict: IdentityVerdict.UNREACHABLE, reason: error.message };
  }

  if (response.data?.status !== 'success') {
    return { verdict: IdentityVerdict.UNVERIFIABLE, reason: response.data?.data?.message || 'refused' };
  }
  return judgeAnswer(dialled, challenge, response.data.data);
}

/**
 * Hold a verdict for every later caller.
 *
 * @param {string} dialled Normalised socket address.
 * @param {object} result A verdict result.
 * @returns {void}
 */
function recordVerdict(dialled, result) {
  verdicts.set(dialled, { result, at: monotonicMs() });
  fluxEventBus.count('peerIdentity:verdict', dialled, result.verdict);
  if (result.verdict === IdentityVerdict.MISROUTED) {
    log.warn(`peerIdentity - a call to ${dialled} was answered by ${result.answeredAs}; `
      + 'this node\'s outbound traffic to that address reaches a different Flux node');
  }
}

/**
 * Ask, and hold what was learned for every later caller.
 *
 * @param {string} dialled Normalised socket address.
 * @returns {Promise<object>} A verdict result.
 */
async function askAndRecord(dialled) {
  let result;
  try {
    result = await askIdentity(dialled);
  } catch (error) {
    result = { verdict: IdentityVerdict.UNVERIFIABLE, reason: error.message };
  }
  recordVerdict(dialled, result);
  return result;
}

/**
 * Which node answers at `socketAddress`.
 *
 * @param {string} socketAddress The address a caller is about to act on.
 * @param {{fresh?: boolean}} [options] `fresh` asks again whatever is held.
 * @returns {Promise<{verdict: string, identity?: object, answeredAs?: string, reason?: string}>}
 */
async function verifyPeer(socketAddress, options = {}) {
  const dialled = normalizeSocketAddress(socketAddress);
  if (!dialled) return { verdict: IdentityVerdict.UNVERIFIABLE, reason: 'no address' };

  if (!options.fresh) {
    const held = verdicts.get(dialled);
    if (held && monotonicMs() - held.at < TTL_MS[held.result.verdict]) return held.result;
    const pending = inFlight.get(dialled);
    if (pending) return pending;
  }

  const asking = askAndRecord(dialled);
  inFlight.set(dialled, asking);
  try {
    return await asking;
  } finally {
    if (inFlight.get(dialled) === asking) inFlight.delete(dialled);
  }
}

/**
 * A reply that does not prove it came from the node at `dialled`.
 *
 * The node the list holds at an address either proves who it is or cannot:
 * `mayReadUnsigned` is true only when it cannot, and then an unsigned read is
 * all there is to act on. A node that can prove itself and whose reply does
 * not was not the node that replied.
 *
 * @param {string} dialled Normalised socket address.
 * @param {{status: number, data: *}} reply What came back.
 * @returns {Promise<object>} A verdict result.
 */
async function unprovenReply(dialled, reply) {
  const identity = await verifyPeer(dialled);
  if (identity.verdict === IdentityVerdict.MISROUTED) return identity;
  return {
    verdict: IdentityVerdict.UNVERIFIABLE,
    ...reply,
    mayReadUnsigned: identity.verdict === IdentityVerdict.UNVERIFIABLE,
  };
}

/**
 * Ask the node at `socketAddress` a question it answers signed, and judge the
 * answer against that address.
 *
 * Every answer is proven on its own, over a challenge only this call carries,
 * so nothing proven of an earlier call vouches for this one. A misroute it
 * shows is held for every later caller.
 *
 * @param {string} socketAddress The address to ask.
 * @param {string} path The endpoint, e.g. /apps/heldcomponents.
 * @param {string} purpose One of AnswerPurpose.
 * @param {object|function(string): Promise<object>} [body] Whatever else the
 *   question carries, or what builds it from this call's challenge - for a body
 *   the caller signs, whose signature has to cover the challenge it is sent with.
 * @param {{timeout?: number}} [options]
 * @returns {Promise<object>} VERIFIED with the `answer`; MISROUTED with
 *   `answeredAs`; UNREACHABLE when nothing replied; else UNVERIFIABLE with the
 *   reply's `status` and `data`, and `mayReadUnsigned`.
 */
async function askSigned(socketAddress, path, purpose, body = {}, options = {}) {
  const dialled = normalizeSocketAddress(socketAddress);
  if (!dialled) return { verdict: IdentityVerdict.UNVERIFIABLE, reason: 'no address', mayReadUnsigned: false };

  const challenge = crypto.randomBytes(16).toString('hex');
  const url = `http://${extractIp(dialled)}:${extractPort(dialled)}${path}`;
  const fields = typeof body === 'function' ? await body(challenge) : body;
  let response;
  try {
    response = await axios.post(url, { ...fields, challenge }, { timeout: options.timeout ?? TIMEOUT_MS });
  } catch (error) {
    if (!error.response) return { verdict: IdentityVerdict.UNREACHABLE, reason: error.message };
    return unprovenReply(dialled, { status: error.response.status, data: error.response.data });
  }

  if (response.data?.status === 'success') {
    const answer = response.data.data;
    const judged = await judgeAnswer(dialled, challenge, answer, purpose).catch((error) => ({
      verdict: IdentityVerdict.UNVERIFIABLE, reason: error.message,
    }));
    if (judged.verdict === IdentityVerdict.VERIFIED) return { verdict: IdentityVerdict.VERIFIED, answer };
    if (judged.verdict === IdentityVerdict.MISROUTED) {
      recordVerdict(dialled, judged);
      return judged;
    }
  }
  return unprovenReply(dialled, { status: response.status, data: response.data });
}

/**
 * Forget every held verdict.
 * @returns {void}
 */
function clearVerdicts() {
  verdicts.clear();
  inFlight.clear();
  introductions.clear();
}

module.exports = {
  AnswerPurpose,
  IDENTITY_PURPOSE,
  INTRODUCTION_PURPOSE,
  IdentityVerdict,
  acceptIntroduction,
  answerSealer,
  askSigned,
  clearVerdicts,
  identityAnswer,
  identityAnswerAPI,
  introducedPeer,
  signedAnswer,
  verifyPeer,
};
