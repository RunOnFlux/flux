// Node.js v17+ resolves localhost to ::1 (IPv6) but Docker binds ports to 0.0.0.0 (IPv4).
// Without this, testcontainers can't connect to the Ryuk reaper and cleanup never runs.
// See: https://github.com/testcontainers/testcontainers-node/issues/772
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= '127.0.0.1';
process.env.TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT ??= '5s';

import { GenericContainer, Wait, getContainerRuntimeClient } from 'testcontainers';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { nodeClient } from './node-client.js';
import { execInContainer } from './container.js';
import { HttpPollWaitStrategy } from './http-wait-strategy.js';
import { TcpPollWaitStrategy } from './tcp-wait-strategy.js';
import { getSubnetConfig, REGISTRY_ALIAS } from './subnet-config.js';
import { closeDb } from './db-client.js';
import {
  clearInfraDeath, infraDeathError, reportInfraDeath, sleepUnlessInfraDead,
} from './infra-death.js';
import { acquireBootLock, releaseBootLock, BOOT_LOCK_MAX_WAIT_MS } from './boot-lock.js';
import { stubPeerClient } from './stub-peer-helper.js';
import { derivePeerThresholds } from './peer-topology.js';
import { pushImage } from './registry-helper.js';
import { MongoClient } from 'mongodb';
import { authenticate } from '../auth.js';
import { fluxTeamKey, nodeKey } from './keys.js';
import chainStart from './chain-start.cjs';

function createLogCollector() {
  // Each entry is { t, line }: t is the capture wall-clock (ISO), line is the raw
  // log text. The container's own log lines carry no timestamp, so we stamp at
  // capture time (near-realtime off the stream). hasLine/countPattern match the
  // raw text; getLines prepends t so inter-line gaps reveal timing (e.g. the
  // monitor cycle interval between successive "sync status" lines).
  const entries = [];
  const push = (line) => entries.push({ t: new Date().toISOString(), line });

  function consumer(stream) {
    stream.on('data', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed) push(trimmed);
      }
    });
    stream.on('end', () => push('[LOG_STREAM_ENDED]'));
    stream.on('error', (err) => push(`[LOG_STREAM_ERROR: ${err.message}]`));
    stream.on('close', () => push('[LOG_STREAM_CLOSED]'));
  }

  consumer.hasLine = (pattern) => {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    return entries.some((e) => regex.test(e.line));
  };

  consumer.countPattern = (pattern) => {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
    return entries.filter((e) => regex.test(e.line)).length;
  };

  consumer.getLines = () => entries.map((e) => `${e.t} ${e.line}`);

  return consumer;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', 'fixtures');
const manifest = JSON.parse(readFileSync(join(fixturesDir, 'node-manifest.json'), 'utf-8'));
// Identity for the fake-blockchain node list (collateral/pubkey/tier). Base-independent;
// the per-run IPs are assigned from subnet-config and POSTed to the daemon stub.
const deterministicList = JSON.parse(readFileSync(join(fixturesDir, 'deterministic-list.json'), 'utf-8'));

// All infra/node addresses derive from the per-run subnet base (TEST_SUBNET_BASE,
// default '198.18'); see subnet-config.js. The named constants below are kept so
// downstream references are unchanged — only the base varies per run.
const subnet = getSubnetConfig();
const SUBNET = subnet.subnet;
const GATEWAY = subnet.gateway;
const MONGO_IP = subnet.mongo;
const DAEMON_IP = subnet.daemon;
const SYNCTHING_IP = subnet.syncthing;
const REGISTRY_IP = subnet.registry;
const EXTERNAL_STUB_IP = subnet.externalStub;
const FDM_IP = subnet.fdm;
// Default only. A suite that needs to stand before a fork passes its own:
// createTestEnv({ initialHeight }). See chain-start.cjs for why the default is
// where it is.
const { DEFAULT_INITIAL_HEIGHT } = chainStart;

// Per-run-all label. run-all.sh exports E2E_RUN_LABEL (unique per invocation) and
// scopes its between-suite cleanup to it, so concurrent run-all invocations only
// ever remove their OWN docker objects — never another live run's fleet. Applied
// to every container, network and volume this run creates. Empty when a suite is
// run standalone (no run-all), in which case the cleanup never fires anyway.
const RUN_LABEL = process.env.E2E_RUN_LABEL || '';
const runLabels = () => (RUN_LABEL ? { 'flux-e2e-run': RUN_LABEL } : {});

// Image tag for every image this harness builds and runs. One box hosts more
// than one branch's harness work at a time, and the image names are fixed, so
// an untagged rebuild silently replaces whatever the other branch had built -
// the "assume all images are the other branch's" trap. Build with
// `FLUX_E2E_TAG=<slug> ./build-images.sh` and run with the same value set;
// the default keeps single-branch use exactly as it was.
const IMAGE_TAG = process.env.FLUX_E2E_TAG || 'latest';
const image = (name) => `${name}:${IMAGE_TAG}`;

// masterSlaveApps resolves the FDM by hostname (getMasterIpFromFdm tries EU/USA/ASIA
// regions, server index from getFdmIndex by the app name's first letter). Every
// reachable FDM hostname must resolve to the stub for any app name, otherwise the
// node resolves the real fdm-*.runonflux.io over the internet.
//
// FluxOS installs cacheable-lookup (apiServer.createDnsCache) on the global http/https
// agents, which resolves via dns.resolve (c-ares) — and c-ares does NOT consult
// /etc/hosts. So extra_hosts alone aren't enough: the names must be served by Docker's
// embedded DNS, which we do by setting them as network aliases on the stub (see
// StaticIpContainer.withStaticIp). extra_hosts are kept as a belt-and-suspenders for
// any getaddrinfo-based path (curl, dns.lookup).
function fdmHostnames() {
  const names = [];
  for (let i = 1; i <= 4; i++) {
    names.push(`fdm-fn-1-${i}.runonflux.io`);
    names.push(`fdm-usa-1-${i}.runonflux.io`);
    names.push(`fdm-sg-1-${i}.runonflux.io`);
  }
  return names;
}

// testcontainers ExtraHost objects for the built-in .withExtraHosts().
function fdmExtraHosts(ip) {
  return fdmHostnames().map((host) => ({ host, ipAddress: ip }));
}

class StaticIpContainer extends GenericContainer {
  #staticIp;
  #networkName;
  #aliases = [];

  withStaticIp(networkName, ip, aliases = []) {
    this.#staticIp = ip;
    this.#networkName = networkName;
    this.#aliases = aliases;
    return this;
  }

