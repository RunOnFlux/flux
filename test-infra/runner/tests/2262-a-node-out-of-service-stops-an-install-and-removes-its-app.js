import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { listAppContainers } from '../framework/container.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import {
  waitForAppInstalled, waitForAppRemoved,
} from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// A node that goes out of service while an install is running removes every
// app, and stops the install at its next step: the app being installed leaves
// with the others, with no record and none of its containers.
//
// The install is held at the point where it has the app's record and has
// created no container, which is where a removal under it would leave
// containers with no record. The node loses its confirmation there. The node
// status monitor's pass runs at production's interval, so the apps can only
// leave through the removal the lost confirmation starts.
//
// Node 1 is the subject; three nodes give it the two peers it fetches the
// network policy from, which it needs to install.

const SUBJECT = 1;
const BEFORE_CONTAINERS = 'install:beforeContainers';
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const INSTALLED_MS = 180000;
const REMOVED_MS = 180000;

describe('a node out of service stops an install and removes its app', function () {
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

  afterTeardown(async function () {
    if (env) {
      await client().releaseCheckpoint(BEFORE_CONTAINERS, installing).catch(() => {});
      await clearNodeStatus(client().ip).catch(() => {});
    }
    await env?.teardown();
  });

  it('removes every app, and stops the install of the app being installed at its next step', async function () {
    this.timeout(INSTALLED_MS + REMOVED_MS + 60000);
    const mark = client().getLastEventId();
    await setNodeStatus(client().ip, 'EXPIRED');
    await client().waitForEvent('confirmation:changed', (d) => d.confirmed === false, 60000, { afterId: mark });

    await waitForAppRemoved(client(), running, REMOVED_MS, { afterId: mark });
    await client().waitForEvent('app:operationPreempted', (d) => d.appName === installing && d.operation === 'install' && d.by === 'removal', REMOVED_MS, { afterId: mark });
    await client().releaseCheckpoint(BEFORE_CONTAINERS, installing);

    await waitForAppRemoved(client(), installing, REMOVED_MS, { afterId: mark });
    const names = await installedNames();
    expect(names, 'the record of the other app').to.not.include(running);
    expect(names, 'the record of the app that was being installed').to.not.include(installing);
    const left = (await listAppContainers(client().container, { all: true }))
      .filter((c) => c.name.includes(installing));
    expect(left, 'containers of the app being installed').to.deep.equal([]);
    const installed = client().getEventBuffer().filter((e) => e.id > mark && e.event === 'app:installed' && e.data?.name === installing);
    expect(installed, 'the install ran on to its end').to.have.lengthOf(0);
  });
});
