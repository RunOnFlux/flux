// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { execInContainer } from '../framework/container.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A version 2 apprunning message names every app its sender holds. Each entry is
// judged on its own: one without a name and a hash is refused
// (network:apprunningRefused) and the rest of the message is stored
// (network:apprunning) and relayed as if it were not there.
//
// The stub peer is a listed node with its own key. Nodes 1 and 2 cannot reach it,
// so they hear what it says only through node 0's relay, and a message node 0
// does not store goes no further.
//
// The last case is a real node that holds an app installed without a hash beside
// one installed normally: it leaves the first out of its announcements
// (app:running.unannounced), and every node goes on storing them.

const REAL_NODES = 3;
const STUB_INDEX = 3;
const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);
const BEHIND_RELAY = [1, 2];
// A node names itself in its messages by its socket address, a stub by its IP.
const bare = (address) => String(address).replace(/:16127$/, '');

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
  const stubIp = () => getSubnetConfig().nodeIp(STUB_INDEX + 1);
  const rowNamesAt = async (i, address) => (await dbClient(i + 1).getAppLocationsByIp(address)).map((row) => row.name);
  const marks = () => realNodes.map((i) => env.clients[i].getLastEventId());
  // Every node stored a message from `ip` naming `name`, after `afterIds`.
  const everyNodeStored = (afterIds, ip, name, timeout = 60000) => Promise.all(realNodes.map((i) => env.clients[i].waitForEvent(
    'network:apprunning',
    (d) => bare(d.ip) === bare(ip) && d.apps?.some((a) => a.name === name),
    timeout,
    { afterId: afterIds[i] },
  )));
  const refusedOn = (i, afterId, ip, name, timeout = 60000) => env.clients[i].waitForEvent(
    'network:apprunningRefused',
    (d) => d.path === 'gossip' && d.refusals?.some((r) => bare(r.ip) === bare(ip) && r.names.includes(name)),
    timeout,
    { afterId },
  );
  const message = (apps) => ({
    type: 'fluxapprunning', version: 2, apps, ip: stubIp(), broadcastedAt: Date.now(), osUptime: 10000, staticIp: false,
  });

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

    // Nodes 1 and 2 cannot reach the stub, whatever their own peering would choose.
    await Promise.all(BEHIND_RELAY.map(async (i) => {
      const cut = await execInContainer(env.clients[i].container,
        `iptables -I INPUT -s ${stubIp()} -j DROP && iptables -I OUTPUT -d ${stubIp()} -j DROP`);
      if (cut.exitCode !== 0) throw new Error(`fixture: node ${i} could not cut the stub off (exit ${cut.exitCode}): ${cut.output}`);
    }));
    await waitFor(async () => {
      const peered = await Promise.all(BEHIND_RELAY.map(async (i) => {
        const [outgoing, incoming] = await Promise.all([env.clients[i].getPeers(), env.clients[i].getIncomingPeers()]);
        return JSON.stringify([...(outgoing.data ?? []), ...(incoming.data ?? [])]).includes(stubIp());
      }));
      return peered.every((p) => !p) && (await stub.connectedNodes()) === 1;
    }, { timeout: 180000, interval: 3000, label: 'only node 0 is peered with the stub' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('stores and relays the entries with a name and hash, and refuses the one without', async function () {
    this.timeout(120000);
    const kept = `e2eentrykept${stamp}`;
    const refused = `e2eentryrefused${stamp}`;
    const afterIds = marks();

    const sent = await stub.broadcast(message([
      { name: kept, hash: `hash-${kept}`, runningSince: new Date().toISOString() },
      { name: refused, runningSince: new Date().toISOString() },
    ]));
    expect(sent.sent, 'fixture: the message reached node 0 and no other').to.equal(1);

    const stored = await everyNodeStored(afterIds, stubIp(), kept);
    stored.forEach(({ data }, i) => {
      expect(data.apps.map((a) => a.name), `node ${i} stored`).to.include(kept);
    });
    await Promise.all(realNodes.map((i) => refusedOn(i, afterIds[i], stubIp(), refused)));
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubIp()), `node ${i} holds a row for the entry without a hash`).to.not.include(refused);
    }
  });

  // An empty v2 message deletes the sender's rows. A message whose entries were
  // all refused named apps: it stores nothing, goes no further, and is never
  // read as one that named none.
  it('stores and relays nothing of a message whose every entry is refused, and keeps the sender\'s rows', async function () {
    this.timeout(180000);
    const held = `e2eentryheld${stamp}`;
    const refusedOnly = `e2eentryrefusedonly${stamp}`;
    const marker = `e2eentrymarker${stamp}`;
    let afterIds = marks();
    await stub.runApp(held, { hash: `hash-${held}` });
    await everyNodeStored(afterIds, stubIp(), held);

    afterIds = marks();
    await stub.broadcast(message([{ name: refusedOnly }]));
    // A node handles one peer's messages in the order they were sent, so a node
    // that stored this has handled the refused message before it.
    await stub.runApp(marker, { hash: `hash-${marker}` });
    await everyNodeStored(afterIds, stubIp(), marker);

    await refusedOn(0, afterIds[0], stubIp(), refusedOnly);
    // Relayed, it would have reached them before the marker did.
    await Promise.all(BEHIND_RELAY.map((i) => assertNoEvent(env.clients[i], 'network:apprunningRefused',
      (d) => d.refusals?.some((r) => r.names.includes(refusedOnly)), 0, { afterId: afterIds[i] })));
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubIp()), `node ${i} deleted the sender's rows`).to.include(held);
    }
  });

  // What the case above guards against is real: a message naming no apps does
  // delete the sender's rows, on node 0 and on the nodes behind it.
  it('deletes the sender\'s rows on a message that names no apps', async function () {
    this.timeout(120000);
    const held = `e2eentrycleared${stamp}`;
    let afterIds = marks();
    await stub.runApp(held, { hash: `hash-${held}` });
    await everyNodeStored(afterIds, stubIp(), held);

    afterIds = marks();
    await stub.broadcast(message([]));
    await Promise.all(realNodes.map((i) => env.clients[i].waitForEvent(
      'network:apprunning', (d) => bare(d.ip) === bare(stubIp()) && d.apps?.length === 0, 60000, { afterId: afterIds[i] },
    )));
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubIp()), `node ${i} kept the sender's rows`).to.deep.equal([]);
    }
  });

  it('leaves out an app installed without a hash, and every node goes on storing the rest', async function () {
    this.timeout(420000);
    const appName = `e2eentryreal${stamp}`;
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({ name: appName, instances: 1, compose: [appComponent(appName)] });
    const idx = await seedAndInstall(env, app);
    const holder = socketAddr(idx + 1);
    const others = realNodes.filter((i) => i !== idx);

    // An app installed without a hash, as a node carries one it took before it
    // upgraded. Everything else about it is the real app's.
    const unhashed = `e2eentryunhashed${stamp}`;
    const { hash, ...withoutHash } = await dbClient(idx + 1).localApp(appName);
    expect(hash, 'fixture: the real app is installed with a hash').to.be.a('string');
    const afterIds = marks();
    await dbClient(idx + 1).seedLocalApp({ ...withoutHash, name: unhashed });

    const { data: announced } = await env.clients[idx].waitForEvent(
      'app:running', (d) => d.apps?.some((a) => a.name === appName), 120000, { afterId: afterIds[idx] },
    );
    expect(await dbClient(idx + 1).localApp(unhashed), 'fixture: the unhashed app was still installed when the holder announced').to.not.equal(null);
    expect(announced.apps.map((a) => a.name), 'the holder announced the app it has no hash for').to.not.include(unhashed);
    expect(announced.unannounced, 'the holder did not say what it left out').to.deep.equal([unhashed]);

    // Every other node stores the announcements made since.
    await Promise.all(others.map((i) => env.clients[i].waitForEvent(
      'network:apprunning', (d) => bare(d.ip) === bare(holder) && d.apps?.some((a) => a.name === appName), 120000, { afterId: afterIds[i] },
    ).catch(() => { throw new Error(`node ${i} stored no announcement from the holder since the unhashed app was installed`); })));
    await Promise.all(others.map((i) => assertNoEvent(env.clients[i], 'network:apprunningRefused',
      (d) => d.refusals?.some((r) => bare(r.ip) === bare(holder)), 0, { afterId: afterIds[i] })));
  });
});
