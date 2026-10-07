// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { execInContainer, crashFluxos } from '../framework/container.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { stopDaemon, startDaemon } from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { placeSilentPrimaryApp, A, B } from '../framework/silent-primary.js';

// A standby whose syncthing restarted after the primary went has no closing of
// its own to read. A primary it was connected to before, and that has not
// reconnected once this FluxOS has known the new syncthing for the restart
// grace (sigtermExpiryS), is gone - and not before then.

const SIGTERM_EXPIRY_S = 120;
const SIGTERM_EXPIRY_MS = SIGTERM_EXPIRY_S * 1000;
// From the grace to the standby running the app: a few election passes and a
// container start.
const TAKEOVER_MS = 4 * 60 * 1000;

describe('a standby whose syncthing restarted takes over from a crashed primary after the grace', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2egrace${Date.now()}`;
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

  it('starts on the standby once its restarted syncthing has waited out the grace, and not before', async function () {
    this.timeout(SIGTERM_EXPIRY_MS + TAKEOVER_MS + 300000);
    // The whole primary goes, with no announcement: the process, the container and
    // the daemon. FDM still names it, so the standby does not act on the closing
    // its syncthing sees - and then that syncthing restarts.
    await crashFluxos(client(B).container, { hold: true });
    await execInContainer(client(B).container, `docker kill flux${fleet.identifier}`);
    await stopDaemon(client(B));
    const standbyFrom = client(A).getLastEventId();
    await stopDaemon(client(A));
    await startDaemon(client(A), { paused: true });
    const restartedAt = Date.now();
    const noEvidenceFrom = await fleet.verdicts(A, 'noEvidence');
    await clearMaster(appName);

    await waitFor(async () => await fleet.verdicts(A, 'noEvidence') > noEvidenceFrom || await fleet.isUp(A), {
      timeout: 60000, interval: 2000, label: 'the standby judging a primary its new syncthing never saw',
    });
    // The moment the standby decides: its promotion begins.
    await client(A).waitForEvent('primaryRole:changed', (d) => d.identifier === fleet.identifier && d.to === 'promoting',
      SIGTERM_EXPIRY_MS + TAKEOVER_MS, { afterId: standbyFrom });
    expect(Date.now() - restartedAt, 'the standby deciding before the grace had passed')
      .to.be.at.least(SIGTERM_EXPIRY_MS);
    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: TAKEOVER_MS, interval: 3000 });
    expect(await fleet.verdicts(A, 'noEvidence'), 'the standby finding no closing of its own to read first').to.be.above(noEvidenceFrom);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
