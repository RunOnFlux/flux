/*
 * A node still holding an app whose installed term has ended keeps it when the name reached
 * another owner by a sale, and removes it with its data, telling the network, when another owner
 * registered the name afresh.
 *
 * In a block a node processes at the tip, the passes run before the block's own messages are
 * stored and before its height is recorded: the expiry pass in block h judges terms at h - 1, and
 * a message paid in block h is seen by the passes of later blocks. The expiry pass runs on
 * multiples of the expiry period, the reinstall pass on multiples of four times its period, and
 * a block's expiry pass runs before its reinstall pass.
 *
 * Alice registers two apps with a 24-block term in block R, one short of a multiple of the expiry
 * period, and each is installed on a holder of its own with a file of hers in its volume. Both
 * terms end at E = R + 24. One app is sold to Bob in block E - 2 and updated by Bob in block E.
 * The expiry pass in block E + 1 judges both at E: each installed record has lapsed, and the
 * network holds the sold one in force under Bob and the other not at all. Neither block between
 * the sale and that pass runs a reinstall pass, so the sold app's record is still Alice's when it
 * is judged. The pass's decision about each installed app is read from its counter.
 *
 * A node with a name installed refuses another owner's registration of it at its door, relayed or
 * requested; one that has fallen more than 500 messages behind catches up in bulk, which stores
 * the message log as the network holds it. So the other app's holder is put that far behind -
 * the payment records of the mainnet message slice, the messages held by its peers - before Bob
 * registers the expired name again, and its removal of Alice's install is held at
 * removalQueue:beforeRemoval, as a node with removals queued ahead of it would hold it. Its
 * reinstall pass then finds Alice's install under a name Bob registered afresh.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, otherOwnerKeys, nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  waitFor, waitForAppRemoved, waitForInstallSettled,
} from '../framework/wait.js';
import { getState, queueAppTx, stopTicker } from '../framework/daemon-control.js';
import {
  driveFleetUntil, mineFleetBlock, relayedToFleet, liveIndices,
} from '../framework/fleet-chain.js';
import { PON_SPEED_MULTIPLIER } from '../framework/coupled-knobs.js';
import { loadMessageSlice } from '../framework/message-slice.js';
import { dbClient } from '../framework/db-client.js';
import {
  seedVolumeTree, volumeRoot, contentOf, exists,
} from '../framework/volume-fixture.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// Five nodes: 5 dialers, 2 peers each way, the floor a submission needs. Nothing is submitted
// through index 0 or asserted on it alone.
const OBSERVER = 1; // reads the holders' removals from the network
const SUBMITTER = 2; // takes every submission
const SOLD_HOLDER = 3; // holds the app that is sold
const TAKEN_HOLDER = 4; // holds the app whose name is registered again

const CHECKPOINT = 'removalQueue:beforeRemoval';
const DECISION = 'expiry:installedApp';
const TERM = 24;
const RENEWED_TERM = 88000;
// explorerService: the expiry pass every 2 blocks, the reinstall pass every 4-9, both times the
// PON speed multiplier.
const EXPIRY_PERIOD = 2 * PON_SPEED_MULTIPLIER;
const REINSTALL_BUDGET = 9 * PON_SPEED_MULTIPLIER + EXPIRY_PERIOD;

describe('a name past its installed term is kept for a buyer and removed for a new registrant', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const slice = loadMessageSlice();
  const alice = appOwnerKey();
  const [bob] = otherOwnerKeys();
  const stamp = Date.now();
  const soldName = `e2eSoldPast${stamp}`;
  const takenName = `e2eTakenPast${stamp}`;
  const aliceFile = 'appdata/alice.txt';

  const appSpec = (name, ownerKey, expire) => buildAppSpec({
    name,
    ownerKey,
    instances: 1,
    expire,
    compose: [{
      name,
      description: 'name tenure test container',
      repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
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
  const soldSpec = appSpec(soldName, alice, TERM);
  const takenSpec = appSpec(takenName, alice, TERM);

  let soldHolder;
  let takenHolder;
  let termEnd;
  let takenBeforeDecidingPass;
  let bobUpdate;

  const height = async () => (await getState()).currentHeight;
  const globalHashes = (name) => Promise.all(liveIndices(env).map(async (i) => (await dbClient(i + 1).globalAppSpec(name))?.hash ?? null));
  const onEveryNode = (name, hash, label) => waitFor(
    async () => (await globalHashes(name)).every((h) => h === hash),
    { timeout: 60000, interval: 1000, label },
  );
  // Signed by the key given, relayed to the nodes named (every node by default); paid in the next
  // block this suite mines.
  const submit = async (spec, type, ownerKey, { indices = liveIndices(env) } = {}) => {
    const result = await registerApp(env.clients[SUBMITTER].url, nodeKey(1), spec, type, { ownerKey });
    expect(result.status, `${type} of ${spec.name}: ${JSON.stringify(result.data)}`).to.equal('success');
    await waitFor(() => relayedToFleet(env, result.data, { indices }), { timeout: 30000, interval: 2000, label: `${spec.name} ${type} relayed to nodes ${indices}` });
    return result.data;
  };
  // A holder's installed record, past the route's 30-second cache.
  const installedRecord = async (holder, name) => {
    const res = await holder.get(`/apps/installedapps?_=${Date.now()}`);
    return (res.data ?? []).find((app) => app.name === name) ?? null;
  };
  const aliceFilePath = (name) => `${volumeRoot(name)}/${aliceFile}`;
  const installWithAlicesFile = async (holder, name) => {
    const auth = await authenticate(holder.url, fluxTeamKey());
    const mark = holder.getLastEventId();
    await holder.installAppLocally(name, auth.zelidauth);
    await waitForInstallSettled(holder, name, 120000, { afterId: mark });
    expect(await installedRecord(holder, name), `${name} installed`).to.include({ owner: alice.zelid });
    await seedVolumeTree(holder.container, name, { [aliceFile]: 'alice' });
  };

  before(async function () {
    this.timeout(1200000);
    // The chain starts above the slice, so its payments are in every node's past.
    env = await createTestEnv({
      hookCtx: this, nodes: 5, tickerAutostart: false, initialHeight: slice.manifest.scannedHeight + 1,
    });
    await bootAndPeer(env);
    await stopTicker();
    soldHolder = env.clients[SOLD_HOLDER];
    takenHolder = env.clients[TAKEN_HOLDER];

    // Every node but the taken app's holder holds the slice, messages and payments alike.
    await Promise.all(liveIndices(env).filter((i) => i !== TAKEN_HOLDER).map(async (i) => {
      await dbClient(i + 1).seedPermanentMessages(slice.messages);
      await dbClient(i + 1).seedAppHashes(slice.records.map((record) => ({ ...record, message: true, messageNotFound: false })));
    }));

    const soldRegistration = await submit(soldSpec, 'fluxappregister', alice);
    const takenRegistration = await submit(takenSpec, 'fluxappregister', alice);
    await driveFleetUntil(env, async () => (await height()) % EXPIRY_PERIOD === EXPIRY_PERIOD - 2, {
      blocks: EXPIRY_PERIOD, label: 'the next block is one short of an expiry-pass block',
    });
    await queueAppTx(soldRegistration);
    await queueAppTx(takenRegistration);
    await mineFleetBlock(env, { label: 'both registrations' });
    const registeredAt = await height();
    expect(registeredAt % EXPIRY_PERIOD, 'registered one block short of an expiry-pass block').to.equal(EXPIRY_PERIOD - 1);
    termEnd = registeredAt + TERM;
    await onEveryNode(soldName, soldRegistration, `${soldName} registered on every node`);
    await onEveryNode(takenName, takenRegistration, `${takenName} registered on every node`);

    await installWithAlicesFile(soldHolder, soldName);
    await installWithAlicesFile(takenHolder, takenName);
    await takenHolder.holdCheckpoint(CHECKPOINT, takenName);

    await driveFleetUntil(env, async () => (await height()) === termEnd - 3, {
      blocks: TERM, label: 'three blocks before the terms end',
    });
    // Alice's update naming Bob, inside her term, paid in block E - 2.
    const sale = await submit({ ...soldSpec, owner: bob.zelid, expire: RENEWED_TERM }, 'fluxappupdate', alice);
    await queueAppTx(sale);
    await mineFleetBlock(env, { label: 'the sale' });
    await onEveryNode(soldName, sale, `${soldName} sold to Bob on every node`);
    await mineFleetBlock(env, { label: 'the block before the terms end' });
    // Bob's own update, paid in block E, the first block past Alice's term.
    bobUpdate = await submit({
      ...soldSpec, owner: bob.zelid, expire: RENEWED_TERM, description: `${soldSpec.description}, updated by its buyer`,
    }, 'fluxappupdate', bob);
    await queueAppTx(bobUpdate);
    await mineFleetBlock(env, { label: 'the block the terms end at' });
    expect(await height(), 'the block the terms end at').to.equal(termEnd);
    await onEveryNode(soldName, bobUpdate, `${soldName} at Bob's update on every node`);
    // The expiry pass that judges both apps at E.
    takenBeforeDecidingPass = takenHolder.getLastEventId();
    await mineFleetBlock(env, { label: 'the expiry pass that judges the terms' });
    expect((await height()) % EXPIRY_PERIOD, 'an expiry-pass block').to.equal(0);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('keeps the sold app at the end of its term, and removes the expired one', async function () {
    this.timeout(120000);
    expect(await soldHolder.getDecisionCount(DECISION, soldName, 'kept'), `${soldName} kept`).to.be.at.least(1);
    expect(await soldHolder.getDecisionCount(DECISION, soldName, 'removed'), `${soldName} removed`).to.equal(0);
    expect(await takenHolder.getDecisionCount(DECISION, takenName, 'removed'), `${takenName} removed`).to.be.at.least(1);
    await takenHolder.waitForEvent('checkpoint:held', (d) => d.name === CHECKPOINT && d.key === takenName, 60000, { afterId: takenBeforeDecidingPass });
  });

  it('rebuilds the sold app at Bob\'s spec, with Alice\'s files', async function () {
    this.timeout(1500000);
    await driveFleetUntil(env, async () => (await installedRecord(soldHolder, soldName))?.hash === bobUpdate, {
      blocks: REINSTALL_BUDGET, label: `the holder runs ${soldName} at Bob's update`,
    });
    expect(await installedRecord(soldHolder, soldName)).to.include({ owner: bob.zelid });
    expect(await contentOf(soldHolder.container, aliceFilePath(soldName))).to.equal('alice');
  });

  it('removes the app whose name Bob registered again, with Alice\'s files, and tells the network', async function () {
    this.timeout(1500000);
    // Canary: Alice's file is on the holder until the removal.
    expect(await exists(takenHolder.container, aliceFilePath(takenName)), 'Alice\'s file before the registration').to.equal(true);

    // More than 500 payments whose messages the holder lacks: its next hash sync is a bulk one.
    await dbClient(TAKEN_HOLDER + 1).seedAppHashes(slice.records.map((record) => ({ ...record, message: false, messageNotFound: false })));
    // Refused by the holder at its door, with the name installed there.
    const everyNodeButTheHolder = liveIndices(env).filter((i) => i !== TAKEN_HOLDER);
    const registration = await submit(appSpec(takenName, bob, RENEWED_TERM), 'fluxappregister', bob, { indices: everyNodeButTheHolder });
    const mark = takenHolder.getLastEventId();
    const bulk = takenHolder.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 1200000, { afterId: mark });
    let removed = false;
    const removal = waitForAppRemoved(takenHolder, takenName, 1500000, { afterId: mark }).then(() => { removed = true; });
    await queueAppTx(registration);
    // Hash sync runs on a timer, so the budget is time; the drive keeps the chain moving.
    await driveFleetUntil(env, async () => removed, {
      timeoutMs: 1200000, label: `the holder takes ${takenName}'s registration in bulk and removes Alice's install`,
    });
    await removal;
    await bulk;

    expect(await exists(takenHolder.container, aliceFilePath(takenName)), 'Alice\'s file after the removal').to.equal(false);
    const ipOf = (address) => String(address).split(':')[0];
    await waitFor(async () => {
      const removals = await dbClient(OBSERVER + 1).appStateEvents({ type: 'appremoved', 'data.appName': takenName });
      return removals.some((e) => ipOf(e.ip) === subnet.nodeIp(TAKEN_HOLDER + 1));
    }, { timeout: 30000, interval: 1000, label: `node ${OBSERVER} hears the holder's removal of ${takenName}` });
  });
});
