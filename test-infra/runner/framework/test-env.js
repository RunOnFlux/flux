import { GenericContainer, Network, Wait, getContainerRuntimeClient } from 'testcontainers';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeClient } from './node-client.js';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', 'fixtures');
const manifest = JSON.parse(readFileSync(join(fixturesDir, 'node-manifest.json'), 'utf-8'));

const SUBNET = '198.18.0.0/16';
const GATEWAY = '198.18.0.1';
const MONGO_IP = '198.18.0.2';
const DAEMON_IP = '198.18.0.3';
const SYNCTHING_IP = '198.18.0.4';
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
  const networkName = `flux-test-${Date.now()}`;
  await client.container.dockerode.createNetwork({
    Name: networkName,
    Driver: 'bridge',
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

async function seedMongo(mongoIp, nodeCount) {
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
    }
  } finally {
    await client.close();
  }
}

export async function createTestEnv({ nodes = 1, tickerAutostart = false } = {}) {
  const networkName = await createNetwork();
  const containers = {};

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
  containers.mongo = mongo;

  await seedMongo(MONGO_IP, nodes);

  const daemonStub = await new StaticIpContainer('flux-e2e-daemon-stub')
    .withStaticIp(networkName, DAEMON_IP)
    .withEnvironment({
      FLUXD_PORT: '16124',
      BENCHD_PORT: '16224',
      CONTROL_PORT: '18232',
      TICKER_AUTOSTART: tickerAutostart ? 'true' : 'false',
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
  containers.daemonStub = daemonStub;

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
  containers.syncthingStub = syncthingStub;

  const fluxNodes = [];
  for (let i = 0; i < nodes; i++) {
    const num = String(i + 1).padStart(2, '0');
    const nodeIp = `198.18.${i + 1}.0`;
    const nodeManifest = manifest.nodes[i];

    const fluxNode = await new StaticIpContainer('flux-e2e-fluxos-01')
      .withPrivilegedMode()
      .withStaticIp(networkName, nodeIp)
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
      })
      .start();

    fluxNodes.push({ container: fluxNode, ip: nodeIp, num: i + 1 });
  }
  containers.fluxNodes = fluxNodes;

  const clients = fluxNodes.map((n) => nodeClient(n.num));

  return {
    networkName,
    containers,
    clients,
    daemonControl: `http://${DAEMON_IP}:18232`,
    mongoUrl: `mongodb://${MONGO_IP}:27017`,

    async teardown() {
      for (const n of fluxNodes) {
        await n.container.stop().catch(() => {});
      }
      await syncthingStub.stop().catch(() => {});
      await daemonStub.stop().catch(() => {});
      await mongo.stop().catch(() => {});
      await removeNetwork(networkName);
    },
  };
}
