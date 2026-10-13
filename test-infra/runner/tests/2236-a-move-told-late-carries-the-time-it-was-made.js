// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { blockTraffic, moveNodeAddress, unblockTraffic } from '../framework/container.js';
import { clearNodeAddress, setNodeAddress } from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node moves while none of its peers can reach it, and they hear the move
// only once its confirmation is mined, so the chain lists the node at its new
// address only, and once the move has been signed again for the relay window:
// a move is re-signed once its copy is OWN_MOVE_RESIGN_MS (120s) old.
//
// A node that runs an app sent apprunning from the address it left, which is
// what proves the move is its own: its peers apply the move, with the time the
// node recorded, and hold its app at the new address. A node that runs none
// sent nothing there to prove it, and has no rows for a move to carry: its
// peers drop the move without counting it against the node that relayed it,
// and connect to the node at the address the chain lists.
const MOVER = 0;
const BARE_MOVER = 3;
const PEERS = [1, 2];
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
// Past the 120s after which a move is signed again.
const UNHEARD_MS = 150 * 1000;
// A move is sent, and applied, for as long as a location stands. Production's
// lifetime (125 min) outlasts the time unheard by far; the shared harness
// fleet's 63s does not, and the move would expire before any peer could hear it.
// This fleet keeps production's order.
const LOCATION_TTL_S = 30 * 60;
if (LOCATION_TTL_S * 1000 <= UNHEARD_MS) {
  throw new Error('2236: a location must outlive the time the move goes unheard');
}

describe('a move told late carries the time it was made', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const blocked = new Map();
  const moved = [];
  const appName = `e2elatemove${Date.now()}`;
  const client = (i) => env.clients[i];
  const others = (i) => env.clients.filter((_unused, j) => j !== i).map((c) => c.ip);
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:${API_PORT}`);
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);
  const listedAt = async (address) => ((await client(PEERS[0]).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`)).data ?? [])
    .some((node) => socketOf(node.ip) === address);

  // Moves node `i` while its peers cannot reach it, and waits until it has
  // recorded the move, the chain lists it at the new address only, and the move
  // has gone unheard past the re-sign; then lets its peers reach it.
  const moveUnheard = async (i, lastOctet) => {
    const fromIp = client(i).ip;
    const toIp = fromIp.replace(/\.\d+$/, `.${lastOctet}`);
    const oldSocket = `${fromIp}:${API_PORT}`;
    const newSocket = `${toIp}:${API_PORT}`;
    const unreachable = others(i);
    await blockTraffic(client(i).container, unreachable, API_PORT);
    blocked.set(i, unreachable);
    await moveNodeAddress(client(i).container, toIp, fromIp);
    await client(i).followTo(toIp);
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved.push(fromIp);

    let recorded;
    await waitFor(async () => { recorded = await moveHeldBy(i, oldSocket, newSocket); return Boolean(recorded); }, {
      timeout: DETECTION_MS, interval: 5000, label: `node ${i} records its own move`,
    });
    await waitFor(async () => (await listedAt(newSocket)) && !(await listedAt(oldSocket)), {
      timeout: 180000, interval: 5000, label: `the chain lists node ${i} at its new address only`,
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const p of PEERS) {
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(p, oldSocket, newSocket), `fixture: node ${p} heard the move while it could not reach node ${i}`).to.equal(undefined);
    }
    await new Promise((resolve) => { setTimeout(resolve, UNHEARD_MS); });
    const anchors = new Map(PEERS.map((p) => [p, client(p).getLastEventId()]));
    await unblockTraffic(client(i).container, unreachable, API_PORT);
    blocked.delete(i);
    return {
      toIp, oldSocket, newSocket, recorded, anchors,
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
        description: 'late move',
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
    const moverSocket = `${client(MOVER).ip}:${API_PORT}`;
    await waitFor(async () => (await Promise.all(PEERS.map(async (p) => (await dbClient(p + 1).getAppLocationsByIp(moverSocket))
      .some((row) => row.name === appName)))).every(Boolean), {
      timeout: 180000, interval: 3000, label: 'every peer holds the app at the mover',
    });
  });

  after(async function () {
    this.timeout(60000);
    // eslint-disable-next-line no-restricted-syntax
    for (const [i, ips] of blocked) {
      // eslint-disable-next-line no-await-in-loop
      await unblockTraffic(client(i).container, ips, API_PORT).catch(() => {});
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const ip of moved) {
      // eslint-disable-next-line no-await-in-loop
      await clearNodeAddress(ip).catch(() => {});
    }
    await env?.teardown();
  });

  it('reaches every peer with the time the node recorded, and its app at the new address, from a node that runs an app', async function () {
    this.timeout(DETECTION_MS + UNHEARD_MS + 600000);
    const { oldSocket, newSocket, recorded } = await moveUnheard(MOVER, 240);

    // eslint-disable-next-line no-restricted-syntax
    for (const p of PEERS) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(p, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 240000, interval: 5000, label: `node ${p} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${p} holds for the move`).to.equal(recorded.data.broadcastedAt);
      // eslint-disable-next-line no-await-in-loop
      const atNew = (await dbClient(p + 1).getAppLocationsByIp(newSocket)).map((row) => row.name);
      expect(atNew, `the apps node ${p} holds at the new address`).to.include(appName);
    }
  });

  it('is dropped by every peer from a node that runs no app, without counting against the node that relayed it, and the node is reached at its new address', async function () {
    this.timeout(DETECTION_MS + UNHEARD_MS + 600000);
    const {
      toIp, oldSocket, newSocket, anchors,
    } = await moveUnheard(BARE_MOVER, 241);

    // eslint-disable-next-line no-restricted-syntax
    for (const p of PEERS) {
      // eslint-disable-next-line no-await-in-loop
      const dropped = await client(p).waitForEvent('network:originatorNotListed', (d) => d.type === 'fluxipchanged', 240000, { afterId: anchors.get(p) });
      expect(String(dropped.data.relay).split(':')[0], `node ${p} dropped the move as the node itself sent it`).to.equal(toIp);
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(p, oldSocket, newSocket), `node ${p} holds the move`).to.equal(undefined);
      // eslint-disable-next-line no-await-in-loop
      await client(p).waitForEvent('peers:added', (d) => d.ip === toIp, 120000, { afterId: anchors.get(p) });
    }
  });
});
