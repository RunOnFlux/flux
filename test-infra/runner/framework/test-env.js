// Node.js v17+ resolves localhost to ::1 (IPv6) but Docker binds ports to 0.0.0.0 (IPv4).
// Without this, testcontainers can't connect to the Ryuk reaper and cleanup never runs.
// See: https://github.com/testcontainers/testcontainers-node/issues/772
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= '127.0.0.1';
process.env.TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT ??= '5s';

import { GenericContainer, Network, Wait, getContainerRuntimeClient } from 'testcontainers';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { nodeClient } from './node-client.js';
import { HttpPollWaitStrategy } from './http-wait-strategy.js';
import { TcpPollWaitStrategy } from './tcp-wait-strategy.js';
import { getSubnetConfig, REGISTRY_ALIAS, REGISTRY_REPO_HOST } from './subnet-config.js';
import { closeDb } from './db-client.js';
import { stubPeerClient } from './stub-peer-helper.js';
import { MongoClient } from 'mongodb';
import { authenticate } from '../auth.js';
import { fluxTeamKey, nodeKey } from './keys.js';

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

// Persist per-node boot logs when fleet startup fails (a container never goes
// healthy). createTestEnv throws before `env` exists, so the normal failure dump
// can't reach these — without this, a boot flake is undiagnosable.
function dumpBootFailureLogs(nodeConfigs) {
  try {
    const dir = join(process.cwd(), 'test-logs', 'boot-failure');
    mkdirSync(dir, { recursive: true });
    for (const n of nodeConfigs) {
      const lines = n.logCollector?.getLines?.() || [];
      const file = join(dir, `node-${String(n.index).padStart(2, '0')}.log`);
      writeFileSync(file, `=== node ${n.index} (ip ${n.ip}) — ${lines.length} captured boot lines ===\n${lines.join('\n')}\n`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n--- boot-failure: per-node boot logs written to ${dir} ---`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`dumpBootFailureLogs failed: ${err.message}`);
  }
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
const INITIAL_HEIGHT = 2100000;

// Per-run-all label. run-all.sh exports E2E_RUN_LABEL (unique per invocation) and
// scopes its between-suite cleanup to it, so concurrent run-all invocations only
// ever remove their OWN docker objects — never another live run's fleet. Applied
// to every container, network and volume this run creates. Empty when a suite is
// run standalone (no run-all), in which case the cleanup never fires anyway.
const RUN_LABEL = process.env.E2E_RUN_LABEL || '';
const runLabels = () => (RUN_LABEL ? { 'flux-e2e-run': RUN_LABEL } : {});

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

function getBootId(nodeNum) {
  return `test-boot-id-node-${String(nodeNum).padStart(2, '0')}`;
}

async function seedMongo(mongoIp, nodeCount, bootContext = 'running', { dataCenter = true } = {}) {
  const client = new MongoClient(`mongodb://${mongoIp}:27017`);
  try {
    await client.connect();
    for (let i = 1; i <= nodeCount; i++) {
      const num = String(i).padStart(2, '0');
      const explorerDb = client.db(`node${num}_zelcashdata`);
      await explorerDb.collection('scannedheight').updateOne(
        {},
        { $set: { generalScannedHeight: INITIAL_HEIGHT } },
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
        await localDb.collection('nodestartuptracker').updateOne(
          { _id: 'heartbeat' },
          { $set: {
            lastAlive: bootContext.lastAlive ?? Date.now(),
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

// ---- host-wide boot semaphore ----
// Fleet boot is the only CPU-heavy phase a suite has: every node in the fleet
// starts its own dockerd and runs FluxOS DB prep at once. When two suites' boots
// overlap under run-parallel.sh, they starve each other and a healthy node can
// blow its event-wait budget while merely slow (observed in the 42-suite gate:
// suite 22's second fleet booted at load ~15 on 16 cores and mongo collection
// prep crawled at 7-17s a step). Running fleets are cheap, so serialise just the
// boot phase host-wide and let everything else overlap. The claim protocol
// mirrors the subnet claim in run-all.sh: an atomic mkdir holding the owner pid,
// reclaimable by any waiter once the owner process is dead.
const BOOT_LOCK_DIR = process.env.E2E_BOOT_LOCK_DIR ?? join(tmpdir(), 'e2e-boot-lock');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function acquireBootLock() {
  for (;;) {
    try {
      mkdirSync(BOOT_LOCK_DIR);
      writeFileSync(join(BOOT_LOCK_DIR, 'pid'), String(process.pid));
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let owner = 0;
    try {
      owner = Number(readFileSync(join(BOOT_LOCK_DIR, 'pid'), 'utf-8'));
    } catch {
      // claimer is between mkdir and pid write — treat as live and wait
    }
    if (owner) {
      try {
        process.kill(owner, 0);
      } catch {
        // owner is dead — reclaim; if a sibling reclaims first, the next
        // mkdir attempt just loses the race and waits
        rmSync(BOOT_LOCK_DIR, { recursive: true, force: true });
        continue;
      }
    }
    await sleep(1000);
  }
}

function releaseBootLock() {
  try {
    const owner = Number(readFileSync(join(BOOT_LOCK_DIR, 'pid'), 'utf-8'));
    if (owner === process.pid) rmSync(BOOT_LOCK_DIR, { recursive: true, force: true });
  } catch {
    // already released or reclaimed
  }
}

export async function createTestEnv({ hookCtx = null, nodes = 1, deferredNodes = 0, legacyNodes = [], stubPeers = [], configOverrides = null, nodeConfigOverrides = {}, nodeTiers = null, dataCenter = true, tickerAutostart = false, discoveryAutostart = false, nodeStatusOverrides = {}, rpcFailures = [], bootContext = 'running' } = {}) {
  await acquireBootLock();
  // The queue wait above must not count against the suite's hook budget. Mocha
  // re-arms a running hook's watchdog from "now" when timeout() is set, so
  // restart it with the suite's own declared value at the moment boot begins.
  if (hookCtx && typeof hookCtx.timeout === 'function') hookCtx.timeout(hookCtx.timeout());
  const networkName = await createNetwork();
  const containers = {};
  const started = [];

  try {
    return await _buildEnv(networkName, containers, started, nodes, deferredNodes, legacyNodes, stubPeers, configOverrides, nodeConfigOverrides, nodeTiers, dataCenter, tickerAutostart, discoveryAutostart, nodeStatusOverrides, rpcFailures, bootContext);
  } catch (err) {
    for (const c of started.reverse()) {
      await c.stop().catch(() => {});
    }
    await removeNetwork(networkName);
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

async function _buildEnv(networkName, containers, started, nodes, deferredNodes, legacyNodes, stubPeers, configOverrides, nodeConfigOverrides, nodeTiers, dataCenter, tickerAutostart, discoveryAutostart, nodeStatusOverrides, rpcFailures, bootContext) {
  const stubPeerSet = new Set(stubPeers);

  // Health check timeout must be < interval — Docker's health state machine
  // produces spurious "unhealthy" on container restart when timeout >= interval.
  const mongo = await new StaticIpContainer('mongo:8')
    .withCommand(['--wiredTigerCacheSizeGB', '1', '--setParameter', 'maxNumActiveUserIndexBuilds=64', '--setParameter', 'enableTestCommands=1'])
    .withStaticIp(networkName, MONGO_IP)
    .withWaitStrategy(new TcpPollWaitStrategy(MONGO_IP, 27017))
    .withHealthCheck({
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
      interval: 3000,
      timeout: 2000,
      retries: 10,
    })
    .start();
  started.push(mongo);
  containers.mongo = mongo;

  await seedMongo(MONGO_IP, nodes, bootContext, { dataCenter });

  const daemonStub = await new StaticIpContainer('flux-e2e-daemon-stub')
    .withStaticIp(networkName, DAEMON_IP)
    .withEnvironment({
      FLUX_TEST_HARNESS: 'true',
      FLUXD_PORT: '16124',
      BENCHD_PORT: '16224',
      CONTROL_PORT: '18232',
      TICKER_AUTOSTART: tickerAutostart ? 'true' : 'false',
      NODE_COUNT: String(nodes),
    })
    .withBindMounts([{
      source: fixturesDir,
      target: '/fixtures',
      mode: 'ro',
    }])
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${DAEMON_IP}:18232/state`))
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:18232/state', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 2000,
      retries: 10,
    })
    .start();
  started.push(daemonStub);
  containers.daemonStub = daemonStub;

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

  const syncthingStub = await new StaticIpContainer('flux-e2e-syncthing-stub')
    .withStaticIp(networkName, SYNCTHING_IP)
    .withEnvironment({ SYNCTHING_PORT: '8384', CONTROL_PORT: '8385' })
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${SYNCTHING_IP}:8384/rest/noauth/health`))
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:8384/rest/noauth/health', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 2000,
      retries: 10,
    })
    .start();
  started.push(syncthingStub);
  containers.syncthingStub = syncthingStub;

  const externalStub = await new StaticIpContainer('flux-e2e-external-http-stub')
    .withStaticIp(networkName, EXTERNAL_STUB_IP)
    .withEnvironment({ STUB_PORT: '3000', CONTROL_PORT: '3001' })
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${EXTERNAL_STUB_IP}:3001/health`))
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:3001/health', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 2000,
      retries: 10,
    })
    .start();
  started.push(externalStub);
  containers.externalStub = externalStub;

  const fdmStub = await new StaticIpContainer('flux-e2e-fdm-stub')
    .withStaticIp(networkName, FDM_IP, fdmHostnames())
    .withEnvironment({ FDM_PORT: '16130', CONTROL_PORT: '16131' })
    .withWaitStrategy(new HttpPollWaitStrategy(`http://${FDM_IP}:16131/health`))
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:16131/health', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 2000,
      retries: 10,
    })
    .start();
  started.push(fdmStub);
  containers.fdmStub = fdmStub;

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

  const rtClient = await getContainerRuntimeClient();
  const { getReaper: getReaperFn } = await import('testcontainers');
  const reaper = await getReaperFn(rtClient);
  const volumeNames = [];
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
  const nodeConfigs = [];

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
    };
    const nodeConfig = mergeConfigs(infraOverride, mergeConfigs(configOverrides, nodeConfigOverrides[i]));
    nodeEnv.NODE_CONFIG = JSON.stringify(nodeConfig);

    // Wait on an HTTP poll of the node's own /flux/version, not Docker's health
    // state machine: under a contended 10-node fleet boot, Wait.forHealthCheck()
    // tears the fleet down on a transient "unhealthy" even when FluxOS is up. See
    // http-wait-strategy.js for the full rationale.
    const builder = new StaticIpContainer('flux-e2e-fluxos-01')
      .withPrivilegedMode()
      .withStaticIp(networkName, nodeIp)
      .withExtraHosts(fdmExtraHosts(FDM_IP))
      .withBindMounts(bindMounts)
      .withLogConsumer(logCollector)
      .withEnvironment(nodeEnv)
      .withWaitStrategy(new HttpPollWaitStrategy(`http://${nodeIp}:16127/flux/version`).withStartupTimeout(120000));

    nodeConfigs.push({ index: i, builder, ip: nodeIp, num: i + 1, logCollector, bootIdDir });
  }

  const startPromises = nodeConfigs
    .filter((n) => n.index < firstDeferred)
    .map(async (n) => {
      const container = await n.builder.start();
      started.push(container);
      return { ...n, container };
    });

  let startedNodes;
  try {
    startedNodes = await Promise.all(startPromises);
  } catch (err) {
    // A boot/health-check failure throws here, before `env` is returned, so the
    // normal per-node failure dump can't run and the boot logs would be lost.
    // The log consumer streams container output before health passes, so persist
    // whatever each node captured for diagnosis, then re-throw.
    dumpBootFailureLogs(nodeConfigs);
    throw err;
  }
  const startedByIndex = new Map(startedNodes.map((n) => [n.index, n]));

  const stubPeerContainers = [];
  const stubPeerClientsMap = new Map();

  for (const stubIdx of stubPeers) {
    const nodeIp = subnet.nodeIp(stubIdx + 1);
    const key = nodeKey(stubIdx + 1);

    const stub = await new StaticIpContainer('flux-e2e-peer-stub')
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
      .withHealthCheck({
        test: ['CMD', 'node', '-e', "require('http').get('http://localhost:16128/health', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
        interval: 3000,
        timeout: 2000,
        retries: 10,
      })
      .start();
    started.push(stub);
    stubPeerContainers.push(stub);
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

  const clients = fluxNodes.map((n) => {
    if (!n.container) return null;
    const client = nodeClient(n.num);
    client.container = n.container;
    return client;
  });

  for (const client of clients) {
    if (client) await client.connectEventStream();
  }

  return {
    networkName,
    containers,
    clients,
    stubPeerClients: stubPeerClientsMap,
    get nodeCount() { return clients.length; },
    get lastNodeIndex() { return clients.length - 1; },
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
      const container = fluxNodes[index].container;
      const saved = container.waitStrategy;
      const nodeUrl = `http://${fluxNodes[index].ip}:16127/flux/version`;
      container.waitStrategy = new HttpPollWaitStrategy(nodeUrl);
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

    async startDiscovery(indices = null) {
      const teamKey = fluxTeamKey();
      const targets = indices
        ? indices.map((i) => clients[i]).filter(Boolean)
        : clients.filter(Boolean);
      await Promise.all(targets.map(async (client) => {
        const auth = await authenticate(client.url, teamKey);
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

    async teardown() {
      const warn = (label, err) => console.warn(`teardown [${networkName}] ${label}: ${err.message}`);
      for (const client of clients) {
        if (client) client.disconnectEventStream();
      }
      for (const n of fluxNodes) {
        if (n.container) await n.container.stop().catch((e) => warn('fluxNode stop', e));
      }
      for (const sc of stubPeerContainers) {
        await sc.stop().catch((e) => warn('stubPeer stop', e));
      }
      await syncthingStub.stop().catch((e) => warn('syncthing stop', e));
      await externalStub.stop().catch((e) => warn('external stop', e));
      await fdmStub.stop().catch((e) => warn('fdm stop', e));
      await registry.stop().catch((e) => warn('registry stop', e));
      await daemonStub.stop().catch((e) => warn('daemon stop', e));
      await mongo.stop().catch((e) => warn('mongo stop', e));
      await closeDb();
      const cleanupClient = await getContainerRuntimeClient();
      for (const volName of volumeNames) {
        await cleanupClient.container.dockerode.getVolume(volName).remove().catch((e) => warn(`volume ${volName}`, e));
      }
      await removeNetwork(networkName).catch((e) => warn('network remove', e));
      for (const n of fluxNodes) {
        if (!n.bootIdDir) continue;
        const { rmSync } = await import('node:fs');
        rmSync(n.bootIdDir, { recursive: true, force: true });
      }
      http.globalAgent.destroy();
    },
  };
}
