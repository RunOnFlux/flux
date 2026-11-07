// Removes, on a node that is not Arcane, every installed enterprise app that was
// never registered: no height, no global specification and no permanent message
// under its name. Only an unpaid test install leaves such a row. Its stored
// specification cannot be decrypted here, so it is removed by the components its
// containers on this node name, with no ports: a test install opens none.
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
 * The components of an app that this node's containers name, as flux<component>_<app>.
 * @param {string} name
 * @returns {Promise<string[]>}
 */
async function componentsOnNode(name) {
  const listed = await appQueryService.listAllApps();
  if (listed.status !== 'success') throw new Error('the node\'s containers could not be listed');
  const components = [];
  listed.data.forEach((container) => {
    const match = /^\/?flux(.+)_([^_]+)$/.exec(container.Names?.[0] ?? '');
    if (match && match[2] === name) components.push(match[1]);
  });
  return components;
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
      const outcome = await appUninstaller.removeAppLocally(app.name, null, true, false, true, {
        specifications: {
          ...app, enterprise: '', compose: components.map((component) => ({ name: component, ports: [] })),
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
