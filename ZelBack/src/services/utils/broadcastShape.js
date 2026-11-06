// What each kind of signed state broadcast carries. A signature says who sent a
// broadcast, not that it is well formed, so a node checks this before it acts on
// one, whether it arrived alone or in a sync answer.

const { appRunningEntries } = require('./appRunningEntries');

// The fields of the fixed-size broadcasts, an address, an app name and a time, come
// to under 200 bytes.
const FIXED_SIZE_MAX_BYTES = 1024;

const isText = (value) => typeof value === 'string' && value.length > 0;
const isAbsentOr = (value, type) => value === undefined || value === null || typeof value === type;
const isDate = (value) => isAbsentOr(value, 'number') || typeof value === 'string';

function appRunningShape(data) {
  if (!isText(data.ip) || !isAbsentOr(data.osUptime, 'number') || !isAbsentOr(data.staticIp, 'boolean')) return false;
  if (!isDate(data.runningSince)) return false;
  if (data.version === 2) {
    return Array.isArray(data.apps) && appRunningEntries(data.apps).stored.every((app) => isDate(app.runningSince));
  }
  return data.version === 1 && isText(data.name) && typeof data.hash === 'string';
}

function fixedSize(check) {
  return (data) => check(data) && JSON.stringify(data).length <= FIXED_SIZE_MAX_BYTES;
}

const SHAPES = Object.freeze({
  fluxapprunning: appRunningShape,
  fluxappinstalling: (data) => isText(data.ip) && isText(data.name),
  fluxappinstallingerror: (data) => isText(data.ip) && isText(data.name)
    && typeof data.hash === 'string' && typeof data.error === 'string',
  fluxappremoved: fixedSize((data) => isText(data.ip) && isText(data.appName)),
  fluxnodesigterm: fixedSize((data) => isText(data.ip)),
  fluxipchanged: fixedSize((data) => isText(data.oldIP) && isText(data.newIP)),
});

/**
 * Whether a broadcast carries what its type says it carries. A type with no shape
 * here passes: this reads state broadcasts only.
 * @param {object} data A verified broadcast's data.
 * @returns {boolean}
 */
function wellFormed(data) {
  const shape = Object.hasOwn(SHAPES, data?.type) ? SHAPES[data.type] : null;
  if (!shape) return true;
  return Number.isFinite(data.broadcastedAt) && shape(data);
}

module.exports = { wellFormed, FIXED_SIZE_MAX_BYTES };
