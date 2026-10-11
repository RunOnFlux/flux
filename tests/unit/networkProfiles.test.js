'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const { resolveDefaultConfig } = require('./fixtures/resolvedConfig');

const NETWORKS_INDEX = require.resolve('../../ZelBack/config/networks');
const networks = require('../../ZelBack/config/networks');
const mainnet = require('../../ZelBack/config/networks/mainnet');
const labnet = require('../../ZelBack/config/networks/labnet');

const SRC_DIR = path.join(__dirname, '../../ZelBack/src');

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

function resolveFor(initial) {
  const userconfig = {
    initial: {
      ipaddress: '127.0.0.1',
      zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      kadena: '',
      development: false,
      apiport: 16127,
      routerIP: '',
      pgpPrivateKey: '',
      pgpPublicKey: '',
      ...initial,
    },
  };
  return resolveDefaultConfig(userconfig);
}

/**
 * Resolve default.js with a stand-in for one network's profile.
 * @param {string} name
 * @param {object} profile
 * @param {object} initial userconfig.initial overrides
 * @returns {object}
 */
function resolveWithProfile(name, profile, initial) {
  const cached = require.cache[NETWORKS_INDEX];
  const saved = cached.exports;
  cached.exports = { ...saved, [name]: profile };
  try {
    return resolveFor(initial);
  } finally {
    cached.exports = saved;
  }
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(c|m)?js$/.test(entry.name) ? [full] : [];
  });
}

describe('network profiles', () => {
  describe('the profiles', () => {
    it('lists exactly mainnet and labnet', () => {
      expect(Object.keys(networks)).to.have.members(['mainnet', 'labnet']);
      expect(networks.mainnet).to.equal(mainnet);
      expect(networks.labnet).to.equal(labnet);
    });

    it('every profile carries the same key paths', () => {
      expect(keyPaths(labnet)).to.eql(keyPaths(mainnet));
    });

    it('a development block carries the same key paths as the values it stands in for', () => {
      Object.values(networks).forEach((profile) => {
        const standIns = keyPaths(profile.development);
        standIns.forEach((key) => expect(key.split('.').reduce((acc, part) => acc[part], profile), key).to.not.equal(undefined));
      });
    });

    it('is frozen all the way down', () => {
      expect(Object.isFrozen(networks)).to.equal(true);
      expect(Object.isFrozen(labnet.fluxapps.price[0])).to.equal(true);
      expect(Object.isFrozen(mainnet.development.fluxapps.appSpecsEnforcementHeights)).to.equal(true);
    });
  });

  describe('default.js', () => {
    it('resolves mainnet when userconfig names no network', () => {
      const resolved = resolveFor({});
      expect(resolved.network).to.equal('mainnet');
      expect(resolved.daemon.port).to.equal(16125);
      expect(resolved.fluxapps.epochstart).to.equal(694000);
    });

    it('resolves each named network from its profile', () => {
      const main = resolveFor({ network: 'mainnet' });
      expect(main.network).to.equal('mainnet');
      expect(main.daemon.rpcport).to.equal(mainnet.daemon.rpcport);

      const lab = resolveFor({ network: 'labnet' });
      expect(lab.network).to.equal('labnet');
      expect(lab.daemon).to.include({
        port: 36125, rpcport: 36124, chainValidHeight: 0, initialHeaderFloor: 0, chainSubdir: 'labnet',
      });
      expect(lab.benchmark).to.include({ port: 36225, rpcport: 36224 });
      expect(lab.fluxTeamFluxID).to.equal(labnet.fluxTeamFluxID);
      expect(lab.fluxapps.daemonPONFork).to.equal(2);
      expect(lab.fluxapps).to.include({
        address: 'tmRj9rspfGbyuhVZvupXNttvP4j9YmzWbkv',
        addressMultisig: 'tmRj9rspfGbyuhVZvupXNttvP4j9YmzWbkv',
        addressMultisigB: 'tmRj9rspfGbyuhVZvupXNttvP4j9YmzWbkv',
        multisigAddressChange: 0,
      });
      expect(lab.policy.publicKeys).to.eql(labnet.policy.publicKeys);
      expect(lab.policy.minConfirmingPeers).to.equal(1);
      expect(lab.analytics.url).to.equal('');
    });

    it('refuses to load for a network it does not know', () => {
      expect(() => resolveFor({ network: 'testnet' })).to.throw(/initial\.network 'testnet' is not a known network/);
      expect(() => resolveFor({ network: 'constructor' })).to.throw(/is not a known network/);
    });

    it('applies development on mainnet', () => {
      const resolved = resolveFor({ network: 'mainnet', development: true });
      expect(resolved.fluxapps.appSpecsEnforcementHeights).to.eql(mainnet.development.fluxapps.appSpecsEnforcementHeights);
      expect(resolved.fluxapps.portBlockheightChange).to.equal(1390000);
    });

    it('ignores development on labnet', () => {
      const resolved = resolveFor({ network: 'labnet', development: true });
      expect(Object.values(resolved.fluxapps.appSpecsEnforcementHeights)).to.eql([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(resolved.fluxapps.portBlockheightChange).to.equal(0);
      // The development receiver is the lab's one receiver, so development adds none.
      expect(resolved.fluxapps.addressDevelopment).to.equal(resolved.fluxapps.address);
    });

    it('reads a profile\'s development block only where the profile says development applies', () => {
      const devBlock = {
        fluxapps: {
          appSpecsEnforcementHeights: {
            1: 7, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 7, 8: 7,
          },
          portBlockheightChange: 7,
        },
      };
      const ignored = resolveWithProfile('labnet', { ...labnet, development: devBlock }, { network: 'labnet', development: true });
      expect(ignored.fluxapps.appSpecsEnforcementHeights).to.eql(labnet.fluxapps.appSpecsEnforcementHeights);
      expect(ignored.fluxapps.portBlockheightChange).to.equal(labnet.fluxapps.portBlockheightChange);

      const honoured = resolveWithProfile('labnet', { ...labnet, developmentApplies: true, development: devBlock }, { network: 'labnet', development: true });
      expect(honoured.fluxapps.appSpecsEnforcementHeights).to.eql(devBlock.fluxapps.appSpecsEnforcementHeights);
      expect(honoured.fluxapps.portBlockheightChange).to.equal(7);
    });

    it('scans from a height the explorer cursor can hold on every network', () => {
      // The bootstrap fallback sets the cursor to epochstart - 1, and the cursor
      // is read back only from heights of 0 and above.
      Object.values(networks).forEach((profile) => {
        expect(profile.fluxapps.epochstart - 1).to.be.at.least(0);
      });
    });
  });

  describe('ZelBack/src', () => {
    it('never names a network: code reads profile values, not the name', () => {
      const offenders = sourceFiles(SRC_DIR).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
        .map((line, index) => ({ line, at: `${path.relative(SRC_DIR, file)}:${index + 1}` }))
        .filter(({ line }) => /mainnet|labnet/i.test(line))
        .map(({ at }) => at));
      expect(offenders).to.eql([]);
    });
  });
});
