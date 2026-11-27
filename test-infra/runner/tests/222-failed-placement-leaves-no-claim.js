import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushBrokenImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { waitFor } from '../framework/wait.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { afterTeardown } from '../framework/teardown-hook.js';
import { dbClient } from '../framework/db-client.js';

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
// An install holds its app and has the app's record, and has not created any of its containers.
const BEFORE_CONTAINERS = 'install:beforeContainers';

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

// An app whose image pulls and whose container cannot start.
const brokenApp = (env, repoName, appName) => buildSeedableApp({
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

  afterTeardown(async function () {
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
    const app = await brokenApp(env, repoName, appName);

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

// The fleet is two nodes: the placing node's one peer has the removal from it and
// passes it to nobody, so the placing node is never sent its own removal back.
describe('a node that gave up a placement it had announced', function () {
  let env;
  const repoName = `brokenannounced${Date.now()}`;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 2, tickerAutostart: false });
    await pushBrokenImage(repoName, 'v1');
    await bootAndPeer(env);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  // The placing node announces the app while its install holds it, so its own
  // location table and every peer's hold a row of it there. When the install fails
  // the node gives the app up, and no node - the one that gave it up included -
  // keeps that row.
  it('drops the row of a placement announced before it failed on every node, its own included', async function () {
    this.timeout(900000);
    const appName = `e2efailannounced${Date.now()}`;
    const app = await brokenApp(env, repoName, appName);
    const marks = env.clients.map((client) => client.getLastEventId());
    await Promise.all(env.clients.map((client) => client.holdCheckpoint(BEFORE_CONTAINERS, appName)));

    await seedSpawnerApp(env, app);

    const placing = await Promise.any(env.clients.map((client, idx) => client.waitForEvent(
      'checkpoint:held',
      (data) => data.name === BEFORE_CONTAINERS && data.key === appName,
      420000,
      { afterId: marks[idx] },
    ).then(() => idx)));
    const placer = env.clients[placing];
    const announced = await placer.waitForEvent(
      'app:running',
      (data) => data.apps.some((entry) => entry.name === appName),
      120000,
      { afterId: marks[placing] },
    );
    const placedAt = announced.data.ip;
    // read from each node's database: the location route's answers are cached
    const rowsAt = async (idx) => (await dbClient(idx + 1).getAppLocations(appName)).filter((row) => row.ip === placedAt);
    const [ownRow] = await rowsAt(placing);
    expect(ownRow, 'canary: the placing node holds its own row of the app it announced').to.exist;

    await Promise.all(env.clients.map((client) => client.releaseCheckpoint(BEFORE_CONTAINERS, appName)));
    await placer.waitForEvent('spawner:installFailed', (data) => data.appName === appName, 300000, { afterId: marks[placing] });
    // A node deletes the row a removal names before it publishes the removal, and the
    // placing node deletes its own before it sends the removal.
    const observing = (placing + 1) % env.clients.length;
    await env.clients[observing].waitForEvent(
      'network:appremoved',
      (data) => data.name === appName && data.ip === placedAt,
      180000,
      { afterId: marks[observing] },
    );

    const left = await Promise.all(env.clients.map((client, idx) => rowsAt(idx)));
    expect(Date.now(), 'canary: the placing node\'s row had not expired when the nodes were read').to.be.below(new Date(ownRow.expireAt).getTime());
    expect(left[observing], 'the peer kept the row of the app given up').to.deep.equal([]);
    expect(left[placing], 'the placing node kept its own row of the app it gave up').to.deep.equal([]);
  });
});
