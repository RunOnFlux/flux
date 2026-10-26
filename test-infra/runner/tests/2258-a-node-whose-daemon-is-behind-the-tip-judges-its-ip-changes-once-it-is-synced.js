// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { crashFluxos, moveNodeAddress, releaseFluxos } from '../framework/container.js';
import {
  advanceBlock, clearDaemonBehind, clearNodeAddress, setDaemonBehind, setHeight, setNodeAddress, stopTicker,
} from '../framework/daemon-control.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The limit on IP changes counts the changes inside a window of blocks, so it
// needs the chain's height. A daemon behind the tip - catching up, or
// re-syncing from far behind - holds a height below the ones the node's changes
// were recorded at, and would read every one of them as recent. A node judges
// its IP changes only at the height of a daemon synced to the tip: a change it
// sees while its daemon is behind is recorded and judged once the daemon has
// caught up.
//
// Node 0 changes its IP inside the window while its daemon is behind; node 1
// changes its IP once its earlier change has left the window, while its daemon
// re-syncs from far behind; node 2 is a bystander.

const BEHIND = 0;
const RESYNCING = 1;
const API_PORT = 16127;
const WINDOW_BLOCKS = 2400;
const IP_CHANGES = 'IP changes over the limit allowed, one in 20 hours';
const DETECTION_MS = 6 * 60 * 1000;
// Longer than the availability recheck and several daemon polls, so a decision
// something would make is seen made.
const STANDS_MS = 60 * 1000;

