'use strict';

const crypto = require('node:crypto');
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

let standIns = {};

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
  const cached = require.cache[NETWORKS_INDEX];
  const saved = cached.exports;
  const known = { labnet, ...standIns };
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

/**
 * Resolve default.js with a stand-in for one network's profile.
 * @param {string} name
 * @param {object} profile
 * @param {object} initial userconfig.initial overrides
 * @returns {object}
 */
function resolveWithProfile(name, profile, initial) {
  standIns = { [name]: profile };
  try {
    return resolveFor(initial);
  } finally {
    standIns = {};
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
    it('builds in mainnet and pins one signing key', () => {
      expect(networks.mainnet).to.equal(mainnet);
      expect(networks.profileFor('mainnet')).to.equal(mainnet);
      expect(networks.PROFILE_KEYS).to.have.lengthOf(1);
      expect(networks.PROFILE_KEYS[0]).to.match(/^[0-9a-f]{64}$/);
    });

    it('every profile carries the same key paths', () => {
      expect(keyPaths(labnet)).to.eql(keyPaths(mainnet));
    });

    it('a development block carries the same key paths as the values it stands in for', () => {
      [mainnet, labnet].forEach((profile) => {
        const standIns = keyPaths(profile.development);
        standIns.forEach((key) => expect(key.split('.').reduce((acc, part) => acc[part], profile), key).to.not.equal(undefined));
      });
    });

    it('is frozen all the way down', () => {
      expect(Object.isFrozen(networks)).to.equal(true);
      expect(Object.isFrozen(mainnet.fluxapps.price[0])).to.equal(true);
      expect(Object.isFrozen(mainnet.development.fluxapps.appSpecsEnforcementHeights)).to.equal(true);
    });
  });

  describe('a signed profile', () => {
    const NAME = 'labnet';
    let dir;
    let publicKeys;
    let sign;

    function write(document, signer = sign) {
      const payload = Buffer.from(JSON.stringify(document));
      const body = { payload_b64: payload.toString('base64'), sig_b64: signer(payload).toString('base64') };
      fs.writeFileSync(path.join(dir, `${NAME}.json`), JSON.stringify(body));
    }

    function signerOf() {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      return {
        hex: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex'),
        sign: (payload) => crypto.sign(null, payload, privateKey),
      };
    }

    const profile = () => networks.profileFor(NAME, { dir, publicKeys });

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'networks-'));
      const signer = signerOf();
      publicKeys = [signer.hex];
      sign = signer.sign;
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('loads frozen, signed by a pinned key', () => {
      write({ seq: 1, documents: { [NAME]: labnet } });
      const loaded = profile();
      expect(loaded.daemon.port).to.equal(labnet.daemon.port);
      expect(Object.isFrozen(loaded.daemon)).to.equal(true);
    });

    it('stops at a profile signed by another key: an operator cannot write their own', () => {
      write({ seq: 1, documents: { [NAME]: labnet } }, signerOf().sign);
      expect(profile).to.throw(/refused: no pinned key verifies/);
    });

    it('stops at a changed profile', () => {
      write({ seq: 1, documents: { [NAME]: labnet } });
      const file = path.join(dir, `${NAME}.json`);
      const body = JSON.parse(fs.readFileSync(file));
      const payload = JSON.parse(Buffer.from(body.payload_b64, 'base64'));
      payload.documents[NAME] = { ...payload.documents[NAME], fluxTeamFluxID: 'attacker' };
      body.payload_b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      fs.writeFileSync(file, JSON.stringify(body));
      expect(profile).to.throw(/refused: no pinned key verifies/);
    });

    it('stops at an unsigned profile', () => {
      fs.writeFileSync(path.join(dir, `${NAME}.json`), JSON.stringify(labnet));
      expect(profile).to.throw(/refused: bundle is not/);
    });

    it('stops at no file', () => {
      expect(profile).to.throw(/has no profile/);
    });

    it('stops at a document signed for another network', () => {
      write({ seq: 1, documents: { other: labnet } });
      expect(profile).to.throw(/holds no profile of 'labnet'/);
    });

    it('stops at a profile missing one of mainnet\'s keys', () => {
      const { fluxTeamFluxID, ...short } = labnet;
      expect(fluxTeamFluxID).to.be.a('string');
      write({ seq: 1, documents: { [NAME]: short } });
      expect(profile).to.throw(/does not carry the keys/);
    });

    it('never reads a path from the name', () => {
      expect(() => networks.profileFor('../labnet', { dir, publicKeys })).to.throw(/not a network name/);
      expect(() => networks.profileFor('Object', { dir, publicKeys })).to.throw(/not a network name/);
      expect(() => networks.profileFor(1, { dir, publicKeys })).to.throw(/not a network name/);
    });

    it('never replaces mainnet from a file', () => {
      fs.writeFileSync(path.join(dir, 'mainnet.json'), 'not read');
      expect(networks.profileFor('mainnet', { dir, publicKeys })).to.equal(mainnet);
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
