const { expect } = require('chai');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/hashListStore';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// The keys fluxbench pins, as the mainnet profile carries them.
const MAINNET_KEYS = [
  '14837066068b258bfbd0749702056f7065361af44aed48761834744391cbbaaa',
  'fee7b0ccf2323954af68a249eaa61f957239eb222329e08a5b6a50ced649bae8',
];
// The list RunOnFlux/fluxhashes published as seq 508, byte for byte.
const PUBLISHED = fs.readFileSync(path.join(__dirname, 'fixtures', 'hashlist-signed.json'), 'utf8');

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
const TREE = 'dd3dfecedbcc10c2caa6ca1d21944884';

function signed(payloadObject, privateKey = KEY.privateKey) {
  const payload = Buffer.from(JSON.stringify(payloadObject), 'utf8');
  return JSON.stringify({
    payload_b64: payload.toString('base64'),
    sig_b64: crypto.sign(null, payload, privateKey).toString('base64'),
  });
}

function list(seq, hashes = [TREE], privateKey = KEY.privateKey) {
  return signed({ seq, issued_at: new Date().toISOString(), hashes }, privateKey);
}

function load(overrides = {}) {
  const log = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
  const repo = {
    HASH_LIST_ID: 'fluxHashList',
    readSignedDocument: sinon.stub().resolves(null),
    writeSignedDocument: sinon.stub().resolves(true),
    ...(overrides.repo || {}),
  };
  const serviceHelper = { axiosGet: sinon.stub().rejects(new Error('offline')), ...(overrides.serviceHelper || {}) };
  const module = proxyquire(MODULE_PATH, {
    config: {
      hashList: {
        sourceUrl: overrides.sourceUrl ?? 'https://hashes.example/hashlist',
        publicKeys: overrides.publicKeys || [KEY.publicHex],
        refreshIntervalMs: 24 * 60 * 60 * 1000,
        peerWindowMs: 20,
        fetchTimeoutMs: 10 * 1000,
        minConfirmingPeers: 1,
        backstopRetryIntervalMs: 0,
      },
    },
    '../lib/log': log,
    './serviceHelper': serviceHelper,
    './utils/fluxEventBus': { publish: sinon.stub() },
    './appDatabase/policyArtifactRepository': repo,
  });
  return {
    module, log, repo, serviceHelper,
  };
}

describe('hashListStore', () => {
  afterEach(() => sinon.restore());

  describe('verifyHashList', () => {
    it('accepts the list fluxhashes published, under the keys fluxbench pins', () => {
      const { module: m } = load({ publicKeys: MAINNET_KEYS });
      const payload = m.verifyHashList(PUBLISHED, {});
      expect(payload.seq).to.equal(508);
      expect(payload.hashes).to.have.lengthOf(921);
    });

    it('refuses a list no pinned key signed', () => {
      const { module: m } = load();
      const reasons = [];
      expect(m.verifyHashList(list(3, [TREE], OTHER.privateKey), { onReject: (r) => reasons.push(r) })).to.equal(null);
      expect(reasons[0]).to.include('no pinned key verifies this hash list');
    });

    it('refuses a signed payload whose hashes are not tree hashes', () => {
      const { module: m } = load();
      const reasons = [];
      expect(m.verifyHashList(list(3, ['not-a-hash']), { onReject: (r) => reasons.push(r) })).to.equal(null);
      expect(m.verifyHashList(signed({ seq: 3, documents: {} }), { onReject: (r) => reasons.push(r) })).to.equal(null);
      expect(reasons).to.deep.equal(['hashes is not a list of tree hashes', 'hashes is not a list of tree hashes']);
    });

    it('refuses a policy bundle, which another key signs', () => {
      const policyKey = makeKeypair();
      const { module: m } = load();
      const bundle = signed({ seq: 3, documents: { blockedrepositories: [] } }, policyKey.privateKey);
      expect(m.verifyHashList(bundle, {})).to.equal(null);
    });
  });

  describe('isEnabled', () => {
    it('keeps a list only on a network that names a source and keys', () => {
      expect(load().module.isEnabled()).to.equal(true);
      expect(load({ sourceUrl: '' }).module.isEnabled()).to.equal(false);
      expect(load({ publicKeys: [] }).module.isEnabled()).to.equal(false);
    });

    it('starts nothing on a network with no hash list', async () => {
      const { module: m, repo } = load({ publicKeys: [] });
      await m.start();
      expect(repo.readSignedDocument.called).to.equal(false);
      expect(m.getRawList()).to.equal(null);
      m.stop();
    });
  });

  describe('holding a list', () => {
    it('restores the list it stored, under its own row', async () => {
      const raw = list(7);
      const { module: m, repo } = load({ repo: { readSignedDocument: sinon.stub().resolves({ raw, seq: 7 }) } });
      await m.start();
      m.stop();
      expect(repo.readSignedDocument.firstCall.args[0]).to.equal('fluxHashList');
      expect(m.getSeq()).to.equal(7);
      expect(m.getRawList()).to.equal(raw);
    });

    it('adopts a newer list a peer offers, stores it, and serves the bytes it verified', async () => {
      const { module: m, repo } = load();
      const raw = list(9);
      expect(await m.offerList(raw, '10.0.0.9:16127', 'c1')).to.equal(true);
      expect(m.getSeq()).to.equal(9);
      expect(m.getRawList()).to.equal(raw);
      expect(repo.writeSignedDocument.firstCall.args).to.deep.equal(['fluxHashList', raw, 9]);
    });

    it('keeps what it holds when a peer offers an older or unverifiable list', async () => {
      const { module: m } = load();
      await m.offerList(list(9), '10.0.0.9:16127');
      expect(await m.offerList(list(5), '10.0.0.8:16127')).to.equal(false);
      expect(await m.offerList(list(12, [TREE], OTHER.privateKey), '10.0.0.7:16127')).to.equal(false);
      expect(m.getSeq()).to.equal(9);
    });

    it('takes the list from the published source when its peers cannot settle it', async () => {
      const raw = list(4);
      const axiosGet = sinon.stub().resolves({ data: raw });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      expect(await m.exchange.refresh()).to.equal(true);
      expect(axiosGet.firstCall.args[0]).to.equal('https://hashes.example/hashlist');
      expect(m.getRawList()).to.equal(raw);
    });
  });
});
