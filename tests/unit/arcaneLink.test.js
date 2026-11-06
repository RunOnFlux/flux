const crypto = require('node:crypto');
const chai = require('chai');
const sinon = require('sinon');
const config = require('config');
const proxyquire = require('proxyquire').noCallThru();
const proxyquireCallThru = require('proxyquire');

const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const messagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');

const { expect } = chai;

const MODULE_PATH = '../../ZelBack/src/services/arcaneLink';

// What every Arcane node's fluxbench computes, and no legacy node's can.
const ARCANE_KEY = 'arcane-node-auth';
const arcaneEncrypt = async (text) => crypto.createHmac('sha256', ARCANE_KEY).update(text).digest('base64');

// The node list every node reads: socket address to the key listed there.
const listed = new Map();
const listListeners = new Set();
const listAt = (ip, pubKey) => listed.set(`${ip}:16127`, pubKey);
const updateList = () => listListeners.forEach((listener) => listener());

const settle = async () => {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
};

/**
 * One node: its own module instance, its own peers, its fluxbench.
 * `send(message, peer)` is wired by `connect`.
 */
function makeNode({
  ip, pubKey, encrypt = arcaneEncrypt, arcane = true, list = true,
}) {
  const node = {
    ip, pubKey, peers: new Map(), routes: new Map(), encryptCalls: 0, linksLost: [], linksGained: [],
  };
  if (list) listAt(ip, pubKey);
  const before = process.env.FLUXOS_PATH;
  if (arcane) process.env.FLUXOS_PATH = '/flux';
  else delete process.env.FLUXOS_PATH;
  node.mod = proxyquire(MODULE_PATH, {
    './benchmarkService': {
      nodeAuthEncrypt: async (text) => {
        node.encryptCalls += 1;
        return encrypt(text);
      },
    },
    './fluxNetworkHelper': { getFluxNodePublicKey: async () => node.pubKey },
    './fluxCommunicationMessagesSender': {
      sendSignedMessage: async (message, peer) => {
        const deliver = node.routes.get(peer);
        if (deliver) setImmediate(() => deliver({ pubKey: node.pubKey, data: message }));
      },
    },
    './networkStateService': {
      getFluxnodeBySocketAddress: async (address) => (listed.has(address) ? { pubkey: listed.get(address) } : null),
      onUpdated: (listener) => { listListeners.add(listener); return () => listListeners.delete(listener); },
    },
    './utils/peerState': {
      peerManager: {
        getOwnSocketAddress: () => `${node.ip}:16127`,
        getUnauthenticatedPeers: () => [...node.peers.values()].filter((peer) => !peer.handshaking && !peer.link?.authenticated),
        noteAuthenticatedLinkLost: (key) => node.linksLost.push(key),
        noteAuthenticatedLinkGained: (key) => node.linksGained.push(key),
      },
    },
  });
  if (before === undefined) delete process.env.FLUXOS_PATH;
  else process.env.FLUXOS_PATH = before;
  node.mod.resetState();
  return node;
}

function makePeer(ip, capabilities = ['arcaneLink']) {
  return {
    ip, port: '16127', key: `${ip}:16127`, isAlive: true, remoteCapabilities: new Set(capabilities), link: null,
  };
}

function dispatchTo(node, peer) {
  return (msg) => {
    if (msg.data.type === node.mod.NONCE_TYPE) node.mod.handleNonce(msg, peer);
    else if (msg.data.type === node.mod.CONFIRM_TYPE) node.mod.handleConfirm(msg, peer);
  };
}

/**
 * Connect two nodes directly: each sees the other's real IP.
 * @returns {{aPeer: object, bPeer: object}} a's view of b, b's view of a.
 */
function connect(a, b, { aSeesIp = b.ip, bSeesIp = a.ip } = {}) {
  const aPeer = makePeer(aSeesIp);
  const bPeer = makePeer(bSeesIp);
  a.peers.set(aPeer.key, aPeer);
  b.peers.set(bPeer.key, bPeer);
  a.routes.set(aPeer, dispatchTo(b, bPeer));
  b.routes.set(bPeer, dispatchTo(a, aPeer));
  return { aPeer, bPeer };
}

async function handshake(a, b, peers) {
  a.mod.startLink(peers.aPeer);
  b.mod.startLink(peers.bPeer);
  await settle();
}

