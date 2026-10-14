// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const realConfig = require('config');

const messageHelper = require('../../ZelBack/src/services/messageHelper');
const socketAddressUtils = require('../../ZelBack/src/services/utils/socketAddressUtils');
const { makePeerIdentityDouble } = require('./peerIdentityTestDouble');

const LOCAL = '119.246.12.164:16157';

/**
 * The service with everything it reaches outside itself replaced. The network
 * helper carries only what the service may use: a DOS setter present on it would
 * be one the service could call without any test noticing.
 */
function loadService() {
  const fluxNetworkHelper = {
    getLocalSocketAddress: sinon.stub().resolves(LOCAL),
  };
  const networkStateService = { getRandomExternalObserver: sinon.stub().resolves(null) };
  const identity = makePeerIdentityDouble();
  const events = { publish: sinon.stub(), count: sinon.stub() };
  const log = {
    info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
  };
  const config = { fluxapps: { ...realConfig.fluxapps } };
  const service = proxyquire('../../ZelBack/src/services/outboundPathService', {
    config,
    '../lib/log': log,
    './messageHelper': messageHelper,
    './fluxNetworkHelper': fluxNetworkHelper,
    './networkStateService': networkStateService,
    './peerIdentityService': identity,
    './utils/fluxEventBus': events,
    './utils/socketAddressUtils': socketAddressUtils,
  });
  return {
    service, fluxNetworkHelper, networkStateService, identity, events, log,
  };
}

/**
 * The observer picker hands out these, in order, one per check.
 */
function observersInTurn(networkStateService, ...observers) {
  observers.forEach((observer, i) => networkStateService.getRandomExternalObserver.onCall(i).resolves(observer));
}

