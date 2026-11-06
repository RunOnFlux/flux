const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const networkStateService = require('./networkStateService');
const fluxnodeAddressRecord = require('./fluxnodeAddressRecord');

/**
 * @typedef {{
 *   version: number,
 *   timestamp: number,
 *   pubKey: string,
 *   signature: string,
 *   data : object,
 * }} FluxNetworkMessage
 */

/**
 * To get deterministc Flux list from network state manager
 * @param {string} filter Filter. Can only be a publicKey.
 * @param {{filter?: string, sort?: boolean, addressOnly?: boolean}} options
 * @returns {Promise<Array<Fluxnode>}
 */
async function deterministicFluxList(options = {}) {
  const filter = options.filter || '';
  const sort = options.sort || false;
  const addressOnly = options.addressOnly || false;

  // The node list takes a moment to arrive, and every accessor here answers an
  // unknown state and a genuinely empty one identically - an empty list, a zero,
  // a false. Waiting is the safe default, so the twelve callers that cannot tell
  // those apart get the right answer without each having to remember to ask.
  // Anything on a repeating schedule must NOT reach here unready: it checks
  // networkStateService.isReady() and re-arms, the way it already does for the
  // daemon. See fluxDiscovery, monitorNodeStatus.
  await networkStateService.waitStarted();

  if (!filter) {
    const state = networkStateService.networkState({ sort });

    if (!addressOnly) return state;

    return state.reduce((filtered, node) => {
      if (node.ip) filtered.push(node.ip);

      return filtered;
    }, []);
  }

  const filtered = await networkStateService.getFluxnodesByPubkey(filter);

  if (!filtered) return [];

  const asArray = Array.from(filtered.values());

  return asArray;
}

async function getNodeCount() {
  await networkStateService.waitStarted();
  const count = networkStateService.nodeCount();

  return count;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Proimse<Fluxnode | null}
 */
async function getFluxnodeFromFluxList(socketAddress) {
  await networkStateService.waitStarted();
  const node = await networkStateService.getFluxnodeBySocketAddress(socketAddress);

  return node;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Proimse<boolean>}
 */
async function socketAddressInFluxList(socketAddress) {
  await networkStateService.waitStarted();
  const found = await networkStateService.socketAddressInNetworkState(socketAddress);

  return found;
}

let counter = 0;
let lastUpdate = 0;

/**
 * How far ahead of this node a signed message may be stamped and still be read as now.
 *
 * The fleet's clocks are not identical and nothing waits for them to be, so a message
 * from a node running slightly ahead is honest. Beyond it, a timestamp is not skew: it
 * is a sender choosing when its message expires, and a check bounded only on the old
 * side lets them choose never.
 */
const BROADCAST_CLOCK_SKEW_MS = 120_000;

const VerifyResult = Object.freeze({
  OK: 'ok',
  MALFORMED: 'malformed',
  NODE_NOT_FOUND: 'nodeNotFound',
  BAD_SIGNATURE: 'badSignature',
  PUBKEY_MISMATCH: 'pubkeyMismatch',
  UNREADABLE: 'unreadable',
});

/**
 * listedSignerVerdict's answer when the list shows a move's signer at its new
 * address only, and chainMoveVerdict decides.
 */
const SIGNER_AT_NEW_ADDRESS_ONLY = 'signerAtNewAddressOnly';

/**
 * The addresses a broadcast's signer may be listed at, the one it speaks for
 * first. A move names two, the address the node left and the one it holds now,
 * and the list shows whichever the chain has reached: the move's own
 * confirmation can be mined before or after peers hear the move. The key is that
 * node's at both. Every other broadcast speaks for the node at one address.
 * @param {object} payload The broadcast's data.
 * @param {string} target The one address the broadcast's type names.
 * @returns {string[]}
 */
function signerAddresses(payload, target) {
  if (payload?.type === 'fluxipchanged') return [payload.oldIP, payload.newIP].filter(Boolean);
  return [target];
}

