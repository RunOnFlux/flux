'use strict';

// The networks FluxOS runs on, by the name userconfig.initial.network gives.
// Mainnet is built in. Any other network's profile is a <name>.json here, which
// no release carries: it sits under ZelBack, so fluxbench's code hash covers it
// and a tree holding one is not a listed tree. That is what keeps it off mainnet;
// a lab's fluxbench alone may skip that hash.

const fs = require('node:fs');
const path = require('node:path');

const NETWORK_NAME = /^[a-z][a-z0-9]*$/;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Every key path of a value, recursing into plain objects only: an array is a
 * value, and its length and entries are each network's own.
 * @param {*} value
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keyPaths(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.keys(value).sort().flatMap((key) => keyPaths(value[key], prefix ? `${prefix}.${key}` : key));
}

const mainnet = deepFreeze(require('./mainnet'));

/**
 * The profile of a network.
 * @param {string} name userconfig.initial.network
 * @param {object} [options]
 * @param {string} [options.dir] where a profile file is read from
 * @returns {object} the profile, frozen
 * @throws {Error} when `name` is not mainnet and has no profile file carrying
 *   exactly mainnet's keys
 */
function profileFor(name, { dir = __dirname } = {}) {
  if (name === 'mainnet') return mainnet;
  if (typeof name !== 'string' || !NETWORK_NAME.test(name)) {
    throw new Error(`config/userconfig.js initial.network '${name}' is not a network name`);
  }
  const file = path.join(dir, `${name}.json`);
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`network '${name}' has no profile: ${error.message}`);
  }
  if (keyPaths(profile).join() !== keyPaths(mainnet).join()) {
    throw new Error(`${file} does not carry the keys of a network profile`);
  }
  return deepFreeze(profile);
}

module.exports = Object.freeze({ mainnet, profileFor, keyPaths });
