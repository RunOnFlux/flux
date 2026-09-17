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
  const eventBus = { publish: sinon.stub(), count: sinon.stub() };
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
    './utils/fluxEventBus': eventBus,
    './appDatabase/policyArtifactRepository': repo,
  });
  return {
    module, log, state, repo, serviceHelper, eventBus,
  };
}

// A peer that speaks the protocol, answering as respondWithPolicy does: the reply echoes
// the id it was sent, because a reply names the ask it settles. requestFrom is the only
// way the store asks; capableKeys is who is worth asking.
const CAPABLE = ['10.0.0.9:16127'];
const answering = (reply) => ({
  capableKeys: () => CAPABLE,
  requestFrom: async (key, seq, id) => reply(key, seq, id),
});
// A capable peer that holds nothing. respondWithPolicy replies in all three states, so
// this settles the ask exactly as a bundle would.
const holdingNothing = (m) => answering((key, seq, id) => m.notePeerSeq(null, key, id));

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
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(5), key, id); }));

      await m.refresh();

      expect(m.getSeq()).to.equal(5);
      expect(axiosGet.called).to.equal(false);
    });

    it('falls through to the backstop when no peer answers usefully', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerTransport(holdingNothing(m));

      await m.refresh();

      expect(m.getSeq()).to.equal(9);
      expect(axiosGet.calledOnce).to.equal(true);
    });

    it('skips a lying peer and keeps going', async () => {
      // A source that answers wrongly is skipped, not believed - which is what lets the
      // ladder prefer whatever is nearest without that being a trust decision.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      m.setPeerTransport(answering((key, seq, id) => {
        m.offerBundle(bundle(500, undefined, OTHER.privateKey), key, id);
        m.offerBundle('not json', key, id);
      }));

      await m.refresh();

      expect(m.getSeq()).to.equal(9); // the backstop's, not the liar's 500
    });

    it('keeps what it holds when every source fails', async () => {
      const { module: m, state } = load();
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(4), key, id); }));
      await m.refresh();
      expect(m.getSeq()).to.equal(4);

      m.setPeerTransport(answering(() => { throw new Error('peers gone'); }));
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
      const { module } = load({ fetchTimeoutMs: 1234, peerWindowMs: 5, serviceHelper: { axiosGet } });
      await module.start();
      // Through the seed rather than through start(): boot no longer reaches the source at
      // all, so this is the first request that leaves the node.
      module.setPeerTransport({ requestFrom: async () => {}, aboveThreshold: () => true });
      await module.notePeerAvailable('10.0.0.1:16127');
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
      module.setPeerTransport({ announce: sinon.stub().resolves(), aboveThreshold: () => false });
      await module.start();
      module.stop();
      expect(module.getSeq(), 'it holds the bundle').to.equal(4);
      expect(state.policyReady, 'but may not act on it yet').to.equal(false);
    });

    it('a peer at the same sequence confirms it', async () => {
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ announce: sinon.stub().resolves(), aboveThreshold: () => false });
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
      module.setPeerTransport({ announce: sinon.stub().resolves(), aboveThreshold: () => true });
      await module.start();

      module.notePeerSeq(null);
      expect(state.policyReady, 'an empty peer is not agreement').to.equal(false);
      module.stop();
    });

    it('a peer AHEAD of us does not confirm - it means we are behind', async () => {
      const request = sinon.stub().resolves();
      const { module, state } = load({ repo: restoredRepo(4) });
      module.setPeerTransport({ capableKeys: () => CAPABLE, requestFrom: request, announce: sinon.stub().resolves(), aboveThreshold: () => true });
      await module.start();

      module.notePeerSeq(9, CAPABLE[0]);
      expect(state.policyReady, 'still shut: we are the stale one').to.equal(false);
      expect(request.calledWith(CAPABLE[0]), 'and we ask the peer that made the claim').to.equal(true);
      module.stop();
    });

    it('adopting anything confirms, because it came from outside', async () => {
      const { module, state } = load({
        repo: restoredRepo(4),
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(9) }) },
      });
      module.setPeerTransport({ announce: sinon.stub().resolves(), aboveThreshold: () => false });
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
      module.setPeerTransport({ announce: sinon.stub().resolves(), aboveThreshold: () => false });
      await module.start();
      await new Promise((resolve) => { setTimeout(resolve, 60); });
      expect(state.policyReady, 'held, unconfirmed, not acting').to.equal(false);
      expect(module.getSeq(), 'but the bundle is held and servable to peers').to.equal(4);
      module.stop();
    });

    it('a node with nothing on disk is unaffected - it has nothing to confirm', async () => {
      const { module, state } = load({
        peerWindowMs: 5,
        serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(2) }) },
      });
      await module.start();
      module.setPeerTransport({ requestFrom: async () => {}, aboveThreshold: () => true });
      await module.notePeerAvailable('10.0.0.1:16127');
      module.stop();
      expect(module.getSeq()).to.equal(2);
      expect(state.policyReady, 'adopting from the source opens it as before').to.equal(true);
    });

    // Holding a bundle and having established that nobody is ahead are two facts, and the
    // gate is their conjunction. These are the orderings in which they can arrive, and the
    // states that can be reached with only one of them - the cases the suite had no example
    // of, which is why a gate that recorded the pair in a latch on one of them shipped.

    it('a source that answers 200 with bytes that do not verify does not spend the confirmation', () => {
      // A captive portal, a transparent proxy, an injected ISP page. All return a body, and
      // none of them is the publisher. On a cold node the old gate treated this as the
      // confirmation, kept it, and could never open afterwards.
      const axiosGet = sinon.stub().resolves({ data: '<html>captive portal</html>' });
      const { module, state } = load({ serviceHelper: { axiosGet } });
      module.setPeerTransport({});

      return module.refresh().then(() => {
        expect(module.getSeq(), 'nothing was adopted').to.equal(0);
        expect(module.offerBundle(bundle(7)), 'then a peer hands over a real one').to.equal(true);
        expect(state.policyReady, 'which is what the node may act on').to.equal(true);
      });
    });

    it('a fetch that failed to verify does not stop the next one confirming', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onCall(0).resolves({ data: 'not a bundle' });
      axiosGet.onCall(1).resolves({ data: bundle(3) });
      const { module, state } = load({ serviceHelper: { axiosGet } });

      await module.refresh();
      await module.refresh();

      expect(module.getSeq()).to.equal(3);
      expect(state.policyReady, 'the second answer was the publisher and it counted').to.equal(true);
    });

    it('a peer claiming seq 0 at an empty node does not spend the confirmation', () => {
      // One signed broadcast from any node in the deterministic list. It is true - nobody
      // is ahead of a node that holds nothing - and there is nothing to act on yet, so it
      // must leave the gate able to open when something does arrive.
      const { module, state } = load();
      module.setPeerTransport({});

      module.notePeerSeq(0, 'peer-1');
      expect(state.policyReady, 'nothing held, so nothing to act on').to.equal(false);

      expect(module.offerBundle(bundle(11))).to.equal(true);
      expect(state.policyReady, 'and now there is').to.equal(true);
    });

    it('an unverified body does not confirm the bundle a node restored', async () => {
      // The mirror of the case above, and the more dangerous one: the node HOLDS something,
      // so a gate written by whatever answered last opens on policy the network may have
      // moved past. Only the signature tells the publisher from whatever answered for it.
      const axiosGet = sinon.stub().resolves({ data: '<html>captive portal</html>' });
      const { module, state } = load({ repo: restoredRepo(2), serviceHelper: { axiosGet } });

      expect(await module.restore()).to.equal(true);
      await module.refresh();

      expect(module.getSeq(), 'it still holds what it restored').to.equal(2);
      expect(state.policyReady, 'but a 200 from nowhere is not evidence about it').to.equal(false);
    });

    it('the publisher serving the sequence already held IS confirmation', async () => {
      // The control for the test above. The ordinary steady-state refresh adopts nothing,
      // and it must still confirm - otherwise "never confirms" would pass as a fix.
      const { module, state } = load({ repo: restoredRepo(2), serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(2) }) } });

      expect(await module.restore()).to.equal(true);
      expect(state.policyReady, 'disk alone does not open it').to.equal(false);

      await module.refresh();
      expect(state.policyReady, 'the source itself answering does').to.equal(true);
    });

    it('confirmation that arrives before the bundle still opens the gate', async () => {
      // start() awaits restore(), and a peer can answer inside that await. The two facts
      // then land in the opposite order to the usual one. Nothing about the node's state
      // differs afterwards, so the gate must not depend on which came first.
      const { module, state } = load({ repo: restoredRepo(2) });

      module.notePeerSeq(0, 'peer-1');
      expect(state.policyReady, 'confirmed, but holding nothing yet').to.equal(false);

      expect(await module.restore()).to.equal(true);
      expect(state.policyReady, 'both facts hold now, in either order').to.equal(true);
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

    it('does not fetch when it came back with nothing either', async () => {
      // start() runs before discovery, so the peer set is empty here on EVERY node. A
      // ladder run at this point cannot take its peer rung and falls through to the
      // source, which made "no peers yet" and "peers have nothing" the same answer - and
      // sent a node whose neighbour held the bundle to github instead. Boot asks nobody;
      // the threshold edge is what decides the node is genuinely alone.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module } = load({ serviceHelper: { axiosGet } });
      await module.start();
      module.stop();
      expect(axiosGet.called, 'an empty store at boot is not evidence about the network').to.equal(false);
      expect(module.getSeq(), 'and it holds nothing until something answers').to.equal(0);
    });
  });

  describe('seeding from the source when the peers have nothing', () => {
    const PEER = '10.0.0.1:16127';
    const OTHER_PEER = '10.0.0.2:16127';

    // A peer that answers "I hold nothing". respondWithPolicy replies in all three states,
    // so this settles the ask exactly as a bundle would - which is what makes no open
    // ask mean "everyone answered" rather than "nobody has yet".
    const holdsNothing = (m) => async (key, seq, id) => m.notePeerSeq(null, key, id);

    it('goes to the source once the peers are up and none of them had anything', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m, state } = load({ serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({ requestFrom: holdsNothing(m), aboveThreshold: () => true });

      await m.notePeerAvailable(PEER);

      expect(axiosGet.calledOnce, 'asked everyone, nobody had it - this is the first rollout').to.equal(true);
      expect(m.getSeq()).to.equal(7);
      expect(state.policyReady, 'the publisher answering is what confirms').to.equal(true);
      m.stop();
    });

    it('does not go to the source while the peer set is below the threshold', async () => {
      // THE CASE THAT USED TO GO TO GITHUB. The node has a peer, asked it, and got nothing
      // back - but one peer is not a peer set, and an empty store here says only that
      // peering is young. The old code read a count that was 0 below the threshold, could
      // not tell this from having nobody at all, and fetched.
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({ requestFrom: holdsNothing(m), aboveThreshold: () => false });

      await m.notePeerAvailable(PEER);

      expect(axiosGet.called, 'below the threshold, so it waits for more peers').to.equal(false);
      expect(m.getSeq()).to.equal(0);
      m.stop();
    });

    it('does not go to the source when a peer answered with a bundle', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({
        requestFrom: async (key) => { m.offerBundle(bundle(5), key); },
        aboveThreshold: () => true,
      });

      await m.notePeerAvailable(PEER);

      expect(axiosGet.called, 'it has policy, so there is nothing to seed').to.equal(false);
      expect(m.getSeq()).to.equal(5);
      m.stop();
    });

    it('does not go to the source for a node that restored a bundle', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const repo = {
        readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }),
        writeBundle: sinon.stub().resolves(true),
      };
      const { module: m } = load({ repo, serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({ requestFrom: holdsNothing(m), aboveThreshold: () => true });

      await m.notePeerAvailable(PEER);

      expect(axiosGet.called, 'a restored node needs no seed - peers and its own tick carry it').to.equal(false);
      expect(m.getSeq()).to.equal(4);
      m.stop();
    });

    // THE ORDERING THE EDGE COULD NOT GIVE US. Deciding on peerThresholdReached would read
    // the store at the moment the set filled - before the peer that filled it had answered,
    // and possibly before the ones behind it had. Hanging the decision on the LAST ask to
    // settle is what makes "nobody has policy" a statement about answers received.
    it('waits for every outstanding ask before deciding', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      await m.start();
      let releaseSlowPeer;
      m.setPeerTransport({
        aboveThreshold: () => true,
        requestFrom: async (key, seq, id) => {
          if (key === PEER) { m.notePeerSeq(null, key, id); return; }
          // the slow one: still in flight when the first peer's ask settles
          await new Promise((resolve) => { releaseSlowPeer = () => { m.offerBundle(bundle(5), key, id); resolve(); }; });
        },
      });

      const slow = m.notePeerAvailable(OTHER_PEER);
      await m.notePeerAvailable(PEER);
      expect(axiosGet.called, 'one ask is still outstanding, so nothing is settled yet').to.equal(false);

      releaseSlowPeer();
      await slow;

      expect(axiosGet.called, 'and it answered with a bundle, so the source was never needed').to.equal(false);
      expect(m.getSeq()).to.equal(5);
      m.stop();
    });

    it('seeds again after the peer set collapsed and rebuilt, with no latch to re-arm', async () => {
      // No retry timer, deliberately. The threshold accessor carries the hysteresis - set at
      // appSyncPeerThreshold, cleared below appSyncDegradedThreshold - so a node that lost
      // its peers and built them back asks the new ones, and the last of those answers with
      // the level true again.
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().rejects(new Error('github unreachable'));
      axiosGet.onSecondCall().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({ requestFrom: holdsNothing(m), aboveThreshold: () => true });

      await m.notePeerAvailable(PEER);
      expect(m.getSeq(), 'the source did not answer, so it still holds nothing').to.equal(0);

      await m.notePeerAvailable(OTHER_PEER);

      expect(axiosGet.callCount).to.equal(2);
      expect(m.getSeq()).to.equal(7);
      m.stop();
    });

    it('still decides when the ask itself could not be sent', async () => {
      // A send that throws deletes its entry like any other, so if it were the last one
      // outstanding and the decision sat after the try/finally, nothing would evaluate it -
      // and the node would hold nothing until another peer happened to arrive.
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({
        requestFrom: async () => { throw new Error('socket gone'); },
        aboveThreshold: () => true,
      });

      await m.notePeerAvailable(PEER);

      expect(axiosGet.calledOnce, 'the ask failed, which is still an answer of nothing').to.equal(true);
      expect(m.getSeq()).to.equal(7);
      m.stop();
    });

    it('does not act on a source that answers with bytes that do not verify', async () => {
      const axiosGet = sinon.stub().resolves({ data: '{"seq":7,"documents":{}}' });
      const { module: m, state } = load({ serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({ requestFrom: holdsNothing(m), aboveThreshold: () => true });

      await m.notePeerAvailable(PEER);

      expect(m.getSeq(), 'unsigned bytes are not the publisher answering').to.equal(0);
      expect(state.policyReady, 'and nothing about them confirms anything').to.equal(false);
      m.stop();
    });
  });

  describe('only a peer that speaks the protocol is asked', () => {
    const LEGACY = '10.0.0.1:16127';
    const SPEAKS = '10.0.0.2:16127';
    const answersNothing = (m) => async (key, seq, id) => m.notePeerSeq(null, key, id);

    it('does not put the question to a peer that has no handler for it', async () => {
      const { module: m } = load();
      const requestFrom = sinon.stub().resolves();
      await m.start();
      m.setPeerTransport({ capableKeys: () => [], requestFrom, aboveThreshold: () => false });

      await m.notePeerAvailable(LEGACY);

      expect(requestFrom.called, 'asking buys a deadline here and an unrecognised type in its log').to.equal(false);
      m.stop();
    });

    it('seeds from the source when NO peer speaks the protocol', async () => {
      // DAY ONE OF A ROLLOUT, and the case that decides the shape of this. An empty capable
      // set is nobody who could have said the network holds something, so the published
      // source is the only rung left.
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m, state } = load({ serviceHelper: { axiosGet } });
      const requestFrom = sinon.stub().resolves();
      await m.start();
      m.setPeerTransport({ capableKeys: () => [], requestFrom, aboveThreshold: () => true });

      await m.notePeerAvailable(LEGACY);

      expect(requestFrom.called, 'nobody was asked, because nobody could answer').to.equal(false);
      expect(axiosGet.calledOnce, 'and that is the network having nothing, not this node having asked nobody').to.equal(true);
      expect(m.getSeq()).to.equal(7);
      expect(state.policyReady).to.equal(true);
      m.stop();
    });

    it('still waits for the one peer that can answer while others arrive', async () => {
      // The mixed fleet. An arrival that could never answer must not read as the set having
      // been asked, or a node seeds past the neighbour that was about to hand it a bundle.
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      let answer;
      await m.start();
      m.setPeerTransport({
        capableKeys: () => [SPEAKS],
        requestFrom: (key, seq, id) => new Promise((resolve) => {
          answer = () => { m.notePeerSeq(null, key, id); resolve(); };
        }),
        aboveThreshold: () => true,
      });

      const asking = m.notePeerAvailable(SPEAKS);
      await m.notePeerAvailable(LEGACY);
      expect(axiosGet.called, 'the only peer that can answer has not').to.equal(false);

      answer();
      await asking;

      expect(axiosGet.calledOnce, 'and it held nothing, which is the whole set answering').to.equal(true);
      m.stop();
    });

    it('does not repeat the question to a peer that already answered on this connection', async () => {
      const { module: m } = load();
      const requestFrom = sinon.stub().callsFake(answersNothing(m));
      await m.start();
      m.setPeerTransport({ capableKeys: () => [SPEAKS], requestFrom, aboveThreshold: () => false });

      await m.notePeerAvailable(SPEAKS);
      await m.notePeerAvailable(SPEAKS);

      expect(requestFrom.callCount, 'one connection, one question').to.equal(1);
      m.stop();
    });

    it('the tick asks again, though that peer answered on arrival', async () => {
      // The retained answer is what the seed decision reads. It must not turn the periodic
      // refresh into a question asked once per connection.
      const { module: m } = load({ serviceHelper: { axiosGet: sinon.stub().rejects(new Error('offline')) } });
      const requestFrom = sinon.stub().callsFake(answersNothing(m));
      await m.start();
      m.setPeerTransport({ capableKeys: () => [SPEAKS], requestFrom, aboveThreshold: () => true });

      await m.notePeerAvailable(SPEAKS);
      expect(requestFrom.callCount).to.equal(1);

      await m.refresh();

      expect(requestFrom.callCount, 'the tick puts the question again').to.equal(2);
      m.stop();
    });
  });

  describe('the threshold is reached after the arrival that reached it', () => {
    const LEGACY = '10.0.0.4:16127';

    it('seeds on the level being written, not on the arrival that wrote it', async () => {
      // peerManager emits peerConnected and sets the latch on the next line, so the arrival
      // that takes the set over the threshold reads the level as false. A set that grows past
      // it is covered by the arrivals behind it; one that stops exactly there waits out the
      // backstop period holding nothing.
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      let above = false;
      await m.start();
      m.setPeerTransport({
        capableKeys: () => [],
        requestFrom: sinon.stub().resolves(),
        aboveThreshold: () => above,
      });

      await m.notePeerAvailable(LEGACY);
      expect(axiosGet.called, 'the level is not written yet, so there is nothing to act on').to.equal(false);

      above = true;
      await m.noteThresholdReached();

      expect(axiosGet.calledOnce, 'and the level being written is what decides it').to.equal(true);
      expect(m.getSeq()).to.equal(7);
      m.stop();
    });

    it('does nothing on a threshold reached by a node that already holds policy', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const repo = {
        readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }),
        writeBundle: sinon.stub().resolves(true),
      };
      const { module: m } = load({ repo, serviceHelper: { axiosGet } });
      await m.start();
      m.setPeerTransport({ capableKeys: () => [], requestFrom: sinon.stub().resolves(), aboveThreshold: () => true });

      await m.noteThresholdReached();

      expect(axiosGet.called, 'a restored node needs no seed').to.equal(false);
      expect(m.getSeq()).to.equal(4);
      m.stop();
    });
  });

  describe('a peer leaving', () => {
    const GOING = '10.0.0.3:16127';

    it('stops the decision waiting on an answer that is no longer coming', async () => {
      const axiosGet = sinon.stub().resolves({ data: bundle(7) });
      const { module: m } = load({ serviceHelper: { axiosGet } });
      let capable = [GOING];
      await m.start();
      m.setPeerTransport({
        capableKeys: () => capable,
        // Never answers, so only its departure can end the ask.
        requestFrom: () => new Promise(() => {}),
        aboveThreshold: () => true,
      });

      m.notePeerAvailable(GOING);
      await new Promise(setImmediate);
      expect(axiosGet.called, 'its ask is outstanding').to.equal(false);

      capable = [];
      await m.notePeerGone(GOING);

      expect(axiosGet.calledOnce, 'and it is gone, so nothing is waiting on it').to.equal(true);
      m.stop();
    });

    it('asks a peer again when it comes back', async () => {
      // A reconnect is peerDisconnected then peerConnected, and the question belongs to the
      // connection: a record is dropped with the socket that produced it.
      const { module: m } = load();
      const requestFrom = sinon.stub().callsFake(async (key, seq, id) => m.notePeerSeq(null, key, id));
      await m.start();
      m.setPeerTransport({ capableKeys: () => [GOING], requestFrom, aboveThreshold: () => false });

      await m.notePeerAvailable(GOING);
      await m.notePeerGone(GOING);
      await m.notePeerAvailable(GOING);

      expect(requestFrom.callCount, 'two connections, two questions').to.equal(2);
      m.stop();
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
      module.setPeerTransport({ capableKeys: () => CAPABLE, requestFrom: request, announce: sinon.stub().resolves(), aboveThreshold: () => false });

      await module.refresh();
      expect(request.called, 'nobody to ask, so it did not ask').to.equal(false);
      expect(delay.called, 'and it did not wait out the peer window').to.equal(false);
      expect(module.getSeq(), 'it went straight to the backstop').to.equal(2);
    });

    it('asks when peers exist', async () => {
      const request = sinon.stub().resolves();
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module } = load({ serviceHelper: { axiosGet } });
      module.setPeerTransport({ capableKeys: () => CAPABLE, requestFrom: request, announce: sinon.stub().resolves(), aboveThreshold: () => true });

      await module.refresh();
      expect(request.calledOnce, 'three peers, so it asked them').to.equal(true);
    });

    it('asks anyway when the transport cannot say how many there are', async () => {
      // Unknown is not zero. A transport wired without a count keeps the old behaviour
      // rather than silently losing the peer rung.
      const request = sinon.stub().resolves();
      const axiosGet = sinon.stub().resolves({ data: bundle(2) });
      const { module } = load({ serviceHelper: { axiosGet } });
      module.setPeerTransport({ capableKeys: () => CAPABLE, requestFrom: request, announce: sinon.stub().resolves() });

      await module.refresh();
      expect(request.calledOnce).to.equal(true);
    });
  });

  describe('a peer arriving', () => {
    // policyStore starts before discovery, so at boot the peer set is empty on every node.
    // Telling the store when a peer appears is what makes peers-first true at boot rather
    // than only at the tick.
    //
    // AN ARRIVAL ON ITS OWN MUST NEVER REACH THE SOURCE. It says something about that peer
    // and nothing about github, and it fires once per arrival on a node filling its peer
    // set - so a ladder run here would be a fetch per arrival, on every node, including a
    // fleet coming back from a release. The source is reached only through the seed, which
    // needs the whole set asked and answered first.

    it('asks the peer that arrived, whether or not it holds anything', async () => {
      const { module } = load();
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();
      expect(module.isReady(), 'boot obtained nothing').to.equal(false);

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'holding nothing is a reason to ask, not a reason to fetch').to.equal(1);
      expect(requestFrom.firstCall.args[0]).to.equal('198.18.0.11:16127');
    });

    it('asks each arriving peer while it holds nothing, and reaches the source for none of them', async () => {
      const axiosGet = sinon.stub().rejects(new Error('offline'));
      const { module } = load({ serviceHelper: { axiosGet } });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();
      const fetchesAtBoot = axiosGet.callCount;

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      module.notePeerAvailable('198.18.0.12:16127');
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'still nothing held, so still worth asking').to.equal(2);
      expect(axiosGet.callCount, 'and the source was not asked once').to.equal(fetchesAtBoot);
    });

    it('a RESTORED node asks the peer rather than the source', async () => {
      // This is the release wave. start() declines to fetch because the node restored
      // something - and then a peer connects seconds later. Running the ladder here made
      // every node in the fleet fetch anyway, moments after the guard that exists to stop
      // exactly that. The peer is the right thing to ask: it may hold something newer, and
      // if the whole fleet is equally stale the PHASED TICK is what breaks the tie, spread
      // across the period so that one node looks rather than all of them.
      const axiosGet = sinon.stub().resolves({ data: bundle(9) });
      const { module } = load({
        serviceHelper: { axiosGet },
        repo: { readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }), writeBundle: sinon.stub().resolves(true) },
      });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });
      await module.restore();
      expect(module.getSeq(), 'restored, so it holds something').to.equal(4);
      const fetchesBefore = axiosGet.callCount;

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'the arriving peer is asked').to.equal(1);
      expect(axiosGet.callCount, 'and the source is left to the tick').to.equal(fetchesBefore);
      module.stop();
    });

    it('a peer that has already confirmed it does not stop the next peer being asked', async () => {
      // The whole fleet restarted together: every node restores the same stale bundle and
      // every peer answers "not ahead", which is true and useless. That settles confirmation
      // in milliseconds, and it must not settle ASKING - a peer arriving later may be the one
      // that has moved on.
      const { module } = load({
        repo: { readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }), writeBundle: sinon.stub().resolves(true) },
      });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });
      await module.restore();
      module.notePeerSeq(4, '198.18.0.11:16127');

      module.notePeerAvailable('198.18.0.12:16127');
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'a level peer must not close the road to the next one').to.equal(1);
      expect(requestFrom.firstCall.args[0]).to.equal('198.18.0.12:16127');
      module.stop();
    });

    it('asks the peer that arrived, not the whole set', async () => {
      // A broadcast here would have to be rationed, and a rationed ask cannot serve a node
      // that is merely behind. Three capable peers and one arrival, so a fan-out is visible
      // as a count rather than having to be inferred.
      const { module } = load({ serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) } });
      const requestFrom = sinon.stub().resolves();
      const arriving = '198.18.0.11:16127';
      module.setPeerTransport({
        capableKeys: () => [arriving, '198.18.0.12:16127', '198.18.0.13:16127'],
        requestFrom,
        announce: sinon.stub().resolves(),
      });
      await module.start();
      module.stop();

      module.notePeerAvailable(arriving);
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'one targeted ask').to.equal(1);
      expect(requestFrom.firstCall.args[0], 'put to the peer that arrived').to.equal(arriving);
    });

    it('keeps asking as peers arrive, rather than once since boot', async () => {
      const { module } = load({ serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) } });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();

      module.notePeerAvailable('198.18.0.12:16127');
      await new Promise(setImmediate);
      module.notePeerAvailable('198.18.0.13:16127');
      await new Promise(setImmediate);

      expect(requestFrom.callCount, 'each arriving peer is asked').to.equal(2);
      expect(requestFrom.secondCall.args[0]).to.equal('198.18.0.13:16127');
    });

    it('settles a targeted ask on the answer, not on the clock', async () => {
      // Every peer answers - respondWithPolicy replies in all three states - so silence means
      // only "not there". A second ask while one is outstanding adds nothing; a peer that has
      // answered is askable again.
      const { module } = load({ serviceHelper: { axiosGet: sinon.stub().resolves({ data: bundle(4) }) } });
      let deliver;
      const requestFrom = sinon.stub().returns(new Promise((resolve) => { deliver = resolve; }));
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });
      await module.start();
      module.stop();

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      expect(requestFrom.callCount, 'one outstanding ask per peer').to.equal(1);

      deliver();
      await new Promise(setImmediate);
      module.notePeerSeq(4, '198.18.0.11:16127');
      await new Promise(setImmediate);

      module.notePeerAvailable('198.18.0.11:16127');
      await new Promise(setImmediate);
      expect(requestFrom.callCount, 'answered, so askable again').to.equal(2);
    });

    it('a burst of sixteen arriving peers reaches the source not once', async () => {
      // Sixteen peers connecting in a second must not become sixteen requests to the
      // published source. It used to become at least one, and on a node still holding
      // nothing, one per arrival. The boot fetch is allowed to fail and finish first, so what
      // is measured here is only what the peers caused.
      const axiosGet = sinon.stub().rejects(new Error('offline'));
      const { module } = load({ serviceHelper: { axiosGet } });
      const requestFrom = sinon.stub().resolves();
      module.setPeerTransport({ requestFrom, announce: sinon.stub().resolves() });

      await module.start();
      module.stop();
      expect(module.isReady(), 'boot obtained nothing').to.equal(false);
      const afterBoot = axiosGet.callCount;

      for (let i = 0; i < 16; i += 1) module.notePeerAvailable(`198.18.0.${i + 20}:16127`);
      await new Promise(setImmediate);
      await new Promise(setImmediate);

      expect(axiosGet.callCount - afterBoot, 'sixteen arrivals, no fetch').to.equal(0);
      expect(requestFrom.callCount, 'and all sixteen were asked directly').to.equal(16);
    });
  });
  describe('spreading a change', () => {
    it('announces a sequence it has adopted', async () => {
      const announce = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ ...answering((key, seq, id) => { m.offerBundle(bundle(6), key, id); }), announce });

      await m.refresh();

      expect(announce.calledOnceWithExactly(6)).to.equal(true);
    });

    it('announces on every adoption, so a change keeps moving outwards', async () => {
      const announce = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ ...holdingNothing(m), announce });

      m.offerBundle(bundle(6));
      m.offerBundle(bundle(7));

      expect(announce.args.map((a) => a[0])).to.deep.equal([6, 7]);
    });

    it('does not announce a bundle it refused', async () => {
      const announce = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ ...holdingNothing(m), announce });
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
      m.setPeerTransport({ ...holdingNothing(m), announce });

      m.offerBundle(bundle(6));

      expect(m.getSeq()).to.equal(6);
    });

    it('asks the peer that claimed a higher sequence, not the network', () => {
      // The claim itself is not checkable, so it is a prompt to ask - and the peer that
      // made it is the one to ask. What comes back is a signed bundle, which is checkable.
      const request = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ capableKeys: () => CAPABLE, requestFrom: request, announce: async () => {} });
      m.offerBundle(bundle(6));
      request.resetHistory();

      m.notePeerSeq(11, CAPABLE[0]);

      expect(request.calledOnce).to.equal(true);
      expect(request.firstCall.args[0], 'the author of the claim').to.equal(CAPABLE[0]);
      expect(request.firstCall.args[1], 'what this node holds').to.equal(6);
    });

    it('ignores a claim at or below what it holds, and a malformed one', () => {
      // A liar claiming 9999 costs one request; a liar claiming a number every second would
      // cost one per second, so the cheap checks happen before the ask.
      const request = sinon.stub().resolves();
      const { module: m } = load();
      m.setPeerTransport({ capableKeys: () => CAPABLE, requestFrom: request, announce: async () => {} });
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
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(10), key, id); }));
      await m.refresh();

      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(3), key, id); }));
      await m.refresh();

      expect(m.getSeq()).to.equal(10);
    });

    it('adopts a newer bundle', async () => {
      const { module: m } = load();
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(10), key, id); }));
      await m.refresh();
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(11), key, id); }));
      await m.refresh();

      expect(m.getSeq()).to.equal(11);
    });

    it('does not re-adopt the sequence it already holds', async () => {
      const { module: m, repo } = load();
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(10), key, id); }));
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
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(raw, key, id); }));
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
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(1, { blockedrepositories: ['x/y'], enterprisenodes: { pubA: ['ownerA'] } }), key, id); }));
      await m.refresh();

      expect(m.getDocument('blockedrepositories')).to.deep.equal(['x/y']);
      expect(m.getDocument('enterprisenodes')).to.deep.equal({ pubA: ['ownerA'] });
      expect(m.getDocument('somethingnew')).to.equal(null);
    });

    it('answers the artifact the bundle names', async () => {
      const { module: m } = load();
      m.setPeerTransport(answering((key, seq, id) => { m.offerBundle(bundle(3), key, id); }));
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
  // WHAT DEPENDS ON THE BUNDLE HAS TO BE TOLD IT ARRIVED.
  //
  // The bundle names the iplocation artifact, so ipLocationSync cannot act until one is
  // held - and it starts on dbReady, which is a fact about the app database and says
  // nothing about policy. Both chains hang off the peer threshold and nothing orders them,
  // so a consumer reading getArtifact at some moment of its own was reading a race.
  describe('telling the rest of the node the bundle changed', () => {
    const peerHands = (m, seq) => m.setPeerTransport(answering((key, _, id) => { m.offerBundle(bundle(seq), key, id); }));

    it('fires on adoption, naming the rung it came from', async () => {
      const seen = [];
      const { module: m } = load();
      m.onBundleChanged((change) => seen.push(change));
      peerHands(m, 5);

      await m.refresh();

      expect(seen).to.deep.equal([{ seq: 5, source: 'peer' }]);
      m.stop();
    });

    it('fires on a restore, because a bundle off disk is equally the one this node holds', async () => {
      // A consumer told only about adoption would be right on a cold node and wrong on
      // every restart - which is most boots.
      const seen = [];
      const { module: m } = load({
        repo: { readBundle: sinon.stub().resolves({ raw: bundle(4), seq: 4 }), writeBundle: sinon.stub().resolves(true) },
      });
      m.onBundleChanged((change) => seen.push(change));

      await m.start();

      expect(seen).to.deep.equal([{ seq: 4, source: 'disk' }]);
      m.stop();
    });

    it('does not fire for a bundle it refused', async () => {
      const seen = [];
      const { module: m } = load();
      m.onBundleChanged((change) => seen.push(change));

      m.offerBundle(bundle(5, undefined, OTHER.privateKey));
      m.offerBundle('not json');

      expect(seen, 'nothing was adopted, so nothing changed').to.deep.equal([]);
      m.stop();
    });

    it('fires again on every later adoption, so a consumer keeps up', async () => {
      const seen = [];
      const { module: m } = load();
      m.onBundleChanged((change) => seen.push(change.seq));

      m.offerBundle(bundle(5));
      m.offerBundle(bundle(6));
      m.offerBundle(bundle(6));

      expect(seen, 'twice, not three times - the repeat was not adopted').to.deep.equal([5, 6]);
      m.stop();
    });

    it('stops telling a listener that unsubscribed', async () => {
      const seen = [];
      const { module: m } = load();
      const off = m.onBundleChanged((change) => seen.push(change.seq));

      m.offerBundle(bundle(5));
      off();
      m.offerBundle(bundle(6));

      expect(seen).to.deep.equal([5]);
      m.stop();
    });

    it('adopts the bundle even when a listener throws', async () => {
      // Telemetry to its subscribers, not a step in adopting. A consumer failing must not
      // cost this node the bundle it has already verified.
      const { module: m, log } = load();
      m.onBundleChanged(() => { throw new Error('consumer blew up'); });

      m.offerBundle(bundle(5));

      expect(m.getSeq(), 'the bundle is held regardless').to.equal(5);
      expect(log.warn.calledWithMatch(/bundle listener threw/), 'and the failure is visible').to.equal(true);
      m.stop();
    });

    it('publishes the change to the harness event stream', async () => {
      const { module: m, eventBus } = load();
      m.offerBundle(bundle(5));

      const published = eventBus.publish.getCalls().filter((c) => c.args[0] === 'policy:bundleChanged');
      expect(published).to.have.lengthOf(1);
      expect(published[0].args[1]).to.deep.equal({ seq: 5, source: 'peer' });
      m.stop();
    });
  });

  describe('an answer settles the ask it names', () => {
    const PEER = '10.0.0.1:16127';
    // A reply carries no sender and no timestamp of its own, so before it named its ask the
    // only thing tying it to one was the socket it came back on. A reply arriving after its
    // own ask had timed out then settled whichever ask was outstanding next.
    //
    // The window has to be REAL here. The shared helper resolves delay() instantly, which
    // makes every ask settle on its window the moment it is made - and an assertion that the
    // ask is still outstanding then passes whatever the answer did.
    const withRealWindow = () => load({
      peerWindowMs: 10_000,
      serviceHelper: { delay: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) },
    });

    // Everything that can run without waiting on a real answer, runs. No wall clock: a
    // promise still pending after the queue drains is pending because it is waiting on
    // something, not because the test looked too soon.
    const drain = async () => {
      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setImmediate(resolve); });
      }
    };

    const settledWithin = (promise, ms) => Promise.race([
      promise.then(() => true),
      new Promise((resolve) => { setTimeout(() => resolve(false), ms); }),
    ]);

    it('names each ask, and ignores an answer naming a different one', async () => {
      const { module } = withRealWindow();
      // Every id this node sent. A claim above what it holds provokes a follow-up ask to
      // its author, which is a second question with a second id - so the ask being tested
      // is the first, not the latest.
      const named = [];
      module.setPeerTransport({
        requestFrom: async (_key, _seq, correlationId) => { named.push(correlationId); },
        aboveThreshold: () => true,
      });

      const inFlight = module.notePeerAvailable(PEER);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(named[0], 'the ask names itself').to.be.a('string');

      module.notePeerSeq(3, PEER, 'some-other-ask');
      expect(await settledWithin(inFlight, 30), 'an answer naming another ask ended this one')
        .to.equal(false);

      module.notePeerSeq(3, PEER, named[0]);
      expect(await settledWithin(inFlight, 200), 'the answer naming this ask left it waiting')
        .to.equal(true);
      module.stop();
    });

    it('waits on an ask already in flight rather than counting the peer as answered', async () => {
      // The fan-out has to come away with every capable peer's answer. Returning early on a
      // peer that already had an ask outstanding would count it as answered on the strength
      // of the question having been put, which is the property the old broadcast had.
      //
      // Read off the backstop rather than off a stopwatch: the rung below the peers is the
      // one thing that cannot have happened while an ask is still out.
      const axiosGet = sinon.stub().rejects(new Error('offline'));
      const { module } = load({ peerWindowMs: 10_000, serviceHelper: { axiosGet } });
      let named = null;
      module.setPeerTransport({
        capableKeys: () => [PEER],
        requestFrom: async (_key, _seq, correlationId) => { named = correlationId; },
        aboveThreshold: () => true,
      });

      const arrival = module.notePeerAvailable(PEER);
      await drain();

      const fanOut = module.refresh();
      await drain();
      expect(axiosGet.called, 'it went to the backstop with an ask still outstanding')
        .to.equal(false);

      module.notePeerSeq(null, PEER, named);
      await arrival;
      await fanOut;
      expect(axiosGet.called, 'and it went on once the peer had answered').to.equal(true);
      module.stop();
    });

    it('is not settled by a message that names nothing', async () => {
      // An adoption announcement carries no id, and that is not an oversight: it is what
      // keeps its content address identical across the nodes that adopted the same
      // sequence, which is what lets the flood filter collapse them into one. So whether
      // a given peer's announcement arrives at all depends on whether an unrelated peer
      // sent the same bytes first - and a fact about one peer cannot ride on that.
      const { module } = withRealWindow();
      module.setPeerTransport({ requestFrom: async () => {}, aboveThreshold: () => true });

      let settled = false;
      module.notePeerAvailable(PEER).then(() => { settled = true; });
      await drain();
      expect(settled, 'it settled before any answer arrived').to.equal(false);

      module.notePeerSeq(3, PEER);
      await drain();
      expect(settled, 'an announcement ended an ask it never answered').to.equal(false);
      module.stop();
    });
  });
});
