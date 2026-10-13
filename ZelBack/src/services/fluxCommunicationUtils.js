const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const networkStateService = require('./networkStateService');

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

/**
 * To verify a Flux broadcast message.
 * @param {FluxNetworkMessage} broadcast Flux network layer message containing public key, timestamp, signature and version.
 * @returns {Promise<boolean>} False unless message is successfully verified.
 */
const VerifyResult = Object.freeze({
  OK: 'ok',
  MALFORMED: 'malformed',
  NODE_NOT_FOUND: 'nodeNotFound',
  BAD_SIGNATURE: 'badSignature',
  PUBKEY_MISMATCH: 'pubkeyMismatch',
});

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
 * The key that last spoke for `address`: the signer of the newest unexpired
 * apprunning event stored for it, which only the node listed there when it was
 * sent could have signed. The same broadcast wrote this node's rows at the
 * address, so a node holding rows there holds their signer.
 * @param {string} address
 * @returns {Promise<string|null>} Null when none is stored or it cannot be read.
 */
async function lastSignerAt(address) {
  try {
    const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    const [event] = await database.collection(config.database.appsglobal.collections.appStateEvents)
      .find(
        { ip: address, type: 'apprunning', expireAt: { $gt: new Date() } },
        { projection: { _id: 0, 'envelope.pubKey': 1 } },
      )
      .sort({ broadcastedAt: -1 })
      .limit(1)
      .toArray();
    return event?.envelope?.pubKey ?? null;
  } catch (error) {
    log.error(`lastSignerAt ${address}: ${error.message}`);
    return null;
  }
}

/**
 * Whether the node `addresses` speaks for holds `pubKey`. A node listed at the
 * first address is the one it speaks for. While nothing is listed there, a
 * signer listed at another address speaks for it only when it was the last
 * key to speak for the first (lastSignerAt): a move's confirmation is mined
 * before some peers hear the move, and the chain then lists its node at the
 * new address only.
 *
 * For a move, `addresses` is [the address it left, the address it holds]:
 *
 *   address left     signer at the new address   last apprunning there   verdict
 *   listed, signer   -                           -                       OK
 *   listed, other    -                           -                       PUBKEY_MISMATCH
 *   not listed       listed, signer              signer's                OK
 *   not listed       listed, signer              another key's           PUBKEY_MISMATCH
 *   not listed       listed, signer              none                    NODE_NOT_FOUND
 *   not listed       listed, other               -                       PUBKEY_MISMATCH
 *   not listed       not listed                  -                       NODE_NOT_FOUND
 *
 * NODE_NOT_FOUND drops the move without counting against the peer that relayed
 * it. With no apprunning at the address it left, the node has no rows there for
 * the move to carry, and the chain already lists it where it is.
 * @param {string[]} addresses From signerAddresses.
 * @param {string} pubKey
 * @returns {Promise<string>} VerifyResult.OK; PUBKEY_MISMATCH when the first
 *   address is listed under another key, the others are listed only under
 *   another, or another key last spoke for the first; NODE_NOT_FOUND when
 *   nothing shows who speaks for it.
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
  const lastSigner = await lastSignerAt(first);
  if (lastSigner === null) return VerifyResult.NODE_NOT_FOUND;
  return lastSigner === pubKey ? VerifyResult.OK : VerifyResult.PUBKEY_MISMATCH;
}

async function verifyFluxBroadcast(broadcast) {
  const {
    pubKey, timestamp, signature, version, data: payload,
  } = broadcast;

  if (version !== 1) return VerifyResult.MALFORMED;

  const message = serviceHelper.ensureString(payload);

  if (!message) return VerifyResult.MALFORMED;

  const { type: msgType } = payload;

  if (!msgType) return VerifyResult.MALFORMED;

  const now = Date.now();

  // message was broadcasted in the future. Allow 120 sec clock sync
  if (now < timestamp - BROADCAST_CLOCK_SKEW_MS) {
    log.error('VerifyBroadcast: Message from future, rejecting');
    return VerifyResult.MALFORMED;
  }

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

  let error = '';
  let target = '';

  switch (msgType) {
    case 'fluxapprunning':
      target = payload.ip;
      // most of invalids are caused because our deterministic list is cached for couple of minutes
      error = `Invalid fluxapprunning message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxappinstalling':
      target = payload.ip;
      error = `Invalid fluxappinstalling message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxappinstallingerror':
      target = payload.ip;
      error = `Invalid fluxappinstallingerror message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxipchanged':
      target = payload.oldIP;
      error = `Invalid fluxipchanged message, oldIP: ${payload.oldIP} pubkey: ${pubKey}`;
      break;

    case 'fluxappremoved':
      target = payload.ip;
      error = `Invalid fluxappremoved message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxnodesigterm':
      target = payload.ip;
      error = `Invalid fluxnodesigterm message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    // zelappregister zelappupdate fluxappregister fluxappupdate fluxapprequest
    default: {
      // this used to just take the first node. I.e:
      //   node = zl.find((key) => key.pubkey === pubKey);
      // however, that doesn't prove anything. So if we find the pubkey, good enough
      // ideally - every message should also have the source ip
      target = await networkStateService.getFluxnodesByPubkey(pubKey);
      error = `No node belonging to ${pubKey} found for ${msgType}`;
    }
  }

  // no public key found in cache
  if (target === null) {
    log.warn(error);
    return VerifyResult.NODE_NOT_FOUND;
  }

  // if we get a map, we have hit the default case and searched for pubkeys
  if (target instanceof Map) {
    // default case: already verified pubkey exists in network
  } else {
    const listed = await listedSignerVerdict(signerAddresses(payload, target), pubKey);
    if (listed === VerifyResult.NODE_NOT_FOUND) {
      log.warn(error);
      return listed;
    }
    if (listed === VerifyResult.PUBKEY_MISMATCH) {
      log.warn(`Sender pubkey ${pubKey} does not match node at ${target}`);
      return listed;
    }
  }

  const messageToVerify = version + message + timestamp;
  const verified = verificationHelper.verifyMessage(
    messageToVerify,
    pubKey,
    signature,
  );

  return verified ? VerifyResult.OK : VerifyResult.BAD_SIGNATURE;
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
  signerAddresses,
  lastSignerAt,
  listedSignerVerdict,
  getNodeCount,
  verifyTimestampInFluxBroadcast,
  verifyOriginalFluxBroadcast,
  deterministicFluxList,
  socketAddressInFluxList,
  getFluxnodeFromFluxList,
  verifyFluxBroadcast,
};
