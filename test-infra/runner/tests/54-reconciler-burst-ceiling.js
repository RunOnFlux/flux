import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedTestApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The crash ladder is driven by evidence of a fault, and Docker's exit code cannot
// supply it in one direction: an image whose entrypoint is a wrapper script ending
// in `exit 0` reports a clean stop for a segfault, and no init we wrap around the
// container can recover a status the image already discarded. Palworld's official
// image does exactly this - its start.sh ends `exit 0` unconditionally, so a
// SIGSEGV and an operator's own shutdown are the same number to us.
//
// So a clean exit is never paced on the code alone, and the burst window is what
// catches the containers whose code lied. This suite drives that shape for real:
// EXIT_CODE=0 with EXIT_AFTER_S makes a container that dies on its own, fast, and
// reports success every time - the only defence against it is the ceiling.
//
// The unit tests cover the arithmetic against a stubbed Docker. What only a real
// fleet proves is that a genuine exit-0 container loops the reconciler at all, and
// that the ceiling closes it.

describe('reconciler ceiling paces a container that restarts too fast to be healthy', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx; let identifier;
  const appName = `e2eburst${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    // This exercises one node's own reconciler against its own container, so the
    // fleet exists to make that node a real one rather than to be peered with.
    // Three is the floor: the discovery mesh is a ring needing 2*minOutgoing+1
    // nodes to close, so three can only carry minOutgoing 1, and the app-submission
    // door checks the inbound count too.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    // exits 0 on its own after 2s: a fault the exit code hides, restarting far
    // faster than the burst window
    ({ index: idx, identifier } = await seedTestApp(env, { name: appName, exitCode: 0, exitAfterS: 2 }));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('restarts a clean exit unpaced until the burst window fills, then enters the ladder', async function () {
    this.timeout(240000);
    const client = env.clients[idx];

    // The count is config.fluxapps.restartBurstCount (5) inside the window; asserting
    // the mechanism rather than the constant keeps this from breaking on a retune.
    const backoff = await waitForReconcileActuated(client, identifier, 'backoff', 180000);
    expect(backoff.data.crashed, 'the exit code said success - only the burst rate gave it away').to.equal(false);
    expect(backoff.data.waitMs, 'the trip disposes into the crash ladder, not a terminal state').to.be.greaterThan(0);

    // everything the reconciler did to this component before it first paced it
    const priorStarts = client.getEventBuffer().filter((e) => e.event === 'reconciler:actuated'
      && e.id < backoff.id
      && e.data.identifier === identifier
      && e.data.action === 'started');
    const priorBackoffs = client.getEventBuffer().filter((e) => e.event === 'reconciler:actuated'
      && e.id < backoff.id
      && e.data.identifier === identifier
      && e.data.action === 'backoff');

    // the install's own first start reports exitCode null (a container that has
    // never run is not a death), so count the restarts that followed a clean exit
    const afterCleanExit = priorStarts.filter((e) => e.data.exitCode === 0);

    expect(priorBackoffs, 'a clean exit must not be paced before the window fills').to.have.lengthOf(0);
    expect(afterCleanExit.length, 'several clean exits went back immediately first').to.be.greaterThan(1);
  });
});
