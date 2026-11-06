const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { MAX_ENTERPRISE_LENGTH } = require('../../ZelBack/src/services/utils/appConstants');

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

  describe('verifyEncryptedSpec', () => {
    const encrypted = (change) => ({
      version: 8, name: 'entapp', owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', compose: [], contacts: [], enterprise: 'blob', ...change,
    });

    [
      ['empty compose and contacts', {}],
      ['no compose or contacts', { compose: undefined, contacts: undefined }],
      ['an enterprise string of exactly the limit', { enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH) }],
      ['a spec that is not encrypted, with compose and contacts', { enterprise: '', compose: [{ name: 'web' }], contacts: ['a@b.c'] }],
      ['a v7 spec', { version: 7, enterprise: undefined, compose: [{ name: 'web' }] }],
    ].forEach(([description, change]) => {
      it(`takes ${description}`, () => {
        const { module: m } = load();
        expect(() => m.verifyEncryptedSpec(encrypted(change))).to.not.throw();
      });
    });

    [
      ['a plain compose', { compose: [{ name: 'web' }] }, 'only inside enterprise'],
      ['plain contacts', { contacts: ['a@b.c'] }, 'only inside enterprise'],
      ['a compose that is not a list', { compose: {} }, 'only inside enterprise'],
      ['an enterprise string one over the limit', { enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH + 1) }, 'too long'],
      ['an invalid owner', { owner: 'my-owner' }, 'Invalid app name or owner'],
      ['an invalid name', { name: 'ent_app' }, 'Invalid app name or owner'],
    ].forEach(([description, change, refusal]) => {
      it(`refuses ${description}`, () => {
        const { module: m } = load();
        expect(() => m.verifyEncryptedSpec(encrypted(change))).to.throw(refusal);
      });
    });
  });

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
});
