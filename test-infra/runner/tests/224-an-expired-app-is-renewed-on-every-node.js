/*
 * An app whose term has ended is renewed by an update, on every node alike.
 *
 * Two apps are registered with a short term and installed on chosen holders. One is renewed by
 * an update relayed while it runs and paid for after it has expired; the other by its owner,
 * submitting after it has expired. Every node holds both renewals: by promotion, after a
 * rebuild from its message log, and on a node that joins afterwards and learns them by hash
 * sync. The removal and the revived app's return show in both location stores.
 *
 * The chain moves only when this suite advances it: the ticker is stopped after boot, and
 * submissions are paid with queueAppTx and mined by driveFleetUntil. A node runs its expiry pass
 * and promotes a payment only on a block that is still the tip when it fetches it, so each block
 * is mined only once every node has processed the one before.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  waitFor, waitForDaemonReady, waitForBlockProcessed, waitForAppRemoved, waitForAppInstalled, waitForInstallSettled,
} from '../framework/wait.js';
import {
  advanceBlock, getState, queueAppTx, stopTicker,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// Six nodes, the last held back: 5 dialers, 2 peers each way, which is also the floor a
// submission needs. Index 0's backward arc wraps onto the held-back slot, so nothing is
// submitted through it or asserted on it alone.
const SUBMITTER = 2; // takes submissions; holds neither app
const OBSERVER = 1; // reads the location stores, and rebuilds its app list
const HOLDER_LATE = 3;
const HOLDER_OWNER = 4;
const JOINER = 5;

// An app's term, in blocks: the spawner leaves an app with under newMinBlocksAllowance (100)
// blocks left alone, so these run only where they are installed by hand.
const TERM = 24;
// Past the term, plus two expiry passes (every 8 blocks).
const EXPIRY_BUDGET = TERM + 16;
const RENEWED_TERM = 88000;

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
  let submitter;
  let lateRenewalHash;
  let ownerRenewalHash;
  const registered = {};
  let removal;
  let installMarks;

  const specHash = async (index, name) => (await dbClient(index + 1).globalAppSpec(name))?.hash ?? null;
  const hashes = async (name) => Promise.all(liveIndices.map((i) => specHash(i, name)));
  const holderIp = (index) => subnet.nodeIp(index + 1);
  const ipOf = (address) => String(address).split(':')[0];
  const allAtTip = async () => {
    const { currentHeight } = await getState();
    const heights = await Promise.all(liveIndices.map((i) => dbClient(i + 1).explorerHeight()));
    return heights.every((h) => h >= currentHeight);
  };
  // Mines one block at a time until the condition holds, each once every node has processed the
  // one before. Budgeted in blocks, or in time for a wait on a timer.
  const driveFleetUntil = async (condition, { blocks = Infinity, timeoutMs = Infinity, label }) => {
    const deadline = Date.now() + timeoutMs;
    for (let mined = 0; mined < blocks && Date.now() < deadline; mined += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await condition()) return;
      // eslint-disable-next-line no-await-in-loop
      await advanceBlock();
      // eslint-disable-next-line no-await-in-loop
      await waitFor(allAtTip, { timeout: 150000, interval: 1000, label: `every node processes the block (${label})` });
    }
    if (!await condition()) throw new Error(`${label}: not reached within ${blocks} blocks / ${timeoutMs} ms`);
  };
  const relayedEverywhere = async (hash) => {
    const held = await Promise.all(live.map(async (node) => (await node.getTempMessages(hash)).data?.length > 0));
    return held.every(Boolean);
  };
  // Signed and relayed, then paid in the next block this suite mines.
  const submit = async (spec, type) => {
    const result = await registerApp(submitter.url, nodeKey(1), spec, type);
    expect(result.status, `${type} of ${spec.name}: ${JSON.stringify(result.data)}`).to.equal('success');
    await waitFor(() => relayedEverywhere(result.data), { timeout: 30000, interval: 2000, label: `${spec.name} ${type} relayed to every node` });
    return result.data;
  };
  const installOn = async (index, name) => {
    const client = env.clients[index];
    const auth = await authenticate(client.url, fluxTeamKey());
    const mark = client.getLastEventId();
    await client.installAppLocally(name, auth.zelidauth);
    await waitForInstallSettled(client, name, 120000, { afterId: mark });
  };
  // The holder's app:removed, then within 30 s the observer's appremoved event from that holder
  // and no location row for it there. Both stores expire their rows 63 s after the last
  // announce, so the 30 s window is what makes "gone" mean removed.
  const observeRemoval = async (holder, name, mark) => {
    await waitForAppRemoved(env.clients[holder], name, 600000, { afterId: mark });
    const observer = dbClient(OBSERVER + 1);
    await waitFor(async () => {
      const removed = await observer.appStateEvents({ type: 'appremoved', 'data.appName': name });
      const rows = await observer.getAppLocations(name);
      return removed.some((e) => ipOf(e.ip) === holderIp(holder))
        && !rows.some((r) => ipOf(r.ip) === holderIp(holder));
    }, { timeout: 30000, interval: 1000, label: `${name}'s removal on node ${holder} in both location stores of node ${OBSERVER}` });
  };

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({ hookCtx: this, nodes: 6, deferredNodes: 1, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();
    submitter = env.clients[SUBMITTER];
    live = env.clients.filter(Boolean);
    liveIndices = env.clients.map((c, i) => (c ? i : null)).filter((i) => i !== null);

    const lateRegistration = await submit(lateSpec, 'fluxappregister');
    const ownerRegistration = await submit(ownerSpec, 'fluxappregister');
    await queueAppTx(lateRegistration);
    await queueAppTx(ownerRegistration);
    await driveFleetUntil(async () => (await hashes(lateName)).every((h) => h === lateRegistration)
      && (await hashes(ownerName)).every((h) => h === ownerRegistration), { blocks: 6, label: 'both apps registered on every node' });
    registered.late = await dbClient(OBSERVER + 1).globalAppSpec(lateName);
    registered.owner = await dbClient(OBSERVER + 1).globalAppSpec(ownerName);

    await installOn(HOLDER_LATE, lateName);
    await installOn(HOLDER_OWNER, ownerName);
    // Canary: the observer holds each holder's location row before the expiry, so its absence
    // afterwards is the removal.
    await waitFor(async () => {
      const late = await dbClient(OBSERVER + 1).getAppLocations(lateName);
      const owner = await dbClient(OBSERVER + 1).getAppLocations(ownerName);
      return late.some((r) => ipOf(r.ip) === holderIp(HOLDER_LATE)) && owner.some((r) => ipOf(r.ip) === holderIp(HOLDER_OWNER));
    }, { timeout: 90000, interval: 2000, label: `node ${OBSERVER} holds both holders' location rows` });

    // Relayed while the app runs; paid after it has expired.
    lateRenewalHash = await submit({ ...lateSpec, expire: RENEWED_TERM }, 'fluxappupdate');

    const marks = {
      late: env.clients[HOLDER_LATE].getLastEventId(),
      owner: env.clients[HOLDER_OWNER].getLastEventId(),
    };
    const removals = Promise.all([
      observeRemoval(HOLDER_LATE, lateName, marks.late),
      observeRemoval(HOLDER_OWNER, ownerName, marks.owner),
    ]);
    removal = removals.then(() => null, (error) => error);
    await driveFleetUntil(async () => (await hashes(lateName)).every((h) => h === null)
      && (await hashes(ownerName)).every((h) => h === null), { blocks: EXPIRY_BUDGET, label: 'both apps expire on every node' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('records each expired app\'s removal in both location stores', async function () {
    this.timeout(60000);
    const error = await removal;
    if (error) throw error;
  });

  it('applies a renewal paid after its app expired, on every node', async function () {
    this.timeout(300000);
    installMarks = live.map((node) => node.getLastEventId());
    await queueAppTx(lateRenewalHash);
    await driveFleetUntil(async () => (await hashes(lateName)).every((h) => h === lateRenewalHash), { blocks: 12, label: `${lateName} renewed on every node` });
    expect((await dbClient(OBSERVER + 1).globalAppSpec(lateName)).expire).to.equal(RENEWED_TERM);
  });

  it('takes an owner\'s renewal of an app that has expired, on every node', async function () {
    this.timeout(300000);
    ownerRenewalHash = await submit({ ...ownerSpec, expire: RENEWED_TERM }, 'fluxappupdate');
    await queueAppTx(ownerRenewalHash);
    await driveFleetUntil(async () => (await hashes(ownerName)).every((h) => h === ownerRenewalHash), { blocks: 12, label: `${ownerName} renewed on every node` });
  });

  it('holds the same renewals after rebuilding its app list from its message log', async function () {
    this.timeout(180000);
    expect(lateRenewalHash, 'the late renewal was applied').to.be.a('string');
    expect(ownerRenewalHash, 'the owner\'s renewal was applied').to.be.a('string');
    const db = dbClient(OBSERVER + 1);
    // Canary: the node is put back to the registrations, so only the rebuild can restore the
    // renewals.
    await db.replaceGlobalAppSpec(registered.late);
    await db.replaceGlobalAppSpec(registered.owner);
    expect(await specHash(OBSERVER, lateName)).to.equal(registered.late.hash);

    const client = env.clients[OBSERVER];
    const res = await client.reindexGlobalApps(client.zelidauth);
    expect(res.status, JSON.stringify(res)).to.equal('success');
    expect(await specHash(OBSERVER, lateName)).to.equal(lateRenewalHash);
    expect(await specHash(OBSERVER, ownerName)).to.equal(ownerRenewalHash);
  });

  it('holds the same renewals on a node that joins afterwards and syncs them in bulk', async function () {
    this.timeout(600000);
    expect(ownerRenewalHash, 'the owner\'s renewal was applied').to.be.a('string');
    await env.startNode(JOINER);
    await waitForDaemonReady(env.clients[JOINER]);
    await waitForBlockProcessed(env.clients[JOINER], () => true, 120000);
    await env.startDiscovery([JOINER]);
    // Hash sync runs on a timer, so the budget is time; the driver keeps the chain moving.
    await driveFleetUntil(async () => await specHash(JOINER, lateName) === lateRenewalHash
      && await specHash(JOINER, ownerName) === ownerRenewalHash, { timeoutMs: 300000, label: 'the joining node holds both renewals' });
  });

  it('announces the revived app in both location stores', async function () {
    this.timeout(300000);
    expect(installMarks, 'the late renewal was paid').to.be.an('array');
    // The spawner places the revived app on its timer, anywhere it fits.
    const installed = await Promise.any(live.map((node, i) => waitForAppInstalled(node, lateName, 240000, { afterId: installMarks[i] })
      .then(() => i)));
    const holder = liveIndices[installed];
    const observer = holder === OBSERVER ? HOLDER_OWNER : OBSERVER;
    const since = Date.now() - 60000;
    await waitFor(async () => {
      const db = dbClient(observer + 1);
      const rows = await db.getAppLocations(lateName);
      const running = await db.appStateEvents({ type: 'apprunning' });
      return rows.some((r) => ipOf(r.ip) === holderIp(holder))
        && running.some((e) => ipOf(e.ip) === holderIp(holder) && new Date(e.broadcastedAt).getTime() > since
          && (e.data?.apps ?? []).some((a) => a.name === lateName));
    }, { timeout: 90000, interval: 2000, label: `node ${holder}'s ${lateName} in both location stores of node ${observer}` });
  });
});
