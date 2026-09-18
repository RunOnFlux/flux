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
 * WHICH INTENTS A TYPE MAY HAVE IS DECLARED IN messageRoutes, AND THE MESSAGE
 * ONLY CHOOSES WHERE THE TYPE ALLOWS IT TO. `fluxpolicyseq` is an announcement
 * when a node tells its peers what it adopted, and an answer when it settles a
 * peer's ask; that type sits in two rows and is declared VARIES, so the marker
 * in `data` decides. Every other type has one row, so its declaration is the
 * answer and a marker on it is ignored.
 *
 * That split is what keeps the filter honest. The marker is inside the signed
 * payload, so it survives every relay: a type that is relayed onward and also
 * takes its intent from the message would let any node that can sign one put an
 * undeduplicated message into the network, and each honest node would announce
 * it again to every peer for as long as its timestamp stayed valid.
 *
 * DELIVERY IS A SEPARATE AXIS, AND IT IS NOT THE CLASSIFIER. `fluxapprequest` is
 * an ask delivered by broadcast, and it is declared ASK.
 *
 * The marker rides inside `data`, so it is covered by the signature and needs no
 * change to the envelope or its preimage. Announcements carry none: they are the
 * default, and leaving them unmarked keeps `hash(data)` - the content address
 * every node computes for the hash-announce protocol - byte-identical to what a
 * node that predates this classifier computes for the same message.
 */
const INTENT = Object.freeze({
  ANNOUNCE: 'announce',
  ASK: 'ask',
  ANSWER: 'answer',
  /**
   * Not an intent a message can be: the type saying it is sent both ways, so the
   * marker in `data` decides and an unmarked message is an announcement. Only a
   * type that is never relayed onward may be declared this.
   */
  VARIES: 'varies',
});

const CLAIMABLE = Object.freeze(new Set([INTENT.ANNOUNCE, INTENT.ASK, INTENT.ANSWER]));

/**
 * The intent of a received message.
 *
 * Runs before verification, on whatever a peer sent, so anything unrecognised
 * reads as an announcement - the row that costs the sender rather than us.
 * @param {object} msgObj Parsed message object.
 * @param {string} declared The type's declared intent, from messageRoutes.
 * @returns {string} One of INTENT, never VARIES.
 */
function intentOf(msgObj, declared) {
  if (declared !== INTENT.VARIES) {
    return CLAIMABLE.has(declared) ? declared : INTENT.ANNOUNCE;
  }
  const data = msgObj && msgObj.data;
  if (!data || typeof data !== 'object') return INTENT.ANNOUNCE;
  return CLAIMABLE.has(data.intent) ? data.intent : INTENT.ANNOUNCE;
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
  CLAIMABLE,
  intentOf,
  newCorrelationId,
};
