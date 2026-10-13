// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { removeFromNodeList } from '../framework/daemon-control.js';
import { crashFluxos } from '../framework/container.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A move is signed by the node listed at the address it leaves. The stub peer is
// a listed node with its own key, and broadcasts over the live path two moves
// signed with it: the app holder's address to its own, which every node refuses,
// then its own address to another port on its IP, which every node keeps. Each
// node handles one peer's messages in the order they were sent, so a node that
// holds the second has handled the first. Then the holder goes down and drops
// off the list, and the stub peer signs a move away from the holder's address
// again: the key that last sent apprunning from it is the holder's, so every
// other node refuses it and keeps no move for that address. The holder's rows
// may be gone by then: monitorNodeStatus removes the rows at an address no node
// is listed at once nothing answers there.

const REAL_NODES = 3;
const STUB_INDEX = 3;
// Production's location lifetime, so the holder's row is still standing when
// the moves are judged.
const LOCATION_TTL_S = 30 * 60;

describe('a move signed by another node is refused', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let stub;
  const appName = `e2eforgedmove${Date.now()}`;
  const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);
  const rowsAt = async (i, address) => (await dbClient(i + 1).getAppLocationsByIp(address)).map((row) => row.name);

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

  it('refuses a move away from the address of a holder that went down and left the list, signed by a node listed at the new one', async function () {
    this.timeout(240000);
    const holder = socketAddr(idx + 1);
    const stubAddress = socketAddr(STUB_INDEX + 1);
    const stubMovedAgain = stubAddress.replace(/:\d+$/, ':16167');
    const others = realNodes.filter((i) => i !== idx);

    await crashFluxos(env.clients[idx].container, { hold: true });
    const anchors = new Map(others.map((i) => [i, env.clients[i].getLastEventId()]));
    await removeFromNodeList(holder.split(':')[0]);
    await Promise.all(others.map((i) => env.clients[i].waitForEvent('networkstate:updated', (d) => d.nodes === REAL_NODES, 120000, { afterId: anchors.get(i) })));

    const forged = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: holder, newIP: stubAddress, broadcastedAt: Date.now(),
    });
    expect(forged.sent, 'fixture: the forged move reached every node still up').to.be.at.least(others.length);
    const honest = await stub.broadcast({
      type: 'fluxipchanged', version: 1, oldIP: stubAddress, newIP: stubMovedAgain, broadcastedAt: Date.now(),
    });
    expect(honest.sent, 'fixture: the honest move reached every node still up').to.be.at.least(others.length);

    const heldHonest = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: stubAddress, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === stubMovedAgain);
    await waitFor(async () => (await Promise.all(others.map(heldHonest))).every(Boolean), {
      timeout: 120000, interval: 2000, label: 'every node still up holds the stub peer\'s second move of its own',
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const i of others) {
      // eslint-disable-next-line no-await-in-loop
      const stored = await dbClient(i + 1).getAppStateEvents({ ip: holder, type: 'ipchanged' });
      expect(stored, `node ${i} stored a move away from the unlisted holder signed by another node`).to.have.length(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await rowsAt(i, stubAddress), `node ${i} gave the unlisted holder's row to the stub peer`).to.not.include(appName);
    }
  });
});
