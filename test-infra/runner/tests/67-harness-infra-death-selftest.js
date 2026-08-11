import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { getContainerRuntimeClient } from 'testcontainers';
import { createTestEnv } from '../framework/test-env.js';
import { infraDeathError } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A self-test of the harness's own infra-death kill-switch (framework/infra-death.js
// plus the death watch in test-env.js). Every other suite trusts that an infra
// container dying mid-run fails the waits AT the death naming the container,
// rather than 30-120s later as a generic timeout that reads like a product bug.
// Nothing proved that, so this suite kills its own mongo on purpose and asserts
// the guard's contract end to end.
//
// The subject under test is the harness, not FluxOS: this suite deliberately
// voids its OWN env, catches the resulting rejections, and PASSES on them. It is
// not a void run - the rejection is the assertion.
//
// NOTE FOR GATE TOOLING: reportInfraDeath prints `INFRA-DEAD: mongo exited
// code=137 ...` to stderr, and run-all merges stderr into the per-suite .tap. A
// reader (or a future grep) that treats an INFRA-DEAD line in a .tap as "this
// run was void" must exclude THIS suite's tap - here the line is the expected
// output. run-all's own pass/fail is counted from `^ok`/`^not ok` and mocha's
// rc, so it is unaffected.
//
// Kill mechanism: dockerode `kill({ signal: 'SIGKILL' })` against the container
// id held by the env, reached through testcontainers' own runtime client - the
// same handle test-env.js uses for disconnectNode and readInfraLogs. It has to
// be this and not `container.stop()`: StartedGenericContainer.stop() awaits the
// containerIsStopping pre-stop hook, which watchInfra uses to mark a deliberate
// stop as expected (the missing-recreate suite stops the registry that way). A docker-level kill
// never runs that hook, so the `die` arrives unmarked - which is exactly the
// unannounced death the guard exists to catch. Shelling out to `docker kill`
// would work too but would not prove the harness's own handle reaches the
// container, and the framework never shells out for docker.

async function sigkill(container) {
  const client = await getContainerRuntimeClient();
  await client.container.dockerode.getContainer(container.getId()).kill({ signal: 'SIGKILL' });
}

// null when the container no longer exists (teardown removed it).
async function containerState(id) {
  const client = await getContainerRuntimeClient();
  try {
    const info = await client.container.dockerode.getContainer(id).inspect();
    return info.State;
  } catch {
    return null;
  }
}

async function networkExists(name) {
  const client = await getContainerRuntimeClient();
  try {
    await client.container.dockerode.getNetwork(name).inspect();
    return true;
  } catch {
    return false;
  }
}

