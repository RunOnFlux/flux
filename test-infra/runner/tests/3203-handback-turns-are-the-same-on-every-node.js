/*
 * Evacuating holders of one app hand it back in turns every node computes the same.
 *
 * A turn is cut from block time and belongs to the holder with the lowest hash of the turn
 * number and its signing key; the holders are the ones the app's signed announcements name. A
 * holder acts only on the second pass of a turn it owns, and not once the chain has reached the
 * pass after next. Each test here moves one input a holder could otherwise disagree on - when a
 * departure gap ends, a restart, a late pass, an eviction, an address move, a spare copy, a
 * lapsing announcement, a decision the chain outran - and checks the turn did not move with it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { dbClient } from '../framework/db-client.js';
import {
  advanceBlock, driveUntil, getState, startTicker, stopTicker, clearSystemSecure, setSystemSecure,
} from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { apprunningEvent } from '../framework/state-events.js';
import {
  subnet, TARGET, SECOND_TARGET, PASS_PERIOD_BLOCKS, PASS_MS, RESIDENTIAL_PACING,
  bootResidentialFleet, seedApp, returnToService, elapseSettleWindow, departureWaitMs, ownedTurnsWaitMs,
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

/** Seed an app every fleet node holds, then start the given nodes evacuating. */
async function seedAndEvacuate(env, appName, nodes) {
  await Promise.all(FLEET.map((node) => returnToService(env, node)));
  await seedApp(env, appName, { instances: FLEET.length });
  await startTicker();
  await waitFor(async () => (await dbClient(2).getAppLocations(appName)).length >= FLEET.length,
    { timeout: 300000, label: `${appName} reaches its instance count across the fleet` });
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

  it('two holders whose departure gaps end a turn apart never hand one app back on the same pass', async function () {
    this.timeout(900000);
    const [one, three] = [env.clients[TARGET - 1], env.clients[SECOND_TARGET - 1]];
    await seedAndEvacuate(env, 'gapapp', [TARGET, SECOND_TARGET]);
    // Node 3's gap since its last departure ends one turn from now; node 1 has none.
    await dbClient(SECOND_TARGET).setLastEvacuationAt(Date.now() - RESIDENTIAL_PACING.residentialEvacuationIntervalMs + TURN_MS);
    const anchor = Math.min(one.getLastEventId(), three.getLastEventId());

    const refusedShort = (client) => eventsOf(client, 'giveUp:considered',
      (d) => d.appName === 'gapapp' && d.giveUp === false && d.code === 'BELOW_INSTANCE_COUNT', anchor).length > 0;
    const departures = () => departuresOf(one, 'gapapp', anchor).length + departuresOf(three, 'gapapp', anchor).length;
    await driveUntil(one, async () => departures() >= 2 || ((refusedShort(one) || refusedShort(three)) && departures() === 1), {
      timeoutMs: departureWaitMs([TARGET, SECOND_TARGET]) + TURN_MS,
    });
    await startTicker();

    expect(departures(), 'both holders handed gapapp back').to.equal(1);
    const [departed] = [one, three].filter((client) => departuresOf(client, 'gapapp', anchor).length);
    const removal = departuresOf(departed, 'gapapp', anchor)[0];
    const turn = turnsOf(departed, 'gapapp', anchor).filter((e) => e.id < removal.id).pop();
    expect(turn.data.owner, 'handed back in a turn it did not own').to.equal(keysOf([departed === one ? TARGET : SECOND_TARGET])[0]);
    expect(turn.data.previousTurn, 'handed back on the first pass of its turn').to.equal(turn.data.turn);
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
    await driveUntil(one, async () => common().length >= 3, { timeoutMs: 6 * PASS_MS + 120000 });
    await startTicker();

    for (const [onOne, onThree] of common()) {
      expect(onThree.turn, `turn at ${onThree.dueHeight}`).to.equal(onOne.turn);
      expect(onThree.owner, `owner at ${onThree.dueHeight}`).to.equal(onOne.owner);
      expect([...onThree.holders].sort(), `holders at ${onThree.dueHeight}`).to.eql([...onOne.holders].sort());
    }
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
  });

  it('a removal the chain has outrun since it was decided is not made', async function () {
    this.timeout(900000);
    const one = env.clients[TARGET - 1];
    await seedAndEvacuate(env, 'staleapp', [TARGET]);
    await one.holdCheckpoint('giveUp:beforeRemoval', 'staleapp');
    const anchor = one.getLastEventId();

    const held = () => eventsOf(one, 'checkpoint:held', (d) => d.name === 'giveUp:beforeRemoval' && d.key === 'staleapp', anchor).length > 0;
    // Its earlier apps go in the same turns, one per turn.
    const holding = (await one.get('/apps/installedapps')).data.length;
    await driveUntil(one, async () => held(), { timeoutMs: ownedTurnsWaitMs(TARGET, holding) });
    // The pass after next: the earliest any other holder could act.
    const { currentHeight } = await getState();
    await driveUntil(one, async () => (await getState()).currentHeight >= currentHeight + 2 * PERIOD, { blocks: 3 * PERIOD });
    await one.releaseCheckpoint('giveUp:beforeRemoval', 'staleapp');
    const stale = await one.waitForEvent('giveUp:decisionStale', (d) => d.appName === 'staleapp', 60000, { afterId: anchor });
    await startTicker();

    expect(stale.data.tip).to.be.at.least(stale.data.dueHeight + 2 * PERIOD);
    expect(departuresOf(one, 'staleapp', anchor), 'the outrun removal was made').to.have.lengthOf(0);
    const installed = await one.get('/apps/installedapps');
    expect(installed.data.map((a) => a.name)).to.include('staleapp');
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
