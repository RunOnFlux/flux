// The payment records the backfill reads: those without a position. A record
// already marked notOnChain is decided: if its transaction is mined later, the
// explorer records the payment from that block. Read through the collection's
// txIndex index (explorerService.prepareCollections), so a node whose records all
// have positions reads none of them.
//
// Free of config so the harness reads it with this same query.
const UNPOSITIONED = { txIndex: { $exists: false }, notOnChain: { $ne: true } };

module.exports = { UNPOSITIONED };
