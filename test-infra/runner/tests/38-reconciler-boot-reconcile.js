import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus } from '../framework/container.js';
import { waitFor, waitForReconcileActuated, waitForBootSettled } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { enableRpcFailure, disableRpcFailure } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

const subnet = getSubnetConfig();

// On a FluxOS restart the inner dockerd's app containers come back exited.
// appStartupManager enqueues each installed component once the boot gate opens,
// and the reconciler restarts the ones that should run (default always policy).
// (No reconciler:swept{boot} event — boot uses per-component enqueue.)

describe('reconciler restarts app containers on FluxOS boot', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  const appName = `e2eboot${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('brings a stopped-on-boot container back up after the boot gate', async function () {
    this.timeout(180000);
    let client = env.clients[idx];
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 2000, label: 'running before restart' });

    // restart FluxOS: the inner dockerd restarts and the app container comes back
    // exited, with nothing actuated until the boot gate opens.
    await env.restartNode(idx);
    client = env.clients[idx];
    const afterId = client.getLastEventId();

    // the boot reconcile enqueues the component and the reconciler starts it
    await waitForReconcileActuated(client, identifier, 'started', 120000, { afterId });
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 2000, label: 'running again after boot reconcile' });
  });

  it('refuses a call that would create a container until the boot gate opens', async function () {
    this.timeout(240000);
    const client = env.clients[idx];
    // zelidauth carries the signature on every request rather than naming a
    // session, so it outlives the restart below.
    const auth = await authenticate(client.url, fluxTeamKey());

    // Hold the gate closed rather than arriving before it opens. manageAppsOnBoot
    // waits on daemonReady, which opens only once this node's daemon RPC answers,
    // so a node whose RPC fails sits at that gate with its API already serving.
    // That is the window the guard exists for, and racing it would make this test
    // assert whichever of two clocks won.
    await enableRpcFailure(subnet.nodeIp(idx + 1));
    let restarted;
    let afterId;
    try {
      await env.restartNode(idx);
      restarted = env.clients[idx];
      // Read while the gate is provably shut, so the wait at the end cannot be
      // satisfied by the boot:settled this node published on its previous boot -
      // waitForEvent answers from its buffer, and the buffer still holds it.
      afterId = restarted.getLastEventId();

      const refused = await restarted.request('GET', `/apps/appstart/${appName}`, {
        headers: { zelidauth: auth.zelidauth },
      });
      expect(refused.status, JSON.stringify(refused.data)).to.equal(503);
      // Without this a caller knows to come back but not when, and a dashboard's
      // answer to that is to poll as fast as it can.
      expect(refused.headers['retry-after']).to.equal('15');

      // Refused rather than answered after the fact: the container the call would
      // have started is still the exited one the restart left behind. An app
      // created here would have no location record for boot reconciliation to
      // keep it by, and would be removed as one that had moved away.
      const held = await getAppContainerStatus(restarted.container, appName);
      expect(held && held.status.startsWith('Up'), JSON.stringify(held)).to.not.equal(true);
    } finally {
      await disableRpcFailure(subnet.nodeIp(idx + 1));
    }

    // And the refusal lifts on its own once the node has settled. Asserted as
    // "no longer refused" rather than on a status: what appstart answers for an
    // app boot reconciliation has already restarted is its own contract, not
    // this guard's.
    await waitForBootSettled(restarted, 180000, { afterId });
    const accepted = await restarted.request('GET', `/apps/appstart/${appName}`, {
      headers: { zelidauth: auth.zelidauth },
    });
    expect(accepted.status, JSON.stringify(accepted.data)).to.not.equal(503);
  });
});
