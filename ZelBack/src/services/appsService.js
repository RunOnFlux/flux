// Complete Modular Apps Service - Main Orchestrator
const os = require('os');
const config = require('config');
const path = require('node:path');
const axios = require('axios');
const util = require('util');
const archiver = require('archiver');
const fs = require('fs').promises;
const { PassThrough } = require('stream');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');
const dockerService = require('./dockerService');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const generalService = require('./generalService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const benchmarkService = require('./benchmarkService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const geolocationService = require('./geolocationService');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const syncthingService = require('./syncthingService');
const upnpService = require('./upnpService');
const networkStateService = require('./networkStateService');
const fluxHttpTestServer = require('./utils/fluxHttpTestServer');
const IOUtils = require('./IOUtils');
const cmdAsync = require('util').promisify(require('child_process').exec);
const execShell = util.promisify(require('child_process').exec);
const log = require('../lib/log');
const {
  outgoingPeers, incomingPeers,
} = require('./utils/establishedConnections');

// Import all modularized components
const appConstants = require('./utils/appConstants');
const appSpecHelpers = require('./utils/appSpecHelpers');
const appUtilities = require('./utils/appUtilities');
const chainUtilities = require('./utils/chainUtilities');
const enterpriseHelper = require('./utils/enterpriseHelper');
const { checkAndDecryptAppSpecs } = enterpriseHelper;
const appValidator = require('./appRequirements/appValidator');
const hwRequirements = require('./appRequirements/hwRequirements');
const appController = require('./appManagement/appController');
const appInspector = require('./appManagement/appInspector');
const appInstaller = require('./appLifecycle/appInstaller');
const appUninstaller = require('./appLifecycle/appUninstaller');
const advancedWorkflows = require('./appLifecycle/advancedWorkflows');
const portManager = require('./appNetwork/portManager');
const messageStore = require('./appMessaging/messageStore');
const messageVerifier = require('./appMessaging/messageVerifier');
const imageManager = require('./appSecurity/imageManager');
const registryManager = require('./appDatabase/registryManager');
const systemIntegration = require('./appSystem/systemIntegration');
const monitoringOrchestrator = require('./appMonitoring/monitoringOrchestrator');
const nodeStatusMonitor = require('./appMonitoring/nodeStatusMonitor');
const syncthingMonitor = require('./appMonitoring/syncthingMonitor');
const availabilityChecker = require('./appMonitoring/availabilityChecker');
const appQueryService = require('./appQuery/appQueryService');
const resourceQueryService = require('./appQuery/resourceQueryService');
const deploymentInfoService = require('./appQuery/deploymentInfoService');
const fileQueryService = require('./appQuery/fileQueryService');
const fileSystemManager = require('./appSystem/fileSystemManager');
const appHashSyncService = require('./appMessaging/appHashSyncService');
const peerNotification = require('./appMessaging/peerNotification');
const cryptographicKeys = require('./appMessaging/cryptographicKeys');
const dockerOperations = require('./appManagement/dockerOperations');
const testHelpers = require('./appTesting/testHelpers');

// Import shared state and caches that need to remain centralized
const cacheManager = require('./utils/cacheManager').default;

// Import shared global state
const globalState = require('./utils/globalState');
const { invalidMessages } = require('./invalidMessages');

// Legacy variable references for backward compatibility
let removalInProgress = false;
let installationInProgress = false;
let reinstallationOfOldAppsInProgress = false;
let masterSlaveAppsRunning = false;
const backupInProgress = globalState.backupInProgress;
const restoreInProgress = globalState.restoreInProgress;

// Database collections
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;

// App hash verification state - moved to appHashSyncService.js
// let continuousFluxAppHashesCheckRunning = false;
// let checkAndSyncAppHashesRunning = false;
// let firstContinuousFluxAppHashesCheckRun = true;
// const hashesNumberOfSearchs = new Map();
const mastersRunningGSyncthingApps = new Map();
const timeTostartNewMasterApp = new Map();

// Cache references
const spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
const trySpawningGlobalAppCache = cacheManager.appSpawnCache;

// Initialize globalState caches
globalState.initializeCaches(cacheManager);
const myShortCache = cacheManager.fluxRatesCache;
const myLongCache = cacheManager.appPriceBlockedRepoCache;
const failedNodesTestPortsCache = cacheManager.testPortsCache;
const receiveOnlySyncthingAppsCache = globalState.receiveOnlySyncthingAppsCache;
const appsStopedCache = cacheManager.stoppedAppsCache;
const syncthingDevicesIDCache = cacheManager.syncthingDevicesCache;

// Apps monitored structure
const appsMonitored = {};

// DOS protection variables
let dosMountMessage = '';
let dosDuplicateAppMessage = '';
// checkAndNotifyPeersOfRunningAppsFirstRun moved to peerNotification.js

// Additional global variables for syncthingApps and checkMyAppsAvailability
let updateSyncthingRunning = false;
let syncthingAppsFirstRun = true;
let dosState = 0;
let dosMessage = null;
let testingPort = null;
let originalPortFailed = null;
let lastUPNPMapFailed = false;
let nextTestingPort = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
const portsNotWorking = new Set();
const isArcane = Boolean(process.env.FLUXOS_PATH);
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

// Functions moved to appQueryService.js
// installedApps, listRunningApps, listAllApps are now imported from appQueryService

// fluxUsage moved to resourceQueryService.js

/**
 * Get applications monitoring data
 * @returns {object} Apps monitoring data
 */
function getAppsMonitored() {
  return appsMonitored;
}

/**
 * Get global state for app operations
 * @returns {object} Global state object
 */
function getGlobalState() {
  // Sync with globalState module
  removalInProgress = globalState.removalInProgress;
  installationInProgress = globalState.installationInProgress;
  reinstallationOfOldAppsInProgress = globalState.reinstallationOfOldAppsInProgress;
  masterSlaveAppsRunning = globalState.masterSlaveAppsRunning;

  return {
    removalInProgress,
    installationInProgress,
    reinstallationOfOldAppsInProgress,
    masterSlaveAppsRunning,
    backupInProgress,
    restoreInProgress: globalState.restoreInProgress,
    hashesNumberOfSearchs,
    mastersRunningGSyncthingApps,
    timeTostartNewMasterApp,
  };
}

// appsResources moved to resourceQueryService.js

/**
 * Set applications monitoring data
 * @param {object} appData - App monitoring data
 */
function setAppsMonitored(appData) {
  appsMonitored[appData.appName] = appData;
}

/**
 * Clear applications monitoring data
 */
function clearAppsMonitored() {
  Object.keys(appsMonitored).forEach((key) => {
    delete appsMonitored[key];
  });
}

/**
 * Wrapper for startMonitoringOfApps - Start monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to monitor
 * @returns {Promise<object>} Result of monitoring start
 */
async function startMonitoringOfApps(appSpecsToMonitor) {
  return monitoringOrchestrator.startMonitoringOfApps(appSpecsToMonitor, appsMonitored, installedApps);
}

/**
 * Check and notify peers of running apps
 */
// Wrapper function for checkAndNotifyPeersOfRunningApps - delegates to peerNotification service
async function checkAndNotifyPeersOfRunningApps() {
  return peerNotification.checkAndNotifyPeersOfRunningApps(
    installedApps,
    listRunningApps,
    appsMonitored,
    removalInProgress,
    installationInProgress,
    reinstallationOfOldAppsInProgress,
    getGlobalState,
    cacheManager,
  );
}

// appLocation moved to registryManager.js
// signCheckAppData moved to availabilityChecker.js
// getDeviceID moved to syncthingMonitor.js

// Moved to appTesting/testHelpers.js
// handleTestShutdown is now imported from testHelpers module

// Moved to appManagement/dockerOperations.js
// Docker control functions with app monitoring integration are now in dockerOperations module

/**
 * Wrapper for stopMonitoringOfApps - Stop monitoring multiple applications
 * @param {Array} appSpecsToMonitor - Array of app specifications to stop monitoring
 * @param {boolean} deleteData - Whether to delete monitoring data
 * @returns {Promise<object>} Result of monitoring stop
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  return monitoringOrchestrator.stopMonitoringOfApps(appSpecsToMonitor, deleteData, appsMonitored, installedApps);
}

/**
 * Wrapper for startAppMonitoringAPI - Start monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function startAppMonitoringAPI(req, res) {
  return monitoringOrchestrator.startAppMonitoringAPI(req, res, appsMonitored, installedApps);
}

/**
 * Wrapper for stopAppMonitoringAPI - Stop monitoring API endpoint
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stopAppMonitoringAPI(req, res) {
  return monitoringOrchestrator.stopAppMonitoringAPI(req, res, appsMonitored, installedApps);
}

// Enhanced appMonitor function that uses the inspector module but adds the monitored data
async function appMonitor(req, res) {
  return appInspector.appMonitor(req, res, appsMonitored);
}

// Global constants - already defined above

/**
 * Check and sync app hashes from other nodes - delegates to appHashSyncService
 */
async function checkAndSyncAppHashes() {
  return appHashSyncService.checkAndSyncAppHashes();
}

/**
 * Wrapper for monitorNodeStatus - Monitor node status and uninstall apps if node is not confirmed
 * Business logic moved to appMonitoring/nodeStatusMonitor.js
 */
// eslint-disable-next-line consistent-return
async function monitorNodeStatus() {
  // Create local reference to removeAppLocally function
  const removeAppLocally = async (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored));

  return nodeStatusMonitor.monitorNodeStatus(removeAppLocally, appQueryService.installedApps);
}

