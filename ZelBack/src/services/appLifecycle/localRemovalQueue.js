// Removes the installed apps the registry no longer lists, one at a time.
//
// The registry is current once a rebuild or the expiry pass has written it. Removing what this node
// still runs follows from that write and is not part of it, so neither waits for the removals. They
// run in the order queued, REMOVAL_SPACING_MS apart, as each one broadcasts its removal to peers.
// A name already queued, or being removed, is not queued again.

const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

const REMOVAL_SPACING_MS = 5_000;

const queued = new Set();
let removing = null;
let remover = null;
let draining = null;

async function drain() {
  try {
    while (queued.size) {
      const [name] = queued;
      queued.delete(name);
      removing = name;
      try {
        // eslint-disable-next-line no-await-in-loop
        await remover(name);
      } catch (error) {
        log.error(`localRemovalQueue - removing ${name} failed: ${error.message}`);
      }
      removing = null;
      // eslint-disable-next-line no-await-in-loop
      if (queued.size) await serviceHelper.delay(REMOVAL_SPACING_MS);
    }
  } finally {
    removing = null;
    draining = null;
  }
}

function startDrain() {
  if (draining || !remover || !queued.size) return;
  draining = drain();
}

/**
 * Sets what removes an installed app, and starts removing what is already queued.
 * @param {(appName: string) => Promise<unknown>} fn
 */
function setRemover(fn) {
  remover = fn;
  startDrain();
}

/**
 * Queues installed apps for removal.
 * @param {string[]} appNames
 */
function queueRemovals(appNames) {
  appNames.forEach((name) => {
    if (name !== removing) queued.add(name);
  });
  startDrain();
}

/**
 * @returns {Promise<void>} resolves once nothing is queued or being removed
 */
async function drained() {
  await draining;
}

module.exports = {
  REMOVAL_SPACING_MS,
  drained,
  queueRemovals,
  setRemover,
};
