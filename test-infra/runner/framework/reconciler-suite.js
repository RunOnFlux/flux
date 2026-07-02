// Shared bootstrap for the reconciler integration suites. bootAndPeer brings a
// fleet to the peered/ticking state. Two deployment interfaces are available and
// shared by all suites:
//   - SPAWNER path: seedAndInstall / seedAndInstallMany / seedSimpleApp — seed the
//     global spec and let the spawner self-select nodes (exercises real placement).
//   - TARGETED path: installOnNodes — install on specific chosen nodes via the
//     node's installapplocally endpoint (deterministic, fast, you pick the nodes).
import { pushImage, pushTestApp } from './registry-helper.js';
import { startTicker, advanceBlock } from './daemon-control.js';
import { dbClient } from './db-client.js';
import { buildSeedableApp, buildSeedableSyncthingApp, buildSeedableTestApp } from './seed-helper.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from './keys.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed, waitForAppInstalled, waitFor,
} from './wait.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from './subnet-config.js';
import { setSynced } from './syncthing-control.js';
import { execInContainer } from './container.js';

// A folder the suite pins "synced" (setSynced reports a non-zero global index)
// must also HOLD data on disk, like any really-synced folder. Seeded apps write
// nothing themselves, and an index that claims bytes over an empty disk is
// exactly the phantom-index state the mount-safety guard demotes - a seeded
// r: leader left idle for a few monitor cycles would be demoted and held
// mid-suite (bit suite 61's leak test on its first run).
async function seedSyncScopedData(env, name, index) {
  const dataFile = `/mnt/appdata/flux-apps/flux${name}_${name}/appdata/seed-data`;
  const r = await execInContainer(env.clients[index].container, `sh -c 'echo seeded > ${dataFile}'`);
  if (r.exitCode !== 0) {
    throw new Error(`seedSyncScopedData: could not write ${dataFile} on node ${index}: ${r.output}`);
  }
}

// Seed a pre-built app's global spec into the given nodes' DBs (so a local install
// can resolve it).
async function seedGlobalSpec(env, app, indices) {
  await Promise.all(indices.map(async (i) => {
    const dc = dbClient(i + 1);
    await dc.seedGlobalAppSpec(app.spec);
    await dc.seedPermanentMessage(app.permanentMessage);
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }));
}

// TARGETED deployment: install a pre-built app on exactly the given node indices
// via each node's installapplocally endpoint (real install: pull + create + start
// + syncthing config). Deterministic and fast — no spawner-placement timing. Auth
// as the flux team (adminandfluxteam) since these are seeded global specs.
// Returns the indices it installed on.
export async function installOnNodes(env, app, indices, { timeout = 120000 } = {}) {
  await seedGlobalSpec(env, app, indices);
  const teamKey = fluxTeamKey();
  await Promise.all(indices.map(async (i) => {
    const client = env.clients[i];
    const auth = await authenticate(client.url, teamKey);
    // installapplocally streams progress then a final status; surface a failure
    // in that body instead of silently waiting out the app:installed timeout.
    const body = await client.installAppLocally(app.spec.name, auth.zelidauth);
    if (/"status"\s*:\s*"error"|Application .* not found|already installed|Unauthorized|Not enough/i.test(body)) {
      throw new Error(`installapplocally failed on node ${i}: ${body.slice(-600)}`);
    }
    await waitForAppInstalled(client, app.spec.name, timeout);
  }));
  return indices;
}

export async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

// Seed a pre-built app (buildSeedableApp / buildSeedableSyncthingApp) into every
// node's DB and wait until it installs on some node; resolves that node index.
export async function seedAndInstall(env, app, { timeout = 120000 } = {}) {
  for (let i = 1; i <= env.nodeCount; i++) {
    const dc = dbClient(i);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedGlobalAppSpec(app.spec);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedPermanentMessage(app.permanentMessage);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }
  return Promise.any(env.clients.map(async (c, i) => {
    await waitForAppInstalled(c, app.spec.name, timeout);
    return i;
  }));
}

// Seed a pre-built app into every node and wait until at least `minCount` nodes
// install it; resolves the sorted list of those node indices. Used by the
// multi-node gates (g: election needs >= 2 holders).
export async function seedAndInstallMany(env, app, minCount, { timeout = 150000 } = {}) {
  for (let i = 1; i <= env.nodeCount; i++) {
    const dc = dbClient(i);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedGlobalAppSpec(app.spec);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedPermanentMessage(app.permanentMessage);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }
  const installed = [];
  await Promise.all(env.clients.map(async (c, i) => {
    try {
      await waitForAppInstalled(c, app.spec.name, timeout);
      installed.push(i);
    } catch { /* this node didn't install within the window */ }
  }));
  installed.sort((a, b) => a - b);
  if (installed.length < minCount) {
    throw new Error(`app ${app.spec.name} installed on ${installed.length} nodes (${installed.join(',')}), needed >= ${minCount}`);
  }
  return installed;
}

// SPAWNER path: seed an app's global spec into EVERY node's globalzelapps DB
// (collection zelappsinformation — the one trySpawningGlobalApplication aggregates
// over) so each node's spawner sees it as missing-instances and self-selects. No
// running/installing locations are seeded, so `actual` starts at 0 and the spawner
// drives real placement + collision-resolution. The app image must be pushed first.
export async function seedSpawnerApp(env, app) {
  const all = env.clients.map((_, i) => i);
  await seedGlobalSpec(env, app, all);
}

