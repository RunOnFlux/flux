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
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A version 2 apprunning message names every app its sender holds. Each entry is
// judged on its own: one without a name and a hash is refused and the rest of the
// message is stored and relayed as if it were not there.
//
// The stub peer is a listed node with its own key, peered with node 0 only, so
// nodes 1 and 2 hear what it says only through node 0's relay. A message node 0
// does not store goes no further, so the relay is part of what is asserted.
//
// The last case is a real node that holds an app installed without a hash beside
// one installed normally: its announcements keep the normal app's rows standing
// on every node.

const REAL_NODES = 3;
const STUB_INDEX = 3;
// The harness's own location lifetime (63s), so a row that is not refreshed is
// gone within a minute and a node that went quiet is visible as one.
const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);

function appComponent(appName) {
  return {
    name: 'alpha',
    description: 'one entry at a time',
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

describe('an announcement is judged one entry at a time', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let stub;
  const stamp = Date.now();
  const stubAddress = () => socketAddr(STUB_INDEX + 1);
  const rowNamesAt = async (i, address) => (await dbClient(i + 1).getAppLocationsByIp(address)).map((row) => row.name);
  const everyNodeHolds = (address, name) => async () => (await Promise.all(realNodes.map((i) => rowNamesAt(i, address))))
    .every((names) => names.includes(name));

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES + 1,
      stubPeers: [STUB_INDEX],
      stubPeeredWith: { [STUB_INDEX]: [0] },
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    stub = env.stubPeerClients.get(STUB_INDEX);
    await waitFor(async () => (await stub.connectedNodes()) >= 1, {
      timeout: 120000, interval: 2000, label: 'node 0 is connected to the stub peer',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  // Nodes 1 and 2 must hear the stub only through node 0, or the relay is not
  // what carried the message to them.
  async function assertOnlyNodeZeroHearsTheStub() {
    const stubIp = stubAddress().split(':')[0];
    // eslint-disable-next-line no-restricted-syntax
    for (const i of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const [outgoing, incoming] = await Promise.all([env.clients[i].getPeers(), env.clients[i].getIncomingPeers()]);
      const peers = JSON.stringify([...(outgoing.data ?? []), ...(incoming.data ?? [])]);
      expect(peers.includes(stubIp), `fixture: node ${i} is peered with the stub directly`).to.equal(false);
    }
  }

  it('stores and relays the entries with a name and hash, and refuses the one without', async function () {
    this.timeout(120000);
    await assertOnlyNodeZeroHearsTheStub();
    const kept = `e2eentrykept${stamp}`;
    const refused = `e2eentryrefused${stamp}`;

    const sent = await stub.broadcast({
      type: 'fluxapprunning',
      version: 2,
      apps: [
        { name: kept, hash: `hash-${kept}`, runningSince: new Date().toISOString() },
        { name: refused, runningSince: new Date().toISOString() },
      ],
      ip: stubAddress(),
      broadcastedAt: Date.now(),
      osUptime: 10000,
      staticIp: false,
    });
    expect(sent.sent, 'fixture: the message reached node 0').to.equal(1);

    await waitFor(everyNodeHolds(stubAddress(), kept), {
      timeout: 60000, interval: 2000, label: 'every node, the two behind node 0 included, holds the entry with a hash',
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubAddress()), `node ${i} stored the entry without a hash`).to.not.include(refused);
    }
  });

  // An empty v2 message deletes the sender's rows. A message whose entries were
  // all refused named apps, and is never read as one that named none.
  it('keeps the sender\'s rows when every entry of a message is refused', async function () {
    this.timeout(120000);
    const held = `e2eentryheld${stamp}`;
    const marker = `e2eentrymarker${stamp}`;
    const heldAt = Date.now();
    await stub.runApp(held, { hash: `hash-${held}`, broadcastedAt: heldAt });
    await waitFor(everyNodeHolds(stubAddress(), held), {
      timeout: 60000, interval: 2000, label: 'every node holds the stub peer\'s app',
    });

    await stub.broadcast({
      type: 'fluxapprunning',
      version: 2,
      apps: [{ name: `e2eentryrefusedonly${stamp}` }],
      ip: stubAddress(),
      broadcastedAt: Date.now(),
      osUptime: 10000,
      staticIp: false,
    });
    // A node handles one peer's messages in the order they were sent, so node 0
    // holding the marker has handled the refused message before it.
    await stub.runApp(marker, { hash: `hash-${marker}` });
    await waitFor(everyNodeHolds(stubAddress(), marker), {
      timeout: 60000, interval: 2000, label: 'every node holds the message sent after the refused one',
    });

    expect(Date.now() - heldAt, 'fixture: the app\'s rows have not reached their own expiry').to.be.below(50000);
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubAddress()), `node ${i} deleted the sender's rows for a message whose entries it refused`).to.include(held);
    }
  });

  // What the case above guards against is real: a message naming no apps does
  // delete the sender's rows, on node 0 and on the nodes behind it.
  it('deletes the sender\'s rows on a message that names no apps', async function () {
    this.timeout(120000);
    const held = `e2eentrycleared${stamp}`;
    await stub.runApp(held, { hash: `hash-${held}` });
    await waitFor(everyNodeHolds(stubAddress(), held), {
      timeout: 60000, interval: 2000, label: 'every node holds the stub peer\'s app',
    });

    await stub.broadcast({
      type: 'fluxapprunning',
      version: 2,
      apps: [],
      ip: stubAddress(),
      broadcastedAt: Date.now(),
      osUptime: 10000,
      staticIp: false,
    });

    await waitFor(async () => (await Promise.all(realNodes.map((i) => rowNamesAt(i, stubAddress())))).every((names) => names.length === 0), {
      timeout: 60000, interval: 2000, label: 'every node dropped the stub peer\'s rows',
    });
  });

  it('keeps a node\'s apps standing while it holds an app installed without a hash', async function () {
    this.timeout(420000);
    const appName = `e2eentryreal${stamp}`;
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({ name: appName, instances: 1, compose: [appComponent(appName)] });
    const idx = await seedAndInstall(env, app);
    const holder = socketAddr(idx + 1);
    const others = realNodes.filter((i) => i !== idx);
    await waitFor(everyNodeHolds(holder, appName), {
      timeout: 180000, interval: 3000, label: 'every node holds the app at its holder',
    });

    // An app installed without a hash, as a node carries one it took before it
    // upgraded. Everything else about it is the real app's.
    const unhashed = `e2eentryunhashed${stamp}`;
    const installed = await dbClient(idx + 1).localApp(appName);
    const { hash, ...withoutHash } = installed;
    expect(hash, 'fixture: the real app is installed with a hash').to.be.a('string');
    const seededAt = Date.now();
    await dbClient(idx + 1).seedLocalApp({ ...withoutHash, name: unhashed });

    const mark = env.clients[idx].getLastEventId();
    const announced = await env.clients[idx].waitForEvent('app:running', (d) => d.apps?.some((a) => a.name === appName), 120000, { afterId: mark });
    expect(announced.apps.map((a) => a.name), 'the holder announced the app it has no hash for').to.not.include(unhashed);
    expect(await dbClient(idx + 1).localApp(unhashed), 'fixture: the unhashed app was still installed when the holder announced').to.not.equal(null);

    // Two location lifetimes after the seeding, the app's rows on every other node
    // are ones written since: a holder whose announcements were refused would have
    // let them lapse.
    await waitFor(async () => Date.now() - seededAt > 130000, { timeout: 140000, interval: 5000, label: 'two location lifetimes pass' });
    // eslint-disable-next-line no-restricted-syntax
    for (const i of others) {
      // eslint-disable-next-line no-await-in-loop
      const row = await dbClient(i + 1).appLocationAt(appName, holder);
      expect(row, `node ${i} lost the holder's row`).to.not.equal(null);
      expect(new Date(row.broadcastedAt).getTime(), `node ${i} holds no announcement made since`).to.be.above(seededAt);
    }
    const own = await dbClient(idx + 1).appLocationAt(appName, holder);
    expect(own, 'the holder lost its own row').to.not.equal(null);
    expect(new Date(own.broadcastedAt).getTime(), 'the holder stored none of its own announcements').to.be.above(seededAt);
  });
});
