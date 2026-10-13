// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { configuredIpOf, getAppContainerStatus } from '../framework/container.js';
import { clearNodeAddress } from '../framework/daemon-control.js';
import { moveNodeWhileDown } from '../framework/node-address.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node's IP changes while it is down, and it has no record of the address it
// held - a node that last ran before it kept one. It comes back with its
// configured IP still the old one, and nothing answers there. A node that ran
// an app there tells the network it moved, and its rows follow it. A node that
// ran nothing there adopts its new address without a move. Either way the new
// address is confirmed and becomes its configured IP.
//
// A node that kept its record moves the same way, but the chain lists it at the
// new address before FluxOS is back, as fluxd's own confirmation can. Its peers
// hear the move with nothing listed at the address it left. One that ran an app
// there proved it was that node, by the apprunning it sent from there, and its
// move is applied. One that ran nothing has nothing to prove it and no rows to
// carry: its move is dropped, without counting against the node that relayed it.

// The rows at the old address have to outlive the node's time down, or a node
// that ran an app there could not show it.
const LOCATION_TTL_S = 30 * 60;
// A node back on a new address has this long to sync its app state before it
// removes every app it holds; production's figure, not the shared fleet's 30s.
const BOOT_SYNC_TIMEOUT_MS = 300000;
const ADOPTED_MS = 8 * 60 * 1000;

