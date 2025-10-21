// Re-export cache from globalState for convenience
// This provides a cleaner API for accessing syncthing caches
const globalState = require('./globalState');

module.exports = {
  receiveOnlySyncthingAppsCache: globalState.receiveOnlySyncthingAppsCache,
  syncthingDevicesIDCache: globalState.syncthingDevicesIDCache,
};
