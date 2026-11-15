import {
  describe, it, before,
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
import { afterTeardown } from '../framework/teardown-hook.js';

// A node's move removes the apps that cannot follow it, a static-IP app among them.
// It cannot tell its peers while the chain lists it at the address it left, and
// they carry the app's row to the new address on the node's word. Once the list
// holds the node at the new address, and its peers have had time to list it there,
// it announces the removal it kept, and its peers drop the row then, not when the
// row expires.
//
// Node 0 moves; node 1 watches. Node 0's daemon refuses the confirmation until the
// suite lets it through, which keeps the chain behind the move. The location
// lifetime is long enough that no row here expires on its own.
const MOVER = 0;
const WATCHER = 1;
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
const LOCATION_TTL_S = 30 * 60;
const STEADY_MS = 30 * 1000;
const CONFIRM = 'createconfirmationtransaction';
const REFUSED_CONFIRMATIONS = 1000;

function component(appName) {
  return {
    name: 'alpha',
    description: 'a node move test container',
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
  };
}

describe('a node tells its peers of the apps its move removed once it is listed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let moved = null;
  const stamp = Date.now();
  // follows the node to its new address
  const plainApp = `e2emoveplain${stamp}`;
  // removed by the move
  const staticApp = `e2emovestatic${stamp}`;
  const client = (i) => env.clients[i];
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:${API_PORT}`);
  const watcherRows = async (appName) => (await dbClient(WATCHER + 1).getAppLocations(appName)).map((row) => socketOf(row.ip));
  const heardRemoval = (afterId) => client(WATCHER).getEventBuffer()
    .find((e) => e.id > afterId && e.event === 'network:appremoved' && e.data?.name === staticApp) ?? null;
  let fromIp;
  let toIp;
  let newSocket;
  let anchor;
  let watcherAnchor;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all([plainApp, staticApp].map((appName) => pushImage(appName, 'v1')));
    const plain = await buildSeedableApp({ name: plainApp, instances: 1, compose: [component(plainApp)] });
    const pinned = await buildSeedableApp({
      name: staticApp, instances: 1, staticip: true, compose: [component(staticApp)],
    });
    await installOnNodes(env, plain, [MOVER]);
    await installOnNodes(env, pinned, [MOVER]);
    await waitFor(async () => (await Promise.all([plainApp, staticApp].map(watcherRows))).every((rows) => rows.length === 1), {
      timeout: 180000, interval: 3000, label: 'the watcher holds both apps on the mover',
    });
  });

  afterTeardown(async function () {
    if (moved) await clearNodeAddress(moved).catch(() => {});
    await env?.teardown();
  });

  it('removes the static-IP app as it moves, and tells no peer while the chain lists it elsewhere', async function () {
    this.timeout(DETECTION_MS + 300000);
    const node = client(MOVER);
    fromIp = node.ip;
    toIp = fromIp.replace(/\.\d+$/, '.240');
    newSocket = socketOf(toIp);
    anchor = node.getLastEventId();
    watcherAnchor = client(WATCHER).getLastEventId();

    await Promise.all([fromIp, toIp].map((ip) => failRpc(ip, CONFIRM, { times: REFUSED_CONFIRMATIONS })));
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    moved = fromIp;
    await moveNodeAddress(node.container, toIp, fromIp);
    await node.followTo(toIp);

    await node.waitForEvent('app:removed', (d) => d.name === staticApp, DETECTION_MS, { afterId: anchor });
    await waitFor(async () => (await watcherRows(plainApp)).join() === newSocket, {
      timeout: DETECTION_MS, interval: 3000, label: 'the watcher carried the rows to the new address',
    });
    await assertNoEvent(client(WATCHER), 'network:appremoved', (d) => d.name === staticApp, STEADY_MS, { afterId: watcherAnchor });
    expect(await dbClient(MOVER + 1).localAppNames(), 'the move did not remove the static-IP app').to.not.include(staticApp);
    expect(await watcherRows(staticApp), 'the row of the removed app the watcher carried').to.deep.equal([newSocket]);
  });

  it('announces the removal once the list holds it at the new address, and the watcher drops the row', async function () {
    this.timeout(300000);
    await Promise.all([fromIp, toIp].map((ip) => clearRpcFailures(ip)));
    await setNodeAddress(fromIp, toIp, { scope: 'all' });

    await waitFor(() => heardRemoval(watcherAnchor) !== null, {
      timeout: 240000, interval: 2000, label: 'the watcher heard the removal',
    });
    expect(socketOf(heardRemoval(watcherAnchor).data.ip), 'the removal is told from the new address').to.equal(newSocket);
    await waitFor(async () => (await watcherRows(staticApp)).length === 0, {
      timeout: 60000, interval: 1000, label: 'the watcher dropped the removed app\'s row',
    });
    expect(await watcherRows(plainApp), 'the app that followed the node keeps its row').to.deep.equal([newSocket]);
  });
});
