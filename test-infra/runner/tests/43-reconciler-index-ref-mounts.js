import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableIndexRefApp } from '../framework/seed-helper.js';
import { waitForReconcileActuated, assertNoEvent } from '../framework/wait.js';
import { resetFdm } from '../framework/fdm-control.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Component index-ref mounts (`N:` references component N's volume).
//   VALID   — a two-component app whose plain second component references the
//             first's volume (index 1 -> 0, like SimpleXxFTP's `|0:/srv/xftp`):
//             installs cleanly; the plain component reconciles/starts; no invalidSpec.
//   INVALID — a single-component app that self-references (index 0 -> 0, like
//             real baserow `g:/data|0:/x`): volumeConstructor must REJECT it at
//             install ("Component 0 cannot reference component 0").
// Background: BUG B in BUG-gapp-nonprimary-sync-segment.md / project_harness_gaps #1.

describe('install + reconcile handle component index-ref mounts', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const okName = `e2eidx${Date.now()}`;
  const badName = `e2eself${Date.now()}`;
  const okC1 = `${okName}c1_${okName}`;
  let afterId;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await pushImage(okName, 'v1');
    await pushImage(badName, 'v1');
    const ok = await buildSeedableIndexRefApp({ name: okName, selfRef: false, mode: 'g' });
    afterId = env.clients[0].getLastEventId();
    await installOnNodes(env, ok, [0]);
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('valid sibling index-ref: plain component reconciles, no invalidSpec', async function () {
    this.timeout(90000);
    const a = env.clients[0];
    await assertNoEvent(
      a, 'reconciler:actuated',
      (d) => d.identifier === okC1 && d.action === 'invalidSpec', 8000,
    );
    // the plain (non-g) component that index-refs component 0's volume starts normally
    await waitForReconcileActuated(a, okC1, 'started', 60000, { afterId });
  });

  it('invalid self-ref (index 0 -> 0): install is rejected', async function () {
    this.timeout(120000);
    const bad = await buildSeedableIndexRefApp({ name: badName, selfRef: true, mode: 'g' });
    let threw = false;
    try {
      await installOnNodes(env, bad, [1]);
    } catch (err) {
      threw = true;
      expect(String(err.message || err)).to.match(/cannot reference component 0|Component 0/i);
    }
    expect(threw, 'self-ref install should have been rejected by volumeConstructor').to.equal(true);
  });
});
