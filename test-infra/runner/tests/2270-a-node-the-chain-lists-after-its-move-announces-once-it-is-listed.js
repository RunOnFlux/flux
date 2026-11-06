import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { moveNodeAddress } from '../framework/container.js';
import {
  clearNodeAddress, clearRpcFailures, failRpc, setNodeAddress,
} from '../framework/daemon-control.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { assertNoEvent, waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node moves and tells its peers while the chain still lists it at the address
// it left, as on mainnet, where the chain lists a node only once it has confirmed
// at the new one. Its peers carry its rows on its word and keep them at an address
// the list does not hold yet, and so does the node. It holds its peers again
// and still cannot be heard at an address the chain does not list, so it announces
// nothing until the list holds it there, and then announces once, having given its
// peers time to list it there so that none refuses the announcement.
//
// Its daemon refuses the confirmation until the suite lets it through, which is
// what keeps the chain behind the move. Node 0 moves; nodes 1, 2 and 3 are its peers. The location lifetime is
// production's, so its next timed announcement is minutes off.
const MOVER = 0;
const WATCHER = 1;
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
const LOCATION_TTL_S = 30 * 60;
// Longer than the peers take to reconnect and a capability check to run.
const STEADY_MS = 30 * 1000;
const CONFIRM = 'createconfirmationtransaction';
const REFUSED_CONFIRMATIONS = 1000;

describe('a node the chain lists after its move announces once it is listed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let moved = null;
  const appName = `e2elistedlate${Date.now()}`;
  const client = (i) => env.clients[i];
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:${API_PORT}`);
  const peerCount = async (node) => {
    const [outbound, inbound] = await Promise.all([node.getPeers(), node.getIncomingPeers()]);
    return new Set([...(outbound.data || []), ...(inbound.data || [])]).size;
  };
  let fromIp;
  let toIp;
  let newSocket;
  let anchor;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'announces once it is listed',
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
    await waitFor(async () => (await dbClient(WATCHER + 1).getAppLocations(appName)).length === 1, {
      timeout: 180000, interval: 3000, label: 'a peer holds the app',
    });
  });

  after(async function () {
    this.timeout(60000);
    if (moved) await clearNodeAddress(moved).catch(() => {});
    await env?.teardown();
  });

  it('is carried by its peers on its word, and announces nothing while the chain lists it elsewhere', async function () {
    this.timeout(DETECTION_MS + 300000);
    const node = client(MOVER);
    fromIp = node.ip;
    toIp = fromIp.replace(/\.\d+$/, '.240');
    newSocket = socketOf(toIp);
    anchor = node.getLastEventId();

    await Promise.all([fromIp, toIp].map((ip) => failRpc(ip, CONFIRM, { times: REFUSED_CONFIRMATIONS })));
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved = fromIp;
    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);

    await waitFor(async () => (await dbClient(WATCHER + 1).getAppLocations(appName)).map((row) => socketOf(row.ip)).join() === newSocket, {
      timeout: DETECTION_MS, interval: 3000, label: 'a peer carried the rows to the new address',
    });
    await waitFor(async () => await peerCount(node) > 0, { timeout: 120000, interval: 1000, label: 'fixture: the node holds peers at its new address' });
    await waitFor(async () => ((await client(WATCHER).getTestCounters())['location:awaitingMove']?.[newSocket] ?? 0) > 0, {
      timeout: 120000, interval: 2000, label: 'a peer finds the new address unlisted and leaves the rows to the chain',
    });
    await assertNoEvent(node, 'app:running', () => true, STEADY_MS, { afterId: anchor });
    await Promise.all([MOVER, WATCHER].map(async (i) => {
      expect((await dbClient(i + 1).getAppLocations(appName)).map((row) => socketOf(row.ip)), `the rows node ${i} holds`).to.deep.equal([newSocket]);
    }));
  });

  it('announces once when the list holds it at the new address', async function () {
    this.timeout(300000);
    const node = client(MOVER);
    const listedAt = Date.now();
    await Promise.all([fromIp, toIp].map((ip) => clearRpcFailures(ip)));
    await setNodeAddress(fromIp, toIp, { scope: 'all' });

    await node.waitForEvent('app:running', (d) => d.ip === newSocket, 240000, { afterId: anchor });
    const announced = () => node.getEventBuffer().filter((event) => event.id > anchor && event.event === 'app:running');
    await assertNoEvent(node, 'app:running', () => true, STEADY_MS, { afterId: announced()[0].id });
    expect(announced().map((event) => event.data.ip), 'one announcement, at the new address').to.deep.equal([newSocket]);

    await waitFor(async () => {
      const [row] = await dbClient(WATCHER + 1).getAppLocations(appName);
      return row && new Date(row.broadcastedAt).getTime() >= listedAt;
    }, { timeout: 60000, interval: 1000, label: 'a peer holds the announcement' });
    await Promise.all([1, 2, 3].map(async (i) => {
      const [row] = await dbClient(i + 1).getAppLocations(appName);
      expect(new Date(row.broadcastedAt).getTime(), `the announcement node ${i} holds`).to.be.at.least(listedAt);
    }));
  });
});
