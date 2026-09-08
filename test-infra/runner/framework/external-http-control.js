// Drives the external HTTP stub's artifact store: arbitrary bytes a node can
// fetch over real HTTP from inside the subnet. The restore suites need this
// because the remote path - the download, the content-length comparison, the
// file landing in backup/remote - cannot be reached with a local archive.
import { getSubnetConfig } from './subnet-config.js';

const HOST = getSubnetConfig().externalStub;
const CONTROL = process.env.EXTERNAL_HTTP_CONTROL || `http://${HOST}:3001`;
const SERVE_PORT = 3000;

async function post(path, body) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

/**
 * Stage bytes to be served at artifactUrl(name).
 *
 * `declaredLength` overrides the content-length header without changing what is
 * sent, which is how a download that stops short of what was promised is
 * reproduced - a dropped connection, or an error page served as 200.
 *
 * @param {string} name - artifact name, used in the URL
 * @param {string} base64 - the bytes, base64 encoded
 * @param {{declaredLength?: number}} [opts]
 */
export async function stageArtifact(name, base64, { declaredLength = null } = {}) {
  return post('/artifact', { name, base64, declaredLength });
}

/**
 * The URL a node should be given to fetch a staged artifact. Built from the
 * subnet config rather than a literal, so it follows a re-based fleet.
 * @param {string} name - artifact name
 * @returns {string} URL reachable from inside the fleet
 */
export function artifactUrl(name) {
  return `http://${HOST}:${SERVE_PORT}/artifact/${name}`;
}

/**
 * Every name a node asked for that nothing on the fleet could answer.
 *
 * The fleet network has no route off it, so a hardcoded address cannot reach
 * anywhere - but blocking alone only turns it into a timeout, and a timeout reads
 * as a slow test rather than as a node reaching somewhere it should not. The
 * resolver records instead, so this list names the host and the node that wanted
 * it.
 *
 * @returns {Promise<Array<{name: string, node: string, at: string}>>}
 */
export async function dnsAttempts() {
  const res = await fetch(`${CONTROL}/dns-attempts`);
  const { attempts } = await res.json();
  return attempts;
}

/**
 * Forget every recorded attempt. Called before the window a suite intends to
 * assert over, so it measures its own fleet rather than whatever ran before it.
 */
export async function resetDnsAttempts() {
  return post('/dns-attempts/reset');
}

/**
 * Fail naming the host and the node, rather than leaving a caller to compare
 * lists. `allowed` is for a suite that means to reach something - it should be
 * rare enough that writing the name down is the easy part.
 *
 * @param {{allowed?: string[]}} [opts]
 */
export async function expectNoUnexpectedDns({ allowed = [] } = {}) {
  const unexpected = (await dnsAttempts()).filter((a) => !allowed.includes(a.name));
  if (!unexpected.length) return;

  const detail = unexpected
    .map((a) => `${a.name} (node ${a.node})`)
    .join(', ');
  throw new Error(`nodes reached for names the fleet does not serve: ${detail}`);
}
