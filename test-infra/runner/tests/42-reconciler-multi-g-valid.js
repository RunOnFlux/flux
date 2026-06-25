import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableMultiSyncthingApp } from '../framework/seed-helper.js';
import { assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Classifier acceptance of a valid MULTI-g app — every component carries a g:
// PRIMARY mount (like real SimpleXxFTP: xftp + onion, both g:). The
// must-not-regress counterpart to suite 41's invalid non-primary-sync shape:
// where 41's [plain|g] is rejected at install, a valid multi-g spec is ACCEPTED
// (installs cleanly) and no component is flagged invalidSpec — proving the
// canonical classifier (commit 84f982984) treats g:-on-the-primary-of-every-
// component as valid. (Election/actuation of g: components is covered by the
// reconciler masterSlave suites.) Background: project_harness_gaps (multi-g
// shape previously unexercised by CI).

describe('install accepts a valid multi-g (every component g:) app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2emg${Date.now()}`;
  const id0 = `${appName}c0_${appName}`;
  const id1 = `${appName}c1_${appName}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('installs without rejection and flags no component invalidSpec', async function () {
    this.timeout(120000);
    const app = await buildSeedableMultiSyncthingApp({ name: appName, mode: 'g', components: 2 });
    // a valid g: primary on every component installs (contrast suite 41's [plain|g],
    // which is rejected at volume construction). A throw here = wrongly rejected.
    await installOnNodes(env, app, [0]);
    await assertNoEvent(
      env.clients[0], 'reconciler:actuated',
      (d) => (d.identifier === id0 || d.identifier === id1) && d.action === 'invalidSpec', 15000,
    );
  });
});
