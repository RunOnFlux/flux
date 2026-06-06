import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, stopAppContainer } from '../framework/container.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedTestApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A clean exit (code 0) is restarted under the default 'always' restart policy.
// This is the regression for the client whose containers exit 0 to free memory:
// the old die-event watch hardcoded-ignored exit 0 and silently lost auto-restart
// once FluxOS took restarts off Docker. The reconciler restores restart:always.
//
// Uses the configurable test-app (EXIT_CODE=0): on `docker stop` (SIGTERM) it
// exits 0 deterministically, so this genuinely exercises the exit-0 path rather
// than a SIGKILL (137).

describe('reconciler restarts a cleanly-exited (exit 0) container by default', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx; let identifier;
  const appName = `e2eexit0${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx, identifier } = await seedTestApp(env, { name: appName, exitCode: 0 }));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('restarts after a graceful exit 0 (default always policy)', async function () {
    this.timeout(120000);
    const client = env.clients[idx];

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'app container running before stop' });

    const afterId = client.getLastEventId();

    // SIGTERM -> the test-app's handler exits 0 (clean exit), container left present
    await stopAppContainer(client.container, appName);

    const evt = await waitForReconcileActuated(client, identifier, 'started', 90000, { afterId });
    expect(evt.data.exitCode).to.equal(0); // genuinely restarted from a clean exit 0

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return status && status.status.startsWith('Up');
    }, { timeout: 60000, interval: 3000, label: 'container running again after exit 0' });
  });
});
