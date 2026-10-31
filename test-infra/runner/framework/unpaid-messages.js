// Unpaid app messages as the network carries them: the message itself, the
// signature of the node that admitted it, the client tag on it, and what a node
// stored for it.
//
// A message built here is one an owner signed and nobody has paid for, with its
// fields in the order an admitting node signs them. A peer stub broadcasting it
// is a node admitting it; a signature made here with a node's key is that node
// having admitted it, carried as the `origin` of a reply rebuilt from storage.

import { randomBytes } from 'node:crypto';
import { signBtcMessage } from '../auth.js';
import { getState, advanceBlocks } from './daemon-control.js';
import { waitForBlockProcessed } from './wait.js';

// ZelBack/src/services/utils/clientTag.js: the salt is the block at the newest
// multiple of TAG_EPOCH_BLOCKS at least TAG_DEPTH_BLOCKS below the tip.
export const TAG_EPOCH_BLOCKS = 120;
const TAG_DEPTH_BLOCKS = 10;

export function tagHeightFor(tip) {
  return Math.floor((tip - TAG_DEPTH_BLOCKS) / TAG_EPOCH_BLOCKS) * TAG_EPOCH_BLOCKS;
}

export async function currentTagHeight() {
  const { currentHeight } = await getState();
  return tagHeightFor(currentHeight);
}

/**
 * Moves the chain to the first block of the next tag epoch, so a suite that
 * counts one client's messages has a whole epoch, about a hundred blocks, before
 * the client's tag changes. Only for a suite whose ticker is stopped: a running
 * ticker moves the tip on its own.
 * @param {object[]} clients The nodes that must have processed the new tip.
 * @returns {Promise<number>} The tag height of the new epoch.
 */
export async function startTagEpoch(clients) {
  const { currentHeight } = await getState();
  const target = tagHeightFor(currentHeight) + TAG_EPOCH_BLOCKS + TAG_DEPTH_BLOCKS;
  const marks = clients.map((c) => c.getLastEventId());
  await advanceBlocks(target - currentHeight);
  await Promise.all(clients.map((c, i) => waitForBlockProcessed(c, (d) => d.height >= target, 180000, { afterId: marks[i] })));
  return tagHeightFor(target);
}

/** A tag no client has: what an operator naming its own clients puts on a message. */
export function freshClientTag() {
  return randomBytes(32).toString('hex');
}

/**
 * The unpaid message of an app built by seed-helper's buildSeedableApp, with any
 * fields an admitting node adds.
 * @param {object} app
 * @param {object} [fields]
 * @returns {object}
 */
export function pendingMessage(app, fields = {}) {
  const {
    type, version, appSpecifications, hash, timestamp, signature,
  } = app.permanentMessage;
  return {
    type, version, appSpecifications, hash, timestamp, signature, arcaneSender: true, ...fields,
  };
}

/**
 * A broadcast frame over `data`, signed with `key` as a node signs one.
 * @param {object} data
 * @param {{pubkey: string, privkey: string}} key
 * @returns {Promise<object>}
 */
export async function signedFrame(data, key) {
  const version = 1;
  const timestamp = Date.now();
  const signature = await signBtcMessage(`${version}${JSON.stringify(data)}${timestamp}`, key.privkey);
  return {
    version, timestamp, pubKey: key.pubkey, signature, data,
  };
}

/**
 * A node's signature over a message it admits, as a reply carries it: the
 * frame's signed fields without the message, which the receiver rebuilds.
 * @param {object} data
 * @param {{pubkey: string, privkey: string}} key
 * @returns {Promise<{version: number, timestamp: number, pubKey: string, signature: string}>}
 */
export async function admittingSignature(data, key) {
  const {
    version, timestamp, pubKey, signature,
  } = await signedFrame(data, key);
  return {
    version, timestamp, pubKey, signature,
  };
}

/**
 * What a node holds for a pending message, read past the route's cache, or null.
 * @param {object} client
 * @param {string} hash
 * @returns {Promise<object|null>}
 */
export async function pendingMessageOn(client, hash) {
  const response = await client.get(`/apps/temporarymessages/${hash}?_=${Date.now()}`);
  return response.status === 'success' ? (response.data?.[0] ?? null) : null;
}

/**
 * A node's decision on an unpaid message, from the event it publishes.
 * @param {object} client
 * @param {string} hash
 * @param {number} afterId Taken before the message was sent.
 * @param {number} [timeout]
 * @returns {Promise<{hash: string, taken: boolean, reason: string|null, clientTag: string|null, originKey: string|null}>}
 */
export async function admissionOf(client, hash, afterId, timeout = 60000) {
  const event = await client.waitForEvent('appmessage:admission', (d) => d.hash === hash, timeout, { afterId });
  return event.data;
}
