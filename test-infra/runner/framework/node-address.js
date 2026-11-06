import {
  crashFluxos, moveNodeAddress, releaseFluxos, restartFluxos, setNodeApiPort,
} from './container.js';
import { advanceBlock, setNodeAddress } from './daemon-control.js';
import { dbClient } from './db-client.js';

/**
 * A node whose address changes while it is down, as a machine that loses power
 * and comes back on another IP: FluxOS is stopped and held, the address moves
 * under it, benchmark reports the new one while the chain still lists the old,
 * and FluxOS starts again at the new address. Its configured IP is left as it
 * was. `forgetOwnAddress` also drops the address the node recorded adopting, as
 * a node that never kept one.
 * @param {object} env The test env.
 * @param {number} index The node's index.
 * @param {string} to Bare address to move to, inside the fleet's own /24.
 * @param {object} [options]
 * @param {boolean} [options.forgetOwnAddress]
 * @returns {Promise<{from: string, to: string}>}
 */
export async function moveNodeWhileDown(env, index, to, { forgetOwnAddress = false } = {}) {
  const client = env.clients[index];
  const from = client.ip;
  await crashFluxos(client.container, { hold: true });
  await moveNodeAddress(client.container, to, from);
  await setNodeAddress(from, to, { scope: 'benchmark' });
  if (forgetOwnAddress) await dbClient(index + 1).forgetOwnAddress();
  await releaseFluxos(client.container);
  await client.followTo(to);
  return { from, to };
}

/**
 * The chain lists a node at `apiPort` on its own IP from the next block, which this mines.
 * @param {object} client The node's client.
 * @param {number} apiPort
 * @returns {Promise<void>}
 */
export async function listNodeAtApiPort(client, apiPort) {
  await setNodeAddress(client.ip, `${client.ip}:${apiPort}`, { scope: 'all' });
  await advanceBlock();
}

/**
 * A node its operator gives an api port, as a node behind a router has: its userconfig.js
 * names the port and whether it maps through UPnP (setNodeApiPort), the chain lists it there,
 * and FluxOS starts again on it. In a fleet with peers, resolves once the node's own
 * availability check has passed at the port: until a peer reaches it there, the node is out
 * of service.
 * @param {object} env The test env.
 * @param {number} index The node's index.
 * @param {number} apiPort
 * @param {object} [options]
 * @param {boolean} [options.upnp] Whether it maps through UPnP; true unless given.
 * @param {number} [options.availableWithinMs] How long its availability check may take.
 * @returns {Promise<void>}
 */
export async function giveNodeApiPort(env, index, apiPort, { upnp = true, availableWithinMs = 180000 } = {}) {
  const client = env.clients[index];
  await setNodeApiPort(client.container, apiPort, { upnp });
  await listNodeAtApiPort(client, apiPort);
  const mark = client.getLastEventId();
  await restartFluxos(client.container, { apiPort });
  await client.followTo(client.ip, apiPort);
  if (env.clients.length > 1) {
    await client.waitForEvent('availability:checked', (d) => d.available === true, availableWithinMs, { afterId: mark });
  }
}
