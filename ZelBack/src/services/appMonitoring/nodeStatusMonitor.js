// Node Status Monitor - Monitors node status and uninstalls apps if node is not confirmed
const axios = require('axios');
const config = require('config');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const log = require('../../lib/log');

// Database collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

/**
 * Method responsible to monitor node status and uninstall apps if node is not confirmed
 * @param {Function} installedAppsFn - Function to get installed apps
 * @param {Function} removeAppLocallyFn - Function to remove apps locally
 * @returns {Promise<void>}
 */
// eslint-disable-next-line consistent-return
async function monitorNodeStatus(installedAppsFn, removeAppLocallyFn) {
  try {
    let isNodeConfirmed = false;
    if (fluxNetworkHelper.getDosStateValue() >= 100) {
      const installedAppsRes = await installedAppsFn();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node have DOS state over 100`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocallyFn(installedApp.name, null, true, false, isNodeConfirmed);
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(60 * 1000); // wait for 1 min between each removal
      }
      await serviceHelper.delay(10 * 60 * 1000); // 10m delay before next check
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    }
    let error = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => { error = true; });
    if (!isNodeConfirmed && !error) {
      log.info('monitorNodeStatus - Node is not Confirmed');
      const installedAppsRes = await installedAppsFn();
      if (installedAppsRes.status !== 'success') {
        throw new Error('monitorNodeStatus - Failed to get installed Apps');
      }
      const appsInstalled = installedAppsRes.data;
      // eslint-disable-next-line no-restricted-syntax
      for (const installedApp of appsInstalled) {
        log.info(`monitorNodeStatus - Application ${installedApp.name} going to be removed from node as the node is not confirmed on the network`);
        log.warn(`monitorNodeStatus - Removing application ${installedApp.name} locally`);
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocallyFn(installedApp.name, null, true, false, false);
        log.warn(`monitorNodeStatus - Application ${installedApp.name} locally removed`);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(60 * 1000); // wait for 1 min between each removal
      }
      await serviceHelper.delay(20 * 60 * 1000); // 20m delay before next check
      return monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
    } if (isNodeConfirmed) {
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
        const timeout = 10 * 1000; // 10 seconds
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
          const query = { ip: location };
          // eslint-disable-next-line no-await-in-loop
          await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, query);
        }
      }
    }
    await serviceHelper.delay(20 * 60 * 1000); // 20m delay before next check
    monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(2 * 60 * 1000); // 2m delay before next check
    monitorNodeStatus(installedAppsFn, removeAppLocallyFn);
  }
}

module.exports = {
  monitorNodeStatus,
};
