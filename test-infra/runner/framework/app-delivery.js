// An app's specification reaches a node the way the network delivers it: the
// owner's signed message waits among the node's pending messages, its payment is
// on the node's record, and the node resolves the payment itself
// (GET /apps/checkhashes). Resolving verifies the message - its height not yet
// expired, the price paid, an update signed by the app's previous owner - and
// stores the message and the specification through the registry's own locked
// write, so a registry rebuild running at the time cannot lose it.
//
// The payment is what an owner's wallet pays: the node's own quote
// (POST /apps/calculateprice), or the network's minimum for an update the quote
// calls free.
//
// deliverAppByBlock puts the payment in the chain's next block instead, which
// every node scans whatever state it is in, and the app's height is that block's.
import { createRequire } from 'node:module';
import { authenticate } from '../auth.js';
import { dbClient } from './db-client.js';
import { fluxTeamKey } from './keys.js';
import { getState, queueAppTx } from './daemon-control.js';
import { waitForBootSettled } from './wait.js';

const require = createRequire(import.meta.url);
const productConfig = require('../../../ZelBack/config/default.js');

// A pending message lives an hour, as the node keeps one it received.
const PENDING_MESSAGE_LIFE_MS = 60 * 60 * 1000;
const STORED_WAIT_MS = 60000;

/**
 * The least any registration or update must pay at a height: the minimum of the
 * price table in force there.
 * @param {number} height
 * @returns {number} FLUX
 */
function minimumPaymentAt(height) {
  const inForce = productConfig.fluxapps.price.filter((interval) => interval.height < height);
  return inForce[inForce.length - 1].minPrice;
}

/**
 * What the node quotes for this specification, in FLUX.
 * @param {object} client
 * @param {object} specification
 * @returns {Promise<number>}
 */
async function quote(client, specification) {
  // The price route reads its body as a stream, and a JSON content type is not one.
  const response = await fetch(`${client.url}/apps/calculateprice`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(specification),
  });
  const answer = await response.json();
  if (answer?.status !== 'success' || typeof answer.data?.flux !== 'number') {
    throw new Error(`node ${client.url} quoted no price for ${specification.name}: ${JSON.stringify(answer)}`);
  }
  return answer.data.flux;
}

/**
 * A message as a node holds one it received and has not seen paid for.
 * @param {object} message the app's permanent message
 * @param {number} now epoch ms
 * @returns {object}
 */
function pendingMessage(message, now) {
  return {
    type: message.type,
    version: message.version,
    appSpecifications: message.appSpecifications,
    hash: message.hash,
    timestamp: message.timestamp,
    signature: message.signature,
    receivedAt: new Date(now),
    expireAt: new Date(now + PENDING_MESSAGE_LIFE_MS),
  };
}

/**
 * A delivered app must still be alive on the chain the fleet runs: an expired one
 * is dropped from every spawner's candidates and removed by the expiry pass, which
 * presents as a spawner timeout rather than as the fixture's fault.
 * @param {object} env
 * @param {object} app
 */
function assertAliveOnThisChain(env, app) {
  const deliveredAt = app.permanentMessage.height;
  const expiresAt = deliveredAt + (app.spec.expire ?? 22000);
  if (expiresAt <= env.initialHeight) {
    throw new Error(
      `delivered app ${app.spec.name} expires at block ${expiresAt}, at or below this suite's `
      + `chain start (${env.initialHeight}): build it relative to the chain, buildSeedableApp({ env, ... }).`,
    );
  }
}

/**
 * Delivers a registration or an update to the given nodes, and returns once each
 * holds it as the specification in force. A node that already holds this exact
 * specification is left as it is.
 * @param {object} env
 * @param {object} app what buildSeedableApp or buildSeedableUpdate returned
 * @param {number[]} indices zero-based node indices
 * @returns {Promise<void>}
 */
export async function deliverApp(env, app, indices) {
  assertAliveOnThisChain(env, app);
  const message = app.permanentMessage;
  const { name } = message.appSpecifications;
  const teamKey = fluxTeamKey();
  await Promise.all(indices.map(async (i) => {
    const client = env.clients[i];
    const dc = dbClient(i + 1);
    // A node quotes a price once its daemon is synced, and resolves a payment once
    // its app sync is running; its boot settling follows both.
    await waitForBootSettled(client);
    if ((await dc.globalAppSpec(name))?.hash === app.hash) return;

    const paid = Math.max(await quote(client, message.appSpecifications), minimumPaymentAt(message.height));
    const now = Date.now();
    await dc.seedTemporaryMessage(pendingMessage(message, now));
    await dc.seedAppHashes([{
      hash: message.hash,
      txid: message.txid,
      height: message.height,
      value: Math.round(paid * 1e8),
      message: false,
      messageNotFound: false,
      createdAt: new Date(now),
    }]);

    const mark = client.getLastEventId();
    const auth = await authenticate(client.url, teamKey);
    const asked = await client.getAuthed('/apps/checkhashes', auth.zelidauth);
    if (asked?.status !== 'success') {
      throw new Error(`node ${i} refused to resolve its app payments: ${JSON.stringify(asked)}`);
    }
    try {
      await client.waitForEvent('app:specStored', (d) => d.name === name && d.hash === app.hash, STORED_WAIT_MS, { afterId: mark });
    } catch (error) {
      throw new Error(`node ${i} did not store ${name} (${app.hash}) from its payment of ${paid} FLUX: ${error.message}`);
    }
  }));
}

/**
 * Puts a registration or an update in front of the given nodes, as an owner's
 * broadcast reaches the nodes online, and its payment in the chain's next block,
 * at the quote of the first of them that gives one. Each node stores the
 * specification when its own scan reaches that block; a node not given the message
 * fetches it from its peers, as one that was offline does. The caller stops the
 * block ticker first, and mines the block.
 * @param {object} env
 * @param {object} app what buildSeedableApp or buildSeedableUpdate returned
 * @param {number[]} indices zero-based indices of the nodes online
 * @returns {Promise<{nextBlockHeight: number}>} the block the payment is in
 */
export async function deliverAppByBlock(env, app, indices) {
  const message = app.permanentMessage;
  const now = Date.now();
  await Promise.all(indices.map((i) => dbClient(i + 1).seedTemporaryMessage(pendingMessage(message, now))));
  let quoted = null;
  const refusals = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const client of indices.map((i) => env.clients[i])) {
    try {
      // eslint-disable-next-line no-await-in-loop
      quoted = await quote(client, message.appSpecifications);
      break;
    } catch (error) {
      refusals.push(error.message);
    }
  }
  if (quoted === null) throw new Error(`no node quoted ${message.appSpecifications.name}: ${refusals.join('; ')}`);
  // The ticker is stopped, so the block the payment lands in is the next one.
  const landsAt = (await getState()).currentHeight + 1;
  const { nextBlockHeight } = await queueAppTx(message.hash, {
    valueSat: Math.round(Math.max(quoted, minimumPaymentAt(landsAt)) * 1e8),
  });
  return { nextBlockHeight };
}
