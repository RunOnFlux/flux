import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import {
  assertNoEvent, waitForAppInstalled, waitForAppRemoved,
} from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node that goes out of service while an install is running removes every
// other app at once and leaves the app being installed to its install. Back in
// service by the time the install finishes, it keeps that app: the removal after
// the install is decided by the node's standing then, not by what made it remove
// the others. The same fixture with the node still out of service removes the
// app (2262).
//
// The install is held at the point where it has the app's record and has
// created no container, which is where a removal under it leaves containers
// with no record. The node loses its confirmation there. The node status
// monitor's pass runs at production's interval, so the app being installed can
// only leave in time through the removal that waited for its install.
//
// Node 1 is the subject; three nodes give it the two peers it fetches the
// network policy from, which it needs to install.

const SUBJECT = 1;
const BEFORE_CONTAINERS = 'install:beforeContainers';
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const INSTALLED_MS = 180000;
// Long enough for the removal that took the other app to reach this one, were
// it not left to its install.
const LEFT_TO_INSTALL_MS = 30000;
const REMOVED_MS = 180000;
// Long enough for the removal that waited for the install to reach the app,
// were it to remove it.
const KEPT_MS = 30000;

describe('a node back in service by the time an install finishes keeps the app it installed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const running = `e2eoosrunning${Date.now()}`;
  const installing = `e2eoosinstalling${Date.now()}`;
  const client = () => env.clients[SUBJECT];
  const installedNames = async () => {
    const res = await client().get(`/apps/installedapps?_=${Date.now()}`);
    expect(res?.status, `installed apps: ${JSON.stringify(res)}`).to.equal('success');
    return res.data.map((app) => app.name);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { nodeMonitorIntervalMs: NODE_MONITOR_INTERVAL_MS } },
    });
    await bootAndPeer(env);
    await pushTestApp(running);
    await pushTestApp(installing);

    await seedSpawnerApp(env, await buildSeedableTestApp({ name: running, instances: 1 }), [SUBJECT]);
    await waitForAppInstalled(client(), running, INSTALLED_MS);

    const from = client().getLastEventId();
    await client().holdCheckpoint(BEFORE_CONTAINERS, installing);
    await seedSpawnerApp(env, await buildSeedableTestApp({ name: installing, instances: 1 }), [SUBJECT]);
    await client().waitForEvent(
      'checkpoint:held',
      (d) => d.name === BEFORE_CONTAINERS && d.key === installing,
      INSTALLED_MS,
      { afterId: from },
    );
    expect(await installedNames(), 'fixture: both apps have a record, one install held before its containers')
      .to.include.members([running, installing]);
  });

  after(async function () {
    this.timeout(60000);
    if (env) {
      await client().releaseCheckpoint(BEFORE_CONTAINERS, installing).catch(() => {});
      await clearNodeStatus(client().ip).catch(() => {});
    }
    await env?.teardown();
  });

  it('removes every other app, and leaves the app being installed to its install', async function () {
    this.timeout(INSTALLED_MS + LEFT_TO_INSTALL_MS + 60000);
    const mark = client().getLastEventId();
    await setNodeStatus(client().ip, 'EXPIRED');
    await client().waitForEvent('confirmation:changed', (d) => d.confirmed === false, 60000, { afterId: mark });

    await waitForAppRemoved(client(), running, REMOVED_MS, { afterId: mark });
    await assertNoEvent(client(), 'app:removed', (d) => d.name === installing, LEFT_TO_INSTALL_MS, { afterId: mark });
    expect(await installedNames(), 'the record of the app being installed').to.include(installing);
  });

  it('keeps the app being installed when the node is back in service by the time its install finishes', async function () {
    this.timeout(INSTALLED_MS + KEPT_MS + 120000);
    const mark = client().getLastEventId();
    await clearNodeStatus(client().ip);
    await client().waitForEvent('confirmation:changed', (d) => d.confirmed === true, 120000, { afterId: mark });
    await client().releaseCheckpoint(BEFORE_CONTAINERS, installing);

    await waitForAppInstalled(client(), installing, INSTALLED_MS, { afterId: mark });
    await assertNoEvent(client(), 'app:removed', (d) => d.name === installing, KEPT_MS, { afterId: mark });
    expect(await installedNames(), 'the record of the app that was being installed').to.include(installing);
  });
});
