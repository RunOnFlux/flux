process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const axiosMock = { get: sinon.stub() };
const fluxCommunicationMock = { peerResponsiveness: sinon.stub() };

const { createPeerFolderLiveness } = proxyquire('../../ZelBack/src/services/appMonitoring/peerFolderLiveness', {
  axios: axiosMock,
  '../fluxCommunication': fluxCommunicationMock,
});

const holding = (folders) => ({ data: { data: { ready: true, folders } } });

describe('peerFolderLiveness', () => {
  beforeEach(() => {
    axiosMock.get.reset();
    axiosMock.get.resolves(holding([]));
    fluxCommunicationMock.peerResponsiveness.reset();
    fluxCommunicationMock.peerResponsiveness.returns({ responding: 8, total: 8 });
  });

  describe('one question per peer', () => {
    it('asks a peer once however many folders ask about it', async () => {
      // The defect this exists to remove: the same holder was asked once per
      // folder, and an unreachable one charged its full timeout every time.
      const liveness = createPeerFolderLiveness();

      await liveness.read('10.0.0.2:16127');
      await liveness.read('10.0.0.2:16127');
      await liveness.read('10.0.0.2:16127');

      sinon.assert.calledOnce(axiosMock.get);
    });

    it('gives every caller the same answer', async () => {
      const liveness = createPeerFolderLiveness();
      axiosMock.get.resolves(holding(['flux_app_one']));

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

      sinon.assert.calledOnce(axiosMock.get);
    });

    it('asks each distinct peer', async () => {
      const liveness = createPeerFolderLiveness();

      await liveness.read('10.0.0.2:16127');
      await liveness.read('10.0.0.3:16127');

      sinon.assert.calledTwice(axiosMock.get);
    });

    it('holds no answer across two views', async () => {
      // A view is one pass. Liveness carried into the next pass would report a
      // recovered holder as dead, or a dead one as serving.
      await createPeerFolderLiveness().read('10.0.0.2:16127');
      await createPeerFolderLiveness().read('10.0.0.2:16127');

      sinon.assert.calledTwice(axiosMock.get);
    });
  });

  describe('prewarm', () => {
    it('asks a whole set at once', async () => {
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127', '10.0.0.3:16127', '10.0.0.4:16127']);

      sinon.assert.calledThrice(axiosMock.get);
    });

    it('collapses a peer named more than once', async () => {
      // Two folders of one app share its holder list.
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127', '10.0.0.2:16127']);

      sinon.assert.calledOnce(axiosMock.get);
    });

    it('leaves nothing for a later read to ask again', async () => {
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127']);
      await liveness.read('10.0.0.2:16127');

      sinon.assert.calledOnce(axiosMock.get);
    });

    it('still answers a peer it was never given', async () => {
      // Prewarm is an optimisation, not the contract. A peer it did not cover
      // must still get a real answer rather than a silent default.
      const liveness = createPeerFolderLiveness();

      await liveness.prewarm(['10.0.0.2:16127']);
      const answer = await liveness.read('10.0.0.9:16127');

      expect(answer.reachable).to.be.true;
      sinon.assert.calledTwice(axiosMock.get);
    });
  });

  describe('what a peer answers', () => {
    it('reports a peer that does not answer as unreachable', async () => {
      axiosMock.get.rejects(new Error('connect ECONNREFUSED'));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({ reachable: false, ready: false, folders: [] });
    });

    it('passes through the folders a peer holds', async () => {
      axiosMock.get.resolves(holding(['flux_app_one', 'flux_app_two']));
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.folders).to.deep.equal(['flux_app_one', 'flux_app_two']);
    });

    it('does not take an unready peer\'s empty list as a clearance', async () => {
      // A peer that has not finished its first pass cannot tell "I hold nothing"
      // from "I have not looked".
      axiosMock.get.resolves({ data: { data: { ready: false, folders: [] } } });
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer.reachable).to.be.true;
      expect(answer.ready).to.be.false;
    });

    it('treats a malformed body as reachable but not ready', async () => {
      axiosMock.get.resolves({ data: {} });
      const liveness = createPeerFolderLiveness();

      const answer = await liveness.read('10.0.0.2:16127');

      expect(answer).to.deep.equal({ reachable: true, ready: false, folders: [] });
    });

    it('treats a non-array folder list as no folders', async () => {
      axiosMock.get.resolves({ data: { data: { ready: true, folders: 'flux_app_one' } } });
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
