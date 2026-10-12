// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { moveNodeAddress } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress } from '../framework/daemon-control.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp, waitForAppRemoved } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { placeSilentPrimaryApp, A, B, C } from '../framework/silent-primary.js';
import { peerDeathMs } from '../framework/coupled-knobs.js';

// The primary's public address moves. FDM names a primary by IP and goes on
// naming the address it left; here it never follows, so every election pass on
// the primary reads FDM naming its old address. The primary keeps the app: that
// address is its own, by the move it recorded. Its peers hear the move once it
// has peers at the new address, and follow it there - so when it later gives
// the app up, the standby asks it where it is now and takes over.
//
// The move is real (moveNodeAddress): the old address leaves the node's
// interface, so every connection made to it goes dead, as it does when a
// router's public IP changes. It follows production's order: the node detects
// the move (suite 56 measured 4m12s), benchmark then reports the new address as
// its own while the network still lists the old one, and the list catches up
// last, once the node's confirmation is on chain.
//
// Production notices a move while the connections made to the old address are
// still counted: detection took 28s on 2026-10-11, and a dead connection stays
// counted for peerDeathMs, 60s at production's settings. The shared harness
// fleet compresses peer liveness to seconds and leaves detection at minutes,
// which inverts that. This fleet keeps production's order instead - liveness
// longer than the detection budget - and the suite checks that every dead
// connection was still counted when the move was noticed.
//
// A = the standby, B = the primary, C = a bystander the discovery ring needs.

const SIGTERM_EXPIRY_S = 120;
const DETECTION_MS = 6 * 60 * 1000;
const ADDRESS_MOVE_PEERS = Object.freeze({ wsPingIntervalMs: 120000, wsMaxMissedPongs: 3 });
if (peerDeathMs(ADDRESS_MOVE_PEERS) <= DETECTION_MS) {
  throw new Error('2222: peer liveness must outlast the detection budget, or the move is noticed after its dead connections are gone');
}
// Election passes after the move in which the primary could stand down: FDM
// names its old address on every one of them.
const PASSES_WATCHED_MS = 3 * 60 * 1000;
const TAKEOVER_MS = 6 * 60 * 1000;

describe('a primary whose address moves keeps the app', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2emoved${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  // The move the primary recorded in its own database, from its old address to
  // its new one; broadcastedAt is when it recorded it.
  const ownMove = async (oldSocket, newSocket) => (await dbClient(B + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
    .find((event) => event.data?.newIP === newSocket);
  let oldIp;
  let movedIp;
  let movedAt;

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({
      hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S, peers: ADDRESS_MOVE_PEERS,
    });
    oldIp = client(B).ip;
    movedIp = oldIp.replace(/\.\d+$/, '.240');
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await clearNodeAddress(oldIp).catch(() => {});
    await resetFdm().catch(() => {});
    await fleet?.env.teardown();
  });

  it('runs on at its new address while FDM names the one it left', async function () {
    this.timeout(DETECTION_MS + PASSES_WATCHED_MS + 180000);
    movedAt = Date.now();
    await moveNodeAddress(client(B).container, movedIp, oldIp);
    const followed = await client(B).followTo(movedIp);
    await setNodeAddress(oldIp, movedIp, { scope: 'publicip' });

    // A node that detects its move restarts its apps for the new address.
    const restarted = (d) => d.identifier === fleet.identifier && d.action === 'restarted';
    await client(B).waitForEvent('reconciler:actuated', restarted, DETECTION_MS, { afterId: followed });
    // Benchmark now reports the new address as the node's own; the network still
    // lists it at the old one until its confirmation is on chain.
    await setNodeAddress(oldIp, movedIp, { scope: 'benchmark' });
    await new Promise((resolve) => { setTimeout(resolve, PASSES_WATCHED_MS); });
    await waitForUp(client(B), appName, 'the primary runs the app at its new address', { timeout: 120000, interval: 3000 });

    // The stream reaches past the passes watched, so a change of role in them
    // would be in the buffer.
    await client(B).waitForEvent('syncthing:passComplete', () => true, 120000, { afterId: client(B).getLastEventId() });
    expect(client(B).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > followed
      && e.data.identifier === fleet.identifier && e.data.from === 'primary'),
      'the primary gave up its role for the address it left').to.deep.equal([]);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });

  it('is heard moving by every peer', async function () {
    this.timeout(300000);
    const oldSocket = socketAddr(B + 1);
    const newSocket = `${movedIp}:16127`;

    // The move was noticed while the connections made to the old address were
    // still counted: none had been dropped between the move and its detection.
    const move = await ownMove(oldSocket, newSocket);
    expect(move, 'the primary recorded its own move').to.not.equal(undefined);
    const detectedAt = move.data.broadcastedAt;
    const auth = await authenticate(client(B).url, fluxTeamKey());
    const history = (await client(B).getAuthed('/flux/peerhistory', auth.zelidauth)).data;
    expect(history.some((e) => e.event === 'connected' && e.timestamp < movedAt), 'fixture: the primary had peers before the move').to.equal(true);
    expect(history.filter((e) => e.event === 'disconnected' && e.timestamp >= movedAt && e.timestamp < detectedAt),
      'fixture: connections dropped between the move and its detection').to.deep.equal([]);
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);

    await waitFor(async () => (await heldMove(A)) && (await heldMove(C)), {
      timeout: 240000, interval: 5000, label: 'every peer holds the move',
    });
  });

  it('is followed to its new address, so the standby takes over once it gives the app up there', async function () {
    this.timeout(TAKEOVER_MS + 240000);
    // The chain has caught up: the network lists the primary at its new address,
    // which is what a signed answer from there is checked against.
    await setNodeAddress(oldIp, movedIp, { scope: 'all' });
    await clearMaster(appName);
    const auth = await authenticate(client(B).url, fluxTeamKey());
    const res = await fetch(`${client(B).url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(client(B), appName, 180000);

    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: TAKEOVER_MS, interval: 3000 });
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
