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
  const deps = {
    sign: sinon.stub().resolves(SIGNED),
    admitUnpaid: sinon.stub().resolves({ fields: { clientTag: 't', originKey: 'entryKey' } }),
    insert: sinon.stub().resolves(),
    holds: sinon.stub().resolves(false),
    publish: sinon.stub(),
  };
  const mod = proxyquire('../../ZelBack/src/services/appMessaging/admissionQuorum', {
    '../utils/peerState': { peerManager },
    '../utils/fluxBroadcastHelper': { serialiseAndSignFluxBroadcast: deps.sign },
    '../utils/fluxEventBus': { publish: deps.publish },
    './unpaidAdmission': { admitUnpaid: deps.admitUnpaid },
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
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it('should stub only names the real modules export', () => {
    expect(realPeerManager.getAuthenticatedPeers).to.be.a('function');
    expect(realPeerManager.getUnauthenticatedPeers).to.be.a('function');
    expect(realPeerManager.authenticatedIpCount).to.be.a('function');
    expect(fluxBroadcastHelper.serialiseAndSignFluxBroadcast).to.be.a('function');
    expect(unpaidAdmission.admitUnpaid).to.be.a('function');
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
      expect(deps.admitUnpaid.firstCall.args[1]).to.eql({ frame: JSON.parse(SIGNED), daemonHeight: 100 });
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

    it('should stop counting a peer that went silent after received', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      receipt(mod, c, 'received');

      clock.tick(999);
      await flush();
      clock.tick(1);
      await expect(admission).to.be.rejectedWith('did not confirm');
    });

    it('should give a peer that answered received a fresh silence bound from that answer', async () => {
      const { mod, peerManager } = withPeers(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
      const { admission } = await startAdmit(mod);
      const [a, b, c] = peerManager.authenticated;
      receipt(mod, a, 'held');
      receipt(mod, b, 'held');
      clock.tick(900);
      receipt(mod, c, 'received');
      clock.tick(900);
      await flush();
      receipt(mod, c, 'held');
      await admission;
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
    it('should answer held, and write only on a commit from the node that proposed it', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      const stranger = makePeer('10.0.0.2');
      let committed = null;
      mod.hold(HASH, entry).then((result) => { committed = result; });
      expect(receiptsTo(entry)).to.eql([{ type: 'appreceipt', hash: HASH, state: 'held' }]);

      mod.onCommit(stranger, { type: 'appcommit', hash: HASH });
      await flush();
      expect(committed).to.equal(null);
      mod.onCommit(entry, { type: 'appcommit', hash: HASH });
      await flush();
      expect(committed).to.equal(true);
    });

    it('should drop the pending copy when no commit comes within admissionHoldMs', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      const held = mod.hold(HASH, entry);
      clock.tick(config.fluxapps.admissionHoldMs);
      expect(await held).to.equal(false);
      mod.onCommit(entry, { type: 'appcommit', hash: HASH });
      expect(mod.joinHold(HASH, entry)).to.equal(false);
    });

    it('should hold for longer than the entry node may take to commit', () => {
      expect(config.fluxapps.admissionHoldMs).to.be.above(config.fluxapps.admissionTimeoutMs * 2);
    });

    it('should let a second node that proposes the same message commit it', async () => {
      const { mod } = load();
      const first = makePeer('10.0.0.1');
      const second = makePeer('10.0.0.2');
      const held = mod.hold(HASH, first);

      expect(mod.joinHold(HASH, second)).to.equal(true);
      expect(receiptsTo(second)).to.eql([{ type: 'appreceipt', hash: HASH, state: 'held' }]);
      mod.onCommit(second, { type: 'appcommit', hash: HASH });

      expect(await held).to.equal(true);
    });

    it('should not take a commit from a proposer whose connection has closed', async () => {
      const { mod, peerManager } = load();
      const entry = makePeer('10.0.0.1');
      const held = mod.hold(HASH, entry);
      peerManager.emit('peerDisconnected', entry.key, entry.connectionId);
      mod.onCommit(entry, { type: 'appcommit', hash: HASH });
      clock.tick(config.fluxapps.admissionHoldMs);
      expect(await held).to.equal(false);
    });

    it('should take a relay over an authenticated link as the commit of a pending copy', async () => {
      const { mod } = load();
      const held = mod.hold(HASH, makePeer('10.0.0.1'));

      expect(mod.takeRelay(HASH, true)).to.equal(true);

      expect(await held).to.equal(true);
      expect(mod.takeRelay(HASH, true)).to.equal(false);
    });

    it('should drop a relay of a pending copy from an unauthenticated link, and keep waiting', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      const held = mod.hold(HASH, entry);

      expect(mod.takeRelay(HASH, false)).to.equal(true);
      // still pending: a second proposer can join it
      expect(mod.joinHold(HASH, makePeer('10.0.0.2'))).to.equal(true);
      mod.onCommit(entry, { type: 'appcommit', hash: HASH });

      expect(await held).to.equal(true);
    });

    it('should take a relay of a message this node holds no copy of', () => {
      const { mod } = load();
      expect(mod.takeRelay(HASH, true)).to.equal(false);
      expect(mod.takeRelay(HASH, false)).to.equal(false);
    });

    it('should refuse a proposal past admissionHoldMax pending', async () => {
      const { mod } = load();
      const entry = makePeer('10.0.0.1');
      for (let i = 0; i < config.fluxapps.admissionHoldMax; i += 1) {
        mod.hold(i.toString(16).padStart(64, '0'), entry);
      }
      const over = makePeer('10.0.0.2');

      expect(await mod.hold(HASH, over)).to.equal(false);
      expect(receiptsTo(over)[0].state).to.equal('refused');
      mod.resetState();
    });
  });
});
