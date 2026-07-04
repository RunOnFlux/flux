import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, signBtcMessage } from '../auth.js';
import { appOwnerKey } from './keys.js';
import { buildEnterpriseBlob } from './enterprise-helper.js';
import { REGISTRY_REPO_HOST } from './subnet-config.js';
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
      description: 'default pause test container',
      // the harness registry, NEVER a bare Docker Hub reference: registration
      // verifies the repotag against the registry it names, and a hub repotag
      // makes the suite depend on live internet + hub rate limits (429s broke
      // suites 07/08/09 in the 2026-07-02 gate). The env registry is seeded
      // with this image at bootstrap (test-env.js).
      repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
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

// Every repotag must name the harness registry: anything else is verified or
// pulled over live internet, silently coupling the suite to Docker Hub uptime
// and rate limits (429s failed suites 07/08/09 in the 2026-07-02 gate). A test
// that deliberately needs an external/unreachable repotag opts out explicitly.
export function assertHermeticRepotags(spec, allowExternalRepotag) {
  if (allowExternalRepotag) return;
  for (const comp of spec.compose || []) {
    if (comp.repotag && !comp.repotag.startsWith(`${REGISTRY_REPO_HOST}/`)) {
      throw new Error(`spec repotag leaves the harness: ${comp.repotag} - push to the env registry (${REGISTRY_REPO_HOST}/...) or pass allowExternalRepotag: true for an external-by-design test`);
    }
  }
}

export function buildAppSpec({ enterprise = false, allowExternalRepotag = false, ...overrides } = {}) {
  const ownerKey = appOwnerKey();
  const spec = { ...defaultSpec, owner: ownerKey.zelid, ...overrides };
  assertHermeticRepotags(spec, allowExternalRepotag);

  if (overrides.compose) {
    spec.compose = overrides.compose;
  }

  if (enterprise) {
    spec.enterprise = buildEnterpriseBlob(spec.compose, spec.contacts);
    spec.compose = [];
    spec.contacts = [];
  }

  // specificationFormatter outputs datacenter before enterprise.
  // Since datacenter isn't in defaultSpec, the spread puts it after
  // enterprise. Reorder to match the formatter's field ordering so
  // JSON.stringify produces the same string for signature verification.
  if (spec.datacenter !== undefined) {
    const { enterprise: ent, datacenter, ...rest } = spec;
    return { ...rest, datacenter, enterprise: ent };
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
  propagationTimeoutMs = 30000,
  explorerTimeoutMs = 120000,
} = {}) {
  const regResult = await registerApp(nodeUrl, adminKeypair, spec, type);
  if (regResult.status !== 'success') return regResult;

  const appHash = regResult.data;

  let tempCount = 0;
  await waitFor(async () => {
    tempCount = 0;
    for (const node of nodes) {
      try {
        const res = await node.getTempMessages(appHash);
        if (res.status === 'success' && res.data?.length > 0) tempCount++;
      } catch { /* */ }
    }
    return tempCount === nodes.length;
  }, { timeout: propagationTimeoutMs, interval: 2000, label: `temp message propagation to ${nodes.length} nodes` });

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