describe('a node whose IP changed while it was down, with no record of its address', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let withApp;
  let withoutApp;
  let bystander;
  let lateWithApp;
  let lateWithoutApp;
  const moved = [];
  const appName = `e2edownmove${Date.now()}`;
  const lateAppName = `e2elatedown${Date.now()}`;
  const client = (i) => env.clients[i];
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:16127`);
  const nodeList = async () => (await client(bystander).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`)).data || [];
  // Read before the node moves: its key is what finds its entry wherever it is listed.
  const keyOf = async (i) => (await nodeList()).find((node) => socketOf(node.ip) === socketOf(client(i).ip)).pubkey;
  const listedAt = async (pubkey) => {
    const own = (await nodeList()).find((node) => node.pubkey === pubkey);
    return own ? socketOf(own.ip) : null;
  };
  const movesFrom = async (address) => (await dbClient(bystander + 1).getAppStateEvents({ ip: address, type: 'ipchanged' }))
    .map((event) => event.data?.newIP);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S },
        system: { bootSyncTimeoutMs: BOOT_SYNC_TIMEOUT_MS },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'moved while down',
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
    withApp = await seedAndInstall(env, app);
    [withoutApp, bystander, lateWithApp, lateWithoutApp] = [0, 1, 2, 3, 4].filter((i) => i !== withApp);
    await pushImage(lateAppName, 'v1');
    const lateApp = await buildSeedableApp({
      name: lateAppName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'moved while down, listed before it is back',
        repotag: `${REGISTRY_REPO_HOST}/${lateAppName}:v1`,
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
    await installOnNodes(env, lateApp, [lateWithApp]);
    await waitFor(async () => (await dbClient(bystander + 1).getAppLocationsByIp(`${client(withApp).ip}:16127`))
      .some((row) => row.name === appName)
      && (await dbClient(bystander + 1).getAppLocationsByIp(`${client(lateWithApp).ip}:16127`)).some((row) => row.name === lateAppName), {
      timeout: 180000, interval: 3000, label: 'the bystander holds each app at its node',
    });
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all(moved.filter(Boolean).map(({ from }) => clearNodeAddress(from).catch(() => {})));
    await env?.teardown();
  });

  it('tells the network it moved when it ran an app at its old address, and its rows follow it', async function () {
    this.timeout(ADOPTED_MS + 300000);
    const to = client(withApp).ip.replace(/\.\d+$/, '.240');
    const pubkey = await keyOf(withApp);
    const { from } = await moveNodeWhileDown(env, withApp, to, { forgetOwnAddress: true });
    moved[withApp] = { from: socketOf(from), to: socketOf(to) };

    await waitFor(async () => (await movesFrom(socketOf(from))).includes(socketOf(to)), {
      timeout: ADOPTED_MS, interval: 5000, label: 'the bystander holds the move',
    });
    await waitFor(async () => (await dbClient(bystander + 1).getAppLocations(appName))
      .map((row) => socketOf(row.ip)).join() === socketOf(to), {
      timeout: 180000, interval: 5000, label: 'the bystander holds the app at the new address only',
    });
    await waitFor(async () => (await listedAt(pubkey)) === socketOf(to), {
      timeout: 300000, interval: 5000, label: 'the node listed at its new address',
    });
    const status = await getAppContainerStatus(client(withApp).container, appName);
    expect(status?.status, 'the app on the node that moved').to.match(/^Up/);
    expect(await configuredIpOf(client(withApp).container), 'its configured IP').to.equal(to);
  });

  it('adopts its new address without a move when it ran nothing at its old one', async function () {
    this.timeout(ADOPTED_MS + 120000);
    const to = client(withoutApp).ip.replace(/\.\d+$/, '.241');
    const pubkey = await keyOf(withoutApp);
    const { from } = await moveNodeWhileDown(env, withoutApp, to, { forgetOwnAddress: true });
    moved[withoutApp] = { from: socketOf(from), to: socketOf(to) };

    await waitFor(async () => (await listedAt(pubkey)) === socketOf(to), {
      timeout: ADOPTED_MS, interval: 5000, label: 'the node listed at its new address',
    });
    expect(await movesFrom(socketOf(from)), 'moves the bystander holds from the old address').to.deep.equal([]);
    expect(await configuredIpOf(client(withoutApp).container), 'its configured IP').to.equal(to);
    expect((await dbClient(withoutApp + 1).ownAddressRecord())?.socketAddress, 'the address it recorded').to.equal(socketOf(to));
  });

  it('is heard with nothing listed at the address it left, and applied, when it ran an app there', async function () {
    this.timeout(ADOPTED_MS + 300000);
    const to = client(lateWithApp).ip.replace(/\.\d+$/, '.242');
    const pubkey = await keyOf(lateWithApp);
    const { from } = await moveNodeWhileDown(env, lateWithApp, to, { chainListsNewAddress: true });
    moved[lateWithApp] = { from: socketOf(from), to: socketOf(to) };
    expect(await listedAt(pubkey), 'fixture: the chain lists the node at its new address').to.equal(socketOf(to));

    await waitFor(async () => (await movesFrom(socketOf(from))).includes(socketOf(to)), {
      timeout: ADOPTED_MS, interval: 5000, label: 'the bystander holds the move',
    });
    await waitFor(async () => (await dbClient(bystander + 1).getAppLocations(lateAppName))
      .map((row) => socketOf(row.ip)).join() === socketOf(to), {
      timeout: 180000, interval: 5000, label: 'the bystander holds the app at the new address only',
    });
  });

  it('is dropped, without counting against the node that relayed it, when it ran nothing at the address it left', async function () {
    this.timeout(ADOPTED_MS + 300000);
    const to = client(lateWithoutApp).ip.replace(/\.\d+$/, '.243');
    const pubkey = await keyOf(lateWithoutApp);
    const peers = [0, 1, 2, 3, 4].filter((i) => i !== lateWithoutApp);
    const anchors = new Map(peers.map((i) => [i, client(i).getLastEventId()]));
    const { from } = await moveNodeWhileDown(env, lateWithoutApp, to, { chainListsNewAddress: true });
    moved[lateWithoutApp] = { from: socketOf(from), to: socketOf(to) };
    expect(await listedAt(pubkey), 'fixture: the chain lists the node at its new address').to.equal(socketOf(to));

    // It tells the peers it is connected to; which those are is the peering's
    // choice, so the case waits for one to have dropped its move.
    let dropper = null;
    await waitFor(async () => {
      // eslint-disable-next-line no-restricted-syntax
      for (const i of peers) {
        // eslint-disable-next-line no-await-in-loop
        const dropped = await client(i).waitForEvent('network:originatorNotListed', (d) => d.type === 'fluxipchanged', 1, { afterId: anchors.get(i) })
          .catch(() => null);
        if (dropped) { dropper = { i, dropped }; return true; }
      }
      return false;
    }, { timeout: ADOPTED_MS, interval: 3000, label: 'a peer that dropped the move' });

    expect(String(dropper.dropped.data.relay).split(':')[0], `node ${dropper.i} dropped the move as the node itself sent it`).to.equal(to);
    expect(await movesFrom(socketOf(from)), 'moves the bystander holds from the old address').to.deep.equal([]);
    expect((await dbClient(lateWithoutApp + 1).ownAddressRecord())?.socketAddress, 'the address it recorded').to.equal(socketOf(to));
  });
});