describe('a node whose daemon is behind the tip judges its IP changes once it is synced', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ebehindtip${Date.now()}`;
  const client = (i) => env.clients[i];
  const listed = {};
  const socketOf = (ip) => `${ip}:${API_PORT}`;
  const record = (i) => dbClient(i + 1).ownAddressRecord();
  const dos = async (i) => {
    const { data } = await client(i).getDOSState();
    return { dosState: data?.dosState ?? null, dosMessage: data?.dosMessage ?? null };
  };
  // held for its IP changes: out of service at 100, for that reason
  const heldForIpChanges = async (i) => {
    const { dosState, dosMessage } = await dos(i);
    return dosState >= 100 && dosMessage === IP_CHANGES;
  };
  const runsTheApp = async (i) => ((await client(i).getInstalledApps()).data || []).some((app) => app.name === appName);
  let tip;

  // Node i has polled its daemon at `height`: a change it sees from now is
  // recorded there.
  const polledAt = (i, height) => client(i).waitForEvent('daemon:polled', (d) => d.height === height, 120000);

  // Moves node i's address as a router's change does: benchmark reports the
  // new one while the chain still lists the old.
  async function move(i, to) {
    const from = client(i).ip;
    await setNodeAddress(listed[i], to, { scope: 'benchmark' });
    await moveNodeAddress(client(i).container, to, from);
    await client(i).followTo(to);
    await waitFor(async () => (await record(i))?.socketAddress === socketOf(to), {
      timeout: DETECTION_MS, interval: 5000, label: `node ${i}'s move to ${to} recorded`,
    });
  }

  // Node i is not held for its IP changes, runs the app, and has no hold in its
  // record, now and for all of STANDS_MS.
  async function expectNotJudgedThroughout(i, label) {
    const until = Date.now() + STANDS_MS;
    while (Date.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      expect(await heldForIpChanges(i), `${label}: held for its IP changes`).to.equal(false);
      // eslint-disable-next-line no-await-in-loop
      expect(await runsTheApp(i), `${label}: runs the app`).to.equal(true);
      // eslint-disable-next-line no-await-in-loop
      expect((await record(i))?.ipChangeHold ?? null, `${label}: the hold its record holds`).to.equal(null);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 5000); });
    }
  }

  async function expectHeldThroughout(i, label) {
    const until = Date.now() + STANDS_MS;
    while (Date.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      expect(await dos(i), label).to.deep.equal({ dosState: 100, dosMessage: IP_CHANGES });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 5000); });
    }
  }

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 2,
      compose: [{
        name: 'alpha',
        description: 'held through a daemon behind the tip',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
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
    await installOnNodes(env, app, [BEHIND, RESYNCING]);
    // The chain moves only as the cases move it, so the window is theirs.
    await stopTicker();
    ({ currentHeight: tip } = await advanceBlock());
    listed[BEHIND] = client(BEHIND).ip;
    listed[RESYNCING] = client(RESYNCING).ip;
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all([BEHIND, RESYNCING].map(async (i) => {
      if (listed[i]) {
        await clearDaemonBehind(listed[i]).catch(() => {});
        await clearNodeAddress(listed[i]).catch(() => {});
      }
    }));
    await env?.teardown();
  });

  it('records a change it sees while its daemon is behind, keeps it through a FluxOS restart, and judges it once the daemon is synced', async function () {
    this.timeout(2 * DETECTION_MS + 4 * STANDS_MS + 600000);
    const base = client(BEHIND).ip.replace(/\.\d+$/, '');
    await polledAt(BEHIND, tip);
    await move(BEHIND, `${base}.240`);
    expect(await heldForIpChanges(BEHIND), 'fixture: held for one IP change').to.equal(false);
    const [first] = (await record(BEHIND)).ipChangeHeights;
    expect(first, 'fixture: the first change has the chain\'s height').to.equal(tip);

    await setDaemonBehind(listed[BEHIND], tip - 100);
    await move(BEHIND, `${base}.241`);
    expect((await record(BEHIND)).ipChangeHeights, 'the change seen while behind').to.deep.equal([tip, null]);
    await expectNotJudgedThroughout(BEHIND, 'while its daemon is behind');

    // FluxOS restarts in place while the daemon is still behind: what was
    // recorded is all that is left of the change.
    await crashFluxos(client(BEHIND).container, { hold: true });
    await releaseFluxos(client(BEHIND).container);
    await waitFor(async () => (await record(BEHIND))?.socketAddress === socketOf(`${base}.241`), {
      timeout: 120000, interval: 3000, label: 'FluxOS back',
    });
    await expectNotJudgedThroughout(BEHIND, 'after the restart, its daemon still behind');

    await clearDaemonBehind(listed[BEHIND]);
    await advanceBlock();
    await waitFor(() => heldForIpChanges(BEHIND), { timeout: 120000, interval: 2000, label: 'out of service once its daemon is synced' });
    await waitFor(async () => !(await runsTheApp(BEHIND)), { timeout: 300000, interval: 5000, label: 'its apps removed' });
    const { ipChangeHeights, ipChangeHold } = await record(BEHIND);
    expect(ipChangeHeights.every((at) => typeof at === 'number'), 'every change has a height').to.equal(true);
    expect(ipChangeHold?.fromHeight, 'the hold starts at the newest change').to.equal(Math.max(...ipChangeHeights));
  });

  it('stays out of service while its daemon falls behind during the hold, and is released only by the synced chain passing it', async function () {
    this.timeout(4 * STANDS_MS + 600000);
    const { ipChangeHold } = await record(BEHIND);
    expect(ipChangeHold?.fromHeight, 'fixture: the hold the first case started').to.be.a('number');

    // The chain passes the hold while the node's daemon is still short of it.
    await setDaemonBehind(listed[BEHIND], ipChangeHold.fromHeight + 10);
    await setHeight(ipChangeHold.fromHeight + WINDOW_BLOCKS);
    await expectHeldThroughout(BEHIND, 'held while its daemon is behind the end of the hold');

    await clearDaemonBehind(listed[BEHIND]);
    await advanceBlock();
    await waitFor(async () => !(await heldForIpChanges(BEHIND)), {
      timeout: 120000, interval: 2000, label: 'back in service once its daemon has the chain past the hold',
    });
    expect((await record(BEHIND)).ipChangeHold, 'the hold the record holds').to.equal(null);
  });

  it('counts no change that has left the window while its daemon re-syncs from far behind, nor once it is synced', async function () {
    this.timeout(2 * DETECTION_MS + 2 * STANDS_MS + 600000);
    const base = client(RESYNCING).ip.replace(/\.\d+$/, '');
    await move(RESYNCING, `${base}.242`);
    const [first] = (await record(RESYNCING)).ipChangeHeights;
    expect(first, 'fixture: the first change has a height').to.be.a('number');

    // The first change leaves the window, and the daemon re-syncs from far below
    // the height it was recorded at.
    ({ currentHeight: tip } = await setHeight(first + WINDOW_BLOCKS));
    await setDaemonBehind(listed[RESYNCING], 100);
    await move(RESYNCING, `${base}.243`);
    await expectNotJudgedThroughout(RESYNCING, 'while its daemon re-syncs');

    await clearDaemonBehind(listed[RESYNCING]);
    await advanceBlock();
    await waitFor(async () => !(await record(RESYNCING)).ipChangeHeights.includes(null), {
      timeout: 120000, interval: 2000, label: 'the change seen while re-syncing given the chain\'s height',
    });
    await expectNotJudgedThroughout(RESYNCING, 'once its daemon is synced');
    expect((await record(RESYNCING)).ipChangeHeights, 'the changes inside the window').to.have.lengthOf(1);
  });
});
