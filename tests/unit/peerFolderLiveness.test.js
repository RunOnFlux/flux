process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { makePeerIdentityDouble } = require('./peerIdentityTestDouble');

const axiosMock = { get: sinon.stub(), post: sinon.stub() };
const fluxCommunicationMock = { peerResponsiveness: sinon.stub() };
const nodeSignerMock = { nodeSigner: sinon.stub() };
const peerIdentityMock = makePeerIdentityDouble({ post: axiosMock.post });

const { createPeerFolderLiveness } = proxyquire('../../ZelBack/src/services/appMonitoring/peerFolderLiveness', {
  axios: axiosMock,
  '../fluxCommunication': fluxCommunicationMock,
  '../utils/nodeSigner': nodeSignerMock,
  '../peerIdentityService': peerIdentityMock,
});

const holding = (folders) => ({ data: { data: { ready: true, folders } } });

// A probe is ONE request to a peer, whichever transport carried it: a node that can
// sign asks over the signed POST, and falls back to the open GET for a peer whose
// release has no such route. Counted together so these assertions stay about how many
// times a peer is asked, which is what they are for.
const probes = () => axiosMock.get.callCount + axiosMock.post.callCount;
// Both transports answer the same way, so a case about what a peer SAID does not also
// have to say how it was asked.
const answers = (value) => { axiosMock.get.resolves(value); axiosMock.post.resolves(value); };
const refuses = (error) => { axiosMock.get.rejects(error); axiosMock.post.rejects(error); };

