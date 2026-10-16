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
import { pauseMongo, resumeMongo } from '../framework/mongo-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A mongod that stops answering, and comes back. The fleet shares one mongod, and a
// paused container is what a mongod whose thread is stuck in the kernel looks like
// from FluxOS: every call waits and none fails. FluxOS bounds a call at 60 s (a read
// is retried once, so 120 s), and every caller of a call that fails leaves what it
// cannot read as it is. Paused for longer than a read's whole budget, the fleet:
//
//   - answers a call that reads the database, with an error, rather than waiting
//     for the database: what turns a stall into a failure each caller handles;
//   - keeps every FluxOS process it had, so nothing exits on a failed call;
//   - removes no app and announces no removal;
//   - keeps an operator-stopped component stopped;
//   - announces its apps again once mongod answers.
//
// The second case pauses mongod while a node boots: the boot holds until mongod
// answers and runs once, rather than starting again from the top.

const subnet = getSubnetConfig();
// Over a read's whole budget with room to tell it from the pause: a read that has
// to wait for a pooled connection first is answered within 60 s for the pool and
// 2 x 60 s for the read and its retry.
const PAUSE_MS = 300 * 1000;
const READ_ANSWERED_WITHIN_MS = 200 * 1000;
// What a call that got no answer leaves in a node's log, and nothing else does. One
// of them shows the calls failed, so the assertions below are about failed calls.
const DATABASE_GAVE_NO_ANSWER = /MongoNetworkTimeoutError|MongoWaitQueueTimeoutError/;

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
  let paused = false;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
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
    if (paused) await resumeMongo(env).catch(() => {});
    await env?.teardown();
  });

  describe('while the fleet runs', function () {
    let pidsBefore;
    let anchors;
    let read;

    before(async function () {
      this.timeout(PAUSE_MS + 120000);
      pidsBefore = await Promise.all(env.clients.map(fluxosPid));
      anchors = env.clients.map((client) => client.getLastEventId());
      await pauseMongo(env);
      paused = true;
      try {
        await new Promise((resolve) => { setTimeout(resolve, 5000); });
        const startedAt = Date.now();
        const reading = env.clients[runningIdx].get(`/apps/appspecifications/${runningName}`)
          .then((body) => ({ body, ms: Date.now() - startedAt }), (error) => ({ error, ms: Date.now() - startedAt }));
        await new Promise((resolve) => { setTimeout(resolve, PAUSE_MS - 5000); });
        read = await Promise.race([reading, { ms: null }]);
        if (read.ms === null) read = { ms: Date.now() - startedAt, unanswered: true };
      } finally {
        await resumeMongo(env);
        paused = false;
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
      expect(pidsAfter, 'a node\'s FluxOS exited during the pause').to.deep.equal(pidsBefore);
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
    let counts;
    let bootAnchor;

    before(async function () {
      this.timeout(PAUSE_MS + 300000);
      const { container } = env.clients[idx];
      // Event ids are seeded from the clock and keep rising across a restart.
      bootAnchor = env.clients[idx].getLastEventId();
      await crashFluxos(container, { hold: true });
      counts = { before: env.nodeLogCount(idx, BEFORE_SCHEMA), after: env.nodeLogCount(idx, AFTER_SCHEMA) };
      await pauseMongo(env);
      paused = true;
      try {
        await releaseFluxos(container);
        await new Promise((resolve) => { setTimeout(resolve, PAUSE_MS); });
      } finally {
        await resumeMongo(env);
        paused = false;
      }
    });

    it('held the boot while the database gave no answer', function () {
      expect(env.nodeHasLog(idx, /Waiting for MongoDB/), 'the boot never waited on the database, so nothing below was tested').to.equal(true);
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
