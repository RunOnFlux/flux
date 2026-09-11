// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { buildSeedableApp, nodeOutpoint } from '../framework/seed-helper.js';
import { dbClient } from '../framework/db-client.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app pinned to named nodes runs on those nodes and nowhere else.
//
// `nodes[]` used to mean three different things. A v7 pin was honoured; a v8 pin by an
// ordinary owner deferred for half an hour and then installed ANYWHERE; a v8 pin by an
// enterprise owner was honoured. And an entry may name a node by socket address OR by
// collateral outpoint - both are live on the network - but appSpawner compared addresses
// only, at five sites, so an outpoint-pinned app matched no node at all and was placed
// nowhere, silently, because a filtered-out candidate produces no error to read.
//
// Two independent gates decide this and both are asserted, because they fail differently:
//
//   the SPAWNER'S filter    which apps a node will consider at all. Read from the
//                           spawner:candidacy event, whose `afterNodePin` stage means
//                           exactly "dropped because its pin does not name me".
//   the INSTALL-TIME gate   hwRequirements.checkAppNodesRequirements, which refuses an
//                           app that reached an install by any route other than selection.
//                           It was gated `version === 7`, so for v8 it never ran.
//
// The candidacy event is used rather than waiting for real placement because placement is
// a lottery over a delay: a suite that waits for the spawner to pick an app proves the
// pin only when it happens to win, and proves nothing at all when it does not.
//
// Four nodes: one named, one not, and two more so the ring's arcs are disjoint and the
// "nowhere else" half has somewhere else to be wrong about. Modelled on suite 64.

const subnet = getSubnetConfig();

// The node the pins name, and the one they never do. Neither is index 0: every other
// node's backward arc wraps onto it, so it is the least representative of the ring.
const PINNED_INDEX = 1;
const UNNAMED_INDEX = 2;

/**
 * The spawner's verdict on one app, from the node's own filter chain.
 *
 * `candidate` means it survived every stage; any other value names the stage that dropped
 * it. Waited for rather than read, because the event is published only when a verdict
 * CHANGES - a node that has always excluded an app says so once and then goes quiet.
 */
async function candidacy(client, appName, timeout = 180000) {
  // waitForEvent resolves with the ENVELOPE - { event, id, data } - not the payload. Read
  // the wrong level and `stage` is undefined, which quietly satisfies a not-equal assertion:
  // the pin test would go green while measuring nothing. Unwrapped once, here.
  const entry = await client.waitForEvent(
    'spawner:candidacy',
    (payload) => payload.name === appName,
    timeout,
  );
  return entry.data;
}

