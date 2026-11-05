'use strict';

// The networks FluxOS runs on, by the name userconfig.initial.network gives.
// Mainnet is built in. Any other network's profile is a signed document in
// config/networks/<name>.json, outside ZelBack and so outside the code hash
// fluxbench checks: the signature is what stands in for that hash, so a profile
// that does not verify stops FluxOS at load.

const fs = require('node:fs');
const path = require('node:path');

const { verifyBundle } = require('../../src/services/utils/policySignature');

// Raw ed25519 public keys, hex, a network profile may be signed by.
const PROFILE_KEYS = ['0b3861945a7b1a4e35981fb11aef8be8bf219543a689dd4610c0db2b7b8d63d9'];
const PROFILE_DIR = path.join(__dirname, '../../../config/networks');
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
 * @param {string} [options.dir] where a signed profile is read from
 * @param {string[]} [options.publicKeys] the keys a signed profile may be signed by
 * @returns {object} the profile, frozen
 * @throws {Error} when `name` is not mainnet and has no signed profile carrying
 *   exactly mainnet's keys
 */
function profileFor(name, { dir = PROFILE_DIR, publicKeys = PROFILE_KEYS } = {}) {
  if (name === 'mainnet') return mainnet;
  if (typeof name !== 'string' || !NETWORK_NAME.test(name)) {
    throw new Error(`config/userconfig.js initial.network '${name}' is not a network name`);
  }
  const file = path.join(dir, `${name}.json`);
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (error) {
    throw new Error(`network '${name}' has no profile: ${error.message}`);
  }
  let why = 'no reason given';
  const bundle = verifyBundle(raw, { publicKeys, onReject: (reason) => { why = reason; } });
  if (!bundle) throw new Error(`${file} is refused: ${why}`);
  if (!Object.hasOwn(bundle.documents, name)) throw new Error(`${file} holds no profile of '${name}'`);
  const profile = bundle.documents[name];
  if (keyPaths(profile).join() !== keyPaths(mainnet).join()) {
    throw new Error(`${file} does not carry the keys of a network profile`);
  }
  return deepFreeze(profile);
}

module.exports = Object.freeze({ mainnet, profileFor, PROFILE_KEYS, keyPaths });
