const { expect } = require('chai');
const crypto = require('crypto');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/policyStore';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function makeKeypair() {
  const seed = crypto.randomBytes(32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8',
  });
  const publicHex = crypto.createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  return { privateKey, publicHex };
}

const KEY = makeKeypair();
const OTHER = makeKeypair();

function bundle(seq, documents = { blockedrepositories: ['a/b'] }, privateKey = KEY.privateKey) {
  const payload = Buffer.from(JSON.stringify({
    seq,
    issued_at: new Date().toISOString(),
    documents,
    artifacts: { 'iplocation.bin.gz': { file: `iplocation-${seq}.bin.gz`, sha256: 'aa', bytes: 1 } },
  }), 'utf8');
  return JSON.stringify({
    payload_b64: payload.toString('base64'),
    sig_b64: crypto.sign(null, payload, privateKey).toString('base64'),
  });
}

function load(overrides = {}) {
  const log = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
  const state = { policyReady: false };
  const repo = overrides.repo || {
    readBundle: sinon.stub().resolves(null),
    writeBundle: sinon.stub().resolves(true),
  };
  const serviceHelper = overrides.serviceHelper || { axiosGet: sinon.stub().rejects(new Error('offline')) };

  const module = proxyquire(MODULE_PATH, {
    config: {
      policy: {
        signedBaseUrl: 'https://policy.example/signed',
        publicKeys: overrides.publicKeys || [KEY.publicHex],
      },
    },
    '../lib/log': log,
    './serviceHelper': serviceHelper,
    './utils/globalState': state,
    './appDatabase/policyArtifactRepository': repo,
  });
  return {
    module, log, state, repo, serviceHelper,
  };
}

