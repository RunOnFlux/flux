const { expect } = require('chai');
const net = require('node:net');
const crypto = require('node:crypto');
const syncthingDeviceId = require('../../ZelBack/src/services/utils/syncthingDeviceId');

// A certificate syncthing 2.1.7 generated, and the device ID it reported for it.
const SYNCTHING_CERTIFICATE = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBoDCCAVKgAwIBAgIJAM0DzfEHSVL6MAUGAytlcDBKMRIwEAYDVQQKEwlTeW5j',
  'dGhpbmcxIDAeBgNVBAsTF0F1dG9tYXRpY2FsbHkgR2VuZXJhdGVkMRIwEAYDVQQD',
  'EwlzeW5jdGhpbmcwHhcNMjYxMTExMDAwMDAwWhcNNDYxMTA2MDAwMDAwWjBKMRIw',
  'EAYDVQQKEwlTeW5jdGhpbmcxIDAeBgNVBAsTF0F1dG9tYXRpY2FsbHkgR2VuZXJh',
  'dGVkMRIwEAYDVQQDEwlzeW5jdGhpbmcwKjAFBgMrZXADIQBWBpoc/QWVSsCSDnXE',
  '1W1P66xwJTe93eLTUypkYfELXKNVMFMwDgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQW',
  'MBQGCCsGAQUFBwMBBggrBgEFBQcDAjAMBgNVHRMBAf8EAjAAMBQGA1UdEQQNMAuC',
  'CXN5bmN0aGluZzAFBgMrZXADQQAgnh5krY9DM7lxdZzTSIullTXMUHqKRUQXdkJF',
  'hND/5mzzEND+hIo0lHQVPwt5L1C3cGlQZCdkdl7PrG3mfgIB',
  '-----END CERTIFICATE-----',
].join('\n');
const SYNCTHING_DEVICE_ID = 'XKLMVJA-M56FRX2-LYRDLST-PQJVEHG-I5C7A3B-YQJPOFB-2ROTI3S-4FIH6AL';

describe('syncthingDeviceId tests', () => {
  describe('canonicalSyncthingDeviceId', () => {
    // syncthing's documentation example, and a mainnet node's
    const DOCS_EXAMPLE = 'MFZWI3D-BONSGYC-YLTMRWG-C43ENR5-QXGZDMM-FZWI3DP-BONSGYY-LTMRWAD';
    const MAINNET = 'OD2POVH-2QWEHYY-AKI6AU2-ZUEQLXY-MTGOIG7-PE57QHU-INYFY5C-QTNOPQ5';
    const withoutCheckCharacters = (id) => [...id.replace(/-/g, '')].filter((c, i) => i % 14 !== 13).join('');

    it('gives a device ID as syncthing writes one back as it is', () => {
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(DOCS_EXAMPLE)).to.equal(DOCS_EXAMPLE);
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(MAINNET)).to.equal(MAINNET);
    });

    it('gives one without dashes, in lower case, with spaces, or without its check characters as syncthing writes it', () => {
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(MAINNET.replace(/-/g, ''))).to.equal(MAINNET);
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(MAINNET.toLowerCase())).to.equal(MAINNET);
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(MAINNET.replace(/-/g, ' '))).to.equal(MAINNET);
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(withoutCheckCharacters(MAINNET))).to.equal(MAINNET);
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(withoutCheckCharacters(DOCS_EXAMPLE))).to.equal(DOCS_EXAMPLE);
    });

    it('gives one with 0, 1 and 8 typed for O, I and B as syncthing writes it', () => {
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(MAINNET.replace(/O/g, '0').replace(/I/g, '1'))).to.equal(MAINNET);
      expect(syncthingDeviceId.canonicalSyncthingDeviceId(DOCS_EXAMPLE.replace(/B/g, '8'))).to.equal(DOCS_EXAMPLE);
    });

    it('refuses one whose check character does not match its group', () => {
      [3, 10, 20, 40].forEach((at) => {
        const changed = `${MAINNET.slice(0, at)}${MAINNET[at] === 'A' ? 'B' : 'A'}${MAINNET.slice(at + 1)}`;
        expect(syncthingDeviceId.canonicalSyncthingDeviceId(changed), `changed at ${at}`).to.equal(null);
      });
    });

    it('refuses anything else', () => {
      ['PEERSTUB-DEVICE-0000001', '', MAINNET.slice(0, -1), `${MAINNET}A`, MAINNET.replace('2', '9'), null, undefined, 42, {}]
        .forEach((value) => expect(syncthingDeviceId.canonicalSyncthingDeviceId(value), JSON.stringify(value)).to.equal(null));
    });
  });

  describe('deviceIdOfCertificate', () => {
    it('gives the device ID syncthing reports for its certificate', () => {
      const der = new crypto.X509Certificate(SYNCTHING_CERTIFICATE).raw;
      expect(syncthingDeviceId.deviceIdOfCertificate(der)).to.equal(SYNCTHING_DEVICE_ID);
    });
  });

  describe('presentedDeviceId', () => {
    it('proves nothing when nothing listens', async () => {
      const server = net.createServer();
      await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      const { port } = server.address();
      await new Promise((resolve) => { server.close(resolve); });
      expect(await syncthingDeviceId.presentedDeviceId('127.0.0.1', port)).to.equal(null);
    });

    it('proves nothing when the listener never completes a handshake', async () => {
      const sockets = [];
      const server = net.createServer((socket) => { sockets.push(socket); });
      await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      try {
        expect(await syncthingDeviceId.presentedDeviceId('127.0.0.1', server.address().port, { timeoutMs: 200 })).to.equal(null);
      } finally {
        sockets.forEach((socket) => socket.destroy());
        await new Promise((resolve) => { server.close(resolve); });
      }
    });
  });
});
