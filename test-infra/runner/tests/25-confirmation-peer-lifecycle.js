import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { startTicker, advanceBlock, setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForPeersRemoved,
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
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
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
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
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

    // The peer routes are cached for 30 seconds (apicache, routes.js) and the
    // read above populates that entry, so a peer count fetched over HTTP
    // describes the fleet as it stood before this test touched it. The peer
    // manager publishes each change as it happens, uncached, and is the only
    // source that can witness a transition. The anchor confines the wait to
    // changes after this point - the event buffer holds every one since boot.
    const beforeLoss = client.getLastEventId();

    await setNodeStatus(nodeIp, 'EXPIRED');
    await waitForNodeStatus(client, (d) => d.confirmed === false, 30000);

    await waitForPeersRemoved(client, (d) => d.total === 0, 30000, { afterId: beforeLoss });
  });
});

describe('Inbound connections rejected when unconfirmed', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    for (const client of env.clients) await waitForDaemonReady(client);

    const nodeIp = subnet.nodeIp(1);
    await setNodeStatus(nodeIp, 'EXPIRED');
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 30000);

    await Promise.all(env.clients.map(
      (c) => waitForNodeStatus(c, (d) => d.confirmed !== undefined, 30000),
    ));
    await advanceBlock();
    for (const client of env.clients) {
      await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
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
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should disconnect peers on loss and reconnect on regain', async function () {
    this.timeout(180000);
    const client = env.clients[0];
    const nodeIp = subnet.nodeIp(1);

    const peersBefore = await client.getPeers();
    expect(peersBefore.data.length).to.be.greaterThan(0);

    // Both transitions are witnessed through the peer manager's events, which
    // carry the counts as they change and sit behind no cache. The peer routes
    // are cached for 30 seconds (apicache, routes.js) and the read above
    // populates that entry, so an HTTP peer count here describes the fleet as it
    // stood before the status changed. Each wait is anchored on the event id
    // taken before its own trigger, because the buffer holds every peer change
    // since boot and an unanchored wait can be satisfied by one of those.
    const beforeLoss = client.getLastEventId();

    await setNodeStatus(nodeIp, 'EXPIRED');
    await waitForNodeStatus(client, (d) => d.confirmed === false, 30000);

    await waitForPeersRemoved(client, (d) => d.total === 0, 30000, { afterId: beforeLoss });

    const beforeRegain = client.getLastEventId();

    await clearNodeStatus(nodeIp);
    await waitForNodeStatus(client, (d) => d.confirmed === true, 30000);

    // outbound is the count /flux/connectedpeers reports, and 4 is the peering
    // target the fleet boots to - so this is the node back to full strength,
    // not merely holding one peer again.
    await client.waitForEvent('peers:added', (d) => d.outbound >= 4, 120000, { afterId: beforeRegain });
  });
});
