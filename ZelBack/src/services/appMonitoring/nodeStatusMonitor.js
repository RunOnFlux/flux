// Node Status Monitor - Monitors node status and uninstalls apps if node is not confirmed
const axios = require('axios');
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const messageStore = require('../appMessaging/messageStore');
const nodeConfirmationService = require('../nodeConfirmationService');
const log = require('../../lib/log');

let removalInProgress = false;

// Database collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

/**
 * Method responsible to monitor node status and uninstall apps if node is not confirmed
 * @param {Function} installedAppsFn - Function to get installed apps
 * @param {Function} removeAppLocallyFn - Function to remove apps locally
 * @returns {Promise<void>}
 */
// eslint-disable-next-line consistent-return
async function removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, reason) {
  if (removalInProgress) return;
  removalInProgress = true;
  try {
    const installedAppsRes = await installedAppsFn();
    if (installedAppsRes.status !== 'success') {
      throw new Error('monitorNodeStatus - Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const canBroadcast = nodeConfirmationService.canSendMessages();
    for (const installedApp of appsInstalled) {
      log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed: ${reason}`);
      log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocallyFn(installedApp.name, null, true, false, canBroadcast);
      log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(config.fluxapps.nodeMonitorRemovalDelayMs ?? 60000);
    }
  } finally {
    removalInProgress = false;
  }
}

function initialize(installedAppsFn, removeAppLocallyFn) {
  nodeConfirmationService.onConfirmationChange((confirmed) => {
    if (!confirmed) {
      log.info('monitorNodeStatus - Confirmation lost, triggering immediate app removal');
      removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'node lost confirmation');
    }
  });
  nodeConfirmationService.onDaemonStale(() => {
    log.info('monitorNodeStatus - Daemon stale, triggering app removal');
    removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'daemon unreachable');
  });
}

async function monitorNodeStatus(installedAppsFn, removeAppLocallyFn) {
  try {
    if (fluxNetworkHelper.isNodeDos()) {
      await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'DOS state >= 100');
      await serviceHelper.delay(config.fluxapps.nodeMonitorDosRecoveryDelayMs ?? 600000);
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    }
    if (nodeConfirmationService.isDaemonStale()) {
      await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'daemon unreachable (backstop)');
      await serviceHelper.delay(config.fluxapps.nodeMonitorConfirmationLossDelayMs ?? 1200000);
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    }
    if (!nodeConfirmationService.isConfirmed()) {
      await removeAllAppsLocally(installedAppsFn, removeAppLocallyFn, 'node not confirmed');
      await serviceHelper.delay(config.fluxapps.nodeMonitorConfirmationLossDelayMs ?? 1200000);
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    } if (nodeConfirmationService.isConfirmed()) {
      log.info('monitorNodeStatus - Node is Confirmed');
      // lets remove from locations when nodes are no longer confirmed
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      const variable = 'ip';
      // we already have the exact same data
      const appslocations = await dbHelper.distinctDatabase(database, globalAppsLocations, variable);
      const appsLocationCount = appslocations.length;
      log.info(`monitorNodeStatus - Found ${appsLocationCount} distinct IP's on appslocations`);

      const appsLocationsNotOnNodelist = [];

      const iterChunk = async (chunk) => {
        const promises = chunk.map(async (location) => {
          const found = await fluxCommunicationUtils.socketAddressInFluxList(location);
          if (!found) appsLocationsNotOnNodelist.push(location);
        });
        await Promise.all(promises);
      };

      const chunkSize = 250;
      let startIndex = 0;
      let endIndex = Math.min(chunkSize, appsLocationCount);

      while (startIndex < appsLocationCount) {
        const chunk = appslocations.slice(startIndex, endIndex);
        // eslint-disable-next-line no-await-in-loop
        await iterChunk(chunk);

        startIndex = endIndex;
        endIndex += chunk.length;
      }

      log.info(`monitorNodeStatus - Found ${appsLocationsNotOnNodelist.length} IP(s) not present on deterministic node list`);
      // eslint-disable-next-line no-restricted-syntax
      for (const location of appsLocationsNotOnNodelist) {
        log.info(`monitorNodeStatus - Checking IP ${location}.`);
        const ip = location.split(':')[0];
        const port = location.split(':')[1] || '16127';
        const { CancelToken } = axios;
        const source = CancelToken.source();
        let isResolved = false;
        const timeout = config.fluxapps.nodeMonitorCheckTimeoutMs ?? 10000;
        setTimeout(() => {
          if (!isResolved) {
            source.cancel('Operation canceled by the user.');
          }
        }, timeout * 2);
        // eslint-disable-next-line no-await-in-loop
        const response = await axios.get(`http://${ip}:${port}/daemon/getfluxnodestatus`, { timeout, cancelToken: source.token }).catch(() => null);
        isResolved = true;
        if (response && response.data && response.data.status === 'success' && response.data.data.status === 'CONFIRMED') {
          log.info(`monitorNodeStatus - IP ${location} is available and confirmed, awaiting for a new confirmation transaction`);
        } else {
          log.info(`monitorNodeStatus - Removing IP ${location} from globalAppsLocations`);
          // eslint-disable-next-line no-await-in-loop
          await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.EVICTED, { ip: location });
          const query = { ip: location };
          // eslint-disable-next-line no-await-in-loop
          await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, query);
        }
      }
    }
    await serviceHelper.delay(config.fluxapps.nodeMonitorIntervalMs ?? 1200000);
    monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(config.fluxapps.nodeMonitorErrorRecoveryDelayMs ?? 120000);
    monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
  }
}

module.exports = {
  initialize,
  monitorNodeStatus,
};