// Helper references for wrapper functions
const appLocation = registryManager.appLocation;
const removeAppLocally = async (app, res, force, endResponse, sendMessage) =>
  appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored));
const appDockerStop = (appname) => dockerOperations.appDockerStop(appname, appInspector.stopAppMonitoring, appsMonitored, installedApps);
const appDockerRestart = (appname) => dockerOperations.appDockerRestart(appname, appInspector.startAppMonitoring, appsMonitored, installedApps);
const appDeleteDataInMountPoint = dockerOperations.appDeleteDataInMountPoint;

// Main functions: syncthingApps and checkMyAppsAvailability
/**
 * Wrapper for syncthingApps - Manages syncthing configuration for apps
 * Business logic moved to appMonitoring/syncthingMonitor.js
 */
async function syncthingApps() {
  // Prepare state object for syncthingMonitor
  const state = {
    installationInProgress,
    removalInProgress,
    updateSyncthingRunning,
    syncthingAppsFirstRun,
    backupInProgress,
    restoreInProgress,
    receiveOnlySyncthingAppsCache,
    syncthingDevicesIDCache,
  };

  return syncthingMonitor.syncthingApps(
    state,
    appQueryService.installedApps,
    getGlobalState,
    appDockerStop,
    appDockerRestart,
    appDeleteDataInMountPoint,
    removeAppLocally,
  );
}

/**
 * Wrapper for checkMyAppsAvailability - Checks apps availability by testing ports
 * Business logic moved to appMonitoring/availabilityChecker.js
 */
async function checkMyAppsAvailability() {
  // Prepare DOS state object for availabilityChecker
  const dosStateObj = {
    dosMountMessage,
    dosDuplicateAppMessage,
    dosMessage,
    dosStateValue: dosState,
    testingPort,
    originalPortFailed,
    nextTestingPort,
    lastUPNPMapFailed,
  };

  return availabilityChecker.checkMyAppsAvailability(
    appQueryService.installedApps,
    dosStateObj,
    portsNotWorking,
    failedNodesTestPortsCache,
    isArcane,
  );
}

/**
 * To get deployment information. Returns information needed for application deployment regarding specification limitation and prices.
 * @param {object} req Request.
 * @param {object} res Response.
 */
// deploymentInformation and getAppSpecsUSDPrice moved to deploymentInfoService.js
// getlatestApplicationSpecificationAPI moved to appQueryService.js

// Moved to appDatabase/registryManager.js
// The following functions are now in registryManager module:
// - registerAppGlobalyApi
// - reindexGlobalAppsLocationAPI
// - reindexGlobalAppsInformationAPI
// - rescanGlobalAppsInformationAPI

// getApplicationOriginalOwner and getAppsInstallingLocations moved to appQueryService.js

// getAppsFolder moved to fileQueryService.js
// createAppsFolder, renameAppsObject, removeAppsObject, downloadAppsFolder, downloadAppsFile moved to fileSystemManager.js

// All file system and crypto functions now directly imported from their respective modules

