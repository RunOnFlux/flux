import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableMixedMountApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { waitForReconcileActuated, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Fail-loud gate for the canonical g: classifier (commit 84f982984).
//
// Real roundcube/rainloop specs carry the sync flag on a NON-primary mount
// segment (`/data|g:/db`) — syntactically invalid, because the model supports
// sync only on the primary mount. The old `.includes('g:')` substring matcher
// silently adopted these and deadlocked forever (no error); the canonical
// parser classifies them as unparseable and the reconciler must REFUSE to act,
// publishing reconciler:actuated{action:'invalidSpec'} instead of guessing.
//
// This exercises the exact production behavior observed live on the fleet
// (chud/roundcube) end-to-end. Background: BUG-gapp-nonprimary-sync-segment.md.

describe('reconciler fails loud on non-primary-sync (invalid) containerData', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ebad${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  let afterId; // event baseline captured before install so we never miss the actuation

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    // roundcube shape: valid plain primary + g: on a later segment -> unparseable
    const app = await buildSeedableMixedMountApp({
      name: appName, mode: 'g', plainPath: '/data', syncPath: '/db',
    });
    afterId = env.clients[0].getLastEventId();
    await installOnNodes(env, app, [0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('refuses to reconcile and emits invalidSpec', async function () {
    this.timeout(90000);
    const a = env.clients[0];
    await waitForReconcileActuated(a, identifier, 'invalidSpec', 60000, { afterId });
  });

  it('never starts the invalid container', async function () {
    this.timeout(40000);
    const a = env.clients[0];
    await assertNoEvent(
      a, 'reconciler:actuated',
      (d) => d.identifier === identifier && d.action === 'started', 15000,
    );
    const status = await getAppContainerStatus(a.container, appName, { all: true });
    expect(status ? status.status.startsWith('Up') : false).to.equal(false);
  });
});