  async beforeContainerCreated() {
    // Tag with this run's label so run-all.sh's between-suite cleanup can scope
    // removal to its own fleet (see runLabels()).
    this.createOpts.Labels = { ...(this.createOpts.Labels || {}), ...runLabels() };
    if (this.#staticIp && this.#networkName) {
      this.createOpts.NetworkingConfig = {
        EndpointsConfig: {
          [this.#networkName]: {
            IPAMConfig: { IPv4Address: this.#staticIp },
            // Network aliases are served by Docker's embedded DNS (127.0.0.11),
            // so they're resolvable via c-ares (dns.resolve) — unlike /etc/hosts
            // extra_hosts, which only getaddrinfo (dns.lookup) consults.
            ...(this.#aliases.length ? { Aliases: this.#aliases } : {}),
          },
        },
      };
    }
  }
}

async function createNetwork() {
  const client = await getContainerRuntimeClient();
  const { getReaper } = await import('testcontainers');
  const reaper = await getReaper(client);
  const networkName = `flux-test-${Date.now()}`;
  await client.container.dockerode.createNetwork({
    Name: networkName,
    Driver: 'bridge',
    Labels: { 'org.testcontainers.session-id': reaper.sessionId, ...runLabels() },
    IPAM: {
      Driver: 'default',
      Config: [{ Subnet: SUBNET, Gateway: GATEWAY }],
    },
  });
  return networkName;
}

async function removeNetwork(networkName) {
  const client = await getContainerRuntimeClient();
  const network = client.container.dockerode.getNetwork(networkName);
  await network.remove().catch(() => {});
}

// Register a container the whole run depends on with the death watch below.
// A suite that stops one on purpose - suite 33 stops the registry so a recreate's
// image pull fails for real - marks it through testcontainers' own pre-stop hook,
// which StartedGenericContainer.stop() awaits before it stops the container, so
// the `die` that follows is never read as a death.
function watchInfra(env, name, container) {
  const entry = { name, container, expected: false };
  container.containerIsStopping = async () => { entry.expected = true; };
  env.infraContainers.push(entry);
}

function handleContainerDie(env, line) {
  // Teardown stops these containers deliberately (exit 0/137/143); every exit
  // from that point on is ours. Exit code is NOT the guard - an OOM-killed mongo
  // exits 137 exactly like a stopped one, and that voids the run just as surely.
  if (env.stopping) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return; // garbled frame - the next line is authoritative
  }
  const id = event.Actor?.ID ?? event.id;
  const entry = env.infraContainers.find((c) => c.container.getId() === id);
  if (!entry || entry.expected) return;
  // The daemon reports exitCode as a string attribute; timeNano is the death's own
  // clock, which is what a reader correlates against the node logs.
  const exitCode = event.Actor?.Attributes?.exitCode ?? 'unknown';
  const ms = event.timeNano
    ? Number(event.timeNano) / 1e6
    : ((event.time && event.time * 1000) || Date.now());
  reportInfraDeath({ name: entry.name, exitCode, at: new Date(ms).toISOString() });
}

// Docker emits a `die` event for every container exit. An infra container dying
// while the env is meant to be alive voids the run, so trip the shared
// kill-switch on the first one: every wait in flight then fails AT the death
// naming it, instead of half a minute later as a generic timeout (see
// infra-death.js). Event-driven off the daemon's own stream - the deaths this
// catches happen 38-91s into a fleet boot, so a poll would either miss the window
// or cost more than the watch.
//
// The stream is host-wide (other runs' fleets, every node, every app container),
// so deaths are matched by id against THIS env's registered infra containers.
async function startInfraDeathWatch(env) {
  const client = await getContainerRuntimeClient();
  const stream = await client.container.dockerode.getEvents({
    filters: { type: ['container'], event: ['die'] },
  });
  stream.setEncoding('utf-8');
  let partial = '';
  stream.on('data', (chunk) => {
    // newline-delimited JSON; a chunk boundary can split a line
    const lines = (partial + chunk).split('\n');
    partial = lines.pop();
    for (const line of lines) {
      if (line.trim()) handleContainerDie(env, line);
    }
  });
  // A socket that goes away with the stream is not an error worth surfacing, and
  // the watch must never be the reason a mocha process stays alive.
  stream.on('error', () => {});
  stream.socket?.unref?.();
  env.infraWatch = {
    stop() {
      stream.removeAllListeners('data');
      stream.destroy();
    },
  };
}

// Docker's log endpoint frames stdout and stderr into 8-byte-headed chunks for
// any container without a TTY, which is every container here. Undo the framing so
// what lands on disk is the plain text a reader expects; a header that is not a
// valid stream type means the output was never framed, so the rest passes through
// as-is. follow:false makes the read self-terminating — the daemon closes the
// response at the end of the log, so this needs no timer to know when it is done.
function demuxDockerLogs(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const parts = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const streamType = buf.readUInt8(i);
    const length = buf.readUInt32BE(i + 4);
    if (streamType > 2 || i + 8 + length > buf.length) break;
    parts.push(buf.subarray(i + 8, i + 8 + length).toString('utf-8'));
    i += 8 + length;
  }
  if (i < buf.length) parts.push(buf.subarray(i).toString('utf-8'));
  return parts.join('');
}

// stdout/stderr of every infra container, read from the daemon on demand: nothing
// streams these during the run the way the nodes' log collectors do, and until
// now they were never captured at all - which is why the mongo SIGSEGV that
// voided three suites has no explanation on disk. Best-effort per container: a
// container the suite stopped on purpose is already removed, and a log fetch that
// fails must never mask the failure being dumped.
async function readInfraLogs(infraContainers) {
  if (!infraContainers.length) return [];
  const client = await getContainerRuntimeClient();
  return Promise.all(infraContainers.map(async ({ name, container }) => {
    try {
      const raw = await client.container.dockerode
        .getContainer(container.getId())
        .logs({ stdout: true, stderr: true, follow: false, timestamps: true });
      return { name, text: demuxDockerLogs(raw) };
    } catch (err) {
      return { name, text: '', error: err.message };
    }
  }));
}

// Every env this process ever booted, including partially-built ones whose boot
// threw. log-on-failure falls back to this when the suite's own `env` variable
// was never assigned (createTestEnv threw inside a before-hook) — the one case
// where the suite-side getter cannot reach the resources holding the evidence.
// Envs stay registered after teardown on purpose: the failure dump runs in an
// after-all hook, i.e. potentially after teardown, and reads in-memory log lines
// and event snapshots that outlive the containers. A module singleton is safe
// because run-all gives each suite file its own mocha process.
const activeEnvs = new Set();
export function activeTestEnvs() {
  return [...activeEnvs];
}

