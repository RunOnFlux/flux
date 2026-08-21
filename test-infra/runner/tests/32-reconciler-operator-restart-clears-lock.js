import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import {
  waitForUp, waitForDown, assertNoEvent, waitForReconcileActuated,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// B4 end-to-end: a user apprestart is an explicit "make it run" - it must clear
// the durable operator stop lock with appstart's exact semantics. Without the
// clear, stop -> restart leaves the lock set and the reconciler re-stops the
// app at its very next trigger (the restart's own die event), which is exactly
// the sequence this suite drives.

describe('apprestart clears the operator stop lock (app stays running)', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2erestart${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  let idx;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName, { port: 31123 }));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('keeps running after appstop -> apprestart, across the restart-triggered reconcile', async function () {
    this.timeout(180000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before operator stop');

    const auth = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    await waitForDown(client, appName, 'stopped after appstop');

    // apprestart must clear the lock BEFORE the docker op; the docker restart
    // emits its own die event, so the reconciler re-evaluates immediately - with
    // a lingering lock it would enforce "stopped" and kill the app again
    const auth2 = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/apprestart/${appName}`, auth2.zelidauth);
    await waitForUp(client, appName, 'running after apprestart');

    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'stopped', 15000);
    const status = await getAppContainerStatus(client.container, appName);
    expect(status && status.status.startsWith('Up')).to.equal(true);
  });

  // The restart above is a start: the container was down, so "make it run" and
  // "bounce it" are the same act and either implementation satisfies it. A
  // restart of a container that is ALREADY running is the case the durable
  // generation exists for, and nothing else drives it.
  it('bounces a container that is already running', async function () {
    this.timeout(180000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before the restart');

    const auth = await authenticate(client.url, appOwnerKey());
    // Anchored before the request: apprestart holds until the pass has run, so
    // the actuation can already be in the buffer by the time it returns.
    const beforeId = client.getLastEventId();
    await client.getAuthed(`/apps/apprestart/${appName}`, auth.zelidauth);

    const bounced = await waitForReconcileActuated(client, identifier, 'restarted', 120000, { afterId: beforeId });
    expect(bounced.data.reason, 'the operator asked for it, not a heal or a crash').to.equal('operatorRequested');
    await waitForUp(client, appName, 'running again after the bounce');

    // The request is a level, and a level nothing marks as reached is a loop -
    // every later pass would read the same request and bounce it again. Not a
    // quiet window, which would pass just as well if no pass had run at all: the
    // bounce emits its own die event, so a pass provably follows it, and this
    // window contains that pass.
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'restarted', 30000, { afterId: bounced.id });

    const status = await getAppContainerStatus(client.container, appName);
    expect(status && status.status.startsWith('Up'), 'and it is left running').to.equal(true);
  });
});
