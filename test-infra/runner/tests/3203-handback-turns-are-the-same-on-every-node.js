/*
 * Evacuating holders of one app hand it back in turns every node computes the same.
 *
 * A turn is cut from block time and belongs to the holder with the lowest hash of the turn
 * number and its signing key; the holders are the ones the app's signed announcements name. A
 * holder acts only on the second pass of a turn it owns, and not once the chain has reached the
 * next pass; it tells the network before it tears the app down. Each test here moves one input a
 * holder could otherwise disagree on - when a holder started counting, a restart, a late pass, an
 * eviction, an address move, a spare copy, a lapsing announcement, a decision the chain outran, a
 * removal still running - and checks the turn did not move with it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { dbClient } from '../framework/db-client.js';
import {
  advanceBlock, driveUntil, getState, startTicker, stopTicker, clearSystemSecure, setSystemSecure,
} from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { retireApp } from '../framework/reconciler-suite.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { apprunningEvent } from '../framework/state-events.js';
import {
  subnet, TARGET, SECOND_TARGET, PASS_PERIOD_BLOCKS, PASS_MS, RESIDENTIAL_PACING,
  bootResidentialFleet, seedApp, returnToService, elapseSettleWindow, departureWaitMs,
} from '../framework/residential-fleet.js';
import { keysOf, turnOf } from '../framework/handback-turns.js';

const FLEET = [1, 2, 3, 4, 5];
const HOLDERS = keysOf(FLEET);
const PERIOD = PASS_PERIOD_BLOCKS * 4;
const TURN_MS = RESIDENTIAL_PACING.residentialTurnMs;

const eventsOf = (client, name, predicate = () => true, afterId = 0) => client.getEventBuffer()
  .filter((e) => e.id > afterId && e.event === name && predicate(e.data));
const turnsOf = (client, appName, afterId = 0) => eventsOf(client, 'giveUp:turn', (d) => d.appName === appName, afterId);
const departuresOf = (client, appName, afterId = 0) => eventsOf(client, 'app:removed', (d) => d.name === appName, afterId);

// The apps seeded on the fleet and not yet retired.
const seeded = [];

/**
 * Retire every app an earlier test seeded, so the evacuating nodes hold this
 * test's app alone, then seed one every fleet node holds and start the given
 * nodes evacuating. A pass hands back one app, and returning a node to service
 * lets the spawner refill any app an earlier departure left short, so an app
 * left on the fleet would be judged ahead of this one.
 */
async function seedAndEvacuate(env, appName, nodes) {
  while (seeded.length) await retireApp(env, seeded.pop());
  await Promise.all(FLEET.map((node) => returnToService(env, node)));
  seeded.push(await seedApp(env, appName, { instances: FLEET.length }));
  await startTicker();
  await waitFor(async () => (await dbClient(2).getAppLocations(appName)).length >= FLEET.length,
    { timeout: 300000, label: `${appName} reaches its instance count across the fleet` });
  // eslint-disable-next-line no-restricted-syntax
  for (const node of nodes) {
    // eslint-disable-next-line no-await-in-loop
    const installed = await env.clients[node - 1].get(`/apps/installedapps?_=${Date.now()}`);
    expect(installed.data.map((a) => a.name), `fixture: node ${node} holds an app besides ${appName}`).to.eql([appName]);
  }
  await Promise.all(nodes.map((node) => setSystemSecure(subnet.nodeIp(node), false)));
  await Promise.all(nodes.map((node) => waitFor(
    async () => (await dbClient(node).residentialMarker()) !== null,
    { timeout: 120000, label: `node ${node} starts its settling window` },
  )));
  await Promise.all(nodes.map((node) => elapseSettleWindow(node)));
  await stopTicker();
}

