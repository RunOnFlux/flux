import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import { waitFor, waitForUp, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { holdCommands, releaseCommands } from '../framework/mongo-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A mongod that keeps leaving FluxOS's calls unanswered, held with mongo-control as
// suite 3301 holds it. Once suspectRoundTrips round trips have run out within
// suspectWindowMs, the node holds itself back from new placements, and it lifts the
// hold suspectWindowMs after the last. The apps it runs stay: heavy load also makes
// calls time out.

const CALL_TIMEOUT_MS = 5 * 1000;
const SUSPECT_WINDOW_MS = 60 * 1000;
// Long enough for many round trips to run out on every node.
const HOLD_MS = 45 * 1000;
const DATABASE_GAVE_NO_ANSWER = /a database round trip ran out/;
const HELD = /Placement hold set by databaseSuspect/;
const RELEASED = /Placement hold cleared by databaseSuspect/;

function step(what) {
  console.log(`# 3302 ${new Date().toISOString()} ${what}`);
}

describe('a database that keeps timing out takes on no new apps', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2edbsuspect${Date.now()}`;
  let appIdx;
  let anchors;
  let held = false;
  let releasedAt;

  before(async function () {
    this.timeout(420000 + HOLD_MS);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 6,
      tickerAutostart: false,
      configOverrides: { database: { callTimeoutMs: CALL_TIMEOUT_MS, suspectWindowMs: SUSPECT_WINDOW_MS } },
    });
    await bootAndPeer(env);
    ({ index: appIdx } = await seedSimpleApp(env, appName));
    await waitForUp(env.clients[appIdx], appName, 'the app is up');

    anchors = env.clients.map((client) => client.getLastEventId());
    step('holding the commands');
    await holdCommands(HOLD_MS);
    held = true;
    try {
      await new Promise((resolve) => { setTimeout(resolve, HOLD_MS); });
    } finally {
      step('releasing the commands');
      await releaseCommands();
      held = false;
      releasedAt = Date.now();
      step('released');
    }
  });

  after(async function () {
    this.timeout(60000);
    if (held) await releaseCommands().catch(() => {});
    await env?.teardown();
  });

  it('counted round trips that ran out: the database did not answer FluxOS', function () {
    const counted = env.clients.map((_, i) => i).filter((i) => env.nodeHasLog(i, DATABASE_GAVE_NO_ANSWER));
    expect(counted, 'no node counted a round trip that ran out, so nothing below was tested').to.not.be.empty;
  });

  it('holds a node whose database kept timing out back from new placements', function () {
    const holding = env.clients.map((_, i) => i).filter((i) => env.nodeHasLog(i, HELD));
    expect(holding, 'no node held itself back while its database left its calls unanswered').to.not.be.empty;
  });

  it('keeps the apps it runs', async function () {
    this.timeout(30000);
    await Promise.all(env.clients.map(async (client, i) => {
      await assertNoEvent(client, 'app:removed', () => true, 1, { afterId: anchors[i] });
    }));
    const running = await getAppContainerStatus(env.clients[appIdx].container, appName);
    expect(running && running.status.startsWith('Up'), 'the app is still up').to.equal(true);
  });

  it('lifts the hold a window after the last round trip that ran out', async function () {
    this.timeout(SUSPECT_WINDOW_MS + 120000);
    const holding = env.clients.map((_, i) => i).filter((i) => env.nodeHasLog(i, HELD));
    await waitFor(() => holding.every((i) => env.nodeLogCount(i, RELEASED) >= env.nodeLogCount(i, HELD)), {
      timeout: SUSPECT_WINDOW_MS + 90000, interval: 2000, label: 'every held node lifts its hold',
    });
    expect(Date.now() - releasedAt, 'a hold lifted before its window could have passed').to.be.at.least(SUSPECT_WINDOW_MS - CALL_TIMEOUT_MS * 2);
  });
});
