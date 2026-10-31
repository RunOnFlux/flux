// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import {
  advanceBlock, clearConfirmationSchedule, clearNodeAddress, driveUntil, removeFromNodeList, setConfirmationSchedule,
  setNodeAddress, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A move is signed by the node listed at the address it leaves. The stub peer is
// a listed node with its own key, and broadcasts over the live path two moves
// signed with it: the app holder's address to its own, which every node refuses,
// then its own address to another port on its IP, which every node keeps. Each
// node handles one peer's messages in the order they were sent, so a node that
// holds the second has handled the first. Then the holder drops off the list,
// still running and answering, so its rows stand, and the stub peer signs a move
// away from the holder's address again: the key that last sent apprunning from
// it is the holder's, so every node refuses it.
//
// A move the chain made proves itself for CONFIRMATION_EXPIRY_BLOCKS after it
// was made. The chain moves the stub peer and mines that many blocks more, the
// stub confirming at its new address in each, and the stub signs that move:
// every node refuses it. The chain moves it again and the stub signs that move
// in the next block: every node holds it.
//
// A restarted node judges a move by the blocks its record held before the
// restart: the chain moves the stub once more, every node records the block,
// one restarts with the chain stopped, and the stub signs the move. The stub is
// listed at a port it does not listen on, so the restarted node cannot dial it;
// the move reaches it from the nodes that relay it.
//
// A node down for more than the record's blocks keeps none of what it recorded
// before: one node's FluxOS is held down, the chain moves the stub back to the
// address it listens on and mines past RECORD_BLOCKS, and the node comes back
// and catches up. The stub confirms on fluxd's cadence from the move on, so its
// first confirmation the returning node records falls within 640 blocks of the
// tip. The stub signs that move, more than 640 blocks old: every node refuses
// it. The chain moves the stub again and the stub signs that move in the next
// block: every node holds it.

const REAL_NODES = 3;
const STUB_INDEX = 3;
// Production's location lifetime, so the holder's row is still standing when
// the moves are judged.
const LOCATION_TTL_S = 30 * 60;
// fluxnodeAddressRecord's CONFIRMATION_EXPIRY_BLOCKS and RECORD_BLOCKS.
const CONFIRMATION_EXPIRY_BLOCKS = 640;
const RECORD_BLOCKS = 890;
// Within fluxd's 500-640 blocks between a node's confirmations.
const STUB_CONFIRMATION_INTERVAL = 600;

