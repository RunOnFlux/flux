// weight: heavy
/*
 * A primary beside a fluxd that decides its address (fluxd 9.2.0) keeps the app
 * when its address moves. FluxOS takes the node's address from fluxd's
 * decided_address, so fluxd reporting the new one is what starts the move; FDM
 * goes on naming the old address throughout.
 *
 * The primary is held inside its move, once it has recorded it and before it acts
 * on it, while the election passes on it: each pass reads FDM naming the old
 * address against the node's own address and its location rows, which agree with
 * each other whichever side of the move they are read on.
 *
 * A = the standby, B = the primary, C = a bystander the discovery ring needs.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { moveNodeAddress } from '../framework/container.js';
import { setDecidedAddress } from '../framework/daemon-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { waitForUp, waitForElectionDecisions, electionDecisionCount } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { placeSilentPrimaryApp, B } from '../framework/silent-primary.js';

const SIGTERM_EXPIRY_S = 120;
// fluxd's answer is read through FluxOS's call cache and the node's address cache.
const DETECTION_MS = 3 * 60 * 1000;
// Election passes on the primary while it is held inside its move.
const PASSES_HELD = 3;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';

describe('a primary whose fluxd decides its new address keeps the app', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2edecided${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  let oldIp;
  let movedIp;

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    oldIp = client(B).ip;
    movedIp = oldIp.replace(/\.\d+$/, '.241');
    await setDecidedAddress(oldIp, oldIp);
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await setDecidedAddress(oldIp, null).catch(() => {});
    await resetFdm().catch(() => {});
    await fleet?.env.teardown();
  });

  it('keeps its role through its move while FDM names the address it left', async function () {
    this.timeout(DETECTION_MS + 300000);
    const movedSocket = `${movedIp}:16127`;
    await client(B).holdCheckpoint(BEFORE_RECONCILE, movedSocket);
    const beforeMove = client(B).getLastEventId();
    await moveNodeAddress(client(B).container, movedIp, oldIp);
    const followed = await client(B).followTo(movedIp);
    await setDecidedAddress(oldIp, movedIp);

    await client(B).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === movedSocket, DETECTION_MS, { afterId: beforeMove });
    const observed = await electionDecisionCount(client(B), fleet.identifier, 'primaryObserved');
    await waitForElectionDecisions(client(B), fleet.identifier, 'primaryObserved', PASSES_HELD, { from: observed, timeout: 60000 });
    expect(client(B).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > beforeMove
      && e.data.identifier === fleet.identifier && e.data.from === 'primary'),
      'the primary gave up its role while held inside its move').to.deep.equal([]);
    await client(B).releaseCheckpoint(BEFORE_RECONCILE, movedSocket);

    // A node that detects its move restarts its apps for the new address.
    const restarted = (d) => d.identifier === fleet.identifier && d.action === 'restarted';
    await client(B).waitForEvent('reconciler:actuated', restarted, 120000, { afterId: followed });
    await waitForUp(client(B), appName, 'the primary runs the app at its new address', { timeout: 120000, interval: 3000 });
    expect(client(B).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > beforeMove
      && e.data.identifier === fleet.identifier && e.data.from === 'primary'),
      'the primary gave up its role for the address it left').to.deep.equal([]);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
