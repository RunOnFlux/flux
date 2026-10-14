// Drives the FDM stub (test-infra/fdm-stub) that masterSlaveApps polls for the
// elected g: primary. Default host matches test-env's FDM_IP/control port.
import { getSubnetConfig } from './subnet-config.js';
import { controlFetch } from './control-fetch.js';
import { loadSharedConfig, PRODUCTION } from './coupled-knobs.js';

// FDM's own clock for a g: primary (fdm-master):
//   passMs         25s floor between pass starts   (domainService.js G_PASS_MIN_INTERVAL_MS)
//   graceMs        90s since last seen healthy     (domainService.js G_APP_UNHEALTHY_THRESHOLD_MS)
//   confirmations  3 consecutive failed checks     (domainService.js G_APP_MIN_CONFIRMATIONS)
//   cacheMs        20s /appips response cache       (routes.js)
// A primary is released only once BOTH the grace has passed and the checks have
// failed that many times.
export const FDM_PRODUCTION = Object.freeze({
  passMs: 25000,
  graceMs: 90000,
  confirmations: 3,
  cacheMs: 20000,
});

// Bounded by what a loaded harness node needs to answer, not compressed: a probe
// cut shorter than that reads a live primary as UNKNOWN.
const FOLLOW_PROBE_TIMEOUT_MS = 2000;

/**
 * FDM's clock on the fleet's: every duration scaled by the ratio the fleet
 * applies to the g: election pass, so FDM's lag spans the same number of
 * election passes and stagger places as it does in production. The
 * confirmation count is a count, and is not scaled.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @returns {object} timing for followPrimary
 */
export function followTiming(fluxapps = loadSharedConfig().fluxapps) {
  const scale = fluxapps.masterSlaveIntervalMs / PRODUCTION.masterSlaveIntervalMs;
  return {
    passMs: Math.round(FDM_PRODUCTION.passMs * scale),
    graceMs: Math.round(FDM_PRODUCTION.graceMs * scale),
    confirmations: FDM_PRODUCTION.confirmations,
    cacheMs: Math.round(FDM_PRODUCTION.cacheMs * scale),
    probeTimeoutMs: FOLLOW_PROBE_TIMEOUT_MS,
  };
}

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

// No primary for the app -> every node is a standby and waits. Also ends
// following it.
export async function clearMaster(appName) {
  return post(`/clear/${appName}`);
}

/**
 * Have FDM follow an app's primary the way the real one does - whichever
 * instance runs its g: component, held through a failed check until the grace
 * and the confirmations are both spent, then a running instance, then one
 * holding it - instead of a test electing it.
 * @param {string} appName Global app name.
 * @param {object} opts
 * @param {string[]} opts.nodes Socket addresses FDM may ask for the app's locations.
 * @param {string[]} opts.gNames Docker names of the app's g: components.
 * @param {object} [opts.timing] followTiming() of the fleet's config.
 */
export async function followPrimary(appName, { nodes, gNames, timing = followTiming() }) {
  const res = await post(`/follow/${appName}`, { nodes, gNames, timing });
  if (!res.ok) throw new Error(`FDM refused to follow ${appName}: ${JSON.stringify(res)}`);
  return res;
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
