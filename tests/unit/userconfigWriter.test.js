const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('node:fs');
const configManager = require('../../ZelBack/src/services/utils/configManager');

const { renderUserConfig, upnpFromNetworkSettings } = configManager;

// userconfig.js is loaded with require, so a rendering is read back the same way
const readBack = (source) => {
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', source)(module);
  return module.exports;
};

describe('userconfig writer tests', () => {
  describe('renderUserConfig', () => {
    it('renders every key, each read back as it was written', () => {
      const initial = {
        ipaddress: '1.2.3.4',
        zelid: '1K6nyw2VjV6jEN1f1CkbKn9htWnYkQabbR',
        kadena: 'kadena:k:abc?chainid=0',
        development: false,
        apiport: 16137,
        routerIP: '192.168.1.1',
        upnp: true,
        network: 'mainnet',
        pgpPrivateKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nline with ` and ${x} and \\\n-----END PGP PRIVATE KEY BLOCK-----\n',
        pgpPublicKey: '',
        note: "an operator's ' and \\ in one",
      };

      expect(readBack(renderUserConfig(initial))).to.deep.equal({ initial });
    });

    it('keeps one key to a line, in the form line-based tools read and edit', () => {
      const rendered = renderUserConfig({ ipaddress: '1.2.3.4', apiport: 16137, routerIP: '', upnp: false });

      expect(rendered.split('\n')).to.include.members([
        "    ipaddress: '1.2.3.4',",
        '    apiport: 16137,',
        "    routerIP: '',",
        '    upnp: false,',
      ]);
    });

    it('leaves out a key with no value', () => {
      expect(readBack(renderUserConfig({ apiport: 16127, routerIP: undefined }))).to.deep.equal({ initial: { apiport: 16127 } });
    });
  });

  describe('writeInitial', () => {
    let before;

    beforeEach(() => {
      before = globalThis.userconfig;
      sinon.stub(fs.promises, 'writeFile').resolves();
      sinon.stub(configManager, 'reloadConfig');
    });

    afterEach(() => {
      globalThis.userconfig = before;
      sinon.restore();
    });

    it('writes its changes over the current settings, keeping every other key, and reloads', async () => {
      globalThis.userconfig = { initial: { ipaddress: '1.2.3.4', apiport: '', upnp: false, network: 'labnet' } };

      await configManager.writeInitial({ ipaddress: '5.6.7.8' });

      sinon.assert.calledOnce(fs.promises.writeFile);
      const [file, source] = fs.promises.writeFile.firstCall.args;
      expect(file).to.equal(configManager.configPath);
      expect(readBack(source)).to.deep.equal({ initial: { ipaddress: '5.6.7.8', apiport: '', upnp: false, network: 'labnet' } });
      sinon.assert.callOrder(fs.promises.writeFile, configManager.reloadConfig);
    });
  });

  describe('upnpFromNetworkSettings', () => {
    [
      [{ apiport: 16137, routerIP: '' }, true, 'an api port other than the default'],
      [{ apiport: '16147' }, true, 'an api port other than the default, as a string'],
      [{ apiport: 16127, routerIP: '192.168.1.1' }, true, 'a router address'],
      [{ apiport: 16127, routerIP: '' }, false, 'the default api port and no router address'],
      [{ apiport: '', routerIP: '' }, false, 'no api port and no router address'],
      [{}, false, 'neither set'],
    ].forEach(([settings, upnp, what]) => {
      it(`answers ${upnp} for ${what}`, () => {
        expect(upnpFromNetworkSettings(settings)).to.equal(upnp);
      });
    });
  });
});