describe('outboundPathService', () => {
  describe('the verdict', () => {
    let t;

    beforeEach(() => {
      t = loadService();
    });

    afterEach(() => {
      t.service.reset();
    });

    it('learns nothing while this node does not know its own address, and asks nobody', async () => {
      t.fluxNetworkHelper.getLocalSocketAddress.resolves(null);

      expect(await t.service.checkOnce()).to.equal(null);

      sinon.assert.notCalled(t.networkStateService.getRandomExternalObserver);
      sinon.assert.notCalled(t.identity.verifyPeer);
      expect(t.service.getStatus().state).to.equal(t.service.OutboundPath.UNKNOWN);
    });

    it('learns nothing when no node on another IP listens on this port', async () => {
      expect(await t.service.checkOnce()).to.equal(null);

      sinon.assert.notCalled(t.identity.verifyPeer);
      sinon.assert.calledWith(t.events.count, 'outboundPath:check', 'noObserver');
      expect(t.service.getStatus().state).to.equal(t.service.OutboundPath.UNKNOWN);
    });

    // A router must forward this node's own API port to this node, so a router
    // that forwards by port alone redirects a call on that port without
    // exception. An observer on any other port could pass on such a router.
    it('asks an observer on another IP that listens on this node\'s own API port, and asks it fresh', async () => {
      observersInTurn(t.networkStateService, '1.1.1.1:16157');
      t.identity.verified('1.1.1.1:16157');

      await t.service.checkOnce();

      sinon.assert.calledWith(t.networkStateService.getRandomExternalObserver, LOCAL, { port: 16157, exclude: [] });
      sinon.assert.calledWith(t.identity.verifyPeer, '1.1.1.1:16157', { fresh: true });
    });

    it('calls the path clear when an observer answers as itself', async () => {
      observersInTurn(t.networkStateService, '1.1.1.1:16157');
      t.identity.verified('1.1.1.1:16157');

      await t.service.checkOnce();

      const status = t.service.getStatus();
      expect(status.state).to.equal(t.service.OutboundPath.CLEAR);
      expect(status.port).to.equal(16157);
      expect(status.since).to.be.a('string');
      sinon.assert.calledWith(t.events.publish, 'outboundPath:clear', sinon.match({ observer: '1.1.1.1:16157', previous: 'unknown' }));
    });

    it('does not call one observer answering as another node a redirect', async () => {
      observersInTurn(t.networkStateService, '94.59.60.29:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');

      await t.service.checkOnce();

      expect(t.service.getStatus().state).to.equal(t.service.OutboundPath.UNKNOWN);
      expect(t.service.getStatus().witnesses).to.have.length(1);
      sinon.assert.neverCalledWith(t.events.publish, 'outboundPath:redirected');
    });

    it('asks a DIFFERENT IP for the second witness', async () => {
      observersInTurn(t.networkStateService, '94.59.60.29:16157', '1.1.1.1:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');

      await t.service.checkOnce();
      await t.service.checkOnce();

      sinon.assert.calledWith(
        t.networkStateService.getRandomExternalObserver.secondCall,
        LOCAL,
        { port: 16157, exclude: ['94.59.60.29:16157'] },
      );
    });

    it('calls the path redirected once two observers on distinct IPs have answered as other nodes', async () => {
      observersInTurn(t.networkStateService, '94.59.60.29:16157', '1.1.1.1:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');
      t.identity.misrouted('1.1.1.1:16157', '119.246.12.164:16157');

      await t.service.checkOnce();
      await t.service.checkOnce();

      const status = t.service.getStatus();
      expect(status.state).to.equal(t.service.OutboundPath.REDIRECTED);
      expect(t.service.isRedirected()).to.equal(true);
      expect(status.witnesses.map((w) => [w.dialled, w.answeredAs])).to.deep.equal([
        ['94.59.60.29:16157', '119.246.12.164:16147'],
        ['1.1.1.1:16157', '119.246.12.164:16157'],
      ]);
      sinon.assert.calledWith(t.events.publish, 'outboundPath:redirected', sinon.match({ port: 16157 }));
      sinon.assert.calledWith(t.log.error, sinon.match(/port 16157.*119\.246\.12\.164:16147, 119\.246\.12\.164:16157/));
    });

    // The node list holds a node on the default API port as a bare IP, while a
    // signed answer names its address with the port.
    it('reports an observer on the default API port with its port, as the answers name it', async () => {
      t.fluxNetworkHelper.getLocalSocketAddress.resolves('119.246.12.164:16127');
      observersInTurn(t.networkStateService, '94.59.60.29', '1.1.1.1', '8.8.8.8');
      t.identity.misrouted('94.59.60.29:16127', '119.246.12.164:16127');
      t.identity.misrouted('1.1.1.1:16127', '119.246.12.164:16127');
      t.identity.verified('8.8.8.8:16127');

      await t.service.checkOnce();
      await t.service.checkOnce();

      sinon.assert.calledWith(t.identity.verifyPeer, '94.59.60.29:16127', { fresh: true });
      sinon.assert.calledWith(t.events.publish, 'outboundPath:redirected', sinon.match({
        witnesses: [
          { dialled: '94.59.60.29:16127', answeredAs: '119.246.12.164:16127' },
          { dialled: '1.1.1.1:16127', answeredAs: '119.246.12.164:16127' },
        ],
      }));

      await t.service.checkOnce();

      sinon.assert.calledWith(t.events.publish, 'outboundPath:clear', sinon.match({ observer: '8.8.8.8:16127', previous: 'redirected' }));
    });

    it('is not redirected until proven, and not after an observer answers as itself', async () => {
      expect(t.service.isRedirected()).to.equal(false);
      observersInTurn(t.networkStateService, '94.59.60.29:16157', '1.1.1.1:16157', '8.8.8.8:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');
      t.identity.misrouted('1.1.1.1:16157', '119.246.12.164:16157');
      t.identity.verified('8.8.8.8:16157');

      await t.service.checkOnce();
      expect(t.service.isRedirected(), 'one witness').to.equal(false);
      await t.service.checkOnce();
      expect(t.service.isRedirected(), 'two witnesses').to.equal(true);
      await t.service.checkOnce();
      expect(t.service.isRedirected(), 'an observer answered as itself').to.equal(false);
      sinon.assert.calledWith(t.events.publish, 'outboundPath:clear', sinon.match({ previous: 'redirected' }));
    });

    it('does not count one IP twice', async () => {
      observersInTurn(t.networkStateService, '94.59.60.29:16157', '94.59.60.29:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');

      await t.service.checkOnce();
      await t.service.checkOnce();

      expect(t.service.getStatus().state).to.equal(t.service.OutboundPath.UNKNOWN);
    });

    it('starts the count again after an observer answers as itself', async () => {
      observersInTurn(t.networkStateService, '94.59.60.29:16157', '8.8.8.8:16157', '1.1.1.1:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');
      t.identity.verified('8.8.8.8:16157');
      t.identity.misrouted('1.1.1.1:16157', '119.246.12.164:16157');

      await t.service.checkOnce();
      await t.service.checkOnce();
      await t.service.checkOnce();

      expect(t.service.getStatus().state).to.equal(t.service.OutboundPath.CLEAR);
      expect(t.service.getStatus().witnesses).to.have.length(1);
    });

    [
      ['silence', (t2, address) => t2.identity.unreachable(address)],
      ['an answer that proves nothing', () => {}],
    ].forEach(([what, arrange]) => {
      it(`changes nothing on ${what}`, async () => {
        observersInTurn(t.networkStateService, '94.59.60.29:16157', '1.1.1.1:16157', '8.8.8.8:16157');
        t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');
        t.identity.misrouted('1.1.1.1:16157', '119.246.12.164:16157');
        arrange(t, '8.8.8.8:16157');

        await t.service.checkOnce();
        await t.service.checkOnce();
        await t.service.checkOnce();

        expect(t.service.getStatus().state).to.equal(t.service.OutboundPath.REDIRECTED);
        expect(t.service.getStatus().witnesses).to.have.length(2);
      });
    });

    it('draws from every IP once the redirect is proven', async () => {
      observersInTurn(t.networkStateService, '94.59.60.29:16157', '1.1.1.1:16157', '8.8.8.8:16157');
      t.identity.misrouted('94.59.60.29:16157', '119.246.12.164:16147');
      t.identity.misrouted('1.1.1.1:16157', '119.246.12.164:16157');

      await t.service.checkOnce();
      await t.service.checkOnce();
      await t.service.checkOnce();

      expect(t.networkStateService.getRandomExternalObserver.thirdCall.args[1].exclude).to.deep.equal([]);
    });

    it('never runs two checks at once, and never throws', async () => {
      let release;
      t.networkStateService.getRandomExternalObserver.callsFake(() => new Promise((resolve) => { release = resolve; }));

      const first = t.service.runCheck();
      const second = t.service.runCheck();
      await second;
      release('1.1.1.1:16157');
      await first;
      sinon.assert.calledOnce(t.networkStateService.getRandomExternalObserver);

      t.networkStateService.getRandomExternalObserver.rejects(new Error('network state went away'));
      await t.service.runCheck();
      sinon.assert.calledWith(t.log.error, sinon.match(/network state went away/));
    });

    it('serves its status on the API', async () => {
      const res = { json: sinon.stub().returnsArg(0) };

      const answer = t.service.outboundPathAPI({}, res);

      expect(answer.status).to.equal('success');
      expect(answer.data).to.deep.equal({
        state: 'unknown', since: null, port: null, witnesses: [],
      });
    });

    it('checks as soon as it starts, then on its interval, and stops checking when stopped', async () => {
      const clock = sinon.useFakeTimers();
      try {
        t.service.start();
        await clock.tickAsync(0);
        sinon.assert.calledOnce(t.networkStateService.getRandomExternalObserver);

        await clock.tickAsync(realConfig.fluxapps.outboundPathCheckIntervalMs);
        sinon.assert.calledTwice(t.networkStateService.getRandomExternalObserver);

        t.service.stop();
        await clock.tickAsync(realConfig.fluxapps.outboundPathCheckIntervalMs * 3);
        sinon.assert.calledTwice(t.networkStateService.getRandomExternalObserver);
      } finally {
        clock.restore();
      }
    });
  });
});
