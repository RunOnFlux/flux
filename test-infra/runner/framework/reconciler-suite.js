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
  waitForReconcileActuated, waitForBootSettled,
} from './wait.js';
import { throwIfInfraDead, sleepUnlessInfraDead } from './infra-death.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from './subnet-config.js';
import { dialerCount, expectedPeerTotal } from './peer-topology.js';
import { setSynced, setSyncState, setNoPeerData } from './syncthing-control.js';
import { execInContainer } from './container.js';

// A folder the suite pins "synced" (setSynced reports a non-zero global index)
// must also HOLD data on disk, like any really-synced folder. Seeded apps write
// nothing themselves, and an index that claims bytes over an empty disk is the
// phantom-index state the mount-safety guard refuses to promote (and demotes) -
// the stub never rescans, so the disagreement never converges and the app never
// (re)starts. Call AFTER the sync layer's first-run reset (the dataCleared
// actuation): the reset clears local appdata at install and deletes anything
// written earlier. seedSyncthingApp runs this ordering itself; only suites
// installing through another path need to call it directly.
export async function seedSyncScopedData(env, name, index) {
  const dataFile = `/mnt/appdata/flux-apps/flux${name}_${name}/appdata/seed-data`;
  const r = await execInContainer(env.clients[index].container, `sh -c 'echo seeded > ${dataFile}'`);
  if (r.exitCode !== 0) {
    throw new Error(`seedSyncScopedData: could not write ${dataFile} on node ${index}: ${r.output}`);
  }
}

// Seed a pre-built app's global spec into the given nodes' DBs (so a local install
// can resolve it).
// A seeded app must still be alive on the chain the fleet is about to run. This
// is the funnel every global seed passes through, and it is the only place that
// holds BOTH the app and the env, so it is where the two are checked against
// each other rather than trusted to have been built consistently.
//
// Getting this wrong is silent and expensive: the spawner drops an expired app
// from every candidate list (so spawner suites spin their whole budget and time
// out rather than failing), and expireGlobalApplications deletes it outright on
// any node that restarts. That is a harness fault that presents as a product
// one, in the most expensive possible shape.
function assertAliveOnThisChain(env, app) {
  const seededAt = app.permanentMessage.height;
  const expiresAt = seededAt + (app.spec.expire ?? 22000);
  if (expiresAt <= env.initialHeight) {
    throw new Error(
      `seeded app ${app.spec.name} expires at block ${expiresAt}, at or below this suite's `
      + `chain start (${env.initialHeight}) - it is already expired before the fleet processes `
      + 'its first block. Seed relative to the chain rather than to a literal: '
      + 'buildSeedableApp({ env, ... }).',
    );
  }
}

async function seedGlobalSpec(env, app, indices) {
  assertAliveOnThisChain(env, app);
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
    // The install endpoint refuses with a 503 until boot reconciliation has
    // decided which apps this node is keeping. Waiting for the node to say it
    // has settled, rather than for its API to answer: the API is up long before
    // that decision, and an app installed in between has no location record for
    // reconciliation to keep it by, so it is removed as one that moved away.
    await waitForBootSettled(client);
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

// The election's own comparator (masterSlaveApps): runningSince ascending, holders
// carrying none first, ip as the final tiebreak. Exported so a suite can assert the
// order it arranged rather than assume it.
export function electionOrder(locations) {
  return [...locations].sort((a, b) => {
    if (!a.runningSince && b.runningSince) return -1;
    if (a.runningSince && !b.runningSince) return 1;
    if (a.runningSince < b.runningSince) return -1;
    if (a.runningSince > b.runningSince) return 1;
    if (a.ip < b.ip) return -1;
    if (a.ip > b.ip) return 1;
    return 0;
  });
}

// Place a g: app on holders ONE AT A TIME so their runningSince values are distinct
// and follow `placementOrder`. Two orderings decide who runs a g: app: the syncthing
// seed is the LOWEST IP among the holders, while the masterSlave election index is
// runningSince ascending — and runningSince is broadcast on placement, so it records
// the order the holders were placed. Installing them in parallel (installOnNodes over
// several indices) collapses that distinction: every holder's placement lands in the
// same instant, the sort falls through to its ip tiebreak, and the lowest-IP seed is
// always ALSO index 0. Every rule reading `index > 0` is dead under that fixture.
//
// Pass a placementOrder that puts the seed in the MIDDLE to get the divergent shape:
// the seed sits at index > 0 with a peer ABOVE it. `coldStart` pins every holder to a
// true cold start first (empty global, no connected peer holding the data), which must
// happen BEFORE install so the first election evaluation sees it.
export async function placeGAppInOrder(env, app, {
  placementOrder, folder, identifier, coldStart = true, gapMs = 3000,
}) {
  if (coldStart) {
    await Promise.all(placementOrder.map((i) => Promise.all([
      setSyncState({
        ip: getSubnetConfig().nodeIp(i + 1), folder, state: 'idle', globalBytes: 0, inSyncBytes: 0,
      }),
      setNoPeerData({ ip: getSubnetConfig().nodeIp(i + 1), folder }),
    ])));
  }
  for (const i of placementOrder) {
    const installAfter = env.clients[i].getLastEventId();
    // eslint-disable-next-line no-await-in-loop
    await installOnNodes(env, app, [i]);
    // Wait out the sync layer's first-run reset before writing disk data, or the
    // reset deletes it - a folder pinned synced later must hold what its index claims.
    // eslint-disable-next-line no-await-in-loop
    await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfter });
    // eslint-disable-next-line no-await-in-loop
    await seedSyncScopedData(env, app.spec.name, i);
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(gapMs);
  }
  return placementOrder;
}

