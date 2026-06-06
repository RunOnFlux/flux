import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, stopAppContainer } from '../framework/container.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A clean exit (code 0) is restarted under the default 'always' restart policy.
// This is the regression for the client whose containers exit 0 to free memory:
// the old die-event watch hardcoded-ignored exit 0 and silently lost auto-restart
// once FluxOS took restarts off Docker. The reconciler restores restart:always.

describe('reconciler restarts a cleanly-exited (exit 0) container by default', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let installedOnIndex;
  const appName = `e2eexit0${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: installedOnIndex } = await seedSimpleApp(env, appName));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('restarts after a graceful exit 0 (default always policy)', async function () {
    this.timeout(120000);
    const client = env.clients[installedOnIndex];

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'app container running before stop' });

    const afterId = client.getLastEventId();

    await stopAppContainer(client.container, appName); // docker stop -> exit 0, left present

    const evt = await waitForReconcileActuated(client, identifier, 'started', 90000, { afterId });
    expect(evt.data.exitCode).to.equal(0); // restarted from a clean exit

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'container running again after exit 0' });
  });
});
