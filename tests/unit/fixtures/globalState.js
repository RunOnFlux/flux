const globalState = require('../../../ZelBack/src/services/utils/globalState');
const operationRegistry = require('../../../ZelBack/src/services/utils/operationRegistry');

/**
 * The real globalState, reset.
 *
 * The module itself, never a hand-written double: a double holding a subset of its
 * members is wrong once the module gains one - the member is missing, the caller's
 * `catch` swallows the TypeError, and the suite fails somewhere else entirely,
 * reading as a defect in the code under test. Isolation between tests is what
 * this reset gives.
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
    // and restoreInProgress are views of the operation registry, which is
    // emptied below.
    else if (Array.isArray(value)) { if (!Object.isFrozen(value)) value.length = 0; }
    else if (value && typeof value === 'object' && value.constructor === Object) {
      // An object's functions are its interface, not its state.
      for (const own of Object.keys(value)) if (typeof value[own] !== 'function') delete value[own];
    }
  }
  operationRegistry.clear();
  return globalState;
}

module.exports = { globalState, resetGlobalState };