/**
 * Whether the node `addresses` speaks for holds `pubKey`, by the node list
 * alone. A node listed at the first address is the one it speaks for. While
 * nothing is listed there, a signer listed at another address may speak for it:
 * a move's confirmation is mined before some peers hear the move, and the chain
 * then lists its node at the new address only. chainMoveVerdict decides that
 * case.
 *
 * For a move, `addresses` is [the address it left, the address it holds]:
 *
 *   address left     signer at the new address   verdict
 *   listed, signer   -                           OK
 *   listed, other    -                           PUBKEY_MISMATCH
 *   not listed       listed, signer              SIGNER_AT_NEW_ADDRESS_ONLY
 *   not listed       listed, other               PUBKEY_MISMATCH
 *   not listed       not listed                  NODE_NOT_FOUND
 * @param {string[]} addresses From signerAddresses.
 * @param {string} pubKey
 * @returns {Promise<string>} VerifyResult.OK, PUBKEY_MISMATCH or NODE_NOT_FOUND,
 *   or SIGNER_AT_NEW_ADDRESS_ONLY.
 */
async function listedSignerVerdict(addresses, pubKey) {
  const [first, ...others] = addresses;
  const node = await networkStateService.getFluxnodeBySocketAddress(first);
  if (node) return node.pubkey === pubKey ? VerifyResult.OK : VerifyResult.PUBKEY_MISMATCH;
  let signerListed = false;
  let otherListed = false;
  // eslint-disable-next-line no-restricted-syntax
  for (const address of others) {
    // eslint-disable-next-line no-await-in-loop
    const listed = await networkStateService.getFluxnodeBySocketAddress(address);
    if (listed?.pubkey === pubKey) signerListed = true;
    else if (listed) otherListed = true;
  }
  if (!signerListed) return otherListed ? VerifyResult.PUBKEY_MISMATCH : VerifyResult.NODE_NOT_FOUND;
  return SIGNER_AT_NEW_ADDRESS_ONLY;
}

// How long a move waits for the explorer to record the block that moved its
// node. The explorer polls fluxd every explorerPollIntervalMs (5 s), so one block
// time without that block is an explorer not keeping up.
const RECORD_WAIT_MS = 30_000;

/**
 * Whether a move from `oldIP` to `newIP`, signed by the key the list shows at
 * `newIP` only, is the chain's: the chain moved the node listed at `newIP` -
 * its collateral - from `oldIP` to there (fluxnodeAddressRecord).
 *
 *   the record, at the node's last confirmation   verdict
 *   holds the change                              OK
 *   does not                                      NODE_NOT_FOUND
 *   has not reached it, or cannot be read         UNREADABLE
 * @param {string} oldIP
 * @param {string} newIP
 * @param {string} pubKey The move's signer.
 * @returns {Promise<{result: string, reason?: string}>}
 */
async function chainMoveVerdict(oldIP, newIP, pubKey) {
  const node = await networkStateService.getFluxnodeBySocketAddress(newIP);
  if (!node || node.pubkey !== pubKey) {
    return { result: VerifyResult.NODE_NOT_FOUND, reason: `No node signed by ${pubKey} is listed at ${newIP}, which a move from ${oldIP} names` };
  }
  const collateral = fluxnodeAddressRecord.collateralOf(node.txhash, node.outidx);
  let moved;
  try {
    if (!await fluxnodeAddressRecord.whenRecorded(Number(node.last_confirmed_height), RECORD_WAIT_MS)) {
      return { result: VerifyResult.UNREADABLE, reason: `The explorer has not recorded block ${node.last_confirmed_height}, which confirmed the node at ${newIP}` };
    }
    moved = await fluxnodeAddressRecord.movedBetween(collateral, oldIP, newIP);
  } catch (error) {
    return { result: VerifyResult.UNREADABLE, reason: `The fluxnode address record cannot be read for the move from ${oldIP} to ${newIP}: ${error.message}` };
  }
  if (!moved) {
    return { result: VerifyResult.NODE_NOT_FOUND, reason: `The chain has not moved the node listed at ${newIP} from ${oldIP}` };
  }
  return { result: VerifyResult.OK };
}

/**
 * The address a broadcast's type names its node by, and the refusal when that
 * node is not listed.
 * @param {object} payload The broadcast's data.
 * @param {string} pubKey
 * @returns {Promise<{target: (string|Map|null), error: string}>} A Map when the
 *   type names no address and the node is found by its key.
 */
