// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import { setNodeStatus, removeFromNodeList } from '../framework/daemon-control.js';
import {
  waitFor, waitForReconcileActuated, waitForUp, waitForElectionDecisions, electionDecisionCount,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { isDaemonUp, listFolderFiles } from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A single-writer app on two nodes, the primary running it and the standby
// holding a copy. The primary loses its confirmation: it drops off the node list
// and takes its apps down. Until the other nodes evict its locations they still
// ask it whether it runs the component, and it answers truthfully, signed by the
// key the list held at its address when the standby proved it - a key the list
// no longer holds.
//
// The standby takes its answer that it holds nothing, and starts. Neither the
// location expiry nor the eviction sweep can do that for it here: both are set
// beyond the suite's own waits.
//
// A = the standby, B = the primary, C = a bystander the discovery ring needs.

const A = 0;
const B = 1;

// As long as production holds a verified identity.
const VERIFIED_TTL_MS = 30 * 60 * 1000;
// Beyond every wait below, so B's locations neither expire nor are evicted while
// the standby decides.
const LOCATION_TTL_S = 30 * 60;
const NODE_MONITOR_INTERVAL_MS = 60 * 60 * 1000;
// Production's whole handover, from FDM going quiet to the standby running it.
const HANDOVER_MS = 5 * 60 * 1000;

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a primary dropped from the node list hands its app over', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2edelisted${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const addr = (i) => `${env.clients[i].ip}:16127`;

  // Sampled for the whole suite: at most one node runs the component.
  const bothRan = [];
  let sampler = null;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          peerIdentityVerifiedTtlMs: VERIFIED_TTL_MS,
          locationTtlS: LOCATION_TTL_S,
          nodeMonitorIntervalMs: NODE_MONITOR_INTERVAL_MS,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await resetFdm();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    await electMaster(appName, env.clients[B].ip);
    const primaryAfter = env.clients[B].getLastEventId();
    await installOnNodes(env, app, [B]);
    await waitForReconcileActuated(env.clients[B], identifier, 'dataCleared', 120000, { afterId: primaryAfter });
    await seedSyncScopedData(env, appName, B);
    await waitForUp(env.clients[B], appName, 'the primary is running', { timeout: 180000, interval: 3000 });

    const standbyAfter = env.clients[A].getLastEventId();
    await installOnNodes(env, app, [A]);
    await waitForReconcileActuated(env.clients[A], identifier, 'dataCleared', 120000, { afterId: standbyAfter });

    sampler = setInterval(() => {
      Promise.all([isUp(env.clients[A], appName), isUp(env.clients[B], appName)])
        .then(([a, b]) => { if (a && b) bothRan.push(Date.now()); })
        .catch(() => {});
    }, 2000);
  });

  after(async function () {
    this.timeout(60000);
    clearInterval(sampler);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('proves who the primary is, and holds a copy of its data', async function () {
    this.timeout(300000);
    await waitFor(
      async () => (await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'verified')) > 0,
      { timeout: 180000, interval: 3000, label: 'the standby verified the primary' },
    );
    await waitFor(
      async () => (await listFolderFiles(env.clients[A], `${appDir(appName)}/appdata`)).split(' ').includes('seed-data'),
      { timeout: 240000, interval: 5000, label: 'the primary\'s data reached the standby' },
    );
    // The standby has read the primary off FDM, so once FDM goes quiet it asks the
    // primary itself.
    await waitForElectionDecisions(env.clients[A], identifier, 'primaryObserved', 1, { timeout: 60000 });
  });

  it('starts once the dropped primary has taken the component down, on its signed word', async function () {
    this.timeout(HANDOVER_MS + 300000);
    const startedAt = await electionDecisionCount(env.clients[A], identifier, 'started');

    await removeFromNodeList(env.clients[B].ip);
    await setNodeStatus(env.clients[B].ip, 'EXPIRED');
    await waitFor(async () => !(await isUp(env.clients[B], appName)), {
      timeout: 240000, interval: 3000, label: 'the dropped primary took its component down',
    });
    await clearMaster(appName);

    await waitForUp(env.clients[A], appName, 'the standby runs the component', { timeout: HANDOVER_MS, interval: 3000 });

    expect(await electionDecisionCount(env.clients[A], identifier, 'started')).to.be.above(startedAt);
    const locations = (await env.clients[A].get(`/apps/location/${appName}`)).data;
    expect(locations.map((l) => l.ip.split(':')[0]),
      'the dropped primary\'s location had gone, so its answer is not what released the standby')
      .to.include(env.clients[B].ip);
    expect(bothRan, 'moments when both nodes ran the component').to.deep.equal([]);
  });
});
