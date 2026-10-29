/*
 * A node still holding an app whose installed term has ended keeps it when the name reached
 * another owner by a sale, and removes it with its data, telling the network, when another owner
 * registered the name afresh.
 *
 * Alice registers two apps with a 24-block term in a block at a multiple of the expiry period, and
 * the holder installs both with a file of hers in each volume. Both terms end at block E, which the
 * expiry pass runs on. One app is sold to Bob at E - 1 and updated by Bob at E, so at E its
 * installed record has lapsed while the network holds Bob's spec in force. The other lapses at E,
 * and Bob registers its name again afterwards.
 *
 * The holder's removal queue is held at removalQueue:beforeRemoval for both names, as a node with a
 * queue of removals ahead of them would hold them. The expiry pass at E decides which it queues;
 * the reinstall pass after it decides what the holder does with each install: rebuild the sold app
 * at Bob's spec with Alice's files, remove the registered-again one with its files. A block's expiry
 * pass runs before its reinstall pass and an odd height runs no reinstall pass, so the sale at
 * E - 1 and Bob's update at E reach the expiry pass before the holder's record is refreshed.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, otherOwnerKeys, nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  waitFor, waitForAppRemoved, waitForInstallSettled, assertNoEvent,
} from '../framework/wait.js';
import { getState, queueAppTx, stopTicker } from '../framework/daemon-control.js';
import {
  driveFleetUntil, mineFleetBlock, relayedToFleet, liveIndices,
} from '../framework/fleet-chain.js';
import { PON_SPEED_MULTIPLIER } from '../framework/coupled-knobs.js';
import { dbClient } from '../framework/db-client.js';
import {
  seedVolumeTree, volumeRoot, contentOf, exists,
} from '../framework/volume-fixture.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// Five nodes: 5 dialers, 2 peers each way, the floor a submission needs. Nothing is submitted
// through index 0 or asserted on it alone.
const OBSERVER = 1; // reads the holder's removal from the network
const SUBMITTER = 2; // takes every submission
const HOLDER = 3; // holds both apps

const CHECKPOINT = 'removalQueue:beforeRemoval';
const TERM = 24;
const RENEWED_TERM = 88000;
// explorerService: the expiry pass every 2 blocks, the reinstall pass every 4-9, both times the
// PON speed multiplier.
const EXPIRY_PERIOD = 2 * PON_SPEED_MULTIPLIER;
const REINSTALL_BUDGET = 9 * PON_SPEED_MULTIPLIER + EXPIRY_PERIOD;

describe('a name past its installed term is kept for a buyer and removed for a new registrant', function () {
  let env;
  dumpLogsOnFailure(() => env);

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

  let holder;
  let termEnd;
  let atTermEnd;
  let bobUpdate;

  const height = async () => (await getState()).currentHeight;
  const globalHashes = (name) => Promise.all(liveIndices(env).map(async (i) => (await dbClient(i + 1).globalAppSpec(name))?.hash ?? null));
  const onEveryNode = (name, hash, label) => waitFor(
    async () => (await globalHashes(name)).every((h) => h === hash),
    { timeout: 60000, interval: 1000, label },
  );
  // Signed by the key given, relayed to every node; paid in the next block this suite mines.
  const submit = async (spec, type, ownerKey) => {
    const result = await registerApp(env.clients[SUBMITTER].url, nodeKey(1), spec, type, { ownerKey });
    expect(result.status, `${type} of ${spec.name}: ${JSON.stringify(result.data)}`).to.equal('success');
    await waitFor(() => relayedToFleet(env, result.data), { timeout: 30000, interval: 2000, label: `${spec.name} ${type} relayed to every node` });
    return result.data;
  };
  // The holder's installed record, past the route's 30-second cache.
  const installedRecord = async (name) => {
    const res = await holder.get(`/apps/installedapps?_=${Date.now()}`);
    return (res.data ?? []).find((app) => app.name === name) ?? null;
  };
  const aliceFilePath = (name) => `${volumeRoot(name)}/${aliceFile}`;

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();
    holder = env.clients[HOLDER];

    const soldRegistration = await submit(soldSpec, 'fluxappregister', alice);
    const takenRegistration = await submit(takenSpec, 'fluxappregister', alice);
    await driveFleetUntil(env, async () => (await height()) % EXPIRY_PERIOD === EXPIRY_PERIOD - 1, {
      blocks: EXPIRY_PERIOD, label: 'the next block is an expiry-pass block',
    });
    await queueAppTx(soldRegistration);
    await queueAppTx(takenRegistration);
    await mineFleetBlock(env, { label: 'both registrations' });
    const registeredAt = await height();
    expect(registeredAt % EXPIRY_PERIOD, 'registered on an expiry-pass block').to.equal(0);
    termEnd = registeredAt + TERM;
    await onEveryNode(soldName, soldRegistration, `${soldName} registered on every node`);
    await onEveryNode(takenName, takenRegistration, `${takenName} registered on every node`);

    const auth = await authenticate(holder.url, fluxTeamKey());
    for (const name of [soldName, takenName]) {
      const mark = holder.getLastEventId();
      // eslint-disable-next-line no-await-in-loop
      await holder.installAppLocally(name, auth.zelidauth);
      // eslint-disable-next-line no-await-in-loop
      await waitForInstallSettled(holder, name, 120000, { afterId: mark });
      // eslint-disable-next-line no-await-in-loop
      expect(await installedRecord(name), `${name} installed on the holder`).to.include({ owner: alice.zelid });
      // eslint-disable-next-line no-await-in-loop
      await seedVolumeTree(holder.container, name, { [aliceFile]: 'alice' });
      // eslint-disable-next-line no-await-in-loop
      await holder.holdCheckpoint(CHECKPOINT, name);
    }

    await driveFleetUntil(env, async () => (await height()) === termEnd - 2, {
      blocks: TERM, label: 'two blocks before the terms end',
    });
    // Alice's update naming Bob, inside her term.
    const sale = await submit({ ...soldSpec, owner: bob.zelid, expire: RENEWED_TERM }, 'fluxappupdate', alice);
    await queueAppTx(sale);
    await mineFleetBlock(env, { label: 'the sale' });
    await onEveryNode(soldName, sale, `${soldName} sold to Bob on every node`);
    // Bob's own update, in the block Alice's term ends at.
    bobUpdate = await submit({
      ...soldSpec, owner: bob.zelid, expire: RENEWED_TERM, description: `${soldSpec.description}, updated by its buyer`,
    }, 'fluxappupdate', bob);
    await queueAppTx(bobUpdate);
    atTermEnd = holder.getLastEventId();
    await mineFleetBlock(env, { label: 'the block the terms end at' });
    expect(await height(), 'the terms end on an expiry-pass block').to.equal(termEnd);
    await onEveryNode(soldName, bobUpdate, `${soldName} at Bob's update on every node`);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('queues the expired app for removal at the end of its term, and not the sold one', async function () {
    this.timeout(120000);
    await holder.waitForEvent('checkpoint:held', (d) => d.name === CHECKPOINT && d.key === takenName, 60000, { afterId: atTermEnd });
    await assertNoEvent(holder, 'checkpoint:held', (d) => d.name === CHECKPOINT && d.key === soldName, 5000, { afterId: atTermEnd });
  });

  it('rebuilds the sold app at Bob\'s spec, with Alice\'s files', async function () {
    this.timeout(1500000);
    await driveFleetUntil(env, async () => (await installedRecord(soldName))?.hash === bobUpdate, {
      blocks: REINSTALL_BUDGET, label: `the holder runs ${soldName} at Bob's update`,
    });
    expect(await installedRecord(soldName)).to.include({ owner: bob.zelid });
    expect(await contentOf(holder.container, aliceFilePath(soldName))).to.equal('alice');
  });

  it('removes the app whose name Bob registered again, with Alice\'s files, and tells the network', async function () {
    this.timeout(1500000);
    // Canary: Alice's file is on the holder until the removal.
    expect(await exists(holder.container, aliceFilePath(takenName)), 'Alice\'s file before the registration').to.equal(true);
    const registration = await submit(appSpec(takenName, bob, RENEWED_TERM), 'fluxappregister', bob);
    const mark = holder.getLastEventId();
    let removed = false;
    const removal = waitForAppRemoved(holder, takenName, 1500000, { afterId: mark }).then(() => { removed = true; });
    await queueAppTx(registration);
    await driveFleetUntil(env, async () => removed, {
      blocks: REINSTALL_BUDGET, label: `the holder removes ${takenName}`,
    });
    await removal;

    expect(await exists(holder.container, aliceFilePath(takenName)), 'Alice\'s file after the removal').to.equal(false);
    const ipOf = (address) => String(address).split(':')[0];
    await waitFor(async () => {
      const removals = await dbClient(OBSERVER + 1).appStateEvents({ type: 'appremoved', 'data.appName': takenName });
      return removals.some((e) => ipOf(e.ip) === subnet.nodeIp(HOLDER + 1));
    }, { timeout: 30000, interval: 1000, label: `node ${OBSERVER} hears the holder's removal of ${takenName}` });
  });
});
