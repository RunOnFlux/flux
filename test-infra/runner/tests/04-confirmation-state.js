import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForPeers, waitFor } from '../framework/wait.js';
import { restartContainer, execInContainer } from '../framework/container.js';

const node = nodeClient(1);

describe('Boot: confirmation state', function () {
  before(async function () {
    this.timeout(300000);
    await daemon.resetAll();
    await daemon.startTicker();
    await waitForApi(node);
  });

  afterEach(async function () {
    this.timeout(300000);
    // Always restore CONFIRMED and ensure node 01 is healthy for next test
    await daemon.clearNodeStatus(node.ip);
    await waitForApi(node);
  });

  describe('node confirmed (default state)', function () {
    it('should detect status CONFIRMED from daemon', async function () {
      const { stdout } = await execInContainer(1,
        'curl -s -X POST http://198.18.0.3:16124/ -H "Content-Type: application/json" -d \'{"method":"getzelnodestatus","params":[],"id":1}\'',
      );
      const rpc = JSON.parse(stdout);
      expect(rpc.result.status).to.equal('CONFIRMED');
    });

    it('should have peers when confirmed', async function () {
      this.timeout(300000);
      await waitForPeers(node, 1, 300000);
      const res = await node.getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });
  });

  describe('boot into unconfirmed state', function () {
    before(async function () {
      this.timeout(300000);
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      await restartContainer(1);
      await waitForApi(node);
      // Wait for at least two discovery cycles (5s retry in test config)
      await new Promise((r) => setTimeout(r, 15000));
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
      // Restart to get back to confirmed boot path
      await restartContainer(1);
      await waitForApi(node);
    });

    it('should return EXPIRED from daemon RPC', async function () {
      const { stdout } = await execInContainer(1,
        'curl -s -X POST http://198.18.0.3:16124/ -H "Content-Type: application/json" -d \'{"method":"getzelnodestatus","params":[],"id":1}\'',
      );
      const rpc = JSON.parse(stdout);
      expect(rpc.result.status).to.equal('EXPIRED');
    });

    it('should not connect any peers', async function () {
      const res = await node.getPeers();
      expect(res.data).to.have.length(0);
    });

    it('should log discovery awaiting', async function () {
      const { hasLogLine } = await import('../framework/log-reader.js');
      const found = await hasLogLine(1, 'discovery is awaiting');
      expect(found).to.equal(true);
    });
  });

  describe('confirmation loss while running', function () {
    before(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
      await waitForPeers(node, 1, 300000);
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
    });

    it('should drop peers when status changes to EXPIRED', async function () {
      this.timeout(120000);
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      await waitFor(async () => {
        const res = await node.getPeers();
        return res.data.length === 0;
      }, { timeout: 90000, interval: 3000, label: 'peers dropped' });
      const res = await node.getPeers();
      expect(res.data).to.have.length(0);
    });
  });

  describe('confirmation regained after loss', function () {
    before(async function () {
      this.timeout(300000);
      // Put node into EXPIRED state and wait for peers to drop
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      await waitFor(async () => {
        const res = await node.getPeers();
        return res.data.length === 0;
      }, { timeout: 90000, interval: 3000, label: 'peers dropped for setup' });
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
    });

    it('should reconnect peers after status returns to CONFIRMED', async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
      await waitForPeers(node, 1, 300000);
      const res = await node.getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });
  });
});
