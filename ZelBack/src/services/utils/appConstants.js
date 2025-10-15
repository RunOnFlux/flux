const config = require('config');
const path = require('path');

// Directory paths
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = path.join(appsFolderPath, '/');

// Database collections - Daemon
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;

// Database collections - Local apps
const localAppsInformation = config.database.appslocal.collections.appsInformation;

// Database collections - Global apps
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsInstallingLocations = config.database.appsglobal.collections.appsInstallingLocations;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;

// Supported architectures
const supportedArchitectures = ['amd64', 'arm64'];

// Environment flags
const isArcane = Boolean(process.env.FLUXOS_PATH);

// Apps that might be using old gateway IP assignment
const appsThatMightBeUsingOldGatewayIpAssignment = [
  'HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated',
  'isokosse', 'ChainBraryDApp', 'health', 'ethercalc',
];

// Default node specifications
const defaultNodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

// Apps monitored structure template
const appsMonitoredTemplate = {
  // component1_appname2: { // >= 4 or name for <= 3
  //   oneMinuteInterval: null, // interval
  //   fifteenMinInterval: null, // interval
  //   oneMinuteStatsStore: [ // stores last hour of stats of app measured every minute
  //     { // object of timestamp, data
  //       timestamp: 0,
  //       data: { },
  //     },
  //   ],
  //   fifteenMinStatsStore: [ // stores last 24 hours of stats of app measured every 15 minutes
  //     { // object of timestamp, data
  //       timestamp: 0,
  //       data: { },
  //     },
  //   ],
  // },
};

module.exports = {
  // Paths
  fluxDirPath,
  appsFolderPath,
  appsFolder,

  // Database collections
  scannedHeightCollection,
  appsHashesCollection,
  localAppsInformation,
  globalAppsMessages,
  globalAppsInformation,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  globalAppsInstallingErrorsLocations,

  // Configuration
  supportedArchitectures,
  isArcane,
  appsThatMightBeUsingOldGatewayIpAssignment,
  defaultNodeSpecs,
  appsMonitoredTemplate,
};
