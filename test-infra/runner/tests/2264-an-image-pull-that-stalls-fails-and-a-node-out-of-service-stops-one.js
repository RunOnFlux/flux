import {
  describe, it, before, afterEach,
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
import { afterTeardown } from '../framework/teardown-hook.js';

// An image pull whose progress goes silent fails and the install leaves nothing,
// and a node that goes out of service stops an install whose pull is
// downloading: the removal stops the pull, which no stall has ended.
//
// Each case's install is held after its image is verified and before it pulls,
// then let go into a pull of a large layer over a slowed link. In the first,
// once the layer is downloading the registry's packets are held: the transfer
// goes silent part way, with nothing closing it, and the pull fails after
// pullStallMs of silence. In the second, the node goes out of service while the
// layer is still downloading, and the removal stops the install.
//
// Node 1 is the subject; three nodes give it the two peers it fetches the
// network policy from, which it needs to install.

const SUBJECT = 1;
const BEFORE_PULL = 'install:beforePull';
const BEFORE_CONTAINERS = 'install:beforeContainers';
const PULL_STALL_MS = 15000;
// A layer that takes about a minute to download at RATE_KBIT, so the download is
// still running when the suite holds it or takes the node out of service.
const PAD_BYTES = 8 * 1024 * 1024;
const RATE_KBIT = 1000;
// A layer of several minutes at RATE_KBIT, so the download is still running when
// the node's removal of its apps comes.
const STOPPED_PAD_BYTES = 32 * 1024 * 1024;
// The node status monitor's pass at production's interval, so an app can only
// leave through its install's failure or the removal of the node's apps.
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const HELD_MS = 180000;
// The stall window, the install's cleanup and the removal after it.
const REMOVED_MS = PULL_STALL_MS + 120000;

describe('an image pull that stalls fails, and a node out of service stops one', function () {
  let env;
  let registryIp;
  dumpLogsOnFailure(() => env);
  const ts = Date.now();
  const subject = () => env.clients[SUBJECT];

  // Pushes the app's large image, holds its install before the pull, and lets the
  // spawner reach the hold.
  async function heldBeforePull(appName, padBytes = PAD_BYTES) {
    await pushTestApp(appName, 'v1', 'testapp', { padBytes });
    const from = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_PULL, appName);
    await seedSpawnerApp(env, await buildSeedableTestApp({ name: appName, instances: 1 }), [SUBJECT]);
    await subject().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_PULL && d.key === appName, HELD_MS, { afterId: from });
  }

  // Lets the held install into a slowed pull, and resolves once its layer is downloading.
  async function downloading(appName, mark) {
    await shapeTraffic(subject().container, { from: registryIp, rateKbit: RATE_KBIT });
    await subject().releaseCheckpoint(BEFORE_PULL, appName);
    await subject().waitForEvent('image:pullDownloading', (d) => d.repoTag?.includes(appName), 120000, { afterId: mark });
  }

  async function leftNothing(appName) {
    const res = await subject().get(`/apps/installedapps?_=${Date.now()}`);
    expect(res?.data?.map((app) => app.name), 'the app\'s record').to.not.include(appName);
    const left = (await listAppContainers(subject().container, { all: true })).filter((c) => c.name.includes(appName));
    expect(left, 'containers of the app').to.deep.equal([]);
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { nodeMonitorIntervalMs: NODE_MONITOR_INTERVAL_MS, pullStallMs: PULL_STALL_MS } },
    });
    await bootAndPeer(env);
    const resolved = await execInContainer(subject().container, `getent hosts ${REGISTRY_ALIAS}`);
    [registryIp] = resolved.output.trim().split(/\s+/);
    expect(registryIp, `${REGISTRY_ALIAS} resolved on the node`).to.match(/^\d+\.\d+\.\d+\.\d+$/);
  });

  // a case that fails part way leaves the next nothing held or slowed
  afterEach(async function () {
    await releaseAll(subject()).catch(() => {});
    await clearTrafficShaping(subject().container).catch(() => {});
    await subject()?.releaseAllCheckpoints().catch(() => {});
  });

  afterTeardown(async function () {
    if (env) await clearNodeStatus(subject().ip).catch(() => {});
    await env?.teardown();
  });

  it('fails a pull whose transfer goes silent, and the install leaves nothing', async function () {
    this.timeout(HELD_MS + REMOVED_MS + 180000);
    const appName = `e2epullstall${ts}`;
    await heldBeforePull(appName);
    const mark = subject().getLastEventId();
    await downloading(appName, mark);
    await hold(subject(), { from: registryIp, sport: REGISTRY_PORT, syn: false });

    await subject().waitForEvent('image:pullStalled', (d) => d.repoTag?.includes(appName), REMOVED_MS, { afterId: mark });
    await waitForAppRemoved(subject(), appName, REMOVED_MS, { afterId: mark });
    await leftNothing(appName);
  });

  it('stops an install whose pull is downloading when the node goes out of service, and the app leaves', async function () {
    this.timeout(HELD_MS + REMOVED_MS + 180000);
    const appName = `e2epullstop${ts}`;
    await heldBeforePull(appName, STOPPED_PAD_BYTES);
    // an install whose pull finished would reach this hold
    await subject().holdCheckpoint(BEFORE_CONTAINERS, appName);
    const mark = subject().getLastEventId();
    await downloading(appName, mark);

    await setNodeStatus(subject().ip, 'EXPIRED');
    await subject().waitForEvent('app:operationPreempted', (d) => d.appName === appName && d.operation === 'install' && d.by === 'removal', 120000, { afterId: mark });
    await waitForAppRemoved(subject(), appName, REMOVED_MS, { afterId: mark });

    const after = subject().getEventBuffer().filter((e) => e.id > mark);
    expect(after.filter((e) => e.event === 'image:pullStalled' && e.data?.repoTag?.includes(appName)), 'the pull ended by stalling, not by the removal').to.have.lengthOf(0);
    expect(after.filter((e) => e.event === 'checkpoint:held' && e.data?.name === BEFORE_CONTAINERS && e.data?.key === appName), 'the pull finished before the removal').to.have.lengthOf(0);
    await leftNothing(appName);
  });
});
