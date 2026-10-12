// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { crashFluxos, stopAppContainer } from '../framework/container.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { placeSilentPrimaryApp, A, B, C } from '../framework/silent-primary.js';

// A second machine starts on the collateral of a single-writer app's primary. It
// is not listed - the network lists the collateral at the primary - and while the
// primary answers it holds itself out of service: it runs nothing, the primary
// and the standby carry on, and nobody hears of a move. When the primary's
// machine dies, the app goes to the standby, which holds its data, and the
// collateral to the second machine; that is not a move of the primary, so no
// move is announced.
//
// A = the standby, B = the primary, C = a bystander, COPY = the second machine.

const COPY = 3;
const SIGTERM_EXPIRY_S = 120;
// A machine that dies closes none of its connections, so the standby's syncthing
// holds them until its own receive timeout (5 min, not compressed by the harness).
const SYNCTHING_DEAD_CONNECTION_MS = 5 * 60 * 1000;
const TAKEOVER_MS = SYNCTHING_DEAD_CONNECTION_MS + 4 * 60 * 1000;
// The collision check's grace and the confirmation's block, from the primary's death.
const COLLATERAL_MS = 6 * 60 * 1000;

describe('a second machine on a primary\'s collateral', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2ecopyprimary${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  const listedAt = (i) => socketAddr(i + 1);
  const collateralAt = async () => {
    const list = await client(C).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`);
    const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:16127`);
    return (list.data || []).map((node) => socketOf(node.ip)).find((ip) => ip === listedAt(B) || ip === listedAt(COPY)) ?? null;
  };
  const movesOf = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: listedAt(B), type: 'ipchanged' }));

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({
      hookCtx: this,
      appName,
      sigtermExpiryS: SIGTERM_EXPIRY_S,
      env: { nodes: 4, deferredNodes: 1, collateralOf: { [COPY + 1]: B + 1 } },
    });
    await fleet.env.startNode(COPY);
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await resetFdm().catch(() => {});
    await fleet?.env.teardown();
  });

  it('holds itself out of service while the primary answers, and leaves the app to it', async function () {
    this.timeout(420000);
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState >= 100, {
      timeout: 360000, interval: 5000, label: 'the second machine holds itself out of service',
    });

    expect(await collateralAt(), 'the collateral is listed at the primary').to.equal(listedAt(B));
    await waitForUp(client(B), appName, 'the primary runs the app', { timeout: 60000, interval: 3000 });
    expect(await fleet.isUp(COPY), 'the second machine runs the app').to.equal(false);
    expect(await movesOf(A), 'moves of the primary the standby holds').to.deep.equal([]);
    expect(await movesOf(C), 'moves of the primary the bystander holds').to.deep.equal([]);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });

  it('when the primary dies, gives the app to the standby and takes the collateral, announcing no move', async function () {
    this.timeout(TAKEOVER_MS + COLLATERAL_MS + 120000);
    const standbyFrom = client(A).getLastEventId();

    // The primary's machine dies: FluxOS, the app and its connections, with no announcement.
    await crashFluxos(client(B).container, { hold: true });
    await stopAppContainer(client(B).container, appName, appName);
    await fleet.env.disconnectNode(B);
    await clearMaster(appName);

    await client(A).waitForEvent('primaryRole:changed', (d) => d.identifier === fleet.identifier && d.to === 'promoting',
      TAKEOVER_MS, { afterId: standbyFrom });
    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: 180000, interval: 3000 });
    await waitFor(async () => (await collateralAt()) === listedAt(COPY), {
      timeout: COLLATERAL_MS, interval: 5000, label: 'the collateral listed at the second machine',
    });
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState === 0, {
      timeout: 180000, interval: 5000, label: 'the second machine back in service',
    });

    expect(await fleet.isUp(COPY), 'the second machine runs the app').to.equal(false);
    expect(await movesOf(A), 'moves of the primary the standby holds').to.deep.equal([]);
    expect(await movesOf(C), 'moves of the primary the bystander holds').to.deep.equal([]);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
