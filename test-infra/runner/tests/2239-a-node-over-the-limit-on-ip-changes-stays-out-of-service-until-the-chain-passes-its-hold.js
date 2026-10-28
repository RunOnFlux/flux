// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { crashFluxos, moveNodeAddress, releaseFluxos } from '../framework/container.js';
import {
  clearNodeAddress, setHeight, setNodeAddress, stopTicker,
} from '../framework/daemon-control.js';
import { waitFor, waitForAppInstalled, waitForAppRemoved } from '../framework/wait.js';
import { bootAndPeer, seedSpawnerApp, installedInstanceIndices } from '../framework/reconciler-suite.js';
import { buildSeedableTestApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node whose IP changes a second time inside the limit's window is out of
// service until the chain is 2400 blocks past the change: the hold is the
// node's own address record and the chain's height, so a FluxOS restart does
// not end it and nothing but the chain does. The app it runs is removed as soon
// as it is held.
//
// Node 1 changes its IP twice; nodes 0 and 2 are bystanders. Three nodes give
// it the two peers it fetches the network policy from, which it needs to
// install the app.

const SUBJECT = 1;
const API_PORT = 16127;
const WINDOW_BLOCKS = 2400;
const IP_CHANGES = 'IP changes over the limit allowed, one in 20 hours';
const DETECTION_MS = 6 * 60 * 1000;
// Longer than the availability recheck and several daemon polls, so a hold
// that something ends would be seen ended.
const STANDS_MS = 60 * 1000;
// The node status monitor's pass at production's interval, so the app can only
// leave in time because the hold itself has it removed.
const NODE_MONITOR_INTERVAL_MS = 20 * 60 * 1000;
const REMOVED_MS = 2 * 60 * 1000;

describe('a node over the limit on IP changes stays out of service until the chain passes its hold', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let listed;
  const appName = `e2eipchanges${Date.now()}`;
  const client = (i) => env.clients[i];
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const record = () => dbClient(SUBJECT + 1).ownAddressRecord();
  // What the node reports of its DOS. Held means out of service at 100, where no
  // app is placed on it, for this reason.
  const dos = async () => {
    const { data } = await client(SUBJECT).getDOSState();
    return { dosState: data?.dosState ?? null, dosMessage: data?.dosMessage ?? null };
  };
  const held = async () => {
    const { dosState, dosMessage } = await dos();
    return dosState >= 100 && dosMessage === IP_CHANGES;
  };

  // Moves the subject's address as a router's change does, and has benchmark
  // report the new one while the chain still lists the old. The stub knows the
  // node by the address it is listed at and answers 127.0.0.1 to an address it
  // does not know, so it is told before the address moves.
  async function move(to) {
    const from = client(SUBJECT).ip;
    await setNodeAddress(listed, to, { scope: 'benchmark' });
    await moveNodeAddress(client(SUBJECT).container, to, from);
    await client(SUBJECT).followTo(to);
    await waitFor(async () => (await record())?.socketAddress === socketOf(to), {
      timeout: DETECTION_MS, interval: 5000, label: `the move to ${to} recorded`,
    });
  }

  // The node is held now and for all of STANDS_MS.
  async function expectHeldThroughout(label) {
    const until = Date.now() + STANDS_MS;
    while (Date.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      expect(await dos(), label).to.deep.equal({ dosState: 100, dosMessage: IP_CHANGES });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 5000); });
    }
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
    listed = client(SUBJECT).ip;
    await pushTestApp(appName);
    await seedSpawnerApp(env, await buildSeedableTestApp({ name: appName, instances: 1 }), [SUBJECT]);
    await waitForAppInstalled(client(SUBJECT), appName, 180000);
  });

  after(async function () {
    this.timeout(60000);
    if (listed) await clearNodeAddress(listed).catch(() => {});
    await env?.teardown();
  });

  it('is out of service for its second IP change, its app removed, and still is after FluxOS restarts', async function () {
    this.timeout(2 * DETECTION_MS + 4 * STANDS_MS + REMOVED_MS + 300000);
    const base = client(SUBJECT).ip.replace(/\.\d+$/, '');
    await move(`${base}.240`);
    expect(await held(), 'held for one IP change').to.equal(false);
    expect(await installedInstanceIndices(env, appName), 'fixture: the app runs on the node before the second change').to.deep.equal([SUBJECT]);

    const anchor = client(SUBJECT).getLastEventId();
    await move(`${base}.241`);
    await waitFor(held, { timeout: 60000, interval: 2000, label: 'out of service for the second IP change' });
    await waitForAppRemoved(client(SUBJECT), appName, REMOVED_MS, { afterId: anchor });

    // FluxOS restarts in place: a container restart would also put the node
    // back on the address docker gave it.
    await crashFluxos(client(SUBJECT).container, { hold: true });
    await releaseFluxos(client(SUBJECT).container);
    await waitFor(held, { timeout: 60000, interval: 2000, label: 'out of service again once FluxOS is back' });
    await expectHeldThroughout('out of service after the restart');
  });

  it('stays out of service until the chain is 2400 blocks past the change, then is back in service', async function () {
    this.timeout(4 * STANDS_MS + 300000);
    await stopTicker();
    const { ipChangeHold } = await record();
    expect(ipChangeHold?.fromHeight, 'the height the hold started at').to.be.a('number');

    await setHeight(ipChangeHold.fromHeight + WINDOW_BLOCKS - 1);
    await expectHeldThroughout(`out of service ${WINDOW_BLOCKS - 1} blocks past the change`);

    await setHeight(ipChangeHold.fromHeight + WINDOW_BLOCKS);
    await waitFor(async () => !(await held()), {
      timeout: 60000, interval: 2000, label: `back in service ${WINDOW_BLOCKS} blocks past the change`,
    });
    expect((await record()).ipChangeHold, 'the hold the record holds').to.equal(null);
  });
});
