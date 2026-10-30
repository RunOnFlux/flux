// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { moveNodeAddress } from '../framework/container.js';
import { clearNodeAddress, setNodeAddress } from '../framework/daemon-control.js';
import {
  assertNoEvent, waitFor, waitForAppRemoved,
} from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Whether a removal is told to the network is read as its message goes out, not
// when the removal starts.
//
// A node held out of service for its IP changes removes its apps at once, and
// leaves an app being installed to its install. The chain still lists it at the
// address it left, so its peers accept no message from it: the removal starts
// with the node unable to be heard. While the install runs, the block ticker
// bootAndPeer starts mines the node's confirmation at its new address, so the
// chain lists it where it is and it reconnects to its peers. The removal that
// waited for the install is then told, and a peer hears it.
//
// Node 1 is the subject; three nodes give it the two peers it fetches the
// network policy from, which it needs to install. Node 0 is the peer that hears
// the removal.

const SUBJECT = 1;
const PEER = 0;
const API_PORT = 16127;
const BEFORE_CONTAINERS = 'install:beforeContainers';
const IP_CHANGES = 'IP changes over the limit allowed, one in 20 hours';
const DETECTION_MS = 6 * 60 * 1000;
// The node status monitor's pass at production's interval, so the app can only
// leave through the hold's own removal.
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const INSTALLED_MS = 180000;
const REMOVED_MS = 180000;
// How long a removal message takes to reach a peer that is connected.
const TOLD_MS = 30000;
// Long enough for the hold's removal to reach the app, were it not left to its install.
const LEFT_TO_INSTALL_MS = 30000;

describe('a node held for its IP changes tells the network of a removal once it can be heard', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let listed;
  // Before the second move: the node's connections and its standing change after it.
  let movedAt;
  const installing = `e2eheardinstalling${Date.now()}`;
  const client = (i) => env.clients[i];
  const subject = () => client(SUBJECT);
  const peer = () => client(PEER);
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const record = () => dbClient(SUBJECT + 1).ownAddressRecord();
  const held = async () => {
    const { data } = await subject().getDOSState();
    return (data?.dosState ?? 0) >= 100 && data?.dosMessage === IP_CHANGES;
  };

  // Moves the subject's address as a router's change does, and has benchmark
  // report the new one while the chain still lists the old. The stub knows the
  // node by the address it is listed at and answers 127.0.0.1 to an address it
  // does not know, so it is told before the address moves.
  async function move(to) {
    const from = subject().ip;
    await setNodeAddress(listed, to, { scope: 'benchmark' });
    await moveNodeAddress(subject().container, to, from);
    await subject().followTo(to);
    await waitFor(async () => (await record())?.socketAddress === socketOf(to), {
      timeout: DETECTION_MS, interval: 5000, label: `the move to ${to} recorded`,
    });
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { nodeMonitorIntervalMs: NODE_MONITOR_INTERVAL_MS } },
    });
    await bootAndPeer(env);
    listed = subject().ip;
    await pushTestApp(installing);

    const from = subject().getLastEventId();
    await subject().holdCheckpoint(BEFORE_CONTAINERS, installing);
    await seedSpawnerApp(env, await buildSeedableTestApp({ name: installing, instances: 1 }), [SUBJECT]);
    await subject().waitForEvent(
      'checkpoint:held',
      (d) => d.name === BEFORE_CONTAINERS && d.key === installing,
      INSTALLED_MS,
      { afterId: from },
    );
  });

  after(async function () {
    this.timeout(60000);
    if (env) await subject().releaseCheckpoint(BEFORE_CONTAINERS, installing).catch(() => {});
    if (listed) await clearNodeAddress(listed).catch(() => {});
    await env?.teardown();
  });

  it('starts the removal while it cannot be heard, and leaves the app being installed to its install', async function () {
    this.timeout(2 * DETECTION_MS + 120000);
    const base = subject().ip.replace(/\.\d+$/, '');
    const start = subject().getLastEventId();
    await move(`${base}.240`);
    const lost = await subject().waitForEvent('messageCapability:changed', (d) => d.capable === false, 60000, { afterId: start });
    movedAt = subject().getLastEventId();
    await move(`${base}.241`);
    await waitFor(held, { timeout: 60000, interval: 2000, label: 'out of service for the second IP change' });
    // the fixture: held while the chain still lists the node where it was
    await assertNoEvent(subject(), 'messageCapability:changed', (d) => d.capable === true, 1, { afterId: lost.id });
    await assertNoEvent(subject(), 'app:removed', (d) => d.name === installing, LEFT_TO_INSTALL_MS, { afterId: movedAt });
    const res = await subject().get(`/apps/installedapps?_=${Date.now()}`);
    expect(res?.data?.map((app) => app.name), 'the record of the app being installed').to.include(installing);
  });

  it('tells the network of the removal that waited for the install, once the chain lists the node where it is', async function () {
    this.timeout(REMOVED_MS + TOLD_MS + 300000);
    const mark = subject().getLastEventId();
    const peerMark = peer().getLastEventId();

    await subject().waitForEvent('messageCapability:changed', (d) => d.capable === true, 120000, { afterId: movedAt });
    await subject().waitForEvent('peers:added', (d) => d.ip === peer().ip, 120000, { afterId: movedAt });
    expect(await held(), 'the node is still held, so the removal still stands').to.equal(true);

    await subject().releaseCheckpoint(BEFORE_CONTAINERS, installing);
    await waitForAppRemoved(subject(), installing, REMOVED_MS, { afterId: mark });
    await peer().waitForEvent('network:appremoved', (d) => d.name === installing, TOLD_MS, { afterId: peerMark });
  });
});
