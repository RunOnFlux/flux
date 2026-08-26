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
