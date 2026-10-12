// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { moveNodeAddress } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress, getJournal } from '../framework/daemon-control.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp, waitForAppRemoved } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { placeSilentPrimaryApp, A, B, C } from '../framework/silent-primary.js';
import { peerDeathMs } from '../framework/coupled-knobs.js';

// The standby's public address moves. The primary goes on running the app and
// nothing starts beside it; the standby's peers hear the move, and the standby
// still holds the app's data at its new address. When the primary later gives
// the app up, the standby takes it over from where it now is.
//
// The move follows production's order, as 2222's does, with peer liveness kept
// longer than the detection budget.
//
// A = the standby, B = the primary, C = a bystander the discovery ring needs.

const SIGTERM_EXPIRY_S = 120;
const DETECTION_MS = 6 * 60 * 1000;
const ADDRESS_MOVE_PEERS = Object.freeze({ wsPingIntervalMs: 120000, wsMaxMissedPongs: 3 });
if (peerDeathMs(ADDRESS_MOVE_PEERS) <= DETECTION_MS) {
  throw new Error('2229: peer liveness must outlast the detection budget, or the move is noticed after its dead connections are gone');
}
// Election passes after the move in which the standby could start beside the primary.
const PASSES_WATCHED_MS = 3 * 60 * 1000;
const TAKEOVER_MS = 6 * 60 * 1000;

describe('a standby whose address moves still takes over', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2emovedstandby${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  let oldIp;
  let movedIp;

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({
      hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S, peers: ADDRESS_MOVE_PEERS,
    });
    oldIp = client(A).ip;
    movedIp = oldIp.replace(/\.\d+$/, '.240');
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await clearNodeAddress(oldIp).catch(() => {});
    await resetFdm().catch(() => {});
    await fleet?.env.teardown();
  });

  it('leaves the primary running alone while it moves', async function () {
    this.timeout(DETECTION_MS + PASSES_WATCHED_MS + 240000);
    await moveNodeAddress(client(A).container, movedIp, oldIp);
    await client(A).followTo(movedIp);
    await setNodeAddress(oldIp, movedIp, { scope: 'publicip' });
    // A node that detects its move asks for its new address to be confirmed.
    const confirmed = async () => (await getJournal({ method: 'createconfirmationtransaction', sourceIp: movedIp })).total > 0;
    await waitFor(confirmed, { timeout: DETECTION_MS, interval: 5000, label: 'the standby detects its move' });
    await setNodeAddress(oldIp, movedIp, { scope: 'benchmark' });
    // The chain has caught up: the network lists the standby at its new address.
    await setNodeAddress(oldIp, movedIp, { scope: 'all' });
    await new Promise((resolve) => { setTimeout(resolve, PASSES_WATCHED_MS); });

    await waitForUp(client(B), appName, 'the primary runs the app', { timeout: 60000, interval: 3000 });
    expect(await fleet.isUp(A), 'the standby runs the app beside the primary').to.equal(false);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });

  it('is heard moving by every peer', async function () {
    this.timeout(300000);
    const oldSocket = socketAddr(A + 1);
    const newSocket = `${movedIp}:16127`;
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);
    await waitFor(async () => (await heldMove(A)) && (await heldMove(B)) && (await heldMove(C)), {
      timeout: 240000, interval: 5000, label: 'the standby and every peer hold the move',
    });
  });

  it('takes the app over from its new address once the primary gives it up', async function () {
    this.timeout(TAKEOVER_MS + 240000);
    await clearMaster(appName);
    const auth = await authenticate(client(B).url, fluxTeamKey());
    const res = await fetch(`${client(B).url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(client(B), appName, 180000);

    await waitForUp(client(A), appName, 'the moved standby runs the app', { timeout: TAKEOVER_MS, interval: 3000 });
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