// The env is a handle that exists from the moment boot starts, not a reward for
// a successful boot: _buildEnv registers resources onto it as they come up, so
// any boot-phase failure can still reach them — for the evidence dump AND for
// teardown (one idempotent path shared by the boot-failure catch and the suite's
// own after-hook). Previously the env object was only assembled on successful
// return: a boot-gate failure left the suite's `env` undefined, the after-all
// dump empty-handed, and the SSE clients connected — open EventSource handles
// that kept the mocha process alive forever (the 2026-06-12 gate wedge).
function makeEnvShell(networkName) {
  const started = []; // every started container, boot order (teardown stops in reverse)
  const clients = []; // node SSE clients, index-aligned with fluxNodes (null gaps)
  const nodeConfigs = []; // per real node: { index, ip, num, logCollector, bootIdDir, ... }
  const volumeNames = [];
  const eventSnapshots = new Map(); // node index -> SSE events captured at teardown
  const infraContainers = []; // { name, container, expected } - infra only, never nodes
  let infraLogSnapshot = null; // infra logs captured at teardown when the run is void
  let tornDown = false;

  const env = {
    networkName,
    containers: {},
    started,
    clients,
    nodeConfigs,
    volumeNames,
    infraContainers,
    stubPeerClients: new Map(),
    // The death watch (armed by createTestEnv) reads both: `stopping` tells it
    // the exits from here on are ours, `infraWatch` is its docker event stream.
    stopping: false,
    infraWatch: null,
    get nodeCount() { return clients.length; },
    get lastNodeIndex() { return clients.length - 1; },

    // Everything captured for each node so far: log lines (streaming since
    // container create) and SSE events (live buffer, or the snapshot teardown
    // takes before disconnect wipes it). Defined on the shell — unlike the
    // post-boot accessors — because the failure dump needs it at ANY boot phase.
    nodeDiagnostics() {
      const byIndex = new Map();
      for (const cfg of nodeConfigs) {
        byIndex.set(cfg.index, {
          index: cfg.index,
          ip: cfg.ip,
          lines: cfg.logCollector?.getLines() ?? [],
          events: [],
        });
      }
      clients.forEach((client, i) => {
        if (!client) return;
        const d = byIndex.get(i) ?? { index: i, ip: client.ip, lines: [], events: [] };
        const live = client.getEventBuffer();
        d.events = live.length ? live : (eventSnapshots.get(i) ?? []);
        byIndex.set(i, d);
      });
      return [...byIndex.values()].sort((a, b) => a.index - b.index);
    },

    // Per-infra-container stdout/stderr for the failure dump. Live off the daemon
    // while the containers exist; the teardown snapshot afterwards. Never rejects:
    // the caller is already reporting a failure and must not lose it to this.
    async infraDiagnostics() {
      if (infraLogSnapshot) return infraLogSnapshot;
      return readInfraLogs(infraContainers)
        .catch((err) => [{ name: 'infra', text: '', error: err.message }]);
    },

    async teardown() {
      if (tornDown) return;
      tornDown = true;
      const warn = (label, err) => console.warn(`teardown [${networkName}] ${label}: ${err.message}`);
      // Everything stopped below exits on purpose. Silence the death watch BEFORE
      // the first stop so a deliberate exit can never be reported as INFRA-DEAD:
      // the flag covers events already queued on the stream, closing it covers
      // the rest.
      env.stopping = true;
      try {
        env.infraWatch?.stop();
      } catch (err) {
        warn('infra death watch', err);
      }
      // When the run is already void, the dump that wants the crash log runs
      // AFTER this teardown (it is an after-all hook) and stopping a container
      // removes it, taking its logs with it. Snapshot them first - exactly why
      // the SSE buffers are snapshotted below.
      if (infraDeathError()) {
        infraLogSnapshot = await readInfraLogs(infraContainers).catch(() => null);
      }
      // disconnectEventStream wipes the client's event buffer — snapshot first so
      // a failure dump running after teardown still has the events
      clients.forEach((client, i) => {
        if (client) eventSnapshots.set(i, client.getEventBuffer());
      });
      for (const client of clients) {
        if (client) client.disconnectEventStream();
      }
      // FluxOS sets app mountpoints immutable (chattr +i) so an unmounted app
      // dir rejects writes. The flag lives on the BARE dir under the loop mount
      // and survives into the node's named volume - Docker then cannot delete
      // the volume (EPERM) and every run leaks its node volumes. Unmount to
      // expose the bare dirs and strip the flag while the node is still
      // running; containers going down makes this the last chance to exec.
      await Promise.all(clients.map(async (client) => {
        if (!client?.container) return;
        await execInContainer(
          client.container,
          'for d in /mnt/appdata/flux-apps/*/; do umount -l "$d" 2>/dev/null; done; chattr -R -i /mnt/appdata/flux-apps 2>/dev/null; true',
        ).catch((e) => warn('immutable-flag sweep', e));
      }));
      for (const c of [...started].reverse()) {
        await c.stop().catch((e) => warn('container stop', e));
      }
      await closeDb();
      const cleanupClient = await getContainerRuntimeClient();
      for (const volName of volumeNames) {
        const volume = cleanupClient.container.dockerode.getVolume(volName);
        try {
          await volume.remove();
        } catch (firstErr) {
          // The in-container sweep above misses nodes that crashed or never got
          // a client (boot failure), and their immutable app dirs EPERM the
          // volume delete. Strip the flags from the volume side with a
          // throwaway container and retry, so even a wedged fleet cleans up.
          try {
            const helper = await cleanupClient.container.dockerode.createContainer({
              Image: image('flux-e2e-fluxos-01'),
              Entrypoint: ['bash', '-c', 'chattr -R -i /v/flux-apps 2>/dev/null; true'],
              HostConfig: { Binds: [`${volName}:/v`], CapAdd: ['LINUX_IMMUTABLE'] },
            });
            await helper.start();
            await helper.wait();
            await helper.remove({ force: true }).catch(() => {});
            await volume.remove();
          } catch (retryErr) {
            warn(`volume ${volName}`, firstErr);
          }
        }
      }
      await removeNetwork(networkName);
      for (const cfg of nodeConfigs) {
        if (cfg.bootIdDir) rmSync(cfg.bootIdDir, { recursive: true, force: true });
      }
      http.globalAgent.destroy();
    },
  };
  return env;
}

