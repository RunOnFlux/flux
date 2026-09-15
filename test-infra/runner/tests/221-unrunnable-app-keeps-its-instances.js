import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount, installedInstanceIndices,
} from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app whose containers are down still occupies the instances it was given,
// and must not be placed again somewhere else.
//
// A node announces the apps INSTALLED on it, not the apps whose containers are
// up, and the spawner counts those announcements against the app's instance
// target. Announce on run-state instead and the count omits exactly the nodes
// that took the app: it never reaches the target, so the spawner places the app
// again, and again, and nothing stops it - the surplus check reads the same
// count, sees it short, and stands nobody down. On mainnet in September 2026 one
// app whose daemon could not start reached 618 nodes against an `instances` of
// 30, and was still spreading when it was found.
//
// The containers are taken down with an operator stop rather than by breaking
// the image, because a stop is the one way down that is DURABLE and produces no
// running edges: operatorStopped outranks every other desired-state input, so
// the reconciler never restarts it. A container that fails instead walks the
// restart ladder, and each restart is briefly up - which the unfixed code
// announced on, so a broken-container fixture proves nothing here (measured: it
// passed against the unfixed code). What is under test is the same either way:
// whether a node that holds an app keeps saying so while nothing is running.
//
// Suite 208 proves the ceiling holds for an app that runs. This proves it holds
// for one that does not.
const INSTANCES = 2;
// More nodes than the app asks for, so a replacement has somewhere to go and the
// spread is a count rather than an inference.
const NODES = 6;
// fluxapps.locationTtlS is 63s in the harness, so an unrefreshed row is gone
// within about a minute. Holding the count for more than two of those is what
// makes the pass mean "still claimed" rather than "not expired yet".
const HOLD_MS = 150000;

async function runningComponents(env, nodeIndex) {
  const res = await env.clients[nodeIndex].get('/apps/listrunningapps');
  const list = res?.status === 'success' ? res.data : null;
  if (!Array.isArray(list)) throw new Error(`listrunningapps unreadable: ${JSON.stringify(res)?.slice(0, 200)}`);
  return list.flatMap((a) => a.Names || []).map((n) => n.replace(/^\//, ''));
}

describe('an app that cannot run keeps its instances and is not placed again', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('keeps announcing while its container cannot run, so the spawner places no replacement', async function () {
    this.timeout(600000);
    const appName = `e2eheld${Date.now()}`;
    await pushTestApp(appName);
    // Starts, then is gone in 50ms, on every node, for ever. Install's own start
    // succeeds so the node really holds the app, and every restart after it dies
    // before anything polling docker can see the process - measured stable at
    // exactly INSTANCES for five minutes. EXIT_AFTER_S cannot express this: its
    // floor is a second, and the run-state broadcast fired on the container-start
    // edge, which lands inside that second and announced the app anyway.
    const app = await buildSeedableTestApp({
      name: appName, instances: INSTANCES, exitCode: 1, exitAfterMs: 50,
    });
    await seedSpawnerApp(env, app);

    const placed = await waitForInstanceCount(env, appName, INSTANCES, {
      timeout: 300000, stableMs: 12000, exact: true,
    });
    expect(placed, 'the app reaches its instance count').to.have.lengthOf(INSTANCES);

    // The subject, first: still exactly the same instances, held for longer than
    // a location row lives unrefreshed. Announced on run-state instead, the
    // holders fall out of the network's count here and the spawner replaces them.
    const after = await waitForInstanceCount(env, appName, INSTANCES, {
      timeout: 30000, stableMs: HOLD_MS, exact: true,
    });
    expect(after, 'the holders still hold the app').to.deep.equal(placed);

    // And the fixture really is an app that cannot run, not a healthy one - or
    // this proves only what suite 208 already does. Asked repeatedly and satisfied
    // by ANY sample that finds it down: the container is up for a few ms after
    // each restart attempt, so a single read can land inside that window, and a
    // hard "is not running right now" fails at random. An app that idles the way
    // every other fixture does is up in all of them.
    await Promise.all(placed.map(async (i) => {
      let sawDown = false;
      for (let attempt = 0; attempt < 8 && !sawDown; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const running = await runningComponents(env, i);
        if (!running.some((n) => n.includes(appName))) sawDown = true;
        // eslint-disable-next-line no-await-in-loop
        if (!sawDown) await new Promise((r) => { setTimeout(r, 3000); });
      }
      expect(sawDown, `node ${i} holds an app that cannot stay up, so it must be seen down`).to.be.true;
    }));

    const finalIdx = await installedInstanceIndices(env, appName);
    expect(finalIdx, 'no replacement was placed while the app was down').to.deep.equal(placed);
  });
});
