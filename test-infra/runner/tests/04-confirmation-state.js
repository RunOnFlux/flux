import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForPeers } from '../framework/wait.js';
import { restartContainer, execInContainer } from '../framework/container.js';
import { hasLogLine } from '../framework/log-reader.js';

const node = nodeClient(1);

describe('Boot: confirmation state', function () {
  before(async function () {
    await daemon.resetAll();
    await daemon.startTicker();
    await waitForApi(node);
  });

  afterEach(async function () {
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

    it('should connect peers when confirmed', async function () {
      await waitForPeers(node, 1);
      const res = await node.getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });
  });

  describe('boot into unconfirmed state', function () {
    before(async function () {
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      await restartContainer(1);
      await waitForApi(node);
    });

    after(async function () {
      await daemon.clearNodeStatus(node.ip);
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

    it('should log discovery awaiting', async function () {
      const found = await hasLogLine(1, 'discovery is awaiting');
      expect(found).to.equal(true);
    });
  });

  describe('confirmation loss at runtime (development baseline)', function () {
    before(async function () {
      await daemon.clearNodeStatus(node.ip);
      await waitForPeers(node, 1);
    });

    after(async function () {
      await daemon.clearNodeStatus(node.ip);
    });

    it('should return EXPIRED from daemon after override set', async function () {
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      const { stdout } = await execInContainer(1,
        'curl -s -X POST http://198.18.0.3:16124/ -H "Content-Type: application/json" -d \'{"method":"getzelnodestatus","params":[],"id":1}\'',
      );
      const rpc = JSON.parse(stdout);
      expect(rpc.result.status).to.equal('EXPIRED');
    });

    it('should log node not confirmed on next monitor cycle', async function () {
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      // monitorNodeStatus runs every 10s in test config
      await new Promise((r) => setTimeout(r, 15000));
      const found = await hasLogLine(1, 'not.*[Cc]onfirmed|discovery is awaiting');
      expect(found).to.equal(true);
    });
  });
});