function getBootId(nodeNum) {
  return `test-boot-id-node-${String(nodeNum).padStart(2, '0')}`;
}

async function seedMongo(mongoIp, nodeCount, bootContext = 'running', { dataCenter = true, initialHeight = DEFAULT_INITIAL_HEIGHT } = {}) {
  const client = new MongoClient(`mongodb://${mongoIp}:27017`);
  try {
    await client.connect();
    for (let i = 1; i <= nodeCount; i++) {
      const num = String(i).padStart(2, '0');
      const explorerDb = client.db(`node${num}_zelcashdata`);
      await explorerDb.collection('scannedheight').updateOne(
        {},
        { $set: { generalScannedHeight: initialHeight } },
        { upsert: true },
      );
      const localDb = client.db(`node${num}_zelfluxlocal`);
      await localDb.collection('geolocation').updateOne(
        { _id: 'nodeGeolocation' },
        {
          $set: {
            geolocation: {
              ip: subnet.nodeIp(i),
              continent: 'Europe', continentCode: 'EU',
              country: 'Germany', countryCode: 'DE',
              region: 'HE', regionName: 'Hesse',
              lat: 50.1109, lon: 8.6821,
              org: 'Test Network', static: true, dataCenter,
            },
            staticIp: true, dataCenter,
            lastIpChangeDate: null, updatedAt: Date.now(),
          },
        },
        { upsert: true },
      );
      if (bootContext === 'running') {
        await localDb.collection('nodestartuptracker').updateOne(
          { _id: 'heartbeat' },
          { $set: { lastAlive: Date.now(), machineBootId: getBootId(i), shutdownReason: null } },
          { upsert: true },
        );
      } else if (bootContext === 'rebooted') {
        await localDb.collection('nodestartuptracker').updateOne(
          { _id: 'heartbeat' },
          { $set: { lastAlive: Date.now(), machineBootId: 'old-boot-id', shutdownReason: 'sigterm' } },
          { upsert: true },
        );
      } else if (typeof bootContext === 'object') {
        // lastAliveAgoMs pins the downtime the node will measure, not a wall
        // clock: an absolute lastAlive computed in a before-hook rots for the
        // whole boot-lock queue (minutes under a parallel gate), while this
        // seed runs after the lock with only the node's own boot left ahead.
        const lastAlive = bootContext.lastAliveAgoMs != null
          ? Date.now() - bootContext.lastAliveAgoMs
          : (bootContext.lastAlive ?? Date.now());
        await localDb.collection('nodestartuptracker').updateOne(
          { _id: 'heartbeat' },
          { $set: {
            lastAlive,
            machineBootId: bootContext.machineBootId ?? 'old-boot-id',
            shutdownReason: bootContext.shutdownReason ?? null,
          } },
          { upsert: true },
        );
      }
      // bootContext === 'firstBoot': no heartbeat seeded
    }
  } finally {
    await client.close();
  }
}

// A node is ready when it can SERVE AUTH, not merely HTTP: the first thing every
// suite does against a fresh or restarted node is authenticate (startDiscovery),
// and /id/loginphrase needs the mongo connection, which comes up after express
// starts answering /flux/version. During that window the route returns 200 with
// an error body, so readiness must validate the body, not just res.ok.
function nodeReadyWaitStrategy(nodeIp) {
  const validate = async (res) => {
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return !!(body && body.status === 'success');
  };
  return new HttpPollWaitStrategy(`http://${nodeIp}:16127/id/loginphrase`, { validate });
}

export async function createTestEnv({
  hookCtx = null, nodes = 1, deferredNodes = 0, legacyNodes = [], stubPeers = [],
  configOverrides = null, nodeConfigOverrides = {}, nodeTiers = null, dataCenter = true,
  tickerAutostart = false, discoveryAutostart = false, nodeStatusOverrides = {},
  rpcFailures = [], bootContext = 'running', initialHeight = DEFAULT_INITIAL_HEIGHT,
} = {}) {
  // The boot-lock queue wait must not count against the suite's hook budget.
  // Mocha enforces a hook's timeout twice: the watchdog timer (which would fire
  // MID-QUEUE whenever the queue alone outlasts the budget), and a completion-time
  // duration check that fails any hook whose TOTAL elapsed time exceeds the
  // timeout VALUE — so merely re-setting the same value re-arms the watchdog but
  // still fails the hook once it completes. Widen it to cover the longest wait the
  // lock itself will tolerate, then set declared + queued once through: that value
  // passes the duration check with exactly the declared budget left for the boot,
  // and setting it re-arms the watchdog.
  //
  // Widened, never DISABLED. A hook with no timeout has no failure mode, only a
  // silence: with the timeout off, a waiter that never reached the front of the
  // queue hung until the runner's 1800s SIGKILL, which reports as rc=125 and
  // discards every test the suite had already passed. The slack below keeps the
  // lock's own deadline the one that fires, so the error names the queue instead
  // of being an anonymous mocha timeout.
  // Hooks that disabled their timeout (0) are left disabled.
  const declaredMs = (hookCtx && typeof hookCtx.timeout === 'function') ? hookCtx.timeout() : 0;
  if (declaredMs > 0) hookCtx.timeout(declaredMs + BOOT_LOCK_MAX_WAIT_MS + 30000);
  const queuedFrom = process.hrtime.bigint();
  await acquireBootLock();
  if (declaredMs > 0) {
    const queuedMs = Number((process.hrtime.bigint() - queuedFrom) / 1000000n);
    hookCtx.timeout(declaredMs + queuedMs);
  }
  const networkName = await createNetwork();
  const env = makeEnvShell(networkName);
  activeEnvs.add(env);
  // A previous env's death must not fail this one's waits.
  clearInfraDeath();

  try {
    // Armed before anything starts: the deaths this catches land 38-91s after
    // mongo starts, i.e. inside the fleet boot, where the waits at risk are the
    // boot's own.
    await startInfraDeathWatch(env);
    await _buildEnv(env, nodes, deferredNodes, legacyNodes, stubPeers, configOverrides, nodeConfigOverrides, nodeTiers, dataCenter, tickerAutostart, discoveryAutostart, nodeStatusOverrides, rpcFailures, bootContext, initialHeight);
    return env;
  } catch (err) {
    // Boot failed: the env owns everything started so far. The shared teardown
    // disconnects the SSE clients (so mocha can exit) and stops the containers;
    // the log collectors and event snapshots stay reachable via activeTestEnvs()
    // for the after-all failure dump. The boot error is what matters — teardown
    // problems are warned, never allowed to mask it.
    await env.teardown().catch((e) => console.warn(`boot-failure teardown [${networkName}]: ${e.message}`));
    throw err;
  } finally {
    releaseBootLock();
  }
}

