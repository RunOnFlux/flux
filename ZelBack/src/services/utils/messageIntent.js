const crypto = require('crypto');

/**
 * How a message travels, and what the transport owes it.
 *
 * A type declares one of these in messageRoutes, and that declaration is the whole
 * of the answer - a message says nothing about how it should be treated, and is
 * not asked.
 *
 *   intent    | relay onward | dedup              | retain
 *   ----------|--------------|--------------------|---------------------------
 *   announce  | yes, once    | yes, on hash(data) | yes, once it is announced
 *   ask       | no           | never              | no
 *   answer    | no           | never              | no
 *   varies    | no           | never              | no
 *
 * DEDUP IS THE ROW THAT DECIDES THE DESIGN. An announcement is a fact about the
 * network and reaches a node by many routes, so two copies are one fact and acting
 * once is the point. Everything else is about the two nodes exchanging it - the
 * sender is part of the meaning, and `hash(data)` is the one part of a message that
 * throws the sender away. Two peers answering "seq 5", or two peers offering it,
 * are byte-identical; a filter keyed on content alone delivers the first and
 * silently drops the rest, and for an offer that discards the only thing it says.
 *
 * VARIES IS A TYPE SENT IN BOTH DIRECTIONS, and it is never relayed - messageRoutes
 * permits the declaration on nothing else. `fluxpolicyseq` is the one: a node
 * telling its peers what it adopted, and a node settling a peer's ask. Both are
 * point to point, so neither can reach this node twice by different routes, and
 * neither is filtered.
 *
 * WHY THE TYPE DECIDES AND NOT THE MESSAGE. A type that is relayed onward and also
 * took its intent from the message would let any node that can sign one put an
 * undeduplicated message into the network, and each honest node would announce it
 * again to every peer for as long as its timestamp stayed valid. So the only thing
 * that can opt a message out of the filter is the routing table, which is this
 * node's own.
 *
 * DELIVERY IS A SEPARATE AXIS, AND IT IS NOT THE CLASSIFIER. `fluxapprequest` is an
 * ask delivered by broadcast, and it is declared ASK.
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
  newCorrelationId,
};
