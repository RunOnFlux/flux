import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { waitForUp, waitForDown, assertNoEvent } from '../framework/wait.js';
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
});
