const EventEmitter = require('node:events');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const config = require('config');
const proxyquire = require('proxyquire').noCallThru();

const { peerManager: realPeerManager } = require('../../ZelBack/src/services/utils/peerState');
const fluxBroadcastHelper = require('../../ZelBack/src/services/utils/fluxBroadcastHelper');
const unpaidAdmission = require('../../ZelBack/src/services/appMessaging/unpaidAdmission');
const temporaryMessageRecord = require('../../ZelBack/src/services/appMessaging/temporaryMessageRecord');

chai.use(chaiAsPromised);
const { expect } = chai;

const HASH = 'a'.repeat(64);
const MESSAGE = {
  type: 'fluxappregister', version: 1, appSpecifications: { name: 'App' }, hash: HASH, timestamp: 1, signature: 's',
};
const SIGNED = JSON.stringify({
  version: 1, timestamp: 2, pubKey: 'entryKey', signature: 'frameSig', data: MESSAGE,
});

let nextConnectionId = 1;
function makePeer(ip, { latency = null, sendOk = true, port = '16127' } = {}) {
  const peer = {
    ip, port, key: `${ip}:${port}`, connectionId: nextConnectionId, latency, sent: [],
  };
  nextConnectionId += 1;
  peer.send = (frame) => {
    peer.sent.push(JSON.parse(frame));
    return sendOk;
  };
  return peer;
}

function load() {
  const peerManager = new EventEmitter();
  peerManager.authenticated = [];
  peerManager.unauthenticated = [];
  peerManager.getAuthenticatedPeers = () => peerManager.authenticated;
  peerManager.getUnauthenticatedPeers = () => peerManager.unauthenticated;
  peerManager.authenticatedIpCount = () => new Set(peerManager.authenticated.map((p) => p.ip)).size;
  const release = sinon.stub();
  const deps = {
    sign: sinon.stub().resolves(SIGNED),
    release,
    admitUnpaid: sinon.stub().resolves({ fields: { clientTag: 't', originKey: 'entryKey' }, release }),
    // the version floor is a release that tags, unless a test says otherwise
    untaggedRefused: sinon.stub().returns(true),
    insert: sinon.stub().resolves(),
    holds: sinon.stub().resolves(false),
    publish: sinon.stub(),
  };
  const mod = proxyquire('../../ZelBack/src/services/appMessaging/admissionQuorum', {
    '../utils/peerState': { peerManager },
    '../utils/fluxBroadcastHelper': { serialiseAndSignFluxBroadcast: deps.sign },
    '../utils/fluxEventBus': { publish: deps.publish },
    './unpaidAdmission': { admitUnpaid: deps.admitUnpaid, untaggedRefused: deps.untaggedRefused },
    './temporaryMessageRecord': { insertTemporaryMessage: deps.insert, holdsTemporaryMessage: deps.holds },
  });
  return { mod, peerManager, deps };
}

const proposalsTo = (peer) => peer.sent.filter((m) => m.type === 'appproposal');
const commitsTo = (peer) => peer.sent.filter((m) => m.type === 'appcommit');
const receiptsTo = (peer) => peer.sent.filter((m) => m.type === 'appreceipt');
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
};

