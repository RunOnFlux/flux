'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expect } = require('chai');
const { resolveDefaultConfig } = require('./fixtures/resolvedConfig');

const NETWORKS_INDEX = require.resolve('../../ZelBack/config/networks');
const networks = require('../../ZelBack/config/networks');
const mainnet = require('../../ZelBack/config/networks/mainnet');
const labnet = require('./fixtures/otherNetwork');

const { keyPaths } = networks;

const SRC_DIR = path.join(__dirname, '../../ZelBack/src');

function resolveFor(initial) {
  const userconfig = {
    initial: {
      ipaddress: '127.0.0.1',
      zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      kadena: '',
      apiport: 16127,
      routerIP: '',
      pgpPrivateKey: '',
      pgpPublicKey: '',
      ...initial,
    },
  };
  const cached = require.cache[NETWORKS_INDEX];
  const saved = cached.exports;
  const known = { labnet };
  cached.exports = {
    ...saved,
    profileFor: (name) => (Object.hasOwn(known, name) ? known[name] : saved.profileFor(name)),
  };
  try {
    return resolveDefaultConfig(userconfig);
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
    it('builds in mainnet', () => {
      expect(networks.mainnet).to.equal(mainnet);
      expect(networks.profileFor('mainnet')).to.equal(mainnet);
    });

    it('every profile carries the same key paths', () => {
      expect(keyPaths(labnet)).to.eql(keyPaths(mainnet));
    });

    it('is frozen all the way down', () => {
      expect(Object.isFrozen(networks)).to.equal(true);
      expect(Object.isFrozen(mainnet.fluxapps.price[0])).to.equal(true);
      expect(Object.isFrozen(mainnet.fluxapps.appSpecsEnforcementHeights)).to.equal(true);
    });
  });

  describe('a profile file', () => {
    const NAME = 'labnet';
    let dir;

    const write = (profile) => fs.writeFileSync(path.join(dir, `${NAME}.json`), JSON.stringify(profile));
    const profile = () => networks.profileFor(NAME, { dir });

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'networks-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('loads frozen', () => {
      write(labnet);
      const loaded = profile();
      expect(loaded.daemon.port).to.equal(labnet.daemon.port);
      expect(Object.isFrozen(loaded.daemon)).to.equal(true);
    });

    it('sits under ZelBack, where the code hash covers it', () => {
      const dirOfProfiles = path.dirname(require.resolve('../../ZelBack/config/networks'));
      expect(path.relative(path.join(__dirname, '../..'), dirOfProfiles).split(path.sep)[0]).to.equal('ZelBack');
      const index = fs.readFileSync(require.resolve('../../ZelBack/config/networks'), 'utf8');
      expect(index).to.include('dir = __dirname');
    });

    it('stops at no file', () => {
      expect(profile).to.throw(/has no profile/);
    });

    it('stops at a file that is not JSON', () => {
      fs.writeFileSync(path.join(dir, `${NAME}.json`), 'module.exports = {}');
      expect(profile).to.throw(/has no profile/);
    });

    it('stops at a profile missing one of mainnet\'s keys', () => {
      const { fluxTeamFluxID, ...short } = labnet;
      expect(fluxTeamFluxID).to.be.a('string');
      write(short);
      expect(profile).to.throw(/does not carry the keys/);
    });

    it('never reads a path from the name', () => {
      expect(() => networks.profileFor('../labnet', { dir })).to.throw(/not a network name/);
      expect(() => networks.profileFor('Object', { dir })).to.throw(/not a network name/);
      expect(() => networks.profileFor(1, { dir })).to.throw(/not a network name/);
    });

    it('never replaces mainnet from a file', () => {
      fs.writeFileSync(path.join(dir, 'mainnet.json'), 'not read');
      expect(networks.profileFor('mainnet', { dir })).to.equal(mainnet);
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

    it('holds the inbound limit at a network\'s floor, and leaves mainnet\'s calculation alone', () => {
      expect(resolveFor({}).fluxapps.incomingCapFloor).to.equal(0);
      expect(resolveFor({ network: 'labnet' }).fluxapps.incomingCapFloor).to.equal(32);
    });

    it('applies every app rule from labnet\'s first block, at mainnet\'s heights on mainnet', () => {
      const ruleHeights = {
        minimumInstancesV8Block: 2176519,
        newMinBlocksAllowanceBlock: 1630040,
        cancel1BlockMinBlocksAllowanceBlock: 1964447,
        removeBlocksAllowanceIntervalBlock: 1625000,
        applyMinimumPriceOn3Instances: 1691000,
        applyMinimumForExtraInstances: 1890000,
      };
      const main = resolveFor({ network: 'mainnet' });
      const lab = resolveFor({ network: 'labnet' });
      Object.entries(ruleHeights).forEach(([key, height]) => {
        expect(main.fluxapps[key], key).to.equal(height);
        expect(lab.fluxapps[key], key).to.equal(0);
      });
    });

    it('refuses to load for a network it does not know', () => {
      expect(() => resolveFor({ network: 'testnet' })).to.throw(/network 'testnet' has no profile/);
      expect(() => resolveFor({ network: 'constructor' })).to.throw(/network 'constructor' has no profile/);
    });

    it('scans from a height the explorer cursor can hold on every network', () => {
      // The bootstrap fallback sets the cursor to epochstart - 1, and the cursor
      // is read back only from heights of 0 and above.
      [mainnet, labnet].forEach((profile) => {
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
