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
import { assertNoEvent, waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node's IP changes and fluxd confirms the new address before FluxOS has told
// its peers, so they hear the move with the chain listing the node at the new
// address only and nothing at the address it left. The node is held after it
// records the move and switches to it, and before it tells anyone, until every
// other node has read the list that holds it at the new address.
//
// The chain moved the node from the address it left, which proves the move is
// its own: its peers apply the move with the time it recorded, whether or not it
// ran an app there, and keep the rows of a node that ran one until they hear it.
// Those rows follow it to the new address, keeping when it took the app, and it
// announces them there once, the move being the one time its address changed.
const WITH_APP = 0;
const WITHOUT_APP = 1;
const API_PORT = 16127;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';
const DETECTION_MS = 6 * 60 * 1000;
// Production's location lifetime, so the rows at the address a node left are
// still standing when its move is heard.
const LOCATION_TTL_S = 30 * 60;
// Longer than the peers take to reconnect and a capability check to run, so a
// second announcement would be seen.
const ANNOUNCED_ONCE_MS = 30 * 1000;

describe('a move heard after the chain lists the new address', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const moved = [];
  const appName = `e2elistedfirst${Date.now()}`;
  const client = (i) => env.clients[i];
  const others = (i) => env.clients.map((_unused, j) => j).filter((j) => j !== i);
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:${API_PORT}`);
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);
  const peerCount = async (node) => {
    const [outbound, inbound] = await Promise.all([node.getPeers(), node.getIncomingPeers()]);
    return new Set([...(outbound.data || []), ...(inbound.data || [])]).size;
  };
  const awaitingMove = async (j, socket) => (await client(j).getTestCounters())['location:awaitingMove']?.[socket] ?? 0;

  // Moves node `i` with the chain listing it at the new address in the next block, holds
  // it before it tells the move, and lets it go once every other node has read
  // a list from after the change. Returns where it moved, the move it recorded,
  // and the event id each other node had reached before it was let go.
  const moveListedFirst = async (i, lastOctet, onHeld = null) => {
    const node = client(i);
    const fromIp = node.ip;
    const toIp = fromIp.replace(/\.\d+$/, `.${lastOctet}`);
    const oldSocket = socketOf(fromIp);
    const newSocket = socketOf(toIp);
    await node.holdCheckpoint(BEFORE_RECONCILE, newSocket);
    const heldAnchor = node.getLastEventId();

    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);
    await setNodeAddress(fromIp, toIp, { scope: 'all' });
    moved.push(fromIp);
    const listAnchors = new Map(others(i).map((j) => [j, client(j).getLastEventId()]));

    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === newSocket, DETECTION_MS, { afterId: heldAnchor });
    const decided = await dbClient(i + 1).ownAddressRecord();
    expect([decided?.movedFrom, decided?.socketAddress], 'fixture: the node decided its move').to.deep.equal([oldSocket, newSocket]);
    expect(await moveHeldBy(i, oldSocket, newSocket), 'fixture: the node recorded its move as its address switched').to.not.equal(undefined);
    await Promise.all(others(i).map((j) => client(j).waitForEvent('networkstate:updated', () => true, 120000, { afterId: listAnchors.get(j) })));
    // eslint-disable-next-line no-restricted-syntax
    for (const j of others(i)) {
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(j, oldSocket, newSocket), `fixture: node ${j} heard the move before the node told it`).to.equal(undefined);
    }

    const toldAnchors = new Map(others(i).map((j) => [j, client(j).getLastEventId()]));
    if (onHeld) await onHeld({ oldSocket, heldAnchor });
    await node.releaseCheckpoint(BEFORE_RECONCILE, newSocket);
    let told;
    await waitFor(async () => { told = await moveHeldBy(i, oldSocket, newSocket); return Boolean(told); }, {
      timeout: 120000, interval: 2000, label: `node ${i} records and tells its move`,
    });
    return {
      toIp, oldSocket, newSocket, told, toldAnchors, heldAnchor,
    };
  };

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
        description: 'listed at its new address first',
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
    await installOnNodes(env, app, [WITH_APP]);
    const at = socketOf(client(WITH_APP).ip);
    await waitFor(async () => (await Promise.all(others(WITH_APP).map(async (j) => (await dbClient(j + 1).getAppLocationsByIp(at))
      .some((row) => row.name === appName)))).every(Boolean), {
      timeout: 180000, interval: 3000, label: 'every other node holds the app at its node',
    });
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all(moved.map((ip) => clearNodeAddress(ip).catch(() => {})));
    await env?.teardown();
  });

  it('is applied with the time the node recorded, and its app followed to the new address, when it ran an app at the address it left', async function () {
    this.timeout(DETECTION_MS + 600000);
    const node = client(WITH_APP);
    const tookAt = (await dbClient(others(WITH_APP)[0] + 1).getAppLocations(appName))[0].runningSince;
    let releasedAt;
    const {
      oldSocket, newSocket, told, heldAnchor,
    } = await moveListedFirst(WITH_APP, 240, async ({ oldSocket: left, heldAnchor: moveAnchor }) => {
      // eslint-disable-next-line no-restricted-syntax
      for (const j of others(WITH_APP)) {
        // eslint-disable-next-line no-await-in-loop
        await waitFor(async () => await awaitingMove(j, left) > 0, {
          timeout: 120000, interval: 2000, label: `node ${j} finds the address unlisted and leaves its rows to the move`,
        });
        // eslint-disable-next-line no-await-in-loop
        expect((await dbClient(j + 1).getAppLocations(appName)).map((row) => socketOf(row.ip)), `node ${j} holds the rows at the address the node left`).to.deep.equal([left]);
        // eslint-disable-next-line no-await-in-loop
        expect(await dbClient(j + 1).getAppStateEvents({ ip: left, type: 'evicted' }), `node ${j} evicted a node the chain moved`).to.have.length(0);
      }
      // Held past the point it could be heard, but for its move: listed where it now
      // is, and holding peers, for longer than a node that moved waits to announce.
      await waitFor(async () => await peerCount(node) > 0, { timeout: 120000, interval: 1000, label: 'fixture: the held node holds peers' });
      let heldAt = node.getLastEventId();
      // eslint-disable-next-line no-restricted-syntax
      for (const unused of [1, 2, 3, 4]) { // eslint-disable-line no-unused-vars
        // eslint-disable-next-line no-await-in-loop
        await node.waitForEvent('networkstate:updated', () => true, 120000, { afterId: heldAt });
        heldAt = node.getLastEventId();
      }
      await assertNoEvent(node, 'app:running', () => true, 1, { afterId: moveAnchor });
      releasedAt = Date.now();
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const j of others(WITH_APP)) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(j, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 180000, interval: 3000, label: `node ${j} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${j} holds for the move`).to.equal(told.data.broadcastedAt);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => {
        const rows = await dbClient(j + 1).getAppLocations(appName);
        return rows.map((row) => socketOf(row.ip)).join() === newSocket && new Date(rows[0].broadcastedAt).getTime() >= releasedAt;
      }, {
        timeout: 240000, interval: 3000, label: `node ${j} holds the node's own announcement at the new address only`,
      });
      // eslint-disable-next-line no-await-in-loop
      const [row] = await dbClient(j + 1).getAppLocations(appName);
      expect(new Date(row.runningSince).getTime(), `when node ${j} holds the node took the app`).to.equal(new Date(tookAt).getTime());
    }

    await node.waitForEvent('app:running', (d) => d.ip === newSocket, 120000, { afterId: heldAnchor });
    const announced = () => node.getEventBuffer().filter((event) => event.id > heldAnchor && event.event === 'app:running');
    expect(announced().map((event) => event.data.ip), 'one announcement, at the new address').to.deep.equal([newSocket]);
    await assertNoEvent(node, 'app:running', () => true, ANNOUNCED_ONCE_MS, { afterId: announced()[0].id });
  });

  it('is applied with the time the node recorded when it ran nothing at the address it left', async function () {
    this.timeout(DETECTION_MS + 600000);
    const { oldSocket, newSocket, told } = await moveListedFirst(WITHOUT_APP, 241);

    // eslint-disable-next-line no-restricted-syntax
    for (const j of others(WITHOUT_APP)) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(j, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 180000, interval: 3000, label: `node ${j} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${j} holds for the move`).to.equal(told.data.broadcastedAt);
    }
  });
});
