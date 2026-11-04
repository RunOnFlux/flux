// Departed Locations - Evicts the location rows of nodes the node list no longer holds

const config = require('config');
const dbHelper = require('../dbHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const messageStore = require('../appMessaging/messageStore');
const nodeConfirmationService = require('../nodeConfirmationService');
const networkStateService = require('../networkStateService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { socketAddressesMatch } = require('../utils/socketAddressUtils');
const fluxEventBus = require('../utils/fluxEventBus');
const log = require('../../lib/log');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

let evicting = false;

/**
 * Evicts every address the location table holds and the node list does not.
 * messageStore.applyEviction decides each: a node the chain moved keeps its rows
 * for a time. Runs on each node list update, one pass at a time; an update
 * arriving during a pass is met by the next. A restarted node hears the evictions
 * it missed from its peers' state sync. A node the daemon does not confirm judges
 * nobody, and no node judges the address it holds: it knows where it is, whatever
 * the list has reached.
 * @returns {Promise<void>}
 */
async function evictDepartedLocations() {
  if (evicting || !nodeConfirmationService.isConfirmed()) return;
  evicting = true;
  try {
    const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    const addresses = await dbHelper.distinctDatabase(database, globalAppsLocations, 'ip');
    const own = fluxNetworkHelper.getKnownLocalSocketAddress();
    // eslint-disable-next-line no-restricted-syntax
    for (const address of addresses.filter((candidate) => !socketAddressesMatch(candidate, own))) {
      // eslint-disable-next-line no-await-in-loop
      if (!await fluxCommunicationUtils.socketAddressInFluxList(address)) {
        // eslint-disable-next-line no-await-in-loop
        await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.LOCATIONS_BEFORE_EVICTION, address);
        // eslint-disable-next-line no-await-in-loop
        await messageStore.applyEviction(address, Date.now());
      }
    }
  } catch (error) {
    log.error(`evictDepartedLocations - ${error.message}`);
  } finally {
    evicting = false;
  }
}

/**
 * Starts evicting on every node list update.
 * @returns {void}
 */
function start() {
  networkStateService.onUpdated(evictDepartedLocations);
  if (networkStateService.isReady()) evictDepartedLocations();
}

module.exports = { start, evictDepartedLocations };
