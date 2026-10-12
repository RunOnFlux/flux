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

// The primary's public address moves. FDM names a primary by IP and goes on
// naming the address it left; here it never follows, so every election pass on
// the primary reads FDM naming its old address. The primary keeps the app: that
// address is its own, by the move it recorded. Its peers hear the move once it
// has peers at the new address, and follow it there - so when it later gives
// the app up, the standby asks it where it is now and takes over.
//
// The move is real (moveNodeAddress): the old address leaves the node's
// interface, so every connection made to it goes dead, as it does when a
// router's public IP changes. Detection takes several availability cycles
// (suite 56 measured 4m12s).
//
// A = the standby, B = the primary, C = a bystander the discovery ring needs.

const SIGTERM_EXPIRY_S = 120;
const DETECTION_MS = 8 * 60 * 1000;
// Election passes after the move in which the primary could stand down: FDM
// names its old address on every one of them.
const PASSES_WATCHED_MS = 3 * 60 * 1000;
const TAKEOVER_MS = 6 * 60 * 1000;

describe('a primary whose address moves keeps the app', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2emoved${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  const linesOf = (i) => fleet.env.nodeDiagnostics().find((n) => n.index === i)?.lines ?? [];
  let oldIp;
  let movedIp;

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
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

  it('runs on at its new address while FDM names the one it left, and every peer hears the move', async function () {
    this.timeout(DETECTION_MS + PASSES_WATCHED_MS + 120000);
    const oldSocket = socketAddr(B + 1);
    const newSocket = `${movedIp}:16127`;
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);

    await moveNodeAddress(client(B).container, movedIp, oldIp);
    await client(B).followTo(movedIp);
    await setNodeAddress(oldIp, movedIp, { scope: 'publicip' });

    await waitFor(() => heldMove(B), { timeout: DETECTION_MS, interval: 5000, label: 'the primary records its own move' });
    const recordedAt = Date.now();
    await waitFor(async () => (await heldMove(A)) && (await heldMove(C)), {
      timeout: 240000, interval: 5000, label: 'every peer holds the move',
    });

    const remaining = PASSES_WATCHED_MS - (Date.now() - recordedAt);
    if (remaining > 0) await new Promise((resolve) => { setTimeout(resolve, remaining); });
    await waitForUp(client(B), appName, 'the primary runs the app at its new address', { timeout: 120000, interval: 3000 });

    expect(linesOf(B).some((line) => line.includes(`New public Ip detected: ${newSocket}`)),
      'canary: the primary\'s log after the move was read').to.equal(true);
    expect(linesOf(B).filter((line) => line.includes(`standing down as primary of component:${fleet.identifier}`)),
      'the primary stood down for the address it left').to.deep.equal([]);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });

  it('is followed to its new address, so the standby takes over once it gives the app up there', async function () {
    this.timeout(TAKEOVER_MS + 240000);
    await clearMaster(appName);
    const auth = await authenticate(client(B).url, fluxTeamKey());
    const res = await fetch(`${client(B).url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(client(B), appName, 180000);

    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: TAKEOVER_MS, interval: 3000 });
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
