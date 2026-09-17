import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { execInContainer } from '../framework/container.js';
import { getSubnetConfig, REGISTRY_PORT } from '../framework/subnet-config.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount, installedInstanceIndices,
} from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { waitFor } from '../framework/wait.js';

// A node that fails to place an app must take back what it claimed.
//
// The local app row is written before the image is pulled, so it is there for
// the whole of an install - and the announcement reports the apps installed on
// this node. An announcement landing inside that window therefore says the node
// holds an app it has not got yet. That is harmless while the install is still
// running: it finishes, and the claim becomes true. It is not harmless when the
// install fails, because the spawner counts the claim against the app's instance
// target and the row stands for its full lifetime (7500s in production) with
// nothing left to correct it. The app runs an instance short for that whole time.
//
// The teardown is the only thing that can retract it, so a placement tears down
// with a broadcast removal. A rebuild does not: its claim is one the node is
// keeping.
//
// The install is stalled by dropping the node's traffic to the registry, rather
// than by a broken repotag. A broken tag fails at the pull in a second or two,
// which is inside no announce interval at all, so the claim is never made and
// the suite passes against the unfixed code. The drop holds the pull open past
// one interval; switching the rule to a reset then fails it on the spot.
const INSTANCES = 1;
const NODES = 4;
// ANNOUNCE_INTERVAL_MS is derived from fluxapps.locationTtlS, which the harness
// compresses to 63s: floor(63000 * 0.96 / 2 / 1000) * 1000. Waiting two of them
// means a tick has fired inside the stall whatever phase the node started in.
const ANNOUNCE_MS = 30000;

const REGISTRY_IP = getSubnetConfig().registry;
const DROP = `-p tcp -d ${REGISTRY_IP} --dport ${REGISTRY_PORT} -j DROP`;
const RESET = `-p tcp -d ${REGISTRY_IP} --dport ${REGISTRY_PORT} -j REJECT --reject-with tcp-reset`;

async function onEveryNode(env, command) {
  await Promise.all(env.clients.map(async (client) => {
    const r = await execInContainer(client.container, command);
    if (r.exitCode !== 0) throw new Error(`${command}: ${r.output}`);
  }));
}

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

describe('a failed placement leaves no claim behind', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    // Tolerates a rule already gone, so a teardown after a failed test cannot
    // fail in its own right.
    await Promise.all(env?.clients?.map((c) => execInContainer(c.container, `iptables -D OUTPUT ${DROP}`).catch(() => {})) ?? []);
    await Promise.all(env?.clients?.map((c) => execInContainer(c.container, `iptables -D OUTPUT ${RESET}`).catch(() => {})) ?? []);
    await env?.teardown();
  });

  it('retracts the claim an announcement made while the install was still running', async function () {
    this.timeout(900000);
    const appName = `e2efailplace${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableTestApp({ name: appName, instances: INSTANCES });

    await onEveryNode(env, `iptables -I OUTPUT ${DROP}`);
    const observer = env.clients[0];
    const observerFrom = observer.getLastEventId();

    await seedSpawnerApp(env, app);

    // The local row, which is what the announcement reads. It is written before
    // the pull, so it appears while the stall is still holding the pull open.
    let holders = [];
    await waitFor(
      async () => {
        holders = await installedInstanceIndices(env, appName);
        return holders.length > 0;
      },
      { timeout: 300000, interval: 2000, label: `a node takes ${appName}` },
    );
    const holderIp = env.clients[holders[0]].ip;

    // Two intervals, so a tick has fired inside the stall.
    await new Promise((r) => { setTimeout(r, ANNOUNCE_MS * 2); });

    // THE CANARY. Without a claim made during the install there is nothing to
    // retract, and everything below would pass against code that never retracts
    // anything.
    const claimed = await locationIpsByNode(env, appName);
    expect(
      claimed.some((ips) => ips && ips.some((ip) => ip.startsWith(`${holderIp}:`))),
      'no node was told this app is held here, so the retraction below proves nothing',
    ).to.be.true;

    // Fail the pull on the spot.
    await onEveryNode(env, `iptables -I OUTPUT ${RESET}`);
    await onEveryNode(env, `iptables -D OUTPUT ${DROP}`);

    // The retraction itself, seen by a peer rather than inferred from a row that
    // could equally have expired: the harness compresses the row's own lifetime
    // to 63s, so "it is gone" alone cannot tell a broadcast from a timeout.
    const removed = await observer.waitForEvent(
      'network:appremoved',
      (data) => data.name === appName && String(data.ip).startsWith(`${holderIp}:`),
      180000,
      { afterId: observerFrom },
    );
    expect(removed, 'the failed placement told nobody it had given the app up').to.exist;

    await waitFor(
      async () => {
        const ips = await locationIpsByNode(env, appName);
        return ips.every((list) => list && !list.some((ip) => ip.startsWith(`${holderIp}:`)));
      },
      { timeout: 60000, interval: 2000, label: `${holderIp} gives up its location row for ${appName}` },
    );

    // And the consequence the claim had: with it standing, the spawner counts an
    // instance that does not exist and the app never reaches its target.
    await onEveryNode(env, `iptables -D OUTPUT ${RESET}`);
    const placed = await waitForInstanceCount(env, appName, INSTANCES, {
      timeout: 420000, stableMs: 10000,
    });
    expect(placed, 'the app never reached its instance count').to.have.lengthOf.at.least(INSTANCES);
  });
});
