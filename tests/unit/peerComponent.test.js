// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const peerIdentityService = require('../../ZelBack/src/services/peerIdentityService');
const { PeerComponent, componentStateOnPeers, componentStateOnOtherHolders } = require('../../ZelBack/src/services/appMonitoring/peerComponent');

describe('peerComponent tests', () => {
  const appId = 'fluxw_a';
  const ctx = {
    appId, identifier: 'w_a', appName: 'a', liveness: {}, logPrefix: 'test',
  };

  // Each peer answers /apps/heldcomponents with what it holds; a peer given a
  // status answers with that error status instead - alive, and unreadable.
  const peersAnswer = (answers) => sinon.stub(axios, 'get').callsFake((url) => {
    const ip = Object.keys(answers).find((addr) => url.includes(`//${addr}/`));
    const answer = answers[ip];
    if (answer.status) return Promise.reject(Object.assign(new Error(`status ${answer.status}`), { response: { status: answer.status } }));
    return Promise.resolve({ data: { data: answer.held } });
  });

  // Every peer here predates the identity endpoint, and is read unsigned.
  beforeEach(() => {
    sinon.stub(peerIdentityService, 'askSigned').resolves({
      verdict: peerIdentityService.IdentityVerdict.UNVERIFIABLE, status: 404, data: null, mayReadUnsigned: true,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  // The question a primary returning paused asks, from the election and from
  // the folder monitor alike: what every other holder is doing with it.
  describe('componentStateOnOtherHolders', () => {
    const SELF = '1.1.1.1:16127';
    const asked = () => axios.get.getCalls().map((call) => call.args[0].split('/')[2]).sort();

    it('asks every other holder its locations name, and not this node', async () => {
      peersAnswer({ '2.2.2.2:16127': { held: [] }, '3.3.3.3:16137': { held: [appId] } });
      const read = sinon.stub().resolves([{ ip: SELF }, { ip: '2.2.2.2:16127' }, { ip: '3.3.3.3:16137' }]);

      expect(await componentStateOnOtherHolders(read, SELF, ctx)).to.equal(PeerComponent.RUNNING);
      sinon.assert.calledOnceWithExactly(read, 'a');
      expect(asked()).to.deep.equal(['2.2.2.2:16127', '3.3.3.3:16137']);
    });

    // FDM names a node by IP alone.
    it('asks a node FDM names that no location shares an IP with, and a listed one once, at its recorded address', async () => {
      peersAnswer({ '2.2.2.2:16137': { held: [] }, '4.4.4.4:16127': { held: [] } });
      const read = sinon.stub().resolves([{ ip: SELF }, { ip: '2.2.2.2:16137' }]);

      expect(await componentStateOnOtherHolders(read, SELF, ctx, { also: ['4.4.4.4', '2.2.2.2', '1.1.1.1'] }))
        .to.equal(PeerComponent.NOT_RUNNING);
      expect(asked()).to.deep.equal(['2.2.2.2:16137', '4.4.4.4:16127']);
    });

    it('answers UNKNOWN, asking no one, when the locations cannot be read', async () => {
      const probe = sinon.stub(axios, 'get').rejects(new Error('no peer should be probed'));
      const read = sinon.stub().rejects(new Error('database unavailable'));

      expect(await componentStateOnOtherHolders(read, SELF, ctx, { also: ['4.4.4.4:16127'] })).to.equal(PeerComponent.UNKNOWN);
      sinon.assert.notCalled(probe);
    });
  });

  describe('componentStateOnPeers', () => {
    it('answers NOT_RUNNING with no one to ask, and asks no one', async () => {
      const probe = sinon.stub(axios, 'get').rejects(new Error('no peer should be probed'));

      expect(await componentStateOnPeers([], ctx)).to.equal(PeerComponent.NOT_RUNNING);
      sinon.assert.notCalled(probe);
    });

    it('answers NOT_RUNNING when every peer holds something else', async () => {
      peersAnswer({ '1.1.1.1:16127': { held: ['fluxother_b'] }, '2.2.2.2:16127': { held: [] } });

      const state = await componentStateOnPeers([
        { ip: '1.1.1.1:16127', label: 'index 0' }, { ip: '2.2.2.2:16127', label: 'index 1' },
      ], ctx);

      expect(state).to.equal(PeerComponent.NOT_RUNNING);
    });

    it('answers RUNNING when one peer holds it, whatever the others answer', async () => {
      peersAnswer({ '1.1.1.1:16127': { status: 500 }, '2.2.2.2:16127': { held: [appId] } });

      const state = await componentStateOnPeers([
        { ip: '1.1.1.1:16127', label: 'index 0' }, { ip: '2.2.2.2:16127', label: 'index 1' },
      ], ctx);

      expect(state).to.equal(PeerComponent.RUNNING);
    });

    it('answers UNKNOWN when one peer cannot be ruled out and none holds it', async () => {
      peersAnswer({ '1.1.1.1:16127': { held: [] }, '2.2.2.2:16127': { status: 500 } });

      const state = await componentStateOnPeers([
        { ip: '1.1.1.1:16127', label: 'index 0' }, { ip: '2.2.2.2:16127', label: 'index 1' },
      ], ctx);

      expect(state).to.equal(PeerComponent.UNKNOWN);
    });
  });
});