describe('a pinned app runs where its spec says', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      // minOutgoing is both the app-submission door and the number of outgoing
      // connections each node makes, so the fleet, this value and the peer wait agree.
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  describe('the spawner will not consider an app that names someone else', function () {
    it('honours a pin written as a socket address', async function () {
      this.timeout(300000);
      const app = await buildSeedableApp({
        env,
        name: `pinbyip${Date.now()}`,
        instances: 1,
        nodes: [`${subnet.nodeIp(PINNED_INDEX + 1)}:16127`],
      });
      await seedToFleet(env, app);

      const [named, other] = await Promise.all([
        candidacy(env.clients[PINNED_INDEX], app.spec.name),
        candidacy(env.clients[UNNAMED_INDEX], app.spec.name),
      ]);
      expect(named.stage, 'the named node was not dropped by the pin filter').to.not.equal('afterNodePin');
      expect(other.stage, 'a node the pin does not name is dropped by it').to.equal('afterNodePin');
      expect(other.candidate).to.equal(false);
    });

    it('honours a pin written as a collateral outpoint', async function () {
      this.timeout(300000);
      // The form that matched nowhere: appSpawner compared socket addresses only, so an
      // outpoint-pinned app was filtered out on EVERY node, including the one it named.
      // The named node's verdict is the whole test - the unnamed node's answer was already
      // correct when the bug was live.
      const app = await buildSeedableApp({
        env,
        name: `pinbyoutpoint${Date.now()}`,
        instances: 1,
        nodes: [nodeOutpoint(PINNED_INDEX)],
      });
      await seedToFleet(env, app);

      const [named, other] = await Promise.all([
        candidacy(env.clients[PINNED_INDEX], app.spec.name),
        candidacy(env.clients[UNNAMED_INDEX], app.spec.name),
      ]);
      expect(named.stage, 'the node whose COLLATERAL the pin names was not dropped').to.not.equal('afterNodePin');
      expect(other.stage, 'a node the outpoint does not name is dropped').to.equal('afterNodePin');
    });

    it('leaves an unpinned app available to every node', async function () {
      this.timeout(300000);
      // instances = the whole fleet, which the pinned apps above do not need.
      //
      // A verdict is only computed for an app that is SHORT of instances. At one
      // instance the first node to draw it installs it - measured: node 3 had it running
      // seconds later - and from that moment it is short nowhere, so the other nodes
      // never compute a verdict and a wait for one can only time out. Asking for an
      // instance per node keeps it short on every node long enough for each to say so.
      //
      // The pinned tests do not need this: a pin the node does not match drops the app at
      // the filter, which IS the verdict, and the two above are additionally deferred as
      // non-enterprise apps on an Arcane node, so they stay short throughout.
      const app = await buildSeedableApp({
        env,
        name: `unpinned${Date.now()}`,
        instances: env.clients.length,
        nodes: [],
      });
      await seedToFleet(env, app);

      const verdicts = await Promise.all(
        [PINNED_INDEX, UNNAMED_INDEX].map((i) => candidacy(env.clients[i], app.spec.name)),
      );
      for (const verdict of verdicts) {
        expect(verdict.stage, 'no pin, so the pin filter drops nobody').to.not.equal('afterNodePin');
      }
    });
  });

  describe('the install-time gate', function () {
    // Selection is not the only way an app reaches an install: an update, a component
    // reinstall and the health monitor's repair path all install without going through
    // the spawner's filter. This gate is what those meet, and for v8 it did not run.
    // The same call installOnNodes makes, minus the success expectation: this block is
    // about what the endpoint REFUSES. It answers a progress stream then a final status,
    // so the body is inspected as text rather than as a parsed result.
    async function installLocally(index, appName) {
      const client = env.clients[index];
      // The endpoint answers 503 until boot reconciliation has decided which apps this
      // node keeps, which would read as a refusal that has nothing to do with the pin.
      await waitForBootSettled(client);
      const auth = await authenticate(client.url, fluxTeamKey());
      return client.installAppLocally(appName, auth.zelidauth);
    }

    it('refuses to install a v8 pinned app on a node the pin does not name', async function () {
      this.timeout(300000);
      const app = await buildSeedableApp({
        env,
        name: `gateip${Date.now()}`,
        instances: 1,
        nodes: [`${subnet.nodeIp(PINNED_INDEX + 1)}:16127`],
      });
      await seedToFleet(env, app);

      const body = await installLocally(UNNAMED_INDEX, app.spec.name);
      expect(body).to.include('not allowed to run on this node');
    });

    it('refuses on an outpoint pin too', async function () {
      this.timeout(300000);
      const app = await buildSeedableApp({
        env,
        name: `gateoutpoint${Date.now()}`,
        instances: 1,
        nodes: [nodeOutpoint(PINNED_INDEX)],
      });
      await seedToFleet(env, app);

      const body = await installLocally(UNNAMED_INDEX, app.spec.name);
      expect(body).to.include('not allowed to run on this node');
    });

    it('does not refuse the node the pin names', async function () {
      this.timeout(300000);
      const app = await buildSeedableApp({
        env,
        name: `gateallowed${Date.now()}`,
        instances: 1,
        nodes: [nodeOutpoint(PINNED_INDEX)],
      });
      await seedToFleet(env, app);

      // The install itself may still fail for reasons this suite is not about (an image
      // pull, a port); what must NOT appear is the pin's refusal.
      const body = await installLocally(PINNED_INDEX, app.spec.name);
      expect(body).to.not.include('not allowed to run on this node');
    });
  });
});

/**
 * Put a built app on every node's global tables.
 *
 * seedGlobalSpec is not exported by reconciler-suite, and installOnNodes - which is -
 * installs as well as seeds, which is the opposite of what the candidacy tests want: they
 * need the fleet to KNOW about an app it has not been told to install.
 */
async function seedToFleet(env, app) {
  const indices = env.clients.map((_, i) => i);
  await Promise.all(indices.map(async (i) => {
    const dc = dbClient(i + 1);
    await dc.seedGlobalAppSpec(app.spec);
    await dc.seedPermanentMessage(app.permanentMessage);
    await dc.seedAppHash(app.hash, app.permanentMessage.height, true);
  }));
  // No wait: the three writes above are awaited, so the rows are durable by the time this
  // returns, and the spawner reads the global table on its next pass. A poll for "some app
  // exists" would be satisfied by an app a previous test seeded, which is worse than no
  // poll at all.
}