async function broadcastTarget(payload, pubKey) {
  switch (payload.type) {
    case 'fluxapprunning':
      // most of invalids are caused because our deterministic list is cached for couple of minutes
      return { target: payload.ip, error: `Invalid fluxapprunning message, ip: ${payload.ip} pubkey: ${pubKey}` };
    case 'fluxappinstalling':
      return { target: payload.ip, error: `Invalid fluxappinstalling message, ip: ${payload.ip} pubkey: ${pubKey}` };
    case 'fluxappinstallingerror':
      return { target: payload.ip, error: `Invalid fluxappinstallingerror message, ip: ${payload.ip} pubkey: ${pubKey}` };
    case 'fluxipchanged':
      return { target: payload.oldIP, error: `Invalid fluxipchanged message, oldIP: ${payload.oldIP} pubkey: ${pubKey}` };
    case 'fluxappremoved':
      return { target: payload.ip, error: `Invalid fluxappremoved message, ip: ${payload.ip} pubkey: ${pubKey}` };
    case 'fluxnodesigterm':
      return { target: payload.ip, error: `Invalid fluxnodesigterm message, ip: ${payload.ip} pubkey: ${pubKey}` };
    // zelappregister zelappupdate fluxappregister fluxappupdate fluxapprequest
    default:
      // a pubkey found in the list is good enough; every message should ideally also carry its source ip
      return {
        target: await networkStateService.getFluxnodesByPubkey(pubKey),
        error: `No node belonging to ${pubKey} found for ${payload.type}`,
      };
  }
}

/**
 * The checks of one broadcast that need no signature: its shape, then the node
 * list. A refusal, or what its signature is checked over.
 * @param {FluxNetworkMessage} broadcast
 * @param {number} now
 * @returns {Promise<{refused: {result: string, reason?: string}}|{item: object}>}
 */
async function checkBeforeSignature(broadcast, now) {
  const {
    pubKey, timestamp, signature, version, data: payload,
  } = broadcast;

  if (version !== 1 || !payload || !pubKey || !timestamp || !signature) return { refused: { result: VerifyResult.MALFORMED } };
  const message = serviceHelper.ensureString(payload);
  if (!message || !payload.type) return { refused: { result: VerifyResult.MALFORMED } };
  // message was broadcasted in the future. Allow 120 sec clock sync
  if (now < timestamp - BROADCAST_CLOCK_SKEW_MS) {
    return { refused: { result: VerifyResult.MALFORMED, reason: 'VerifyBroadcast: Message from future, rejecting' } };
  }

  const { target, error } = await broadcastTarget(payload, pubKey);
  if (target === null) return { refused: { result: VerifyResult.NODE_NOT_FOUND, reason: error } };

  let proveAt = null;
  // a Map is the node found by its key: it is listed
  if (!(target instanceof Map)) {
    const addresses = signerAddresses(payload, target);
    const listed = await listedSignerVerdict(addresses, pubKey);
    if (listed === VerifyResult.NODE_NOT_FOUND) return { refused: { result: listed, reason: error } };
    if (listed === VerifyResult.PUBKEY_MISMATCH) {
      return { refused: { result: listed, reason: `Sender pubkey ${pubKey} does not match node at ${target}` } };
    }
    if (listed === SIGNER_AT_NEW_ADDRESS_ONLY) proveAt = { oldIP: payload.oldIP, newIP: payload.newIP };
  }

  return {
    item: {
      messageToVerify: version + message + timestamp, pubKey, signature, proveAt,
    },
  };
}

function verifySignaturesInline(items) {
  return items.map(({ messageToVerify, pubKey, signature }) => verificationHelper.verifyMessage(messageToVerify, pubKey, signature));
}

/**
 * Verify Flux broadcasts: that each speaks for a listed node, and that the node
 * signed it.
 *
 * A broadcast is refused by the cheapest check that can refuse it, so the checks
 * run cheapest first: its shape, then the node list (in memory), then its
 * signature, then anything that reads the database. A broadcast whose signature
 * fails never costs a database read.
 *
 * NODE_NOT_FOUND and UNREADABLE are the refusals that do not count against the
 * peer that relayed the broadcast: the list is cached, and can lag the chain,
 * and UNREADABLE is this node's database not answering, which says nothing of
 * the broadcast.
 * @param {FluxNetworkMessage[]} broadcasts
 * @param {object} [options]
 * @param {function(object[]): (boolean[]|Promise<boolean[]>)} [options.verifySignatures]
 *   Whether each item's `signature` over `messageToVerify` is `pubKey`'s, in
 *   order. Checked here, one by one, unless given: a batch passes a worker pool.
 * @returns {Promise<Array<{result: string, reason?: string}>>} A VerifyResult per
 *   broadcast, in order, and why when it was refused.
 */
