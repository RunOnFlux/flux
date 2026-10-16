import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  execInContainer, getAppContainerStatus, crashFluxos, releaseFluxos,
} from '../framework/container.js';
import {
  waitFor, waitForUp, waitForDown, waitForOperatorIntent, waitForBootSettled, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { holdCommands, releaseCommands } from '../framework/mongo-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A mongod that stops answering FluxOS's commands while it goes on answering the
// driver's heartbeats, and then answers again: what a mongod with one thread stuck
// in the kernel looks like from FluxOS (mongo-control). The fleet shares one mongod.
// Every call waits and none fails, and only a bound on the call ends the wait.
// FluxOS bounds a call at config.database.callTimeoutMs, and a call on the client
// for long operations at maintenanceCallTimeoutMs; a read is retried once. Every
// caller of a call that fails leaves what it cannot read as it is. This fleet runs
// with both bounds short, and held for longer than a read's whole budget, it:
//
//   - answers a call that reads the database, with an error, rather than waiting
//     for the database: what turns a stall into a failure each caller handles;
//   - keeps every FluxOS process it had, so nothing exits on a failed call;
//   - removes no app and announces no removal;
//   - keeps an operator-stopped component stopped;
//   - announces its apps again once mongod answers.
//
// The second case holds the commands while a node boots. The boot's schema step
// runs on the client for long operations and fails each time its bound runs out;
// boot runs that step again until it succeeds, so the boot runs once rather than
// starting again from the top.

const subnet = getSubnetConfig();
const CALL_TIMEOUT_MS = 10 * 1000;
const MAINTENANCE_CALL_TIMEOUT_MS = 20 * 1000;
// A read that has to wait for a pooled connection first is answered within one
// bound for the pool and two for the read and its retry.
const READ_ANSWERED_WITHIN_MS = 3 * CALL_TIMEOUT_MS + 10 * 1000;
// Over a read's whole budget with room to tell it from the hold, and over three
// of the schema step's bounds.
const HOLD_MS = 75 * 1000;
// What a call that got no answer leaves in a node's log, and nothing else does. One
// of them shows the calls failed, so the assertions below are about failed calls.
const DATABASE_GAVE_NO_ANSWER = /MongoNetworkTimeoutError|MongoWaitQueueTimeoutError/;

// A TAP comment, so a hold that overruns says which step it was in.
function step(what) {
  console.log(`# 3301 ${new Date().toISOString()} ${what}`);
}

async function fluxosPid(client) {
  return Number((await execInContainer(client.container, 'cat /tmp/fluxos.pid')).stdout.trim());
}

describe('a database that stops answering takes nothing down', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const runningName = `e2edbrun${Date.now()}`;
  const stoppedName = `e2edbstop${Date.now()}`;
  let runningIdx;
  let stoppedIdx;
  let held = false;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 10,
      tickerAutostart: false,
      configOverrides: { database: { callTimeoutMs: CALL_TIMEOUT_MS, maintenanceCallTimeoutMs: MAINTENANCE_CALL_TIMEOUT_MS } },
    });
    await bootAndPeer(env);
    ({ index: runningIdx } = await seedSimpleApp(env, runningName));
    ({ index: stoppedIdx } = await seedSimpleApp(env, stoppedName));
    await waitForUp(env.clients[runningIdx], runningName, 'the running app is up');
    await waitForUp(env.clients[stoppedIdx], stoppedName, 'the app to stop is up');

    const client = env.clients[stoppedIdx];
    const auth = await authenticate(client.url, appOwnerKey());
    const stopRes = await client.getAuthed(`/apps/appstop/${stoppedName}`, auth.zelidauth);
    expect(stopRes.status, `appstop refused: ${JSON.stringify(stopRes.data)}`).to.equal('success');
    await waitForOperatorIntent(client, `${stoppedName}_${stoppedName}`, true);
    await waitForDown(client, stoppedName, 'stopped by its owner');
  });

  after(async function () {
    this.timeout(60000);
    if (held) await releaseCommands().catch(() => {});
    await env?.teardown();
  });

  describe('while the fleet runs', function () {
    let pidsBefore;
    let anchors;
    let read;

    before(async function () {
      this.timeout(HOLD_MS + 120000);
      step('reading the FluxOS pids');
      pidsBefore = await Promise.all(env.clients.map(fluxosPid));
      anchors = env.clients.map((client) => client.getLastEventId());
      step('holding the commands');
      await holdCommands(HOLD_MS);
      held = true;
      step('held');
      try {
        await new Promise((resolve) => { setTimeout(resolve, 5000); });
        const startedAt = Date.now();
        const reading = env.clients[runningIdx].get(`/apps/appspecifications/${runningName}`)
          .then((body) => ({ body, ms: Date.now() - startedAt }), (error) => ({ error, ms: Date.now() - startedAt }));
        await new Promise((resolve) => { setTimeout(resolve, HOLD_MS - 5000); });
        read = await Promise.race([reading, { ms: null }]);
        if (read.ms === null) read = { ms: Date.now() - startedAt, unanswered: true };
        step(`read ${read.unanswered ? 'unanswered' : 'answered'} after ${read.ms} ms`);
      } finally {
        step('releasing the commands');
        await releaseCommands();
        held = false;
        step('released');
      }
    });

    it('answers a call that reads the database, rather than waiting for it', function () {
      expect(read.unanswered, `the node gave no answer in ${Math.round(read.ms / 1000)} s while the database gave none`).to.not.equal(true);
      expect(read.ms, 'answered within a read\'s budget').to.be.below(READ_ANSWERED_WITHIN_MS);
    });

    it('reached FluxOS: a node logged a call the database did not answer', function () {
      const stalled = env.clients.map((_, i) => i).filter((i) => env.nodeHasLog(i, DATABASE_GAVE_NO_ANSWER));
      expect(stalled, 'no node logged a database call that timed out, so nothing below was tested').to.not.be.empty;
    });

    it('keeps every FluxOS process it had', async function () {
      const pidsAfter = await Promise.all(env.clients.map(fluxosPid));
      expect(pidsAfter, 'a node\'s FluxOS exited during the hold').to.deep.equal(pidsBefore);
    });

    it('removes no app and announces no removal', async function () {
      this.timeout(30000);
      await Promise.all(env.clients.map(async (client, i) => {
        await assertNoEvent(client, 'app:removed', () => true, 1, { afterId: anchors[i] });
        await assertNoEvent(client, 'network:appremoved', () => true, 1, { afterId: anchors[i] });
      }));
      const running = await getAppContainerStatus(env.clients[runningIdx].container, runningName);
      expect(running && running.status.startsWith('Up'), 'the running app is still up').to.equal(true);
    });

    it('keeps the operator-stopped component stopped', async function () {
      this.timeout(30000);
      const client = env.clients[stoppedIdx];
      await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === `${stoppedName}_${stoppedName}` && d.action === 'started', 1, { afterId: anchors[stoppedIdx] });
      const stopped = await getAppContainerStatus(client.container, stoppedName, { all: true });
      expect(stopped && stopped.status.startsWith('Up'), 'the stopped component was started').to.not.equal(true);
    });

    it('announces its apps again once the database answers', async function () {
      this.timeout(240000);
      const holderIp = subnet.nodeIp(runningIdx + 1);
      const peer = env.clients[(runningIdx + 1) % env.clients.length];
      const afterId = peer.getLastEventId();
      await peer.waitForEvent(
        'network:apprunning',
        (d) => d.ip?.startsWith(holderIp) && d.apps?.some((a) => a.name === runningName),
        200000,
        { afterId },
      );
      const installed = await env.clients[runningIdx].get('/apps/installedapps');
      expect(installed.status, 'the node reads its installed apps again').to.equal('success');
      expect(installed.data.map((app) => app.name)).to.include(runningName);
    });
  });

  describe('while a node boots', function () {
    const idx = 0;
    // One line from the stretch of boot before the schema, and one from after it: a
    // boot that started again from the top would log either of them twice.
    const BEFORE_SCHEMA = /System service initiated/;
    const AFTER_SCHEMA = /Flux checks operational/;
    // The schema phase begun and not finished when the hold ends: the boot was held
    // on the database, inside the step boot runs again until it succeeds.
    const SCHEMA_BEGUN = /Preparing local database/;
    const SCHEMA_FINISHED = /Local database prepared/;
    let counts;
    let atRelease;
    let bootAnchor;

    before(async function () {
      this.timeout(HOLD_MS + 300000);
      const { container } = env.clients[idx];
      // Event ids are seeded from the clock and keep rising across a restart.
      bootAnchor = env.clients[idx].getLastEventId();
      await crashFluxos(container, { hold: true });
      counts = {
        before: env.nodeLogCount(idx, BEFORE_SCHEMA),
        after: env.nodeLogCount(idx, AFTER_SCHEMA),
        begun: env.nodeLogCount(idx, SCHEMA_BEGUN),
        finished: env.nodeLogCount(idx, SCHEMA_FINISHED),
        noAnswer: env.nodeLogCount(idx, DATABASE_GAVE_NO_ANSWER),
      };
      await holdCommands(HOLD_MS);
      held = true;
      try {
        await releaseFluxos(container);
        await new Promise((resolve) => { setTimeout(resolve, HOLD_MS); });
        atRelease = {
          begun: env.nodeLogCount(idx, SCHEMA_BEGUN) - counts.begun,
          finished: env.nodeLogCount(idx, SCHEMA_FINISHED) - counts.finished,
          noAnswer: env.nodeLogCount(idx, DATABASE_GAVE_NO_ANSWER) - counts.noAnswer,
        };
      } finally {
        await releaseCommands();
        held = false;
      }
    });

    it('held the boot inside its schema step while the database gave no answer', function () {
      expect(atRelease.begun, 'the boot never reached its schema step, so nothing below was tested').to.be.above(0);
      expect(atRelease.noAnswer, 'no call of the boot failed while it was held, so nothing below was tested').to.be.above(0);
      expect(atRelease.finished, 'the schema step finished while the database held every command').to.equal(0);
    });

    it('finishes the boot once, after the database answers', async function () {
      this.timeout(240000);
      await waitForBootSettled(env.clients[idx], 200000, { afterId: bootAnchor });
      await waitFor(() => env.nodeLogCount(idx, AFTER_SCHEMA) > counts.after, {
        timeout: 60000, interval: 2000, label: 'the boot reaches the start of the flux checks',
      });
      expect(env.nodeLogCount(idx, BEFORE_SCHEMA) - counts.before, 'the stretch before the schema ran').to.equal(1);
      expect(env.nodeLogCount(idx, AFTER_SCHEMA) - counts.after, 'the start phase ran').to.equal(1);
    });
  });
});
