const { expect } = require('chai');

const { verifyEncryptedSpec, verifyEnterpriseCarriesNoPlainSpec } = require('../../ZelBack/src/services/utils/enterpriseSpec');
const { MAX_ENTERPRISE_LENGTH } = require('../../ZelBack/src/services/utils/appConstants');

const REFUSAL = 'An enterprise app carries its compose and contacts encrypted in enterprise, and nothing in plain';

describe('enterpriseSpec', () => {
  describe('verifyEnterpriseCarriesNoPlainSpec', () => {
    const enterprise = (change) => ({
      version: 8, name: 'entapp', enterprise: 'blob', compose: [], contacts: [], ...change,
    });

    [
      ['a compose component', { compose: [{ name: 'web' }] }],
      ['a contact', { contacts: ['owner@example.com'] }],
      ['a compose that is not an array', { compose: 'web' }],
      ['contacts that are not an array', { contacts: 'owner@example.com' }],
    ].forEach(([description, change]) => {
      it(`refuses an enterprise specification carrying ${description}`, () => {
        expect(() => verifyEnterpriseCarriesNoPlainSpec(enterprise(change))).to.throw(REFUSAL);
      });
    });

    [
      ['empty compose and contacts', {}],
      ['no compose or contacts', { compose: undefined, contacts: undefined }],
      ['null compose and contacts', { compose: null, contacts: null }],
      ['an invalid owner', { owner: 'my-owner' }],
    ].forEach(([description, change]) => {
      it(`accepts an enterprise specification with ${description}`, () => {
        expect(() => verifyEnterpriseCarriesNoPlainSpec(enterprise(change))).to.not.throw();
      });
    });
  });

  describe('verifyEncryptedSpec', () => {
    const enterprise = (change) => ({
      version: 8, name: 'entapp', owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', enterprise: 'blob', compose: [], contacts: [], ...change,
    });

    [
      ['a compose component', { compose: [{ name: 'web' }] }, REFUSAL],
      ['a contact', { contacts: ['owner@example.com'] }, REFUSAL],
      ['a compose that is not an array', { compose: 'web' }, REFUSAL],
      ['a compose that is an object', { compose: {} }, REFUSAL],
      ['contacts that are not an array', { contacts: 'owner@example.com' }, REFUSAL],
      ['an enterprise string one over the limit', { enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH + 1) }, 'too long'],
      ['an enterprise that is not a string', { enterprise: ['blob'] }, 'too long'],
      ['an invalid owner', { owner: 'my-owner' }, 'Invalid app name or owner'],
      ['an invalid name', { name: 'ent_app' }, 'Invalid app name or owner'],
    ].forEach(([description, change, refusal]) => {
      it(`refuses an enterprise specification carrying ${description}`, () => {
        expect(() => verifyEncryptedSpec(enterprise(change))).to.throw(refusal);
      });
    });

    [
      ['empty compose and contacts', {}],
      ['no compose or contacts', { compose: undefined, contacts: undefined }],
      ['null compose and contacts', { compose: null, contacts: null }],
      ['an enterprise string of exactly the limit', { enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH) }],
    ].forEach(([description, change]) => {
      it(`accepts an enterprise specification with ${description}`, () => {
        expect(() => verifyEncryptedSpec(enterprise(change))).to.not.throw();
      });
    });

    [
      ['a v8 specification without enterprise', { version: 8, enterprise: '', compose: [{ name: 'web' }], contacts: ['a@b.c'] }],
      ['a v7 specification', { version: 7, enterprise: 'blob', compose: [{ name: 'web' }], contacts: ['a@b.c'] }],
      ['nothing', undefined],
    ].forEach(([description, spec]) => {
      it(`does not apply to ${description}`, () => {
        expect(() => verifyEncryptedSpec(spec)).to.not.throw();
      });
    });
  });
});
