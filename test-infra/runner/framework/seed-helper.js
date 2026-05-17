import { createHash, randomBytes } from 'node:crypto';
import { signBtcMessage } from '../auth.js';
import { appOwnerKey } from './keys.js';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fakeTxid() {
  return randomBytes(32).toString('hex');
}

export async function buildSeedableApp({
  name,
  compose = null,
  height = 2100010,
  instances = 3,
  owner = null,
  staticip = false,
  enterprise = '',
}) {
  const ownerKey = appOwnerKey();
  const appOwner = owner ?? ownerKey.zelid;

  const spec = {
    version: 8,
    name,
    description: `Seeded test app ${name}`,
    owner: appOwner,
    compose: compose ?? [{
      name,
      description: 'seeded component',
      repotag: 'nginx:alpine',
      ports: [31111],
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
    instances,
    contacts: [],
    geolocation: [],
    expire: height + 22000,
    nodes: [],
    staticip,
    enterprise,
  };

  const type = 'fluxappregister';
  const version = 1;
  const timestamp = Date.now();
  const payload = type + version + JSON.stringify(spec) + timestamp;
  const signature = await signBtcMessage(payload, ownerKey.privkey);

  const messageContent = type + version + JSON.stringify(spec) + timestamp + signature;
  const hash = sha256(messageContent);
  const txid = fakeTxid();

  const permanentMessage = {
    type,
    version,
    appSpecifications: spec,
    hash,
    timestamp,
    signature,
    txid,
    height,
    valueSat: 200000000,
  };

  const hashEntry = {
    hash,
    txid,
    height,
    value: 200000000,
    message: true,
    messageNotFound: false,
    createdAt: new Date(),
  };

  const specWithMeta = { ...spec, hash, height };

  return { spec: specWithMeta, permanentMessage, hashEntry, hash, txid };
}

export function buildRunningState({ appName, nodeIps, hash, broadcastedAt = null }) {
  const ts = broadcastedAt ?? Date.now();

  const locations = nodeIps.map((ip) => ({
    name: appName,
    ip,
    hash,
    broadcastedAt: ts,
    runningSince: ts - 60000,
  }));

  const stateEvents = nodeIps.map((ip) => ({
    type: 'apprunning',
    ip,
    dedupKey: 'v2',
    broadcastedAt: new Date(ts),
    expireAt: new Date(ts + 125 * 60 * 1000),
    receivedAt: new Date(ts),
    data: {
      apps: [{ name: appName, hash, runningSince: ts - 60000 }],
      ip,
      broadcastedAt: ts,
    },
  }));

  return { locations, stateEvents };
}

export async function seedAppOnAllNodes(dbClients, { name, compose, height, instances } = {}) {
  const app = await buildSeedableApp({ name, compose, height, instances });

  const seedPromises = dbClients.map(async (dbc) => {
    await dbc.seedGlobalAppSpec(app.spec);
    await dbc.seedPermanentMessage(app.permanentMessage);
    await dbc.seedAppHash(app.hash, app.permanentMessage.height, true);
  });
  await Promise.all(seedPromises);

  return app;
}

export async function seedAppWithRunningState(dbClients, nodeIps, { name, compose, height, instances } = {}) {
  const app = await seedAppOnAllNodes(dbClients, { name, compose, height, instances });
  const state = buildRunningState({ appName: name, nodeIps, hash: app.hash });

  const seedPromises = dbClients.map(async (dbc, i) => {
    for (const loc of state.locations) {
      await dbc.seedAppLocation(loc);
    }
    for (const evt of state.stateEvents) {
      await dbc.seedAppStateEvent(evt);
    }
  });
  await Promise.all(seedPromises);

  return { ...app, locations: state.locations, stateEvents: state.stateEvents };
}
