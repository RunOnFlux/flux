// Shared bootstrap for the reconciler integration suites. bootAndPeer brings a
// fleet to the peered/ticking state; seedAndInstall DB-seeds a pre-built app on
// every node and waits for it to install. Modelled on suite 28's inline helpers
// so new suites don't each re-copy them.
import { pushImage } from './registry-helper.js';
import { startTicker, advanceBlock } from './daemon-control.js';
import { dbClient } from './db-client.js';
import { buildSeedableApp, buildSeedableSyncthingApp } from './seed-helper.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed, waitForAppInstalled,
} from './wait.js';

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
    throw new Error(`app ${app.spec.name} installed on ${installed.length} nodes, needed >= ${minCount}`);
  }
  return installed;
}

// Convenience for a plain single-component app (the suite-28 shape): push an
// image, build the spec, seed + install. Returns { app, index }.
// Seed a syncthing (r:/g:/s:) app and wait for it to install. The syncthing
// folder id the deciders query is getAppIdentifier(`${name}_${name}`) i.e.
// `flux${name}_${name}` — returned as `folder` for driving syncthing-control.
//
// runningPeerIp: seed a remote running location so the installed node is NOT the
// syncthing leader (a leader starts immediately; only a non-leader waits for
// sync). Pass a non-fleet IP to force the sync-gated path.
export async function seedSyncthingApp(env, { name, mode = 'r', runningPeerIp = null }) {
  await pushImage(name, 'v1');
  const app = await buildSeedableSyncthingApp({ name, mode });

  for (let i = 1; i <= env.nodeCount; i++) {
    const dc = dbClient(i);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedGlobalAppSpec(app.spec);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedPermanentMessage(app.permanentMessage);
    // eslint-disable-next-line no-await-in-loop
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
    if (runningPeerIp) {
      // eslint-disable-next-line no-await-in-loop
      await dc.seedAppLocation({
        name, ip: runningPeerIp, hash: app.hash, runningSince: Date.now() - 600000,
      });
    }
  }

  const index = await Promise.any(env.clients.map(async (c, i) => {
    await waitForAppInstalled(c, name, 150000);
    return i;
  }));
  return { app, index, folder: `flux${name}_${name}`, identifier: `${name}_${name}` };
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