function mergeConfigs(base, override) {
  if (!override) return base;
  if (!base) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
      result[key] = { ...result[key], ...value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function _buildEnv(env, nodes, deferredNodes, legacyNodes, stubPeers, configOverrides, nodeConfigOverrides, nodeTiers, dataCenter, tickerAutostart, discoveryAutostart, nodeStatusOverrides, rpcFailures, bootContext, initialHeight) {
  // Everything built here registers onto the env shell as it comes up, so a
  // boot-phase throw leaves the partial state reachable (see makeEnvShell).
  const {
    networkName, containers, started, clients, volumeNames, nodeConfigs,
    stubPeerClients: stubPeerClientsMap,
  } = env;
  const stubPeerSet = new Set(stubPeers);

  // NO docker health checks on infra containers, deliberately. Readiness is the
  // wait strategy right below each one, host-side, polling the very endpoint a
  // health check would have polled; death is a `die` event (watchInfra). Nothing
  // reads Docker's health status here - the poll strategies exist BECAUSE
  // Wait.forHealthCheck() destroys a fleet on one transient "unhealthy" under
  // boot contention (see http-wait-strategy.js).
  //
  // It was not free to keep: every check spawned a process inside the container
  // every 3 seconds - a full mongosh for mongo, measured at ~750ms of CPU each,
  // and a node boot for every stub. Around 37% of a core per fleet, ~2 cores at
  // six fleets in flight, spent producing a signal with no consumer.
  //
  // Pinned by digest so a crash can be bisected across image updates.
  // nofile: Docker's default soft limit is 1024, and a whole fleet's connection
  // pools plus WiredTiger's file-per-collection cross it during concurrent node
  // boot — EMFILE panics WT (directory-sync fails) and mongod dies with what
  // presents as a SIGSEGV. The compose envs already run mongo at 65536; this
  // path was the only one still on the Docker default.
  const mongo = await new StaticIpContainer('mongo:8@sha256:a706cb4e493bcd0262f345b3b0c78732ca0e54301f0d7bbe2b66f26313ce7ccb')
    .withCommand(['--wiredTigerCacheSizeGB', '1', '--setParameter', 'maxNumActiveUserIndexBuilds=64', '--setParameter', 'enableTestCommands=1'])
    .withUlimits({ nofile: { soft: 65536, hard: 65536 } })
    .withStaticIp(networkName, MONGO_IP)
    .withWaitStrategy(new TcpPollWaitStrategy(MONGO_IP, 27017))
    .start();
  started.push(mongo);
  containers.mongo = mongo;
  watchInfra(env, 'mongo', mongo);

  await seedMongo(MONGO_IP, nodes, bootContext, { dataCenter, initialHeight });

  const daemonStub = await new StaticIpContainer(image('flux-e2e-daemon-stub'))
    .withStaticIp(networkName, DAEMON_IP)
    .withEnvironment({
      FLUX_TEST_HARNESS: 'true',
      FLUXD_PORT: '16124',
      BENCHD_PORT: '16224',
      CONTROL_PORT: '18232',
      TICKER_AUTOSTART: tickerAutostart ? 'true' : 'false',
      NODE_COUNT: String(nodes),
      INITIAL_HEIGHT: String(initialHeight),
    })
    .withBindMounts([{
      source: fixturesDir,
      target: '/fixtures',
      mode: 'ro',
    }])
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${DAEMON_IP}:18232/state`))
    .start();
  started.push(daemonStub);
  containers.daemonStub = daemonStub;
  watchInfra(env, 'daemonStub', daemonStub);

  // Render the deterministic node list for this run: identity from the committed
  // fixture, addresses from subnet-config (the single source of truth for node IPs).
  // POST before any node boots; /set-node-list also resets the stub's restore/reset
  // baseline. A no-op-equivalent when base === '198.18'.
  const runNodeList = deterministicList.slice(0, nodes).map((n, idx) => ({ ...n, ip: subnet.nodeIp(idx + 1) }));
  await fetch(`http://${DAEMON_IP}:18232/set-node-list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: runNodeList }),
  });

  for (const [ip, status] of Object.entries(nodeStatusOverrides)) {
    await fetch(`http://${DAEMON_IP}:18232/node-status/${ip}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }

  for (const ip of rpcFailures) {
    await fetch(`http://${DAEMON_IP}:18232/rpc-fail/${ip}`, { method: 'POST' });
  }

  if (nodeTiers) {
    for (const [index, tier] of Object.entries(nodeTiers)) {
      const ip = subnet.nodeIp(Number(index) + 1);
      await fetch(`http://${DAEMON_IP}:18232/node-tier/${ip}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
    }
  }

  const syncthingStub = await new StaticIpContainer(image('flux-e2e-syncthing-stub'))
    .withStaticIp(networkName, SYNCTHING_IP)
    .withEnvironment({ SYNCTHING_PORT: '8384', CONTROL_PORT: '8385' })
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${SYNCTHING_IP}:8384/rest/noauth/health`))
    .start();
  started.push(syncthingStub);
  containers.syncthingStub = syncthingStub;
  watchInfra(env, 'syncthingStub', syncthingStub);

  const externalStub = await new StaticIpContainer(image('flux-e2e-external-http-stub'))
    .withStaticIp(networkName, EXTERNAL_STUB_IP)
    .withEnvironment({ STUB_PORT: '3000', CONTROL_PORT: '3001' })
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${EXTERNAL_STUB_IP}:3001/health`))
    .start();
  started.push(externalStub);
  containers.externalStub = externalStub;
  watchInfra(env, 'externalStub', externalStub);

  const fdmStub = await new StaticIpContainer(image('flux-e2e-fdm-stub'))
    .withStaticIp(networkName, FDM_IP, fdmHostnames())
    .withEnvironment({ FDM_PORT: '16130', CONTROL_PORT: '16131' })
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${FDM_IP}:16131/health`))
    .start();
  started.push(fdmStub);
  containers.fdmStub = fdmStub;
  watchInfra(env, 'fdmStub', fdmStub);

  if (!dataCenter) {
    for (let i = 1; i <= nodes; i++) {
      await fetch(`http://${EXTERNAL_STUB_IP}:3001/geolocation/${subnet.nodeIp(i)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosting: false }),
      });
    }
  }

  const registryTlsDir = join(fixturesDir, 'registry-tls');
  // The registry is reached by a stable network alias (fluxregistry), not its IP:
  // node dockerd pulls fluxregistry:5000/... and TLS verifies DNS:fluxregistry, so
  // the registry works under any subnet base without regenerating the cert.
  const registry = await new StaticIpContainer('registry:2')
    .withStaticIp(networkName, REGISTRY_IP, [REGISTRY_ALIAS])
    .withBindMounts([{
      source: registryTlsDir,
      target: '/certs',
      mode: 'ro',
    }])
    .withEnvironment({
      REGISTRY_HTTP_ADDR: '0.0.0.0:5000',
      REGISTRY_HTTP_TLS_CERTIFICATE: '/certs/server-cert.pem',
      REGISTRY_HTTP_TLS_KEY: '/certs/server-key.pem',
    })
    .withWaitStrategy(Wait.forLogMessage(/listening on/))
    .start();
  started.push(registry);
  containers.registry = registry;
  watchInfra(env, 'registry', registry);

  // Seed the default spec image so every env's registry can satisfy
  // registration verification and installs for buildAppSpec/buildSeedableApp
  // defaults BY CONSTRUCTION - no per-suite push incantation. The image is
  // synthesized in memory (static pause binary + marker; see registry-helper),
  // so this costs milliseconds and never contacts Docker Hub.
  await pushImage('e2e-pause', 'v1');

  const rtClient = await getContainerRuntimeClient();
  const { getReaper: getReaperFn } = await import('testcontainers');
  const reaper = await getReaperFn(rtClient);
  for (let i = 0; i < nodes; i++) {
    const volName = `${networkName}-node${i}`;
    await rtClient.container.dockerode.createVolume({
      Name: volName,
      Labels: { 'org.testcontainers.session-id': reaper.sessionId, ...runLabels() },
    });
    volumeNames.push(volName);
  }

  const deferredBuilders = new Map();
  const firstDeferred = nodes - deferredNodes;

  for (let i = 0; i < nodes; i++) {
    if (stubPeerSet.has(i)) continue;

    const num = String(i + 1).padStart(2, '0');
    const nodeIp = subnet.nodeIp(i + 1);
    const nodeManifest = manifest.nodes[i];

    const logCollector = createLogCollector();
    const bootIdDir = join(tmpdir(), `flux-bootid-${networkName}-${num}`);
    mkdirSync(bootIdDir, { recursive: true });
    writeFileSync(join(bootIdDir, 'boot-id'), getBootId(i + 1));
    const bindMounts = [
      { source: volumeNames[i], target: '/mnt/appdata' },
      { source: join(fixturesDir, 'registry-tls', 'ca.pem'), target: '/usr/local/share/ca-certificates/test-registry.crt', mode: 'ro' },
      { source: bootIdDir, target: '/tmp/flux-boot-config' },
    ];
    const isLegacy = legacyNodes.includes(i);
    const nodeEnv = {
      NODE_CONFIG_DIR: `/flux/test-infra/config/node-${num}`,
      FLUXD_PATH: '/dat/var/lib/fluxd',
      FLUXD_CONFIG_PATH: `/flux/test-infra/fixtures/conf/flux-${num}.conf`,
      SYNCTHING_PATH: '/dat/usr/lib/syncthing',
      FLUXBENCH_PATH: '/dat/usr/lib/fluxbenchd',
      FLUX_WATCHDOG_PATH: '/dat/usr/lib/fluxwatchdog',
      FLUX_APPS_FOLDER: '/mnt/appdata/flux-apps',
      FLUX_NODE_IP: nodeIp,
      FLUX_ADMIN_ZELID: nodeManifest.zelid,
      FLUX_API_PORT: '16127',
      FLUX_SYNCTHING_HOST: SYNCTHING_IP,
      FLUX_SYNCTHING_PORT: '8384',
      NODE_EXTRA_CA_CERTS: '/usr/local/share/ca-certificates/test-registry.crt',
    };
    if (!isLegacy) nodeEnv.FLUXOS_PATH = '/flux';
    if (discoveryAutostart) nodeEnv.FLUX_DISCOVERY_AUTOSTART = 'true';
    // Point the node's config at the base-derived infra IPs. The mounted config
    // files (shared.js / node-NN) carry the default 198.18 addresses; NODE_CONFIG
    // is deep-merged over them by the `config` package, so under a non-default base
    // these overrides take effect (and are a no-op when base === '198.18'). Explicit
    // test overrides still win (merged on top of this).
    const infraOverride = {
      database: { url: MONGO_IP },
      daemon: { host: DAEMON_IP },
      benchmark: { host: DAEMON_IP },
      syncthing: { ip: SYNCTHING_IP },
      github: { rawBaseUrl: `http://${EXTERNAL_STUB_IP}:3000`, apiBaseUrl: `http://${EXTERNAL_STUB_IP}:3000` },
      geolocation: { ipApiBaseUrl: `http://${EXTERNAL_STUB_IP}:3000`, statsApiBaseUrl: `http://${EXTERNAL_STUB_IP}:3000` },
      // Every base URL a node fetches from belongs here, not just in
      // config/shared.js: a run claims its own /24, so an address baked into the
      // shared config is only correct for the run that happens to claim the
      // first one. A policy URL left pointing at another run's subnet is
      // unreachable, and the fetch stalls the spawn attempt rather than failing
      // it - the app is simply never installed, with nothing logged.
      policy: { baseUrl: `http://${EXTERNAL_STUB_IP}:3000` },
      // Peer thresholds follow the fleet, so a suite declares a shape and never a
      // constant. The production values assume a network large enough to carry
      // them; a smaller fleet cannot, and asking it to is what leaves a node short
      // of a door it can never open. Derived here rather than in the suites so
      // there is nothing to remember and nothing to keep in step - see
      // peer-topology.js. A suite TESTING a threshold sets its own in
      // configOverrides, which merges over this and wins.
      fluxapps: derivePeerThresholds(nodes, stubPeers.length),
    };
    const nodeConfig = mergeConfigs(infraOverride, mergeConfigs(configOverrides, nodeConfigOverrides[i]));
    nodeEnv.NODE_CONFIG = JSON.stringify(nodeConfig);

    // Wait on an HTTP poll of the node's own /flux/version, not Docker's health
    // state machine: under a contended 10-node fleet boot, Wait.forHealthCheck()
    // tears the fleet down on a transient "unhealthy" even when FluxOS is up. See
    // http-wait-strategy.js for the full rationale.
    const builder = new StaticIpContainer(image('flux-e2e-fluxos-01'))
      .withPrivilegedMode()
      .withStaticIp(networkName, nodeIp)
      .withExtraHosts(fdmExtraHosts(FDM_IP))
      .withBindMounts(bindMounts)
      .withLogConsumer(logCollector)
      .withEnvironment(nodeEnv)
      .withWaitStrategy(nodeReadyWaitStrategy(nodeIp).withStartupTimeout(120000));

    nodeConfigs.push({ index: i, builder, ip: nodeIp, num: i + 1, logCollector, bootIdDir });
  }

  const startPromises = nodeConfigs
    .filter((n) => n.index < firstDeferred)
    .map(async (n) => {
      const container = await n.builder.start();
      started.push(container);
      return { ...n, container };
    });

  const startedNodes = await Promise.all(startPromises);
  const startedByIndex = new Map(startedNodes.map((n) => [n.index, n]));

  for (const stubIdx of stubPeers) {
    const nodeIp = subnet.nodeIp(stubIdx + 1);
    const key = nodeKey(stubIdx + 1);

    const stub = await new StaticIpContainer(image('flux-e2e-peer-stub'))
      .withStaticIp(networkName, nodeIp)
      .withEnvironment({
        FLUX_TEST_HARNESS: 'true',
        WS_PORT: '16127',
        CONTROL_PORT: '16128',
        PRIVATE_KEY: key.privkey,
        PUBLIC_KEY: key.pubkey,
        NODE_IP: nodeIp,
      })
      .withWaitStrategy(new HttpPollWaitStrategy(`http://${nodeIp}:16128/health`))
      .start();
    started.push(stub);
    stubPeerClientsMap.set(stubIdx, stubPeerClient(nodeIp));
  }

  const fluxNodesByIndex = new Map(nodeConfigs.map((n) => [n.index, n]));
  const fluxNodes = [];
  for (let i = 0; i < nodes; i++) {
    const cfg = fluxNodesByIndex.get(i);
    if (!cfg) {
      fluxNodes.push({ container: null, ip: subnet.nodeIp(i + 1), num: i + 1, logCollector: null, bootIdDir: null });
      continue;
    }
    const s = startedByIndex.get(i);
    if (s) {
      fluxNodes.push({ container: s.container, ip: cfg.ip, num: cfg.num, logCollector: cfg.logCollector, bootIdDir: cfg.bootIdDir });
    } else {
      deferredBuilders.set(i, cfg.builder);
      fluxNodes.push({ container: null, ip: cfg.ip, num: cfg.num, logCollector: cfg.logCollector, bootIdDir: cfg.bootIdDir });
    }
  }
  containers.fluxNodes = fluxNodes;

  for (const n of fluxNodes) {
    if (!n.container) {
      clients.push(null);
      continue;
    }
    const client = nodeClient(n.num);
    client.container = n.container;
    clients.push(client);
  }

  for (const client of clients) {
    if (client) await client.connectEventStream();
  }

  // Boot is NOT complete when the nodes answer HTTP: FluxOS still runs its
  // internal boot (mongo collection prep → daemon poll loop), and that is the
  // phase that actually crawls under fleet contention (both observed
  // daemon:polled gate failures — suites 22 and 01 — died there, post-HTTP).
  // Wait for each node's first daemon:polled here so the boot semaphore in
  // createTestEnv covers the whole boot, releasing only when the fleet is
  // operational. Exempt only nodes whose daemon RPC is deliberately broken at
  // creation (rpcFailures — they can never reach polling; their suites assert
  // the timeout path). Legacy nodes are NOT exempt: they run the same image
  // and emit daemon:polled (suite 21's waitForDaemonReady has always passed on
  // them) — an earlier exemption left all-legacy fleets booting outside the
  // lock and suite 21 failed on exactly the contention this wait prevents.
  const rpcFailSet = new Set(rpcFailures);
  await Promise.all(clients
    .filter((c) => c && !rpcFailSet.has(c.ip))
    .map((c) => c.waitForEvent('daemon:polled', () => true, 90000)));

  // Post-boot methods join the shell here (they close over _buildEnv locals like
  // deferredBuilders/fluxNodes); identity, registries and teardown live on the
  // shell itself so they exist from boot start.
  Object.assign(env, {
    // The height this run's chain started at. Suites wait on "a block ABOVE the
    // start has been processed" to know the node has caught up with the block they
    // just advanced to, and that only means anything against the height this env
    // actually used - a literal goes stale the moment the default moves, and goes
    // stale silently, because a predicate that is already true still passes.
    initialHeight,
    daemonControl: `http://${DAEMON_IP}:18232`,
    stubControl: `http://${EXTERNAL_STUB_IP}:3001`,
    fdmControl: `http://${FDM_IP}:16131`,
    syncthingControl: `http://${SYNCTHING_IP}:8385`,
    registryUrl: `https://${REGISTRY_IP}:5000`,
    mongoUrl: `mongodb://${MONGO_IP}:27017`,

    async startNode(index) {
      const builder = deferredBuilders.get(index);
      if (!builder) throw new Error(`No deferred builder for node index ${index}`);
      const container = await builder.start();
      started.push(container);
      fluxNodes[index].container = container;
      const client = nodeClient(fluxNodes[index].num);
      client.container = container;
      await client.connectEventStream();
      clients[index] = client;
      deferredBuilders.delete(index);
      return client;
    },

    // Wait on an HTTP poll of /flux/version rather than Docker's health state
    // machine: on restart Docker transiently reports "unhealthy" during monitor
    // teardown (moby/daemon/container/health.go CloseMonitorChannel), which a
    // health-coupled wait strategy would mistake for a dead container. This is
    // the same HttpPollWaitStrategy the initial fleet build uses.
    async restartNode(index, { timeout = 15000 } = {}) {
      if (clients[index]) clients[index].disconnectEventStream();
      const { container } = fluxNodes[index];
      const saved = container.waitStrategy;
      container.waitStrategy = nodeReadyWaitStrategy(fluxNodes[index].ip);
      try {
        await container.restart({ timeout });
      } finally {
        container.waitStrategy = saved;
      }
      if (clients[index]) await clients[index].connectEventStream();
      return clients[index];
    },

    setBootId(index, bootId) {
      writeFileSync(join(fluxNodes[index].bootIdDir, 'boot-id'), bootId);
    },

    async disconnectNode(index) {
      const rtClient = await getContainerRuntimeClient();
      const network = rtClient.container.dockerode.getNetwork(networkName);
      const containerId = fluxNodes[index].container.getId();
      await network.disconnect({ Container: containerId });
      if (clients[index]) clients[index].disconnectEventStream();
    },

    async reconnectNode(index) {
      const rtClient = await getContainerRuntimeClient();
      const network = rtClient.container.dockerode.getNetwork(networkName);
      const containerId = fluxNodes[index].container.getId();
      const nodeIp = fluxNodes[index].ip;
      await network.connect({
        Container: containerId,
        EndpointConfig: { IPAMConfig: { IPv4Address: nodeIp } },
      });
      if (clients[index]) await clients[index].connectEventStream();
    },

    // Split the fleet into two groups that stay internally connected but cannot reach
    // each other, by dropping cross-group node-to-node packets inside each container
    // (iptables; the image ships it and the nodes run privileged). Every node keeps its
    // path to the daemon and to its same-group peers. A node held in the minority
    // therefore stays daemon-confirmed (message capability intact) and above the peer
    // floor, so it never degrades or resyncs. The host runner reaches nodes over the
    // gateway, not a node IP, so its REST/SSE access to BOTH sides is unaffected — the
    // minority is observable throughout.
    //
    // Returns only once the partition is REAL, which is a stronger guarantee than the
    // rules alone give. iptables stops packets, but TCP retransmits across a DROP: the
    // cross-group sockets stay up until ping/pong liveness gives up, and until then a
    // message sent to the other group is QUEUED, not lost — healPartition then delivers
    // the whole backlog, so a suite whose premise is "this node missed the gossip" gets
    // the opposite of what it asked for, and finds out much later as an unrelated-looking
    // timeout.
    //
    // So wait for both sides to actually drop the other group from their peer lists, and
    // fail HERE, naming who is still connected. How long that takes is peer liveness —
    // peers.wsPingIntervalMs x peers.wsMaxMissedPongs — so a suite that partitions should
    // compress that interval in its configOverrides the same way it compresses every
    // other cadence. Pass { awaitSever: false } for a caller that only wants packets
    // dropped and is not asserting message loss.
    async partitionGroups(groupA, groupB, { awaitSever = true, severTimeoutMs = 60000 } = {}) {
      const ops = [];
      for (const a of groupA) {
        for (const b of groupB) {
          ops.push([a, fluxNodes[b].ip]);
          ops.push([b, fluxNodes[a].ip]);
        }
      }
      await Promise.all(ops.map(async ([node, otherIp]) => {
        const res = await fluxNodes[node].container.exec(['sh', '-c', `iptables -I INPUT -s ${otherIp} -j DROP`]);
        if (res.exitCode !== 0) {
          throw new Error(`partitionGroups: drop on node ${node} for ${otherIp} failed (exit ${res.exitCode}): ${res.output}`);
        }
      }));
      if (!awaitSever) return;

      // Each node paired with the cross-group IPs that must disappear from its peers.
      const crossGroup = [
        ...groupA.map((a) => [a, groupB.map((b) => fluxNodes[b].ip)]),
        ...groupB.map((b) => [b, groupA.map((a) => fluxNodes[a].ip)]),
      ];
      const stillConnected = async () => {
        const held = await Promise.all(crossGroup.map(async ([node, ips]) => {
          const client = clients[node];
          if (!client) return [];
          const [outbound, inbound] = await Promise.all([client.getPeers(), client.getIncomingPeers()]);
          const peers = new Set([...(outbound.data || []), ...(inbound.data || [])]);
          return ips.filter((ip) => peers.has(ip)).map((ip) => `node ${node} -> ${ip}`);
        }));
        return held.flat();
      };

      let remaining = await stillConnected();
      const deadline = Date.now() + severTimeoutMs;
      while (remaining.length > 0 && Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 1000); });
        // eslint-disable-next-line no-await-in-loop
        remaining = await stillConnected();
      }
      if (remaining.length > 0) {
        throw new Error(
          `partitionGroups: sockets survived the partition after ${severTimeoutMs}ms (${remaining.join(', ')}). `
          + 'Messages sent now would be queued and delivered on heal, not lost. Compress '
          + 'peers.wsPingIntervalMs in the suite configOverrides, or raise severTimeoutMs.',
        );
      }
    },

    // Remove the cross-group drops added by partitionGroups(groupA, groupB). Per-rule
    // best-effort (a rule already gone is not an error); the caller re-runs discovery so
    // the dead cross-group sockets get re-dialed.
    async healPartition(groupA, groupB) {
      const ops = [];
      for (const a of groupA) {
        for (const b of groupB) {
          ops.push([a, fluxNodes[b].ip]);
          ops.push([b, fluxNodes[a].ip]);
        }
      }
      await Promise.all(ops.map(([node, otherIp]) => fluxNodes[node].container.exec(
        ['sh', '-c', `iptables -D INPUT -s ${otherIp} -j DROP || true`],
      )));
    },

    async startDiscovery(indices = null) {
      const teamKey = fluxTeamKey();
      const targets = indices
        ? indices.map((i) => clients[i]).filter(Boolean)
        : clients.filter(Boolean);
      await Promise.all(targets.map(async (client) => {
        // Authenticating here races the node's own availability check. Boot
        // readiness proved the node could serve a login phrase, but the periodic
        // outside-communication check can flip it unavailable while the mesh is
        // still forming - and forming the mesh is exactly what this call exists
        // to do, so that refusal is transient by construction. Wait it out here,
        // bounded; authenticate() itself stays one-shot so a suite asserting a
        // node is genuinely unavailable still sees the refusal.
        const deadline = Date.now() + 120000;
        let auth;
        for (;;) {
          try {
            // eslint-disable-next-line no-await-in-loop
            auth = await authenticate(client.url, teamKey);
            break;
          } catch (error) {
            if (!error.message.includes('not available for outside communication')
              || Date.now() >= deadline) throw error;
            // eslint-disable-next-line no-await-in-loop
            await sleepUnlessInfraDead(2000);
          }
        }
        // kept on the client: endpoints that answer a paying user's question
        // ask for a Flux ID, and every suite that reaches one has already come
        // through here
        client.zelidauth = auth.zelidauth;
        await client.getAuthed('/flux/startdiscovery', auth.zelidauth);
      }));
    },

    nodeHasLog(index, pattern) {
      return fluxNodes[index].logCollector.hasLine(pattern);
    },

    nodeLogCount(index, pattern) {
      return fluxNodes[index].logCollector.countPattern(pattern);
    },

    nodeLogLines(index) {
      return fluxNodes[index].logCollector.getLines();
    },
  });
}
