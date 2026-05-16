// Node.js v17+ resolves localhost to ::1 (IPv6) but Docker binds ports to 0.0.0.0 (IPv4).
// Without this, testcontainers can't connect to the Ryuk reaper and cleanup never runs.
// See: https://github.com/testcontainers/testcontainers-node/issues/772
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= '127.0.0.1';
process.env.TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT ??= '5s';

import { GenericContainer, Network, Wait, getContainerRuntimeClient } from 'testcontainers';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { nodeClient } from './node-client.js';
import { closeDb } from './db-client.js';
import { MongoClient } from 'mongodb';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from './keys.js';

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
const GITHUB_STUB_IP = '198.18.0.6';
const INITIAL_HEIGHT = 2100000;

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

async function seedMongo(mongoIp, nodeCount, bootContext = 'running') {
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
              org: 'Test Network', static: true, dataCenter: true,
            },
            staticIp: true, dataCenter: true,
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

export async function createTestEnv({ nodes = 1, deferredNodes = 0, tickerAutostart = false, discoveryAutostart = false, nodeStatusOverrides = {}, rpcFailures = [], bootContext = 'running' } = {}) {
  const networkName = await createNetwork();
  const containers = {};
  const started = [];

  try {
    return await _buildEnv(networkName, containers, started, nodes, deferredNodes, tickerAutostart, discoveryAutostart, nodeStatusOverrides, rpcFailures, bootContext);
  } catch (err) {
    for (const c of started.reverse()) {
      await c.stop().catch(() => {});
    }
    await removeNetwork(networkName);
    throw err;
  }
}

async function _buildEnv(networkName, containers, started, nodes, deferredNodes, tickerAutostart, discoveryAutostart, nodeStatusOverrides, rpcFailures, bootContext) {

  const mongo = await new StaticIpContainer('mongo:8')
    .withCommand(['--wiredTigerCacheSizeGB', '1', '--setParameter', 'maxNumActiveUserIndexBuilds=64'])
    .withStaticIp(networkName, MONGO_IP)
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
      interval: 3000,
      timeout: 5000,
      retries: 10,
    })
    .start();
  started.push(mongo);
  containers.mongo = mongo;

  await seedMongo(MONGO_IP, nodes, bootContext);

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
      timeout: 5000,
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

  const syncthingStub = await new StaticIpContainer('flux-e2e-syncthing-stub')
    .withStaticIp(networkName, SYNCTHING_IP)
    .withEnvironment({ SYNCTHING_PORT: '8384', CONTROL_PORT: '8385' })
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:8384/rest/noauth/health', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 5000,
      retries: 10,
    })
    .start();
  started.push(syncthingStub);
  containers.syncthingStub = syncthingStub;

  const githubStub = await new StaticIpContainer('flux-e2e-github-stub')
    .withStaticIp(networkName, GITHUB_STUB_IP)
    .withEnvironment({ GITHUB_STUB_PORT: '3000', CONTROL_PORT: '3001' })
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:3001/health', r => { r.on('data', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"],
      interval: 3000,
      timeout: 5000,
      retries: 10,
    })
    .start();
  started.push(githubStub);
  containers.githubStub = githubStub;

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
    const num = String(i + 1).padStart(2, '0');
    const nodeIp = `198.18.${i + 1}.0`;
    const nodeManifest = manifest.nodes[i];

    const logCollector = createLogCollector();
    const bindMounts = [
      { source: volumeNames[i], target: '/mnt/appdata' },
      { source: join(fixturesDir, 'registry-tls', 'ca.pem'), target: '/usr/local/share/ca-certificates/test-registry.crt', mode: 'ro' },
    ];
    const builder = new StaticIpContainer('flux-e2e-fluxos-01')
      .withPrivilegedMode()
      .withStaticIp(networkName, nodeIp)
      .withBindMounts(bindMounts)
      .withLogConsumer(logCollector)
      .withEnvironment({
        NODE_CONFIG_DIR: `/flux/test-infra/config/node-${num}`,
        FLUXOS_PATH: '/flux',
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
        FLUX_BOOT_ID: getBootId(i + 1),
        NODE_EXTRA_CA_CERTS: '/usr/local/share/ca-certificates/test-registry.crt',
        ...(discoveryAutostart ? { FLUX_DISCOVERY_AUTOSTART: 'true' } : {}),
      });

    nodeConfigs.push({ index: i, builder, ip: nodeIp, num: i + 1, logCollector });
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

  const fluxNodes = nodeConfigs.map((n) => {
    const s = startedByIndex.get(n.index);
    if (s) return { container: s.container, ip: n.ip, num: n.num, logCollector: n.logCollector };
    deferredBuilders.set(n.index, n.builder);
    return { container: null, ip: n.ip, num: n.num, logCollector: n.logCollector };
  });
  containers.fluxNodes = fluxNodes;

  const clients = fluxNodes.map((n) => (n.container ? nodeClient(n.num) : null));

  for (const client of clients) {
    if (client) await client.connectEventStream();
  }

  return {
    networkName,
    containers,
    clients,
    get nodeCount() { return clients.length; },
    get lastNodeIndex() { return clients.length - 1; },
    daemonControl: `http://${DAEMON_IP}:18232`,
    githubControl: `http://${GITHUB_STUB_IP}:3001`,
    registryUrl: `https://${REGISTRY_IP}:5000`,
    mongoUrl: `mongodb://${MONGO_IP}:27017`,

    async startNode(index) {
      const builder = deferredBuilders.get(index);
      if (!builder) throw new Error(`No deferred builder for node index ${index}`);
      const container = await builder.start();
      started.push(container);
      fluxNodes[index].container = container;
      const client = nodeClient(fluxNodes[index].num);
      await client.connectEventStream();
      clients[index] = client;
      deferredBuilders.delete(index);
      return client;
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

    async startDiscovery() {
      const teamKey = fluxTeamKey();
      await Promise.all(clients.map(async (client) => {
        if (!client) return;
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
      for (const client of clients) {
        if (client) client.disconnectEventStream();
      }
      for (const n of fluxNodes) {
        if (n.container) await n.container.stop().catch(() => {});
      }
      await syncthingStub.stop().catch(() => {});
      await githubStub.stop().catch(() => {});
      await registry.stop().catch(() => {});
      await daemonStub.stop().catch(() => {});
      await mongo.stop().catch(() => {});
      await closeDb();
      const cleanupClient = await getContainerRuntimeClient();
      for (const volName of volumeNames) {
        await cleanupClient.container.dockerode.getVolume(volName).remove().catch(() => {});
      }
      await removeNetwork(networkName);
      http.globalAgent.destroy();
    },
  };
}
