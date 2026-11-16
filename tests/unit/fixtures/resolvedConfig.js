'use strict';

const path = require('node:path');

const DEFAULT_JS = path.join(__dirname, '../../../ZelBack/config/default.js');
const USERCONFIG_JS = require.resolve('../../../config/userconfig');

/**
 * Production default.js, evaluated afresh against `userconfig`, without
 * node-config: what a node with that userconfig resolves its config to.
 * @param {object} userconfig
 * @returns {object}
 */
function resolveDefaultConfig(userconfig) {
  const saved = require.cache[USERCONFIG_JS];
  require.cache[USERCONFIG_JS] = { id: USERCONFIG_JS, filename: USERCONFIG_JS, loaded: true, exports: userconfig };
  delete require.cache[DEFAULT_JS];
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(DEFAULT_JS);
  } finally {
    delete require.cache[DEFAULT_JS];
    if (saved) require.cache[USERCONFIG_JS] = saved; else delete require.cache[USERCONFIG_JS];
  }
}

/**
 * A canonical, JSON-safe rendering of a config: keys sorted, and the values JSON
 * cannot hold (functions, RegExps, undefined, non-finite numbers) tagged.
 * @param {*} value
 * @returns {*}
 */
function canonical(value) {
  if (typeof value === 'function') return `[function ${value.toString()}]`;
  if (value instanceof RegExp) return `[regexp ${value.toString()}]`;
  if (value === undefined) return '[undefined]';
  if (typeof value === 'number' && !Number.isFinite(value)) return `[number ${value}]`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: canonical(value[key]) }), {});
  }
  return value;
}

module.exports = { resolveDefaultConfig, canonical };
