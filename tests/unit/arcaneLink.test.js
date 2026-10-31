const crypto = require('node:crypto');
const chai = require('chai');
const sinon = require('sinon');
const config = require('config');
const proxyquire = require('proxyquire').noCallThru();
const proxyquireCallThru = require('proxyquire');

const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const messagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');

const { expect } = chai;

const MODULE_PATH = '../../ZelBack/src/services/arcaneLink';

// What every Arcane node's fluxbench computes, and no legacy node's can.
const ARCANE_KEY = 'arcane-node-auth';
const arcaneEncrypt = async (text) => crypto.createHmac('sha256', ARCANE_KEY).update(text).digest('base64');

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
  ip, pubKey, encrypt = arcaneEncrypt, arcane = true,
}) {
  const node = {
    ip, pubKey, peers: new Map(), routes: new Map(), encryptCalls: 0,
  };
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
    './utils/peerState': {
      peerManager: {
        get: (key) => node.peers.get(key),
        getOwnSocketAddress: () => `${node.ip}:16127`,
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
  await Promise.all([a.mod.startLink(peers.aPeer.key), b.mod.startLink(peers.bPeer.key)]);
  await settle();
}

describe('arcaneLink tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should stub only names the real modules export', () => {
    expect(benchmarkService.nodeAuthEncrypt).to.be.a('function');
    expect(fluxNetworkHelper.getFluxNodePublicKey).to.be.a('function');
    expect(messagesSender.sendSignedMessage).to.be.a('function');
    expect(peerManager.get).to.be.a('function');
    expect(peerManager.getOwnSocketAddress).to.be.a('function');
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

      await Promise.all([a.mod.startLink(peers.aPeer.key), b.mod.startLink(peers.bPeer.key)]);
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

    it('should open no handshake on a node that is not Arcane', async () => {
      const legacy = makeNode({ ip: '10.0.0.9', pubKey: 'keyL', arcane: false });
      const peer = makePeer('10.0.0.1');
      legacy.peers.set(peer.key, peer);

      await legacy.mod.startLink(peer.key);

      expect(peer.link).to.equal(null);
    });

    it('should open no handshake with a peer that does not advertise the capability', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const peer = makePeer('10.0.0.9', []);
      a.peers.set(peer.key, peer);

      await a.mod.startLink(peer.key);

      expect(peer.link).to.equal(null);
    });
  });

  describe('a relay', () => {
    it('should not let a node on a third IP join two Arcane nodes into an authenticated link', async () => {
      const a = makeNode({ ip: '10.0.0.1', pubKey: 'keyA' });
      const b = makeNode({ ip: '10.0.0.2', pubKey: 'keyB' });
      // Both ends see the relay's IP; it forwards every frame unchanged.
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

      await a.mod.startLink(peer.key);
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

    it('should take one nonce per socket', async () => {
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
      await a.mod.startLink(peer.key);

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
        a.mod.startLink(peers.aPeer.key);
        b.mod.startLink(peers.bPeer.key);
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
      await Promise.all([a.mod.startLink(peers.aPeer.key), b.mod.startLink(peers.bPeer.key)]);
      await settle();

      peers.aPeer.isAlive = false;
      release();
      await settle();

      expect(peers.aPeer.link.sendKey).to.equal(null);
      expect(b.mod.isAuthenticated(peers.bPeer)).to.equal(false);
    });
  });
});
