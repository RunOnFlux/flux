// Removes, on a node that is not Arcane, every installed enterprise app that was
// never registered: no height, no global specification and no permanent message
// under its name. Only an unpaid test install leaves such a row. Its stored
// specification cannot be decrypted here, so it is removed by the components its
// containers and volume images on this node name, each with no ports: a test
// install opens none.
//
// Remove this module, and the specifications option of removeAppLocally, once the
// FluxOS version floor is at or above the release that ships it.

const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const globalState = require('../utils/globalState');
const { RemovalOutcome } = require('../utils/removalOutcome');
const {
  globalAppsInformation, globalAppsMessages, isArcane,
} = require('../utils/appConstants');
const appQueryService = require('../appQuery/appQueryService');
const volumeService = require('../utils/volumeService');
const appUninstaller = require('./appUninstaller');

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a name has no global specification and no permanent message, in any case.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function neverRegistered(name) {
  const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
  const byName = new RegExp(`^${escapeRegex(name)}$`, 'i');
  const [specification, message] = await Promise.all([
    dbHelper.findOneInDatabase(database, globalAppsInformation, { name: byName }, { projection: { _id: 0, name: 1 } }),
    dbHelper.findOneInDatabase(database, globalAppsMessages, { 'appSpecifications.name': byName }, { projection: { _id: 0, hash: 1 } }),
  ]);
  return !specification && !message;
}

/**
 * The components of an app that this node's containers or volume images name, as
 * flux<component>_<app>, each with the image its container runs when it has one.
 * @param {string} name
 * @returns {Promise<Array<{name: string, repotag?: string}>>}
 */
async function componentsOnNode(name) {
  const listed = await appQueryService.listAllApps();
  if (listed.status !== 'success') throw new Error('the node\'s containers could not be listed');
  const components = new Map();
  listed.data.forEach((container) => {
    const match = /^\/?flux(.+)_([^_]+)$/.exec(container.Names?.[0] ?? '');
    if (match && match[2] === name) components.set(match[1], container.Image);
  });
  const volumes = await volumeService.getComponentAppIdsFromVolumeFiles(name);
  if (!volumes.conclusive) throw new Error(`the volume images of ${name} could not all be found`);
  const suffix = `_${name}`;
  volumes.appIds.forEach((appId) => {
    if (appId.startsWith('flux') && appId.endsWith(suffix) && appId.length > 'flux'.length + suffix.length) {
      const component = appId.slice('flux'.length, -suffix.length);
      if (!components.has(component)) components.set(component, undefined);
    }
  });
  return [...components].map(([component, repotag]) => (repotag ? { name: component, repotag } : { name: component }));
}

/**
 * Removes every installed enterprise app this node cannot decrypt and that was never
 * registered. A read that fails ends the pass with nothing more removed.
 * @returns {Promise<string[]>} the names removed
 */
async function removeUnregisteredEnterpriseApps() {
  const removed = [];
  if (isArcane) return removed;
  try {
    const installed = await appQueryService.installedApps();
    if (installed.status !== 'success') throw new Error('the installed apps could not be read');
    // eslint-disable-next-line no-restricted-syntax
    for (const app of installed.data) {
      const enterprise = app.version >= 8 && Boolean(app.enterprise);
      const hasHeight = app.height !== undefined && app.height !== null;
      // eslint-disable-next-line no-continue
      if (!enterprise || hasHeight || globalState.testInstallingApps.has(app.name)) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!await neverRegistered(app.name)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      const components = await componentsOnNode(app.name);
      log.warn(`REMOVAL REASON: Unregistered enterprise app - ${app.name} is installed on a node that cannot decrypt it and was never registered`);
      // eslint-disable-next-line no-await-in-loop
      // By its docker name: removeAppLocally takes one leading flux off the name it is given.
      const outcome = await appUninstaller.removeAppLocally(`flux${app.name}`, null, true, false, true, {
        specifications: {
          ...app, enterprise: '', compose: components.map((component) => ({ ...component, ports: [] })),
        },
      });
      if (outcome === RemovalOutcome.REMOVED) removed.push(app.name);
    }
  } catch (error) {
    log.error(`removeUnregisteredEnterpriseApps - ${error.message}`);
  }
  return removed;
}

module.exports = {
  removeUnregisteredEnterpriseApps,
};
