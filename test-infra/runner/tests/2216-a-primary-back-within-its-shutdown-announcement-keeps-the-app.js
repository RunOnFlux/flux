// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { releaseFluxos, shutdownFluxosGracefully } from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { startDaemon } from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { placeSilentPrimaryApp, A, B } from '../framework/silent-primary.js';

// A primary that announced its shutdown is rebooting until the announcement
// expires (sigtermExpiryS): its closed connection is the reboot. One back within
// it keeps the app, and the standby never takes it over.

const SIGTERM_EXPIRY_S = 120;

describe('a primary back within its shutdown announcement keeps the app', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2ereboot${Date.now()}`;
  const client = (i) => fleet.env.clients[i];

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await resetFdm().catch(() => {});
    await fleet?.env.teardown();
  });

  it('holds the standby back while the primary reboots, and the primary runs the app again', async function () {
    this.timeout(600000);
    const standbyFrom = client(A).getLastEventId();
    const restartingFrom = await fleet.verdicts(A, 'restarting');
    const shutdownAt = Date.now();

    await shutdownFluxosGracefully(client(B).container, { hold: true, stopSyncthingAfter: true });
    // FDM no longer names a primary that does not answer.
    await clearMaster(appName);
    // The standby asks while the primary is away: held by the announcement, or
    // taking over.
    await waitFor(async () => await fleet.verdicts(A, 'restarting') > restartingFrom
      || fleet.becamePrimary(A, standbyFrom).length > 0, {
      timeout: 60000, interval: 2000, label: 'the standby judging the primary that announced its shutdown',
    });
    expect(fleet.becamePrimary(A, standbyFrom), 'the standby taking over from a rebooting primary').to.deep.equal([]);

    await startDaemon(client(B), { paused: true });
    await releaseFluxos(client(B).container);
    await electMaster(appName, client(B).ip);
    await waitForUp(client(B), appName, 'the primary runs the app again', { timeout: 300000, interval: 3000 });
    expect(Date.now() - shutdownAt, 'fixture: the primary was back within its announcement')
      .to.be.below(SIGTERM_EXPIRY_S * 1000);

    expect(fleet.becamePrimary(A, standbyFrom), 'the standby taking over from a rebooting primary').to.deep.equal([]);
    expect(await fleet.isUp(A), 'the standby running the app').to.equal(false);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
