import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, restartDockerd } from '../framework/container.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { waitForUp, waitForDown, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// B6 end-to-end: a deliberate stop whose die event is LOST (docker event stream
// down) must not wedge anything. The stoppingContainers flag is OPERATION-
// scoped (cleared when the stop resolves, never by the die event), and the
// operator lock was recorded before the docker op - so the lost event costs
// nothing: the app stays stopped (desired state), no defer-loop persists, and a
// later appstart works normally.
//
// The outage window is real, not simulated: restartDockerd drops FluxOS's event
// stream, and the hardened subscriber takes ~10s to resubscribe - a stop issued
// right after dockerd returns lands inside that window.

describe('deliberate stop during an event-stream outage neither wedges nor flaps', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2estreamout${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  let idx;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName, { port: 31127 }));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('stop lands during the resubscribe window; app stays stopped and recovers on appstart', async function () {
    this.timeout(240000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before the outage');

    // cycle dockerd: the event stream dies with it and resubscribes ~10s later
    await restartDockerd(client.container);

    // stop immediately - dockerd is back, the stream very likely is not yet
    const auth = await authenticate(client.url, appOwnerKey());
    const stopRes = await client.getAuthed(`/apps/appstop/${appName}`, auth.zelidauth);
    expect(stopRes.status).to.equal('success');
    await waitForDown(client, appName, 'stopped during the stream outage');

    // the lost die event must cost nothing: no restart against the operator
    // lock (reconnect sweep + boot-style reconciles all see operatorStopped),
    // and no flapping start/stop loop
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 20000);
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    expect(status && status.status.startsWith('Up')).to.not.equal(true);

    // and nothing is wedged: a normal appstart brings it back
    const auth2 = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/appstart/${appName}`, auth2.zelidauth);
    await waitForUp(client, appName, 'running again after appstart');
  });
});
