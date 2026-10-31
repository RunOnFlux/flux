import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning } from '../framework/container.js';
import { waitForAppInstalled } from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An install is refused a port another install of the same app is testing, and
// the install testing it goes on to hold the app.
//
// Node 1's spawner selects the app and its port test listens on the app's port;
// the test is held there. A local install of the same app arrives on node 1
// while the test listens. It is refused as busy, before it starts a container
// on a port something else is listening on. Once the test is let go, the
// spawner's install holds the app and its container runs.
//
// Node 1 is the subject; three nodes give its port test peers to ask. The app is
// seeded on node 1 alone, so no other node's spawner selects it.

const SUBJECT = 1;
const PORT_TEST_LISTENING = 'install:portTestListening';
const HELD_MS = 180000;
const INSTALLED_MS = 180000;

describe('an install is refused a port another install of the app is testing', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eporttested${Date.now()}`;
  const subject = () => env.clients[SUBJECT];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3 });
    await bootAndPeer(env);
    await pushTestApp(appName, 'v1', 'testapp');

    const from = subject().getLastEventId();
    await subject().holdCheckpoint(PORT_TEST_LISTENING, appName);
    await seedSpawnerApp(env, await buildSeedableTestApp({ name: appName, instances: 1 }), [SUBJECT]);
    await subject().waitForEvent(
      'checkpoint:held',
      (d) => d.name === PORT_TEST_LISTENING && d.key === appName,
      HELD_MS,
      { afterId: from },
    );
  });

  after(async function () {
    this.timeout(60000);
    if (env) await subject().releaseCheckpoint(PORT_TEST_LISTENING, appName).catch(() => {});
    await env?.teardown();
  });

  it('refuses the local install as busy while the port test listens', async function () {
    this.timeout(120000);
    const mark = subject().getLastEventId();
    const auth = await authenticate(subject().url, fluxTeamKey());

    const body = await subject().installAppLocally(appName, auth.zelidauth);

    const { data } = await subject().waitForEvent('app:installOutcome', (d) => d.name === appName, 30000, { afterId: mark })
      .catch(() => { throw new Error(`the local install reported no outcome: ${body.slice(-400)}`); });
    expect(data.outcome, `what the local install did: ${body.slice(-400)}`).to.equal('busy');
  });

  it('installs the app through the install that was testing its port', async function () {
    this.timeout(INSTALLED_MS + 60000);
    const mark = subject().getLastEventId();

    await subject().releaseCheckpoint(PORT_TEST_LISTENING, appName);

    await waitForAppInstalled(subject(), appName, INSTALLED_MS, { afterId: mark });
    expect(await isAppContainerRunning(subject().container, appName), 'the app\'s container').to.equal(true);
  });
});