describe('harness infra-death guard', function () {
  let env;
  let node;
  let mongoEntry;
  let mongoId;
  let networkName;
  let recordedDeath = null;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(180000);
    // One node is the framework minimum and all this needs: the guard is
    // fleet-independent, and a parked SSE wait needs exactly one client.
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
    node = env.clients[0];
    ({ networkName } = env);
    mongoEntry = env.infraContainers.find((c) => c.name === 'mongo');
    expect(mongoEntry, 'mongo is registered with the death watch').to.exist;
    mongoId = mongoEntry.container.getId();
  });

  after(async function () {
    this.timeout(60000);
    // Idempotent: the teardown test below already ran this on a green run, and
    // this is the only teardown on a red one.
    await env?.teardown().catch(() => {});
    // Belt and braces for a standalone `npx mocha tests/67-...` run: run-all
    // sweeps its own label between suites, a solo run has no such sweep, and
    // anything left holding the run's /24 would fail the next env's network
    // create. Scoped to this env's own id/name - never a blanket sweep.
    const client = await getContainerRuntimeClient();
    if (mongoId) {
      await client.container.dockerode.getContainer(mongoId).remove({ force: true }).catch(() => {});
    }
    if (networkName) {
      await client.container.dockerode.getNetwork(networkName).remove().catch(() => {});
    }
  });

  it('fails a parked wait at the death, naming the container and exit code', async function () {
    // Deliberately well under the parked wait's own 120s budget: if the guard
    // never fires, this test fails here in 60s rather than sitting out the
    // wait's full deadline.
    this.timeout(60000);

    // Both suppressors must be disarmed or a pass below would prove nothing.
    // `stopping` is set only by teardown; `expected` is set only through the
    // containerIsStopping pre-stop hook, which a docker-level kill bypasses.
    expect(env.stopping, 'env is not tearing down').to.equal(false);
    expect(mongoEntry.expected, 'mongo is not marked as a deliberate stop').to.equal(false);
    expect(infraDeathError(), 'no death recorded before the kill').to.equal(null);

    // Park on an event this env can never emit: a one-node fleet with no app
    // registered never emits app:installed, and afterId pins the wait past
    // everything already buffered. A 120s budget makes "rejected in seconds"
    // attributable to the kill-switch and to nothing else.
    const PARKED_TIMEOUT_MS = 120000;
    const startedAt = process.hrtime.bigint();
    const parked = node.waitForEvent('app:installed', () => true, PARKED_TIMEOUT_MS, {
      afterId: node.getLastEventId(),
    });
    // waitForEvent registers its onInfraDeath handler synchronously, so it is
    // already parked here. Convert to a settled-outcome promise immediately:
    // the rejection can land during the kill's own round trip, and an
    // unhandled rejection would fail the mocha process instead of this test.
    const settled = parked.then((entry) => ({ entry }), (error) => ({ error }));

    await sigkill(mongoEntry.container);

    const { entry, error } = await settled;
    const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);

    expect(entry, 'app:installed cannot occur here, so the wait must not resolve').to.equal(undefined);
    expect(error, 'the parked wait rejected').to.be.an('error');
    expect(error.infraDead, 'the rejection is flagged as an infra death').to.equal(true);
    expect(error.message, 'leads with the literal gate tooling greps a .tap for').to.include('INFRA-DEAD');
    expect(error.message, 'names the container that died').to.include('mongo');
    // SIGKILL yields 137. The watcher deliberately does NOT filter on exit code
    // - an OOM-killed mongo exits 137 exactly like a deliberately stopped one,
    // and both void the run - so this asserts 137 is REPORTED, not that any
    // code gated the report.
    expect(error.message, 'reports the exit code').to.include('code=137');
    expect(
      elapsedMs,
      `rejected at the death (${elapsedMs}ms), not at its own ${PARKED_TIMEOUT_MS}ms deadline`,
    ).to.be.below(15000);

    // A wait started AFTER the switch tripped never parks: waitForEvent's
    // pre-check reads infraDeathError() before it touches the buffer or arms a
    // timer, and rejects with the SAME recorded error - the first death is the
    // cause, later ones never replace it.
    const lateStartedAt = process.hrtime.bigint();
    let lateError = null;
    try {
      await node.waitForEvent('app:installed', () => true, PARKED_TIMEOUT_MS);
    } catch (err) {
      lateError = err;
    }
    const lateMs = Number((process.hrtime.bigint() - lateStartedAt) / 1000000n);
    expect(lateError, 'a wait started after the death rejects with the recorded death').to.equal(error);
    expect(lateMs, 'rejects without parking').to.be.below(1000);

    // Same object the rest of the wait machinery reads (wait.js throwIfInfraDead,
    // the http/tcp poll strategies).
    expect(infraDeathError(), 'the module records the death for every other waiter').to.equal(error);

    recordedDeath = error;
  });

  it('tears down cleanly with mongo dead, snapshotting its logs first', async function () {
    this.timeout(60000);
    expect(recordedDeath, 'the kill test ran').to.be.an('error');

    let teardownError = null;
    try {
      await env.teardown();
    } catch (err) {
      teardownError = err;
    }
    expect(
      teardownError,
      `teardown must survive a dead infra container: ${teardownError?.message}`,
    ).to.equal(null);

    // teardown snapshots the infra logs when the run is void, because stopping a
    // container removes it and takes its logs with it.
    //
    // On a FAILING suite dumpLogsOnFailure writes that snapshot to
    // test-logs/<title>/infra-mongo.log. This suite PASSES, and log-on-failure
    // only writes files for a failed test, for an after-all with nothing passed,
    // or under DUMP_LOGS=always - so no file lands here and asserting one would
    // be asserting a failure. The snapshot BEHIND that file is what a passing
    // run can prove, so that is what is asserted.
    const infra = await env.infraDiagnostics();
    const mongoLogs = infra.find((e) => e.name === 'mongo');
    expect(mongoLogs, 'mongo is in the teardown log snapshot').to.exist;
    expect(mongoLogs.error, 'the snapshot was taken while the container still existed').to.equal(undefined);
    expect(mongoLogs.text.trim(), 'mongo logged before it was killed').to.not.equal('');

    // Nothing of this env is left holding the run's /24: the killed mongo is
    // stopped or removed, and the network is released.
    const state = await containerState(mongoId);
    expect(state === null || state.Running === false, 'the killed mongo is not left running').to.equal(true);
    expect(await networkExists(networkName), 'teardown released the env network').to.equal(false);
  });
});

// The switch is a module singleton, and mocha gives run-all one process per
// suite file but several envs per file. A death that outlived its env would fail
// the next env's waits before they started - including the daemon:polled waits
// inside createTestEnv's own boot. createTestEnv clears the switch before it
// arms the new watch; this proves it, with a second env in the same process.
describe('harness infra-death guard does not leak into the next env', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(180000);
    // Booting at all is half the proof: _buildEnv's last step waits for
    // daemon:polled on every node, and a leaked death would reject it outright.
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('a fresh env records no death and serves waits again', async function () {
    this.timeout(30000);
    expect(infraDeathError(), 'the previous env death was cleared').to.equal(null);

    // daemon:polled is already in this node's buffer (the boot waited on it), so
    // this resolves off the buffer with no timer at all - the positive control
    // for the pre-check that rejected in the previous describe.
    const polled = await env.clients[0].waitForEvent('daemon:polled', () => true, 10000);
    expect(polled.event).to.equal('daemon:polled');
  });
});