// Re-export ALL functions from modules for complete backward compatibility
module.exports = {
  // Query functions - Re-exported from appQueryService
  installedApps: appQueryService.installedApps,
  listRunningApps: appQueryService.listRunningApps,
  listAllApps: appQueryService.listAllApps,
  getlatestApplicationSpecificationAPI: appQueryService.getlatestApplicationSpecificationAPI,
  getApplicationOriginalOwner: appQueryService.getApplicationOriginalOwner,
  getAppsInstallingLocations: appQueryService.getAppsInstallingLocations,

  // Resource query functions - Re-exported from resourceQueryService
  fluxUsage: resourceQueryService.fluxUsage,
  appsResources: resourceQueryService.appsResources,

  // Deployment info functions - Re-exported from deploymentInfoService
  deploymentInformation: deploymentInfoService.deploymentInformation,
  getAppSpecsUSDPrice: deploymentInfoService.getAppSpecsUSDPrice,

  // File query and management functions - Re-exported from fileQueryService and fileSystemManager
  getAppsFolder: fileQueryService.getAppsFolder,
  createAppsFolder: fileSystemManager.createAppsFolder,
  renameAppsObject: fileSystemManager.renameAppsObject,
  removeAppsObject: fileSystemManager.removeAppsObject,
  downloadAppsFolder: fileSystemManager.downloadAppsFolder,
  downloadAppsFile: fileSystemManager.downloadAppsFile,

  // Cryptographic keys - Re-exported from cryptographicKeys
  getAppPublicKey: cryptographicKeys.getAppPublicKey,
  getPublicKey: cryptographicKeys.getPublicKey,

  // Local orchestrator functions (still defined in this file)
  getAppsMonitored,
  setAppsMonitored,
  clearAppsMonitored,
  checkAndNotifyPeersOfRunningApps,

  // Monitoring functions - Re-exported from monitoring modules
  syncthingApps,
  checkMyAppsAvailability,
  startMonitoringOfApps: monitoringOrchestrator.startMonitoringOfApps,
  stopMonitoringOfApps: monitoringOrchestrator.stopMonitoringOfApps,
  startAppMonitoringAPI: monitoringOrchestrator.startAppMonitoringAPI,
  stopAppMonitoringAPI: monitoringOrchestrator.stopAppMonitoringAPI,
  appMonitor: monitoringOrchestrator.appMonitor,
  monitorNodeStatus,

  // Re-exported from appSpecHelpers
  getChainTeamSupportAddressUpdates: appSpecHelpers.getChainTeamSupportAddressUpdates,
  parseAppSpecification: appSpecHelpers.parseAppSpecification,

  // Re-exported from appValidator
  verifyTypeCorrectnessOfApp: appValidator.verifyTypeCorrectnessOfApp,
  verifyRestrictionCorrectnessOfApp: appValidator.verifyRestrictionCorrectnessOfApp,
  verifyObjectKeysCorrectnessOfApp: appValidator.verifyObjectKeysCorrectnessOfApp,
  checkHWParameters: appValidator.checkHWParameters,
  checkComposeHWParameters: appValidator.checkComposeHWParameters,
  verifyAppSpecifications: appValidator.verifyAppSpecifications,

  // Re-exported from hwRequirements
  getNodeSpecs: hwRequirements.getNodeSpecs,
  setNodeSpecs: hwRequirements.setNodeSpecs,
  returnNodeSpecs: hwRequirements.returnNodeSpecs,
  totalAppHWRequirements: hwRequirements.totalAppHWRequirements,
  // checkAppHWRequirements is defined below with custom implementation
  checkAppRequirements: hwRequirements.checkAppRequirements,
  nodeFullGeolocation: hwRequirements.nodeFullGeolocation,
  checkAppStaticIpRequirements: hwRequirements.checkAppStaticIpRequirements,
  checkAppGeolocationRequirements: hwRequirements.checkAppGeolocationRequirements,
  checkAppNodesRequirements: hwRequirements.checkAppNodesRequirements,

  // Re-exported from appController
  executeAppGlobalCommand: appController.executeAppGlobalCommand,
  appStart: (req, res) => appController.appStart(req, res, (appname) => appInspector.startAppMonitoring(appname, appsMonitored)),
  appStop: (req, res) => appController.appStop(req, res, (appname, deleteData) => appInspector.stopAppMonitoring(appname, deleteData, appsMonitored)),
  appRestart: (req, res) => appController.appRestart(req, res, (appname) => appInspector.startAppMonitoring(appname, appsMonitored), (appname, deleteData) => appInspector.stopAppMonitoring(appname, deleteData, appsMonitored)),
  appKill: (req, res) => appController.appKill(req, res),
  appPause: (req, res) => appController.appPause(req, res),
  appUnpause: (req, res) => appController.appUnpause(req, res),
  appDockerRestart: (req, res) => appController.appDockerRestart(req, res),
  stopAllNonFluxRunningApps: appController.stopAllNonFluxRunningApps,

  // Re-exported from appInspector
  appTop: appInspector.appTop,
  appLog: appInspector.appLog,
  appLogStream: appInspector.appLogStream,
  appLogPolling: appInspector.appLogPolling,
  appInspect: appInspector.appInspect,
  appStats: appInspector.appStats,
  appMonitor: async (req, res) => appInspector.appMonitor(req, res, appsMonitored),
  appMonitorStream: appInspector.appMonitorStream,
  appExec: appInspector.appExec,
  appChanges: appInspector.appChanges,
  startAppMonitoring: (appName) => appInspector.startAppMonitoring(appName, appsMonitored),
  stopAppMonitoring: (appName, deleteData) => appInspector.stopAppMonitoring(appName, deleteData, appsMonitored),
  listAppsImages: appInspector.listAppsImages,
  getAppsDOSState: appInspector.getAppsDOSState,
  checkApplicationsCpuUSage: () => appInspector.checkApplicationsCpuUSage(appsMonitored, installedApps),
  monitorSharedDBApps: () => appInspector.monitorSharedDBApps(installedApps, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)), getGlobalState()),
  checkStorageSpaceForApps: () => appInspector.checkStorageSpaceForApps(installedApps, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)), null, []),

  // Re-exported from appInstaller
  createAppVolume: appInstaller.createAppVolume,
  registerAppLocally: async (appSpecs, componentSpecs, res, test = false) => {
    // Sync global state before checking
    getGlobalState();

    // Original implementation with global state checks
    if (removalInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing removal. Installation not possible.');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }
    if (installationInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing installation. Installation not possible');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }

    // Call the modular implementation
    return appInstaller.registerAppLocally(appSpecs, componentSpecs, res, test);
  },
  installApplicationHard: appInstaller.installApplicationHard,
  installApplicationSoft: appInstaller.installApplicationSoft,

  // Re-exported from appUninstaller
  appUninstallHard: async (appName, appId, appSpecs, isComponent, res) =>
    appUninstaller.appUninstallHard(appName, appId, appSpecs, isComponent, res, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored), receiveOnlySyncthingAppsCache),
  appUninstallSoft: async (appName, appId, appSpecs, isComponent, res) =>
    appUninstaller.appUninstallSoft(appName, appId, appSpecs, isComponent, res, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  removeAppLocally: async (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  softRemoveAppLocally: async (app, res) =>
    appUninstaller.softRemoveAppLocally(app, res, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),
  removeAppLocallyApi: async (req, res) =>
    appUninstaller.removeAppLocallyApi(req, res, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored)),

  // Re-exported from portManager
  appPortsUnique: portManager.appPortsUnique,
  ensureAppUniquePorts: portManager.ensureAppUniquePorts,
  assignedPortsInstalledApps: portManager.assignedPortsInstalledApps,
  assignedPortsGlobalApps: portManager.assignedPortsGlobalApps,
  ensureApplicationPortsNotUsed: portManager.ensureApplicationPortsNotUsed,
  restoreFluxPortsSupport: portManager.restoreFluxPortsSupport,
  restoreAppsPortsSupport: portManager.restoreAppsPortsSupport,
  restorePortsSupport: portManager.restorePortsSupport,
  callOtherNodeToKeepUpnpPortsOpen: async () => portManager.callOtherNodeToKeepUpnpPortsOpen(failedNodesTestPortsCache, installedApps),
  getAllUsedPorts: portManager.getAllUsedPorts,
  isPortAvailable: portManager.isPortAvailable,
  findNextAvailablePort: portManager.findNextAvailablePort,

  // Re-exported from messageStore
  storeAppTemporaryMessage: messageStore.storeAppTemporaryMessage,
  storeAppPermanentMessage: messageStore.storeAppPermanentMessage,
  storeAppRunningMessage: messageStore.storeAppRunningMessage,
  storeAppInstallingMessage: messageStore.storeAppInstallingMessage,
  checkAppMessageExistence: messageVerifier.checkAppMessageExistence,
  checkAppTemporaryMessageExistence: messageVerifier.checkAppTemporaryMessageExistence,
  getAppsTemporaryMessages: messageVerifier.getAppsTemporaryMessages,
  getAppsPermanentMessages: messageVerifier.getAppsPermanentMessages,
  cleanupOldTemporaryMessages: messageStore.cleanupOldTemporaryMessages,

  // App Utilities
  appPricePerMonth: appUtilities.appPricePerMonth,
  nodeFullGeolocation: appUtilities.nodeFullGeolocation,
  getAppFolderSize: appUtilities.getAppFolderSize,
  getContainerStorage: appUtilities.getContainerStorage,
  getAppPorts: appUtilities.getAppPorts,
  specificationFormatter: appUtilities.specificationFormatter,
  parseAppSpecification: appUtilities.parseAppSpecification,
  validateAppName: appUtilities.validateAppName,
  sanitizeAppInput: appUtilities.sanitizeAppInput,
  generateAppHash: appUtilities.generateAppHash,
  extractAppMetadata: appUtilities.extractAppMetadata,

  // Chain Utilities
  getChainParamsPriceUpdates: chainUtilities.getChainParamsPriceUpdates,
  getChainTeamSupportAddressUpdates: chainUtilities.getChainTeamSupportAddressUpdates,

  // Message Verification
  verifyAppHash: messageVerifier.verifyAppHash,
  verifyAppMessageSignature: messageVerifier.verifyAppMessageSignature,
  verifyAppMessageUpdateSignature: messageVerifier.verifyAppMessageUpdateSignature,
  requestAppMessage: messageVerifier.requestAppMessage,
  requestAppsMessage: messageVerifier.requestAppsMessage,
  requestAppMessageAPI: messageVerifier.requestAppMessageAPI,
  storeAppInstallingErrorMessage: messageStore.storeAppInstallingErrorMessage,
  storeIPChangedMessage: messageStore.storeIPChangedMessage,
  storeAppRemovedMessage: messageStore.storeAppRemovedMessage,
  appHashHasMessage: messageVerifier.appHashHasMessage,
  appHashHasMessageNotFound: messageVerifier.appHashHasMessageNotFound,
  checkAndRequestApp: messageVerifier.checkAndRequestApp,
  checkAndRequestMultipleApps: messageVerifier.checkAndRequestMultipleApps,
  // Delegated to appHashSyncService
  continuousFluxAppHashesCheck: appHashSyncService.continuousFluxAppHashesCheck,
  triggerAppHashesCheckAPI: appHashSyncService.triggerAppHashesCheckAPI,

  // Image Management & Security
  verifyRepository: imageManager.verifyRepository,
  getBlockedRepositores: imageManager.getBlockedRepositores,
  getUserBlockedRepositores: imageManager.getUserBlockedRepositores,
  checkAppSecrets: imageManager.checkAppSecrets,
  checkApplicationImagesComplience: imageManager.checkApplicationImagesComplience,
  checkApplicationImagesBlocked: imageManager.checkApplicationImagesBlocked,
  checkApplicationsCompliance: () => imageManager.checkApplicationsCompliance(installedApps, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored))),

  // Registry & Database Management
  getAppHashes: registryManager.getAppHashes,
  appLocation: registryManager.appLocation,
  appInstallingLocation: registryManager.appInstallingLocation,
  getAppsLocations: registryManager.getAppsLocations,
  getAppsLocation: registryManager.getAppsLocation,
  getAppInstallingLocation: registryManager.getAppInstallingLocation,
  getAppInstallingErrorsLocation: registryManager.getAppInstallingErrorsLocation,
  getAppsInstallingErrorsLocations: registryManager.getAppsInstallingErrorsLocations,
  getApplicationGlobalSpecifications: registryManager.getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications: registryManager.getApplicationLocalSpecifications,
  getApplicationSpecifications: registryManager.getApplicationSpecifications,
  getApplicationSpecificationAPI: registryManager.getApplicationSpecificationAPI,
  updateApplicationSpecificationAPI: registryManager.updateApplicationSpecificationAPI,
  getApplicationOwnerAPI: registryManager.getApplicationOwnerAPI,
  getGlobalAppsSpecifications: registryManager.getGlobalAppsSpecifications,
  availableApps: registryManager.availableApps,
  checkApplicationRegistrationNameConflicts: registryManager.checkApplicationRegistrationNameConflicts,
  updateAppSpecifications: registryManager.updateAppSpecifications,
  updateAppSpecsForRescanReindex: registryManager.updateAppSpecsForRescanReindex,
  storeAppSpecificationInPermanentStorage: registryManager.storeAppSpecificationInPermanentStorage,
  removeAppSpecificationFromStorage: registryManager.removeAppSpecificationFromStorage,
  getAppSpecificationFromDb: registryManager.getAppSpecificationFromDb,
  getAllAppsInformation: registryManager.getAllAppsInformation,
  getInstalledApps: registryManager.getInstalledApps,
  getRunningApps: registryManager.getRunningApps,
  getAllGlobalApplications: registryManager.getAllGlobalApplications,
  expireGlobalApplications: registryManager.expireGlobalApplications,
  reindexGlobalAppsInformation: registryManager.reindexGlobalAppsInformation,
  reconstructAppMessagesHashCollection: registryManager.reconstructAppMessagesHashCollection,
  reconstructAppMessagesHashCollectionAPI: registryManager.reconstructAppMessagesHashCollectionAPI,

  // Advanced Workflows
  createAppVolume: advancedWorkflows.createAppVolume,
  softRegisterAppLocally: advancedWorkflows.softRegisterAppLocally,
  redeployAPI: advancedWorkflows.redeployAPI,
  checkFreeAppUpdate: appSpecHelpers.checkFreeAppUpdate,
  // verifyAppUpdateParameters moved to appValidator module
  stopSyncthingApp: advancedWorkflows.stopSyncthingApp,
  appendBackupTask: advancedWorkflows.appendBackupTask,
  appendRestoreTask: advancedWorkflows.appendRestoreTask,
  removeTestAppMount: advancedWorkflows.removeTestAppMount,
  testAppMount: advancedWorkflows.testAppMount,
  checkApplicationUpdateNameRepositoryConflicts: advancedWorkflows.checkApplicationUpdateNameRepositoryConflicts,
  forceAppRemovals: () => advancedWorkflows.forceAppRemovals(installedApps, listAllApps, registryManager.getApplicationGlobalSpecifications, (app, res, force, endResponse, sendMessage) =>
    appUninstaller.removeAppLocally(app, res, force, endResponse, sendMessage, getGlobalState(), (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored))),
  masterSlaveApps: () => {
    const https = require('https');
    return advancedWorkflows.masterSlaveApps(getGlobalState(), installedApps, listRunningApps, receiveOnlySyncthingAppsCache, backupInProgress, globalState.restoreInProgress, https);
  },
  trySpawningGlobalApplication: async () => {
    let shortDelayTime = 5 * 60 * 1000; // Default 5 minutes
    try {
      // how do we continue with this function?
      // we have globalapplication specifics list
      // check if we are synced
      const synced = await generalService.checkSynced();
      if (synced !== true) {
        log.info('Flux not yet synced');
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      if (!globalState.checkAndSyncAppHashesWasEverExecuted) {
        log.info('Flux checkAndSyncAppHashesWasEverExecuted not yet executed');
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      let isNodeConfirmed = false;
      isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
      if (!isNodeConfirmed) {
        log.info('Flux Node not Confirmed. Global applications will not be installed');
        globalState.fluxNodeWasNotConfirmedOnLastCheck = true;
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      if (globalState.firstExecutionAfterItsSynced === true) {
        log.info('Explorer Synced, checking for expired apps');
        await registryManager.expireGlobalApplications();
        globalState.firstExecutionAfterItsSynced = false;
        await advancedWorkflows.getPeerAppsInstallingErrorMessages();
      }

      if (globalState.fluxNodeWasAlreadyConfirmed && globalState.fluxNodeWasNotConfirmedOnLastCheck) {
        globalState.fluxNodeWasNotConfirmedOnLastCheck = false;
        setTimeout(() => {
          // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
          // 125 minutes should give enough time for node receive currently two times the apprunning messages
          module.exports.trySpawningGlobalApplication();
        }, 125 * 60 * 1000);
        return;
      }
      globalState.fluxNodeWasAlreadyConfirmed = true;

      const benchmarkResponse = await benchmarkService.getBenchmarks();
      if (benchmarkResponse.status === 'error') {
        log.info('FluxBench status Error. Global applications will not be installed');
        await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }
      if (benchmarkResponse.data.thunder) {
        log.info('Flux Node is a Fractus Storage Node. Global applications will not be installed');
        await serviceHelper.delay(24 * 3600 * 1000); // check again in one day as changing from and to only requires the restart of flux daemon
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // get my external IP and check that it is longer than 5 in length.
      let myIP = null;
      if (benchmarkResponse.data.ipaddress) {
        log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
        myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
      }
      if (myIP === null) {
        throw new Error('Unable to detect Flux IP address');
      }

      // get all the applications list names missing instances
      const { globalAppsInformation } = require('./utils/appConstants');
      const pipeline = [
        {
          $lookup: {
            from: 'zelappslocation',
            localField: 'name',
            foreignField: 'name',
            as: 'locations',
          },
        },
        {
          $addFields: {
            actual: { $size: '$locations.name' },
          },
        },
        {
          $match: {
            $expr: { $lt: ['$actual', { $ifNull: ['$instances', 3] }] },
          },
        },
        {
          $project: {
            _id: 0,
            name: '$name',
            actual: '$actual',
            required: '$instances',
            nodes: { $ifNull: ['$nodes', []] },
            geolocation: { $ifNull: ['$geolocation', []] },
            hash: '$hash',
            version: '$version',
            enterprise: '$enterprise',
          },
        },
        { $sort: { name: 1 } },
      ];

      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      log.info('trySpawningGlobalApplication - Checking for apps that are missing instances on the network.');
      let globalAppNamesLocation = await dbHelper.aggregateInDatabase(database, globalAppsInformation, pipeline);
      const numberOfGlobalApps = globalAppNamesLocation.length;
      if (!numberOfGlobalApps) {
        log.info('trySpawningGlobalApplication - No installable application found');
        await serviceHelper.delay(30 * 60 * 1000);
        module.exports.trySpawningGlobalApplication();
        return;
      }
      log.info(`trySpawningGlobalApplication - Found ${numberOfGlobalApps} apps that are missing instances on the network.`);

      // If there are multiple apps to process, use shorter delays
      const delayTime = numberOfGlobalApps > 1 ? 60 * 1000 : 30 * 60 * 1000;
      shortDelayTime = numberOfGlobalApps > 1 ? 60 * 1000 : 5 * 60 * 1000;

      let appToRun = null;
      let appToRunAux = null;
      let minInstances = null;
      let appHash = null;
      let appFromAppsToBeCheckedLater = false;
      let appFromAppsSyncthingToBeCheckedLater = false;
      const { appsToBeCheckedLater, appsSyncthingToBeCheckedLater } = globalState;
      const appIndex = appsToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
      const appSyncthingIndex = appsSyncthingToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
      let runningAppList = [];
      let installingAppList = [];

      if (appIndex >= 0) {
        appToRun = appsToBeCheckedLater[appIndex].appName;
        appHash = appsToBeCheckedLater[appIndex].hash;
        minInstances = appsToBeCheckedLater[appIndex].required;
        appsToBeCheckedLater.splice(appIndex, 1);
        appFromAppsToBeCheckedLater = true;
      } else if (appSyncthingIndex >= 0) {
        appToRun = appsSyncthingToBeCheckedLater[appSyncthingIndex].appName;
        appHash = appsSyncthingToBeCheckedLater[appSyncthingIndex].hash;
        minInstances = appsSyncthingToBeCheckedLater[appSyncthingIndex].required;
        appsSyncthingToBeCheckedLater.splice(appSyncthingIndex, 1);
        appFromAppsSyncthingToBeCheckedLater = true;
      } else {
        const myNodeLocation = systemIntegration.nodeFullGeolocation();

        const runningApps = await appQueryService.listRunningApps();
        if (runningApps.status !== 'success') {
          throw new Error('trySpawningGlobalApplication - Unable to check running apps on this Flux');
        }

        // filter apps that failed to install before
        globalAppNamesLocation = globalAppNamesLocation.filter((app) => !runningApps.data.find((appsRunning) => appsRunning.Names[0].slice(5) === app.name)
          && !globalState.spawnErrorsLongerAppCache.has(app.hash)
          && !globalState.trySpawningGlobalAppCache.has(app.hash)
          && !appsToBeCheckedLater.includes((appAux) => appAux.appName === app.name));
        // filter apps that are non enterprise or are marked to install on my node
        globalAppNamesLocation = globalAppNamesLocation.filter((app) => app.nodes.length === 0 || app.nodes.find((ip) => ip === myIP) || app.version >= 8);
        // filter apps that dont have geolocation or that are forbidden to spawn on my node geolocation
        globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('a!c')).length === 0 || !app.geolocation.find((loc) => loc.startsWith('a!c') && `a!c${myNodeLocation}`.startsWith(loc.replace('_NONE', '')))));
        // filter apps that dont have geolocation or have and match my node geolocation
        globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('ac')).length === 0 || app.geolocation.find((loc) => loc.startsWith('ac') && `ac${myNodeLocation}`.startsWith(loc))));

        if (globalAppNamesLocation.length === 0) {
          log.info('trySpawningGlobalApplication - No app currently to be processed');
          await serviceHelper.delay(30 * 60 * 1000);
          module.exports.trySpawningGlobalApplication();
          return;
        }
        log.info(`trySpawningGlobalApplication - Found ${globalAppNamesLocation.length} apps that are missing instances on the network and can be selected to try to spawn on my node.`);
        let random = Math.floor(Math.random() * globalAppNamesLocation.length);
        appToRunAux = globalAppNamesLocation[random];
        const filterAppsWithNyNodeIP = globalAppNamesLocation.filter((app) => app.nodes.find((ip) => ip === myIP));
        if (filterAppsWithNyNodeIP.length > 0) {
          random = Math.floor(Math.random() * filterAppsWithNyNodeIP.length);
          appToRunAux = filterAppsWithNyNodeIP[random];
        }

        appToRun = appToRunAux.name;
        appHash = appToRunAux.hash;
        minInstances = appToRunAux.required;

        log.info(`trySpawningGlobalApplication - Application ${appToRun} selected to try to spawn. Reported as been running in ${appToRunAux.actual} instances and ${appToRunAux.required} are required.`);
        runningAppList = await registryManager.appLocation(appToRun);
        installingAppList = await registryManager.appInstallingLocation(appToRun);
        if (runningAppList.length + installingAppList.length > minInstances) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
          await serviceHelper.delay(shortDelayTime);
          module.exports.trySpawningGlobalApplication();
          return;
        }
        const isArcane = Boolean(process.env.FLUXOS_PATH);
        if (appToRunAux.enterprise && !isArcane) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} can only install on ArcaneOS`);
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          await serviceHelper.delay(shortDelayTime);
          module.exports.trySpawningGlobalApplication();
          return;
        }
      }

      globalState.trySpawningGlobalAppCache.set(appHash, '');
      log.info(`trySpawningGlobalApplication - App ${appToRun} hash: ${appHash}`);

      /* const installingAppErrorsList = await registryManager.appInstallingErrorsLocation(appToRun);
      if (installingAppErrorsList.find((app) => !app.expireAt && app.hash === appHash)) {
        globalState.spawnErrorsLongerAppCache.set(appHash, '');
        throw new Error(`trySpawningGlobalApplication - App ${appToRun} is marked as having errors on app installing errors locations.`);
      }*/

      runningAppList = await registryManager.appLocation(appToRun);

      const adjustedIP = myIP.split(':')[0]; // just IP address
      // check if app not running on this device
      if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
        await serviceHelper.delay(delayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }
      if (installingAppList.find((document) => document.ip.includes(adjustedIP))) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
        await serviceHelper.delay(delayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // get app specifications
      const appSpecifications = await registryManager.getApplicationGlobalSpecifications(appToRun);
      if (!appSpecifications) {
        throw new Error(`trySpawningGlobalApplication - Specifications for application ${appToRun} were not found!`);
      }

      // eslint-disable-next-line no-restricted-syntax
      const dbopen = dbHelper.databaseConnection();
      const { localAppsInformation } = require('./utils/appConstants');
      const appsDatabase = dbopen.db(config.database.appslocal.database);
      const appsQuery = {}; // all
      const appsProjection = {
        projection: {
          _id: 0,
          name: 1,
          version: 1,
          repotag: 1,
          compose: 1,
        },
      };
      const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const appExists = apps.find((app) => app.name === appSpecifications.name);
      if (appExists) { // double checked in installation process.
        log.info(`trySpawningGlobalApplication - Application ${appSpecifications.name} is already installed`);
        await serviceHelper.delay(shortDelayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // verify app compliance
      await imageManager.checkApplicationImagesComplience(appSpecifications).catch((error) => {
        if (error.message !== 'Unable to communicate with Flux Services! Try again later.') {
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
        }
        throw error;
      });

      // verify requirements
      await hwRequirements.checkAppRequirements(appSpecifications);

      // ensure ports unused
      // Get apps running specifically on this IP
      const myIPAddress = myIP.split(':')[0]; // just IP address without port
      const runningAppsOnThisIP = await registryManager.getRunningAppIpList(myIPAddress);
      const runningAppsNames = runningAppsOnThisIP.map((app) => app.name);

      await portManager.ensureApplicationPortsNotUsed(appSpecifications, runningAppsNames);

      const appPorts = appUtilities.getAppPorts(appSpecifications);
      // check port is not user blocked
      const fluxNetworkHelper = require('./fluxNetworkHelper');
      appPorts.forEach((port) => {
        const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
        if (isUserBlocked) {
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          throw new Error(`trySpawningGlobalApplication - Port ${port} is blocked by user. Installation aborted.`);
        }
      });

      // Check if ports are publicly available - critical for proper Flux network operation
      const portsPubliclyAvailable = await portManager.checkInstallingAppPortAvailable(appPorts);
      if (portsPubliclyAvailable === false) {
        log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
        await serviceHelper.delay(shortDelayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // double check if app is installed on the number of instances requested
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        await serviceHelper.delay(shortDelayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      let syncthingApp = false;
      if (appSpecifications.version <= 3) {
        syncthingApp = appSpecifications.containerData.includes('g:') || appSpecifications.containerData.includes('r:') || appSpecifications.containerData.includes('s:');
      } else {
        syncthingApp = appSpecifications.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      }

      if (syncthingApp) {
        const myIpWithoutPort = myIP.split(':')[0];
        const lastIndex = myIpWithoutPort.lastIndexOf('.');
        const secondLastIndex = myIpWithoutPort.substring(0, lastIndex).lastIndexOf('.');
        const sameIpRangeNode = runningAppList.find((location) => location.ip.includes(myIpWithoutPort.substring(0, secondLastIndex)));
        if (sameIpRangeNode) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
          await serviceHelper.delay(shortDelayTime);
          module.exports.trySpawningGlobalApplication();
          return;
        }
        if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater && runningAppList.length < 6) {
          // check if there are connectivity to all nodes
          const fluxNetworkHelper = require('./fluxNetworkHelper');
          // eslint-disable-next-line no-restricted-syntax
          for (const node of runningAppList) {
            const ip = node.ip.split(':')[0];
            const port = node.ip.split(':')[1] || '16127';
            // eslint-disable-next-line no-await-in-loop
            const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
            if (!isOpen) {
              log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance running on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 30m if remaining missing instances`);
              const appToCheck = {
                timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
                appName: appToRun,
                hash: appHash,
                required: minInstances,
              };
              globalState.appsSyncthingToBeCheckedLater.push(appToCheck);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(shortDelayTime);
              globalState.trySpawningGlobalAppCache.delete(appHash);
              module.exports.trySpawningGlobalApplication();
              return;
            }
          }
        }
      }

      if (!appFromAppsToBeCheckedLater) {
        const tier = await generalService.nodeTier();
        const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecifications, tier);
        let delay = false;
        const isArcane = Boolean(process.env.FLUXOS_PATH);
        if (!appToRunAux.enterprise && isArcane) {
          const appToCheck = {
            timeToCheck: Date.now() + 0.95 * 60 * 60 * 1000,
            appName: appToRun,
            hash: appHash,
            required: minInstances,
          };
          log.info(`trySpawningGlobalApplication - App ${appToRun} specs not enterprise, will check in around 1h if instances are still missing`);
          globalState.appsToBeCheckedLater.push(appToCheck);
          globalState.trySpawningGlobalAppCache.delete(appHash);
          delay = true;
        } else if (appToRunAux.nodes.length > 0 && !appToRunAux.nodes.find((ip) => ip === myIP)) {
          const appToCheck = {
            timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
            appName: appToRun,
            hash: appHash,
            required: minInstances,
          };
          log.info(`trySpawningGlobalApplication - App ${appToRun} specs have target ips, will check in around 0.5h if instances are still missing`);
          globalState.appsToBeCheckedLater.push(appToCheck);
          globalState.trySpawningGlobalAppCache.delete(appHash);
          delay = true;
        } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
          const appToCheck = {
            timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 1.95 * 60 * 60 * 1000,
            appName: appToRun,
            hash: appHash,
            required: minInstances,
          };
          log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 2h if instances are still missing`);
          globalState.appsToBeCheckedLater.push(appToCheck);
          globalState.trySpawningGlobalAppCache.delete(appHash);
          delay = true;
        } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
          const appToCheck = {
            timeToCheck: appToRunAux.enterprise ? Date.now() + 0.35 * 60 * 60 * 1000 : Date.now() + 1.45 * 60 * 60 * 1000,
            appName: appToRun,
            hash: appHash,
            required: minInstances,
          };
          log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from nimbus, will check in around 1h30 if instances are still missing`);
          globalState.appsToBeCheckedLater.push(appToCheck);
          globalState.trySpawningGlobalAppCache.delete(appHash);
          delay = true;
        } else if (appToRunAux.nodes.length === 0 && tier === 'super' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
          const appToCheck = {
            timeToCheck: appToRunAux.enterprise ? Date.now() + 0.2 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
            appName: appToRun,
            hash: appHash,
            required: minInstances,
          };
          log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 1h if instances are still missing`);
          globalState.appsToBeCheckedLater.push(appToCheck);
          globalState.trySpawningGlobalAppCache.delete(appHash);
          delay = true;
        }
        if (delay) {
          await serviceHelper.delay(shortDelayTime);
          module.exports.trySpawningGlobalApplication();
          return;
        }
      }

      // ToDo: Move this to global
      const architecture = await systemIntegration.systemArchitecture();

      // TODO evaluate later to move to more broad check as image can be shared among multiple apps
      const compositedSpecification = appSpecifications.compose || [appSpecifications]; // use compose array if v4+ OR if not defined its <= 3 do an array of appSpecs.
      // eslint-disable-next-line no-restricted-syntax
      for (const componentToInstall of compositedSpecification) {
        // check image is whitelisted and repotag is available for download
        // eslint-disable-next-line no-await-in-loop
        await imageManager.verifyRepository(componentToInstall.repotag, { repoauth: componentToInstall.repoauth, architecture }).catch((error) => {
          globalState.spawnErrorsLongerAppCache.set(appHash, '');
          throw error;
        });
      }

      // triple check if app is installed on the number of instances requested
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        await serviceHelper.delay(shortDelayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      // an application was selected and checked that it can run on this node. try to install and run it locally
      // lets broadcast to the network the app is going to be installed on this node, so we don't get lot's of intances installed when it's not needed
      let broadcastedAt = Date.now();
      const newAppInstallingMessage = {
        type: 'fluxappinstalling',
        version: 1,
        name: appSpecifications.name,
        ip: myIP,
        broadcastedAt,
      };

      // store it in local database first
      await registryManager.storeAppInstallingMessage(newAppInstallingMessage);
      // broadcast messages about running apps to all peers
      const fluxCommMessagesSender = require('./fluxCommunicationMessagesSender');
      await fluxCommMessagesSender.broadcastMessageToOutgoing(newAppInstallingMessage);
      await serviceHelper.delay(500);
      await fluxCommMessagesSender.broadcastMessageToIncoming(newAppInstallingMessage);

      await serviceHelper.delay(30 * 1000); // give it time so messages are propagated on the network

      // double check if app is installed in more of the instances requested
      runningAppList = await registryManager.appLocation(appToRun);
      installingAppList = await registryManager.appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        installingAppList.sort((a, b) => {
          if (a.broadcastedAt < b.broadcastedAt) {
            return -1;
          }
          if (a.broadcastedAt > b.broadcastedAt) {
            return 1;
          }
          return 0;
        });
        broadcastedAt = Date.now();
        const index = installingAppList.findIndex((x) => x.ip === myIP);
        if (runningAppList.length + index + 1 > minInstances) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances, my instance is number ${runningAppList.length + index + 1}`);
          await serviceHelper.delay(shortDelayTime);
          module.exports.trySpawningGlobalApplication();
          return;
        }
      }

      // install the app
      let registerOk = false;
      try {
        registerOk = await module.exports.registerAppLocally(appSpecifications, null, null, false); // can throw
      } catch (error) {
        log.error(error);
        registerOk = false;
      }
      if (!registerOk) {
        log.info('trySpawningGlobalApplication - Error on registerAppLocally');
        await serviceHelper.delay(shortDelayTime);
        module.exports.trySpawningGlobalApplication();
        return;
      }

      await serviceHelper.delay(1 * 60 * 1000); // await 1 minute to give time for messages to be propagated on the network
      // double check if app is installed in more of the instances requested
      runningAppList = await registryManager.appLocation(appToRun);
      if (runningAppList.length > minInstances) {
        runningAppList.sort((a, b) => {
          if (!a.runningSince && b.runningSince) {
            return -1;
          }
          if (a.runningSince && !b.runningSince) {
            return 1;
          }
          if (a.runningSince < b.runningSince) {
            return -1;
          }
          if (a.runningSince > b.runningSince) {
            return 1;
          }
          return 0;
        });
        const index = runningAppList.findIndex((x) => x.ip === myIP);
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned on ${runningAppList.length} instances, my instance is number ${index + 1}`);
        if (index + 1 > minInstances) {
          log.info(`trySpawningGlobalApplication - Application ${appToRun} is going to be removed as already passed the instances required.`);
          globalState.trySpawningGlobalAppCache.delete(appHash);
          module.exports.removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
        }
      }

      await serviceHelper.delay(delayTime);
      log.info('trySpawningGlobalApplication - Reinitiating possible app installation');
      module.exports.trySpawningGlobalApplication();
    } catch (error) {
      log.error(error);
      await serviceHelper.delay(shortDelayTime || 5 * 60 * 1000);
      module.exports.trySpawningGlobalApplication();
    }
  },

  // System Integration
  systemArchitecture: systemIntegration.systemArchitecture,
  // Use the original business logic for checkAppHWRequirements that calls appsResources
  checkAppHWRequirements: async (appSpecs) => {
    // appSpecs has hdd, cpu and ram assigned to correct tier
    const tier = await generalService.nodeTier();
    const resourcesLocked = await resourceQueryService.appsResources();
    if (resourcesLocked.status !== 'success') {
      throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
    }

    const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecs, tier);
    const nodeSpecs = await hwRequirements.getNodeSpecs();
    const totalSpaceOnNode = nodeSpecs.ssdStorage;
    if (totalSpaceOnNode === 0) {
      throw new Error('Insufficient space on Flux Node to spawn an application');
    }
    const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
    const hddLockedByApps = resourcesLocked.data.appsHddLocked;
    const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps;
    // bigger or equal so we have the 1 gb free...
    if (appHWrequirements.hdd > availableSpaceForApps) {
      throw new Error('Insufficient space on Flux Node to spawn an application');
    }

    const totalCpuOnNode = nodeSpecs.cpuCores * 10;
    const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
    const cpuLockedByApps = resourcesLocked.data.appsCpusLocked * 10;
    const adjustedAppCpu = appHWrequirements.cpu * 10;
    const availableCpuForApps = useableCpuOnNode - cpuLockedByApps;
    if (adjustedAppCpu > availableCpuForApps) {
      throw new Error('Insufficient CPU power on Flux Node to spawn an application');
    }

    const totalRamOnNode = nodeSpecs.ram;
    const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
    const ramLockedByApps = resourcesLocked.data.appsRamLocked;
    const availableRamForApps = useableRamOnNode - ramLockedByApps;
    if (appHWrequirements.ram > availableRamForApps) {
      throw new Error('Insufficient RAM on Flux Node to spawn an application');
    }
    return true;
  },
  createFluxNetworkAPI: systemIntegration.createFluxNetworkAPI,

  // State Management Functions
  removalInProgressReset: globalState.removalInProgressReset,
  setRemovalInProgressToTrue: globalState.setRemovalInProgressToTrue,
  installationInProgressReset: globalState.installationInProgressReset,
  setInstallationInProgressTrue: globalState.setInstallationInProgressTrue,
  checkAndRemoveApplicationInstance: advancedWorkflows.checkAndRemoveApplicationInstance,
  reinstallOldApplications: advancedWorkflows.reinstallOldApplications,

  // Constants and utilities
  appConstants,

  // Global state access (controlled)
  getGlobalState,

  setGlobalState: (state) => {
    if (state.removalInProgress !== undefined) removalInProgress = state.removalInProgress;
    if (state.installationInProgress !== undefined) installationInProgress = state.installationInProgress;
    if (state.reinstallationOfOldAppsInProgress !== undefined) reinstallationOfOldAppsInProgress = state.reinstallationOfOldAppsInProgress;
    if (state.masterSlaveAppsRunning !== undefined) masterSlaveAppsRunning = state.masterSlaveAppsRunning;
  },

  // Cache and maps access
  getCaches: () => ({
    spawnErrorsLongerAppCache,
    trySpawningGlobalAppCache,
    myShortCache,
    myLongCache,
    failedNodesTestPortsCache,
    receiveOnlySyncthingAppsCache,
    appsStopedCache,
    syncthingDevicesIDCache,
  }),

  getMaps: () => ({
    hashesNumberOfSearchs,
    mastersRunningGSyncthingApps,
    timeTostartNewMasterApp,
  }),

  // Critical API functions
  installAppLocally: appInstaller.installAppLocally,
  testAppInstall: appInstaller.testAppInstall,
  updateAppGlobalyApi: advancedWorkflows.updateAppGlobalyApi,
  getAppPrice: appSpecHelpers.getAppPrice,
  getAppFiatAndFluxPrice: appSpecHelpers.getAppFiatAndFluxPrice,
  verifyAppRegistrationParameters: appValidator.verifyAppRegistrationParameters,
  verifyAppUpdateParameters: appValidator.verifyAppUpdateParameters,
  checkDockerAccessibility: imageManager.checkDockerAccessibility,
  registrationInformation: registryManager.registrationInformation,

  // Registry API functions (already declared earlier but kept for backward compatibility)
  registerAppGlobalyApi: registryManager.registerAppGlobalyApi,
  reindexGlobalAppsLocationAPI: registryManager.reindexGlobalAppsLocationAPI,
  reindexGlobalAppsInformationAPI: registryManager.reindexGlobalAppsInformationAPI,
  rescanGlobalAppsInformationAPI: registryManager.rescanGlobalAppsInformationAPI,
  appLocation: registryManager.appLocation,

  // Re-exported from dockerOperations
  appDockerStop: (appname) => dockerOperations.appDockerStop(
    appname,
    appInspector.stopAppMonitoring,
    appsMonitored,
    registryManager.getApplicationSpecifications,
  ),
  appDockerRestart: (appname) => dockerOperations.appDockerRestart(
    appname,
    appInspector.startAppMonitoring,
    appsMonitored,
    registryManager.getApplicationSpecifications,
  ),
  appDeleteDataInMountPoint: dockerOperations.appDeleteDataInMountPoint,

  // Re-exported from testHelpers
  handleTestShutdown: (testingPort, testHttpServer, options) => testHelpers.handleTestShutdown(
    testingPort,
    testHttpServer,
    options,
    fluxNetworkHelper.isFirewallActive,
    fluxNetworkHelper.deleteAllowPortRule,
    upnpService.removeMapUpnpPort,
  ),
};
