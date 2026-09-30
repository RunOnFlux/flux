// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const peerIdentityService = require('../../ZelBack/src/services/peerIdentityService');
const { PeerComponent, componentStateOnPeers } = require('../../ZelBack/src/services/appMonitoring/peerComponent');

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
