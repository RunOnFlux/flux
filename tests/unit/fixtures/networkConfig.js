'use strict';

const config = require('config');
const networks = require('../../../ZelBack/config/networks');

/**
 * The running config with some of its sections' keys replaced, as a plain
 * object to hand to proxyquire as `config`. The running config is immutable,
 * so a module is loaded against this instead of the values being stubbed.
 * @param {Object<string, object>} sections section name -> keys to replace in it
 * @returns {object}
 */
function configWith(sections) {
  const out = { ...config };
  Object.entries(sections).forEach(([section, values]) => {
    out[section] = { ...config[section], ...values };
  });
  return out;
}

module.exports = { networks, configWith };
