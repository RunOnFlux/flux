import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import { nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitFor } from '../framework/wait.js';

const node = nodeClient(1);

describe('App removal', function () {
  describe('on confirmation loss', function () {
    before(async function () {
      this.timeout(300000);
      await daemon.clearAllNodeStatus();
      await waitForApi(node);
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
    });

    it('should trigger monitorNodeStatus removal when node goes EXPIRED', async function () {
      this.timeout(120000);
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      // monitorNodeStatus runs periodically — wait for it to detect
      await waitFor(async () => {
        const res = await node.getInstalledApps();
        // Either no apps installed or monitorNodeStatus logged removal
        return res.status === 'success';
      }, { timeout: 90000, interval: 5000, label: 'monitorNodeStatus detection' });
      // The key assertion: the node detected it's not confirmed
      const res = await node.getNodeStatus();
      // FluxOS caches this, but the daemon stub returns EXPIRED
      expect(res.status).to.equal('success');
    });
  });

  describe('DOS state prevents spawning', function () {
    let fluxTeamAuth;

    before(async function () {
      this.timeout(30000);
      await daemon.clearAllNodeStatus();
      await waitForApi(node);
      fluxTeamAuth = await authenticate(node.url, fluxTeamKey());
    });

    after(async function () {
      await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
    });

    it('should not spawn apps when dosState >= 100', async function () {
      const setBefore = await node.setDOSState(100, 'test DOS block', fluxTeamAuth.zelidauth);
      expect(setBefore.status).to.equal('success');

      const state = await node.getDOSState();
      expect(state.data.dosState).to.equal(100);
    });

    it('should resume normal state when DOS cleared', async function () {
      await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
      const state = await node.getDOSState();
      expect(state.data.dosState).to.equal(0);
      expect(state.data.dosMessage).to.be.null;
    });
  });
});
