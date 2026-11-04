// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { moveNodeAddress } from '../framework/container.js';
import { clearNodeAddress, setNodeAddress } from '../framework/daemon-control.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { evictedEvent } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node that ran an app moves, and the chain lists it at the new address before
// its peers hear the move. Each peer finds nothing listed at the address it left,
// and the chain's record of the move tells it the node moved rather than left, so
// its rows stand: neither the peer's own check nor an eviction reaching it by
// state sync, as one from a node that judged the address gone would, takes them.
// The move, heard late, carries them, and the peers hold the move with the time
// the node recorded.
//
// The node notices its new address first and the chain lists it there after,
// as on mainnet, where the chain lists a node only once it has confirmed there.
//
// Node 0 moves. Nodes 1 and 2 hear it; node 3 holds an eviction of the address it
// left and node 2 is restarted to sync it.
const MOVER = 0;
const API_PORT = 16127;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';
const DETECTION_MS = 6 * 60 * 1000;
// Production's location lifetime, so only an eviction takes the rows at the
// address the node left.
const LOCATION_TTL_S = 30 * 60;

describe('a node the chain moved keeps its rows until its move is heard', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let moved = null;
  const appName = `e2eevictedfirst${Date.now()}`;
  const client = (i) => env.clients[i];
  const peers = [1, 2];
  const SYNCS_EVICTION = 2;
  const HOLDS_EVICTION = 3;
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);
  const awaitingMove = async (i, socket) => (await client(i).getTestCounters())['location:awaitingMove']?.[socket] ?? 0;
  const evictions = (i, socket) => dbClient(i + 1).getAppStateEvents({ ip: socket, type: 'evicted' });
  const rowsAt = async (i, socket) => (await dbClient(i + 1).getAppLocationsByIp(socket)).filter((row) => row.name === appName);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
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
        description: 'keeps its rows until its move is heard',
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
    await installOnNodes(env, app, [MOVER]);
    const at = socketOf(client(MOVER).ip);
    await waitFor(async () => (await Promise.all(peers.map(async (j) => (await rowsAt(j, at)).length > 0))).every(Boolean), {
      timeout: 180000, interval: 3000, label: 'every peer holds the app at the mover',
    });
  });

  after(async function () {
    this.timeout(60000);
    if (moved) await clearNodeAddress(moved).catch(() => {});
    await env?.teardown();
  });

  let node;
  let oldSocket;
  let newSocket;
  let recorded;
  let tookAt;

  it('stands at the address it left while the chain lists it elsewhere and the move is unheard', async function () {
    this.timeout(DETECTION_MS + 300000);
    node = client(MOVER);
    const fromIp = node.ip;
    const toIp = fromIp.replace(/\.\d+$/, '.240');
    oldSocket = socketOf(fromIp);
    newSocket = socketOf(toIp);
    [{ runningSince: tookAt }] = await rowsAt(peers[0], oldSocket);
    await node.holdCheckpoint(BEFORE_RECONCILE, newSocket);
    const heldAnchor = node.getLastEventId();

    // The stub is told first: it knows the node by its listed address.
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved = fromIp;
    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);

    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === newSocket, DETECTION_MS, { afterId: heldAnchor });
    recorded = await dbClient(MOVER + 1).ownAddressRecord();
    expect([recorded?.movedFrom, recorded?.socketAddress], 'fixture: the node recorded its move').to.deep.equal([oldSocket, newSocket]);
    await setNodeAddress(fromIp, toIp, { scope: 'all' });

    // eslint-disable-next-line no-restricted-syntax
    for (const j of peers) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => await awaitingMove(j, oldSocket) > 0, {
        timeout: 300000, interval: 3000, label: `node ${j} finds the address unlisted and leaves its rows to the move`,
      });
      // eslint-disable-next-line no-await-in-loop
      expect(await rowsAt(j, oldSocket), `the rows node ${j} holds at the address`).to.have.length(1);
      // eslint-disable-next-line no-await-in-loop
      expect(await evictions(j, oldSocket), `node ${j} evicted a node the chain moved`).to.have.length(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(j, oldSocket, newSocket), `fixture: node ${j} heard the move before the node told it`).to.equal(undefined);
    }
  });

  it('stands through an eviction of the address arriving by state sync', async function () {
    this.timeout(300000);
    await dbClient(HOLDS_EVICTION + 1).seedAppStateEvents([evictedEvent({ nodeNum: MOVER + 1, createdAt: Date.now() })]);
    expect(await evictions(HOLDS_EVICTION, oldSocket), 'fixture: the node holds the eviction').to.have.length(1);
    await env.restartNode(SYNCS_EVICTION);
    await waitFor(async () => await awaitingMove(SYNCS_EVICTION, oldSocket) > 0, {
      timeout: 240000, interval: 3000, label: 'the restarted node applied the eviction and left the rows to the move',
    });
    expect(await rowsAt(SYNCS_EVICTION, oldSocket), 'the rows the restarted node holds at the address').to.have.length(1);
    expect(await evictions(SYNCS_EVICTION, oldSocket), 'the restarted node recorded the eviction').to.have.length(0);
  });

  it('follows the node to its new address when the move is heard, with the time it recorded', async function () {
    this.timeout(420000);
    await node.releaseCheckpoint(BEFORE_RECONCILE, newSocket);
    let told;
    await waitFor(async () => { told = await moveHeldBy(MOVER, oldSocket, newSocket); return Boolean(told); }, {
      timeout: 120000, interval: 2000, label: 'the node records and tells its move',
    });
    expect(told.data.broadcastedAt, 'fixture: the move the node tells is the one it recorded').to.equal(recorded.movedAt);

    // eslint-disable-next-line no-restricted-syntax
    for (const j of peers) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(j, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 180000, interval: 3000, label: `node ${j} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${j} holds for the move`).to.equal(recorded.movedAt);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await rowsAt(j, oldSocket)).length === 0 && (await rowsAt(j, newSocket)).length === 1, {
        timeout: 180000, interval: 3000, label: `node ${j} holds the app at the new address only`,
      });
      // eslint-disable-next-line no-await-in-loop
      const [row] = await rowsAt(j, newSocket);
      expect(new Date(row.runningSince).getTime(), `when node ${j} holds the node took the app`).to.equal(new Date(tookAt).getTime());
    }
  });
});
