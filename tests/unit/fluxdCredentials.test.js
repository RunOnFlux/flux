const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

const fluxdCredentials = require('../../ZelBack/src/services/daemonService/fluxdCredentials');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('fluxdCredentials tests', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxd-credentials-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('readNodeKeyCredential', () => {
    it('reads the node-key credential, trimmed', async () => {
      await fs.writeFile(path.join(dir, 'node-key'), 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ\n');
      const key = await fluxdCredentials.readNodeKeyCredential({ CREDENTIALS_DIRECTORY: dir });
      expect(key).to.equal('L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ');
    });

    it('is null when the unit passes no credentials', async () => {
      expect(await fluxdCredentials.readNodeKeyCredential({})).to.equal(null);
    });

    it('is null when the credentials passed do not include the node key', async () => {
      await fs.writeFile(path.join(dir, 'other'), 'x');
      expect(await fluxdCredentials.readNodeKeyCredential({ CREDENTIALS_DIRECTORY: dir })).to.equal(null);
    });

    it('refuses an empty node key, naming the file', async () => {
      await fs.writeFile(path.join(dir, 'node-key'), '\n');
      await expect(fluxdCredentials.readNodeKeyCredential({ CREDENTIALS_DIRECTORY: dir }))
        .to.be.rejectedWith(`the node-key credential ${path.join(dir, 'node-key')} is empty`);
    });

    it('refuses a node key it cannot read, naming the file', async function unreadable() {
      if (process.getuid && process.getuid() === 0) this.skip(); // root reads a mode-000 file
      const file = path.join(dir, 'node-key');
      await fs.writeFile(file, 'akey');
      await fs.chmod(file, 0o000);
      await expect(fluxdCredentials.readNodeKeyCredential({ CREDENTIALS_DIRECTORY: dir }))
        .to.be.rejectedWith(`the node-key credential ${file} cannot be read`);
    });
  });

  describe('loadNodeKey', () => {
    // A copy of the module of its own: the loaded key is the process's, and every
    // other suite runs with none.
    const modulePath = require.resolve('../../ZelBack/src/services/daemonService/fluxdCredentials');
    let shared;
    let isolated;
    beforeEach(() => {
      shared = require.cache[modulePath];
      delete require.cache[modulePath];
      // eslint-disable-next-line global-require
      isolated = require('../../ZelBack/src/services/daemonService/fluxdCredentials');
    });
    afterEach(() => {
      require.cache[modulePath] = shared;
    });

    it('reads the credential once per process', async () => {
      await fs.writeFile(path.join(dir, 'node-key'), 'firstkey');
      const loaded = await isolated.loadNodeKey({ CREDENTIALS_DIRECTORY: dir });
      await fs.writeFile(path.join(dir, 'node-key'), 'secondkey');
      expect(loaded).to.equal('firstkey');
      expect(await isolated.loadNodeKey({})).to.equal('firstkey');
    });
  });

  describe('parseCookie', () => {
    it('splits at the first colon', () => {
      expect(fluxdCredentials.parseCookie('__cookie__:ab:c/d+=\n'))
        .to.eql({ username: '__cookie__', password: 'ab:c/d+=' });
    });

    ['', 'nocolon', ':password', 'user:'].forEach((text) => {
      it(`refuses ${JSON.stringify(text)}`, () => {
        expect(fluxdCredentials.parseCookie(text)).to.equal(null);
      });
    });
  });

  describe('readRpcCookie', () => {
    it('reads the cookie fluxd wrote', async () => {
      const file = path.join(dir, 'rpc.cookie');
      await fs.writeFile(file, '__cookie__:c2VjcmV0');
      expect(await fluxdCredentials.readRpcCookie(file))
        .to.eql({ username: '__cookie__', password: 'c2VjcmV0' });
    });

    it('is null while fluxd has written none', async () => {
      expect(await fluxdCredentials.readRpcCookie(path.join(dir, 'rpc.cookie'))).to.equal(null);
    });
  });
});
