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

// Compressed ladder: immediate, then 5s, 10s, 30s, 60s.
const LADDER_MS = [0, 5000, 10000, 30000, 60000];
// A run this long clears the ladder. Shorter than the 30s rung on purpose - that
// is the whole shape of the defect this suite reaches.
const STABLE_RUN_MS = 20000;
// Five 2s lifetimes fit inside it, so the ceiling can fill.
const BURST_WINDOW_MS = 60000;

// The relationship, asserted rather than assumed. Production ships 15m against
// 10m; if a retune here ever left every rung shorter than the window, the test
// below would pass while never reaching the branch it targets.
const DEEP_RUNG_MS = LADDER_MS.find((ms) => ms > STABLE_RUN_MS);

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
    // The ladder and the stable-run window are compressed together, because what
    // this suite needs is not small numbers but a preserved RELATIONSHIP: a rung
    // longer than the window that clears the ladder. Production has that at 15m
    // against 10m; here it is 30s against 20s. Compress one without the other and
    // no rung outlasts the window, the clearing branch is never reached, and the
    // suite goes green having stopped testing the thing it exists for.
    //
    // Floors, not preferences: the app runs 2s before exiting, and the harness
    // does not compress a container's own runtime - so a rung near 2s would be
    // swamped by it. The burst window has to outlast five of those lifetimes
    // (~10s) or the ceiling can never fill.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          crashBackoffDelaysMs: LADDER_MS,
          crashBackoffStableRunMs: STABLE_RUN_MS,
          restartBurstWindowMs: BURST_WINDOW_MS,
        },
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

  // The rung that outlasts the stable-run window is where the ladder used to
  // clear itself. restartWaitMs measures how long the component ran from its last
  // rung, and a component only earned one when its exit reported a fault or the
  // burst window was full - the window empties while it sits out a wait, so the
  // gap being measured was the wait itself. Fifteen minutes stopped read as
  // fifteen minutes running, the ladder cleared, and the climb restarted at the
  // bottom, forever, never reaching the cap.
  //
  // The unit tests pin the arithmetic. What only a fleet shows is a real
  // container serving a real wait and the ladder still standing afterwards.
  it('does not clear the ladder on the wait it just served', async function () {
    this.timeout(300000);
    const client = env.clients[idx];

    expect(DEEP_RUNG_MS, 'no rung outlasts the stable-run window, so nothing below reaches the branch').to.not.equal(undefined);

    // Anchored here: the suite's first test leaves a climb already in the buffer,
    // and an unanchored search reads whichever rung it happens to land on.
    const fromId = client.getLastEventId();

    // Climb until a wait longer than a stable run is handed out. waitMs is what
    // REMAINS of the rung, not the rung - the reconciler re-enqueues during a
    // wait, so one rung reports several times, each smaller than the last.
    // Matching at-or-above the rung length finds its first report.
    const deep = await client.waitForEvent(
      'reconciler:actuated',
      (d) => d.identifier === identifier && d.action === 'backoff' && d.waitMs >= DEEP_RUNG_MS,
      240000,
      { afterId: fromId },
    );
    expect(deep.data.crashed, 'still a clean exit - the ceiling is what put it here').to.equal(false);

    // Serve the rung out: the container comes back, dies again, and the pass that
    // follows either holds its place on the ladder or starts over.
    await client.waitForEvent(
      'reconciler:actuated',
      (d) => d.identifier === identifier && d.action === 'started',
      DEEP_RUNG_MS + 60000,
      { afterId: deep.id },
    );

    const next = await client.waitForEvent(
      'reconciler:actuated',
      (d) => d.identifier === identifier && d.action === 'backoff',
      DEEP_RUNG_MS + 60000,
      { afterId: deep.id },
    );

    // The rung, not the remaining wait. A ladder cleared by the wait it just
    // served comes back at rung 1, having read the time the component spent
    // stopped as time it spent running.
    expect(next.data.rung, 'the wait it served is not evidence that it ran')
      .to.be.at.least(deep.data.rung);
  });
});
