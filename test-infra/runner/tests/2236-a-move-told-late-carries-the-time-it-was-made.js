// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { moveNodeAddress } from '../framework/container.js';
import {
  clearNodeAddress, clearRpcFailures, failRpc, setNodeAddress,
} from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node moves, and its peers hear the move at once. A node that joins later is
// told the move then, from a copy signed again once the move is
// OWN_MOVE_RESIGN_MS (120s) old. The time a move was made decides which rows it
// carries and where it falls among the node's moves, so the late copy carries
// the time the node recorded, as the first ones did.
//
// The move's confirmation is refused for the whole case, so the chain lists the
// node at the address it left and the late node judges the move as the early
// ones did. The late node cannot dial the moved node there; the moved node dials
// it, as it does every node it can, and the late node peers with enough nodes to
// sync the app state they hold.
const MOVER = 0;
const PEERS = [1, 2];
const LATE = 3;
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
// Past the 120s after which a move is signed again.
const LATE_BY_MS = 150 * 1000;
// A move is sent, and applied, for as long as a location stands. Production's
// lifetime (125 min) outlasts the time before the late node joins by far; the
// shared harness fleet's 63s does not, and the move would expire first. This
// fleet keeps production's order.
const LOCATION_TTL_S = 30 * 60;
if (LOCATION_TTL_S * 1000 <= LATE_BY_MS) {
  throw new Error('2236: a location must outlive the time before the late node joins');
}

describe('a move told late carries the time it was made', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let fromIp;
  let toIp;
  const client = (i) => env.clients[i];
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:${API_PORT}`);
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);
  const listedAt = async (address) => ((await client(PEERS[0]).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`)).data ?? [])
    .some((node) => socketOf(node.ip) === address);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      deferredNodes: 1,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S } },
      nodeConfigOverrides: {
        [MOVER]: { fluxapps: { minOutgoing: 3 } },
        [LATE]: { fluxapps: { minOutgoing: 3 } },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    if (toIp) await clearRpcFailures(toIp).catch(() => {});
    if (fromIp) await clearNodeAddress(fromIp).catch(() => {});
    await env?.teardown();
  });

  it('reaches a node that joins after the move is signed again with the time the node recorded', async function () {
    this.timeout(DETECTION_MS + LATE_BY_MS + 600000);
    fromIp = client(MOVER).ip;
    toIp = fromIp.replace(/\.\d+$/, '.240');
    const oldSocket = socketOf(fromIp);
    const newSocket = socketOf(toIp);
    // The daemon knows a node by the address its requests arrive from.
    await failRpc(toIp, 'createconfirmationtransaction', { times: 10000 });

    await moveNodeAddress(client(MOVER).container, toIp, fromIp);
    await client(MOVER).followTo(toIp);
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });
    let recorded;
    await waitFor(async () => { recorded = await moveHeldBy(MOVER, oldSocket, newSocket); return Boolean(recorded); }, {
      timeout: DETECTION_MS, interval: 5000, label: 'the node records its own move',
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const p of PEERS) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(p, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 180000, interval: 5000, label: `node ${p} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${p} holds for the move`).to.equal(recorded.data.broadcastedAt);
    }

    const lateBy = recorded.data.broadcastedAt + LATE_BY_MS - Date.now();
    if (lateBy > 0) await new Promise((resolve) => { setTimeout(resolve, lateBy); });
    expect(await listedAt(oldSocket), 'fixture: the chain still lists the node at the address it left').to.equal(true);
    await env.startNode(LATE);

    let held;
    await waitFor(async () => { held = await moveHeldBy(LATE, oldSocket, newSocket); return Boolean(held); }, {
      timeout: 300000, interval: 5000, label: 'the late node holds the move',
    });
    expect(held.data.broadcastedAt, 'the time the late node holds for the move').to.equal(recorded.data.broadcastedAt);
    expect(Date.now() - recorded.data.broadcastedAt, 'fixture: the late node heard it past the re-sign').to.be.above(120000);
  });
});
