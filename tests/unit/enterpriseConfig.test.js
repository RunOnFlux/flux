const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseConfig';

const MAP = { pubA: ['ownerA', 'ownerB'], pubB: ['ownerB'] };

// enterpriseConfig no longer fetches anything. policyStore obtains and verifies the signed
// bundle; this module owns what the enterprisenodes document MEANS. These tests are about
// that meaning, and above all about the distinction the module exists for: an unread policy
// is not an empty one.
function load(document) {
  const log = { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
  const policyStore = { getDocument: sinon.stub().returns(document) };
  return { module: proxyquire(MODULE_PATH, { '../policyStore': policyStore, '../../lib/log': log }), log, policyStore };
}

describe('enterpriseConfig', () => {
  afterEach(() => sinon.restore());

  describe('when the policy is unknown', () => {
    it('answers null from every getter, never an empty value', () => {
      // `{}` says nobody is an enterprise node. Absence says we do not know yet. Answering
      // the first when the second is true is what let a node fill with apps it must not host.
      const { module: m } = load(null);
      expect(m.isPolicyKnown()).to.equal(false);
      expect(m.getEnterpriseNodeOwnerMap()).to.equal(null);
      expect(m.getEnterpriseNodesPublicKeys()).to.equal(null);
      expect(m.getEnterpriseAppOwners()).to.equal(null);
      expect(m.getAllowedOwnersForNode('pubA')).to.equal(null);
    });

    it('null is distinguishable from an empty map', () => {
      const { module: m } = load(null);
      expect(m.getEnterpriseNodesPublicKeys()).to.not.deep.equal([]);
      expect(m.getEnterpriseAppOwners()).to.not.deep.equal([]);
    });
  });

  describe('when the bundle carries the document', () => {
    it('reads the map, its keys and the deduped owner union', () => {
      const { module: m } = load(MAP);
      expect(m.isPolicyKnown()).to.equal(true);
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal(MAP);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(['pubA', 'pubB']);
      expect(m.getEnterpriseAppOwners()).to.deep.equal(['ownerA', 'ownerB']);
    });

    it('answers [] for a node the map does not mention, which is known and hosts nobody', () => {
      const { module: m } = load(MAP);
      expect(m.getAllowedOwnersForNode('pubA')).to.deep.equal(['ownerA', 'ownerB']);
      expect(m.getAllowedOwnersForNode('pubZ')).to.deep.equal([]);
    });

    it('treats a genuinely empty map as known, with nobody enterprise', () => {
      const { module: m } = load({});
      expect(m.isPolicyKnown()).to.equal(true);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal([]);
      expect(m.getEnterpriseAppOwners()).to.deep.equal([]);
    });

    it('memoizes the owner union until the store hands back a different map', () => {
      const { module: m, policyStore } = load(MAP);
      const first = m.getEnterpriseAppOwners();
      expect(m.getEnterpriseAppOwners()).to.equal(first); // same reference, not rebuilt

      policyStore.getDocument.returns({ pubC: ['ownerC'] });
      const second = m.getEnterpriseAppOwners();
      expect(second).to.not.equal(first);
      expect(second).to.deep.equal(['ownerC']);
    });
  });

  describe('a signed document is still checked', () => {
    // A signature says who published a document, not that its contents are the shape this
    // code expects. A single malformed value would make a node host nothing and uninstall
    // everything, so the shape check survives the move to a signed bundle.
    it('rejects a document that is not a plain object', () => {
      [['not', 'an', 'object'], 'string', 42].forEach((document) => {
        const { module: m } = load(document);
        expect(m.getEnterpriseNodeOwnerMap(), JSON.stringify(document)).to.equal(null);
        expect(m.isPolicyKnown()).to.equal(false);
      });
    });

    it('rejects values that are not arrays of strings, and says so', () => {
      const { module: m, log } = load({ pubA: null });
      expect(m.getEnterpriseNodeOwnerMap()).to.equal(null);
      expect(log.error.called).to.equal(true);
    });

    it('rejects an array containing a non-string owner', () => {
      const { module: m } = load({ pubA: ['ownerA', 42] });
      expect(m.getEnterpriseNodeOwnerMap()).to.equal(null);
    });
  });

  describe('what it reads', () => {
    it('asks the store for the enterprisenodes document and nothing else', () => {
      const { module: m, policyStore } = load(MAP);
      m.getEnterpriseNodeOwnerMap();
      expect(policyStore.getDocument.calledWith('enterprisenodes')).to.equal(true);
    });
  });
});