describe('policyStore', () => {
  afterEach(() => sinon.restore());

  describe('before anything is obtained', () => {
    it('answers null, not empty, and leaves the gate shut', () => {
      const { module: m, state } = load();
      expect(m.isReady()).to.equal(false);
      expect(m.getSeq()).to.equal(0);
      expect(m.getDocument('blockedrepositories')).to.equal(null);
      expect(m.getArtifact('iplocation.bin.gz')).to.equal(null);
      expect(state.policyReady).to.equal(false);
    });
  });

  describe('the ladder', () => {
    it('asks peers before the backstop, and does not reach it when a peer answers', async () => {
      // The property that makes github a seed rather than a dependency.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerFetch(async () => [bundle(5)]);

      await m.refresh();

      expect(m.getSeq()).to.equal(5);
      expect(axiosGet.called).to.equal(false);
    });

    it('falls through to the backstop when no peer answers usefully', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerFetch(async () => []);

      await m.refresh();

      expect(m.getSeq()).to.equal(9);
      expect(axiosGet.calledOnce).to.equal(true);
    });

    it('skips a lying peer and keeps going', async () => {
      // A source that answers wrongly is skipped, not believed - which is what lets the
      // ladder prefer whatever is nearest without that being a trust decision.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerFetch(async () => [bundle(500, undefined, OTHER.privateKey), 'not json']);

      await m.refresh();

      expect(m.getSeq()).to.equal(9); // the backstop's, not the liar's 500
    });

    it('keeps what it holds when every source fails', async () => {
      const { module: m, state } = load();
      m.setPeerFetch(async () => [bundle(4)]);
      await m.refresh();
      expect(m.getSeq()).to.equal(4);

      m.setPeerFetch(async () => { throw new Error('peers gone'); });
      await m.refresh();

      expect(m.getSeq()).to.equal(4);
      expect(state.policyReady).to.equal(true);
    });
  });

  describe('sequence', () => {
    it('refuses a bundle older than the one held', async () => {
      const { module: m } = load();
      m.setPeerFetch(async () => [bundle(10)]);
      await m.refresh();

      m.setPeerFetch(async () => [bundle(3)]);
      await m.refresh();

      expect(m.getSeq()).to.equal(10);
    });

    it('adopts a newer bundle', async () => {
      const { module: m } = load();
      m.setPeerFetch(async () => [bundle(10)]);
      await m.refresh();
      m.setPeerFetch(async () => [bundle(11)]);
      await m.refresh();

      expect(m.getSeq()).to.equal(11);
    });

    it('does not re-adopt the sequence it already holds', async () => {
      const { module: m, repo } = load();
      m.setPeerFetch(async () => [bundle(10)]);
      await m.refresh();
      const writes = repo.writeBundle.callCount;

      await m.refresh();

      expect(m.getSeq()).to.equal(10);
      expect(repo.writeBundle.callCount).to.equal(writes); // nothing rewritten
    });
  });

  describe('persistence', () => {
    it('stores the bytes that were verified, not a re-serialisation', async () => {
      // Re-serialising would leave a document whose signature no longer checks, and the
      // point of storing it is to check it again at boot.
      const raw = bundle(12);
      const { module: m, repo } = load();
      m.setPeerFetch(async () => [raw]);
      await m.refresh();

      expect(repo.writeBundle.calledOnce).to.equal(true);
      expect(repo.writeBundle.firstCall.args[0]).to.equal(raw);
      expect(repo.writeBundle.firstCall.args[1]).to.equal(12);
    });

    it('restores and re-verifies a stored bundle without any network', async () => {
      const axiosGet = sinon.stub().rejects(new Error('should not be called'));
      const repo = { readBundle: sinon.stub().resolves({ raw: bundle(8), seq: 8 }), writeBundle: sinon.stub().resolves(true) };
      const { module: m, state } = load({ repo, serviceHelper: { axiosGet } });

      await m.restore();

      expect(m.getSeq()).to.equal(8);
      expect(state.policyReady).to.equal(true);
      expect(axiosGet.called).to.equal(false);
    });

    it('drops a stored bundle that no longer verifies', async () => {
      // The row is only as good as whatever can write to this node's database, and the
      // pinned keys may have moved on since it was stored.
      const repo = { readBundle: sinon.stub().resolves({ raw: bundle(8, undefined, OTHER.privateKey), seq: 8 }), writeBundle: sinon.stub().resolves(true) };
      const { module: m, state } = load({ repo });

      const restored = await m.restore();

      expect(restored).to.equal(false);
      expect(m.isReady()).to.equal(false);
      expect(state.policyReady).to.equal(false);
    });
  });

  describe('documents', () => {
    it('answers a document the bundle carries, and null for one it does not', async () => {
      // A name the bundle does not carry answers null so a document can be published before
      // the release that reads it.
      const { module: m } = load();
      m.setPeerFetch(async () => [bundle(1, { blockedrepositories: ['x/y'], enterprisenodes: { pubA: ['ownerA'] } })]);
      await m.refresh();

      expect(m.getDocument('blockedrepositories')).to.deep.equal(['x/y']);
      expect(m.getDocument('enterprisenodes')).to.deep.equal({ pubA: ['ownerA'] });
      expect(m.getDocument('somethingnew')).to.equal(null);
    });

    it('answers the artifact the bundle names', async () => {
      const { module: m } = load();
      m.setPeerFetch(async () => [bundle(3)]);
      await m.refresh();

      expect(m.getArtifact('iplocation.bin.gz').file).to.equal('iplocation-3.bin.gz');
    });
  });

  describe('the backstop response', () => {
    it('is taken as text, never as a parsed object', async () => {
      // axios parsing and this module re-serialising would verify something the signer
      // never signed.
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module: m } = load({ serviceHelper: { axiosGet } });

      await m.refresh();

      expect(axiosGet.firstCall.args[1].transformResponse).to.be.an('array');
      expect(m.getSeq()).to.equal(2);
    });

    it('is size-capped at the request', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module: m } = load({ serviceHelper: { axiosGet } });

      await m.refresh();

      expect(axiosGet.firstCall.args[1].maxContentLength).to.be.a('number');
    });
  });
});
