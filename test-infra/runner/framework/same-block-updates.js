// Two updates to one app confirmed in the same block, with the update signed
// last placed FIRST in the block.
//
// An owner's own messages stand in the order the owner signed them, wherever
// the miner placed them: only a node that orders them by their signatures'
// timestamps holds the update signed last.

import { expect } from 'chai';
import { nodeKey } from './keys.js';
import { buildAppSpec, registerApp, registerAndConfirm } from './app-helper.js';
import {
  stopTicker, startTicker, queueAppTx, advanceBlock, advanceBlocks,
} from './daemon-control.js';
import { waitFor } from './wait.js';

/**
 * Register an app, then confirm two updates to it in one block.
 * @param {object} env Test environment
 * @param {string} name App name
 * @returns {Promise<{standing: {hash: string, description: string},
 *   superseded: {hash: string, description: string}}>} the update signed last,
 *   at block position 0 (the one that must stand), and the update signed first,
 *   at position 1
 */
export async function confirmTwoUpdatesInOneBlock(env, name) {
  const registered = await registerAndConfirm(env.clients[0].url, nodeKey(1), buildAppSpec({ name }), env.clients);
  expect(registered.status, JSON.stringify(registered)).to.equal('success');
  await waitFor(async () => {
    const answers = await Promise.all(env.clients.map((c) => c.getAppSpecs(name).catch(() => null)));
    return answers.every((a) => a?.status === 'success');
  }, { timeout: 180000, interval: 3000, label: `every node holds ${name}` });

  await stopTicker();
  const submit = async (description) => {
    const result = await registerApp(env.clients[0].url, nodeKey(1), buildAppSpec({ name, description }), 'fluxappupdate');
    expect(result.status, JSON.stringify(result)).to.equal('success');
    return { hash: result.data, description };
  };
  const signedFirst = await submit(`${name} update signed first`);
  const signedLast = await submit(`${name} update signed last`);

  await waitFor(async () => {
    const held = await Promise.all(env.clients.flatMap((c) => [signedFirst, signedLast]
      .map((u) => c.getTempMessages(u.hash).then((r) => r.status === 'success' && r.data?.length > 0).catch(() => false))));
    return held.every(Boolean);
  }, { timeout: 60000, interval: 2000, label: 'both updates held by every node' });

  // Position 0: the update signed last. Position 1: the update signed first.
  await queueAppTx(signedLast.hash);
  await queueAppTx(signedFirst.hash);
  await advanceBlock();
  await advanceBlocks(2);
  await startTicker();

  const promoted = async (client, hash) => {
    const r = await fetch(`${client.url}/apps/permanentmessages/${hash}`).then((res) => res.json()).catch(() => null);
    return r?.status === 'success' && Array.isArray(r.data) && r.data.length > 0;
  };
  await waitFor(async () => {
    const all = await Promise.all(env.clients.flatMap((c) => [promoted(c, signedFirst.hash), promoted(c, signedLast.hash)]));
    return all.every(Boolean);
  }, { timeout: 180000, interval: 3000, label: 'both updates promoted on every node' });

  return { standing: signedLast, superseded: signedFirst };
}
