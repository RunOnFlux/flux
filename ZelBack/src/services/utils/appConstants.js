const config = require('config');
const path = require('path');

// Directory paths
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = path.join(appsFolderPath, '/');
// Backing FLUXFSVOL images live here when the host volume is the root
// filesystem (the directory ships with the repo - see appvolumes/.gitkeep).
const appVolumesPath = path.join(fluxDirPath, 'appvolumes');
// The path used to be assembled by string concatenation without a separator,
// landing images in a glued '<fluxDir>appvolumes' sibling directory (e.g.
// ~/zelfluxappvolumes). Volumes created by older FluxOS still live there, so
// discovery must keep checking it.
const legacyAppVolumesPath = `${fluxDirPath}appvolumes`;

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
const globalAppStateEvents = config.database.appsglobal.collections.appStateEvents;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;
const globalAppsInstallingErrorsBroadcasts = config.database.appsglobal.collections.appsInstallingErrorsBroadcasts;

// App / component name validation regexes.
// v8+ app names allow internal hyphens; v<=7 app names and all component names are strictly alphanumeric.
const APP_NAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const APP_NAME_REGEX_LEGACY = /^[a-zA-Z0-9]+$/;

// Mount options for an app's FLUXFSVOL. An app volume holds data its owner
// writes, so nothing stored there should be able to confer privilege on
// whatever reads it back.
//
// `nosuid` makes any setuid/setgid bit on the volume inert. It does NOT prevent
// execution - an app that downloads and runs a binary from its own volume is
// unaffected - it only stops that binary switching to another user. Legitimate
// setuid binaries live in the container image, not in appdata.
//
// `nodev` stops a device node on the volume being honoured; an app that needs
// device access gets it from docker's device mapping.
//
// This belongs at the mount rather than in any one caller because there is more
// than one way for such a file to arrive: unpacking a user-supplied archive is
// the obvious one, but a copy preserves the bits too. A bind mount inherits its
// source's options, so a volume handed to a container carries them as well.
const APP_VOLUME_MOUNT_OPTIONS = 'loop,nosuid,nodev';

// Supported architectures
const supportedArchitectures = ['amd64', 'arm64'];

// Enterprise required architectures (Arcane nodes are amd64-only)
const enterpriseRequiredArchitectures = ['amd64'];

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

// Expiry / TTL constants (milliseconds)
const GOSSIP_VALIDITY_MS = 5 * 60 * 1000;
const RUNNING_EXPIRY_MS = 125 * 60 * 1000;
const INSTALLING_EXPIRY_MS = 15 * 60 * 1000;
const INSTALLING_ERRORS_EXPIRY_MS = 24 * 60 * 60 * 1000;
const SIGTERM_EXPIRY_MS = 420 * 1000;
const EVICTED_EXPIRY_MS = RUNNING_EXPIRY_MS;

// Hash sync constants (blocks, at 30s per block)
const HASH_EXPIRY_BLOCKS = 1051200; // ~1 year — permanently flag unresolvable hashes
const HASH_RETRY_BACKOFF = [0, 100, 500, 2500, 12500, 50000, 100000]; // ~0, 50min, 4h, 21h, 4d, 17d, 35d

module.exports = {
  // Paths
  fluxDirPath,
  appsFolderPath,
  appsFolder,
  appVolumesPath,
  legacyAppVolumesPath,

  // Database collections
  scannedHeightCollection,
  appsHashesCollection,
  localAppsInformation,
  globalAppsMessages,
  globalAppsInformation,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations,
  globalAppStateEvents,
  globalAppsInstallingErrorsLocations,
  globalAppsInstallingErrorsBroadcasts,

  // Validation regexes
  APP_NAME_REGEX,
  APP_NAME_REGEX_LEGACY,

  // Volumes
  APP_VOLUME_MOUNT_OPTIONS,

  // Configuration
  supportedArchitectures,
  enterpriseRequiredArchitectures,
  isArcane,
  appsThatMightBeUsingOldGatewayIpAssignment,
  defaultNodeSpecs,

  // Expiry / TTL
  GOSSIP_VALIDITY_MS,
  RUNNING_EXPIRY_MS,
  INSTALLING_EXPIRY_MS,
  INSTALLING_ERRORS_EXPIRY_MS,
  SIGTERM_EXPIRY_MS,
  EVICTED_EXPIRY_MS,

  // Hash sync
  HASH_EXPIRY_BLOCKS,
  HASH_RETRY_BACKOFF,
};