describe('arcaneLink tests', () => {
  beforeEach(() => {
    listed.clear();
    listListeners.clear();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should stub only names the real modules export', () => {
    expect(benchmarkService.nodeAuthEncrypt).to.be.a('function');
    expect(fluxNetworkHelper.getFluxNodePublicKey).to.be.a('function');
    expect(messagesSender.sendSignedMessage).to.be.a('function');
    expect(peerManager.getOwnSocketAddress).to.be.a('function');
    expect(peerManager.getUnauthenticatedPeers).to.be.a('function');
    expect(peerManager.noteAuthenticatedLinkLost).to.be.a('function');
    expect(peerManager.noteAuthenticatedLinkGained).to.be.a('function');
    expect(networkStateService.getFluxnodeBySocketAddress).to.be.a('function');
    expect(networkStateService.onUpdated).to.be.a('function');
  });

  it('should advertise the capability only on an Arcane node', () => {
    const before = process.env.FLUXOS_PATH;
    const capabilities = (arcane) => {
      if (arcane) process.env.FLUXOS_PATH = '/flux';
      else delete process.env.FLUXOS_PATH;
      return proxyquireCallThru('../../ZelBack/src/services/utils/FluxPeerSocket', {}).FLUX_CAPABILITIES;
    };
    try {
      expect(capabilities(true)).to.include('arcaneLink');
      expect(capabilities(false)).to.not.include('arcaneLink');
    } finally {
      if (before === undefined) delete process.env.FLUXOS_PATH;
      else process.env.FLUXOS_PATH = before;
    }
  });

  describe('two Arcane nodes', () => {
    it('should authenticate the link at both ends', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);

      await handshake(a, b, peers);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(true);
      expect(a.encryptCalls).to.equal(1);
      expect(b.encryptCalls).to.equal(1);
    });

    it('should settle the handshake when the link authenticates', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);

      const settled = a.mod.startLink(peers.aPeer);
      b.mod.startLink(peers.bPeer);
      await settled;

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
    });

    it('should settle the handshake when the link fails', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA', encrypt: async () => null });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);

      const settled = a.mod.startLink(peers.aPeer);
      b.mod.startLink(peers.bPeer);
      await settled;

      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.FLUXBENCH);
    });

    it('should authenticate two nodes of one operator, which share a node key', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyOp' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyOp' });
      const peers = connect(a, b);

      await handshake(a, b, peers);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(true);
    });

    it('should give each direction one key, held by its sender and its receiver alone', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);

      const aLink = peers.aPeer.link;
      const bLink = peers.bPeer.link;
      expect(aLink.sendKey.equals(bLink.recvKey)).to.equal(true);
      expect(bLink.sendKey.equals(aLink.recvKey)).to.equal(true);
      expect(aLink.sendKey.equals(aLink.recvKey)).to.equal(false);
    });

    it('should authenticate when the peer\'s confirm arrives before this node has derived its keys', async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA', encrypt: async (text) => { await gate; return arcaneEncrypt(text); } });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);

      a.mod.startLink(peers.aPeer);
      b.mod.startLink(peers.bPeer);
      await settle();
      expect(peers.aPeer.link.peerConfirm).to.not.equal(null);
      expect(peers.aPeer.link.recvKey).to.equal(null);
      release();
      await settle();

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(true);
    });
  });

  describe('a node that is not Arcane', () => {
    it('should not authenticate a peer whose fluxbench cannot derive the secret', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const legacy = makeNode({
        ip: '10.0.0.9', pubKey: 'keyL', encrypt: async (text) => crypto.createHmac('sha256', 'guess').update(text).digest('base64'),
      });
      const peers = connect(a, legacy);

      await handshake(a, legacy, peers);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(false);
      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.CONFIRM);
    });

    it('should not authenticate when its own fluxbench refuses the identity', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA', encrypt: async () => null });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);

      await handshake(a, b, peers);

      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.FLUXBENCH);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(false);
    });

    it('should tell its peer when its own fluxbench fails, so the peer settles at once, unauthenticated and not backed off', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA', encrypt: async () => null });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);

      a.mod.startLink(peers.aPeer);
      const settled = b.mod.startLink(peers.bPeer);
      await settled;

      expect(peers.bPeer.link.failed).to.equal(b.mod.FAILURE.PEER_GAVE_UP);
      // b holds nothing against a's IP: its next link to a handshakes
      b.peers.delete(peers.bPeer.key);
      const healed = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const again = connect(healed, b);
      await handshake(healed, b, again);
      expect(b.mod.isAuthenticated(again.bPeer)).to.equal(true);
    });

    it('should tell its peer when the peer\'s confirm does not prove the secret', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const legacy = makeNode({
        ip: '10.0.0.9', pubKey: 'keyL', encrypt: async (text) => crypto.createHmac('sha256', 'guess').update(text).digest('base64'),
      });
      const peers = connect(a, legacy);
      const sentByA = [];
      const deliver = a.routes.get(peers.aPeer);
      a.routes.set(peers.aPeer, (msg) => { sentByA.push(msg.data); deliver(msg); });

      await handshake(a, legacy, peers);

      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.CONFIRM);
      expect(sentByA.filter((data) => data.type === a.mod.CONFIRM_TYPE && data.mac === null)).to.have.length(1);
    });

    it('should stop treating a link as authenticated when its peer gives up after it had', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);
      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);

      a.mod.handleConfirm({ pubKey: 'keyB', data: { type: a.mod.CONFIRM_TYPE, mac: null, nonce: peers.aPeer.link.localNonce } }, peers.aPeer);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(false);
      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.PEER_GAVE_UP);
      expect(a.linksLost, 'the authenticated link was lost').to.deep.equal([peers.aPeer.key]);
    });

    it('should take a give-up only from the key the peer\'s nonce came under', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);

      a.mod.handleConfirm({ pubKey: 'keyX', data: { type: a.mod.CONFIRM_TYPE, mac: null, nonce: peers.aPeer.link.localNonce } }, peers.aPeer);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
    });

    it('should take a give-up only for this link\'s nonce', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);

      a.mod.handleConfirm({ pubKey: 'keyB', data: { type: a.mod.CONFIRM_TYPE, mac: null, nonce: 'ab'.repeat(32) } }, peers.aPeer);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
    });

    it('should open no handshake on a node that is not Arcane', async () => {
      const legacy = makeNode({ ip: '10.0.0.9', pubKey: 'keyL', arcane: false });
      const peer = makePeer('10.0.0.1');
      legacy.peers.set(peer.key, peer);

      expect(legacy.mod.startLink(peer)).to.equal(null);

      expect(peer.link).to.equal(null);
    });

    it('should open no handshake with a peer that does not advertise the capability', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const peer = makePeer('10.0.0.9', []);
      a.peers.set(peer.key, peer);

      expect(a.mod.startLink(peer)).to.equal(null);
      expect(peer.link).to.equal(null);
    });
  });

  describe('a relay', () => {
    it('should refuse two Arcane nodes joined through a third IP their keys are not listed at, without a fluxbench call', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      // Both ends see the relay's IP; it forwards every frame unchanged.
      const peers = connect(a, b, { aSeesIp: '10.0.0.66', bSeesIp: '10.0.0.66' });

      await handshake(a, b, peers);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(false);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(false);
      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
      expect(a.encryptCalls + b.encryptCalls).to.equal(0);
    });

    it('should not let a relay on a node of the same operator join two of its nodes into an authenticated link', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyOp' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyOp' });
      listAt('10.0.0.66', 'keyOp');
      const peers = connect(a, b, { aSeesIp: '10.0.0.66', bSeesIp: '10.0.0.66' });

      await handshake(a, b, peers);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(false);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(false);
      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.CONFIRM);
    });

    it('should refuse its own nonce sent back to it', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const peer = makePeer('10.0.0.66');
      a.peers.set(peer.key, peer);
      // The relay reflects every frame straight back.
      a.routes.set(peer, dispatchTo(a, peer));

      a.mod.startLink(peer);
      await settle();

      expect(peer.link.failed).to.equal(a.mod.FAILURE.REFLECTED);
      expect(a.encryptCalls).to.equal(0);
    });

    it('should refuse a confirm signed by a key other than the nonce\'s', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      const deliver = b.routes.get(peers.bPeer);
      b.routes.set(peers.bPeer, (msg) => deliver(msg.data.type === b.mod.CONFIRM_TYPE ? { ...msg, pubKey: 'keyX' } : msg));

      await handshake(a, b, peers);

      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.KEY_CHANGED);
    });

    it('should take no nonce on an authenticated link', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);

      await a.mod.handleNonce({ pubKey: 'keyB', data: { type: a.mod.NONCE_TYPE, nonce: 'ab'.repeat(32) } }, peers.aPeer);

      expect(a.encryptCalls).to.equal(1);
      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
    });

    it('should refuse a malformed nonce without a fluxbench call', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const peer = makePeer('10.0.0.9');
      a.peers.set(peer.key, peer);
      a.mod.startLink(peer);

      await a.mod.handleNonce({ pubKey: 'keyL', data: { type: a.mod.NONCE_TYPE, nonce: 'not-hex' } }, peer);

      expect(peer.link.failed).to.equal(a.mod.FAILURE.MALFORMED);
      expect(a.encryptCalls).to.equal(0);
    });
  });

  describe('fluxbench load', () => {
    async function oneHandshake(a, ip, encryptNode) {
      const b = encryptNode ?? makeNode({ ip, pubKey: `key${ip}` });
      const peers = connect(a, b);
      await handshake(a, b, peers);
      return peers.aPeer;
    }

    it('should cost no fluxbench call past the per-IP budget', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const { linkHandshakesPerIp } = config.fluxapps;
      for (let i = 0; i < linkHandshakesPerIp; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const peer = await oneHandshake(a, '10.0.0.2');
        expect(a.mod.isAuthenticated(peer)).to.equal(true);
        a.peers.delete(peer.key);
      }

      const refused = await oneHandshake(a, '10.0.0.2');

      expect(refused.link.failed).to.equal(a.mod.FAILURE.BUDGET);
      expect(a.encryptCalls).to.equal(linkHandshakesPerIp);
    });

    it('should back an IP off after its link failed to prove the secret', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const legacy = makeNode({
        ip: '10.0.0.9', pubKey: 'keyL', encrypt: async (text) => crypto.createHmac('sha256', 'guess').update(text).digest('base64'),
      });
      const first = await oneHandshake(a, '10.0.0.9', legacy);
      expect(first.link.failed).to.equal(a.mod.FAILURE.CONFIRM);
      a.peers.delete(first.key);

      const second = await oneHandshake(a, '10.0.0.9', makeNode({ ip: '10.0.0.9', pubKey: 'keyB' }));

      expect(second.link.failed).to.equal(a.mod.FAILURE.BUDGET);
      expect(a.encryptCalls).to.equal(1);
    });

    it('should not back an IP off when this node\'s own fluxbench failed', async () => {
      let calls = 0;
      const a = makeNode({
        ip: '10.0.0.1',
        pubKey: 'keyA',
        encrypt: async (text) => {
          calls += 1;
          return calls === 1 ? null : arcaneEncrypt(text);
        },
      });
      const first = await oneHandshake(a, '10.0.0.2');
      expect(first.link.failed).to.equal(a.mod.FAILURE.FLUXBENCH);
      a.peers.delete(first.key);

      const second = await oneHandshake(a, '10.0.0.2');

      expect(a.mod.isAuthenticated(second)).to.equal(true);
    });

    it('should hold node-auth calls to the global cap and drop those past the queue', async () => {
      const { nodeAuthCallsConcurrent, nodeAuthCallsQueued } = config.fluxapps;
      let inFlight = 0;
      let maxInFlight = 0;
      const waiting = [];
      const a = makeNode({
        ip: '10.0.0.1',
        pubKey: 'keyA',
        encrypt: async (text) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => { waiting.push(resolve); });
          inFlight -= 1;
          return arcaneEncrypt(text);
        },
      });
      const total = nodeAuthCallsConcurrent + nodeAuthCallsQueued + 1;
      const links = [];
      for (let i = 0; i < total; i += 1) {
        const b = makeNode({ ip: `10.1.0.${i + 1}`, pubKey: `key${i}` });
        const peers = connect(a, b);
        links.push(peers);
        a.mod.startLink(peers.aPeer);
        b.mod.startLink(peers.bPeer);
      }
      await settle();

      expect(inFlight).to.equal(nodeAuthCallsConcurrent);
      expect(links.filter((p) => p.aPeer.link.failed === a.mod.FAILURE.BUSY)).to.have.length(1);
      while (waiting.length) {
        waiting.shift()();
        // eslint-disable-next-line no-await-in-loop
        await settle();
      }

      expect(maxInFlight).to.equal(nodeAuthCallsConcurrent);
      expect(links.filter((p) => a.mod.isAuthenticated(p.aPeer))).to.have.length(total - 1);
    });

    it('should send no confirm on a socket that closed while its secret was derived', async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA', encrypt: async (text) => { await gate; return arcaneEncrypt(text); } });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      a.mod.startLink(peers.aPeer);
      b.mod.startLink(peers.bPeer);
      await settle();

      peers.aPeer.isAlive = false;
      release();
      await settle();

      expect(peers.aPeer.link.sendKey).to.equal(null);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(false);
    });
  });

  describe('a key not listed at the socket\'s address', () => {
    const nonceFrom = (pubKey) => ({ pubKey, data: { type: 'fluxlinknonce', nonce: crypto.randomBytes(32).toString('hex') } });

    // a refuses b's first handshake: b's key is listed at another address.
    async function refusedThenJoined({ bListed = false } = {}) {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB', list: bListed });
      if (!bListed) listAt('10.0.0.200', 'keyB');
      const peers = connect(a, b);
      await handshake(a, b, peers);
      expect(peers.aPeer.link.failed, 'fixture: a refused the first handshake').to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
      return { a, b, peers };
    }

    it('should refuse it before any fluxbench call, and tell the peer, without backing its IP off', async () => {
      const { a, b, peers } = await refusedThenJoined();

      expect(a.encryptCalls).to.equal(0);
      expect(peers.bPeer.link.failed).to.equal(b.mod.FAILURE.PEER_GAVE_UP);
      listAt('10.0.0.2', 'keyB');
      a.peers.delete(peers.aPeer.key);
      b.peers.delete(peers.bPeer.key);
      const again = connect(a, b);
      await handshake(a, b, again);
      expect(a.mod.isAuthenticated(again.aPeer)).to.equal(true);
    });

    it('should authenticate a key listed at another address once this node has taken its move to the socket\'s', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB', list: false });
      listAt('10.0.0.200', 'keyB');
      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      const peers = connect(a, b);

      await handshake(a, b, peers);

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(true);
    });

    it('should not take a move of another key, or one past its validity', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB', list: false });
      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyX', Date.now() + 60000);
      const c = makeNode({ ip: '10.0.0.3', pubKey: 'keyC', list: false });
      await a.mod.noteMoveTaken('10.0.0.3:16127', 'keyC', Date.now() - 1);
      const toB = connect(a, b);
      const toC = connect(a, c);

      await handshake(a, b, toB);
      await handshake(a, c, toC);

      expect(toB.aPeer.link.failed).to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
      expect(toC.aPeer.link.failed).to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
      expect(a.encryptCalls).to.equal(0);
    });

    it('should not take a move once it is past its validity', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB', list: false });
      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 1000);
      clock.tick(1000);
      const peers = connect(a, b);

      await handshake(a, b, peers);

      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
    });

    it('should authenticate the same connection when this node takes the move there, and count the link gained at both ends', async () => {
      const { a, b, peers } = await refusedThenJoined();
      const {aPeer} = peers;
      const {bPeer} = peers;

      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      await settle();

      expect(peers.aPeer).to.equal(aPeer);
      expect(a.mod.isAuthenticated(aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(bPeer)).to.equal(true);
      expect(aPeer.link.sendKey.equals(bPeer.link.recvKey)).to.equal(true);
      expect(a.linksGained).to.deep.equal([aPeer.key]);
      expect(b.linksGained).to.deep.equal([bPeer.key]);
    });

    it('should authenticate the same connection when the node list shows the key at its address', async () => {
      const { a, b, peers } = await refusedThenJoined();

      listAt('10.0.0.2', 'keyB');
      updateList();
      await settle();

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(true);
    });

    it('should not handshake again on a list update that still does not show the key there', async () => {
      const { a, peers } = await refusedThenJoined();
      const {link} = peers.aPeer;
      const sent = [];
      const deliver = a.routes.get(peers.aPeer);
      a.routes.set(peers.aPeer, (msg) => { sent.push(msg.data.type); deliver(msg); });

      updateList();
      await settle();

      expect(peers.aPeer.link).to.equal(link);
      expect(sent).to.deep.equal([]);
    });

    it('should handshake again only the connections refused for want of a listing', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA', encrypt: async () => null });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);
      expect(peers.aPeer.link.failed, 'fixture: refused for another reason').to.equal(a.mod.FAILURE.FLUXBENCH);
      const {link} = peers.aPeer;

      updateList();
      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      await settle();

      expect(peers.aPeer.link).to.equal(link);
    });

    it('should ignore a fresh nonce on a connection that has not joined', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const peer = makePeer('10.0.0.2');
      peer.handshaking = true;
      a.peers.set(peer.key, peer);
      a.mod.startLink(peer);
      await a.mod.handleNonce(nonceFrom('keyB'), peer);
      const { link } = peer;
      expect(link.failed, 'fixture: the first handshake failed before the connection joined').to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
      listAt('10.0.0.2', 'keyB');

      await a.mod.handleNonce(nonceFrom('keyB'), peer);

      expect(peer.link).to.equal(link);
    });

    it('should ignore a fresh nonce, sending nothing, once the peer\'s IP has no handshake budget left', async () => {
      const { a, peers } = await refusedThenJoined();
      const { linkHandshakesPerIp } = config.fluxapps;
      for (let i = 0; i < linkHandshakesPerIp; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await a.mod.handleNonce(nonceFrom('keyB'), peers.aPeer);
        // eslint-disable-next-line no-await-in-loop
        await settle();
        expect(peers.aPeer.link.failed, `fixture: fresh nonce ${i + 1} handshaken and refused`).to.equal(a.mod.FAILURE.NOT_LISTED_HERE);
      }
      const {link} = peers.aPeer;
      const sent = [];
      a.routes.set(peers.aPeer, (msg) => sent.push(msg.data.type));

      await a.mod.handleNonce(nonceFrom('keyB'), peers.aPeer);
      await settle();

      expect(peers.aPeer.link).to.equal(link);
      expect(sent).to.deep.equal([]);
    });

    it('should count a handshake a fresh nonce starts once against the peer IP\'s budget', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      listAt('10.0.0.2', 'keyB');
      const peer = makePeer('10.0.0.2');
      a.peers.set(peer.key, peer);
      const giveUp = () => a.mod.handleConfirm({ pubKey: 'keyB', data: { type: a.mod.CONFIRM_TYPE, mac: null, nonce: peer.link.localNonce } }, peer);
      const { linkHandshakesPerIp } = config.fluxapps;
      a.mod.startLink(peer);
      await a.mod.handleNonce(nonceFrom('keyB'), peer);
      giveUp();

      for (let i = 1; i < linkHandshakesPerIp; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await a.mod.handleNonce(nonceFrom('keyB'), peer);
        // eslint-disable-next-line no-await-in-loop
        await settle();
        giveUp();
      }

      expect(a.encryptCalls, 'every handshake the budget allows derived its keys').to.equal(linkHandshakesPerIp);
    });

    it('should ignore a fresh nonce on a link still handshaking on a joined connection', async () => {
      const { a, peers } = await refusedThenJoined();
      const held = [];
      a.routes.set(peers.aPeer, (msg) => held.push(msg));
      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      await a.mod.handleNonce(nonceFrom('keyB'), peers.aPeer);
      const {link} = peers.aPeer;
      expect(link.failed, 'fixture: the new handshake is running').to.equal(null);

      await a.mod.handleNonce(nonceFrom('keyB'), peers.aPeer);

      expect(peers.aPeer.link).to.equal(link);
    });

    it('should not fail a new handshake on the confirm of the one it replaced', async () => {
      const { a, b, peers } = await refusedThenJoined();
      const deliver = a.routes.get(peers.aPeer);
      const held = [];
      a.routes.set(peers.aPeer, (msg) => held.push(msg));
      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      await settle();
      expect(peers.aPeer.link.peerNonce, 'fixture: the new handshake waits for the peer\'s nonce').to.equal(null);

      // The confirm b sent for the handshake a refused, arriving after a started the new one.
      a.mod.handleConfirm({ pubKey: 'keyB', data: { type: a.mod.CONFIRM_TYPE, mac: 'ab'.repeat(32) } }, peers.aPeer);
      a.routes.set(peers.aPeer, deliver);
      held.forEach(deliver);
      await settle();

      expect(a.mod.isAuthenticated(peers.aPeer)).to.equal(true);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(true);
    });

    it('should fail a new handshake the peer does not answer, after linkHandshakeDeadlineMs', async () => {
      const { a, peers } = await refusedThenJoined();
      a.routes.delete(peers.aPeer);
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      await settle();
      expect(peers.aPeer.link.failed).to.equal(null);
      clock.tick(config.fluxapps.linkHandshakeDeadlineMs);

      expect(peers.aPeer.link.failed).to.equal(a.mod.FAILURE.TIMEOUT);
    });

    it('should never handshake an authenticated link again', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      const peers = connect(a, b);
      await handshake(a, b, peers);
      const {link} = peers.aPeer;

      await a.mod.noteMoveTaken('10.0.0.2:16127', 'keyB', Date.now() + 60000);
      updateList();
      await a.mod.handleNonce(nonceFrom('keyB'), peers.aPeer);
      await settle();

      expect(peers.aPeer.link).to.equal(link);
      expect(a.encryptCalls).to.equal(1);
    });
  });
});
