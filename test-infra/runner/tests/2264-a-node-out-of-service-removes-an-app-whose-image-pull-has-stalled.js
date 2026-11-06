import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  clearTrafficShaping, execInContainer, listAppContainers, shapeTraffic,
} from '../framework/container.js';
import { hold, releaseAll } from '../framework/packet-hold.js';
import { REGISTRY_ALIAS, REGISTRY_PORT } from '../framework/subnet-config.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import { waitForAppRemoved } from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An image pull whose progress goes silent fails, so the removal of a node
// out of service, which waits for the install running on it, is not held by a
// registry that never answers.
//
// The install is held after its image is verified and before it pulls, and the
// node goes out of service. The install is let go into a pull of a large layer
// over a slowed link, and once the layer is downloading the registry's packets
// are held: the transfer goes silent part way, with nothing closing it. The pull
// fails after pullStallMs of silence, the install fails and cleans up, and the
// app leaves the node.
//
// Node 1 is the subject; three nodes give it the two peers it fetches the
// network policy from, which it needs to install.

const SUBJECT = 1;
const BEFORE_PULL = 'install:beforePull';
const PULL_STALL_MS = 15000;
// A layer that takes about a minute to download at RATE_KBIT, so the download is
// still running when the suite holds it.
const PAD_BYTES = 8 * 1024 * 1024;
const RATE_KBIT = 1000;
// The node status monitor's pass at production's interval, so the app can only
// leave through the removal that waited for its install.
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const HELD_MS = 180000;
// The stall window, the install's cleanup and the removal after it.
const REMOVED_MS = PULL_STALL_MS + 120000;

describe('a node out of service removes an app whose image pull has stalled', function () {
  let env;
  let registryIp;
  dumpLogsOnFailure(() => env);
  const appName = `e2epullstall${Date.now()}`;
  const subject = () => env.clients[SUBJECT];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { nodeMonitorIntervalMs: NODE_MONITOR_INTERVAL_MS, pullStallMs: PULL_STALL_MS } },
    });
    await bootAndPeer(env);
    await pushTestApp(appName, 'v1', 'testapp', { padBytes: PAD_BYTES });
    const resolved = await execInContainer(subject().container, `getent hosts ${REGISTRY_ALIAS}`);
    [registryIp] = resolved.output.trim().split(/\s+/);
    expect(registryIp, `${REGISTRY_ALIAS} resolved on the node`).to.match(/^\d+\.\d+\.\d+\.\d+$/);

    const from = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_PULL, appName);
    await seedSpawnerApp(env, await buildSeedableTestApp({ name: appName, instances: 1 }), [SUBJECT]);
    await subject().waitForEvent(
      'checkpoint:held',
      (d) => d.name === BEFORE_PULL && d.key === appName,
      HELD_MS,
      { afterId: from },
    );
  });

  after(async function () {
    this.timeout(60000);
    if (env) {
      await releaseAll(subject()).catch(() => {});
      await clearTrafficShaping(subject().container).catch(() => {});
      await subject().releaseCheckpoint(BEFORE_PULL, appName).catch(() => {});
      await clearNodeStatus(subject().ip).catch(() => {});
    }
    await env?.teardown();
  });

  it('fails a pull whose transfer goes silent, and the app leaves the node out of service', async function () {
    this.timeout(REMOVED_MS + 180000);
    const mark = subject().getLastEventId();
    await setNodeStatus(subject().ip, 'EXPIRED');
    await subject().waitForEvent('confirmation:changed', (d) => d.confirmed === false, 60000, { afterId: mark });

    await shapeTraffic(subject().container, { from: registryIp, rateKbit: RATE_KBIT });
    await subject().releaseCheckpoint(BEFORE_PULL, appName);
    await subject().waitForEvent('image:pullDownloading', (d) => d.repoTag?.includes(appName), 120000, { afterId: mark });
    await hold(subject(), { from: registryIp, sport: REGISTRY_PORT, syn: false });

    await waitForAppRemoved(subject(), appName, REMOVED_MS, { afterId: mark });

    await subject().waitForEvent('image:pullStalled', (d) => d.repoTag?.includes(appName), 1, { afterId: mark });
    const res = await subject().get(`/apps/installedapps?_=${Date.now()}`);
    expect(res?.data?.map((app) => app.name), 'the app\'s record').to.not.include(appName);
    const left = (await listAppContainers(subject().container, { all: true })).filter((c) => c.name.includes(appName));
    expect(left, 'containers of the app').to.deep.equal([]);
  });
});
