import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushBrokenImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { waitFor } from '../framework/wait.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';

// A node that fails to place an app tells the network it has given it up.
//
// An app's row in the local table is written before its image is fetched, and
// the announcement reports the apps installed on this node - so an announcement
// landing inside an install says the node holds an app it has not got yet. That
// resolves itself while the install is still running: it finishes, and the claim
// becomes true. It does not resolve when the install fails, because nothing else
// retracts a holding claim. fluxappinstallingerror clears the installing row and
// the installing broadcast; it never touches appsLocations. The row then stands
// for its full lifetime - 7500s in production - and the spawner counts an
// instance that does not exist.
//
// So a placement's teardown broadcasts the removal. What that is worth does not
// depend on whether an announcement happened to land inside this particular
// install: the claim is retracted either way, and against a node that tears down
// in silence no removal reaches anybody at all. That is what this asserts.
//
// A rebuild's teardown stays silent, and must - its claim is one the node is
// keeping, and a removal would clear a row the app is coming back to.
const INSTANCES = 1;
const NODES = 4;

// Every node's view of who holds this app. A claim only matters where other
// nodes can see it - theirs is the count the spawner reads - so a suite asking
// whether one was retracted has to ask all of them. A node that cannot answer
// contributes null, so unreachable is never read as "holds nothing".
async function locationIpsByNode(env, appName) {
  return Promise.all(env.clients.map(async (client) => {
    try {
      const res = await client.getAppLocations(appName);
      if (res?.status !== 'success') return null;
      return res.data.map((entry) => entry.ip);
    } catch {
      return null;
    }
  }));
}

describe('a failed placement tells the network it gave the app up', function () {
  let env;
  const repoName = `brokenplace${Date.now()}`;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await pushBrokenImage(repoName, 'v1');
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('broadcasts the removal when a placement it does not yet hold fails', async function () {
    this.timeout(900000);
    const appName = `e2efailplace${Date.now()}`;
    // The image pulls and its container cannot start, so the install gets past
    // writing the app's local row and then fails - the shape being tested. The
    // repotag goes in before the spec is built, never after: the signature and
    // the hash are taken over the whole spec, so a field written later leaves the
    // app carrying a hash that does not match it.
    const app = await buildSeedableApp({
      name: appName,
      instances: INSTANCES,
      env,
      compose: [{
        name: appName,
        description: 'an app whose container cannot start',
        repotag: `${REGISTRY_REPO_HOST}/${repoName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    const observer = env.clients[0];
    const observerFrom = observer.getLastEventId();

    await seedSpawnerApp(env, app);

    // A node attempted it, so a teardown ran and the assertion below is about
    // what the teardown said rather than about an install that never started.
    const failed = await observer.waitForEvent(
      'spawner:installFailed',
      (data) => data.appName === appName,
      420000,
      { afterId: observerFrom },
    );
    expect(failed, 'no node attempted the app, so nothing here is under test').to.exist;

    // THE SUBJECT. A node that tears down in silence sends nothing, and peers
    // hold whatever it claimed until the row expires on its own.
    const removed = await observer.waitForEvent(
      'network:appremoved',
      (data) => data.name === appName,
      180000,
      { afterId: observerFrom },
    );
    expect(removed, 'the failed placement told nobody it had given the app up').to.exist;

    // And the removal had its effect, asked of every node rather than of the one
    // that sent it. Keyed on the sender rather than on the app being absent
    // everywhere: an app whose container cannot start is offered to node after
    // node, so other claims come and go throughout, and only this one is settled.
    const departedIp = removed.data.ip;
    expect(departedIp, 'the removal named no sender').to.be.a('string');
    await waitFor(
      async () => {
        const ips = await locationIpsByNode(env, appName);
        return ips.every((list) => list && !list.includes(departedIp));
      },
      { timeout: 120000, interval: 2000, label: `every node drops ${departedIp}'s location row for ${appName}` },
    );
  });
});
