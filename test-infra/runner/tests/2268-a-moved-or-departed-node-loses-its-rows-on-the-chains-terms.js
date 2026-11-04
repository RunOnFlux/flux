import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { moveNodeAddress } from '../framework/container.js';
import {
  clearNodeAddress, clearNodeStatus, getState, removeFromNodeList, restoreToNodeList, setNodeAddress, setNodeStatus,
} from '../framework/daemon-control.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The node list and the chain's record of moves decide when a node's location
// rows go, and every peer reads the same two.
//
// A node that sends no move: the chain moved it, and it may have kept its
// collateral and started empty. Its rows wait 40 blocks from the block that moved
// it, then go from every peer. Holding it before it tells its move is what such a
// node looks like from outside.
//
// A node that moved and then left the list: nothing is left to wait for.
//
// A node the list dropped whose own daemon still says CONFIRMED: the list decides,
// so its rows go within a list update, whatever it says of itself.
//
// Nodes 1 and 2 watch. Node 0 never tells its move, node 3 moves and is dropped,
// node 4 is dropped.
const SILENT = 0;
const MOVED_THEN_GONE = 3;
const DROPPED = 4;
const WATCHERS = [1, 2];
const API_PORT = 16127;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';
const DETECTION_MS = 6 * 60 * 1000;
// ADDRESS_MOVE_GRACE_BLOCKS.
const GRACE_BLOCKS = 40;
// Two list refreshes, the most any two peers' passes are apart, and a poll of it.
const LIST_UPDATES_MS = 75 * 1000;
// Production's location lifetime, so only an eviction takes the rows.
const LOCATION_TTL_S = 30 * 60;

describe('a moved or departed node loses its rows on the chain\'s terms', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const moved = [];
  const held = [];
  const dropped = [];
  const stamp = Date.now();
  const apps = {
    [SILENT]: `e2esilent${stamp}`,
    [MOVED_THEN_GONE]: `e2emovedgone${stamp}`,
    [DROPPED]: `e2edropped${stamp}`,
  };
  const client = (i) => env.clients[i];
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const rowsAt = async (j, socket, name) => (await dbClient(j + 1).getAppLocationsByIp(socket)).filter((row) => row.name === name);
  const awaitingMove = async (j, socket) => (await client(j).getTestCounters())['location:awaitingMove']?.[socket] ?? 0;
  const evictedAt = async (j, socket) => {
    const [eviction] = await dbClient(j + 1).getAppStateEvents({ ip: socket, type: 'evicted' });
    return eviction ? new Date(eviction.createdAt).getTime() : null;
  };

  // Moves node `i`, holds it before it tells the move, and has the chain list it
  // at the new address. Returns the block before the one that moved it.
  const moveAndHold = async (i, lastOctet) => {
    const node = client(i);
    const fromIp = node.ip;
    const toIp = fromIp.replace(/\.\d+$/, `.${lastOctet}`);
    const newSocket = socketOf(toIp);
    await node.holdCheckpoint(BEFORE_RECONCILE, newSocket);
    held.push([i, newSocket]);
    const anchor = node.getLastEventId();
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved.push(fromIp);
    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);
    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === newSocket, DETECTION_MS, { afterId: anchor });
    const { currentHeight: height } = await getState();
    await setNodeAddress(fromIp, toIp, { scope: 'all' });
    return { fromIp, oldSocket: socketOf(fromIp), height };
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(Object.entries(apps).map(async ([index, name]) => {
      await pushImage(name, 'v1');
      const app = await buildSeedableApp({
        name,
        instances: 1,
        compose: [{
          name: 'alpha',
          description: 'loses its rows on the chain\'s terms',
          repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
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
      await installOnNodes(env, app, [Number(index)]);
      await waitFor(async () => (await Promise.all(WATCHERS.map(async (j) => (await rowsAt(j, socketOf(client(Number(index)).ip), name)).length > 0))).every(Boolean), {
        timeout: 180000, interval: 3000, label: `every watcher holds ${name}`,
      });
    }));
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all(held.map(([i, socket]) => client(i).releaseCheckpoint(BEFORE_RECONCILE, socket).catch(() => {})));
    await Promise.all(dropped.map((ip) => Promise.all([restoreToNodeList(ip).catch(() => {}), clearNodeStatus(ip).catch(() => {})])));
    await Promise.all(moved.map((ip) => clearNodeAddress(ip).catch(() => {})));
    await env?.teardown();
  });

  it('takes the rows of a node the list dropped within a list update, whatever its own daemon says', async function () {
    this.timeout(300000);
    const { ip } = client(DROPPED);
    const socket = socketOf(ip);
    await setNodeStatus(ip, 'CONFIRMED');
    dropped.push(ip);
    await removeFromNodeList(ip);
    const droppedAt = Date.now();

    await Promise.all(WATCHERS.map((j) => waitFor(async () => (await rowsAt(j, socket, apps[DROPPED])).length === 0, {
      timeout: LIST_UPDATES_MS, interval: 1000, label: `node ${j} evicts the dropped node`,
    })));
    const times = await Promise.all(WATCHERS.map((j) => evictedAt(j, socket)));
    expect(times.every((at) => at !== null && at >= droppedAt), 'every watcher evicted it after it was dropped').to.equal(true);
  });

  it('takes the rows of a node that moved and left the list, without waiting for the move', async function () {
    this.timeout(DETECTION_MS + 300000);
    const { fromIp, oldSocket } = await moveAndHold(MOVED_THEN_GONE, 243);
    await Promise.all(WATCHERS.map((j) => waitFor(async () => await awaitingMove(j, oldSocket) > 0, {
      timeout: 180000, interval: 3000, label: `fixture: node ${j} leaves its rows to the move`,
    })));
    const before = await Promise.all(WATCHERS.map((j) => rowsAt(j, oldSocket, apps[MOVED_THEN_GONE])));
    expect(before.every((rows) => rows.length === 1), 'fixture: every watcher still holds the rows').to.equal(true);

    dropped.push(fromIp);
    await removeFromNodeList(fromIp);

    await Promise.all(WATCHERS.map((j) => waitFor(async () => (await rowsAt(j, oldSocket, apps[MOVED_THEN_GONE])).length === 0, {
      timeout: LIST_UPDATES_MS, interval: 1000, label: `node ${j} evicts the node that moved and left`,
    })));
  });

  it('keeps the rows of a node that sends no move for 40 blocks, then every peer takes them', async function () {
    this.timeout(DETECTION_MS + 600000);
    const { oldSocket, height } = await moveAndHold(SILENT, 244);
    await Promise.all(WATCHERS.map((j) => waitFor(async () => await awaitingMove(j, oldSocket) > 0, {
      timeout: 180000, interval: 3000, label: `node ${j} leaves its rows to the move`,
    })));

    const heights = {};
    await Promise.all(WATCHERS.map((j) => waitFor(async () => {
      const gone = (await rowsAt(j, oldSocket, apps[SILENT])).length === 0;
      if (gone) heights[j] ??= (await getState()).currentHeight;
      return gone;
    }, {
      timeout: 600000, interval: 1000, label: `node ${j} evicts the node that sent no move`,
    })));

    WATCHERS.forEach((j) => expect(heights[j], `the block node ${j} took the rows at`).to.be.at.least(height + GRACE_BLOCKS));
    const times = await Promise.all(WATCHERS.map((j) => evictedAt(j, oldSocket)));
    expect(times.every((at) => at !== null), 'every watcher recorded the eviction').to.equal(true);
    expect(Math.abs(times[0] - times[1]), 'how far apart the watchers evicted').to.be.below(LIST_UPDATES_MS);
  });
});