// Ground-truth count of where an app is actually installed across the fleet
// (queries each node's installedapps endpoint). Returns sorted node indices.
export async function installedInstanceIndices(env, appName) {
  const idx = [];
  await Promise.all(env.clients.map(async (c, i) => {
    try {
      const res = await c.getInstalledApps();
      if (res.status === 'success' && res.data.find((a) => a.name === appName)) idx.push(i);
    } catch { /* node unreachable this tick */ }
  }));
  return idx.sort((a, b) => a - b);
}

// Wait until exactly `target` nodes have the app installed, then confirm the count
// HOLDS at exactly `target` for `stableMs` (so a late overshoot is caught, not
// missed by checking once). Returns the final sorted node indices.
export async function waitForInstanceCount(env, appName, target, {
  timeout = 120000, stableMs = 12000, interval = 3000,
} = {}) {
  await waitFor(
    async () => (await installedInstanceIndices(env, appName)).length >= target,
    { timeout, interval, label: `>=${target} instances of ${appName}` },
  );
  const deadline = Date.now() + stableMs;
  let last = await installedInstanceIndices(env, appName);
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, interval); });
    // eslint-disable-next-line no-await-in-loop
    const now = await installedInstanceIndices(env, appName);
    if (now.length !== target) {
      throw new Error(`${appName} instance count = ${now.length} [${now.join(',')}], expected exactly ${target}`);
    }
    last = now;
  }
  return last;
}

// Deploy a syncthing (r:/g:/s:) app on a chosen node (targeted install) and wait
// for it to install. The syncthing folder id the deciders query is
// getAppIdentifier(`${name}_${name}`) i.e. `flux${name}_${name}` — returned as
// `folder` for driving syncthing-control.
//
// forceNonLeader: make the installed node a follower rather than the syncthing
// leader (a leader starts immediately; only a follower waits for sync). Done the
// honest way — actually run the app on a real peer node first. That peer becomes
// the leader, starts, and advertises its running location via the normal gossip
// path (checkAndNotifyPeersOfRunningApps, carrying runningSince). We wait until the
// subject node has received that location, so when it installs it sees a genuine
// running peer and takes the sync-gated follower path. No fabricated DB rows — the
// alternative (seeding a location) is reaped by nodeStatusMonitor unless it points
// at a real node, and even then misrepresents an instance that isn't running.
//
// The peer's stub must report a genuinely synced source (setSynced) so it PROMOTES
// to sendreceive and keeps running for the whole test. On stub defaults the peer
// reports an empty global (globalBytes 0) plus a phantom connected synced peer:
// once an empty global is correctly no longer treated as synced, that node sits as
// an un-synced follower with a "connected synced peer" and the stall ladder removes
// it (broadcasting fluxappremoved) ~40s in — which collapses the SUBJECT's running-
// peer list to itself and makes the subject win a spurious single-peer election and
// cold-start. Pinning the peer synced keeps it the stable running source the subject
// must defer to.
export async function seedSyncthingApp(env, {
  name, mode = 'r', forceNonLeader = false, index = 0,
}) {
  await pushImage(name, 'v1');
  const app = await buildSeedableSyncthingApp({ name, mode });

  const peerIndex = forceNonLeader ? (index === 0 ? env.clients.length - 1 : 0) : null;
  if (forceNonLeader) {
    // run the app on a real peer first: it becomes the syncthing leader, starts, and
    // gossips its running location. Wait until the subject node receives that
    // broadcast (surfaced as network:apprunning) before installing it, so its first
    // leader-election sees a running peer and takes the sync-gated follower path.
    const afterId = env.clients[index].getLastEventId();
    await installOnNodes(env, app, [peerIndex]);
    await seedSyncScopedData(env, name, peerIndex);
    await setSynced({ ip: getSubnetConfig().nodeIp(peerIndex + 1), folder: `flux${name}_${name}` });
    await env.clients[index].waitForEvent(
      'network:apprunning', (d) => d.apps?.some((a) => a.name === name), 60000, { afterId },
    );
  }

  await installOnNodes(env, app, [index]);
  await seedSyncScopedData(env, name, index);
  return {
    app, index, peerIndex, folder: `flux${name}_${name}`, identifier: `${name}_${name}`,
  };
}

// Convenience for a plain single-component app (the suite-28 shape) via the
// SPAWNER path: push an image, build the spec, seed + install. Returns { app, index }.

// Seed the configurable test-app (controllable exit code / timed exit) and wait
// for it to install. Returns { app, index, identifier }. Requires the test-app
// binary to be built (bash test-infra/test-app/build.sh).
export async function seedTestApp(env, { name, exitCode = 0, exitAfterS = null } = {}) {
  await pushTestApp(name);
  const app = await buildSeedableTestApp({ name, exitCode, exitAfterS });
  const index = await seedAndInstall(env, app);
  return { app, index, identifier: `${name}_${name}` };
}

export async function seedSimpleApp(env, appName, { port = 31111 } = {}) {
  await pushImage(appName, 'v1');
  const app = await buildSeedableApp({
    name: appName,
    compose: [{
      name: appName,
      description: 'test container',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [port],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    }],
  });
  const index = await seedAndInstall(env, app);
  return { app, index };
}
