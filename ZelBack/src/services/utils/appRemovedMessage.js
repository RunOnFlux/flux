// What a fluxappremoved this node sends may name. Version 1 names one app; version
// 2 names every app a node removed together. Every node reads version 2 once
// minimumFluxOSAllowedVersion is at least appRemovedListFrom, the first release
// that reads it; below that a node sends version 1.

const config = require('config');
const serviceHelper = require('../serviceHelper');

/**
 * @returns {boolean} Whether every node on the network reads a fluxappremoved
 *   naming several apps.
 */
function namesSeveralApps() {
  return serviceHelper.semverAtLeast(config.minimumFluxOSAllowedVersion, config.fluxapps.appRemovedListFrom);
}

module.exports = { namesSeveralApps };
