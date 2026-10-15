/*
 * A log of app messages on chain, for suites about how a node fetches the messages it is missing.
 *
 * buildMessageLog signs `apps` registrations, each followed by `updates` updates, one message per
 * block from `height`, app after app. Every entry is what buildSeedableApp returns:
 * { hash, permanentMessage, hashEntry, ... }, and the log is in height order.
 *
 * seedMessageLog writes it the way a node's own scan and its peers would have left it: each
 * serving node holds the messages and the chain's payment records for them; the joiner holds the
 * payment records, resolved for the messages it already has and unresolved for the rest.
 */
import { randomBytes } from 'node:crypto';
import { buildSeedableApp, buildSeedableUpdate } from './seed-helper.js';
import { dbClient } from './db-client.js';
import { createTestEnv } from './test-env.js';
import { bootAndPeer } from './reconciler-suite.js';
import { waitFor, waitForDaemonReady } from './wait.js';
import { getSubnetConfig } from './subnet-config.js';

// A serving node about to write the next piece of its log, keyed by the pieces it has written.
export const BEFORE_LOG_PIECE = 'messageLog:beforePiece';

/**
 * `incompressible` gives every update random descriptions the length a spec allows, so the log
 * compresses about as well as mainnet's (some 450 bytes a message) rather than to a fraction of it.
 * @param {{env: object, name: string, apps: number, updates: number, height: number,
 *   incompressible?: boolean}} options
 * @returns {Promise<object[]>}
 */
export async function buildMessageLog({
  env, name, apps, updates, height, incompressible = false,
}) {
  function revise(a, u) {
    return function reviseSpec(spec) {
      if (incompressible) {
        spec.description = randomBytes(128).toString('hex');
        spec.compose[0].description = randomBytes(128).toString('hex');
      } else {
        spec.description = `${name}${a} revision ${u}`;
      }
    };
  }
  const log = [];
  for (let a = 0; a < apps; a += 1) {
    const first = height + (a * (updates + 1));
    // eslint-disable-next-line no-await-in-loop
    let current = await buildSeedableApp({ env, name: `${name}${a}`, height: first });
    log.push(current);
    for (let u = 1; u <= updates; u += 1) {
      // eslint-disable-next-line no-await-in-loop
      current = await buildSeedableUpdate(current, revise(a, u), { height: first + u });
      log.push(current);
    }
  }
  return log;
}

/**
 * @param {{log: object[], servers: number[], joiner: number, held?: Set<string>}} options
 *   `servers` and `joiner` are node indices; `held` names the hashes the joiner already holds
 */
export async function seedMessageLog({
  log, servers, joiner, held = new Set(),
}) {
  const entries = log.map((m) => m.hashEntry);
  await Promise.all(servers.map(async (index) => {
    await dbClient(index + 1).seedPermanentMessages(log.map((m) => m.permanentMessage));
    await dbClient(index + 1).seedAppHashes(entries);
  }));
  const joinerHolds = log.filter((m) => held.has(m.hash));
  if (joinerHolds.length > 0) await dbClient(joiner + 1).seedPermanentMessages(joinerHolds.map((m) => m.permanentMessage));
  await dbClient(joiner + 1).seedAppHashes(log.map((m) => ({ ...m.hashEntry, message: held.has(m.hash) })));
}

/**
 * The messages of the log the joiner does not hold at its own record's txid, height and payment:
 * each with what the joiner stores for the hash, if anything, and its payment record.
 * @param {number} joiner node index
 * @param {object[]} log
 * @returns {Promise<{hash: string, stored: object|null, record: object|null}[]>}
 */
export async function messagesNotKept(joiner, log) {
  const db = dbClient(joiner + 1);
  const kept = new Map((await db.permanentMessages()).map((m) => [m.hash, m]));
  const wrong = log.filter((m) => {
    const stored = kept.get(m.hash);
    return !stored || stored.txid !== m.hashEntry.txid || stored.height !== m.hashEntry.height
      || stored.valueSat !== m.hashEntry.value || stored.signature !== m.permanentMessage.signature;
  });
  if (wrong.length === 0) return [];
  const records = new Map((await db.appHashRecords({ hash: { $in: wrong.map((m) => m.hash) } })).map((r) => [r.hash, r]));
  return wrong.map((m) => {
    const stored = kept.get(m.hash);
    return {
      hash: m.hash,
      type: m.permanentMessage.type,
      name: m.permanentMessage.appSpecifications.name,
      expected: { txid: m.hashEntry.txid, height: m.hashEntry.height, value: m.hashEntry.value },
      stored: stored ? { txid: stored.txid, height: stored.height, valueSat: stored.valueSat } : null,
      record: records.get(m.hash) ?? null,
    };
  });
}

/**
 * A fleet of six serving nodes holding a log of `apps` x (1 + `updates`) messages, and a joiner,
 * not yet started, holding the payment records of all of them and none of the messages.
 *
 * A bulk fetch asks only the peers that dialled the joiner, never the ones it dialled itself, and
 * in a ring of seven nodes three peers dial each node: so the joiner has three peers to ask, and
 * a suite can fail one and still have others to take the rest from.
 * @param {object} hookCtx the before hook's `this`
 * @param {{name: string, apps?: number, updates?: number}} options
 * @returns {Promise<{env: object, log: object[], peers: number[], joiner: number}>}
 */
export async function fleetMissingALog(hookCtx, { name, apps = 10, updates = 59 }) {
  const peers = [0, 1, 2, 3, 4, 5];
  const joiner = 6;
  const env = await createTestEnv({ hookCtx, nodes: 7, deferredNodes: 1 });
  await bootAndPeer(env);
  const log = await buildMessageLog({
    env, name: `${name}${Date.now()}x`, apps, updates, height: env.initialHeight - 2000,
  });
  await seedMessageLog({ log, servers: peers, joiner });
  return {
    env, log, peers, joiner,
  };
}

/**
 * Starts the joiner and waits for its API, without letting it find peers yet.
 * @returns {Promise<object>} its client
 */
export async function startJoiner(env, joiner) {
  const client = await env.startNode(joiner);
  await waitForDaemonReady(client);
  return client;
}

/** The address a node is known by to its peers, as a bulk fetch names it. */
export function peerKey(index) {
  return `${getSubnetConfig().nodeIp(index + 1)}:16127`;
}

/**
 * Waits until one of the serving nodes is held writing its log after its first piece, and
 * returns its index: the peer the joiner asked first.
 * @param {object} env
 * @param {number[]} peers
 * @returns {Promise<number>}
 */
export async function firstPeerHeldAfterOnePiece(env, peers) {
  let held;
  await waitFor(() => {
    held = peers.find((i) => env.clients[i].getEventBuffer()
      .some((e) => e.event === 'checkpoint:held' && e.data.name === BEFORE_LOG_PIECE && e.data.key === 1));
    return held !== undefined;
  }, { timeout: 600000, interval: 500, label: 'a peer held after the first piece of its log' });
  return held;
}
