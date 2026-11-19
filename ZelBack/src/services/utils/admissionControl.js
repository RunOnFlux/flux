// Resource admission for operations that put an app on the node. Installs of
// different apps run at once, so a check of the node's free cpu, ram and disk and
// the claim on what it found free are one step: admit() runs the check and records
// the app's footprint as a reservation under a node-wide lock, and every check
// counts the reservations. An app holding a reservation is counted by it instead of
// by its row, so an app is counted once whether or not its row exists at that
// moment - a redeploy's row is gone between its teardown and its reinstall, and its
// reservation keeps the room. A reservation lasts until the operation holding the
// app ends; the lock is released when its check ends. Nothing is released on a
// timer. In memory only: after a restart no operation is in progress.

const operationRegistry = require('./operationRegistry');

// app name -> { cpu, ram, hdd }, in the units resourceQueryService.appsResources sums
const reservations = new Map();
// the end of the last admission queued, which the next one runs after
let tail = Promise.resolve();

/**
 * Runs `fn` alone among admissions: the next one starts when this one settles.
 * @param {function(): Promise<*>} fn
 * @returns {Promise<*>} What `fn` returns.
 */
function withLock(fn) {
  const run = tail.then(() => fn());
  tail = run.catch(() => {});
  return run;
}

/**
 * Checks the node has room for an app and reserves it, as one step among
 * admissions. The check leaves the app's own row and reservation out, so an app
 * already counted is checked by what it will take, not what it takes now. Only an
 * operation holding the app reserves: called outside one, it checks alone.
 * @param {string} appName
 * @param {function(): Promise<void>} check The node's resource check for the app,
 *   leaving `appName` out; rejects when the app does not fit.
 * @param {function(): Promise<{cpu: number, ram: number, hdd: number}>} footprint
 *   What the app reserves.
 * @returns {Promise<void>} Rejects with the check's reason, reserving nothing.
 */
function admit(appName, check, footprint) {
  return withLock(async () => {
    await check();
    if (operationRegistry.isHeld(appName)) reservations.set(appName, await footprint());
  });
}

/**
 * @returns {Map<string, {cpu: number, ram: number, hdd: number}>} The apps holding a
 *   reservation and what each holds.
 */
function reserved() {
  return new Map(reservations);
}

function release(appName) {
  reservations.delete(appName);
}

// Drops every reservation. For tests.
function clear() {
  reservations.clear();
  tail = Promise.resolve();
}

operationRegistry.onReleased(release);

module.exports = {
  admit,
  reserved,
  release,
  clear,
};
