import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, signBtcMessage } from '../auth.js';
import { appOwnerKey } from './keys.js';
import * as daemon from './daemon-control.js';
import { waitFor } from './wait.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultSpec = {
  version: 8,
  name: 'e2eTestApp',
  description: 'E2E test application for lifecycle testing',
  owner: null,
  compose: [
    {
      name: 'e2eTestApp',
      description: 'nginx test container',
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
    },
  ],
  instances: 3,
  contacts: [],
  geolocation: [],
  expire: 22000,
  nodes: [],
  staticip: false,
  enterprise: '',
};

export function buildAppSpec(overrides = {}) {
  const ownerKey = appOwnerKey();
  const spec = { ...defaultSpec, owner: ownerKey.zelid, ...overrides };
  if (overrides.compose) {
    spec.compose = overrides.compose;
  }
  return spec;
}

export async function signAppSpec(spec, type = 'fluxappregister') {
  const ownerKey = appOwnerKey();
  const timestamp = Date.now();
  const version = 1;
  const payload = type + version + JSON.stringify(spec) + timestamp;
  const signature = await signBtcMessage(payload, ownerKey.privkey);
  return { type, version, appSpecification: spec, timestamp, signature };
}

export async function registerApp(nodeUrl, adminKeypair, spec, type = 'fluxappregister') {
  const auth = await authenticate(nodeUrl, adminKeypair);
  const signed = await signAppSpec(spec, type);

  const res = await fetch(`${nodeUrl}/apps/appregister`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', zelidauth: auth.zelidauth },
    body: JSON.stringify(signed),
  });
  const data = await res.json();
  return { ...data, auth };
}

export async function registerAndConfirm(nodeUrl, adminKeypair, spec, nodes, {
  type = 'fluxappregister',
  propagationWaitMs = 15000,
  explorerTimeoutMs = 120000,
} = {}) {
  const regResult = await registerApp(nodeUrl, adminKeypair, spec, type);
  if (regResult.status !== 'success') return regResult;

  const appHash = regResult.data;

  if (propagationWaitMs > 0) {
    await new Promise((r) => setTimeout(r, propagationWaitMs));
  }

  let tempCount = 0;
  for (const node of nodes) {
    try {
      const res = await node.getTempMessages(appHash);
      if (res.status === 'success' && res.data?.length > 0) tempCount++;
    } catch { /* */ }
  }

  const queueResult = await daemon.queueAppTx(appHash);
  const targetHeight = queueResult.nextBlockHeight + 2;

  await waitFor(async () => {
    const state = await daemon.getState();
    return state.currentHeight >= targetHeight;
  }, { timeout: explorerTimeoutMs, interval: 2000, label: `daemon height >= ${targetHeight}` });

  await waitFor(async () => {
    const res = await nodes[0].isExplorerSynced();
    return res.status === 'success' && res.data === true;
  }, { timeout: explorerTimeoutMs, interval: 2000, label: 'explorer synced after block' });

  return {
    status: 'success',
    appHash,
    tempPropagation: { count: tempCount, total: nodes.length },
    targetHeight,
  };
}

export async function checkPermanentSpec(nodes, appName) {
  let count = 0;
  for (const node of nodes) {
    try {
      const res = await node.getAppSpecs(appName);
      if (res.status === 'success' && res.data) count++;
    } catch { /* */ }
  }
  return { count, total: nodes.length };
}
