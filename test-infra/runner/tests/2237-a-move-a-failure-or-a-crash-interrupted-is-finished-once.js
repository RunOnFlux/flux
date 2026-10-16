// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  configuredIpOf, crashFluxos, moveNodeAddress, releaseFluxos,
} from '../framework/container.js';
import {
  clearNodeAddress, clearRpcFailures, failRpc, getJournal, holdRpc, releaseRpc, setNodeAddress,
} from '../framework/daemon-control.js';
import { askToBeDialed } from '../framework/peer-topology.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node's move of its own address is recorded once, before anything acts on
// it, and finished by a reconcile that runs on each node list refresh. A
// confirmation the daemon refuses is asked for again on a later pass; a node
// that stops after recording the move and before acting on it finishes the
// move once it is back. Either way the move is counted once and told with the
// time it was recorded.
//
// Node 0 has its confirmation refused once; node 1 is crashed between
// recording its move and acting on it. Node 2 is a bystander that holds the
// events and reads the list.
//
// Node 1 runs no app, so a peer that hears its move once the chain lists it at
// the new address only has nothing to prove the move by, and drops it. Once it
// is back its confirmation is held, and it is asked to dial the bystander, until
// the bystander holds the move.

const REFUSED = 0;
const CRASHED = 1;
const BYSTANDER = 2;
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
const LISTED_MS = 4 * 60 * 1000;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';

describe('a move a failure or a crash interrupted is finished once', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const moved = [];
  const failing = [];
  const holding = [];
  const client = (i) => env.clients[i];
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:${API_PORT}`);
  const nodeList = async () => (await client(BYSTANDER).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`)).data || [];
  const keyOf = async (i) => (await nodeList()).find((node) => socketOf(node.ip) === socketOf(client(i).ip)).pubkey;
  const listedAt = async (pubkey) => {
    const own = (await nodeList()).find((node) => node.pubkey === pubkey);
    return own ? socketOf(own.ip) : null;
  };

  // Moves node i's address as a router's change does, and has benchmark report
  // the new one while the chain still lists the old.
  async function move(i, to) {
    const from = client(i).ip;
    moved.push(from);
    await moveNodeAddress(client(i).container, to, from);
    await client(i).followTo(to);
    await setNodeAddress(from, to, { scope: 'benchmark' });
    return { from: socketOf(from), to: socketOf(to) };
  }

  // The move the bystander holds from node i's old address.
  async function bystanderHolds(i, { from, to }) {
    let held;
    await waitFor(async () => {
      held = (await dbClient(BYSTANDER + 1).getAppStateEvents({ ip: from, type: 'ipchanged' }))
        .find((event) => event.data?.newIP === to);
      return Boolean(held);
    }, { timeout: 180000, interval: 5000, label: `the bystander holds node ${i}'s move` });
    return held;
  }

  // The move as the node recorded it, the move the bystander holds from its old
  // address, and where the list has it.
  async function expectFinishedOnce(i, { from, to }, pubkey) {
    await waitFor(async () => (await listedAt(pubkey)) === to, {
      timeout: LISTED_MS, interval: 5000, label: `node ${i} listed at its new address`,
    });
    const record = await dbClient(i + 1).ownAddressRecord();
    expect(record.socketAddress, `node ${i}'s recorded address`).to.equal(to);
    expect(record.ipChangeHeights, `node ${i}'s IP changes counted`).to.have.lengthOf(1);
    const held = await bystanderHolds(i, { from, to });
    expect(held.data.broadcastedAt, `the time node ${i}'s move is told with`).to.equal(record.movedAt);
    expect(await configuredIpOf(client(i).container), `node ${i}'s configured IP`).to.equal(to.split(':')[0]);
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all(moved.map((ip) => clearNodeAddress(ip).catch(() => {})));
    await Promise.all(failing.map((ip) => clearRpcFailures(ip).catch(() => {})));
    await Promise.all(holding.map((ip) => releaseRpc(ip).catch(() => {})));
    await env?.teardown();
  });

  it('asks again for a confirmation the daemon refused, and is listed at its new address', async function () {
    this.timeout(DETECTION_MS + LISTED_MS + 180000);
    const pubkey = await keyOf(REFUSED);
    const fromIp = client(REFUSED).ip;
    const toIp = fromIp.replace(/\.\d+$/, '.240');
    // The daemon knows a node by the address its calls come from, which is the
    // new one once the address has moved.
    failing.push(toIp);
    await failRpc(toIp, 'createconfirmationtransaction', { times: 1 });
    const addresses = await move(REFUSED, toIp);

    await expectFinishedOnce(REFUSED, addresses, pubkey);
    const asked = (await getJournal({ method: 'createconfirmationtransaction' })).entries
      .filter((entry) => [fromIp, toIp].includes(entry.sourceIp));
    expect(asked.length, 'confirmations asked for: the refused one, then the one that listed it').to.be.at.least(2);
  });

  it('finishes a move it recorded and was stopped before acting on, once it is back', async function () {
    this.timeout(DETECTION_MS + LISTED_MS + 300000);
    const pubkey = await keyOf(CRASHED);
    const toIp = client(CRASHED).ip.replace(/\.\d+$/, '.241');
    const node = client(CRASHED);
    await node.holdCheckpoint(BEFORE_RECONCILE, socketOf(toIp));
    const anchor = node.getLastEventId();
    const addresses = await move(CRASHED, toIp);

    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === addresses.to, DETECTION_MS, { afterId: anchor });
    expect((await dbClient(CRASHED + 1).ownAddressRecord()).socketAddress, 'fixture: the move recorded before the crash').to.equal(addresses.to);
    await crashFluxos(node.container, { hold: true });
    // The daemon knows a node by the address its calls come from.
    holding.push(toIp);
    await holdRpc(toIp, 'createconfirmationtransaction');
    const bystander = client(BYSTANDER);
    const peeredAnchor = bystander.getLastEventId();
    await releaseFluxos(node.container);
    // A node tells its move to each peer as it connects.
    await waitFor(async () => askToBeDialed(bystander, node, API_PORT).then(() => true, () => false), {
      timeout: 180000, interval: 5000, label: `node ${CRASHED} takes the bystander's ask to be dialed`,
    });
    await bystander.waitForEvent('peers:added', (d) => d.ip === toIp, 120000, { afterId: peeredAnchor });

    await bystanderHolds(CRASHED, addresses);
    expect(await listedAt(pubkey), 'fixture: the bystander heard the move with the chain listing the old address').to.equal(addresses.from);
    await releaseRpc(toIp);
    await expectFinishedOnce(CRASHED, addresses, pubkey);
  });
});
