// fluxd as a node whose unit passes the node key as a credential reaches it: the
// cookie fluxd accepts and fluxd.json naming its RPC port, both in /run/fluxd,
// which fluxd writes at each start and removes when it stops. The daemon stub
// serves fluxd for every node and accepts from such a node only its current
// cookie; this module stops, starts and restarts fluxd for one of them
// (createTestEnv's credentialNodes).
import { randomBytes } from 'node:crypto';
import { execInContainer } from './container.js';
import { controlJson } from './control-fetch.js';
import { getSubnetConfig } from './subnet-config.js';

// The port fluxd publishes in fluxd.json. The stub serves fluxd on it and on
// fluxd's default, 16124, which no credential node is told about.
export const FLUXD_PUBLISHED_PORT = 16125;

const DAEMON_IP = getSubnetConfig().daemon;
const CONTROL = `http://${DAEMON_IP}:18232`;
const RUN_DIR = '/run/fluxd';
// fluxd not running: its port refuses connections.
const REFUSE_RULE = `OUTPUT -p tcp -d ${DAEMON_IP} --dport ${FLUXD_PUBLISHED_PORT} -j REJECT --reject-with tcp-reset`;

const post = (path, body) => controlJson(`${CONTROL}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

/**
 * A cookie as fluxd writes one: `__cookie__:<random password>`.
 * @returns {string}
 */
export function newFluxdLogin() {
  return `__cookie__:${randomBytes(32).toString('hex')}`;
}

/**
 * The one login fluxd accepts from the node at `ip`.
 * @param {string} ip
 * @param {string} login `user:password`
 */
export async function setFluxdLogin(ip, login) {
  const answer = await post(`/fluxd-login/${ip}`, { login });
  if (answer.login !== login) throw new Error(`setFluxdLogin ${ip}: ${JSON.stringify(answer)}`);
}

async function run(client, label, command) {
  const r = await execInContainer(client.container, command);
  if (r.exitCode !== 0) throw new Error(`${label} on ${client.ip}: ${r.output}`);
}

/**
 * fluxd stops: its run files are gone and its port refuses connections.
 * @param {object} client The node's client.
 */
export async function stopFluxd(client) {
  await run(client, 'stopFluxd', `rm -f ${RUN_DIR}/rpc.cookie ${RUN_DIR}/fluxd.json && `
    + `(iptables -C ${REFUSE_RULE} 2>/dev/null || iptables -I ${REFUSE_RULE})`);
}

/**
 * fluxd starts: a new cookie, then fluxd.json naming its port, and the port
 * answers.
 * @param {object} client The node's client.
 * @returns {Promise<string>} The new login.
 */
export async function startFluxd(client) {
  const login = newFluxdLogin();
  await setFluxdLogin(client.ip, login);
  await run(client, 'startFluxd', `install -d -m 755 ${RUN_DIR} && `
    + `printf '%s' '${login}' > ${RUN_DIR}/rpc.cookie && chmod 640 ${RUN_DIR}/rpc.cookie && `
    + `printf '{"address":"%s","pid":1,"rpcport":%s}\\n' '${client.ip}' ${FLUXD_PUBLISHED_PORT} > ${RUN_DIR}/fluxd.json && `
    + `while iptables -D ${REFUSE_RULE} 2>/dev/null; do :; done`);
  return login;
}

/**
 * fluxd restarts: from now on it refuses the node's old cookie.
 * @param {object} client The node's client.
 * @returns {Promise<string>} The new login.
 */
export async function restartFluxd(client) {
  return startFluxd(client);
}

/**
 * Holds fluxd's refusals to the node unanswered until releaseFluxdRefusals, so
 * the calls a restart refuses are answered together.
 * @param {object} client The node's client.
 */
export async function holdFluxdRefusals(client) {
  await post(`/fluxd-refusals/hold/${client.ip}`);
}

/**
 * How many refusals to the node are being held.
 * @param {object} client The node's client.
 * @returns {Promise<number>}
 */
export async function heldFluxdRefusals(client) {
  return (await controlJson(`${CONTROL}/fluxd-refusals/hold/${client.ip}`)).waiting;
}

/**
 * Answers every held refusal to the node and stops holding.
 * @param {object} client The node's client.
 * @returns {Promise<number>} How many were answered.
 */
export async function releaseFluxdRefusals(client) {
  return (await controlJson(`${CONTROL}/fluxd-refusals/hold/${client.ip}`, { method: 'DELETE' })).released;
}
