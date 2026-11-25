// What each kind of signed state broadcast and app message carries. A signature
// says who sent a broadcast, not that it is well formed, so a node checks this
// before it acts on one, whether it arrived alone or in a sync answer.

const config = require('config');
const { APP_NAME_REGEX, MAX_APP_NAME_LENGTH } = require('./appConstants');
const { parseSocketAddress } = require('./socketAddressUtils');

// The fields of the fixed-size broadcasts, an address, an app name and a time, come
// to under 200 bytes.
const FIXED_SIZE_MAX_BYTES = 1024;
const MAX_APPS_PER_NODE = config.fluxapps.maxAppsPerNode;

const isText = (value) => typeof value === 'string' && value.length > 0;
// An app's name, as its specification may give one (appValidator).
const isAppName = (value) => typeof value === 'string' && value.length <= MAX_APP_NAME_LENGTH && APP_NAME_REGEX.test(value);
// An app specification's hash: SHA-256, in hex.
const isSpecHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// A node's address: an IPv4 address, with its API port or without.
const isNodeAddress = (value) => parseSocketAddress(value) !== null;
// A time as Date#toISOString writes it.
const isIsoTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

// Whether an object carries exactly these fields and no other.
function hasExactly(data, fields) {
  const keys = Object.keys(data);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(data, field));
}

const APP_RUNNING_FIELDS = ['type', 'version', 'apps', 'ip', 'broadcastedAt', 'osUptime', 'staticIp'];
const APP_RUNNING_ENTRY_FIELDS = ['name', 'hash', 'runningSince'];

/**
 * Whether an app a running message names is exactly an app's name, its
 * specification's hash and when its node took it.
 * @param {*} entry
 * @returns {boolean}
 */
function isAppRunningEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && hasExactly(entry, APP_RUNNING_ENTRY_FIELDS)
    && isAppName(entry.name) && isSpecHash(entry.hash) && isIsoTime(entry.runningSince);
}

// Version 2 names every app its node runs; no release on the network sends
// version 1, which named one.
function appRunningShape(data) {
  return data.version === 2 && hasExactly(data, APP_RUNNING_FIELDS)
    && isNodeAddress(data.ip) && typeof data.osUptime === 'number' && typeof data.staticIp === 'boolean'
    && Array.isArray(data.apps) && data.apps.length <= MAX_APPS_PER_NODE && data.apps.every(isAppRunningEntry);
}

// An app message carries a signed specification and no time of its own, so its
// shape is the fields the temporary store takes it by (messageStore).
const APP_MESSAGE_TYPES = new Set(['zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate']);

function appMessageShape(data) {
  return typeof data.hash === 'string' && typeof data.signature === 'string'
    && typeof data.version === 'number' && typeof data.timestamp === 'number'
    && data.appSpecifications !== null && typeof data.appSpecifications === 'object';
}

function fixedSize(check) {
  return (data) => check(data) && JSON.stringify(data).length <= FIXED_SIZE_MAX_BYTES;
}

const APP_REMOVED_FIELDS = {
  1: ['type', 'version', 'appName', 'ip', 'broadcastedAt'],
  2: ['type', 'version', 'apps', 'ip', 'broadcastedAt'],
};

// Version 1 names one app; version 2 names every app a node removed together, at
// most as many as a node may hold.
function appRemovedShape(data) {
  const fields = Object.hasOwn(APP_REMOVED_FIELDS, data.version) ? APP_REMOVED_FIELDS[data.version] : null;
  if (!fields || !hasExactly(data, fields) || !isNodeAddress(data.ip)) return false;
  if (data.version === 2) {
    return Array.isArray(data.apps) && data.apps.length > 0 && data.apps.length <= MAX_APPS_PER_NODE
      && data.apps.every(isAppName);
  }
  return isAppName(data.appName);
}

const SHAPES = Object.freeze({
  fluxapprunning: appRunningShape,
  fluxappinstalling: (data) => isText(data.ip) && isText(data.name),
  fluxappinstallingerror: (data) => isText(data.ip) && isText(data.name)
    && typeof data.hash === 'string' && typeof data.error === 'string',
  fluxappremoved: appRemovedShape,
  fluxnodesigterm: fixedSize((data) => isText(data.ip)),
  fluxipchanged: fixedSize((data) => isText(data.oldIP) && isText(data.newIP)),
});

/**
 * Whether a broadcast carries what its type says it carries. A type with no shape
 * here passes: this reads state broadcasts and app messages only.
 * @param {object} data A verified broadcast's data.
 * @returns {boolean}
 */
function wellFormed(data) {
  if (APP_MESSAGE_TYPES.has(data?.type)) return appMessageShape(data);
  const shape = Object.hasOwn(SHAPES, data?.type) ? SHAPES[data.type] : null;
  if (!shape) return true;
  return Number.isFinite(data.broadcastedAt) && shape(data);
}

module.exports = { wellFormed, isAppRunningEntry, FIXED_SIZE_MAX_BYTES };
