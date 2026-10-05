/*
 * An app whose term has ended is renewed by an update, on every node alike.
 *
 * Two apps run out together. One was renewed by an update signed while it ran and paid for
 * after it had expired; the other is renewed by its owner after it expired. Every node holds
 * both renewals: those that promote them block by block, one that rebuilds its app list from
 * its message log, and one that joins afterwards and learns them through hash sync. The nodes
 * that ran the apps report their removal and the revived app's return in both location stores.
 *
 * DRIVEN BY BLOCKS. The expiry pass runs on a block still at the tip when it is fetched, every
 * 2 x speedMultiplier (8) blocks, so the chain is advanced by driveUntil alone once the apps are
 * registered: a second advancer leaves the node's tip on one parity and the pass never fires.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp, registerAndConfirm, updateAndConfirm } from '../framework/app-helper.js';
import { bootAndPeer, installedInstanceIndices } from '../framework/reconciler-suite.js';
import { waitFor, waitForDaemonReady, waitForNodeStatus } from '../framework/wait.js';
import {
  driveUntil, queueAppTx, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app's term, in blocks: long enough to install it, short enough to drive past.
const TERM = 40;
// The term, plus three expiry passes.
const EXPIRY_BUDGET = TERM + 24;
const RENEWED_TERM = 88000;
const subnet = getSubnetConfig();

describe('an expired app is renewed by an update, on every node alike', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  const lateName = `e2eLateRenew${stamp}`;
  const ownerName = `e2eOwnerRenew${stamp}`;
  const lateSpec = buildAppSpec({ name: lateName, instances: 1, expire: TERM });
  const ownerSpec = buildAppSpec({ name: ownerName, instances: 1, expire: TERM });
  let live;
  let liveIndices;
  let lateRenewalHash;
  let ownerRenewalHash;
  let lateHolders;

  // Node numbers are 1-based in the database, indices 0-based in env.clients.
  const specHash = async (index, name) => (await dbClient(index + 1).appSpec(name))?.hash ?? null;
  const hashesEverywhere = async (indices, name) => Promise.all(indices.map((i) => specHash(i, name)));

  before(async function () {
    this.timeout(900000);
    // A node takes a registration or an update only with minOutgoing (4) and minIncoming (2)
    // peers, and the ring gives every node 4 outbound peers from 9 dialers up.
    env = await createTestEnv({ hookCtx: this, nodes: 10, deferredNodes: 1, tickerAutostart: false });
    await bootAndPeer(env, { minOutbound: 4, minInbound: 2 });
    await waitFor(async () => {
      const [outgoing, incoming] = await Promise.all([env.clients[0].getPeers(), env.clients[0].getIncomingPeers()]);
      return (outgoing.data?.length ?? 0) >= 4 && (incoming.data?.length ?? 0) >= 2;
    }, { timeout: 120000, interval: 2000, label: 'node 0 has the peers a submission needs' });
    live = env.clients.filter(Boolean);
    liveIndices = env.clients.map((c, i) => (c ? i : null)).filter((i) => i !== null);

    for (const spec of [lateSpec, ownerSpec]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, live);
      expect(result.status, `${spec.name} registers: ${JSON.stringify(result.data)}`).to.equal('success');
    }
    await stopTicker();

    await waitFor(async () => {
      lateHolders = await installedInstanceIndices(env, lateName);
      return lateHolders.length > 0 && (await installedInstanceIndices(env, ownerName)).length > 0;
    }, { timeout: 180000, interval: 3000, label: 'both apps installed before their term ends' });

    // Signed and relayed while the app still runs; its payment waits until after the app ends.
    const signed = await registerApp(env.clients[0].url, nodeKey(1), { ...lateSpec, expire: RENEWED_TERM }, 'fluxappupdate');
    expect(signed.status, `the renewal of ${lateName} is accepted while the app runs: ${JSON.stringify(signed.data)}`).to.equal('success');
    lateRenewalHash = signed.data;
    await waitFor(async () => {
      const held = await Promise.all(live.map(async (node) => (await node.getTempMessages(lateRenewalHash)).data?.length > 0));
      return held.every(Boolean);
    }, { timeout: 30000, interval: 2000, label: 'the unpaid renewal reaches every node' });

    await driveUntil(env.clients[0], async () => {
      const hashes = [...await hashesEverywhere(liveIndices, lateName), ...await hashesEverywhere(liveIndices, ownerName)];
      return hashes.every((h) => h === null);
    }, { blocks: EXPIRY_BUDGET, label: 'both apps expire on every node' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('records the expired app\'s removal in both location stores', async function () {
    this.timeout(120000);
    const holderIps = lateHolders.map((i) => subnet.nodeIp(i + 1));
    const observer = liveIndices.find((i) => !lateHolders.includes(i));
    await waitFor(async () => {
      const removed = await dbClient(observer + 1).appStateEvents({ type: 'appremoved', 'data.appName': lateName });
      return holderIps.every((ip) => removed.some((e) => e.ip.split(':')[0] === ip));
    }, { timeout: 90000, interval: 3000, label: `every holder's appremoved for ${lateName} in the event log` });
    const locations = await dbClient(observer + 1).getAppLocations(lateName);
    expect(locations, 'no location row survives the removal').to.deep.equal([]);
  });

  it('applies a renewal paid after its app expired, on every node', async function () {
    this.timeout(600000);
    await queueAppTx(lateRenewalHash);
    await driveUntil(env.clients[0], async () => {
      const hashes = await hashesEverywhere(liveIndices, lateName);
      return hashes.every((h) => h === lateRenewalHash);
    }, { blocks: 12, label: `${lateName} renewed on every node` });
    const renewed = await dbClient(liveIndices[0] + 1).appSpec(lateName);
    expect(renewed.expire).to.equal(RENEWED_TERM);
  });

  it('takes an owner\'s renewal of an app that has expired, on every node', async function () {
    this.timeout(600000);
    await startTicker();
    const result = await updateAndConfirm(env.clients[0].url, nodeKey(1), { ...ownerSpec, expire: RENEWED_TERM }, live);
    await stopTicker();
    expect(result.status, `${ownerName} accepts a renewal after it expired: ${JSON.stringify(result.data)}`).to.equal('success');
    ownerRenewalHash = result.appHash;
    await waitFor(async () => {
      const hashes = await hashesEverywhere(liveIndices, ownerName);
      return hashes.every((h) => h === ownerRenewalHash);
    }, { timeout: 120000, interval: 3000, label: `${ownerName} renewed on every node` });
  });

  it('holds the same renewals after rebuilding its app list from its message log', async function () {
    this.timeout(120000);
    const rebuilt = liveIndices[1];
    const res = await env.clients[rebuilt].reindexGlobalApps(env.clients[rebuilt].zelidauth);
    expect(res.status, JSON.stringify(res)).to.equal('success');
    expect(await specHash(rebuilt, lateName)).to.equal(lateRenewalHash);
    expect(await specHash(rebuilt, ownerName)).to.equal(ownerRenewalHash);
  });

  it('holds the same renewals on a node that joins afterwards and syncs them in bulk', async function () {
    this.timeout(600000);
    const joiner = env.lastNodeIndex;
    await env.startNode(joiner);
    await waitForDaemonReady(env.clients[joiner]);
    await waitForNodeStatus(env.clients[joiner], (d) => d.confirmed === true, 30000);
    await env.startDiscovery([joiner]);
    await driveUntil(env.clients[0], async () => (
      await specHash(joiner, lateName) === lateRenewalHash && await specHash(joiner, ownerName) === ownerRenewalHash
    ), { blocks: 60, label: 'the joining node holds both renewals' });
  });

  it('announces the revived app in both location stores', async function () {
    this.timeout(600000);
    let holders = [];
    await driveUntil(env.clients[0], async () => {
      holders = await installedInstanceIndices(env, lateName);
      return holders.length > 0;
    }, { blocks: 60, label: `${lateName} installed again` });
    const holderIps = holders.map((i) => subnet.nodeIp(i + 1));
    const observer = liveIndices.find((i) => !holders.includes(i));
    await waitFor(async () => {
      const db = dbClient(observer + 1);
      const locations = await db.getAppLocations(lateName);
      const running = await db.appStateEvents({ type: 'apprunning' });
      return holderIps.every((ip) => locations.some((l) => l.ip.split(':')[0] === ip)
        && running.some((e) => e.ip.split(':')[0] === ip && (e.data?.apps ?? []).some((a) => a.name === lateName)));
    }, { timeout: 120000, interval: 3000, label: `${lateName} running in the location table and the event log` });
  });
});
