// Drives the FDM stub (test-infra/fdm-stub) that masterSlaveApps polls for the
// elected g: primary. Default host matches test-env's FDM_IP/control port.
import { getSubnetConfig } from './subnet-config.js';
import { controlFetch } from './control-fetch.js';

const CONTROL = process.env.FDM_CONTROL || `http://${getSubnetConfig().fdm}:16131`;

async function post(path, body) {
  const res = await controlFetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function get(path) {
  const res = await controlFetch(`${CONTROL}${path}`);
  return res.json();
}

// Elect (or fail over) the primary for an app. ip is a bare node IP (the value
// FDM returns through /appips); masterSlaveApps compares it with ipsMatch.
export async function electMaster(appName, ip) {
  return post(`/appips/${appName}`, { ip });
}

// No primary for the app -> every node is a standby and waits.
export async function clearMaster(appName) {
  return post(`/clear/${appName}`);
}

export async function resetFdm() {
  return post('/reset');
}

export async function getFdmState() {
  return get('/state');
}

// Stop FDM answering, which is the only way to reach the node's third state:
// not "no primary yet" (clearMaster, above - that is FDM answering) but "FDM
// gave no verdict at all", which the election stands down on rather than acting
// on evidence it does not have.
//   'refuse'      close the socket - the node's poll gets ECONNREFUSED, the
//                 production outage signature
//   'unavailable' 503 - reachable, but reporting itself as still starting up
export async function startFdmOutage(mode = 'refuse') {
  return post('/outage', { mode });
}

export async function endFdmOutage() {
  return post('/recover');
}
