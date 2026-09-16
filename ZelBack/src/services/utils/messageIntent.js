const crypto = require('crypto');

/**
 * How a message travels, and what the transport owes it.
 *
 * Every message carries one of three intents, and the intent answers all three
 * questions the transport has about it:
 *
 *   intent    | relay onward | dedup              | retain
 *   ----------|--------------|--------------------|---------------------------
 *   announce  | yes, once    | yes, on hash(data) | yes, once it is announced
 *   ask       | no           | never              | no
 *   answer    | no           | never              | no
 *
 * Dedup is the row that decides the design. An announcement is a fact about the
 * network and reaches a node by many routes, so two copies are one fact and
 * acting once is the point. An ask and an answer are about the two nodes
 * exchanging them - the sender is part of the meaning, and `hash(data)` is the
 * one part of the message that throws the sender away. Two peers answering
 * "seq 5" are byte-identical, so a filter keyed on content alone delivers the
 * first and silently drops the rest.
 *
 * DELIVERY IS A SEPARATE AXIS, AND IT IS NOT THE CLASSIFIER. `fluxapprequest` is
 * an ask delivered by broadcast. `fluxpolicyseq` is an announcement when a node
 * tells its peers what it adopted, and an answer when it settles a peer's ask.
 * A type sits in two rows at once, which is why the intent travels with the
 * message instead of being looked up from its name.
 *
 * The intent rides inside `data`, so it is covered by the signature and needs no
 * change to the envelope or its preimage. Announcements carry no marker: they
 * are the default, and leaving them unmarked keeps `hash(data)` - the content
 * address every node computes for the hash-announce protocol - byte-identical
 * to what a node that predates this classifier computes for the same message.
 *
 * An intent a peer gets wrong costs that peer and not this node. Claiming `ask`
 * for an announcement forgoes dedup, so the handler runs again on a message the
 * database already refuses; claiming `announce` for an ask lets another peer's
 * identical ask suppress it. Neither reaches past the per-peer token bucket in
 * FluxPeerSocket, which is what actually bounds inbound work.
 */
const INTENT = Object.freeze({
  ANNOUNCE: 'announce',
  ASK: 'ask',
  ANSWER: 'answer',
});

const INTENTS = Object.freeze(new Set(Object.values(INTENT)));

/**
 * What an unmarked message means, for peers that do not send the marker yet.
 *
 * Only the three types whose intent is unambiguous from the name alone.
 * `fluxpolicyseq` is deliberately absent: unmarked, there is no way to tell an
 * adoption announcement from an answer, and reading it as an announcement is
 * what a node without this classifier does. Retire this map when the version
 * floor is past the release that first sends the marker.
 */
const UNMARKED_INTENTS = Object.freeze(new Map([
  ['fluxapprequest', INTENT.ASK],
  ['fluxpolicyrequest', INTENT.ASK],
  ['fluxpolicy', INTENT.ANSWER],
]));

/**
 * The intent of a received message.
 * @param {object} msgObj Parsed message object.
 * @returns {string} One of INTENT.
 */
function intentOf(msgObj) {
  const data = msgObj && msgObj.data;
  if (!data || typeof data !== 'object') return INTENT.ANNOUNCE;
  if (INTENTS.has(data.intent)) return data.intent;
  return UNMARKED_INTENTS.get(data.type) || INTENT.ANNOUNCE;
}

/**
 * An identifier for one ask, echoed by the answer that settles it.
 *
 * This is what makes an answer unique per ask rather than per payload, so two
 * peers answering the same question can never collapse into one message. It
 * also lets an answer be routed to the ask that is waiting for it instead of
 * being matched by guessing from the sending peer.
 * @returns {string}
 */
function newCorrelationId() {
  return crypto.randomBytes(12).toString('hex');
}

module.exports = {
  INTENT,
  intentOf,
  newCorrelationId,
  UNMARKED_INTENTS,
};