// Resolve a holder's position in the election order, from the location list the
// election itself reads. Returns -1 when the holder has not been broadcast yet.
export async function electionIndexOf(env, appName, holderIndex, { timeout = 90000 } = {}) {
  const targetIp = getSubnetConfig().nodeIp(holderIndex + 1);
  let position = -1;
  await waitFor(async () => {
    const res = await env.clients[holderIndex].getAppLocations(appName);
    if (res.status !== 'success' || !res.data?.length) return false;
    position = electionOrder(res.data).findIndex((entry) => entry.ip.split(':')[0] === targetIp);
    return position > -1;
  }, { timeout, interval: 3000, label: `node ${holderIndex} present in ${appName}'s election order` });
  return position;
}

export async function bootAndPeer(env, { minOutbound, minInbound } = {}) {
  // A stub peer holds an index with no client behind it. It is something for the
  // fleet to talk to, never a node this boots, confirms or reads a height from -
  // so the waits run over the real nodes while the peering ceiling below still
  // counts every index, because a stub IS a peer.
  const nodes = env.clients.filter(Boolean);
  for (const client of nodes) await waitForDaemonReady(client);
  await Promise.all(nodes.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of nodes) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery();
  // Peering is a property of the fleet, not a literal. The ring's two halves are
  // disjoint only when dialers >= 2k+1 (peer-topology.js), and the fleet's own
  // config is derived to satisfy that, so outbound and inbound both settle at k.
  // A suite may still ask for its own numbers; they are capped by what a fleet of
  // this size can hold rather than waiting out a timeout on an impossible one.
  // Stubs are excluded: a stub holds a ring slot but supplies no connection.
  const dialers = dialerCount(env.clients.length, env.stubPeerClients?.size ?? 0);
  const ceiling = Math.max(dialers - 1, 1);
  const outboundTarget = minOutbound ?? Math.min(4, ceiling);
  const inboundTarget = minInbound ?? Math.min(2, ceiling);
  // Waited as a TOTAL. With the arcs disjoint the split is the ring's to decide,
  // but a suite that overrides the arc into an overlapping shape hands the split
  // to whichever half reaches the shared peer first - a race. The sum survives
  // both, and is the same demand either way.
  const stubCount = env.stubPeerClients?.size ?? 0;
  const totalTarget = expectedPeerTotal(outboundTarget, inboundTarget, dialers, stubCount);
  // Every real node, not nodes[0]. One node's counts are not the fleet's, and
  // node 0 is the least representative of them: it is the index every other
  // node's backward arc wraps onto, so it is where an overlapping ring strands
  // its connections first.
  //
  // Polled, not awaited on a peers:added event. That event is edge-triggered:
  // a small fleet finishes peering in a handful of events, so if the counts are
  // already satisfied when the listener attaches, nothing further is ever
  // published and the wait burns its full timeout on a condition that is
  // already true. The REST counts are the state itself.
  await waitFor(
    async () => {
      const totals = await Promise.all(nodes.map(async (n) => {
        const [outgoing, incoming] = await Promise.all([n.getPeers(), n.getIncomingPeers()]);
        return (outgoing.data?.length ?? 0) + (incoming.data?.length ?? 0);
      }));
      return totals.every((t) => t >= totalTarget);
    },
    { timeout: 120000, interval: 2000, label: `>=${totalTarget} peers on each of ${nodes.length} nodes` },
  );
  await startTicker();
}

