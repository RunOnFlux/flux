const log = require('../../lib/log');
const policyStore = require('../policyStore');

// Which app-owner addresses may install on which enterprise nodes, read from the signed
// policy bundle rather than fetched here. policyStore owns obtaining and verifying it; this
// module owns what the document MEANS, which is the only thing its callers care about.
//
// `null` means this node has not obtained the map, and is not the same as an empty map. Every
// lookup answers null in that state rather than an empty result, because the two are
// indistinguishable downstream and only one of them is a fact: `{}` says nobody is an
// enterprise node, absence says we do not know yet. Answering the first when the second is
// true is what let a node decide it was not an enterprise node, fill up with apps it must not
// host, and then have them removed from under it by the ownership sweep.

const DOCUMENT = 'enterprisenodes';

// Memoized union of all owners, keyed by the map it was built from. The store hands back the
// same object until it adopts a new bundle, so reference identity is a sound signal.
let ownersUnionCache = null;
let ownersUnionCacheKey = null;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A valid node->owners map is a plain object whose every value is an array of strings.
 *
 * Still checked even though the bundle is signed. A signature says who published a document,
 * not that its contents are the shape this code expects, and a single malformed value would
 * otherwise make a node host nothing and uninstall everything.
 */
function isValidNodeOwnerMap(value) {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (owners) => Array.isArray(owners) && owners.every((owner) => typeof owner === 'string'),
  );
}

/**
 * The raw node-pubkey -> [ownerAddress] map, or null when the policy is unknown.
 *
 * A bundle that carries no enterprisenodes document also reads as unknown. The publisher
 * emits all four documents together, so its absence means something is wrong rather than
 * that nobody is an enterprise node -- and this is the read where guessing is expensive.
 */
function getEnterpriseNodeOwnerMap() {
  const document = policyStore.getDocument(DOCUMENT);
  if (document === null) return null;
  if (!isValidNodeOwnerMap(document)) {
    log.error(`enterpriseConfig - ${DOCUMENT} in the signed bundle is not a valid node->owners map`);
    return null;
  }
  return document;
}

/** Whether the node->owners map has been obtained. False means unknown, never "empty". */
function isPolicyKnown() {
  return getEnterpriseNodeOwnerMap() !== null;
}

/** Every enterprise node pubkey, or null when the policy is unknown. */
function getEnterpriseNodesPublicKeys() {
  const map = getEnterpriseNodeOwnerMap();
  return map === null ? null : Object.keys(map);
}

/** Owners allowed to install on a node pubkey, or null when the policy is unknown. */
function getAllowedOwnersForNode(pubKey) {
  const map = getEnterpriseNodeOwnerMap();
  if (map === null) return null;
  const owners = map[pubKey];
  return Array.isArray(owners) ? owners : [];
}

/**
 * The global set of enterprise app owners: the deduped union of every node's allowed owners,
 * or null when the policy is unknown. Used for node-agnostic checks (datacenter validation,
 * CPU burst eligibility, excluding enterprise apps from public nodes).
 */
function getEnterpriseAppOwners() {
  const map = getEnterpriseNodeOwnerMap();
  if (map === null) return null;
  if (ownersUnionCacheKey === map) return ownersUnionCache;
  ownersUnionCache = [...new Set(Object.values(map).filter(Array.isArray).flat())];
  ownersUnionCacheKey = map;
  return ownersUnionCache;
}

module.exports = {
  getAllowedOwnersForNode,
  getEnterpriseAppOwners,
  getEnterpriseNodeOwnerMap,
  getEnterpriseNodesPublicKeys,
  isPolicyKnown,
};
