import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableMixedMountApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Fail-loud gate for the canonical g: classifier (commits 19ed49b98 / 84f982984).
//
// Real roundcube/rainloop specs carry the sync flag on a NON-primary mount
// segment (`/data|g:/db`) — syntactically invalid: the model supports sync only
// on the primary mount, and parseContainerData throws "Unknown mount syntax at
// index 1" on it. The old `.includes('g:')` substring matcher silently adopted
// these and deadlocked forever; the canonical parser rejects them. The first
// enforcement point is INSTALL: volume construction parses the containerData and
// refuses to build storage for an unparseable mount, so the spec can never be
// installed (the reconciler's invalidSpec refusal is the second net, for specs
// already on disk — covered by appReconciler.test.js). Here we prove the system
// REFUSES the shape rather than silently accepting it.
// Background: BUG-gapp-nonprimary-sync-segment.md.

describe('install rejects a non-primary-sync (invalid) containerData', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ebad${Date.now()}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('rejects install of a [plain|g] spec (g: on a non-primary mount)', async function () {
    this.timeout(120000);
    const app = await buildSeedableMixedMountApp({
      name: appName, mode: 'g', plainPath: '/data', syncPath: '/db',
    });
    let err;
    try {
      await installOnNodes(env, app, [0]);
    } catch (e) {
      err = e;
    }
    expect(err, 'install of a non-primary-sync spec must be rejected, not silently accepted').to.not.equal(undefined);
    // tie the rejection to THIS app's install so it can't false-pass on an unrelated error
    expect(String(err.message || err)).to.include(appName);
  });
});
