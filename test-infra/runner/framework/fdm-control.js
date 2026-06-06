// Drives the FDM stub (test-infra/fdm-stub) that masterSlaveApps polls for the
// elected g: primary. Default host matches test-env's FDM_IP/control port.
const CONTROL = process.env.FDM_CONTROL || 'http://198.18.0.7:16131';

async function post(path, body) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${CONTROL}${path}`);
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
