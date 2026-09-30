// The changes of primary role in progress on this node, per component. Kept apart
// from primaryRole, which carries a change out, so the modules that answer "does
// this node hold this component?" read it without depending on the reconciler.
// In-memory: a change does not outlive the process that began it.

const changes = new Map();

/**
 * @param {string} identifier `<component>_<app>`
 * @returns {object|undefined} The change in progress
 */
function get(identifier) {
  return changes.get(identifier);
}

function set(identifier, change) {
  changes.set(identifier, change);
}

/**
 * Ends a change, unless another has replaced it.
 * @param {string} identifier `<component>_<app>`
 * @param {object} change The change that ended
 */
function end(identifier, change) {
  if (changes.get(identifier) === change) changes.delete(identifier);
}

/**
 * The change in progress for the component a syncthing folder belongs to.
 * @param {string} folderId Syncthing folder id
 * @returns {object|undefined}
 */
function byFolder(folderId) {
  return [...changes.values()].find((change) => change.appId === folderId);
}

/**
 * Components this node is becoming the primary of: committed, not yet running.
 * @returns {string[]}
 */
function promotingIdentifiers() {
  return [...changes].filter(([, change]) => change.state === 'promoting').map(([identifier]) => identifier);
}

module.exports = {
  get,
  set,
  end,
  byFolder,
  promotingIdentifiers,
};