describe('a move signed by another node is refused', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let stub;
  const appName = `e2eforgedmove${Date.now()}`;
  const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);
  const rowsAt = async (i, address) => (await dbClient(i + 1).getAppLocationsByIp(address)).map((row) => row.name);
  const held = async (i, from, to) => (await dbClient(i + 1).getAppStateEvents({ ip: from, type: 'ipchanged' }))
    .some((event) => event.data?.newIP === to);
  // Mines `count` blocks, and returns once each of `nodes` has processed them and read a list from after them.
  const mineAndRead = async (count, nodes = realNodes) => {
    const anchors = nodes.map((i) => env.clients[i].getLastEventId());
    let tip;
    for (let n = 0; n < count; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      ({ currentHeight: tip } = await advanceBlock());
    }
    await waitFor(async () => (await Promise.all(nodes.map((i) => dbClient(i + 1).explorerHeight()))).every((height) => height >= tip), {
      timeout: 300000, interval: 2000, label: `nodes ${nodes} have processed block ${tip}`,
    });
    // A node fetches the list again on a block, at most once every 30 s, so blocks
    // are mined until each has read one from after them.
    const read = () => nodes.every((i, n) => env.clients[i].getEventBuffer()
      .some((e) => e.id > anchors[n] && e.event === 'networkstate:updated'));
    await driveUntil(env.clients[nodes[0]], async () => read(), {
      timeoutMs: 120000, label: `nodes ${nodes} read the node list from after block ${tip}`,
    });
    return tip;
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES + 1,
      stubPeers: [STUB_INDEX],
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'forged move',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    idx = await seedAndInstall(env, app);
    await waitFor(async () => (await Promise.all(realNodes.map((i) => rowsAt(i, socketAddr(idx + 1)))))
      .every((names) => names.includes(appName)), {
      timeout: 180000, interval: 3000, label: 'every node holds the app at its holder',
    });
    stub = env.stubPeerClients.get(STUB_INDEX);
    await waitFor(async () => (await stub.connectedNodes()) >= REAL_NODES, {
      timeout: 120000, interval: 2000, label: 'every real node is connected to the stub peer',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('keeps the holder\'s rows at its own address, and stores no move from it', async function () {
    this.timeout(180000);
    const holder = socketAddr(idx + 1);
    const stubAddress = socketAddr(STUB_INDEX + 1);
    const stubMovedTo = stubAddress.replace(/:\d+$/, ':16157');

    const forged = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: holder, newIP: stubAddress, broadcastedAt: Date.now(),
    });
    expect(forged.sent, 'fixture: the forged move reached every real node').to.equal(REAL_NODES);
    const honest = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: stubAddress, newIP: stubMovedTo, broadcastedAt: Date.now(),
    });
    expect(honest.sent, 'fixture: the honest move reached every real node').to.equal(REAL_NODES);

    const heldHonest = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: stubAddress, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === stubMovedTo);
    await waitFor(async () => (await Promise.all(realNodes.map(heldHonest))).every(Boolean), {
      timeout: 120000, interval: 2000, label: 'every node holds the stub peer\'s own move',
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      const stored = await dbClient(i + 1).getAppStateEvents({ ip: holder, type: 'ipchanged' });
      expect(stored, `node ${i} stored a move away from the holder signed by another node`).to.have.length(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await rowsAt(i, holder), `node ${i} moved the holder's row away`).to.include(appName);
      // eslint-disable-next-line no-await-in-loop
      expect(await rowsAt(i, stubAddress), `node ${i} gave the holder's row to the stub peer`).to.not.include(appName);
    }
  });

  it('refuses a move away from the holder\'s address once nothing is listed there, signed by a node listed at the new one', async function () {
    this.timeout(240000);
    const holder = socketAddr(idx + 1);
    const stubAddress = socketAddr(STUB_INDEX + 1);
    const stubMovedAgain = stubAddress.replace(/:\d+$/, ':16167');

    const anchors = realNodes.map((i) => env.clients[i].getLastEventId());
    await removeFromNodeList(holder.split(':')[0]);
    await Promise.all(realNodes.map((i) => env.clients[i].waitForEvent('networkstate:updated', (d) => d.nodes === REAL_NODES, 120000, { afterId: anchors[i] })));

    const forged = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: holder, newIP: stubAddress, broadcastedAt: Date.now(),
    });
    expect(forged.sent, 'fixture: the forged move reached every real node').to.equal(REAL_NODES);
    const honest = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: stubAddress, newIP: stubMovedAgain, broadcastedAt: Date.now(),
    });
    expect(honest.sent, 'fixture: the honest move reached every real node').to.equal(REAL_NODES);

    const heldHonest = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: stubAddress, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === stubMovedAgain);
    await waitFor(async () => (await Promise.all(realNodes.map(heldHonest))).every(Boolean), {
      timeout: 120000, interval: 2000, label: 'every node holds the stub peer\'s second move of its own',
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      const stored = await dbClient(i + 1).getAppStateEvents({ ip: holder, type: 'ipchanged' });
      expect(stored, `node ${i} stored a move away from the unlisted holder signed by another node`).to.have.length(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await rowsAt(i, holder), `node ${i} moved the unlisted holder's row away`).to.include(appName);
      // eslint-disable-next-line no-await-in-loop
      expect(await rowsAt(i, stubAddress), `node ${i} gave the unlisted holder's row to the stub peer`).to.not.include(appName);
    }
  });

  it('refuses a move the chain made more than 640 blocks ago, and holds one it made in the last block', async function () {
    this.timeout(600000);
    const stubAddress = socketAddr(STUB_INDEX + 1);
    const stubIp = stubAddress.split(':')[0];
    const staleTo = `${stubIp}:16177`;
    const freshTo = `${stubIp}:16187`;

    await setNodeAddress(stubIp, staleTo, { scope: 'all' });
    await mineAndRead(1 + CONFIRMATION_EXPIRY_BLOCKS);

    const stale = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: stubAddress, newIP: staleTo, broadcastedAt: Date.now(),
    });
    expect(stale.sent, 'fixture: the stale move reached every real node').to.equal(REAL_NODES);

    await setNodeAddress(stubIp, freshTo, { scope: 'all' });
    await mineAndRead(1);
    const fresh = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: staleTo, newIP: freshTo, broadcastedAt: Date.now(),
    });
    expect(fresh.sent, 'fixture: the fresh move reached every real node').to.equal(REAL_NODES);

    await waitFor(async () => (await Promise.all(realNodes.map((i) => held(i, staleTo, freshTo)))).every(Boolean), {
      timeout: 120000, interval: 2000, label: 'every node holds the move the chain made in the last block',
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await held(i, stubAddress, staleTo), `node ${i} held a move the chain made ${CONFIRMATION_EXPIRY_BLOCKS + 1} blocks ago`).to.equal(false);
    }
  });

  it('holds a move a restarted node hears before the chain has moved on', async function () {
    this.timeout(600000);
    const stubIp = socketAddr(STUB_INDEX + 1).split(':')[0];
    const from = `${stubIp}:16187`;
    const to = `${stubIp}:16197`;
    // A listed node: the holder left the list in the case above.
    const restarted = realNodes.find((i) => i !== idx);
    const others = realNodes.filter((i) => i !== restarted);

    await setNodeAddress(stubIp, to, { scope: 'all' });
    await mineAndRead(1);
    // No block arrives after the restart, so the restarted node's record holds
    // only what it held before.
    await stopTicker();
    try {
      await env.restartNode(restarted);
      const client = env.clients[restarted];
      await waitForDaemonReady(client);
      const otherIps = others.map((i) => env.clients[i].ip);
      await waitFor(async () => {
        const [outgoing, incoming] = await Promise.all([client.getPeers(), client.getIncomingPeers()]);
        const ipOf = (peer) => String(typeof peer === 'string' ? peer : peer?.ip).split(':')[0];
        return [...(outgoing.data ?? []), ...(incoming.data ?? [])].some((peer) => otherIps.includes(ipOf(peer)));
      }, { timeout: 180000, interval: 2000, label: 'the restarted node is connected to a node that did not restart' });

      const move = await stub.broadcast({
        type: 'fluxipchanged', version: 1, oldIP: from, newIP: to, broadcastedAt: Date.now(),
      });
      expect(move.sent, 'fixture: the move reached every node that did not restart').to.equal(others.length);

      await waitFor(async () => (await Promise.all(others.map((i) => held(i, from, to)))).every(Boolean), {
        timeout: 120000, interval: 2000, label: 'every node that did not restart holds the move',
      });
      await waitFor(async () => held(restarted, from, to), {
        timeout: 120000, interval: 2000, label: 'the restarted node holds the move',
      });
    } finally {
      await startTicker();
    }
  });

  it('refuses a move the chain made more than 640 blocks before a node that was down caught up', async function () {
    this.timeout(1800000);
    const stubAddress = socketAddr(STUB_INDEX + 1);
    const stubIp = stubAddress.split(':')[0];
    const from = `${stubIp}:16197`;
    const freshTo = `${stubIp}:16227`;
    // A listed node: the holder left the list in an earlier case.
    const down = realNodes.find((i) => i !== idx);
    const up = realNodes.filter((i) => i !== down);
    const client = env.clients[down];

    await stopTicker();
    try {
      await crashFluxos(client.container, { hold: true });
      await setConfirmationSchedule(stubIp, { intervalBlocks: STUB_CONFIRMATION_INTERVAL });
      // Back to the address it listens on, so the returning node can dial it.
      await clearNodeAddress(stubIp);
      const tip = await mineAndRead(1 + RECORD_BLOCKS + 10, up);
      const mark = client.getLastEventId();
      await releaseFluxos(client.container);
      // The event stream does not outlive FluxOS, so it is opened again on the new process.
      client.disconnectEventStream();
      await client.connectEventStream();
      await waitForDaemonReady(client, 120000, { afterId: mark });
      await waitFor(async () => (await dbClient(down + 1).explorerHeight()) >= tip, {
        timeout: 600000, interval: 5000, label: `the returning node has caught up to block ${tip}`,
      });
      await waitFor(async () => (await stub.connectedNodes()) >= REAL_NODES, {
        timeout: 180000, interval: 2000, label: 'every real node is connected to the stub peer',
      });

      const stale = await stub.broadcast({
        type: 'fluxipchanged', version: 1, oldIP: from, newIP: stubAddress, broadcastedAt: Date.now(),
      });
      expect(stale.sent, 'fixture: the stale move reached every real node').to.equal(REAL_NODES);

      await setNodeAddress(stubIp, freshTo, { scope: 'all' });
      await mineAndRead(1);
      const fresh = await stub.broadcast({
        type: 'fluxipchanged', version: 1, oldIP: stubAddress, newIP: freshTo, broadcastedAt: Date.now(),
      });
      expect(fresh.sent, 'fixture: the fresh move reached every real node').to.equal(REAL_NODES);

      await waitFor(async () => (await Promise.all(realNodes.map((i) => held(i, stubAddress, freshTo)))).every(Boolean), {
        timeout: 120000, interval: 2000, label: 'every node holds the move the chain made in the last block',
      });
      // eslint-disable-next-line no-restricted-syntax
      for (const i of realNodes) {
        // eslint-disable-next-line no-await-in-loop
        expect(await held(i, from, stubAddress), `node ${i} held a move the chain made ${RECORD_BLOCKS + 11} blocks ago`).to.equal(false);
      }
    } finally {
      await clearConfirmationSchedule(stubIp);
      await startTicker();
    }
  });
});
