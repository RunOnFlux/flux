import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { listAppContainers } from '../framework/container.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import {
  assertNoEvent, waitForAppInstalled, waitForAppRemoved,
} from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node that goes out of service while an install is running removes every
// other app at once, leaves the app being installed to its install, and removes
// that app once the install has finished: removed under the install, the app's
// record goes and the install creates its containers anyway.
//
// The install is held at the point where it has the app's record and has
// created no container, which is where a removal under it leaves containers
// with no record. The node loses its confirmation there. The node status
// monitor's pass runs at production's interval, so the app being installed can
// only leave in time through the removal that waited for its install.
//
// Whether a removal is told to the network is read as its message goes out: the
// app removed while the node is unconfirmed is told to no peer, and the app
// removed after its install, once the node is confirmed again, is.
//
// Node 1 is the subject; three nodes give it the two peers it fetches the
// network policy from, which it needs to install. Node 0 is the peer that hears
// the removals.

const SUBJECT = 1;
const PEER = 0;
const BEFORE_CONTAINERS = 'install:beforeContainers';
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const INSTALLED_MS = 180000;
// Long enough for the removal that took the other app to reach this one, were
// it not left to its install.
const LEFT_TO_INSTALL_MS = 30000;
const REMOVED_MS = 180000;
// How long a removal message takes to reach a peer; the one that is sent arrives
// within it.
const TOLD_MS = 30000;

describe('a node out of service removes an app being installed once its install finishes', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const running = `e2eoosrunning${Date.now()}`;
  const installing = `e2eoosinstalling${Date.now()}`;
  const client = () => env.clients[SUBJECT];
  const peer = () => env.clients[PEER];
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

  it('removes every other app without telling the network it cannot reach, and leaves the app being installed to its install', async function () {
    this.timeout(INSTALLED_MS + LEFT_TO_INSTALL_MS + 60000);
    const mark = client().getLastEventId();
    const peerMark = peer().getLastEventId();
    await setNodeStatus(client().ip, 'EXPIRED');
    await client().waitForEvent('confirmation:changed', (d) => d.confirmed === false, 60000, { afterId: mark });

    await waitForAppRemoved(client(), running, REMOVED_MS, { afterId: mark });
    await assertNoEvent(client(), 'app:removed', (d) => d.name === installing, LEFT_TO_INSTALL_MS, { afterId: mark });
    expect(await installedNames(), 'the record of the app being installed').to.include(installing);
    // the canary is the next test: the same peer hears the removal sent once the node can be heard
    await assertNoEvent(peer(), 'network:appremoved', (d) => d.name === running, 1, { afterId: peerMark });
  });

  it('removes the app being installed once its install has finished, telling the network the node can by then reach, and leaving none of its containers', async function () {
    this.timeout(REMOVED_MS + TOLD_MS + 180000);
    const mark = client().getLastEventId();
    const peerMark = peer().getLastEventId();
    expect(await installedNames(), 'the record of the other app').to.not.include(running);

    // Confirmed again while the install runs. Unconfirmed, the node closed and
    // refused its peer connections, so the removal is let go once the peer is
    // connected again: a message sent before that reaches no one. Back in service,
    // the node's spawner may place the app again: an install of it stops before
    // its containers.
    await clearNodeStatus(client().ip);
    await client().waitForEvent('messageCapability:changed', (d) => d.capable === true, 120000, { afterId: mark });
    await client().waitForEvent('peers:added', (d) => d.ip === peer().ip, 120000, { afterId: mark });
    await client().releaseCheckpoint(BEFORE_CONTAINERS, installing);
    await client().holdCheckpoint(BEFORE_CONTAINERS, installing);

    await waitForAppRemoved(client(), installing, REMOVED_MS, { afterId: mark });
    await peer().waitForEvent('network:appremoved', (d) => d.name === installing, TOLD_MS, { afterId: peerMark });
    const left = (await listAppContainers(client().container, { all: true }))
      .filter((c) => c.name.includes(installing));
    expect(left, 'containers of the app being installed').to.deep.equal([]);
  });
});
