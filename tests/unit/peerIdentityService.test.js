// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const config = require('config');

const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const nodeSignerModule = require('../../ZelBack/src/services/utils/nodeSigner');
const peerIdentityService = require('../../ZelBack/src/services/peerIdentityService');
const { makePeerIdentityDouble } = require('./peerIdentityTestDouble');

const { IdentityVerdict, IDENTITY_PURPOSE } = peerIdentityService;

// Three real keys, so every signature below is checked by the real verifier.
// The address binding is the whole of what this module adds, and a stubbed
// verifier would test the stub.
const KEYS = {
  a: '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh',
  b: 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD',
  c: '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
};
const ADDR = {
  a: '10.0.0.1:16127',
  b: '10.0.0.2:16127',
  c: '10.0.0.3:16137',
};
const CHALLENGE = '0123456789abcdef0123456789abcdef';

describe('peerIdentityService', () => {
  const pub = {};
  // pubKey -> the addresses the deterministic list holds it at.
  let list;

  before(async () => {
    pub.a = await fluxNetworkHelper.getFluxNodePublicKey(KEYS.a);
    pub.b = await fluxNetworkHelper.getFluxNodePublicKey(KEYS.b);
    pub.c = await fluxNetworkHelper.getFluxNodePublicKey(KEYS.c);
  });

  /**
   * An identity as the node holding `key` would sign it.
   */
  const signedAnswer = (key, fields) => {
    const answer = {
      purpose: IDENTITY_PURPOSE,
      socketAddress: ADDR[key],
      pubKey: pub[key],
      deviceId: `DEVICE-${key.toUpperCase()}`,
      challenge: CHALLENGE,
      ...fields,
    };
    return { ...answer, signature: verificationHelper.signMessage(JSON.stringify(answer), KEYS[key]) };
  };

  /**
   * The peer answers every call with whatever `answerFor` builds from the
   * challenge that call carried.
   */
  const peerAnswers = (answerFor) => sinon.stub(axios, 'post').callsFake(async (_url, body) => ({
    data: { status: 'success', data: answerFor(body.challenge) },
  }));

  beforeEach(() => {
    peerIdentityService.clearVerdicts();
    // This node is A.
    sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('10.0.0.1');
    sinon.stub(nodeSignerModule, 'nodeSigner').resolves({
      pubKey: pub.a,
      sign: (message) => verificationHelper.signMessage(message, KEYS.a),
    });
    sinon.stub(syncthingService, 'getDeviceId').resolves('DEVICE-A');
    list = new Map([[pub.a, [ADDR.a]], [pub.b, [ADDR.b]], [pub.c, [ADDR.c]]]);
    sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').callsFake(async ({ filter }) => (list.get(filter) || [])
      .map((ip) => ({ ip, pubkey: filter })));
    sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList')
      .callsFake(async (address) => [...list.values()].some((addresses) => addresses.includes(address)));
  });

  afterEach(() => {
    sinon.restore();
    peerIdentityService.clearVerdicts();
  });

  describe('answering who this node is', () => {
    it('signs its own address, key, device and the challenge - and nothing else', async () => {
      const answer = await peerIdentityService.identityAnswer({ challenge: CHALLENGE });

      // Exactly these keys. A signed `target` or `timestamp` would be accepted by
      // the verifiers of the node-to-node asks that carry them, so a caller could
      // have this node sign one of those asks for any recipient it names.
      expect(Object.keys(answer)).to.deep.equal(['purpose', 'socketAddress', 'pubKey', 'deviceId', 'challenge', 'signature']);
      expect(answer.purpose).to.equal(IDENTITY_PURPOSE);
      expect(answer.socketAddress, 'a bare address is the default port, said').to.equal('10.0.0.1:16127');
      expect(answer.pubKey).to.equal(pub.a);
      expect(answer.deviceId).to.equal('DEVICE-A');
      expect(answer.challenge).to.equal(CHALLENGE);

      const { signature, ...signed } = answer;
      expect(verificationHelper.verifyMessage(JSON.stringify(signed), pub.a, signature)).to.equal(true);
    });

    it('still answers while its syncthing is down, with no device', async () => {
      syncthingService.getDeviceId.rejects(new Error('syncthing is not running'));

      const answer = await peerIdentityService.identityAnswer({ challenge: CHALLENGE });

      expect(answer.deviceId).to.equal(null);
      expect(answer.signature).to.be.a('string');
    });

    [
      ['absent', undefined],
      ['not a string', 12345],
      ['upper case', CHALLENGE.toUpperCase()],
      ['one short', CHALLENGE.slice(1)],
      ['one long', `${CHALLENGE}0`],
      ['carrying other text', `${CHALLENGE.slice(0, 31)}"`],
    ].forEach(([what, challenge]) => {
      it(`refuses a challenge that is ${what}, so the caller cannot choose what is signed`, async () => {
        const signer = await nodeSignerModule.nodeSigner();
        const sign = sinon.spy(signer, 'sign');
        nodeSignerModule.nodeSigner.resolves(signer);

        let thrown;
        try {
          await peerIdentityService.identityAnswer({ challenge });
        } catch (error) {
          thrown = error;
        }

        expect(thrown?.message).to.match(/challenge/);
        sinon.assert.notCalled(sign);
      });
    });

    it('refuses while it does not know its own address', async () => {
      fluxNetworkHelper.getLocalSocketAddress.resolves(null);

      let thrown;
      try {
        await peerIdentityService.identityAnswer({ challenge: CHALLENGE });
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.message).to.match(/own address/);
    });

    it('refuses while it cannot sign as itself', async () => {
      nodeSignerModule.nodeSigner.resolves(null);

      let thrown;
      try {
        await peerIdentityService.identityAnswer({ challenge: CHALLENGE });
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.message).to.match(/cannot sign/);
    });

    it('refuses rather than answer unsigned when the signature fails', async () => {
      nodeSignerModule.nodeSigner.resolves({ pubKey: pub.a, sign: () => null });

      let thrown;
      try {
        await peerIdentityService.identityAnswer({ challenge: CHALLENGE });
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.message).to.match(/could not sign/);
    });

    it('serves the answer as a data message, and a refusal as an error message', async () => {
      const res = { json: sinon.stub().returnsArg(0) };

      const ok = await peerIdentityService.identityAnswerAPI({ body: { challenge: CHALLENGE } }, res);
      expect(ok.status).to.equal('success');
      expect(ok.data.pubKey).to.equal(pub.a);

      const refused = await peerIdentityService.identityAnswerAPI({ body: { challenge: 'nope' } }, res);
      expect(refused.status).to.equal('error');
    });
  });

  describe('asking which node answers at an address', () => {
    it('is VERIFIED when the node listed at the dialled address signed the answer', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.VERIFIED);
      expect(result.identity).to.deep.equal({ socketAddress: ADDR.b, pubKey: pub.b, deviceId: 'DEVICE-B' });
    });

    it('asks the dialled address itself, with a fresh random challenge and a bounded answer', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      await peerIdentityService.verifyPeer(ADDR.b, { fresh: true });
      await peerIdentityService.verifyPeer(ADDR.b, { fresh: true });

      const [first, second] = axios.post.getCalls();
      expect(first.args[0]).to.equal('http://10.0.0.2:16127/flux/identity');
      expect(first.args[1].challenge).to.match(/^[0-9a-f]{32}$/);
      expect(second.args[1].challenge, 'a challenge reused is a recording accepted').to.not.equal(first.args[1].challenge);
      expect(first.args[2].timeout).to.equal(config.fluxapps.peerIdentityTimeoutMs);
      expect(first.args[2].maxContentLength).to.be.a('number').and.to.be.below(1024 * 1024);
    });

    it('dials the default port for a bare address, and judges it as that address', async () => {
      list.set(pub.b, ['10.0.0.2']);
      peerAnswers((challenge) => signedAnswer('b', { challenge, socketAddress: '10.0.0.2:16127' }));

      const result = await peerIdentityService.verifyPeer('10.0.0.2');

      expect(axios.post.firstCall.args[0]).to.equal('http://10.0.0.2:16127/flux/identity');
      expect(result.verdict).to.equal(IdentityVerdict.VERIFIED);
    });

    // The palworld case: HK dialled UAE's address and its router handed the call
    // to the node beside it, which answered truthfully as itself.
    it('is MISROUTED when another listed node signed the answer to a call for this address', async () => {
      peerAnswers((challenge) => signedAnswer('c', { challenge }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.MISROUTED);
      expect(result.answeredAs).to.equal(ADDR.c);
      expect(result.identity, 'a misrouted answer yields nothing to act on').to.equal(undefined);
    });

    it('is MISROUTED when the call comes back to this very node', async () => {
      peerAnswers((challenge) => signedAnswer('a', { challenge }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.MISROUTED);
      expect(result.answeredAs).to.equal(ADDR.a);
    });

    it('is only UNVERIFIABLE when the dialled address is not on the list, since the node there may have just moved to it', async () => {
      const moved = '10.0.0.9:16127';
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      const result = await peerIdentityService.verifyPeer(moved);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });

    it('is only UNVERIFIABLE when the answer claims an address its key is not listed at', async () => {
      // Signed by C, claiming B's address: C's signature is real, but nothing
      // ties it to where C says it is, so it proves no redirect.
      peerAnswers((challenge) => signedAnswer('c', { challenge, socketAddress: '10.0.0.8:16127' }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });

    it('does not believe an answer that claims to be the dialled node but is signed by another key', async () => {
      peerAnswers((challenge) => signedAnswer('c', { challenge, socketAddress: ADDR.b, pubKey: pub.b }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });

    it('does not believe an answer to a different challenge, however well signed', async () => {
      const recorded = signedAnswer('b', { challenge: 'ffffffffffffffffffffffffffffffff' });
      peerAnswers(() => recorded);

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });

    it('does not believe a signed message of another kind', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge, purpose: 'somethingElse' }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });

    it('is UNVERIFIABLE for a peer too old to have the endpoint', async () => {
      sinon.stub(axios, 'post').rejects(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });

    it('is UNVERIFIABLE for a peer that refuses to say', async () => {
      sinon.stub(axios, 'post').resolves({ data: { status: 'error', data: { message: 'This node cannot sign as itself' } } });

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
      expect(result.reason).to.match(/cannot sign/);
    });

    it('is UNREACHABLE when nothing answers', async () => {
      sinon.stub(axios, 'post').rejects(new Error('timeout of 10000ms exceeded'));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNREACHABLE);
    });

    it('answers UNVERIFIABLE rather than throw when judging fails', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge }));
      fluxCommunicationUtils.deterministicFluxList.rejects(new Error('list unavailable'));

      const result = await peerIdentityService.verifyPeer(ADDR.b);

      expect(result.verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });
  });

  describe('introducing the caller', () => {
    /**
     * An introduction as the node holding `key` would send it with its ask.
     */
    const introductionFrom = (key, fields) => {
      const introduction = {
        purpose: peerIdentityService.INTRODUCTION_PURPOSE,
        socketAddress: ADDR[key],
        pubKey: pub[key],
        deviceId: `DEVICE-${key.toUpperCase()}`,
        recipient: ADDR.a,
        issuedAt: Date.now(),
        ...fields,
      };
      return { ...introduction, signature: verificationHelper.signMessage(JSON.stringify(introduction), KEYS[key]) };
    };

    const askedWith = (introduction) => peerIdentityService.identityAnswer({ challenge: CHALLENGE, introduction });

    // The palworld case from the other side: UAE's calls to HK arrive intact, and
    // UAE asking HK who it is tells HK who UAE is.
    it('learns a partner that proves itself by calling in', async () => {
      await askedWith(introductionFrom('b'));

      expect(peerIdentityService.introducedPeer(ADDR.b))
        .to.deep.equal({ socketAddress: ADDR.b, pubKey: pub.b, deviceId: 'DEVICE-B' });
    });

    it('finds a partner under a bare address as the default port', async () => {
      await askedWith(introductionFrom('b'));

      expect(peerIdentityService.introducedPeer('10.0.0.2')).to.not.equal(null);
    });

    // Fields built when the test runs: a time read when this file loads is
    // minutes stale by the time a full suite reaches it.
    [
      ['addressed to another node', () => ({ recipient: ADDR.c })],
      ['issued more than a minute ago', () => ({ issuedAt: Date.now() - 61 * 1000 })],
      ['issued beyond the network\'s clock skew ahead', () => ({ issuedAt: Date.now() + 121 * 1000 })],
      ['of another kind', () => ({ purpose: 'fluxnodeIdentity' })],
      ['carrying no time', () => ({ issuedAt: undefined })],
    ].forEach(([what, fields]) => {
      it(`ignores an introduction ${what}`, async () => {
        await askedWith(introductionFrom('b', fields()));

        expect(peerIdentityService.introducedPeer(ADDR.b)).to.equal(null);
      });
    });

    it('ignores an introduction signed by a key the list does not hold at the address it names', async () => {
      // C signs, claiming B's address and key.
      await askedWith(introductionFrom('c', { socketAddress: ADDR.b, pubKey: pub.b }));

      expect(peerIdentityService.introducedPeer(ADDR.b)).to.equal(null);
    });

    it('ignores a listed node introducing itself under another node\'s address', async () => {
      // C's own key, validly signed - only the address is a lie.
      await askedWith(introductionFrom('c', { socketAddress: ADDR.b }));

      expect(peerIdentityService.introducedPeer(ADDR.b)).to.equal(null);
      expect(peerIdentityService.introducedPeer(ADDR.c)).to.equal(null);
    });

    it('ignores an introduction altered after it was signed', async () => {
      const altered = { ...introductionFrom('b'), deviceId: 'DEVICE-OF-SOMEONE-ELSE' };

      await askedWith(altered);

      expect(peerIdentityService.introducedPeer(ADDR.b)).to.equal(null);
    });

    it('answers the ask whatever the introduction turns out to be', async () => {
      const answer = await askedWith(introductionFrom('c', { socketAddress: ADDR.b, pubKey: pub.b }));

      expect(answer.pubKey).to.equal(pub.a);
      expect(answer.challenge).to.equal(CHALLENGE);
    });

    it('relies on an introduction for peerIdentityIntroductionTtlMs, and not after', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['hrtime'] });
      try {
        await askedWith(introductionFrom('b'));
        clock.tick(config.fluxapps.peerIdentityIntroductionTtlMs - 1);
        expect(peerIdentityService.introducedPeer(ADDR.b)).to.not.equal(null);
        clock.tick(1);
        expect(peerIdentityService.introducedPeer(ADDR.b)).to.equal(null);
      } finally {
        clock.restore();
      }
    });

    it('introduces this node to the node it asks, signed for that node', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      await peerIdentityService.verifyPeer(ADDR.b);

      const { introduction } = axios.post.firstCall.args[1];
      expect(introduction.purpose).to.equal(peerIdentityService.INTRODUCTION_PURPOSE);
      expect(introduction.recipient).to.equal(ADDR.b);
      expect(introduction.socketAddress).to.equal(ADDR.a);
      expect(introduction.deviceId).to.equal('DEVICE-A');
      const { signature, ...signed } = introduction;
      expect(verificationHelper.verifyMessage(JSON.stringify(signed), pub.a, signature)).to.equal(true);
    });

    it('asks without an introduction when it cannot sign as itself', async () => {
      nodeSignerModule.nodeSigner.resolves(null);
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      await peerIdentityService.verifyPeer(ADDR.b);

      expect(axios.post.firstCall.args[1]).to.have.keys(['challenge']);
    });
  });

  describe('reusing what was learned', () => {
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ toFake: ['hrtime', 'Date'] });
    });

    afterEach(() => {
      clock.restore();
    });

    it('asks once for many callers at the same moment', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      const results = await Promise.all([1, 2, 3].map(() => peerIdentityService.verifyPeer(ADDR.b)));

      sinon.assert.calledOnce(axios.post);
      results.forEach((result) => expect(result.verdict).to.equal(IdentityVerdict.VERIFIED));
    });

    [
      [IdentityVerdict.VERIFIED, 'peerIdentityVerifiedTtlMs', (challenge) => signedAnswer('b', { challenge })],
      [IdentityVerdict.MISROUTED, 'peerIdentityMisroutedTtlMs', (challenge) => signedAnswer('c', { challenge })],
    ].forEach(([verdict, key, answerFor]) => {
      it(`holds a ${verdict} verdict for ${key} and then asks again`, async () => {
        peerAnswers(answerFor);
        const ttl = config.fluxapps[key];

        expect((await peerIdentityService.verifyPeer(ADDR.b)).verdict).to.equal(verdict);
        clock.tick(ttl - 1);
        await peerIdentityService.verifyPeer(ADDR.b);
        sinon.assert.calledOnce(axios.post);

        clock.tick(1);
        await peerIdentityService.verifyPeer(ADDR.b);
        sinon.assert.calledTwice(axios.post);
      });
    });

    it('holds silence only briefly', async () => {
      sinon.stub(axios, 'post').rejects(new Error('timeout of 10000ms exceeded'));

      await peerIdentityService.verifyPeer(ADDR.b);
      clock.tick(config.fluxapps.peerIdentityUnreachableTtlMs);
      await peerIdentityService.verifyPeer(ADDR.b);

      sinon.assert.calledTwice(axios.post);
    });

    it('asks again when a caller wants a fresh answer, and keeps that answer for everyone', async () => {
      const post = peerAnswers((challenge) => signedAnswer('b', { challenge }));
      await peerIdentityService.verifyPeer(ADDR.b);

      post.callsFake(async (_url, body) => ({ data: { status: 'success', data: signedAnswer('c', { challenge: body.challenge }) } }));
      const fresh = await peerIdentityService.verifyPeer(ADDR.b, { fresh: true });
      const held = await peerIdentityService.verifyPeer(ADDR.b);

      expect(fresh.verdict).to.equal(IdentityVerdict.MISROUTED);
      expect(held.verdict, 'the newest answer is the one that stands').to.equal(IdentityVerdict.MISROUTED);
      sinon.assert.calledTwice(axios.post);
    });

    it('holds a verdict per address', async () => {
      peerAnswers((challenge) => signedAnswer('b', { challenge }));

      await peerIdentityService.verifyPeer(ADDR.b);
      await peerIdentityService.verifyPeer('10.0.0.2:16137');

      sinon.assert.calledTwice(axios.post);
    });
  });

  describe('the test double', () => {
    it('carries the module\'s own verdict names', () => {
      expect(makePeerIdentityDouble().IdentityVerdict).to.equal(IdentityVerdict);
    });

    it('answers an address it was told nothing about as a peer that predates the endpoint', async () => {
      const double = makePeerIdentityDouble();
      expect((await double.verifyPeer(ADDR.b)).verdict).to.equal(IdentityVerdict.UNVERIFIABLE);
    });
  });
});
