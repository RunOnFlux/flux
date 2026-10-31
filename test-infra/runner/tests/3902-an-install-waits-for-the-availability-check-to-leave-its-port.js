import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning } from '../framework/container.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An install of an app on the port the availability check is testing waits for
// the check to stop listening there, and then installs.
//
// Every node gives apps the one port PORT, so the check on node 1 tests PORT,
// and passes every few seconds. The check is held while it listens on PORT, and
// the app, whose one port is PORT, is installed on node 1. The install waits
// rather than starting a container on a port the check is listening on, which
// fails to bind. Once the check is let go, the install holds the app and its
// container runs.
//
// Node 1 is the subject; three nodes give its check a peer to ask.

const SUBJECT = 1;
// Below the ports the harness allocates, and in no banned range.
const PORT = 31150;
const CHECK_LISTENING = 'availability:listening';
// A pass every few seconds, so a hold placed after boot meets the next one.
const CHECK_INTERVAL_MS = 5000;
const HELD_MS = 120000;
const INSTALLED_MS = 180000;

describe('an install waits for the availability check to leave its port', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2echeckedport${Date.now()}`;
  const subject = () => env.clients[SUBJECT];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: {
        fluxapps: { portMin: PORT, portMax: PORT, appsPortCheck: { timeoutsMs: { default: CHECK_INTERVAL_MS } } },
      },
    });
    await bootAndPeer(env);
    await pushTestApp(appName, 'v1', 'testapp');

    const from = subject().getLastEventId();
    await subject().holdCheckpoint(CHECK_LISTENING);
    await subject().waitForEvent(
      'checkpoint:held',
      (d) => d.name === CHECK_LISTENING && Number(d.key) === PORT,
      HELD_MS,
      { afterId: from },
    );
  });

  after(async function () {
    this.timeout(60000);
    if (env) await subject().releaseCheckpoint(CHECK_LISTENING).catch(() => {});
    await env?.teardown();
  });

  it('waits while the check listens on the app\'s port, and installs the app once it has stopped', async function () {
    this.timeout(INSTALLED_MS + HELD_MS + 60000);
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'an app on the port the check tests',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [PORT],
        domains: [''],
        environmentParameters: ['EXIT_CODE=0'],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    const mark = subject().getLastEventId();
    // Node 1's spawner may take the app too, and its port test then waits for the
    // check as well; the wait that counts is the install's own.
    const installed = installOnNodes(env, app, [SUBJECT], { timeout: INSTALLED_MS });
    installed.catch(() => {});

    const waited = subject().waitForEvent('ports:awaitingRelease', (d) => d.appName === appName && d.step === 'install', HELD_MS, { afterId: mark })
      .then(({ data }) => ({ waited: data }));
    const failed = subject().waitForEvent('app:installOutcome', (d) => d.name === appName && d.outcome === 'failed', HELD_MS, { afterId: mark })
      .then(() => ({ failed: true }));
    [waited, failed].forEach((pending) => pending.catch(() => {}));
    const first = await Promise.race([waited, failed]);
    expect(first.failed, 'the install failed on the port the check was listening on').to.equal(undefined);
    expect(first.waited).to.deep.include({ holder: 'availabilityCheck', ports: [PORT] });

    await subject().releaseCheckpoint(CHECK_LISTENING);

    await installed;
    expect(await isAppContainerRunning(subject().container, appName), 'the app\'s container').to.equal(true);
    const failures = subject().getEventBuffer()
      .filter((e) => e.id > mark && e.event === 'app:installOutcome' && e.data?.name === appName && e.data.outcome === 'failed');
    expect(failures, 'installs of the app that failed').to.deep.equal([]);
  });
});
