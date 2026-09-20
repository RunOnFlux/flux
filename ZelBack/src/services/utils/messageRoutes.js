const { INTENT, CLAIMABLE } = require('./messageIntent');

/**
 * Where a message goes: which handler takes it, which pipeline carries it, and what it
 * is allowed to be.
 *
 * One declaration per type. Every part of the transport that has to know about a type
 * reads it from here, so none of them keeps a list of its own and a type cannot be
 * reachable by one and invisible to another.
 *
 * Both are required. A type whose intent is not stated is a type whose dedup behaviour
 * nobody decided, and the one way that goes wrong - a relayed type taking its intent
 * from the signed payload - puts an undeduplicated message into the whole network. The
 * signature is the guard, so adding a type means answering the question.
 */
const ROUTE = Object.freeze({
  // Deduplicated and verified, then handed over.
  GOSSIP: 'gossip',
  // Straight to the per-peer queue: position carries meaning, so nothing that can
  // reorder may sit in front of it.
  ORDERED: 'ordered',
});

const routes = new Map();

/**
 * Declare who takes a message type, how it travels, and what it may be.
 * @param {string|string[]} types Wire type, or several sharing one handler.
 * @param {Function} handler Takes (msgObj, peerSocket).
 * @param {string} route One of ROUTE.
 * @param {string} intent One of INTENT, including VARIES for a type sent both ways.
 */
function register(types, handler, route, intent) {
  if (route !== ROUTE.GOSSIP && route !== ROUTE.ORDERED) {
    throw new Error(`messageRoutes: ${types} declares no route`);
  }
  if (intent !== INTENT.VARIES && !CLAIMABLE.has(intent)) {
    throw new Error(`messageRoutes: ${types} declares no intent`);
  }
  const list = Array.isArray(types) ? types : [types];
  list.forEach((type) => routes.set(type, { handler, route, intent }));
}

/**
 * What a type is allowed to be, which is what decides whether the message itself
 * gets a say. An unknown type is an announcement: it has no handler, so it is
 * dropped either way, and deduplicating it first costs the sender rather than us.
 * @param {string} type
 * @returns {string} One of INTENT.
 */
function declaredIntent(type) {
  const entry = routes.get(type);
  return entry ? entry.intent : INTENT.ANNOUNCE;
}

/**
 * The handler for a type, or null when nothing claims it.
 * @param {string} type
 * @returns {Function|null}
 */
function handlerFor(type) {
  const entry = routes.get(type);
  return entry ? entry.handler : null;
}

/**
 * Whether a type must keep its arrival order.
 * @param {string} type
 * @returns {boolean}
 */
function isOrdered(type) {
  const entry = routes.get(type);
  return Boolean(entry) && entry.route === ROUTE.ORDERED;
}

/** Every declared type, for the guards that assert the table is populated. */
function registeredTypes() {
  return [...routes.keys()];
}

module.exports = {
  ROUTE,
  register,
  declaredIntent,
  handlerFor,
  isOrdered,
  registeredTypes,
};
