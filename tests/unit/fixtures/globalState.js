const globalState = require('../../../ZelBack/src/services/utils/globalState');

/**
 * The real globalState, reset.
 *
 * Fifteen suites used to inject a hand-written object in its place, each a
 * different subset of the module's members. A double like that is correct only
 * until the module gains something: the member is missing, the caller's `catch`
 * swallows the TypeError, and the suite fails somewhere else entirely - reading
 * as a defect in the code under test. Adding `operationHolding` broke nineteen
 * tests across two suites that way, in a run whose failures named none of them.
 *
 * Using the module itself removes the divergence rather than maintaining it. The
 * only thing a double was buying is isolation between tests, and that is what
 * this resets.
 *
 * DERIVED, never a list. Scalars are restored to the values the module was first
 * required with, and every container it exposes is emptied in place - so a member
 * added tomorrow is reset tomorrow, which is the whole point. Anything the module
 * exposes without a setter is skipped: it had no way to change.
 */
const initialScalars = {};
for (const key of Object.keys(globalState)) {
  const value = globalState[key];
  const isContainer = value instanceof Map || value instanceof Set || Array.isArray(value);
  if (typeof value !== 'function' && !isContainer && (value === null || typeof value !== 'object')) {
    initialScalars[key] = value;
  }
}

function resetGlobalState() {
  for (const [key, value] of Object.entries(initialScalars)) {
    try {
      globalState[key] = value;
    } catch (error) {
      // getter-only: it was never assignable, so it cannot have drifted
    }
  }
  for (const key of Object.keys(globalState)) {
    const value = globalState[key];
    if (value instanceof Map || value instanceof Set) value.clear();
    // A frozen array is a defensive copy the module hands out - backupInProgress
    // and restoreInProgress are only meant to be changed through tryStart/finish,
    // so they are emptied that way below rather than written to here.
    else if (Array.isArray(value)) { if (!Object.isFrozen(value)) value.length = 0; }
    else if (value && typeof value === 'object' && value.constructor === Object) {
      for (const own of Object.keys(value)) delete value[own];
    }
  }
  for (const appname of globalState.backupInProgress) globalState.finishBackup(appname);
  for (const appname of globalState.restoreInProgress) globalState.finishRestore(appname);
  return globalState;
}

module.exports = { globalState, resetGlobalState };
