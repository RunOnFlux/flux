/**
 * Where a message goes: which handler takes it, and which pipeline carries it.
 *
 * One declaration per type. Every part of the transport that has to know about a type
 * reads it from here, so none of them keeps a list of its own and a type cannot be
 * reachable by one and invisible to another.
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
 * Declare who takes a message type.
 * @param {string|string[]} types Wire type, or several sharing one handler.
 * @param {Function} handler Takes (msgObj, peerSocket).
 * @param {string} [route] One of ROUTE.
 */
function register(types, handler, route = ROUTE.GOSSIP) {
  const list = Array.isArray(types) ? types : [types];
  list.forEach((type) => routes.set(type, { handler, route }));
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
  handlerFor,
  isOrdered,
  registeredTypes,
};