describe('handback turns are the same on every node', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await bootResidentialFleet(this);
  });

  after(async function () {
    this.timeout(120000);
    await Promise.all((env?.clients ?? []).map((client) => client.releaseAllCheckpoints().catch(() => {})));
    await clearSystemSecure().catch(() => {});
    await stopTicker().catch(() => {});
    if (env) await env.teardown();
  });

  // First, while node 1 holds this app alone: the first turn it can act in is this app's.
  it('a removal the chain has outrun since it was decided is not made', async function () {
    this.timeout(1500000);
    const one = env.clients[TARGET - 1];
    const ownKey = keysOf([TARGET])[0];
    await seedAndEvacuate(env, 'staleapp', [TARGET]);
    await one.holdCheckpoint('giveUp:beforeRemoval', 'staleapp');
    const anchor = one.getLastEventId();
    try {
      const held = () => eventsOf(one, 'checkpoint:held', (d) => d.name === 'giveUp:beforeRemoval' && d.key === 'staleapp', anchor).length > 0;
      // The turns node 1 owned and had a second pass in, by its own account of them.
      const turnsItCouldActIn = () => new Set(turnsOf(one, 'staleapp', anchor)
        .filter((e) => e.data.owner === ownKey && e.data.previousTurn === e.data.turn)
        .map((e) => e.data.turn)).size;
      await driveUntil(one, async () => held() || turnsItCouldActIn() >= 2, { timeoutMs: 1200000 });
      expect(held(), `no decision in ${turnsItCouldActIn()} turns it could act in`).to.equal(true);
      // The next pass: the last a removal may start in and still be told before another holder decides.
      const { currentHeight } = await getState();
      await driveUntil(one, async () => (await getState()).currentHeight >= currentHeight + PERIOD, { blocks: 2 * PERIOD });
      await one.releaseCheckpoint('giveUp:beforeRemoval', 'staleapp');
      const stale = () => eventsOf(one, 'giveUp:decisionStale', (d) => d.appName === 'staleapp', anchor);
      await waitFor(async () => stale().length > 0 || departuresOf(one, 'staleapp', anchor).length > 0,
        { timeout: 60000, label: 'the released decision is carried out or dropped' });

      expect(departuresOf(one, 'staleapp', anchor), 'the outrun removal was made').to.have.lengthOf(0);
      expect(stale()[0].data.tip).to.be.at.least(stale()[0].data.dueHeight + PERIOD);
      const installed = await one.get('/apps/installedapps');
      expect(installed.data.map((a) => a.name)).to.include('staleapp');
    } finally {
      await one.releaseCheckpoint('giveUp:beforeRemoval', 'staleapp').catch(() => {});
      await startTicker();
    }
  });

  it('a holder handing an app back is no holder to the others while its removal runs', async function () {
    this.timeout(1500000);
    const nodes = [TARGET, SECOND_TARGET];
    const clients = nodes.map((node) => env.clients[node - 1]);
    await seedAndEvacuate(env, 'leaveapp', nodes);
    // Whichever holder decides first is held with its removal committed and nothing torn down.
    await Promise.all(clients.map((client) => client.holdCheckpoint('removal:beforeTeardown', 'leaveapp')));
    const anchors = clients.map((client) => client.getLastEventId());
    try {
      const heldOn = () => clients.findIndex((client, i) => eventsOf(client, 'checkpoint:held',
        (d) => d.name === 'removal:beforeTeardown' && d.key === 'leaveapp', anchors[i]).length > 0);
      await driveUntil(clients[0], async () => heldOn() >= 0, { timeoutMs: 1200000 });
      const leaving = heldOn();
      expect(leaving, 'neither holder decided to hand leaveapp back').to.be.at.least(0);
      const observer = clients[1 - leaving];
      const leavingKey = keysOf([nodes[leaving]])[0];
      const anchor = observer.getLastEventId();
      await driveUntil(observer, async () => turnsOf(observer, 'leaveapp', anchor).length > 0, { blocks: 2 * PERIOD });
      await startTicker();

      const [judged] = turnsOf(observer, 'leaveapp', anchor);
      expect(judged, 'the other holder ran no pass while the removal was held').to.not.equal(undefined);
      expect(judged.data.holders, 'counted a holder whose removal was under way').to.not.include(leavingKey);
    } finally {
      await Promise.all(clients.map((client) => client.releaseCheckpoint('removal:beforeTeardown', 'leaveapp').catch(() => {})));
      await startTicker();
    }
  });

  it('a holder that starts counting late never hands an app back on the same pass as one that started on time', async function () {
    this.timeout(900000);
    const [one, three] = [env.clients[TARGET - 1], env.clients[SECOND_TARGET - 1]];
    // Node 3's passes are held, so it judges nothing until node 1 has been counting a turn.
    await three.holdCheckpoint('giveUp:beforePass');
    try {
    await seedAndEvacuate(env, 'startapp', [TARGET, SECOND_TARGET]);
    const anchor = Math.min(one.getLastEventId(), three.getLastEventId());

    const refusedShort = (client) => eventsOf(client, 'giveUp:considered',
      (d) => d.appName === 'startapp' && d.giveUp === false && d.code === 'BELOW_INSTANCE_COUNT', anchor).length > 0;
    const departures = () => departuresOf(one, 'startapp', anchor).length + departuresOf(three, 'startapp', anchor).length;
    await driveUntil(one, async () => eventsOf(one, 'giveUp:considered', (d) => d.appName === 'startapp', anchor).length > 0,
      { blocks: PERIOD * 3 });
    const releaseAt = Date.now() + TURN_MS;
    let released = false;
    await driveUntil(one, async () => {
      if (!released && Date.now() >= releaseAt) {
        released = true;
        await three.releaseCheckpoint('giveUp:beforePass');
      }
      return released && (departures() >= 2 || ((refusedShort(one) || refusedShort(three)) && departures() === 1));
    }, { timeoutMs: TURN_MS + departureWaitMs([TARGET, SECOND_TARGET], FLEET.length) });
    await startTicker();

    expect(departures(), 'both holders handed startapp back').to.equal(1);
    const [departed] = [one, three].filter((client) => departuresOf(client, 'startapp', anchor).length);
    const removal = departuresOf(departed, 'startapp', anchor)[0];
    const turn = turnsOf(departed, 'startapp', anchor).filter((e) => e.id < removal.id).pop();
    expect(turn.data.owner, 'handed back in a turn it did not own').to.equal(keysOf([departed === one ? TARGET : SECOND_TARGET])[0]);
    expect(turn.data.previousTurn, 'handed back on the first pass of its turn').to.equal(turn.data.turn);
    } finally {
      await three.releaseCheckpoint('giveUp:beforePass').catch(() => {});
      await startTicker();
    }
  });

  it('a holder restarted mid-queue judges each pass by the same turn as the others', async function () {
    this.timeout(900000);
    const one = env.clients[TARGET - 1];
    await seedAndEvacuate(env, 'restartapp', [TARGET, SECOND_TARGET]);

    await env.restartNode(SECOND_TARGET - 1);
    const three = env.clients[SECOND_TARGET - 1];
    const anchorOne = one.getLastEventId();
    const anchorThree = three.getLastEventId();
    const common = () => {
      const byHeight = new Map(turnsOf(one, 'restartapp', anchorOne).map((e) => [e.data.dueHeight, e.data]));
      return turnsOf(three, 'restartapp', anchorThree).map((e) => [byHeight.get(e.data.dueHeight), e.data]).filter(([a]) => a);
    };
    // The restart's SIGTERM drops node 3 from node 1's count until node 3
    // announces again, so for a while the two count different holders: node 1
    // then sees the app short and stands still. Driven until a pass both judged
    // on the same holders, or a holder leaves.
    const sameHolders = ([a, b]) => [...a.holders].sort().join() === [...b.holders].sort().join();
    const departed = () => departuresOf(one, 'restartapp', anchorOne).length + departuresOf(three, 'restartapp', anchorThree).length;
    await driveUntil(one, async () => common().some(sameHolders) || departed() > 0, { timeoutMs: 6 * PASS_MS + 120000 });
    await startTicker();

    expect(common(), 'no pass both nodes judged after the restart').to.not.be.empty;
    for (const [onOne, onThree] of common()) {
      expect(onThree.turn, `turn at ${onThree.dueHeight}`).to.equal(onOne.turn);
      if (sameHolders([onOne, onThree])) expect(onThree.owner, `owner at ${onThree.dueHeight}`).to.equal(onOne.owner);
    }
    expect(departed(), 'both handed restartapp back').to.be.at.most(1);
  });

  it('a node that runs a pass late judges it at the block the pass fell due on', async function () {
    this.timeout(900000);
    const [one, three] = [env.clients[TARGET - 1], env.clients[SECOND_TARGET - 1]];
    await seedAndEvacuate(env, 'lateapp', [TARGET, SECOND_TARGET]);

    // The due block lands just before a turn ends, and the late node reaches the tip after it
    // has: judged at the tip block's time, it would read the next turn.
    const { currentHeight } = await getState();
    const due = (Math.floor((currentHeight + 2) / PERIOD) + 1) * PERIOD;
    await driveUntil(one, async () => (await getState()).currentHeight >= due - 1, { blocks: PERIOD * 2 });
    await three.holdCheckpoint('explorer:beforeBlock');
    try {
    let turnEnd = (turnOf(Date.now(), TURN_MS) + 1) * TURN_MS;
    if (turnEnd - Date.now() < 4000) turnEnd += TURN_MS;
    await sleepUnlessInfraDead(Math.max(0, turnEnd - 3000 - Date.now()));
    const anchorOne = one.getLastEventId();
    await advanceBlock();
    const onTime = await one.waitForEvent('giveUp:turn', (d) => d.appName === 'lateapp' && d.dueHeight === due, 60000, { afterId: anchorOne });
    await sleepUnlessInfraDead(Math.max(0, turnEnd + 1000 - Date.now()));
    await advanceBlock();
    await advanceBlock();
    const anchorThree = three.getLastEventId();
    await three.releaseCheckpoint('explorer:beforeBlock');
    const late = await three.waitForEvent('giveUp:turn', (d) => d.appName === 'lateapp' && d.dueHeight === due, 120000, { afterId: anchorThree });
    const ran = eventsOf(three, 'blockWork:ran', (d) => d.job === 'checkAndRemoveApplicationInstance', anchorThree).map((e) => e.data.height);
    await startTicker();

    expect(ran, 'the held node did not run the pass late').to.include(due + 2);
    expect(late.data.turn, 'the late node read the turn of the block it reached the tip on').to.equal(onTime.data.turn);
    expect(late.data.owner).to.equal(onTime.data.owner);
    } finally {
      await three.releaseCheckpoint('explorer:beforeBlock').catch(() => {});
      await startTicker();
    }
  });

  it('an eviction does not take a holder out of the count', async function () {
    this.timeout(900000);
    const one = env.clients[TARGET - 1];
    await seedAndEvacuate(env, 'evictapp', [TARGET]);
    const evicted = `${subnet.nodeIp(4)}:16127`;
    const missing = async () => !(await dbClient(TARGET).getAppLocations('evictapp')).some((l) => l.ip === evicted);

    // An eviction a peer passed on in a sync: unsigned, and the rows it covers gone.
    // Bracketed, because the evicted node's next announcement puts its row back.
    let judged = null;
    for (let attempt = 0; attempt < 5 && !judged; attempt += 1) {
      const now = Date.now();
      // eslint-disable-next-line no-await-in-loop
      await dbClient(TARGET).seedAppStateEvent({
        ip: evicted, type: 'evicted', dedupKey: `evicted-${attempt}`, createdAt: new Date(now), expireAt: new Date(now + 60000),
      });
      // eslint-disable-next-line no-await-in-loop
      await dbClient(TARGET).deleteAppLocation('evictapp', evicted);
      const anchor = one.getLastEventId();
      // eslint-disable-next-line no-await-in-loop
      await driveUntil(one, async () => turnsOf(one, 'evictapp', anchor).length > 0, { blocks: PERIOD * 2 });
      // eslint-disable-next-line no-await-in-loop
      if (await missing()) [judged] = turnsOf(one, 'evictapp', anchor);
    }
    await startTicker();

    expect(judged, 'no pass ran while the eviction stood').to.not.equal(null);
    expect([...judged.data.holders].sort()).to.eql([...HOLDERS].sort());
  });

  it('a holder whose address moves is counted once, under its key', async function () {
    this.timeout(900000);
    const one = env.clients[TARGET - 1];
    await seedAndEvacuate(env, 'moveapp', [TARGET]);
    const now = Date.now();
    await dbClient(TARGET).seedAppStateEvent(await apprunningEvent({
      nodeNum: 4, apps: ['moveapp'], broadcastedAt: now, ip: `${subnet.nodeIp(4)}:16137`, expireAt: now + 60000,
    }));
    const anchor = one.getLastEventId();
    await driveUntil(one, async () => turnsOf(one, 'moveapp', anchor).length > 0, { blocks: PERIOD * 2 });
    await startTicker();

    const [judged] = turnsOf(one, 'moveapp', anchor);
    expect([...judged.data.holders].sort()).to.eql([...HOLDERS].sort());
  });

  it('a spare copy leaves the app to the surplus trim', async function () {
    this.timeout(900000);
    const one = env.clients[TARGET - 1];
    await seedAndEvacuate(env, 'spareapp', [TARGET]);
    const now = Date.now();
    // A sixth holder, signed by a node outside the fleet.
    await dbClient(TARGET).seedAppStateEvent(await apprunningEvent({
      nodeNum: 6, apps: ['spareapp'], broadcastedAt: now, expireAt: now + 60000,
    }));
    const anchor = one.getLastEventId();
    const above = () => eventsOf(one, 'giveUp:considered',
      (d) => d.appName === 'spareapp' && d.code === 'ABOVE_INSTANCE_COUNT', anchor);
    await driveUntil(one, async () => above().length > 0, { timeoutMs: RESIDENTIAL_PACING.residentialEvacuationIntervalMs + 4 * PASS_MS });
    await startTicker();

    expect(above()).to.not.be.empty;
    expect(departuresOf(one, 'spareapp', anchor)).to.have.lengthOf(0);
  });

  it('a holder whose own announcement lapses within the turn does not act', async function () {
    this.timeout(900000);
    const one = env.clients[TARGET - 1];
    await seedAndEvacuate(env, 'lapseapp', [TARGET]);
    const now = Date.now();
    // Its newest announcement, and one that lapses a turn after its departure gap could end.
    await dbClient(TARGET).updateAppStateEvents(
      { type: 'apprunning', dedupKey: 'v2', ip: `${subnet.nodeIp(TARGET)}:16127` },
      { broadcastedAt: new Date(now + 3600000), expireAt: new Date(now + RESIDENTIAL_PACING.residentialEvacuationIntervalMs + TURN_MS) },
    );
    const anchor = one.getLastEventId();
    const lapsing = () => eventsOf(one, 'giveUp:considered',
      (d) => d.appName === 'lapseapp' && d.code === 'ANNOUNCEMENT_LAPSING', anchor);
    await driveUntil(one, async () => lapsing().length > 0, { timeoutMs: RESIDENTIAL_PACING.residentialEvacuationIntervalMs + TURN_MS });
    await startTicker();

    expect(lapsing()).to.not.be.empty;
    expect(departuresOf(one, 'lapseapp', anchor)).to.have.lengthOf(0);
  });
});
