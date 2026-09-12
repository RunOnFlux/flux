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
        // Production's values unless a test says otherwise. Supplied rather than left
        // undefined: the period reaches setInterval, and setInterval(fn, undefined) is
        // setInterval(fn, 0) - a runaway refresh under every other test in this file.
        refreshIntervalMs: overrides.refreshIntervalMs ?? 24 * 60 * 60 * 1000,
        peerWindowMs: overrides.peerWindowMs ?? 3 * 1000,
        fetchTimeoutMs: overrides.fetchTimeoutMs ?? 10 * 1000,
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
  describe('the timings come from config', () => {
    // They were constants in the module, and a 24-hour period written there cannot be
    // observed by any test - so the periodic refresh had no coverage and the fleet suites
    // restarted nodes to approximate it, which exercises the boot path instead.
    it('refreshes on the configured period, not on a hardcoded day', async () => {
      const axiosGet = sinon.stub().rejects(new Error('offline'));
      const { module } = load({ refreshIntervalMs: 40, serviceHelper: { axiosGet } });
      await module.start();
      const afterBoot = axiosGet.callCount;
      await new Promise((resolve) => { setTimeout(resolve, 150); });
      module.stop();
      // At 40ms a 150ms wait is three ticks; asserted as "more than the boot fetch"
      // rather than an exact count, because the number of ticks in a window is the
      // machine's business and the property is only that the period is the one given.
      expect(axiosGet.callCount, 'the configured period elapsed and it refreshed')
        .to.be.greaterThan(afterBoot);
    });

    it('bounds the backstop fetch with the configured timeout', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(3) });
      const { module } = load({ fetchTimeoutMs: 1234, serviceHelper: { axiosGet } });
      await module.start();
      module.stop();
      expect(axiosGet.firstCall.args[1].timeout).to.equal(1234);
    });
  });

  describe('holding policy is not the same as acting on it', () => {
    const restoredRepo = (seq) => ({
      readBundle: sinon.stub().resolves({ raw: bundle(seq), seq }),
      writeBundle: sinon.stub().resolves(true),
    });

    it('restores a bundle but does not open the gate on the strength of disk', async () => {
      // Disk proves the bundle is real. It cannot prove policy did not move while this
      // node was down, and the documents inside decide who may host what.
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ request: sinon.stub().resolves(), announce: sinon.stub().resolves(), count: () => 0 });
      await module.start();
      module.stop();
      expect(module.getSeq(), 'it holds the bundle').to.equal(4);
      expect(state.policyReady, 'but may not act on it yet').to.equal(false);
    });

    it('a peer at the same sequence confirms it', async () => {
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ request: sinon.stub().resolves(), announce: sinon.stub().resolves(), count: () => 0 });
      await module.start();
      expect(state.policyReady).to.equal(false);

      module.notePeerSeq(4); // "I am at 4 too" - so we are not behind
      expect(state.policyReady, 'a peer that is not ahead of us is the evidence').to.equal(true);
      module.stop();
    });

    it('a peer with no policy at all does not confirm us', async () => {
      // It answers, so it is alive - but an empty peer cannot speak to whether what we
      // restored is still the network's.
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ request: sinon.stub().resolves(), announce: sinon.stub().resolves(), count: () => 1 });
      await module.start();

      module.notePeerSeq(null);
      expect(state.policyReady, 'an empty peer is not agreement').to.equal(false);
      module.stop();
    });

    it('a peer AHEAD of us does not confirm - it means we are behind', async () => {
      const request = sinon.stub().resolves();
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ request, announce: sinon.stub().resolves(), count: () => 1 });
      await module.start();

      module.notePeerSeq(9);
      expect(state.policyReady, 'still shut: we are the stale one').to.equal(false);
      expect(request.called, 'and we ask for what they have').to.equal(true);
      module.stop();
    });

    it('adopting anything confirms, because it came from outside', async () => {
      const { module, state } = load({
        repo: restoredRepo(4),
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(9) }) },
      });
      module.setPeerTransport({ request: sinon.stub().resolves(), announce: sinon.stub().resolves(), count: () => 0 });
      await module.start();
      expect(state.policyReady).to.equal(false);

      expect(module.offerBundle(bundle(9)), 'a peer hands over something newer').to.equal(true);
      expect(state.policyReady).to.equal(true);
      module.stop();
    });

    it('stays shut when there is no peer set to confirm with, and that is correct', async () => {
      // No fallback timer, deliberately. A node with no peer set is below
      // appSyncPeerThreshold, and the network already holds that such a node should not
      // be acquiring apps - appSyncDegradedThreshold pauses the spawner for that exact
      // reason. Forcing the gate open on a timer would override a decision the fleet
      // had already made.
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ request: sinon.stub().resolves(), announce: sinon.stub().resolves(), count: () => 0 });
      await module.start();
      await new Promise((resolve) => { setTimeout(resolve, 60); });
      expect(state.policyReady, 'held, unconfirmed, not acting').to.equal(false);
      expect(module.getSeq(), 'but the bundle is held and servable to peers').to.equal(4);
      module.stop();
    });

    it('a node with nothing on disk is unaffected - it has nothing to confirm', async () => {
      const { module, state } = load({
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(2) }) },
      });
      await module.start();
      module.stop();
      expect(module.getSeq()).to.equal(2);
      expect(state.policyReady, 'adopting from the source opens it as before').to.equal(true);
    });
  });

  describe('what boot costs the published source', () => {
    it('does not fetch when it came back holding a verified bundle', async () => {
      // A release wave restarts the fleet inside a short window. An unconditional boot
      // fetch makes that every node at once - the storm the tick phase exists to prevent,
      // through a different door. A restored node already has policy.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const repo = {
        readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }),
        writeBundle: sinon.stub().resolves(true),
      };
      const { module } = load({ repo, serviceHelper: { axiosGet } });
      await module.start();
      module.stop();
      expect(module.getSeq(), 'it is running on what it restored').to.equal(4);
      expect(axiosGet.called, 'and it did not go to the source to learn that').to.equal(false);
    });

    it('fetches when it came back with nothing', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module } = load({ serviceHelper: { axiosGet } });
      await module.start();
      module.stop();
      expect(axiosGet.calledOnce, 'nothing on disk, so it must ask').to.equal(true);
      expect(module.getSeq()).to.equal(9);
    });
  });

  describe('when in the period this node ticks', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const { backstopPhaseMs } = load().module;

    it('is the same slot every time, so a restart does not move it', () => {
      const id = 'a0b1c2:0';
      expect(backstopPhaseMs(id, DAY)).to.equal(backstopPhaseMs(id, DAY));
    });

    it('is inside the period', () => {
      for (let i = 0; i < 50; i += 1) {
        const phase = backstopPhaseMs(`node-${i}:0`, DAY);
        expect(phase).to.be.at.least(0);
        expect(phase).to.be.below(DAY);
      }
    });

    it('spreads a fleet across the whole period', () => {
      // The property the whole thing exists for. A fleet-sized sample is bucketed by
      // hour; a deterministic phase has to fill all 24 roughly evenly, because if it
      // clusters then a release wave still produces a synchronised fetch - which is the
      // failure being designed out, not a cosmetic concern.
      const buckets = new Array(24).fill(0);
      const fleet = 6300;
      for (let i = 0; i < fleet; i += 1) {
        const phase = backstopPhaseMs(`${i.toString(16).padStart(64, '0')}:0`, DAY);
        buckets[Math.floor(phase / (60 * 60 * 1000))] += 1;
      }
      const expectedPerBucket = fleet / 24; // 262.5
      expect(Math.min(...buckets), 'no hour is starved').to.be.greaterThan(expectedPerBucket * 0.8);
      expect(Math.max(...buckets), 'no hour is crowded').to.be.below(expectedPerBucket * 1.2);
    });

    it('gives different nodes different slots', () => {
      // Restarted together, phased apart: this is the case a random offset gets wrong,
      // because a random offset is re-drawn on every boot and a release wave has every
      // node drawing inside the same minute.
      const slots = new Set(
        Array.from({ length: 200 }, (unused, i) => backstopPhaseMs(`peer-${i}:0`, DAY)),
      );
      expect(slots.size, '200 nodes land on 200 distinct slots').to.equal(200);
    });
  });

  describe('asking peers only when there are peers', () => {
    it('does not ask, and does not wait, when nothing is connected', async () => {
      // What every boot did: the store starts before discovery, so this broadcast reached
      // nobody and the window that followed waited for an answer that could not come.
      const request = sinon.stub().resolves();
      const delay = sinon.stub().resolves();
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module } = load({ serviceHelper: { axiosGet, delay } });
      module.setPeerTransport({ request, announce: sinon.stub().resolves(), count: () => 0 });

      await module.refresh();
      expect(request.called, 'nobody to ask, so it did not ask').to.equal(false);
      expect(delay.called, 'and it did not wait out the peer window').to.equal(false);
      expect(module.getSeq(), 'it went straight to the backstop').to.equal(2);
    });

    it('asks when peers exist', async () => {
      const request = sinon.stub().resolves();
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module } = load({ serviceHelper: { axiosGet } });
      module.setPeerTransport({ request, announce: sinon.stub().resolves(), count: () => 3 });

      await module.refresh();
      expect(request.calledOnce, 'three peers, so it asked them').to.equal(true);
    });

    it('asks anyway when the transport cannot say how many there are', async () => {
      // Unknown is not zero. A transport wired without a count keeps the old behaviour
      // rather than silently losing the peer rung.
      const request = sinon.stub().resolves();
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module } = load({ serviceHelper: { axiosGet } });
      module.setPeerTransport({ request, announce: sinon.stub().resolves() });

      await module.refresh();
      expect(request.calledOnce).to.equal(true);
    });
  });

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

    it('runs the whole ladder for a RESTORED bundle, which is not confirmation', async () => {
      // A node that restored from disk holds a bundle and is still behind until something
      // says otherwise: disk proves the bundle was real, never that it is still the
      // network's. Its peers may be equally stale, so the published source is the floor
      // under it exactly as under a node holding nothing.
      //
      // Gating on "holds something" instead left a restarted node unable to reach the source
      // at all - it took the targeted rung, which by design cannot fetch - so it sat on
      // whatever it had until its next backstop tick.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module } = load({
        serviceHelper: { axiosGet },
        repo: {
          readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }),
          writeBundle: sinon.stub().resolves(true),
        },
      });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({
        request: sinon.stub().resolves(), requestFrom, announce: sinon.stub().resolves(),
      });
      await module.restore();
      expect(module.getSeq(), 'restored, so it holds something').to.equal(4);

      const fetchesBefore = axiosGet.callCount;
      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);

      expect(axiosGet.callCount, 'restored, so the source is still in reach')
        .to.be.greaterThan(fetchesBefore);
      module.stop();
    });

    it('reaches the source after a restart even when a peer has already confirmed it', async () => {
      // THE WHOLE FLEET RESTARTED TOGETHER. Every node restores the same stale bundle, so
      // every peer answers "not ahead" - true, and useless. That answer marks the node
      // confirmed within milliseconds, and if confirmation gated the ladder, nothing would
      // ever reach the published source: a newly published document would wait for a
      // backstop tick up to a day out, and a blocklist naming a running application would
      // not arrive at all.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module } = load({
        serviceHelper: { axiosGet },
        repo: {
          readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }),
          writeBundle: sinon.stub().resolves(true),
        },
      });
      module.setPeerTransport({
        request: sinon.stub().resolves(),
        requestFrom: sinon.stub().resolves(),
        announce: sinon.stub().resolves(),
      });
      await module.restore();

      // A peer at the same sequence settles it before any arrival is noted.
      module.notePeerSeq(4, '198.18.0.11:16127');
      const fetchesBefore = axiosGet.callCount;

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);

      expect(axiosGet.callCount, 'a level peer must not close the road to the source')
        .to.be.greaterThan(fetchesBefore);
      module.stop();
    });

    it('asks the peer that arrived, not the whole set, once it holds something', async () => {
      // A node that already holds policy has one question - is THIS peer ahead - and puts it
      // to that peer alone. A broadcast here would have to be rationed, and a rationed ask
      // cannot serve a node that is merely behind.
      const { module } = load({
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) },
      });
      const request = sinon.stub().resolves();
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ request, requestFrom, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();
      expect(module.getSeq()).to.equal(4);
      // The first arrival after boot spends the once-per-boot ladder; the targeted rung is
      // what every arrival AFTER it takes.
      module.notePeerAvailable('198.18.0.99:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);
      const broadcastsAtBoot = request.callCount;

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);

      expect(requestFrom.calledOnce, 'the arriving peer was asked directly').to.equal(true);
      expect(requestFrom.firstCall.args[0]).to.equal('198.18.0.11:16127');
      expect(requestFrom.firstCall.args[1], 'and told what we hold').to.equal(4);
      expect(request.callCount, 'no broadcast to the whole set').to.equal(broadcastsAtBoot);
    });

    it('keeps asking as peers arrive, rather than once since boot', async () => {
      // Every arrival is asked, for as long as the node holds policy. Being told is not an
      // alternative: a peer that adopts in the seconds before it connects announces to
      // nobody, and nothing afterwards revisits it.
      const { module } = load({
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) },
      });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({
        request: sinon.stub().resolves(), requestFrom, announce: sinon.stub().resolves(),
      });
      await module.start();
      module.stop();

      // The first arrival after boot spends the once-per-boot ladder; the targeted rung is
      // what every arrival AFTER it takes.
      module.notePeerAvailable('198.18.0.99:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      module.notePeerAvailable('198.18.0.13:16127');
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'each arriving peer is asked').to.equal(2);
      expect(requestFrom.secondCall.args[0]).to.equal('198.18.0.13:16127');
    });

    it('never reaches the published source on the targeted rung', async () => {
      // The source is rate-limited and shared by the whole fleet, so anything that can reach
      // it must run on the backstop's timer. This rung runs on every arrival, so it must not
      // be able to reach it at all.
      const axiosGet = sinon.stub().resolves({ data: bundle(4) });
      const { module } = load({ serviceHelper: { axiosGet } });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({
        request: sinon.stub().resolves(), requestFrom, announce: sinon.stub().resolves(),
      });
      await module.start();
      module.stop();
      // The first arrival after boot spends the once-per-boot ladder; the targeted rung is
      // what every arrival AFTER it takes.
      module.notePeerAvailable('198.18.0.99:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);
      const fetchesAtBoot = axiosGet.callCount;

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);

      expect(axiosGet.callCount, 'the source was not asked').to.equal(fetchesAtBoot);
    });

    it('settles a targeted ask on the answer, not on the clock', async () => {
      // Every peer answers - a bundle if ahead, its sequence if not, null if it holds
      // nothing - so the ask ends on the reply. A second ask while one is outstanding adds
      // nothing; a peer that has answered is askable again.
      const { module } = load({
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) },
      });
      // The send is held open so the first ask is still outstanding when the second arrives;
      // otherwise it completes within the tick and there is no overlap to assert on.
      let deliver;
      const requestFrom = sinon.stub().returns(new Promise((resolve) => { deliver = resolve; }));
      module.setPeerTransport({
        request: sinon.stub().resolves(), requestFrom, announce: sinon.stub().resolves(),
      });
      await module.start();
      module.stop();

      module.notePeerAvailable('198.18.0.99:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      expect(requestFrom.callCount, 'one outstanding ask per peer').to.equal(1);

      // The peer answers "not ahead". That ends the ask without waiting out the window.
      deliver();
      await new Promise(setImmediate);
      module.notePeerSeq(4, '198.18.0.11:16127');
      await new Promise(setImmediate);

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      expect(requestFrom.callCount, 'answered, so askable again').to.equal(2);
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
      expect(axiosGet.called, 'disk alone, no network').to.equal(false);
      // The gate is NOT opened by a restore any more. Disk proves the bundle is real and
      // says nothing about whether policy moved while this node was down, so acting on it
      // waits for a peer to agree - see 'holding policy is not the same as acting on it'.
      expect(state.policyReady, 'held, pending confirmation').to.equal(false);
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