describe('admissionQuorum tests', () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    process.env.FLUXOS_PATH = '/dat/usr/lib/fluxos';
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
    delete process.env.FLUXOS_PATH;
  });

  it('should stub only names the real modules export', () => {
    expect(realPeerManager.getAuthenticatedPeers).to.be.a('function');
    expect(realPeerManager.getUnauthenticatedPeers).to.be.a('function');
    expect(realPeerManager.authenticatedIpCount).to.be.a('function');
    expect(fluxBroadcastHelper.serialiseAndSignFluxBroadcast).to.be.a('function');
    expect(unpaidAdmission.admitUnpaid).to.be.a('function');
    expect(unpaidAdmission.untaggedRefused).to.be.a('function');
    expect(temporaryMessageRecord.insertTemporaryMessage).to.be.a('function');
    expect(temporaryMessageRecord.holdsTemporaryMessage).to.be.a('function');
  });

  describe('the entry node', () => {
    function withPeers(ips, options) {
      const loaded = load();
      loaded.peerManager.authenticated = ips.map((ip) => makePeer(ip, options));
      return loaded;
    }

    // Resolves once the proposals are out, with the admission still pending.
    async function startAdmit(mod) {
      const admission = mod.admit(MESSAGE, { daemonHeight: 100 });
      admission.catch(() => {});
      await flush();
      return { admission };
    }

    function receipt(mod, peer, state, reason) {
      mod.onReceipt(peer, {
        type: 'appreceipt', hash: HASH, state, reason,
      });
    }

    it('should refuse at the door below the quorum of authenticated IPs', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2']);
      expect(() => mod.requireQuorum()).to.throw(mod.AdmissionUnavailableError);
      await expect(mod.admit(MESSAGE, { daemonHeight: 100 })).to.be.rejectedWith('holds authenticated links to 2 of the 3');
      expect(deps.sign.called).to.equal(false);
      peerManager.authenticated.forEach((peer) => expect(peer.sent).to.have.length(0));
    });

    it('should refuse at the door, whatever its links, on a node that is not ArcaneOS', async () => {
      delete process.env.FLUXOS_PATH;
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']);
      expect(() => mod.requireQuorum()).to.throw(mod.AdmissionNotSupportedError);
      await expect(mod.admit(MESSAGE, { daemonHeight: 100 })).to.be.rejectedWith('only ArcaneOS nodes do');
      expect(deps.sign.called).to.equal(false);
      peerManager.authenticated.forEach((peer) => expect(peer.sent).to.have.length(0));
    });

    describe('below the quorum, until the version floor is a release that tags', () => {
      // as the door builds it (unpaidAdmission.admittedMessage)
      const UNTAGGED = { ...MESSAGE, arcaneSender: true };
      const TAGGED = { ...UNTAGGED, clientTag: 'c'.repeat(64), clientTagHeight: 100 };

      it('should let the request through the door', () => {
        const { mod, deps } = withPeers(['10.0.0.1']);
        deps.untaggedRefused.returns(false);

        expect(mod.requireQuorum()).to.equal(false);
      });

      it('should write the message without its tag and send it to every peer, proposing it to none', async () => {
        const { mod, peerManager, deps } = withPeers(['10.0.0.1']);
        deps.untaggedRefused.returns(false);
        deps.admitUnpaid.resolves({ fields: {} });
        const legacy = makePeer('10.0.9.9');
        peerManager.unauthenticated = [legacy];

        await mod.admit(TAGGED, { daemonHeight: 100 });

        const [signedMessage] = deps.sign.firstCall.args;
        expect(signedMessage).to.eql(UNTAGGED);
        sinon.assert.calledOnceWithExactly(deps.insert, UNTAGGED, {});
        [...peerManager.authenticated, legacy].forEach((peer) => {
          expect(peer.sent).to.eql([JSON.parse(SIGNED)]);
          expect(proposalsTo(peer)).to.have.length(0);
        });
      });

      it('should write nothing and send nothing when the message is refused', async () => {
        const { mod, peerManager, deps } = withPeers(['10.0.0.1']);
        deps.untaggedRefused.returns(false);
        deps.admitUnpaid.resolves({ refused: 'a reason' });

        await expect(mod.admit(TAGGED, { daemonHeight: 100 })).to.be.rejectedWith('a reason');
        sinon.assert.notCalled(deps.insert);
        peerManager.authenticated.forEach((peer) => expect(peer.sent).to.have.length(0));
      });

      it('should run the round once it holds the quorum', async () => {
        const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
        deps.untaggedRefused.returns(false);

        mod.admit(TAGGED, { daemonHeight: 100 }).catch(() => {});
        await flush();

        peerManager.authenticated.forEach((peer) => expect(proposalsTo(peer)).to.have.length(1));
      });
    });

    it('should count two links to one IP once at the door', () => {
      const { mod } = withPeers(['10.0.0.1', '10.0.0.1', '10.0.0.2']);
      expect(() => mod.requireQuorum()).to.throw(mod.AdmissionUnavailableError);
    });

    it('should commit, store and send on, once peers on the quorum of IPs hold it', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']);
      const legacy = makePeer('10.0.9.9');
      peerManager.unauthenticated = [legacy];
      const { admission } = await startAdmit(mod);
      const [a, b, c, d] = peerManager.authenticated;
      expect(proposalsTo(a)[0].envelope).to.eql(JSON.parse(SIGNED));

      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      await flush();
      expect(deps.insert.called).to.equal(false);
      expect(commitsTo(a)).to.have.length(0);
      receipt(mod, c, 'held');
      await admission;

      [a, b, c, d].forEach((peer) => expect(commitsTo(peer)).to.eql([{ type: 'appcommit', hash: HASH }]));
      sinon.assert.calledOnceWithExactly(deps.insert, MESSAGE, { clientTag: 't', originKey: 'entryKey' });
      expect(legacy.sent).to.eql([JSON.parse(SIGNED)]);
      expect(proposalsTo(legacy)).to.have.length(0);
    });

    it('should take the origin from the frame it proposes', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      peerManager.authenticated.forEach((peer) => receipt(mod, peer, 'held'));
      await admission;
      const [asked, { frame, daemonHeight }] = deps.admitUnpaid.firstCall.args;
      expect(frame).to.eql(JSON.parse(SIGNED));
      expect(daemonHeight).to.equal(100);
      // unpaidAdmission takes the frame as the admitting node's only when it carries this very message
      expect(asked).to.equal(frame.data);
    });

    it('should not count two links to one IP as two holders', async () => {
      const { mod, peerManager, deps } = load();
      peerManager.authenticated = [
        makePeer('10.0.0.1'), makePeer('10.0.0.1', { port: '16137' }), makePeer('10.0.0.2'), makePeer('10.0.0.3'),
      ];
      const { admission } = await startAdmit(mod);
      const [a1, a2, b] = peerManager.authenticated;
      receipt(mod, a1, 'held');
      receipt(mod, a2, 'held');
      receipt(mod, b, 'held');
      await flush();
      expect(deps.insert.called).to.equal(false);
      receipt(mod, peerManager.authenticated[3], 'held');
      await admission;
      sinon.assert.calledOnce(deps.insert);
    });

    it('should fail at once, committing nothing, when a refusal leaves the quorum out of reach', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'refused', 'its client tag height 90 is not current');

      await expect(admission).to.be.rejectedWith('The network refused this app message: its client tag height 90 is not current');
      expect(deps.insert.called).to.equal(false);
      peerManager.authenticated.forEach((peer) => expect(commitsTo(peer)).to.have.length(0));
      expect(peerManager.unauthenticated).to.have.length(0);
    });

    it('should fail at admissionTimeoutMs with fewer than the quorum, and commit nothing after it', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3'], { latency: 1000 });
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      receipt(mod, c, 'received');

      clock.tick(config.fluxapps.admissionTimeoutMs);
      await expect(admission).to.be.rejectedWith('did not confirm this app message on 3 nodes');
      receipt(mod, c, 'held');
      await flush();

      expect(deps.insert.called).to.equal(false);
      [a, b, c].forEach((peer) => expect(commitsTo(peer)).to.have.length(0));
    });

    it('should stop counting a peer that has not answered received within its silence bound', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');

      clock.tick(999);
      await flush();
      clock.tick(1);
      await expect(admission).to.be.rejectedWith('did not confirm');
    });

    it('should count a peer that answered received until admissionTimeoutMs, however long its checks take', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      receipt(mod, c, 'received');
      clock.tick(config.fluxapps.admissionTimeoutMs - 1);
      await flush();
      receipt(mod, c, 'held');
      await admission;
    });

    it('should commit at the quorum\'s third held, without waiting for admissionTimeoutMs', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']);
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      receipt(mod, c, 'held');
      await admission;
      expect(deps.insert.calledOnce).to.equal(true);
    });

    it('should give a peer four of its round trips before it is silent', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3'], { latency: 400 });
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      clock.tick(1500);
      await flush();
      receipt(mod, c, 'held');
      await admission;
    });

    it('should stop counting a peer whose connection closed', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');

      peerManager.emit('peerDisconnected', c.key, c.connectionId);

      await expect(admission).to.be.rejectedWith('did not confirm');
    });

    it('should not count a peer the proposal could not be sent to', async () => {
      const { mod, peerManager } = load();
      peerManager.authenticated = [makePeer('10.0.0.1'), makePeer('10.0.0.2'), makePeer('10.0.0.3', { sendOk: false })];
      const { admission } = await startAdmit(mod);
      await expect(admission).to.be.rejectedWith('did not confirm');
    });

    it('should ignore a receipt from a connection it did not propose to', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      receipt(mod, makePeer('10.0.0.3'), 'held');
      await flush();
      expect(deps.insert.called).to.equal(false);
      receipt(mod, peerManager.authenticated[2], 'held');
      await admission;
    });

    it('should run one round for two submissions of one message', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission: first } = await startAdmit(mod);
      const second = mod.admit(MESSAGE, { daemonHeight: 100 });
      const asked = mod.alreadyAdmitted(HASH);
      peerManager.authenticated.forEach((peer) => receipt(mod, peer, 'held'));

      await Promise.all([first, second]);
      expect(await asked).to.equal(true);
      peerManager.authenticated.forEach((peer) => expect(proposalsTo(peer)).to.have.length(1));
      sinon.assert.calledOnce(deps.insert);
    });

    it('should drop a relay of a message it is admitting, which it writes at its commit', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);

      expect(mod.takeRelay(HASH, true)).to.equal(true);
      peerManager.authenticated.forEach((peer) => receipt(mod, peer, 'held'));
      await admission;
      expect(mod.takeRelay(HASH, true)).to.equal(false);
    });

    it('should answer whether a message is held here, or reject as an admission in progress does', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      deps.holds.resolves(true);
      expect(await mod.alreadyAdmitted(HASH)).to.equal(true);
      deps.holds.resolves(false);
      expect(await mod.alreadyAdmitted(HASH)).to.equal(false);

      await startAdmit(mod);
      const asked = mod.alreadyAdmitted(HASH);
      receipt(mod, peerManager.authenticated[0], 'refused', 'nope');
      await expect(asked).to.be.rejectedWith('nope');
    });

    it('should hold the message\'s place in its allowances through the round, and give it back once written', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      receipt(mod, peerManager.authenticated[0], 'held');
      receipt(mod, peerManager.authenticated[1], 'held');
      await flush();
      expect(deps.release.called).to.equal(false);

      receipt(mod, peerManager.authenticated[2], 'held');
      await admission;

      sinon.assert.calledOnce(deps.release);
      sinon.assert.callOrder(deps.insert, deps.release);
    });

    it('should give the place back when the round fails on a refusal', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      receipt(mod, peerManager.authenticated[0], 'refused', 'its client already has 10 unpaid app messages pending');

      await expect(admission).to.be.rejectedWith('The network refused this app message');
      sinon.assert.calledOnce(deps.release);
    });

    it('should give the place back when the round times out', async () => {
      const { mod, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3'], { latency: 1000 });
      const { admission } = await startAdmit(mod);

      clock.tick(config.fluxapps.admissionTimeoutMs);

      await expect(admission).to.be.rejectedWith('did not confirm this app message on 3 nodes');
      sinon.assert.calledOnce(deps.release);
    });

    it('should give the place back when its own write fails', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      deps.insert.rejects(new Error('database gone'));
      const { admission } = await startAdmit(mod);
      peerManager.authenticated.forEach((peer) => receipt(mod, peer, 'held'));

      await expect(admission).to.be.rejectedWith('database gone');
      sinon.assert.calledOnce(deps.release);
    });

    it('should propose nothing when admission refuses it, or when this node cannot sign', async () => {
      const { mod, peerManager, deps } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      deps.admitUnpaid.resolves({ refused: 'its client has no allowance left' });
      await expect(mod.admit(MESSAGE, { daemonHeight: 100 })).to.be.rejectedWith('no allowance left');
      deps.sign.resolves(null);
      await expect(mod.admit(MESSAGE, { daemonHeight: 100 })).to.be.rejectedWith('cannot sign');
      peerManager.authenticated.forEach((peer) => expect(peer.sent).to.have.length(0));
    });
  });

  describe('a peer holding a proposal', () => {
    const propose = (mod, peer) => mod.openProposal(HASH, peer);
    const commit = (mod, peer) => mod.onCommit(peer, { type: 'appcommit', hash: HASH });

    it('should answer a proposer once however often it proposes', () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      propose(mod, entry);
      propose(mod, entry);
      propose(mod, entry);

      mod.hold(HASH);

      expect(receiptsTo(entry)).to.eql([{ type: 'appreceipt', hash: HASH, state: 'held' }]);
    });

    it('should answer held once its checks pass, and write only on a commit from the node that proposed it', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      const stranger = makePeer('10.0.0.2');
      expect(propose(mod, entry)).to.equal(true);
      expect(receiptsTo(entry)).to.eql([]);

      let committed = null;
      mod.hold(HASH).then((result) => { committed = result; });
      expect(receiptsTo(entry)).to.eql([{ type: 'appreceipt', hash: HASH, state: 'held' }]);

      commit(mod, stranger);
      await flush();
      expect(committed).to.equal(null);
      commit(mod, entry);
      await flush();
      expect(committed).to.equal(true);
    });

    it('should keep a commit that arrives while its checks still run, and write as soon as they pass', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      propose(mod, entry);

      commit(mod, entry);

      expect(await mod.hold(HASH)).to.equal(true);
    });

    it('should drop the proposal when no commit comes within admissionHoldMs', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      propose(mod, entry);
      const held = mod.hold(HASH);

      clock.tick(config.fluxapps.admissionHoldMs);

      expect(await held).to.equal(false);
      expect(propose(mod, entry)).to.equal(true);
    });

    it('should not write a proposal whose checks outlast admissionHoldMs', async () => {
      const { mod } = load();
      propose(mod, makePeer('10.0.0.1'));
      clock.tick(config.fluxapps.admissionHoldMs);

      expect(await mod.hold(HASH)).to.equal(false);
    });

    it('should hold for longer than the entry node may take to commit', () => {
      expect(config.fluxapps.admissionHoldMs).to.be.above(config.fluxapps.admissionTimeoutMs * 2);
    });

    it('should answer a second proposer from the first proposal\'s checks, and let it commit', async () => {
      const { mod } = load();
      const first = makePeer('10.0.0.1');
      const second = makePeer('10.0.0.2');
      propose(mod, first);

      expect(propose(mod, second)).to.equal(false);
      expect(receiptsTo(second)).to.eql([]);
      const held = mod.hold(HASH);
      expect(receiptsTo(second)).to.eql([{ type: 'appreceipt', hash: HASH, state: 'held' }]);
      commit(mod, second);

      expect(await held).to.equal(true);
    });

    it('should answer held at once to a proposer that joins after the checks passed', () => {
      const { mod } = load();
      propose(mod, makePeer('10.0.0.1'));
      mod.hold(HASH);
      const late = makePeer('10.0.0.2');

      expect(propose(mod, late)).to.equal(false);
      expect(receiptsTo(late)).to.eql([{ type: 'appreceipt', hash: HASH, state: 'held' }]);
    });

    it('should answer every proposer a refusal, and close the proposal', () => {
      const { mod } = load();
      const first = makePeer('10.0.0.1');
      const second = makePeer('10.0.0.2');
      propose(mod, first);
      propose(mod, second);

      mod.answerProposal(HASH, 'refused', 'nope');

      [first, second].forEach((peer) => expect(receiptsTo(peer)).to.eql([{
        type: 'appreceipt', hash: HASH, state: 'refused', reason: 'nope',
      }]));
      expect(propose(mod, first)).to.equal(true);
    });

    it('should not take a commit from a proposer whose connection has closed', async () => {
      const { mod, peerManager } = load();
      const entry = makePeer('10.0.0.1');
      propose(mod, entry);
      const held = mod.hold(HASH);
      peerManager.emit('peerDisconnected', entry.key, entry.connectionId);
      commit(mod, entry);
      clock.tick(config.fluxapps.admissionHoldMs);
      expect(await held).to.equal(false);
    });

    it('should take a relay over an authenticated link as the commit of a proposal, checked or not', async () => {
      const { mod } = load();
      propose(mod, makePeer('10.0.0.1'));

      expect(mod.takeRelay(HASH, true)).to.equal(true);

      expect(await mod.hold(HASH)).to.equal(true);
      expect(mod.takeRelay(HASH, true)).to.equal(false);
    });

    it('should drop a relay of a proposal from an unauthenticated link, and keep waiting for the commit', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      propose(mod, entry);
      const held = mod.hold(HASH);

      expect(mod.takeRelay(HASH, false)).to.equal(true);
      expect(propose(mod, makePeer('10.0.0.2'))).to.equal(false);
      commit(mod, entry);

      expect(await held).to.equal(true);
    });

    it('should take a relay of a message this node was not proposed', () => {
      const { mod } = load();
      expect(mod.takeRelay(HASH, true)).to.equal(false);
      expect(mod.takeRelay(HASH, false)).to.equal(false);
    });

    it('should refuse a proposal past admissionHoldMax pending', () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      for (let i = 0; i < config.fluxapps.admissionHoldMax; i += 1) {
        mod.openProposal(i.toString(16).padStart(64, '0'), entry);
      }
      const over = makePeer('10.0.0.2');

      expect(propose(mod, over)).to.equal(null);
      expect(receiptsTo(over)[0].state).to.equal('refused');
      mod.resetState();
    });
  });
});
