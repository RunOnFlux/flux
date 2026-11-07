const { expect } = require('chai');

const { verifyEnterpriseCarriesNoPlainSpec } = require('../../ZelBack/src/services/utils/enterpriseSpec');

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
    ].forEach(([description, change]) => {
      it(`accepts an enterprise specification with ${description}`, () => {
        expect(() => verifyEnterpriseCarriesNoPlainSpec(enterprise(change))).to.not.throw();
      });
    });

    [
      ['a v8 specification without enterprise', { version: 8, enterprise: '', compose: [{ name: 'web' }], contacts: ['a@b.c'] }],
      ['a v7 specification', { version: 7, enterprise: 'blob', compose: [{ name: 'web' }], contacts: ['a@b.c'] }],
      ['nothing', undefined],
    ].forEach(([description, spec]) => {
      it(`does not apply to ${description}`, () => {
        expect(() => verifyEnterpriseCarriesNoPlainSpec(spec)).to.not.throw();
      });
    });
  });
});
