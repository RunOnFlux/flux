// Deterministic ordering shared by every code path that ranks an app's
// installing claims or running instances to decide which node keeps the app
// and which stands aside. Each node sorts values carried inside the broadcast
// messages, so the fleet agrees on the outcome only if the order is total:
// a comparator that returns 0 on equal timestamps ranks tied entries by local
// arrival order - different on every node - and two nodes can each compute
// the winning rank for themselves. On any tie the lower socket address
// survives; the higher address is the junior entry and stands aside.

/**
 * Orders installing claims for the collision resolver: earliest broadcastedAt
 * first, a claim without a timestamp last (it cannot assert seniority), equal
 * timestamps broken by socket address ascending - the lower address wins the
 * slot.
 * @param {{ip: string, broadcastedAt?: number}} a Installing claim.
 * @param {{ip: string, broadcastedAt?: number}} b Installing claim.
 * @returns {number} Comparator result for Array.prototype.sort.
 */
function compareInstallingClaims(a, b) {
  const aTime = a.broadcastedAt ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.broadcastedAt ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  if (a.ip < b.ip) {
    return -1;
  }
  if (a.ip > b.ip) {
    return 1;
  }
  return 0;
}

/**
 * Orders running instances by seniority: longest-running first, an instance
 * that has not yet reported runningSince ahead of all that have (an instance
 * still settling is never the surplus one), equal runningSince broken by
 * socket address ascending. Surplus-instance checks rank the junior end of
 * this order; primary selection ranks the senior end.
 * @param {{ip: string, runningSince?: string|number}} a Running instance.
 * @param {{ip: string, runningSince?: string|number}} b Running instance.
 * @returns {number} Comparator result for Array.prototype.sort.
 */
function compareInstanceSeniority(a, b) {
  if (!a.runningSince && b.runningSince) {
    return -1;
  }
  if (a.runningSince && !b.runningSince) {
    return 1;
  }
  if (a.runningSince < b.runningSince) {
    return -1;
  }
  if (a.runningSince > b.runningSince) {
    return 1;
  }
  if (a.ip < b.ip) {
    return -1;
  }
  if (a.ip > b.ip) {
    return 1;
  }
  return 0;
}

/**
 * Renders a ranked list for the resolver's decision logs - each entry's
 * address with the timestamp it was ranked by - so a disputed outcome can be
 * diagnosed from any single node's log.
 * @param {object[]} list Entries in their ranked order.
 * @param {string} timestampField Field the ranking was keyed by.
 * @returns {string} One-line rendering of the ranked entries.
 */
function describeRanking(list, timestampField) {
  return list.map((entry) => `${entry.ip}@${entry[timestampField] ?? 'unreported'}`).join(', ');
}

module.exports = {
  compareInstallingClaims,
  compareInstanceSeniority,
  describeRanking,
};
