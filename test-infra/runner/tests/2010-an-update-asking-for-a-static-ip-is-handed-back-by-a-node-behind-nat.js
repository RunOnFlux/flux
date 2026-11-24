// weight: heavy
/*
 * A node behind NAT hands back an app whose update asks for a static IP, in its
 * turn, and the nodes with a static IP keep it.
 *
 * Three nodes hold one app; node 2 reaches the internet by a device holding no
 * public address (network shape private-egress), so it reads its static IP as
 * DYNAMIC, and the other two read STATIC. The owner's update turns on staticip.
 * Node 2 cannot take the update and keeps the app at the specification it runs;
 * the give-up pass finds the registered specification asks for a kind of node it
 * is not and hands the app back as UNSUITED, by the same turn rule a misplaced
 * or outgrown app leaves by. Every holder judges the registered specification
 * while it differs from its own, so the static nodes are judged too, and never
 * as UNSUITED.
 *
 * The data-centre half of the rule needs a published table that classes a node
 * as residential, and the unknown and conflicting answers that keep the app are
 * states this fleet cannot hold; those are unit-tested.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer, waitForInstanceCount, installedInstanceIndices } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  PASS_PERIOD_BLOCKS, PASS_MS, RESIDENTIAL_PACING, departureWaitMs, seedApp,
} from '../framework/residential-fleet.js';
import { allowFromNow } from '../framework/time-budget.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const NODES = 3;
// zero-based
const BEHIND_NAT = 1;
const STATIC_NODES = [0, 2];

describe('2010: a node behind NAT hands back an app whose update asks for a static IP', function () {
  let env;
  const appName = `e2eunsuited${Date.now()}`;
  // each node's last event id once the update was stored
  let afterUpdate;

  const decided = (index, predicate, afterId) => env.clients[index].getEventBuffer()
    .some((e) => e.event === 'giveUp:considered' && e.id > afterId
      && e.data.appName === appName && predicate(e.data));
  const unsuited = (d) => d.reason === 'UNSUITED';

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      networkShapes: { [BEHIND_NAT]: 'private-egress' },
      configOverrides: {
        fluxapps: {
          // The give-up pass hangs off the last block of a burst; a cached height
          // refreshed at 1:1 with the block can keep the pass from landing.
          daemonInfoIntervalMs: 1000,
          removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
          handbackTurnMs: RESIDENTIAL_PACING.handbackTurnMs,
        },
      },
    });
    await bootAndPeer(env);

    const states = [];
    await Promise.all(env.clients.map((client, index) => waitFor(async () => {
      states[index] = (await dbClient(index + 1).nodeGeolocation())?.staticIpState;
      return Boolean(states[index]);
    }, { timeout: 180000, interval: 3000, label: `node ${index} decided its static IP` })));
    expect(states, 'node 2 behind NAT, the others static').to.deep.equal(['STATIC', 'DYNAMIC', 'STATIC']);

    const app = await seedApp(env, appName, { instances: NODES });
    await waitForInstanceCount(env, appName, NODES, { timeout: 300000 });

    const updated = await buildSeedableUpdate(app, (spec) => {
      spec.staticip = true;
    });
    await deliverApp(env, updated, [...Array(NODES).keys()]);
    afterUpdate = env.clients.map((client) => client.getLastEventId());
    await stopTicker();
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('the node behind NAT gives the app up as UNSUITED, in its turn', async function () {
    const waitMs = departureWaitMs([BEHIND_NAT + 1], NODES);
    allowFromNow(this, waitMs + 240000);
    await driveUntil(
      env.clients[BEHIND_NAT],
      async () => decided(BEHIND_NAT, (d) => unsuited(d) && d.giveUp === true, afterUpdate[BEHIND_NAT]),
      { timeoutMs: waitMs, label: `node ${BEHIND_NAT} gives ${appName} up as unsuited` },
    );
    await driveUntil(
      env.clients[STATIC_NODES[0]],
      async () => !(await installedInstanceIndices(env, appName)).includes(BEHIND_NAT),
      { timeoutMs: 120000, label: `node ${BEHIND_NAT} no longer holds ${appName}` },
    );
  });

  it('the static nodes judge the update and keep the app', async function () {
    allowFromNow(this, (4 * PASS_MS) + 60000);
    // A judgement since the update proves each static node's pass ran over it, so
    // the negative below is about nodes that were looking.
    await driveUntil(
      STATIC_NODES.map((i) => env.clients[i]),
      async () => STATIC_NODES.every((i) => decided(i, () => true, afterUpdate[i])),
      { timeoutMs: 4 * PASS_MS, label: 'each static node judges the app after the update' },
    );
    STATIC_NODES.forEach((i) => {
      expect(decided(i, unsuited, afterUpdate[i]), `node ${i} judged the app unsuited`).to.equal(false);
    });
    expect(await installedInstanceIndices(env, appName)).to.include.members(STATIC_NODES);
  });
});
