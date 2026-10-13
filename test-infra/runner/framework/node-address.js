import { crashFluxos, moveNodeAddress, releaseFluxos } from './container.js';
import { setNodeAddress } from './daemon-control.js';
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
