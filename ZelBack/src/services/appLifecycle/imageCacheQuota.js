const config = require('config');
const imageCacheStore = require('./imageCacheStore');

// Admission + accounting for the enterprise image cache.
//
// Accounting is ALWAYS real measured on-disk bytes: each record's sizeOnDiskBytes is
// the docker df() Size captured when that image finished pulling (images are
// immutable, so the stored value stays accurate). Summing per-image Size slightly
// over-counts shared base layers — conservative for a quota, never under-charged.
// No estimate is ever stored.
//
// The compressed->on-disk estimate (compressed * 2) is used ONLY transiently: to gate
// a single image's burst and to reserve space for an in-flight pull so concurrent
// pulls can't collectively overshoot. Reservations live in memory only (recomputed
// from the df-backed records on restart) and are released the moment a pull finishes
// and its real size lands in the store.

const GB = 1_000_000_000; // decimal GB, matching config.fluxapps.maxImageSize
const ESTIMATE_MULTIPLIER = 2; // compressed -> on-disk admission/reservation estimate

// token -> { fluxId, estimateBytes }
const reservations = new Map();
let reservationSeq = 0;

function quotaBytes() { return config.fluxapps.imageCachePerFluxIdQuotaGb * GB; }
function perImageBurstCapBytes() { return config.fluxapps.imageCachePerImageBurstCapGb * GB; }
function nodeMaxBytes() { return config.fluxapps.imageCacheNodeMaxGb * GB; }

function reservedForFluxId(fluxId) {
  return [...reservations.values()]
    .filter((r) => r.fluxId === fluxId)
    .reduce((sum, r) => sum + r.estimateBytes, 0);
}

function reservedNodeTotal() {
  return [...reservations.values()].reduce((sum, r) => sum + r.estimateBytes, 0);
}

/** Sum the real (df-measured) on-disk size across records. */
function usageFromRecords(records) {
  return (records || []).reduce((sum, r) => sum + (r.sizeOnDiskBytes || 0), 0);
}

/**
 * Pure admission decision over already-resolved numbers. Returns
 * { decision: 'admit'|'queue'|'reject', reason, estimateBytes }.
 *   - reject 'too-big'        : compressed*2 alone exceeds the per-image burst cap.
 *   - reject 'over-quota'     : the owner's committed real usage already fills 20GB.
 *   - reject 'over-node-cap'  : the node's committed real usage already fills the cap.
 *   - queue  'quota-reserved' : would fit but in-flight reservations hold the room;
 *   - queue  'node-reserved'    re-evaluate against real usage as pulls drain.
 *   - admit                   : committed + reserved leaves a byte of headroom.
 */
function decide({
  compressedBytes, committedFluxId, reservedFluxId, committedNode, reservedNode,
}) {
  const estimateBytes = compressedBytes * ESTIMATE_MULTIPLIER;
  if (estimateBytes >= perImageBurstCapBytes()) {
    return { decision: 'reject', reason: 'too-big', estimateBytes };
  }
  if (committedFluxId >= quotaBytes()) {
    return { decision: 'reject', reason: 'over-quota', estimateBytes };
  }
  if (committedNode >= nodeMaxBytes()) {
    return { decision: 'reject', reason: 'over-node-cap', estimateBytes };
  }
  if (committedFluxId + reservedFluxId >= quotaBytes()) {
    return { decision: 'queue', reason: 'quota-reserved', estimateBytes };
  }
  if (committedNode + reservedNode >= nodeMaxBytes()) {
    return { decision: 'queue', reason: 'node-reserved', estimateBytes };
  }
  return { decision: 'admit', reason: null, estimateBytes };
}

/**
 * Stateful admission for one candidate image. Reads df-backed committed usage from
 * the store, factors in current in-flight reservations, and — when it decides
 * 'admit' — atomically records a reservation and returns its token. MUST be awaited
 * serially per submission (the reservation is taken synchronously after the decision,
 * so back-to-back admits see each other's reservations).
 *
 * Fail-closed: a store read error rejects with 'accounting-unavailable' (never admit
 * a download we cannot account for).
 *
 * @returns {Promise<{decision, reason, estimateBytes, token?:string}>}
 */
async function tryAdmit(fluxId, repotag, compressedBytes) {
  const [fluxRecords, allRecords] = await Promise.all([
    imageCacheStore.listImagesForFluxId(fluxId),
    imageCacheStore.listAllImages(),
  ]);
  if (fluxRecords === null || allRecords === null) {
    return { decision: 'reject', reason: 'accounting-unavailable', estimateBytes: compressedBytes * ESTIMATE_MULTIPLIER };
  }
  // Exclude the candidate's own prior record (a refresh of the same repotag replaces
  // it) so its old size is not counted against the new pull.
  const committedFluxId = usageFromRecords(fluxRecords.filter((r) => r.repotag !== repotag));
  const committedNode = usageFromRecords(allRecords.filter((r) => !(r.fluxId === fluxId && r.repotag === repotag)));
  const result = decide({
    compressedBytes,
    committedFluxId,
    reservedFluxId: reservedForFluxId(fluxId),
    committedNode,
    reservedNode: reservedNodeTotal(),
  });
  if (result.decision === 'admit') {
    reservationSeq += 1;
    const token = `res-${reservationSeq}`;
    reservations.set(token, { fluxId, estimateBytes: result.estimateBytes });
    return { ...result, token };
  }
  return result;
}

/** Release an in-flight reservation once its pull has finished (success or failure). */
function release(token) {
  if (token) reservations.delete(token);
}

/** Drop all reservations (process boot / tests). */
function clearReservations() {
  reservations.clear();
}

module.exports = {
  decide,
  tryAdmit,
  release,
  clearReservations,
  usageFromRecords,
  reservedForFluxId,
  reservedNodeTotal,
};
