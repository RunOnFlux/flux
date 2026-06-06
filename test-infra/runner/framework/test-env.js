// Node.js v17+ resolves localhost to ::1 (IPv6) but Docker binds ports to 0.0.0.0 (IPv4).
// Without this, testcontainers can't connect to the Ryuk reaper and cleanup never runs.
// See: https://github.com/testcontainers/testcontainers-node/issues/772
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= '127.0.0.1';
process.env.TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT ??= '5s';

import { GenericContainer, Network, Wait, getContainerRuntimeClient } from 'testcontainers';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { nodeClient } from './node-client.js';
import { closeDb } from './db-client.js';
import { stubPeerClient } from './stub-peer-helper.js';
import { MongoClient } from 'mongodb';
import { authenticate } from '../auth.js';
import { fluxTeamKey, nodeKey } from './keys.js';

function createLogCollector() {
  const lines = [];

  function consumer(stream) {
    stream.on('data', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed) lines.push(trimmed);
      }
    });
    stream.on('end', () => lines.push('[LOG_STREAM_ENDED]'));
    stream.on('error', (err) => lines.push(`[LOG_STREAM_ERROR: ${err.message}]`));
    stream.on('close', () => lines.push('[LOG_STREAM_CLOSED]'));
  }

  consumer.hasLine = (pattern) => {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    return lines.some((line) => regex.test(line));
  };

  consumer.countPattern = (pattern) => {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
    return lines.filter((line) => regex.test(line)).length;
  };

  consumer.getLines = () => [...lines];

  return consumer;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', 'fixtures');
const manifest = JSON.parse(readFileSync(join(fixturesDir, 'node-manifest.json'), 'utf-8'));

const SUBNET = '198.18.0.0/16';
const GATEWAY = '198.18.0.1';
const MONGO_IP = '198.18.0.2';
const DAEMON_IP = '198.18.0.3';
const SYNCTHING_IP = '198.18.0.4';
const REGISTRY_IP = '198.18.0.5';
const EXTERNAL_STUB_IP = '198.18.0.6';
const FDM_IP = '198.18.0.7';
const INITIAL_HEIGHT = 2100000;

// masterSlaveApps resolves the FDM by hostname (getMasterIpFromFdm tries EU/USA/ASIA
// regions, server index from getFdmIndex by the app name's first letter). Map every
// reachable FDM hostname to the stub so any app name lands on it — otherwise the
// node resolves the real fdm-*.runonflux.io over the internet. Returns testcontainers
// ExtraHost objects for the built-in .withExtraHosts().
function fdmExtraHosts(ip) {
  const hosts = [];
  for (let i = 1; i <= 4; i++) {
    hosts.push({ host: `fdm-fn-1-${i}.runonflux.io`, ipAddress: ip });
    hosts.push({ host: `fdm-usa-1-${i}.runonflux.io`, ipAddress: ip });
    hosts.push({ host: `fdm-sg-1-${i}.runonflux.io`, ipAddress: ip });
  }
  return hosts;
}

class StaticIpContainer extends GenericContainer {
  #staticIp;
  #networkName;

  withStaticIp(networkName, ip) {
    this.#staticIp = ip;
    this.#networkName = networkName;
    return this;
  }