// The location table never gates boot: the fetch starts at DB-ready and a
// real-scale artifact takes seconds to ingest and swap, so a request racing
// the boot lands on the designed degrade posture (/16 domains, geo answers
// 503). A suite that asserts table-backed answers waits for the swap to land
// first. domains: the organisation count the published artifact splits the
// fleet into - reaching it proves every node resolved (an unresolved node
// falls to its /16 rung and inflates the count).
export async function waitForLocationTable(node, { domains, timeout = 90000 } = {}) {
  await waitFor(async () => {
    // the placement geography, which is what this is actually waiting for -
    // asking the advice endpoint would be putting a question to a node to find
    // out whether its data has loaded, and that endpoint wants a Flux ID
    const response = await node.get('/apps/placementlocations');
    return response.status === 'success'
      && response.data.tableAvailable === true
      && (domains === undefined || response.data.total.domains === domains);
  }, { timeout, interval: 2000, label: `location table live${domains === undefined ? '' : ` with ${domains} domains`}` });
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

// What each node believes about who is installing an app, as an array indexed by
// node. A claim only matters where OTHER nodes can see it - it is their view
// that decides whether they stand down - so a suite asserting a claim was
// retracted has to ask every node, not the one that sent it.
// A node that cannot answer contributes null rather than an empty list, so
// "unreachable" is never mistaken for "holds no claims".
export async function installingClaimIpsByNode(env, appName) {
  return Promise.all(env.clients.map(async (client) => {
    try {
      const res = await client.get('/apps/installinglocations');
      if (res?.status !== 'success') return null;
      return res.data.filter((entry) => entry.name === appName).map((entry) => entry.ip);
    } catch {
      return null;
    }
  }));
}

// The installing ERRORS each node holds for an app, indexed by node. An error
// means an install was attempted and failed; nothing else may appear here.
export async function installingErrorsByNode(env, appName) {
  return Promise.all(env.clients.map(async (client) => {
    try {
      const res = await client.get('/apps/installingerrorslocations');
      if (res?.status !== 'success') return null;
      return res.data.filter((entry) => entry.name === appName);
    } catch {
      return null;
    }
  }));
}

// Wait until exactly `target` nodes have the app installed, then confirm the count
// HOLDS at exactly `target` for `stableMs` (so a late overshoot is caught, not
// missed by checking once). Returns the final sorted node indices.
// exact:false holds the window against `>= target` instead of `=== target`, for
// the callers whose subject is that the count is REACHED. Enforcing the ceiling
// as well only belongs to a caller whose subject is the ceiling - otherwise a
// suite proving one thing fails for the other, and the failure reads as the
// thing it was written to prove.
export async function waitForInstanceCount(env, appName, target, {
  timeout = 120000, stableMs = 12000, interval = 3000, exact = true,
} = {}) {
  await waitFor(
    async () => (await installedInstanceIndices(env, appName)).length >= target,
    { timeout, interval, label: `>=${target} instances of ${appName}` },
  );
  const deadline = Date.now() + stableMs;
  let last = await installedInstanceIndices(env, appName);
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(interval);
    // eslint-disable-next-line no-await-in-loop
    const now = await installedInstanceIndices(env, appName);
    if (exact ? now.length !== target : now.length < target) {
      throw new Error(`${appName} instance count = ${now.length} [${now.join(',')}], expected ${exact ? 'exactly' : 'at least'} ${target}`);
    }
    last = now;
  }
  // A count that "held" over an env that died during the window must not read
  // as a pass - nodes keep answering from memory over a dead env.
  throwIfInfraDead();
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
//
// Every install here waits out the sync layer's first-run reset (dataCleared) and
// then writes sync-scoped disk data, so a folder any test later pins synced already
// holds the data its index claims (see seedSyncScopedData). Whether/when to pin the
// SUBJECT synced stays the caller's choice.
export async function seedSyncthingApp(env, {
  name, mode = 'r', forceNonLeader = false, index = 0,
}) {
  await pushImage(name, 'v1');
  const app = await buildSeedableSyncthingApp({ name, mode });
  const folder = `flux${name}_${name}`;
  const identifier = `${name}_${name}`;

  const peerIndex = forceNonLeader ? (index === 0 ? env.clients.length - 1 : 0) : null;
  if (forceNonLeader) {
    // run the app on a real peer first: it becomes the syncthing leader, starts, and
    // gossips its running location. Wait until the subject node receives that
    // broadcast (surfaced as network:apprunning) before installing it, so its first
    // leader-election sees a running peer and takes the sync-gated follower path.
    const afterId = env.clients[index].getLastEventId();
    const peerInstallAfter = env.clients[peerIndex].getLastEventId();
    await installOnNodes(env, app, [peerIndex]);
    await waitForReconcileActuated(env.clients[peerIndex], identifier, 'dataCleared', 60000, { afterId: peerInstallAfter });
    await seedSyncScopedData(env, name, peerIndex);
    await setSynced({ ip: getSubnetConfig().nodeIp(peerIndex + 1), folder });
    await env.clients[index].waitForEvent(
      'network:apprunning', (d) => d.apps?.some((a) => a.name === name), 60000, { afterId },
    );
  }

  const installAfter = env.clients[index].getLastEventId();
  await installOnNodes(env, app, [index]);
  await waitForReconcileActuated(env.clients[index], identifier, 'dataCleared', 60000, { afterId: installAfter });
  await seedSyncScopedData(env, name, index);
  return {
    app, index, peerIndex, folder, identifier,
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
