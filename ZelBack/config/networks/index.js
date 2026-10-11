'use strict';

// The networks FluxOS runs on, by the name userconfig.initial.network gives.
// Closed: a name not listed here is not a network, and nothing builds a path
// from the name.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

module.exports = Object.freeze({
  mainnet: deepFreeze(require('./mainnet')),
  labnet: deepFreeze(require('./labnet')),
});