  async beforeContainerCreated() {
    if (this.#staticIp && this.#networkName) {
      this.createOpts.NetworkingConfig = {
        EndpointsConfig: {
          [this.#networkName]: {
            IPAMConfig: { IPv4Address: this.#staticIp },
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
    Labels: { 'org.testcontainers.session-id': reaper.sessionId },
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
              ip: `198.18.${i}.0`,
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

export async function createTestEnv({ nodes = 1, deferredNodes = 0, legacyNodes = [], stubPeers = [], configOverrides = null, nodeConfigOverrides = {}, nodeTiers = null, dataCenter = true, tickerAutostart = false, discoveryAutostart = false, nodeStatusOverrides = {}, rpcFailures = [], bootContext = 'running' } = {}) {
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
    .withWaitStrategy(Wait.forHealthCheck())
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
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:18232/state', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 2000,
      retries: 10,
    })
    .start();
  started.push(daemonStub);
  containers.daemonStub = daemonStub;

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
      const ip = `198.18.${Number(index) + 1}.0`;
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
    .withWaitStrategy(Wait.forHealthCheck())
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
    .withWaitStrategy(Wait.forHealthCheck())
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
    .withStaticIp(networkName, FDM_IP)
    .withEnvironment({ FDM_PORT: '16130', CONTROL_PORT: '16131' })
    .withWaitStrategy(Wait.forHealthCheck())
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
      await fetch(`http://${EXTERNAL_STUB_IP}:3001/geolocation/198.18.${i}.0`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosting: false }),
      });
    }
  }

  const registryTlsDir = join(fixturesDir, 'registry-tls');
  const registry = await new StaticIpContainer('registry:2')
    .withStaticIp(networkName, REGISTRY_IP)
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
      Labels: { 'org.testcontainers.session-id': reaper.sessionId },
    });
    volumeNames.push(volName);
  }

  const deferredBuilders = new Map();
  const firstDeferred = nodes - deferredNodes;
  const nodeConfigs = [];

  for (let i = 0; i < nodes; i++) {
    if (stubPeerSet.has(i)) continue;

    const num = String(i + 1).padStart(2, '0');
    const nodeIp = `198.18.${i + 1}.0`;
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
    const nodeConfig = mergeConfigs(configOverrides, nodeConfigOverrides[i]);
    if (nodeConfig) nodeEnv.NODE_CONFIG = JSON.stringify(nodeConfig);

    const builder = new StaticIpContainer('flux-e2e-fluxos-01')
      .withPrivilegedMode()
      .withStaticIp(networkName, nodeIp)
      .withExtraHosts(fdmExtraHosts(FDM_IP))
      .withBindMounts(bindMounts)
      .withLogConsumer(logCollector)
      .withEnvironment(nodeEnv)
      .withWaitStrategy(Wait.forHealthCheck())
      .withHealthCheck({
        test: ['CMD', '/usr/bin/curl', '-sf', 'http://localhost:16127/flux/version'],
        interval: 3000,
        timeout: 2000,
        retries: 30,
        startPeriod: 15000,
      });

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

  const stubPeerContainers = [];
  const stubPeerClientsMap = new Map();

  for (const stubIdx of stubPeers) {
    const nodeIp = `198.18.${stubIdx + 1}.0`;
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
      .withWaitStrategy(Wait.forHealthCheck())
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
      fluxNodes.push({ container: null, ip: `198.18.${i + 1}.0`, num: i + 1, logCollector: null, bootIdDir: null });
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

    // Docker's CloseMonitorChannel (moby/daemon/container/health.go:80) sets
    // status to "unhealthy" during monitor teardown. On restart, there's a
    // race between this and the reset to "starting" (different locks), so
    // HealthCheckWaitStrategy can see a transient "unhealthy" and destroy
    // the container. We swap in an HTTP-polling wait strategy for restarts
    // to bypass Docker's health state machine entirely.
    async restartNode(index, { timeout = 15000 } = {}) {
      if (clients[index]) clients[index].disconnectEventStream();
      const container = fluxNodes[index].container;
      const saved = container.waitStrategy;
      const nodeUrl = `http://${fluxNodes[index].ip}:16127/flux/version`;
      container.waitStrategy = {
        waitUntilReady: async () => {
          const deadline = Date.now() + 120000;
          while (Date.now() < deadline) {
            try {
              const res = await fetch(nodeUrl, { signal: AbortSignal.timeout(2000) });
              if (res.ok) return;
            } catch {}
            await new Promise((r) => setTimeout(r, 500));
          }
          console.warn('restartNode: container not responding after 120s, continuing');
        },
      };
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
