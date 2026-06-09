import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { startTicker, advanceBlock, setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForPeersRemoved, waitFor,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

describe('Peers disconnect on confirmation loss (4019)', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should disconnect all peers when node loses confirmation', async function () {
    this.timeout(60000);
    const client = env.clients[0];
    const nodeIp = subnet.nodeIp(1);

    const peersBefore = await client.getPeers();
    expect(peersBefore.data.length).to.be.greaterThan(0);

    await setNodeStatus(nodeIp, 'EXPIRED');
    await waitForNodeStatus(client, (d) => d.confirmed === false, 30000);

    await waitFor(async () => {
      const res = await client.getPeers();
      return res.data.length === 0;
    }, { timeout: 30000, interval: 1000, label: 'all peers disconnected after confirmation loss' });
  });
});

describe('Inbound connections rejected when unconfirmed', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    for (const client of env.clients) await waitForDaemonReady(client);

    const nodeIp = subnet.nodeIp(1);
    await setNodeStatus(nodeIp, 'EXPIRED');
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 30000);

    await Promise.all(env.clients.map(
      (c) => waitForNodeStatus(c, (d) => d.confirmed !== undefined, 30000),
    ));
    await advanceBlock();
    for (const client of env.clients) {
      await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
    }

    const indices = Array.from({ length: 9 }, (_, i) => i + 1);
    await env.startDiscovery(indices);
    await env.clients[1].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
    await startTicker();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should reject inbound peers when not confirmed', async function () {
    this.timeout(30000);
    const client = env.clients[0];

    const inbound = await client.getIncomingPeers();
    expect(inbound.data.length).to.equal(0);

    const outbound = await client.getPeers();
    expect(outbound.data.length).to.equal(0);
  });
});

describe('Full confirmation loss and regain lifecycle', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should disconnect peers on loss and reconnect on regain', async function () {
    this.timeout(180000);
    const client = env.clients[0];
    const observer = env.clients[1];
    const nodeIp = subnet.nodeIp(1);

    const peersBefore = await client.getPeers();
    expect(peersBefore.data.length).to.be.greaterThan(0);

    await setNodeStatus(nodeIp, 'EXPIRED');
    await waitForNodeStatus(client, (d) => d.confirmed === false, 30000);

    await waitFor(async () => {
      const res = await client.getPeers();
      return res.data.length === 0;
    }, { timeout: 30000, interval: 1000, label: 'peers disconnected' });

    await clearNodeStatus(nodeIp);
    await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);

    await waitFor(async () => {
      const res = await client.getPeers();
      return res.data.length >= 4;
    }, { timeout: 120000, interval: 2000, label: 'peers reconnected after confirmation regained' });

    const peersAfter = await client.getPeers();
    expect(peersAfter.data.length).to.be.greaterThan(0);
  });
});
