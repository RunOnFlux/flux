import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableIndexRefApp } from '../framework/seed-helper.js';
import { assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Classifier/volumeConstructor handling of component index-ref mounts (`N:`
// references component N's volume):
//   VALID  — a two-component app whose second (plain) component references the
//            first's volume (index 1 -> 0, like SimpleXxFTP's `|0:/srv/xftp`):
//            installs cleanly, no invalidSpec.
//   INVALID— a single-component app that self-references (index 0 -> 0, like real
//            baserow `g:/data|0:/x`): volumeConstructor rejects it at install.
// The rejection reason is wrapped in the install-stream failure, so we assert the
// install is rejected (and names the app), as suite 41 does. Background: BUG B in
// BUG-gapp-nonprimary-sync-segment.md / project_harness_gaps #1.

describe('install handles component index-ref mounts', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const okName = `e2eidx${Date.now()}`;
  const badName = `e2eself${Date.now()}`;
  const okC1 = `${okName}c1_${okName}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(okName, 'v1');
    await pushImage(badName, 'v1');
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('accepts a valid sibling index-ref (1 -> 0): installs, no invalidSpec', async function () {
    this.timeout(120000);
    const ok = await buildSeedableIndexRefApp({ name: okName, selfRef: false, mode: 'g' });
    await installOnNodes(env, ok, [0]);
    await assertNoEvent(
      env.clients[0], 'reconciler:actuated',
      (d) => d.identifier === okC1 && d.action === 'invalidSpec', 10000,
    );
  });

  it('rejects an invalid self-ref (index 0 -> 0) at install', async function () {
    this.timeout(120000);
    const bad = await buildSeedableIndexRefApp({ name: badName, selfRef: true, mode: 'g' });
    let err;
    try {
      await installOnNodes(env, bad, [1]);
    } catch (e) {
      err = e;
    }
    expect(err, 'self-ref install must be rejected, not silently accepted').to.not.equal(undefined);
    expect(String(err.message || err)).to.include(badName);
  });
});
