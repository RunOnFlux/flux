// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { crashFluxos, moveNodeAddress, stopAppContainer } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress } from '../framework/daemon-control.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { placeSilentPrimaryApp, A, B, C } from '../framework/silent-primary.js';
import { peerDeathMs } from '../framework/coupled-knobs.js';

// The primary's public address moves, the network catches up with it, and then
// the machine dies: no shutdown announcement, its app and its syncthing gone
// with it. The standby judges the silent primary at the address it moved to and
// takes the app over, as it would for a primary that never moved.
//
// The move follows production's order, as 2222's does: the node detects it, its
// peers hear it, and the list catches up last. Peer liveness is kept longer than
// the detection budget for the same reason 2222 keeps it.
//
// A = the standby, B = the primary, C = a bystander the discovery ring needs.

const SIGTERM_EXPIRY_S = 120;
const DETECTION_MS = 6 * 60 * 1000;
const ADDRESS_MOVE_PEERS = Object.freeze({ wsPingIntervalMs: 120000, wsMaxMissedPongs: 3 });
if (peerDeathMs(ADDRESS_MOVE_PEERS) <= DETECTION_MS) {
  throw new Error('2228: peer liveness must outlast the detection budget, or the move is noticed after its dead connections are gone');
}
// A machine that dies closes none of its connections, so the standby's syncthing
// holds them until its own receive timeout (5 min, not compressed by the harness)
// and the standby rightly refuses to start while it does. Then a few election
// passes and a container start.
const SYNCTHING_DEAD_CONNECTION_MS = 5 * 60 * 1000;
const TAKEOVER_MS = SYNCTHING_DEAD_CONNECTION_MS + 4 * 60 * 1000;

describe('a primary that moved and then died is taken over', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2emoveddied${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  let oldIp;
  let movedIp;

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

  it('keeps the app through the move', async function () {
    this.timeout(DETECTION_MS + 240000);
    await moveNodeAddress(client(B).container, movedIp, oldIp);
    const followed = await client(B).followTo(movedIp);
    await setNodeAddress(oldIp, movedIp, { scope: 'publicip' });
    // A node that detects its move restarts its apps for the new address.
    const restarted = (d) => d.identifier === fleet.identifier && d.action === 'restarted';
    await client(B).waitForEvent('reconciler:actuated', restarted, DETECTION_MS, { afterId: followed });
    await setNodeAddress(oldIp, movedIp, { scope: 'benchmark' });
    // The chain has caught up: the network lists the primary at its new address.
    await setNodeAddress(oldIp, movedIp, { scope: 'all' });
    await waitForUp(client(B), appName, 'the primary runs the app at its new address', { timeout: 120000, interval: 3000 });
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });

  it('is heard moving by every peer', async function () {
    this.timeout(300000);
    const oldSocket = socketAddr(B + 1);
    const newSocket = `${movedIp}:16127`;
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);
    await waitFor(async () => (await heldMove(A)) && (await heldMove(C)), {
      timeout: 240000, interval: 5000, label: 'every peer holds the move',
    });
  });

  it('is taken over by the standby once it dies at its new address', async function () {
    this.timeout(TAKEOVER_MS + 180000);
    const goneFrom = await fleet.verdicts(A, 'gone');
    const standbyFrom = client(A).getLastEventId();

    // The machine dies: FluxOS, the app and its connections, with no announcement.
    await crashFluxos(client(B).container, { hold: true });
    await stopAppContainer(client(B).container, appName, appName);
    await fleet.env.disconnectNode(B);
    await clearMaster(appName);

    await client(A).waitForEvent('primaryRole:changed', (d) => d.identifier === fleet.identifier && d.to === 'promoting',
      TAKEOVER_MS, { afterId: standbyFrom });
    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: 180000, interval: 3000 });
    expect(await fleet.verdicts(A, 'gone'), 'the standby judged the moved primary gone').to.be.above(goneFrom);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
