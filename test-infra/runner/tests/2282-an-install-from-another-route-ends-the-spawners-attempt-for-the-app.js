/*
 * An install of an app from another route ends a spawner attempt deciding on that
 * app: the attempt neither takes the app nor marks it failed.
 *
 * Node 1's spawner chooses the app, claims it, and is held at the checkpoint before
 * it takes the spawner's lock for its install. The Flux team then installs the app on
 * node 1 directly. Released, the attempt either ends stopped, or goes on to an
 * install that finds the app installed, takes the app for that answer and marks it
 * failed; the suite waits for whichever comes and asserts it is the first.
 *
 * The app is delivered to node 1 alone, so no other node's spawner chooses it. Three
 * nodes give node 1 the two peers it fetches the network policy from, which it needs
 * to install.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer, seedSpawnerApp, installSeededOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const SUBJECT = 1;
const BEFORE_INSTALL = 'spawner:beforeInstall';
const CHOSEN_MS = 180000;
const INSTALLED_MS = 180000;
const ENDED_MS = 60000;
// Long enough for the next spawner pass after the stop to choose the app again,
// were it not installed.
const NEXT_PASS_MS = 30000;

describe('an install from another route ends the spawner\'s attempt', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eotherroute${Date.now()}`;
  let app;
  let installedMark;
  let ended;
  const subject = () => env.clients[SUBJECT];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3 });
    await bootAndPeer(env);
    await pushTestApp(appName);

    const from = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_INSTALL, appName);
    app = await buildSeedableTestApp({ name: appName, instances: 1 });
    await seedSpawnerApp(env, app, [SUBJECT]);
    // the fixture: an attempt that has chosen the app and not yet taken the lock for its install
    await subject().waitForEvent(
      'checkpoint:held',
      (d) => d.name === BEFORE_INSTALL && d.key === appName,
      CHOSEN_MS,
      { afterId: from },
    );

    installedMark = subject().getLastEventId();
    await installSeededOnNodes(env, app, [SUBJECT], { timeout: INSTALLED_MS });
  });

  afterTeardown(async function () {
    if (env) await subject().releaseCheckpoint(BEFORE_INSTALL, appName).catch(() => {});
    await env?.teardown();
  });

  it('ends the attempt stopped, without installing, once it is released', async function () {
    this.timeout(ENDED_MS + 30000);
    const mark = subject().getLastEventId();
    const stopped = subject().waitForEvent('spawner:attemptStopped', (d) => d.appName === appName, ENDED_MS, { afterId: mark });
    const failed = subject().waitForEvent('spawner:installFailed', (d) => d.appName === appName, ENDED_MS, { afterId: mark });
    stopped.catch(() => {});
    failed.catch(() => {});

    await subject().releaseCheckpoint(BEFORE_INSTALL, appName);
    ended = await Promise.any([
      stopped.then((event) => ({ how: 'stopped', event })),
      failed.then((event) => ({ how: 'installFailed', event })),
    ]);

    expect(ended.how, `the attempt went on to install: ${JSON.stringify(ended.event?.data)}`).to.equal('stopped');
    expect(ended.event.data.installed, 'the attempt says it installed the app').to.equal(false);
  });

  it('took no hold on the app for an install, and marked nothing failed', async function () {
    this.timeout(NEXT_PASS_MS + 30000);
    // canary: the direct install is what holds the app
    const installed = subject().getEventBuffer().filter((e) => e.id > installedMark && e.event === 'app:installed' && e.data?.name === appName);
    expect(installed, 'the direct install did not install the app').to.have.lengthOf(1);

    await assertNoEvent(subject(), 'app:installOutcome', (d) => d.name === appName, NEXT_PASS_MS, { afterId: installedMark });
    await assertNoEvent(subject(), 'spawner:installFailed', (d) => d.appName === appName, 1, { afterId: installedMark });
  });
});
