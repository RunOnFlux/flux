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
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed, waitForAppInstalled,
} from './wait.js';

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

// Deploy a syncthing (r:/g:/s:) app on a chosen node (targeted install) and wait
// for it to install. The syncthing folder id the deciders query is
// getAppIdentifier(`${name}_${name}`) i.e. `flux${name}_${name}` — returned as
// `folder` for driving syncthing-control.
//
// forceNonLeader: seed a remote running location so the installed node is NOT the
// syncthing leader (a leader starts immediately; only a non-leader waits for
// sync). The peer must be a REAL, confirmed fleet node that isn't the install
// target: nodeStatusMonitor reaps any appslocation IP that isn't on the
// deterministic node list, so a fake peer IP would be pruned and the install node
// would then elect itself leader and start immediately — skipping the sync gate.
export async function seedSyncthingApp(env, {
  name, mode = 'r', forceNonLeader = false, index = 0,
}) {
  await pushImage(name, 'v1');
  const app = await buildSeedableSyncthingApp({ name, mode });

  if (forceNonLeader) {
    const peerIp = env.clients[index === 0 ? env.clients.length - 1 : 0].ip;
    await dbClient(index + 1).seedAppLocation({
      name, ip: peerIp, hash: app.hash, runningSince: Date.now() - 600000,
    });
  }

  await installOnNodes(env, app, [index]);
  return {
    app, index, folder: `flux${name}_${name}`, identifier: `${name}_${name}`,
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
      repotag: `198.18.0.5:5000/${appName}:v1`,
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
