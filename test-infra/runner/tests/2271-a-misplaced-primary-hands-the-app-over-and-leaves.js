/*
 * A primary the table moves stops writing, a holder takes the app over with everything
 * the primary wrote, and the node leaves on a later turn, with a free correctly placed
 * node taking the gap. Three holders of a g: app wanting three, on four nodes, all in DE
 * until the table moves the primary.
 *
 * Real syncthing, because the property is that the final save, made by the stop itself,
 * reaches the node that takes over. The app writes one on SIGTERM.
 *
 * Not here: a primary whose peers cannot take over, and a placement that cannot be read.
 * Those are unit-tested.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { listAppContainers } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, installedInstanceIndices, seedSpawnerApp, waitForInstanceCount,
} from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { followPrimary, getFdmState, resetFdm } from '../framework/fdm-control.js';
import { getFolderConfig, isDaemonUp, readPath } from '../framework/syncthing-real.js';
import { allowFromNow } from '../framework/time-budget.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { PASS_PERIOD_BLOCKS, PASS_MS, RESIDENTIAL_PACING } from '../framework/residential-fleet.js';
import { keysOf, nextOwnedTurn, turnOwner } from '../framework/handback-turns.js';

const subnet = getSubnetConfig();
const NODES = 4;
const HOLDERS = 3;
const PIN = ['acEU_DE'];
const FINAL_SAVE = 'final.sav';
const TICKING_NODE = 0;
const TURN_MS = RESIDENTIAL_PACING.handbackTurnMs;

// To the end of the `nth` turn `node` owns from now.
function ownedTurnEndsInMs(node, holders, nth) {
  const [own] = keysOf([node]);
  const keys = keysOf(holders);
  let { turn } = nextOwnedTurn({
    holders: keys, owners: [own], turnMs: TURN_MS, fromMs: Date.now(),
  });
  for (let owned = 1; owned < nth; turn += 1) {
    if (turnOwner(keys, turn + 1) === own) owned += 1;
  }
  return Math.max(0, (turn + 1) * TURN_MS - Date.now()) + (2 * PASS_MS);
}

describe('a misplaced primary hands the app over and leaves', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2emoved${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  let moved;
  let free;
  let holders;
  let root;

  const running = async (i) => (await listAppContainers(env.clients[i].container))
    .some((c) => c.name.includes(appName) && c.status?.startsWith('Up'));
  const event = (i, name) => env.clients[i].getEventBuffer()
    .find((e) => e.event === name && (e.data?.appName === appName || e.data?.components));
  const drive = (i, condition, timeoutMs, label) => driveUntil(env.clients[i], condition, { timeoutMs, label });

  const publishTable = async (body) => {
    const response = await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok, 'the stub accepted the publication').to.equal(true);
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      syncthing: 'binary',
      tickerAutostart: false,
      locationTable: { domains: 1 },
      nodeConfigOverrides: { [TICKING_NODE]: { policy: { refreshIntervalMs: 15000 } } },
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          daemonInfoIntervalMs: 1000,
          removeFluxAppsPeriod: PASS_PERIOD_BLOCKS,
          handbackTurnMs: TURN_MS,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await waitFor(async () => {
      const trees = await Promise.all(env.clients.map((client) => client.get('/apps/placementlocations').catch(() => null)));
      return trees.every((tree) => tree?.status === 'success' && tree.data.tableAvailable === true && tree.data.unresolved === 0);
    }, { timeout: 120000, interval: 3000, label: 'every node holds the location table' });

    await followPrimary(appName, { nodes: env.clients.map((c) => new URL(c.url).host), gNames: [folder] });
    await pushTestApp(appName, 'v1', appName, { user: 1000 });
    await seedSpawnerApp(env, await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS,
      geolocation: PIN,
      compose: [{
        name: appName,
        description: 'g: component',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed', `WRITE_ON_SIGNAL=/appdata/${FINAL_SAVE}`],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    }));
    await waitForInstanceCount(env, appName, HOLDERS, { timeout: 300000 });
    holders = await installedInstanceIndices(env, appName);
    await waitFor(async () => (await Promise.all(holders.map(running))).filter(Boolean).length === 1, {
      timeout: 300000, interval: 3000, label: 'one holder is the primary',
    });
    moved = holders[(await Promise.all(holders.map(running))).indexOf(true)];
    await waitFor(async () => (await getFdmState()).following?.[appName]?.served === subnet.nodeIp(moved + 1), {
      timeout: 180000, interval: 3000, label: 'FDM names the primary',
    });
    free = [...Array(NODES).keys()].find((i) => !holders.includes(i));
    root = (await getFolderConfig(env.clients[moved], folder)).path;
    await waitFor(async () => (await Promise.all(holders.map((i) => readPath(env.clients[i], `${root}/appdata/placed.txt`))))
      .every((content) => content !== null), {
      timeout: 180000, interval: 3000, label: 'every holder has the primary\'s data',
    });

    const beforeMove = env.clients.map((client) => client.getLastEventId());
    await publishTable({ domains: 1, countryByIp: { [subnet.nodeIp(moved + 1)]: 'FR' } });
    await Promise.all(env.clients.map((client, i) => client.waitForEvent(
      'ipLocation:tableInstalled',
      () => true,
      240000,
      { afterId: beforeMove[i] },
    )));
    await stopTicker();
  });

  after(async function () {
    this.timeout(30000);
    await fetch(`${env?.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 1 }),
    }).catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('the moved primary stops writing and a holder takes over with its final save', async function () {
    const waitMs = ownedTurnEndsInMs(moved + 1, holders.map((i) => i + 1), 1);
    allowFromNow(this, waitMs + 420000);
    await drive(moved, async () => Boolean(event(moved, 'giveUp:standDown')), waitMs, 'the primary stood down');
    expect(await running(moved), 'the moved node stopped').to.equal(false);

    const others = holders.filter((i) => i !== moved);
    await drive(others[0], async () => (await Promise.all(others.map(running))).some(Boolean), 300000, 'a holder took over');
    const next = others[(await Promise.all(others.map(running))).indexOf(true)];
    await drive(next, async () => (await readPath(env.clients[next], `${root}/appdata/${FINAL_SAVE}`)) !== null, 120000, 'the final save on the new primary');
    expect(await running(moved), 'the moved node stayed stopped').to.equal(false);
  });

  it('the node leaves, and the free correctly placed node takes the gap', async function () {
    const waitMs = ownedTurnEndsInMs(moved + 1, holders.map((i) => i + 1), 2);
    allowFromNow(this, waitMs + 420000);
    await drive(free, async () => !(await installedInstanceIndices(env, appName)).includes(moved), waitMs, 'the moved node gave the app up');
    await drive(free, async () => {
      const now = await installedInstanceIndices(env, appName);
      return now.length === HOLDERS && now.includes(free);
    }, 300000, 'the free node took the gap');
    await drive(free, async () => (await readPath(env.clients[free], `${root}/appdata/${FINAL_SAVE}`)) !== null, 180000, 'the data on the free node');
  });
});
