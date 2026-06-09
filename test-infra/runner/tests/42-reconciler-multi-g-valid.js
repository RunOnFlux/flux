import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableMultiSyncthingApp } from '../framework/seed-helper.js';
import { waitForReconcileActuated, assertNoEvent } from '../framework/wait.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Valid MULTI-g app — every component carries a g: primary mount (like real
// SimpleXxFTP: xftp + onion, both g:). Proves the canonical classifier
// (commit 84f982984) treats a multi-component g: spec as VALID — the must-not-
// regress counterpart to suite 41's invalid non-primary-sync shape:
//   * no component is flagged invalidSpec, AND
//   * every g: component is deferred to masterSlave and the reconciler runs ALL
//     of them on the FDM-elected primary.
// Background: project_harness_gaps (multi-g shape previously unexercised by CI).

describe('reconciler handles a valid multi-g (every component) app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2emg${Date.now()}`;
  const id0 = `${appName}c0_${appName}`;
  const id1 = `${appName}c1_${appName}`;
  let holders;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await pushImage(appName, 'v1');
    const app = await buildSeedableMultiSyncthingApp({ name: appName, mode: 'g', components: 2 });
    holders = await installOnNodes(env, app, [0, 1]);
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('classifies every component as valid g: (no invalidSpec)', async function () {
    this.timeout(40000);
    const a = env.clients[holders[0]];
    await assertNoEvent(
      a, 'reconciler:actuated',
      (d) => (d.identifier === id0 || d.identifier === id1) && d.action === 'invalidSpec', 15000,
    );
  });

  it('runs every g: component on the FDM-elected primary', async function () {
    this.timeout(120000);
    const a = env.clients[holders[0]];
    await electMaster(appName, a.ip);
    await waitForReconcileActuated(a, id0, 'started', 60000);
    await waitForReconcileActuated(a, id1, 'started', 60000);
  });
});
