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
  const serviceHelper = {
    axiosGet: sinon.stub().rejects(new Error('offline')),
    // Real, but instant: the peer window is a bound on waiting, and a test should not sit
    // through three seconds of it.
    delay: () => Promise.resolve(),
    ...(overrides.serviceHelper || {}),
  };

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
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(5)); } });

      await m.refresh();

      expect(m.getSeq()).to.equal(5);
      expect(axiosGet.called).to.equal(false);
    });

    it('falls through to the backstop when no peer answers usefully', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerTransport({ request: async () => {} });

      await m.refresh();

      expect(m.getSeq()).to.equal(9);
      expect(axiosGet.calledOnce).to.equal(true);
    });

    it('skips a lying peer and keeps going', async () => {
      // A source that answers wrongly is skipped, not believed - which is what lets the
      // ladder prefer whatever is nearest without that being a trust decision.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerTransport({
        request: async () => {
          m.offerBundle(bundle(500, undefined, OTHER.privateKey));
          m.offerBundle('not json');
        },
      });

      await m.refresh();

      expect(m.getSeq()).to.equal(9); // the backstop's, not the liar's 500
    });

    it('keeps what it holds when every source fails', async () => {
      const { module: m, state } = load();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(4)); } });
      await m.refresh();
      expect(m.getSeq()).to.equal(4);

      m.setPeerTransport({ request: async () => { throw new Error('peers gone'); } });
      await m.refresh();

      expect(m.getSeq()).to.equal(4);
      expect(state.policyReady).to.equal(true);
    });
  });

  // What makes peers the primary path rather than a fallback. Polling can only ever ask the
  // source "is there anything newer?", so the source stays primary wherever it sits in the
  // ladder. Being TOLD inverts that: a change spreads outwards from whichever node reached
  // the backstop first, and the poll becomes a safety net for nodes that missed it.
  describe('the peer rung at boot', () => {
    // policyStore is started before discovery (serviceManager.js:505 vs :560), so the boot
    // refresh asks an empty peer set and falls through to the backstop. Until a peer
    // connection told the store to ask again, the FIRST time peers were ever asked was the
    // 24-hour tick -- so a node that booted while the source was unreachable held no policy
    // for a day, beside neighbours that had it.
    it('asks again when a peer first appears, having had none to ask at boot', async () => {
      const { module } = load();
      const request = sinon.stub().resolves();
      module.setPeerTransport({ request, announce: sinon.stub().resolves() });
      // boot: no peers exist yet, the source is unreachable, nothing is obtained
      await module.start();
      module.stop();
      expect(module.isReady(), 'boot obtained nothing').to.equal(false);
      const asksAtBoot = request.callCount;

      module.notePeerAvailable();
      await new Promise(setImmediate);
      expect(request.callCount, 'a peer appearing produces an ask').to.be.greaterThan(asksAtBoot);
    });

    it('asks on every new peer while it holds nothing', async () => {
      const { module } = load();
      const request = sinon.stub().resolves();
      module.setPeerTransport({ request, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();
      const asksAtBoot = request.callCount;

      // Each is awaited so the previous refresh has settled: the point being proven is
      // that a node holding nothing keeps asking, not how concurrent asks collapse.
      module.notePeerAvailable();
      await new Promise(setImmediate);
      const afterFirst = request.callCount;
      module.notePeerAvailable();
      await new Promise(setImmediate);
      expect(afterFirst).to.be.greaterThan(asksAtBoot);
      expect(request.callCount, 'still nothing held, so still worth asking').to.be.greaterThan(afterFirst);
    });

    it('asks once only, once it holds something', async () => {
      const { module } = load({
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) },
      });
      const request = sinon.stub().resolves();
      module.setPeerTransport({ request, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();
      expect(module.getSeq()).to.equal(4);
      const asksAtBoot = request.callCount;

      module.notePeerAvailable();
      await new Promise(setImmediate);
      const afterFirst = request.callCount;
      expect(afterFirst, 'the first peer is still worth one ask').to.be.greaterThan(asksAtBoot);
      module.notePeerAvailable();
      await new Promise(setImmediate);
      expect(request.callCount, 'and no more after that').to.equal(afterFirst);
    });

    it('collapses a burst of arriving peers into exactly one refresh', async () => {
      // Sixteen peers connecting in a second must not become sixteen requests to the
      // published source. That is the fleet-wide stampede this design exists to avoid,
      // arriving by the back door.
      //
      // The boot fetch is allowed to FAIL and finish first, so the count measured here is
      // only what the peers caused. Measuring from zero would let this pass on the boot
      // fetch alone -- green whether or not a peer does anything at all.
      let resolveFetch;
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().rejects(new Error('offline'));
      axiosGet.returns(new Promise((resolve) => { resolveFetch = resolve; }));
      const { module } = load({ serviceHelper: { axiosGet } });
      module.setPeerTransport({ request: sinon.stub().resolves(), announce: sinon.stub().resolves() });

      await module.start();
      module.stop();
      expect(module.isReady(), 'boot obtained nothing').to.equal(false);
      const afterBoot = axiosGet.callCount;

      for (let i = 0; i < 16; i += 1) module.notePeerAvailable();
      await new Promise(setImmediate);
      await new Promise(setImmediate);
      expect(
        axiosGet.callCount - afterBoot,
        'sixteen peers, one fetch: more than one is the stampede, none means the peers did nothing',
      ).to.equal(1);

      resolveFetch({ data: bundle(9) });
      await new Promise(setImmediate);
      expect(module.getSeq()).to.equal(9);
    });
  });

  describe('spreading a change', () => {
    it('announces a sequence it has adopted', async () => {
      const announce = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(6)); }, announce });

      await m.refresh();

      expect(announce.calledOnceWithExactly(6)).to.equal(true);
    });

    it('announces on every adoption, so a change keeps moving outwards', async () => {
      const announce = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ request: async () => {}, announce });

      m.offerBundle(bundle(6));
      m.offerBundle(bundle(7));

      expect(announce.args.map((a) => a[0])).to.deep.equal([6, 7]);
    });

    it('does not announce a bundle it refused', async () => {
      const announce = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ request: async () => {}, announce });
      m.offerBundle(bundle(6));
      announce.resetHistory();

      m.offerBundle(bundle(2)); // older
      m.offerBundle(bundle(9, undefined, OTHER.privateKey)); // unsigned by a pinned key

      expect(announce.called).to.equal(false);
    });

    it('does not let a failed announcement stop the adoption', async () => {
      // Telling peers is best effort. A node that cannot announce still holds the policy.
      const announce = sinon.stub().rejects(new Error('peers gone'));
      const { module: m } = load();
      m.setPeerTransport({ request: async () => {}, announce });

      m.offerBundle(bundle(6));

      expect(m.getSeq()).to.equal(6);
    });

    it('asks the network when a peer claims a higher sequence', () => {
      // The claim itself is not checkable, so it is a prompt to ask. What comes back is a
      // signed bundle, which is.
      const request = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ request, announce: async () => {} });
      m.offerBundle(bundle(6));
      request.resetHistory();

      m.notePeerSeq(11);

      expect(request.calledOnceWithExactly(6)).to.equal(true);
    });

    it('ignores a claim at or below what it holds, and a malformed one', () => {
      // A liar claiming 9999 costs one request; a liar claiming a number every second would
      // cost one per second, so the cheap checks happen before the ask.
      const request = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ request, announce: async () => {} });
      m.offerBundle(bundle(6));
      request.resetHistory();

      m.notePeerSeq(6);
      m.notePeerSeq(2);
      m.notePeerSeq('11');
      m.notePeerSeq(null);

      expect(request.called).to.equal(false);
    });
  });

  describe('sequence', () => {
    it('refuses a bundle older than the one held', async () => {
      const { module: m } = load();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(10)); } });
      await m.refresh();

      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(3)); } });
      await m.refresh();

      expect(m.getSeq()).to.equal(10);
    });

    it('adopts a newer bundle', async () => {
      const { module: m } = load();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(10)); } });
      await m.refresh();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(11)); } });
      await m.refresh();

      expect(m.getSeq()).to.equal(11);
    });

    it('does not re-adopt the sequence it already holds', async () => {
      const { module: m, repo } = load();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(10)); } });
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
      m.setPeerTransport({ request: async () => { m.offerBundle(raw); } });
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
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(1, { blockedrepositories: ['x/y'], enterprisenodes: { pubA: ['ownerA'] } })); } });
      await m.refresh();

      expect(m.getDocument('blockedrepositories')).to.deep.equal(['x/y']);
      expect(m.getDocument('enterprisenodes')).to.deep.equal({ pubA: ['ownerA'] });
      expect(m.getDocument('somethingnew')).to.equal(null);
    });

    it('answers the artifact the bundle names', async () => {
      const { module: m } = load();
      m.setPeerTransport({ request: async () => { m.offerBundle(bundle(3)); } });
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
