// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitForBootSettled, assertNoEvent } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { restartFluxos } from '../framework/container.js';
import { setBenchmarkUnresolved } from '../framework/daemon-control.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node's location rows are filed under its address, and an installed app
// without a placement record is dated from this node's own row. A node that
// boots before benchmark reports its address writes no record until it has one
// (app:placementRecorded), then dates the app at its own row, and its next
// announcement carries that date to its peers.

const REAL_NODES = 3;
const realNodes = Array.from({ length: REAL_NODES }, (_unused, i) => i);
const DAY_MS = 24 * 60 * 60 * 1000;
// Production's location lifetime, so this node's own row still stands while it
// has no address.
const LOCATION_TTL_S = 30 * 60;
// Long enough that the node is not out of service while the case holds its
// address back, at the harness's 15 s ask interval.
const PUBLIC_IP_ASKS_BEFORE_DOS = 40;
// A node syncs its apps only once it can be heard, which needs its address, and
// removes them when it has not synced within this: long enough to hold the
// address back and keep the app.
const BOOT_SYNC_TIMEOUT_MS = 300000;
// One harness ask interval and three confirmation polls: a backfill that ran
// without the address has written by then.
const UNRESOLVED_WINDOW_MS = 20000;
const bare = (address) => String(address).replace(/:16127$/, '');

describe('a node that boots without its address dates its records once it has one', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let holder;
  let others;
  const appName = `e2enoaddress${Date.now()}`;

  const marks = () => realNodes.map((i) => env.clients[i].getLastEventId());
  const runningSinceIn = (data) => {
    const entry = data.apps?.find((a) => a.name === appName);
    return entry ? new Date(entry.runningSince).getTime() : null;
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { locationTtlS: LOCATION_TTL_S, publicIpAsksBeforeDos: PUBLIC_IP_ASKS_BEFORE_DOS },
        system: { bootSyncTimeoutMs: BOOT_SYNC_TIMEOUT_MS },
      },
    });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'no address at boot',
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
    idx = await seedAndInstall(env, app);
    holder = socketAddr(idx + 1);
    others = realNodes.filter((i) => i !== idx);
    await env.clients[idx].waitForEvent('app:running', (d) => runningSinceIn(d) !== null, 120000);
  });

  after(async function () {
    this.timeout(60000);
    if (holder) await setBenchmarkUnresolved(holder, false).catch(() => {});
    await env?.teardown();
  });

  it('writes no record while it has no address, then dates the app at its own row and announces that', async function () {
    this.timeout(480000);
    const rowSince = Date.now() - 3 * DAY_MS;
    await dbClient(idx + 1).deletePlacement(appName);
    await dbClient(idx + 1).setAppLocationRunningSince(appName, holder, rowSince);
    expect((await dbClient(idx + 1).appLocationAt(appName, holder))?.runningSince?.getTime(), 'fixture: the node\'s own row').to.equal(rowSince);

    await setBenchmarkUnresolved(holder, true);
    const afterIds = marks();
    await restartFluxos(env.clients[idx].container);

    await assertNoEvent(env.clients[idx], 'app:placementRecorded', (d) => d.name === appName, UNRESOLVED_WINDOW_MS, { afterId: afterIds[idx] });

    const resolvedIds = marks();
    await setBenchmarkUnresolved(holder, false);
    await waitForBootSettled(env.clients[idx], 240000, { afterId: afterIds[idx] });
    const { data: recorded } = await env.clients[idx].waitForEvent('app:placementRecorded', (d) => d.name === appName, 120000, { afterId: resolvedIds[idx] });
    expect(recorded.source, 'the record was not dated from the node\'s own row').to.equal('locationRow');
    expect(new Date(recorded.placedAt).getTime(), 'the record is not the node\'s own row\'s date').to.equal(rowSince);

    const stored = await Promise.all(others.map((i) => env.clients[i].waitForEvent(
      'network:apprunning',
      (d) => bare(d.ip) === bare(holder) && d.apps?.some((a) => a.name === appName),
      120000,
      { afterId: resolvedIds[i] },
    )));
    expect(stored.map(({ data }) => runningSinceIn(data)), 'a peer stored a different runningSince').to.deep.equal(others.map(() => rowSince));
  });
});
