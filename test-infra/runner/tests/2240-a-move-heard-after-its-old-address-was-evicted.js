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
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node that ran an app moves, and the chain lists it at the new address before
// its peers hear the move. Each peer's node status check then finds nothing
// listed at the address it left, nothing answering there, and evicts it: the
// rows there go. The move, made before that eviction, is still the node's own:
// the chain moved the node from the address it left, so its peers hold the move
// with the time the node recorded.
//
// The node notices its new address first and the chain lists it there after,
// as on mainnet, where the chain lists a node only once it has confirmed there.
//
// Node 0 moves; nodes 1 and 2 hear it.
const MOVER = 0;
const API_PORT = 16127;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';
const DETECTION_MS = 6 * 60 * 1000;
// Production's location lifetime, so only an eviction takes the rows at the
// address the node left.
const LOCATION_TTL_S = 30 * 60;

describe('a move heard after its old address was evicted', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let moved = null;
  const appName = `e2eevictedfirst${Date.now()}`;
  const client = (i) => env.clients[i];
  const peers = [1, 2];
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);
  // when node i evicted `socket`, ms, or null
  const evictedAt = async (i, socket) => {
    const [eviction] = await dbClient(i + 1).getAppStateEvents({ ip: socket, type: 'evicted' });
    return eviction ? new Date(eviction.createdAt).getTime() : null;
  };
  const rowsAt = async (i, socket) => (await dbClient(i + 1).getAppLocationsByIp(socket)).filter((row) => row.name === appName);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
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
        description: 'evicted before its move is heard',
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

  it('is held, with the time the node recorded, by every peer that evicted the address it left', async function () {
    this.timeout(DETECTION_MS + 900000);
    const node = client(MOVER);
    const fromIp = node.ip;
    const toIp = fromIp.replace(/\.\d+$/, '.240');
    const oldSocket = socketOf(fromIp);
    const newSocket = socketOf(toIp);
    await node.holdCheckpoint(BEFORE_RECONCILE, newSocket);
    const heldAnchor = node.getLastEventId();

    // The stub is told first: it knows the node by its listed address.
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved = fromIp;
    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);

    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === newSocket, DETECTION_MS, { afterId: heldAnchor });
    const recorded = await dbClient(MOVER + 1).ownAddressRecord();
    expect([recorded?.movedFrom, recorded?.socketAddress], 'fixture: the node recorded its move').to.deep.equal([oldSocket, newSocket]);
    await setNodeAddress(fromIp, toIp, { scope: 'all' });

    // eslint-disable-next-line no-restricted-syntax
    for (const j of peers) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await evictedAt(j, oldSocket)) !== null && (await rowsAt(j, oldSocket)).length === 0, {
        timeout: 300000, interval: 3000, label: `fixture: node ${j} evicted the address the node left`,
      });
      // eslint-disable-next-line no-await-in-loop
      expect(await evictedAt(j, oldSocket), `fixture: node ${j} evicted the address after the move was made`).to.be.above(recorded.movedAt);
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(j, oldSocket, newSocket), `fixture: node ${j} heard the move before the node told it`).to.equal(undefined);
    }

    await node.releaseCheckpoint(BEFORE_RECONCILE, newSocket);
    let told;
    await waitFor(async () => { told = await moveHeldBy(MOVER, oldSocket, newSocket); return Boolean(told); }, {
      timeout: 120000, interval: 2000, label: 'the node records and tells its move',
    });
    expect(told.data.broadcastedAt, 'fixture: the move was made before the evictions').to.equal(recorded.movedAt);

    // eslint-disable-next-line no-restricted-syntax
    for (const j of peers) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(j, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 180000, interval: 3000, label: `node ${j} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${j} holds for the move`).to.equal(recorded.movedAt);
    }
  });
});
