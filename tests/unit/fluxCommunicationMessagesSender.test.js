/* eslint-disable no-underscore-dangle */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const WebSocket = require('ws');
const { FluxTTLCache } = require('../../ZelBack/src/services/utils/cacheManager');
const { PassThrough } = require('stream');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const messageVerifier = require('../../ZelBack/src/services/appMessaging/messageVerifier');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { PEER_SOURCE } = require('../../ZelBack/src/services/utils/FluxPeerSocket');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('fluxCommunicationMessagesSender tests', () => {
  describe('relay tests', () => {
    const generateWebsocket = (ip, port, readyState, source = { source: PEER_SOURCE.RANDOM }) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), source);
      ws.send.resetHistory();
      return ws;
    };

    beforeEach(() => {
      peerManager.reset();
    });

    afterEach(() => {
      sinon.restore();
    });

    // A message with null where the key and signature go is refused by every
    // peer without a word. Nothing goes on the wire, and the caller is told so
    // by the answer rather than by silence at the far end.
    it('broadcastMessageToAll relays nothing and answers null when this node cannot sign', async () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves(null);
      const ws1 = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN, { source: PEER_SOURCE.RANDOM });

      const answer = await fluxCommunicationMessagesSender.broadcastMessageToAll({ type: 'fluxapprunning' });

      expect(answer).to.equal(null);
      sinon.assert.notCalled(ws1.send);
    });

    it('should send data to all peers (both directions)', async () => {
      const data = 'test-message';
      const ws1 = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN, { source: PEER_SOURCE.RANDOM });
      const ws2 = generateWebsocket('127.0.0.2', 16127, WebSocket.OPEN, { source: PEER_SOURCE.INBOUND });

      await fluxCommunicationMessagesSender.relay(data);

      sinon.assert.calledOnceWithExactly(ws1.send, data);
      sinon.assert.calledOnceWithExactly(ws2.send, data);
    });

    it('should exclude a peer by key', async () => {
      const data = 'test-message';
      const ws1 = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN, { source: PEER_SOURCE.RANDOM });
      const ws2 = generateWebsocket('127.0.0.2', 16127, WebSocket.OPEN, { source: PEER_SOURCE.RANDOM });

      await fluxCommunicationMessagesSender.relay(data, '127.0.0.1:16127');

      sinon.assert.notCalled(ws1.send);
      sinon.assert.calledOnceWithExactly(ws2.send, data);
    });

    it('should close peer on send failure and continue to others', async () => {
      const data = 'test-message';
      const ws1 = generateWebsocket('127.0.0.1', 16127, WebSocket.CLOSED, { source: PEER_SOURCE.RANDOM });
      const ws2 = generateWebsocket('127.0.0.2', 16127, WebSocket.OPEN, { source: PEER_SOURCE.RANDOM });

      await fluxCommunicationMessagesSender.relay(data);

      sinon.assert.notCalled(ws1.send);
      sinon.assert.calledOnce(ws1.close);
      sinon.assert.calledOnceWithExactly(ws2.send, data);
    });
  });

  describe('serialiseAndSignFluxBroadcast tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('answers nothing when this node cannot sign as itself', async () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves(null);

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast({ title: 'message' });

      expect(signedData).to.equal(null);
    });

    it('should return serialised and signed message', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const expectedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).pubKey).to.eql(expectedPubKey);
      expect(JSON.parse(signedData).data).to.eql(data);
    });

    it('should return serialised and signed empty message', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const data = '';
      const expectedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).pubKey).to.eql(expectedPubKey);
      expect(JSON.parse(signedData).data).to.eql(data);
    });

    it('should fall back to zelnode private key config if empty', async () => {
      const mockedPrivKey = '5J2Hf3T8LpjKEkY46qhPLFF8DjQfCSBh6aWRfeDwQSMJKomvHFa';
      sinon.stub(daemonServiceUtils, 'getConfigValue').resolves(mockedPrivKey);
      const privateKey = ''; // falls back to 5J2Hf3T8LpjKEkY46qhPLFF8DjQfCSBh6aWRfeDwQSMJKomvHFa as thats in sample config.
      const data = '';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).data).to.eql(data);
      expect(JSON.parse(signedData).pubKey).to.eql('04e3f3c95621419fac3ffaaf4545b686469c6535b015c843ad6df9fc862df62b0cc55ce6e7be31dbd07d359626df860145789732fc2dc318afdd7605482da0549f');
    });
  });

  describe('getFluxMessageSignature tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return signature if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';

      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey);

      expect(signature).to.be.a('string');
    });

    it('Should properly return signature if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';
      const daemonStub = sinon.stub(daemonServiceUtils, 'getConfigValue').resolves(mockedPrivKey);

      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message);

      expect(signature).to.be.a('string');
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should answer nothing if private key is invalid', async () => {
      const privateKey = 'asdf';
      const message = 'testing1234';

      const result = await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey);

      expect(result).to.equal(null);
    });
  });

  describe('sendSignedMessage tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = () => {
      const ws = {};
      ws.send = sinon.stub().returns('okay');
      return ws;
    };
    beforeEach(() => {
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('sends nothing when this node cannot sign as itself', async () => {
      fluxNetworkHelperPublicKeyStub.returns(null);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.sendSignedMessage({ title: 'message' }, websocket);

      sinon.assert.notCalled(websocket.send);
    });

    it('should send a message to the given websocket if keys are accessible through config', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.sendSignedMessage(data, websocket);

      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
    });

    it('should send an empty message to the given websocket if keys are accessible through config', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = {};
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.sendSignedMessage(data, websocket);

      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
    });

    it('should use sendAsync when awaitDrain option is true', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = { title: 'test' };
      const websocket = generateWebsocket();
      websocket.sendAsync = sinon.stub().resolves(true);

      await fluxCommunicationMessagesSender.sendSignedMessage(data, websocket, { awaitDrain: true });

      sinon.assert.calledOnce(websocket.sendAsync);
      sinon.assert.notCalled(websocket.send);
    });

    it('should use send when awaitDrain option is not set', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = { title: 'test' };
      const websocket = generateWebsocket();
      websocket.sendAsync = sinon.stub().resolves(true);

      await fluxCommunicationMessagesSender.sendSignedMessage(data, websocket);

      sinon.assert.calledOnce(websocket.send);
      sinon.assert.notCalled(websocket.sendAsync);
    });
  });

  // An empty response and a complete one are the same three fields, so a
  // booting node's nothing counted as one of the three surveys the asker needs.
  // A node that does not know yet says so instead, decided at the moment of
  // asking so there is nothing cached to go stale.
  describe('a node that is not authoritative declines a sync request', () => {
    let wasAuthoritative;
    let peer;
    let findStub;

    const sent = () => peer.sendAsync.getCalls().map((c) => JSON.parse(c.args[0]).data);

    beforeEach(() => {
      wasAuthoritative = globalState.appStateAuthoritative;
      peer = { key: '198.51.100.9:16127', sendAsync: sinon.stub().resolves(), send: sinon.stub(), remoteClockOffsetMs: 0 };
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      findStub = sinon.stub().returns({ sort: () => [] });
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({ collection: () => ({ find: findStub }) }) });
    });

    afterEach(() => {
      sinon.restore();
      globalState.appStateAuthoritative = wasAuthoritative;
    });

    // The temp stream is in this list for the same reason the other three are:
    // a node that cannot say what the network holds cannot say what it is
    // PENDING either, and a short set of registrations is as misleading as a
    // short list of running apps.
    // The temp stream carries a payload `version` on the wire and the other
    // three do not, so each responder brings the rest of its own envelope. The
    // assertions below stay exact rather than loosening to accommodate it.
    const responders = [
      ['respondWithAppRunningMessages', 'fluxapprunningsync', {}],
      ['respondWithAppInstallingMessages', 'fluxappinstallingsync', {}],
      ['respondWithAppInstallingErrorsMessages', 'fluxappinstallingerrorssync', {}],
      ['respondWithTempMessages', 'fluxapptempsync', { version: 1 }],
    ];

    responders.forEach(([fn, wireType, envelope]) => {
      it(`${fn} refuses and reads nothing from the store`, async () => {
        globalState.appStateAuthoritative = false;

        await fluxCommunicationMessagesSender[fn](peer, 0);

        expect(sent()).to.deep.equal([{
          type: wireType, ...envelope, messages: [], done: true, refused: true,
        }]);
        expect(findStub.called, 'a refusing node still queried its own store').to.equal(false);
      });

      // THE TRAP. A network with nothing running legitimately answers with an
      // empty list, and if that reads as a refusal such a fleet never syncs at
      // all. Absent is not false here - the field must not be sent.
      it(`${fn} answers an empty store without refusing`, async () => {
        globalState.appStateAuthoritative = true;

        await fluxCommunicationMessagesSender[fn](peer, 0);

        const messages = sent();
        expect(messages).to.have.lengthOf(1);
        expect(messages[0]).to.deep.equal({
          type: wireType, ...envelope, messages: [], done: true,
        });
        expect(messages[0]).to.not.have.property('refused');
      });
    });
  });

  // The peer half of policy distribution. A node that adopts a sequence tells its peers; a
  // peer that is behind asks for the bundle. Both directions are here because neither had any
  // coverage and they are the point of the whole exercise.
  describe('policy messages', () => {
    const KEY = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const PRIV = 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD';
    let policyStore;

    function makePeer() {
      return { send: sinon.stub().returns('okay') };
    }

    function sentTypes(peer) {
      return peer.send.getCalls().map((c) => JSON.parse(c.args[0]).data.type);
    }

    beforeEach(() => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').returns(KEY);
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').returns(PRIV);
      // eslint-disable-next-line global-require
      policyStore = require('../../ZelBack/src/services/policyStore');
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('respondWithPolicy', () => {
      it('sends the bundle when this node holds something newer', async () => {
        sinon.stub(policyStore, 'getSeq').returns(9);
        sinon.stub(policyStore, 'getRawBundle').returns('{"payload_b64":"x","sig_b64":"y"}');
        const peer = makePeer();

        await fluxCommunicationMessagesSender.respondWithPolicy(
          { data: { type: 'fluxpolicyrequest', version: 1, seq: 4 } }, peer,
        );

        expect(sentTypes(peer)).to.deep.equal(['fluxpolicy']);
        expect(JSON.parse(peer.send.firstCall.args[0]).data.bundle).to.equal('{"payload_b64":"x","sig_b64":"y"}');
      });

      it('answers with its sequence when it holds no more than the asker', async () => {
        // It used to say nothing, on the grounds that "I have nothing newer" is a claim
        // the asker cannot check. Still uncheckable, and still grants nothing - but
        // silence cannot distinguish "my peers agree I am current" from "my peers are
        // asleep", and a node that restored a bundle from disk needs exactly that
        // difference before it acts on it.
        sinon.stub(policyStore, 'getSeq').returns(4);
        sinon.stub(policyStore, 'getRawBundle').returns('{}');
        const peer = makePeer();

        await fluxCommunicationMessagesSender.respondWithPolicy(
          { data: { type: 'fluxpolicyrequest', version: 1, seq: 4 } }, peer,
        );
        await fluxCommunicationMessagesSender.respondWithPolicy(
          { data: { type: 'fluxpolicyrequest', version: 1, seq: 9 } }, peer,
        );

        expect(peer.send.callCount, 'both asks answered').to.equal(2);
        for (const call of peer.send.getCalls()) {
          const sent = JSON.parse(call.args[0]);
          expect(sent.data.type, 'a sequence, never the bundle').to.equal('fluxpolicyseq');
          expect(sent.data.seq).to.equal(4);
        }
      });

      it('answers null when it holds no bundle at all, rather than saying nothing', async () => {
        // Three states the asker has to tell apart: a peer with policy, a peer with none,
        // and a peer that is not there. Answering 0 would be read as "you are not behind
        // me" and taken for agreement; answering nothing is indistinguishable from being
        // absent. null is the third answer.
        sinon.stub(policyStore, 'getSeq').returns(0);
        sinon.stub(policyStore, 'getRawBundle').returns(null);
        const peer = makePeer();

        await fluxCommunicationMessagesSender.respondWithPolicy(
          { data: { type: 'fluxpolicyrequest', version: 1, seq: 5 } }, peer,
        );

        expect(peer.send.calledOnce, 'it answered').to.equal(true);
        const sent = JSON.parse(peer.send.firstCall.args[0]);
        expect(sent.data.type).to.equal('fluxpolicyseq');
        expect(sent.data.seq, 'no policy, and it says so').to.equal(null);
      });

      it('treats a missing sequence as zero rather than refusing to answer', async () => {
        // A node asking before it has anything sends seq 0; a malformed one may send none.
        sinon.stub(policyStore, 'getSeq').returns(3);
        sinon.stub(policyStore, 'getRawBundle').returns('{"a":1}');
        const peer = makePeer();

        await fluxCommunicationMessagesSender.respondWithPolicy(
          { data: { type: 'fluxpolicyrequest', version: 1 } }, peer,
        );

        expect(sentTypes(peer)).to.deep.equal(['fluxpolicy']);
      });

      it('ignores a version it does not know', async () => {
        sinon.stub(policyStore, 'getSeq').returns(9);
        sinon.stub(policyStore, 'getRawBundle').returns('{"a":1}');
        const peer = makePeer();

        await fluxCommunicationMessagesSender.respondWithPolicy(
          { data: { type: 'fluxpolicyrequest', version: 2, seq: 0 } }, peer,
        );

        expect(peer.send.called).to.equal(false);
      });

      it('does not throw on a message with no data', async () => {
        const peer = makePeer();
        await fluxCommunicationMessagesSender.respondWithPolicy({}, peer);
        expect(peer.send.called).to.equal(false);
      });
    });

    // These call the functions, rather than asserting what serialiseAndSignFluxBroadcast does
    // with a hand-built message. A test that never invokes the function under test passes
    // whatever that function does, including nothing.
    describe('what actually goes on the wire', () => {
      function connectedPeer() {
        const ws = {
          ip: '127.0.0.1',
          port: '16127',
          readyState: WebSocket.OPEN,
          ping: sinon.stub(),
          send: sinon.stub().returns('okay'),
          on: sinon.stub(),
          close: sinon.stub(),
          _socket: { remoteAddress: '127.0.0.1' },
        };
        peerManager.add(ws, '127.0.0.1', '16127', { source: PEER_SOURCE.RANDOM });
        ws.send.resetHistory();
        return ws;
      }

      beforeEach(() => peerManager.reset());

      it('announcePolicySeq sends the sequence to peers, and NOT the bundle', async () => {
        // A peer cannot check a claim about a number, so it is a prompt to ask rather than
        // something to believe. Attaching the bundle would push megabytes at every peer on
        // every policy change, unasked.
        const ws = connectedPeer();

        await fluxCommunicationMessagesSender.announcePolicySeq(12);

        expect(ws.send.calledOnce).to.equal(true);
        const { data } = JSON.parse(ws.send.firstCall.args[0]);
        expect(data).to.deep.equal({ type: 'fluxpolicyseq', version: 1, seq: 12 });
        expect(data.bundle).to.equal(undefined);
      });

      it('requestPolicyFromPeers sends the sequence this node holds', async () => {
        const ws = connectedPeer();

        await fluxCommunicationMessagesSender.requestPolicyFromPeers(7);

        expect(ws.send.calledOnce).to.equal(true);
        expect(JSON.parse(ws.send.firstCall.args[0]).data)
          .to.deep.equal({ type: 'fluxpolicyrequest', version: 1, seq: 7 });
      });
    });
  });

  describe('respondWithAppMessage tests', () => {
    const generateWebsocket = () => {
      const ws = {};
      ws.send = sinon.stub().returns('okay');
      return ws;
    };
    let message;

    beforeEach(async () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').returns('KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD');
      const privateKey = 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD';
      const ownerAddress = '13ienDRfUwFEgfZxm5dk4drTQsmj5hDGwL';
      const appSpecifications = {
        name: 'website',
        commands: [
          '--chain',
          'kusama',
        ],
        containerData: '/chaindata',
        cpu: 0.8,
        description: 'This is my test app',
        domains: [
          'testing.runonflux.io',
          'testing.runonflux.io',
          'testing.runonflux.io',
        ],
        enviromentParameters: [],
        hdd: 20,
        owner: ownerAddress,
        ram: 1800,
        repotag: 'yurinnick/folding-at-home:latest',
        tiered: false,
        containerPorts: [
          '30333',
          '9933',
          '9944',
        ],
        ports: [
          '31113',
          '31112',
          '31111',
        ],
        version: 2,
      };
      const type = 'fluxappregister';
      const version = 1;
      const timestamp = 1592988806887;
      const messageToSign = type + version + JSON.stringify(appSpecifications) + timestamp;
      const signature = verificationHelper.signMessage(messageToSign, privateKey);
      const messageToHash = type + version + JSON.stringify(appSpecifications) + timestamp + signature;
      const hash = await generalService.messageHash(messageToHash);
      message = {
        type,
        version,
        appSpecifications,
        timestamp,
        signature,
        hash,
        arcaneSender: false,
      };
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should return error if message version is not supported', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hash: 'test1',
          version: 3,
        },
      };
      const lruHas = sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
      const websocket = generateWebsocket();
      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);
      sinon.assert.notCalled(lruHas);
    });

    it('should return error if message version is 1 and hash is not a string', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hash: 312313,
          version: 1,
        },
      };
      const lruHas = sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
      const websocket = generateWebsocket();
      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);
      sinon.assert.notCalled(lruHas);
    });

    it('should return error if message version is 2 and hashes is not an array', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hashes: 312313,
          version: 2,
        },
      };
      const lruHas = sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
      const websocket = generateWebsocket();
      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);
      sinon.assert.notCalled(lruHas);
    });

    it('should respond with app message that exists in permanent storage but is not located in cache', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hash: 'test1',
          version: 1,
        },
      };
      const checkAppMessageExistenceStub = sinon.stub(messageVerifier, 'checkAppMessageExistence').returns(message);
      sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
      const myMessageCacheSetStub = sinon.stub(FluxTTLCache.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.calledOnceWithExactly(myMessageCacheSetStub, callMessage.data.hash, message);
      sinon.assert.calledOnceWithExactly(checkAppMessageExistenceStub, callMessage.data.hash);
    });

    it('should respond with app message that exists in temp storage but is not located in cache or perm storage', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hash: 'test1',
          version: 1,
        },
      };
      const checkAppMessageExistenceStub = sinon.stub(messageVerifier, 'checkAppMessageExistence').returns(undefined);
      const checkAppTemporaryMessageExistenceStub = sinon.stub(messageVerifier, 'checkAppTemporaryMessageExistence').returns(message);
      sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
      const myMessageCacheSetStub = sinon.stub(FluxTTLCache.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.calledOnceWithExactly(myMessageCacheSetStub, callMessage.data.hash, message);
      sinon.assert.calledOnceWithExactly(checkAppMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(checkAppTemporaryMessageExistenceStub, callMessage.data.hash);
    });

    it('should do nothing if the message does not exist', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hash: 'test1',
          version: 1,
        },
      };
      const sendSignedMessageStub = sinon.stub(fluxCommunicationMessagesSender, 'sendSignedMessage').returns(undefined);
      const checkAppMessageExistenceStub = sinon.stub(messageVerifier, 'checkAppMessageExistence').returns(undefined);
      const checkAppTemporaryMessageExistenceStub = sinon.stub(messageVerifier, 'checkAppTemporaryMessageExistence').returns(undefined);
      sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
      const myMessageCacheSetStub = sinon.stub(FluxTTLCache.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.notCalled(sendSignedMessageStub);
      sinon.assert.calledOnceWithExactly(checkAppMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(checkAppTemporaryMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(myMessageCacheSetStub, callMessage.data.hash, null);
    });

    it('should respond with app message that is located in cache', async () => {
      const callMessage = {
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprequest',
          hash: 'test1',
          version: 1,
        },
      };
      const checkAppMessageExistenceSpy = sinon.spy(messageVerifier, 'checkAppMessageExistence');
      const myMessageCacheGetStub = sinon.stub(FluxTTLCache.prototype, 'get').returns(message);
      const myMessageCacheSetStub = sinon.stub(FluxTTLCache.prototype, 'set').returns(undefined);
      sinon.stub(FluxTTLCache.prototype, 'has').returns(true);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.notCalled(myMessageCacheSetStub);
      sinon.assert.notCalled(checkAppMessageExistenceSpy);
      sinon.assert.calledOnceWithExactly(myMessageCacheGetStub, callMessage.data.hash);
    });
  });

  describe('broadcastMessageToOutgoingFromUser tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.RANDOM });
      ws.send.resetHistory();
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if no data is passed', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          test: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageToIncomingFromUser tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.INBOUND });
      ws.send.resetHistory();
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if no data is passed', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          test: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageFromUser tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateIncomingWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.INBOUND });
      ws.send.resetHistory();
      return ws;
    };
    const generateOutgoingWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.RANDOM });
      ws.send.resetHistory();
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should not broadcast message if no data is passed', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          test: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });
  });

  describe('broadcastMessageToOutgoingFromUserPost tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.RANDOM });
      ws.send.resetHistory();
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(fluxNetworkHelper, 'closeConnection').returns(true);
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);

      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if the data is empty', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      const mockStream = new PassThrough();
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageToIncomingFromUserPost tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.INBOUND });
      ws.send.resetHistory();
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(fluxNetworkHelper, 'closeConnection').returns(true);
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);

      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if the data is empty', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      const mockStream = new PassThrough();
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageFromUserPost tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateIncomingWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.INBOUND });
      ws.send.resetHistory();
      return ws;
    };
    const generateOutgoingWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.RANDOM });
      ws.send.resetHistory();
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(fluxNetworkHelper, 'closeConnection').returns(true);
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should not broadcast message if the data is empty', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      const mockStream = new PassThrough();
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', 16127, WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await new Promise((resolve) => { setTimeout(resolve, 150); });

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });
  });

  describe('broadcastTemporaryAppMessage tests', () => {
    const generateOutgoingWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.RANDOM });
      ws.send.resetHistory();
      return ws;
    };
    const generateIncomingWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws.close = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.INBOUND });
      ws.send.resetHistory();
      return ws;
    };

    beforeEach(() => {
      peerManager.reset();
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send a message to incoming and outgoing connections when app message is properly formatted', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'fluxapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);

      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/type/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/fluxapp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/appSpecifications/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/specs/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/some specs/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/some specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/hash/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/12346789asdfghj/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature12345/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/type/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/fluxapp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/appSpecifications/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/specs/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/some specs/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/some specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/hash/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/12346789asdfghj/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature12345/gm));
    });

    it('should throw an error if the message is not an object', async () => {
      const temporaryAppMessage = 'test';
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.type is not a string', async () => {
      const temporaryAppMessage = {
        type: 1,
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.version is not a number', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'fluxapp',
        version: '3',
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.appSpecifications is not an object', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'fluxapp',
        version: 3,
        appSpecifications: 'test',
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.hash is not a string', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'fluxapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: 2,
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.timestamp is not a number', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'fluxapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: 'testestest',
        timestamp: '168732333',
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.singature is not a string', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'fluxapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: 2,
        timestamp: 168732333,
        signature: 2,
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', 16127, WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', 16127, WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });
  });
});