describe('peerFolderLiveness', () => {
  beforeEach(() => {
    peerIdentityMock.reset();
    axiosMock.get.reset();
    answers(holding([]));
    axiosMock.post.reset();
    axiosMock.post.resolves(holding([]));
    nodeSignerMock.nodeSigner.reset();
    nodeSignerMock.nodeSigner.resolves({ pubKey: 'PUB', sign: () => 'SIG' });
    fluxCommunicationMock.peerResponsiveness.reset();
    fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
  });

  describe('a peer whose address another node answers', () => {
    it('is reachable, cannot be asked, and says so - and is not asked what it holds', async () => {
      peerIdentityMock.misrouted('10.0.0.2:16127', '10.0.0.7:16137');
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: true, answerable: false, misrouted: true, ready: false, folders: [], holding: {},
      });
      expect(probes(), 'what another node holds is not this peer\'s answer').to.equal(0);
    });

    it('asks a peer that proves who it is, as before', async () => {
      peerIdentityMock.verified('10.0.0.2:16127');
      answers(holding(['app1']));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.folders).to.deep.equal(['app1']);
      expect(answer.misrouted).to.equal(undefined);
    });

    it('asks for an answer signed as promoted folders, at the peer\'s own address', async () => {
      peerIdentityMock.verified('10.0.0.2:16127');
      const liveness = createPeerFolderLiveness();

      await liveness.read('10.0.0.2:16127');

      sinon.assert.calledOnceWithMatch(
        peerIdentityMock.askSigned,
        '10.0.0.2:16127',
        '/apps/promotedfolders',
        peerIdentityMock.AnswerPurpose.PROMOTED_FOLDERS,
      );
    });
  });

  // A peer that has proven who it is signs every answer. A reply from its address
  // that does not prove it came from it came from somewhere else - whatever this
  // node proved of that address before.
  describe('a reply that does not prove it came from the peer', () => {
    it('knows nothing of what a peer that can prove itself holds, and reads nothing unsigned', async () => {
      peerIdentityMock.verified('10.0.0.2:16127');
      peerIdentityMock.repliesUnsigned('10.0.0.2:16127');
      answers(holding([]));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: true, answerable: false, unproven: true, ready: false, folders: [], holding: {},
      });
      sinon.assert.notCalled(axiosMock.get);
    });

    it('reads an unproven reply of not-ready as not ready, which only blocks', async () => {
      peerIdentityMock.verified('10.0.0.2:16127');
      peerIdentityMock.repliesUnsigned('10.0.0.2:16127');
      axiosMock.post.rejects(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } }));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: true, answerable: true, ready: false, folders: [], holding: {},
      });
    });

    it('reads the unsigned reply of a peer that cannot prove who it is at all', async () => {
      answers(holding(['app1']));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.answerable).to.equal(true);
      expect(answer.folders).to.deep.equal(['app1']);
      sinon.assert.notCalled(axiosMock.get);
    });
  });

  // `holding` is the tenant's - a size and a last-write time per app - so a peer serves
  // it to a node that signs for it and to nobody else. Everything about how that is
  // asked has to degrade to the answer this endpoint gave before holdings existed,
  // because the release carrying the POST reaches the fleet one node at a time.
  describe('asking for what a peer holds', () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });

    it('signs the request for the one peer it is sent to, and for now', async () => {
      const liveness = createPeerFolderLiveness();
      const before = Date.now();

      await liveness.read('10.0.0.2:16127');

      sinon.assert.calledOnce(axiosMock.post);
      const [url, body] = axiosMock.post.firstCall.args;
      expect(url).to.equal('http://10.0.0.2:16127/apps/promotedfolders');
      expect(body.target, 'a body that names no recipient works on every node').to.equal('10.0.0.2:16127');
      expect(body.pubKey).to.equal('PUB');
      expect(body.signature).to.equal('SIG');
      expect(body.timestamp, 'a body that names no moment never expires').to.be.at.least(before);
      expect(body.challenge, 'a body that names no call can be replayed').to.match(/^c+$/);
    });

    // The peer verifies the signature over the body it receives, less the signature
    // itself - so the signed text has to be exactly that, challenge included.
    it('signs exactly the body it sends', async () => {
      const sign = sinon.stub().returns('SIG');
      nodeSignerMock.nodeSigner.resolves({ pubKey: 'PUB', sign });
      const liveness = createPeerFolderLiveness();

      await liveness.read('10.0.0.2:16127');

      const { signature, ...sent } = axiosMock.post.firstCall.args[1];
      expect(signature).to.equal('SIG');
      expect(sign.firstCall.args[0]).to.equal(JSON.stringify(sent));
    });

    it('asks a peer whose release has no such route over the open endpoint', async () => {
      axiosMock.post.rejects(notFound);
      axiosMock.get.resolves(holding(['flux_app_one']));

      const liveness = createPeerFolderLiveness();
      const answer = await liveness.read('10.0.0.2:16127');

      expect(probes(), 'the fallback costs one extra request, against old peers only').to.equal(2);
      expect(answer.answerable, 'a peer that answered the open endpoint is not unanswerable').to.equal(true);
      expect(answer.folders).to.deep.equal(['flux_app_one']);
      expect(answer.holding, 'an old peer claims nothing, which the address order expects').to.deep.equal({});
    });

    // 503 is the one status the fallback must not cover. A node still loading its
    // network state cannot say who anybody is, so it refuses at once instead of
    // parking the request - and what it is saying is "alive, ask me again", which the
    // promotion check blocks on. Answered over the open endpoint instead, it would
    // report syncthing's readiness, and a peer reads THAT as this node holding
    // nothing - a claim, where the node meant to defer.
    it('reads a peer still loading its network state as alive and not ready', async () => {
      const notReady = Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } });
      axiosMock.post.rejects(notReady);

      const liveness = createPeerFolderLiveness();
      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: true, answerable: true, ready: false, folders: [], holding: {},
      });
      sinon.assert.notCalled(axiosMock.get);
    });

    // The answer is signed whether or not the request is: the peer proves who it is
    // to anyone who asks, and withholds only `holding`.
    it('asks unsigned, for a signed answer, when this node cannot sign as itself', async () => {
      nodeSignerMock.nodeSigner.resolves(null);

      const liveness = createPeerFolderLiveness();
      await liveness.read('10.0.0.2:16127');

      sinon.assert.calledOnce(axiosMock.post);
      expect(Object.keys(axiosMock.post.firstCall.args[1]), 'nothing but the challenge').to.deep.equal(['challenge']);
      sinon.assert.notCalled(axiosMock.get);
    });

    it('asks unsigned, for a signed answer, when the signature cannot be produced', async () => {
      nodeSignerMock.nodeSigner.resolves({ pubKey: 'PUB', sign: () => null });

      const liveness = createPeerFolderLiveness();
      await liveness.read('10.0.0.2:16127');

      sinon.assert.calledOnce(axiosMock.post);
      expect(Object.keys(axiosMock.post.firstCall.args[1]), 'nothing but the challenge').to.deep.equal(['challenge']);
      sinon.assert.notCalled(axiosMock.get);
    });

    it('does not retry a peer that never answered at all', async () => {
      // No reply is a peer that may be gone, and asking twice charges its timeout
      // twice for an answer that was not withheld but absent.
      axiosMock.post.rejects(new Error('connect ECONNREFUSED'));

      const liveness = createPeerFolderLiveness();
      const answer = await liveness.read('10.0.0.2:16127');

      expect(probes()).to.equal(1);
      expect(answer.reachable).to.equal(false);
    });
  });

  describe('one question per peer', () => {
    it('asks a peer once however many folders ask about it', async () => {
      // The defect this exists to remove: the same holder was asked once per
      // folder, and an unreachable one charged its full timeout every time.
      const liveness = createPeerFolderLiveness();

      await liveness.read('10.0.0.2:16127');
      await liveness.read('10.0.0.2:16127');
      await liveness.read('10.0.0.2:16127');

      expect(probes()).to.equal(1);
    });

    it('gives every caller the same answer', async () => {
      const liveness = createPeerFolderLiveness();
      answers(holding(['flux_app_one']));

      const first = await liveness.read('10.0.0.2:16127');
      const second = await liveness.read('10.0.0.2:16127');

      expect(second).to.equal(first);
    });

    it('asks concurrent callers\' peer only once', async () => {
      // Both promotion decisions can reach the same peer in one folder's
      // processing. Sharing the in-flight request, not just the settled answer,
      // is what keeps that to one call.
      const liveness = createPeerFolderLiveness();

      await Promise.all([
        liveness.read('10.0.0.2:16127'),
        liveness.read('10.0.0.2:16127'),
      ]);

      expect(probes()).to.equal(1);
    });

    it('asks each distinct peer', async () => {
      const liveness = createPeerFolderLiveness();

      await liveness.read('10.0.0.2:16127');
      await liveness.read('10.0.0.3:16127');

      expect(probes()).to.equal(2);
    });

    it('holds no answer across two views', async () => {
      // A view is one pass. Liveness carried into the next pass would report a
      // recovered holder as dead, or a dead one as serving.
      await createPeerFolderLiveness().read('10.0.0.2:16127');
      await createPeerFolderLiveness().read('10.0.0.2:16127');

      expect(probes()).to.equal(2);
    });
  });

  describe('prewarm', () => {
    it('asks a whole set at once', async () => {
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127', '10.0.0.3:16127', '10.0.0.4:16127']);

      expect(probes()).to.equal(3);
    });

    it('collapses a peer named more than once', async () => {
      // Two folders of one app share its holder list.
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127', '10.0.0.2:16127']);

      expect(probes()).to.equal(1);
    });

    it('leaves nothing for a later read to ask again', async () => {
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127']);
      await liveness.read('10.0.0.2:16127');

      expect(probes()).to.equal(1);
    });

    it('still answers a peer it was never given', async () => {
      // Prewarm is an optimisation, not the contract. A peer it did not cover
      // must still get a real answer rather than a silent default.
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127']);
      const answer = await liveness.read('10.0.0.9:16127');

      expect(answer.reachable).to.be.true;
      expect(probes()).to.equal(2);
    });
  });

  describe('what a peer answers', () => {
    it('reports a peer that does not answer as unreachable', async () => {
      refuses(new Error('connect ECONNREFUSED'));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: false, answerable: false, ready: false, folders: [], holding: {},
      });
    });

    it('reports a peer that answers an error status as alive but unanswerable', async () => {
      // The endpoint is new, so every node not yet upgraded replies 404. A reply
      // is a reply: the peer is alive, and calling it dead drops a live holder
      // out of the election.
      const notFound = new Error('Request failed with status code 404');
      notFound.response = { status: 404 };
      refuses(notFound);
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: true, answerable: false, ready: false, folders: [], holding: {},
      });
    });

    it('reports a server error the same way - it answered, so it is alive', async () => {
      const serverError = new Error('Request failed with status code 500');
      serverError.response = { status: 500 };
      refuses(serverError);
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.reachable).to.be.true;
      expect(answer.answerable).to.be.false;
    });

    it('passes through the folders a peer holds', async () => {
      answers(holding(['flux_app_one', 'flux_app_two']));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.folders).to.deep.equal(['flux_app_one', 'flux_app_two']);
    });

    it('does not take an unready peer\'s empty list as a clearance', async () => {
      // A peer that has not finished its first pass cannot tell "I hold nothing"
      // from "I have not looked".
      answers({ data: { data: { ready: false, folders: [] } } });
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.reachable).to.be.true;
      expect(answer.ready).to.be.false;
    });

    it('treats a malformed body as reachable but not ready', async () => {
      answers({ data: {} });
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({
        reachable: true, answerable: true, ready: false, folders: [], holding: {},
      });
    });

    it('treats a non-array folder list as no folders', async () => {
      answers({ data: { data: { ready: true, folders: 'flux_app_one' } } });
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.folders).to.deep.equal([]);
    });
  });

  describe('this node\'s own connectivity', () => {
    it('decides once for the whole view', async () => {
      // Two folders in one pass must not reach opposite conclusions about whose
      // silence they are looking at.
      const liveness = createPeerFolderLiveness();

      liveness.localConnectivity();
      liveness.localConnectivity();
      liveness.localConnectivity();

      sinon.assert.calledOnce(fluxCommunicationMock.peerResponsiveness);
    });

    it('holds the same verdict even as the fleet moves under it', async () => {
      const liveness = createPeerFolderLiveness();
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });

      const first = liveness.localConnectivity();
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 8 });

      expect(liveness.localConnectivity()).to.deep.equal(first);
    });

    it('is connected while at least half its peers answer', async () => {
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 4, total: 8 });

      expect(createPeerFolderLiveness().localConnectivity().connected).to.be.true;
    });

    it('is cut off below half', async () => {
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 3, total: 8 });

      expect(createPeerFolderLiveness().localConnectivity().connected).to.be.false;
    });

    it('is cut off with no peers at all', async () => {
      // Having nobody to talk to is the isolation case, not evidence of health:
      // this node holds an app whose other holders exist.
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 0, total: 0 });

      expect(createPeerFolderLiveness().localConnectivity().connected).to.be.false;
    });

    it('carries the counts for the caller to report', async () => {
      fluxCommunicationMock.peerResponsiveness.returns({ responding: 2, total: 9 });

      expect(createPeerFolderLiveness().localConnectivity()).to.deep.equal({
        connected: false, responding: 2, total: 9,
      });
    });
  });
});
