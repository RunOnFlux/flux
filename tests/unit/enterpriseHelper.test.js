const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseHelper';

// isArcane is read when the module loads, so FLUXOS_PATH is set around the load. Reaching the
// database is the first step of a decrypt; the stub throws so a test sees whether it was reached.
function load() {
  const previous = process.env.FLUXOS_PATH;
  process.env.FLUXOS_PATH = '/tmp/fluxos';
  const dbHelper = { databaseConnection: sinon.stub().throws(new Error('decrypt reached')) };
  try {
    const m = proxyquire(MODULE_PATH, {
      '../dbHelper': dbHelper,
      '../benchmarkService': {},
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    });
    return { module: m, dbHelper };
  } finally {
    if (previous === undefined) delete process.env.FLUXOS_PATH;
    else process.env.FLUXOS_PATH = previous;
  }
}

describe('enterpriseHelper', () => {
  afterEach(() => sinon.restore());

  describe('checkAndDecryptAppSpecs', () => {
    // A spec is enterprise exactly when version >= 8 and it carries an enterprise blob; the
    // route checks use the same rule, so every spec that reaches a decrypt has passed them.
    it('decrypts a version 8 spec with an enterprise blob', async () => {
      const { module: m, dbHelper } = load();
      await m.checkAndDecryptAppSpecs({ version: 8, name: 'app', enterprise: 'blob' })
        .then(() => expect.fail('resolved without a decrypt'), (error) => expect(error.message).to.equal('decrypt reached'));
      sinon.assert.calledOnce(dbHelper.databaseConnection);
    });

    [
      ['no version', { name: 'app', enterprise: 'blob' }],
      ['a non-numeric version', { version: 'eight', name: 'app', enterprise: 'blob' }],
      ['version 7', { version: 7, name: 'app', enterprise: 'blob' }],
      ['an empty enterprise', { version: 8, name: 'app', enterprise: '' }],
    ].forEach(([label, spec]) => {
      it(`returns a spec with ${label} unchanged, without a decrypt`, async () => {
        const { module: m, dbHelper } = load();
        expect(await m.checkAndDecryptAppSpecs(spec)).to.equal(spec);
        sinon.assert.notCalled(dbHelper.databaseConnection);
      });
    });
  });

  describe('decryptAesKeyWithRsaKey, while fluxbench is busy', () => {
    const busy = { status: 'error', data: { code: 500, name: 'Error', message: 'Work queue depth exceeded' } };
    const unwrapped = { status: 'success', data: JSON.stringify({ status: 'ok', message: 'AESKEY' }) };
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    function loadWith(decryptRSAMessage) {
      const previous = process.env.FLUXOS_PATH;
      process.env.FLUXOS_PATH = '/tmp/fluxos';
      try {
        return proxyquire(MODULE_PATH, {
          '../dbHelper': { databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }) },
          '../benchmarkService': { decryptRSAMessage },
          '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        });
      } finally {
        if (previous === undefined) delete process.env.FLUXOS_PATH;
        else process.env.FLUXOS_PATH = previous;
      }
    }

    it('asks again a second after each busy refusal, and returns the key fluxbench then unwraps', async () => {
      const decryptRSAMessage = sinon.stub();
      decryptRSAMessage.onCall(0).resolves(busy);
      decryptRSAMessage.onCall(1).resolves(busy);
      decryptRSAMessage.onCall(2).resolves(unwrapped);
      const m = loadWith(decryptRSAMessage);

      const key = m.decryptAesKeyWithRsaKey('app', 100, 'wrapped', 'owner');
      await clock.tickAsync(999);
      sinon.assert.calledOnce(decryptRSAMessage);
      await clock.tickAsync(1);
      sinon.assert.calledTwice(decryptRSAMessage);
      await clock.tickAsync(1000);

      expect(await key).to.equal('AESKEY');
      sinon.assert.calledThrice(decryptRSAMessage);
    });

    it('gives up after three more refusals, naming the refusal', async () => {
      const decryptRSAMessage = sinon.stub().resolves(busy);
      const m = loadWith(decryptRSAMessage);

      const key = m.decryptAesKeyWithRsaKey('app', 100, 'wrapped', 'owner').catch((error) => error);
      await clock.tickAsync(10000);

      expect((await key).message).to.equal('fluxbench refused unwrapping the key of app as busy 4 times');
      expect(decryptRSAMessage.callCount).to.equal(4);
    });

    it('does not ask again after any other failure', async () => {
      const decryptRSAMessage = sinon.stub().resolves({ status: 'error', data: { message: 'System not Secure' } });
      const m = loadWith(decryptRSAMessage);

      const key = m.decryptAesKeyWithRsaKey('app', 100, 'wrapped', 'owner').catch((error) => error);
      await clock.tickAsync(10000);

      expect((await key).message).to.equal('Error getting decrypted AES key.');
      sinon.assert.calledOnce(decryptRSAMessage);
    });
  });
});
