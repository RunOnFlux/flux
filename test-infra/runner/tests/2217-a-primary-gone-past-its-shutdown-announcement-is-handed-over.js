// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { shutdownFluxosGracefully } from '../framework/container.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitForUp } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { placeSilentPrimaryApp, A, B } from '../framework/silent-primary.js';

// A primary that announced its shutdown and has not come back is handed over
// once the announcement has expired (sigtermExpiryS), and not before: until then
// its closed connection is a reboot.

const SIGTERM_EXPIRY_S = 120;
const SIGTERM_EXPIRY_MS = SIGTERM_EXPIRY_S * 1000;
// From the expiry to the standby running the app: a few election passes and a
// container start.
const TAKEOVER_MS = 4 * 60 * 1000;

describe('a primary gone past its shutdown announcement is handed over', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2egone${Date.now()}`;
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

  it('starts on the standby once the announcement has expired, and not before', async function () {
    this.timeout(SIGTERM_EXPIRY_MS + TAKEOVER_MS + 120000);
    const restartingFrom = await fleet.verdicts(A, 'restarting');
    const standbyFrom = client(A).getLastEventId();

    await shutdownFluxosGracefully(client(B).container, { hold: true, stopSyncthingAfter: true });
    await clearMaster(appName);
    const [sigterm] = await dbClient(A + 1).getAppStateEvents({ ip: socketAddr(B + 1), type: 'sigterm' });
    expect(sigterm, 'fixture: the standby heard the shutdown').to.not.equal(undefined);
    // The moment the standby decides: its promotion begins.
    await client(A).waitForEvent('primaryRole:changed', (d) => d.identifier === fleet.identifier && d.to === 'promoting',
      SIGTERM_EXPIRY_MS + TAKEOVER_MS, { afterId: standbyFrom });
    expect(Date.now() - sigterm.broadcastedAt.getTime(), 'the standby deciding before the announcement expired')
      .to.be.at.least(SIGTERM_EXPIRY_MS);
    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: TAKEOVER_MS, interval: 3000 });
    expect(await fleet.verdicts(A, 'restarting'), 'the standby held by the announcement first').to.be.above(restartingFrom);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
