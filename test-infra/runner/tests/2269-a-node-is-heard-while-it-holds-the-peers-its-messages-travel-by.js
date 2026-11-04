import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { assertNoEvent, waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node can send only while it holds the peers its messages travel by: the same
// two thresholds the app sync reads, so it stays heard as peers fall to the lower
// and is heard again only from the upper. Having them back is what announces its
// apps, once.
//
// Five nodes give node 2 four peers. The thresholds are 3 up and 2 down, so a node
// cut to 2 stays heard, cut to 1 is not, and back at 2 still is not. The location
// lifetime is production's, so its next timed announcement is minutes off and an
// announcement after the heal is the one having its peers back caused.
const SUBJECT = 2;
const FIRST_CUT = [0, 1];
const SECOND_CUT = [3];
const LAST_PEER = [4];
const LOCATION_TTL_S = 30 * 60;
// Longer than a socket takes to go and a capability check to run.
const STEADY_MS = 20 * 1000;
const API_PORT = 16127;

describe('a node is heard while it holds the peers its messages travel by', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eheard${Date.now()}`;
  const subject = () => env.clients[SUBJECT];
  const peerCount = async () => {
    const [outbound, inbound] = await Promise.all([subject().getPeers(), subject().getIncomingPeers()]);
    return new Set([...(outbound.data || []), ...(inbound.data || [])]).size;
  };
  const untilPeers = (count, label) => waitFor(async () => await peerCount() === count, { timeout: 120000, interval: 1000, label });
  let lostAt;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      configOverrides: { fluxapps: { appSyncPeerThreshold: 3, appSyncDegradedThreshold: 2, locationTtlS: LOCATION_TTL_S } },
    });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'heard while it holds its peers',
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
    await installOnNodes(env, app, [SUBJECT]);
    await waitFor(async () => (await dbClient(LAST_PEER[0] + 1).getAppLocations(appName)).length === 1, {
      timeout: 180000, interval: 3000, label: 'a peer holds the app',
    });
    await untilPeers(4, 'fixture: the node holds its four peers');
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('stays heard with its peers at the lower threshold', async function () {
    this.timeout(180000);
    const anchor = subject().getLastEventId();
    await env.partitionGroups([SUBJECT], FIRST_CUT);
    await untilPeers(2, 'fixture: the node is cut to two peers');
    await assertNoEvent(subject(), 'messageCapability:changed', () => true, STEADY_MS, { afterId: anchor });
  });

  it('stops being heard below it', async function () {
    this.timeout(180000);
    const anchor = subject().getLastEventId();
    await env.partitionGroups([SUBJECT], SECOND_CUT);
    await untilPeers(1, 'fixture: the node is cut to one peer');
    await subject().waitForEvent('messageCapability:changed', (d) => d.capable === false, 30000, { afterId: anchor });
    lostAt = subject().getLastEventId();
  });

  it('is not heard again until its peers reach the upper threshold', async function () {
    this.timeout(180000);
    await env.healPartition([SUBJECT], SECOND_CUT);
    await untilPeers(2, 'fixture: the node has two peers back');
    await assertNoEvent(subject(), 'messageCapability:changed', () => true, STEADY_MS, { afterId: lostAt });
  });

  it('announces its apps once when it is heard again', async function () {
    this.timeout(240000);
    const healedAt = Date.now();
    await env.healPartition([SUBJECT], FIRST_CUT);
    await subject().waitForEvent('messageCapability:changed', (d) => d.capable === true, 120000, { afterId: lostAt });
    await waitFor(async () => {
      const [row] = await dbClient(LAST_PEER[0] + 1).getAppLocations(appName);
      return row && new Date(row.broadcastedAt).getTime() >= healedAt;
    }, { timeout: 60000, interval: 1000, label: 'a peer holds the announcement' });

    const announced = () => subject().getEventBuffer().filter((event) => event.id > lostAt && event.event === 'app:running');
    expect(announced().map((event) => event.data.ip), 'one announcement').to.deep.equal([`${subject().ip}:${API_PORT}`]);
    await assertNoEvent(subject(), 'app:running', () => true, STEADY_MS, { afterId: announced()[0].id });
  });
});
