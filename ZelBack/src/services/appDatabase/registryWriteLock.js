// The one lock every write to the global application registry runs under.
//
// The registry (globalAppsInformation) is written by promotion, by expiry and by
// the rebuild that replaces it from the permanent messages. Each writer reads what
// is stored and then decides, and promotions run concurrently (the block scanner
// schedules them without awaiting, and a message fetched from peers is promoted on
// its own), so two unserialised writers can both read and the older write last.
// The rebuild builds a staging collection and renames it over the live one; a
// write landing on the live collection meanwhile would be discarded by that
// rename. Under this lock a write happens before the rebuild reads the messages,
// or waits and lands on the collection the rebuild produced.
//
// The lock is not re-entrant: a function running inside withRegistryWrite must
// not call another that takes it.

const { AsyncLock } = require('../utils/asyncLock');

const lock = new AsyncLock();

/**
 * Run fn holding the registry write lock, releasing it however fn ends.
 * @template T
 * @param {() => Promise<T>} fn The registry write
 * @returns {Promise<T>} What fn resolved to
 */
async function withRegistryWrite(fn) {
  await lock.enable();
  try {
    return await fn();
  } finally {
    lock.disable();
  }
}

module.exports = { withRegistryWrite };
