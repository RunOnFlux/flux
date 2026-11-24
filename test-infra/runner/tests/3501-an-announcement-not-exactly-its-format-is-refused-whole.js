// weight: medium
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr, specHashOf } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// A report (fluxapprunning) or removal (fluxappremoved) a node takes is exactly
// the message its version describes: these fields and no other, each of its
// type, and in a report every app exactly a name, a hash and a running time. Any
// other is refused whole where it arrives (peers:frameDropped, malformed): nothing
// of it is stored, it goes no further, and the sender's rows stand.
//
// The stub peer is a listed node with its own key. Nodes 1 and 2 cannot reach it,
// so they hear what it says only through node 0's relay. A node handles one
// peer's messages in the order they were sent, so a well-formed marker sent after
// a refused message, once stored, says the refused one was handled before it.
//
// The last case is a real node that holds an app installed without a hash beside
// one installed normally: it leaves the first out of its reports
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
    description: 'exactly its format',
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

describe('an announcement not exactly its format is refused whole', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let stub;
  const stamp = Date.now();
  const stubIp = () => getSubnetConfig().nodeIp(STUB_INDEX + 1);
  const rowNamesAt = async (i, address) => (await dbClient(i + 1).getAppLocationsByIp(address)).map((row) => row.name);
  const marks = () => realNodes.map((i) => env.clients[i].getLastEventId());
  const entry = (name) => ({ name, hash: specHashOf(name), runningSince: new Date().toISOString() });
  // Every node stored a report from `ip` naming `name`, after `afterIds`.
  const everyNodeStored = (afterIds, ip, name) => Promise.all(realNodes.map((i) => env.clients[i].waitForEvent(
    'network:apprunning',
    (d) => bare(d.ip) === bare(ip) && (d.apps ?? []).some((a) => a.name === name),
    60000,
    { afterId: afterIds[i] },
  ).catch(() => { throw new Error(`node ${i} did not store ${name}`); })));
  // read once the marker after the message is stored, so the message was handled
  const refusedAtNodeZero = (afterIds, type) => env.clients[0].getEventBuffer()
    .some((e) => e.id > afterIds[0] && e.event === 'peers:frameDropped' && e.data.type === type && e.data.reason === 'malformed');
  const report = (apps) => ({
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
    stub = env.stubPeerClients.get(STUB_INDEX);
    // Nodes 1 and 2 cannot reach the stub, cut off before the fleet peers so
    // neither ever holds a connection to it.
    await env.cutOff(BEHIND_RELAY, STUB_INDEX);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    const peeredWithStub = await Promise.all(BEHIND_RELAY.map(async (i) => {
      const [outgoing, incoming] = await Promise.all([env.clients[i].getPeers(), env.clients[i].getIncomingPeers()]);
      return JSON.stringify([...(outgoing.data ?? []), ...(incoming.data ?? [])]).includes(stubIp());
    }));
    expect(peeredWithStub, 'fixture: a node behind the relay is peered with the stub').to.deep.equal([false, false]);
    expect(await stub.connectedNodes(), 'fixture: the stub holds connections beyond node 0').to.equal(1);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('refuses a report naming one app that is not exactly an app, stores none of it, and keeps the sender\'s rows', async function () {
    this.timeout(180000);
    const held = `e2eshapeheld${stamp}`;
    const named = `e2eshapenamed${stamp}`;
    const marker = `e2eshapemarker${stamp}`;
    let afterIds = marks();
    await stub.broadcast(report([entry(held)]));
    await everyNodeStored(afterIds, stubIp(), held);

    afterIds = marks();
    const sent = await stub.broadcast(report([entry(held), entry(named), { name: `e2eshapeunhashed${stamp}`, runningSince: new Date().toISOString() }]));
    expect(sent.sent, 'fixture: the report reached node 0 and no other').to.equal(1);

    // A marker naming `named` would store it: this one names only what the
    // sender held before, so its own write says nothing of the refused report.
    await stub.broadcast(report([entry(held), entry(marker)]));
    await everyNodeStored(afterIds, stubIp(), marker);
    await Promise.all(realNodes.map((i) => assertNoEvent(env.clients[i], 'network:apprunning',
      (d) => (d.apps ?? []).some((a) => a.name === named), 0, { afterId: afterIds[i] })
      .catch(() => { throw new Error(`node ${i} stored an app of the refused report`); })));
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubIp()), `node ${i} lost the sender's row`).to.include(held);
    }
    expect(refusedAtNodeZero(afterIds, 'fluxapprunning'), 'node 0 did not refuse the report where it arrived').to.equal(true);
    // Relayed, it would have reached them before the marker did, and been refused there.
    await Promise.all(BEHIND_RELAY.map((i) => assertNoEvent(env.clients[i], 'peers:frameDropped',
      (d) => d.type === 'fluxapprunning', 0, { afterId: afterIds[i] })));
  });

  // An empty report deletes the sender's rows, on node 0 and on the nodes behind it.
  it('deletes the sender\'s rows on a report that names no apps', async function () {
    this.timeout(120000);
    const held = `e2eshapecleared${stamp}`;
    let afterIds = marks();
    await stub.runApp(held, { hash: specHashOf(held) });
    await everyNodeStored(afterIds, stubIp(), held);

    afterIds = marks();
    await stub.broadcast(report([]));
    await Promise.all(realNodes.map((i) => env.clients[i].waitForEvent(
      'network:apprunning', (d) => bare(d.ip) === bare(stubIp()) && d.cleared === true, 60000, { afterId: afterIds[i] },
    )));
    // eslint-disable-next-line no-restricted-syntax
    for (const i of realNodes) {
      // eslint-disable-next-line no-await-in-loop
      expect(await rowNamesAt(i, stubIp()), `node ${i} kept the sender's rows`).to.deep.equal([]);
    }
  });

  it('refuses a removal naming an app by a name no app may have, and takes a correct one after it', async function () {
    this.timeout(180000);
    const held = `e2eshapetaken${stamp}`;
    const badName = `e2e shape ${stamp}`;
    const afterIds = marks();
    await stub.broadcast(report([entry(held)]));
    await everyNodeStored(afterIds, stubIp(), held);

    await stub.broadcast({
      type: 'fluxappremoved', version: 1, appName: badName, ip: stubIp(), broadcastedAt: Date.now(),
    });
    await stub.broadcast({
      type: 'fluxappremoved', version: 1, appName: held, ip: stubIp(), broadcastedAt: Date.now(),
    });
    // Handled in the order sent, so the first was handled before the second.
    await Promise.all(realNodes.map((i) => env.clients[i].waitForEvent(
      'network:appremoved', (d) => d.name === held, 60000, { afterId: afterIds[i] },
    ).catch(() => { throw new Error(`node ${i} did not take the correct removal`); })));
    await Promise.all(realNodes.map((i) => assertNoEvent(env.clients[i], 'network:appremoved',
      (d) => d.name === badName, 0, { afterId: afterIds[i] })
      .catch(() => { throw new Error(`node ${i} took a removal naming an app by a name no app may have`); })));
    expect(refusedAtNodeZero(afterIds, 'fluxappremoved'), 'node 0 did not refuse the removal where it arrived').to.equal(true);
  });

  // A node's shutdown is handled from what the node's own reports and removals
  // say it runs (registryManager.appLocationFromEvents). Runs last of the stub's
  // cases: the shutdown ends what the stub is recorded as running.
  it('refuses a version 1 removal that carries a list of apps, and handles the sender\'s shutdown after it', async function () {
    this.timeout(180000);
    const held = `e2eshaperemoved${stamp}`;
    let afterIds = marks();
    await stub.broadcast(report([entry(held)]));
    await everyNodeStored(afterIds, stubIp(), held);

    afterIds = marks();
    await stub.broadcast({
      type: 'fluxappremoved', version: 1, appName: held, apps: 'x', ip: stubIp(), broadcastedAt: Date.now(),
    });
    await stub.broadcast({
      type: 'fluxnodesigterm', version: 1, ip: stubIp(), broadcastedAt: Date.now(),
    });
    await Promise.all(realNodes.map((i) => env.clients[i].waitForEvent(
      'network:sigterm', (d) => bare(d.ip) === bare(stubIp()), 60000, { afterId: afterIds[i] },
    ).catch(() => { throw new Error(`node ${i} did not handle the sender's shutdown`); })));
    expect(refusedAtNodeZero(afterIds, 'fluxappremoved'), 'node 0 did not refuse the removal where it arrived').to.equal(true);
  });

  it('leaves out an app installed without a hash, and every node goes on storing the rest', async function () {
    this.timeout(420000);
    const appName = `e2eshapereal${stamp}`;
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({ name: appName, instances: 1, compose: [appComponent(appName)] });
    // Node 1: it announces on its own interval. Node 2's ring neighbour is the
    // stub's slot, which it cannot reach, so it holds fewer peers than the
    // threshold that starts a node's announcements.
    const idx = 1;
    await installOnNodes(env, app, [idx]);
    const holder = socketAddr(idx + 1);
    const others = realNodes.filter((i) => i !== idx);

    // An app installed without a hash. Everything else about it is the real app's.
    const unhashed = `e2eshapeunhashedreal${stamp}`;
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

    // Every other node stores the reports made since.
    await Promise.all(others.map((i) => env.clients[i].waitForEvent(
      'network:apprunning', (d) => bare(d.ip) === bare(holder) && d.apps?.some((a) => a.name === appName), 120000, { afterId: afterIds[i] },
    ).catch(() => { throw new Error(`node ${i} stored no report from the holder since the unhashed app was installed`); })));
  });
});
