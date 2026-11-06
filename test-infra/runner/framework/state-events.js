// App state events built the way a node stores them in `appstateevents`, so a
// suite can seed them into a serving node's database and have a syncing node
// receive them exactly as it would from the network.
//
// The signed ones carry an envelope made with the sending node's key over
// version + JSON(data) + timestamp - the form every node verifies - and
// `signedBy` lets one carry another node's signature, the shape a forged event
// has on the wire. Evictions are unsigned: a node makes them locally, and
// createdAt is when it made the call.
import { nodeKey } from './keys.js';
import { signBtcMessage } from '../auth.js';
import { getSubnetConfig } from './subnet-config.js';

export const socketAddr = (nodeNum) => `${getSubnetConfig().nodeIp(nodeNum)}:16127`;

async function envelopeFor(nodeNum, data, broadcastedAt, signedBy) {
  const version = 1;
  const payload = String(version) + JSON.stringify(data) + String(broadcastedAt);
  const signature = await signBtcMessage(payload, nodeKey(signedBy).privkey);
  return {
    version, timestamp: broadcastedAt, pubKey: nodeKey(nodeNum).pubkey, signature,
  };
}

// A v2 apprunning broadcast: the node runs `apps`, as of broadcastedAt. An app
// named by a string gets a hash and a runningSince; one given as an object is
// sent as it is, so an entry a node refuses can be built.
// `ip` is where it announced from, its own address unless given; `expireAt`
// is set only when given, as a node's store sets it.
export async function apprunningEvent({
  nodeNum, apps, broadcastedAt, dedupKey = 'v2', signedBy = nodeNum, ip = socketAddr(nodeNum), expireAt,
}) {
  const data = {
    type: 'fluxapprunning',
    version: 2,
    apps: apps.map((app) => (typeof app === 'string' ? {
      name: app,
      hash: `hash-${app}`,
      runningSince: new Date(broadcastedAt).toISOString(),
    } : app)),
    ip,
    broadcastedAt,
    osUptime: 10000,
    staticIp: false,
  };
  return {
    type: 'apprunning',
    dedupKey,
    ip,
    broadcastedAt: new Date(broadcastedAt),
    ...(expireAt === undefined ? {} : { expireAt: new Date(expireAt) }),
    envelope: await envelopeFor(nodeNum, data, broadcastedAt, signedBy),
    data,
  };
}

// The node announced it is shutting down, at broadcastedAt.
export async function sigtermEvent({ nodeNum, broadcastedAt, signedBy = nodeNum }) {
  const ip = socketAddr(nodeNum);
  const data = {
    type: 'fluxnodesigterm', version: 1, ip, broadcastedAt,
  };
  return {
    type: 'sigterm',
    dedupKey: 'sigterm',
    ip,
    broadcastedAt: new Date(broadcastedAt),
    envelope: await envelopeFor(nodeNum, data, broadcastedAt, signedBy),
    data,
  };
}

// The node announced it removed appName, at broadcastedAt.
export async function appRemovedEvent({
  nodeNum, appName, broadcastedAt, signedBy = nodeNum,
}) {
  const ip = socketAddr(nodeNum);
  const data = {
    type: 'fluxappremoved', version: 1, appName, ip, broadcastedAt,
  };
  return {
    type: 'appremoved',
    dedupKey: `appremoved:${appName}`,
    ip,
    broadcastedAt: new Date(broadcastedAt),
    envelope: await envelopeFor(nodeNum, data, broadcastedAt, signedBy),
    data,
  };
}

// A move from node nodeNum's address to `newIP`, at broadcastedAt, sent by
// `sentBy`: the key the envelope names and signs with.
export async function ipchangedEvent({
  nodeNum, newIP, broadcastedAt, sentBy = nodeNum,
}) {
  const oldIP = socketAddr(nodeNum);
  const data = {
    type: 'fluxipchanged', version: 1, oldIP, newIP, broadcastedAt,
  };
  return {
    type: 'ipchanged',
    dedupKey: 'ipchanged',
    ip: oldIP,
    broadcastedAt: new Date(broadcastedAt),
    envelope: await envelopeFor(sentBy, data, broadcastedAt, sentBy),
    data,
  };
}

// Some node judged this one gone, at createdAt. Carries no broadcastedAt, so a
// serving node's timestamp sort puts it at the front of a sync response.
export function evictedEvent({ nodeNum, createdAt }) {
  return {
    type: 'evicted',
    ip: socketAddr(nodeNum),
    dedupKey: 'evicted',
    createdAt: new Date(createdAt),
  };
}
