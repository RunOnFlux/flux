import { createTestEnv } from './test-env.js';
import { pushImage } from './registry-helper.js';
import { buildSeedableSyncthingApp } from './seed-helper.js';
import { getAppContainerStatus } from './container.js';
import { electMaster, resetFdm } from './fdm-control.js';
import { waitFor, waitForReconcileActuated, waitForUp, waitForElectionDecisions } from './wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from './reconciler-suite.js';
import { isDaemonUp, listFolderFiles } from './syncthing-real.js';

// A single-writer (g:) app on two holders of a three-node fleet, for the suites
// that take its primary away and watch what the standby does: B runs it, A holds
// a synced copy and has read B off FDM, C holds nothing and keeps the discovery
// ring closed.
//
// Locations and the node-list eviction outlive every wait a suite makes, so
// neither releases the standby in place of what the suite is about.

export const A = 0;
export const B = 1;
export const C = 2;

export const LOCATION_TTL_S = 30 * 60;
const NODE_MONITOR_INTERVAL_MS = 60 * 60 * 1000;

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

/**
 * Boots the fleet and places the app: B the primary, A the standby holding its
 * data. Samples, from then until `stop`, every moment more than one node runs it.
 * @param {object} opts
 * @param {object} opts.hookCtx The suite's `before` context
 * @param {string} opts.appName
 * @param {number} opts.sigtermExpiryS The fleet's shutdown window, and the grace
 *   a restarted syncthing waits out
 * @returns {Promise<object>}
 */
export async function placeSilentPrimaryApp({ hookCtx, appName, sigtermExpiryS }) {
  const identifier = `${appName}_${appName}`;
  const env = await createTestEnv({
    hookCtx,
    nodes: 3,
    syncthing: 'binary',
    tickerAutostart: false,
    configOverrides: {
      fluxapps: {
        minOutgoing: 1,
        minIncoming: 1,
        sigtermExpiryS,
        locationTtlS: LOCATION_TTL_S,
        nodeMonitorIntervalMs: NODE_MONITOR_INTERVAL_MS,
      },
    },
  });
  const client = (i) => env.clients[i];
  await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
    timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
  })));

  await resetFdm();
  await pushImage(appName, 'v1');
  // Two instances: the holders the suites place. Wanting more, the spawner would
  // place a third on C, which would then judge and take over beside them.
  const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', instances: 2 });

  await electMaster(appName, client(B).ip);
  const primaryAfter = client(B).getLastEventId();
  await installOnNodes(env, app, [B]);
  await waitForReconcileActuated(client(B), identifier, 'dataCleared', 120000, { afterId: primaryAfter });
  await seedSyncScopedData(env, appName, B);
  await waitForUp(client(B), appName, 'the primary is running', { timeout: 180000, interval: 3000 });

  const standbyAfter = client(A).getLastEventId();
  await installOnNodes(env, app, [A]);
  await waitForReconcileActuated(client(A), identifier, 'dataCleared', 120000, { afterId: standbyAfter });
  await waitFor(async () => (await listFolderFiles(client(A), `${appDir(appName)}/appdata`)).split(' ').includes('seed-data'), {
    timeout: 240000, interval: 5000, label: 'the primary\'s data reached the standby',
  });
  // Once FDM goes quiet the standby asks the primary it read off FDM.
  await waitForElectionDecisions(client(A), identifier, 'primaryObserved', 1, { timeout: 60000 });

  const twoRan = [];
  const sampler = setInterval(() => {
    Promise.all([A, B, C].map((i) => isUp(client(i), appName)))
      .then((up) => { if (up.filter(Boolean).length > 1) twoRan.push(Date.now()); })
      .catch(() => {});
  }, 2000);

  return {
    env,
    identifier,
    // When more than one node ran the component.
    twoRan,
    stop: () => clearInterval(sampler),
    isUp: (i) => isUp(client(i), appName),
    // How many times node i's election judged a silent peer with this verdict.
    verdicts: (i, verdict) => client(i).getDecisionCount('peer:silenceVerdict', identifier, verdict),
    // Node i's changes of role to primary after `afterId`.
    becamePrimary: (i, afterId) => client(i).getEventBuffer()
      .filter((e) => e.event === 'primaryRole:changed' && e.id > afterId
        && e.data?.identifier === identifier && e.data?.to === 'primary'),
  };
}
