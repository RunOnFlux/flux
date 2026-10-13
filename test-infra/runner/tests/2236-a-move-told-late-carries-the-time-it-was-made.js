// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { blockTraffic, moveNodeAddress, unblockTraffic } from '../framework/container.js';
import { clearNodeAddress, setNodeAddress } from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node moves while none of its peers can reach it, and they hear the move
// only once it has been signed again for the relay window: a move is re-signed
// once its copy is OWN_MOVE_RESIGN_MS (120s) old. The time a move was made
// decides which rows it carries and where it falls among the node's moves, so
// every copy carries the time the node recorded, however late it is told.

const MOVER = 0;
const PEERS = [1, 2];
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
// Past the 120s after which a move is signed again.
const UNHEARD_MS = 150 * 1000;

describe('a move told late carries the time it was made', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let fromIp;
  let blocked = false;
  const client = (i) => env.clients[i];
  const peerIps = () => PEERS.map((i) => client(i).ip);
  const moveHeldBy = async (i, oldSocket, newSocket) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    fromIp = client(MOVER).ip;
  });

  after(async function () {
    this.timeout(60000);
    if (blocked) await unblockTraffic(client(MOVER).container, peerIps(), API_PORT).catch(() => {});
    await clearNodeAddress(fromIp).catch(() => {});
    await env?.teardown();
  });

  it('reaches every peer with the time the node recorded', async function () {
    this.timeout(DETECTION_MS + UNHEARD_MS + 360000);
    const toIp = fromIp.replace(/\.\d+$/, '.240');
    const oldSocket = `${fromIp}:${API_PORT}`;
    const newSocket = `${toIp}:${API_PORT}`;

    await blockTraffic(client(MOVER).container, peerIps(), API_PORT);
    blocked = true;
    await moveNodeAddress(client(MOVER).container, toIp, fromIp);
    await client(MOVER).followTo(toIp);
    await setNodeAddress(fromIp, toIp, { scope: 'benchmark' });

    let recorded;
    await waitFor(async () => { recorded = await moveHeldBy(MOVER, oldSocket, newSocket); return Boolean(recorded); }, {
      timeout: DETECTION_MS, interval: 5000, label: 'the node records its own move',
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const i of PEERS) {
      // eslint-disable-next-line no-await-in-loop
      expect(await moveHeldBy(i, oldSocket, newSocket), `fixture: node ${i} heard the move while it could not reach the node`).to.equal(undefined);
    }
    await new Promise((resolve) => { setTimeout(resolve, UNHEARD_MS); });
    await unblockTraffic(client(MOVER).container, peerIps(), API_PORT);
    blocked = false;

    // eslint-disable-next-line no-restricted-syntax
    for (const i of PEERS) {
      let held;
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => { held = await moveHeldBy(i, oldSocket, newSocket); return Boolean(held); }, {
        timeout: 240000, interval: 5000, label: `node ${i} holds the move`,
      });
      expect(held.data.broadcastedAt, `the time node ${i} holds for the move`).to.equal(recorded.data.broadcastedAt);
    }
  });
});