async function verifyBroadcasts(broadcasts, { verifySignatures = verifySignaturesInline } = {}) {
  const now = Date.now();
  const verdicts = new Array(broadcasts.length);
  const unsigned = [];
  for (let i = 0; i < broadcasts.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { refused, item } = await checkBeforeSignature(broadcasts[i], now);
    if (refused) verdicts[i] = refused;
    else unsigned.push({ index: i, ...item });
  }

  const signed = await verifySignatures(unsigned);

  // The moves are judged together, so their waits for the explorer share one
  // RECORD_WAIT_MS however many a batch carries.
  await Promise.all(unsigned.map(async ({ index, pubKey, proveAt }, i) => {
    if (!signed[i]) verdicts[index] = { result: VerifyResult.BAD_SIGNATURE };
    else verdicts[index] = proveAt ? await chainMoveVerdict(proveAt.oldIP, proveAt.newIP, pubKey) : { result: VerifyResult.OK };
  }));
  return verdicts;
}

/**
 * Verify one Flux broadcast, as verifyBroadcasts does.
 * @param {FluxNetworkMessage} broadcast Flux network layer message containing public key, timestamp, signature and version.
 * @returns {Promise<string>} A VerifyResult.
 */
async function verifyFluxBroadcast(broadcast) {
  counter += 1;
  if (!lastUpdate) lastUpdate = process.hrtime.bigint();

  // log message rate every 1000 messages. As of 090725 - approx 1-2 MSG/s
  if (counter % 1000 === 0) {
    counter = 0;
    const nowHrtime = process.hrtime.bigint();
    const elapsed = Number(nowHrtime - lastUpdate) / 1000_000_000;
    const rate = 1000 / elapsed;
    // rounds to 2dp
    const rounded = Math.round((rate + Number.EPSILON) * 100) / 100;
    lastUpdate = nowHrtime;

    log.info(`Receiving broadcast message rate: ${rounded} MSG/s`);
  }

  const [{ result, reason }] = await verifyBroadcasts([broadcast]);
  if (reason) log.warn(reason);
  return result;
}

/**
 * To verify timestamp in Flux broadcast.
 * @param {object} data Data.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {boolean} False unless current timestamp is within 5 minutes of the data object's timestamp.
 */
function verifyTimestampInFluxBroadcast(data, currentTimeStamp, maxOld = 300_000) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms

  // A NUMBER, because the bound below is arithmetic on it. `timestamp + maxOld`
  // CONCATENATES for a string or an array, giving a figure orders of magnitude
  // beyond now, and every message of every age then reads as fresh - the check
  // inverted rather than loosened. The type is the sender's to choose and it
  // survives the signature: a broadcast is signed over version + message +
  // timestamp joined as text, where a number and its string are the same
  // preimage, so a captured message can be replayed for as long as it is held.
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;

  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp + maxOld)) { // not older than 5 mins
    return true;
  }
  const age = Math.round((currentTimeStamp - timestamp) / 1_000);
  const maxAge = maxOld / 1_000;
  log.warn('Unable to verify mesage. Timestamp '
    + `${timestamp} is too old: ${age}s, Max: ${maxAge}`);

  return false;
}

/**
 * To verify original Flux broadcast. Extends verifyFluxBroadcast by not allowing request older than 5 mins.
 * @param {object} data Data.
 * @param {object[]} obtainedFluxNodeList List of FluxNodes.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {Promise<boolean>} False unless message is successfully verified.
 */
async function verifyOriginalFluxBroadcast(data, currentTimeStamp) {
  const timeStampOK = verifyTimestampInFluxBroadcast(data, currentTimeStamp);
  if (timeStampOK) {
    return verifyFluxBroadcast(data);
  }
  return VerifyResult.MALFORMED;
}

module.exports = {
  BROADCAST_CLOCK_SKEW_MS,
  VerifyResult,
  getNodeCount,
  verifyTimestampInFluxBroadcast,
  verifyOriginalFluxBroadcast,
  deterministicFluxList,
  socketAddressInFluxList,
  getFluxnodeFromFluxList,
  verifyBroadcasts,
  verifyFluxBroadcast,
};
